import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
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
const { MiaodaWorkItemRepository } = require('../../server/modules/work-item/miaoda-work-item.repository.ts');
const { LocalMineruWorkerService } = require('../../server/modules/canonical-host/local-mineru-worker.service.ts');
const url = process.env.LOCAL_MINERU_RLS_TEST_DATABASE_URL;
const migration = name => readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8');

// Only the named loopback test database may be reset. Admin is used solely for fixture setup/readback.
// All product reads/claims below run as an explicit nonowner, non-BYPASSRLS service_role.
test('local worker discovers existing delegation before actor-owned parse access under real RLS', { skip: !url }, async () => {
  const target = new URL(url);
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.pathname, '/wiselink_local_worker_rls_test');
  const admin = postgres(url, { max: 1, onnotice() {} });
  const runtime = postgres(url, { max: 1, onnotice() {} });
  const sha = 'a'.repeat(64);
  const scope = { tenantId: 'TENANT-RLS', actorUserId: 'ACTOR-RLS', documentVersionId: 'DV-RLS',
    automaticWorkItem: { workItemId: 'WI-RLS', requestId: 'REQ-RLS', principalId: 'P-RLS',
      documentId: 'DOC-RLS', sourceArtifactId: 'ART-RLS', sourceFileSha256: sha, sourceByteLength: 123, leaseGeneration: 3 } };
  try {
    await admin.unsafe(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
      END $$;
      CREATE TYPE user_profile AS (user_id text);
      CREATE TABLE dm_document_version(document_version_id varchar(96) PRIMARY KEY, document_id varchar(96),
        family_id varchar(96), source_artifact_id varchar(96), pdf_sha256 varchar(64), byte_length bigint, owner_id text);
      CREATE FUNCTION engineering_matter_document_owned_by_actor(t varchar, v varchar) RETURNS boolean LANGUAGE sql STABLE AS $$
        SELECT t='TENANT-RLS' AND EXISTS (SELECT 1 FROM dm_document_version
          WHERE document_version_id=v AND owner_id=current_setting('app.user_id',true));
      $$;
      CREATE TABLE identity_subject_mapping(miaoda_user_id text, miaoda_tenant_id text, expected_client_id text, status text);
      ALTER TABLE identity_subject_mapping ENABLE ROW LEVEL SECURITY;
      CREATE TABLE work_item(tenant_id varchar(128), work_item_id varchar(96), request_id varchar(96), requested_by_user_id varchar(255),
        document_id varchar(96), document_version_id varchar(96), source_artifact_id varchar(96), source_file_sha256 varchar(64),
        source_byte_length bigint, action_type varchar(64), status varchar(64), revision integer, package_id text,
        PRIMARY KEY(tenant_id,work_item_id));
      ALTER TABLE work_item ENABLE ROW LEVEL SECURITY;`);
    // Apply the actual identity and WorkItem SELECT policies, including actor/mapping requirements.
    const hostedPolicies = await migration('0019_interactive_review_hosted_runtime_select.sql');
    await admin.unsafe(hostedPolicies.slice(hostedPolicies.indexOf('DROP POLICY IF EXISTS identity_subject_mapping'),
      hostedPolicies.indexOf('DROP POLICY IF EXISTS review_conversation')));
    for (const name of ['0038_document_parse_run.sql', '0044_document_parse_step_lease.sql',
      '0062_auto_work_item_authorization.sql', '0063_auto_work_item_lease_ack.sql', '0064_auto_work_item_block_receipt.sql'])
      await admin.unsafe(await migration(name));
    await admin.unsafe(`GRANT USAGE ON SCHEMA public TO service_role;
      GRANT SELECT ON identity_subject_mapping,work_item,dm_document_version TO service_role;
      GRANT SELECT,UPDATE ON dm_document_parse_run,auto_work_item_authorization TO service_role;
      GRANT UPDATE ON dm_document_version TO service_role;`);
    await admin`INSERT INTO identity_subject_mapping VALUES ('ACTOR-RLS','TENANT-RLS','cli_aadde8b579f95bc9','ACTIVE')`;
    await admin`INSERT INTO dm_document_version VALUES ('DV-RLS','DOC-RLS','FAM-RLS','ART-RLS',${sha},123,'ACTOR-RLS'),
      ('DV-FOREIGN','DOC-FOREIGN','FAM-FOREIGN','ART-FOREIGN',${sha},123,'ACTOR-FOREIGN')`;
    await admin`INSERT INTO work_item VALUES ('TENANT-RLS','WI-RLS','REQ-RLS','ACTOR-RLS','DOC-RLS','DV-RLS','ART-RLS',
      ${sha},123,'PARSE_PDF','CANDIDATE_READBACK_VERIFIED',1,'PACKAGE-RLS')`;
    await admin`INSERT INTO auto_work_item_authorization(tenant_id,work_item_id,request_id,actor_user_id,document_id,
      document_version_id,source_artifact_id,source_file_sha256,source_byte_length,grant_kind,status,lease_owner,
      lease_token,lease_generation,lease_expires_at) VALUES ('TENANT-RLS','WI-RLS','REQ-RLS','ACTOR-RLS','DOC-RLS',
      'DV-RLS','ART-RLS',${sha},123,'MIAODA_CANONICAL_PARSE_REQUEST','LEASED','P-RLS',
      '11111111-1111-4111-8111-111111111111',3,now()+interval '10 minutes')`;
    const binding = { documentVersionId: 'DV-RLS', documentId: 'DOC-RLS', familyId: 'FAM-RLS', sourceArtifactId: 'ART-RLS',
      pdfSha256: sha, byteLength: 123,
      parserInput: { mode: 'LOCAL_MINERU_WORKER', settings: { revision: 0, localMineruFallbackEnabled: true, titleEnhancementEnabled: false } } };
    await admin`INSERT INTO dm_document_parse_run(parse_run_id,document_version_id,tenant_id,actor_user_id,request_id,
      parse_revision,expected_published_revision,status,bucket_id,source_binding,deadline_at)
      VALUES ('PRUN-rls','DV-RLS','TENANT-RLS','ACTOR-RLS','PARSE-RLS',1,0,'RUNNING','BUCKET-RLS',${admin.json(binding)},now()+interval '10 minutes')`;
    await runtime.unsafe("SET ROLE service_role; SELECT set_config('app.user_id','',false)");
    const [role] = await runtime`SELECT current_user AS role, r.rolsuper, r.rolbypassrls,
      c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS table_owner,
      c.relrowsecurity AS rls FROM pg_roles r,pg_class c WHERE r.rolname=current_user AND c.oid='dm_document_parse_run'::regclass`;
    assert.deepEqual(role, { role: 'service_role', rolsuper: false, rolbypassrls: false, table_owner: false, rls: true });
    const db = drizzle(runtime);
    const leases = new DocumentStepLeaseRepository(db);
    const repository = new DocumentParsingRepository(db, leases);
    const workItems = new MiaodaWorkItemRepository(db);
    assert.equal((await runtime`SELECT * FROM dm_document_parse_run`).length, 0);
    assert.equal((await runtime`SELECT * FROM work_item`).length, 0);
    assert.equal((await runtime`SELECT * FROM auto_work_item_authorization`).length, 1);
    assert.equal(await repository.readLocalWorkerById('TENANT-RLS', 'PRUN-rls'), null);

    const actorCalls = [];
    // Models SQL middleware's per-operation actor scope; no database-owner queries enter the callback.
    const actors = { async withActorScope(actor, callback) {
      actorCalls.push(actor);
      await runtime`SELECT set_config('app.user_id',${actor},false)`;
      try { return await callback(); }
      finally { await runtime`SELECT set_config('app.user_id','',false)`; }
    } };
    const parsing = { async readLocalWorkerRun(id, context) {
      const run = await repository.read(context, id);
      assert.ok(run, 'product lookup must be inside the delegated actor scope');
      const bound = { ...context, automaticWorkItem: context.automaticWorkItem ?? run.sourceBinding.automaticWorkItem };
      await repository.assertLocalWorkerScope(bound, run);
      return { run, scope: bound };
    } };
    const authorization = { async assertAutoWorkItemQueueTransport() {},
      async authorizeOpenClawAutoWorkItemQueue() { return { appId: 'app_17bzc551rsg', tenantId: 'TENANT-RLS',
        principalId: 'P-RLS', authorizationFingerprint: 'verified' }; } };
    const worker = new LocalMineruWorkerService(authorization, actors, repository, parsing, leases, workItems);
    const claimed = await worker.claim({});
    assert.equal(claimed.status, 'CLAIMED');
    assert.equal(claimed.parseRunId, 'PRUN-rls');
    assert.equal(claimed.documentVersionId, 'DV-RLS');
    assert.equal(claimed.lease.leaseOwner, 'mineru:P-RLS:WI-RLS:g3');
    assert.deepEqual(actorCalls, ['ACTOR-RLS']);
    assert.equal((await runtime`SELECT * FROM dm_document_parse_run`).length, 0, 'actor scope must be cleared');
    const [saved] = await admin`SELECT lease_owner,lease_token FROM dm_document_parse_run WHERE parse_run_id='PRUN-rls'`;
    assert.equal(saved.lease_owner, claimed.lease.leaseOwner);
    assert.equal(saved.lease_token, claimed.lease.leaseToken);
    const fence = { parseRunId: claimed.parseRunId, ...claimed.lease };
    await actors.withActorScope('ACTOR-FOREIGN', async () => {
      assert.equal(await repository.readLocalWorkerById('TENANT-RLS', 'PRUN-rls'), null);
      await assert.rejects(leases.check({ ...scope, actorUserId: 'ACTOR-FOREIGN' }, fence), /DOCUMENT_AUTOMATIC_LEASE_REJECTED/);
    });
    await actors.withActorScope('ACTOR-RLS', async () => {
      await leases.check(scope, fence);
      await assert.rejects(leases.check({ ...scope, documentVersionId: 'DV-FOREIGN' }, fence), /DOCUMENT_AUTOMATIC_LEASE_REJECTED/);
      await assert.rejects(repository.assertLocalWorkerScope({ ...scope,
        automaticWorkItem: { ...scope.automaticWorkItem, sourceArtifactId: 'ART-FOREIGN' } },
      await repository.read(scope, 'PRUN-rls')), /DOCUMENT_AUTOMATIC_LEASE_REJECTED/);
    });
    await actors.withActorScope('ACTOR-RLS', async () => {
      await repository.stage(scope, 'PRUN-rls', fence);
      const run = await repository.read(scope, 'PRUN-rls');
      assert.equal(run.sourceBinding.automaticWorkItem, undefined, 'browser run keeps its immutable source binding');
    });
    await admin`UPDATE auto_work_item_authorization SET lease_generation=4 WHERE work_item_id='WI-RLS'`;
    await assert.rejects(worker.renew({ parseRunId: claimed.parseRunId, documentVersionId: claimed.documentVersionId,
      lease: claimed.lease }), /LOCAL_MINERU_RUN_NOT_FOUND/);
    await actors.withActorScope('ACTOR-RLS', async () => {
      await assert.rejects(repository.recordLocalWorkerCandidate(scope, fence, { role: 'MANIFEST',
        relativePath: 'raw/mineru-candidate.json', bucketId: 'BUCKET-RLS',
        filePath: 'wiselink/parsed/DV-RLS/PRUN-rls/raw/mineru-candidate.json', providerObjectId: 'FILE-RLS',
        byteLength: 2, sha256: 'b'.repeat(64), readback: 'VERIFIED', mediaType: 'application/json' }),
      /DOCUMENT_AUTOMATIC_LEASE_REJECTED/);
    });
    const [noWrite] = await admin`SELECT artifact_progress FROM dm_document_parse_run WHERE parse_run_id='PRUN-rls'`;
    assert.deepEqual(noWrite.artifact_progress, []);
    await admin`UPDATE auto_work_item_authorization SET lease_generation=3 WHERE work_item_id='WI-RLS'`;
    await admin`UPDATE work_item SET source_artifact_id='ART-CHANGED' WHERE work_item_id='WI-RLS'`;
    await assert.rejects(worker.renew({ parseRunId: claimed.parseRunId, documentVersionId: claimed.documentVersionId,
      lease: claimed.lease }), /LOCAL_MINERU_RUN_NOT_FOUND|LOCAL_MINERU.*MISMATCH|DOCUMENT_AUTOMATIC_LEASE_REJECTED/);
    const [unchanged] = await admin`SELECT lease_owner,lease_token FROM dm_document_parse_run WHERE parse_run_id='PRUN-rls'`;
    assert.deepEqual(unchanged, saved);

    // A later browser request uses the immutable parse admission plus a completed
    // grant only to recover its actor. No automatic WorkItem lease is resurrected.
    await admin`UPDATE dm_document_parse_run SET status='FAILED',error_code='TEST_SUPERSEDED',
      completed_at=now(),lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL WHERE parse_run_id='PRUN-rls'`;
    await admin`UPDATE work_item SET source_artifact_id='ART-RLS' WHERE work_item_id='WI-RLS'`;
    await admin`UPDATE auto_work_item_authorization SET status='COMPLETED',lease_owner=NULL,
      lease_token=NULL,lease_expires_at=NULL,completed_lease_token_hash=${'b'.repeat(64)},
      completed_lease_generation=3,completed_at=now() WHERE work_item_id='WI-RLS'`;
    await admin`INSERT INTO dm_document_parse_run(parse_run_id,document_version_id,tenant_id,actor_user_id,request_id,
      parse_revision,expected_published_revision,status,bucket_id,source_binding,deadline_at)
      VALUES ('PRUN-browser','DV-RLS','TENANT-RLS','ACTOR-RLS','BROWSER-RLS',2,0,'RUNNING','BUCKET-RLS',
        ${admin.json(binding)},now()+interval '10 minutes')`;
    assert.equal((await runtime`SELECT * FROM dm_document_parse_run`).length, 0);
    assert.equal((await workItems.listCompletedLocalWorkerDiscovery({ tenantId: 'TENANT-RLS' })).length, 1);
    const browser = await worker.claim({});
    assert.equal(browser.status, 'CLAIMED');
    assert.equal(browser.parseRunId, 'PRUN-browser');
    assert.equal(browser.lease.leaseOwner, 'mineru:P-RLS:PRUN-browser');
    const browserScope = { tenantId: 'TENANT-RLS', actorUserId: 'ACTOR-RLS', documentVersionId: 'DV-RLS' };
    await actors.withActorScope('ACTOR-RLS', async () => {
      await leases.check(browserScope, { parseRunId: browser.parseRunId, ...browser.lease });
      await assert.rejects(leases.check(browserScope, { parseRunId: browser.parseRunId,
        ...browser.lease, leaseGeneration: browser.lease.leaseGeneration + 1 }), /DOCUMENT_STEP_LEASE_REJECTED/);
    });
    await admin`UPDATE work_item SET source_artifact_id='ART-CHANGED' WHERE work_item_id='WI-RLS'`;
    await assert.rejects(worker.renew({ parseRunId: browser.parseRunId, documentVersionId: browser.documentVersionId,
      lease: browser.lease }), /LOCAL_MINERU_RUN_NOT_FOUND/);
    await admin`UPDATE work_item SET source_artifact_id='ART-RLS' WHERE work_item_id='WI-RLS'`;
    await admin`UPDATE dm_document_version SET owner_id='ACTOR-FOREIGN' WHERE document_version_id='DV-RLS'`;
    await assert.rejects(worker.renew({ parseRunId: browser.parseRunId, documentVersionId: browser.documentVersionId,
      lease: browser.lease }));
    await admin`UPDATE dm_document_version SET owner_id='ACTOR-RLS' WHERE document_version_id='DV-RLS'`;
    // The automatic consumer skips accepted candidates; browser continuation
    // must be able to reclaim the same persisted run after its fence is free.
    await admin`UPDATE dm_document_parse_run SET status='STAGING',lease_owner=NULL,lease_token=NULL,
      lease_expires_at=NULL,artifact_progress=${admin.json([{ relativePath: 'raw/mineru-candidate.json' }])}
      WHERE parse_run_id='PRUN-browser'`;
    await actors.withActorScope('ACTOR-RLS', async () => {
      assert.equal((await repository.listLocalWorkerCandidates('TENANT-RLS', 50, browserScope)).length, 0);
      assert.equal((await repository.listLocalWorkerCandidates('TENANT-RLS', 50, browserScope, true)).length, 1);
    });
  } finally { await runtime.end(); await admin.end(); }
});
