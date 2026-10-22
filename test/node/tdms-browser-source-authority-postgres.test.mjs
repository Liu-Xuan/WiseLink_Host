import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { postgresCapability, startOwnedPostgres } from '../pg/owned-postgres-cluster.mjs';

process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../../tsconfig.node.json', import.meta.url));
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const { TdmsBrowserSourceAuthorization } = require('../../server/modules/tdms-source/tdms-browser-source-authorization.ts');
const { TdmsReceiverIdentityProfile } = require('../../server/modules/tdms-source/tdms-receiver-identity-profile.ts');
const { MiaodaTdmsSourceRepository } = require('../../server/modules/tdms-source/tdms-source.repository.ts');
const { MiaodaTdmsDocumentAccess } = require('../../server/modules/tdms-source/miaoda-tdms-document-access.ts');
const { TdmsSourceService } = require('../../server/modules/tdms-source/tdms-source.service.ts');
const { actor, fixture } = require('../unit/tdms-source/tdms-fixtures.ts');

const SCHEMA = 'workspace_aadkpkjef3slu';
const BROWSER = 'authenticated_workspace_aadkpkjef3slu';
const SERVICE = 'service_role_workspace_aadkpkjef3slu';
const scope = { tenantId: 'tenant-a', sourceKey: 'TDMS', sourceInstanceId: 'browser-fixture', scopeId: 'source-a' };
const tables = ['tdms_capture', 'tdms_record', 'tdms_record_revision', 'tdms_relation', 'tdms_relation_assertion', 'tdms_read_receipt'];
const allowedMembers = {
  records: [{ recordKind: 'ENGINEERING_FILE', sourceRecordId: 'AEO-visible' }],
  artifacts: [], relationIds: ['EDGE-visible', 'EDGE-denied-endpoint'], relatedDocumentVersionIds: [],
};
function actions(members = allowedMembers) {
  const decision = { allowed: true, authorityRef: 'fixture-read', authorityRevision: '1',
    authorityEvidenceRef: 'fixture-controlled-decision', approvedBySubject: 'fixture-approver',
    validFrom: new Date(Date.now() - 86400000).toISOString(),
    validUntil: new Date(Date.now() + 86400000).toISOString(), purpose: 'fixture-browser-read',
    retainedCaptureReadAllowed: true, permittedMembers: members };
  return Object.fromEntries(['CATALOGUE', 'READ_RECORD', 'READ_HISTORY', 'READ_RELATIONS'].map(key => [key, decision]));
}

