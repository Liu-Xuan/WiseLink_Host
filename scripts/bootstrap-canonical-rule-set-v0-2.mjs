#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const rulePackPath = path.resolve(
  repoRoot,
  'server/runtime-assets/assessment-host/job-aid/rule-pack-0.2.json',
);
const expected = Object.freeze({
  rulePackVersion: '0.2',
  criteriaCount: 150,
  snapshotId: 'JACS-72D0484B6F1C17A38F671F46',
  criterionSetHash:
    'sha256:72d0484b6f1c17a38f671f465abe87ddb5cf93f49f64442ea9623cd251346061',
  memberIdentityHash:
    'sha256:dd794f498068e925e706089641a5809c6f831991b9c5b00a7b3777a2dd68a95c',
  canonicalCriteriaHash:
    'sha256:29a085166e2f08391b6f057a9e6dbb881800bd087cef9c359ea3a6f93ebc03cd',
  artifactRef: 'feishu-drive://file/Q3eVb8SGFovADCxSdH6cWDKCnme',
  artifactDigest:
    'sha256:32eb18d165dbd54eab4df7fcbe7543e5cdc63d8fb10614244ad9ddaef4b5d15e',
  artifactVersion: '7672126854932728804',
});

const apply = process.argv.includes('--apply');
const ownerMapPath = requiredOption('--owner-map');
const databaseUrl =
  process.env.CANONICAL_RULE_SET_BOOTSTRAP_DATABASE_URL?.trim() || '';
const requiredRoleId =
  process.env.WL_CANONICAL_RULE_SET_ENGINEERING_OWNER_ROLE_ID?.trim() || '';

assert.ok(
  databaseUrl,
  'CANONICAL_RULE_SET_BOOTSTRAP_DATABASE_URL is required; credentials are never accepted as CLI arguments',
);
assert.ok(
  requiredRoleId,
  'WL_CANONICAL_RULE_SET_ENGINEERING_OWNER_ROLE_ID is required',
);
assert.notEqual(
  requiredRoleId,
  'wiselink_development',
  'WL_CANONICAL_RULE_SET_ENGINEERING_OWNER_ROLE_ID must be a dedicated role',
);
assert.ok(requiredRoleId.length <= 96, 'engineering-owner role ID is too long');

const rulePackJson = fs.readFileSync(rulePackPath, 'utf8');
const rulePack = JSON.parse(rulePackJson);
assert.equal(
  `sha256:${createHash('sha256').update(rulePackJson).digest('hex')}`,
  expected.artifactDigest,
  'legacy v0.2 rule-pack bytes changed',
);
assert.equal(rulePack.package_meta?.schema_version, expected.rulePackVersion);
assert.equal(rulePack.package_meta?.criteria_count, expected.criteriaCount);
assert.equal(rulePack.criteria?.length, expected.criteriaCount);

const database = parsePostgresUrl(databaseUrl);
const tenants = JSON.parse(runPsql(database, discoverTenantsSql()));
assert.ok(Array.isArray(tenants) && tenants.length > 0, 'NO_EXISTING_TENANTS');
const ownerMap = readOwnerMap(ownerMapPath);
const tenantIds = tenants.map((row) => row.tenantId);
assert.deepEqual(
  [...Object.keys(ownerMap.tenants)].sort(),
  [...tenantIds].sort(),
  'owner map must cover exactly every discovered tenant',
);
const owners = tenantIds.map((tenantId) => {
  const owner = ownerMap.tenants[tenantId];
  assert.ok(owner && typeof owner === 'object', `owner missing: ${tenantId}`);
  const engineeringOwnerUserId = requiredText(
    owner.engineeringOwnerUserId,
    `engineering owner user ID missing: ${tenantId}`,
    255,
  );
  return { tenantId, engineeringOwnerUserId };
});

