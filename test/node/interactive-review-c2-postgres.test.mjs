import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
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
const {
  ReviewConversationRepository,
} = require('../../server/modules/review-persistence/review-conversation.repository.ts');

const databaseUrl = process.env.REVIEW_C2_TEST_DATABASE_URL;

test(
  'R09 C2 PostgreSQL serial migration, repository readback and fail-closed guards',
  { skip: !databaseUrl },
  async () => {
    assertSafeIsolatedDatabase(databaseUrl);
    const sql = postgres(databaseUrl, { max: 8 });
    try {
      await resetDatabase(sql);
      await seedC1Turn(sql);
      await assertOpenClawActorScopedBinding(databaseUrl);
      const repository = new ReviewConversationRepository(drizzle(sql));
      const aggregate = await repository.loadById('RC-C2');
      assert.ok(aggregate);
      assert.equal(aggregate.turns[0].assistantCandidate, null);
      assert.equal(
        await repository.hasActiveOfficialActorMapping({
          tenantId: 'tenant-C2',
          actorId: 'actor-C2',
        }),
        true,
      );

      const incoming = candidate('AQ-C2', 'a'.repeat(64));
      const first = await repository.persistAssistantCandidate({
        conversation: aggregate.conversation,
        turn: aggregate.turns[0],
        actionAttemptId: 'ATT-C2',
        candidate: incoming,
        completedAt: new Date('2026-08-26T12:00:00.000Z'),
      });
      assert.equal(first.replayed, false);
      assert.deepEqual(first.turn.assistantCandidate, {
        ...incoming,
        completedAt: '2026-08-26T12:00:00.000Z',
      });

      const replay = await repository.persistAssistantCandidate({
        conversation: aggregate.conversation,
        turn: aggregate.turns[0],
        actionAttemptId: 'ATT-C2',
        candidate: incoming,
        completedAt: new Date('2026-08-26T12:01:00.000Z'),
      });
      assert.equal(replay.replayed, true);
      assert.equal(
        replay.turn.assistantCandidate.completedAt,
        '2026-08-26T12:00:00.000Z',
      );
      await sql`UPDATE action_attempt SET status = 'SUCCEEDED' WHERE attempt_id = 'ATT-C2'`;

      await assertAppendOnly(sql);
      await assertStaleRejectedWithoutMutation(sql, repository, aggregate);
      await assertOtherActorRejectedWithoutMutation(sql, repository, aggregate);
      await assertClosedRejectedWithoutMutation(sql, repository, aggregate);
      await assertActiveAttemptActorIsolation(sql);
      await assertSchemaReadback(sql);
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
);

function assertSafeIsolatedDatabase(value) {
  const parsed = new URL(value);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname));
  assert.equal(parsed.pathname, '/wiselink_review_c2_test');
}

async function resetDatabase(sql) {
  const c1 = await readFile(
    resolve(
      process.cwd(),
      'migrations/0009_review_conversation_persistence_c1.sql',
    ),
    'utf8',
  );
  const c2 = await readFile(
    resolve(
      process.cwd(),
      'migrations/0010_interactive_review_host_mcp_c2.sql',
    ),
    'utf8',
  );
  await sql.unsafe('DROP SCHEMA public CASCADE');
  await sql.unsafe('CREATE SCHEMA public');
  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
      THEN CREATE ROLE authenticated NOLOGIN;
      END IF;
    END $$
  `);
  await sql.unsafe(`
    CREATE TABLE identity_subject_mapping (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      miaoda_user_id varchar(255) NOT NULL,
      miaoda_tenant_id varchar(128) NOT NULL,
      expected_client_id varchar(128) NOT NULL,
      status varchar(32) NOT NULL
    )
  `);
  await sql.unsafe(`
    CREATE TABLE work_item (
      work_item_id varchar(96) PRIMARY KEY,
      tenant_id varchar(128) NOT NULL,
      requested_by_user_id varchar(255) NOT NULL,
      revision integer NOT NULL
    )
  `);
  await sql.unsafe(`
    CREATE TABLE action_attempt (
      attempt_id varchar(96) PRIMARY KEY,
      work_item_id varchar(96) NOT NULL REFERENCES work_item(work_item_id),
      action_type varchar(64) NOT NULL,
      actor_user_id varchar(255) NOT NULL,
      tenant_id varchar(128) NOT NULL,
      input_revision integer,
      base_revision integer,
      status varchar(64) NOT NULL,
      result_content_hash varchar(64)
    )
  `);
  await sql.unsafe(`
    CREATE UNIQUE INDEX uk_action_attempt_active_work_task
    ON action_attempt(work_item_id, action_type)
    WHERE status IN ('QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING')
  `);
  const migrationSql = await sql.reserve();
  try {
    await migrationSql.unsafe(c1);
    await migrationSql.unsafe(c2);
  } finally {
    migrationSql.release();
  }
  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'review_c2_runtime')
      THEN CREATE ROLE review_c2_runtime LOGIN PASSWORD 'review-c2-password';
      END IF;
    END $$
  `);
  await sql.unsafe('GRANT authenticated TO review_c2_runtime');
  await sql.unsafe('GRANT USAGE ON SCHEMA public TO authenticated');
  await sql.unsafe(`
    GRANT SELECT ON TABLE
      identity_subject_mapping,
      work_item,
      review_conversation,
      review_turn,
      engineer_supplied_input
    TO authenticated
  `);
}

