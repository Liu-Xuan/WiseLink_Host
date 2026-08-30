import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import postgres from 'postgres';

import {
  ACTOR,
  CONTROLLED_SNAPSHOT,
  CURRENT_WORK_ITEM,
  OTHER_ACTOR,
  OTHER_TENANT,
  SOURCE_EXPRESSION,
  STALE_WORK_ITEM,
  TENANT,
  buildWorkItem,
  createControlledFleetHead,
  frozenPackageBytes,
  insertWorkItem,
  resetBatchDatabase,
  session,
  sourceUnits,
} from './helpers/batch-applicability-host-postgres.fixture.mjs';

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'node',
  experimentalDecorators: true,
  emitDecoratorMetadata: true,
});
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const {
  BatchApplicabilityController,
} = require('../../server/modules/batch-applicability/batch-applicability.controller.ts');
const {
  BatchApplicabilityHostService,
} = require('../../server/modules/batch-applicability/batch-applicability-host.service.ts');
const {
  BatchApplicabilityRepository,
} = require('../../server/modules/batch-applicability/batch-applicability.repository.ts');
const {
  BatchApplicabilityService,
} = require('../../server/modules/batch-applicability/batch-applicability.service.ts');
const {
  BatchApplicabilitySourceReader,
} = require('../../server/modules/batch-applicability/batch-applicability-source-reader.ts');
const {
  CanonicalFleetMasterDataRepository,
} = require('../../server/modules/canonical-host/canonical-fleet-master-data.repository.ts');
const {
  readFrozenApplicabilitySourceBinding,
} = require('../../server/modules/canonical-host/canonical-host-applicability-source.ts');
const {
  SessionResolver,
} = require('../../server/modules/identity/session-resolver.service.ts');
const {
  MiaodaCanonicalWorkItemRegistrarAdapter,
} = require('../../server/modules/work-item/miaoda-canonical-work-item-registrar.adapter.ts');
const {
  MiaodaHostedCanonicalObjectAccessAdapter,
} = require('../../server/modules/work-item/miaoda-hosted-canonical-object-access.adapter.ts');
const {
  MiaodaWorkItemRepository,
} = require('../../server/modules/work-item/miaoda-work-item.repository.ts');

const databaseUrl = process.env.BATCH_APPLICABILITY_TEST_DATABASE_URL;

