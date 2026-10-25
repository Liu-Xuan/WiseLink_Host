import test from 'node:test';
import assert from 'node:assert/strict';
import { runDynamicEvaluation } from '../skills/wiselink-research-and-synthesize/scripts/orchestrate-host-mcp.mjs';
import { assertRuntimeResultIdentity, canonicalSha256,
  WISELINK_HOST_MCP_NAME, WISELINK_HOST_MCP_VERSION } from
  '../skills/wiselink-research-and-synthesize/scripts/validate-payload.mjs';

function envelope(taskType, modelInput) {
  const basis = {
    schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
    actionAttemptId: 'ATT-1', operationRef: 'AQ-1', taskType, priority: 100,
    tenantId: 'tenant-1', workItemId: 'WI-1', inputRevision: 1, baseRevision: 1,
    documentVersionId: 'DV-1', sourceRefs: [], allowedConnectors: [],
    hostResolvedMissingInputs: [], modelInput, deadline: '2099-01-01T00:00:00.000Z',
    idempotencyKey: 'synthetic:zero-model',
  };
  return { ...basis, inputHash: canonicalSha256(basis) };
}

test('fresh Codex saved-work reconciliation reaches commit without generation and retains exact SAVE key', async () => {
  const marker = { executionKind: 'HOST_SAVED_WORK_RECONCILIATION', modelRequests: 0,
    workRevisionRef: 'JAWR-1', workRevision: 1, sourceActionAttemptId: 'ATT-OLD' };
  const previousWork = { workRevisionRef: 'JAWR-1', workRevision: 1,
    actionAttemptId: 'ATT-OLD', content: { roundCompletion: 'COMPLETE' } };
  const inner = { schemaVersion: 'wiselink.jobaid-problem-task.v3',
    purpose: 'INITIAL_PROBLEM_ASSESSMENT' };
  const task = envelope('OPENCLAW_DYNAMIC_EVALUATION', {
    schemaVersion: 'wiselink.jobaid-problem-task.v3', modelInput: inner,
    savedWorkReconciliation: marker, previousWork,
  });
  const begin = { status: 'RUNNING', attemptRef: 'AQ-1', task,
    leaseToken: 'lease-1', leaseGeneration: 1, modelInput: inner };
  const revision = { workRevisionRef: 'JAWR-1', workRevision: 1,
    actionAttemptId: 'ATT-OLD', workItemId: 'WI-1', documentVersionId: 'DV-1',
    basedOnWorkItemRevision: 1, requestId: 'SAVE-ORIGINAL',
    content: { roundCompletion: 'COMPLETE' } };
  const read = { schemaVersion: 'wiselink.jobaid-work-read.v2', attemptId: 'ATT-1',
    executionStatus: 'RUNNING', revision };
  let committed = null;
  let modelCalls = 0;
  const calls = [];
  const callTool = async (name, args) => {
    calls.push({ name, args });
    if (name === 'get_parse_status') return { entry: { workItemId: 'WI-1' } };
    if (name === 'begin_dynamic_evaluation') return begin;
    if (name === 'heartbeat_action_attempt') return { leaseExpiresAt: '2099-01-01T00:00:00.000Z' };
    if (name === 'read_assessment_work') return structuredClone(read);
    if (name === 'commit_dynamic_evaluation_candidate') {
      assertRuntimeResultIdentity(args.result, 'CODEX');
      committed = args.result;
      return { workItemId: 'WI-1', workItemRevision: 2, status: 'BASE_RULE_CANDIDATE_READY' };
    }
    if (name === 'get_deep_link') return { workItemId: 'WI-1', deepLink: '/synthetic' };
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  const result = await runDynamicEvaluation({ workItemId: 'WI-1', callTool,
    evaluateDynamicRules: async () => { modelCalls++; throw new Error('MODEL_SHOULD_NOT_RUN'); },
    runtimeProvenance: { toolVersions: { [WISELINK_HOST_MCP_NAME]: WISELINK_HOST_MCP_VERSION,
      'model-executor': 'CODEX' } },
  });
  assert.equal(result.executionKind, 'HOST_SAVED_WORK_RECONCILIATION');
  assert.equal(modelCalls, 0);
  assert.equal(committed.modelRequests, 0);
  assert.equal(committed.toolVersions[WISELINK_HOST_MCP_NAME], WISELINK_HOST_MCP_VERSION);
  assert.deepEqual(calls.filter(call => call.name === 'read_assessment_work').map(call => call.args),
    [{ attemptRef: 'AQ-1' }, { attemptRef: 'AQ-1', requestId: 'SAVE-ORIGINAL' }]);
});
