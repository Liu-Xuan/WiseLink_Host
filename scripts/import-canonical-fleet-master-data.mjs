#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const assetDirectory = path.resolve(
  repoRoot,
  option('--asset-directory') ||
    'config/fleet-master-data/ameco-fleet-20260605',
);
const tenantId = requiredOption('--tenant-id');
const actorId =
  option('--actor-id') || 'system:fleet-master-data-authority-migration';
const expectedCurrentSnapshotId =
  option('--expected-current-source-snapshot-id') || null;
const apply = process.argv.includes('--apply');
const manifest = readJson(path.join(assetDirectory, 'manifest.json'));
const assets = readNdjson(path.join(assetDirectory, manifest.files.assets));
const aliases = readNdjson(path.join(assetDirectory, manifest.files.aliases));
const facts = readNdjson(
  path.join(assetDirectory, manifest.files.configurationFacts),
);
const assetSqlRows = assets.map((row) => ({
  asset_id: row.assetId,
  asset_version_id: row.assetVersionId,
  aircraft_number: row.aircraftNumber,
  fleet_family: row.fleetFamily,
  aircraft_model: row.aircraftModel,
  series: row.series,
  msn: row.msn,
  line_number: row.lineNumber,
  delivery_date: row.deliveryDate,
  valid_from: row.validFrom,
  valid_to: row.validTo,
  status: row.status,
  source_record_id: row.sourceRecordId,
  record_hash: row.recordHash,
  source_record_hash: row.sourceRecordHash,
}));
const aliasSqlRows = aliases.map((row) => ({
  alias_version_id: row.aliasVersionId,
  alias_id: row.aliasId,
  asset_id: row.assetId,
  alias_type: row.aliasType,
  alias_value: row.aliasValue,
  status: row.status,
  record_hash: row.recordHash,
}));
const factSqlRows = facts.map((row) => ({
  fact_id: row.factId,
  fact_version_id: row.factVersionId,
  asset_id: row.assetId,
  fact_type: row.factType,
  property: row.property,
  qualifier: row.qualifier,
  value_json: row.valueJson,
  valid_as_of: row.validAsOf,
  status: row.status,
  source_record_id: row.sourceRecordId,
  record_hash: row.recordHash,
}));

assert.equal(
  manifest.schemaVersion,
  'wiselink.3_1.canonical_fleet_import_asset.v1',
);
assert.equal(manifest.runtimeReadsLegacySource, false);
assert.equal(manifest.aircraftConfigSnapshotsClaimed, false);
assert.equal(assets.length, manifest.counts.aircraftAssets);
assert.equal(aliases.length, manifest.counts.aircraftIdentityAliases);
assert.equal(facts.length, manifest.counts.configurationFacts);
assert.equal(
  facts.length,
  0,
  'this approved restoration contains no configuration facts',
);
assert.equal(new Set(assets.map((row) => row.assetId)).size, assets.length);
assert.equal(new Set(aliases.map((row) => row.aliasId)).size, aliases.length);
assert.equal(
  aliases.every((row) => assets.some((asset) => asset.assetId === row.assetId)),
  true,
);

const preview = {
  schemaVersion: 'wiselink.3_1.canonical_fleet_import_preview.v1',
  status: apply ? 'validated_ready_to_apply' : 'validated_preview_only',
  tenantId,
  sourceSnapshotId: manifest.sourceSnapshotId,
  sourceRevisionKey: manifest.sourceRevisionKey,
  sourceAsOf: manifest.sourceAsOf,
  counts: manifest.counts,
  runtimeReadsLegacySource: false,
  configurationFactsInvented: false,
};
if (!apply) {
  console.log(JSON.stringify(preview, null, 2));
  process.exit(0);
}

const databaseUrl = process.env.CANONICAL_FLEET_IMPORT_DATABASE_URL || '';
assert.ok(
  databaseUrl,
  '--apply requires CANONICAL_FLEET_IMPORT_DATABASE_URL; credentials are never accepted as CLI arguments',
);
const database = parsePostgresUrl(databaseUrl);
const result = spawnSync(
  process.env.PSQL_BIN || 'psql',
  [
    '-X',
    '-qAt',
    '-v',
    'ON_ERROR_STOP=1',
    '-h',
    database.host,
    '-p',
    String(database.port),
    '-U',
    database.username,
    '-d',
    database.database,
  ],
  {
    input: importSql(),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, PGPASSWORD: database.password },
  },
);
if (result.status !== 0) {
  const rawMessage = String(result.stderr || result.stdout || 'psql failed');
  const message = (
    database.password
      ? rawMessage.replaceAll(database.password, '[REDACTED]')
      : rawMessage
  ).trim();
  throw new Error(`CANONICAL_FLEET_IMPORT_FAILED: ${message}`);
}
const readback = JSON.parse(String(result.stdout).trim());
assert.deepEqual(readback.counts, manifest.counts);
assert.equal(readback.sourceSnapshotId, manifest.sourceSnapshotId);
console.log(
  JSON.stringify(
    {
      ...preview,
      status: readback.importStatus,
      authorityRevision: readback.authorityRevision,
      readback: readback.counts,
    },
    null,
    2,
  ),
);

