import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const { eq, sql: contextSql } = require('drizzle-orm');
const {
  SqlExecutionContextMiddleware,
} = require('@lark-apaas/fullstack-nestjs-core');
const { actionAttempt } = require('../../server/database/schema.ts');
const {
  EngineeringSearchProjectionWriter,
} = require('../../server/modules/canonical-host/engineering-search-projection.ts');
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
  CanonicalHostOpenClawReviewService,
} = require('../../server/modules/canonical-host/canonical-host-openclaw-review.service.ts');
const {
  MiaodaWorkItemRepository,
} = require('../../server/modules/work-item/miaoda-work-item.repository.ts');
const {
  ActionAttemptRepository,
} = require('../../server/modules/action-attempt/action-attempt.repository.ts');
const {
  ActionAttemptLifecycleService,
} = require('../../server/modules/action-attempt/action-attempt-lifecycle.service.ts');
const {
  materializeJobAidWork,
  jobAidReadingResult,
} = require('../../server/modules/canonical-host/jobaid-problem-work.ts');
const {
  buildJobAidProblemTask,
} = require('../../server/modules/canonical-host/jobaid-problem-task.ts');
const {
  projectCommonAssessmentContext,
} = require('../../server/modules/canonical-host/canonical-host-common-context.service.ts');
const {
  sealResultEnvelope,
  sealTaskEnvelope,
  canonicalJson,
} = require('../../server/modules/action-attempt/action-attempt-envelope.ts');
const {
  JOBAID_METHOD_BINDING,
  JOBAID_METHOD_EVIDENCE,
} = require('../../server/modules/canonical-host/jobaid-method-pack.ts');
const {
  originalFixture,
} = require('../unit/document-parsing/fixtures/document-original.fixture.ts');
const { fixedModelSettings } = require('../support/fixed-model-settings.ts');
const {
  overallUserRegenerationIdempotencyKey,
  CanonicalHostOpenClawOverallService,
} = require('../../server/modules/canonical-host/canonical-host-openclaw-overall.service.ts');
const {
  CanonicalHostOverallRegenerationService,
} = require('../../server/modules/canonical-host/canonical-host-overall-regeneration.service.ts');
const { resetQ1Database, initialProjection } =
  await import('./helpers/q1-review-postgres.fixture.mjs');

const databaseUrl = process.env.JOBAID_WORK_TEST_DATABASE_URL;
const scope = {
  tenantId: 'tenant-job',
  workItemId: 'WI-job',
  actorUserId: 'actor-job',
};
const fence = {
  principalId: 'service-job',
  leaseToken: 'lease-job',
  leaseGeneration: 1,
};
const source = {
  kind: 'DOCUMENT_PASSAGE',
  evidenceRef: 'source:dv-job:sr1',
  title: 'Constructed Q1 source',
  workItemId: scope.workItemId,
  documentVersionId: 'dv-job',
  sourceRefId: 'sr1',
  versionLabel: 'R1',
  locator: 'page 1',
  excerpt:
    'Do not replace unless the indication persists after 5 seconds. Normal inspection does not exclude intermittent failure.',
};
const evidence = [source, ...JOBAID_METHOD_EVIDENCE];
const sourceBindings = [
  {
    workItemId: scope.workItemId,
    documentVersionId: 'dv-job',
    artifactRef: 'artifact://test/source',
    artifactSha256: 'a'.repeat(64),
  },
];

// Manually checked against the constructed two-sentence source. No model candidate,
// OEM content acceptance, risk score, remote plugin, or product model call is involved.
function proposal(corrected = false) {
  return {
    schemaVersion: 'wiselink.jobaid-problem-work.v3',
    headline: corrected
      ? 'Normal inspection does not exclude intermittent failure'
      : 'Replacement requires a persistent indication',
    listBrief: corrected
      ? 'Preserve both the replacement condition and the inspection limitation.'
      : 'The indication must persist after 5 seconds.',
    overview: corrected
      ? source.excerpt
      : 'Replacement is conditional on a persistent indication.',
    roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS',
    completionReason:
      'The source is read; operational frequency remains unknown.',
    changeSummary: corrected
      ? 'Clarify the inspection limitation.'
      : 'Record the source condition.',
    unchangedExplanation: 'Keep the unrelated issue intact.',
    issues: [
      {
        issueKey: 'condition',
        question: corrected
          ? 'Can a normal inspection exclude intermittent failure?'
          : 'When is replacement allowed?',
        body: `${corrected ? source.excerpt : source.excerpt.split('. ')[0] + '.'} [[${source.evidenceRef}]]`,
        riskScenarios: [
          {
            scenario: 'Intermittent indication',
            conditions: ['A normal inspection can occur between indications.'],
            method: 'JA_AC_R01',
            severity: null,
            likelihood: null,
            importantEvent: null,
            limitations: ['No operational severity or frequency is provided.'],
            controlComparison: 'Keep the unknown severity and likelihood.',
          },
        ],
        measures: [],
        otherClassifications: [],
        requirementHandling: [],
        openQuestions: [
          {
            question: 'Is a continuous record available?',
            affects: 'Frequency',
            nextEvidence: 'Continuous record',
            reason: 'A single inspection does not resolve intermittency.',
          },
        ],
      },
    ],
    unchangedIssueKeys: corrected ? ['unrelated'] : [],
    retiredIssues: [],
  };
}

