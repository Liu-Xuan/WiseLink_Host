import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import postgres from 'postgres';

process.env.TS_NODE_PROJECT = 'tsconfig.node.json';
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS', moduleResolution: 'node',
});
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const { getTableConfig } = require('drizzle-orm/pg-core');
const { SqlExecutionContextMiddleware } = require('@lark-apaas/fullstack-nestjs-core');
const { identitySession } = require('../../server/database/schema.ts');
const { IdentityRepository } = require('../../server/modules/identity/identity.repository.ts');
const { SessionStore } = require('../../server/modules/identity/session.store.ts');
const { SessionResolver } = require('../../server/modules/identity/session-resolver.service.ts');
const { MiaodaWorkItemRepository } = require('../../server/modules/work-item/miaoda-work-item.repository.ts');
const { MiaodaCanonicalWorkItemRegistrarAdapter } = require('../../server/modules/work-item/miaoda-canonical-work-item-registrar.adapter.ts');
const { MiaodaHostedCanonicalObjectAccessAdapter } = require('../../server/modules/work-item/miaoda-hosted-canonical-object-access.adapter.ts');
const { CanonicalObjectAccessRouter } = require('../../server/modules/work-item/canonical-object-access.router.ts');
const unavailable = require('../../server/modules/work-item/unavailable-canonical-object-access.adapters.ts');
const { ReviewConversationRepository } = require('../../server/modules/review-persistence/review-conversation.repository.ts');
const { CanonicalJobAidProblemService } = require('../../server/modules/canonical-host/canonical-jobaid-problem.service.ts');
const { JobAidWorkRepository } = require('../../server/modules/canonical-host/jobaid-work.repository.ts');
const { CanonicalHostReviewOverallProjectionService } = require('../../server/modules/canonical-host/canonical-host-review-overall-projection.service.ts');
const { CanonicalHostReviewOverallProjectionRepository } = require('../../server/modules/canonical-host/canonical-host-review-overall-projection.repository.ts');
const { canonicalJson, sealTaskEnvelope } = require('../../server/modules/action-attempt/action-attempt-envelope.ts');
const { resetQ1Database, initialProjection } = await import('./helpers/q1-review-postgres.fixture.mjs');

const databaseUrl = process.env.JOBAID_WORK_TEST_DATABASE_URL;
const options = { skip: !databaseUrl, concurrency: false };
const hash = 'a'.repeat(64);
const identity = { tenantId: 'tenant-job', actorUserId: 'actor-job',
  workItemId: 'WI-job', requestId: 'REQ-overall' };
const input = {
  requestId: identity.requestId, expectedRevision: 7,
  reviewConversationId: 'RC-review', reviewTurnId: 'RT-review',
  workRevisionRef: 'JAWR-review', expectedWorkRevision: 23,
  sourceIdentity: { documentVersionId: 'dv-job', sourceArtifactId: 'ART-TEST',
    sourceFileSha256: hash, packageId: 'PKG-WI-job', packageArtifactSha256: hash },
};

