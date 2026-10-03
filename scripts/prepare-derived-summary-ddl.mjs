import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const marker = /-- @derived-summary:legacy-boundaries:start[\s\S]*?-- @derived-summary:legacy-boundaries:end/u;
const originalPolicies = ['action_attempt_matter_subject_boundary', 'action_attempt_matter_or_document_subject_boundary'];
const scopeNames = ['authenticated', 'service_role', 'anon'];
const quote = value => `"${value.replaceAll('"', '""')}"`;

export function parseOfficialSchemaSnapshot(value) {
  if (value?.ok !== true || !Array.isArray(value.data) || value.data.length !== 1)
    throw new Error('DERIVED_SUMMARY_OFFICIAL_SCHEMA_SNAPSHOT_REQUIRED');
  const raw = value.data[0]?.schema_probe;
  const snapshot = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!snapshot || typeof snapshot.schema !== 'string' || !Array.isArray(snapshot.constraints) || !Array.isArray(snapshot.policies))
    throw new Error('DERIVED_SUMMARY_SCHEMA_PROBE_REQUIRED');
  return snapshot;
}

// Pure preparation consumes official read-only snapshots. It performs no SQL,
// remote calls or business writes. Generated top-level statements are the DDL
// supplied to the existing official dev/app-release migration consumer.
export function prepareDerivedSummaryDdl({ template, devSnapshot, onlineSnapshot }) {
  const dev = parseOfficialSchemaSnapshot(devSnapshot);
  const online = parseOfficialSchemaSnapshot(onlineSnapshot);
  if (dev.schema !== online.schema || !marker.test(template)) throw new Error('DERIVED_SUMMARY_PREPARATION_SCOPE_MISMATCH');
  const constraint = online.constraints.find(item => item.table === 'action_attempt' && item.name === 'ck_action_attempt_summary_subject')
    ?? online.constraints.find(item => item.table === 'action_attempt' && item.name === 'ck_action_attempt_subject');
  const check = constraint?.definition?.match(/^CHECK\s*\(([\s\S]*)\)$/u)?.[1];
  if (!check) throw new Error('DERIVED_SUMMARY_LEGACY_SUBJECT_CHECK_REQUIRED');
  const candidates = online.policies.filter(item => item.table === 'action_attempt' &&
    (originalPolicies.includes(item.name) || originalPolicies.some(name => item.name === `${name}_summary`)
      || item.name.startsWith('action_attempt_summary_legacy_')));
  if (!candidates.length) throw new Error('DERIVED_SUMMARY_LEGACY_SUBJECT_POLICY_REQUIRED');
  const policies = [];
  for (const item of candidates) {
    if (!item.restrictive || item.command !== '*' || typeof item.using !== 'string' || !Array.isArray(item.roles) || !item.roles.length)
      throw new Error('DERIVED_SUMMARY_LEGACY_POLICY_SHAPE_UNSUPPORTED');
    const scopes = item.roles.map(role => scopeNames.find(scope => role === `${scope}_${online.schema}`));
    if (scopes.some(scope => !scope)) throw new Error('DERIVED_SUMMARY_LEGACY_POLICY_ROLE_UNSUPPORTED');
    const prior = policies.find(policy => policy.using === item.using && policy.check === (item.check ?? item.using));
    if (prior) prior.scopes.push(...scopes);
    else policies.push({ using: item.using, check: item.check ?? item.using, scopes: [...scopes] });
  }
  // Multiple unrelated restrictions cannot be flattened into one OR branch.
  // Preserve their independent AND composition with separately named policies.
  const added = "(subject_kind = 'DERIVED_SUMMARY' AND derived_summary_attempt_owned(tenant_id,actor_user_id,summary_id))";
  const subject = check.includes('DERIVED_SUMMARY') ? check : `(${check}) OR (subject_kind='DERIVED_SUMMARY' AND work_item_id IS NULL AND matter_id IS NULL AND matter_revision_id IS NULL AND document_version_id IS NULL AND summary_id IS NOT NULL AND action_type='OPENCLAW_DERIVED_SUMMARY' AND input_revision IS NOT NULL AND base_revision IS NOT NULL)`;
  const statements = [
    '-- Prepared from official dev/online metadata; every legacy expression is retained verbatim.',
    'ALTER TABLE action_attempt DROP CONSTRAINT IF EXISTS ck_action_attempt_subject;',
    'ALTER TABLE action_attempt DROP CONSTRAINT IF EXISTS ck_action_attempt_summary_subject;',
    `ALTER TABLE action_attempt ADD CONSTRAINT ck_action_attempt_summary_subject CHECK (${subject});`,
  ];
  const names = new Set([...originalPolicies, ...originalPolicies.map(name => `${name}_summary`), ...candidates.map(item => item.name)]);
  for (const name of names) statements.push(`DROP POLICY IF EXISTS ${quote(name)} ON action_attempt;`);
  for (const [index, item] of policies.entries()) {
    for (const scope of [...new Set(item.scopes)]) {
      const name = `action_attempt_summary_legacy_${policies.length > 1 ? `${index + 1}_` : ''}${scope}`;
      const using = item.using.includes('DERIVED_SUMMARY') ? item.using : `(${item.using}) OR ${added}`;
      const checks = item.check.includes('DERIVED_SUMMARY') ? item.check : `(${item.check}) OR ${added}`;
      statements.push(`DROP POLICY IF EXISTS ${quote(name)} ON action_attempt;`);
      statements.push(`CREATE POLICY ${quote(name)} ON action_attempt AS RESTRICTIVE FOR ALL TO ${scope}\n  USING (${using}) WITH CHECK (${checks});`);
    }
  }
  return template.replace(marker, statements.join('\n'));
}

async function main() {
  const args = process.argv.slice(2);
  const options = Object.fromEntries(args.reduce((entries, flag, index) => index % 2 ? entries : [...entries, [flag, args[index + 1]]], []));
  if (args.length !== 6 || !options['--dev-snapshot'] || !options['--online-snapshot'] || !options['--output'])
    throw new Error('Usage: node scripts/prepare-derived-summary-ddl.mjs --dev-snapshot <official.json> --online-snapshot <official.json> --output <prepared.sql>');
  const template = await readFile(new URL('../server/database/derived-summary.ddl.sql', import.meta.url), 'utf8');
  const [dev, online] = await Promise.all([options['--dev-snapshot'], options['--online-snapshot']].map(async file => JSON.parse(await readFile(file, 'utf8'))));
  const output = prepareDerivedSummaryDdl({ template, devSnapshot: dev, onlineSnapshot: online });
  await writeFile(options['--output'], output, { flag: 'wx' });
  process.stdout.write(`Prepared ${options['--output']} from official schema snapshots. No database statements executed.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