test('browser Source authority uses actual SQL identity and bounded receiver grants through native readers',
  { timeout: 90000 }, async t => {
    const capability = await postgresCapability();
    assert.equal(capability.available, true, capability.reason);
    const owned = await startOwnedPostgres(capability);
    const previousTenant = process.env.WISELINK_TDMS_BOUND_TENANT_ID;
    const previousSandbox = process.env.SANDBOX_ID;
    process.env.WISELINK_TDMS_BOUND_TENANT_ID = scope.tenantId;
    try {
      const admin = owned.admin;
      const login = 'tdms_fixture_app_' + randomUUID().replaceAll('-', '').slice(0, 16);
      await admin.unsafe(`CREATE ROLE ${BROWSER} NOLOGIN NOSUPERUSER NOBYPASSRLS;
        CREATE ROLE ${SERVICE} NOLOGIN NOSUPERUSER NOBYPASSRLS;
        CREATE ROLE ${login} LOGIN NOSUPERUSER NOBYPASSRLS IN ROLE ${BROWSER},${SERVICE};
        CREATE SCHEMA ${SCHEMA}; SET search_path TO ${SCHEMA},pg_catalog;
        GRANT USAGE ON SCHEMA ${SCHEMA} TO ${BROWSER},${SERVICE};`);
      await admin.unsafe(await readFile(new URL('../../server/database/tdms-source-rebuild-v1.draft.sql', import.meta.url), 'utf8'));
      await seedAuthority(admin);
      // Local reduced RLS deliberately admits both same-scope records. Production
      // receiver/member decisions must perform the additional per-record restriction.
      for (const table of tables) await admin.unsafe(`CREATE POLICY fixture_tenant_read ON ${table}
        FOR SELECT TO ${BROWSER} USING (tenant_id='tenant-a' AND current_setting('app.user_id',true)='123');
        GRANT SELECT ON ${table} TO ${BROWSER};`);
      await admin.unsafe(`GRANT INSERT ON tdms_read_receipt TO ${BROWSER};
        CREATE POLICY fixture_receipt_write ON tdms_read_receipt FOR INSERT TO ${BROWSER}
        WITH CHECK (tenant_id='tenant-a' AND actor_id=current_setting('app.user_id',true));`);
      const connect = async role => {
        const client = await owned.connect(login);
        await client.unsafe(`SET search_path TO ${SCHEMA},pg_catalog; SET ROLE ${role}`);
        await client`SELECT set_config('app.user_id','123',false)`;
        return client;
      };
      // Separate finite connections avoid nesting a one-connection pool: both carry
      // the same verified browser SQL identity, as the real request middleware does.
      const readClient = await connect(BROWSER), authClient = await connect(BROWSER);
      const documentClient = await connect(BROWSER), serviceClient = await connect(SERVICE);
      const [identity] = await authClient`SELECT current_user AS role,session_user AS login,
        r.rolsuper,r.rolbypassrls FROM pg_roles r WHERE r.rolname=current_user`;
      assert.equal(identity.role, BROWSER);
      assert.equal(identity.login, login);
      assert.equal(identity.rolsuper, false);
      assert.equal(identity.rolbypassrls, false);
      const browser = actor();
      const profile = new TdmsReceiverIdentityProfile({ configured: true, clientId: 'fixture-client',
        applicationScopeId: 'app_17bzc551rsg' });
      const documentChecks = [];
      // Existing DM port is independently controlled fixture data, not an inferred
      // Source grant; this suite does not claim acceptance of hosted DM policies.
      const documents = new MiaodaTdmsDocumentAccess({ assertCanRead: async input => {
        documentChecks.push(structuredClone(input));
        const rows = await documentClient`SELECT document_version_id FROM fixture_document_read
          WHERE tenant_id=${input.tenantId} AND actor_id=${input.actorUserId}
            AND document_version_id=${input.documentVersionId} AND allowed`;
        if (rows.length !== 1) throw Object.assign(new Error('FIXTURE_DM_READ_DENIED'), { statusCode: 403 });
      } });
      const authorization = new TdmsBrowserSourceAuthorization(drizzle(authClient), profile, documents);
      const repository = new MiaodaTdmsSourceRepository(drizzle(readClient));
      const artifacts = { acquire: async () => { throw new Error('UNEXPECTED_IMPORT_OR_ARTIFACT_FETCH'); } };
      const service = new TdmsSourceService(repository, authorization, artifacts, documents);
      const visible = stored('AEO-visible', 'Z-visible', ['DV-allowed']);
      const hidden = stored('AEO-hidden', 'A-hidden', ['DV-allowed']);
      await saveRecord(admin, visible);
      await saveRecord(admin, hidden);
      for (let index = 0; index < 55; index++) await saveRecord(admin,
        stored(`AEO-denied-${index}`, `B-denied-${String(index).padStart(2, '0')}`, ['DV-allowed']));
      await seedRelations(admin, visible, hidden);

      await t.test('real browser/profile produces bounded decisions; service SQL and identity lookalikes deny', async () => {
        const grant = await authorization.authorize(browser, scope, 'READ_RECORD', {});
        assert.deepEqual(grant.permittedMembers, allowedMembers);
        assert.ok(Date.parse(grant.validUntil) > Date.now());
        await assert.rejects(new TdmsBrowserSourceAuthorization(drizzle(serviceClient), profile, documents)
          .authorize(browser, scope, 'READ_RECORD', {}), { code: 'TDMS_BROWSER_AUTHENTICATED_DATABASE_REQUIRED' });
        await assert.rejects(authorization.authorize({ ...browser, canonicalSubject: { ...browser.canonicalSubject, id: '999' } },
          scope, 'READ_RECORD', {}), { code: 'TDMS_RECEIVER_SQL_ACTOR_MISMATCH' });
        await admin`UPDATE identity_subject_mapping SET expected_client_id='wrong-client'`;
        try { await assert.rejects(authorization.authorize(browser, scope, 'READ_RECORD', {}),
          { code: 'TDMS_RECEIVER_BOUND_IDENTITY_MISMATCH' }); }
        finally { await admin`UPDATE identity_subject_mapping SET expected_client_id='fixture-client'`; }
        await assert.rejects(authorization.authorize(browser, { ...scope, tenantId: 'other' }, 'READ_RECORD', {}),
          { code: 'TDMS_SOURCE_NOT_FOUND' });
      });

      await t.test('actual readRecord releases only the permitted record and writes its genuine READ receipt', async () => {
        const result = await service.readRecord(browser, visible.record.sourceRevisionRef);
        assert.equal(result.record.sourceRecordId, 'AEO-visible');
        assert.deepEqual(result.record.content, visible.record.content);
        assert.equal(result.bodyReadPolicy.kind, 'NON_OPINION_SOURCE');
        const [receipt] = await admin`SELECT data FROM tdms_read_receipt WHERE receipt_ref=${result.receipt.receiptRef}`;
        assert.equal(receipt.data.actorId, '123');
        assert.equal(receipt.data.receipt.readPerformed, true);
        assert.equal(receipt.data.receipt.sourceRevisionRef, visible.record.sourceRevisionRef);
        const before = await receiptCount(admin);
        await assert.rejects(service.readRecord(browser, hidden.record.sourceRevisionRef),
          { code: 'TDMS_RECEIVER_EXACT_MEMBER_DENIED' });
        assert.equal(await receiptCount(admin), before);
      });

      await t.test('catalogue and exact document pagination filter 56 denied rows before the SQL limit', async () => {
        const catalogue = await service.catalogue(browser);
        assert.deepEqual(catalogue.records.map(row => row.sourceRecordId), ['AEO-visible']);
        assert.equal(catalogue.hasMore, false);
        assert.equal(catalogue.nextAfter, null);
        const result = await service.readDocumentVersion(browser, { documentVersionId: 'DV-allowed', limit: 1 });
        assert.deepEqual(result.records.map(row => row.record.sourceRecordId), ['AEO-visible']);
        assert.equal(result.hasMore, false);
        assert.equal(result.nextAfter, null);
        assert.ok(documentChecks.some(value => value.documentVersionId === 'DV-allowed' && value.action === 'DOCUMENT_READ'));
        const empty = { records: [], artifacts: [], relationIds: [], relatedDocumentVersionIds: [] };
        await updateActions(admin, actions(empty));
        try {
          assert.deepEqual((await service.catalogue(browser)).records, []);
          assert.deepEqual((await service.readDocumentVersion(browser, { documentVersionId: 'DV-allowed' })).records, []);
        } finally { await updateActions(admin, actions()); }
      });

      await t.test('relation ID permission and both exact native endpoints are independently enforced', async () => {
        const result = await service.readRelations(browser, visible.record.sourceRevisionRef);
        assert.deepEqual(result.relations.map(value => value.sourceRelationId), ['EDGE-visible']);
        assert.equal(JSON.stringify(result).includes('AEO-hidden'), false);
        assert.equal(JSON.stringify(result).includes('EDGE-unpermitted'), false);
      });

      await t.test('independent DM denial and unsupported contexts remain closed without issuing receipts', async () => {
        const before = await receiptCount(admin);
        await admin`UPDATE fixture_document_read SET allowed=false`;
        try {
          await assert.rejects(service.readRecord(browser, visible.record.sourceRevisionRef), /FIXTURE_DM_READ_DENIED/);
          await assert.rejects(service.readDocumentVersion(browser, { documentVersionId: 'DV-allowed' }), /FIXTURE_DM_READ_DENIED/);
        } finally { await admin`UPDATE fixture_document_read SET allowed=true`; }
        assert.equal(await receiptCount(admin), before);
        await assert.rejects(authorization.authorize(browser, scope, 'READ_RECORD', { matterId: 'MATTER-unwired' }),
          { code: 'TDMS_BROWSER_SOURCE_OBJECT_CONTEXT_UNCONFIGURED' });
        await assert.rejects(authorization.authorizeImport(), { code: 'TDMS_BROWSER_SOURCE_IMPORT_UNCONFIGURED' });
      });

      await t.test('controlled Source revocation after receipt insertion prevents body release and rolls back that receipt', async () => {
        let revoked = false;
        const interrupted = new TdmsSourceService({ transaction: operation => repository.transaction(tx => operation(new Proxy(tx, {
          get(target, key) {
            if (key === 'saveReceipt') return async value => {
              await target.saveReceipt(value);
              if (!revoked) { revoked = true; await admin`UPDATE tdms_source_receiver_grant SET status='REVOKED',revoked_at=now()`; }
            };
            const value = Reflect.get(target, key);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        }))) }, authorization, artifacts, documents);
        const before = await receiptCount(admin);
        try {
          await assert.rejects(interrupted.readRecord(browser, visible.record.sourceRevisionRef), { code: 'TDMS_SOURCE_NOT_FOUND' });
          assert.equal(revoked, true);
          assert.equal(await receiptCount(admin), before);
          await assert.rejects(service.readRecord(browser, visible.record.sourceRevisionRef), { code: 'TDMS_SOURCE_NOT_FOUND' });
        } finally { await admin`UPDATE tdms_source_receiver_grant SET status='ACTIVE',revoked_at=NULL`; }
      });
    } finally {
      if (previousTenant === undefined) delete process.env.WISELINK_TDMS_BOUND_TENANT_ID;
      else process.env.WISELINK_TDMS_BOUND_TENANT_ID = previousTenant;
      if (previousSandbox === undefined) delete process.env.SANDBOX_ID;
      else process.env.SANDBOX_ID = previousSandbox;
      await owned.stop();
    }
  });

function stored(sourceRecordId, sourceRevisionRef, relatedDocumentVersionIds) {
  const { itemId: _item, expectedHeadRevisionRef: _head, artifactMemberIds: _members, ...base } = fixture().records[0];
  return { scope, record: { ...base, sourceRecordId, sourceRevisionRef, recordRef: 'RECORD-' + sourceRecordId,
    sourceKey: scope.sourceKey, sourceInstanceId: scope.sourceInstanceId, captureRef: 'CAP-' + sourceRevisionRef,
    capturedAt: base.observedAt, relatedDocumentVersionIds, fieldSelectors: [], artifacts: [], unreadAttachments: [],
    sourceVerification: 'DECLARED_ONLY', currentness: 'SELECTED_HOST_OBSERVATION', selectedHead: true } };
}
async function saveRecord(admin, value) {
  const r = value.record;
  const head = { scope, recordKind: r.recordKind, sourceRecordId: r.sourceRecordId,
    recordRef: r.recordRef, sourceRevisionRef: r.sourceRevisionRef, observedAt: r.observedAt };
  await admin`INSERT INTO tdms_record_revision VALUES (${scope.tenantId},${scope.sourceKey},${scope.sourceInstanceId},
    ${scope.scopeId},${r.sourceRevisionRef},${r.recordRef},${admin.json(value)})`;
  await admin`INSERT INTO tdms_record VALUES (${scope.tenantId},${scope.sourceKey},${scope.sourceInstanceId},${scope.scopeId},
    ${r.recordKind},${r.sourceRecordId},${r.recordRef},${r.sourceRevisionRef},${admin.json(head)})`;
}
async function receiptCount(admin) {
  const [row] = await admin`SELECT count(*)::int AS count FROM tdms_read_receipt`;
  return row.count;
}
async function updateActions(admin, value) {
  await admin`UPDATE tdms_source_receiver_grant SET actions_json=${admin.json(value)}`;
}
async function seedRelations(admin, visible, hidden) {
  for (const [id, endpoint] of [['EDGE-visible', visible], ['EDGE-denied-endpoint', hidden], ['EDGE-unpermitted', visible]]) {
    const assertion = { sourceRelationId: id, relationRef: 'REL-' + id, assertionRef: 'ASSERT-' + id,
      captureRef: 'CAP-relations', rawKind: 'references', controlledKind: 'REFERENCES', authority: 'SOURCE_EXPLICIT',
      from: { kind: 'NATIVE_RECORD_REVISION', sourceRevisionRef: visible.record.sourceRevisionRef },
      to: { kind: 'NATIVE_RECORD_REVISION', sourceRevisionRef: endpoint.record.sourceRevisionRef },
      selector: 'fixture.relation', observedAt: visible.record.observedAt, coverage: visible.record.coverage,
      scope: {}, completionEffect: 'UNSPECIFIED', changeClass: 'UNSPECIFIED', rawFields: {}, sourceVerification: 'DECLARED_ONLY' };
    await admin`INSERT INTO tdms_relation_assertion VALUES (${scope.tenantId},${scope.sourceKey},${scope.sourceInstanceId},
      ${scope.scopeId},${assertion.assertionRef},${assertion.relationRef},${visible.record.sourceRevisionRef},
      ${endpoint.record.sourceRevisionRef},${admin.json({ scope, assertion })})`;
    await admin`INSERT INTO tdms_relation VALUES (${scope.tenantId},${scope.sourceKey},${scope.sourceInstanceId},${scope.scopeId},
      ${id},${assertion.relationRef},${assertion.assertionRef},${admin.json({ scope, sourceRelationId: id,
        relationRef: assertion.relationRef, assertionRef: assertion.assertionRef, observedAt: assertion.observedAt })})`;
  }
}
async function seedAuthority(admin) {
  // Reduced local receiver/mapping/DM fixtures exercise production reads and
  // actual roles. They do not install a grant, migration, or policy in Hosted.
  await admin.unsafe(`CREATE TABLE identity_subject_mapping(miaoda_user_id text,miaoda_tenant_id text,expected_client_id text,status text);
    CREATE FUNCTION tdms_act_bound_identity(t text,c text) RETURNS boolean LANGUAGE SQL SECURITY INVOKER AS $$
      SELECT t='tenant-a' AND c='fixture-client' AND current_schema()='${SCHEMA}'
        AND current_user IN ('${BROWSER}','${SERVICE}') AND (SELECT count(*)=1 FROM identity_subject_mapping
        WHERE miaoda_user_id=current_setting('app.user_id',true) AND miaoda_tenant_id=t AND expected_client_id=c AND status='ACTIVE') $$;
    CREATE TABLE tdms_source_receiver(receiver_id text,tenant_id text,application_scope_id text,source_key text,
      source_instance_id text,scope_id text,source_subject_namespace text,source_subject_id text,authority_ref text,
      authority_revision text,authority_evidence_ref text,approved_by_subject text,approved_at timestamptz,
      valid_from timestamptz,valid_until timestamptz,status text,revoked_at timestamptz,revision integer);
    CREATE TABLE tdms_source_receiver_grant(receiver_id text,actor_subject_id text,source_subject_namespace text,
      source_subject_id text,permission_revision text,authority_evidence_ref text,approved_by_subject text,approved_at timestamptz,
      valid_from timestamptz,valid_until timestamptz,status text,revoked_at timestamptz,revision integer,actions_json jsonb);
    CREATE FUNCTION fixture_receiver_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      PERFORM pg_advisory_xact_lock(hashtextextended('wiselink:tdms-receiver:'||OLD.receiver_id,0));
      NEW.revision:=OLD.revision+1;RETURN NEW;END;$$;
    CREATE TRIGGER fixture_receiver_fence BEFORE UPDATE ON tdms_source_receiver_grant
      FOR EACH ROW EXECUTE FUNCTION fixture_receiver_update();
    CREATE TABLE fixture_document_read(tenant_id text,actor_id text,document_version_id text,allowed boolean);
    GRANT SELECT ON identity_subject_mapping,tdms_source_receiver,tdms_source_receiver_grant,fixture_document_read
      TO ${BROWSER},${SERVICE};`);
  await admin`INSERT INTO identity_subject_mapping VALUES ('123','tenant-a','fixture-client','ACTIVE')`;
  await admin`INSERT INTO fixture_document_read VALUES ('tenant-a','123','DV-allowed',true)`;
  await admin`INSERT INTO tdms_source_receiver VALUES ('receiver','tenant-a','app_17bzc551rsg','TDMS',
    ${scope.sourceInstanceId},${scope.scopeId},'TDMS_USER','source-user','authority','1','proof','approver',
    now()-interval '1 day',now()-interval '1 day',now()+interval '1 day','ACTIVE',NULL,1)`;
  await admin`INSERT INTO tdms_source_receiver_grant VALUES ('receiver','123','TDMS_USER','source-user','permission','proof','approver',
    now()-interval '1 day',now()-interval '1 day',now()+interval '1 day','ACTIVE',NULL,1,${admin.json(actions())})`;
}
