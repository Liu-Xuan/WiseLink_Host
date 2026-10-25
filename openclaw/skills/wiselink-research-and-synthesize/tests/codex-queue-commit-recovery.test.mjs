import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { consumeHostedWorkItem, runHostedInitialStage } from '../scripts/consume-hosted-work-item.mjs';
import { canonicalSha256, sealResultEnvelope, validateTaskEnvelope,
  WISELINK_HOST_MCP_NAME, WISELINK_HOST_MCP_VERSION, WISELINK_SKILL_VERSION } from '../scripts/validate-payload.mjs';

const workItemId = 'WI-RECOVERY', attemptRef = 'AQ-RECOVERY', actionAttemptId = 'ATT-RECOVERY';
const documentVersionId = 'DVI-RECOVERY', workRevisionRef = 'JAWR-RECOVERY', saveRequestId = 'SAVE-RECOVERY';
const draft = { schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1', actionAttemptId,
  operationRef: attemptRef, taskType: 'OPENCLAW_DYNAMIC_EVALUATION', priority: 100,
  tenantId: 'synthetic-tenant', workItemId, inputRevision: 1, baseRevision: 1, documentVersionId,
  sourceRefs: [], allowedConnectors: [], hostResolvedMissingInputs: [],
  modelInput: { executionMode: 'PROGRAM_CONTROLLED_V1' },
  deadline: '2099-01-01T00:00:00.000Z', idempotencyKey: 'synthetic-recovery' };
const task = validateTaskEnvelope({ ...draft, inputHash: canonicalSha256(draft) });
const provenance = { modelVersion: 'miaoda/glm-5.3', promptVersion: 'wiselink-jobaid-problem@v3',
  skillVersion: WISELINK_SKILL_VERSION, toolVersions: { [WISELINK_HOST_MCP_NAME]: WISELINK_HOST_MCP_VERSION,
    'jobaid-problem-protocol': '3', 'model-executor': 'CODEX' }, runMetrics: { durationMs: 1, inputUnits: 1, outputUnits: 1 } };
const recoveryResult = sealResultEnvelope({ task, modelOutput: { workRevisionRef }, provenance,
  factsConsidered: [workRevisionRef] });
const recovery = { status: 'RECOVERY_COMMITTING', operation: 'EVALUATE_JOBAID', attemptRef,
  resultContentHash: recoveryResult.contentHash, documentVersionId, workItemRevision: 1 };
function initial(done = false) {
  return { candidateOnly: true, workItemRevision: 1, documentVersionId, status: done ? 'SUCCEEDED' : 'BUSY',
    nextOperation: null, stages: { translation: { status: 'SUCCEEDED' }, applicability: { status: 'WAITING_INPUT' },
      jobAid: done ? { status: 'SUCCEEDED' } : { status: 'BUSY', attemptStatus: 'COMMITTING', attemptRef },
      overall: { status: done ? 'SUCCEEDED' : 'PENDING' } } };
}
const projection = () => ({ status: 'OVERALL_CANDIDATE_READY', baseRules: { workRevisionRef },
  overallSynthesis: { status: 'CANDIDATE_ONLY', executionKind: 'DETERMINISTIC_PROJECTION', modelRequests: 0,
    basedOnJobAidWorkRevisionRef: workRevisionRef, sourceAssessment: { actionAttemptId, workRevisionRef,
      workRevision: 1, saveRequestId, readObservedAt: '2026-10-25T09:00:00.000Z' } } });
const saved = () => ({ schemaVersion: 'wiselink.jobaid-work-read.v2', attemptId: actionAttemptId,
  inputWorkRevision: 0, executionStatus: 'COMMITTING', revision: { workRevisionRef, workRevision: 1,
    requestId: saveRequestId, actionAttemptId, workItemId, documentVersionId, basedOnWorkItemRevision: 1,
    content: { roundCompletion: 'COMPLETE', overviewStatus: 'CURRENT', understanding: 'synthetic work' } } });
