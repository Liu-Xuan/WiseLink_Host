import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import postgres from 'postgres';

process.env.TS_NODE_PROJECT = 'tsconfig.node.json';
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const { sql: querySql } = require('drizzle-orm');
const { SqlExecutionContextMiddleware } = require('@lark-apaas/fullstack-nestjs-core');
const { EngineeringMatterWorkingRepository } = require('../../server/modules/canonical-host/engineering-matter-working.repository.ts');
const { JobAidWorkRepository } = require('../../server/modules/canonical-host/jobaid-work.repository.ts');
const { CanonicalJobAidProblemService } = require('../../server/modules/canonical-host/canonical-jobaid-problem.service.ts');
const { ReviewConversationRepository } = require('../../server/modules/review-persistence/review-conversation.repository.ts');
const { DerivedSummaryMembersService } = require('../../server/modules/canonical-host/derived-summary-members.service.ts');
const { DerivedSummaryRepository } = require('../../server/modules/canonical-host/derived-summary.repository.ts');
const { DerivedSummaryService } = require('../../server/modules/canonical-host/derived-summary.service.ts');
const { DerivedSummaryRuntimeService } = require('../../server/modules/canonical-host/derived-summary-runtime.service.ts');
const { JOBAID_METHOD_BINDING } = require('../../server/modules/canonical-host/jobaid-method-pack.ts');

const databaseUrl = process.env.DERIVED_SUMMARY_TEST_DATABASE_URL;
// The SDK roleSchema is the actual fixed schema used by the functions.
const roleSchema = 'public';
const owner = { tenantId: 'tenant-summary', actorUserId: 'actor-summary' };
const scope = { tenantId: owner.tenantId, principalId: 'service-summary', appId: 'app_17bzc551rsg', authorizationFingerprint: 'configured' };
const source = { kind: 'DOCUMENT_PASSAGE', evidenceRef: 'SOURCE-DV-old-para1', title: 'Synthetic old publication',
  versionLabel: 'R1', excerpt: 'Monitoring remains incomplete; no applicability decision is made.',
  workItemId: 'WI-summary', documentVersionId: 'DV-old', sourceRefId: 'SR-1', locator: 'paragraph 1' };
const member = { kind: 'WORK_ITEM_WORK', workItemId: 'WI-summary', documentVersionId: 'DV-old',
  workRef: 'JA-summary23', workRevision: 23, issueKeys: ['tls-cause', 'tls-measure'] };
const request = { requestId: 'ATA4-request', scope: { kind: 'ATA4', title: 'B787 selected ATA46-00 materials',
  fleetFamilyId: 'B787', fleetModelIds: [], ata2: '46', ata4: '46-00', selectionReason: 'Explicit candidate selection, unconfirmed membership' },
  members: [member], instruction: 'Explain the selected saved work and retain old/new publication gaps', modelRef: 'miaoda/glm-5.3' };

