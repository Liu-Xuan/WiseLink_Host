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

const databaseUrl = process.env.REVIEW_PERSISTENCE_TEST_DATABASE_URL;

test(
  'R09 C1 PostgreSQL create, concurrent replay, readback, ACL and close',
  { skip: !databaseUrl },
  async () => {
    assertSafeIsolatedDatabase(databaseUrl);
    const sql = postgres(databaseUrl, { max: 8 });
    try {
      await resetDatabase(sql);
      await seedWorkItems(sql);
      await assertPolicyReadback(sql);
      await assertDirectConversationDenials(sql);
      await seedSameActorCrossTenantConversation(sql);
      await assertSameActorCrossTenantIsolation(sql);
      await asActor(sql, 'actor-A', async (actorSql) => {
        await insertConversation(actorSql, {
          reviewConversationId: 'RC-A',
          tenantId: 'tenant-A',
          actorId: 'actor-A',
          workItemId: 'WI-A',
        });
      });
      await assertForgedParentDenied(sql);
      await assertConcurrentReplay(sql);
      await assertRepositoryRoundTrip(sql);
      await assertAppendOnlyAndCrossActorRead(sql);
      await assertCloseRejectsAppend(sql);
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
);

function assertSafeIsolatedDatabase(value) {
  const parsed = new URL(value);
  assert.ok(
    ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname),
    'PostgreSQL integration test must use localhost',
  );
  assert.equal(
    parsed.pathname,
    '/wiselink_review_c1_test',
    'PostgreSQL integration test requires the exact isolated database name',
  );
}

async function resetDatabase(sql) {
  const migration = await readFile(
    resolve(
      process.cwd(),
      'migrations/0009_review_conversation_persistence_c1.sql',
    ),
    'utf8',
  );
  await sql.unsafe('DROP SCHEMA public CASCADE');
  await sql.unsafe('CREATE SCHEMA public');
  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
      THEN
        CREATE ROLE authenticated NOLOGIN;
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
  const migrationSql = await sql.reserve();
  try {
    await migrationSql.unsafe(migration);
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

async function assertPolicyReadback(sql) {
  const policies = await sql`
    SELECT
      tablename,
      policyname,
      roles::text AS roles,
      cmd,
      qual,
      with_check AS "withCheck"
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'review_conversation',
        'review_turn',
        'engineer_supplied_input'
      )
    ORDER BY tablename, policyname
  `;
  assert.equal(policies.length, 7);
  for (const policy of policies) {
    assert.equal(policy.roles.includes('authenticated'), true);
    assert.equal(policy.roles.includes('service_role'), false);
    assert.notEqual(policy.cmd, 'ALL');
    assert.notEqual(normalizedPolicyExpression(policy.qual), 'true');
    assert.notEqual(normalizedPolicyExpression(policy.withCheck), 'true');
  }
  assert.deepEqual(
    policies
      .filter((policy) => policy.tablename === 'review_turn')
      .map((policy) => policy.cmd)
      .sort(),
    ['INSERT', 'SELECT'],
  );
  assert.deepEqual(
    policies
      .filter((policy) => policy.tablename === 'engineer_supplied_input')
      .map((policy) => policy.cmd)
      .sort(),
    ['INSERT', 'SELECT'],
  );
}

function normalizedPolicyExpression(expression) {
  return (expression ?? '').replace(/[()]/g, '').trim().toLowerCase();
}

async function seedWorkItems(sql) {
  await sql`
    INSERT INTO identity_subject_mapping (
      miaoda_user_id,
      miaoda_tenant_id,
      expected_client_id,
      status
    ) VALUES
      ('actor-A', 'tenant-A', 'cli_aadde8b579f95bc9', 'ACTIVE'),
      ('actor-B', 'tenant-B', 'cli_aadde8b579f95bc9', 'ACTIVE')
  `;
  await sql`
    INSERT INTO work_item (
      work_item_id,
      tenant_id,
      requested_by_user_id,
      revision
    ) VALUES
      ('WI-A', 'tenant-A', 'actor-A', 7),
      ('WI-REPOSITORY', 'tenant-A', 'actor-A', 9),
      ('WI-SAME-ACTOR-TENANT-B', 'tenant-B', 'actor-A', 5),
      ('WI-B', 'tenant-B', 'actor-B', 3)
  `;
}

async function assertDirectConversationDenials(sql) {
  await assert.rejects(
    asActor(sql, 'actor-A', (actorSql) =>
      insertConversation(actorSql, {
        reviewConversationId: 'RC-CROSS-TENANT',
        tenantId: 'tenant-B',
        actorId: 'actor-A',
        workItemId: 'WI-A',
      }),
    ),
    (error) => databaseCode(error) === '42501',
  );
  await assert.rejects(
    asActor(sql, 'actor-A', (actorSql) =>
      insertConversation(actorSql, {
        reviewConversationId: 'RC-WRONG-WORKITEM',
        tenantId: 'tenant-B',
        actorId: 'actor-A',
        workItemId: 'WI-B',
      }),
    ),
    (error) => databaseCode(error) === '42501',
  );
  await assert.rejects(
    asActor(sql, 'actor-A', (actorSql) =>
      insertConversation(actorSql, {
        reviewConversationId: 'RC-FORGED-ACTOR',
        tenantId: 'tenant-B',
        actorId: 'actor-B',
        workItemId: 'WI-B',
      }),
    ),
    (error) => databaseCode(error) === '42501',
  );
  await assert.rejects(
    asActor(sql, 'actor-A', (actorSql) =>
      insertConversation(actorSql, {
        reviewConversationId: 'RC-SAME-ACTOR-TENANT-B-DIRECT',
        tenantId: 'tenant-B',
        actorId: 'actor-A',
        workItemId: 'WI-SAME-ACTOR-TENANT-B',
      }),
    ),
    (error) => databaseCode(error) === '42501',
  );
}

async function seedSameActorCrossTenantConversation(sql) {
  await insertConversation(sql, {
    reviewConversationId: 'RC-SAME-ACTOR-TENANT-B',
    tenantId: 'tenant-B',
    actorId: 'actor-A',
    workItemId: 'WI-SAME-ACTOR-TENANT-B',
    revision: 5,
  });
  await insertTurn(sql, {
    reviewTurnId: 'RT-SAME-ACTOR-TENANT-B-SEED',
    engineerSuppliedInputId: 'ESI-SAME-ACTOR-TENANT-B-SEED',
    reviewConversationId: 'RC-SAME-ACTOR-TENANT-B',
    requestId: 'REQ-SAME-ACTOR-TENANT-B-SEED',
    tenantId: 'tenant-B',
    actorId: 'actor-A',
    workItemId: 'WI-SAME-ACTOR-TENANT-B',
    inputRevision: 5,
  });
}

async function assertSameActorCrossTenantIsolation(sql) {
  await asActor(sql, 'actor-A', async (actorSql) => {
    const conversations = await actorSql`
      SELECT review_conversation_id
      FROM review_conversation
      WHERE review_conversation_id = 'RC-SAME-ACTOR-TENANT-B'
    `;
    const turns = await actorSql`
      SELECT review_turn_id
      FROM review_turn
      WHERE review_conversation_id = 'RC-SAME-ACTOR-TENANT-B'
    `;
    const inputs = await actorSql`
      SELECT engineer_supplied_input_id
      FROM engineer_supplied_input
      WHERE review_conversation_id = 'RC-SAME-ACTOR-TENANT-B'
    `;
    const closed = await actorSql`
      UPDATE review_conversation
      SET status = 'CLOSED', closed_at = CURRENT_TIMESTAMP
      WHERE review_conversation_id = 'RC-SAME-ACTOR-TENANT-B'
      RETURNING review_conversation_id
    `;
    assert.equal(conversations.length, 0);
    assert.equal(turns.length, 0);
    assert.equal(inputs.length, 0);
    assert.equal(closed.length, 0);
  });
  await assert.rejects(
    asActor(sql, 'actor-A', (actorSql) =>
      insertTurn(actorSql, {
        reviewTurnId: 'RT-SAME-ACTOR-TENANT-B',
        engineerSuppliedInputId: 'ESI-SAME-ACTOR-TENANT-B',
        reviewConversationId: 'RC-SAME-ACTOR-TENANT-B',
        requestId: 'REQ-SAME-ACTOR-TENANT-B',
        tenantId: 'tenant-B',
        actorId: 'actor-A',
        workItemId: 'WI-SAME-ACTOR-TENANT-B',
        inputRevision: 5,
      }),
    ),
    (error) => ['42501', 'P0001'].includes(databaseCode(error)),
  );
}

async function assertForgedParentDenied(sql) {
  await assert.rejects(
    asActor(sql, 'actor-A', (actorSql) =>
      insertTurn(actorSql, {
        reviewTurnId: 'RT-FORGED-PARENT',
        engineerSuppliedInputId: 'ESI-FORGED-PARENT',
        reviewConversationId: 'RC-MISSING',
        requestId: 'REQ-FORGED-PARENT',
      }),
    ),
    (error) => databaseCode(error) === 'P0001',
  );
}

async function assertConcurrentReplay(sql) {
  const first = asActor(sql, 'actor-A', (actorSql) =>
    insertTurn(actorSql, {
      reviewTurnId: 'RT-REPLAY-1',
      engineerSuppliedInputId: 'ESI-REPLAY-1',
      reviewConversationId: 'RC-A',
      requestId: 'REQ-REPLAY',
    }),
  );
  const second = asActor(sql, 'actor-A', (actorSql) =>
    insertTurn(actorSql, {
      reviewTurnId: 'RT-REPLAY-2',
      engineerSuppliedInputId: 'ESI-REPLAY-2',
      reviewConversationId: 'RC-A',
      requestId: 'REQ-REPLAY',
    }),
  );
  const outcomes = await Promise.allSettled([first, second]);
  assert.equal(
    outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
    1,
  );
  const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
  assert.equal(databaseCode(rejected?.reason), '23505');

  const [readback] = await sql`
    SELECT
      conversation.last_turn_no AS "lastTurnNo",
      conversation.last_synced_revision AS "lastSyncedRevision",
      (SELECT count(*)::int FROM review_turn turn_row
        WHERE turn_row.review_conversation_id = 'RC-A') AS "turnCount",
      (SELECT count(*)::int FROM engineer_supplied_input input_row
        WHERE input_row.review_conversation_id = 'RC-A') AS "inputCount",
      (SELECT min(turn_no)::int FROM review_turn turn_row
        WHERE turn_row.review_conversation_id = 'RC-A') AS "firstTurnNo"
    FROM review_conversation conversation
    WHERE conversation.review_conversation_id = 'RC-A'
  `;
  assert.deepEqual(readback, {
    lastTurnNo: 1,
    lastSyncedRevision: 7,
    turnCount: 1,
    inputCount: 1,
    firstTurnNo: 1,
  });
  await asActor(sql, 'actor-A', async (actorSql) => {
    const [actorReadback] = await actorSql`
      SELECT
        conversation.review_conversation_id AS "reviewConversationId",
        turn_row.turn_no AS "turnNo",
        turn_row.request_id AS "requestId",
        input_row.input_type AS "inputType",
        input_row.adoption_status AS "adoptionStatus",
        input_row.candidate_text AS "candidateText"
      FROM review_conversation conversation
      JOIN review_turn turn_row
        ON turn_row.review_conversation_id =
          conversation.review_conversation_id
      JOIN engineer_supplied_input input_row
        ON input_row.review_turn_id = turn_row.review_turn_id
      WHERE conversation.review_conversation_id = 'RC-A'
    `;
    assert.deepEqual(actorReadback, {
      reviewConversationId: 'RC-A',
      turnNo: 1,
      requestId: 'REQ-REPLAY',
      inputType: 'ENGINEER_TEXT',
      adoptionStatus: 'CANDIDATE_UNADOPTED',
      candidateText: 'Engineer supplied context',
    });
  });
}

async function assertRepositoryRoundTrip(sql) {
  const first = await reserveActorRepository(sql, 'actor-A');
  const second = await reserveActorRepository(sql, 'actor-A');
  try {
    for (const actorConnection of [first.connection, second.connection]) {
      const [context] = await actorConnection`
        SELECT
          current_user AS "currentUser",
          session_user AS "sessionUser",
          current_setting('app.user_id', true) AS "appUserId"
      `;
      assert.deepEqual(context, {
        currentUser: 'authenticated',
        sessionUser: 'postgres',
        appUserId: 'actor-A',
      });
    }

    const created = await first.repository.createOrResume({
      tenantId: 'tenant-A',
      actorId: 'actor-A',
      workItemId: 'WI-REPOSITORY',
      currentRevision: 9,
    });
    assert.equal(created.created, true);
    const resumed = await first.repository.createOrResume({
      tenantId: 'tenant-A',
      actorId: 'actor-A',
      workItemId: 'WI-REPOSITORY',
      currentRevision: 9,
    });
    assert.equal(resumed.created, false);
    assert.equal(
      resumed.aggregate.conversation.reviewConversationId,
      created.aggregate.conversation.reviewConversationId,
    );

    const conversation = resumed.aggregate.conversation;
    const turns = await Promise.all([
      first.repository.appendTextTurn({
        conversation,
        requestId: 'REQ-REPOSITORY-REPLAY',
        userMessage: 'Repository persisted engineer text',
        currentRevision: 9,
      }),
      second.repository.appendTextTurn({
        conversation,
        requestId: 'REQ-REPOSITORY-REPLAY',
        userMessage: 'Repository persisted engineer text',
        currentRevision: 9,
      }),
    ]);
    assert.deepEqual(turns.map((result) => result.replayed).sort(), [
      false,
      true,
    ]);

    const reloaded = await first.repository.loadById(
      conversation.reviewConversationId,
    );
    assert.ok(reloaded);
    assert.equal(reloaded.conversation.lastSyncedRevision, 9);
    assert.equal(reloaded.turns.length, 1);
    assert.deepEqual(
      {
        turnNo: reloaded.turns[0].turnNo,
        requestId: reloaded.turns[0].requestId,
        inputType: reloaded.turns[0].inputType,
        adoptionStatus: reloaded.turns[0].adoptionStatus,
        candidateText: reloaded.turns[0].candidateText,
      },
      {
        turnNo: 1,
        requestId: 'REQ-REPOSITORY-REPLAY',
        inputType: 'ENGINEER_TEXT',
        adoptionStatus: 'CANDIDATE_UNADOPTED',
        candidateText: 'Repository persisted engineer text',
      },
    );
    const [counter] = await sql`
      SELECT
        conversation.last_turn_no AS "lastTurnNo",
        (SELECT count(*)::int FROM review_turn turn_row
          WHERE turn_row.review_conversation_id =
            ${conversation.reviewConversationId}) AS "turnCount",
        (SELECT count(*)::int FROM engineer_supplied_input input_row
          WHERE input_row.review_conversation_id =
            ${conversation.reviewConversationId}) AS "inputCount"
      FROM review_conversation conversation
      WHERE conversation.review_conversation_id =
        ${conversation.reviewConversationId}
    `;
    assert.deepEqual(counter, {
      lastTurnNo: 1,
      turnCount: 1,
      inputCount: 1,
    });

    const closed = await first.repository.close({
      conversation: reloaded.conversation,
      currentRevision: 9,
    });
    assert.equal(closed.aggregate.conversation.status, 'CLOSED');
    await assert.rejects(
      first.repository.appendTextTurn({
        conversation: closed.aggregate.conversation,
        requestId: 'REQ-REPOSITORY-AFTER-CLOSE',
        userMessage: 'must not persist',
        currentRevision: 9,
      }),
      (error) => error.code === 'REVIEW_CONVERSATION_CLOSED',
    );
  } finally {
    await Promise.all([first.release(), second.release()]);
  }
}

async function reserveActorRepository(sql, actorId) {
  const connection = await sql.reserve();
  try {
    await connection.unsafe('SET ROLE authenticated');
    await connection`SELECT set_config('app.user_id', ${actorId}, false)`;
    connection.options = sql.options;
    return {
      connection,
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

async function assertAppendOnlyAndCrossActorRead(sql) {
  await assert.rejects(
    asActor(
      sql,
      'actor-A',
      (actorSql) => actorSql`
      UPDATE review_conversation
      SET last_turn_no = 99
      WHERE review_conversation_id = 'RC-A'
    `,
    ),
    (error) => databaseCode(error) === 'P0001',
  );
  await asActor(sql, 'actor-A', async (actorSql) => {
    const updatedTurns = await actorSql`
      UPDATE review_turn
      SET user_message = 'tampered'
      WHERE review_conversation_id = 'RC-A'
      RETURNING review_turn_id
    `;
    const deletedTurns = await actorSql`
      DELETE FROM review_turn
      WHERE review_conversation_id = 'RC-A'
      RETURNING review_turn_id
    `;
    const updatedInputs = await actorSql`
      UPDATE engineer_supplied_input
      SET candidate_text = 'tampered'
      WHERE review_conversation_id = 'RC-A'
      RETURNING engineer_supplied_input_id
    `;
    const deletedInputs = await actorSql`
      DELETE FROM engineer_supplied_input
      WHERE review_conversation_id = 'RC-A'
      RETURNING engineer_supplied_input_id
    `;
    const deletedConversations = await actorSql`
      DELETE FROM review_conversation
      WHERE review_conversation_id = 'RC-A'
      RETURNING review_conversation_id
    `;
    assert.equal(updatedTurns.length, 0);
    assert.equal(deletedTurns.length, 0);
    assert.equal(updatedInputs.length, 0);
    assert.equal(deletedInputs.length, 0);
    assert.equal(deletedConversations.length, 0);
  });
  await asActor(sql, 'actor-B', async (actorSql) => {
    const conversations = await actorSql`
      SELECT review_conversation_id
      FROM review_conversation
      WHERE review_conversation_id = 'RC-A'
    `;
    const turns = await actorSql`
      SELECT review_turn_id
      FROM review_turn
      WHERE review_conversation_id = 'RC-A'
    `;
    assert.equal(conversations.length, 0);
    assert.equal(turns.length, 0);
  });
  const [readback] = await sql`
    SELECT
      turn_row.user_message AS "userMessage",
      input_row.candidate_text AS "candidateText"
    FROM review_turn turn_row
    JOIN engineer_supplied_input input_row
      ON input_row.engineer_supplied_input_id =
        turn_row.engineer_supplied_input_id
    WHERE turn_row.review_conversation_id = 'RC-A'
  `;
  assert.deepEqual(readback, {
    userMessage: 'Engineer supplied context',
    candidateText: 'Engineer supplied context',
  });
}

async function assertCloseRejectsAppend(sql) {
  await asActor(sql, 'actor-A', async (actorSql) => {
    const closed = await actorSql`
      UPDATE review_conversation
      SET
        status = 'CLOSED',
        closed_at = CURRENT_TIMESTAMP,
        last_active_at = CURRENT_TIMESTAMP
      WHERE review_conversation_id = 'RC-A'
        AND status = 'ACTIVE'
      RETURNING review_conversation_id
    `;
    assert.equal(closed.length, 1);
  });
  await assert.rejects(
    asActor(sql, 'actor-A', (actorSql) =>
      insertTurn(actorSql, {
        reviewTurnId: 'RT-AFTER-CLOSE',
        engineerSuppliedInputId: 'ESI-AFTER-CLOSE',
        reviewConversationId: 'RC-A',
        requestId: 'REQ-AFTER-CLOSE',
      }),
    ),
    (error) => databaseCode(error) === 'P0001',
  );
  const [readback] = await sql`
    SELECT
      conversation.status,
      conversation.last_turn_no AS "lastTurnNo",
      (SELECT count(*)::int FROM review_turn turn_row
        WHERE turn_row.review_conversation_id = 'RC-A') AS "turnCount",
      (SELECT count(*)::int FROM engineer_supplied_input input_row
        WHERE input_row.review_conversation_id = 'RC-A') AS "inputCount"
    FROM review_conversation conversation
    WHERE conversation.review_conversation_id = 'RC-A'
  `;
  assert.deepEqual(readback, {
    status: 'CLOSED',
    lastTurnNo: 1,
    turnCount: 1,
    inputCount: 1,
  });
}

async function insertConversation(sql, input) {
  return sql`
    INSERT INTO review_conversation (
      review_conversation_id,
      tenant_id,
      actor_id,
      work_item_id,
      openclaw_agent_id,
      openclaw_session_key,
      started_at_revision,
      last_synced_revision
    ) VALUES (
      ${input.reviewConversationId},
      ${input.tenantId},
      ${input.actorId},
      ${input.workItemId},
      'wiselink-engineering',
      ${`review:${input.reviewConversationId}`},
      ${input.revision ?? 7},
      ${input.revision ?? 7}
    )
    RETURNING review_conversation_id
  `;
}

async function insertTurn(sql, input) {
  return sql`
    INSERT INTO review_turn (
      review_turn_id,
      review_conversation_id,
      engineer_supplied_input_id,
      tenant_id,
      actor_id,
      work_item_id,
      turn_no,
      request_id,
      input_revision,
      user_message,
      input_type,
      adoption_status
    ) VALUES (
      ${input.reviewTurnId},
      ${input.reviewConversationId},
      ${input.engineerSuppliedInputId},
      ${input.tenantId ?? 'tenant-A'},
      ${input.actorId ?? 'actor-A'},
      ${input.workItemId ?? 'WI-A'},
      0,
      ${input.requestId},
      ${input.inputRevision ?? 7},
      'Engineer supplied context',
      'ENGINEER_TEXT',
      'CANDIDATE_UNADOPTED'
    )
    RETURNING review_turn_id, turn_no
  `;
}

async function asActor(sql, actorId, operation) {
  const actorSql = await sql.reserve();
  try {
    await actorSql.unsafe('SET ROLE authenticated');
    await actorSql`SELECT set_config('app.user_id', ${actorId}, false)`;
    return await operation(actorSql);
  } finally {
    await actorSql.unsafe('RESET ROLE');
    actorSql.release();
  }
}

function databaseCode(error) {
  let current = error;
  for (let depth = 0; depth < 6; depth += 1) {
    if (!current || typeof current !== 'object') return null;
    if (typeof current.code === 'string') return current.code;
    current = current.cause;
  }
  return null;
}
