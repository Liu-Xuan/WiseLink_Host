import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SCHEMA = 'workspace_aadkpkjef3slu';
const AUTH = `authenticated_${SCHEMA}`;
const SERVICE = `service_role_${SCHEMA}`;
const ANON = `anon_${SCHEMA}`;
const marker = /-- @native-tenant-read:prepared-policies:start[\s\S]*?-- @native-tenant-read:prepared-policies:end/u;
const ident = value => `"${value.replaceAll('"', '""')}"`;

// Only tables consumed by the shared library, work and evidence readers.
// Identity, service-control and source-authorization tables are excluded.
const directTenantTables = new Set([
  'work_item', 'action_attempt', 'engineering_matter',
  'engineering_matter_revision', 'engineering_matter_revision_work_item',
  'engineering_matter_material_link', 'engineering_matter_work_revision',
  'assessment_work_revision', 'engineer_supplied_input',
  'review_conversation', 'review_turn',
  'dm_document_parse_run', 'dm_document_semantic_revision',
  'dm_document_reading_run', 'dm_document_reading_retraction',
  'dm_document_activity_run', 'translation_workspace',
  'translation_block_revision', 'derived_summary', 'derived_summary_revision',
  'hierarchical_wiki_scope', 'hierarchical_wiki_membership',
  'hierarchical_wiki_change', 'engineering_search_projection',
  'engineering_search_projection_pending',
  'canonical_fleet_source_snapshot', 'canonical_fleet_scope_head',
  'canonical_fleet_asset_version', 'canonical_fleet_alias_version',
  'canonical_fleet_configuration_fact_version',
  'configuration_evidence_event_version',
  'configuration_evidence_fact_version',
  'configuration_evidence_predicate_trace_version',
  'configuration_evidence_query_attempt',
  'configuration_evidence_snapshot_version',
  'configuration_evidence_trace_staleness',
  'configuration_evidence_work_item_head',
  'batch_applicability_run', 'batch_applicability_confirmation',
  'canonical_model_setting', 'canonical_rule_set_snapshot',
  'canonical_rule_set_activation',
  'dialogue_thread', 'dialogue_message', 'discussion_contribution',
  'dialogue_assessment_request', 'review_aily_query',
  'translation_knowledge_candidate',
  'translation_knowledge_governance_event',
  'translation_knowledge_import_request_item',
  'translation_knowledge_source_ref',
]);

const related = (kind, id) =>
  `native_app_dm_related_readable('63849986','${kind}',${id})`;
const tenantless = {
  dm_publication_family: alias => related('FAMILY', `${alias}.family_id`),
  dm_document: alias => related('DOCUMENT', `${alias}.document_id`),
  dm_document_version: alias =>
    `native_app_document_readable('63849986',${alias}.document_version_id)`,
  dm_document_version_metadata: alias =>
    `native_app_document_readable('63849986',${alias}.document_version_id)`,
  dm_currentness_decision: alias => related('FAMILY', `${alias}.family_id`),
  dm_acquisition: alias => related('ACQUISITION', `${alias}.acquisition_id`),
  dm_ingress_preflight: alias => related('ACQUISITION', `${alias}.acquisition_id`),
  dm_source_artifact: alias => related('ARTIFACT', `${alias}.source_artifact_id`),
};
export const nativeSharedReadTables = new Set([
  ...directTenantTables, ...Object.keys(tenantless),
]);

function expectSnapshot(snapshot) {
  if (snapshot?.ok !== true || !Array.isArray(snapshot.data) ||
    snapshot.data.some(p => p.schemaname !== SCHEMA ||
      typeof p.tablename !== 'string' || typeof p.policyname !== 'string' ||
      !['ALL', 'SELECT', 'INSERT', 'UPDATE', 'DELETE'].includes(p.cmd) ||
      !['PERMISSIVE', 'RESTRICTIVE'].includes(p.permissive) ||
      typeof p.roles !== 'string')) {
    throw new Error('NATIVE_READ_OFFICIAL_POLICY_SNAPSHOT_REQUIRED');
  }
  return snapshot.data;
}

function roleNames(raw) {
  const names = raw.replace(/^\{|\}$/gu, '').split(',');
  if (names.some(name => ![AUTH, SERVICE, ANON].includes(name)))
    throw new Error(`NATIVE_READ_UNEXPECTED_POLICY_ROLE:${raw}`);
  return names;
}