test('real saved aggregate/upper consumer preserves exact work, pool1, CAS, lease and revocation',
  { skip: !databaseUrl, timeout: 60000 }, async t => {
    const url = new URL(databaseUrl);
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
    assert.match(url.pathname, /^\/derived_summary_test_[a-z0-9_]+$/u);
    const admin = postgres(databaseUrl, { max: 1, onnotice() {} });
    let connection;
    try {
      await t.test('exact SDK SQL roles survive PUBLIC serializer conversion, upgrade and replay', () => reset(admin));
      await seed(admin);
      connection = postgres(databaseUrl, { max: 1, onnotice() {} });
      const database = drizzle(connection);
      const sqlContext = new SqlExecutionContextMiddleware({ roleSchema });
      const transactions = new EngineeringMatterWorkingRepository(database, sqlContext, { roleSchema }, null);
      const works = new JobAidWorkRepository(database, transactions, null);
      const jobAid = new CanonicalJobAidProblemService(null, null, null, null, null, null, null,
        new ReviewConversationRepository(database), null, works);
      const members = new DerivedSummaryMembersService(jobAid, transactions);
      const repository = new DerivedSummaryRepository(database, transactions, members);
      const authorization = { authorizeOpenClawAutoWorkItemQueue: async () => scope };
      const summaries = new DerivedSummaryService(repository, members, authorization);
      const runtime = new DerivedSummaryRuntimeService(repository, members, summaries);
      const context = (actorId, hosted, operation) => new Promise((resolve, reject) => sqlContext.use({
        userContext: { userId: actorId, isSystemAccount: hosted, roles: [] } }, {},
      () => Promise.resolve().then(operation).then(resolve, reject)));
      const browser = operation => context(owner.actorUserId, false, operation);
      const hosted = operation => context('-1', true, operation);
      const actor = nativeActor(owner.actorUserId, owner.tenantId);
      // Exercise an external reader needing this same max=1 pool. It must run
      // outside the save transaction; the original source registry remains unchanged.
      const verify = members.verifyOriginalEvidence.bind(members);
      members.verifyOriginalEvidence = async (evidence, actor) => {
        await verify(evidence, actor);
        await transactions.withActorScope(actor.actorUserId, () => database.execute(querySql`SELECT pg_backend_pid()`));
      };
      let accepted;
      await t.test('native actor admits a fixed work and explicit GLM route; replay does not create another task', async () => {
        accepted = await browser(() => summaries.create(request, actor));
        assert.equal(accepted.status, 'QUEUED');
        assert.equal((await browser(() => summaries.create(request, actor))).created, false);
        await assert.rejects(browser(() => summaries.create({ ...request, instruction: 'changed' }, actor)), /REQUEST_ID_REUSED/u);
        assert.throws(() => summaries.create(request, { ...actor, objectAccessActor: undefined }), /IDENTITY_HANDOFF/u);
        await assert.rejects(context('other-actor', false, () => summaries.read(accepted.summaryId,
          nativeActor('other-actor', owner.tenantId))), /UNAVAILABLE/u);
        const rows = await admin`SELECT subject_kind,work_item_id,matter_id,summary_id,execution_model_json FROM action_attempt WHERE operation_ref=${accepted.attemptRef}`;
        assert.equal(rows[0].subject_kind, 'DERIVED_SUMMARY');
        assert.equal(rows[0].work_item_id, null); assert.equal(rows[0].matter_id, null);
        assert.equal(JSON.parse(rows[0].execution_model_json).modelRef, 'miaoda/glm-5.3');
      });
      await t.test('DB CHECK rejects a fake WI summary action while retaining ordinary WI and real summary subjects', async () => {
        const insert = (attemptId, actionType) => admin`INSERT INTO action_attempt(attempt_id,work_item_id,subject_kind,attempt_no,
          tenant_id,actor_user_id,action_type,trigger_request_id,request_origin,status)
          VALUES (${attemptId},'WI-summary','WORK_ITEM',2,${owner.tenantId},${owner.actorUserId},${actionType},
            ${attemptId},'OPENCLAW_MCP_V1','SUCCEEDED')`;
        await assert.rejects(insert('ATT-fake-summary-WI', 'OPENCLAW_DERIVED_SUMMARY'),
          error => databaseCode(error) === '23514' && databaseConstraint(error) === 'ck_action_attempt_derived_summary');
        await insert('ATT-ordinary-WI', 'OPENCLAW_DYNAMIC_EVALUATION');
        const rows = await admin`SELECT subject_kind,action_type,summary_id FROM action_attempt
          WHERE attempt_id='ATT-ordinary-WI' OR operation_ref=${accepted.attemptRef}`;
        assert.equal(rows.length, 2);
        assert.ok(rows.some(row => row.subject_kind === 'WORK_ITEM' && row.action_type === 'OPENCLAW_DYNAMIC_EVALUATION' && row.summary_id === null));
        assert.ok(rows.some(row => row.subject_kind === 'DERIVED_SUMMARY' && row.action_type === 'OPENCLAW_DERIVED_SUMMARY' && row.summary_id === accepted.summaryId));
      });
      await t.test('platform ACLs cannot expose the service resolver to ordinary roles, forged claims or TRUNCATE', async () => {
        const resolver = querySql`SELECT derived_summary_runtime_actor(${owner.tenantId},${accepted.summaryId},
          ${accepted.attemptRef},${scope.principalId}) AS actor`;
        const [privilege] = await admin`SELECT has_function_privilege('authenticated_public',
          'derived_summary_runtime_actor(varchar,varchar,varchar,varchar)','EXECUTE') AS allowed`;
        assert.equal(privilege.allowed, true, 'ordinary invocation is possible under platform ACLs, so the function must reject it itself');
        await assert.rejects(browser(() => database.execute(resolver)), serviceRoleDenied);
        await assert.rejects(browser(() => database.execute(querySql`WITH claims AS MATERIALIZED (SELECT
          set_config('request.jwt.claims', ${JSON.stringify({ role: 'service_role', sub: owner.actorUserId, tenantId: owner.tenantId })}, true),
          set_config('request.jwt.claim.role','service_role',true),set_config('app.role_ids','service_role_public',true))
          SELECT derived_summary_runtime_actor(${owner.tenantId},${accepted.summaryId},${accepted.attemptRef},${scope.principalId}) FROM claims`)), serviceRoleDenied);
        await assert.rejects(context(undefined, false, () => database.execute(resolver)), serviceRoleDenied);
        const [binding] = await hosted(() => database.execute(resolver));
        assert.equal(binding.actor, owner.actorUserId);
        const [wrongTenant] = await hosted(() => database.execute(querySql`SELECT derived_summary_runtime_actor('other-tenant',
          ${accepted.summaryId},${accepted.attemptRef},${scope.principalId}) AS actor`));
        assert.equal(wrongTenant.actor, null);
        const [anon] = await context(undefined, false, () => database.execute(querySql`WITH forged_actor AS MATERIALIZED (
          SELECT set_config('app.user_id',${owner.actorUserId},true)) SELECT
          derived_summary_attempt_owned(${owner.tenantId},${owner.actorUserId},${accepted.summaryId}) AS allowed,
          derived_summary_reading_sources_owned(${owner.tenantId},${owner.actorUserId},'{"members":[],"evidence":[]}'::jsonb) AS sources
          FROM forged_actor`));
        assert.equal(anon.allowed, false); assert.equal(anon.sources, false);
        await browser(() => database.execute(querySql`INSERT INTO derived_summary(summary_id,tenant_id,actor_user_id,
          create_request_id,scope_json,members_json) VALUES ('DS-native-draft',${owner.tenantId},${owner.actorUserId},'native-draft',
          ${JSON.stringify(request.scope)}::jsonb,'[]'::jsonb)`));
        const deleteDraft = () => database.execute(querySql`DELETE FROM derived_summary WHERE summary_id='DS-native-draft' RETURNING summary_id`);
        assert.equal((await browser(deleteDraft)).length, 0, 'ordinary head DELETE remains unavailable under broad CRUD');
        assert.equal((await hosted(() => transactions.withActorScope(owner.actorUserId, deleteDraft))).length, 0,
          'service head DELETE remains unavailable under broad CRUD');
        assert.equal((await context(undefined, false, () => database.execute(querySql`SELECT summary_id FROM derived_summary`))).length, 0);
        for (const run of [browser, hosted]) await assert.rejects(run(() => database.execute(querySql`
          TRUNCATE derived_summary,derived_summary_revision CASCADE`)),
        error => databaseCode(error) === '42501' && databaseMessageIncludes(error, 'DERIVED_SUMMARY_TRUNCATE_DENIED'));
        // Unlike a custom JWT/app claim GUC, PostgreSQL validates its special
        // role setting against the session user's actual role memberships.
        const loginUrl = new URL(databaseUrl); loginUrl.username = 'summary_ordinary_login'; loginUrl.password = '';
        const ordinary = postgres(loginUrl.toString(), { max: 1, onnotice() {} });
        try {
          await assert.rejects(ordinary.begin(async sql => {
            await sql.unsafe('SET LOCAL ROLE authenticated_public');
            await sql`SELECT set_config('role','service_role_public',true)`;
          }), error => databaseCode(error) === '42501');
        } finally { await ordinary.end({ timeout: 5 }); }
      });
      const target = () => ({ summaryId: accepted.summaryId, attemptRef: accepted.attemptRef, scope });
      let claim;
      await t.test('exact service delegation claims shared lease; fake service, missing save and stale fence fail', async () => {
        await assert.rejects(hosted(() => runtime.claim({ ...target(), scope: { ...scope, principalId: 'different-service' } })), /UNAVAILABLE/u);
        await assert.rejects(browser(() => runtime.claim(target())), error => databaseCode(error) === '42501');
        claim = await hosted(() => runtime.claim(target()));
        assert.equal(claim.task.taskType, 'OPENCLAW_DERIVED_SUMMARY');
        assert.equal(claim.task.subject.summaryId, accepted.summaryId);
        assert.equal(claim.task.modelInput.members[0].member.workRef, 'JA-summary23');
        assert.match(claim.task.modelInput.members[0].limitations.join(' '), /DV-old.*历史正式版.*DV-new.*未被本成员覆盖/u);
        assert.equal(claim.task.executionModel.modelRef, 'miaoda/glm-5.3');
        const sourceCopy = { members: claim.task.modelInput.members, evidence: claim.task.modelInput.evidence };
        const [eligible] = await browser(() => database.execute(querySql`SELECT
          derived_summary_reading_sources_owned(${owner.tenantId},${owner.actorUserId},${JSON.stringify(sourceCopy)}::jsonb) AS sources,
          EXISTS(SELECT 1 FROM action_attempt WHERE operation_ref=${accepted.attemptRef} AND status='RUNNING'
            AND lease_token IS NOT NULL AND lease_expires_at>CURRENT_TIMESTAMP) AS active`));
        assert.equal(eligible.sources, true); assert.equal(eligible.active, true);
        await assert.rejects(browser(() => database.execute(querySql`INSERT INTO derived_summary_revision(summary_ref,summary_id,
          tenant_id,actor_user_id,revision,request_id,attempt_id,content_json) VALUES ('DSR-native-forged',${accepted.summaryId},
          ${owner.tenantId},${owner.actorUserId},1,${request.requestId},${claim.task.actionAttemptId},${JSON.stringify(sourceCopy)}::jsonb)`)),
        error => databaseCode(error) === '42501');
        await assert.rejects(hosted(() => runtime.finish({ ...target(), ...claimFence(claim), requestId: request.requestId })), /REQUIRES_SAVED/u);
        await assert.rejects(hosted(() => runtime.heartbeat({ ...target(), ...claimFence(claim), leaseGeneration: 0 })), /LEASE_FENCE/u);
      });
      let saved;
      let content;
      await t.test('actual member/source reads precede atomic save, exact readback and durable FINISH', async () => {
        const ref = claim.task.modelInput.members[0].evidenceRef;
        content = { headline: 'Selected TLS candidate', listBrief: 'One selected old publication; newer version not covered',
          body: `Monitoring and measures remain conditional. [[${ref}]] [[${source.evidenceRef}]]`,
          limitations: ['The newer formal publication is not a selected member.'] };
        const saveInput = { ...target(), ...claimFence(claim), requestId: request.requestId,
          expectedSummaryRevision: 0, contentJson: JSON.stringify(content), provenanceJson: JSON.stringify({
            configuredModelRef: 'miaoda/glm-5.3', actualModel: null, promptVersion: 'summary-test-v1',
            skillVersion: 'test', toolVersions: { derived_summary_attempt: 'v1' } }) };
        await assert.rejects(hosted(() => runtime.save(saveInput)), /MEMBER_READ_REQUIRED/u);
        const read = await hosted(() => runtime.readMemberWork({ ...target(), ...claimFence(claim), evidenceRefs: [ref], purpose: 'Read complete saved work' }));
        assert.equal(read.members[0].issues.length, 2); assert.match(read.members[0].body, /Saved cause/u);
        await assert.rejects(hosted(() => runtime.readSources({ ...target(), ...claimFence(claim), evidenceRefs: ['invented'], purpose: 'invalid' })), /NOT_REGISTERED/u);
        const sources = await hosted(() => runtime.readSources({ ...target(), ...claimFence(claim), evidenceRefs: [source.evidenceRef], purpose: 'Verify exact paragraph' }));
        assert.deepEqual(sources.evidence, [source]);
        saved = await hosted(() => runtime.save(saveInput));
        assert.equal(saved.revision, 1);
        assert.equal((await hosted(() => runtime.save(saveInput))).replay, true);
        const readback = await hosted(() => runtime.readSaved({ ...target(), requestId: request.requestId }));
        assert.equal(readback.summary.summaryRef, saved.summaryRef);
        assert.deepEqual(readback.summary.members[0].rootRefs, [source.evidenceRef]);
        assert.equal(readback.summary.coverage[0].used, true);
        assert.equal(readback.summary.candidateOnly, true);
        assert.equal((await hosted(() => runtime.finish({ ...target(), ...claimFence(claim), requestId: request.requestId }))).status, 'SUCCEEDED');
        assert.equal((await browser(() => summaries.read(accepted.summaryId, actor))).currentSummaryRef, saved.summaryRef);
        for (const run of [browser, operation => hosted(() => transactions.withActorScope(owner.actorUserId, operation))]) {
          const changed = await run(() => database.execute(querySql`UPDATE derived_summary_revision SET content_json='{}'::jsonb
            WHERE summary_ref=${saved.summaryRef} RETURNING summary_ref`));
          const deleted = await run(() => database.execute(querySql`DELETE FROM derived_summary_revision
            WHERE summary_ref=${saved.summaryRef} RETURNING summary_ref`));
          assert.equal(changed.length, 0); assert.equal(deleted.length, 0, 'revision mutations remain unavailable under broad CRUD');
        }
        assert.equal((await context(undefined, false, () => database.execute(querySql`SELECT summary_ref FROM derived_summary_revision`))).length, 0);
        await assert.rejects(browser(() => summaries.request(accepted.summaryId,
          { ...request, requestId: 'stale-request', expectedSummaryRevision: 0 }, actor)), /REVISION_CONFLICT/u);
        await assert.rejects(admin`UPDATE action_attempt SET summary_delegated_principal_id='other' WHERE operation_ref=${accepted.attemptRef}`,
          error => databaseCode(error) === '23514');
        await assert.rejects(admin`UPDATE action_attempt SET operation_ref='AQ-forged' WHERE operation_ref=${accepted.attemptRef}`,
          error => databaseCode(error) === '23514');
        await assert.rejects(admin`UPDATE derived_summary_revision SET request_id='other' WHERE summary_ref=${saved.summaryRef}`,
          error => databaseCode(error) === '23514');
      });
      let upper;
      let upperSaved;
      await t.test('upper ATA2 consumes one exact saved ATA4 and preserves converged roots/limited coverage', async () => {
        upper = await browser(() => summaries.create({ ...request, requestId: 'ATA2-request',
          scope: { ...request.scope, kind: 'ATA2', title: 'Selected ATA46 aggregate', ata4: null },
          members: [{ kind: 'DERIVED_SUMMARY', summaryId: accepted.summaryId, summaryRef: saved.summaryRef, summaryRevision: 1 }] }, actor));
        const upperTarget = { summaryId: upper.summaryId, attemptRef: upper.attemptRef, scope };
        const lease = await hosted(() => runtime.claim(upperTarget));
        const ref = lease.task.modelInput.members[0].evidenceRef;
        const readings = await hosted(() => runtime.readMemberWork({ ...upperTarget, ...claimFence(lease), evidenceRefs: [ref], purpose: 'Read exact child summary' }));
        assert.equal(readings.members[0].leaves[0].workRef, 'JA-summary23');
        assert.deepEqual(readings.members[0].rootRefs, [source.evidenceRef]);
        upperSaved = await hosted(() => runtime.save({ ...upperTarget, ...claimFence(lease), requestId: 'ATA2-request', expectedSummaryRevision: 0,
          contentJson: JSON.stringify({ headline: 'Selected ATA46 subset', listBrief: 'Only one selected ATA4',
            body: `The parent covers only its explicit ATA46-00 child. [[${ref}]]`, limitations: ['Other ATA4 nodes are not covered.'] }) }));
        await hosted(() => runtime.finish({ ...upperTarget, ...claimFence(lease), requestId: 'ATA2-request' }));
        const { revision: reading } = await browser(() => summaries.readRevision(upper.summaryId, upperSaved.summaryRef, actor));
        assert.equal(reading.evidence.length, 1); assert.equal(reading.coverage.length, 1);
        assert.equal(reading.members[0].member.summaryRef, saved.summaryRef);
        assert.match(reading.content.limitations.join(' '), /未覆盖|not covered/u);
      });
      await t.test('historical read remains authorized when V2 adds a later revoked member; metadata list remains discoverable', async () => {
        const laterMember = { ...member, workItemId: 'WI-new', documentVersionId: 'DV-new', workRef: 'JA-new1', workRevision: 1 };
        const receipt = await browser(() => summaries.request(accepted.summaryId, { ...request, requestId: 'ATA4-V2-request',
          expectedSummaryRevision: 1, members: [member, laterMember] }, actor));
        const updatedTarget = { summaryId: accepted.summaryId, attemptRef: receipt.attemptRef, scope };
        const lease = await hosted(() => runtime.claim(updatedTarget));
        const refs = lease.task.modelInput.members.map(item => item.evidenceRef);
        await hosted(() => runtime.readMemberWork({ ...updatedTarget, ...claimFence(lease), evidenceRefs: refs, purpose: 'Read V2 selected members' }));
        const second = await hosted(() => runtime.save({ ...updatedTarget, ...claimFence(lease), requestId: 'ATA4-V2-request', expectedSummaryRevision: 1,
          contentJson: JSON.stringify({ headline: 'V2 selected work', listBrief: 'Later selected source added',
            body: `The original selected work remains a candidate. [[${refs[0]}]]`, limitations: ['Second member was read but is not used in this body.'] }) }));
        await hosted(() => runtime.finish({ ...updatedTarget, ...claimFence(lease), requestId: 'ATA4-V2-request' }));
        await admin`UPDATE summary_test_document_acl SET allowed=false WHERE document_version_id='DV-new'`;
        await assert.rejects(browser(() => summaries.read(accepted.summaryId, actor)), /UNAVAILABLE/u);
        const old = await browser(() => summaries.readRevision(accepted.summaryId, saved.summaryRef, actor));
        assert.equal(old.revision.summaryRef, saved.summaryRef);
        assert.equal(old.currentSummaryRef, second.summaryRef);
        assert.equal(old.currentRevision, 2);
        assert.equal(old.memberNotices.length, 1);
        const catalogue = await browser(() => summaries.list(actor));
        assert.ok(catalogue.some(item => item.summaryId === accepted.summaryId && item.currentSummaryRef === second.summaryRef));
        assert.equal(catalogue.some(item => 'current' in item || 'members' in item), false, 'metadata directory contains no member/source bodies');
      });
      await t.test('new saved work produces exact fresh notices without swapping members; root revocation denies ATA4 and parent', async () => {
        await admin`INSERT INTO assessment_work_revision (assessment_work_revision_id,tenant_id,work_item_id,work_revision,request_id,
          action_attempt_id,based_on_work_item_revision,document_version_id,command_json,content_json,created_by_user_id)
          SELECT 'JA-summary24',tenant_id,work_item_id,24,'JA-save24',action_attempt_id,based_on_work_item_revision,
            document_version_id,command_json,content_json,created_by_user_id FROM assessment_work_revision WHERE assessment_work_revision_id='JA-summary23'`;
        const read = await browser(() => summaries.readRevision(accepted.summaryId, saved.summaryRef, actor));
        assert.equal(read.revision.members[0].member.workRef, 'JA-summary23');
        assert.equal(read.memberNotices[0].current, false);
        await admin`UPDATE summary_test_document_acl SET allowed=false WHERE document_version_id='DV-old'`;
        await assert.rejects(browser(() => summaries.read(accepted.summaryId, actor)), /UNAVAILABLE/u);
        await assert.rejects(browser(() => summaries.readRevision(upper.summaryId, upperSaved.summaryRef, actor)), /UNAVAILABLE/u);
        await assert.rejects(hosted(() => runtime.readSaved({ ...target(), requestId: request.requestId })), /UNAVAILABLE/u);
        const hidden = await browser(() => database.execute(querySql`SELECT summary_ref FROM derived_summary_revision`));
        assert.equal(hidden.length, 0, 'ordinary RLS hides saved bodies after root permission is revoked');
      });
    } finally {
      if (connection) await connection.end({ timeout: 5 });
      await admin.end({ timeout: 5 });
    }
  });