function importSql() {
  const expectedHeadCheck = expectedCurrentSnapshotId
    ? `IF current_snapshot IS DISTINCT FROM ${literal(expectedCurrentSnapshotId)} THEN
         RAISE EXCEPTION 'CANONICAL_FLEET_IMPORT_HEAD_CONFLICT';
       END IF;`
    : `IF current_snapshot IS NOT NULL AND current_snapshot <> ${literal(manifest.sourceSnapshotId)} THEN
         RAISE EXCEPTION 'CANONICAL_FLEET_IMPORT_EXPECTED_HEAD_REQUIRED';
       END IF;`;
  return `BEGIN;
LOCK TABLE canonical_fleet_scope_head IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE canonical_fleet_import_state ON COMMIT DROP AS
SELECT EXISTS (
  SELECT 1 FROM canonical_fleet_scope_head
  WHERE tenant_id = ${literal(tenantId)}
    AND current_source_snapshot_id = ${literal(manifest.sourceSnapshotId)}
) AS idempotent_replay;

DO $$
DECLARE current_snapshot text;
BEGIN
  SELECT current_source_snapshot_id INTO current_snapshot
  FROM canonical_fleet_scope_head
  WHERE tenant_id = ${literal(tenantId)}
  FOR UPDATE;
  ${expectedHeadCheck}
END $$;

INSERT INTO canonical_fleet_source_snapshot(
  tenant_id, source_snapshot_id, source_kind, logical_source_key,
  source_revision_key, source_content_hash, source_as_of, snapshot_as_of,
  fleet_snapshot_digest, upstream_lineage_json, aircraft_asset_count,
  identity_alias_count, configuration_fact_count, imported_by_actor_id
) VALUES (
  ${literal(tenantId)}, ${literal(manifest.sourceSnapshotId)},
  ${literal(manifest.sourceKind)}, ${literal(manifest.logicalSourceKey)},
  ${literal(manifest.sourceRevisionKey)}, ${literal(manifest.sourceContentHash)},
  ${literal(manifest.sourceAsOf)}, ${literal(manifest.snapshotAsOf)}::timestamptz,
  ${literal(manifest.fleetSnapshotDigest)},
  ${literal(JSON.stringify(manifest.upstreamLineage))},
  ${manifest.counts.aircraftAssets}, ${manifest.counts.aircraftIdentityAliases},
  ${manifest.counts.configurationFacts}, ${literal(actorId)}
)
ON CONFLICT (tenant_id, source_snapshot_id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM canonical_fleet_source_snapshot
    WHERE tenant_id = ${literal(tenantId)}
      AND source_snapshot_id = ${literal(manifest.sourceSnapshotId)}
      AND source_revision_key = ${literal(manifest.sourceRevisionKey)}
      AND source_content_hash = ${literal(manifest.sourceContentHash)}
      AND fleet_snapshot_digest = ${literal(manifest.fleetSnapshotDigest)}
      AND aircraft_asset_count = ${manifest.counts.aircraftAssets}
      AND identity_alias_count = ${manifest.counts.aircraftIdentityAliases}
      AND configuration_fact_count = ${manifest.counts.configurationFacts}
  ) THEN RAISE EXCEPTION 'CANONICAL_FLEET_IMPORT_SOURCE_DRIFT'; END IF;
END $$;

CREATE TEMP TABLE canonical_fleet_asset_stage ON COMMIT DROP AS
SELECT * FROM jsonb_to_recordset(${json(assetSqlRows)}) AS row(
  asset_id text, asset_version_id text, aircraft_number text,
  fleet_family text, aircraft_model text, series text, msn text,
  line_number integer, delivery_date text, valid_from timestamptz,
  valid_to timestamptz, status text, source_record_id text,
  record_hash text, source_record_hash text
);
INSERT INTO canonical_fleet_asset_version(
  tenant_id, source_snapshot_id, asset_id, asset_version_id,
  aircraft_number, fleet_family, aircraft_model, series, msn, line_number,
  delivery_date, valid_from, valid_to, status, source_record_id,
  record_hash, source_record_hash
)
SELECT ${literal(tenantId)}, ${literal(manifest.sourceSnapshotId)},
  asset_id, asset_version_id, aircraft_number, fleet_family, aircraft_model,
  series, msn, line_number, delivery_date, valid_from, valid_to, status,
  source_record_id, record_hash, source_record_hash
FROM canonical_fleet_asset_stage
ON CONFLICT (tenant_id, asset_version_id) DO NOTHING;

CREATE TEMP TABLE canonical_fleet_alias_stage ON COMMIT DROP AS
SELECT * FROM jsonb_to_recordset(${json(aliasSqlRows)}) AS row(
  alias_version_id text, alias_id text, asset_id text, alias_type text,
  alias_value text, status text, record_hash text
);
INSERT INTO canonical_fleet_alias_version(
  tenant_id, source_snapshot_id, alias_version_id, alias_id, asset_id,
  alias_type, alias_value, status, record_hash
)
SELECT ${literal(tenantId)}, ${literal(manifest.sourceSnapshotId)},
  alias_version_id, alias_id, asset_id, alias_type, alias_value, status,
  record_hash
FROM canonical_fleet_alias_stage
ON CONFLICT (tenant_id, alias_version_id) DO NOTHING;

CREATE TEMP TABLE canonical_fleet_fact_stage ON COMMIT DROP AS
SELECT * FROM jsonb_to_recordset(${json(factSqlRows)}) AS row(
  fact_id text, fact_version_id text, asset_id text, fact_type text,
  property text, qualifier text, value_json text, valid_as_of text,
  status text, source_record_id text, record_hash text
);
INSERT INTO canonical_fleet_configuration_fact_version(
  tenant_id, source_snapshot_id, fact_id, fact_version_id, asset_id,
  fact_type, property, qualifier, value_json, valid_as_of, status,
  source_record_id, record_hash
)
SELECT ${literal(tenantId)}, ${literal(manifest.sourceSnapshotId)},
  fact_id, fact_version_id, asset_id, fact_type, property, qualifier,
  value_json, valid_as_of, status, source_record_id, record_hash
FROM canonical_fleet_fact_stage
ON CONFLICT (tenant_id, fact_version_id) DO NOTHING;

DO $$ BEGIN
  IF (SELECT count(*) FROM canonical_fleet_asset_version
      WHERE tenant_id = ${literal(tenantId)}
        AND source_snapshot_id = ${literal(manifest.sourceSnapshotId)}) <> ${manifest.counts.aircraftAssets}
    OR (SELECT count(*) FROM canonical_fleet_alias_version
      WHERE tenant_id = ${literal(tenantId)}
        AND source_snapshot_id = ${literal(manifest.sourceSnapshotId)}) <> ${manifest.counts.aircraftIdentityAliases}
    OR (SELECT count(*) FROM canonical_fleet_configuration_fact_version
      WHERE tenant_id = ${literal(tenantId)}
        AND source_snapshot_id = ${literal(manifest.sourceSnapshotId)}) <> ${manifest.counts.configurationFacts}
  THEN RAISE EXCEPTION 'CANONICAL_FLEET_IMPORT_COUNT_DRIFT'; END IF;
END $$;

INSERT INTO canonical_fleet_scope_head(
  tenant_id, current_source_snapshot_id, authority_revision
) VALUES (${literal(tenantId)}, ${literal(manifest.sourceSnapshotId)}, 1)
ON CONFLICT (tenant_id) DO UPDATE SET
  current_source_snapshot_id = EXCLUDED.current_source_snapshot_id,
  authority_revision = CASE
    WHEN canonical_fleet_scope_head.current_source_snapshot_id = EXCLUDED.current_source_snapshot_id
      THEN canonical_fleet_scope_head.authority_revision
    ELSE canonical_fleet_scope_head.authority_revision + 1
  END,
  updated_at = CURRENT_TIMESTAMP;

SELECT jsonb_build_object(
  'importStatus', CASE WHEN state.idempotent_replay THEN 'idempotent_replay' ELSE 'applied' END,
  'sourceSnapshotId', current_source_snapshot_id,
  'authorityRevision', authority_revision,
  'counts', jsonb_build_object(
    'aircraftAssets', (SELECT count(*)::int FROM canonical_fleet_asset_version
      WHERE tenant_id = ${literal(tenantId)} AND source_snapshot_id = current_source_snapshot_id),
    'aircraftIdentityAliases', (SELECT count(*)::int FROM canonical_fleet_alias_version
      WHERE tenant_id = ${literal(tenantId)} AND source_snapshot_id = current_source_snapshot_id),
    'configurationFacts', (SELECT count(*)::int FROM canonical_fleet_configuration_fact_version
      WHERE tenant_id = ${literal(tenantId)} AND source_snapshot_id = current_source_snapshot_id)
  )
)::text
FROM canonical_fleet_scope_head
JOIN canonical_fleet_import_state state ON true
WHERE tenant_id = ${literal(tenantId)};
COMMIT;`;
}

function parsePostgresUrl(value) {
  const parsed = new URL(value);
  assert.ok(['postgres:', 'postgresql:'].includes(parsed.protocol));
  assert.ok(parsed.hostname && parsed.username && parsed.pathname.slice(1));
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 5432),
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.slice(1)),
  };
}

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function readNdjson(filename) {
  return fs
    .readFileSync(filename, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function literal(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function json(value) {
  return `${literal(JSON.stringify(value))}::jsonb`;
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 &&
    process.argv[index + 1] &&
    !process.argv[index + 1].startsWith('--')
    ? process.argv[index + 1]
    : '';
}

function requiredOption(name) {
  const value = option(name);
  assert.ok(value, `${name} is required`);
  return value;
}
