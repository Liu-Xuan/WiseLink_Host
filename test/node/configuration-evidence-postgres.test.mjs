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
  MiaodaConfigurationEvidenceStore,
} = require('../../server/modules/canonical-host/configuration-evidence/configuration-evidence.repository.ts');
const {
  mapInstallationEventEvidence,
} = require('../../server/modules/canonical-host/configuration-evidence/installation-event-evidence.mapper.ts');
const {
  mapConfigurationSnapshot,
} = require('../../server/modules/canonical-host/configuration-evidence/configuration-snapshot.mapper.ts');

const databaseUrl = process.env.CONFIGURATION_EVIDENCE_TEST_DATABASE_URL;
const TENANT_ID = 'tenant-configuration-evidence';
const ACTOR_ID = 'actor-configuration-evidence';
const OTHER_ACTOR_ID = 'actor-configuration-evidence-other';
const WORK_ITEM_ID = 'WI-CONFIGURATION-EVIDENCE-POSTGRES';
const AIRCRAFT = {
  assetId: 'AIRCRAFT:MODEL_MSN:B777_39L_38674',
  aircraftNumber: 'B-2035',
  msn: '38674',
  lineNumber: 1051,
};
const AS_OF = '2026-08-29T23:59:59.999Z';
const EARLY_AS_OF = '2026-08-28T02:30:00.000Z';
const AIMS2_TARGET = {
  kind: 'EQUIPMENT',
  equipmentKey: 'AIMS2',
  positionId: null,
};
const REPAIR_TARGET = {
  kind: 'REPAIR',
  repairId: 'REPAIR:777-31-42',
};