function roleSql(name) {
  return ident(name);
}

function createPolicy({ name, table, command, roles, using, check }) {
  const expressions = command === 'INSERT'
    ? ` WITH CHECK (${check})`
    : command === 'DELETE' || command === 'SELECT'
      ? ` USING (${using})`
      : ` USING (${using}) WITH CHECK (${check})`;
  return `CREATE POLICY ${ident(name)} ON ${ident(table)} AS RESTRICTIVE
    FOR ${command} TO ${roles.map(roleSql).join(', ')}${expressions};`;
}

function sharedPredicate(table) {
  if (table === 'dialogue_thread' || table === 'dialogue_message')
    return `native_app_shared_read_allowed(tenant_id)
      AND actor_id=current_setting('app.user_id',true)`;
  if (table === 'discussion_contribution' ||
    table === 'dialogue_assessment_request')
    return `native_app_shared_read_allowed(tenant_id)
      AND actor_id=current_setting('app.user_id',true)
      AND EXISTS (SELECT 1 FROM work_item w
        WHERE w.tenant_id=${ident(table)}.tenant_id
          AND w.work_item_id=${ident(table)}.work_item_id)`;
  if (table === 'review_aily_query') return `native_app_shared_read_allowed(tenant_id)
    AND (
      (actor_id=current_setting('app.user_id',true)
        AND attempt_ref IS NULL
        AND EXISTS (SELECT 1 FROM dialogue_message m
          WHERE m.message_ref=review_aily_query.message_ref
            AND m.tenant_id=review_aily_query.tenant_id
            AND m.actor_id=review_aily_query.actor_id
            AND m.purpose='CHAT' AND m.executor='AILY'))
      OR (attempt_ref IS NOT NULL AND message_ref IS NULL
        AND EXISTS (SELECT 1 FROM action_attempt a
          JOIN work_item w ON w.work_item_id=a.work_item_id
            AND w.tenant_id=a.tenant_id
          WHERE a.attempt_id=review_aily_query.attempt_ref
            AND a.tenant_id=review_aily_query.tenant_id
            AND a.actor_user_id=review_aily_query.actor_id
            AND w.requested_by_user_id=review_aily_query.actor_id
            AND a.action_type IN ('OPENCLAW_DYNAMIC_EVALUATION',
              'OPENCLAW_OVERALL_SYNTHESIS')
            AND native_app_work_item_readable(
              review_aily_query.tenant_id,w.work_item_id)))
    )`;
  if (table === 'hierarchical_wiki_scope') return `native_app_shared_read_allowed(tenant_id)
    AND EXISTS (SELECT 1 FROM derived_summary s
      WHERE s.summary_id=hierarchical_wiki_scope.summary_id
        AND s.tenant_id=hierarchical_wiki_scope.tenant_id)`;
  if (table === 'hierarchical_wiki_membership') return `native_app_shared_read_allowed(tenant_id)
    AND EXISTS (SELECT 1 FROM hierarchical_wiki_scope s
      WHERE s.wiki_id=hierarchical_wiki_membership.wiki_id
        AND s.tenant_id=hierarchical_wiki_membership.tenant_id)`;
  if (table === 'hierarchical_wiki_change') return `native_app_shared_read_allowed(tenant_id)
    AND CASE kind
      WHEN 'DOCUMENT' THEN native_app_document_readable(tenant_id,subject_id)
      WHEN 'WORK_ITEM' THEN native_app_work_item_readable(tenant_id,subject_id)
      WHEN 'MATTER' THEN EXISTS (SELECT 1 FROM engineering_matter m
        WHERE m.tenant_id=hierarchical_wiki_change.tenant_id
          AND m.matter_id=hierarchical_wiki_change.subject_id)
      WHEN 'SUMMARY' THEN EXISTS (SELECT 1 FROM derived_summary s
        WHERE s.tenant_id=hierarchical_wiki_change.tenant_id
          AND s.summary_id=hierarchical_wiki_change.subject_id)
      ELSE false END`;
  if (table === 'review_conversation') return `native_app_shared_read_allowed(tenant_id)
    AND EXISTS (SELECT 1 FROM work_item w WHERE w.tenant_id=review_conversation.tenant_id
      AND w.work_item_id=review_conversation.work_item_id)`;
  if (table === 'review_turn' || table === 'engineer_supplied_input')
    return `native_app_shared_read_allowed(tenant_id)
      AND EXISTS (SELECT 1 FROM work_item w WHERE w.tenant_id=${ident(table)}.tenant_id
        AND w.work_item_id=${ident(table)}.work_item_id)
      AND EXISTS (SELECT 1 FROM review_conversation c
        WHERE c.tenant_id=${ident(table)}.tenant_id
          AND c.work_item_id=${ident(table)}.work_item_id
          AND c.review_conversation_id=${ident(table)}.review_conversation_id
          AND c.actor_id=${ident(table)}.actor_id)`;
  if (directTenantTables.has(table)) return 'native_app_shared_read_allowed(tenant_id)';
  const local = tenantless[table](ident(table));
  return `native_app_shared_read_allowed('63849986') AND ${local}`;
}

