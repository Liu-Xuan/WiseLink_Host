import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
const {
  readFrozenApplicabilitySourceBinding,
} = require('../../server/modules/canonical-host/canonical-host-applicability-source.ts');

const databaseUrl = process.env.CANONICAL_FLEET_TEST_DATABASE_URL;

test(
  'R09 Fleet DB serial migrations allow service reads and keep writes closed',
  { skip: !databaseUrl, concurrency: false },
  async () => {
    assertSafeIsolatedDatabase(databaseUrl);
    const sql = postgres(databaseUrl, { max: 4 });
    try {
      await resetDatabase(sql);
      await importRealFleet(databaseUrl);
      await assertFleetPolicyReadback(sql);
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

      const service = await sql.reserve();
      try {
        await service.unsafe('BEGIN');
        await service.unsafe('SET LOCAL ROLE service_role');
        const [context] = await service`
          SELECT current_setting('app.user_id', true) AS user_id
        `;
        assert.ok(context.user_id === null || context.user_id === '');
        service.options = sql.options;
        const repository = new CanonicalFleetMasterDataRepository(
          drizzle(service),
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
        await service.unsafe('COMMIT');
      } finally {
        service.release();
      }

      await assertServiceWriteDenials(sql);

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
            INSERT INTO canonical_fleet_source_snapshot (
              tenant_id,
              source_snapshot_id,
              source_kind,
              logical_source_key,
              source_revision_key,
              source_content_hash,
              source_as_of,
              snapshot_as_of,
              fleet_snapshot_digest,
              upstream_lineage_json,
              aircraft_asset_count,
              identity_alias_count,
              configuration_fact_count,
              imported_by_actor_id
            ) VALUES (
              'tenant-local',
              'FMS-BROWSER-WRITE-DENIED',
              'test',
              'test',
              'test',
              ${`sha256:${'0'.repeat(64)}`},
              '2026-08-27',
              CURRENT_TIMESTAMP,
              ${'0'.repeat(64)},
              '{}',
              1,
              0,
              0,
              'user-local'
            )
          `,
          /row-level security policy/iu,
        );
        await browserWrite.unsafe('ROLLBACK');
        await browserWrite.unsafe('BEGIN');
        await browserWrite.unsafe('SET LOCAL ROLE authenticated');
        await browserWrite`
          SELECT set_config('app.user_id', 'user-local', true)
        `;
        const updated = await browserWrite`
          UPDATE canonical_fleet_scope_head
          SET authority_revision = authority_revision + 1
          WHERE tenant_id = 'tenant-local'
          RETURNING authority_revision
        `;
        assert.equal(updated.length, 0);
        const deleted = await browserWrite`
          DELETE FROM canonical_fleet_alias_version
          WHERE tenant_id = 'tenant-local'
          RETURNING alias_version_id
        `;
        assert.equal(deleted.length, 0);
        await browserWrite.unsafe('ROLLBACK');
      } finally {
        browserWrite.release();
      }
      const [unchanged] = await sql`
        SELECT
          authority_revision,
          (SELECT count(*)::int FROM canonical_fleet_alias_version
            WHERE tenant_id = 'tenant-local') AS aircraft_identity_aliases
        FROM canonical_fleet_scope_head
        WHERE tenant_id = 'tenant-local'
      `;
      assert.deepEqual(unchanged, {
        authority_revision: 1,
        aircraft_identity_aliases: 2579,
      });
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
);

async function resetDatabase(sql) {
  const [fleetMigration, serviceMigration] = await Promise.all([
    readFile(
      resolve(process.cwd(), 'migrations/0011_canonical_fleet_master_data.sql'),
      'utf8',
    ),
    readFile(
      resolve(
        process.cwd(),
        'migrations/0012_canonical_fleet_service_role_select.sql',
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
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
      THEN CREATE ROLE service_role NOLOGIN;
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
  const migrationSql = await sql.reserve();
  try {
    await migrationSql.unsafe(fleetMigration);
    await migrationSql.unsafe(serviceMigration);
  } finally {
    migrationSql.release();
  }
  await sql.unsafe(
    'GRANT USAGE ON SCHEMA public TO authenticated, service_role',
  );
  await sql.unsafe('GRANT SELECT ON identity_subject_mapping TO authenticated');
  await sql.unsafe(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      canonical_fleet_source_snapshot,
      canonical_fleet_scope_head,
      canonical_fleet_asset_version,
      canonical_fleet_alias_version,
      canonical_fleet_configuration_fact_version
    TO authenticated, service_role
  `);
  await sql.unsafe(`
    INSERT INTO identity_subject_mapping (
      miaoda_user_id,
      miaoda_tenant_id,
      expected_client_id,
      status
    ) VALUES
      ('user-local', 'tenant-local', 'cli_aadde8b579f95bc9', 'ACTIVE'),
      ('user-other', 'tenant-other', 'cli_aadde8b579f95bc9', 'ACTIVE')
  `);
}

async function importRealFleet(value) {
  const result = spawnSync(
    process.execPath,
    [
      resolve(process.cwd(), 'scripts/import-canonical-fleet-master-data.mjs'),
      '--tenant-id',
      'tenant-local',
      '--actor-id',
      'system:canonical-fleet-postgres-test',
      '--apply',
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        CANONICAL_FLEET_IMPORT_DATABASE_URL: value,
      },
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const imported = JSON.parse(result.stdout);
  assert.equal(imported.status, 'applied');
  assert.deepEqual(imported.readback, {
    aircraftAssets: 587,
    aircraftIdentityAliases: 2579,
    configurationFacts: 0,
  });
}

async function assertFleetPolicyReadback(sql) {
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
        'canonical_fleet_source_snapshot',
        'canonical_fleet_scope_head',
        'canonical_fleet_asset_version',
        'canonical_fleet_alias_version',
        'canonical_fleet_configuration_fact_version'
      )
    ORDER BY tablename, policyname
  `;
  assert.equal(policies.length, 10);
  const servicePolicies = policies.filter((policy) =>
    policy.roles.includes('service_role'),
  );
  assert.equal(servicePolicies.length, 5);
  for (const policy of servicePolicies) {
    assert.equal(policy.cmd, 'SELECT');
    assert.equal(normalizePolicyExpression(policy.qual), 'true');
    assert.equal(policy.withCheck, null);
  }
  const authenticatedPolicies = policies.filter((policy) =>
    policy.roles.includes('authenticated'),
  );
  assert.equal(authenticatedPolicies.length, 5);
  assert.equal(
    authenticatedPolicies.every((policy) => policy.cmd === 'SELECT'),
    true,
  );
}

function normalizePolicyExpression(expression) {
  return String(expression ?? '')
    .replace(/[()]/gu, '')
    .trim()
    .toLowerCase();
}

async function assertServiceWriteDenials(sql) {
  const serviceWrite = await sql.reserve();
  try {
    await serviceWrite.unsafe('BEGIN');
    await serviceWrite.unsafe('SET LOCAL ROLE service_role');
    await assert.rejects(
      serviceWrite`
        INSERT INTO canonical_fleet_source_snapshot (
          tenant_id,
          source_snapshot_id,
          source_kind,
          logical_source_key,
          source_revision_key,
          source_content_hash,
          source_as_of,
          snapshot_as_of,
          fleet_snapshot_digest,
          upstream_lineage_json,
          aircraft_asset_count,
          identity_alias_count,
          configuration_fact_count,
          imported_by_actor_id
        ) VALUES (
          'tenant-local',
          'FMS-SERVICE-WRITE-DENIED',
          'test',
          'test',
          'test',
          ${`sha256:${'0'.repeat(64)}`},
          '2026-08-27',
          CURRENT_TIMESTAMP,
          ${'0'.repeat(64)},
          '{}',
          1,
          0,
          0,
          'service-role'
        )
      `,
      /row-level security policy/iu,
    );
    await serviceWrite.unsafe('ROLLBACK');
    await serviceWrite.unsafe('BEGIN');
    await serviceWrite.unsafe('SET LOCAL ROLE service_role');
    const updated = await serviceWrite`
      UPDATE canonical_fleet_scope_head
      SET authority_revision = authority_revision + 1
      WHERE tenant_id = 'tenant-local'
      RETURNING authority_revision
    `;
    assert.equal(updated.length, 0);
    const deleted = await serviceWrite`
      DELETE FROM canonical_fleet_alias_version
      WHERE tenant_id = 'tenant-local'
      RETURNING alias_version_id
    `;
    assert.equal(deleted.length, 0);
    await serviceWrite.unsafe('ROLLBACK');
  } finally {
    serviceWrite.release();
  }
}

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
  assert.equal(source.assets[0].aliases.length, 5);
  assert.equal(
    source.assets[0].aliases.some(({ aliasValue }) => aliasValue === 'B-1266'),
    true,
  );
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
  const sourceBinding = readFrozenApplicabilitySourceBinding({
    bytes: frozen777ApplicabilityBytes(),
    workItem: current,
    sourceUnits: [
      {
        unitId: 'UNIT-777-AIMS2',
        kind: 'paragraph',
        text: 'MODEL 777 WITH AIMS-2 INSTALLED',
        sourceRefIds: ['SRC-777-AIMS2'],
      },
    ],
  });
  assert.deepEqual(sourceBinding.deterministicFragments, [
    {
      ruleFragmentId: 'EXP-777-AIMS2',
      extractionStatus: 'extracted',
      applicabilityLevel: 'document_effectivity',
      contentRef: null,
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
  ]);
  const trace = evaluateApplicabilityFragmentSetWithTrace(
    sourceBinding.deterministicFragments,
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

function frozen777ApplicabilityBytes() {
  return new TextEncoder().encode(
    JSON.stringify({
      sourceRefs: [{ sourceRefId: 'SRC-777-AIMS2' }],
      modules: [{ moduleId: 'MODULE-777' }],
      applicability: {
        sourceExpressions: [
          {
            expressionId: 'EXP-777-AIMS2',
            text: 'MODEL 777 WITH AIMS-2 INSTALLED',
            form: 'logical_expression',
            authority: 'source_asserted',
            sourceRefIds: ['SRC-777-AIMS2'],
          },
        ],
        normalizedCandidates: [
          {
            candidateId: 'CANDIDATE-777-AIMS2',
            language: 'techpub-applicability-expr.v1',
            confidence: 'deterministic',
            sourceExpressionIds: ['EXP-777-AIMS2'],
            expression: {
              operator: 'all',
              children: [
                {
                  operator: 'predicate',
                  predicate: {
                    property: 'model',
                    comparator: 'eq',
                    values: ['777'],
                  },
                },
                {
                  operator: 'predicate',
                  predicate: {
                    property: 'equipmentModelInstalled',
                    comparator: 'eq',
                    values: ['AIMS-2'],
                  },
                },
              ],
            },
            authority: 'parser_candidate',
          },
        ],
        assignments: [
          {
            assignmentId: 'ASSIGN-777-AIMS2',
            expressionId: 'EXP-777-AIMS2',
            authority: 'source_asserted',
            target: {
              kind: 'module',
              targetId: 'MODULE-777',
              sourceRefIds: ['SRC-777-AIMS2'],
            },
          },
        ],
      },
    }),
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