// Only fixture data and artifact I/O are substitutes. The service, session,
// object grant, registrar, exact Review/source readers and SDK patch are real.
async function fixture(t, afterArtifacts) {
  const url = new URL(databaseUrl);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.match(url.pathname, /^\/wiselink_jobaid_test_q1_[a-z0-9_]+$/u);
  const admin = postgres(databaseUrl, { max: 2, onnotice() {} });
  const queries = [];
  const applicationName = `review_overall_service_${randomUUID()}`;
  const browserSql = postgres(databaseUrl, {
    max: 1, onnotice() {}, connection: { application_name: applicationName },
  });
  t.after(async () => {
    await browserSql.end({ timeout: 0 });
    await admin.end({ timeout: 0 });
  });
  await resetQ1Database(admin);
  await admin.unsafe(`ALTER TABLE identity_subject_mapping
    ADD COLUMN feishu_open_id varchar, ADD COLUMN feishu_tenant_key varchar,
    ADD COLUMN feishu_user_id varchar, ADD COLUMN revision integer DEFAULT 1;`);
  const columns = getTableConfig(identitySession).columns.map(column =>
    `"${column.name}" ${column.getSQLType()}`);
  await admin.unsafe(`CREATE TABLE identity_session (${columns.join(',')});
    ALTER TABLE identity_session ENABLE ROW LEVEL SECURITY;`);
  const identityRls = await readFile(new URL(
    '../../migrations/0005_identity_oauth_authenticated_rls.sql', import.meta.url), 'utf8');
  for (const name of ['identity_session_authenticated_read',
    'identity_session_authenticated_update']) {
    const policy = identityRls.match(new RegExp(
      `CREATE POLICY ${name}[\\s\\S]+?\\n  \\);`, 'u'));
    assert.ok(policy);
    await admin.unsafe(policy[0]);
  }
  await admin.unsafe('GRANT SELECT, UPDATE ON identity_session TO authenticated');
  const token = 'isolated-server-session';
  await admin`INSERT INTO identity_subject_mapping(id,miaoda_user_id,miaoda_tenant_id,
    expected_client_id,status,feishu_open_id,feishu_tenant_key,revision)
    VALUES ('11111111-1111-4111-8111-111111111111','actor-job','tenant-job',
      'cli_aadde8b579f95bc9','ACTIVE','ou-isolated','isolated-tenant',1)`;
  await admin`INSERT INTO identity_session(id,session_token_hash,subject_mapping_id,
    revision,expires_at,last_seen_at,_created_at,_updated_at)
    VALUES ('22222222-2222-4222-8222-222222222222',
      ${createHash('sha256').update(token).digest('hex')},
      '11111111-1111-4111-8111-111111111111',1,now()+interval '1 hour',now(),now(),now())`;
  const current = { ...initialProjection('WI-job'), revision: 7,
    integratedAssessment: { status: 'BASE_RULE_CANDIDATE_READY',
      baseRules: { schemaVersion: 'wiselink.jobaid-problem-result.v2',
        status: 'CANDIDATE_ONLY', revision: 2, workRevisionRef: 'JAWR-old',
        workRevision: 15, artifact: initialProjection('WI-job').package.artifact },
      engineerReviews: null, overallSynthesis: { status: 'STALE', revision: 2,
        basedOnJobAidWorkRevisionRef: 'JAWR-old' }, overallForAeoConfirmation: null } };
  for (const [id, projection] of [['WI-job', current],
    ['WI-context', initialProjection('WI-context')]]) {
    await admin`INSERT INTO work_item(work_item_id,tenant_id,requested_by_user_id,
      revision,document_id,document_version_id,request_id,projection_json)
      VALUES (${id},'tenant-job','actor-job',${projection.revision},'doc-job','dv-job',
        ${projection.requestId},${JSON.stringify(projection)})`;
  }
  const task = sealTaskEnvelope({
    schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
    actionAttemptId: 'ATT-review', operationRef: 'AQ-review',
    taskType: 'OPENCLAW_INTERACTIVE_REVIEW', priority: 100, tenantId: 'tenant-job',
    workItemId: 'WI-job', inputRevision: 7, baseRevision: 7, documentVersionId: 'dv-job',
    sourceRefs: [], allowedConnectors: [], hostResolvedMissingInputs: [],
    modelInput: { jobAidContext: { actorUserId: 'actor-job',
      modelInput: { expectedWorkRevision: 22,
        documentOverview: { original: { binding: { parseRunId: 'PARSE-1' } } } },
      sourceBindings: ['WI-job', 'WI-context'].map(workItemId => ({
        kind: 'SOURCE_FILE', workItemId, documentVersionId: 'dv-job',
        artifactRef: 'ART-TEST', artifactSha256: hash,
      })) } },
    deadline: new Date(Date.now() + 3600_000).toISOString(), idempotencyKey: 'review-isolated',
  });
  await admin`INSERT INTO action_attempt(attempt_id,operation_ref,work_item_id,
    tenant_id,actor_user_id,action_type,request_origin,status,document_version_id,
    input_revision,base_revision,trigger_request_id,attempt_no,task_envelope_json,result_content_hash)
    VALUES ('ATT-review','AQ-review','WI-job','tenant-job','actor-job',
      'OPENCLAW_INTERACTIVE_REVIEW','OPENCLAW_MCP_V1','SUCCEEDED','dv-job',7,7,
      'review-request',1,${canonicalJson(task)},${hash})`;
  const content = {
    schemaVersion: 'wiselink.jobaid-problem-work.v3', headline: 'Saved headline',
    listBrief: 'Saved brief', understanding: 'Saved complete understanding',
    decisiveIssueKeys: ['ISSUE-1'], overviewStatus: 'CURRENT', roundCompletion: 'COMPLETE',
    issues: [{ issueKey: 'ISSUE-1', issueRef: 'REF-1', question: 'Question',
      body: 'Saved body', openQuestions: [] }],
    evidence: [{ kind: 'QUERY_RECEIPT', evidenceRef: 'QUERY-isolated',
      dialogueSource: { contextWorkItemIds: ['WI-context'] } }],
  };
  await admin`INSERT INTO assessment_work_revision(assessment_work_revision_id,
    tenant_id,work_item_id,work_revision,request_id,action_attempt_id,
    based_on_work_item_revision,document_version_id,command_json,content_json,created_by_user_id)
    VALUES ('JAWR-review','tenant-job','WI-job',23,'review-turn:RT-review','ATT-review',
      7,'dv-job','{}',${JSON.stringify(content)},'actor-job')`;
  await admin`INSERT INTO review_conversation(review_conversation_id,tenant_id,
    actor_id,work_item_id,openclaw_agent_id,openclaw_session_key,started_at_revision,
    last_synced_revision,status) VALUES ('RC-review','tenant-job','actor-job','WI-job',
      'wiselink-engineering','review:isolated',7,7,'ACTIVE')`;
  const engineerInput = 'WLR7:' + canonicalJson({
    schemaVersion: 'wiselink.3_1.review_engineer_input.v1.c7',
    userMessage: 'Update assessment', purpose: 'UPDATE_ASSESSMENT', attachments: [],
    executionRequested: true,
  });
  await admin`INSERT INTO review_turn(review_turn_id,review_conversation_id,
    engineer_supplied_input_id,tenant_id,actor_id,work_item_id,turn_no,request_id,
    input_revision,user_message,input_type,adoption_status,response_type,
    assistant_response,source_refs_json,missing_inputs_json,candidate_evidence_refs_json,
    review_action_draft_json,affected_item_ids_json,warnings_json,result_provenance_json,
    result_content_hash,action_attempt_id,assistant_completed_at)
    VALUES ('RT-review','RC-review','ESI-review','tenant-job','actor-job','WI-job',1,
      'review-request',7,${engineerInput},'ENGINEER_TEXT','CANDIDATE_UNADOPTED','ANSWER',
      'Saved answer','[]','[]','[]','null','[]','[]',${canonicalJson({
        actionAttemptRef: 'AQ-review', resultContentHash: hash,
        jobAidWorkingUpdate: { status: 'APPLIED', workRevisionRef: 'JAWR-review',
          workRevision: 23, affectedIssueKeys: ['ISSUE-1'] },
      })},${hash},'ATT-review',now())`;
  await admin`INSERT INTO dm_document_version(document_version_id) VALUES ('dv-job')`;
  async function publishOriginal(parseRunId, revision) {
    await admin`INSERT INTO dm_document_parse_run(parse_run_id,document_version_id,
      tenant_id,actor_user_id,request_id,parse_revision,expected_published_revision,
      status,bucket_id,source_binding,manifest_artifact,deadline_at,completed_at)
      VALUES (${parseRunId},'dv-job','tenant-job','actor-job',${parseRunId},${revision},
        ${revision - 1},'PUBLISHED','isolated-bucket',
        '{"documentVersionId":"dv-job"}','{"role":"MANIFEST","readback":"VERIFIED"}',
        now()+interval '1 hour',now())`;
  }
  await publishOriginal('PARSE-1', 1);
  const db = drizzle(browserSql, { logger: { logQuery(query) { queries.push(query); } } });
  const context = new SqlExecutionContextMiddleware({ roleSchema: 'wiselink_jobaid_test' });
  const sessions = new SessionResolver(new SessionStore(new IdentityRepository(db)), {
    applicationScopeId: 'app_17bzc551rsg', sessionEnvironment: 'runtime',
  }, context);
  const workItems = new MiaodaWorkItemRepository(db);
  const registrar = new MiaodaCanonicalWorkItemRegistrarAdapter(workItems);
  const access = new CanonicalObjectAccessRouter(new MiaodaHostedCanonicalObjectAccessAdapter(workItems),
    new unavailable.UnavailableAilyObjectAccessAdapter(),
    new unavailable.UnavailableServiceObjectAccessAdapter(),
    new unavailable.UnavailableSessionObjectAccessAdapter());
  const unused = new Proxy({}, { get(_target, name) {
    throw new Error(`UNEXPECTED_EXTERNAL_DEPENDENCY:${String(name)}`);
  } });
  const work = new JobAidWorkRepository(db, unused, unused);
  const reviews = new ReviewConversationRepository(db);
  let artifactWrites = 0;
  const artifacts = { persistAndReadback: async bytes => {
    artifactWrites += 1;
    if (artifactWrites === 2 && afterArtifacts) await afterArtifacts(admin);
    return { artifact: { ref: `artifact://isolated/${artifactWrites}`,
      sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.byteLength,
      mediaType: 'application/json', storeRole: 'U0_PARSED_PACKAGE' } };
  } };
  const jobAid = new CanonicalJobAidProblemService(registrar, artifacts, unused,
    unused, unused, unused, workItems, reviews, unused, work,
    undefined, undefined, undefined, db);
  const executions = new CanonicalHostReviewOverallProjectionRepository(db);
  const service = new CanonicalHostReviewOverallProjectionService(sessions, access,
    registrar, workItems, work, jobAid, executions, artifacts);
  const request = { headers: { cookie: `wl_session=${token}` }, userContext: {
    userId: 'actor-job', tenantId: 'tenant-job', isSystemAccount: false, roles: [],
  } };
  async function browser(callback, actorId = 'actor-job', cacheSession = false) {
    const original = request.userContext.userId;
    request.userContext.userId = actorId;
    try {
      return await new Promise((resolve, reject) => context.use(request, {}, () =>
        Promise.resolve().then(() => cacheSession
          ? sessions.withRequestSession(request, callback) : callback()).then(resolve, reject)));
    } finally { request.userContext.userId = original; }
  }
  async function bounded(callback, cacheSession = false) {
    let timer;
    try {
      return await Promise.race([browser(callback, 'actor-job', cacheSession), new Promise((_, reject) => {
        timer = setTimeout(() => {
          t.diagnostic(`lastSQL=${queries.at(-1)}`);
          reject(new Error('MAX_ONE_TRANSACTION_REENTRANT_TIMEOUT'));
        }, 3000);
      })]);
    } finally { clearTimeout(timer); }
  }
  async function unchanged() {
    const [row] = await admin`SELECT revision FROM work_item WHERE work_item_id='WI-job'`;
    assert.equal(row.revision, 7);
    const [attempt] = await admin`SELECT count(*)::int AS n FROM action_attempt
      WHERE action_type='HOST_REVIEW_OVERALL_PROJECTION'`;
    assert.equal(attempt.n, 0);
  }
  return { admin, database: db, service, sessions, executions, request, browser, bounded, unchanged,
    publishOriginal, artifactWrites: () => artifactWrites, applicationName };
}

