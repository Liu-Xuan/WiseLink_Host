import assert from 'node:assert/strict';
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
const { SqlExecutionContextMiddleware } =
  require('@lark-apaas/fullstack-nestjs-core');
const { MiaodaWorkItemRepository } =
  require('../../server/modules/work-item/miaoda-work-item.repository.ts');
const { CanonicalHostReviewOverallProjectionRepository } =
  require('../../server/modules/canonical-host/canonical-host-review-overall-projection.repository.ts');
const { resetQ1Database, initialProjection } =
  await import('./helpers/q1-review-postgres.fixture.mjs');

const databaseUrl = process.env.JOBAID_WORK_TEST_DATABASE_URL;
test('Review Overall execution and projection are one actor-scoped transaction',
  { skip: !databaseUrl, concurrency: false }, async () => {
    const url = new URL(databaseUrl);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.match(url.pathname, /^\/wiselink_jobaid_test_q1_[a-z0-9_]+$/u);
    const sql = postgres(databaseUrl, { max: 4, onnotice() {} });
    try {
      await resetQ1Database(sql);
      const db = drizzle(sql);
      const context = new SqlExecutionContextMiddleware({
        roleSchema: 'wiselink_jobaid_test',
      });
      const browser = (actorUserId, callback) =>
        new Promise((resolve, reject) => context.use({
          userContext: { userId: actorUserId, isSystemAccount: false, roles: [] },
        }, {}, () => Promise.resolve().then(callback).then(resolve, reject)));
      const workItems = new MiaodaWorkItemRepository(db);
      const executions = new CanonicalHostReviewOverallProjectionRepository(db);
      const projection = { ...initialProjection('WI-review-overall'), revision: 8 };
      await sql`INSERT INTO identity_subject_mapping(miaoda_user_id,miaoda_tenant_id,expected_client_id,status)
        VALUES ('actor-job','tenant-job','cli_aadde8b579f95bc9','ACTIVE')`;
      await sql`INSERT INTO work_item(work_item_id,tenant_id,requested_by_user_id,revision,document_version_id,projection_json)
        VALUES ('WI-review-overall','tenant-job','actor-job',8,'dv-job',${JSON.stringify(projection)})`;
      await sql`INSERT INTO action_attempt(attempt_id,work_item_id,tenant_id,actor_user_id,action_type,request_origin,status,
        document_version_id,base_revision,trigger_request_id,attempt_no)
        VALUES ('ATT-source-review','WI-review-overall','tenant-job','actor-job',
          'OPENCLAW_INTERACTIVE_REVIEW','OPENCLAW_MCP_V1','SUCCEEDED','dv-job',8,'source-review',1)`;
      await sql`INSERT INTO assessment_work_revision(assessment_work_revision_id,tenant_id,work_item_id,work_revision,
        request_id,action_attempt_id,based_on_work_item_revision,document_version_id,command_json,content_json,created_by_user_id)
        VALUES ('JAWR-review-overall','tenant-job','WI-review-overall',16,
          'review-turn:RT-review','ATT-source-review',8,'dv-job','{}','{}','actor-job')`;
      const request = (requestId, revision) => ({
        requestId, expectedRevision: revision,
        reviewConversationId: 'RC-review',
        reviewTurnId: 'RT-review',
        workRevisionRef: 'JAWR-review-overall',
        expectedWorkRevision: 16,
        sourceIdentity: {
          documentVersionId: 'dv-job',
          sourceArtifactId: 'ART-TEST',
          sourceFileSha256: 'a'.repeat(64),
          packageId: 'PKG-WI-review-overall',
          packageArtifactSha256: 'a'.repeat(64),
        },
      });
      const artifact = { ref: 'artifact://review-overall',
        sha256: 'b'.repeat(64), byteLength: 100,
        storeRole: 'U0_PARSED_PACKAGE', mediaType: 'application/json' };
      const commit = (requestId, expectedRevision, failAfterInsert = false) =>
        browser('actor-job', async () => {
          const input = request(requestId, expectedRevision);
          const identity = { tenantId: 'tenant-job', actorUserId: 'actor-job',
            workItemId: 'WI-review-overall', requestId };
          return workItems.withLockedReviewOverallProjection({
            ...identity,
            expectedRevision,
            workRevisionRef: 'JAWR-review-overall',
            documentVersionId: 'dv-job',
          }, async (database, current) => {
            const receipt = {
              executionKind: 'DETERMINISTIC_PROJECTION',
              modelRequests: 0,
              requestId,
              executionAttemptId: executions.attemptId(identity),
              status: 'SUCCEEDED',
              replayed: false,
              workItemRevision: current.revision + 1,
              overallRevision: current.revision,
              basedOnJobAidWorkRevisionRef: 'JAWR-review-overall',
              artifact,
            };
            await executions.insert({
              database,
              tenantId: 'tenant-job', actorUserId: 'actor-job',
              workItemId: 'WI-review-overall',
              documentVersionId: 'dv-job',
              request: input, receipt,
              checks: {
                sourceReceiptMatched: true, latestWorkMatched: true,
                workItemRevisionMatched: current.revision === expectedRevision,
                sourceBindingsReauthorized: true,
                documentVersionAndParseMatched: true,
                fullV3ReadingConstructed: true,
                overviewCurrent: true,
                completionNotInProgress: true,
              },
            });
            if (failAfterInsert) throw new Error('AFTER_INSERT_ROLLBACK');
            const { revision: _revision, ...next } = current;
            return { next: { ...next, phase: 'CANDIDATE_READBACK_VERIFIED' },
              value: receipt };
          });
        });

      const first = await commit('REQ-1', 8);
      assert.equal(first.saved.revision, 9);
      assert.equal((await sql`SELECT revision FROM work_item WHERE work_item_id='WI-review-overall'`)[0].revision, 9);
      const stored = await browser('actor-job', () => executions.read({
        tenantId: 'tenant-job', actorUserId: 'actor-job',
        workItemId: 'WI-review-overall', requestId: 'REQ-1',
      }));
      assert.equal(stored.receipt.executionAttemptId,
        first.value.executionAttemptId);
      const [row] = await sql`SELECT status,request_origin,task_envelope_json,
        result_envelope_json,execution_model_json,projection_applied
        FROM action_attempt WHERE attempt_id=${first.value.executionAttemptId}`;
      assert.deepEqual([row.status, row.request_origin, row.task_envelope_json,
        row.result_envelope_json, row.execution_model_json, row.projection_applied],
      ['SUCCEEDED', 'HOST_BROWSER_PROJECTION', null, null, null, true]);

      await assert.rejects(commit('REQ-stale', 8), /WORK_ITEM_CAS_CONFLICT/u);
      await assert.rejects(commit('REQ-rollback', 9, true), /AFTER_INSERT_ROLLBACK/u);
      assert.equal((await sql`SELECT revision FROM work_item WHERE work_item_id='WI-review-overall'`)[0].revision, 9);
      assert.equal((await sql`SELECT count(*)::int AS count FROM action_attempt
        WHERE trigger_request_id='REQ-rollback'`)[0].count, 0);
      const race = await Promise.allSettled([
        commit('REQ-race-a', 9),
        commit('REQ-race-b', 9),
      ]);
      assert.deepEqual(race.map((result) => result.status).sort(),
        ['fulfilled', 'rejected']);
      assert.equal((await sql`SELECT revision FROM work_item WHERE work_item_id='WI-review-overall'`)[0].revision, 10);
      assert.equal((await sql`SELECT count(*)::int AS count FROM action_attempt
        WHERE trigger_request_id IN ('REQ-race-a','REQ-race-b')`)[0].count, 1);
      await assert.rejects(
        browser('actor-other', () => workItems.withLockedReviewOverallProjection({
          tenantId: 'tenant-job', actorUserId: 'actor-other',
          workItemId: 'WI-review-overall', expectedRevision: 10,
          workRevisionRef: 'JAWR-review-overall', documentVersionId: 'dv-job',
        }, async () => { throw new Error('ACTOR_SHOULD_NOT_ENTER'); })),
        /WORK_ITEM_CAS_CONFLICT/u,
      );
    } finally {
      await sql.end();
    }
  });