function claimFence(claim) { return { leaseToken: claim.leaseToken, leaseGeneration: claim.leaseGeneration }; }
function databaseCode(error) { for (let current = error; current; current = current.cause) if (current.code) return current.code; return null; }
function databaseConstraint(error) { for (let current = error; current; current = current.cause) if (current.constraint_name) return current.constraint_name; return null; }
function databaseMessageIncludes(error, message) { for (let current = error; current; current = current.cause) if (current.message?.includes(message)) return true; return false; }
function serviceRoleDenied(error) { return databaseCode(error) === '42501' && databaseMessageIncludes(error, 'DERIVED_SUMMARY_SERVICE_ROLE_REQUIRED'); }
function nativeActor(userId, tenantId) {
  return { userId, tenantId, appId: 'app_17bzc551rsg', roles: [], env: 'runtime', objectAccessActor: {
    principalKind: 'FINAL_USER', transport: 'MIAODA_AUTHENTICATED_HTTP', canonicalSubject: { namespace: 'MIAODA_USER_ID', id: userId },
    subjectDecision: { source: 'MIAODA_GATEWAY_USER_CONTEXT', applicationScopeId: 'app_17bzc551rsg', tenantId,
      version: 'miaoda-hosted-native-sso.v1', decidedAt: new Date().toISOString() }, tenantId,
    applicationScopeId: 'app_17bzc551rsg', applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT', workspaceId: null,
    workspaceProvenance: 'UNAVAILABLE', env: 'runtime', platformRoles: [], identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT',
    feishuUserId: null, feishuOpenId: null, feishuIdentityProvenance: 'UNAVAILABLE', sessionId: null,
    sessionRevision: null, sessionProvenance: 'UNAVAILABLE' } };
}