test('Review Overall real service with max=1 commits and replays the same request', options, async t => {
  const f = await fixture(t);
  const receipt = await f.bounded(() => f.service.project('WI-job', input, f.request));
  assert.equal(receipt.status, 'SUCCEEDED');
  assert.equal(receipt.modelRequests, 0);
  assert.equal(receipt.workItemRevision, 8);
  const [row] = await f.admin`SELECT revision,projection_json FROM work_item WHERE work_item_id='WI-job'`;
  const projection = JSON.parse(row.projection_json);
  assert.equal(row.revision, 8);
  assert.equal(projection.integratedAssessment.baseRules.workRevisionRef, input.workRevisionRef);
  assert.equal(projection.integratedAssessment.overallSynthesis.basedOnJobAidWorkRevisionRef, input.workRevisionRef);
  const replay = await f.bounded(() => f.service.project('WI-job', input, f.request));
  assert.equal(replay.replayed, true);
  assert.equal(replay.executionAttemptId, receipt.executionAttemptId);
  const status = await f.bounded(() => f.service.status('WI-job', input.requestId, f.request));
  assert.equal(status.executionAttemptId, receipt.executionAttemptId);
  assert.equal(f.artifactWrites(), 2);
  const [count] = await f.admin`SELECT count(*)::int AS n FROM action_attempt
    WHERE action_type='HOST_REVIEW_OVERALL_PROJECTION'`;
  assert.equal(count.n, 1);
  await assert.rejects(f.bounded(() => f.service.project('WI-job', {
    ...input, reviewTurnId: 'RT-different',
  }, f.request)), /REVIEW_OVERALL_IDEMPOTENCY_CONFLICT/u);
});

