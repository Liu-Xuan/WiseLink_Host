import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const TENANT = 'tenant-batch-local';
export const ACTOR = 'user-batch-local';
export const OTHER_TENANT = 'tenant-batch-other';
export const OTHER_ACTOR = 'user-batch-other';
export const CURRENT_WORK_ITEM = 'WI-BATCH-HOST-CURRENT';
export const STALE_WORK_ITEM = 'WI-BATCH-HOST-STALE';
export const SOURCE_EXPRESSION = 'EXP-BATCH-737-PN';
export const CONTROLLED_SNAPSHOT = 'FMS-TEST-CONTROLLED-BATCH-V2';
export const CONTROLLED_REVISION = 'test-controlled:batch-v2';

export async function resetBatchDatabase(sql, databaseUrl) {
  const [workItemDdl, fleetMigration, serviceMigration, batchMigration] =
    await Promise.all([
      readFile(
        resolve(process.cwd(), 'server/database/work-item.ddl.sql'),
        'utf8',
      ),
      readFile(
        resolve(
          process.cwd(),
          'migrations/0011_canonical_fleet_master_data.sql',
        ),
        'utf8',
      ),
      readFile(
        resolve(
          process.cwd(),
          'migrations/0012_canonical_fleet_service_role_select.sql',
        ),
        'utf8',
      ),
      readFile(
        resolve(process.cwd(), 'migrations/0016_batch_applicability_host.sql'),
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
    CREATE TYPE user_profile AS (
      user_id text, name text, avatar_url text, tenant_id text
    )
  `);
  const migrationSql = await sql.reserve();
  try {
    await migrationSql.unsafe(workItemDdl);
  } finally {
    migrationSql.release();
  }
  await sql.unsafe(`
    CREATE TABLE identity_subject_mapping (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      miaoda_user_id varchar(255) NOT NULL,
      miaoda_tenant_id varchar(128) NOT NULL,
      expected_client_id varchar(128) NOT NULL,
      status varchar(32) NOT NULL
    )
  `);
  const serialMigrationSql = await sql.reserve();
  try {
    await serialMigrationSql.unsafe(fleetMigration);
    await serialMigrationSql.unsafe(serviceMigration);
    await serialMigrationSql.unsafe(batchMigration);
  } finally {
    serialMigrationSql.release();
  }
  await sql.unsafe(
    'GRANT USAGE ON SCHEMA public TO authenticated, service_role',
  );
  await sql.unsafe('GRANT SELECT ON identity_subject_mapping TO authenticated');
  await sql.unsafe(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      work_item, action_attempt,
      canonical_fleet_source_snapshot, canonical_fleet_scope_head,
      canonical_fleet_asset_version, canonical_fleet_alias_version,
      canonical_fleet_configuration_fact_version,
      batch_applicability_run, batch_applicability_confirmation
    TO authenticated, service_role
  `);
  await sql`
    INSERT INTO identity_subject_mapping (
      miaoda_user_id, miaoda_tenant_id, expected_client_id, status
    ) VALUES
      (${ACTOR}, ${TENANT}, 'cli_aadde8b579f95bc9', 'ACTIVE'),
      (${OTHER_ACTOR}, ${OTHER_TENANT}, 'cli_aadde8b579f95bc9', 'ACTIVE')
  `;
  importRealFleet(databaseUrl);
}

export function importRealFleet(databaseUrl) {
  const result = spawnSync(
    process.execPath,
    [
      resolve(process.cwd(), 'scripts/import-canonical-fleet-master-data.mjs'),
      '--tenant-id',
      TENANT,
      '--actor-id',
      'system:batch-host-postgres-test',
      '--apply',
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        CANONICAL_FLEET_IMPORT_DATABASE_URL: databaseUrl,
      },
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const readback = JSON.parse(result.stdout).readback;
  assert.deepEqual(readback, {
    aircraftAssets: 587,
    aircraftIdentityAliases: 2579,
    configurationFacts: 0,
  });
}

export async function createControlledFleetHead(sql) {
  const [base] = await sql`
    SELECT current_source_snapshot_id AS "sourceSnapshotId",
      authority_revision AS "authorityRevision"
    FROM canonical_fleet_scope_head WHERE tenant_id = ${TENANT}
  `;
  assert.equal(base.authorityRevision, 1);
  const [counts] = await sql`
    SELECT
      (SELECT count(*)::int FROM canonical_fleet_asset_version
        WHERE tenant_id = ${TENANT}) AS assets,
      (SELECT count(*)::int FROM canonical_fleet_alias_version
        WHERE tenant_id = ${TENANT}) AS aliases,
      (SELECT count(*)::int FROM canonical_fleet_configuration_fact_version
        WHERE tenant_id = ${TENANT}) AS facts
  `;
  assert.deepEqual(counts, { assets: 587, aliases: 2579, facts: 0 });
  await sql`
    INSERT INTO canonical_fleet_source_snapshot (
      tenant_id, source_snapshot_id, source_kind, logical_source_key,
      source_revision_key, source_content_hash, source_as_of, snapshot_as_of,
      fleet_snapshot_digest, upstream_lineage_json, aircraft_asset_count,
      identity_alias_count, configuration_fact_count, imported_by_actor_id
    ) SELECT tenant_id, ${CONTROLLED_SNAPSHOT}, 'test_controlled',
      logical_source_key, ${CONTROLLED_REVISION}, ${hash('controlled-source')},
      source_as_of, CURRENT_TIMESTAMP, ${rawHash('controlled-digest')},
      '{"authority":"TEST_CONTROLLED_ONLY"}', aircraft_asset_count,
      identity_alias_count, 4, 'test-controlled:batch-host'
    FROM canonical_fleet_source_snapshot
    WHERE tenant_id = ${TENANT} AND source_snapshot_id = ${base.sourceSnapshotId}
  `;
  await sql`
    INSERT INTO canonical_fleet_asset_version (
      tenant_id, source_snapshot_id, asset_id, asset_version_id,
      aircraft_number, fleet_family, aircraft_model, series, msn, line_number,
      delivery_date, valid_from, valid_to, status, source_record_id,
      record_hash, source_record_hash
    ) SELECT tenant_id, ${CONTROLLED_SNAPSHOT}, asset_id,
      left(asset_version_id, 88) || ':TC2', aircraft_number, fleet_family,
      aircraft_model, series, msn, line_number, delivery_date, valid_from,
      valid_to, status, 'test-controlled:' || left(source_record_id, 108),
      record_hash, source_record_hash
    FROM canonical_fleet_asset_version
    WHERE tenant_id = ${TENANT} AND source_snapshot_id = ${base.sourceSnapshotId}
  `;
  await sql`
    INSERT INTO canonical_fleet_alias_version (
      tenant_id, source_snapshot_id, alias_version_id, alias_id, asset_id,
      alias_type, alias_value, status, record_hash
    ) SELECT tenant_id, ${CONTROLLED_SNAPSHOT},
      left(alias_version_id, 88) || ':TC2', alias_id, asset_id, alias_type,
      alias_value, status, record_hash
    FROM canonical_fleet_alias_version
    WHERE tenant_id = ${TENANT} AND source_snapshot_id = ${base.sourceSnapshotId}
  `;
  const assets = await sql`
    SELECT aircraft_number, asset_id FROM canonical_fleet_asset_version
    WHERE tenant_id = ${TENANT} AND source_snapshot_id = ${CONTROLLED_SNAPSHOT}
      AND aircraft_number IN ('B-1397', 'B-1392', 'B-1398')
  `;
  const assetId = (aircraftNumber) =>
    assets.find((row) => row.aircraft_number === aircraftNumber).asset_id;
  const facts = [
    ['B1397-TRUE', assetId('B-1397'), true],
    ['B1392-TRUE', assetId('B-1392'), true],
    ['B1398-TRUE', assetId('B-1398'), true],
    ['B1398-FALSE', assetId('B-1398'), false],
  ];
  for (const [factId, controlledAssetId, value] of facts) {
    await sql`
      INSERT INTO canonical_fleet_configuration_fact_version (
        tenant_id, source_snapshot_id, fact_id, fact_version_id, asset_id,
        fact_type, property, qualifier, value_json, valid_as_of, status,
        source_record_id, record_hash
      ) VALUES (
        ${TENANT}, ${CONTROLLED_SNAPSHOT}, ${`FACT-${factId}`},
        ${`FACT-V-${factId}`}, ${controlledAssetId}, 'fleet_configuration',
        'pnInstalled', '10-62225-004', ${JSON.stringify(value)},
        '2026-07-01', 'ACTIVE', ${`test-controlled:${factId}`},
        ${hash(`fact:${factId}:${value}`)}
      )
    `;
  }
  await sql`
    UPDATE canonical_fleet_scope_head
    SET current_source_snapshot_id = ${CONTROLLED_SNAPSHOT},
      authority_revision = 2, updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ${TENANT}
  `;
  return base.sourceSnapshotId;
}

export function frozenPackageBytes() {
  const predicate = (property, comparator, values) => ({
    operator: 'predicate',
    predicate: { property, comparator, values },
  });
  return new TextEncoder().encode(
    JSON.stringify({
      sourceRefs: [{ sourceRefId: 'SRC-BATCH-737-PN' }],
      modules: [{ moduleId: 'MODULE-BATCH-737' }],
      applicability: {
        sourceExpressions: [
          {
            expressionId: SOURCE_EXPRESSION,
            text: '737 effectivity with part 10-62225-004 installed',
            authority: 'source_asserted',
            sourceRefIds: ['SRC-BATCH-737-PN'],
          },
        ],
        normalizedCandidates: [
          {
            candidateId: 'CANDIDATE-BATCH-737-PN',
            language: 'techpub-applicability-expr.v1',
            confidence: 'deterministic',
            sourceExpressionIds: [SOURCE_EXPRESSION],
            expression: {
              operator: 'all',
              children: [
                predicate('model', 'in', ['737-8', '737-9', '737-8200']),
                predicate('lineNumber', 'in', [6490, 6555, 6722]),
                predicate('pnInstalled', 'eq', ['10-62225-004']),
              ],
            },
            authority: 'parser_candidate',
          },
        ],
        assignments: [
          {
            assignmentId: 'ASSIGN-BATCH-737-PN',
            expressionId: SOURCE_EXPRESSION,
            authority: 'source_asserted',
            target: {
              kind: 'module',
              targetId: 'MODULE-BATCH-737',
              sourceRefIds: ['SRC-BATCH-737-PN'],
            },
          },
        ],
      },
    }),
  );
}

export function sourceUnits() {
  return [
    {
      unitId: 'UNIT-BATCH-737-PN',
      kind: 'paragraph',
      text: '737 effectivity with part 10-62225-004 installed',
      sourceRefIds: ['SRC-BATCH-737-PN'],
    },
  ];
}

export function buildWorkItem({ workItemId, stale, targetBindingHash }) {
  const selectionRevision = `${workItemId}:selection:7`;
  const fleetHead = {
    sourceSnapshotId: CONTROLLED_SNAPSHOT,
    sourceRevisionKey: CONTROLLED_REVISION,
    authorityRevision: '2',
    sourceAsOf: '2026-06-05',
  };
  const artifactBytes = frozenPackageBytes();
  const artifact = {
    storeRole: 'UnifiedArtifactStoreCandidate',
    ref: `artifact://batch/${workItemId}.json`,
    sha256: rawHash(artifactBytes),
    byteLength: artifactBytes.byteLength,
    mediaType: 'application/json',
  };
  return {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId,
    requestId: `REQ-${workItemId}`,
    revision: 7,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    source: { documentId: 'DOC-BATCH', documentVersionId: `DV-${workItemId}` },
    package: {
      packageId: `PKG-${workItemId}`,
      contractId: 'techpub.parsed-package.v1',
      contractRevision: 'frozen.2',
      artifact,
      contentHash: hash(`package:${workItemId}`),
      contentUnitCount: 1,
      usagePolicy: {
        applicability: {
          sourceExpressionCount: 1,
          normalizedCandidateCount: 1,
          assignmentCount: 1,
        },
      },
    },
    applicabilityControlledSelection: {
      schemaVersion: 'wiselink.3_1.controlled_applicability_selection.v1',
      selectionRevision,
      currentness: 'CURRENT',
      documentVersionId: `DV-${workItemId}`,
      aircraftIdentifier: 'B-1397',
      asOf: '2026-08-30',
      fleetSourceSnapshotId: fleetHead.sourceSnapshotId,
      fleetSourceRevisionKey: fleetHead.sourceRevisionKey,
      fleetAuthorityRevision: fleetHead.authorityRevision,
      fleetSourceAsOf: fleetHead.sourceAsOf,
    },
    applicabilityInput: {
      schemaVersion: 'wiselink.3_1.applicability_input_projection.v1',
      applicabilityContextRef: `host-applicability-context:${workItemId}`,
      workItemId,
      documentVersionId: `DV-${workItemId}`,
      sourcePackageId: `PKG-${workItemId}`,
      sourcePackageContentHash: hash(`package:${workItemId}`),
      sourcePackageArtifactSha256: artifact.sha256,
      targetBindingHash,
      selectionRevision,
      bindingRevision: `${workItemId}:binding:7`,
      currentness: stale ? 'STALE' : 'CURRENT',
      aircraftNumber: 'B-1397',
      assessmentAsOf: '2026-08-30',
      fleetMasterData: {
        schemaVersion: 'wiselink.v3_1.applicability_fleet.fleet_master_data.v1',
        ...fleetHead,
        assets: [],
        facts: [],
      },
    },
  };
}

export async function insertWorkItem(sql, projection) {
  await sql`
    INSERT INTO work_item (
      work_item_id, tenant_id, action_type, document_id, document_version_id,
      source_artifact_id, source_file_sha256, source_byte_length,
      normalized_family, request_id, status, revision, projection_json,
      package_id, package_artifact_ref, package_artifact_sha256,
      requested_by_user_id, run_key
    ) VALUES (
      ${projection.workItemId}, ${TENANT}, 'PARSE_PDF',
      ${projection.source.documentId}, ${projection.source.documentVersionId},
      'SOURCE-BATCH', ${'a'.repeat(64)}, 1, 'SB', ${projection.requestId},
      'CANDIDATE_READBACK_VERIFIED', ${projection.revision},
      ${JSON.stringify(projection)}, ${projection.package.packageId},
      ${projection.package.artifact.ref}, ${projection.package.artifact.sha256},
      ${ACTOR}, ${projection.workItemId}
    )
  `;
}

export function session(token, actor = ACTOR, tenant = TENANT) {
  return {
    headers: { cookie: `wl_session=${token}` },
    userContext: undefined,
    expectedIdentity: {
      subjectMappingId: `mapping:${actor}`,
      provenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
      miaodaUserId: actor,
      tenantId: tenant,
      feishuUserId: `feishu-user:${actor}`,
      feishuOpenId: `feishu-open:${actor}`,
      namespacedSubject: {
        namespace: 'FEISHU_OPEN_ID',
        subject: `feishu-open:${actor}`,
        tenantKey: `feishu-tenant:${tenant}`,
      },
      verifiedAt: '2026-08-30T08:00:00.000Z',
    },
  };
}

export function rawHash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hash(value) {
  return `sha256:${rawHash(value)}`;
}