async function seedC1Turn(sql) {
  await sql`
    INSERT INTO identity_subject_mapping (
      miaoda_user_id, miaoda_tenant_id, expected_client_id, status
    ) VALUES (
      'actor-C2', 'tenant-C2', 'cli_aadde8b579f95bc9', 'ACTIVE'
    )
  `;
  await sql`
    INSERT INTO work_item (
      work_item_id, tenant_id, requested_by_user_id, revision
    ) VALUES ('WI-C2', 'tenant-C2', 'actor-C2', 7)
  `;
  await sql`
    INSERT INTO review_conversation (
      review_conversation_id, tenant_id, actor_id, work_item_id,
      openclaw_agent_id, openclaw_session_key, started_at_revision,
      last_synced_revision, status, created_at, last_active_at
    ) VALUES (
      'RC-C2', 'tenant-C2', 'actor-C2', 'WI-C2',
      'wiselink-engineering', 'review:server-owned:RC-C2', 7, 7,
      'ACTIVE', '2026-08-26T11:00:00.000Z', '2026-08-26T11:00:00.000Z'
    )
  `;
  await insertTurn(sql, 'RT-C2', 'ESI-C2', 'request-C2');
  await insertAttempt(sql, {
    attemptId: 'ATT-C2',
    actorId: 'actor-C2',
    hash: 'a'.repeat(64),
  });
}

async function assertOpenClawActorScopedBinding(value) {
  const runtimeUrl = new URL(value);
  runtimeUrl.username = 'review_c2_runtime';
  runtimeUrl.password = 'review-c2-password';
  const runtimeSql = postgres(runtimeUrl.toString(), { max: 1 });
  try {
    const [identity] = await runtimeSql`
      SELECT
        current_user AS "currentUser",
        rolsuper AS "superuser",
        rolbypassrls AS "bypassRls"
      FROM pg_roles
      WHERE rolname = current_user
    `;
    assert.deepEqual(identity, {
      currentUser: 'review_c2_runtime',
      superuser: false,
      bypassRls: false,
    });

    const repository = new ReviewConversationRepository(drizzle(runtimeSql));
    const binding = await repository.loadOpenClawTurnBinding({
      reviewConversationId: 'RC-C2',
      requestId: 'request-C2',
      tenantId: 'tenant-C2',
      actorId: 'actor-C2',
      workItemId: 'WI-C2',
    });
    assert.ok(binding);
    assert.equal(binding.conversation.reviewConversationId, 'RC-C2');
    assert.equal(binding.turn.reviewTurnId, 'RT-C2');
    assert.equal(binding.turn.assistantCandidate, null);

    const byIdBinding = await repository.loadOpenClawTurnByIdBinding({
      reviewConversationId: 'RC-C2',
      reviewTurnId: 'RT-C2',
      tenantId: 'tenant-C2',
      actorId: 'actor-C2',
      workItemId: 'WI-C2',
    });
    assert.ok(byIdBinding);
    assert.equal(byIdBinding.turn.requestId, 'request-C2');

    const [contextAfterStatement] = await runtimeSql`
      SELECT current_setting('app.user_id', true) AS "actorContext"
    `;
    assert.ok(
      contextAfterStatement.actorContext === null ||
        contextAfterStatement.actorContext === '',
    );

    assert.equal(
      await repository.loadOpenClawTurnBinding({
        reviewConversationId: 'RC-C2',
        requestId: 'request-C2',
        tenantId: 'tenant-C2',
        actorId: 'actor-other',
        workItemId: 'WI-C2',
      }),
      null,
    );
  } finally {
    await runtimeSql.end({ timeout: 5 });
  }
}