for (const [name, mutate, expected] of [
  ['revoked session', sql => sql`UPDATE identity_session SET revoked_at=now()`,
    /REVIEW_OVERALL_LOGIN_REQUIRED/u],
  ['expired session', sql => sql`UPDATE identity_session SET expires_at=now()-interval '1 second'`,
    /REVIEW_OVERALL_LOGIN_REQUIRED/u],
  // Mapping revocation already hides the latest work under RLS before the callback.
  ['revoked actor mapping', sql => sql`UPDATE identity_subject_mapping SET status='REVOKED'`,
    /JOBAID_OVERALL_EXACT_WORK_CHANGED/u],
]) {
  test(`Review Overall max=1 fresh validation rejects ${name} even with request session cache`, options, async t => {
    const f = await fixture(t, mutate);
    await assert.rejects(f.bounded(() => f.service.project('WI-job', input, f.request), true), expected);
    await f.unchanged();
  });
}

test('Review Overall session resolver rechecks a revoked mapping in the supplied transaction', options, async t => {
  const f = await fixture(t);
  const resolved = await f.bounded(async () => {
    await f.admin`UPDATE identity_subject_mapping SET status='REVOKED'`;
    return f.database.transaction(database => f.sessions.resolve(f.request, database));
  }, true);
  assert.equal(resolved, null);
  await f.unchanged();
});

