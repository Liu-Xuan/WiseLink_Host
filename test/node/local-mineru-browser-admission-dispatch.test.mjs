import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { userInfo } from 'node:os';
import test from 'node:test';
import postgres from 'postgres';

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
process.env.TS_NODE_PROJECT = 'tsconfig.node.json';
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const { DocumentParsingRepository } = require('../../server/modules/document-management/src/hosted/nest/document-parsing.repository.ts');
const { DocumentStepLeaseRepository } = require('../../server/modules/document-management/src/hosted/nest/document-step-lease.repository.ts');
const { DocumentParsingHostedService } = require('../../server/modules/document-management/src/hosted/nest/document-parsing-hosted.service.ts');
const { LocalMineruWorkerService } = require('../../server/modules/canonical-host/local-mineru-worker.service.ts');
const { FileDownloadBuilder } = require('@lark-apaas/file-service');
const { documentParseRecoveryRequestId } = require('../../shared/document-parsing-recovery.ts');
const socket = process.env.LOCAL_MINERU_BROWSER_DISPATCH_TEST_SOCKET;
const migration = name => readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');

// Disposable Unix-socket-only cluster supplied by the local test runner. Never
// accepts an application URL, credentials or the normal developer database.
test('real browser admission discovery, all four operations and actor-bound expiry under PostgreSQL RLS', { skip: !socket }, async t => {
  assert.match(socket, /^\/private\/tmp\/wl-browser-dispatch-test-[A-Za-z0-9_-]+\/socket$/);
  const options = { host: socket, port: 65437, database: 'wiselink_browser_dispatch_test', username: userInfo().username, max: 1, onnotice() {} };
  const admin = postgres(options); const runtime = postgres(options);
  const tenant = 'T-BROWSER'; const actor = 'U-BROWSER'; const other = 'U-OTHER'; const principal = 'P-BROWSER';
  const schema = 'browser_dispatch_test'; const serviceRole = `service_role_${schema}`;
  const pdf = Buffer.from('%PDF-synthetic-browser-admission'); const sha = hash(pdf);
  const binding = version => ({ documentVersionId: version, documentId: 'DOC-BROWSER', familyId: 'FAM-BROWSER',
    sourceArtifactId: 'ART-BROWSER', pdfSha256: sha, byteLength: pdf.length });
  const workerSettings = { revision: 2, localMineruFallbackEnabled: true, titleEnhancementEnabled: false };
  let sourceRevoked = false; let serviceTenant = tenant; let transportAllowed = true;
  let currentActor = ''; const actorEntries = [];
  const sourceObjects = new Map([['source.pdf', { bytes: pdf, type: 'application/pdf' }]]);
  const normalize = path => path.replace(/^\/+/, '');
  const metadata = path => {
    const name = normalize(path); const item = sourceObjects.get(name);
    return item ? { id: `object:${name}`, name: name.split('/').at(-1), bucketID: 'fixture-bucket', filePath: `/${name}`,
      createdBy: { userID: actor }, metadata: { contentLength: item.bytes.length, mimeType: item.type } } : null;
  };
  const scopedFiles = {
    async getFileMetadata(path) { return metadata(path); },
    download(path) {
      return new FileDownloadBuilder(async () => { const item = sourceObjects.get(normalize(path)); assert.ok(item);
        return { metadata: metadata(path), content: new Response(item.bytes) }; });
    },
    async upload(bytes, opts) { const path = normalize(opts.filePath); assert.ok(!sourceObjects.has(path)); sourceObjects.set(path, { bytes: Buffer.from(bytes), type: opts.contentType }); return metadata(path); },
  };
  const files = { async getDefaultBucket() { return 'fixture-bucket'; }, from() { return scopedFiles; } };
  const authorizer = { async assertCanRead(context) {
    if (sourceRevoked || context.tenantId !== tenant || ![actor, other].includes(context.actorUserId) || currentActor !== context.actorUserId)
      throw Object.assign(new Error('DOCUMENT_ACCESS_DENIED'), { statusCode: 403 });
  } };
  const catalog = {
    async readMetadataSource(version, requestedTenant) {
      assert.equal(requestedTenant, tenant);
      return { family: { familyId: 'FAM-BROWSER', canonicalDocumentNumber: 'SYNTHETIC', documentFamily: 'SL', issuerAuthority: 'TEST', currentDocumentVersionId: version },
        version: { ...binding(version), originalFilename: 'source.pdf', businessRevision: '1' },
        source: { sourceArtifactId: 'ART-BROWSER', bucketId: 'fixture-bucket', filePath: '/source.pdf', sha256: sha, byteLength: pdf.length,
          providerObjectId: 'object:source.pdf', providerVersionId: 'object:source.pdf' } };
    },
    async listDocumentUploadDeliveryCandidates() { return []; },
  };
  const workItems = { async listActiveLocalWorkerDelegations() { return []; }, async listCompletedLocalWorkerDiscovery() { return []; } };
  const authorization = { async assertAutoWorkItemQueueTransport() { if (!transportAllowed) throw new Error('TRANSPORT_DENIED'); },
    async authorizeOpenClawAutoWorkItemQueue() { return { appId: 'app_17bzc551rsg', tenantId: serviceTenant, principalId: principal, authorizationFingerprint: 'fixture-verified' }; } };
  try {
    await admin.unsafe(`CREATE SCHEMA ${schema}; SET search_path TO ${schema};
      CREATE ROLE service_role NOLOGIN NOSUPERUSER NOBYPASSRLS;
      CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS;
      CREATE ROLE ${serviceRole} NOLOGIN NOSUPERUSER NOBYPASSRLS IN ROLE service_role;
      CREATE ROLE authenticated_${schema} NOLOGIN NOSUPERUSER NOBYPASSRLS IN ROLE authenticated;
      CREATE ROLE anon_${schema} NOLOGIN NOSUPERUSER NOBYPASSRLS;
      CREATE TYPE user_profile AS (user_id text);
      CREATE TABLE dm_document_version(document_version_id varchar(96) PRIMARY KEY,document_id varchar(96),family_id varchar(96),
        source_artifact_id varchar(96),pdf_sha256 varchar(64),byte_length bigint,owners text[]);
      CREATE TABLE identity_subject_mapping(miaoda_user_id text,miaoda_tenant_id text,expected_client_id text,status text);
      CREATE FUNCTION engineering_matter_document_owned_by_actor(t varchar,v varchar) RETURNS boolean LANGUAGE sql STABLE AS $$
        SELECT t='T-BROWSER' AND EXISTS(SELECT 1 FROM dm_document_version WHERE document_version_id=v
          AND current_setting('app.user_id',true)=ANY(owners)); $$;
      CREATE FUNCTION derived_summary_sql_role_allowed(service_only boolean) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $$
        SELECT COALESCE(current_setting('role',true),'')='service_role_'||current_schema()
          OR (service_only IS FALSE AND COALESCE(current_setting('role',true),'')='authenticated_'||current_schema()); $$;`);
    await admin.unsafe(await migration('0038_document_parse_run.sql'));
    await admin.unsafe(await migration('0044_document_parse_step_lease.sql'));
    await admin.unsafe(await migration('0079_local_mineru_browser_admission_dispatch.sql'));
    await admin.unsafe(`GRANT USAGE ON SCHEMA ${schema} TO ${serviceRole},authenticated_${schema},anon_${schema};
      GRANT SELECT,UPDATE ON dm_document_version TO ${serviceRole};
      GRANT SELECT,INSERT,UPDATE ON dm_document_parse_run TO ${serviceRole};`);
    await admin`INSERT INTO identity_subject_mapping VALUES (${actor},${tenant},'cli_aadde8b579f95bc9','ACTIVE'),
      (${other},${tenant},'cli_aadde8b579f95bc9','ACTIVE'),('U-FOREIGN','T-FOREIGN','cli_aadde8b579f95bc9','ACTIVE')`;
    for (const version of ['DV-BROWSER','DV-EXPIRED','DV-OTHER','DV-ERROR','DV-PUBLISHED','DV-FUTURE','DV-AUTO','DV-MAPPED','DV-CANCELLED'])
      await admin`INSERT INTO dm_document_version VALUES (${version},'DOC-BROWSER','FAM-BROWSER','ART-BROWSER',${sha},${pdf.length},${admin.array([actor,other])})`;
    await runtime.unsafe(`SET search_path TO ${schema}; SET ROLE ${serviceRole}; SELECT set_config('app.user_id','',false)`);
    const [role] = await runtime`SELECT rolname,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`;
    assert.equal(role.rolsuper, false); assert.equal(role.rolbypassrls, false);
    const db = drizzle(runtime); const leases = new DocumentStepLeaseRepository(db); const repository = new DocumentParsingRepository(db, leases);
    const actors = { async withActorScope(id, action) {
      actorEntries.push(id); await runtime`SELECT set_config('app.user_id',${id},false)`; currentActor = id;
      try { return await action(); } finally { await runtime`SELECT set_config('app.user_id','',false)`; currentActor = ''; }
    } };
    const parsing = new DocumentParsingHostedService(files, catalog, repository, { configured() { return false; } }, leases, authorizer,
      { async capture() { return { ...workerSettings }; } });
    const worker = new LocalMineruWorkerService(authorization, actors, repository, parsing, leases, workItems, catalog);
    const browser = version => ({ tenantId: tenant, actorUserId: actor, documentVersionId: version, roles: [], appId: 'app_17bzc551rsg', env: 'runtime' });
    let admitted; let identity; let validCandidate;
    await t.test('normal actor start with no automatic/completed/upload directory becomes discoverable and claim/source/renew/result all work', async () => {
      admitted = await actors.withActorScope(actor, () => parsing.start('DV-BROWSER', { requestId: 'independent-browser-start', expectedPublishedRevision: 0 }, browser('DV-BROWSER')));
      assert.equal(admitted.executionMode, 'LOCAL_MINERU_WORKER'); assert.equal(admitted.status, 'RUNNING');
      assert.equal((await runtime`SELECT * FROM dm_document_parse_run`).length, 0, 'service still cannot read arbitrary parse rows');
      const locator = await repository.listLocalWorkerBrowserAdmissions({ tenantId: tenant });
      assert.deepEqual(locator, [{ tenantId: tenant, parseRunId: admitted.parseRunId, actorUserId: actor, documentVersionId: 'DV-BROWSER' }]);
      const claimed = await worker.claim({}); assert.equal(claimed.status, 'CLAIMED'); assert.equal(claimed.parseRunId, admitted.parseRunId);
      assert.equal(claimed.lease.leaseOwner, `mineru:${principal}:${admitted.parseRunId}`);
      identity = { parseRunId: claimed.parseRunId, documentVersionId: claimed.documentVersionId, lease: claimed.lease };
      assert.deepEqual((await worker.source(identity)).bytes, pdf); assert.equal((await worker.renew(identity)).status, 'RENEWED');
      // Discovery integration targets dispatch/fencing, not the unchanged PDF publisher.
      // Use a real readback/stored candidate acceptance, then retain its STAGING receipt.
      const candidate = Buffer.from(JSON.stringify({ schemaVersion: 'wiselink.mineru.local-candidate.v1', source: { sha256: sha, byteLength: pdf.length },
        parser: { version: '3.4.5', backend: 'pipeline' }, raw: { markdown: 'Synthetic independent browser fixture.',
          middle: { _version_name: '3.4.5', _backend: 'pipeline', pdf_info: [{ page_idx: 0, page_size: [600,800] }] },
          contentListV2: [[{ type: 'paragraph', bbox: [0,0,200,100], content: { paragraph_content: [{ type: 'text', content: 'Synthetic independent browser fixture.' }] } }]] }, assets: [] }));
      validCandidate = candidate;
      parsing.executeStep = async () => ({ status: 'STAGING' });
      const accepted = await worker.result(identity, candidate); assert.equal(accepted.status, 'ACCEPTED'); assert.equal(accepted.candidateSha256, hash(candidate));
      assert.equal((await worker.result(identity, candidate)).candidateSha256, accepted.candidateSha256, 'same stored result remains idempotent');
      assert.equal((await runtime`SELECT * FROM dm_document_parse_run`).length, 0, 'all actor callbacks restore service scope');
    });
    await t.test('PUBLIC execute never permits authenticated/anon roles or forged app role claims', { skip: process.env.LOCAL_MINERU_DISPATCH_ONLY_CHANGED === '1' }, async () => {
      for (const name of [`authenticated_${schema}`, `anon_${schema}`]) {
        await runtime.unsafe(`RESET ROLE; SET ROLE ${name}; SELECT set_config('app.user_id','${actor}',false); SELECT set_config('app.role','service_role',false)`);
        await assert.rejects(runtime`SELECT * FROM local_mineru_browser_admissions(${tenant},NULL,NULL,50)`, error => error.code === '42501');
      }
      await runtime.unsafe(`RESET ROLE; SET ROLE ${serviceRole}; SELECT set_config('app.user_id','',false)`);
    });
    await t.test('configured tenant, caller actor override, current source/actor access and receipt fences are enforced', async () => {
      serviceTenant = 'T-FOREIGN'; assert.deepEqual(await worker.claim({}), { status: 'IDLE' });
      await assert.rejects(worker.source(identity), /LOCAL_MINERU_RUN_NOT_FOUND/); serviceTenant = tenant;
      await assert.rejects(worker.claim({ actorUserId: actor }), /CLAIM_INPUT_INVALID/);
      transportAllowed = false; await assert.rejects(worker.source(identity), /TRANSPORT_DENIED/); transportAllowed = true;
      sourceRevoked = true; await assert.rejects(worker.source(identity), /DOCUMENT_ACCESS_DENIED/); sourceRevoked = false;
      await admin`UPDATE dm_document_version SET source_artifact_id='ART-CHANGED' WHERE document_version_id='DV-BROWSER'`;
      await assert.rejects(worker.renew(identity), /DOCUMENT_PARSE_SOURCE_CHANGED/);
      await admin`UPDATE dm_document_version SET source_artifact_id='ART-BROWSER' WHERE document_version_id='DV-BROWSER'`;
      await assert.rejects(worker.result({ ...identity, lease: { ...identity.lease, leaseToken: 'wrong' } }, validCandidate), /RECEIPT_MISMATCH/);
      await admin`UPDATE identity_subject_mapping SET status='INACTIVE' WHERE miaoda_user_id=${actor}`;
      await assert.rejects(worker.renew(identity), /LOCAL_MINERU_RUN_NOT_FOUND/);
      await admin`UPDATE identity_subject_mapping SET status='ACTIVE' WHERE miaoda_user_id=${actor}`;
    });
    const insert = async (version, runActor, status, deadline, error = null, automatic = false, cancel = null, idOverride) => {
      const source = { ...binding(version), parserInput: { mode: 'LOCAL_MINERU_WORKER', settings: workerSettings },
        ...(automatic ? { automaticWorkItem: { workItemId: 'WI-NOT-BROWSER' } } : {}) };
      const id = idOverride ?? `PRUN-${version.slice(3).toLowerCase()}`;
      await admin`INSERT INTO dm_document_parse_run(parse_run_id,document_version_id,tenant_id,actor_user_id,request_id,parse_revision,
        expected_published_revision,status,bucket_id,source_binding,deadline_at,error_code,cancel_requested_at,lease_owner,lease_token,lease_generation,lease_expires_at,artifact_progress,manifest_artifact,completed_at)
        VALUES (${id},${version},${tenant},${runActor},${'request-'+version},1,0,${status},'fixture-bucket',${admin.json(source)},${deadline},${error},${cancel},
          'fixture-old-owner','fixture-old-token',1,${new Date(Date.now()-1000)},${admin.json([{relativePath:'fixture/existing',readback:'VERIFIED'}])},
          ${status==='PUBLISHED' ? admin.json({role:'MANIFEST',readback:'VERIFIED',relativePath:'fixture/published-manifest'}) : null},${status==='PUBLISHED' ? new Date() : null})`;
      return id;
    };
    await t.test('automatic, expired and cancelled rows are not browser claim candidates; exact terminal locators do not become new work', { skip: process.env.LOCAL_MINERU_DISPATCH_ONLY_CHANGED === '1' }, async () => {
      await insert('DV-AUTO', actor, 'RUNNING', new Date(Date.now()+60000), null, true);
      await insert('DV-CANCELLED', actor, 'RUNNING', new Date(Date.now()+60000), null, false, new Date());
      await insert('DV-MAPPED', actor, 'FAILED', new Date(Date.now()-1000));
      const rows = await repository.listLocalWorkerBrowserAdmissions({ tenantId: tenant });
      assert.ok(!rows.some(row => ['DV-AUTO','DV-CANCELLED','DV-MAPPED'].includes(row.documentVersionId)));
      assert.equal((await repository.listLocalWorkerBrowserAdmissions({ tenantId: tenant, parseRunId: 'PRUN-auto', limit: 1 })).length, 0);
      assert.equal((await repository.listLocalWorkerBrowserAdmissions({ tenantId: tenant, parseRunId: 'PRUN-mapped', limit: 1 })).length, 1);
      await assert.rejects(repository.listLocalWorkerBrowserAdmissions({ tenantId: tenant, parseRunId: 'PRUN-mapped', afterParseRunId: 'PRUN-other' }), /ARGUMENT_INVALID/);
    });
    await t.test('authorized status archives only own expired active rows, preserving existing error/source/lease/artifacts and enabling exact same-source recovery', async () => {
      const realId = 'PRUN-00000000-0000-4000-8000-000000000079';
      const expired = await insert('DV-EXPIRED', actor, 'RUNNING', new Date(Date.now()-1000), null, false, null, realId);
      await insert('DV-OTHER', other, 'RUNNING', new Date(Date.now()-1000));
      await insert('DV-ERROR', actor, 'STAGING', new Date(Date.now()-1000), 'DOCUMENT_PLUGIN_QUOTA_EXHAUSTED');
      await insert('DV-PUBLISHED', actor, 'PUBLISHED', new Date(Date.now()-1000));
      await insert('DV-FUTURE', actor, 'RUNNING', new Date(Date.now()+60000));
      const [before] = await admin`SELECT source_binding,lease_owner,lease_token,artifact_progress,deadline_at FROM dm_document_parse_run WHERE parse_run_id=${expired}`;
      const status = await actors.withActorScope(actor, () => parsing.status('DV-EXPIRED', browser('DV-EXPIRED')));
      assert.equal(status.latestRun.status, 'FAILED'); assert.equal(status.latestRun.errorCode, 'DOCUMENT_PARSE_INTERRUPTED'); assert.equal(status.latestRun.waitingForLocalWorker, false);
      const [after] = await admin`SELECT source_binding,lease_owner,lease_token,artifact_progress,deadline_at FROM dm_document_parse_run WHERE parse_run_id=${expired}`; assert.deepEqual(after, before);
      await actors.withActorScope(actor, () => parsing.status('DV-OTHER', browser('DV-OTHER')));
      await actors.withActorScope(actor, () => parsing.status('DV-ERROR', browser('DV-ERROR')));
      await actors.withActorScope(actor, () => parsing.status('DV-PUBLISHED', browser('DV-PUBLISHED')));
      await actors.withActorScope(actor, () => parsing.status('DV-FUTURE', browser('DV-FUTURE')));
      const rows = await admin`SELECT document_version_id,status,error_code FROM dm_document_parse_run WHERE document_version_id IN ('DV-OTHER','DV-ERROR','DV-PUBLISHED','DV-FUTURE') ORDER BY document_version_id`;
      assert.deepEqual(rows.map(row => [row.document_version_id,row.status,row.error_code]), [['DV-ERROR','FAILED','DOCUMENT_PLUGIN_QUOTA_EXHAUSTED'],['DV-FUTURE','RUNNING',null],['DV-OTHER','RUNNING',null],['DV-PUBLISHED','PUBLISHED',null]]);
      const recoveryRequest = documentParseRecoveryRequestId(realId);
      const resumed = await actors.withActorScope(actor, () => parsing.start('DV-EXPIRED', { requestId: recoveryRequest, expectedPublishedRevision: 0 }, browser('DV-EXPIRED')));
      assert.equal(resumed.status, 'RUNNING'); assert.equal(resumed.parseRevision, 2); assert.notEqual(resumed.parseRunId, realId);
      assert.equal((await actors.withActorScope(actor, () => repository.read(browser('DV-EXPIRED'), resumed.parseRunId))).requestId, recoveryRequest);
      assert.equal((await repository.listLocalWorkerBrowserAdmissions({ tenantId: tenant })).some(row => row.parseRunId === resumed.parseRunId), true);
      const replay = await actors.withActorScope(actor, () => parsing.start('DV-EXPIRED', { requestId: recoveryRequest, expectedPublishedRevision: 0 }, browser('DV-EXPIRED'))); assert.equal(replay.parseRunId, resumed.parseRunId);
    });
    assert.ok(actorEntries.includes(actor));
  } finally { await runtime.end(); await admin.end(); }
});
