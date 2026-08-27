#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CANONICAL_ASSET_FIELDS = [
  'assetId',
  'fleetId',
  'fleetFamily',
  'aircraftModel',
  'series',
  'msn',
  'tailNumber',
  'operatorCode',
  'managingUnit',
  'lineNumber',
  'ipcNumber',
  'customerNumber',
  'structureNumber',
  'selcalCode',
  'deliveryDate',
  'acquisitionMode',
  'engineType',
  'engineSerialNumber',
  'apuType',
  'apuSerialNumber',
  'seatConfig',
  'replacementInfo',
  'notes',
  'specialOpsCapabilities',
  'sourceRef',
  'sourceFields',
  'status',
  'validFrom',
  'validTo',
  'leaseExpiry',
];

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const contractPath = requiredOption('--contract');
const sourcePath = requiredOption('--source');
const outputDirectory = path.resolve(
  repoRoot,
  option('--output') || 'config/fleet-master-data/ameco-fleet-20260605',
);
const contract = readJson(contractPath);

assert.equal(
  contract.schemaVersion,
  'wiselink.0_10.fleet_master_data_authority_migration_contract.v1',
);
assert.equal(
  contract.status,
  'approved_for_one_time_existing_authority_restoration',
);
assert.equal(contract.migration.rawExportProductRuntimeAuthorityAllowed, false);
assert.equal(contract.migration.workbookProductRuntimeAuthorityAllowed, false);
assert.equal(contract.migration.fallbackAllowed, false);
assert.equal(contract.migration.silentFailureAllowed, false);

const sourceBytes = fs.readFileSync(path.resolve(sourcePath));
const sourceHash = `sha256:${sha256(sourceBytes)}`;
assert.equal(sourceHash, contract.source.sourceContentHash);
const source = JSON.parse(sourceBytes.toString('utf8'));
assert.equal(
  source.aircraftAssets.length,
  contract.source.expectedAircraftAssetCount,
);
assert.equal(
  source.aircraftIdentityAliases.length,
  contract.source.expectedIdentityAliasCount,
);
assert.deepEqual(
  source.aircraftConfigSnapshots,
  [],
  'the approved source has no AircraftConfigSnapshot; facts must remain empty',
);
assert.equal(
  source.aircraftAssets.every(
    (asset) =>
      asset.sourceRef === contract.source.upstreamLineage.workbook.sourceRef,
  ),
  true,
);

const scope = canonical(contract.scope);
const sourceSnapshotId = `FMS-${sha256(
  stableJson({
    ...scope,
    logicalSourceKey: contract.source.logicalSourceKey,
    sourceRevisionKey: contract.source.sourceRevisionKey,
    sourceContentHash: sourceHash,
  }),
)}`;
const assets = source.aircraftAssets
  .map((raw) => normalizeAsset(raw, sourceSnapshotId))
  .sort((left, right) => left.assetId.localeCompare(right.assetId));
const assetIds = new Set(assets.map((asset) => asset.assetId));
assert.equal(
  assetIds.size,
  assets.length,
  'aircraft asset identities must be unique',
);
const aliases = source.aircraftIdentityAliases
  .map((raw) => normalizeAlias(raw, sourceSnapshotId))
  .sort((left, right) =>
    left.aliasVersionId.localeCompare(right.aliasVersionId),
  );
assert.equal(
  aliases.every((alias) => assetIds.has(alias.assetId)),
  true,
  'aliases must reference a migrated asset',
);
assert.equal(
  new Set(aliases.map((alias) => alias.aliasId)).size,
  aliases.length,
  'alias identities must be unique',
);
const fleetSnapshotDigest = sha256(
  stableJson({
    sourceSnapshotId,
    assets: assets.map(({ assetId, recordHash }) => ({ assetId, recordHash })),
    aliases: aliases.map(
      ({ aliasId: legacyAliasId, recordHash: aliasRecordHash }) => ({
        legacyAliasId,
        aliasRecordHash,
      }),
    ),
  }),
);
const manifest = {
  schemaVersion: 'wiselink.3_1.canonical_fleet_import_asset.v1',
  migrationSourceSchemaVersion: contract.schemaVersion,
  sourceSnapshotId,
  sourceKind: contract.source.sourceKind,
  logicalSourceKey: contract.source.logicalSourceKey,
  sourceRevisionKey: contract.source.sourceRevisionKey,
  sourceContentHash: sourceHash,
  sourceAsOf: contract.source.snapshotAsOf.slice(0, 10),
  snapshotAsOf: contract.source.snapshotAsOf,
  fleetSnapshotDigest,
  sourceScope: scope,
  upstreamLineage: canonical(contract.source.upstreamLineage),
  counts: {
    aircraftAssets: assets.length,
    aircraftIdentityAliases: aliases.length,
    configurationFacts: 0,
  },
  files: {
    assets: 'assets.ndjson',
    aliases: 'aliases.ndjson',
    configurationFacts: 'configuration-facts.ndjson',
  },
  runtimeReadsLegacySource: false,
  aircraftConfigSnapshotsClaimed: false,
};