for (const [name, mutate, expected] of [
  ['retained context source revoked', sql => sql`UPDATE work_item SET requested_by_user_id='actor-other'
    WHERE work_item_id='WI-context'`, /JOBAID_SOURCE_AUTHORIZATION_CHANGED/u],
  ['retained context source hash changed', async sql => {
    const [row] = await sql`SELECT projection_json FROM work_item WHERE work_item_id='WI-context'`;
    const projection = JSON.parse(row.projection_json);
    projection.source.sourceFileSha256 = 'b'.repeat(64);
    await sql`UPDATE work_item SET projection_json=${JSON.stringify(projection)}
      WHERE work_item_id='WI-context'`;
  },
    /JOBAID_OVERALL_EXACT_WORK_REQUIRED/u],
  ['owner changed', sql => sql`UPDATE work_item SET requested_by_user_id='actor-other'
    WHERE work_item_id='WI-job'`, /WORK_ITEM_CAS_CONFLICT/u],
  ['WorkItem CAS changed', sql => sql`UPDATE work_item SET revision=8,
    projection_json=jsonb_set(projection_json::jsonb,'{revision}','8')::text
    WHERE work_item_id='WI-job'`, /WORK_ITEM_CAS_CONFLICT/u],
]) {
  test(`Review Overall max=1 commit rejects ${name}`, options, async t => {
    const f = await fixture(t, mutate);
    await assert.rejects(f.bounded(() => f.service.project('WI-job', input, f.request)), expected);
    const [attempt] = await f.admin`SELECT count(*)::int AS n FROM action_attempt
      WHERE action_type='HOST_REVIEW_OVERALL_PROJECTION'`;
    assert.equal(attempt.n, 0);
  });
}

test('Review Overall max=1 rejects cross actor and tenant before artifact writes', options, async t => {
  const f = await fixture(t);
  await assert.rejects(f.browser(() => f.service.project('WI-job', input, f.request), 'actor-other'),
    /REVIEW_OVERALL_LOGIN_REQUIRED/u);
  await f.admin`UPDATE identity_subject_mapping SET miaoda_tenant_id='tenant-other'`;
  await assert.rejects(f.bounded(() => f.service.project('WI-job', input, f.request)),
    /CANONICAL_WORK_ITEM_NOT_FOUND/u);
  assert.equal(f.artifactWrites(), 0);
  await f.unchanged();
});

test('Review Overall max=1 rechecks the exact original parse in the commit transaction', options, async t => {
  let f;
  f = await fixture(t, () => f.publishOriginal('PARSE-2', 2));
  await assert.rejects(f.bounded(() => f.service.project('WI-job', input, f.request)),
    /JOBAID_OVERALL_ORIGINAL_PARSE_CHANGED/u);
  await f.unchanged();
});

test('Review Overall max=1 rolls back the execution row when final projection commit fails', options, async t => {
  const f = await fixture(t);
  const insert = f.executions.insert.bind(f.executions);
  f.executions.insert = async args => {
    await insert(args);
    throw new Error('AFTER_EXECUTION_INSERT');
  };
  await assert.rejects(f.bounded(() => f.service.project('WI-job', input, f.request)),
    /AFTER_EXECUTION_INSERT/u);
  await f.unchanged();
  f.executions.insert = insert;
  const recovered = await f.bounded(() => f.service.project('WI-job', input, f.request));
  assert.equal(recovered.workItemRevision, 8);
  assert.equal(recovered.replayed, false);
});
