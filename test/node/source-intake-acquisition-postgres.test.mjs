import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import postgres from 'postgres';

const databaseUrl = process.env.SOURCE_INTAKE_TEST_DATABASE_URL;

test('0070 acquisition intent uses exact Host role and preserves legacy rows',
  { skip: !databaseUrl }, async () => {
    assert.match(new URL(databaseUrl).pathname,
      /^\/wl_delivery_test_source_intake(?:_[a-z0-9_]+)?$/u);
    const admin = postgres(databaseUrl, { max: 1, onnotice() {} });
    const pool = postgres(databaseUrl, { max: 4, onnotice() {} });
    try {
      await admin.unsafe(`
        CREATE SCHEMA IF NOT EXISTS workspace_aadkpkjef3slu;
        SET search_path TO workspace_aadkpkjef3slu, public;
        DROP TABLE IF EXISTS action_attempt,dm_acquisition,dm_source_artifact,
          engineering_matter CASCADE;
        DROP FUNCTION IF EXISTS source_intake_guard_attempt() CASCADE;
        DROP FUNCTION IF EXISTS source_intake_guard_acquisition() CASCADE;
        DROP FUNCTION IF EXISTS engineering_matter_uri_component(text) CASCADE;
        DROP FUNCTION IF EXISTS engineering_matter_actor_has_tenant(text) CASCADE;
        DROP FUNCTION IF EXISTS engineering_matter_owned_by_actor(text,text) CASCADE;
        DROP FUNCTION IF EXISTS engineering_matter_all_links_owned_by_actor(text,text) CASCADE;
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
            CREATE ROLE authenticated NOLOGIN;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
            CREATE ROLE service_role NOLOGIN;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated_workspace_aadkpkjef3slu') THEN
            CREATE ROLE authenticated_workspace_aadkpkjef3slu NOLOGIN;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role_workspace_aadkpkjef3slu') THEN
            CREATE ROLE service_role_workspace_aadkpkjef3slu NOLOGIN;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon_workspace_aadkpkjef3slu') THEN
            CREATE ROLE anon_workspace_aadkpkjef3slu NOLOGIN;
          END IF;
        END $$;
        CREATE TABLE engineering_matter(tenant_id text,matter_id text,
          current_matter_revision_id text);
        CREATE FUNCTION engineering_matter_uri_component(text) RETURNS text
          LANGUAGE sql IMMUTABLE AS 'SELECT $1';
        CREATE FUNCTION engineering_matter_actor_has_tenant(text) RETURNS boolean
          LANGUAGE sql IMMUTABLE AS 'SELECT true';
        CREATE FUNCTION engineering_matter_owned_by_actor(text,text) RETURNS boolean
          LANGUAGE sql IMMUTABLE AS 'SELECT true';
        CREATE FUNCTION engineering_matter_all_links_owned_by_actor(text,text) RETURNS boolean
          LANGUAGE sql IMMUTABLE AS 'SELECT true';
        CREATE TABLE dm_source_artifact(source_artifact_id text PRIMARY KEY,
          readback_verified boolean,bucket_id text,file_path text,
          provider_object_id text,provider_version_id text);
        CREATE TABLE dm_acquisition(acquisition_id text PRIMARY KEY,
          source_artifact_id text,document_version_id text,source_channel text,
          source_ref text,selection_bucket_id text,selection_file_path text,
          provider_object_id text,provider_version_id text,acquired_by text,
          acquired_at timestamptz,idempotency_key text,source_descriptor_json text,
          status text);
        CREATE TABLE action_attempt(attempt_id text PRIMARY KEY,
          subject_kind text,work_item_id text,matter_id text,matter_revision_id text,
          document_version_id text,producer_run_id text,input_revision int,base_revision int,
          action_type text,attempt_no int,trigger_request_id text,request_origin text,
          status text,actor_user_id text,tenant_id text,execution_model_json text,
          task_envelope_json text,idempotency_key text,
          CONSTRAINT uk_action_attempt_idempotency UNIQUE (tenant_id,idempotency_key),
          CONSTRAINT ck_action_attempt_subject CHECK (subject_kind <> 'ACQUISITION'));
        ALTER TABLE action_attempt ENABLE ROW LEVEL SECURITY;
        ALTER TABLE dm_acquisition ENABLE ROW LEVEL SECURITY;
        CREATE POLICY action_attempt_matter_or_document_subject_boundary
          ON action_attempt AS RESTRICTIVE FOR ALL TO authenticated,service_role
          USING (true);
        CREATE POLICY test_action_permissive ON action_attempt FOR ALL TO PUBLIC
          USING (true) WITH CHECK (true);
        CREATE POLICY test_acquisition_permissive ON dm_acquisition FOR ALL TO PUBLIC
          USING (true) WITH CHECK (true);
        GRANT USAGE ON SCHEMA workspace_aadkpkjef3slu TO
          authenticated,service_role,authenticated_workspace_aadkpkjef3slu,
          service_role_workspace_aadkpkjef3slu,anon_workspace_aadkpkjef3slu;
        GRANT ALL ON action_attempt,dm_acquisition,dm_source_artifact,
          engineering_matter TO authenticated,service_role,
          authenticated_workspace_aadkpkjef3slu,
          service_role_workspace_aadkpkjef3slu,anon_workspace_aadkpkjef3slu;
        GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA workspace_aadkpkjef3slu TO
          authenticated,service_role,authenticated_workspace_aadkpkjef3slu,
          service_role_workspace_aadkpkjef3slu,anon_workspace_aadkpkjef3slu;
        INSERT INTO dm_source_artifact VALUES
          ('SRC-1',true,'bucket','/source.pdf','file-1','v1');
        INSERT INTO dm_acquisition VALUES
          ('ACQ-LEGACY','SRC-1',NULL,'legacy','fixture','bucket','/source.pdf',
            'file-1','v1','actor',CURRENT_TIMESTAMP,
            'tenant:t1:request:legacy','{}','ACQUIRED_READBACK_VERIFIED');
      `);
      const migration = await readFile(resolve('migrations/0070_source_intake_acquisition_intent.sql'), 'utf8');
      assert.doesNotMatch(migration, /^(?:GRANT|REVOKE)\b/gmu);
      await admin.unsafe(migration);

      const asRole = (role, actor, work) => pool.begin(async tx => {
        await tx.unsafe(`SET LOCAL ROLE ${role}`);
        await tx.unsafe('SET LOCAL search_path TO workspace_aadkpkjef3slu, public');
        await tx`SELECT set_config('app.user_id',${actor},true)`;
        return work(tx);
      });
      const service = work => asRole('service_role_workspace_aadkpkjef3slu','actor',work);
      await service(tx => tx`INSERT INTO dm_acquisition VALUES
        ('ACQ-1','SRC-1',NULL,'wiselink_drive_source','fixture','bucket','/source.pdf',
          'file-1','v1','actor',CURRENT_TIMESTAMP,'tenant:t1:request:source',
          '{"sourceKey":"technical-library","rootToken":"Q6uSfDwcDlBrUldWvZccoje8nXf"}',
          'ACQUIRED_READBACK_VERIFIED')`);
      const envelope = {
        schemaVersion: 'wiselink.document_delivery_intent.v2', acquisitionId: 'ACQ-1',
        authority: { kind: 'SOURCE_DELEGATION',
          authorityRef: 'technical-library:Q6uSfDwcDlBrUldWvZccoje8nXf',
          policyRevision: '1', executorPrincipalId: 'host-app' },
        documentDelivery: { reading: true, translation: 'NONE' },
        engineeringMode: 'DOCUMENT_ONLY',
      };
      const insertIntent = (attemptId, body = envelope) => service(tx => tx`
        INSERT INTO action_attempt(attempt_id,subject_kind,action_type,attempt_no,
          trigger_request_id,request_origin,status,actor_user_id,tenant_id,
          task_envelope_json,idempotency_key)
        VALUES (${attemptId},'ACQUISITION','DOCUMENT_DELIVERY_INTENT',1,
          'REQ-1','HOST_SOURCE_INTAKE_V2','RECORDED','actor','t1',
          ${JSON.stringify(body)},'source-intake:ACQ-1:initial')
        ON CONFLICT (tenant_id,idempotency_key) DO NOTHING RETURNING attempt_id`);
      const [first, second] = await Promise.all([
        insertIntent('ATT-1'), insertIntent('ATT-2'),
      ]);
      assert.equal(first.length + second.length, 1);
      assert.equal((await service(tx => tx`SELECT attempt_id FROM action_attempt
        WHERE subject_kind='ACQUISITION'`)).length, 1);
      await assert.rejects(insertIntent('ATT-MISSING', {
        ...envelope, authority: { kind: 'SOURCE_DELEGATION' },
      }), /SOURCE_INTAKE_ENVELOPE_INVALID/u);
      await service(tx => tx`INSERT INTO dm_acquisition VALUES
        ('ACQ-NO-ROOT','SRC-1',NULL,'wiselink_drive_source','fixture','bucket',
          '/source.pdf','file-1','v1','actor',CURRENT_TIMESTAMP,
          'tenant:t1:request:no-root','{"sourceKey":"technical-library"}',
          'ACQUIRED_READBACK_VERIFIED')`);
      await assert.rejects(service(tx => tx`INSERT INTO action_attempt
        (attempt_id,subject_kind,action_type,attempt_no,trigger_request_id,
          request_origin,status,actor_user_id,tenant_id,task_envelope_json,
          idempotency_key) VALUES ('ATT-NO-ROOT','ACQUISITION',
          'DOCUMENT_DELIVERY_INTENT',1,'REQ-NO-ROOT','HOST_SOURCE_INTAKE_V2',
          'RECORDED','actor','t1',${JSON.stringify({ ...envelope,
            acquisitionId: 'ACQ-NO-ROOT' })},
          'source-intake:ACQ-NO-ROOT:initial')`),
      /SOURCE_INTAKE_ACQUISITION_MISMATCH/u);
      for (const role of ['authenticated_workspace_aadkpkjef3slu',
        'anon_workspace_aadkpkjef3slu']) {
        assert.equal((await asRole(role,'actor',tx => tx`SELECT attempt_id
          FROM action_attempt WHERE subject_kind='ACQUISITION'`)).length, 0);
        await assert.rejects(asRole(role,'actor',tx => tx`INSERT INTO dm_acquisition VALUES
          ('ACQ-FORGED','SRC-1',NULL,'wiselink_drive_source','fixture','bucket',
            '/source.pdf','file-1','v1','actor',CURRENT_TIMESTAMP,
            'tenant:t1:request:forged','{}','ACQUIRED_READBACK_VERIFIED')`),
        error => error.code === '42501');
      }
      assert.equal((await asRole('authenticated_workspace_aadkpkjef3slu','actor',
        tx => tx`DELETE FROM dm_acquisition WHERE acquisition_id='ACQ-LEGACY'
          RETURNING acquisition_id`)).length, 1);
      assert.equal((await admin`SELECT count(*)::int AS count FROM dm_acquisition
        WHERE acquisition_id='ACQ-LEGACY'`)[0].count, 0);
    } finally {
      await pool.end();
      await admin.end();
    }
  });
