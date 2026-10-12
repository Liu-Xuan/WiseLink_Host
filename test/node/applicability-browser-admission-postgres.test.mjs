import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { postgresCapability, startOwnedPostgres } from '../pg/owned-postgres-cluster.mjs';
process.env.TS_NODE_PROJECT = 'tsconfig.node.json';
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const { sql } = require('drizzle-orm');
const { SqlExecutionContextMiddleware } = require('@lark-apaas/fullstack-nestjs-core');
const { SessionResolver } = require('../../server/modules/identity/session-resolver.service.ts');
const { MiaodaWorkItemRepository } = require('../../server/modules/work-item/miaoda-work-item.repository.ts');
const { MiaodaAutomaticWorkItemLeaseAuthorizationAdapter } = require('../../server/modules/canonical-host/miaoda-automatic-work-item-lease-authorization.adapter.ts');
const { ConfiguredDevelopmentCanonicalServiceScopeAuthorization } = require('../../server/modules/canonical-host/configured-development-service-scope.authorization.ts');
const { CanonicalHostApplicabilityInputProducer } = require('../../server/modules/canonical-host/canonical-host-applicability-input.producer.ts');
const { CanonicalHostInitialAnalysisStatusService } = require('../../server/modules/canonical-host/canonical-host-initial-analysis-status.service.ts');

