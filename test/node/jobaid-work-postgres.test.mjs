import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import postgres from 'postgres';

process.env.TS_NODE_PROJECT = 'tsconfig.node.json';
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'node',
});
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const { eq, sql: drizzleSql } = require('drizzle-orm');
const { getTableConfig } = require('drizzle-orm/pg-core');
const {
  SqlExecutionContextMiddleware,
} = require('@lark-apaas/fullstack-nestjs-core');
const { workItem, actionAttempt } = require('../../server/database/schema.ts');
const { EngineeringSearchProjectionWriter } = require('../../server/modules/canonical-host/engineering-search-projection.ts');
const {
  EngineeringMatterWorkingRepository,
} = require('../../server/modules/canonical-host/engineering-matter-working.repository.ts');
const {
  JobAidWorkRepository,
} = require('../../server/modules/canonical-host/jobaid-work.repository.ts');
const {
  ReviewConversationRepository,
} = require('../../server/modules/review-persistence/review-conversation.repository.ts');
const {
  CanonicalJobAidProblemService,
} = require('../../server/modules/canonical-host/canonical-jobaid-problem.service.ts');
const {
  ActionAttemptLifecycleService,
} = require('../../server/modules/action-attempt/action-attempt-lifecycle.service.ts');
const {
  ActionAttemptRepository,
} = require('../../server/modules/action-attempt/action-attempt.repository.ts');
const {
  parseTaskEnvelope,
} = require('../../server/modules/action-attempt/action-attempt-envelope.ts');
const {
  INITIAL_ANALYSIS_REQUEST_SCHEMA,
  readInitialAnalysisRequestInput,
} = require('../../server/modules/action-attempt/initial-analysis-request.ts');
const {
  parseJobAidProblemTask,
} = require('../../server/modules/canonical-host/jobaid-problem-task.ts');
const {
  MiaodaWorkItemRepository,
} = require('../../server/modules/work-item/miaoda-work-item.repository.ts');
const {
  projectCommonAssessmentContext,
} = require('../../server/modules/canonical-host/canonical-host-common-context.service.ts');
const { fixedModelSettings } = require('../support/fixed-model-settings.ts');
const {
  materializeJobAidWork,
} = require('../../server/modules/canonical-host/jobaid-problem-work.ts');
const {
  JOBAID_METHOD_BINDING,
  JOBAID_METHOD_EVIDENCE,
} = require('../../server/modules/canonical-host/jobaid-method-pack.ts');

const { originalFixture } = require('../unit/document-parsing/fixtures/document-original.fixture.ts');
const { CanonicalHostInitialAnalysisStatusService } = require('../../server/modules/canonical-host/canonical-host-initial-analysis-status.service.ts');
const databaseUrl = process.env.JOBAID_WORK_TEST_DATABASE_URL;
const scope = {
  tenantId: 'tenant-job',
  workItemId: 'WI-job',
  actorUserId: 'actor-job',
};
const hash = 'a'.repeat(64);
const sourceBindings = [
  {
    workItemId: scope.workItemId,
    documentVersionId: 'dv-job',
    artifactRef: 'artifact://test/source',
    artifactSha256: hash,
  },
];
const fence = {
  principalId: 'service-job',
  leaseToken: 'lease-job',
  leaseGeneration: 1,
};
const document = {
  evidenceRef: 'source:dv-job:sr1',
  kind: 'DOCUMENT_PASSAGE',
  title: 'Synthetic source',
  versionLabel: 'R1',
  excerpt:
    'Do not replace unless the indication persists after 5 seconds. Normal inspection does not exclude intermittent failure.',
  workItemId: scope.workItemId,
  documentVersionId: 'dv-job',
  sourceRefId: 'sr1',
  locator: 'page 1',
};
const evidence = [document, ...JOBAID_METHOD_EVIDENCE];
const context = {
  methodBinding: JOBAID_METHOD_BINDING,
  workItemId: scope.workItemId,
  previous: null,
  evidence,
  readSourceRefs: evidence.map((item) => item.evidenceRef),
  capabilities: [],
  history: {
    required: false,
    priorAssessmentRefs: [],
    engineeringDocumentRefs: [],
    coverage: 'NOT_REQUIRED',
    limitation: null,
  },
};
function proposal(text = document.excerpt) {
  return {
    schemaVersion: 'wiselink.jobaid-problem-work.v2',
    headline: '仍需持续状态证据',
    listBrief: '单次正常检查不能排除间歇状态。',
    understanding: text,
    decisiveIssueKeys: ['condition'],
    roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS',
    completionReason: '本轮来源分析完成；缺失证据明确保留。',
    changeSummary: '更新条件理解。',
    unchangedExplanation: '其余问题完整保留。',
    issues: [
      {
        issueKey: 'condition',
        question: '更换条件是否成立？',
        understanding: text,
        statements: [
          {
            claimKey: 'source-condition',
            text,
            basis: 'SOURCE_FACT',
            premises: [
              {
                evidenceRef: document.evidenceRef,
                role: 'SUPPORTS',
                explanation: '保留持续 5 秒的原文条件。',
                limitation: null,
              },
            ],
          },
        ],
        riskScenarios: [],
        measures: [],
        otherClassifications: [],
        openQuestions: [
          {
            question: '是否取得连续监测？',
            affects: '措施价值',
            nextEvidence: '连续记录',
            reason: '当前仅有单次检查。',
          },
        ],
        requirementHandling: [],
        sourceDependencies: [document.evidenceRef],
        premiseRefs: [],
      },
    ],
    unchangedIssueKeys: [],
    retiredIssues: [],
  };
}