test(
  '0017 PostgreSQL preserves RLS, CAS, bi-temporal as-of, conflict and append-only evidence',
  { skip: !databaseUrl, concurrency: false },
  async () => {
    assertSafeIsolatedDatabase(databaseUrl);
    const sql = postgres(databaseUrl, { max: 4 });
    try {
      await resetDatabase(sql);
      await assertPolicyReadback(sql);
      const firstInput = commitInput({
        requestId: 'REQ-AIMS2-TRUE',
        expectedRevision: 7,
        sourceRevision: 'SOURCE-AIMS2-REV-1',
        target: AIMS2_TARGET,
        records: [equipmentRecord('INSTALL', 1)],
        recordedAt: '2026-08-30T01:00:00.000Z',
      });
      const secondInput = commitInput({
        requestId: 'REQ-REPAIR-HEAD',
        expectedRevision: 8,
        sourceRevision: 'SOURCE-REPAIR-REV-1',
        target: REPAIR_TARGET,
        records: [repairRecord()],
        recordedAt: '2026-08-30T01:01:00.000Z',
      });
      const thirdInput = commitInput({
        requestId: 'REQ-AIMS2-FALSE',
        expectedRevision: 9,
        sourceRevision: 'SOURCE-AIMS2-REV-2',
        target: AIMS2_TARGET,
        records: [equipmentRecord('INSTALL', 1), equipmentRecord('REMOVE', 4)],
        recordedAt: '2026-08-30T01:02:00.000Z',
      });
      const earlyAsOfInput = commitInput({
        requestId: 'REQ-AIMS2-EARLY-AS-OF',
        expectedRevision: 10,
        assessmentAsOf: EARLY_AS_OF,
        sourceRevision: 'SOURCE-AIMS2-EARLY-AS-OF-REV-1',
        target: AIMS2_TARGET,
        records: [equipmentRecord('INSTALL', 1)],
        recordedAt: '2026-08-30T01:03:00.000Z',
      });
      const conflictInput = commitInput({
        requestId: 'REQ-AIMS2-CONFLICT',
        expectedRevision: 11,
        sourceRevision: 'SOURCE-AIMS2-CONFLICT-REV-1',
        target: AIMS2_TARGET,
        records: [equipmentRecord('INSTALL', 6), equipmentRecord('REMOVE', 6)],
        recordedAt: '2026-08-30T01:04:00.000Z',
      });
      const staleCasInput = commitInput({
        requestId: 'REQ-AIMS2-STALE-CAS',
        expectedRevision: 11,
        sourceRevision: 'SOURCE-AIMS2-STALE-CAS-REV-1',
        target: AIMS2_TARGET,
        records: [equipmentRecord('INSTALL', 7)],
        recordedAt: '2026-08-30T01:05:00.000Z',
      });

      await asActor(databaseUrl, ACTOR_ID, async (actorSql) => {
        const store = new MiaodaConfigurationEvidenceStore(drizzle(actorSql));
        const first = await store.commit(firstInput);
        const second = await store.commit(secondInput);
        const replayedSecond = await store.commit(secondInput);

        assert.equal(first.persisted.snapshot.facts[0].truth, 'TRUE');
        assert.equal(second.persisted.snapshot.facts[0].truth, 'TRUE');
        assert.equal(replayedSecond.replayed, true);
        assert.equal(replayedSecond.workItem.revision, 9);
        assert.equal(
          await rowCount(actorSql, 'configuration_evidence_snapshot_version'),
          2,
        );

        const third = await store.commit(thirdInput);
        const oldAims2 = await store.readSnapshot({
          tenantId: TENANT_ID,
          workItemId: WORK_ITEM_ID,
          snapshotId: first.persisted.summary.snapshotId,
        });
        const oldRepair = await store.readSnapshot({
          tenantId: TENANT_ID,
          workItemId: WORK_ITEM_ID,
          snapshotId: second.persisted.summary.snapshotId,
        });
        const current = await store.readCurrent({
          tenantId: TENANT_ID,
          workItemId: WORK_ITEM_ID,
        });
        const history = await store.listHistory({
          tenantId: TENANT_ID,
          workItemId: WORK_ITEM_ID,
          limit: 20,
        });

        assert.equal(third.persisted.snapshot.facts[0].truth, 'FALSE');
        assert.deepEqual(
          oldAims2?.snapshot.facts,
          first.persisted.snapshot.facts,
        );
        assert.deepEqual(
          oldAims2?.snapshot.evidenceRecordRefs,
          first.persisted.snapshot.evidenceRecordRefs,
        );
        assert.deepEqual(oldAims2?.snapshot.predicateTraces[0], {
          ...first.persisted.snapshot.predicateTraces[0],
          status: 'STALE',
          staleReason: {
            code: 'DEPENDENCY_OBSERVATION_CHANGED',
            previousStatus: 'EVALUATED',
            incomingSourceSliceRef:
              third.persisted.snapshot.sourceSlices[0].sourceSliceRef,
            incomingSourceStatus: 'COMPLETE',
            incomingSourceSystem: 'TEST_INSTALLATION_EVENT_SOR',
            incomingSourceRevision: 'SOURCE-AIMS2-REV-2',
            incomingEvidenceRecordIds:
              third.persisted.snapshot.evidenceRecordRefs.map(
                (record) => record.evidenceRecordId,
              ),
            incomingConfigEventIds: third.persisted.snapshot.configEvents.map(
              (event) => event.configEventId,
            ),
          },
        });
        assert.equal(
          oldRepair?.snapshot.predicateTraces[0].status,
          'EVALUATED',
        );
        assert.equal(oldRepair?.snapshot.predicateTraces[0].staleReason, null);
        assert.equal(
          current?.summary.snapshotId,
          third.persisted.summary.snapshotId,
        );
        assert.equal(current?.summary.configurationRevision, 3);
        assert.equal(current?.summary.isCurrent, true);
        assert.equal(history.length, 3);
        assert.equal(history.filter((entry) => entry.isCurrent).length, 1);

        const countsBeforeReplay = await persistenceCounts(actorSql);
        const replayedFirst = await store.commit(firstInput);
        const replayRead = await store.findByRequest({
          tenantId: TENANT_ID,
          workItemId: WORK_ITEM_ID,
          requestId: firstInput.request.requestId,
        });
        const countsAfterReplay = await persistenceCounts(actorSql);
        assert.equal(replayedFirst.replayed, true);
        assert.equal(replayedFirst.workItem.revision, 10);
        assert.equal(replayRead?.workItem.revision, 10);
        assert.equal(replayRead?.persisted.summary.isCurrent, false);
        assert.deepEqual(
          replayRead?.persisted.snapshot.predicateTraces[0].staleReason,
          replayedFirst.persisted.snapshot.predicateTraces[0].staleReason,
        );
        assert.deepEqual(countsAfterReplay, countsBeforeReplay);
        assert.equal(
          replayedFirst.persisted.snapshot.predicateTraces[0].staleReason
            .previousStatus,
          'EVALUATED',
        );

        const earlyAsOf = await store.commit(earlyAsOfInput);
        const conflict = await store.commit(conflictInput);
        const persistedEarlyAsOf = await store.readSnapshot({
          tenantId: TENANT_ID,
          workItemId: WORK_ITEM_ID,
          snapshotId: earlyAsOf.persisted.summary.snapshotId,
        });
        const currentAfterConflict = await store.readCurrent({
          tenantId: TENANT_ID,
          workItemId: WORK_ITEM_ID,
        });
        const historyAfterConflict = await store.listHistory({
          tenantId: TENANT_ID,
          workItemId: WORK_ITEM_ID,
          limit: 20,
        });

        assert.equal(earlyAsOf.persisted.snapshot.assessmentAsOf, EARLY_AS_OF);
        assert.equal(earlyAsOf.persisted.snapshot.facts[0].truth, 'TRUE');
        assert.equal(persistedEarlyAsOf?.snapshot.assessmentAsOf, EARLY_AS_OF);
        assert.equal(persistedEarlyAsOf?.snapshot.facts[0].truth, 'TRUE');
        assert.equal(persistedEarlyAsOf?.summary.isCurrent, false);
        assert.equal(conflict.persisted.snapshot.facts[0].truth, 'CONFLICT');
        assert.equal(
          currentAfterConflict?.summary.snapshotId,
          conflict.persisted.summary.snapshotId,
        );
        assert.equal(currentAfterConflict?.summary.configurationRevision, 5);
        assert.equal(currentAfterConflict?.snapshot.facts[0].truth, 'CONFLICT');
        assert.equal(historyAfterConflict.length, 5);
        assert.equal(
          historyAfterConflict.filter((entry) => entry.isCurrent).length,
          1,
        );
        await assert.rejects(
          store.commit(staleCasInput),
          (error) => error?.code === 'WORK_ITEM_CAS_CONFLICT',
        );

        await assertAppendOnlyAndHeadBinding(actorSql, {
          firstSnapshotId: first.persisted.summary.snapshotId,
        });
      });

      await asActor(databaseUrl, OTHER_ACTOR_ID, async (actorSql) => {
        const store = new MiaodaConfigurationEvidenceStore(drizzle(actorSql));
        assert.equal(
          await store.readCurrent({
            tenantId: TENANT_ID,
            workItemId: WORK_ITEM_ID,
          }),
          null,
        );
        assert.deepEqual(
          await store.listHistory({
            tenantId: TENANT_ID,
            workItemId: WORK_ITEM_ID,
            limit: 20,
          }),
          [],
        );
        assert.equal(
          await store.readSnapshot({
            tenantId: TENANT_ID,
            workItemId: WORK_ITEM_ID,
            snapshotId: snapshotIdForRequest(earlyAsOfInput.request.requestId),
          }),
          null,
        );
        assert.equal(
          await store.readSnapshot({
            tenantId: TENANT_ID,
            workItemId: WORK_ITEM_ID,
            snapshotId: snapshotIdForRequest(conflictInput.request.requestId),
          }),
          null,
        );
        await assert.rejects(
          store.commit({ ...conflictInput, expectedWorkItemRevision: 12 }),
          (error) =>
            error?.code === 'CANONICAL_WORK_ITEM_NOT_FOUND' &&
            error?.statusCode === 409,
        );
      });
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
    '/wiselink_configuration_evidence_0017_test',
    'PostgreSQL integration test requires the exact isolated database name',
  );
}

function snapshotIdForRequest(requestId) {
  return `CONFIGURATION-SNAPSHOT:${requestId}`;
}

async function resetDatabase(sql) {
  const migration = await readFile(
    resolve(
      process.cwd(),
      'migrations/0017_configuration_evidence_persistence.sql',
    ),
    'utf8',
  );
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
      revision integer NOT NULL,
      projection_json text NOT NULL,
      updated_at timestamptz(3) NOT NULL
    )
  `);
  await sql.unsafe('ALTER TABLE work_item ENABLE ROW LEVEL SECURITY');
  const ownerExpression = `
    requested_by_user_id = current_setting('app.user_id', true)
    AND EXISTS (
      SELECT 1 FROM identity_subject_mapping actor_mapping
      WHERE actor_mapping.miaoda_user_id =
        current_setting('app.user_id', true)
        AND actor_mapping.miaoda_tenant_id = work_item.tenant_id
        AND actor_mapping.expected_client_id = 'cli_aadde8b579f95bc9'
        AND actor_mapping.status = 'ACTIVE'
    )
  `;
  await sql.unsafe(`
    CREATE POLICY work_item_authenticated_select
    ON work_item FOR SELECT TO authenticated
    USING (${ownerExpression})
  `);
  await sql.unsafe(`
    CREATE POLICY work_item_authenticated_update
    ON work_item FOR UPDATE TO authenticated
    USING (${ownerExpression})
    WITH CHECK (${ownerExpression})
  `);
  const migrationSql = await sql.reserve();
  try {
    await migrationSql.unsafe(migration);
  } finally {
    migrationSql.release();
  }
  await sql.unsafe('GRANT USAGE ON SCHEMA public TO authenticated');
  await sql.unsafe('GRANT SELECT ON identity_subject_mapping TO authenticated');
  await sql.unsafe('GRANT SELECT, UPDATE ON work_item TO authenticated');
  await sql.unsafe(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      configuration_evidence_snapshot_version,
      configuration_evidence_event_version,
      configuration_evidence_fact_version,
      configuration_evidence_predicate_trace_version,
      configuration_evidence_trace_staleness,
      configuration_evidence_work_item_head
    TO authenticated
  `);
  await sql`
    INSERT INTO identity_subject_mapping (
      miaoda_user_id,
      miaoda_tenant_id,
      expected_client_id,
      status
    ) VALUES
      (${ACTOR_ID}, ${TENANT_ID}, 'cli_aadde8b579f95bc9', 'ACTIVE'),
      (${OTHER_ACTOR_ID}, ${TENANT_ID}, 'cli_aadde8b579f95bc9', 'ACTIVE')
  `;
  await sql`
    INSERT INTO work_item (
      work_item_id,
      tenant_id,
      requested_by_user_id,
      revision,
      projection_json,
      updated_at
    ) VALUES (
      ${WORK_ITEM_ID},
      ${TENANT_ID},
      ${ACTOR_ID},
      7,
      ${JSON.stringify(workItemProjection())},
      '2026-08-30T00:59:00.000Z'
    )
  `;
}

