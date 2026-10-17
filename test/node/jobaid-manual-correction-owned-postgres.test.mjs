import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { postgresCapability, startOwnedPostgres } from '../pg/owned-postgres-cluster.mjs';

process.env.TS_NODE_PROJECT = 'tsconfig.node.json';
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const { SqlExecutionContextMiddleware } = require('@lark-apaas/fullstack-nestjs-core');
const { SessionResolver } = require('../../server/modules/identity/session-resolver.service.ts');
const { MiaodaWorkItemRepository } = require('../../server/modules/work-item/miaoda-work-item.repository.ts');
const { MiaodaCanonicalWorkItemRegistrarAdapter } = require('../../server/modules/work-item/miaoda-canonical-work-item-registrar.adapter.ts');
const { MiaodaHostedCanonicalObjectAccessAdapter } = require('../../server/modules/work-item/miaoda-hosted-canonical-object-access.adapter.ts');
const { OrdinaryCanonicalAuthorizationAdapter, OrdinaryCanonicalPermissionSnapshotAdapter } = require('../../server/modules/canonical-host/ordinary-canonical-authorization.adapter.ts');
const { ReviewConversationRepository } = require('../../server/modules/review-persistence/review-conversation.repository.ts');
const { EngineeringMatterWorkingRepository } = require('../../server/modules/canonical-host/engineering-matter-working.repository.ts');
const { EngineeringSearchProjectionWriter } = require('../../server/modules/canonical-host/engineering-search-projection.ts');
const { JobAidWorkRepository } = require('../../server/modules/canonical-host/jobaid-work.repository.ts');
const { CanonicalJobAidProblemService } = require('../../server/modules/canonical-host/canonical-jobaid-problem.service.ts');
const { CanonicalJobAidWorkCorrectionService } = require('../../server/modules/canonical-host/canonical-jobaid-work-correction.service.ts');
const { CanonicalJobAidWorkCorrectionController } = require('../../server/modules/canonical-host/canonical-jobaid-work-correction.controller.ts');
const { DialogueBrowserScope } = require('../../server/modules/canonical-host/dialogue-browser-scope.service.ts');
const { ProductionMiaodaBrowserObjectIngressGuard } = require('../../server/modules/work-item/production-miaoda-browser-ingress.ts');
const { materializeManualJobAidCorrection } = require('../../server/modules/canonical-host/jobaid-work-correction.ts');
const { correctionFixture } = require('../fixtures/jobaid-work-correction.fixture.ts');
const { resetQ1Database, initialProjection } = await import('./helpers/q1-review-postgres.fixture.mjs');