test(
  'JobAid PostgreSQL work, scope and two Review transactions keep exact substantive revisions',
  { skip: !databaseUrl, concurrency: false },
  async (t) => {
    const url = new URL(databaseUrl);
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
    assert.match(url.pathname, /^\/wiselink_jobaid_test_[a-z0-9_]+$/u);
    const sql = postgres(databaseUrl, { max: 4, onnotice() {} });
    const originalFeatureFlag = process.env.WL_JOBAID_PROBLEM_V2_ENABLED;
    process.env.WL_JOBAID_PROBLEM_V2_ENABLED = '1';
    try {
      await reset(sql);
      const db = drizzle(sql);
      const sqlContext = new SqlExecutionContextMiddleware({
        roleSchema: 'wiselink_jobaid_test',
      });
      const projection = new EngineeringSearchProjectionWriter(db);
      const actors = new EngineeringMatterWorkingRepository(db, sqlContext, {
        roleSchema: 'wiselink_jobaid_test',
      }, projection);
      const repository = new JobAidWorkRepository(db, actors, projection);
      const reviews = new ReviewConversationRepository(db);
      const hosted = (callback) =>
        new Promise((resolve, reject) =>
          sqlContext.use(
            { userContext: { userId: '-1', isSystemAccount: true, roles: [] } },
            {},
            () => Promise.resolve().then(callback).then(resolve, reject),
          ),
        );
      const browser = (callback) =>
        new Promise((resolve, reject) =>
          sqlContext.use(
            {
              userContext: {
                userId: scope.actorUserId,
                isSystemAccount: false,
                roles: [],
              },
            },
            {},
            () => Promise.resolve().then(callback).then(resolve, reject),
          ),
        );
      await seed(sql);
      await t.test(
        'knowledge rebinding and reservation share one WorkItem transaction',
        async () => {
          const workItemId = 'WI-knowledge-rebind';
          await sql`INSERT INTO work_item(work_item_id,tenant_id,requested_by_user_id,revision,document_version_id)
          VALUES (${workItemId},${scope.tenantId},${scope.actorUserId},1,'dv-job')`;
          const attempts = new ActionAttemptRepository(db);
          const sessions = [
            '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222222',
          ];
          const row = (key) => ({
            attemptId: `ATT-rebind-${key}`,
            operationRef: `AQ-rebind-${key}`,
            workItemId,
            tenantId: scope.tenantId,
            documentVersionId: 'dv-job',
            actionType: 'OPENCLAW_DYNAMIC_EVALUATION',
            status: 'QUEUED',
            baseRevision: 1,
            idempotencyKey: `openclaw-v2:dynamic:${workItemId}:dv-job:${key}`,
            taskEnvelopeJson: JSON.stringify({
              allowedConnectors: ['feishu-aily-user'],
            }),
          });
          const binding = (sessionId, expectedSessionId = null) => ({
            expectedSessionId,
            replacement: {
              sessionId,
              actorId: scope.actorUserId,
              tenantId: scope.tenantId,
            },
          });
          const results = await Promise.allSettled(
            sessions.map((sessionId, index) =>
              attempts.reserve(row(String(index)), binding(sessionId)),
            ),
          );
          assert.equal(
            results.filter((result) => result.status === 'fulfilled').length,
            1,
          );
          const winner = results.findIndex(
            (result) => result.status === 'fulfilled',
          );
          const readSession = async () =>
            (
              await sql`SELECT initial_aily_session_id AS session FROM work_item WHERE work_item_id=${workItemId}`
            )[0].session;
          assert.equal(await readSession(), sessions[winner]);
          const replay = await attempts.reserve(
            row(String(winner)),
            binding(sessions[1 - winner]),
          );
          assert.equal(replay.created, false);
          assert.equal(
            await readSession(),
            sessions[winner],
            'replay does not rebind the running input',
          );
          assert.equal(
            (
              await sql`SELECT count(*)::int AS n FROM action_attempt WHERE work_item_id=${workItemId}`
            )[0].n,
            1,
          );
          await sql`UPDATE action_attempt SET status='CANCELLED' WHERE work_item_id=${workItemId}`;
          await assert.rejects(
            attempts.reserve(row('stale'), binding(sessions[1 - winner])),
            /KNOWLEDGE_BINDING_CHANGED/u,
          );
          await assert.rejects(
            attempts.reserve(row('omitted')),
            /KNOWLEDGE_BINDING_CHANGED/u,
          );
          await assert.rejects(
            attempts.reserve(row('wrong-owner'), {
              ...binding(sessions[1 - winner], sessions[winner]),
              replacement: {
                sessionId: sessions[1 - winner],
                actorId: 'other-owner',
                tenantId: scope.tenantId,
              },
            }),
            /KNOWLEDGE_BINDING_CHANGED/u,
          );
          const conflict = {
            ...row('rollback'),
            attemptId: `ATT-rebind-${winner}`,
          };
          await assert.rejects(
            attempts.reserve(
              conflict,
              binding(sessions[1 - winner], sessions[winner]),
            ),
          );
          assert.equal(
            await readSession(),
            sessions[winner],
            'failed insert rolls back the grant binding',
          );
          await attempts.reserve(
            row('next'),
            binding(sessions[1 - winner], sessions[winner]),
          );
          assert.equal(await readSession(), sessions[1 - winner]);
          await sql`UPDATE action_attempt SET status='CANCELLED' WHERE work_item_id=${workItemId}`;
        },
      );

      await t.test(
        'actual identity RLS filters an unbound Hosted query and admits only the bound official actor',
        async () => {
          const mapping = {
            tenantId: scope.tenantId,
            actorId: scope.actorUserId,
          };
          assert.equal(
            await hosted(() => reviews.hasActiveOfficialActorMapping(mapping)),
            false,
          );
          assert.equal(
            await hosted(() =>
              repository.withActorTransaction(scope.actorUserId, (executor) =>
                reviews.hasActiveOfficialActorMapping(mapping, executor),
              ),
            ),
            true,
          );
          assert.equal(
            await hosted(() =>
              repository.withActorTransaction('actor-other', (executor) =>
                reviews.hasActiveOfficialActorMapping(mapping, executor),
              ),
            ),
            false,
          );
          assert.equal(
            await hosted(() =>
              repository.withActorTransaction(scope.actorUserId, (executor) =>
                reviews.hasActiveOfficialActorMapping(
                  { ...mapping, tenantId: 'other-tenant' },
                  executor,
                ),
              ),
            ),
            false,
          );
          assert.equal(
            await hosted(() => reviews.hasActiveOfficialActorMapping(mapping)),
            false,
            'the verified actor must not leak into a later unbound Hosted query',
          );
        },
      );

      await t.test(
        'authenticated JobAid requests prepare only at Hosted begin and preserve actor authorization under actual RLS',
        async () => {
          const initial = initialProjection('WI-job-begin');
          const denied = initialProjection('WI-job-denied');
          const queued = initialProjection('WI-job-queued');
          queued.package = null;
          const queuedDenied = initialProjection('WI-job-queued-denied');
          for (const candidate of [initial, denied, queued, queuedDenied]) {
            await sql`INSERT INTO work_item (work_item_id,tenant_id,requested_by_user_id,revision,document_version_id,projection_json)
              VALUES (${candidate.workItemId},${scope.tenantId},${scope.actorUserId},1,'dv-job',${JSON.stringify(candidate)})`;
          }
          const lifecycle = new ActionAttemptLifecycleService(
            new ActionAttemptRepository(db),
            fixedModelSettings(),
          );
          const workItems = new MiaodaWorkItemRepository(db);
          const original = originalFixture(); original.binding.documentVersionId='dv-job';
          original.source.units=[original.source.units[0]]; original.source.units[0].payload={text:document.excerpt};
          // Feed the real reservation producer's payload into the isolated
          // published fixture, rather than copying an original-result DTO.
          const { DocumentParsingHostedService } = require('../../server/modules/document-management/src/hosted/nest/document-parsing-hosted.service.ts');
          let reservedSourceBinding;
          const parser = new DocumentParsingHostedService({ from: () => {
            assert.fail('A parse reservation must not read or write files');
          } }, {
            readMetadataSource: async () => ({version:{documentId:'doc-job',familyId:'family-job',
              sourceArtifactId:original.binding.sourceArtifactId,pdfSha256:original.binding.sourceSha256,
              byteLength:original.binding.sourceByteLength},source:{bucketId:'fixture'}}),
          }, {readRequest:async () => null,reserve:async (_scope,input) => {
            reservedSourceBinding=input.sourceBinding;
            return {row:{parseRunId:'PR-TEST-2',documentVersionId:'dv-job',parseRevision:2,status:'RUNNING',
              artifactProgress:[],startedAt:new Date(),deadlineAt:new Date(),completedAt:null,errorCode:null}};
          }}, {configured:() => true}, {}, {assertCanRead:async input => {
            assert.equal(input.documentVersionId,'dv-job'); assert.equal(input.actorUserId,scope.actorUserId);
          }});
          await parser.start('dv-job',{requestId:'original-fixture',expectedPublishedRevision:1},scope);
          assert.ok(reservedSourceBinding);
          await sql`INSERT INTO dm_document_version(document_version_id) VALUES ('dv-job')`;
          await sql`INSERT INTO dm_document_parse_run(parse_run_id,document_version_id,tenant_id,actor_user_id,request_id,parse_revision,expected_published_revision,status,bucket_id,source_binding,manifest_artifact,deadline_at,completed_at)
            VALUES ('PR-TEST-2','dv-job',${scope.tenantId},${scope.actorUserId},'original-fixture',2,1,'PUBLISHED','fixture',${JSON.stringify(reservedSourceBinding)}::jsonb,
              ${JSON.stringify({role:'MANIFEST',readback:'VERIFIED',relativePath:'original/manifest.json',sha256:'b'.repeat(64),byteLength:100})}::jsonb,now()+interval '1 minute',now())`;
          let sourceReads = 0;
          const service = new CanonicalJobAidProblemService(
            {
              getTenantScopedByWorkItemId: async (input) => {
                const loaded = await workItems.loadTenantScopedProjection(
                  input.workItemId,
                  input.tenantId,
                );
                assert.ok(loaded?.projection);
                return loaded.projection;
              },
            },
            {
              readActualBytes: async () => {
                sourceReads += 1;
                return new TextEncoder().encode(
                  JSON.stringify({
                    sourceRefs: [
                      {
                        sourceRefId: 'sr1',
                        pageStart: 1,
                        pageEnd: 1,
                        quote: document.excerpt,
                      },
                    ],
                  }),
                );
              },
            },
            {},
            {},
            {},
            lifecycle,
            workItems,
            reviews,
            {
              buildForWorkItemWithEvidence: async (candidate) => ({
                common: projectCommonAssessmentContext(
                  candidate,
                  {
                    context: {
                      status: 'UNAVAILABLE',
                      reason: 'ISOLATED_RLS_TEST',
                    },
                    documentReadingStatus: 'AVAILABLE',
                    items: [],
                    sections: [],
                    resourceRefs: [],
                  },
                  [],
                ),
                availableReadingEvidence: [],
              }),
            },
            repository,
            undefined,
            {readDocumentOriginal:async (_dv,runId) => {
              assert.equal(_dv,'dv-job'); assert.equal(runId,'PR-TEST-2'); sourceReads+=1;
              return {original,structuredSource:original.source,run:{...original.binding,
                manifestArtifact:{relativePath:'original/manifest.json',readback:'VERIFIED',sha256:'b'.repeat(64),byteLength:100}}};
            }},
          );
          const begin = (candidate, requestId) =>
            hosted(() =>
              service.begin(
                candidate,
                {
                  tenantId: scope.tenantId,
                  workItemId: candidate.workItemId,
                  principalId: fence.principalId,
                  appId: 'app-test',
                  authorizationFingerprint: 'isolated-host-owner-binding',
                },
                'INITIAL_PROBLEM_ASSESSMENT',
                requestId,
              ),
            );
          const first = await begin(initial);
          assert.equal(first.status, 'RUNNING');
          assert.equal(first.task.modelInput.actorUserId, scope.actorUserId);
          const replay = await begin(initial);
          assert.equal(replay.attemptRef, first.attemptRef);
          assert.equal(replay.leaseToken, first.leaseToken);
          assert.equal(replay.leaseGeneration, first.leaseGeneration);
          assert.equal(
            (
              await sql`SELECT attempt_id FROM action_attempt WHERE work_item_id = ${initial.workItemId}`
            ).length,
            1,
          );

          const enqueue = (candidate, requestId) =>
            browser(async () => {
              const [role] = await db.execute(drizzleSql`
                SELECT current_user AS role,
                  current_setting('app.user_id') AS actor
              `);
              assert.equal(role.role, 'authenticated_wiselink_jobaid_test');
              assert.equal(role.actor, scope.actorUserId);
              return service.enqueueContinuation(
                candidate,
                scope.tenantId,
                'browser-permission-snapshot',
                requestId,
                'INITIAL_PROBLEM_ASSESSMENT',
              );
            });
          const queuedRequestId = 'f11c6fa2-1531-4dfb-9f4d-bd2bef4d26bf';
          const statusService=new CanonicalHostInitialAnalysisStatusService(db,lifecycle,repository);
          const entryScope={workItem:queued,tenantId:scope.tenantId};
          const ready=await hosted(() => statusService.project(entryScope));
          assert.equal(ready.nextOperation,'EVALUATE_JOBAID');
          assert.equal(ready.stages.applicability.status,'WAITING_INPUT');
          assert.equal((await browser(() => statusService.project(entryScope))).nextOperation,'EVALUATE_JOBAID');
          const wrongFile=structuredClone(queued); wrongFile.source.sourceFileSha256='f'.repeat(64);
          assert.equal((await hosted(() => statusService.project({...entryScope,workItem:wrongFile}))).status,'NOT_READY');
          const deniedRequestId = '60cae79e-364b-4e1b-a8ae-8cfbb7d04d5d';
          const beforeEnqueueReads = sourceReads;
          const receipt = await enqueue(queued, queuedRequestId);
          assert.equal(receipt.status, 'QUEUED');
          assert.equal(receipt.created, true);
          assert.equal(sourceReads, beforeEnqueueReads);
          const [pendingRow] =
            await sql`SELECT * FROM action_attempt WHERE operation_ref = ${receipt.attemptRef}`;
          assert.equal(pendingRow.actor_user_id, 'service:openclaw-main');
          const pendingTask = parseTaskEnvelope(pendingRow.task_envelope_json);
          assert.deepEqual(readInitialAnalysisRequestInput(pendingTask), {
            schemaVersion: INITIAL_ANALYSIS_REQUEST_SCHEMA,
            taskType: 'OPENCLAW_DYNAMIC_EVALUATION',
            requestId: queuedRequestId,
            originalParseRunId: 'PR-TEST-2',
          });
          assert.equal(
            (
              await sql`SELECT count(*)::int AS n FROM assessment_work_revision WHERE work_item_id = ${queued.workItemId}`
            )[0].n,
            0,
          );
          assert.deepEqual(await enqueue(queued, queuedRequestId), {
            ...receipt,
            created: false,
          });
          assert.equal(sourceReads, beforeEnqueueReads);
          const prepared = await begin(queued, queuedRequestId);
          assert.equal(prepared.attemptRef, receipt.attemptRef);
          assert.equal(prepared.status, 'RUNNING');
          assert.equal(readInitialAnalysisRequestInput(prepared.task), null);
          assert.equal(
            parseJobAidProblemTask(prepared.task).actorUserId,
            scope.actorUserId,
          );
          assert.equal(sourceReads, beforeEnqueueReads + 2);
          const {
            modelInput: _pendingInput,
            inputHash: pendingHash,
            ...pendingBindings
          } = pendingTask;
          const {
            modelInput: _preparedInput,
            inputHash: preparedHash,
            ...preparedBindings
          } = prepared.task;
          assert.deepEqual(preparedBindings, pendingBindings);
          assert.notEqual(preparedHash, pendingHash);
          const preparedReplay = await begin(queued, queuedRequestId);
          assert.equal(preparedReplay.attemptRef, receipt.attemptRef);
          assert.equal(preparedReplay.leaseToken, prepared.leaseToken);
          assert.equal(sourceReads, beforeEnqueueReads + 3);
          const deniedReceipt = await enqueue(queuedDenied, deniedRequestId);

          try {
            await sql`UPDATE identity_subject_mapping SET status = 'REVOKED' WHERE miaoda_user_id = ${scope.actorUserId}`;
            await assert.rejects(
              begin(denied),
              /JOBAID_ACTOR_AUTHORIZATION_CHANGED/u,
            );
            assert.equal(
              (
                await sql`SELECT attempt_id FROM action_attempt WHERE work_item_id = ${denied.workItemId}`
              ).length,
              0,
              'preflight rejection must not leave QUEUED or RUNNING work',
            );
            await assert.rejects(
              begin(queuedDenied, deniedRequestId),
              /JOBAID_ACTOR_AUTHORIZATION_CHANGED/u,
            );
            const [failedPreparation] =
              await sql`SELECT status, claim_count, lease_token, error_code FROM action_attempt WHERE operation_ref = ${deniedReceipt.attemptRef}`;
            assert.equal(failedPreparation.status, 'FAILED');
            assert.equal(failedPreparation.claim_count, 0);
            assert.equal(failedPreparation.lease_token, null);
            assert.equal(
              failedPreparation.error_code,
              'JOBAID_ACTOR_AUTHORIZATION_CHANGED',
            );
            await assert.rejects(
              begin(initial),
              /JOBAID_ACTOR_AUTHORIZATION_CHANGED/u,
            );
            const [preserved] =
              await sql`SELECT status, claim_count, lease_generation FROM action_attempt WHERE operation_ref = ${first.attemptRef}`;
            assert.equal(preserved.status, 'RUNNING');
            assert.equal(preserved.claim_count, 1);
            assert.equal(preserved.lease_generation, first.leaseGeneration);
          } finally {
            await sql`UPDATE identity_subject_mapping SET status = 'ACTIVE' WHERE miaoda_user_id = ${scope.actorUserId}`;
          }
          const changed = structuredClone(initial);
          changed.package.artifact.sha256 = 'b'.repeat(64);
          await sql`UPDATE work_item SET projection_json = ${JSON.stringify(changed)} WHERE work_item_id = ${initial.workItemId}`;
          assert.equal((await begin(initial)).attemptRef, first.attemptRef);
          changed.source.sourceFileSha256 = 'c'.repeat(64);
          await sql`UPDATE work_item SET projection_json = ${JSON.stringify(changed)} WHERE work_item_id = ${initial.workItemId}`;
          await assert.rejects(
            begin(initial),
            /JOBAID_SOURCE_VERSION_CHANGED/u,
          );
          assert.equal(
            (
              await sql`SELECT attempt_id FROM action_attempt WHERE work_item_id = ${initial.workItemId}`
            ).length,
            1,
          );
        },
      );

      let row = await attempt(db, 'ATT-initial');
      const command = proposal();
      let saved;
      const saveArgs = (requestId, expectedWorkRevision, raw = command) => ({
        row,
        actorUserId: scope.actorUserId,
        fence,
        sourceBindings,
        requestId,
        expectedWorkRevision,
        command: raw,
        content: materializeJobAidWork(raw, context),
      });

      await sql.unsafe(`CREATE FUNCTION fail_test_projection() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'TEST_PROJECTION_SQL_FAILURE'; END $$;
        CREATE TRIGGER fail_test_projection BEFORE INSERT ON engineering_search_projection
        FOR EACH ROW EXECUTE FUNCTION fail_test_projection();`);

      await t.test(
        'concurrent CAS admits one exact body; terminal response-loss readback preserves it',
        async () => {
          const concurrent = await Promise.allSettled(
            ['save-first-a', 'save-first-b'].map((id) =>
              hosted(() => repository.save(saveArgs(id, 0))),
            ),
          );
          assert.equal(
            concurrent.filter((result) => result.status === 'fulfilled').length,
            1,
            concurrent.filter(result => result.status === 'rejected').map(result => String(result.reason?.cause ?? result.reason)).join('\n'),
          );
          assert.match(
            concurrent.find((result) => result.status === 'rejected').reason
              .message,
            /JOBAID_WORK_REVISION_CONFLICT/u,
          );
          saved = concurrent.find((result) => result.status === 'fulfilled')
            .value.revision;
          const replayArgs = saveArgs(saved.requestId, 0);
          await sql`UPDATE action_attempt SET status = 'SUCCEEDED' WHERE attempt_id = 'ATT-initial'`;
          const replay = await hosted(() => repository.save(replayArgs));
          assert.equal(replay.replayed, true);
          assert.deepEqual(replay.revision, saved);
          await assert.rejects(
            hosted(() =>
              repository.save({
                ...replayArgs,
                command: { ...command, understanding: 'changed' },
              }),
            ),
            /JOBAID_SAVE_REQUEST_REUSE/u,
          );
          assert.equal(
            (
              await sql`SELECT revision FROM work_item WHERE work_item_id = 'WI-job'`
            )[0].revision,
            1,
          );
        },
      );

      await t.test('real projection SQL failure preserves committed body and exact pending, then rebuild recovers', async () => {
        const before = (await sql`SELECT content_json FROM assessment_work_revision WHERE assessment_work_revision_id=${saved.workRevisionRef}`)[0].content_json;
        const [pending] = await sql`SELECT * FROM engineering_search_projection_pending WHERE exact_revision_ref=${saved.workRevisionRef}`;
        assert.equal(pending.subject_id, scope.workItemId);
        assert.equal(pending.owner_id, scope.actorUserId);
        assert.equal(pending.attempts, 0);
        const rebuild = () => hosted(() => actors.withActorTransaction(scope.actorUserId, async () =>
          projection.rebuildPending({ tenantId: scope.tenantId, load: async item => {
            const work = await repository.readByRefForRuntime({ tenantId: scope.tenantId,
              actorUserId: scope.actorUserId, workItemId: item.subjectId, workRevisionRef: item.revisionRef });
            assert.ok(work);
            return work.content;
          } })));
        assert.deepEqual(await rebuild(), { attempted: 1, rebuilt: 0, failed: 1 });
        const [failed] = await sql`SELECT * FROM engineering_search_projection_pending WHERE exact_revision_ref=${saved.workRevisionRef}`;
        assert.equal(failed.last_error, 'P0001');
        assert.ok(!failed.last_error.includes('params:'));
        assert.equal((await sql`SELECT content_json FROM assessment_work_revision WHERE assessment_work_revision_id=${saved.workRevisionRef}`)[0].content_json, before);
        await sql.unsafe('DROP TRIGGER fail_test_projection ON engineering_search_projection');
        assert.deepEqual(await rebuild(), { attempted: 1, rebuilt: 1, failed: 0 });
        assert.equal((await sql`SELECT * FROM engineering_search_projection_pending`).length, 0);
        const indexed = await sql`SELECT parent_context_ref, owner_id FROM engineering_search_projection`;
        assert.ok(indexed.length > 0);
        assert.ok(indexed.every(row => row.parent_context_ref === scope.workItemId && row.owner_id === scope.actorUserId));
        assert.equal((await sql`SELECT content_json FROM assessment_work_revision WHERE assessment_work_revision_id=${saved.workRevisionRef}`)[0].content_json, before);
      });

      await t.test('authorized source batches retain earlier passages and reject identity collisions atomically', async () => {
        const entry = key => ({ entryId: `source-batch:${key}`, ownerKind: 'SOURCE', ownerId: scope.actorUserId,
          exactRevisionRef: 'parse-source-batch', entryKind: 'SOURCE', locatorRef: key,
          parentContextRef: 'dv-job', originalText: `${key} original condition ${'long text '.repeat(40)}` });
        const index = entries => hosted(() => actors.withActorScope(scope.actorUserId,
          () => projection.indexAuthorizedSourceEntries({ tenantId: scope.tenantId, entries })));
        await index([entry('A')]);
        await index([entry('B')]);
        await index([{ ...entry('A'), originalText: 'A corrected condition' }, entry('C')]);
        const rows = await sql`SELECT locator_ref, original_or_work_text FROM engineering_search_projection
          WHERE exact_revision_ref='parse-source-batch' ORDER BY locator_ref`;
        assert.deepEqual(rows.map(row => row.locator_ref), ['A', 'B', 'C']);
        assert.equal(rows[0].original_or_work_text, 'A corrected condition');
        assert.equal(rows[1].original_or_work_text, entry('B').originalText);
        await assert.rejects(index([entry('D'), { ...entry('A'), exactRevisionRef: 'another-parse' }]),
          /ENGINEERING_SEARCH_SOURCE_IDENTITY_CONFLICT/);
        assert.equal((await sql`SELECT * FROM engineering_search_projection WHERE entry_id='source-batch:D'`).length, 0);
        await sql`DELETE FROM engineering_search_projection WHERE exact_revision_ref='parse-source-batch'`;
      });

      await t.test(
        'actual Hosted actor scope hides work from another actor or tenant and rejects changed source',
        async () => {
          assert.deepEqual(
            await hosted(() =>
              repository.readByRefForRuntime({
                ...scope,
                workRevisionRef: saved.workRevisionRef,
              }),
            ),
            saved,
          );
          assert.deepEqual(
            await hosted(() => repository.listHeadersForRuntime(scope)),
            [
              {
                workRevisionRef: saved.workRevisionRef,
                workRevision: saved.workRevision,
              },
            ],
          );
          for (const changedScope of [
            { actorUserId: 'actor-other' },
            { tenantId: 'other-tenant' },
            { workItemId: 'WI-other' },
          ]) {
            assert.equal(
              await hosted(() =>
                repository.readByRefForRuntime({
                  ...scope,
                  ...changedScope,
                  workRevisionRef: saved.workRevisionRef,
                }),
              ),
              null,
            );
            assert.deepEqual(
              await hosted(() =>
                repository.listHeadersForRuntime({
                  ...scope,
                  ...changedScope,
                }),
              ),
              [],
            );
          }
          assert.equal(
            await hosted(() => repository.latest(scope)),
            null,
            'unbound system account is not the owner',
          );
          assert.deepEqual(
            await hosted(() =>
              repository.latestForRuntime({
                ...scope,
                actorUserId: 'actor-other',
              }),
            ),
            null,
          );
          assert.deepEqual(
            await hosted(() =>
              repository.latestForRuntime({
                ...scope,
                tenantId: 'other-tenant',
              }),
            ),
            null,
          );
          await assert.rejects(
            hosted(() =>
              repository.save({
                ...saveArgs('wrong-actor', 1),
                actorUserId: 'actor-other',
              }),
            ),
            /JOBAID_ACTOR_AUTHORIZATION_CHANGED/u,
          );
          await sql`UPDATE work_item SET document_version_id = 'dv-changed' WHERE work_item_id = 'WI-job'`;
          await assert.rejects(
            hosted(() => repository.save(saveArgs('changed-source', 1))),
            /JOBAID_SOURCE_AUTHORIZATION_CHANGED/u,
          );
          await sql`UPDATE work_item SET document_version_id = 'dv-job' WHERE work_item_id = 'WI-job'`;
          const current = await hosted(() =>
            repository.latestForRuntime(scope),
          );
          assert.deepEqual(current, saved);
        },
      );

      await t.test(
        'source-read receipt is durable; cancellation rejects every late append',
        async () => {
          await sql`UPDATE action_attempt SET status = 'RUNNING' WHERE attempt_id = 'ATT-initial'`;
          await hosted(() =>
            repository.recordSourceRead({
              row,
              actorUserId: scope.actorUserId,
              fence,
              sourceBindings,
              sourceRefs: [document.evidenceRef],
              purpose: '核对完整限制条件。',
            }),
          );
          const [receipt] =
            await sql`SELECT review_activity_json FROM action_attempt WHERE attempt_id = 'ATT-initial'`;
          assert.deepEqual(
            JSON.parse(receipt.review_activity_json)[0].sourceRefs,
            [document.evidenceRef],
          );
          await sql`UPDATE action_attempt SET cancel_requested_at = now() WHERE attempt_id = 'ATT-initial'`;
          await assert.rejects(
            hosted(() => repository.save(saveArgs('late-after-cancel', 1))),
            /JOBAID_WORK_LEASE_FENCE_REJECTED/u,
          );
          await assert.rejects(
            hosted(() =>
              repository.recordSourceRead({
                row,
                actorUserId: scope.actorUserId,
                fence,
                sourceBindings,
                sourceRefs: [document.evidenceRef],
                purpose: 'late',
              }),
            ),
            /JOBAID_WORK_LEASE_FENCE_REJECTED/u,
          );
          assert.equal(
            (
              await sql`SELECT count(*)::int AS n FROM assessment_work_revision`
            )[0].n,
            1,
          );
          await sql`UPDATE action_attempt SET status = 'CANCELLED' WHERE attempt_id = 'ATT-initial'`;
        },
      );

      for (const number of [1, 2])
        await t.test(
          `Review ${number} rolls back work and candidate together, then saves and replays one revision`,
          async () => {
            const turnId = `RT-job-${number}`;
            const attemptId = `ATT-review-${number}`;
            const resultHash = String(number).repeat(64);
            await seedReview(sql, number, resultHash);
            row = await attempt(db, attemptId);
            const binding = await hosted(() =>
              actors.withActorTransaction(scope.actorUserId, ({ database }) =>
                reviews.loadOpenClawTurnByIdBinding(
                  {
                    reviewConversationId: 'RC-job',
                    reviewTurnId: turnId,
                    tenantId: scope.tenantId,
                    actorId: scope.actorUserId,
                    workItemId: scope.workItemId,
                  },
                  database,
                ),
              ),
            );
            assert.ok(binding);
            const raw = proposal(
              `${document.excerpt} Review ${number}: ${'完整条件不得截断。'.repeat(70)}`,
            );
            const content = materializeJobAidWork(raw, {
              ...context,
              previous: saved.content,
            });
            const persist = async (injectRollback) =>
              hosted(() =>
                actors.withActorTransaction(
                  scope.actorUserId,
                  async ({ database }) => {
                    const update = await repository.save(
                      {
                        row,
                        actorUserId: scope.actorUserId,
                        fence: { ...fence, allowCommittingReview: true },
                        sourceBindings,
                        requestId: `review-turn:${turnId}`,
                        expectedWorkRevision: number,
                        command: raw,
                        content,
                      },
                      database,
                    );
                    const candidate = {
                      responseType: 'ANSWER',
                      answer: `候选理解修订 ${number} 已保留完整条件。`,
                      sourceRefs: [document.evidenceRef],
                      missingInputs: [],
                      candidateEvidenceRefs: [document.evidenceRef],
                      reviewActionDraft: null,
                      affectedItemIds: [],
                      warnings: [],
                      actionAttemptRef: `AQ-review-${number}`,
                      jobAidWorkingUpdate: {
                        status: 'APPLIED',
                        workRevisionRef: update.revision.workRevisionRef,
                        workRevision: update.revision.workRevision,
                        affectedIssueKeys: ['condition'],
                      },
                      provenance: {
                        runtimeAppId: 'app_17c3zn24kv2',
                        profileRef: 'wiselink-engineering',
                        modelVersion: 'synthetic-test',
                        promptVersion: 'review-test',
                        skillVersion:
                          'wiselink-research-and-synthesize@r09.c43',
                        toolVersions: {
                          'wiselink-openclaw-engineering-assessment': '1.1.0',
                        },
                        resultContentHash: resultHash,
                      },
                    };
                    const result =
                      await reviews.persistOpenClawAssistantCandidate(
                        {
                          conversation: binding.conversation,
                          turn: binding.turn,
                          actionAttemptId: attemptId,
                          candidate,
                          completedAt: new Date(),
                        },
                        database,
                      );
                    if (injectRollback)
                      throw new Error('SYNTHETIC_AFTER_CANDIDATE_ROLLBACK');
                    return { update, result };
                  },
                ),
              );
            await assert.rejects(
              persist(true),
              /SYNTHETIC_AFTER_CANDIDATE_ROLLBACK/u,
            );
            assert.equal(
              (
                await sql`SELECT count(*)::int AS n FROM assessment_work_revision`
              )[0].n,
              number,
            );
            assert.equal(
              (
                await sql`SELECT assistant_response FROM review_turn WHERE review_turn_id = ${turnId}`
              )[0].assistant_response,
              null,
            );
            const first = await persist(false);
            const replay = await persist(false);
            assert.equal(first.update.replayed, false);
            assert.equal(replay.update.replayed, true);
            assert.equal(replay.result.replayed, true);
            assert.deepEqual(
              replay.result.turn.assistantCandidate.jobAidWorkingUpdate,
              first.result.turn.assistantCandidate.jobAidWorkingUpdate,
            );
            assert.equal(
              first.update.revision.previousWorkRevisionRef,
              saved.workRevisionRef,
            );
            assert.equal(
              first.update.revision.content.issues[0].statements[0].claimId,
              saved.content.issues[0].statements[0].claimId,
            );
            assert.equal(
              first.update.revision.content.issues[0].statements[0].text,
              raw.issues[0].statements[0].text,
            );
            saved = first.update.revision;
            await sql`UPDATE action_attempt SET status = 'SUCCEEDED' WHERE attempt_id = ${attemptId}`;
          },
        );

      await t.test(
        'browser owner reads the same latest work; no role can update/delete a saved work row through RLS',
        async () => {
          await sql.begin(async (tx) => {
            await tx.unsafe(
              'SET LOCAL ROLE authenticated_wiselink_jobaid_test',
            );
            await tx`SELECT set_config('app.user_id', 'actor-job', true)`;
            const rows =
              await tx`SELECT assessment_work_revision_id FROM assessment_work_revision ORDER BY work_revision DESC`;
            assert.equal(rows.length, 3);
            assert.equal(
              rows[0].assessment_work_revision_id,
              saved.workRevisionRef,
            );
            assert.equal(
              (
                await tx`UPDATE assessment_work_revision SET content_json = '{}' RETURNING assessment_work_revision_id`
              ).length,
              0,
            );
            assert.equal(
              (
                await tx`DELETE FROM assessment_work_revision RETURNING assessment_work_revision_id`
              ).length,
              0,
            );
          });
          assert.equal(
            (
              await sql`SELECT revision FROM work_item WHERE work_item_id = 'WI-job'`
            )[0].revision,
            1,
            'candidate work never changes formal WorkItem revision',
          );
          assert.equal(
            (await hosted(() => repository.latestForRuntime(scope)))
              .workRevisionRef,
            saved.workRevisionRef,
          );

          // Exercise the service used by GET /assessment-work with the actual
          // authenticated role, no write privilege, and a READ ONLY transaction.
          await sql.unsafe(
            'REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM authenticated',
          );
          const browserView = await new Promise((resolve, reject) =>
            sqlContext.use(
              {
                userContext: {
                  userId: scope.actorUserId,
                  isSystemAccount: false,
                  roles: [],
                },
              },
              {},
              () =>
                db
                  .transaction(
                    async (browserDb) => {
                      const [role] = await browserDb.execute(drizzleSql`
                      SELECT current_user AS role,
                        current_setting('transaction_read_only') AS read_only,
                        has_table_privilege(current_user, 'assessment_work_revision', 'UPDATE') AS can_update
                    `);
                      assert.equal(
                        role.role,
                        'authenticated_wiselink_jobaid_test',
                      );
                      assert.equal(role.read_only, 'on');
                      assert.equal(role.can_update, false);
                      const browserWorkItems = new MiaodaWorkItemRepository(
                        browserDb,
                      );
                      const browserService = new CanonicalJobAidProblemService(
                        {
                          getTenantScopedByWorkItemId: async (input) => {
                            const loaded =
                              await browserWorkItems.loadTenantScopedProjection(
                                input.workItemId,
                                input.tenantId,
                              );
                            assert.ok(loaded?.projection);
                            return loaded.projection;
                          },
                        },
                        {},
                        {},
                        {
                          authorize: async ({ actor, action, workItemId }) => ({
                            allowed:
                              actor.userId === scope.actorUserId &&
                              actor.tenantId === scope.tenantId &&
                              workItemId === scope.workItemId,
                            action,
                            permissionSnapshotVersion: 'browser-test',
                          }),
                        },
                        {
                          freshRead: async () => ({
                            permissionSnapshotVersion: 'browser-test',
                          }),
                        },
                        {},
                        browserWorkItems,
                        new ReviewConversationRepository(browserDb),
                        {},
                        new JobAidWorkRepository(browserDb, actors, projection),
                      );
                      return browserService.readBrowser(scope.workItemId, {
                        userId: scope.actorUserId,
                        tenantId: scope.tenantId,
                      });
                    },
                    { accessMode: 'read only' },
                  )
                  .then(resolve, reject),
            ),
          );
          assert.deepEqual(browserView.current, saved);
          assert.equal(browserView.executionStatus, 'SUCCEEDED');
          assert.equal(browserView.currentInputChanged, false);
        },
      );
    } finally {
      if (originalFeatureFlag === undefined)
        delete process.env.WL_JOBAID_PROBLEM_V2_ENABLED;
      else process.env.WL_JOBAID_PROBLEM_V2_ENABLED = originalFeatureFlag;
      await sql.end({ timeout: 5 });
    }
  },
);