async function assertPolicyReadback(sql) {
  const policies = await sql`
    SELECT tablename, roles::text AS roles, cmd
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename LIKE 'configuration_evidence_%'
    ORDER BY tablename, cmd
  `;
  assert.equal(policies.length, 13);
  assert.equal(
    policies.every(
      (policy) =>
        policy.roles.includes('authenticated') &&
        !policy.roles.includes('service_role'),
    ),
    true,
  );
  for (const tableName of [
    'configuration_evidence_snapshot_version',
    'configuration_evidence_event_version',
    'configuration_evidence_fact_version',
    'configuration_evidence_predicate_trace_version',
    'configuration_evidence_trace_staleness',
  ]) {
    assert.deepEqual(
      policies
        .filter((policy) => policy.tablename === tableName)
        .map((policy) => policy.cmd)
        .sort(),
      ['INSERT', 'SELECT'],
    );
  }
  assert.deepEqual(
    policies
      .filter(
        (policy) =>
          policy.tablename === 'configuration_evidence_work_item_head',
      )
      .map((policy) => policy.cmd)
      .sort(),
    ['INSERT', 'SELECT', 'UPDATE'],
  );
}

async function asActor(value, actorId, callback) {
  const actorSql = postgres(value, { max: 1 });
  try {
    await actorSql.unsafe('SET ROLE authenticated');
    await actorSql`SELECT set_config('app.user_id', ${actorId}, false)`;
    return await callback(actorSql);
  } finally {
    await actorSql.end({ timeout: 5 });
  }
}

