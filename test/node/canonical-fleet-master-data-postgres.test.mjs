import assert from 'node:assert/strict';
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
const {
  CanonicalFleetMasterDataRepository,
} = require('../../server/modules/canonical-host/canonical-fleet-master-data.repository.ts');
const {
  CanonicalHostApplicabilitySelectionService,
} = require('../../server/modules/canonical-host/canonical-host-applicability-selection.service.ts');
const {
  MiaodaApplicabilityControlledSelectionAdapter,
} = require('../../server/modules/canonical-host/miaoda-applicability-controlled-selection.adapter.ts');
const {
  resolveFleetSnapshot,
} = require('../../server/modules/assessment-workbench/applicability-fleet/fleetMasterData.ts');
const {
  UNKNOWN,
  evaluateApplicabilityFragmentSetWithTrace,
} = require('../../server/modules/assessment-workbench/applicability-fleet/applicabilityKleeneEngine.ts');

const databaseUrl = process.env.CANONICAL_FLEET_TEST_DATABASE_URL;

test(
  'R09 Fleet DB owner reads the imported real 777 and enforces authenticated tenant isolation',
  { skip: !databaseUrl, concurrency: false },
  async () => {
    assertSafeIsolatedDatabase(databaseUrl);
    const sql = postgres(databaseUrl, { max: 4 });
    try {
      const [counts] = await sql`
        SELECT
          (SELECT count(*)::int FROM canonical_fleet_asset_version
            WHERE tenant_id = 'tenant-local') AS aircraft_assets,
          (SELECT count(*)::int FROM canonical_fleet_alias_version
            WHERE tenant_id = 'tenant-local') AS aircraft_identity_aliases,
          (SELECT count(*)::int
            FROM canonical_fleet_configuration_fact_version
            WHERE tenant_id = 'tenant-local') AS configuration_facts,
          (SELECT count(*)::int
            FROM canonical_fleet_configuration_fact_version
            WHERE tenant_id = 'tenant-local'
              AND property = 'equipmentModelInstalled'
              AND upper(coalesce(qualifier, '')) = 'AIMS-2') AS aims_2_facts
      `;
      assert.deepEqual(counts, {
        aircraft_assets: 587,
        aircraft_identity_aliases: 2579,
        configuration_facts: 0,
        aims_2_facts: 0,
      });

      const ownerRepository = new CanonicalFleetMasterDataRepository(
        drizzle(sql),
      );
      assertRealB1266(
        await ownerRepository.readCurrentForAircraft({
          tenantId: 'tenant-local',
          aircraftIdentifier: 'B-1266',
          asOf: '2026-08-27',
        }),
      );
      await assertSelectionAndKleeneUnknown(ownerRepository);

      const authenticated = await sql.reserve();
      try {
        await authenticated.unsafe('BEGIN');
        await authenticated.unsafe('SET LOCAL ROLE authenticated');
        await authenticated`
          SELECT set_config('app.user_id', 'user-local', true)
        `;
        authenticated.options = sql.options;
        const repository = new CanonicalFleetMasterDataRepository(
          drizzle(authenticated),
        );
        assertRealB1266(
          await repository.readCurrentForAircraft({
            tenantId: 'tenant-local',
            aircraftIdentifier: 'B-1266',
            asOf: '2026-08-27',
          }),
        );
        await assert.rejects(
          repository.readCurrentForAircraft({
            tenantId: 'tenant-other',
            aircraftIdentifier: 'B-1266',
            asOf: '2026-08-27',
          }),
          (error) =>
            error?.code === 'APPLICABILITY_FLEET_DATABASE_UNAVAILABLE' &&
            error?.statusCode === 503,
        );
        await authenticated.unsafe('COMMIT');
      } finally {
        authenticated.release();
      }

      const browserWrite = await sql.reserve();
      try {
        await browserWrite.unsafe('BEGIN');
        await browserWrite.unsafe('SET LOCAL ROLE authenticated');
        await browserWrite`
          SELECT set_config('app.user_id', 'user-local', true)
        `;
        await assert.rejects(
          browserWrite`
            UPDATE canonical_fleet_scope_head
            SET authority_revision = authority_revision + 1
            WHERE tenant_id = 'tenant-local'
          `,
          /permission denied/u,
        );
        await browserWrite.unsafe('ROLLBACK');
      } finally {
        browserWrite.release();
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
);

function assertRealB1266(source) {
  assert.equal(
    source.sourceSnapshotId,
    'FMS-1dc404288ff1e05218d5eac81e2e9327c1bf9c06ddbaa6450b7bfa6267eae36e',
  );
  assert.equal(
    source.sourceRevisionKey,
    'legacy-object-layer-export-2026-06-05T20-28-49-064Z',
  );
  assert.equal(source.authorityRevision, '1');
  assert.equal(source.sourceAsOf, '2026-06-05');
  assert.equal(source.assets.length, 1);
  assert.deepEqual(source.facts, []);
  assert.deepEqual(
    {
      aircraftNumber: source.assets[0].aircraftNumber,
      fleetFamily: source.assets[0].fleetFamily,
      aircraftModel: source.assets[0].aircraftModel,
      series: source.assets[0].series,
      msn: source.assets[0].msn,
    },
    {
      aircraftNumber: 'B-1266',
      fleetFamily: 'B777',
      aircraftModel: 'B777-39L',
      series: 'B777-300',
      msn: '65300',
    },
  );
}

async function assertSelectionAndKleeneUnknown(fleetRepository) {
  let current = selectableWorkItem();
  const registrar = {
    getTenantScopedByWorkItemId: async ({ tenantId, workItemId }) => {
      if (tenantId !== 'tenant-local' || workItemId !== current.workItemId) {
        throw new Error('CANONICAL_WORK_ITEM_NOT_FOUND');
      }
      return structuredClone(current);
    },
    compareAndSet: async ({ expectedRevision, next }) => {
      assert.equal(expectedRevision, current.revision);
      current = { ...structuredClone(next), revision: current.revision + 1 };
      return structuredClone(current);
    },
  };
  const session = {
    actor: {
      tenantId: 'tenant-local',
      canonicalSubject: { namespace: 'MIAODA_USER_ID', id: 'user-local' },
    },
  };
  const sessions = { resolve: async () => session };
  const objectAccess = {
    freshRead: async ({ action, accessRoot }) => ({
      allowed: true,
      action,
      workItemId: accessRoot.id,
      workItemRevision: current.revision,
      documentVersionId: current.source.documentVersionId,
      tenantId: 'tenant-local',
      actorUserId: 'user-local',
    }),
  };
  const selections = new CanonicalHostApplicabilitySelectionService(
    sessions,
    objectAccess,
    registrar,
    fleetRepository,
  );
  const selected = await selections.configure(
    current.workItemId,
    { aircraftIdentifier: 'b-1266', asOf: '2026-08-27' },
    {},
  );
  assert.equal(selected.aircraftIdentifier, 'B-1266');
  assert.equal(selected.currentness, 'CURRENT');
  assert.equal(selected.fleetSource.authorityRevision, '1');
  assert.equal(JSON.stringify(selected).includes('recordHash'), false);

  const controlled = await new MiaodaApplicabilityControlledSelectionAdapter(
    registrar,
    fleetRepository,
  ).readCurrent({
    tenantId: 'tenant-local',
    workItemId: current.workItemId,
    documentVersionId: current.source.documentVersionId,
    applicabilityContextRef: 'APCTX-LOCAL-777',
  });
  const resolution = resolveFleetSnapshot({
    dataSource: controlled.fleetMasterData,
    aircraftNumber: controlled.aircraftNumber,
    asOf: controlled.assessmentAsOf,
  });
  assert.equal(resolution.status, 'RESOLVED');
  assert.equal(resolution.snapshot.properties.model, 'B777-39L');
  const trace = evaluateApplicabilityFragmentSetWithTrace(
    [
      {
        ruleFragmentId: 'EXP-777-AIMS2',
        extractionStatus: 'extracted',
        applicabilityLevel: 'document_effectivity',
        expressionAst: {
          type: 'and',
          children: [
            { type: 'assert', property: 'model', operator: 'eq', value: '777' },
            {
              type: 'assert',
              property: 'equipmentModelInstalled',
              operator: 'eq',
              value: true,
              qualifier: 'AIMS-2',
            },
          ],
        },
      },
    ],
    resolution.snapshot,
  );
  assert.equal(trace.result, UNKNOWN);
  assert.deepEqual(
    trace.blockingUnknowns.map(({ kind, property, qualifier, assetId }) => ({
      kind,
      property,
      qualifier,
      assetId,
    })),
    [
      {
        kind: 'fact_unknown',
        property: 'equipmentModelInstalled',
        qualifier: 'AIMS2',
        assetId: 'AIRCRAFT:MODEL_MSN:B777_39L_65300',
      },
    ],
  );
}

function selectableWorkItem() {
  return {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: 'WI-LOCAL-777',
    requestId: 'REQ-LOCAL-777',
    revision: 7,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    source: {
      documentId: 'DOC-LOCAL-777',
      documentVersionId: 'DV-LOCAL-777',
    },
    package: {
      contractId: 'techpub.parsed-package.v1',
      contractRevision: 'frozen.2',
      usagePolicy: {
        applicability: {
          sourceExpressionCount: 1,
          normalizedCandidateCount: 1,
          assignmentCount: 1,
        },
      },
    },
    applicabilityControlledSelection: null,
    applicabilityInput: null,
    applicability: null,
  };
}

function assertSafeIsolatedDatabase(value) {
  const parsed = new URL(value);
  assert.ok(['127.0.0.1', 'localhost'].includes(parsed.hostname));
  assert.match(parsed.pathname, /fleet_test/u);
}
