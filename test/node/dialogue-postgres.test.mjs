import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import postgres from 'postgres';
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'node',
});
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const { sql: dsql } = require('drizzle-orm');
const {
  DialogueRepository,
} = require('../../server/modules/canonical-host/dialogue.repository.ts');
const {
  DialogueAssessmentRepository,
} = require('../../server/modules/canonical-host/dialogue-assessment.repository.ts');
const url = process.env.DIALOGUE_TEST_DATABASE_URL;
const scope = { tenantId: 'tenant-test', actorId: 'actor-test' };
const context = {
  generationQuery: 'saved exact query',
  focus: [],
  contextWorkItemIds: [],
  historyMessageRefs: [],
  earlierMessagesOmitted: false,
};

test(
  'private dialogue migrations, real concurrent CAS, immutable text, RLS and assessment binding',
  { skip: !url },
  async () => {
    const parsed = new URL(url);
    assert.ok(['localhost', '127.0.0.1'].includes(parsed.hostname));
    assert.equal(parsed.pathname, '/wiselink_dialogue_test');
    const pg = postgres(url, { max: 5, onnotice() {} });
    try {
      await reset(pg);
      const actorTransactions = {
        withActorTransaction(actorId, operation) {
          return drizzle(pg).transaction(async (db) => {
            await db.execute(dsql`SET LOCAL ROLE service_role`);
            await db.execute(
              dsql`SELECT set_config('app.user_id', ${actorId}, true)`,
            );
            return operation({ database: db });
          });
        },
      };
      const repo = new DialogueRepository(actorTransactions);
      const assessment = new DialogueAssessmentRepository(repo);
      const thread = await repo.create(scope, 'create', ['WI-test']);
      assert.equal(
        (await repo.create(scope, 'create', ['WI-test'])).thread_ref,
        thread.thread_ref,
      );
      await assert.rejects(
        repo.create(scope, 'create', []),
        /DIALOGUE_REQUEST_REPLAY_CONFLICT/,
      );
      assert.deepEqual(
        (await repo.list(scope)).map((row) => row.threadRef),
        [thread.thread_ref],
      );
      assert.deepEqual(
        await repo.list({ tenantId: scope.tenantId, actorId: 'actor-other' }),
        [],
      );
      assert.deepEqual(await repo.list(scope, thread.thread_ref), []);
      const input = {
        threadRef: thread.thread_ref,
        requestKey: 'message',
        expectedRevision: 1,
        userText: '请核对😀原话',
        origin: 'FEISHU_EXCERPT',
        originDetails: {},
        focusIds: ['WI-test'],
        purpose: 'CONTRIBUTION_ONLY',
        context,
      };
      const competing = await Promise.allSettled([
        repo.append(scope, input),
        repo.append(scope, { ...input, requestKey: 'competing' }),
      ]);
      assert.equal(
        competing.filter((result) => result.status === 'fulfilled').length,
        1,
      );
      assert.equal(
        competing.filter((result) => result.status === 'rejected').length,
        1,
      );
      const saved = competing.find((result) => result.status === 'fulfilled')
        .value.message;
      const state = await repo.read(scope, thread.thread_ref);
      assert.equal(state.messages.length, 1);
      assert.equal(state.thread.revision, 2);
      const contributionInput = {
        threadRef: thread.thread_ref,
        requestKey: 'selection',
        expectedRevision: 2,
        messageRef: saved.message_ref,
        sourcePart: 'USER',
        selection: { start: 3, end: 5 },
        workItemId: 'WI-test',
        kind: 'CORRECTION',
      };
      await assert.rejects(
        repo.saveContribution(scope, {
          ...contributionInput,
          selection: { start: 3, end: 4 },
        }),
        /DIALOGUE_SELECTION_INVALID/,
      );
      const contribution = await repo.saveContribution(
        scope,
        contributionInput,
      );
      assert.equal(contribution.selected_text, '😀');
      assert.equal(
        (await repo.saveContribution(scope, contributionInput))
          .contribution_ref,
        contribution.contribution_ref,
      );
      await assert.rejects(
        repo.saveContribution(scope, {
          ...contributionInput,
          kind: 'QUESTION',
        }),
        /DIALOGUE_REQUEST_REPLAY_CONFLICT/,
      );
      const updateCount = await repo.transaction(scope, (db) =>
        db.execute(
          dsql`UPDATE dialogue_message SET user_text='changed' WHERE message_ref=${saved.message_ref}::uuid RETURNING message_ref`,
        ),
      );
      assert.equal(updateCount.length, 0);
      await assert.rejects(
        repo.read(
          { tenantId: scope.tenantId, actorId: 'actor-other' },
          thread.thread_ref,
        ),
        /DIALOGUE_NOT_FOUND/,
      );
      await assert.rejects(
        repo.read(
          { tenantId: 'tenant-other', actorId: scope.actorId },
          thread.thread_ref,
        ),
        /DIALOGUE_NOT_FOUND/,
      );
      await assert.rejects(
        repo.create(
          { tenantId: 'tenant-other', actorId: scope.actorId },
          'forged',
          [],
        ),
        (error) => error.cause?.code === '42501',
      );
      const otherThread = await repo.create(scope, 'other-thread', []);
      await assert.rejects(
        repo.saveContribution(scope, {
          ...contributionInput,
          requestKey: 'cross-thread',
          threadRef: otherThread.thread_ref,
          expectedRevision: 1,
        }),
        /DIALOGUE_NOT_FOUND/,
      );
      const request = {
        requestId: 'explicit-update',
        workItemId: 'WI-test',
        expectedWorkItemRevision: 2,
        expectedWorkingRef: 'work-1',
        contributions: [
          {
            contributionRef: contribution.contribution_ref,
            expectedRevision: 1,
          },
        ],
        userMessage: '重新评估',
      };
      const snapshot = {
        contextWorkItemIds: ['WI-test'],
        contributions: [
          {
            contributionRef: contribution.contribution_ref,
            revision: 1,
            selectedText: '😀',
          },
        ],
      };
      const frozen = await assessment.create(
        scope,
        thread.thread_ref,
        request,
        snapshot,
        'exact user payload',
        'RC-test',
      );
      assert.equal(
        (
          await assessment.create(
            scope,
            thread.thread_ref,
            request,
            snapshot,
            'ignored new context',
            'RC-test',
          )
        ).user_message,
        'exact user payload',
      );
      await assert.rejects(
        assessment.create(
          scope,
          thread.thread_ref,
          { ...request, userMessage: 'altered' },
          snapshot,
          'changed',
          'RC-test',
        ),
        /DIALOGUE_REQUEST_REPLAY_CONFLICT/,
      );
      await assessment.bind(scope, frozen, 'RT-test');
      await assessment.bind(scope, frozen, 'RT-test');
      const bound = await repo.read(scope, thread.thread_ref);
      assert.equal(JSON.parse(bound.contributions[0].used_by_json).length, 1);
      await repo.withdraw(
        scope,
        thread.thread_ref,
        contribution.contribution_ref,
        'withdraw',
        1,
      );
      assert.equal(
        (await assessment.find(scope, thread.thread_ref, request.requestId))
          .user_message,
        'exact user payload',
      );
      await assert.rejects(
        assessment.create(
          scope,
          thread.thread_ref,
          { ...request, requestId: 'new-after-withdraw' },
          snapshot,
          'new',
          'RC-test',
        ),
        /DIALOGUE_CONTRIBUTION_CHANGED/,
      );
      assert.equal(
        (await repo.relevantContributions(scope, ['WI-test'])).length,
        0,
      );
      // The old attempt-bound query still works; new message-bound queries keep XOR.
      await pg`INSERT INTO review_aily_query (attempt_ref,tenant_id,actor_id,session_id,agent_id,request_key,query_text) VALUES ('ATT-test','tenant-test','actor-test','11111111-1111-1111-1111-111111111111','agent','old','query')`;
      const chat = (
        await repo.append(scope, {
          ...input,
          threadRef: otherThread.thread_ref,
          expectedRevision: 1,
          purpose: 'CHAT',
          requestKey: 'chat',
        })
      ).message;
      await repo.transaction(scope, (db) =>
        db.execute(
          dsql`INSERT INTO review_aily_query (message_ref,tenant_id,actor_id,session_id,agent_id,request_key,query_text) VALUES (${chat.message_ref}::uuid,'tenant-test','actor-test','11111111-1111-1111-1111-111111111111','agent','chat','query')`,
        ),
      );
      await assert.rejects(
        repo.append(scope, {
          ...input,
          threadRef: otherThread.thread_ref,
          expectedRevision: 2,
          purpose: 'CHAT',
          requestKey: 'next-chat',
        }),
        /DIALOGUE_MESSAGE_IN_PROGRESS/,
      );
      await repo.transaction(scope, (db) =>
        db.execute(
          dsql`UPDATE review_aily_query SET status='UNKNOWN' WHERE message_ref=${chat.message_ref}::uuid`,
        ),
      );
      await repo.append(scope, {
        ...input,
        threadRef: otherThread.thread_ref,
        expectedRevision: 2,
        purpose: 'CHAT',
        requestKey: 'next-chat',
      });
      await pg.begin(async (tx) => {
        await tx.unsafe('SET LOCAL ROLE authenticated');
        await tx`SELECT set_config('app.user_id', 'actor-test', true)`;
        assert.equal((await tx`SELECT * FROM dialogue_thread`).length, 0);
      });
    } finally {
      await pg.end();
    }
  },
);

