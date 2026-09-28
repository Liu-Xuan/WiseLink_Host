import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import postgres from 'postgres';

const databaseUrl = process.env.DOCUMENT_DELIVERY_TEST_DATABASE_URL;

test('draft upload authorization: exact legacy link works, actor intent remains blocked',
  { skip: !databaseUrl }, async () => {
    // The draft migration creates application-schema functions and policies. Only run it
    // against a disposable, explicitly named database, never an app database.
    assert.match(new URL(databaseUrl).pathname, /^\/wl_delivery_test(?:_[a-z0-9_]+)?$/u);
    const db = postgres(databaseUrl, { max: 1, onnotice() {} });
    try {
      await db.unsafe('CREATE SCHEMA IF NOT EXISTS workspace_aadkpkjef3slu; SET search_path TO workspace_aadkpkjef3slu, public');
      await db.unsafe(`
        DROP TABLE IF EXISTS auto_document_delivery_authorization,action_attempt,
          work_item,dm_acquisition,dm_ingress_preflight,dm_document_version,
          dm_publication_family,dm_source_artifact CASCADE;
        DROP FUNCTION IF EXISTS auto_document_delivery_register_upload() CASCADE;
        DROP FUNCTION IF EXISTS auto_document_delivery_freeze_upload() CASCADE;
        DROP FUNCTION IF EXISTS auto_document_delivery_freeze_upload_preflight() CASCADE;
        DROP FUNCTION IF EXISTS auto_document_delivery_preserve() CASCADE;
        DROP TYPE IF EXISTS user_profile CASCADE;
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
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role_workspace_other') THEN
            CREATE ROLE service_role_workspace_other NOLOGIN;
          END IF;
        END $$;
        CREATE TYPE user_profile AS (user_id text);
        CREATE TABLE action_attempt (action_type text NOT NULL, task_envelope_json text);
        CREATE TABLE work_item (work_item_id text PRIMARY KEY);
        CREATE TABLE dm_source_artifact (source_artifact_id text PRIMARY KEY,
          sha256 text NOT NULL, byte_length bigint NOT NULL, readback_verified boolean NOT NULL);
        CREATE TABLE dm_publication_family (family_id text PRIMARY KEY,
          canonical_identity_key text NOT NULL);
        CREATE TABLE dm_document_version (document_version_id text PRIMARY KEY,
          family_id text NOT NULL, acquisition_id text NOT NULL, source_artifact_id text NOT NULL,
          committed_by text NOT NULL, pdf_sha256 text NOT NULL, byte_length bigint NOT NULL,
          lifecycle_status text NOT NULL);
        CREATE TABLE dm_ingress_preflight (preflight_id text PRIMARY KEY, acquisition_id text NOT NULL,
          status text NOT NULL, execution_authorized boolean NOT NULL, decision text NOT NULL,
          document_version_id text, commit_idempotency_key text,
          normalized_descriptor_json text NOT NULL,branch text NOT NULL DEFAULT 'fixture',
          observed_current_generation integer NOT NULL DEFAULT 0,
          observed_current_document_version_id text,decision_payload_json text NOT NULL DEFAULT '{}',
          committed_at timestamptz);
        CREATE TABLE dm_acquisition (acquisition_id text PRIMARY KEY,
          source_artifact_id text NOT NULL, document_version_id text,
          source_channel text NOT NULL, source_ref text NOT NULL,
          selection_bucket_id text NOT NULL, selection_file_path text NOT NULL,
          provider_object_id text NOT NULL, provider_version_id text NOT NULL,
          acquired_by text NOT NULL, acquired_at timestamptz NOT NULL,
          idempotency_key text NOT NULL, source_descriptor_json text NOT NULL,
          status text NOT NULL);
        ALTER TABLE action_attempt ENABLE ROW LEVEL SECURITY;
        ALTER TABLE dm_acquisition ENABLE ROW LEVEL SECURITY;
        ALTER TABLE dm_ingress_preflight ENABLE ROW LEVEL SECURITY;
        CREATE POLICY old_action_actor ON action_attempt FOR ALL TO authenticated USING (true)
          WITH CHECK (true);
        CREATE POLICY old_action_workspace_actor ON action_attempt FOR ALL TO authenticated_workspace_aadkpkjef3slu USING (true)
          WITH CHECK (true);
        CREATE POLICY service_action ON action_attempt FOR ALL TO service_role USING (true)
          WITH CHECK (true);
        CREATE POLICY workspace_service_action ON action_attempt FOR ALL TO service_role_workspace_aadkpkjef3slu USING (true)
          WITH CHECK (true);
        CREATE POLICY old_acquisition_actor ON dm_acquisition FOR ALL TO authenticated USING (true)
          WITH CHECK (true);
        CREATE POLICY old_acquisition_workspace_actor ON dm_acquisition FOR ALL TO authenticated_workspace_aadkpkjef3slu USING (true)
          WITH CHECK (true);
        CREATE POLICY old_preflight_actor ON dm_ingress_preflight FOR ALL TO authenticated USING (true)
          WITH CHECK (true);
        CREATE POLICY old_preflight_workspace_actor ON dm_ingress_preflight FOR ALL TO authenticated_workspace_aadkpkjef3slu USING (true)
          WITH CHECK (true);
        CREATE POLICY service_acquisition ON dm_acquisition FOR ALL TO service_role USING (true)
          WITH CHECK (true);
        CREATE POLICY service_preflight ON dm_ingress_preflight FOR ALL TO service_role USING (true)
          WITH CHECK (true);
        CREATE POLICY workspace_service_acquisition ON dm_acquisition FOR ALL TO service_role_workspace_aadkpkjef3slu USING (true)
          WITH CHECK (true);
        CREATE POLICY workspace_service_preflight ON dm_ingress_preflight FOR ALL TO service_role_workspace_aadkpkjef3slu USING (true)
          WITH CHECK (true);
        GRANT USAGE ON SCHEMA workspace_aadkpkjef3slu TO authenticated,service_role,
          authenticated_workspace_aadkpkjef3slu,service_role_workspace_aadkpkjef3slu,
          service_role_workspace_other;
        GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON action_attempt TO authenticated;
        GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON action_attempt TO authenticated_workspace_aadkpkjef3slu;
        GRANT SELECT,INSERT,UPDATE,DELETE ON work_item TO authenticated;
        GRANT SELECT,INSERT,UPDATE,DELETE ON work_item TO authenticated_workspace_aadkpkjef3slu;
        GRANT SELECT,INSERT ON action_attempt,work_item TO service_role;
        GRANT SELECT,INSERT ON action_attempt,work_item TO service_role_workspace_aadkpkjef3slu;
        GRANT SELECT,UPDATE ON dm_acquisition TO authenticated;
        GRANT SELECT,UPDATE,DELETE,TRUNCATE ON dm_acquisition TO authenticated_workspace_aadkpkjef3slu;
        GRANT SELECT,UPDATE ON dm_acquisition,dm_ingress_preflight TO service_role;
        GRANT SELECT,UPDATE ON dm_acquisition,dm_ingress_preflight TO service_role_workspace_aadkpkjef3slu;
        GRANT INSERT,UPDATE ON dm_ingress_preflight TO authenticated;
        GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON dm_ingress_preflight TO authenticated_workspace_aadkpkjef3slu;
        GRANT SELECT ON dm_source_artifact,dm_document_version,dm_publication_family,
          dm_ingress_preflight TO authenticated,authenticated_workspace_aadkpkjef3slu;
        INSERT INTO dm_source_artifact VALUES ('SRC-1',repeat('a',64),100,true),
          ('SRC-BAD',repeat('b',64),100,true);
        INSERT INTO dm_publication_family VALUES ('FAM-1','tenant:t1:family:fixture');
        INSERT INTO dm_document_version VALUES
          ('DV-1','FAM-1','ACQ-OLD','SRC-1','actor-old',repeat('a',64),100,
            'COMMITTED_IMMUTABLE');
        INSERT INTO dm_ingress_preflight(preflight_id,acquisition_id,status,execution_authorized,
          decision,document_version_id,commit_idempotency_key,normalized_descriptor_json) VALUES
          ('PF-NEW','ACQ-NEW','READY',false,'REUSE_EXACT',NULL,NULL,
            json_build_object('sha256',repeat('a',64),'sizeBytes',100)::text),
          ('PF-BAD','ACQ-BAD','READY',false,'REUSE_EXACT',NULL,NULL,
            json_build_object('sha256',repeat('b',64),'sizeBytes',100)::text);
        INSERT INTO dm_acquisition VALUES
          ('ACQ-NEW','SRC-1',NULL,'document_library_upload','fixture',
            'bucket','path','object','version','actor-new',CURRENT_TIMESTAMP,
            'tenant:t1:request:new',
            '{"documentDeliveryIntent":{"reading":true,"translation":"NONE"}}',
            'ACQUIRED_READBACK_VERIFIED'),
          ('ACQ-BAD','SRC-BAD',NULL,'document_library_upload','fixture',
            'bucket','path','object','version','actor-new',CURRENT_TIMESTAMP,
            'tenant:t1:request:bad',
            '{"documentDeliveryIntent":{"reading":true,"translation":"NONE"}}',
            'ACQUIRED_READBACK_VERIFIED');
      `);
      const migration = await readFile(resolve('migrations/0067_document_upload_delivery_authorization.sql'), 'utf8');
      await db.unsafe('GRANT TRUNCATE ON action_attempt TO PUBLIC');
      await assert.rejects(db.unsafe(migration), /DOCUMENT_DELIVERY_BROWSER_TRUNCATE_REMAINS/u);
      await db.unsafe('ROLLBACK');
      await db.unsafe('REVOKE TRUNCATE ON action_attempt FROM PUBLIC');
      await db.unsafe('SET search_path TO public');
      await assert.rejects(db.unsafe(migration), /DOCUMENT_DELIVERY_APP_SCHEMA_OR_ROLE_MISMATCH/u);
      await db.unsafe('ROLLBACK');
      await db.unsafe('SET search_path TO workspace_aadkpkjef3slu, public');
      await db.unsafe(migration);

      const asActor = (work) => db.begin(async (tx) => {
        await tx.unsafe('SET LOCAL ROLE authenticated_workspace_aadkpkjef3slu');
        await tx`SELECT set_config('app.user_id','actor-new',true)`;
        assert.equal((await tx`SELECT current_user AS role`)[0].role, 'authenticated_workspace_aadkpkjef3slu');
        return work(tx);
      });
      await assert.rejects(asActor((tx) => tx`UPDATE dm_acquisition
        SET status='LINKED_EXACT_DOCUMENT_VERSION',document_version_id='DV-1'
        WHERE acquisition_id='ACQ-NEW'`), (error) => error.code === '42501');
      await assert.rejects(asActor((tx) => tx`UPDATE dm_acquisition
        SET status='COMMITTED_CANONICAL',document_version_id='DV-1'
        WHERE acquisition_id='ACQ-NEW'`), (error) => error.code === '42501');
      await assert.rejects(asActor((tx) => tx`UPDATE dm_ingress_preflight
        SET decision='INGEST_NEW_FAMILY' WHERE preflight_id='PF-NEW'`),
      /DOCUMENT_UPLOAD_PREFLIGHT_HOST_COMMIT_REQUIRED/u);
      await assert.rejects(asActor((tx) => tx`UPDATE dm_ingress_preflight
        SET status='COMMITTED' WHERE preflight_id='PF-NEW'`),
      /DOCUMENT_UPLOAD_PREFLIGHT_HOST_COMMIT_REQUIRED/u);
      await assert.rejects(asActor((tx) => tx`INSERT INTO dm_ingress_preflight
        (preflight_id,acquisition_id,status,execution_authorized,decision,
          document_version_id,commit_idempotency_key,normalized_descriptor_json)
        VALUES ('PF-FORGED','ACQ-NEW','COMMITTED',false,'REUSE_EXACT','DV-1',
          'catalog:ACQ-NEW','{}')`), (error) => error.code === '42501');
      await asActor((tx) => tx`INSERT INTO dm_ingress_preflight
        (preflight_id,acquisition_id,status,execution_authorized,decision,
          document_version_id,commit_idempotency_key,normalized_descriptor_json)
        VALUES ('PF-READY-FORGED','ACQ-NEW','READY',false,'REUSE_EXACT',NULL,NULL,
          ${JSON.stringify({ sha256: 'a'.repeat(64), sizeBytes: 100 })})`);
      assert.equal((await db`SELECT count(*)::int AS count
        FROM auto_document_delivery_authorization`)[0].count, 0);
      for (const table of ['action_attempt', 'dm_acquisition', 'dm_ingress_preflight']) {
        await assert.rejects(asActor((tx) => tx.unsafe(`TRUNCATE ${table}`)),
          (error) => error.code === '42501');
      }
      assert.equal((await db`SELECT status,decision FROM dm_ingress_preflight
        WHERE preflight_id='PF-NEW'`)[0].decision, 'REUSE_EXACT');
      assert.equal((await db`SELECT count(*)::int AS count FROM auto_document_delivery_authorization`)[0].count, 0);
      const asService = (work) => db.begin(async (tx) => {
        await tx.unsafe('SET LOCAL ROLE service_role_workspace_aadkpkjef3slu');
        await tx`SELECT set_config('app.user_id','actor-new',true)`;
        assert.equal((await tx`SELECT current_user AS role`)[0].role, 'service_role_workspace_aadkpkjef3slu');
        return work(tx);
      });
      // The new-version residual replay path may use COMMITTED_CANONICAL only
      // for a version owned by this acquisition. An old exact version must use
      // LINKED_EXACT_DOCUMENT_VERSION and its READY exact-link preflight.
      await assert.rejects(asService((tx) => tx`UPDATE dm_acquisition
        SET status='COMMITTED_CANONICAL',document_version_id='DV-1'
        WHERE acquisition_id='ACQ-NEW'`), /DOCUMENT_DELIVERY_SOURCE_MISMATCH/u);
      assert.equal((await db`SELECT count(*)::int AS count
        FROM auto_document_delivery_authorization`)[0].count, 0);
      await assert.rejects(asService(async (tx) => {
        await tx`UPDATE dm_acquisition SET status='LINKED_EXACT_DOCUMENT_VERSION',
          document_version_id='DV-1' WHERE acquisition_id='ACQ-NEW'`;
        throw new Error('ROLLBACK_PROBE');
      }), /ROLLBACK_PROBE/u);
      assert.equal((await db`SELECT status FROM dm_acquisition
        WHERE acquisition_id='ACQ-NEW'`)[0].status, 'ACQUIRED_READBACK_VERIFIED');
      assert.equal((await db`SELECT count(*)::int AS count FROM auto_document_delivery_authorization`)[0].count, 0);
      await asService(async (tx) => {
        await tx`UPDATE dm_acquisition SET status='LINKED_EXACT_DOCUMENT_VERSION',
          document_version_id='DV-1' WHERE acquisition_id='ACQ-NEW'`;
        await tx`UPDATE dm_ingress_preflight SET status='COMMITTED',
          document_version_id='DV-1',commit_idempotency_key='catalog:ACQ-NEW'
          WHERE preflight_id='PF-NEW' AND status='READY'`;
      });
      const [registered] = await db`SELECT acquisition_id,tenant_key,actor_user_id,
        document_version_id,source_artifact_id,reading,translation
        FROM auto_document_delivery_authorization`;
      assert.deepEqual(registered, {
        acquisition_id: 'ACQ-NEW', tenant_key: 't1', actor_user_id: 'actor-new',
        document_version_id: 'DV-1', source_artifact_id: 'SRC-1',
        reading: true, translation: 'NONE',
      });
      const [audit] = await db`SELECT _created_at IS NOT NULL AS created_at_present,
        _updated_at IS NOT NULL AS updated_at_present,
        (_created_by).user_id AS created_by,(_updated_by).user_id AS updated_by
        FROM auto_document_delivery_authorization WHERE acquisition_id='ACQ-NEW'`;
      assert.deepEqual(audit, { created_at_present: true, updated_at_present: true,
        created_by: 'actor-new', updated_by: 'actor-new' });
      assert.equal((await db`SELECT status FROM dm_ingress_preflight
        WHERE preflight_id='PF-NEW'`)[0].status, 'COMMITTED');
      await assert.rejects(asService((tx) => tx`UPDATE dm_acquisition
        SET status='LINKED_EXACT_DOCUMENT_VERSION',document_version_id='DV-1'
        WHERE acquisition_id='ACQ-BAD'`), /DOCUMENT_DELIVERY_SOURCE_MISMATCH/u);
      assert.equal((await db`SELECT count(*)::int AS count
        FROM auto_document_delivery_authorization`)[0].count, 1);

      const asSqlRole = (role, actor, work) => db.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE ${role}`);
        await tx`SELECT set_config('app.user_id',${actor},true)`;
        return work(tx);
      });
      const authTable = 'auto_document_delivery_authorization';
      for (const role of ['authenticated', 'authenticated_workspace_aadkpkjef3slu',
        'service_role', 'service_role_workspace_other']) {
        await assert.rejects(asSqlRole(role, 'actor-new',
          (tx) => tx.unsafe(`SELECT * FROM ${authTable}`)),
        (error) => error.code === '42501');
      }
      await assert.rejects(asService((tx) => tx`INSERT INTO auto_document_delivery_authorization
        (acquisition_id,tenant_key,actor_user_id,document_version_id,source_artifact_id,reading,translation)
        VALUES ('ACQ-BAD','t1','actor-new','DV-1','SRC-BAD',true,'NONE')`),
      (error) => error.code === '42501');
      await assert.rejects(asService((tx) => tx`DELETE FROM auto_document_delivery_authorization
        WHERE acquisition_id='ACQ-NEW'`), (error) => error.code === '42501');
      await assert.rejects(asService((tx) => tx`UPDATE auto_document_delivery_authorization
        SET reading=false WHERE acquisition_id='ACQ-NEW'`), (error) => error.code === '42501');
      assert.equal((await asSqlRole('service_role_workspace_aadkpkjef3slu', 'actor-other',
        (tx) => tx`UPDATE auto_document_delivery_authorization SET status='ADMITTED',
          admitted_at=CURRENT_TIMESTAMP WHERE acquisition_id='ACQ-NEW' RETURNING acquisition_id`)).length, 0);
      assert.equal((await asService((tx) => tx`SELECT acquisition_id
        FROM auto_document_delivery_authorization`)).length, 1);
      assert.equal((await asService((tx) => tx`UPDATE auto_document_delivery_authorization
        SET status='ADMITTED',admitted_at=CURRENT_TIMESTAMP
        WHERE acquisition_id='ACQ-NEW' RETURNING acquisition_id`)).length, 1);
      const [admittedAudit] = await db`SELECT _updated_at>=_created_at AS updated,
        (_updated_by).user_id AS updated_by FROM auto_document_delivery_authorization
        WHERE acquisition_id='ACQ-NEW'`;
      assert.deepEqual(admittedAudit, { updated: true, updated_by: 'actor-new' });
      assert.equal((await asService((tx) => tx`UPDATE auto_document_delivery_authorization
        SET status='ADMITTED',admitted_at=CURRENT_TIMESTAMP
        WHERE acquisition_id='ACQ-NEW' RETURNING acquisition_id`)).length, 0);

      for (const selection of [null, { reading: true, translation: 'NONE' }]) {
        await assert.rejects(asActor(async (tx) => {
          await tx`INSERT INTO work_item VALUES ('WI-ROLLBACK')`;
          await tx`INSERT INTO action_attempt(action_type) VALUES ('PARSE_PDF')`;
          await tx`INSERT INTO action_attempt(action_type,task_envelope_json)
            VALUES ('DOCUMENT_DELIVERY_INTENT',${JSON.stringify(selection)})`;
        }), (error) => error.code === '42501');
        assert.equal((await db`SELECT count(*)::int AS count FROM work_item`)[0].count, 0);
        assert.equal((await db`SELECT count(*)::int AS count FROM action_attempt`)[0].count, 0);
      }
      for (const [index, selection] of [null, { reading: true, translation: 'NONE' }].entries()) {
        await assert.rejects(asService(async (tx) => {
          await tx`INSERT INTO work_item VALUES (${`WI-ROLLBACK-${index}`})`;
          await tx`INSERT INTO action_attempt(action_type,task_envelope_json)
            VALUES ('DOCUMENT_DELIVERY_INTENT',${JSON.stringify(selection)})`;
          throw new Error('RESERVE_ROLLBACK_PROBE');
        }), /RESERVE_ROLLBACK_PROBE/u);
        assert.equal((await db`SELECT count(*)::int AS count FROM work_item`)[0].count, index);
        await asService(async (tx) => {
          await tx`INSERT INTO work_item VALUES (${`WI-SAVED-${index}`})`;
          await tx`INSERT INTO action_attempt(action_type,task_envelope_json)
            VALUES ('DOCUMENT_DELIVERY_INTENT',${JSON.stringify(selection)})`;
        });
      }
      assert.equal((await db`SELECT count(*)::int AS count FROM work_item`)[0].count, 2);
      assert.deepEqual((await db`SELECT task_envelope_json FROM action_attempt ORDER BY task_envelope_json`)
        .map((row) => JSON.parse(row.task_envelope_json)),
      [null, { reading: true, translation: 'NONE' }]);
    } finally {
      await db.end();
    }
  });
