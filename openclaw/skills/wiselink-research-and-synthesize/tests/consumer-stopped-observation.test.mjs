import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runHostedInitialStage } from '../scripts/consume-hosted-work-item.mjs';
import { initialStageCheckpointPath } from '../scripts/initial-assessment-recovery.mjs';

const requestId = '00000000-0000-4000-8000-000000000219';
const failureCode = 'JOBAID_GATEWAY_HTTP_400:INCOMPLETE_TERMINAL_RESPONSE';

async function stoppedRun(t, { operation = 'EVALUATE_JOBAID', explicit = true,
  hostTool = true, change = null, reportFailure = false, wrongReceipt = false } = {}) {
  const checkpointRoot = await mkdtemp(join(tmpdir(), 'wiselink-consumer-stopped-'));
  t.after(() => rm(checkpointRoot, { recursive: true, force: true }));
  const options = { workItemId: 'WI-stop', checkpointRoot, maxInitialStages: 1, initialStageOnly: true };
  const stage = operation === 'EVALUATE_JOBAID' ? 'jobAid' : 'overall';
  const selectedRequest = explicit ? requestId : undefined;
  const initial = { workItemRevision: 2, documentVersionId: 'DV-stop', candidateOnly: true,
    status: 'REQUIRED', nextOperation: operation,
    stages: { translation: { status: 'SUCCEEDED' }, applicability: { status: 'WAITING_INPUT' },
      jobAid: { status: 'SUCCEEDED' }, overall: { status: 'PENDING' },
      [stage]: { status: 'PENDING', ...(explicit ? { requestId } : {}) } } };
  const beginName = operation === 'EVALUATE_JOBAID' ? 'begin_dynamic_evaluation' : 'begin_overall_synthesis';
  const kind = operation === 'EVALUATE_JOBAID' ? 'dynamic' : 'overall';
  const task = { actionAttemptId: 'ATT-stop', operationRef: 'AQ-stop',
    taskType: operation === 'EVALUATE_JOBAID' ? 'OPENCLAW_DYNAMIC_EVALUATION' : 'OPENCLAW_OVERALL_SYNTHESIS',
    workItemId: 'WI-stop', documentVersionId: 'DV-stop', inputRevision: 2,
    idempotencyKey: explicit
      ? ['openclaw-v2', kind, 'WI-stop', 'DV-stop', requestId].join(':')
      : 'openclaw-v1:overall:WI-stop:2:problem-v2',
    deadline: new Date(Date.now() + 60_000).toISOString() };
  const modelInput = { schemaVersion: 'wiselink.jobaid-problem-task.v2' };
  const claim = { status: 'RUNNING', attemptRef: 'AQ-stop', task, modelInput,
    leaseToken: 'fixture-lease-token', leaseGeneration: 2 };
  const directory = initialStageCheckpointPath(options, operation, selectedRequest);
  const calls = [];
  let modelCalls = 0;
  const dependencies = {
    hasTool: name => name === 'record_assessment_consumer_stopped' && hostTool,
    callTool: async (name, args) => {
      calls.push({ name, args });
      if (name === beginName) return structuredClone(claim);
      assert.equal(name, 'record_assessment_consumer_stopped');
      const persisted = JSON.parse(await readFile(join(directory, 'run-result.json'), 'utf8'));
      assert.equal(persisted.status, 'REQUIRES_ATTENTION');
      assert.equal(persisted.attemptStatus, 'UNKNOWN');
      assert.equal(persisted.errorCode, failureCode);
      assert.deepEqual(args, { attemptRef: 'AQ-stop', workItemId: 'WI-stop',
        leaseToken: 'fixture-lease-token', leaseGeneration: 2,
        requestId: selectedRequest ?? null, documentVersionId: 'DV-stop', inputRevision: 2,
        modelRound: 6, errorCode: failureCode, upstreamOutcome: 'UNKNOWN' });
      if (reportFailure) throw new Error('JOBAID_OBSERVATION_TRANSPORT_UNCERTAIN');
      return { status: 'RECORDED', attemptRef: wrongReceipt ? 'AQ-other' : 'AQ-stop',
        observedAt: '2026-10-25T00:00:00.000Z', upstreamOutcome: 'UNKNOWN', replayed: false };
    },
    runInitial: async run => {
      await run.callTool(beginName, { ...(selectedRequest ? { requestId: selectedRequest } : {}) });
      await (operation === 'EVALUATE_JOBAID' ? run.evaluateDynamicRules : run.synthesizeOverall)(modelInput);
      assert.fail('the synthetic gateway failure must escape the model callback');
    },
    invokeInitialModel: async (_input, hooks) => {
      modelCalls++;
      await hooks.assessmentCheckpoint.write('assessment-state', { round: 6, expectedWorkRevision: 0, saved: null });
      if (change === 'request') {
        const binding = await hooks.assessmentCheckpoint.readOptional('binding');
        await hooks.assessmentCheckpoint.write('binding', { ...binding, requestId: '00000000-0000-4000-8000-000000000218' });
      }
      if (change === 'claim') {
        const current = await hooks.assessmentCheckpoint.readOptional('assessment-current-claim');
        await hooks.assessmentCheckpoint.write('assessment-current-claim', {
          ...current, task: { ...current.task, actionAttemptId: 'ATT-other' },
        });
      }
      // No provider/network/model is run: the actual consumer handles a
      // constructed, already parsed Gateway error through its production catch.
      throw new Error(failureCode);
    },
  };
  const run = () => runHostedInitialStage({ ...options, operation, initial }, dependencies);
  const result = await run();
  return { result, calls, modelCalls: () => modelCalls, run, claim, directory };
}