async function insertTurn(sql, turnId, inputId, requestId) {
  await sql`
    INSERT INTO review_turn (
      review_turn_id, review_conversation_id, engineer_supplied_input_id,
      tenant_id, actor_id, work_item_id, turn_no, request_id, input_revision,
      user_message, input_type, adoption_status, created_at
    ) VALUES (
      ${turnId}, 'RC-C2', ${inputId}, 'tenant-C2', 'actor-C2', 'WI-C2',
      0, ${requestId}, 7, 'Engineer review input', 'ENGINEER_TEXT',
      'CANDIDATE_UNADOPTED', '2026-08-26T11:01:00.000Z'
    )
  `;
}

async function insertAttempt(sql, input) {
  await sql`
    INSERT INTO action_attempt (
      attempt_id, work_item_id, action_type, actor_user_id, tenant_id,
      input_revision, base_revision, status, result_content_hash
    ) VALUES (
      ${input.attemptId}, 'WI-C2',
      ${input.actionType ?? 'OPENCLAW_INTERACTIVE_REVIEW'},
      ${input.actorId}, 'tenant-C2', 7, 7,
      ${input.status ?? 'COMMITTING'}, ${input.hash ?? null}
    )
  `;
}

function candidate(attemptRef, resultContentHash) {
  return {
    responseType: 'ANSWER',
    answer: 'Candidate response.',
    sourceRefs: ['SRC-C2'],
    missingInputs: [],
    candidateEvidenceRefs: ['SRC-C2'],
    reviewActionDraft: null,
    affectedItemIds: ['RULE-C2'],
    warnings: [],
    actionAttemptRef: attemptRef,
    provenance: {
      runtimeAppId: 'app_17c3zn24kv2',
      profileRef: 'wiselink-engineering',
      modelVersion: 'GLM-5.3',
      promptVersion: 'review-prompt.v1',
      skillVersion:
        'wiselink-research-and-synthesize@r09.interactive-review.c2',
      toolVersions: {
        'wiselink-openclaw-engineering-assessment': '1.1.0',
      },
      resultContentHash,
    },
  };
}

async function assertAppendOnly(sql) {
  await assert.rejects(
    sql`UPDATE review_turn SET assistant_response = 'forged' WHERE review_turn_id = 'RT-C2'`,
    (error) => databaseCode(error) === 'P0001',
  );
  const [row] = await sql`
    SELECT assistant_response AS "assistantResponse"
    FROM review_turn WHERE review_turn_id = 'RT-C2'
  `;
  assert.equal(row.assistantResponse, 'Candidate response.');
}

async function assertStaleRejectedWithoutMutation(sql, repository, aggregate) {
  await insertTurn(sql, 'RT-STALE', 'ESI-STALE', 'request-stale');
  await insertAttempt(sql, {
    attemptId: 'ATT-STALE',
    actorId: 'actor-C2',
    hash: 'b'.repeat(64),
  });
  await sql`UPDATE work_item SET revision = 8 WHERE work_item_id = 'WI-C2'`;
  const turn = await repository.loadTurnById('RC-C2', 'RT-STALE');
  await assert.rejects(
    repository.persistAssistantCandidate({
      conversation: aggregate.conversation,
      turn,
      actionAttemptId: 'ATT-STALE',
      candidate: candidate('AQ-STALE', 'b'.repeat(64)),
      completedAt: new Date('2026-08-26T12:10:00.000Z'),
    }),
    (error) => databaseCode(error) === 'P0001',
  );
  const [row] = await sql`
    SELECT assistant_response AS "assistantResponse"
    FROM review_turn WHERE review_turn_id = 'RT-STALE'
  `;
  assert.equal(row.assistantResponse, null);
  await sql`UPDATE action_attempt SET status = 'FAILED' WHERE attempt_id = 'ATT-STALE'`;
  await sql`UPDATE work_item SET revision = 7 WHERE work_item_id = 'WI-C2'`;
}