test('browser admission uses real SDK scope and service-only lease RLS without bypassing Source checks', async (t) => {
  const cluster = await startOwnedPostgres(await postgresCapability());
  const saved = { ...process.env };
  const scope = 'admission_fixture';
  const auth = `authenticated_${scope}`, service = `service_role_${scope}`;
  const actor = 'fixture-owner', tenant = 'fixture-tenant', principal = 'service:fixture';
  const hash = 'a'.repeat(64);
  const item = { schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: 'WI-fixture', requestId: 'fixture-request', revision: 3,
    phase: 'CANDIDATE_READBACK_VERIFIED', classification: { normalizedFamily: 'SB', status: 'CONFIRMED' },
    source: { documentId: 'DOC-fixture', documentVersionId: 'DV-fixture', sourceArtifactId: 'ART-fixture',
      sourceFileSha256: hash, sourceByteLength: 1024 },
    package: { packageId: 'PKG-fixture', contractId: 'techpub.parsed-package.v1', contractRevision: 'frozen.2' } };
  try {
    Object.assign(process.env, { SANDBOX_ID: 'owned-admission-test', WL_JOBAID_PROBLEM_V2_ENABLED: '1',
      WL_OPENCLAW_SERVICE_SCOPE_ENABLED: '1', WL_OPENCLAW_GATEWAY_AUTH_MODE: 'API_KEY',
      WL_OPENCLAW_SERVICE_SCOPE_ENV: 'DEV', WL_OPENCLAW_SERVICE_PRINCIPAL_ID: principal,
      WL_OPENCLAW_SERVICE_TENANT_ID: tenant, WL_OPENCLAW_SERVICE_AUTO_QUEUE_ENABLED: '1' });
    delete process.env.MIAODA_LOCAL_DEV;
    delete process.env.WL_OPENCLAW_SERVICE_WORK_ITEM_ID;
    const admin = cluster.admin;
    await admin.unsafe(`CREATE ROLE service_role NOLOGIN; CREATE ROLE ${auth} NOLOGIN NOSUPERUSER NOBYPASSRLS;
      CREATE ROLE ${service} NOLOGIN NOSUPERUSER NOBYPASSRLS IN ROLE service_role;
      CREATE ROLE tdms_fixture_app_1234567890abcdef LOGIN NOSUPERUSER NOBYPASSRLS IN ROLE ${auth},${service};
      CREATE TABLE work_item (tenant_id varchar,work_item_id varchar,request_id varchar,requested_by_user_id varchar,
      document_id varchar,document_version_id varchar,source_artifact_id varchar,source_file_sha256 varchar,
      source_byte_length bigint,action_type varchar,status varchar,revision integer,package_id varchar,
      run_key varchar,projection_json text,PRIMARY KEY(tenant_id,work_item_id));`);
    for (const file of ['0062_auto_work_item_authorization.sql','0063_auto_work_item_lease_ack.sql','0064_auto_work_item_block_receipt.sql'])
      await admin.unsafe(await readFile(new URL(`../../migrations/${file}`,import.meta.url),'utf8'));
    await admin.unsafe(`GRANT SELECT ON work_item,auto_work_item_authorization TO ${auth},${service};
      ALTER TABLE work_item ENABLE ROW LEVEL SECURITY;
      CREATE POLICY work_fixture ON work_item FOR SELECT USING (requested_by_user_id=current_setting('app.user_id',true));`);
    await admin`INSERT INTO work_item VALUES (${tenant},${item.workItemId},${item.requestId},${actor},
      ${item.source.documentId},${item.source.documentVersionId},${item.source.sourceArtifactId},${hash},1024,
      'PARSE_PDF','CANDIDATE_READBACK_VERIFIED',3,'PKG-fixture','fixture',${JSON.stringify(item)})`;
    await admin`INSERT INTO auto_work_item_authorization (tenant_id,work_item_id,request_id,actor_user_id,
      document_id,document_version_id,source_artifact_id,source_file_sha256,source_byte_length,grant_kind,status,
      lease_owner,lease_token,lease_generation,lease_expires_at)
      VALUES (${tenant},${item.workItemId},${item.requestId},${actor},${item.source.documentId},
      ${item.source.documentVersionId},${item.source.sourceArtifactId},${hash},1024,'MIAODA_CANONICAL_PARSE_REQUEST',
      'LEASED',${principal},'11111111-1111-4111-8111-111111111111',27,now()+interval '1 hour')`;
    const db = drizzle(await cluster.connect('tdms_fixture_app_1234567890abcdef'));
    const middleware = new SqlExecutionContextMiddleware({roleSchema: scope});
    const sessions = new SessionResolver({validate: async (token) => token === 'expired' ? null : ({
      sessionId: 'fixture-session', revision: 1, expiresAt: new Date(Date.now()+60000),
      identity: { miaodaUserId: token, tenantId: tenant, verifiedAt: new Date().toISOString(), feishuOpenId: 'fixture-open' },
    })}, {applicationScopeId:'app_17bzc551rsg',sessionEnvironment:'runtime'}, middleware);
    const repo = new MiaodaWorkItemRepository(db);
    let sourceAllowed = true, sourceReads = 0;
    const lease = new MiaodaAutomaticWorkItemLeaseAuthorizationAdapter(repo,
      { resolve: async () => ({ version: {...item.source,pdfSha256:hash,byteLength:1024},
        artifact:{sourceArtifactId:item.source.sourceArtifactId,sha256:hash,byteLength:1024} }) },
      { authorizeSourceRead: async (input) => { sourceReads++; return {...input,allowed:sourceAllowed,
        action:'DOCUMENT_READ',authorizationPolicy:'MIAODA_HOST_DOCUMENT_READ'}; } });
    const authorization = new ConfiguredDevelopmentCanonicalServiceScopeAuthorization(lease);
    const producer = new CanonicalHostApplicabilityInputProducer({}, {}, {}, authorization, {});
    // Status/parse publication are bounded fixtures; admission below uses real SQL,
    // real repository, lease adapter, service authorization, producer and sessions.
    const chain = {where:()=>chain,orderBy:()=>chain,limit:async()=>[{id:'published-original'}]};
    const statusDb = { execute:async()=>[{service:false}],select:()=>({from:()=>chain}),
      selectDistinctOn:()=>({from:()=>({where:()=>({orderBy:async()=>[]})})}) };
    const status = new CanonicalHostInitialAnalysisStatusService(statusDb,{},undefined,undefined,producer,sessions);
    const request = (token = actor, native = actor) => ({headers:token ? {cookie:`wl_session=${token}`} : {},
      userContext:{userId:native,tenantId:tenant,appId:'app_17bzc551rsg',env:'runtime',isSystemAccount:false,roles:[]}});
    const browser = (req,operation) => new Promise((resolve,reject)=>middleware.use(req,{},()=>{
      Promise.resolve().then(()=>sessions.withRequestSession(req,operation)).then(resolve,reject);
    }));
    const input = {workItem:item,tenantId:tenant,browserActorUserId:actor};
    const discover = () => status.project(input);
    const reason = (value) => value.stages.applicability.terminalCode;
    await t.test('proves the original RLS false negative, then the corrected honest context result', async()=>{
      await browser(request(),async()=>{
        const [identity] = await db.execute(sql`SELECT current_user AS role`);
        assert.equal(identity.role,auth);
        assert.equal(await repo.loadActiveAutoProcessingLease({tenantId:tenant,workItemId:item.workItemId,leaseOwner:principal,now:new Date()}),null);
        assert.equal((await producer.readOriginalAdmissionContext({tenantId:tenant,workItemId:item.workItemId,documentVersionId:item.source.documentVersionId})).reason,'CANONICAL_WORK_ITEM_NOT_FOUND');
        const value = await discover();
        assert.equal(reason(value),'APPLICABILITY_CONTEXT_NOT_CONFIGURED');
        assert.equal(value.applicabilityContextRef,null);
        assert.equal(value.stages.applicability.status,'WAITING_INPUT');
        assert.equal((await db.execute(sql`SELECT current_user AS role`))[0].role,auth);
      });
    });
    await t.test('native-only and expired sessions never query the privileged admission', async()=>{
      const before = sourceReads;
      for (const token of [null,'expired'])
        assert.equal(reason(await browser(request(token),discover)),'OFFICIAL_OAUTH_SESSION_REQUIRED');
      assert.equal(sourceReads,before);
    });
    await t.test('mismatched opaque user and native actor fail before discovery',async()=>{
      await assert.rejects(browser(request('other-user'),discover),/DIALOGUE_BROWSER_IDENTITY_MISMATCH/);
    });
    await t.test('Source denial and an expired lease retain the not-found boundary',async()=>{
      sourceAllowed=false;
      assert.equal(reason(await browser(request(),discover)),'CANONICAL_WORK_ITEM_NOT_FOUND');
      sourceAllowed=true;
      await admin`UPDATE auto_work_item_authorization SET lease_expires_at=now()-interval '1 minute'`;
      assert.equal(reason(await browser(request(),discover)),'CANONICAL_WORK_ITEM_NOT_FOUND');
    });
    await t.test('ordinary browser still cannot read or mutate the service-only grant',async()=>{
      await browser(request(),async()=>{
        assert.equal((await db.execute(sql`SELECT * FROM auto_work_item_authorization`)).length,0);
        await assert.rejects(db.execute(sql`UPDATE auto_work_item_authorization SET lease_generation=99`),(error) => error.cause?.code === '42501');
      });
      assert.equal((await admin`SELECT lease_generation FROM auto_work_item_authorization`)[0].lease_generation,27);
    });
  } finally {
    for(const key of Object.keys(process.env)) if(!(key in saved)) delete process.env[key];
    Object.assign(process.env,saved);
    await cluster.stop();
  }
});