for (const setup of [{ operation: 'EVALUATE_JOBAID', explicit: true },
  { operation: 'SYNTHESIZE_OVERALL', explicit: false }]) {
  test('consumer-stopped reports the real ' + setup.operation + ' catch with its exact request namespace and never reruns', async t => {
    const h = await stoppedRun(t, setup);
    assert.equal(h.result.status, 'REQUIRES_ATTENTION');
    assert.equal(h.result.attemptStatus, 'UNKNOWN');
    assert.equal(h.result.errorCode, failureCode);
    assert.equal(h.result.consumerStoppedObservation.status, 'RECORDED');
    assert.equal(h.modelCalls(), 1);
    assert.deepEqual(h.calls.map(item => item.name), [
      setup.operation === 'EVALUATE_JOBAID' ? 'begin_dynamic_evaluation' : 'begin_overall_synthesis',
      'record_assessment_consumer_stopped',
    ]);
    assert.equal(h.claim.status, 'RUNNING');
    await assert.rejects(h.run(), /INITIAL_COMPLETED_STAGE_HOST_DRIFT/u);
    assert.equal(h.modelCalls(), 1);
    assert.equal(h.calls.length, 2);
  });
}

test('consumer-stopped remains optional on an old Host and explicitly reports UNAVAILABLE after one model invocation', async t => {
  const h = await stoppedRun(t, { hostTool: false });
  assert.equal(h.modelCalls(), 1);
  assert.deepEqual(h.calls.map(item => item.name), ['begin_dynamic_evaluation']);
  assert.deepEqual(h.result.consumerStoppedObservation, {
    status: 'UNAVAILABLE', errorCode: 'JOBAID_CONSUMER_STOPPED_HOST_TOOL_UNAVAILABLE',
  });
  assert.equal(h.result.errorCode, failureCode);
});

for (const change of ['request', 'claim']) {
  test('consumer-stopped refuses a changed local ' + change + ' without sending metadata or retrying the model', async t => {
    const h = await stoppedRun(t, { change });
    assert.equal(h.modelCalls(), 1);
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.result.consumerStoppedObservation, {
      status: 'UNCONFIRMED', errorCode: 'JOBAID_CONSUMER_STOPPED_LOCAL_BINDING_CHANGED',
    });
    assert.equal(h.result.attemptStatus, 'UNKNOWN');
  });
}

for (const setup of [{ reportFailure: true }, { wrongReceipt: true }]) {
  test('consumer-stopped preserves the original UNKNOWN when its observation is not confirmed: ' + JSON.stringify(setup), async t => {
    const h = await stoppedRun(t, setup);
    assert.equal(h.modelCalls(), 1);
    assert.equal(h.calls.length, 2);
    assert.equal(h.result.errorCode, failureCode);
    assert.equal(h.result.attemptStatus, 'UNKNOWN');
    assert.equal(h.result.consumerStoppedObservation.status, 'UNCONFIRMED');
    const persisted = JSON.parse(await readFile(join(h.directory, 'run-result.json'), 'utf8'));
    assert.deepEqual(persisted, h.result);
  });
}