// Only these eight new narrowing policies target the exact SDK SQL scopes.
// Existing Matter policy roles continue to be preserved separately.
const sqlBoundaries = [
  ['action_attempt_summary_subject_boundary', 'action_attempt', '*'],
  ['derived_summary_owner_boundary', 'derived_summary', '*'],
  ['derived_summary_no_delete', 'derived_summary', 'd'],
  ['derived_summary_revision_sources', 'derived_summary_revision', '*'],
  ['derived_summary_revision_real_attempt', 'derived_summary_revision', 'a'],
  ['derived_summary_revision_hosted_insert', 'derived_summary_revision', 'a'],
  ['derived_summary_revision_no_update', 'derived_summary_revision', 'w'],
  ['derived_summary_revision_no_delete', 'derived_summary_revision', 'd'],
];

function rewriteTopLevelPublicPolicies(ddl) {
  // Model the observed platform transform on parsed top-level CREATE POLICY
  // statements. Dollar-quoted DO/function bodies remain untouched, as in the
  // actual prior dynamic old-policy extension accepted by the platform.
  return ddl.replace(/(\$[a-z_]*\$)[\s\S]*?\1|CREATE POLICY[^;]+;/giu,
    (statement, quoted) => quoted ? statement : statement.replace(/\bTO PUBLIC\b/gu, `TO authenticated_${roleSchema}`));
}