async function reset(sql) {
  await sql.unsafe(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated_wiselink_jobaid_test') THEN CREATE ROLE authenticated_wiselink_jobaid_test NOLOGIN IN ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role_wiselink_jobaid_test') THEN CREATE ROLE service_role_wiselink_jobaid_test NOLOGIN IN ROLE service_role; END IF; END $$;
    CREATE TYPE user_profile AS (user_id text);
    CREATE TABLE identity_subject_mapping (id uuid DEFAULT gen_random_uuid(), miaoda_user_id text, miaoda_tenant_id text, expected_client_id text, status text);`);
  for (const [name, table, constraints] of [
    [
      'work_item',
      workItem,
      'UNIQUE(work_item_id), UNIQUE(tenant_id,work_item_id)',
    ],
    [
      'action_attempt',
      actionAttempt,
      'UNIQUE(attempt_id), UNIQUE(operation_ref)',
    ],
  ]) {
    const columns = getTableConfig(table).columns.map(
      (column) =>
        `"${column.name.replaceAll('"', '""')}" ${column.getSQLType()}`,
    );
    await sql.unsafe(
      `CREATE TABLE ${name} (${columns.join(',')}, ${constraints})`,
    );
  }
  await sql.unsafe(`CREATE UNIQUE INDEX uk_action_attempt_active_work_task ON action_attempt(work_item_id, action_type)
    WHERE status IN ('QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING')`);
  await sql.unsafe(`ALTER TABLE action_attempt
    ALTER COLUMN claim_count SET DEFAULT 0,
    ALTER COLUMN retry_count SET DEFAULT 0,
    ALTER COLUMN lease_generation SET DEFAULT 0,
    ALTER COLUMN projection_applied SET DEFAULT false;
    ALTER TABLE identity_subject_mapping ENABLE ROW LEVEL SECURITY;`);
  // Match the existing platform ALL policies on these two tables. Source/work
  // history and identity tables retain their actual actor-bound RLS below.
  for (const name of ['work_item', 'action_attempt']) {
    await sql.unsafe(`ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY;
      CREATE POLICY ${name}_authenticated ON ${name}
        FOR ALL TO authenticated_wiselink_jobaid_test USING (true);
      CREATE POLICY ${name}_service ON ${name}
        FOR ALL TO service_role_wiselink_jobaid_test USING (true);`);
  }
  const migration = await sql.reserve();
  try {
    for (const name of [
      '0009_review_conversation_persistence_c1.sql',
      '0010_interactive_review_host_mcp_c2.sql',
      '0018_interactive_review_openclaw_candidate_update.sql',
      '0019_interactive_review_hosted_runtime_select.sql',
      '0021_interactive_review_hosted_runtime_candidate_update.sql',
    ]) {
      await migration.unsafe(
        await readFile(
          new URL(`../../migrations/${name}`, import.meta.url),
          'utf8',
        ),
      );
    }
    const identityRls = await readFile(
      new URL(
        '../../migrations/0005_identity_oauth_authenticated_rls.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const authenticatedIdentityPolicy = identityRls.match(
      /CREATE POLICY identity_subject_mapping_authenticated_oauth_read[\s\S]+?\n  \);/u,
    );
    assert.ok(authenticatedIdentityPolicy);
    await migration.unsafe(authenticatedIdentityPolicy[0]);
    await migration.unsafe(
      'ALTER TABLE review_turn ADD COLUMN review_scope_json jsonb',
    );
    const catalog = await readFile(
      new URL(
        '../../migrations/0014_engineering_matter_catalog.sql',
        import.meta.url,
      ),
      'utf8',
    );
    for (const name of [
      'engineering_matter_actor_has_tenant',
      'engineering_matter_work_item_owned_by_actor',
    ]) {
      const match = catalog.match(
        new RegExp(
          `CREATE OR REPLACE FUNCTION ${name}\\([\\s\\S]+?\\$\\$;`,
          'u',
        ),
      );
      assert.ok(match);
      await migration.unsafe(match[0]);
    }
    await migration.unsafe(
      await readFile(
        new URL(
          '../../migrations/0026_assessment_work_revision.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    await migration.unsafe(`CREATE TABLE dm_document_version(document_version_id varchar(96) PRIMARY KEY, family_id varchar, source_artifact_id varchar);
      CREATE TABLE dm_publication_family(family_id varchar, canonical_identity_key text);
      CREATE TABLE dm_acquisition(document_version_id varchar,source_artifact_id varchar,acquired_by varchar,status varchar,idempotency_key text);`);
    const materialSql = await readFile(new URL('../../migrations/0032_engineering_matter_material.sql',import.meta.url),'utf8');
    for (const name of ['engineering_matter_uri_component','engineering_matter_document_owned_by_actor']) {
      const start=materialSql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
      assert.ok(start>=0); const end=materialSql.indexOf('$$;',start)+3;
      await migration.unsafe(materialSql.slice(start,end));
    }
    await migration.unsafe(await readFile(new URL('../../migrations/0038_document_parse_run.sql',import.meta.url),'utf8'));
    for (const name of ['0039_engineering_search_projection.sql', '0042_engineering_search_projection_pending.sql', '0043_engineering_search_hosted_actor_scope.sql', '0050_document_source_projection_progress.sql']) {
      await migration.unsafe(await readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'));
    }
  } finally {
    migration.release();
  }
  await sql.unsafe(
    'GRANT USAGE ON SCHEMA public TO service_role, authenticated',
  );
  await sql.unsafe(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role, authenticated',
  );
}

async function seed(sql) {
  await sql`INSERT INTO identity_subject_mapping (miaoda_user_id,miaoda_tenant_id,expected_client_id,status)
    VALUES ('actor-job','tenant-job','cli_aadde8b579f95bc9','ACTIVE'), ('actor-other','other-tenant','cli_aadde8b579f95bc9','ACTIVE')`;
  await sql`INSERT INTO work_item (work_item_id,tenant_id,requested_by_user_id,revision,document_version_id,projection_json)
    VALUES ('WI-job','tenant-job','actor-job',1,'dv-job',${JSON.stringify(initialProjection(scope.workItemId))})`;
  await seedAttempt(
    sql,
    'ATT-initial',
    'AQ-initial',
    'OPENCLAW_DYNAMIC_EVALUATION',
    'RUNNING',
    null,
  );
  await sql`INSERT INTO review_conversation (review_conversation_id,tenant_id,actor_id,work_item_id,openclaw_agent_id,openclaw_session_key,
    started_at_revision,last_synced_revision,status,created_at,last_active_at)
    VALUES ('RC-job','tenant-job','actor-job','WI-job','wiselink-engineering','review:test-job',1,1,'ACTIVE',now(),now())`;
}
async function seedAttempt(sql, id, ref, type, status, resultHash) {
  await sql`INSERT INTO action_attempt (attempt_id,operation_ref,work_item_id,tenant_id,actor_user_id,action_type,request_origin,status,input_revision,base_revision,
    document_version_id,task_input_hash,lease_owner,lease_token,lease_generation,lease_expires_at,deadline_at,result_content_hash)
    VALUES (${id},${ref},'WI-job','tenant-job','actor-job',${type},'OPENCLAW_MCP_V1',${status},1,1,'dv-job',${hash},'service-job','lease-job',1,now()+interval '1 hour',now()+interval '2 hours',${resultHash})`;
}
async function seedReview(sql, number, resultHash) {
  await sql`INSERT INTO review_turn (review_turn_id,review_conversation_id,engineer_supplied_input_id,tenant_id,actor_id,work_item_id,turn_no,request_id,input_revision,user_message,input_type,adoption_status,created_at)
    VALUES (${`RT-job-${number}`},'RC-job',${`ESI-job-${number}`},'tenant-job','actor-job','WI-job',0,${`request-review-${number}`},1,${`合成测试纠正 ${number}`},'ENGINEER_TEXT','CANDIDATE_UNADOPTED',now())`;
  await seedAttempt(
    sql,
    `ATT-review-${number}`,
    `AQ-review-${number}`,
    'OPENCLAW_INTERACTIVE_REVIEW',
    'COMMITTING',
    resultHash,
  );
}
async function attempt(db, id) {
  return (
    await db.select().from(actionAttempt).where(eq(actionAttempt.attemptId, id))
  )[0];
}

function initialProjection(workItemId) {
  return {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId,
    requestId: `REQ-${workItemId}`,
    revision: 1,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    permissionSnapshotVersion: 'isolated-test',
    source: { documentId: 'doc-job', documentVersionId: 'dv-job',sourceArtifactId:'ART-TEST',sourceFileSha256:hash,sourceByteLength:1234 },
    classification: { status: 'CONFIRMED', normalizedFamily: 'SB' },
    package: {
      packageId: `PKG-${workItemId}`,
      title: 'Synthetic English source',
      artifact: {
        ref: sourceBindings[0].artifactRef,
        sha256: hash,
        byteLength: 1,
        storeRole: 'U0_PARSED_PACKAGE',
        mediaType: 'application/json',
      },
    },
    integratedAssessment: null,
    failure: null,
    recordingFailure: null,
  };
}