async function options(t) {
  const checkpointRoot = await mkdtemp(join(tmpdir(), 'wl-codex-queue-recovery-'));
  t.after(() => rm(checkpointRoot, { recursive: true, force: true }));
  return { checkpointRoot, modelExecutor: 'CODEX', workItemId, initialStageOnly: true,
    maxInitialStages: 1, queueCommitRecovery: recovery };
}

for (const mutate of [false, true]) test(`queue wrapper resumes sealed program commit; foreign saved work=${mutate}`, async t => {
  const calls = []; let committed = false;
  const opts = await options(t);
  const result = consumeHostedWorkItem(opts, {
    invokeInitialModel: async () => assert.fail('COMMITTING cannot call a model'),
    callTool: async (name, args) => {
      calls.push({ name, args });
      if (name === 'get_parse_status') return { entry: { workItemId }, initialAnalysis: initial(committed),
        ...(committed ? { integratedAssessmentSummary: projection() } : {}) };
      if (name === 'get_action_attempt_status') return { ...recovery, taskType: task.taskType,
        status: 'COMMITTING', projectionApplied: false, recoveryAvailable: true, recoveryResult,
        commitStartedAt: '2026-10-25T09:00:00.000Z', terminalReason: null };
      if (name === 'begin_dynamic_evaluation') return { status: 'COMMITTING', attemptRef, task,
        leaseToken: '00000000-0000-4000-8000-000000000001', leaseGeneration: 1,
        modelInput: { schemaVersion: 'wiselink.jobaid-problem-task.v3', executionMode: 'PROGRAM_CONTROLLED_V1',
          purpose: 'INITIAL_PROBLEM_ASSESSMENT', expectedWorkRevision: 0 }, recoveryResult };
      if (name === 'read_assessment_work') {
        assert.deepEqual(args, { attemptRef, workItemId,
          ...(Object.hasOwn(args, 'requestId') ? { requestId: saveRequestId } : {}) });
        const packet = saved(); if (mutate) packet.revision.actionAttemptId = 'ATT-FOREIGN';
        return packet;
      }
      if (name === 'commit_dynamic_evaluation_candidate') {
        assert.equal(args.result.contentHash, recoveryResult.contentHash);
        committed = true; return { workItemId, workItemRevision: 2, ...projection() };
      }
      assert.fail(`unexpected tool ${name}`);
    },
  });
  if (mutate) {
    await assert.rejects(result, /HOST_MCP_PROGRAM_ASSESSMENT_SAVED_READBACK_INVALID/u);
    assert.equal(committed, false);
  } else {
    const value = await result;
    assert.equal(value.status, 'INITIAL_STAGE_SAVED');
    assert.equal(value.outcome, 'COMMITTING_REPLAYED');
    assert.equal(value.modelCallCount, 0);
    assert.deepEqual(value.completedStages, ['EVALUATE_JOBAID']);
    assert.equal(calls.filter(call => call.name === 'read_assessment_work').length, 2);
    assert.equal(calls.filter(call => call.name === 'commit_dynamic_evaluation_candidate').length, 1);
  }
  assert.equal(calls.some(call => call.name === 'save_assessment_work'), false);
});

for (const [name, args] of [
  ['read_assessment_work', { attemptRef: 'AQ-OTHER', workItemId }],
  ['read_assessment_work', { attemptRef, workItemId: 'WI-OTHER' }],
  ['read_assessment_work', { attemptRef, workItemId, requestId: 'caller-selected' }],
  ['save_assessment_work', { attemptRef, workItemId }],
]) test(`sealed recovery rejects ${name} with ${JSON.stringify(args)}`, async t => {
  const opts = await options(t); let calls = 0;
  await assert.rejects(runHostedInitialStage({ ...opts, operation: 'EVALUATE_JOBAID', initial: initial(),
    assessmentRecovery: recovery }, { callTool: async () => { calls++; assert.fail('cannot reach Host'); },
    runInitial: async input => input.callTool(name, args) }),
  /AUTO_WORK_ITEM_COMMITTING_RECOVERY_CHANGED|AUTO_WORK_ITEM_COMMITTING_RECOVERY_TOOL_REJECTED/u);
  assert.equal(calls, 0);
});