function commitInput(input) {
  const assessmentAsOf = input.assessmentAsOf ?? AS_OF;
  const query = {
    schemaVersion: 'wiselink.3_1.get_installation_events_query.v0.candidate',
    aircraft: structuredClone(AIRCRAFT),
    target: structuredClone(input.target),
    windowStart: null,
    assessmentAsOf,
  };
  const projection = mapInstallationEventEvidence({
    query,
    result: completeResult(
      query,
      input.records,
      input.sourceRevision,
      input.recordedAt,
    ),
  });
  return {
    tenantId: TENANT_ID,
    actorId: ACTOR_ID,
    workItemId: WORK_ITEM_ID,
    expectedWorkItemRevision: input.expectedRevision,
    request: {
      schemaVersion: 'wiselink.3_1.refresh_configuration_evidence.v1',
      requestId: input.requestId,
      expectedRevision: input.expectedRevision,
      aircraftIdentifier: 'B-2035',
      assessmentAsOf,
      windowStart: null,
      gapRefs: ['GAP-CONFIGURATION'],
      targets: [structuredClone(input.target)],
      aircraft: structuredClone(AIRCRAFT),
      capabilityGrant: {
        schemaVersion:
          'wiselink.3_1.configuration_evidence_capability_grant.v1',
        grantRef: `CG-${input.requestId}`,
        capability: 'GET_INSTALLATION_EVENTS',
        inputRevision: input.expectedRevision,
        gapRefs: ['GAP-CONFIGURATION'],
        affectedCriterionIds: ['APP-012'],
        materialities: ['P0_DECISION_CRITICAL'],
        sourceConfigured: true,
        issuedAt: input.recordedAt,
      },
    },
    projections: [projection],
    snapshot: mapConfigurationSnapshot({
      aircraftAssetId: AIRCRAFT.assetId,
      assessmentAsOf,
      projections: [projection],
    }),
    recordedAt: input.recordedAt,
  };
}