const preview = {
  schemaVersion: 'wiselink.3_1.canonical_rule_set_v0_2_bootstrap.v1',
  status: apply ? 'validated_ready_to_apply' : 'validated_preview_only',
  requiredRoleId,
  snapshotId: expected.snapshotId,
  artifactDigest: expected.artifactDigest,
  criteriaCount: expected.criteriaCount,
  tenants: owners.map(({ tenantId }) => tenantId),
  tenantCount: owners.length,
};

if (!apply) {
  console.log(JSON.stringify(preview, null, 2));
  process.exit(0);
}

const readback = JSON.parse(
  runPsql(database, bootstrapSql({ owners, requiredRoleId, rulePackJson })),
);
assert.equal(readback.snapshotId, expected.snapshotId);
assert.equal(readback.tenantCount, owners.length);
assert.equal(readback.activeHeads.length, owners.length);
for (const head of readback.activeHeads) {
  assert.equal(head.activeSnapshotId, expected.snapshotId);
  assert.ok(Number.isSafeInteger(head.headRevision) && head.headRevision > 0);
  assert.equal(head.requiredRoleId, requiredRoleId);
  assert.equal(
    head.engineeringOwnerUserId,
    owners.find(({ tenantId }) => tenantId === head.tenantId)
      ?.engineeringOwnerUserId,
  );
}
console.log(JSON.stringify({ ...preview, ...readback }, null, 2));

function discoverTenantsSql() {
  return `SELECT COALESCE(jsonb_agg(jsonb_build_object('tenantId', tenant_id)
    ORDER BY tenant_id), '[]'::jsonb)::text
FROM (
  SELECT tenant_id FROM work_item
  UNION
  SELECT miaoda_tenant_id AS tenant_id
  FROM identity_subject_mapping WHERE status = 'ACTIVE'
  UNION
  SELECT tenant_id FROM canonical_rule_set_snapshot
) tenants
WHERE tenant_id IS NOT NULL AND btrim(tenant_id) <> '';`;
}