async function sqlBoundaryRows(admin) {
  return admin`SELECT p.polname,c.relname,p.polcmd,p.polpermissive,
    p.polroles=ARRAY[0]::oid[] AS all_roles,
    (SELECT array_agg(role_oid ORDER BY role_oid) FROM unnest(p.polroles) AS role_oid)=
      (SELECT array_agg(oid ORDER BY oid) FROM pg_roles WHERE rolname=ANY(${['authenticated', 'service_role', 'anon'].map(role => `${role}_${roleSchema}`)})) AS exact_scopes,
    p.polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname=${`authenticated_${roleSchema}`})]::oid[] AS ordinary_only
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
    WHERE p.polname=ANY(${sqlBoundaries.map(([name]) => name)}) ORDER BY p.polname`;
}

async function assertSqlBoundaries(admin) {
  const rows = await sqlBoundaryRows(admin);
  assert.equal(rows.length, sqlBoundaries.length);
  for (const [name, table, command] of sqlBoundaries) {
    const row = rows.find(policy => policy.polname === name);
    assert.equal(row.relname, table); assert.equal(row.polcmd, command);
    assert.equal(row.polpermissive, false); assert.equal(row.exact_scopes, true, `${name} must retain the three exact SDK SQL role OIDs`);
    assert.equal(row.all_roles, false);
    assert.equal(row.ordinary_only, false);
  }
}