function reviewerPolicies() {
  const own = table => `wiselink_native_reviewer(tenant_id)
    AND actor_id=current_setting('app.user_id',true)
    AND EXISTS (SELECT 1 FROM work_item w WHERE w.work_item_id=${table}.work_item_id
      AND w.tenant_id=${table}.tenant_id)`;
  const conversation = table => `${own(table)} AND EXISTS (
    SELECT 1 FROM review_conversation c
    WHERE c.review_conversation_id=${table}.review_conversation_id
      AND c.tenant_id=${table}.tenant_id AND c.work_item_id=${table}.work_item_id
      AND c.actor_id=${table}.actor_id)`;
  const rows = [
    ['review_conversation', 'INSERT', own('review_conversation')],
    ['review_conversation', 'SELECT', own('review_conversation')],
    ['review_conversation', 'UPDATE', own('review_conversation')],
    ['review_turn', 'INSERT', `${conversation('review_turn')}
      AND input_type='ENGINEER_TEXT'
      AND adoption_status='CANDIDATE_UNADOPTED'
      AND response_type IS NULL AND assistant_response IS NULL
      AND source_refs_json IS NULL AND missing_inputs_json IS NULL
      AND candidate_evidence_refs_json IS NULL
      AND review_action_draft_json IS NULL
      AND affected_item_ids_json IS NULL AND warnings_json IS NULL
      AND result_provenance_json IS NULL AND result_content_hash IS NULL
      AND action_attempt_id IS NULL AND assistant_completed_at IS NULL`],
    ['review_turn', 'SELECT', conversation('review_turn')],
    ['engineer_supplied_input', 'INSERT',
      `${conversation('engineer_supplied_input')}
        AND input_type='ENGINEER_TEXT'
        AND adoption_status='CANDIDATE_UNADOPTED'
        AND EXISTS (SELECT 1 FROM review_turn t
          WHERE t.review_turn_id=engineer_supplied_input.review_turn_id
            AND t.review_conversation_id=
              engineer_supplied_input.review_conversation_id
            AND t.tenant_id=engineer_supplied_input.tenant_id
            AND t.actor_id=engineer_supplied_input.actor_id
            AND t.work_item_id=engineer_supplied_input.work_item_id
            AND t.input_type=engineer_supplied_input.input_type
            AND t.adoption_status=engineer_supplied_input.adoption_status)`],
    ['engineer_supplied_input', 'SELECT', conversation('engineer_supplied_input')],
  ];
  return rows.map(([table, command, predicate]) => {
    const name = `nr78_reviewer_${command.toLowerCase()}`;
    const clause = command === 'INSERT' ? `WITH CHECK (${predicate})`
      : command === 'UPDATE' ? `USING (${predicate}) WITH CHECK (${predicate})`
      : `USING (${predicate})`;
    return `DROP POLICY IF EXISTS ${ident(name)} ON ${ident(table)};\n` +
      `CREATE POLICY ${ident(name)} ON ${ident(table)} AS PERMISSIVE FOR ${command}
        TO ${roleSql(AUTH)} ${clause};`;
  });
}