async function assertClosedRejectedWithoutMutation(sql, repository, aggregate) {
  await insertTurn(sql, 'RT-CLOSED', 'ESI-CLOSED', 'request-closed');
  await insertAttempt(sql, {
    attemptId: 'ATT-CLOSED',
    actorId: 'actor-C2',
    hash: 'c'.repeat(64),
  });
  await sql`
    UPDATE review_conversation
    SET status = 'CLOSED', closed_at = '2026-08-26T12:20:00.000Z'
    WHERE review_conversation_id = 'RC-C2'
  `;
  const turn = await repository.loadTurnById('RC-C2', 'RT-CLOSED');
  await assert.rejects(
    repository.persistAssistantCandidate({
      conversation: aggregate.conversation,
      turn,
      actionAttemptId: 'ATT-CLOSED',
      candidate: candidate('AQ-CLOSED', 'c'.repeat(64)),
      completedAt: new Date('2026-08-26T12:20:00.000Z'),
    }),
    (error) => databaseCode(error) === 'P0001',
  );
  const [row] = await sql`
    SELECT assistant_response AS "assistantResponse"
    FROM review_turn WHERE review_turn_id = 'RT-CLOSED'
  `;
  assert.equal(row.assistantResponse, null);
  await sql`UPDATE action_attempt SET status = 'FAILED' WHERE attempt_id = 'ATT-CLOSED'`;
}

async function assertOtherActorRejectedWithoutMutation(
  sql,
  repository,
  aggregate,
) {
  await insertTurn(sql, 'RT-OTHER-ACTOR', 'ESI-OTHER-ACTOR', 'request-other');
  await insertAttempt(sql, {
    attemptId: 'ATT-OTHER-ACTOR',
    actorId: 'actor-other',
    hash: 'd'.repeat(64),
  });
  const turn = await repository.loadTurnById('RC-C2', 'RT-OTHER-ACTOR');
  await assert.rejects(
    repository.persistAssistantCandidate({
      conversation: aggregate.conversation,
      turn,
      actionAttemptId: 'ATT-OTHER-ACTOR',
      candidate: candidate('AQ-OTHER-ACTOR', 'd'.repeat(64)),
      completedAt: new Date('2026-08-26T12:15:00.000Z'),
    }),
    (error) => databaseCode(error) === 'P0001',
  );
  const [row] = await sql`
    SELECT assistant_response AS "assistantResponse"
    FROM review_turn WHERE review_turn_id = 'RT-OTHER-ACTOR'
  `;
  assert.equal(row.assistantResponse, null);
  await sql`UPDATE action_attempt SET status = 'FAILED' WHERE attempt_id = 'ATT-OTHER-ACTOR'`;
}

async function assertActiveAttemptActorIsolation(sql) {
  await insertAttempt(sql, {
    attemptId: 'ATT-SAME-ACTOR-BASE',
    actorId: 'actor-C2',
    status: 'RUNNING',
  });
  await assert.rejects(
    insertAttempt(sql, {
      attemptId: 'ATT-DIFFERENT-ACTOR',
      actorId: 'actor-other',
      status: 'RUNNING',
    }),
    (error) => databaseCode(error) === '23505',
  );
  await assert.rejects(
    insertAttempt(sql, {
      attemptId: 'ATT-SAME-ACTOR-DUPLICATE',
      actorId: 'actor-C2',
      status: 'RUNNING',
    }),
    (error) => databaseCode(error) === '23505',
  );
  await insertAttempt(sql, {
    attemptId: 'ATT-V1-UNCHANGED',
    actorId: 'actor-C2',
    actionType: 'OPENCLAW_DYNAMIC_EVALUATION',
    status: 'RUNNING',
  });
}

async function assertSchemaReadback(sql) {
  const constraints = await sql`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'review_turn'::regclass
      AND conname IN (
        'fk_review_turn_action_attempt',
        'uk_review_turn_action_attempt',
        'ck_review_turn_c2_candidate_state'
      )
    ORDER BY conname
  `;
  assert.deepEqual(
    constraints.map((row) => row.conname),
    [
      'ck_review_turn_c2_candidate_state',
      'fk_review_turn_action_attempt',
      'uk_review_turn_action_attempt',
    ],
  );
  const [index] = await sql`
    SELECT indexdef FROM pg_indexes
    WHERE indexname = 'uk_action_attempt_active_work_task'
  `;
  assert.match(index.indexdef, /work_item_id, action_type/iu);
  assert.doesNotMatch(index.indexdef, /actor_user_id/iu);
}

function databaseCode(error) {
  let current = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (!current || typeof current !== 'object') return undefined;
    if (typeof current.code === 'string') return current.code;
    current = current.cause;
  }
  return undefined;
}
