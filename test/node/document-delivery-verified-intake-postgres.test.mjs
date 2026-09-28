import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import postgres from 'postgres';

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS', moduleResolution: 'node',
});
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const { sql } = require('drizzle-orm');
const { getTableConfig } = require('drizzle-orm/pg-core');
const { SqlExecutionContextMiddleware } = require('@lark-apaas/fullstack-nestjs-core');
const { SessionResolver } = require('../../server/modules/identity/session-resolver.service.ts');
const { MiaodaWorkItemRepository } = require('../../server/modules/work-item/miaoda-work-item.repository.ts');
const { workItem, actionAttempt } = require('../../server/database/schema.ts');
const { autoWorkItemAuthorization } = require('../../server/database/auto-work-item-authorization.schema.ts');

const databaseUrl = process.env.DOCUMENT_DELIVERY_SESSION_TEST_DATABASE_URL;
const schema = 'workspace_aadkpkjef3slu';
const actorId = 'actor-intake';
const tenantId = 'tenant-intake';
const appId = 'app_17bzc551rsg';

test('0067 verified service SQL admits only new development intake in its exact role',
  { skip: !databaseUrl }, async () => {
    const target = new URL(databaseUrl);
    assert.ok(['localhost', '127.0.0.1'].includes(target.hostname));
    assert.match(target.pathname, /^\/wl_delivery_test_session_[a-z0-9_]+$/u);
    const savedSandbox = process.env.SANDBOX_ID;
    const savedLocal = process.env.MIAODA_LOCAL_DEV;
    process.env.SANDBOX_ID = 'isolated-0067-session-test';
    delete process.env.MIAODA_LOCAL_DEV;
    const admin = postgres(databaseUrl, { max: 1, onnotice() {} });
    let pool;
    try {
      await admin.unsafe(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
            CREATE ROLE authenticated NOLOGIN;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated_workspace_aadkpkjef3slu') THEN
            CREATE ROLE authenticated_workspace_aadkpkjef3slu NOLOGIN;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role_workspace_aadkpkjef3slu') THEN
            CREATE ROLE service_role_workspace_aadkpkjef3slu NOLOGIN;
          END IF;
        END $$;
        DROP SCHEMA IF EXISTS ${schema} CASCADE;
        CREATE SCHEMA ${schema};
      `);
      pool = postgres(databaseUrl, {
        max: 1, connection: { search_path: schema }, onnotice() {},
      });
      await pool.unsafe(`
        CREATE TYPE user_profile AS (user_id text);
        CREATE TABLE work_item (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          work_item_id varchar(96) UNIQUE NOT NULL,
          tenant_id varchar(128) NOT NULL,
          action_type varchar(64) NOT NULL,
          document_id varchar(96) NOT NULL,
          document_version_id varchar(96) NOT NULL,
          source_artifact_id varchar(96) NOT NULL,
          source_file_sha256 varchar(64) NOT NULL,
          source_byte_length bigint NOT NULL,
          normalized_family varchar(64) NOT NULL,
          run_key varchar(96) NOT NULL,
          analysis_model_json text,
          initial_aily_session_id uuid,
          request_id varchar(96) NOT NULL,
          status varchar(64) NOT NULL,
          revision integer NOT NULL,
          package_id text,
          requested_by_user_id varchar(255) NOT NULL,
          created_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL,
          UNIQUE (tenant_id,action_type,document_version_id,run_key)
        );
        CREATE TABLE action_attempt (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          attempt_id varchar(96) UNIQUE NOT NULL,
          work_item_id varchar(96) REFERENCES work_item(work_item_id),
          subject_kind varchar(32) NOT NULL DEFAULT 'WORK_ITEM',
          document_version_id varchar(96),
          action_type varchar(64) NOT NULL,
          attempt_no integer NOT NULL,
          trigger_request_id varchar(96) NOT NULL,
          request_origin varchar(32) NOT NULL,
          status varchar(64) NOT NULL,
          actor_user_id varchar(255) NOT NULL,
          tenant_id varchar(128) NOT NULL,
          task_envelope_json text,
          idempotency_key varchar(255),
          created_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL,
          UNIQUE (work_item_id,action_type,attempt_no)
        );
        CREATE TABLE auto_work_item_authorization (
          tenant_id varchar(128) NOT NULL, work_item_id varchar(96) NOT NULL,
          request_id varchar(96) NOT NULL, actor_user_id varchar(255) NOT NULL,
          document_id varchar(96) NOT NULL, document_version_id varchar(96) NOT NULL,
          source_artifact_id varchar(96) NOT NULL, source_file_sha256 varchar(64) NOT NULL,
          source_byte_length bigint NOT NULL, grant_kind varchar(48) NOT NULL,
          status varchar(16) NOT NULL DEFAULT 'WAITING',
          lease_generation integer NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
          PRIMARY KEY (tenant_id,work_item_id)
        );
        CREATE TABLE dm_source_artifact (source_artifact_id varchar(96) PRIMARY KEY);
        CREATE TABLE dm_document_version (document_version_id varchar(96) PRIMARY KEY);
        CREATE TABLE dm_acquisition (acquisition_id varchar(96) PRIMARY KEY,
          source_artifact_id varchar(96), document_version_id varchar(96),
          source_channel text, source_ref text, selection_bucket_id text,
          selection_file_path text, provider_object_id text, provider_version_id text,
          acquired_by text, acquired_at timestamptz, idempotency_key text,
          source_descriptor_json text, status text);
        CREATE TABLE dm_ingress_preflight (preflight_id varchar(96) PRIMARY KEY,
          acquisition_id varchar(96), status text, execution_authorized boolean,
          decision text, branch text, observed_current_generation integer,
          observed_current_document_version_id text, normalized_descriptor_json text,
          decision_payload_json text, document_version_id text,
          commit_idempotency_key text, committed_at timestamptz);
        ALTER TABLE work_item ENABLE ROW LEVEL SECURITY;
        ALTER TABLE action_attempt ENABLE ROW LEVEL SECURITY;
        ALTER TABLE auto_work_item_authorization ENABLE ROW LEVEL SECURITY;
        ALTER TABLE dm_acquisition ENABLE ROW LEVEL SECURITY;
        ALTER TABLE dm_ingress_preflight ENABLE ROW LEVEL SECURITY;
        CREATE POLICY service_work ON work_item FOR ALL TO service_role_workspace_aadkpkjef3slu
          USING (requested_by_user_id=current_setting('app.user_id',true))
          WITH CHECK (requested_by_user_id=current_setting('app.user_id',true));
        CREATE POLICY browser_work ON work_item FOR ALL TO authenticated_workspace_aadkpkjef3slu
          USING (requested_by_user_id=current_setting('app.user_id',true))
          WITH CHECK (requested_by_user_id=current_setting('app.user_id',true));
        CREATE POLICY service_attempt ON action_attempt FOR ALL TO service_role_workspace_aadkpkjef3slu
          USING (actor_user_id=current_setting('app.user_id',true))
          WITH CHECK (actor_user_id=current_setting('app.user_id',true));
        CREATE POLICY browser_attempt ON action_attempt FOR ALL TO authenticated_workspace_aadkpkjef3slu
          USING (actor_user_id=current_setting('app.user_id',true))
          WITH CHECK (actor_user_id=current_setting('app.user_id',true));
        CREATE POLICY service_auto ON auto_work_item_authorization FOR ALL
          TO service_role_workspace_aadkpkjef3slu USING (actor_user_id=current_setting('app.user_id',true))
          WITH CHECK (actor_user_id=current_setting('app.user_id',true));
        CREATE POLICY browser_acquisition ON dm_acquisition FOR ALL
          TO authenticated_workspace_aadkpkjef3slu USING (true) WITH CHECK (true);
        CREATE POLICY browser_preflight ON dm_ingress_preflight FOR ALL
          TO authenticated_workspace_aadkpkjef3slu USING (true) WITH CHECK (true);
        GRANT USAGE ON SCHEMA ${schema} TO authenticated_workspace_aadkpkjef3slu,
          service_role_workspace_aadkpkjef3slu;
        GRANT SELECT,INSERT,UPDATE,DELETE ON work_item,action_attempt
          TO authenticated_workspace_aadkpkjef3slu,service_role_workspace_aadkpkjef3slu;
        GRANT SELECT,INSERT,UPDATE ON auto_work_item_authorization
          TO service_role_workspace_aadkpkjef3slu;
        GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON dm_acquisition,dm_ingress_preflight
          TO authenticated_workspace_aadkpkjef3slu;
        INSERT INTO work_item (work_item_id,tenant_id,action_type,document_id,
          document_version_id,source_artifact_id,source_file_sha256,source_byte_length,
          normalized_family,run_key,request_id,status,revision,requested_by_user_id,
          created_at,updated_at) VALUES ('WI-LEGACY','tenant-intake','PARSE_PDF',
          'DOC-LEGACY','DV-LEGACY','SRC-LEGACY',repeat('a',64),100,'SB',
          'dev:legacy','REQ-LEGACY','RESERVED',0,'actor-intake',now(),now());
        INSERT INTO action_attempt (attempt_id,work_item_id,action_type,attempt_no,
          trigger_request_id,request_origin,status,actor_user_id,tenant_id,created_at,updated_at)
          VALUES ('ATT-LEGACY','WI-LEGACY','PARSE_PDF',1,'REQ-LEGACY','MIAODA',
          'PENDING','actor-intake','tenant-intake',now(),now());
      `);
      for (const [tableName, definition] of [
        ['work_item', workItem], ['action_attempt', actionAttempt],
        ['auto_work_item_authorization', autoWorkItemAuthorization],
      ]) {
        const present = new Set((await pool`SELECT column_name FROM information_schema.columns
          WHERE table_schema=${schema} AND table_name=${tableName}`)
          .map((row) => row.column_name));
        for (const column of getTableConfig(definition).columns) {
          if (!present.has(column.name)) {
            await pool.unsafe(`ALTER TABLE "${tableName}" ADD COLUMN "${column.name}" ${column.getSQLType()}`);
          }
        }
      }
      await pool.unsafe(await readFile(resolve('migrations/0067_document_upload_delivery_authorization.sql'), 'utf8'));
      await pool.end();
      pool = postgres(databaseUrl, {
        max: 4, connection: { search_path: schema }, onnotice() {},
      });

      const db = drizzle(pool);
      const middleware = new SqlExecutionContextMiddleware({ roleSchema: schema });
      const sessions = new SessionResolver({
        async validate(token) {
          if (token !== 'valid') return null;
          return { sessionId: 'SESSION-VALID', revision: 1,
            expiresAt: new Date(Date.now() + 60_000),
            identity: { miaodaUserId: actorId, tenantId,
              verifiedAt: new Date().toISOString(), feishuOpenId: 'open-intake' } };
        },
      }, { applicationScopeId: appId, sessionEnvironment: 'runtime' }, middleware);
      const repository = new MiaodaWorkItemRepository(db);
      const request = (userId = actorId, requestTenant = tenantId) => ({
        headers: { cookie: 'wl_session=valid' },
        userContext: { userId, tenantId: requestTenant, appId,
          env: 'runtime', isSystemAccount: false, roles: [] },
      });
      const input = (suffix, delivery) => ({
        tenantId, actorUserId: actorId, documentId: `DOC-${suffix}`,
        documentVersionId: `DV-${suffix}`, sourceArtifactId: `SRC-${suffix}`,
        sourceFileSha256: 'b'.repeat(64), sourceByteLength: 100,
        normalizedFamily: 'SB', requestOrigin: 'MIAODA',
        runKey: `dev:${suffix}`, developmentIntake: true,
        documentDelivery: delivery,
        autoProcessingGrant: 'MIAODA_CANONICAL_PARSE_REQUEST',
      });
      const reserve = (req, value) => sessions.withRequestSession(req, () =>
        sessions.withVerifiedServiceSql(() => repository.reserve(value), value.actorUserId));
      const identity = () => db.execute(sql`SELECT current_user AS role,
        current_setting('app.user_id',true) AS actor`);
      await sessions.withRequestSession(request(), async () => {
        const [observed] = await sessions.withVerifiedServiceSql(identity, actorId);
        assert.deepEqual(observed, {
          role: 'service_role_workspace_aadkpkjef3slu', actor: actorId,
        });
      });

      const selected = input('SELECTED', { reading: true, translation: 'ZH_FULL' });
      const first = await reserve(request(), selected);
      assert.equal(first.created, true);
      const replay = await reserve(request(), selected);
      assert.equal(replay.created, false);
      assert.deepEqual(replay, { ...first, created: false });
      const none = await reserve(request(), input('NONE', { reading: false, translation: 'NONE' }));
      assert.equal(none.created, true);
      await assert.rejects(reserve(request(), { ...selected,
        documentDelivery: { reading: false, translation: 'NONE' },
      }), /DOCUMENT_DELIVERY_IDEMPOTENCY_CONFLICT/u);
      await assert.rejects(reserve(request(), { ...input('LEGACY',
        { reading: true, translation: 'ZH_FULL' }),
      runKey: 'dev:legacy', sourceFileSha256: 'a'.repeat(64) }),
      /DOCUMENT_DELIVERY_LEGACY_REPLAY_CONFLICT/u);
      await assert.rejects(sessions.withRequestSession(request(), () =>
        sessions.withVerifiedBrowserSql(() => repository.reserve(input('BROWSER',
          { reading: true, translation: 'NONE' })))),
      (error) => error.cause?.code === '42501');

      const [rows] = await admin.unsafe(`SELECT
        (SELECT count(*)::int FROM ${schema}.work_item) AS work_items,
        (SELECT count(*)::int FROM ${schema}.action_attempt WHERE action_type='DOCUMENT_DELIVERY_INTENT') AS intents,
        (SELECT count(*)::int FROM ${schema}.auto_work_item_authorization) AS grants,
        (SELECT count(*)::int FROM ${schema}.auto_work_item_authorization WHERE work_item_id='WI-LEGACY') AS legacy_grants`);
      assert.deepEqual(rows, { work_items: 3, intents: 2, grants: 2, legacy_grants: 0 });
      const stored = await admin.unsafe(`SELECT task_envelope_json FROM ${schema}.action_attempt
        WHERE action_type='DOCUMENT_DELIVERY_INTENT' ORDER BY task_envelope_json`);
      assert.deepEqual(stored.map((row) => JSON.parse(row.task_envelope_json).documentDelivery),
        [{ reading: false, translation: 'NONE' }, { reading: true, translation: 'ZH_FULL' }]);
      await assert.rejects(reserve(request('other-actor'), input('WRONG-ACTOR',
        { reading: true, translation: 'NONE' })), /DIALOGUE_BROWSER_IDENTITY_MISMATCH/u);
      await assert.rejects(reserve(request(actorId, 'other-tenant'), input('WRONG-TENANT',
        { reading: true, translation: 'NONE' })), /DIALOGUE_BROWSER_IDENTITY_MISMATCH/u);
      await assert.rejects(reserve({ ...request(), headers: { cookie: 'wl_session=expired' } },
        input('EXPIRED', { reading: true, translation: 'NONE' })),
      /OFFICIAL_OAUTH_SESSION_REQUIRED/u);

      await pool.unsafe(`CREATE FUNCTION reject_probe_intent() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.action_type='DOCUMENT_DELIVERY_INTENT' AND NEW.document_version_id='DV-ROLLBACK'
          THEN RAISE EXCEPTION 'ROLLBACK_PROBE'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER reject_probe_intent BEFORE INSERT ON action_attempt
          FOR EACH ROW EXECUTE FUNCTION reject_probe_intent();`);
      await assert.rejects(reserve(request(), input('ROLLBACK',
        { reading: true, translation: 'NONE' })),
      (error) => error.cause?.message === 'ROLLBACK_PROBE');
      const [afterRollback] = await admin.unsafe(`SELECT
        (SELECT count(*)::int FROM ${schema}.work_item WHERE document_version_id='DV-ROLLBACK') AS work_items,
        (SELECT count(*)::int FROM ${schema}.action_attempt WHERE document_version_id='DV-ROLLBACK') AS attempts,
        (SELECT count(*)::int FROM ${schema}.auto_work_item_authorization WHERE document_version_id='DV-ROLLBACK') AS grants`);
      assert.deepEqual(afterRollback, { work_items: 0, attempts: 0, grants: 0 });
    } finally {
      if (pool) await pool.end();
      await admin.end();
      if (savedSandbox === undefined) delete process.env.SANDBOX_ID;
      else process.env.SANDBOX_ID = savedSandbox;
      if (savedLocal === undefined) delete process.env.MIAODA_LOCAL_DEV;
      else process.env.MIAODA_LOCAL_DEV = savedLocal;
    }
  });
