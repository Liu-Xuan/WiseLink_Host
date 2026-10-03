import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { prepareDerivedSummaryDdl } from '../../scripts/prepare-derived-summary-ddl.mjs';

const template = await readFile('server/database/derived-summary.ddl.sql', 'utf8');
const snapshot = () => ({ ok: true, data: [{ schema_probe: JSON.stringify({ schema: 'workspace_fixture',
  constraints: [{ table: 'action_attempt', name: 'ck_action_attempt_subject', definition: "CHECK (subject_kind = 'WORK_ITEM' OR subject_kind = 'ACQUISITION')" }],
  policies: [{ table: 'action_attempt', name: 'action_attempt_matter_or_document_subject_boundary', restrictive: true, command: '*',
    using: "subject_kind IN ('WORK_ITEM','ACQUISITION') OR engineering_matter_all_links_owned_by_actor(tenant_id,matter_revision_id)", check: null,
    roles: ['authenticated_workspace_fixture', 'service_role_workspace_fixture'] }],
  }) }] });
const prepare = (online = snapshot(), dev = snapshot()) => prepareDerivedSummaryDdl({ template, devSnapshot: dev, onlineSnapshot: online });

test('fresh official expressions produce top-level constraints and single-scope policies used by deployment', () => {
  const output = prepare();
  assert.doesNotMatch(output, /DERIVED_SUMMARY_PREPARE_REQUIRED/u);
  assert.match(output, /ADD CONSTRAINT ck_action_attempt_summary_subject CHECK \(\(subject_kind = 'WORK_ITEM' OR subject_kind = 'ACQUISITION'\) OR/u);
  assert.match(output, /engineering_matter_all_links_owned_by_actor\(tenant_id,matter_revision_id\)/u);
  assert.match(output, /CREATE POLICY "action_attempt_summary_legacy_service_role" ON action_attempt AS RESTRICTIVE FOR ALL TO service_role/u);
  assert.equal((output.match(/^CREATE POLICY derived_summary_.* AS RESTRICTIVE.* TO (?:authenticated|service_role|anon)$/gmu) ?? []).length, 21);
  assert.equal((output.match(/^CREATE POLICY action_attempt_summary_subject_boundary_.* AS RESTRICTIVE.* TO (?:authenticated|service_role|anon)$/gmu) ?? []).length, 3);
  assert.doesNotMatch(output, /workspace_fixture/u, 'portable aliases and bare tables carry no hardcoded schema');
});

test('failed/malformed official snapshots and different scopes fail preparation', () => {
  assert.throws(() => prepare({ ok: false, data: [] }), /OFFICIAL_SCHEMA_SNAPSHOT_REQUIRED/u);
  const wrong = snapshot(); wrong.data[0].schema_probe = wrong.data[0].schema_probe.replaceAll('workspace_fixture','other_schema');
  assert.throws(() => prepare(wrong), /PREPARATION_SCOPE_MISMATCH/u);
  const missing = snapshot(); const body = JSON.parse(missing.data[0].schema_probe); body.constraints = []; missing.data[0].schema_probe = body;
  assert.throws(() => prepare(missing), /LEGACY_SUBJECT_CHECK_REQUIRED/u);
});

test('unsupported existing SQL roles are never silently dropped from a legacy boundary', () => {
  const input = snapshot(); const body = JSON.parse(input.data[0].schema_probe);
  body.policies[0].roles.push('custom_workspace_fixture'); input.data[0].schema_probe = body;
  assert.throws(() => prepare(input), /LEGACY_POLICY_ROLE_UNSUPPORTED/u);
});

test('independent legacy predicates preserve AND composition and their exact roles', () => {
  const input = snapshot(); const body = JSON.parse(input.data[0].schema_probe);
  body.policies.push({ ...body.policies[0], name: 'action_attempt_matter_subject_boundary', using: 'actor_user_id=current_setting(\'app.user_id\',true)',
    roles: ['service_role_workspace_fixture'] }); input.data[0].schema_probe = body;
  const output = prepare(input);
  assert.match(output, /CREATE POLICY "action_attempt_summary_legacy_1_authenticated"/u);
  assert.match(output, /CREATE POLICY "action_attempt_summary_legacy_1_service_role"/u);
  assert.match(output, /CREATE POLICY "action_attempt_summary_legacy_2_service_role"/u);
  assert.doesNotMatch(output, /CREATE POLICY "action_attempt_summary_legacy_2_authenticated"/u);
});
