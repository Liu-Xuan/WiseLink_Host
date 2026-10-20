import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { postgresCapability, startOwnedPostgres } from '../pg/owned-postgres-cluster.mjs';

process.env.TS_NODE_PROJECT = 'tsconfig.node.json';
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { correctionFixture } = require('../fixtures/jobaid-work-correction.fixture.ts');
const { resetQ1Database } = await import('./helpers/q1-review-postgres.fixture.mjs');
const candidate = await readFile(new URL('../../migrations/candidates/jobaid_manual_correction.hosted.sql', import.meta.url), 'utf8');

// This spec owns its loopback cluster. It accepts no external database URL and
// tests the deployed schema-role shape without any suffix-to-generic membership.
test('manual correction policy: exact schema role adaptation and atomic refusal', { timeout: 60000 }, async t => {
  const capability = await postgresCapability();
  assert.equal(capability.available, true, capability.reason ?? 'PostgreSQL engine required');
  const cluster = await startOwnedPostgres(capability);
  t.after(async () => {
    await cluster.stop();
    await assert.rejects(access(cluster.root), error => error.code === 'ENOENT');
  });
  const admin = cluster.admin;
  await admin.unsafe(`CREATE SCHEMA workspace_aadkpkjef3slu;
    SET search_path TO workspace_aadkpkjef3slu`);
  await resetQ1Database(admin);
  // Fixture-only ACLs already exist on hosted suffix roles; candidate SQL must
  // neither add them nor rely on generic inheritance synthesized by Q1.
  await admin.unsafe(`CREATE ROLE service_role_workspace_aadkpkjef3slu NOLOGIN NOSUPERUSER NOBYPASSRLS;
    CREATE ROLE authenticated_workspace_aadkpkjef3slu NOLOGIN NOSUPERUSER NOBYPASSRLS;
    CREATE ROLE service_role_other_schema NOLOGIN NOSUPERUSER NOBYPASSRLS;
    GRANT USAGE ON SCHEMA workspace_aadkpkjef3slu TO service_role,service_role_workspace_aadkpkjef3slu;
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA workspace_aadkpkjef3slu
      TO service_role,service_role_workspace_aadkpkjef3slu;
    ALTER POLICY work_item_service ON work_item TO service_role_workspace_aadkpkjef3slu;
    ALTER POLICY action_attempt_service ON action_attempt TO service_role_workspace_aadkpkjef3slu;
    ALTER POLICY assessment_work_revision_actor_select ON assessment_work_revision
      TO authenticated_workspace_aadkpkjef3slu,service_role_workspace_aadkpkjef3slu;
    ALTER POLICY assessment_work_revision_hosted_candidate_insert ON assessment_work_revision
      TO service_role_workspace_aadkpkjef3slu;
    COMMENT ON POLICY assessment_work_revision_hosted_candidate_insert ON assessment_work_revision
      IS 'original policy must survive unchanged'`);

  async function catalog() {
    const [table] = await admin`SELECT relowner,relacl::text,relrowsecurity,relforcerowsecurity
      FROM pg_class WHERE oid='assessment_work_revision'::regclass`;
    const policies = await admin`SELECT to_jsonb(p) AS policy,
      obj_description(oid,'pg_policy') AS comment
      FROM pg_policy p WHERE polrelid='assessment_work_revision'::regclass ORDER BY polname`;
    const roles = await admin`SELECT oid,rolname,rolsuper,rolbypassrls,rolinherit
      FROM pg_roles WHERE rolname IN ('service_role','service_role_workspace_aadkpkjef3slu') ORDER BY rolname`;
    const memberships = await admin`SELECT roleid,member,admin_option FROM pg_auth_members
      WHERE member=(SELECT oid FROM pg_roles WHERE rolname='service_role_workspace_aadkpkjef3slu') ORDER BY roleid`;
    return { table, policies: [...policies], roles: [...roles], memberships: [...memberships] };
  }
  async function refused(errorPattern) {
    const before = await catalog();
    await assert.rejects(() => admin.unsafe(candidate), errorPattern);
    // A failed multi-statement migration leaves this reserved session aborted.
    await admin.unsafe('ROLLBACK');
    assert.deepEqual(await catalog(), before);
  }
  async function inheritance() {
    const [row] = await admin`SELECT
      pg_has_role('service_role_workspace_aadkpkjef3slu','service_role','MEMBER') AS member,
      pg_has_role('service_role_workspace_aadkpkjef3slu','service_role','USAGE') AS usage,
      has_table_privilege('service_role_workspace_aadkpkjef3slu','assessment_work_revision','INSERT') AS insert_acl`;
    assert.deepEqual(row, { member: false, usage: false, insert_acl: true });
  }
  await inheritance();

  for (const [label, roles] of [
    ['generic service role', 'service_role'],
    ['another schema service role', 'service_role_other_schema'],
    ['authenticated role', 'authenticated_workspace_aadkpkjef3slu'],
    ['PUBLIC role', 'PUBLIC'],
    ['mixed exact and generic roles', 'service_role_workspace_aadkpkjef3slu,service_role'],
  ]) {
    await t.test(`reject ${label} and retain the whole preexisting catalog`, async () => {
      await admin.unsafe(`ALTER POLICY assessment_work_revision_hosted_candidate_insert
        ON assessment_work_revision TO ${roles}`);
      await refused(/JOBAID_MANUAL_CORRECTION_ORIGINAL_ROLES_REJECTED/);
    });
  }
  await admin.unsafe(`ALTER POLICY assessment_work_revision_hosted_candidate_insert
    ON assessment_work_revision TO service_role_workspace_aadkpkjef3slu`);
  for (const flag of ['BYPASSRLS', 'SUPERUSER']) {
    await t.test(`reject an exact suffix with ${flag}`, async () => {
      await admin.unsafe(`ALTER ROLE service_role_workspace_aadkpkjef3slu ${flag}`);
      try { await refused(/JOBAID_MANUAL_CORRECTION_ORIGINAL_ROLES_REJECTED/); }
      finally { await admin.unsafe(`ALTER ROLE service_role_workspace_aadkpkjef3slu NO${flag}`); }
    });
  }
  await t.test('missing source policy is refused atomically', async () => {
    await admin.unsafe(`ALTER POLICY assessment_work_revision_hosted_candidate_insert
      ON assessment_work_revision RENAME TO original_temporarily_absent`);
    try { await refused(/JOBAID_MANUAL_CORRECTION_ORIGINAL_POLICY_REQUIRED/); }
    finally {
      await admin.unsafe(`ALTER POLICY original_temporarily_absent ON assessment_work_revision
        RENAME TO assessment_work_revision_hosted_candidate_insert`);
    }
  });
  await t.test('a table found only through a later search_path schema is refused', async () => {
    const before = await catalog();
    await admin.unsafe('CREATE SCHEMA empty_schema; SET search_path TO empty_schema,workspace_aadkpkjef3slu');
    try { await refused(/JOBAID_MANUAL_CORRECTION_ORIGINAL_POLICY_REQUIRED/); }
    finally { await admin.unsafe('SET search_path TO workspace_aadkpkjef3slu'); }
    assert.deepEqual(await catalog(), before);
  });

  await t.test('reuse exact suffix roles with no generic inheritance; preserve original and ACLs', async () => {
    const before = await catalog();
    await admin.unsafe(candidate);
    const after = await catalog();
    assert.deepEqual(after.table, before.table);
    assert.deepEqual(after.roles, before.roles);
    assert.deepEqual(after.memberships, before.memberships);
    assert.deepEqual(after.policies.filter(row => row.policy.polname !== 'assessment_work_revision_manual_correction_insert'),
      before.policies);
    const original = before.policies.find(row => row.policy.polname === 'assessment_work_revision_hosted_candidate_insert');
    const manual = after.policies.find(row => row.policy.polname === 'assessment_work_revision_manual_correction_insert');
    assert.deepEqual(manual.policy.polroles, original.policy.polroles);
    assert.equal(manual.policy.polcmd, 'a');
    assert.equal(manual.policy.polpermissive, true);
    await inheritance();

    const { base, request: command } = correctionFixture();
    await admin`INSERT INTO identity_subject_mapping(miaoda_user_id,miaoda_tenant_id,expected_client_id,status)
      VALUES ('actor-job','tenant-job','cli_aadde8b579f95bc9','ACTIVE')`;
    await admin`INSERT INTO work_item(work_item_id,tenant_id,requested_by_user_id,revision,document_version_id)
      VALUES ('WI-job','tenant-job','actor-job',7,'dv-job')`;
    await admin`INSERT INTO action_attempt(attempt_id,tenant_id,work_item_id,action_type,request_origin,status,
      document_version_id,base_revision,actor_user_id)
      VALUES ('ATT-base','tenant-job','WI-job','OPENCLAW_DYNAMIC_EVALUATION','OPENCLAW_MCP_V1',
        'SUCCEEDED','dv-job',7,'actor-job')`;
    await admin`INSERT INTO assessment_work_revision(assessment_work_revision_id,tenant_id,work_item_id,
      work_revision,request_id,action_attempt_id,based_on_work_item_revision,document_version_id,
      command_json,content_json,created_by_user_id)
      VALUES (${base.workRevisionRef},'tenant-job','WI-job',4,'original-save','ATT-base',7,'dv-job',
        '{}',${JSON.stringify(base.content)},'actor-job')`;
    await admin`INSERT INTO action_attempt(attempt_id,tenant_id,work_item_id,subject_kind,action_type,
      request_origin,status,actor_user_id,document_version_id,input_revision,base_revision,trigger_request_id,
      review_activity_json)
      VALUES ('ATT-manual','tenant-job','WI-job','WORK_ITEM','HOST_JOBAID_MANUAL_CORRECTION',
        'HOST_BROWSER_CORRECTION','COMMITTING','actor-job','dv-job',7,7,${command.requestId},
        ${JSON.stringify({ schemaVersion: 'wiselink.jobaid-manual-correction-execution.v1',
          executionKind: 'HOST_MANUAL_CORRECTION', modelRequests: 0, semanticReanalysisPerformed: false,
          request: command, receipt: null })})`;
    async function insert(role) {
      return admin.begin(async tx => {
        await tx.unsafe(`SET LOCAL ROLE ${role}`);
        await tx`SELECT set_config('app.user_id','actor-job',true)`;
        return tx`INSERT INTO assessment_work_revision(assessment_work_revision_id,tenant_id,work_item_id,
          work_revision,request_id,action_attempt_id,based_on_work_item_revision,document_version_id,
          previous_work_revision_id,command_json,content_json,created_by_user_id)
          VALUES ('JAWR-manual','tenant-job','WI-job',5,${command.requestId},'ATT-manual',7,'dv-job',
            ${base.workRevisionRef},${JSON.stringify(command)},${JSON.stringify(base.content)},'actor-job')`;
      });
    }
    await assert.rejects(() => insert('service_role'), error => error.code === '42501');
    await insert('service_role_workspace_aadkpkjef3slu');
    const [saved] = await admin`SELECT count(*)::integer AS count FROM assessment_work_revision
      WHERE assessment_work_revision_id='JAWR-manual'`;
    assert.equal(saved.count, 1);
    // The preexisting leased producer still works through its unmodified branch.
    await admin`UPDATE action_attempt SET status='COMMITTING' WHERE attempt_id='ATT-base'`;
    await admin.begin(async tx => {
      await tx.unsafe('SET LOCAL ROLE service_role_workspace_aadkpkjef3slu');
      await tx`SELECT set_config('app.user_id','actor-job',true)`;
      await tx`INSERT INTO assessment_work_revision(assessment_work_revision_id,tenant_id,work_item_id,
        work_revision,request_id,action_attempt_id,based_on_work_item_revision,document_version_id,
        command_json,content_json,created_by_user_id)
        VALUES ('JAWR-leased','tenant-job','WI-job',6,'leased-save','ATT-base',7,'dv-job','{}','{}','actor-job')`;
    });
    await inheritance();
  });
  await t.test('duplicate application refuses without altering either INSERT branch', async () => {
    await refused(error => error.code === '42710');
  });
});