test(
  'Q1 fixed Review work, exact dependencies and recovery on disposable PostgreSQL',
  { skip: !databaseUrl, concurrency: false },
  async (t) => {
    const url = new URL(databaseUrl);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.match(url.pathname, /^\/wiselink_jobaid_test_q1_[a-z0-9_]+$/u);
    const sql = postgres(databaseUrl, { max: 4, onnotice() {} });
    try {
      await resetQ1Database(sql);
      const db = drizzle(sql);
      const sqlContext = new SqlExecutionContextMiddleware({
        roleSchema: 'wiselink_jobaid_test',
      });
      const projection = new EngineeringSearchProjectionWriter(db);
      const actors = new EngineeringMatterWorkingRepository(
        db,
        sqlContext,
        { roleSchema: 'wiselink_jobaid_test' },
        projection,
      );
      const work = new JobAidWorkRepository(db, actors, projection);
      const reviews = new ReviewConversationRepository(db);
      const workItems = new MiaodaWorkItemRepository(db);
      const attempts = new ActionAttemptLifecycleService(
        new ActionAttemptRepository(db),
        fixedModelSettings(),
      );
      const inContext = (userId, system, callback) =>
        new Promise((resolve, reject) =>
          sqlContext.use(
            { userContext: { userId, isSystemAccount: system, roles: [] } },
            {},
            () => Promise.resolve().then(callback).then(resolve, reject),
          ),
        );
      const hosted = (callback) => inContext('-1', true, callback);
      const browser = (callback) =>
        inContext(scope.actorUserId, false, callback);
      const current = async () =>
        (
          await workItems.loadTenantScopedProjection(
            scope.workItemId,
            scope.tenantId,
          )
        ).projection;
      const registrar = {
        getTenantScopedByWorkItemId: current,
        compareAndSet: (input) => workItems.compareAndSet(input),
      };
      let artifactWrites = 0;
      const artifactStore = {
        persistAndReadback: async (bytes) => {
          artifactWrites += 1;
          return {
            artifact: {
              ref: `artifact://q1/${artifactWrites}`,
              sha256: createHash('sha256').update(bytes).digest('hex'),
              byteLength: bytes.byteLength,
              mediaType: 'application/json',
              storeRole: 'U0_PARSED_PACKAGE',
            },
          };
        },
      };
      const original = originalFixture();
      original.binding.documentVersionId = 'dv-job';
      original.source.units = [original.source.units[0]];
      original.source.units[0].payload = { text: source.excerpt };
      const originalReader = {
        readDocumentOriginal: async () => ({
          original,
          structuredSource: original.source,
          run: {
            ...original.binding,
            manifestArtifact: {
              readback: 'VERIFIED',
              relativePath: 'original/manifest.json',
              sha256: 'b'.repeat(64),
              byteLength: 100,
            },
          },
        }),
      };
      // Only parse discovery is stubbed; every work, Review, lease and CAS uses SQL/RLS.
      work.publishedOriginalBinding = work.publishedOriginalBindingForRequest =
        async () => ({
          parseRunId: original.binding.parseRunId,
        });
      const common = {
        buildForWorkItemWithEvidence: async (item) => ({
          common: projectCommonAssessmentContext(
            item,
            {
              context: { status: 'UNAVAILABLE', reason: 'Q1_OFFLINE' },
              documentReadingStatus: 'AVAILABLE',
              items: [],
              sections: [],
              resourceRefs: [],
            },
            [],
          ),
          availableReadingEvidence: [],
        }),
      };
      const service = new CanonicalJobAidProblemService(
        registrar,
        artifactStore,
        {},
        {
          authorize: async ({ action }) => ({
            allowed: true,
            action,
            permissionSnapshotVersion: 'q1',
          }),
        },
        { freshRead: async () => ({ permissionSnapshotVersion: 'q1' }) },
        attempts,
        workItems,
        reviews,
        common,
        work,
        undefined,
        originalReader,
        { read: async () => null },
        db,
      );
      const reviewService = new CanonicalHostOpenClawReviewService(
        reviews,
        workItems,
        {},
        {},
        attempts,
        artifactStore,
        {},
        {},
        common,
        undefined,
        actors,
        service,
      );
      await sql`INSERT INTO identity_subject_mapping(miaoda_user_id,miaoda_tenant_id,expected_client_id,status)
        VALUES ('actor-job','tenant-job','cli_aadde8b579f95bc9','ACTIVE')`;
      await sql`INSERT INTO work_item(work_item_id,tenant_id,requested_by_user_id,revision,document_version_id,projection_json)
        VALUES ('WI-job','tenant-job','actor-job',1,'dv-job',${JSON.stringify(initialProjection(scope.workItemId))})`;
      await sql`INSERT INTO review_conversation(review_conversation_id,tenant_id,actor_id,work_item_id,openclaw_agent_id,openclaw_session_key,
        started_at_revision,last_synced_revision,status,created_at,last_active_at)
        VALUES ('RC-q1','tenant-job','actor-job','WI-job','wiselink-engineering','review:q1',1,1,'ACTIVE',now(),now())`;
      const rowById = async (id) =>
        (
          await db
            .select()
            .from(actionAttempt)
            .where(eq(actionAttempt.attemptId, id))
        )[0];
      const seedAttempt = async (id, type, status, baseRevision = 1) => {
        await sql`INSERT INTO action_attempt(attempt_id,operation_ref,work_item_id,tenant_id,actor_user_id,action_type,request_origin,status,
          input_revision,base_revision,document_version_id,task_input_hash,lease_owner,lease_token,lease_generation,lease_expires_at,deadline_at,created_at,updated_at,trigger_request_id)
          VALUES (${id},${`AQ-${id}`},'WI-job','tenant-job','actor-job',${type},'OPENCLAW_MCP_V1',${status},${baseRevision},${baseRevision},
          'dv-job',${'a'.repeat(64)},'service-job','lease-job',1,now()+interval '1 hour',now()+interval '2 hours',now(),now(),${`Q1-trigger-${id}`})`;
        return rowById(id);
      };
      const context = (previous) => ({
        methodBinding: JOBAID_METHOD_BINDING,
        workItemId: scope.workItemId,
        previous,
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
      });
      let saved;
      let baseline;
      let reviewTask;
      let reviewRow;
      let initialSaveArgs;
      let publicRoute;
      let publicRequest;
      let publicQueued;

      await t.test(
        'concurrent initial saves admit one body, reject stale CAS and changed request reuse',
        async () => {
          const row = await seedAttempt(
            'ATT-q1-initial',
            'OPENCLAW_DYNAMIC_EVALUATION',
            'RUNNING',
          );
          const command = proposal();
          command.issues.push({
            issueKey: 'unrelated',
            question: 'What replacement condition is stated?',
            body: `${source.excerpt} [[${source.evidenceRef}]]`,
            riskScenarios: [],
            measures: [],
            otherClassifications: [],
            requirementHandling: [],
            openQuestions: [],
          });
          const args = (id) => ({
            row,
            actorUserId: scope.actorUserId,
            fence,
            sourceBindings,
            requestId: id,
            expectedWorkRevision: 0,
            command,
            content: materializeJobAidWork(command, context(null)),
          });
          const results = await Promise.allSettled(
            ['initial-a', 'initial-b'].map((id) =>
              hosted(() => work.save(args(id))),
            ),
          );
          assert.equal(
            results.filter((result) => result.status === 'fulfilled').length,
            1,
          );
          assert.match(
            String(
              results.find((result) => result.status === 'rejected').reason,
            ),
            /JOBAID_WORK_REVISION_CONFLICT/u,
          );
          saved = results.find((result) => result.status === 'fulfilled').value
            .revision;
          const replay = await hosted(() => work.save(args(saved.requestId)));
          assert.equal(replay.replayed, true);
          assert.deepEqual(replay.revision, saved);
          await assert.rejects(
            hosted(() =>
              work.save({ ...args(saved.requestId), command: proposal(true) }),
            ),
            /JOBAID_SAVE_REQUEST_REUSE/u,
          );
          await sql`UPDATE action_attempt SET status='SUCCEEDED' WHERE attempt_id=${row.attemptId}`;
          baseline = saved;
          initialSaveArgs = args(saved.requestId);
          // Seed an already committed base/Overall fixture. This does not assert model quality.
          const item = await current();
          item.integratedAssessment = {
            status: 'OVERALL_CANDIDATE_READY',
            baseRules: service.baseProjection(item, row, saved, {
              ref: 'artifact://base',
              sha256: 'c'.repeat(64),
              byteLength: 100,
              mediaType: 'application/json',
              storeRole: 'U0_PARSED_PACKAGE',
            }),
            overallSynthesis: {
              status: 'CANDIDATE_ONLY',
              revision: 1,
              actionAttemptId: 'ATT-old-overall',
              basedOnJobAidWorkRevisionRef: saved.workRevisionRef,
              readingResult: jobAidReadingResult(saved),
              staleReason: null,
              artifact: {
                ref: 'artifact://old-overall',
                sha256: 'e'.repeat(64),
                byteLength: 1,
                mediaType: 'application/json',
                storeRole: 'U0_PARSED_PACKAGE',
              },
            },
            overallForAeoConfirmation: null,
          };
          item.integratedAssessment.overallForAeoConfirmation = {
            status: 'HUMAN_CONFIRMED',
            authority: 'CANONICAL_WORKITEM_SERVER_FRESH_READ',
            workItemRevision: 1,
            overallRevision: 1,
            overallArtifactRef: 'artifact://old-overall',
            overallArtifactSha256: 'e'.repeat(64),
            actionAttemptId: 'ATT-old-confirmation',
            confirmingActorUserId: scope.actorUserId,
            confirmedAt: '2026-10-02T00:00:00.000Z',
          };
          item.aeo = {
            status: 'CANDIDATE_AUTHORING_IN_PROGRESS',
            targetIdentity: 'AEO-q1',
            disposition: 'ADOPT',
            authorityLevel: 'candidate_only',
            sourceCandidateCount: 1,
            automaticallyAdopted: false,
            engineeringApproved: false,
            actionAttemptId: 'ATT-old-aeo',
            ownerCommit: '74333547ae5cd1878259812353d59563cc9041da',
            sourceOverall: {
              revision: 1,
              artifactRef: 'artifact://old-overall',
              artifactSha256: 'e'.repeat(64),
              confirmationActionAttemptId: 'ATT-old-confirmation',
              confirmedWorkItemRevision: 1,
              engineerReviewRevision: null,
              engineerReviewArtifactSha256: null,
            },
            artifacts: [],
          };
          await sql`UPDATE work_item SET projection_json=${JSON.stringify(item)} WHERE work_item_id='WI-job'`;
          await seedAttempt(
            'ATT-old-overall',
            'OPENCLAW_OVERALL_SYNTHESIS',
            'SUCCEEDED',
          );
        },
      );

      await t.test(
        'ordinary authenticated regeneration keeps the same base work through real reserve and Hosted begin',
        async () => {
          const before = await current();
          const overall = new CanonicalHostOpenClawOverallService(registrar, artifactStore,
            workItems, {}, {}, {}, attempts, {}, common, service);
          const route = new CanonicalHostOverallRegenerationService(
            {resolve:async()=>({actor:{tenantId:scope.tenantId,canonicalSubject:{id:scope.actorUserId}}})},
            {freshRead:async()=>({allowed:true,action:'REQUEST_OVERALL_REGENERATION',tenantId:scope.tenantId,
              actorUserId:scope.actorUserId,workItemId:scope.workItemId,workItemRevision:(await current()).revision,
              requestId:before.requestId,documentVersionId:'dv-job',authorizationFingerprint:'q1'})},
            registrar,{nowIso:()=> '2026-10-02T00:00:00.000Z'},overall,attempts,service);
          const request={requestId:'Q1-normal-base-regeneration',expectedRevision:before.revision,
            sourceIdentity:{documentVersionId:before.source.documentVersionId,
              sourceArtifactId:before.source.sourceArtifactId,sourceFileSha256:before.source.sourceFileSha256,
              packageId:before.package.packageId,packageArtifactSha256:before.package.artifact.sha256}};
          try {
            const [role]=await browser(()=>db.execute(contextSql`SELECT current_user AS role,current_setting('app.user_id',true) AS actor`));
            assert.equal(role.role,'authenticated_wiselink_jobaid_test');assert.equal(role.actor,scope.actorUserId);
            const queued=await browser(()=>route.request(scope.workItemId,request,{}));
            const replay=await browser(()=>route.request(scope.workItemId,request,{}));
            assert.equal(replay.replayed,true);assert.equal(replay.regeneration.attemptRef,queued.regeneration.attemptRef);
            const item=await current();assert.equal(item.revision,before.revision+1);
            assert.equal(item.overallRegenerationRequest.jobAidReviewWork,undefined);
            const begun=await hosted(()=>service.begin(item,{...scope,principalId:fence.principalId,
              authorizationFingerprint:'q1'},'OVERALL_CONSISTENCY'));
            assert.equal(begun.attemptRef,queued.regeneration.attemptRef);
            assert.equal(begun.task.modelInput.previousWork.workRevisionRef,baseline.workRevisionRef);
            assert.equal(begun.task.modelInput.previousWork.workRevision,baseline.workRevision);
            assert.equal(begun.task.modelInput.modelInput.expectedWorkRevision,baseline.workRevision);
            await sql`UPDATE action_attempt SET status='CANCELLED' WHERE operation_ref=${begun.attemptRef}`;
          } finally {
            // Disposable owner fixture restores the formal row before independent Review cases.
            // Runtime request/reserve/begin above use their actual public/Hosted SQL roles.
            await sql`UPDATE work_item SET revision=${before.revision},projection_json=${JSON.stringify(before)} WHERE work_item_id='WI-job'`;
          }
        },
      );

      await t.test(
        'actual Review persistence rolls back body, receipt and pending together, then recovers once',
        async () => {
          reviewRow = await seedAttempt(
            'ATT-q1-review',
            'OPENCLAW_INTERACTIVE_REVIEW',
            'COMMITTING',
          );
          await sql`UPDATE action_attempt SET result_content_hash=${'d'.repeat(64)} WHERE attempt_id=${reviewRow.attemptId}`;
          await sql`INSERT INTO review_turn(review_turn_id,review_conversation_id,engineer_supplied_input_id,tenant_id,actor_id,work_item_id,
          turn_no,request_id,input_revision,user_message,input_type,adoption_status,created_at)
          VALUES ('RT-q1','RC-q1','ESI-q1','tenant-job','actor-job','WI-job',1,'request-q1',1,'Clarify the inspection limitation.','ENGINEER_TEXT','CANDIDATE_UNADOPTED',now())`;
          const binding = await hosted(() =>
            work.withActorTransaction(scope.actorUserId, (database) =>
              reviews.loadOpenClawTurnByIdBinding(
                {
                  reviewConversationId: 'RC-q1',
                  reviewTurnId: 'RT-q1',
                  tenantId: scope.tenantId,
                  actorId: scope.actorUserId,
                  workItemId: scope.workItemId,
                },
                database,
              ),
            ),
          );
          reviewTask = buildJobAidProblemTask({
            workItem: await current(),
            actorUserId: scope.actorUserId,
            permissionSnapshotVersion: 'q1',
            purpose: 'PROBLEM_REVIEW',
            sourceCatalog: evidence,
            sourceBindings,
            common: (await common.buildForWorkItemWithEvidence(await current()))
              .common,
            previousWork: baseline,
            expectedWorkRevision: 1,
            priorAssessmentRefs: [baseline.workRevisionRef],
          });
          const sealedReviewTask = sealTaskEnvelope({
            schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
            actionAttemptId: reviewRow.attemptId,
            operationRef: reviewRow.operationRef,
            taskType: reviewRow.actionType,
            priority: 100,
            tenantId: scope.tenantId,
            workItemId: scope.workItemId,
            inputRevision: 1,
            baseRevision: 1,
            documentVersionId: 'dv-job',
            sourceRefs: [
              {
                ref: sourceBindings[0].artifactRef,
                sha256: sourceBindings[0].artifactSha256,
              },
            ],
            allowedConnectors: [],
            hostResolvedMissingInputs: [],
            modelInput: { jobAidContext: reviewTask },
            deadline: reviewRow.deadlineAt.toISOString(),
            idempotencyKey: 'q1:review:exact',
          });
          await sql`UPDATE action_attempt SET task_envelope_json=${canonicalJson(sealedReviewTask)},task_input_hash=${sealedReviewTask.inputHash} WHERE attempt_id=${reviewRow.attemptId}`;
          reviewRow = await rowById(reviewRow.attemptId);
          const candidate = {
            responseType: 'ANSWER',
            answer: 'Both conditions are retained.',
            sourceRefs: [source.evidenceRef],
            missingInputs: [],
            candidateEvidenceRefs: [source.evidenceRef],
            reviewActionDraft: null,
            affectedItemIds: [],
            warnings: [],
            actionAttemptRef: reviewRow.operationRef,
            provenance: {
              runtimeAppId: 'app_17c3zn24kv2',
              profileRef: 'wiselink-engineering',
              modelVersion: 'q1-constructed-not-called',
              promptVersion: 'q1-fixture',
              skillVersion: 'wiselink-research-and-synthesize@r09.c43',
              toolVersions: {
                'wiselink-openclaw-engineering-assessment': '1.2.0',
              },
              resultContentHash: 'd'.repeat(64),
            },
          };
          const authorized = {
            conversation: binding.conversation,
            turn: binding.turn,
            row: reviewRow,
            contract: { context: {}, jobAidContext: reviewTask },
          };
          const input = () => ({
            conversation: binding.conversation,
            turn: binding.turn,
            actionAttemptId: reviewRow.attemptId,
            candidate: structuredClone(candidate),
            completedAt: new Date(),
          });
          const originalPersist =
            reviews.persistOpenClawAssistantCandidate.bind(reviews);
          reviews.persistOpenClawAssistantCandidate = async (...args) => {
            await originalPersist(...args);
            throw new Error('Q1_AFTER_RECEIPT_ROLLBACK');
          };
          const persist = () =>
            hosted(() =>
              reviewService.persistJobAidCandidate(
                authorized,
                { ...candidate, jobAidWorkingDelta: proposal(true) },
                input(),
                fence,
                new Set(evidence.map((item) => item.evidenceRef)),
              ),
            );
          await assert.rejects(persist(), /Q1_AFTER_RECEIPT_ROLLBACK/u);
          assert.equal(
            (
              await sql`SELECT count(*)::int AS n FROM assessment_work_revision`
            )[0].n,
            1,
          );
          assert.equal(
            (
              await sql`SELECT count(*)::int AS n FROM engineering_search_projection_pending`
            )[0].n,
            1,
          );
          assert.equal(
            (
              await sql`SELECT assistant_response FROM review_turn WHERE review_turn_id='RT-q1'`
            )[0].assistant_response,
            null,
          );
          reviews.persistOpenClawAssistantCandidate = originalPersist;
          const beforeProjection = (
            await sql`SELECT projection_json FROM work_item WHERE work_item_id='WI-job'`
          )[0].projection_json;
          const invalidate = service.invalidateReviewOverall.bind(service);
          service.invalidateReviewOverall = async (...args) => {
            await invalidate(...args);
            throw new Error('Q1_AFTER_STALE_ROLLBACK');
          };
          await assert.rejects(persist(), /Q1_AFTER_STALE_ROLLBACK/u);
          assert.equal(
            (
              await sql`SELECT projection_json FROM work_item WHERE work_item_id='WI-job'`
            )[0].projection_json,
            beforeProjection,
          );
          assert.equal(
            (
              await sql`SELECT count(*)::int AS n FROM assessment_work_revision`
            )[0].n,
            1,
          );
          assert.equal(
            (
              await sql`SELECT assistant_response FROM review_turn WHERE review_turn_id='RT-q1'`
            )[0].assistant_response,
            null,
          );
          service.invalidateReviewOverall = invalidate;
          const first = await persist();
          const firstProjection = (
            await sql`SELECT projection_json,updated_at FROM work_item WHERE work_item_id='WI-job'`
          )[0];
          const replay = await persist();
          assert.equal(replay.replayed, true);
          assert.deepEqual(
            replay.turn.assistantCandidate.jobAidWorkingUpdate,
            first.turn.assistantCandidate.jobAidWorkingUpdate,
          );
          assert.deepEqual(
            (
              await sql`SELECT projection_json,updated_at FROM work_item WHERE work_item_id='WI-job'`
            )[0],
            firstProjection,
          );
          saved = await hosted(() => work.latestForRuntime(scope));
          assert.equal(saved.workRevision, 2);
          assert.equal(saved.previousWorkRevisionRef, baseline.workRevisionRef);
          assert.equal(
            saved.content.issues[0].issueRef,
            baseline.content.issues[0].issueRef,
          );
          assert.equal(
            saved.content.issues[0].body,
            proposal(true).issues[0].body,
          );
          assert.equal(
            saved.content.issues[0].question,
            proposal(true).issues[0].question,
          );
          assert.equal(saved.content.issues[0].riskScenarios[0].score, null);
          assert.equal(
            saved.content.issues[0].riskScenarios[0].riskGrade,
            null,
          );
          assert.deepEqual(saved.content.issues[0].sourceDependencies, [
            source.evidenceRef,
          ]);
          assert.deepEqual(
            saved.content.issues.find(
              (issue) => issue.issueKey === 'unrelated',
            ),
            baseline.content.issues.find(
              (issue) => issue.issueKey === 'unrelated',
            ),
          );
          await sql`UPDATE action_attempt SET status='SUCCEEDED' WHERE attempt_id=${reviewRow.attemptId}`;
        },
      );

      await t.test(
        'new service instances recover terminal Review and older save receipts without appending or moving latest',
        async () => {
          const coldWork = new JobAidWorkRepository(db, actors, projection);
          const coldReviews = new ReviewConversationRepository(db);
          const coldItem = await new MiaodaWorkItemRepository(
            db,
          ).loadTenantScopedProjection(scope.workItemId, scope.tenantId);
          assert.equal(
            coldItem.projection.integratedAssessment.overallSynthesis.status,
            'STALE',
          );
          assert.equal(
            coldItem.projection.integratedAssessment.overallSynthesis
              .basedOnJobAidWorkRevisionRef,
            baseline.workRevisionRef,
          );
          assert.equal((await rowById('ATT-old-overall')).status, 'SUCCEEDED');
          const historicalReceipt = await hosted(() =>
            coldWork.save(initialSaveArgs),
          );
          assert.equal(historicalReceipt.replayed, true);
          assert.deepEqual(historicalReceipt.revision, baseline);
          const binding = await hosted(() =>
            coldWork.withActorTransaction(scope.actorUserId, (database) =>
              coldReviews.loadOpenClawTurnByIdBinding(
                {
                  reviewConversationId: 'RC-q1',
                  reviewTurnId: 'RT-q1',
                  tenantId: scope.tenantId,
                  actorId: scope.actorUserId,
                  workItemId: scope.workItemId,
                },
                database,
              ),
            ),
          );
          const coldReviewService = new CanonicalHostOpenClawReviewService(
            coldReviews,
            workItems,
            {},
            {},
            attempts,
            artifactStore,
            {},
            {},
            common,
            undefined,
            actors,
            service,
          );
          const { completedAt: _completedAt, ...candidate } =
            binding.turn.assistantCandidate;
          const replay = await hosted(() =>
            coldReviewService.persistJobAidCandidate(
              {
                conversation: binding.conversation,
                turn: binding.turn,
                row: reviewRow,
                contract: { context: {}, jobAidContext: reviewTask },
              },
              binding.turn.assistantCandidate,
              {
                conversation: binding.conversation,
                turn: binding.turn,
                actionAttemptId: reviewRow.attemptId,
                candidate: structuredClone(candidate),
                completedAt: new Date(),
              },
              fence,
              new Set(evidence.map((item) => item.evidenceRef)),
            ),
          );
          assert.equal(replay.replayed, true);
          assert.equal(
            replay.turn.assistantCandidate.jobAidWorkingUpdate.workRevisionRef,
            saved.workRevisionRef,
          );
          assert.equal(
            (await hosted(() => coldWork.latestForRuntime(scope)))
              .workRevisionRef,
            saved.workRevisionRef,
          );
          assert.equal(
            (
              await sql`SELECT count(*)::int AS n FROM assessment_work_revision`
            )[0].n,
            2,
          );
        },
      );

      await t.test(
        'Overall admission rejects missing/conflicting receipts and cross-actor, WorkItem, attempt or source bindings',
        async () => {
          const item = await current();
          const [turn] =
            await sql`SELECT result_provenance_json FROM review_turn WHERE review_turn_id='RT-q1'`;
          const originalProvenance = JSON.parse(turn.result_provenance_json);
          const cases = [
            (value) => {
              delete value.jobAidWorkingUpdate;
            },
            (value) => {
              value.jobAidWorkingUpdate.status = 'UNCHANGED';
            },
            (value) => {
              value.jobAidWorkingUpdate.workRevisionRef =
                baseline.workRevisionRef;
            },
            (value) => {
              value.jobAidWorkingUpdate.workRevision = 1;
            },
            (value) => {
              value.actionAttemptRef = 'AQ-conflict';
            },
            (value) => {
              value.resultContentHash = 'f'.repeat(64);
            },
          ];
          // The normal append-only trigger rejects receipt edits. Corrupt-fixture
          // setup alone uses the disposable cluster owner and a transaction-local
          // replication setting; runtime admission still reads with actor RLS.
          await assert.rejects(
            sql`UPDATE review_turn SET result_provenance_json='{}' WHERE review_turn_id='RT-q1'`,
            /REVIEW_TURN_C2_CANDIDATE_APPEND_ONLY/u,
          );
          const corruptFixture = (mutate) =>
            sql.begin(async (fixtureSql) => {
              await fixtureSql`SET LOCAL session_replication_role='replica'`;
              await mutate(fixtureSql);
            });
          const before = (
            await sql`SELECT count(*)::int AS n FROM action_attempt`
          )[0].n;
          for (const mutate of cases) {
            const changed = structuredClone(originalProvenance);
            mutate(changed);
            try {
              await corruptFixture(
                (fixtureSql) =>
                  fixtureSql`UPDATE review_turn SET result_provenance_json=${JSON.stringify(changed)} WHERE review_turn_id='RT-q1'`,
              );
              await assert.rejects(
                hosted(() =>
                  service.enqueueOverall(item, scope.tenantId, 'q1'),
                ),
                /JOBAID_OVERALL_EXACT_WORK_REQUIRED|REVIEW_TURN_CANDIDATE_JSON_INVALID|REVIEW_TURN_CANDIDATE_PROVENANCE_MISMATCH/u,
              );
            } finally {
              await corruptFixture(
                (fixtureSql) =>
                  fixtureSql`UPDATE review_turn SET result_provenance_json=${turn.result_provenance_json} WHERE review_turn_id='RT-q1'`,
              );
            }
          }
          for (const change of ['actor', 'workItem', 'source', 'attempt']) {
            try {
              if (change === 'actor')
                await corruptFixture(
                  (fixtureSql) =>
                    fixtureSql`UPDATE action_attempt SET actor_user_id='actor-other' WHERE attempt_id=${reviewRow.attemptId}`,
                );
              if (change === 'workItem')
                await corruptFixture(
                  (fixtureSql) =>
                    fixtureSql`UPDATE review_turn SET work_item_id='WI-other' WHERE review_turn_id='RT-q1'`,
                );
              if (change === 'source')
                await corruptFixture(
                  (fixtureSql) =>
                    fixtureSql`UPDATE action_attempt SET document_version_id='dv-other' WHERE attempt_id=${reviewRow.attemptId}`,
                );
              if (change === 'attempt')
                await corruptFixture(
                  (fixtureSql) =>
                    fixtureSql`UPDATE review_turn SET action_attempt_id='ATT-other' WHERE review_turn_id='RT-q1'`,
                );
              await assert.rejects(
                hosted(() =>
                  service.enqueueOverall(item, scope.tenantId, 'q1'),
                ),
                /JOBAID_OVERALL_EXACT_WORK_REQUIRED/u,
              );
            } finally {
              await corruptFixture(
                (fixtureSql) =>
                  fixtureSql`UPDATE action_attempt SET actor_user_id=${scope.actorUserId},document_version_id='dv-job' WHERE attempt_id=${reviewRow.attemptId}`,
              );
              await corruptFixture(
                (fixtureSql) =>
                  fixtureSql`UPDATE review_turn SET work_item_id=${scope.workItemId},action_attempt_id=${reviewRow.attemptId} WHERE review_turn_id='RT-q1'`,
              );
            }
          }
          assert.equal(
            (await sql`SELECT count(*)::int AS n FROM action_attempt`)[0].n,
            before,
          );
          assert.equal(artifactWrites, 0);
        },
      );

      await t.test(
        'Review persists old Overall stale and admits only its exact saved receipt into Overall input',
        async () => {
          const actor = {
            tenantId: scope.tenantId,
            userId: scope.actorUserId,
            roles: [],
          };
          const read = await browser(() =>
            service.readBrowser(scope.workItemId, actor),
          );
          assert.equal(read.current.workRevisionRef, saved.workRevisionRef);
          assert.equal(read.overallStatus, 'STALE');
          assert.equal(
            read.overallBasedOnWorkRevisionRef,
            baseline.workRevisionRef,
          );
          const item = await current();
          assert.equal(
            item.integratedAssessment.baseRules.workRevisionRef,
            baseline.workRevisionRef,
          );
          assert.equal(
            item.integratedAssessment.overallSynthesis.status,
            'STALE',
          );
          assert.equal(
            item.integratedAssessment.overallSynthesis.staleReason,
            'BASE_RULE_RESULT_CHANGED',
          );
          assert.equal((await rowById('ATT-old-overall')).status, 'SUCCEEDED');
          assert.equal(item.revision, 1);
          assert.equal(item.aeo, null);
          assert.equal(
            item.integratedAssessment.overallForAeoConfirmation,
            null,
          );
          const before = (
            await sql`SELECT count(*)::int AS n FROM action_attempt`
          )[0].n;
          const queued = await hosted(() =>
            service.enqueueOverall(item, scope.tenantId, 'q1'),
          );
          const [reserved] =
            await sql`SELECT task_envelope_json,attempt_id FROM action_attempt WHERE operation_ref=${queued.attemptRef}`;
          const sealed = JSON.parse(reserved.task_envelope_json);
          assert.equal(
            sealed.modelInput.previousWork.workRevisionRef,
            saved.workRevisionRef,
          );
          assert.equal(sealed.modelInput.modelInput.expectedWorkRevision, 2);
          assert.equal(
            (await sql`SELECT count(*)::int AS n FROM action_attempt`)[0].n,
            before + 1,
          );
          assert.equal(artifactWrites, 0);
          await sql`UPDATE action_attempt SET status='CANCELLED' WHERE attempt_id=${reserved.attempt_id}`;
        },
      );

      await t.test(
        'a new request on the old working version is rejected while exact historical work remains readable',
        async () => {
          const staleRow = await seedAttempt(
            'ATT-q1-stale',
            'OPENCLAW_INTERACTIVE_REVIEW',
            'COMMITTING',
          );
          await assert.rejects(
            hosted(() =>
              work.withActorTransaction(scope.actorUserId, (database) =>
                service.saveReviewWork(
                  {
                    row: staleRow,
                    task: reviewTask,
                    fence,
                    requestId: 'review-turn:stale',
                    proposal: proposal(true),
                    actualReadRefs: new Set(
                      evidence.map((item) => item.evidenceRef),
                    ),
                  },
                  database,
                ),
              ),
            ),
            /JOBAID_WORK_REVISION_CONFLICT/u,
          );
          assert.deepEqual(
            await hosted(() =>
              work.readByRefForRuntime({
                ...scope,
                workRevisionRef: baseline.workRevisionRef,
              }),
            ),
            baseline,
          );
          assert.equal(
            (
              await sql`SELECT count(*)::int AS n FROM assessment_work_revision`
            )[0].n,
            2,
          );
          await sql`UPDATE action_attempt SET status='FAILED' WHERE attempt_id=${staleRow.attemptId}`;
        },
      );

      await t.test(
        'cancellation and lease generation changes reject late saves without losing the last accepted work',
        async () => {
          const row = await seedAttempt(
            'ATT-q1-cancel',
            'OPENCLAW_INTERACTIVE_REVIEW',
            'RUNNING',
          );
          const input = {
            row,
            actorUserId: scope.actorUserId,
            fence,
            sourceBindings,
            requestId: 'late-cancelled',
            expectedWorkRevision: 2,
            command: proposal(true),
            content: materializeJobAidWork(
              proposal(true),
              context(saved.content),
            ),
          };
          await sql`UPDATE action_attempt SET cancel_requested_at=now() WHERE attempt_id=${row.attemptId}`;
          await assert.rejects(
            hosted(() => work.save(input)),
            /JOBAID_WORK_LEASE_FENCE_REJECTED/u,
          );
          await sql`UPDATE action_attempt SET cancel_requested_at=null,lease_generation=2 WHERE attempt_id=${row.attemptId}`;
          await assert.rejects(
            hosted(() => work.save(input)),
            /JOBAID_WORK_LEASE_FENCE_REJECTED/u,
          );
          assert.equal(
            (await hosted(() => work.latestForRuntime(scope))).workRevisionRef,
            saved.workRevisionRef,
          );
          assert.equal(
            (
              await sql`SELECT count(*)::int AS n FROM assessment_work_revision`
            )[0].n,
            2,
          );
          await sql`UPDATE action_attempt SET status='CANCELLED' WHERE attempt_id=${row.attemptId}`;
        },
      );

      await t.test(
        'authenticated public request validates receipt, CAS and real reserve, reads exact key and replays once',
        async () => {
          const [actualSqlContext] = await browser(() =>
            db.execute(
              contextSql`SELECT current_user AS role, current_setting('app.user_id',true) AS actor`,
            ),
          );
          assert.equal(
            actualSqlContext.role,
            'authenticated_wiselink_jobaid_test',
          );
          assert.equal(actualSqlContext.actor, scope.actorUserId);
          const old = await current();
          publicRequest = {
            requestId: 'Q1-user-regen',
            expectedRevision: old.revision,
            sourceIdentity: {
              documentVersionId: old.source.documentVersionId,
              sourceArtifactId: old.source.sourceArtifactId,
              sourceFileSha256: old.source.sourceFileSha256,
              packageId: old.package.packageId,
              packageArtifactSha256: old.package.artifact.sha256,
            },
          };
          let casCalls = 0;
          publicRoute = new CanonicalHostOverallRegenerationService(
            {
              resolve: async () => ({
                actor: {
                  tenantId: scope.tenantId,
                  canonicalSubject: { id: scope.actorUserId },
                },
              }),
            },
            {
              freshRead: async () => {
                const item = await current();
                return {
                  allowed: true,
                  action: 'REQUEST_OVERALL_REGENERATION',
                  tenantId: scope.tenantId,
                  actorUserId: scope.actorUserId,
                  workItemId: scope.workItemId,
                  workItemRevision: item.revision,
                  requestId: item.requestId,
                  documentVersionId: item.source.documentVersionId,
                  authorizationFingerprint: 'q1',
                };
              },
            },
            {
              ...registrar,
              compareAndSet: async (input) => {
                casCalls++;
                return registrar.compareAndSet(input);
              },
            },
            { nowIso: () => '2026-10-02T00:00:00.000Z' },
            {
              enqueueUserRequestedRegeneration: async () => {
                throw new Error('UNEXPECTED_LEGACY_QUEUE');
              },
            },
            attempts,
            service,
          );
          await assert.rejects(
            service.reviewOverallRegenerationBinding({
              workItem: old,
              ...scope,
            }),
            /JOBAID_REQUEST_ACTOR_CONTEXT_REQUIRED/u,
          );
          await assert.rejects(
            inContext('actor-other', false, () =>
              service.reviewOverallRegenerationBinding({
                workItem: old,
                ...scope,
              }),
            ),
            /JOBAID_REQUEST_ACTOR_CONTEXT_REQUIRED/u,
          );
          await assert.rejects(
            browser(() =>
              service.reviewOverallRegenerationBinding({
                workItem: old,
                ...scope,
                tenantId: 'tenant-other',
              }),
            ),
            /JOBAID_OVERALL_EXACT_WORK_REQUIRED/u,
          );
          const before = (
            await sql`SELECT count(*)::int AS n FROM action_attempt`
          )[0].n;
          await assert.rejects(
            browser(() =>
              publicRoute.request(
                scope.workItemId,
                { ...publicRequest, expectedRevision: 99 },
                {},
              ),
            ),
            /WORK_ITEM_CAS_CONFLICT/u,
          );
          await assert.rejects(
            browser(() =>
              publicRoute.request(
                scope.workItemId,
                {
                  ...publicRequest,
                  sourceIdentity: {
                    ...publicRequest.sourceIdentity,
                    packageArtifactSha256: 'f'.repeat(64),
                  },
                },
                {},
              ),
            ),
            /OVERALL_REGENERATION_SOURCE_CHANGED/u,
          );
          // Request JSON cannot enable a context branch or bypass receipt verification.
          const [receipt] =
            await sql`SELECT result_provenance_json FROM review_turn WHERE review_turn_id='RT-q1'`;
          const malformed = JSON.parse(receipt.result_provenance_json);
          delete malformed.jobAidWorkingUpdate;
          const corruptFixture = (mutate) =>
            sql.begin(async (fixtureSql) => {
              await fixtureSql`SET LOCAL session_replication_role='replica'`;
              await mutate(fixtureSql);
            });
          try {
            await corruptFixture(
              (q) =>
                q`UPDATE review_turn SET result_provenance_json=${JSON.stringify(malformed)} WHERE review_turn_id='RT-q1'`,
            );
            await assert.rejects(
              browser(() =>
                publicRoute.request(
                  scope.workItemId,
                  { ...publicRequest, requestContext: true },
                  {},
                ),
              ),
              /JOBAID_OVERALL_EXACT_WORK_REQUIRED/u,
            );
          } finally {
            await corruptFixture(
              (q) =>
                q`UPDATE review_turn SET result_provenance_json=${receipt.result_provenance_json} WHERE review_turn_id='RT-q1'`,
            );
          }
          assert.equal(casCalls, 0);
          assert.deepEqual(await current(), old);
          // Simulate interruption after the Host request CAS and before queue.
          // A same-request retry must retain the exact marker and perform no new CAS.
          const enqueue = service.enqueueOverall.bind(service);
          service.enqueueOverall = async () => {
            throw new Error('Q1_QUEUE_INTERRUPTED_AFTER_CAS');
          };
          await assert.rejects(
            browser(() =>
              publicRoute.request(scope.workItemId, publicRequest, {}),
            ),
            /Q1_QUEUE_INTERRUPTED_AFTER_CAS/u,
          );
          assert.equal((await current()).revision, 2);
          assert.equal(casCalls, 1);
          service.enqueueOverall = enqueue;
          publicQueued = await browser(() =>
            publicRoute.request(scope.workItemId, publicRequest, {}),
          );
          assert.equal(publicQueued.replayed, true);
          assert.equal(publicQueued.regeneration.status, 'QUEUED');
          const item = await current();
          assert.equal(item.revision, 2);
          assert.deepEqual(item.overallRegenerationRequest.jobAidReviewWork, {
            workRevisionRef: saved.workRevisionRef,
            workRevision: 2,
          });
          assert.equal(
            item.overallRegenerationRequest.requestedFromRevision,
            1,
          );
          assert.equal(item.overallRegenerationRequest.executionRevision, 2);
          assert.equal(
            item.overallRegenerationRequest.requestedByUserId,
            scope.actorUserId,
          );
          assert.deepEqual(
            item.overallRegenerationRequest.sourceIdentity,
            publicRequest.sourceIdentity,
          );
          assert.equal(
            item.integratedAssessment.baseRules.workRevisionRef,
            baseline.workRevisionRef,
          );
          assert.equal((await rowById('ATT-old-overall')).status, 'SUCCEEDED');
          const key = overallUserRegenerationIdempotencyKey(
            scope.workItemId,
            2,
            publicRequest.requestId,
          );
          const row = await browser(() =>
            attempts.readExactIdempotency({
              tenantId: scope.tenantId,
              workItemId: scope.workItemId,
              taskType: 'OPENCLAW_OVERALL_SYNTHESIS',
              baseRevision: 2,
              documentVersionId: 'dv-job',
              idempotencyKey: key,
            }),
          );
          assert.equal(row.operationRef, publicQueued.regeneration.attemptRef);
          assert.equal(row.idempotencyKey, key);
          const sealed = JSON.parse(row.taskEnvelopeJson);
          assert.equal(
            sealed.modelInput.previousWork.workRevisionRef,
            saved.workRevisionRef,
          );
          assert.equal(sealed.modelInput.modelInput.expectedWorkRevision, 2);
          const replay = await browser(() =>
            publicRoute.request(scope.workItemId, publicRequest, {}),
          );
          assert.equal(replay.replayed, true);
          assert.equal(replay.regeneration.attemptRef, row.operationRef);
          assert.equal(casCalls, 1);
          assert.equal(
            (await sql`SELECT count(*)::int AS n FROM action_attempt`)[0].n,
            before + 1,
          );
          assert.equal(
            JSON.stringify(publicQueued).includes('jobAidReviewWork'),
            false,
          );
        },
      );

      await t.test(
        'post-CAS marker must match exact work, actor, source, package, old Overall and both formal versions',
        async () => {
          const item = await current();
          const before = (
            await sql`SELECT count(*)::int AS n FROM action_attempt`
          )[0].n;
          const cases = [
            (marker) => delete marker.jobAidReviewWork,
            (marker) => {
              marker.jobAidReviewWork.workRevisionRef =
                baseline.workRevisionRef;
            },
            (marker) => {
              marker.jobAidReviewWork.workRevision = 1;
            },
            (marker) => {
              marker.requestedFromRevision = 2;
            },
            (marker) => {
              marker.executionRevision = 99;
            },
            (marker) => {
              marker.requestedByUserId = 'actor-other';
            },
            (marker) => {
              marker.sourceIdentity.documentVersionId = 'dv-other';
            },
            (marker) => {
              marker.sourceIdentity.sourceArtifactId = 'source-other';
            },
            (marker) => {
              marker.sourceIdentity.sourceFileSha256 = 'f'.repeat(64);
            },
            (marker) => {
              marker.sourceIdentity.packageId = 'package-other';
            },
            (marker) => {
              marker.sourceIdentity.packageArtifactSha256 = 'f'.repeat(64);
            },
            (marker) => {
              marker.sourceOverall.actionAttemptId = 'ATT-other';
            },
            (marker) => {
              marker.sourceOverall.revision = 99;
            },
            (marker) => {
              marker.sourceOverall.artifactSha256 = 'f'.repeat(64);
            },
          ];
          for (const mutate of cases) {
            const changed = structuredClone(item);
            mutate(changed.overallRegenerationRequest);
            await assert.rejects(
              hosted(() =>
                service.enqueueOverall(changed, scope.tenantId, 'q1'),
              ),
              /JOBAID_OVERALL_EXACT_WORK_REQUIRED/u,
            );
          }
          assert.equal(
            (await sql`SELECT count(*)::int AS n FROM action_attempt`)[0].n,
            before,
          );
          assert.equal(artifactWrites, 0);
          assert.deepEqual(await current(), item);
        },
      );

      await t.test(
        'a later saved work after request CAS cannot be substituted for marker-bound work2',
        async () => {
          const item = await current();
          const row = await seedAttempt(
            'ATT-q1-after-request',
            'OPENCLAW_INTERACTIVE_REVIEW',
            'RUNNING',
            item.revision,
          );
          const next = await hosted(() =>
            work.save({
              row,
              actorUserId: scope.actorUserId,
              fence,
              sourceBindings,
              requestId: 'review-turn:RT-after-request',
              expectedWorkRevision: 2,
              command: proposal(true),
              content: materializeJobAidWork(
                proposal(true),
                context(saved.content),
              ),
            }),
          );
          assert.equal(next.revision.workRevision, 3);
          const before = (
            await sql`SELECT count(*)::int AS n FROM action_attempt`
          )[0].n;
          try {
            await assert.rejects(
              browser(() =>
                publicRoute.request(scope.workItemId, publicRequest, {}),
              ),
              /JOBAID_OVERALL_EXACT_WORK_REQUIRED/u,
            );
            await assert.rejects(
              hosted(() => service.enqueueOverall(item, scope.tenantId, 'q1')),
              /JOBAID_OVERALL_EXACT_WORK_REQUIRED/u,
            );
            const queuedBefore = await hosted(() =>
              attempts.readScoped({
                attemptRef: publicQueued.regeneration.attemptRef,
                tenantId: scope.tenantId,
                workItemId: scope.workItemId,
              }),
            );
            await assert.rejects(
              hosted(() =>
                service.begin(
                  item,
                  {
                    ...scope,
                    principalId: fence.principalId,
                    authorizationFingerprint: 'q1',
                  },
                  'OVERALL_CONSISTENCY',
                ),
              ),
              /JOBAID_OVERALL_EXACT_WORK_REQUIRED/u,
            );
            const queuedAfter = await hosted(() =>
              attempts.readScoped({
                attemptRef: publicQueued.regeneration.attemptRef,
                tenantId: scope.tenantId,
                workItemId: scope.workItemId,
              }),
            );
            assert.equal(queuedAfter.status, 'QUEUED');
            assert.equal(queuedAfter.claimCount, queuedBefore.claimCount);
            assert.equal(
              (await sql`SELECT count(*)::int AS n FROM action_attempt`)[0].n,
              before,
            );
            assert.deepEqual(await current(), item);
          } finally {
            // Dedicated test-owner teardown only; production never deletes work.
            await sql`DELETE FROM engineering_search_projection_pending WHERE exact_revision_ref=${next.revision.workRevisionRef}`;
            await sql`DELETE FROM assessment_work_revision WHERE assessment_work_revision_id=${next.revision.workRevisionRef}`;
            await sql`UPDATE action_attempt SET status='CANCELLED' WHERE attempt_id=${row.attemptId}`;
          }
        },
      );

      await t.test(
        'Overall public commit uses the exact corrected work and reconciles a lost terminal response after CAS',
        async () => {
          // A sealed deterministic fixture tests public commit independently of
          // queue transport; the preceding test covers real queue admission.
          const item = await current();
          const begun = await hosted(() =>
            service.begin(
              item,
              {
                ...scope,
                principalId: fence.principalId,
                authorizationFingerprint: 'q1',
              },
              'OVERALL_CONSISTENCY',
            ),
          );
          const task = begun.task;
          const row = await rowById(task.actionAttemptId);
          assert.equal(task.baseRevision, 2);
          assert.equal(task.operationRef, publicQueued.regeneration.attemptRef);
          assert.equal(
            task.modelInput.previousWork.workRevisionRef,
            saved.workRevisionRef,
          );
          const result = sealResultEnvelope({
            schemaVersion: 'wiselink.3_1.openclaw_result_envelope.v1',
            actionAttemptId: task.actionAttemptId,
            operationRef: task.operationRef,
            taskType: task.taskType,
            workItemId: task.workItemId,
            baseRevision: task.baseRevision,
            status: 'SUCCEEDED',
            businessOutcome: 'CANDIDATE_READY',
            candidateStatus: null,
            modelOutput: JSON.stringify({
              workRevisionRef: saved.workRevisionRef,
              consistencyCheck: source.excerpt,
            }),
            outputArtifactRefs: [],
            sourceRefs: task.sourceRefs,
            factsConsidered: [],
            missingInputs: [],
            conflicts: [],
            warnings: [],
            modelVersion: 'q1-constructed-not-called',
            promptVersion: 'wiselink-jobaid-problem@v2',
            skillVersion: 'wiselink-research-and-synthesize@r09.c43',
            toolVersions: {
              'jobaid-problem-protocol': '2',
              'wiselink-openclaw-engineering-assessment': '1.2.0',
            },
            runMetrics: { durationMs: 0, inputUnits: 0, outputUnits: 0 },
            errorCode: null,
            errorDetail: null,
          });
          const args = async () => ({
            row: await rowById(row.attemptId),
            scope: {
              ...scope,
              principalId: fence.principalId,
              attemptRef: row.operationRef,
            },
            leaseToken: begun.leaseToken,
            leaseGeneration: begun.leaseGeneration,
            result,
          });
          const finish = attempts.finishProjectionSuccess.bind(attempts);
          attempts.finishProjectionSuccess = async () => {
            throw new Error('Q1_LOST_TERMINAL_RESPONSE');
          };
          await assert.rejects(
            hosted(async () => service.commit(await args())),
            /Q1_LOST_TERMINAL_RESPONSE/u,
          );
          const afterCas = await current();
          assert.equal(afterCas.revision, 3);
          assert.equal(
            afterCas.integratedAssessment.overallSynthesis
              .basedOnJobAidWorkRevisionRef,
            saved.workRevisionRef,
          );
          assert.equal(
            afterCas.integratedAssessment.baseRules.workRevisionRef,
            saved.workRevisionRef,
          );
          assert.equal(
            afterCas.integratedAssessment.baseRules.workRevision,
            saved.workRevision,
          );
          assert.equal((await rowById(row.attemptId)).status, 'COMMITTING');
          const writesAfterCas = artifactWrites;
          attempts.finishProjectionSuccess = finish;
          const recovered = await hosted(async () =>
            service.commit(await args()),
          );
          assert.equal(
            recovered.overallSynthesis.basedOnJobAidWorkRevisionRef,
            saved.workRevisionRef,
          );
          assert.equal((await rowById(row.attemptId)).status, 'SUCCEEDED');
          await hosted(async () => service.commit(await args()));
          assert.equal((await current()).revision, 3);
          assert.equal(artifactWrites, writesAfterCas);
          const read = await browser(() =>
            service.readBrowser(scope.workItemId, {
              tenantId: scope.tenantId,
              userId: scope.actorUserId,
              roles: [],
            }),
          );
          assert.equal(read.overallStatus, 'CURRENT');
          assert.equal(
            read.overallBasedOnWorkRevisionRef,
            saved.workRevisionRef,
          );
          assert.deepEqual(read.current.content, saved.content);
        },
      );

      await t.test(
        'public Overall commit rejects an older saved ref without changing the corrected projection',
        async () => {
          const item = await current();
          const row = await seedAttempt(
            'ATT-q1-old-overall',
            'OPENCLAW_OVERALL_SYNTHESIS',
            'RUNNING',
            item.revision,
          );
          const taskInput = buildJobAidProblemTask({
            workItem: item,
            actorUserId: scope.actorUserId,
            permissionSnapshotVersion: 'q1',
            purpose: 'OVERALL_CONSISTENCY',
            sourceCatalog: evidence,
            sourceBindings,
            common: (await common.buildForWorkItemWithEvidence(item)).common,
            previousWork: saved,
            expectedWorkRevision: 2,
            priorAssessmentRefs: [
              saved.workRevisionRef,
              baseline.workRevisionRef,
            ],
          });
          const task = sealTaskEnvelope({
            schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
            actionAttemptId: row.attemptId,
            operationRef: row.operationRef,
            taskType: row.actionType,
            priority: 100,
            tenantId: scope.tenantId,
            workItemId: scope.workItemId,
            inputRevision: item.revision,
            baseRevision: item.revision,
            documentVersionId: 'dv-job',
            sourceRefs: [
              {
                ref: sourceBindings[0].artifactRef,
                sha256: sourceBindings[0].artifactSha256,
              },
            ],
            allowedConnectors: [],
            hostResolvedMissingInputs: [],
            modelInput: taskInput,
            deadline: row.deadlineAt.toISOString(),
            idempotencyKey: 'q1:overall:obsolete',
          });
          await sql`UPDATE action_attempt SET task_envelope_json=${canonicalJson(task)},task_input_hash=${task.inputHash},
            idempotency_key=${task.idempotencyKey} WHERE attempt_id=${row.attemptId}`;
          const result = sealResultEnvelope({
            schemaVersion: 'wiselink.3_1.openclaw_result_envelope.v1',
            actionAttemptId: row.attemptId,
            operationRef: row.operationRef,
            taskType: row.actionType,
            workItemId: scope.workItemId,
            baseRevision: item.revision,
            status: 'SUCCEEDED',
            businessOutcome: 'CANDIDATE_READY',
            candidateStatus: null,
            modelOutput: JSON.stringify({
              workRevisionRef: baseline.workRevisionRef,
              consistencyCheck: source.excerpt,
            }),
            outputArtifactRefs: [],
            sourceRefs: task.sourceRefs,
            factsConsidered: [],
            missingInputs: [],
            conflicts: [],
            warnings: [],
            modelVersion: 'q1-constructed-not-called',
            promptVersion: 'wiselink-jobaid-problem@v2',
            skillVersion: 'wiselink-research-and-synthesize@r09.c43',
            toolVersions: {
              'jobaid-problem-protocol': '2',
              'wiselink-openclaw-engineering-assessment': '1.2.0',
            },
            runMetrics: { durationMs: 0, inputUnits: 0, outputUnits: 0 },
            errorCode: null,
            errorDetail: null,
          });
          const writes = artifactWrites;
          const terminal = await hosted(async () =>
            service.commit({
              row: await rowById(row.attemptId),
              scope: {
                ...scope,
                principalId: fence.principalId,
                attemptRef: row.operationRef,
              },
              leaseToken: fence.leaseToken,
              leaseGeneration: 1,
              result,
            }),
          );
          assert.equal(terminal.status, 'FAILED');
          assert.match(
            String((await rowById(row.attemptId)).errorCode),
            /JOBAID_COMPLETED_WORK_REQUIRED/u,
          );
          assert.deepEqual(await current(), item);
          assert.equal(artifactWrites, writes);
        },
      );

      await t.test(
        'legacy model schema is rejected; historical rows remain exact and workItem change fences late saves',
        async () => {
          assert.throws(
            () =>
              materializeJobAidWork(
                {
                  ...proposal(true),
                  schemaVersion: 'wiselink.jobaid-problem-work.v2',
                },
                context(saved.content),
              ),
            /JOBAID_SCHEMA/u,
          );
          const row = await seedAttempt(
            'ATT-q1-late',
            'OPENCLAW_INTERACTIVE_REVIEW',
            'COMMITTING',
          );
          await assert.rejects(
            hosted(() =>
              work.withActorTransaction(scope.actorUserId, (database) =>
                service.saveReviewWork(
                  {
                    row,
                    task: {
                      ...reviewTask,
                      modelInput: {
                        ...reviewTask.modelInput,
                        expectedWorkRevision: 2,
                      },
                      previousWork: saved,
                    },
                    fence,
                    requestId: 'review-turn:late',
                    proposal: proposal(true),
                    actualReadRefs: new Set(
                      evidence.map((item) => item.evidenceRef),
                    ),
                  },
                  database,
                ),
              ),
            ),
            /JOBAID_SAVE_WORK_ITEM_CHANGED/u,
          );
          assert.deepEqual(
            await hosted(() =>
              work.readByRefForRuntime({
                ...scope,
                workRevisionRef: baseline.workRevisionRef,
              }),
            ),
            baseline,
          );
          assert.equal(
            (
              await sql`SELECT count(*)::int AS n FROM assessment_work_revision`
            )[0].n,
            2,
          );
          await sql`UPDATE action_attempt SET status='CANCELLED' WHERE attempt_id=${row.attemptId}`;
        },
      );
      await t.test(
        'a later work with a review-turn prefix and no exact receipt cannot reuse an older matching receipt',
        async () => {
          const item = await current();
          const row = await seedAttempt(
            'ATT-q1-unmatched',
            'OPENCLAW_INTERACTIVE_REVIEW',
            'RUNNING',
            item.revision,
          );
          const next = await hosted(() =>
            work.save({
              row,
              actorUserId: scope.actorUserId,
              fence,
              sourceBindings,
              requestId: 'review-turn:RT-q1-unmatched',
              expectedWorkRevision: 2,
              command: proposal(true),
              content: materializeJobAidWork(
                proposal(true),
                context(saved.content),
              ),
            }),
          );
          assert.equal(next.revision.workRevision, 3);
          const before = (
            await sql`SELECT count(*)::int AS n FROM action_attempt`
          )[0].n;
          const writes = artifactWrites;
          await assert.rejects(
            hosted(() => service.enqueueOverall(item, scope.tenantId, 'q1')),
            /JOBAID_OVERALL_EXACT_WORK_REQUIRED/u,
          );
          assert.equal(
            (await sql`SELECT count(*)::int AS n FROM action_attempt`)[0].n,
            before,
          );
          assert.equal(artifactWrites, writes);
          assert.equal(
            (await current()).integratedAssessment.baseRules.workRevisionRef,
            saved.workRevisionRef,
          );
          assert.equal(
            (
              await hosted(() =>
                work.readByRefForRuntime({
                  ...scope,
                  workRevisionRef: saved.workRevisionRef,
                }),
              )
            ).workRevision,
            2,
          );
          await sql`UPDATE action_attempt SET status='CANCELLED' WHERE attempt_id=${row.attemptId}`;
        },
      );
      await t.test(
        'a subsequent authenticated Review request binds new receipt and does not inherit an obsolete regeneration marker',
        async () => {
          const item = await current();
          assert.equal(item.revision, 3);
          const previous = await hosted(() => work.latestForRuntime(scope));
          assert.equal(previous.workRevision, 3);
          let row = await seedAttempt(
            'ATT-q1-second-review',
            'OPENCLAW_INTERACTIVE_REVIEW',
            'COMMITTING',
            item.revision,
          );
          await sql`UPDATE action_attempt SET result_content_hash=${'d'.repeat(64)} WHERE attempt_id=${row.attemptId}`;
          await sql`UPDATE review_conversation SET last_synced_revision=3 WHERE review_conversation_id='RC-q1'`;
          await sql`INSERT INTO review_turn(review_turn_id,review_conversation_id,engineer_supplied_input_id,tenant_id,actor_id,work_item_id,
            turn_no,request_id,input_revision,user_message,input_type,adoption_status,created_at)
            VALUES ('RT-q1-second','RC-q1','ESI-q1-second','tenant-job','actor-job','WI-job',2,'request-q1-second',3,
              'Retain the checked inspection limitation.','ENGINEER_TEXT','CANDIDATE_UNADOPTED',now())`;
          const taskInput = buildJobAidProblemTask({
            workItem: item,
            actorUserId: scope.actorUserId,
            permissionSnapshotVersion: 'q1',
            purpose: 'PROBLEM_REVIEW',
            sourceCatalog: evidence,
            sourceBindings,
            common: (await common.buildForWorkItemWithEvidence(item)).common,
            previousWork: previous,
            expectedWorkRevision: 3,
            priorAssessmentRefs: [
              previous.workRevisionRef,
              saved.workRevisionRef,
            ],
          });
          const task = sealTaskEnvelope({
            schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
            actionAttemptId: row.attemptId,
            operationRef: row.operationRef,
            taskType: row.actionType,
            priority: 100,
            tenantId: scope.tenantId,
            workItemId: scope.workItemId,
            inputRevision: 3,
            baseRevision: 3,
            documentVersionId: 'dv-job',
            sourceRefs: [
              {
                ref: sourceBindings[0].artifactRef,
                sha256: sourceBindings[0].artifactSha256,
              },
            ],
            allowedConnectors: [],
            hostResolvedMissingInputs: [],
            modelInput: { jobAidContext: taskInput },
            deadline: row.deadlineAt.toISOString(),
            idempotencyKey: 'q1:review:second',
          });
          await sql`UPDATE action_attempt SET task_envelope_json=${canonicalJson(task)},task_input_hash=${task.inputHash} WHERE attempt_id=${row.attemptId}`;
          row = await rowById(row.attemptId);
          const binding = await hosted(() =>
            work.withActorTransaction(scope.actorUserId, (database) =>
              reviews.loadOpenClawTurnByIdBinding(
                {
                  reviewConversationId: 'RC-q1',
                  reviewTurnId: 'RT-q1-second',
                  tenantId: scope.tenantId,
                  actorId: scope.actorUserId,
                  workItemId: scope.workItemId,
                },
                database,
              ),
            ),
          );
          const first = await hosted(() =>
            work.withActorTransaction(scope.actorUserId, (database) =>
              reviews.loadOpenClawTurnByIdBinding(
                {
                  reviewConversationId: 'RC-q1',
                  reviewTurnId: 'RT-q1',
                  tenantId: scope.tenantId,
                  actorId: scope.actorUserId,
                  workItemId: scope.workItemId,
                },
                database,
              ),
            ),
          );
          const {
            completedAt: _completedAt,
            jobAidWorkingUpdate: _receipt,
            ...candidate
          } = first.turn.assistantCandidate;
          candidate.actionAttemptRef = row.operationRef;
          await hosted(() =>
            reviewService.persistJobAidCandidate(
              {
                conversation: binding.conversation,
                turn: binding.turn,
                row,
                contract: { context: {}, jobAidContext: taskInput },
              },
              { ...candidate, jobAidWorkingDelta: proposal(true) },
              {
                conversation: binding.conversation,
                turn: binding.turn,
                actionAttemptId: row.attemptId,
                candidate: structuredClone(candidate),
                completedAt: new Date(),
              },
              fence,
              new Set(evidence.map((value) => value.evidenceRef)),
            ),
          );
          await sql`UPDATE action_attempt SET status='SUCCEEDED' WHERE attempt_id=${row.attemptId}`;
          const reviewed = await current();
          const next = await hosted(() => work.latestForRuntime(scope));
          assert.equal(next.workRevision, 4);
          assert.equal(
            reviewed.integratedAssessment.overallSynthesis.staleReason,
            'BASE_RULE_RESULT_CHANGED',
          );
          assert.equal(
            reviewed.overallRegenerationRequest.executionRevision,
            2,
          );
          const request = {
            ...publicRequest,
            requestId: 'Q1-second-user-regen',
            expectedRevision: 3,
          };
          const response = await browser(() =>
            publicRoute.request(scope.workItemId, request, {}),
          );
          const updated = await current();
          assert.equal(updated.revision, 4);
          assert.equal(
            updated.overallRegenerationRequest.requestedFromRevision,
            3,
          );
          assert.equal(updated.overallRegenerationRequest.executionRevision, 4);
          assert.deepEqual(
            updated.overallRegenerationRequest.jobAidReviewWork,
            { workRevisionRef: next.workRevisionRef, workRevision: 4 },
          );
          const [queued] =
            await sql`SELECT task_envelope_json,attempt_id FROM action_attempt WHERE operation_ref=${response.regeneration.attemptRef}`;
          assert.equal(
            JSON.parse(queued.task_envelope_json).modelInput.previousWork
              .workRevisionRef,
            next.workRevisionRef,
          );
          assert.equal(
            updated.integratedAssessment.baseRules.workRevisionRef,
            saved.workRevisionRef,
          );
          await sql`UPDATE action_attempt SET status='CANCELLED' WHERE attempt_id=${queued.attempt_id}`;
        },
      );
    } finally {
      await sql.end();
    }
  },
);
