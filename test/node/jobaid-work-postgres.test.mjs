import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import postgres from 'postgres';

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'node',
});
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const { eq } = require('drizzle-orm');
const { getTableConfig } = require('drizzle-orm/pg-core');
const {
  SqlExecutionContextMiddleware,
} = require('@lark-apaas/fullstack-nestjs-core');
const { workItem, actionAttempt } = require('../../server/database/schema.ts');
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
  materializeJobAidWork,
} = require('../../server/modules/canonical-host/jobaid-problem-work.ts');
const {
  JOBAID_METHOD_EVIDENCE,
} = require('../../server/modules/canonical-host/jobaid-method-pack.ts');

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
    try {
      await reset(sql);
      const db = drizzle(sql);
      const sqlContext = new SqlExecutionContextMiddleware({
        roleSchema: 'wiselink_jobaid_test',
      });
      const actors = new EngineeringMatterWorkingRepository(db, sqlContext, {
        roleSchema: 'wiselink_jobaid_test',
      });
      const repository = new JobAidWorkRepository(db, actors);
      const reviews = new ReviewConversationRepository(db);
      const hosted = (callback) =>
        new Promise((resolve, reject) =>
          sqlContext.use(
            { userContext: { userId: '-1', isSystemAccount: true, roles: [] } },
            {},
            () => Promise.resolve().then(callback).then(resolve, reject),
          ),
        );
      await seed(sql);
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

      await t.test(
        'actual Hosted actor scope hides work from another actor or tenant and rejects changed source',
        async () => {
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
            await tx.unsafe('SET LOCAL ROLE authenticated');
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
        },
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
);

async function reset(sql) {
  await sql.unsafe(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
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
    VALUES ('WI-job','tenant-job','actor-job',1,'dv-job',${JSON.stringify({ package: { artifact: { ref: sourceBindings[0].artifactRef, sha256: hash } } })})`;
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
