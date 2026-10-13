import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  nativeSharedReadTables,
  nativeTenantReadAclPreflightSql,
  prepareNativeTenantReadDdl,
} from '../../scripts/prepare-native-tenant-read-ddl.mjs';

const schema = 'workspace_aadkpkjef3slu';
const auth = `authenticated_${schema}`;
const service = `service_role_${schema}`;
const anon = `anon_${schema}`;
const quote = value => `"${value.replaceAll('"', '""')}"`;

test('prepared native shared read uses real PostgreSQL roles and RLS',
  { timeout: 120000, concurrency: false }, async t => {
    const base = mkdtempSync(join(tmpdir(), 'wl-native-rls-'));
    const cluster = join(base, 'db');
    const socket = join(base, 's');
    const port = String(54000 + Math.floor(Math.random() * 9000));
    let started = false;
    const call = (command, args, input) => execFileSync(command, args, {
      input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    const psql = sql => call('psql', [
      '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', socket, '-p', port,
      '-U', 'postgres', '-d', 'postgres',
    ], sql).trim();
    try {
      call('initdb', ['-A', 'trust', '-U', 'postgres', '-D', cluster]);
      call('mkdir', ['-p', socket]);
      call('pg_ctl', ['-D', cluster, '-l', join(base, 'postgres.log'),
        '-o', `-k ${socket} -p ${port} -F`,
        '-w', 'start']);
      started = true;
      const baseSql = [
        `CREATE SCHEMA ${quote(schema)};`,
        `CREATE ROLE ${quote(auth)};`,
        `CREATE ROLE ${quote(service)};`,
        `CREATE ROLE ${quote(anon)};`,
        `GRANT ${quote(auth)}, ${quote(service)}, ${quote(anon)} TO postgres;`,
        `GRANT USAGE ON SCHEMA ${quote(schema)} TO ${quote(auth)},
          ${quote(service)}, ${quote(anon)};`,
        `SET search_path TO ${quote(schema)}, public;`,
        `CREATE FUNCTION engineering_matter_uri_component(value text)
          RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT value $$;`,
      ];
      const policies = [];
      for (const table of nativeSharedReadTables) {
        baseSql.push(`CREATE TABLE ${quote(table)} (
          id text, tenant_id varchar, actor_id text, work_item_id varchar,
          review_conversation_id text, family_id varchar,
          canonical_identity_key text, document_version_id varchar,
          acquisition_id varchar, source_artifact_id varchar,
          idempotency_key text, readback_verified boolean, status text,
          document_id varchar, source_file_sha256 varchar,
          source_byte_length bigint, pdf_sha256 varchar, sha256 varchar,
          byte_length bigint,
          matter_id varchar, matter_revision_id varchar, material_json text,
          summary_id varchar, wiki_id varchar, kind text, subject_id varchar,
          input_type text, adoption_status text, response_type text,
          assistant_response text, source_refs_json text,
          missing_inputs_json text, candidate_evidence_refs_json text,
          review_action_draft_json text, affected_item_ids_json text,
          warnings_json text, result_provenance_json text,
          result_content_hash text, action_attempt_id text,
          assistant_completed_at timestamptz, attempt_ref text,
          message_ref text, purpose text, executor text,
          attempt_id text, actor_user_id text, requested_by_user_id text,
          action_type text, review_turn_id text);`);
        baseSql.push(`ALTER TABLE ${quote(table)} ENABLE ROW LEVEL SECURITY;`);
        baseSql.push(`ALTER TABLE ${quote(table)} FORCE ROW LEVEL SECURITY;`);
        baseSql.push(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${quote(table)}
          TO ${quote(auth)}, ${quote(service)}, ${quote(anon)};`);
        const name = `legacy_select_${table}`;
        baseSql.push(`CREATE POLICY ${quote(name)} ON ${quote(table)}
          FOR SELECT TO ${quote(auth)} USING (actor_id=current_setting('app.user_id',true));`);
        policies.push({ schemaname: schema, tablename: table, policyname: name,
          cmd: 'SELECT', permissive: 'PERMISSIVE', roles: `{${auth}}`,
          qual: "actor_id=current_setting('app.user_id',true)", with_check: null });
      }
      baseSql.push(`CREATE POLICY legacy_wi_write ON work_item FOR ALL
        TO ${quote(auth)} USING (true) WITH CHECK (true);`);
      policies.push({ schemaname: schema, tablename: 'work_item',
        policyname: 'legacy_wi_write', cmd: 'ALL', permissive: 'PERMISSIVE',
        roles: `{${auth}}`, qual: 'true', with_check: 'true' });
      baseSql.push(`CREATE POLICY legacy_summary_owner ON derived_summary
        AS RESTRICTIVE FOR ALL TO ${quote(auth)}, ${quote(service)}
        USING (actor_id=current_setting('app.user_id',true))
        WITH CHECK (actor_id=current_setting('app.user_id',true));`);
      policies.push({ schemaname: schema, tablename: 'derived_summary',
        policyname: 'legacy_summary_owner', cmd: 'ALL',
        permissive: 'RESTRICTIVE', roles: `{${auth},${service}}`,
        qual: "actor_id=current_setting('app.user_id',true)",
        with_check: "actor_id=current_setting('app.user_id',true)" });
      baseSql.push(`CREATE POLICY legacy_summary_service ON derived_summary
        FOR ALL TO ${quote(service)} USING (true) WITH CHECK (true);`);
      baseSql.push(`CREATE POLICY legacy_summary_actor ON derived_summary
        FOR ALL TO ${quote(auth)} USING (true) WITH CHECK (true);`);
      policies.push({ schemaname: schema, tablename: 'derived_summary',
        policyname: 'legacy_summary_actor', cmd: 'ALL',
        permissive: 'PERMISSIVE', roles: `{${auth}}`,
        qual: 'true', with_check: 'true' });
      psql(baseSql.join('\n'));
      psql(`REVOKE SELECT ON ${quote(schema)}.hierarchical_wiki_scope
        FROM ${quote(auth)};`);
      psql('ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;');

      const template = await readFile(new URL('../../migrations/0078_native_tenant_shared_read.sql', import.meta.url), 'utf8');
      assert.throws(() => prepareNativeTenantReadDdl({
        template,
        snapshot: { ok: true, data: policies.filter(policy =>
          !policy.tablename.startsWith('hierarchical_wiki_')) },
      }), /NATIVE_READ_REQUIRED_TABLES_MISSING:hierarchical_wiki_/u);
      const prepared = prepareNativeTenantReadDdl({
        template, snapshot: { ok: true, data: policies },
      });
      assert.doesNotMatch(prepared, /\b(?:GRANT|REVOKE)\b/iu);
      assert.match(prepared, /has_table_privilege/u);
      assert.match(prepareNativeTenantReadDdl({
        template, snapshot: { ok: true, data: policies },
        permissionMode: 'managed',
      }), /GRANT SELECT ON "work_item"/u);
      const aclSql = nativeTenantReadAclPreflightSql();
      assert.match(aclSql, /has_table_privilege/u);
      assert.match(aclSql, /has_function_privilege/u);
      assert.match(psql(aclSql), /hierarchical_wiki_scope\|f/u);
      assert.match(psql(aclSql),
        /native_app_document_readable\(varchar,varchar\)\|NOT_INSTALLED\|NOT_INSTALLED/u);
      const preparedFile = join(base, 'prepared.sql');
      writeFileSync(preparedFile,
        `SET client_min_messages TO WARNING;\nSET search_path TO ${quote(schema)}, public;\n${prepared}`);
      const deploy = () => call('psql', [
        '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', socket,
        '-p', port, '-U', 'postgres', '-d', 'postgres', '-f', preparedFile,
      ]);
      assert.throws(deploy, /NATIVE_READ_AUTH_SELECT_ACL_MISSING: hierarchical_wiki_scope/u);
      assert.equal(psql(`SELECT count(*) FROM pg_proc
        WHERE pronamespace='${schema}'::regnamespace
          AND proname='native_app_shared_read_allowed';`), '0');
      assert.equal(psql(`SELECT count(*) FROM pg_policies
        WHERE schemaname='${schema}' AND policyname='nr78_shared_read';`), '0');
      psql(`GRANT SELECT ON ${quote(schema)}.hierarchical_wiki_scope
        TO ${quote(auth)};`);
      assert.doesNotMatch(psql(aclSql), /\|f(?:\n|$)/u);
      assert.throws(deploy, /NATIVE_READ_AUTH_EXECUTE_ACL_MISSING/u);
      assert.equal(psql(`SELECT count(*) FROM pg_proc
        WHERE pronamespace='${schema}'::regnamespace
          AND proname='native_app_shared_read_allowed';`), '0');
      assert.equal(psql(`SELECT count(*) FROM pg_policies
        WHERE schemaname='${schema}' AND policyname='nr78_shared_read';`), '0');
      const functions = [
        ['native_app_shared_read_allowed(target_tenant varchar)',
          'native_app_shared_read_allowed(varchar)', true],
        ['native_app_work_item_readable(target_tenant varchar,target_work_item varchar)',
          'native_app_work_item_readable(varchar,varchar)', true],
        ['native_app_document_readable(target_tenant varchar,target_document_version varchar)',
          'native_app_document_readable(varchar,varchar)', true],
        ['native_app_dm_related_readable(target_tenant varchar,entity_kind varchar,entity_id varchar)',
          'native_app_dm_related_readable(varchar,varchar,varchar)', true],
        ['native_app_matter_revision_readable(target_tenant varchar,target_matter_revision varchar)',
          'native_app_matter_revision_readable(varchar,varchar)', true],
        ['wiselink_native_reviewer(target_tenant text)',
          'wiselink_native_reviewer(text)', false],
      ];
      psql(`SET search_path TO ${quote(schema)}, public;\n` + functions.map(
        ([definition]) => `CREATE FUNCTION ${definition}
          RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;`,
      ).join('\n'));
      psql(`SET search_path TO ${quote(schema)}, public;\n` + functions.map(
        ([, signature]) => `GRANT EXECUTE ON FUNCTION ${signature}
          TO ${quote(auth)};`,
      ).join('\n'));
      assert.match(psql(aclSql),
        /native_app_document_readable\(varchar,varchar\)\|OK\|MISSING/u);
      assert.throws(deploy, /NATIVE_READ_SERVICE_EXECUTE_ACL_MISSING/u);
      assert.equal(psql(`SELECT count(*) FROM pg_policies
        WHERE schemaname='${schema}' AND policyname='nr78_shared_read';`), '0');
      psql(`SET search_path TO ${quote(schema)}, public;\n` + functions
        .filter(([, , serviceRequired]) => serviceRequired)
        .map(([, signature]) => `GRANT EXECUTE ON FUNCTION ${signature}
          TO ${quote(service)};`).join('\n'));
      assert.match(psql(aclSql),
        /native_app_document_readable\(varchar,varchar\)\|OK\|OK/u);
      deploy();
      assert.equal(psql(`SET search_path TO ${quote(schema)}, public;
        SELECT has_function_privilege('${anon}',
          '${schema}.native_app_document_readable(character varying,character varying)',
          'EXECUTE');`), 'f');
      psql(`SET search_path TO ${quote(schema)}, public;\n` + functions.map(
        ([, signature]) => `GRANT EXECUTE ON FUNCTION ${signature}
          TO PUBLIC;`,
      ).join('\n'));
      psql(`SET search_path TO ${quote(schema)}, public;
        INSERT INTO work_item(id,tenant_id,actor_id,work_item_id,
          requested_by_user_id)
          VALUES ('A','63849986','A','WI-A','A'),
            ('B','63849986','B','WI-B','B'),
            ('X','other','X','WI-X','X');
        INSERT INTO action_attempt(id,tenant_id,actor_user_id,work_item_id,
          attempt_id,action_type)
          VALUES ('AT-A','63849986','A','WI-A','AT-A',
            'OPENCLAW_DYNAMIC_EVALUATION');
        INSERT INTO derived_summary(id,tenant_id,actor_id)
          VALUES ('SA','63849986','A'),('SB','63849986','B'),('SX','other','X');
        INSERT INTO dm_publication_family(id,canonical_identity_key,family_id)
          VALUES ('FA','tenant:63849986:family:a','FA'),
            ('FX','tenant:other:family:x','FX');
        INSERT INTO dm_document_version(id,document_version_id,family_id,
          acquisition_id,source_artifact_id,document_id,pdf_sha256,byte_length)
          VALUES ('VA','VA','FA','AA','SA','DA','HASH-A',10),
            ('VH','VH','FH','AH','SH','DH','HASH-H',20),
            ('VM','VM','FM','AM','SM','DM','HASH-M',30),
            ('VN','VN','FN','AN','SN','DN','HASH-N',40),
            ('VX','VX','FX','AX','SX','DX','HASH-X',50),
            ('VC','VC','FX','AC','SC','DC','HASH-C',60);
        INSERT INTO dm_acquisition(id,acquisition_id,source_artifact_id,
          document_version_id,idempotency_key,status)
          VALUES ('AA','AA','SA','VA','tenant:63849986:request:a',
            'COMMITTED_CANONICAL'),
            ('AH','AH','SH','VH','legacy-h','COMMITTED_CANONICAL'),
            ('AM','AM','SM','VM','legacy-m','COMMITTED_CANONICAL'),
            ('AN','AN','SN','VN','legacy-n','COMMITTED_CANONICAL'),
            ('AX','AX','SX','VX','tenant:other:request:x','COMMITTED_CANONICAL'),
            ('AC','AC','SC','VC','legacy-c','COMMITTED_CANONICAL');
        INSERT INTO dm_source_artifact(id,source_artifact_id,readback_verified,
          sha256,byte_length)
          VALUES ('SA','SA',true,'HASH-A',10),
            ('SH','SH',true,'HASH-H',20),('SM','SM',true,'HASH-M',30),
            ('SN','SN',true,'HASH-N',40),('SX','SX',true,'HASH-X',50),
            ('SC','SC',true,'HASH-C',60);
        INSERT INTO dm_publication_family(id,canonical_identity_key,family_id)
          VALUES ('FH','legacy-h','FH'),('FM','legacy-m','FM'),
            ('FN','legacy-n','FN');
        INSERT INTO dm_document(id,document_id,family_id)
          VALUES ('DH','DH','FH'),('DM','DM','FM'),('DN','DN','FN'),
            ('DX','DX','FX');
        INSERT INTO dm_document_version_metadata(id,document_version_id)
          VALUES ('MH','VH'),('MM','VM'),('MN','VN');
        INSERT INTO dm_currentness_decision(id,family_id)
          VALUES ('CH','FH'),('CM','FM'),('CN','FN');
        INSERT INTO dm_ingress_preflight(id,acquisition_id)
          VALUES ('PH','AH'),('PM','AM'),('PN','AN');
        INSERT INTO work_item(id,tenant_id,actor_id,work_item_id,
          requested_by_user_id,document_version_id,document_id,
          source_artifact_id,source_file_sha256,source_byte_length)
          VALUES ('WH','63849986','A','WI-H','A','VH','DH','SH','HASH-H',20),
            ('WM','63849986','A','WI-M','A','VM','DM','SM','WRONG',30),
            ('WC','63849986','A','WI-C','A','VC','DC','SC','HASH-C',60);
        INSERT INTO review_conversation(id,tenant_id,actor_id,work_item_id,
          review_conversation_id) VALUES
          ('CA','63849986','A','WI-A','CA'),
          ('CB','63849986','B','WI-A','CB');
        INSERT INTO review_turn(id,tenant_id,actor_id,work_item_id,
          review_conversation_id,review_turn_id,input_type,adoption_status)
          VALUES ('TA','63849986','A','WI-A','CA','TA',
            'ENGINEER_TEXT','CANDIDATE_UNADOPTED'),
            ('TB-SEED','63849986','B','WI-A','CB','TB-SEED',
              'ENGINEER_TEXT','CANDIDATE_UNADOPTED');
        INSERT INTO engineer_supplied_input(id,tenant_id,actor_id,work_item_id,
          review_conversation_id) VALUES
          ('IA','63849986','A','WI-A','CA');
        INSERT INTO dialogue_thread(id,tenant_id,actor_id)
          VALUES ('DTA','63849986','A'),('DTB','63849986','B');
        INSERT INTO dialogue_message(id,tenant_id,actor_id,message_ref,
          purpose,executor)
          VALUES ('DMA','63849986','A','MA','CHAT','AILY'),
            ('DMB','63849986','B','MB','CHAT','AILY');
        INSERT INTO discussion_contribution(id,tenant_id,actor_id,work_item_id)
          VALUES ('DCA','63849986','A','WI-A'),
            ('DCB','63849986','B','WI-A');
        INSERT INTO dialogue_assessment_request(id,tenant_id,actor_id,
          work_item_id) VALUES ('DRA','63849986','A','WI-A'),
            ('DRB','63849986','B','WI-A');
        INSERT INTO review_aily_query(id,tenant_id,actor_id,message_ref)
          VALUES ('RA','63849986','A','MA'),('RB','63849986','B','MB');
        INSERT INTO review_aily_query(id,tenant_id,actor_id,attempt_ref)
          VALUES ('R-RECEIPT','63849986','A','AT-A');
        INSERT INTO engineering_matter(id,tenant_id,matter_id)
          VALUES ('M','63849986','M');
        INSERT INTO engineering_matter_revision(id,tenant_id,matter_id,
          matter_revision_id)
          VALUES ('R','63849986','M','R'),('R2','63849986','M','R2');
        INSERT INTO engineering_matter_revision_work_item(
          id,tenant_id,matter_revision_id,work_item_id)
          VALUES ('L','63849986','R','WI-A');
        INSERT INTO engineering_matter_material_link(id,tenant_id,
          matter_revision_id,document_version_id,family_id,material_json)
          VALUES ('ML','63849986','R2','VA','FA',
            '{"basis":[{"documentVersionId":"VA"}]}');`);
      const asRole = (role, actor, roles, query) => psql(`BEGIN;
        SET LOCAL search_path TO ${quote(schema)}, public;
        SET LOCAL ROLE ${quote(role)};
        SELECT set_config('app.user_id', '${actor}', true);
        SELECT set_config('app.role_ids', '${roles}', true);
        ${query}
        ROLLBACK;`).split('\n').at(-1);
      assert.equal(asRole(auth, 'A', '',
        'SELECT string_agg(id,\',\' ORDER BY id) FROM work_item;'), 'A,B,WC,WH,WM');
      assert.equal(asRole(auth, 'B', '',
        'SELECT string_agg(id,\',\' ORDER BY id) FROM work_item;'), 'A,B,WC,WH,WM');
      assert.equal(asRole(auth, 'B', '',
        'SELECT string_agg(id,\',\' ORDER BY id) FROM derived_summary;'), 'SA,SB');
      for (const table of [
        'review_conversation', 'review_turn', 'engineer_supplied_input',
      ]) assert.equal(asRole(auth, 'B', '',
        `SELECT count(*) FROM ${quote(table)} WHERE actor_id='A';`), '1');
      for (const table of [
        'dialogue_thread', 'dialogue_message', 'discussion_contribution',
        'dialogue_assessment_request',
      ]) {
        assert.equal(asRole(auth, 'B', '',
          `SELECT count(*) FROM ${quote(table)} WHERE actor_id='A';`), '0');
        assert.equal(asRole(auth, 'B', '',
          `SELECT count(*) FROM ${quote(table)} WHERE actor_id='B';`), '1');
      }
      assert.equal(asRole(auth, 'B', '',
        "SELECT string_agg(id,',' ORDER BY id) FROM review_aily_query;"),
      'R-RECEIPT,RB');
      assert.equal(asRole(auth, 'B', '',
        "SELECT count(*) FROM review_aily_query WHERE id='RA';"), '0');
      assert.equal(asRole(anon, 'B', '', 'SELECT count(*) FROM work_item;'), '0');
      for (const helper of [
        "native_app_shared_read_allowed('63849986')",
        "native_app_work_item_readable('63849986','WI-A')",
        "native_app_document_readable('63849986','VA')",
        "native_app_dm_related_readable('63849986','FAMILY','FH')",
        "native_app_dm_related_readable('63849986','DOCUMENT','DH')",
        "native_app_dm_related_readable('63849986','ACQUISITION','AH')",
        "native_app_dm_related_readable('63849986','ARTIFACT','SH')",
        "native_app_matter_revision_readable('63849986','R')",
        "wiselink_native_reviewer('63849986')",
      ]) {
        assert.equal(asRole(service, 'B', '', `SELECT ${helper};`), 'f');
        assert.equal(asRole(anon, 'B', '', `SELECT ${helper};`), 'f');
      }
      assert.equal(psql(`SET search_path TO ${quote(schema)}, public;
        SELECT has_function_privilege('${anon}',
          '${schema}.native_app_document_readable(character varying,character varying)',
          'EXECUTE');`), 't');
      assert.equal(asRole(auth, '', '', 'SELECT count(*) FROM work_item;'), '0');
      assert.equal(asRole(auth, 'B', '',
        "SELECT native_app_document_readable('63849986','VA');"), 't');
      assert.equal(asRole(auth, 'B', '',
        "SELECT native_app_document_readable('63849986','VH');"), 't');
      for (const helper of [
        "native_app_shared_read_allowed('other')",
        "native_app_work_item_readable('other','WI-X')",
        "native_app_document_readable('other','VX')",
        "native_app_dm_related_readable('other','FAMILY','FX')",
        "native_app_matter_revision_readable('other','R')",
        "wiselink_native_reviewer('other')",
      ]) assert.equal(asRole(auth, 'B', '', `SELECT ${helper};`), 'f');
      for (const version of ['VM','VN','VC','VX'])
        assert.equal(asRole(auth, 'B', '',
          `SELECT native_app_document_readable('63849986','${version}');`), 'f');
      const catalogCases = [
        ['dm_publication_family','FH','FM,FN,FX'],
        ['dm_document_version','VH','VM,VN,VC,VX'],
        ['dm_document','DH','DM,DN,DX'],
        ['dm_document_version_metadata','MH','MM,MN'],
        ['dm_currentness_decision','CH','CM,CN'],
        ['dm_acquisition','AH','AM,AN,AC,AX'],
        ['dm_ingress_preflight','PH','PM,PN'],
        ['dm_source_artifact','SH','SM,SN,SC,SX'],
      ];
      for (const [table, allowed, deniedCsv] of catalogCases) {
        assert.equal(asRole(auth, 'B', '',
          `SELECT count(*) FROM ${quote(table)} WHERE id='${allowed}';`), '1');
        for (const denied of deniedCsv.split(','))
          assert.equal(asRole(auth, 'B', '',
            `SELECT count(*) FROM ${quote(table)} WHERE id='${denied}';`), '0');
      }
      psql(`SET search_path TO ${quote(schema)}, public;
        UPDATE dm_acquisition SET status='PENDING' WHERE acquisition_id='AH';`);
      assert.equal(asRole(auth, 'B', '',
        "SELECT native_app_document_readable('63849986','VH');"), 'f');
      assert.equal(asRole(auth, 'B', '',
        "SELECT count(*) FROM dm_document_version WHERE id='VH';"), '0');
      psql(`SET search_path TO ${quote(schema)}, public;
        UPDATE dm_acquisition SET status='COMMITTED_CANONICAL'
          WHERE acquisition_id='AH';
        UPDATE dm_source_artifact SET readback_verified=false
          WHERE source_artifact_id='SH';`);
      assert.equal(asRole(auth, 'B', '',
        "SELECT native_app_document_readable('63849986','VH');"), 'f');
      assert.equal(asRole(auth, 'B', '',
        "SELECT count(*) FROM dm_document_version WHERE id='VH';"), '0');
      psql(`SET search_path TO ${quote(schema)}, public;
        UPDATE dm_source_artifact SET readback_verified=true
          WHERE source_artifact_id='SH';`);
      assert.equal(asRole(auth, 'B', '',
        "SELECT native_app_document_readable('other','VX');"), 'f');
      assert.equal(asRole(auth, 'B', '',
        "SELECT native_app_work_item_readable('63849986','WI-A');"), 't');
      assert.equal(asRole(auth, 'B', '',
        "SELECT native_app_work_item_readable('other','WI-X');"), 'f');
      assert.equal(asRole(auth, 'B', '',
        "SELECT native_app_matter_revision_readable('63849986','R');"), 't');
      assert.equal(asRole(auth, 'B', '',
        "SELECT native_app_matter_revision_readable('63849986','R2');"), 't');
      assert.equal(asRole(auth, 'B', '',
        "SELECT native_app_matter_revision_readable('other','R2');"), 'f');
      assert.equal(asRole(auth, 'B', '',
        `INSERT INTO review_conversation(id,tenant_id,actor_id,work_item_id)
          VALUES ('C0','63849986','B','WI-A') RETURNING id;`), 'C0');
      assert.equal(asRole(auth, 'B',
        'wiselink_development,wiselink_engineering_reviewer',
        `INSERT INTO review_conversation(id,tenant_id,actor_id,work_item_id)
          VALUES ('C1','63849986','B','WI-A') RETURNING id;`), 'C1');
      assert.throws(() => asRole(auth, 'B',
        'wiselink_engineering_reviewer',
        `INSERT INTO review_conversation(id,tenant_id,actor_id,work_item_id)
          VALUES ('C2','63849986','A','WI-A') RETURNING id;`),
      /row-level security policy/u);
      assert.throws(() => asRole(auth, 'B',
        'wiselink_engineering_reviewer',
        `INSERT INTO review_conversation(id,tenant_id,actor_id,work_item_id)
          VALUES ('C3','other','B','WI-X') RETURNING id;`),
      /row-level security policy/u);
      assert.equal(asRole(auth, 'B', 'xwiselink_engineering_reviewer',
        "SELECT wiselink_native_reviewer('63849986');"), 't');
      assert.equal(asRole(auth, 'B', '',
        `INSERT INTO review_turn(id,tenant_id,actor_id,work_item_id,
          review_conversation_id,input_type,adoption_status)
          VALUES ('TB','63849986','B','WI-A','CB','ENGINEER_TEXT',
            'CANDIDATE_UNADOPTED') RETURNING id;`), 'TB');
      assert.throws(() => asRole(auth, 'B', '',
        `INSERT INTO review_turn(id,tenant_id,actor_id,work_item_id,
          review_conversation_id,input_type,adoption_status,response_type)
          VALUES ('TB-CAND','63849986','B','WI-A','CB','ENGINEER_TEXT',
            'CANDIDATE_UNADOPTED','ANSWER') RETURNING id;`),
      /row-level security policy/u);
      assert.equal(asRole(auth, 'B', '',
        `INSERT INTO engineer_supplied_input(id,tenant_id,actor_id,
          work_item_id,review_conversation_id,review_turn_id,
          input_type,adoption_status)
          VALUES ('IB','63849986','B','WI-A','CB','TB-SEED','ENGINEER_TEXT',
            'CANDIDATE_UNADOPTED') RETURNING id;`), 'IB');
      // The legacy broad WorkItem write remains present; the new policies are
      // SELECT-only except the exact reviewer records.
      assert.equal(asRole(auth, 'B', '',
        "UPDATE work_item SET id='Z' WHERE work_item_id='WI-A' RETURNING id;"), 'Z');
      assert.equal(asRole(auth, 'B', '',
        `INSERT INTO derived_summary(id,tenant_id,actor_id)
          VALUES ('S-OWN','63849986','B') RETURNING id;`), 'S-OWN');
      assert.throws(() => asRole(auth, 'B', '',
        `INSERT INTO derived_summary(id,tenant_id,actor_id)
          VALUES ('S-OTHER','63849986','A') RETURNING id;`),
      /row-level security policy/u);
      assert.match(psql(`SET search_path TO ${quote(schema)}, public;
        SELECT cmd||':'||permissive FROM pg_policies
        WHERE tablename='derived_summary'
          AND policyname='nr78_old_all_0_update';`),
      /UPDATE:RESTRICTIVE/u);
      t.diagnostic('isolated PostgreSQL RLS A/B, tenant, reviewer and preserved write policies passed');
    } finally {
      if (started) call('pg_ctl', ['-D', cluster, '-m', 'immediate', '-w', 'stop']);
      rmSync(base, { recursive: true, force: true });
    }
  });