function completeResult(query, records, sourceRevision, observedAt) {
  return {
    status: 'COMPLETE',
    source: {
      owner: 'canonical-host:configuration-evidence',
      sourceSystem: 'TEST_INSTALLATION_EVENT_SOR',
      sourceRevision,
      observedAt,
      freshness: 'AS_OF',
    },
    queryScope: structuredClone(query),
    coverage: {
      included: 'Exact controlled source records for the requested target.',
      limitation: 'No claim outside the requested aircraft and target.',
      completeness: 'COMPLETE',
      allRecordsRead: true,
      exactAircraftMatch: true,
      exactTargetMatch: true,
    },
    records: structuredClone(records),
    error: null,
  };
}

function equipmentRecord(kind, hour) {
  const timestamp = `2026-08-28T${String(hour).padStart(2, '0')}:00:00.000Z`;
  const component = {
    componentId: 'COMPONENT:AIMS2:P1',
    partNumber: 'PN:AIMS2',
    serialNumber: 'SN:AIMS2:P1',
    equipmentKey: 'AIMS2',
  };
  return sourceRecord({
    recordId: `WORK-ORDER:${kind}:P1:${hour}`,
    effectiveAt: timestamp,
    recordedAt: timestamp,
    position: { positionId: 'POSITION:P1', sourcePositionKey: 'P1' },
    event:
      kind === 'INSTALL'
        ? { kind, installedComponent: component }
        : { kind, removedComponent: component },
  });
}