async function reset(admin) {
  await admin.unsafe('DROP SCHEMA public CASCADE');
  await admin.unsafe('CREATE SCHEMA public');
  await admin.unsafe(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated_${roleSchema}') THEN CREATE ROLE authenticated_${roleSchema} NOLOGIN IN ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role_${roleSchema}') THEN CREATE ROLE service_role_${roleSchema} NOLOGIN IN ROLE service_role; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon_${roleSchema}') THEN CREATE ROLE anon_${roleSchema} NOLOGIN IN ROLE anon; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='summary_ordinary_login') THEN CREATE ROLE summary_ordinary_login LOGIN IN ROLE authenticated_${roleSchema}; END IF;
  END $$`);
  await admin.unsafe('CREATE TYPE user_profile AS (user_id text)');
  const originalDdl = await readFile('server/database/work-item.ddl.sql', 'utf8');
  await admin.unsafe(originalDdl.match(/CREATE TABLE work_item \([\s\S]*?\n\);/u)[0]);
  await admin.unsafe(originalDdl.match(/CREATE TABLE action_attempt \([\s\S]*?\n\);/u)[0]);
  await admin.unsafe(await readFile('migrations/0003_action_attempt_openclaw_v1.sql', 'utf8'));
  await admin.unsafe(`ALTER TABLE action_attempt ALTER COLUMN work_item_id DROP NOT NULL,
    ADD COLUMN subject_kind varchar(32) NOT NULL DEFAULT 'WORK_ITEM', ADD COLUMN matter_id varchar(96),
    ADD COLUMN matter_revision_id varchar(96),ADD COLUMN review_activity_json text,ADD COLUMN execution_model_json text;
    ALTER TABLE action_attempt ADD CONSTRAINT ck_action_attempt_subject CHECK
      (subject_kind IN ('WORK_ITEM','DOCUMENT_VERSION','ENGINEERING_MATTER','ACQUISITION'));
    CREATE TABLE identity_subject_mapping (id uuid DEFAULT gen_random_uuid(),miaoda_user_id varchar(255),miaoda_tenant_id varchar(128),expected_client_id varchar(128),status varchar(32));
    CREATE TABLE summary_test_document_acl (tenant_id varchar,actor_id varchar,document_version_id varchar,allowed boolean);
    CREATE TABLE dm_document_version (document_version_id varchar,family_id varchar);
    CREATE TABLE dm_publication_family (family_id varchar,current_document_version_id varchar);
    CREATE TABLE engineering_matter (tenant_id varchar,matter_id varchar,current_matter_revision_id varchar,created_by_user_id varchar);
    CREATE TABLE engineering_matter_work_revision (tenant_id varchar,matter_id varchar,matter_work_revision_id varchar,working_revision integer,
      created_by_user_id varchar,based_on_matter_revision_id varchar);
    CREATE UNIQUE INDEX uk_work_item_tenant ON work_item(tenant_id,work_item_id);
    CREATE FUNCTION engineering_matter_actor_has_tenant(t varchar) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $$
      SELECT EXISTS (SELECT 1 FROM identity_subject_mapping m WHERE m.miaoda_user_id=current_setting('app.user_id',true)
        AND m.miaoda_tenant_id=t AND m.expected_client_id='cli_aadde8b579f95bc9' AND m.status='ACTIVE') $$;
    CREATE FUNCTION engineering_matter_work_item_owned_by_actor(t varchar,w varchar) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $$
      SELECT EXISTS (SELECT 1 FROM work_item x WHERE x.tenant_id=t AND x.work_item_id=w AND x.requested_by_user_id=current_setting('app.user_id',true)) $$;
    CREATE FUNCTION engineering_matter_document_owned_by_actor(t varchar,d varchar) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $$
      SELECT EXISTS (SELECT 1 FROM summary_test_document_acl a WHERE a.tenant_id=t AND a.document_version_id=d
        AND a.actor_id=current_setting('app.user_id',true) AND a.allowed) $$;
    CREATE FUNCTION engineering_matter_owned_by_actor(t varchar,m varchar) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE FUNCTION engineering_matter_all_links_owned_by_actor(t varchar,m varchar) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    ALTER TABLE action_attempt ENABLE ROW LEVEL SECURITY;
    CREATE POLICY legacy_attempt_access ON action_attempt TO authenticated,service_role USING (true);
    CREATE POLICY action_attempt_matter_or_document_subject_boundary ON action_attempt AS RESTRICTIVE FOR ALL TO authenticated_${roleSchema},service_role_${roleSchema}
      USING (subject_kind IN ('WORK_ITEM','DOCUMENT_VERSION') OR subject_kind='ACQUISITION' OR
        (subject_kind='ENGINEERING_MATTER' AND engineering_matter_owned_by_actor(tenant_id,matter_id)));
    ALTER TABLE work_item ENABLE ROW LEVEL SECURITY;
    CREATE POLICY work_owner ON work_item TO authenticated,service_role USING
      (requested_by_user_id=current_setting('app.user_id',true) AND engineering_matter_actor_has_tenant(tenant_id));
    GRANT USAGE ON SCHEMA public TO authenticated,service_role,anon;
    GRANT SELECT ON identity_subject_mapping TO authenticated,service_role;
    GRANT SELECT ON dm_document_version,dm_publication_family TO authenticated,service_role;
    GRANT SELECT,INSERT,UPDATE ON action_attempt TO authenticated,service_role;
    GRANT SELECT ON work_item TO authenticated,service_role;`);
  await admin.unsafe(await readFile('migrations/0026_assessment_work_revision.sql', 'utf8'));
  await admin.unsafe('GRANT SELECT ON assessment_work_revision TO authenticated,service_role');
  const summaryDdl = await readFile('server/database/derived-summary.ddl.sql', 'utf8');
  assert.doesNotMatch(summaryDdl, /\b(?:GRANT|REVOKE)\b/iu, 'production DDL leaves ACL administration to the platform');
  // Start with the prior weaker summary-only constraint, then prove the same
  // additive DDL upgrades it and remains reapplicable without altering legacy branches.
  const [oldPolicy] = await admin`SELECT polroles FROM pg_policy WHERE polrelid='action_attempt'::regclass
    AND polname='action_attempt_matter_or_document_subject_boundary'`;
  await admin.unsafe(rewriteTopLevelPublicPolicies(summaryDdl.replace("\n        AND action_type <> 'OPENCLAW_DERIVED_SUMMARY'", '')));
  // Dev already has the earlier DO/PUBLIC apply. Reproduce its OID 0
  // metadata before the migration-compatible three-scope upgrade.
  for (const [name, table] of sqlBoundaries) await admin.unsafe(`ALTER POLICY ${name} ON ${table} TO PUBLIC`);
  const priorPublic = await sqlBoundaryRows(admin);
  assert.ok(priorPublic.every(row => row.all_roles && !row.exact_scopes));
  await admin.unsafe(rewriteTopLevelPublicPolicies(summaryDdl));
  await assertSqlBoundaries(admin);
  // Also support the older authenticated-only dev apply without new tables
  // or data migration. Only actual restrictive policy role targets change.
  for (const [name, table] of sqlBoundaries) {
    await admin.unsafe(`ALTER POLICY ${name} ON ${table} TO authenticated_${roleSchema}`);
  }
  const narrowed = await sqlBoundaryRows(admin);
  assert.equal(narrowed.length, sqlBoundaries.length);
  assert.ok(narrowed.every(row => row.ordinary_only && !row.all_roles && !row.polpermissive));
  // A bypass role cannot be treated as an RLS-constrained SDK scope.
  await admin.unsafe(`ALTER ROLE anon_${roleSchema} BYPASSRLS`);
  try {
    await assert.rejects(admin.unsafe(summaryDdl), error => databaseCode(error) === '42501'
      && databaseMessageIncludes(error, 'DERIVED_SUMMARY_SQL_ROLE_RLS_REQUIRED'));
  } finally {
    await admin.unsafe('ROLLBACK');
    await admin.unsafe(`ALTER ROLE anon_${roleSchema} NOBYPASSRLS`);
  }
  assert.deepEqual(await sqlBoundaryRows(admin), narrowed, 'bypass-role upgrade leaves prior policy roles intact');
  // Missing actual SQL scopes cannot become a smaller accepted target set.
  await admin.unsafe(`ALTER ROLE anon_${roleSchema} RENAME TO summary_missing_anon`);
  try {
    await assert.rejects(admin.unsafe(summaryDdl), error => databaseCode(error) === '42501'
      && databaseMessageIncludes(error, 'DERIVED_SUMMARY_SQL_ROLES_REQUIRED'));
  } finally {
    await admin.unsafe('ROLLBACK');
    await admin.unsafe(`ALTER ROLE summary_missing_anon RENAME TO anon_${roleSchema}`);
  }
  assert.deepEqual(await sqlBoundaryRows(admin), narrowed, 'missing-role upgrade rolls back without replacing any policy');
  // If a serializer ever drops a scope from an explicit target list, the
  // checked transaction must reject the change rather than commit it.
  await assert.rejects(admin.unsafe(summaryDdl.replaceAll('$policy$,role_targets)',
    "$policy$,quote_ident('authenticated_' || current_schema()))")),
  error => databaseCode(error) === '42501' && databaseMessageIncludes(error, 'DERIVED_SUMMARY_SQL_BOUNDARY_REQUIRED'));
  await admin.unsafe('ROLLBACK');
  assert.deepEqual(await sqlBoundaryRows(admin), narrowed, 'rejected target conversion rolls back the whole upgrade');
  await admin.unsafe(rewriteTopLevelPublicPolicies(summaryDdl));
  await assertSqlBoundaries(admin);
  const [extendedPolicy] = await admin`SELECT polroles FROM pg_policy WHERE polrelid='action_attempt'::regclass
    AND polname='action_attempt_matter_or_document_subject_boundary_summary'`;
  assert.deepEqual(extendedPolicy.polroles, oldPolicy.polroles, 'dynamic policy extension preserves actual schema-suffixed target roles');
  await admin.unsafe(rewriteTopLevelPublicPolicies(summaryDdl));
  await assertSqlBoundaries(admin);
  // Simulate the documented broad platform-managed ACLs locally, including
  // TRUNCATE. These fixture-only statements are never part of deployed DDL.
  await admin.unsafe('GRANT ALL ON derived_summary,derived_summary_revision TO authenticated,service_role,anon');
  await admin.unsafe('GRANT TRUNCATE ON ALL TABLES IN SCHEMA public TO authenticated,service_role,anon');
  await admin.unsafe(`CREATE POLICY platform_native_crud ON derived_summary TO authenticated,service_role,anon USING(true) WITH CHECK(true);
    CREATE POLICY platform_native_crud ON derived_summary_revision TO authenticated,service_role,anon USING(true) WITH CHECK(true);`);
}

async function seed(admin) {
  await admin`INSERT INTO identity_subject_mapping(miaoda_user_id,miaoda_tenant_id,expected_client_id,status)
    VALUES (${owner.actorUserId},${owner.tenantId},'cli_aadde8b579f95bc9','ACTIVE'),('other-actor',${owner.tenantId},'cli_aadde8b579f95bc9','ACTIVE')`;
  await admin`INSERT INTO summary_test_document_acl VALUES (${owner.tenantId},${owner.actorUserId},'DV-old',true),
    (${owner.tenantId},${owner.actorUserId},'DV-new',true)`;
  await admin`INSERT INTO dm_document_version VALUES ('DV-old','FAMILY-summary'),('DV-new','FAMILY-summary')`;
  await admin`INSERT INTO dm_publication_family VALUES ('FAMILY-summary','DV-new')`;
  await admin`INSERT INTO work_item(work_item_id,tenant_id,action_type,document_id,document_version_id,source_artifact_id,source_file_sha256,
    source_byte_length,normalized_family,request_id,status,revision,requested_by_user_id,projection_json)
    VALUES ('WI-summary',${owner.tenantId},'PARSE_PDF','DOC-summary','DV-old','SRC-summary',${'a'.repeat(64)},100,'FTD','intake','complete',7,
      ${owner.actorUserId},${JSON.stringify({ source: { documentVersionId: 'DV-old', sourceArtifactId: 'SRC-summary', sourceFileSha256: 'a'.repeat(64) } })})`;
  await admin`INSERT INTO action_attempt(attempt_id,work_item_id,tenant_id,actor_user_id,action_type,trigger_request_id,request_origin,status)
    VALUES ('ATT-work23','WI-summary',${owner.tenantId},${owner.actorUserId},'OPENCLAW_DYNAMIC_EVALUATION','initial','OPENCLAW_MCP_V1','SUCCEEDED')`;
  const issues = ['tls-cause','tls-measure'].map(issueKey => ({ issueKey, issueRef: `issue:${issueKey}`,question: issueKey,
    body: `Saved cause and measure retain uncertainty. [[${source.evidenceRef}]]`,riskScenarios: [],measures: [],otherClassifications: [],
    openQuestions: [],requirementHandling: [],sourceDependencies: [source.evidenceRef],premiseRefs: [source.evidenceRef] }));
  const content = { schemaVersion: 'wiselink.jobaid-problem-work.v3',headline: 'TLS work23',listBrief: 'Saved synthetic work',
    understanding: 'Conditional TLS overview',decisiveIssueKeys: issues.map(item => item.issueKey),overviewStatus: 'CURRENT',issues,
    roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS',completionReason: 'Scope uncertainty retained',changeSummary: 'Synthetic fixture',
    unchangedExplanation: '',methodBinding: JOBAID_METHOD_BINDING,evidence: [source],readSourceRefs: [source.evidenceRef],capabilities: [],
    historyReview: { required: false,priorAssessmentRefs: [],engineeringDocumentRefs: [],coverage: 'NOT_REQUIRED',limitation: null } };
  await admin`INSERT INTO assessment_work_revision(assessment_work_revision_id,tenant_id,work_item_id,work_revision,request_id,
    action_attempt_id,based_on_work_item_revision,document_version_id,command_json,content_json,created_by_user_id)
    VALUES ('JA-summary23',${owner.tenantId},'WI-summary',23,'JA-save23','ATT-work23',7,'DV-old','{}',${JSON.stringify(content)},${owner.actorUserId})`;
  await admin`INSERT INTO work_item(work_item_id,tenant_id,action_type,document_id,document_version_id,source_artifact_id,source_file_sha256,
    source_byte_length,normalized_family,request_id,status,revision,requested_by_user_id,projection_json)
    VALUES ('WI-new',${owner.tenantId},'PARSE_PDF','DOC-summary','DV-new','SRC-new',${'b'.repeat(64)},101,'FTD','intake-new','complete',1,
      ${owner.actorUserId},${JSON.stringify({ source: { documentVersionId: 'DV-new', sourceArtifactId: 'SRC-new', sourceFileSha256: 'b'.repeat(64) } })})`;
  const newerContent = JSON.parse(JSON.stringify(content).replaceAll('SOURCE-DV-old-para1','SOURCE-DV-new-para1')
    .replaceAll('DV-old','DV-new').replaceAll('WI-summary','WI-new'));
  await admin`INSERT INTO assessment_work_revision(assessment_work_revision_id,tenant_id,work_item_id,work_revision,request_id,
    action_attempt_id,based_on_work_item_revision,document_version_id,command_json,content_json,created_by_user_id)
    VALUES ('JA-new1',${owner.tenantId},'WI-new',1,'JA-save-new','ATT-work23',1,'DV-new','{}',${JSON.stringify(newerContent)},${owner.actorUserId})`;
}