function bootstrapSql(input) {
  const ownerRows = JSON.stringify(
    input.owners.map((owner) => ({
      tenant_id: owner.tenantId,
      engineering_owner_user_id: owner.engineeringOwnerUserId,
    })),
  );
  return `BEGIN;
LOCK TABLE work_item IN SHARE MODE;
LOCK TABLE identity_subject_mapping IN SHARE MODE;
LOCK TABLE canonical_rule_set_snapshot IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE canonical_rule_set_activation IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE rule_set_bootstrap_owner_stage ON COMMIT DROP AS
SELECT * FROM jsonb_to_recordset(${json(ownerRows)}) AS owner(
  tenant_id varchar(128), engineering_owner_user_id varchar(255)
);

DO $$
BEGIN
  IF EXISTS (
    SELECT tenant_id FROM (
      SELECT tenant_id FROM work_item
      UNION
      SELECT miaoda_tenant_id FROM identity_subject_mapping WHERE status = 'ACTIVE'
      UNION
      SELECT tenant_id FROM canonical_rule_set_snapshot
    ) current_tenants
    WHERE tenant_id IS NOT NULL AND btrim(tenant_id) <> ''
    EXCEPT SELECT tenant_id FROM rule_set_bootstrap_owner_stage
  ) OR EXISTS (
    SELECT tenant_id FROM rule_set_bootstrap_owner_stage
    EXCEPT
    SELECT tenant_id FROM (
      SELECT tenant_id FROM work_item
      UNION
      SELECT miaoda_tenant_id AS tenant_id
      FROM identity_subject_mapping WHERE status = 'ACTIVE'
      UNION
      SELECT tenant_id FROM canonical_rule_set_snapshot
    ) current_tenants
    WHERE tenant_id IS NOT NULL AND btrim(tenant_id) <> ''
  ) THEN
    RAISE EXCEPTION 'RULE_SET_BOOTSTRAP_TENANT_SET_CHANGED';
  END IF;
END $$;

CREATE TEMP TABLE rule_set_bootstrap_state ON COMMIT DROP AS
SELECT owner.tenant_id,
  EXISTS (
    SELECT 1 FROM canonical_rule_set_activation activation
    WHERE activation.tenant_id = owner.tenant_id
      AND activation.rule_set_key = 'JOB_AID'
  ) AS had_activation
FROM rule_set_bootstrap_owner_stage owner;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM rule_set_bootstrap_owner_stage owner
    JOIN LATERAL (
      SELECT active_criterion_set_id, required_role_id,
        engineering_owner_user_id
      FROM canonical_rule_set_activation activation
      WHERE activation.tenant_id = owner.tenant_id
        AND activation.rule_set_key = 'JOB_AID'
      ORDER BY activation_revision DESC
      LIMIT 1
    ) current ON true
    WHERE current.active_criterion_set_id <> ${literal(expected.snapshotId)}
      OR current.required_role_id <> ${literal(input.requiredRoleId)}
      OR current.engineering_owner_user_id <>
        owner.engineering_owner_user_id
  ) THEN
    RAISE EXCEPTION 'RULE_SET_BOOTSTRAP_ACTIVE_HEAD_CONFLICT';
  END IF;
END $$;

INSERT INTO canonical_rule_set_snapshot(
  tenant_id, rule_set_key, criterion_set_id, criterion_set_hash,
  member_identity_hash, criteria_count, rule_pack_version, rule_pack_json,
  artifact_ref, artifact_digest, artifact_version, canonical_criteria_hash,
  source_job_aid_document_version_id, source_job_aid_version_status,
  created_by_engineering_owner_user_id
)
SELECT owner.tenant_id, 'JOB_AID', ${literal(expected.snapshotId)},
  ${literal(expected.criterionSetHash)}, ${literal(expected.memberIdentityHash)},
  ${expected.criteriaCount}, ${literal(expected.rulePackVersion)},
  ${literal(input.rulePackJson)}, ${literal(expected.artifactRef)},
  ${literal(expected.artifactDigest)}, ${literal(expected.artifactVersion)},
  ${literal(expected.canonicalCriteriaHash)}, NULL, 'VERSION_UNCONFIRMED',
  owner.engineering_owner_user_id
FROM rule_set_bootstrap_owner_stage owner
ON CONFLICT (tenant_id, rule_set_key, criterion_set_id) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM rule_set_bootstrap_owner_stage owner
    LEFT JOIN canonical_rule_set_snapshot snapshot
      ON snapshot.tenant_id = owner.tenant_id
      AND snapshot.rule_set_key = 'JOB_AID'
      AND snapshot.criterion_set_id = ${literal(expected.snapshotId)}
    WHERE snapshot.criterion_set_id IS NULL
      OR snapshot.criterion_set_hash <> ${literal(expected.criterionSetHash)}
      OR snapshot.member_identity_hash <> ${literal(expected.memberIdentityHash)}
      OR snapshot.criteria_count <> ${expected.criteriaCount}
      OR snapshot.rule_pack_version <> ${literal(expected.rulePackVersion)}
      OR snapshot.rule_pack_json <> ${literal(input.rulePackJson)}
      OR snapshot.artifact_ref <> ${literal(expected.artifactRef)}
      OR snapshot.artifact_digest <> ${literal(expected.artifactDigest)}
      OR snapshot.artifact_version <> ${literal(expected.artifactVersion)}
      OR snapshot.canonical_criteria_hash <> ${literal(expected.canonicalCriteriaHash)}
      OR snapshot.source_job_aid_document_version_id IS NOT NULL
      OR snapshot.source_job_aid_version_status <> 'VERSION_UNCONFIRMED'
      OR snapshot.created_by_engineering_owner_user_id <>
        owner.engineering_owner_user_id
  ) THEN
    RAISE EXCEPTION 'RULE_SET_BOOTSTRAP_SNAPSHOT_READBACK_MISMATCH';
  END IF;
END $$;

INSERT INTO canonical_rule_set_activation(
  tenant_id, rule_set_key, activation_revision, expected_revision, action,
  from_criterion_set_id, active_criterion_set_id,
  engineering_owner_user_id, required_role_id, reason
)
SELECT owner.tenant_id, 'JOB_AID', 1, 0, 'PROMOTE', NULL,
  ${literal(expected.snapshotId)}, owner.engineering_owner_user_id,
  ${literal(input.requiredRoleId)},
  'Bootstrap the exact legacy v0.2 150-rule runtime before lifecycle rollout.'
FROM rule_set_bootstrap_owner_stage owner
WHERE NOT EXISTS (
  SELECT 1 FROM canonical_rule_set_activation activation
  WHERE activation.tenant_id = owner.tenant_id
    AND activation.rule_set_key = 'JOB_AID'
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM rule_set_bootstrap_owner_stage owner
    LEFT JOIN LATERAL (
      SELECT active_criterion_set_id
      FROM canonical_rule_set_activation activation
      WHERE activation.tenant_id = owner.tenant_id
        AND activation.rule_set_key = 'JOB_AID'
      ORDER BY activation_revision DESC LIMIT 1
    ) current ON true
    WHERE current.active_criterion_set_id IS DISTINCT FROM ${literal(expected.snapshotId)}
  ) THEN
    RAISE EXCEPTION 'RULE_SET_BOOTSTRAP_ACTIVE_HEAD_READBACK_MISMATCH';
  END IF;
END $$;

SELECT jsonb_build_object(
  'status', CASE
    WHEN bool_and(state.had_activation) THEN 'idempotent_replay'
    WHEN bool_or(state.had_activation) THEN 'applied_and_replayed'
    ELSE 'applied'
  END,
  'snapshotId', ${literal(expected.snapshotId)},
  'tenantCount', count(*)::int,
  'activeHeads', jsonb_agg(jsonb_build_object(
    'tenantId', owner.tenant_id,
    'activeSnapshotId', current.active_criterion_set_id,
    'headRevision', current.activation_revision,
    'engineeringOwnerUserId', current.engineering_owner_user_id,
    'requiredRoleId', current.required_role_id
  ) ORDER BY owner.tenant_id)
)::text
FROM rule_set_bootstrap_owner_stage owner
JOIN rule_set_bootstrap_state state USING (tenant_id)
JOIN LATERAL (
  SELECT active_criterion_set_id, activation_revision,
    engineering_owner_user_id, required_role_id
  FROM canonical_rule_set_activation activation
  WHERE activation.tenant_id = owner.tenant_id
    AND activation.rule_set_key = 'JOB_AID'
  ORDER BY activation_revision DESC LIMIT 1
) current ON true;
COMMIT;`;
}

function runPsql(database, sql) {
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
      input: sql,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, PGPASSWORD: database.password },
    },
  );
  if (result.status !== 0) {
    const raw = String(result.stderr || result.stdout || 'psql failed');
    const redacted = database.password
      ? raw.replaceAll(database.password, '[REDACTED]')
      : raw;
    throw new Error(`CANONICAL_RULE_SET_BOOTSTRAP_FAILED: ${redacted.trim()}`);
  }
  return String(result.stdout).trim();
}

function readOwnerMap(filename) {
  const value = JSON.parse(fs.readFileSync(path.resolve(filename), 'utf8'));
  assert.equal(
    value.schemaVersion,
    'wiselink.3_1.rule_set_bootstrap_owner_map.v1',
  );
  assert.ok(value.tenants && typeof value.tenants === 'object');
  return value;
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

function literal(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function json(value) {
  return `${literal(value)}::jsonb`;
}

function requiredText(value, message, maxLength) {
  assert.equal(typeof value, 'string', message);
  assert.equal(value.trim(), value, message);
  assert.ok(value.length > 0 && value.length <= maxLength, message);
  return value;
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