fs.mkdirSync(outputDirectory, { recursive: true });
writeJson(path.join(outputDirectory, 'manifest.json'), manifest);
writeNdjson(path.join(outputDirectory, manifest.files.assets), assets);
writeNdjson(path.join(outputDirectory, manifest.files.aliases), aliases);
writeNdjson(path.join(outputDirectory, manifest.files.configurationFacts), []);

for (const filename of Object.values(manifest.files)) {
  const target = path.join(outputDirectory, filename);
  assert.ok(
    fs.statSync(target).size <= 1024 * 1024,
    `${filename} exceeds 1 MiB`,
  );
  const lineCount = fs
    .readFileSync(target, 'utf8')
    .split('\n')
    .filter(Boolean).length;
  assert.ok(lineCount <= 5000, `${filename} exceeds 5000 lines`);
}

console.log(
  JSON.stringify(
    {
      status: 'generated',
      outputDirectory,
      sourceSnapshotId,
      fleetSnapshotDigest,
      counts: manifest.counts,
    },
    null,
    2,
  ),
);

function normalizeAsset(raw, snapshotId) {
  const legacy = canonical(raw);
  const canonicalRecord = Object.fromEntries(
    CANONICAL_ASSET_FIELDS.map((key) => [key, canonicalValue(legacy[key])]),
  );
  const assetId = requiredText(canonicalRecord.assetId, 'assetId');
  assert.match(assetId, /^AIRCRAFT:MODEL_MSN:.+$/u);
  requiredText(canonicalRecord.aircraftModel, 'aircraftModel');
  requiredText(canonicalRecord.msn, 'msn');
  const aircraftNumber = requiredText(canonicalRecord.tailNumber, 'tailNumber');
  const status = requiredText(canonicalRecord.status, 'status').toLowerCase();
  assert.ok(['active', 'inactive'].includes(status));
  const validFrom = normalizeInstant(canonicalRecord.validFrom);
  const validTo = canonicalRecord.validTo
    ? normalizeInstant(canonicalRecord.validTo)
    : null;
  const recordHash = `sha256:${sha256(stableJson(canonicalRecord))}`;
  const sourceRecordHash = `sha256:${sha256(stableJson(legacy))}`;
  const assetVersionId = `AAV-${sha256(
    stableJson({ assetId, sourceSnapshotId: snapshotId, recordHash }),
  )}`;
  return {
    assetId,
    assetVersionId,
    aircraftNumber,
    fleetFamily: nullableText(canonicalRecord.fleetFamily),
    aircraftModel: nullableText(canonicalRecord.aircraftModel),
    series: nullableText(canonicalRecord.series),
    msn: nullableText(canonicalRecord.msn),
    lineNumber: nullableInteger(canonicalRecord.lineNumber),
    deliveryDate: nullableDate(canonicalRecord.deliveryDate),
    validFrom,
    validTo,
    status: status.toUpperCase(),
    sourceRecordId: assetId,
    recordHash,
    sourceRecordHash,
  };
}

function normalizeAlias(raw, snapshotId) {
  const source = canonical(raw);
  const aliasId = requiredText(source.aliasId, 'aliasId');
  const assetId = requiredText(source.assetId, 'assetId');
  const aliasType = requiredText(source.aliasType, 'aliasType');
  const aliasValue = requiredText(source.aliasValue, 'aliasValue');
  const status = requiredText(source.status, 'status').toLowerCase();
  assert.ok(['active', 'inactive'].includes(status));
  const aliasCore = {
    legacyAliasId: aliasId,
    assetId,
    aliasType,
    aliasValue,
    status,
  };
  return {
    aliasVersionId: `AIAV-${sha256(
      stableJson({ sourceSnapshotId: snapshotId, ...aliasCore }),
    )}`,
    aliasId,
    assetId,
    aliasType,
    aliasValue,
    status: status.toUpperCase(),
    recordHash: `sha256:${sha256(stableJson(aliasCore))}`,
  };
}

function canonicalValue(value) {
  if (value === undefined) return null;
  if (typeof value === 'string') return value.normalize('NFC').trim();
  return canonical(value);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  if (typeof value === 'string') return value.normalize('NFC').trim();
  return value === undefined ? null : value;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function nullableText(value) {
  const normalized =
    value === null || value === undefined ? '' : String(value).trim();
  return normalized || null;
}

function nullableInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  assert.ok(Number.isSafeInteger(number), `invalid integer: ${String(value)}`);
  return number;
}

function nullableDate(value) {
  if (!value) return null;
  return normalizeInstant(value).slice(0, 10);
}

function normalizeInstant(value) {
  const timestamp = Date.parse(String(value));
  assert.ok(Number.isFinite(timestamp), `invalid instant: ${String(value)}`);
  return new Date(timestamp).toISOString();
}

function requiredText(value, label) {
  const normalized =
    value === null || value === undefined ? '' : String(value).trim();
  assert.ok(normalized, `${label} is required`);
  return normalized;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
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
  return path.resolve(value);
}

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function writeJson(filename, value) {
  fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`);
}

function writeNdjson(filename, rows) {
  fs.writeFileSync(
    filename,
    rows.map((row) => JSON.stringify(row)).join('\n') +
      (rows.length ? '\n' : ''),
  );
}