test(
  'Phase 2 Host create/read/confirm stays current, tenant-scoped, and candidate-only on real PostgreSQL',
  { skip: !databaseUrl, concurrency: false },
  async () => {
    assertSafeIsolatedDatabase(databaseUrl);
    const sql = postgres(databaseUrl, { max: 6 });
    try {
      await resetBatchDatabase(sql, databaseUrl);
      const baseSnapshotId = await createControlledFleetHead(sql);
      const fixture = buildFixture();
      await insertWorkItem(sql, fixture.current);
      await insertWorkItem(sql, fixture.stale);
      const harness = createHarness(sql, fixture);

      const created = await harness.controller.create(
        CURRENT_WORK_ITEM,
        createRequest('batch-create-1'),
        harness.localRequest,
      );
      assert.equal(created.currentness.status, 'CURRENT');
      assert.deepEqual(created.counts, {
        total: 4,
        true: 1,
        false: 1,
        unknown: 2,
        evaluated: 2,
        waitingInput: 1,
        conflict: 1,
        stale: 0,
        clustered: 2,
        excludedFromClustering: 2,
      });
      assert.deepEqual(
        created.matrix.map(({ aircraftIdentifier, truth, status }) => ({
          aircraftIdentifier,
          truth,
          status,
        })),
        [
          { aircraftIdentifier: 'B-1397', truth: 'TRUE', status: 'EVALUATED' },
          {
            aircraftIdentifier: 'B-5043',
            truth: 'FALSE',
            status: 'EVALUATED',
          },
          {
            aircraftIdentifier: 'B-1397',
            truth: 'UNKNOWN',
            status: 'WAITING_INPUT',
          },
          {
            aircraftIdentifier: 'B-1398',
            truth: 'UNKNOWN',
            status: 'CONFLICT',
          },
        ],
      );
      assertBrowserSafe(created);
      assert.deepEqual(
        await harness.controller.read(
          CURRENT_WORK_ITEM,
          created.runId,
          harness.localRequest,
        ),
        created,
      );
      const replay = await harness.controller.create(
        CURRENT_WORK_ITEM,
        createRequest('batch-create-1'),
        harness.localRequest,
      );
      assert.equal(replay.runId, created.runId);
      await assert.rejects(
        harness.controller.create(
          CURRENT_WORK_ITEM,
          {
            ...createRequest('batch-create-1'),
            targets: [{ aircraftIdentifier: 'B-1397', asOf: '2026-08-30' }],
          },
          harness.localRequest,
        ),
        errorCode('BATCH_REQUEST_ID_REUSED_WITH_DIFFERENT_PAYLOAD'),
      );

      const unknown = created.matrix.find((row) => row.truth === 'UNKNOWN');
      await assert.rejects(
        harness.controller.confirm(
          CURRENT_WORK_ITEM,
          created.runId,
          confirmationRequest('confirm-unknown', unknown.matrixItemId),
          harness.localRequest,
        ),
        errorCode('BATCH_CLUSTER_NOT_CONFIRMABLE'),
      );
      await assertDatabaseConfirmationBoundary(sql, created.runId);
      const trueCluster = created.candidateClusters.find(
        (cluster) => cluster.truth === 'TRUE',
      );
      const confirmed = await harness.controller.confirm(
        CURRENT_WORK_ITEM,
        created.runId,
        confirmationRequest('confirm-true-1', trueCluster.candidateClusterId),
        harness.localRequest,
      );
      assert.equal(confirmed.confirmations.length, 1);
      assert.equal(confirmed.confirmations[0].authority.receiptPersisted, true);
      assert.equal(
        confirmed.confirmations[0].authority.engineeringApprovalChanged,
        false,
      );
      assert.equal(
        (
          await harness.controller.confirm(
            CURRENT_WORK_ITEM,
            created.runId,
            confirmationRequest(
              'confirm-true-1',
              trueCluster.candidateClusterId,
            ),
            harness.localRequest,
          )
        ).confirmations.length,
        1,
      );

      await assertAccessDenials(harness, created.runId);
      await assertMixedHeadRejected(sql, harness, fixture, baseSnapshotId);

      const stale = await harness.controller.create(
        STALE_WORK_ITEM,
        {
          requestId: 'batch-create-stale',
          sourceExpressionId: SOURCE_EXPRESSION,
          targets: [{ aircraftIdentifier: 'B-1397', asOf: '2026-08-30' }],
        },
        harness.localRequest,
      );
      assert.equal(stale.currentness.status, 'STALE');
      assert.equal(stale.matrix[0].truth, 'TRUE');
      assert.equal(stale.matrix[0].status, 'STALE');
      assert.equal(stale.matrix[0].candidateClusterId, null);
      assert.deepEqual(stale.candidateClusters, []);
      await assert.rejects(
        harness.controller.confirm(
          STALE_WORK_ITEM,
          stale.runId,
          confirmationRequest('confirm-stale', 'CLUSTER-NOT-PRESENT'),
          harness.localRequest,
        ),
        errorCode('BATCH_CONFIRMATION_HOST_CURRENTNESS_STALE'),
      );

      await assertRlsIsolation(sql);
      const [nonclaims] = await sql`
        SELECT
          (SELECT count(*)::int FROM canonical_fleet_configuration_fact_version
            WHERE tenant_id = ${TENANT}
              AND source_snapshot_id = ${CONTROLLED_SNAPSHOT}
              AND source_record_id LIKE 'test-controlled:%') AS controlled_facts,
          (SELECT count(*)::int FROM action_attempt) AS action_attempts,
          (SELECT revision FROM work_item
            WHERE work_item_id = ${CURRENT_WORK_ITEM}) AS work_item_revision
      `;
      assert.deepEqual(nonclaims, {
        controlled_facts: 4,
        action_attempts: 0,
        work_item_revision: 7,
      });
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
);

function buildFixture() {
  const draft = buildWorkItem({
    workItemId: CURRENT_WORK_ITEM,
    stale: false,
    targetBindingHash: 'pending',
  });
  const binding = readFrozenApplicabilitySourceBinding({
    bytes: frozenPackageBytes(),
    workItem: draft,
    sourceUnits: sourceUnits(),
  });
  return {
    current: buildWorkItem({
      workItemId: CURRENT_WORK_ITEM,
      stale: false,
      targetBindingHash: binding.targetBindingHash,
    }),
    stale: buildWorkItem({
      workItemId: STALE_WORK_ITEM,
      stale: true,
      targetBindingHash: binding.targetBindingHash,
    }),
    bytes: frozenPackageBytes(),
  };
}

function createHarness(sql, fixture, fleetOverride = null) {
  const db = drizzle(sql);
  const workItems = new MiaodaWorkItemRepository(db);
  const registrar = new MiaodaCanonicalWorkItemRegistrarAdapter(workItems);
  const sessions = new Map();
  const local = session('session-local');
  const other = session('session-other', OTHER_ACTOR, OTHER_TENANT);
  sessions.set('session-local', local.expectedIdentity);
  sessions.set('session-other', other.expectedIdentity);
  const resolver = new SessionResolver(
    {
      validate: async (token) => {
        const identity = sessions.get(token);
        return identity
          ? {
              sessionId: `session-id:${token}`,
              revision: 1,
              expiresAt: new Date('2026-09-30T00:00:00.000Z'),
              identity,
            }
          : null;
      },
    },
    {
      applicationScopeId: 'app_17bzc551rsg',
      sessionEnvironment: 'preview',
    },
  );
  const sourceReader = new BatchApplicabilitySourceReader(
    { readActualBytes: async () => fixture.bytes },
    { readAllSourceUnits: async () => sourceUnits() },
  );
  const fleet = fleetOverride ?? new CanonicalFleetMasterDataRepository(db);
  const service = new BatchApplicabilityHostService(
    resolver,
    new MiaodaHostedCanonicalObjectAccessAdapter(workItems),
    registrar,
    { nowIso: () => '2026-08-30T10:00:00.000Z' },
    fleet,
    sourceReader,
    new BatchApplicabilityService(),
    new BatchApplicabilityRepository(db),
  );
  return {
    controller: new BatchApplicabilityController(service),
    localRequest: local,
    otherRequest: other,
  };
}

function createRequest(requestId) {
  return {
    requestId,
    sourceExpressionId: SOURCE_EXPRESSION,
    targets: [
      { aircraftIdentifier: 'B-1397', asOf: '2026-08-30' },
      { aircraftIdentifier: 'B-5043', asOf: '2026-08-30' },
      { aircraftIdentifier: 'B-1397', asOf: '2026-06-05' },
      { aircraftIdentifier: 'B-1398', asOf: '2026-08-30' },
    ],
  };
}

function confirmationRequest(requestId, candidateClusterId) {
  return {
    requestId,
    expectedWorkItemRevision: 7,
    candidateClusterId,
    decision: 'CONFIRM_CLUSTER_CANDIDATE',
    reason: 'Test engineer reviewed this candidate trace and source binding.',
    validUntil: '2026-09-30T10:00:00.000Z',
  };
}

async function assertAccessDenials(harness, runId) {
  await assert.rejects(
    harness.controller.read(CURRENT_WORK_ITEM, runId, harness.otherRequest),
    (error) => error?.statusCode === 404,
  );
  await assert.rejects(
    harness.controller.read(STALE_WORK_ITEM, runId, harness.localRequest),
    errorCode('BATCH_APPLICABILITY_RUN_NOT_FOUND', 404),
  );
  await assert.rejects(
    harness.controller.read(CURRENT_WORK_ITEM, runId, { headers: {} }),
    errorCode('SESSION_REQUIRED', 401),
  );
}

async function assertDatabaseConfirmationBoundary(sql, targetRunId) {
  const [stored] = await sql`
    SELECT candidate_set_json AS "candidateSetJson"
    FROM batch_applicability_run
    WHERE run_id = ${targetRunId}
  `;
  assert.ok(stored);
  const base = JSON.parse(stored.candidateSetJson);
  const evaluatedCluster = base.candidateClusters.find(
    (cluster) => cluster.truth === 'TRUE',
  );
  assert.ok(evaluatedCluster);
  const evaluatedMember = base.matrix.find(
    (row) => row.matrixItemId === evaluatedCluster.memberMatrixItemIds[0],
  );
  assert.ok(evaluatedMember);

  const otherRunSet = structuredClone(base);
  otherRunSet.candidateSetId = 'CANDIDATE-SET-DB-OTHER-RUN';
  otherRunSet.candidateClusters = [
    {
      ...structuredClone(evaluatedCluster),
      candidateClusterId: 'CLUSTER-DB-OTHER-RUN-TRUE',
      memberMatrixItemIds: ['MATRIX-DB-OTHER-RUN-TRUE'],
    },
  ];
  otherRunSet.matrix = [
    {
      ...structuredClone(evaluatedMember),
      matrixItemId: 'MATRIX-DB-OTHER-RUN-TRUE',
      candidateClusterId: 'CLUSTER-DB-OTHER-RUN-TRUE',
    },
  ];
  await insertDirectRun(
    sql,
    targetRunId,
    'RUN-DB-OTHER-RUN',
    'db-boundary-run-other',
    otherRunSet,
  );
  await assertDirectConfirmationRejected(sql, {
    targetRunId,
    requestId: 'db-boundary-confirm-other-run',
    receiptId: 'RECEIPT-DB-OTHER-RUN',
    candidateSet: otherRunSet,
    cluster: otherRunSet.candidateClusters[0],
  });

  const unknownSet = structuredClone(base);
  unknownSet.candidateSetId = 'CANDIDATE-SET-DB-UNKNOWN';
  unknownSet.candidateClusters = [
    {
      ...structuredClone(evaluatedCluster),
      candidateClusterId: 'CLUSTER-DB-UNKNOWN',
      truth: 'UNKNOWN',
      status: 'EVALUATED',
      memberMatrixItemIds: ['MATRIX-DB-UNKNOWN'],
    },
  ];
  unknownSet.matrix = [
    {
      ...structuredClone(evaluatedMember),
      matrixItemId: 'MATRIX-DB-UNKNOWN',
      truth: 'UNKNOWN',
      status: 'WAITING_INPUT',
      clusterEligibility: 'EXCLUDED_UNKNOWN',
      candidateClusterId: 'CLUSTER-DB-UNKNOWN',
    },
  ];
  await insertDirectRun(
    sql,
    targetRunId,
    'RUN-DB-UNKNOWN',
    'db-boundary-run-unknown',
    unknownSet,
  );
  await assertDirectConfirmationRejected(sql, {
    targetRunId: 'RUN-DB-UNKNOWN',
    requestId: 'db-boundary-confirm-unknown',
    receiptId: 'RECEIPT-DB-UNKNOWN',
    candidateSet: unknownSet,
    cluster: unknownSet.candidateClusters[0],
  });

  const conflictSet = structuredClone(base);
  conflictSet.candidateSetId = 'CANDIDATE-SET-DB-CONFLICT';
  conflictSet.candidateClusters = [
    {
      ...structuredClone(evaluatedCluster),
      candidateClusterId: 'CLUSTER-DB-CONFLICT',
      truth: 'TRUE',
      status: 'CONFLICT',
      memberMatrixItemIds: ['MATRIX-DB-CONFLICT'],
    },
  ];
  conflictSet.matrix = [
    {
      ...structuredClone(evaluatedMember),
      matrixItemId: 'MATRIX-DB-CONFLICT',
      truth: 'UNKNOWN',
      status: 'CONFLICT',
      clusterEligibility: 'EXCLUDED_CONFLICT',
      candidateClusterId: 'CLUSTER-DB-CONFLICT',
    },
  ];
  await insertDirectRun(
    sql,
    targetRunId,
    'RUN-DB-CONFLICT',
    'db-boundary-run-conflict',
    conflictSet,
  );
  await assertDirectConfirmationRejected(sql, {
    targetRunId: 'RUN-DB-CONFLICT',
    requestId: 'db-boundary-confirm-conflict',
    receiptId: 'RECEIPT-DB-CONFLICT',
    candidateSet: conflictSet,
    cluster: conflictSet.candidateClusters[0],
  });

  const [rejected] = await sql`
    SELECT count(*)::int AS value
    FROM batch_applicability_confirmation
    WHERE request_id LIKE 'db-boundary-confirm-%'
  `;
  assert.equal(rejected.value, 0);
}

async function insertDirectRun(
  sql,
  sourceRunId,
  runId,
  requestId,
  candidateSet,
) {
  await sql`
    INSERT INTO batch_applicability_run (
      run_id, tenant_id, actor_id, work_item_id, request_id,
      request_payload_json, work_item_revision, document_version_id,
      source_package_id, source_expression_id, source_condition_id,
      source_ref_ids_json, fleet_source_snapshot_id,
      fleet_source_revision_key, fleet_authority_revision,
      fleet_source_as_of, host_binding_status, candidate_set_json
    )
    SELECT ${runId}, tenant_id, actor_id, work_item_id, ${requestId},
      request_payload_json, work_item_revision, document_version_id,
      source_package_id, source_expression_id, source_condition_id,
      source_ref_ids_json, fleet_source_snapshot_id,
      fleet_source_revision_key, fleet_authority_revision,
      fleet_source_as_of, host_binding_status, ${JSON.stringify(candidateSet)}
    FROM batch_applicability_run
    WHERE run_id = ${sourceRunId}
  `;
}

async function assertDirectConfirmationRejected(sql, input) {
  const candidate = {
    status: 'HUMAN_CLUSTER_REVIEW_CANDIDATE_READY',
    candidateSetId: input.candidateSet.candidateSetId,
    candidateClusterId: input.cluster.candidateClusterId,
    decision: 'CONFIRM_CLUSTER_CANDIDATE',
    reviewedCluster: {
      truth: input.cluster.truth,
      memberMatrixItemIds: input.cluster.memberMatrixItemIds,
      aircraftIdentifiers: input.cluster.aircraftIdentifiers,
      asOfValues: input.cluster.asOfValues,
    },
    audit: {
      workItemId: CURRENT_WORK_ITEM,
      workItemRevision: 7,
      documentVersionId: 'DOCUMENT-VERSION-BATCH-HOST',
      confirmedByActorId: ACTOR,
      reason: 'Direct SQL boundary negative case.',
      confirmedAt: '2026-08-30T10:00:00.000Z',
      validUntil: '2026-09-30T10:00:00.000Z',
      sourceRefIds: ['SRC-BATCH-737-PN'],
    },
  };
  await assert.rejects(
    sql`
      INSERT INTO batch_applicability_confirmation (
        receipt_id, run_id, tenant_id, actor_id, work_item_id, request_id,
        request_payload_json, work_item_revision, candidate_cluster_id,
        decision, reason, confirmed_at, valid_until,
        confirmation_candidate_json
      ) VALUES (
        ${input.receiptId}, ${input.targetRunId}, ${TENANT}, ${ACTOR},
        ${CURRENT_WORK_ITEM}, ${input.requestId}, '{}', 7,
        ${input.cluster.candidateClusterId}, 'CONFIRM_CLUSTER_CANDIDATE',
        'Direct SQL boundary negative case.',
        '2026-08-30T10:00:00.000Z'::timestamptz,
        '2026-09-30T10:00:00.000Z'::timestamptz,
        ${JSON.stringify(candidate)}
      )
    `,
    (error) =>
      error?.code === 'P0001' &&
      error?.message.includes(
        'BATCH_APPLICABILITY_CONFIRMATION_CLUSTER_NOT_CONFIRMABLE',
      ),
  );
}

async function assertMixedHeadRejected(sql, harness, fixture, baseSnapshotId) {
  const db = drizzle(sql);
  const realFleet = new CanonicalFleetMasterDataRepository(db);
  let reads = 0;
  const flippingFleet = {
    readCurrentHead: (input) => realFleet.readCurrentHead(input),
    readCurrentForAircraft: async (input) => {
      const result = await realFleet.readCurrentForAircraft(input);
      reads += 1;
      if (reads === 1) {
        await sql`
          UPDATE canonical_fleet_scope_head
          SET current_source_snapshot_id = ${baseSnapshotId},
            authority_revision = 3, updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ${TENANT}
        `;
      }
      return result;
    },
  };
  const mixedHarness = createHarness(sql, fixture, flippingFleet);
  try {
    await assert.rejects(
      mixedHarness.controller.create(
        CURRENT_WORK_ITEM,
        {
          requestId: 'batch-create-mixed-head',
          sourceExpressionId: SOURCE_EXPRESSION,
          targets: [
            { aircraftIdentifier: 'B-1397', asOf: '2026-08-30' },
            { aircraftIdentifier: 'B-1392', asOf: '2026-08-30' },
          ],
        },
        harness.localRequest,
      ),
      errorCode('BATCH_FLEET_SOURCE_MIXED'),
    );
    const [count] = await sql`
      SELECT count(*)::int AS value FROM batch_applicability_run
      WHERE request_id = 'batch-create-mixed-head'
    `;
    assert.equal(count.value, 0);
  } finally {
    await sql`
      UPDATE canonical_fleet_scope_head
      SET current_source_snapshot_id = ${CONTROLLED_SNAPSHOT},
        authority_revision = 2, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${TENANT}
    `;
  }
}

async function assertRlsIsolation(sql) {
  const connection = await sql.reserve();
  try {
    await connection.unsafe('BEGIN');
    await connection.unsafe('SET LOCAL ROLE authenticated');
    await connection`SELECT set_config('app.user_id', ${OTHER_ACTOR}, true)`;
    const rows = await connection`SELECT run_id FROM batch_applicability_run`;
    assert.equal(rows.length, 0);
    await connection.unsafe('ROLLBACK');
  } finally {
    connection.release();
  }
}

function assertBrowserSafe(value) {
  const text = JSON.stringify(value);
  for (const forbidden of [
    TENANT,
    ACTOR,
    'sourceSnapshotId',
    'assetId',
    'assetVersionId',
    'sourceRecordId',
    'recordHash',
    'engineeringApproval":true',
  ]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
  assert.equal(value.authority.outputAuthority, 'CANDIDATE_ONLY');
  assert.equal(value.authority.modelCanSetFinalApplicability, false);
  assert.equal(value.authority.humanConfirmationIsEngineeringApproval, false);
  assert.equal(value.authority.publicationPerformed, false);
}

function assertSafeIsolatedDatabase(value) {
  const parsed = new URL(value);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname));
  assert.equal(parsed.pathname, '/wiselink_batch_applicability_test');
}

function errorCode(code, statusCode = 409) {
  return (error) => error?.code === code && error?.statusCode === statusCode;
}
