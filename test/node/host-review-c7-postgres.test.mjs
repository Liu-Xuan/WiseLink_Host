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

const databaseUrl = process.env.REVIEW_C7_TEST_DATABASE_URL;

test(
  'R09 C7 real PostgreSQL restricted-role text + attachment + draft + revision-sync chain',
  { skip: !databaseUrl },
  async () => {
    assertSafeIsolatedDatabase(databaseUrl);
    const sql = postgres(databaseUrl, { max: 6 });
    try {
      await resetDatabase(sql);
      await seed(sql);
      const hostRepository = new ReviewConversationRepository(drizzle(sql));
      const actor = await reserveActorRepository(sql, 'actor-C7');
      try {
        const created = await actor.repository.createOrResume({
          tenantId: 'tenant-C7',
          actorId: 'actor-C7',
          workItemId: 'WI-C7',
          currentRevision: 7,
        });
        assert.equal(created.created, true);
        const conversation = created.aggregate.conversation;
        const text = await actor.repository.appendTextTurn({
          conversation,
          requestId: 'request-text-C7',
          userMessage: 'Engineer supplied current configuration text.',
          currentRevision: 7,
        });
        assert.equal(text.replayed, false);
        assert.deepEqual(text.turn.attachmentBindings, []);

        const attachment = attachmentBinding();
        const attached = await actor.repository.appendTextTurn({
          conversation,
          requestId: 'request-attachment-C7',
          userMessage: 'Use the selected engineering attachment.',
          currentRevision: 7,
          attachmentBindings: [attachment],
        });
        assert.equal(attached.replayed, false);
        assert.deepEqual(attached.turn.attachmentBindings, [attachment]);
        assert.equal(
          attached.turn.userMessage,
          'Use the selected engineering attachment.',
        );

        await insertAttempt(sql);
        const candidate = assistantCandidate();
        const persisted = await hostRepository.persistAssistantCandidate({
          conversation,
          turn: attached.turn,
          actionAttemptId: 'ATT-C7',
          candidate,
          completedAt: new Date('2026-08-27T04:00:00.000Z'),
        });
        assert.equal(persisted.replayed, false);
        assert.deepEqual(
          persisted.turn.assistantCandidate.reviewActionDraft,
          candidate.reviewActionDraft,
        );
        await sql`
          UPDATE action_attempt SET status = 'SUCCEEDED'
          WHERE attempt_id = 'ATT-C7'
        `;

        await sql`
          UPDATE work_item SET revision = 8 WHERE work_item_id = 'WI-C7'
        `;
        const synced = await hostRepository.syncAfterReviewAction({
          conversation,
          expectedRevision: 7,
          currentRevision: 8,
        });
        assert.equal(synced.conversation.lastSyncedRevision, 8);
        assert.equal(synced.turns.length, 2);
        assert.deepEqual(synced.turns[1].attachmentBindings, [attachment]);
        assert.equal(
          synced.turns[1].assistantCandidate.reviewActionDraft.baseRevision,
          7,
        );
        const actorReadback = await actor.repository.loadById(
          conversation.reviewConversationId,
        );
        assert.equal(actorReadback.conversation.lastSyncedRevision, 8);
        assert.deepEqual(actorReadback.turns[1].attachmentBindings, [
          attachment,
        ]);

        const beforeCrossWorkItem = await turnCount(sql);
        await assert.rejects(
          actor.repository.appendTextTurn({
            conversation: { ...conversation, workItemId: 'WI-C7-OTHER' },
            requestId: 'request-cross-work-item-C7',
            userMessage: 'must not persist',
            currentRevision: 8,
          }),
        );
        assert.equal(await turnCount(sql), beforeCrossWorkItem);
      } finally {
        await actor.release();
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
);

function assertSafeIsolatedDatabase(value) {
  const parsed = new URL(value);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname));
  assert.equal(parsed.pathname, '/wiselink_review_c7_test');
}

async function resetDatabase(sql) {
  const [c1, c2] = await Promise.all([
    readFile(
      resolve(
        process.cwd(),
        'migrations/0009_review_conversation_persistence_c1.sql',
      ),
      'utf8',
    ),
    readFile(
      resolve(
        process.cwd(),
        'migrations/0010_interactive_review_host_mcp_c2.sql',
      ),
      'utf8',
    ),
  ]);
  await sql.unsafe('DROP SCHEMA public CASCADE');
  await sql.unsafe('CREATE SCHEMA public');
  await sql.unsafe(`
    DO $$ BEGIN
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
  await sql.unsafe(
    'ALTER TABLE identity_subject_mapping ENABLE ROW LEVEL SECURITY',
  );
  await sql.unsafe(`
    CREATE POLICY identity_subject_mapping_authenticated_read
    ON identity_subject_mapping FOR SELECT TO authenticated
    USING (
      miaoda_user_id = current_setting('app.user_id', true)
      AND status = 'ACTIVE'
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
  await sql.unsafe('GRANT USAGE ON SCHEMA public TO authenticated');
  await sql.unsafe('GRANT SELECT ON identity_subject_mapping TO authenticated');
  await sql.unsafe('GRANT SELECT ON work_item TO authenticated');
  await sql.unsafe(`
    GRANT SELECT, INSERT, UPDATE, DELETE
    ON review_conversation, review_turn, engineer_supplied_input
    TO authenticated
  `);
}

async function seed(sql) {
  await sql`
    INSERT INTO identity_subject_mapping (
      miaoda_user_id, miaoda_tenant_id, expected_client_id, status
    ) VALUES ('actor-C7', 'tenant-C7', 'cli_aadde8b579f95bc9', 'ACTIVE')
  `;
  await sql`
    INSERT INTO work_item (
      work_item_id, tenant_id, requested_by_user_id, revision
    ) VALUES
      ('WI-C7', 'tenant-C7', 'actor-C7', 7),
      ('WI-C7-OTHER', 'tenant-C7', 'actor-C7', 8)
  `;
}

async function insertAttempt(sql) {
  await sql`
    INSERT INTO action_attempt (
      attempt_id, work_item_id, action_type, actor_user_id, tenant_id,
      input_revision, base_revision, status, result_content_hash
    ) VALUES (
      'ATT-C7', 'WI-C7', 'OPENCLAW_INTERACTIVE_REVIEW', 'actor-C7',
      'tenant-C7', 7, 7, 'COMMITTING', ${'f'.repeat(64)}
    )
  `;
}

function attachmentBinding() {
  return {
    attachmentRef: 'ATTACHMENT-C7',
    documentVersionId: 'DV-ATTACHMENT-C7',
    fileName: 'engineering-note.pdf',
    mediaType: 'application/pdf',
    byteLength: 321,
    selectionKey: 'bucket-default\nofficial-selection/engineering-note.pdf',
    parsedArtifact: {
      storeRole: 'UnifiedArtifactStoreCandidate',
      ref: 'miaoda-file-service://bucket/artifact-C7',
      sha256: 'e'.repeat(64),
      byteLength: 200,
      mediaType: 'application/json',
    },
  };
}

function assistantCandidate() {
  return {
    responseType: 'REVIEW_ACTION_DRAFT',
    answer: 'Candidate action based on the current attachment.',
    sourceRefs: ['ATTACHMENT-C7'],
    missingInputs: [],
    candidateEvidenceRefs: ['ATTACHMENT-C7'],
    reviewActionDraft: {
      baseRevision: 7,
      evaluationItemId: 'RULE-1',
      proposedStatus: 'review_required',
      resolvedGapRefs: [],
      adoptedInputRefs: ['ATTACHMENT-C7'],
      sourceRefs: ['ATTACHMENT-C7'],
      assumptions: [],
      affectedItemIds: ['RULE-1'],
      overallImpact: true,
    },
    affectedItemIds: ['RULE-1'],
    warnings: [],
    actionAttemptRef: 'AQ-C7',
    provenance: {
      runtimeAppId: 'app_17c3zn24kv2',
      profileRef: 'wiselink-engineering',
      modelVersion: 'GLM-5.3',
      promptVersion: 'review-prompt.v1',
      skillVersion:
        'wiselink-research-and-synthesize@r09.interactive-review.c2',
      toolVersions: {
        'wiselink-openclaw-engineering-assessment': '1.2.0',
      },
      resultContentHash: 'f'.repeat(64),
    },
  };
}

async function reserveActorRepository(sql, actorId) {
  const connection = await sql.reserve();
  try {
    await connection.unsafe('SET ROLE authenticated');
    await connection`SELECT set_config('app.user_id', ${actorId}, false)`;
    connection.options = sql.options;
    return {
      repository: new ReviewConversationRepository(drizzle(connection)),
      async release() {
        await connection.unsafe('RESET ROLE');
        connection.release();
      },
    };
  } catch (error) {
    await connection.unsafe('RESET ROLE');
    connection.release();
    throw error;
  }
}

async function turnCount(sql) {
  const [row] = await sql`
    SELECT count(*)::int AS count FROM review_turn
    WHERE review_conversation_id = (
      SELECT review_conversation_id FROM review_conversation
      WHERE work_item_id = 'WI-C7'
    )
  `;
  return row.count;
}