async function reset(pg) {
  await pg.unsafe(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    END $$;
    CREATE TYPE user_profile AS (user_id text);
    CREATE TABLE identity_subject_mapping (id uuid, miaoda_user_id text, miaoda_tenant_id text, expected_client_id text, status text);
    CREATE TABLE identity_session (id uuid PRIMARY KEY, subject_mapping_id uuid, revoked_at timestamptz, expires_at timestamptz);
    CREATE TABLE work_item (work_item_id varchar(96) PRIMARY KEY,tenant_id varchar(255),requested_by_user_id text, UNIQUE(tenant_id,work_item_id));
    CREATE TABLE action_attempt (attempt_id varchar(96) PRIMARY KEY,tenant_id text,actor_user_id text,action_type text);
    CREATE TABLE review_conversation (review_conversation_id varchar(96) PRIMARY KEY);
    CREATE TABLE review_turn (review_turn_id varchar(96) PRIMARY KEY,review_conversation_id varchar(96),tenant_id text,actor_id text,work_item_id text);
    INSERT INTO identity_subject_mapping VALUES ('11111111-1111-1111-1111-111111111111','actor-test','tenant-test','cli_aadde8b579f95bc9','ACTIVE');
    INSERT INTO identity_session VALUES ('11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111',NULL,now()+interval '1 day');
    INSERT INTO work_item VALUES ('WI-test','tenant-test','actor-test');
    INSERT INTO action_attempt VALUES ('ATT-test','tenant-test','actor-test','OPENCLAW_INTERACTIVE_REVIEW');
    INSERT INTO review_conversation VALUES ('RC-test');
    INSERT INTO review_turn VALUES ('RT-test','RC-test','tenant-test','actor-test','WI-test');`);
  const migration = await pg.reserve();
  try {
    const catalog = await readFile(
      new URL(
        '../../migrations/0014_engineering_matter_catalog.sql',
        import.meta.url,
      ),
      'utf8',
    );
    for (const name of [
      'engineering_matter_actor_has_tenant',
      'engineering_matter_work_item_owned_by_actor',
    ]) {
      const match = catalog.match(
        new RegExp(
          `CREATE OR REPLACE FUNCTION ${name}\\([\\s\\S]+?\\$\\$;`,
          'u',
        ),
      );
      assert.ok(match);
      await migration.unsafe(match[0]);
    }
    for (const file of [
      '0029_review_aily_user_delegation.sql',
      '0030_personal_dialogue.sql',
    ])
      await migration.unsafe(
        await readFile(
          new URL(`../../migrations/${file}`, import.meta.url),
          'utf8',
        ),
      );
  } finally {
    migration.release();
  }
  await pg.unsafe(
    'GRANT USAGE ON SCHEMA public TO service_role,authenticated; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO service_role,authenticated;',
  );
}
