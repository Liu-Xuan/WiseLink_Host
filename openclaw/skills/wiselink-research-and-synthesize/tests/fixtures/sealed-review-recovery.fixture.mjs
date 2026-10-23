import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { consumePendingReviewTurn } from '../../scripts/consume-hosted-review-turn.mjs';
import { WISELINK_SKILL_VERSION, WISELINK_HOST_MCP_NAME, WISELINK_HOST_MCP_VERSION } from '../../scripts/validate-payload.mjs';
import { freshPacket, plain, reviewEnvelope, reviewOutput, reviewRuntimeFixture } from './tdms-review-runtime.fixture.mjs';

// Exercise the actual consumer/driver checkpoints. Only the MCP transport and
// model are doubles; READ packets use the existing exact runtime fixture.
export async function sealedReviewPipeline(t, { unchanged = false, review = reviewRuntimeFixture(), reads } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'wiselink-sealed-review-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const task = reviewEnvelope(review), calls = [], journal = new Set();
  const state = { status: 'RUNNING', result: null, model: 0, commits: 0, workWrites: 0,
    commitMode: 'ROLLBACK', receipt: null, alterBegin: null, alterStatus: null, alterReceipt: null };
  const begin = () => ({ status: state.result ? 'COMMITTING' : 'RUNNING', attemptRef: task.operationRef,
    task: structuredClone(task), leaseToken: 'synthetic-current-lease', leaseGeneration: 2,
    leaseExpiresAt: '2026-01-01T00:00:00Z',
    ...(state.result ? { recoveryResult: structuredClone(state.result) } : {}) });
  const status = () => ({ attemptRef: task.operationRef, taskType: task.taskType, status: state.status,
    recoveryAvailable: state.status === 'COMMITTING', projectionApplied: false,
    commitStartedAt: state.result ? '2026-10-23T00:00:00Z' : null,
    terminalReason: state.status === 'SUCCEEDED' ? 'REVIEW_TURN_CANDIDATE_PERSISTED' : null,
    resultContentHash: state.result?.contentHash ?? null,
    ...(state.status === 'COMMITTING' ? { recoveryResult: structuredClone(state.result) } : {}) });
  const receipt = () => ({ schemaVersion: 'wiselink.3_1.review_turn_commit.v1.c2',
    attemptRef: task.operationRef, status: 'SUCCEEDED',
    authority: { candidatePersisted: true, reviewActionExecuted: false,
      workItemRevisionChanged: false, currentChanged: false, staleMarked: !unchanged },
    assistantCandidate: { actionAttemptRef: task.operationRef,
      provenance: { resultContentHash: state.result.contentHash }, jobAidWorkingUpdate: {
        status: unchanged ? 'UNCHANGED' : 'APPLIED', workRevisionRef: unchanged ? 'saved-work-3' : 'saved-work-4',
        workRevision: unchanged ? 3 : 4, affectedIssueKeys: unchanged ? [] : ['bounded-native-review'],
        readSourceRefs: [...journal] } } });
  const callTool = async (name, args) => {
    calls.push({ name, args: structuredClone(args) });
    assert.equal(args.workItemId, task.workItemId, `${name}: consumer scopes the actual transport`);
    if (name === 'get_pending_review_turn') return { busy: false, next: {
      reviewConversationRef: review.reviewConversationRef, reviewTurnRef: review.reviewTurnRef,
      requestId: review.requestId } };
    if (name === 'begin_review_turn') {
      const value = begin(); state.alterBegin?.(value); return value;
    }
    if (name === 'get_review_turn_context') return {
      schemaVersion: 'wiselink.3_1.review_turn_context.v1.c2', attemptRef: task.operationRef,
      reviewConversationRef: review.reviewConversationRef, reviewTurnRef: review.reviewTurnRef,
      mode: 'INTERACTIVE_REVIEW', selectedEvaluationItemId: null, inputRevision: review.inputRevision,
      allowedOperations: review.allowedOperations, executionPolicy: review.executionPolicy,
      context: structuredClone(review.context), resourceRefs: review.resourceRefs.map(
        ({ sourceRefId, resourceArtifactRef, resourceArtifactSha256 }) => ({ sourceRefId, resourceArtifactRef, resourceArtifactSha256 })) };
    if (name === 'heartbeat_action_attempt') return { leaseExpiresAt: '2099-01-01T00:00:00Z' };
    if (name === 'read_review_native_sources') {
      const packet = freshPacket(review, args.sourceRefs);
      args.sourceRefs.forEach(ref => journal.add(ref)); return packet;
    }
    if (name === 'read_source_refs') {
      args.sourceRefIds.forEach(ref => journal.add(ref));
      return { schemaVersion: 'wiselink.3_1.review_source_refs.v1.c2', attemptRef: task.operationRef,
        sourceRefs: args.sourceRefIds.map(ref => ({ ...plain(review.jobAidContext.sourceCatalog.find(
          item => item.evidenceRef === ref)), sourceRefId: ref })) };
    }
    if (name === 'get_action_attempt_status') {
      const value = status(); state.alterStatus?.(value); return value;
    }
    if (name === 'commit_review_turn_candidate') {
      state.commits += 1;
      const submitted = JSON.parse(args.resultJson);
      if (state.result) assert.deepEqual(submitted, state.result, 'exact original sealed payload');
      else state.result = submitted;
      assert.equal(args.attemptRef, task.operationRef);
      assert.equal(args.leaseToken, 'synthetic-current-lease'); assert.equal(args.leaseGeneration, 2);
      state.status = 'COMMITTING';
      if (state.commitMode === 'ROLLBACK') throw new Error('SYNTHETIC_POST_SEAL_ROLLBACK');
      state.status = 'SUCCEEDED'; state.workWrites += 1;
      state.receipt = receipt(); state.alterReceipt?.(state.receipt);
      if (state.commitMode === 'LOST_AFTER_SAVE') throw new Error('SYNTHETIC_LOST_COMMIT_RESPONSE');
      return structuredClone(state.response === undefined ? state.receipt : state.response);
    }
    assert.fail(`Forbidden or unexpected tool: ${name}`);
  };
  const invokeModel = async (_input, hooks) => {
    state.model += 1;
    await hooks.readSourceRefs(reads ?? (unchanged ? ['document:page-1'] : ['native:fresh-1']));
    return { output: { responseType: 'RESYNTHESIS_RESULT', missingInputs: [], candidateEvidenceRefs: [],
      reviewActionDraft: null, affectedItemIds: [], warnings: [], ...(unchanged
        ? { answer: '原版本判断保持不变。', sourceRefs: [], jobAidWorkingDelta: null } : reviewOutput()) },
    provenance: { modelVersion: 'synthetic-model', promptVersion: 'synthetic-review', skillVersion: WISELINK_SKILL_VERSION,
      toolVersions: { [WISELINK_HOST_MCP_NAME]: WISELINK_HOST_MCP_VERSION },
      runMetrics: { durationMs: 1, inputUnits: 0, outputUnits: 0 } } };
  };
  const options = { workItemId: task.workItemId, checkpointRoot: root };
  const checkpointDir = join(root, encodeURIComponent(review.reviewTurnRef));
  return { task, review, state, calls, journal, checkpointDir, begin, status, receipt,
    run: () => consumePendingReviewTurn(options, { callTool, hasTool: () => true, invokeModel }),
    snapshot: async () => Object.fromEntries(await Promise.all((await readdir(checkpointDir)).map(
      async name => [name, await readFile(join(checkpointDir, name), 'utf8')]))),
  };
}