function repairRecord() {
  return sourceRecord({
    recordId: 'WORK-ORDER:REPAIR:1',
    effectiveAt: '2026-08-28T02:00:00.000Z',
    recordedAt: '2026-08-28T02:00:00.000Z',
    position: { positionId: 'POSITION:AIMS', sourcePositionKey: 'AIMS' },
    event: {
      kind: 'REPAIR_ACCOMPLISHMENT',
      repair: { repairId: REPAIR_TARGET.repairId },
      affectedItem: { kind: 'POSITION', id: 'POSITION:AIMS' },
    },
  });
}

function sourceRecord(input) {
  return {
    recordId: input.recordId,
    revision: 'EVENT-REV-1',
    authorityClass:
      input.event.kind === 'REPAIR_ACCOMPLISHMENT'
        ? 'MAINTENANCE_RELEASE_RECORD'
        : 'INSTALLATION_EVENT_SOR',
    controlStatus: 'CONTROLLED',
    observedAt: '2026-08-29T12:00:00.000Z',
    freshness: 'AS_OF',
    coverage: {
      included: 'Exact controlled event record and revision.',
      limitation: 'Limited to the requested target.',
      completeness: 'COMPLETE',
    },
    aircraftAssetId: AIRCRAFT.assetId,
    position: input.position,
    effectiveAt: input.effectiveAt,
    recordedAt: input.recordedAt,
    event: structuredClone(input.event),
  };
}

function workItemProjection() {
  return {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: WORK_ITEM_ID,
    requestId: 'REQ-WORK-ITEM',
    revision: 7,
    source: { documentVersionId: 'DV-777-FTD-31-21002' },
  };
}

async function persistenceCounts(sql) {
  const [counts] = await sql`
    SELECT
      (SELECT count(*)::int
        FROM configuration_evidence_snapshot_version) AS snapshots,
      (SELECT count(*)::int
        FROM configuration_evidence_event_version) AS events,
      (SELECT count(*)::int
        FROM configuration_evidence_fact_version) AS facts,
      (SELECT count(*)::int
        FROM configuration_evidence_predicate_trace_version) AS traces,
      (SELECT count(*)::int
        FROM configuration_evidence_trace_staleness) AS staleness,
      (SELECT count(*)::int
        FROM configuration_evidence_work_item_head) AS heads
  `;
  return counts;
}

async function rowCount(sql, tableName) {
  const [count] = await sql.unsafe(
    `SELECT count(*)::int AS value FROM ${tableName}`,
  );
  return count.value;
}

async function assertAppendOnlyAndHeadBinding(sql, input) {
  const updatedFacts = await sql`
    UPDATE configuration_evidence_fact_version
    SET truth = 'FALSE'
    RETURNING fact_assertion_id
  `;
  const deletedEvents = await sql`
    DELETE FROM configuration_evidence_event_version
    RETURNING config_event_id
  `;
  assert.equal(updatedFacts.length, 0);
  assert.equal(deletedEvents.length, 0);
  await assert.rejects(
    sql`
      UPDATE configuration_evidence_work_item_head
      SET
        current_snapshot_id = ${input.firstSnapshotId},
        configuration_revision = 3
      WHERE tenant_id = ${TENANT_ID}
        AND work_item_id = ${WORK_ITEM_ID}
    `,
    (error) => error?.code === '23503',
  );
}