// No URL/environment fallback: this spec owns the loopback server, random database,
// roles and synthetic data, and always destroys them. It never reaches a hosted DB.
test('manual correction: real consumer, transaction, recovery and disjoint PostgreSQL RLS', { timeout: 60000 }, async t => {
  const capability = await postgresCapability();
  assert.equal(capability.available, true, capability.reason ?? 'PostgreSQL engine required');
  const cluster = await startOwnedPostgres(capability);
  t.after(() => cluster.stop());
  const admin = cluster.admin;
  const savedSandbox = process.env.SANDBOX_ID;
  const savedLocal = process.env.MIAODA_LOCAL_DEV;
  process.env.SANDBOX_ID = 'isolated-manual-correction-test';
  delete process.env.MIAODA_LOCAL_DEV;
  t.after(() => {
    if (savedSandbox === undefined) delete process.env.SANDBOX_ID; else process.env.SANDBOX_ID = savedSandbox;
    if (savedLocal === undefined) delete process.env.MIAODA_LOCAL_DEV; else process.env.MIAODA_LOCAL_DEV = savedLocal;
  });
  await resetQ1Database(admin);
  // Fixture-only native read admission: exact local authenticated role, active
  // mapping and owned WI/DVI. This is narrower than deployed 0078 shared reads.
  await admin.unsafe(`CREATE FUNCTION native_app_shared_read_allowed(target_tenant varchar)
    RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_user='authenticated_wiselink_jobaid_test'
      AND engineering_matter_actor_has_tenant(target_tenant) $$;
    CREATE FUNCTION native_app_work_item_readable(target_tenant varchar,target_work_item varchar)
    RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT native_app_shared_read_allowed(target_tenant)
      AND engineering_matter_work_item_owned_by_actor(target_tenant,target_work_item) $$;
    CREATE FUNCTION native_app_document_readable(target_tenant varchar,target_document_version varchar)
    RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT native_app_shared_read_allowed(target_tenant)
      AND EXISTS(SELECT 1 FROM work_item w WHERE w.tenant_id=target_tenant
        AND w.document_version_id=target_document_version
        AND w.requested_by_user_id=current_setting('app.user_id',true)) $$;`);
  const login = `tdms_fixture_app_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  await admin.unsafe(`CREATE ROLE ${login} LOGIN NOSUPERUSER NOBYPASSRLS
    IN ROLE authenticated_wiselink_jobaid_test,service_role_wiselink_jobaid_test`);
  const client = await cluster.connect(login);
  const db = drizzle(client);
  const sqlContext = new SqlExecutionContextMiddleware({ roleSchema: 'wiselink_jobaid_test' });
  const sessions = new SessionResolver({ findByToken: () => { throw new Error('UNEXPECTED_OAUTH'); } },
    { applicationScopeId: 'app_17bzc551rsg', sessionEnvironment: 'runtime' }, sqlContext);
  const scope = new DialogueBrowserScope(sessions);
  const search = new EngineeringSearchProjectionWriter(db);
  const actorTransactions = new EngineeringMatterWorkingRepository(db, sqlContext,
    { roleSchema: 'wiselink_jobaid_test' }, search);
  const work = new JobAidWorkRepository(db, actorTransactions, search);
  const workItems = new MiaodaWorkItemRepository(db);
  const access = new MiaodaHostedCanonicalObjectAccessAdapter(workItems);
  const unused = new Proxy({}, { get(_target, name) { throw new Error(`UNEXPECTED_MODEL_OR_EXTERNAL:${String(name)}`); } });
  const jobAid = new CanonicalJobAidProblemService(new MiaodaCanonicalWorkItemRegistrarAdapter(workItems),
    unused, unused, new OrdinaryCanonicalAuthorizationAdapter(access), new OrdinaryCanonicalPermissionSnapshotAdapter(access),
    unused, workItems, new ReviewConversationRepository(db), unused, work,
    undefined, undefined, undefined, db, undefined, access);
  const service = new CanonicalJobAidWorkCorrectionService(sessions, access, work, jobAid);
  const controller = new CanonicalJobAidWorkCorrectionController(service, scope);
  const request = { headers: {}, userContext: { userId: 'actor-job', tenantId: 'tenant-job',
    appId: 'app_17bzc551rsg', env: 'runtime', isSystemAccount: false, roles: [] } };
  const guard = new ProductionMiaodaBrowserObjectIngressGuard();
  function guarded() { return guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) }); }
  async function save(command) { guarded(); return controller.save('WI-job', command, request); }
  function read(id) { guarded(); return controller.read('WI-job', id, request); }
  function browserRead() { return scope.runRead(request, () => jobAid.readBrowser('WI-job', {
    userId: request.userContext.userId, tenantId: request.userContext.tenantId,
    roles: [], objectAccessActor: sessions.nativeBrowserIdentity(request).actor })); }
  async function seed() {
    await admin.unsafe(`TRUNCATE assessment_work_revision,action_attempt,work_item,
      identity_subject_mapping,engineering_search_projection_pending CASCADE`);
    await admin`INSERT INTO identity_subject_mapping(miaoda_user_id,miaoda_tenant_id,expected_client_id,status)
      VALUES ('actor-job','tenant-job','cli_aadde8b579f95bc9','ACTIVE'),
      ('actor-other','tenant-job','cli_aadde8b579f95bc9','ACTIVE')`;
    const { base, request: command } = correctionFixture();
    const projection = { ...initialProjection('WI-job'), revision: 7,
      integratedAssessment: { status: 'BASE_RULE_CANDIDATE_READY', baseRules: {
        schemaVersion: 'wiselink.jobaid-problem-result.v2', status: 'CANDIDATE_ONLY',
        revision: 2, workRevisionRef: base.workRevisionRef, workRevision: base.workRevision,
        artifact: initialProjection('WI-job').package.artifact },
      overallSynthesis: { status: 'CANDIDATE_ONLY', basedOnJobAidWorkRevisionRef: base.workRevisionRef },
      engineerReviews: null, overallForAeoConfirmation: null } };
    await admin`INSERT INTO work_item(work_item_id,tenant_id,requested_by_user_id,revision,
      document_id,document_version_id,request_id,projection_json)
      VALUES ('WI-job','tenant-job','actor-job',7,'doc-job','dv-job','REQ-WI-job',${JSON.stringify(projection)})`;
    await admin`INSERT INTO action_attempt(attempt_id,operation_ref,subject_kind,work_item_id,
      tenant_id,actor_user_id,action_type,request_origin,status,document_version_id,
      input_revision,base_revision,trigger_request_id,attempt_no)
      VALUES ('ATT-base','AQ-base','WORK_ITEM','WI-job','tenant-job','actor-job',
        'OPENCLAW_DYNAMIC_EVALUATION','OPENCLAW_MCP_V1','SUCCEEDED','dv-job',7,7,'original-save',1)`;
    await admin`INSERT INTO assessment_work_revision(assessment_work_revision_id,tenant_id,work_item_id,
      work_revision,request_id,action_attempt_id,based_on_work_item_revision,document_version_id,
      command_json,content_json,created_by_user_id)
      VALUES (${base.workRevisionRef},'tenant-job','WI-job',4,'original-save','ATT-base',7,'dv-job',
        '{}',${JSON.stringify(base.content)},'actor-job')`;
    return { base, command, projection };
  }
  async function counts() {
    const [row] = await admin`SELECT (SELECT count(*)::integer FROM assessment_work_revision) AS work,
      (SELECT count(*)::integer FROM action_attempt) AS attempts,
      (SELECT count(*)::integer FROM engineering_search_projection_pending) AS pending`;
    return row;
  }

  await t.test('original 0026 cannot save a manual producer; failure rolls everything back', async () => {
    const { command } = await seed();
    await assert.rejects(() => save(command), error => error.cause?.code === '42501' || error.code === '42501');
    assert.deepEqual(await counts(), { work: 1, attempts: 1, pending: 0 });
  });
  await admin.unsafe(await readFile(new URL('../../migrations/candidates/jobaid_manual_correction.hosted.sql', import.meta.url), 'utf8'));

  await t.test('actual controller/service save and browser latest read return the complete precise JAWR', async () => {
    const { base, command, projection } = await seed();
    const before = await browserRead();
    assert.equal(before.overallStatus, 'CURRENT');
    const receipt = await save(command);
    assert.equal(receipt.status, 'SAVED');
    assert.equal(receipt.modelRequests, 0);
    assert.equal(receipt.adopted, false);
    assert.equal(receipt.candidateCarrierAdvanced, false);
    assert.equal(receipt.workRevision, 5);
    assert.equal(receipt.replayed, false);
    assert.deepEqual(receipt.work.content, materializeManualJobAidCorrection(base, command).content);
    const actual = await browserRead();
    assert.deepEqual(actual.current, receipt.work);
    assert.equal(actual.current.content.evidence.length, 70);
    assert.equal(actual.current.content.overviewStatus, 'STALE');
    assert.equal(actual.overallStatus, 'STALE');
    const [stored] = await admin`SELECT projection_json,revision FROM work_item WHERE work_item_id='WI-job'`;
    assert.deepEqual(JSON.parse(stored.projection_json), projection);
    assert.equal(stored.revision, 7);
    assert.deepEqual(await counts(), { work: 2, attempts: 2, pending: 1 });
    const [audit] = await admin`SELECT * FROM action_attempt WHERE attempt_id=${receipt.executionAttemptId}`;
    assert.equal(audit.status, 'SUCCEEDED');
    assert.equal(audit.lease_owner, null);
    assert.equal(audit.task_envelope_json, null);
    assert.equal(audit.execution_model_json, null);
    assert.equal(JSON.parse(audit.review_activity_json).receipt.work, undefined);
    assert.deepEqual(JSON.parse(audit.review_activity_json).request, command);
  });

  await t.test('lost response recovers by requestId; exact replay is single-save even after a later revision', async () => {
    const { command } = await seed();
    const recovery = work.readManualCorrection.bind(work);
    work.readManualCorrection = async () => { throw new Error('TEST_COMMITTED_RESPONSE_LOST'); };
    try { await assert.rejects(() => save(command), /TEST_COMMITTED_RESPONSE_LOST/); }
    finally { work.readManualCorrection = recovery; }
    assert.deepEqual(await counts(), { work: 2, attempts: 2, pending: 1 });
    const recovered = await read(command.requestId);
    assert.equal(recovered.replayed, true);
    assert.equal((await save(command)).workRevisionRef, recovered.workRevisionRef);
    assert.deepEqual(await counts(), { work: 2, attempts: 2, pending: 1 });
    const next = structuredClone(command);
    next.requestId = 'next-correction';
    next.baseWorkRef = recovered.workRevisionRef; next.baseWorkRevision = recovered.workRevision;
    next.changes = [next.changes[0]];
    next.changes[0].expectedOldValue = recovered.work.content.issues[0].body;
    next.changes[0].newValue += ' Later synthetic correction.';
    await save(next);
    assert.deepEqual((await save(command)).work, recovered.work);
    await assert.rejects(() => save({ ...command, changes: [{ ...command.changes[0], reason: 'Different request' }] }), /REQUEST_REUSE/);
    assert.deepEqual(await counts(), { work: 3, attempts: 3, pending: 2 });
  });

  await t.test('two physical connections race on one latest base: one save, one CAS conflict; same request replays', async () => {
    const { command } = await seed();
    const second = drizzle(await cluster.connect(login));
    const secondSearch = new EngineeringSearchProjectionWriter(second);
    const secondWork = new JobAidWorkRepository(second,
      new EngineeringMatterWorkingRepository(second, sqlContext, { roleSchema: 'wiselink_jobaid_test' }, secondSearch), secondSearch);
    const secondController = new CanonicalJobAidWorkCorrectionController(
      new CanonicalJobAidWorkCorrectionService(sessions, access, secondWork, jobAid), scope);
    const other = structuredClone(command); other.requestId = 'parallel-other';
    other.changes[0].newValue += ' Other synthetic request.';
    const results = await Promise.allSettled([save(command), secondController.save('WI-job', other, request)]);
    const successful = results.filter(item => item.status === 'fulfilled');
    const failed = results.filter(item => item.status === 'rejected');
    assert.equal(successful.length, 1);
    assert.equal(failed.length, 1);
    assert.match(failed[0].reason.message, /BASE_CONFLICT/);
    assert.deepEqual(await counts(), { work: 2, attempts: 2, pending: 1 });
    await seed();
    const same = await Promise.all([save(command), secondController.save('WI-job', command, request)]);
    assert.equal(same[0].workRevisionRef, same[1].workRevisionRef);
    assert.equal(same.filter(item => item.replayed).length, 1);
    assert.deepEqual(await counts(), { work: 2, attempts: 2, pending: 1 });
  });

  await t.test('no-op audit preserves CURRENT; conflicts and structural injection never create audit/work', async () => {
    const { command } = await seed();
    const noop = structuredClone(command);
    for (const change of noop.changes) change.newValue = change.expectedOldValue;
    const receipt = await save(noop);
    assert.equal(receipt.status, 'UNCHANGED');
    assert.equal(receipt.workRevision, 4);
    assert.equal((await browserRead()).overallStatus, 'CURRENT');
    const fresh = { ...command, requestId: 'conflict' };
    await assert.rejects(() => save({ ...fresh, expectedWorkItemRevision: 6 }), /WORK_ITEM_CONFLICT/);
    await assert.rejects(() => save({ ...fresh, baseWorkRevision: 3 }), /BASE_CONFLICT/);
    await assert.rejects(() => save({ ...fresh, changes: [{ ...command.changes[0], expectedOldValue: 'wrong' }] }), /OLD_VALUE_CONFLICT/);
    await assert.rejects(() => save({ ...fresh, adopted: true }), /REQUEST_INVALID/);
    await assert.rejects(() => save({ ...fresh, changes: [{ ...command.changes[0], path: 'owner' }] }), /REQUEST_INVALID/);
    assert.deepEqual(await counts(), { work: 1, attempts: 2, pending: 0 });
  });

  await t.test('current owner, source identity and mapping are rechecked; receipt is unavailable after revoke', async () => {
    const { command } = await seed();
    const saved = await save(command);
    await admin`UPDATE work_item SET requested_by_user_id='actor-other' WHERE work_item_id='WI-job'`;
    await assert.rejects(() => read(command.requestId), /OWNER_REQUIRED/);
    await assert.rejects(() => save({ ...command, requestId: 'revoked' }), /OWNER_REQUIRED/);
    await admin`UPDATE work_item SET requested_by_user_id='actor-job',document_version_id='dv-other' WHERE work_item_id='WI-job'`;
    await assert.rejects(() => read(command.requestId), /SOURCE_CONFLICT/);
    await admin`UPDATE work_item SET document_version_id='dv-job' WHERE work_item_id='WI-job'`;
    await admin`UPDATE identity_subject_mapping SET status='REVOKED' WHERE miaoda_user_id='actor-job'`;
    await assert.rejects(() => read(command.requestId), /ACTOR_AUTHORIZATION_CHANGED|BASE_CONFLICT/);
    assert.equal(saved.workRevision, 5);
    assert.deepEqual(await counts(), { work: 2, attempts: 2, pending: 1 });
  });

  await t.test('late authorization failure and derived-write failure atomically roll back all new rows', async () => {
    const { command } = await seed();
    const original = jobAid.assertManualCorrectionEvidence.bind(jobAid);
    let calls = 0;
    jobAid.assertManualCorrectionEvidence = async (...args) => {
      await original(...args); calls += 1;
      if (calls === 3) throw new Error('TEST_LATE_AUTHORIZATION_REVOKED');
    };
    try { await assert.rejects(() => save(command), /TEST_LATE_AUTHORIZATION_REVOKED/); }
    finally { jobAid.assertManualCorrectionEvidence = original; }
    assert.deepEqual(await counts(), { work: 1, attempts: 1, pending: 0 });
    const enqueue = search.enqueuePending.bind(search);
    search.enqueuePending = async (...args) => { await enqueue(...args); throw new Error('TEST_SEARCH_FAILURE'); };
    try { await assert.rejects(() => save(command), /TEST_SEARCH_FAILURE/); }
    finally { search.enqueuePending = enqueue; }
    assert.deepEqual(await counts(), { work: 1, attempts: 1, pending: 0 });
  });

  await t.test('receipt read fails explicitly for a malformed or inconsistent persisted audit', async () => {
    const { command } = await seed();
    const saved = await save(command);
    const [row] = await admin`SELECT review_activity_json FROM action_attempt WHERE attempt_id=${saved.executionAttemptId}`;
    const audit = JSON.parse(row.review_activity_json);
    audit.receipt.workItemRevision = 6;
    await admin`UPDATE action_attempt SET review_activity_json=${JSON.stringify(audit)} WHERE attempt_id=${saved.executionAttemptId}`;
    await assert.rejects(() => read(command.requestId), /AUDIT_INVALID/);
    await admin`UPDATE action_attempt SET review_activity_json='not-json' WHERE attempt_id=${saved.executionAttemptId}`;
    await assert.rejects(() => read(command.requestId), /AUDIT_INVALID/);
    assert.deepEqual(await counts(), { work: 2, attempts: 2, pending: 1 });
  });

  await t.test('active model/review execution conflicts, and old leased SAVE still rejects a stale token', async () => {
    const { command } = await seed();
    await admin`UPDATE action_attempt SET status='RUNNING',lease_owner='service:old',lease_token='current-token',
      lease_generation=2,lease_expires_at=now()+interval '1 hour',deadline_at=now()+interval '1 hour'
      WHERE attempt_id='ATT-base'`;
    await assert.rejects(() => save(command), /ACTIVE_EXECUTION/);
    await assert.rejects(() => scope.run(request, async () => {
      const { actionAttempt } = require('../../server/database/schema.ts');
      const [attempt] = await db.select().from(actionAttempt);
      return work.save({ row: attempt, actorUserId: 'actor-job',
        fence: { principalId: 'service:old', leaseToken: 'stale-token', leaseGeneration: 2 },
        sourceBindings: [{ kind: 'SOURCE_FILE', workItemId: 'WI-job', documentVersionId: 'dv-job', artifactRef: 'ART-TEST', artifactSha256: 'a'.repeat(64) }],
        requestId: 'stale-save', expectedWorkRevision: 4, command: {}, content: correctionFixture().base.content });
    }), /LEASE_FENCE_REJECTED/);
    assert.deepEqual(await counts(), { work: 1, attempts: 1, pending: 0 });
  });

  await t.test('SQL policy binds exact producer, subject, tenant, owner, DVI, latest base and command', async () => {
    const mutations = [
      ['status', a => { a.status = 'SUCCEEDED'; }],
      ['producer', a => { a.action_type = 'OTHER_HOST_ACTION'; }],
      ['origin', a => { a.request_origin = 'OTHER'; }],
      ['subject', a => { a.subject_kind = 'ENGINEERING_MATTER'; }],
      ['actor', a => { a.actor_user_id = 'actor-other'; }],
      ['tenant', a => { a.tenant_id = 'tenant-other'; }],
      ['DVI', a => { a.document_version_id = 'dv-other'; }],
      ['base WI', a => { a.base_revision = 6; a.input_revision = 6; }],
      ['trigger', a => { a.trigger_request_id = 'wrong'; }],
      ['fake lease', a => { a.lease_owner = 'service:fake'; }],
      ['model envelope', a => { a.execution_model_json = '{}'; }],
      ['model count', a => { a.review_activity_json.modelRequests = 1; }],
      ['command mismatch', (_a, w) => { w.command_json.changes[0].newValue = 'different'; }],
      ['base ref', a => { a.review_activity_json.request.baseWorkRef = 'JAWR-other'; }],
      ['base revision', a => { a.review_activity_json.request.baseWorkRevision = 3; }],
    ];
    async function attempt(mutate, prepare) {
      const { base, command } = await seed();
      if (prepare) await prepare();
      const a = { attempt_id: 'ATT-policy', operation_ref: 'AQ-policy', subject_kind: 'WORK_ITEM',
        work_item_id: 'WI-job', tenant_id: 'tenant-job', actor_user_id: 'actor-job',
        action_type: 'HOST_JOBAID_MANUAL_CORRECTION', request_origin: 'HOST_BROWSER_CORRECTION', status: 'COMMITTING',
        document_version_id: 'dv-job', input_revision: 7, base_revision: 7, trigger_request_id: command.requestId,
        attempt_no: 1, lease_generation: 0,
        review_activity_json: { schemaVersion: 'wiselink.jobaid-manual-correction-execution.v1',
          executionKind: 'HOST_MANUAL_CORRECTION', modelRequests: 0, semanticReanalysisPerformed: false,
          request: structuredClone(command), receipt: null } };
      const w = { assessment_work_revision_id: 'JAWR-policy', tenant_id: 'tenant-job', work_item_id: 'WI-job',
        work_revision: 5, request_id: command.requestId, action_attempt_id: a.attempt_id,
        based_on_work_item_revision: 7, document_version_id: 'dv-job', previous_work_revision_id: base.workRevisionRef,
        command_json: structuredClone(command), content_json: JSON.stringify(base.content), created_by_user_id: 'actor-job' };
      mutate?.(a, w);
      a.review_activity_json = JSON.stringify(a.review_activity_json);
      w.command_json = JSON.stringify(w.command_json);
      await admin`INSERT INTO action_attempt ${admin(a)}`;
      return admin.begin(async tx => {
        await tx.unsafe('SET LOCAL ROLE service_role_wiselink_jobaid_test');
        await tx`SELECT set_config('app.user_id','actor-job',true)`;
        await tx`INSERT INTO assessment_work_revision ${tx(w)}`;
      });
    }
    await attempt();
    for (const [label, mutate] of mutations)
      await assert.rejects(() => attempt(mutate), e => e.code === '42501', label);
    await assert.rejects(() => attempt(undefined, () => admin`UPDATE work_item SET requested_by_user_id='actor-other'`), e => e.code === '42501', 'current owner');
    await assert.rejects(() => attempt(undefined, () => admin`INSERT INTO assessment_work_revision
      (assessment_work_revision_id,tenant_id,work_item_id,work_revision,request_id,action_attempt_id,
       based_on_work_item_revision,document_version_id,previous_work_revision_id,command_json,content_json,created_by_user_id)
      SELECT 'JAWR-newer',tenant_id,work_item_id,5,'newer',action_attempt_id,based_on_work_item_revision,
        document_version_id,assessment_work_revision_id,command_json,content_json,created_by_user_id
        FROM assessment_work_revision WHERE assessment_work_revision_id='JAWR-base'`),
    e => e.code === '42501', 'latest base');
    // Wrong native/service contexts cannot borrow the exact service producer policy.
    const { command } = await seed();
    request.userContext.isSystemAccount = true;
    try { assert.throws(guarded, /IDENTITY_HANDOFF_UNAVAILABLE/); }
    finally { request.userContext.isSystemAccount = false; }
    request.userContext.appId = 'other-app';
    try { await assert.rejects(() => save(command), /IDENTITY_HANDOFF_UNAVAILABLE/); }
    finally { request.userContext.appId = 'app_17bzc551rsg'; }
  });
});
