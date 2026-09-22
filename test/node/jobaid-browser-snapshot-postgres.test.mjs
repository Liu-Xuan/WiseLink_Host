import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import postgres from 'postgres';

process.env.TS_NODE_PROJECT = 'tsconfig.node.json';
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const { SqlExecutionContextMiddleware } = require('@lark-apaas/fullstack-nestjs-core');
const { JobAidWorkRepository } = require('../../server/modules/canonical-host/jobaid-work.repository.ts');
const { ACTION_ATTEMPT_REQUEST_ORIGIN } = require('../../server/modules/action-attempt/action-attempt.types.ts');
const databaseUrl = process.env.JOBAID_SNAPSHOT_TEST_DATABASE_URL;

// A dedicated disposable local database; never run schema fixtures on business data.
test('single-statement JobAid snapshot works with real platform auth/RLS and concurrent run changes', { skip: !databaseUrl }, async () => {
  const url = new URL(databaseUrl);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  assert.match(url.pathname, /^\/wiselink_snapshot_test_[a-z0-9_]+$/u);
  const admin = postgres(databaseUrl, { max: 3, onnotice() {} });
  const reader = postgres(databaseUrl, { max: 1, connection: { application_name: 'wiselink_snapshot_reader' }, onnotice() {} });
  let unblock;
  let writer;
  try {
    await admin.unsafe(`
      CREATE ROLE authenticated_wiselink_snapshot_test;
      CREATE TABLE action_attempt (attempt_id text PRIMARY KEY, tenant_id text, work_item_id text,
        document_version_id text, subject_kind text, request_origin text, action_type text,
        status text, operation_ref text, review_activity_json text, created_at timestamptz);
      CREATE TABLE assessment_work_revision (assessment_work_revision_id text PRIMARY KEY,
        tenant_id text, work_item_id text, work_revision integer, previous_work_revision_id text,
        request_id text, action_attempt_id text, based_on_work_item_revision integer,
        document_version_id text, created_at timestamptz, content_json text);
      CREATE FUNCTION snapshot_visible(tenant text) RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(98543721);
        RETURN tenant = current_setting('app.user_id', true);
      END $$;
      ALTER TABLE action_attempt ENABLE ROW LEVEL SECURITY;
      ALTER TABLE assessment_work_revision ENABLE ROW LEVEL SECURITY;
      CREATE POLICY snapshot_attempt_read ON action_attempt FOR SELECT TO authenticated_wiselink_snapshot_test USING (snapshot_visible(tenant_id));
      CREATE POLICY snapshot_work_read ON assessment_work_revision FOR SELECT TO authenticated_wiselink_snapshot_test USING (snapshot_visible(tenant_id));
      GRANT SELECT ON action_attempt, assessment_work_revision TO authenticated_wiselink_snapshot_test;
    `);
    const db = drizzle(reader);
    const repository = new JobAidWorkRepository(db, null, null);
    const middleware = new SqlExecutionContextMiddleware({ roleSchema: 'wiselink_snapshot_test' });
    const scoped = (callback, userId = 'tenant-one') => new Promise((resolve, reject) => middleware.use(
      { userContext: { userId, isSystemAccount: false, roles: [] } }, {},
      () => Promise.resolve().then(callback).then(resolve, reject)));
    const input = { tenantId: 'tenant-one', workItemId: 'WI', documentVersionId: 'DV' };
    const read = (query = input) => scoped(() => repository.readBrowserSnapshot(query));
    assert.deepEqual(await read(), { execution: null, current: null, savedActivity: [] });
    const addAttempt = (connection, id, status, tenant = 'tenant-one', document = 'DV') => connection`
      INSERT INTO action_attempt VALUES (${id}, ${tenant}, 'WI', ${document}, 'WORK_ITEM',
        ${ACTION_ATTEMPT_REQUEST_ORIGIN}, 'OPENCLAW_DYNAMIC_EVALUATION', ${status}, ${'ref-' + id}, '[]', clock_timestamp())`;
    const addWork = (connection, attempt, revision, tenant = 'tenant-one', document = 'DV') => connection`
      INSERT INTO assessment_work_revision VALUES (${'work-' + attempt}, ${tenant}, 'WI', ${revision}, null,
        ${'request-' + attempt}, ${attempt}, 3, ${document}, clock_timestamp(),
        ${JSON.stringify({ schemaVersion: 'wiselink.jobaid-problem-work.v3', issues: [], evidence: [] })})`;
    await addAttempt(admin, 'old', 'SUCCEEDED');
    await addWork(admin, 'old', 1);
    await addAttempt(admin, 'foreign', 'RUNNING', 'tenant-other');
    await addWork(admin, 'foreign', 99, 'tenant-other');
    await addAttempt(admin, 'different-version', 'RUNNING', 'tenant-one', 'DV-other');
    const initial = await read();
    assert.equal(initial.execution.attemptId, 'old');
    assert.equal(initial.current.workRevisionRef, 'work-old');
    assert.ok(initial.savedActivity[0].createdAt instanceof Date);
    assert.deepEqual(await read({ ...input, tenantId: 'tenant-other' }), { execution: null, current: null, savedActivity: [] });
    assert.deepEqual(await scoped(() => repository.readBrowserSnapshot(input), 'not-owner'), { execution: null, current: null, savedActivity: [] });

    let locked;
    const lockReady = new Promise(resolve => { locked = resolve; });
    const release = new Promise(resolve => { unblock = resolve; });
    writer = admin.begin(async connection => {
      await connection`SELECT pg_advisory_xact_lock(98543721)`;
      locked();
      await release;
      await addAttempt(connection, 'new', 'RUNNING');
      await addWork(connection, 'new', 2);
    });
    await lockReady;
    const inFlight = read();
    let waiting = false;
    for (let index = 0; index < 100; index++) {
      const rows = await admin`SELECT 1 FROM pg_stat_activity WHERE application_name='wiselink_snapshot_reader' AND wait_event='advisory'`;
      if (rows.length) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(waiting, 'reader reached the database snapshot before concurrent commit');
    unblock(); await writer;
    const oldSnapshot = await inFlight;
    assert.equal(oldSnapshot.execution.attemptId, 'old');
    assert.equal(oldSnapshot.current.workRevisionRef, 'work-old');
    assert.deepEqual(oldSnapshot.savedActivity.map(item => item.workRevisionRef), ['work-old']);
    const newSnapshot = await read();
    assert.equal(newSnapshot.execution.attemptId, 'new');
    assert.equal(newSnapshot.current.workRevisionRef, 'work-new');
    assert.deepEqual(newSnapshot.savedActivity.map(item => item.workRevisionRef), ['work-new']);
    await admin`UPDATE action_attempt SET status='SUCCEEDED' WHERE attempt_id='new'`;
    await addAttempt(admin, 'unsaved', 'RUNNING');
    const unsaved = await read();
    assert.equal(unsaved.execution.attemptId, 'unsaved');
    assert.equal(unsaved.current.workRevisionRef, 'work-new');
    assert.deepEqual(unsaved.savedActivity, []);
  } finally {
    unblock?.();
    if (writer) await writer.catch(() => {});
    await reader.end();
    await admin.unsafe('DROP TABLE IF EXISTS assessment_work_revision, action_attempt; DROP FUNCTION IF EXISTS snapshot_visible(text); DROP ROLE IF EXISTS authenticated_wiselink_snapshot_test');
    await admin.end();
  }
});