export function prepareNativeTenantReadDdl({ template, snapshot }) {
  const policies = expectSnapshot(snapshot);
  if (!marker.test(template) || !template.includes("target_tenant = '63849986'"))
    throw new Error('NATIVE_READ_TEMPLATE_MISMATCH');
  const tables = new Set(policies.map(p => p.tablename));
  const missing = [...nativeSharedReadTables].filter(table => !tables.has(table));
  if (missing.length) throw new Error(`NATIVE_READ_REQUIRED_TABLES_MISSING:${missing.join(',')}`);
  const statements = [];
  for (const table of nativeSharedReadTables) {
    statements.push(`ALTER TABLE ${ident(table)} ENABLE ROW LEVEL SECURITY;`);
    const selectRestrictions = policies.filter(p => p.tablename === table &&
      p.cmd === 'SELECT' && p.permissive === 'RESTRICTIVE' &&
      roleNames(p.roles).includes(AUTH));
    for (const [index, policy] of selectRestrictions.entries()) {
      if (typeof policy.qual !== 'string')
        throw new Error(`NATIVE_READ_UNSUPPORTED_SELECT_POLICY:${policy.policyname}`);
      statements.push(`DROP POLICY ${ident(policy.policyname)} ON ${ident(table)};`);
      const other = roleNames(policy.roles).filter(role => role !== AUTH);
      if (other.length) statements.push(createPolicy({
        name: `nr78_old_select_${index}_other`, table,
        command: 'SELECT', roles: other, using: policy.qual,
      }));
    }
    const restrictive = policies.filter(p => p.tablename === table &&
      p.cmd === 'ALL' && p.permissive === 'RESTRICTIVE' &&
      roleNames(p.roles).includes(AUTH));
    for (const [index, policy] of restrictive.entries()) {
      const roles = roleNames(policy.roles);
      if (typeof policy.qual !== 'string')
        throw new Error(`NATIVE_READ_UNSUPPORTED_ALL_POLICY:${policy.policyname}`);
      statements.push(`DROP POLICY ${ident(policy.policyname)} ON ${ident(table)};`);
      const other = roles.filter(role => role !== AUTH);
      if (other.length) statements.push(createPolicy({
        name: `nr78_old_all_${index}_other`, table, command: 'ALL',
        roles: other, using: policy.qual,
        check: policy.with_check ?? policy.qual,
      }));
      for (const command of ['INSERT', 'UPDATE', 'DELETE']) {
        statements.push(createPolicy({
          name: `nr78_old_all_${index}_${command.toLowerCase()}`,
          table, command, roles: [AUTH], using: policy.qual,
          check: policy.with_check ?? policy.qual,
        }));
      }
      statements.push(createPolicy({
        name: `nr78_old_all_${index}_select`, table,
        command: 'SELECT', roles: [AUTH], using: sharedPredicate(table),
      }));
    }
    const name = 'nr78_shared_read';
    statements.push(`DROP POLICY IF EXISTS ${ident(name)} ON ${ident(table)};`);
    statements.push(`CREATE POLICY ${ident(name)} ON ${ident(table)} AS PERMISSIVE
      FOR SELECT TO ${roleSql(AUTH)} USING (${sharedPredicate(table)});`);
    const boundary = 'nr78_tenant_boundary';
    statements.push(`DROP POLICY IF EXISTS ${ident(boundary)} ON ${ident(table)};`);
    statements.push(createPolicy({
      name: boundary, table, command: 'SELECT', roles: [AUTH],
      using: sharedPredicate(table),
    }));
    statements.push(`GRANT SELECT ON ${ident(table)} TO ${roleSql(AUTH)};`);
  }
  statements.push(...reviewerPolicies());
  return template.replace(marker, `-- @native-tenant-read:prepared-policies:start\n${statements.join('\n')}\n-- @native-tenant-read:prepared-policies:end`)
    .replaceAll('TO authenticated, service_role;',
      `TO ${roleSql(AUTH)}, ${roleSql(SERVICE)};`)
    .replaceAll(`TO authenticated;`, `TO ${roleSql(AUTH)};`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--snapshot' || args[2] !== '--output')
    throw new Error('Usage: node scripts/prepare-native-tenant-read-ddl.mjs --snapshot official-policies.json --output prepared.sql');
  const [template, snapshot] = await Promise.all([
    readFile(new URL('../migrations/0078_native_tenant_shared_read.sql', import.meta.url), 'utf8'),
    readFile(args[1], 'utf8').then(JSON.parse),
  ]);
  await writeFile(args[3], prepareNativeTenantReadDdl({ template, snapshot }), { flag: 'wx' });
  process.stdout.write(`Prepared ${args[3]}. No database statements executed.\n`);
}
