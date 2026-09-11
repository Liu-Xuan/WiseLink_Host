import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { consumeHostedMatter } from '../scripts/consume-hosted-matter.mjs';
import { invokeHostedJobAidProblemModel } from '../scripts/run-jobaid-problem-assessment.mjs';
import { createCheckpointStore } from '../scripts/run-hosted-review-turn.mjs';
import { WISELINK_SKILL_VERSION, WISELINK_HOST_MCP_NAME, WISELINK_HOST_MCP_VERSION } from '../scripts/validate-payload.mjs';

async function fixture(run) {
  const checkpointRoot = await mkdtemp(join(tmpdir(), 'matter-consumer-'));
  try { await run(checkpointRoot); } finally { await rm(checkpointRoot, { recursive: true, force: true }); }
}
const task = { schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v2', taskType: 'OPENCLAW_MATTER_ASSESSMENT',
  deadline: '2099-01-01T00:00:00.000Z',
  actionAttemptId: 'ATT-one', operationRef: 'AQ-one', subject: { kind: 'ENGINEERING_MATTER', matterId: 'MAT-one' },
  baseRevision: 0, sourceRefs: [], inputHash: 'host-task-binding', executionModel: { modelRef: 'miaoda/minimax-m3' },
  modelInput: { schemaVersion: 'wiselink.matter-jobaid-task.v2', sourceCatalog: [], modelInput: {
    schemaVersion: 'wiselink.matter-jobaid-task.v2', expectedWorkRevision: 0, previousWork: null,
    availableDocuments: [{ documentVersionId: 'DV-one' }],
  } } };
const provenance = { modelVersion: 'test-model-only', promptVersion: 'test-prompt', skillVersion: WISELINK_SKILL_VERSION,
  toolVersions: { [WISELINK_HOST_MCP_NAME]: WISELINK_HOST_MCP_VERSION }, runMetrics: { durationMs: 1, inputUnits: 1, outputUnits: 1 } };

test('the existing Matter branch reads pages, saves work and finishes once; unknown finish reuses the exact result', () => fixture(async checkpointRoot => {
  let modelCalls = 0; let finishCalls = 0; let firstResult;
  const operations = [];
  const dependencies = {
    callTool: async (name, input) => {
      if (name === 'next_matter_assessment') return { matterId: 'MAT-one', next: { attemptRef: 'AQ-one', status: 'RUNNING' } };
      assert.equal(name, 'matter_action_attempt'); operations.push(input.operation);
      if (input.operation === 'CLAIM') return { task, status: 'RUNNING', attemptRef: 'AQ-one', leaseToken: 'lease', leaseGeneration: 1 };
      if (input.operation === 'HEARTBEAT') return {};
      if (input.operation === 'STATUS') return { attemptRef: 'AQ-one', status: 'RUNNING', resultContentHash: null };
      if (input.operation === 'READ_SOURCES') return { documentVersionId: 'DV-one', pageCount: 9, extractionScope: 'NATIVE_TEXT_LAYER',
        pages: [{ page: 1, sourceRefId: 'DOCUMENT_VERSION:DV-one:page:1', textLayerStatus: 'PRESENT', evidence: { evidenceRef: 'DOCUMENT_VERSION:DV-one:page:1', excerpt: 'Actual test text' } }] };
      if (input.operation === 'SAVE_WORK') return { workRevisionRef: 'MWR-one', workRevision: 1, roundCompletion: 'COMPLETE' };
      if (input.operation === 'FINISH') {
        finishCalls += 1;
        if (finishCalls === 1) { firstResult = input.result; throw new Error('transport response lost'); }
        assert.deepEqual(input.result, firstResult);
        return { attemptRef: 'AQ-one', status: 'SUCCEEDED', workRevisionRef: 'MWR-one' };
      }
      assert.fail(input.operation);
    },
    invokeMatterModel: async (input, hooks) => {
      modelCalls += 1;
      assert.equal(input.operation, 'ASSESS_MATTER');
      assert.deepEqual(hooks.executionModel, task.executionModel);
      await hooks.heartbeat();
      const read = await hooks.readAssessmentSources({ sourceRefs: ['DOCUMENT_VERSION:DV-one:page:1'], purpose: 'read source', context: 'PAGE' });
      assert.equal(read.documents[0].pageCount, 9);
      assert.equal(read.documents[0].visualContentVerified, false);
      await hooks.saveAssessmentWork({ requestId: 'save-one', expectedWorkRevision: 0, workJson: '{}' });
      return { output: { workRevisionRef: 'MWR-one' }, provenance };
    },
  };
  const options = { matterId: 'MAT-one', checkpointRoot };
  await assert.rejects(consumeHostedMatter(options, dependencies), /transport response lost/);
  assert.equal((await consumeHostedMatter(options, dependencies)).status, 'MATTER_WORK_SAVED');
  assert.equal(modelCalls, 1); assert.equal(finishCalls, 2);
  assert.equal(operations.filter(item => item === 'SAVE_WORK').length, 1);
}));

test('an ambiguous model request is never repeated on the next native tick', () => fixture(async checkpointRoot => {
  let calls = 0;
  const dependencies = { callTool: async name => name === 'next_matter_assessment'
    ? { matterId: 'MAT-one', next: { attemptRef: 'AQ-one', status: 'RUNNING' } }
    : { task, status: 'RUNNING', attemptRef: 'AQ-one', leaseToken: 'lease', leaseGeneration: 1 },
    invokeMatterModel: async () => { calls += 1; throw new Error('unknown model outcome'); } };
  await assert.rejects(consumeHostedMatter({ matterId: 'MAT-one', checkpointRoot }, dependencies), /unknown model outcome/);
  await assert.rejects(consumeHostedMatter({ matterId: 'MAT-one', checkpointRoot }, dependencies), /MODEL_OUTCOME_UNKNOWN/);
  assert.equal(calls, 1);
}));

for (const recoverLegacy of [false, true]) test(`Matter resumes a failed page read after lease renewal (legacy=${recoverLegacy})`, () => fixture(async checkpointRoot => {
  const boundTask = structuredClone(task);
  Object.assign(boundTask.executionModel, { displayName: 'Synthetic', providerKind: 'BUILT_IN', settingsRevision: 1,
    selectedAt: '2026-09-11T00:00:00.000Z' });
  Object.assign(boundTask.modelInput.modelInput, {
    subject: task.subject, methodBinding: { packRef: 'synthetic-method' }, availableSources: [], deliveredEvidence: [],
  });
  const steps = [
    { action: 'READ_SOURCES', sourceRefs: ['DOCUMENT_VERSION:DV-one:page:1'], context: 'PAGE', purpose: 'read' },
    { action: 'SAVE_WORK', workJson: JSON.stringify({ roundCompletion: 'COMPLETE' }) },
    { action: 'FINISH' },
  ];
  const users = []; let reads = 0; let saves = 0; let generation = 1;
  const dependencies = {
    callTool: async (name, input) => {
      if (name === 'next_matter_assessment') return { matterId: 'MAT-one', next: { attemptRef: 'AQ-one', status: 'RUNNING' } };
      if (input.operation === 'CLAIM') return { task: boundTask, attemptRef: 'AQ-one', status: 'RUNNING', leaseToken: `lease-${generation}`, leaseGeneration: generation };
      if (input.operation === 'READ_SAVED_WORK') return null;
      assert.equal(input.leaseGeneration, generation);
      if (input.operation === 'HEARTBEAT') return {};
      if (input.operation === 'READ_SOURCES') {
        if (++reads === 1) throw new Error('SOURCE_TRANSPORT_FAILED');
        return sourceReading(input);
      }
      if (input.operation === 'SAVE_WORK') { saves++; return { workRevisionRef: 'MWR-one', workRevision: 1, roundCompletion: 'COMPLETE' }; }
      if (input.operation === 'FINISH') return { attemptRef: 'AQ-one', status: 'SUCCEEDED', workRevisionRef: 'MWR-one' };
      assert.fail(input.operation);
    },
    invokeMatterModel: (input, hooks) => invokeHostedJobAidProblemModel(input, {
      gatewayChatCompletionsEnabled: true, gatewayUrl: 'http://127.0.0.1:1', gatewayToken: 'synthetic', ...hooks,
      registeredModelRefs: ['miaoda/minimax-m3'],
    }, { requestGateway: async (_url, request) => {
      users.push(JSON.parse(request.body).user);
      return new Response(JSON.stringify({ model: 'synthetic', choices: [{ finish_reason: 'tool_calls', message: {
        role: 'assistant', content: null, tool_calls: [{ id: `call-${users.length}`, type: 'function', function: {
          name: 'return_wiselink_assessment_step', arguments: JSON.stringify({ step: steps.shift() }),
        } }],
      } }] }));
    } }),
  };
  const options = { matterId: 'MAT-one', checkpointRoot };
  if (recoverLegacy) {
    const checkpoint = await createCheckpointStore(join(checkpointRoot, 'matter', 'MAT-one', 'AQ-one'));
    await assert.rejects(checkpoint.remoteStep({ step: 'model', args: { inputHash: task.inputHash }, ambiguousCommit: false,
      perform: async () => { throw new Error('legacy source failure'); } }), /legacy source failure/);
    const step = steps.shift();
    dependencies.recoverNativeMatterResponse = async binding => ({ ...binding, sessionDiscriminator: 'AQ-one:1',
      response: { status: 200, ok: true, raw: JSON.stringify({ model: 'synthetic', choices: [{ finish_reason: 'tool_calls',
        message: { role: 'assistant', content: null, tool_calls: [{ id: 'original-native-call', type: 'function',
          function: { name: 'return_wiselink_assessment_step', arguments: JSON.stringify({ step }) } }] } }] }) } });
  }
  await assert.rejects(consumeHostedMatter(options, dependencies), /SOURCE_TRANSPORT_FAILED/);
  generation = 2;
  assert.equal((await consumeHostedMatter(options, dependencies)).status, 'MATTER_WORK_SAVED');
  assert.deepEqual(users, Array(recoverLegacy ? 2 : 3).fill('initial:AQ-one:1'));
  assert.equal(reads, 2); assert.equal(saves, 1);
}));

test('idle or terminal requests never claim or invoke a model', async () => {
  for (const next of [null, { attemptRef: 'AQ-one', status: 'CANCELLED' }]) {
    let calls = 0;
    const result = await consumeHostedMatter({ matterId: 'MAT-one' }, {
      callTool: async name => { calls += 1; assert.equal(name, 'next_matter_assessment'); return { matterId: 'MAT-one', next }; },
      invokeMatterModel: async () => assert.fail('model must not run'),
    });
    assert.equal(result.status, next ? 'REQUIRES_ATTENTION' : 'IDLE'); assert.equal(calls, 1);
  }
});

function sourceReading(input) {
  return { documentVersionId: input.documentVersionId, pageCount: 12, extractionScope: 'NATIVE_TEXT_LAYER',
    pages: Array.from({ length: input.pageEnd - input.pageStart + 1 }, (_, index) => {
      const page = input.pageStart + index;
      const sourceRefId = `DOCUMENT_VERSION:${input.documentVersionId}:page:${page}`;
      return { page, sourceRefId, textLayerStatus: 'PRESENT', evidence: { evidenceRef: sourceRefId, excerpt: 'test source' } };
    }) };
}

test('Matter groups exact contiguous pages using the Host limit and starts independent reads together', async () => {
  const { readMatterAssessmentSources } = await import('../scripts/consume-hosted-matter.mjs');
  const sourceRefs = Array.from({ length: 10 }, (_, index) => `DOCUMENT_VERSION:DV-one:page:${index + 1}`);
  sourceRefs.push('DOCUMENT_VERSION:DV-two:page:1');
  const calls = []; const releases = [];
  const pending = readMatterAssessmentSources({ sourceRefs, purpose: 'compare', context: 'PAGE' }, {
    sourceCatalog: [], availableDocuments: [{ documentVersionId: 'DV-one' }, { documentVersionId: 'DV-two' }],
  }, async (operation, input) => {
    assert.equal(operation, 'READ_SOURCES'); calls.push(input);
    await new Promise(resolve => releases.push(resolve));
    return sourceReading(input);
  });
  assert.equal(calls.length, 3, 'all independent ranges start before any result arrives');
  assert.deepEqual(calls.map(({ pageStart, pageEnd }) => [pageStart, pageEnd]), [[1, 8], [9, 10], [1, 1]]);
  releases.reverse().forEach(resolve => resolve());
  const result = await pending;
  assert.deepEqual(result.sourceRefs, sourceRefs);
  assert.equal(result.documents.length, 11);
  assert.equal(result.originalVisualContentVerified, false);
});

test('Matter validates all source handles before dispatch and rejects duplicate or foreign selections', async () => {
  const { readMatterAssessmentSources } = await import('../scripts/consume-hosted-matter.mjs');
  let calls = 0;
  for (const sourceRefs of [['METHOD-one', 'DOCUMENT_VERSION:foreign:page:1'], ['METHOD-one', 'METHOD-one']]) {
    await assert.rejects(readMatterAssessmentSources({ sourceRefs, purpose: 'read', context: 'PAGE' }, {
      sourceCatalog: [{ evidenceRef: 'METHOD-one' }], availableDocuments: [],
    }, async () => { calls += 1; }), /JOBAID_SOURCE_/);
  }
  assert.equal(calls, 0);
});

test('Matter reads at most four ranges at once and settles them before reporting a failure', async () => {
  const { readMatterAssessmentSources } = await import('../scripts/consume-hosted-matter.mjs');
  const availableDocuments = Array.from({ length: 5 }, (_, index) => ({ documentVersionId: `DV-${index}` }));
  const sourceRefs = availableDocuments.map(item => `DOCUMENT_VERSION:${item.documentVersionId}:page:1`);
  const releases = []; const calls = []; let failed = false;
  const pending = readMatterAssessmentSources({ sourceRefs, purpose: 'read', context: 'PAGE' }, {
    sourceCatalog: [], availableDocuments,
  }, async (_operation, input) => {
    calls.push(input.documentVersionId);
    if (input.documentVersionId === 'DV-0') throw new Error('SOURCE_ACCESS_REVOKED');
    await new Promise(resolve => releases.push(resolve));
    return sourceReading(input);
  });
  const checked = assert.rejects(pending, /SOURCE_ACCESS_REVOKED/).then(() => { failed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 4);
  assert.equal(failed, false, 'no source callback is left running when the caller receives failure');
  releases.forEach(resolve => resolve());
  await checked;
  assert.equal(calls.length, 4, 'later ranges are not started after a failed batch');
});

test('a confirmed incomplete response reports failure once and recovers a lost failure receipt without another generation', () => fixture(async checkpointRoot => {
  const boundTask = structuredClone(task);
  Object.assign(boundTask.executionModel, { displayName: 'Synthetic', providerKind: 'BUILT_IN', settingsRevision: 1,
    selectedAt: '2026-09-11T00:00:00.000Z' });
  Object.assign(boundTask.modelInput.modelInput, {
    subject: task.subject, methodBinding: { packRef: 'synthetic-method' }, availableSources: [], deliveredEvidence: [],
  });
  let modelCalls = 0; let finishes = 0; let saved = 0; let committed;
  const dependencies = {
    callTool: async (name, input) => {
      if (name === 'next_matter_assessment') return { matterId: 'MAT-one', next: { attemptRef: 'AQ-one', status: 'RUNNING' } };
      if (input.operation === 'CLAIM') return { task: boundTask, status: 'RUNNING', attemptRef: 'AQ-one', leaseToken: 'lease', leaseGeneration: 1 };
      if (input.operation === 'HEARTBEAT') return {};
      if (input.operation === 'SAVE_WORK') { saved++; return { workRevisionRef: 'MWR-one', workRevision: 1, roundCompletion: 'COMPLETE' }; }
      if (input.operation === 'READ_SAVED_WORK') return null;
      if (input.operation === 'STATUS') return { attemptRef: 'AQ-one', status: 'FAILED', resultContentHash: committed.contentHash };
      if (input.operation === 'FINISH') {
        finishes++;
        committed = input.result;
        assert.equal(committed.status, 'FAILED');
        assert.equal(committed.modelOutput, null);
        assert.equal(committed.errorCode, 'JOBAID_INCOMPLETE_TERMINAL_RESPONSE');
        assert.equal(JSON.stringify(committed).includes('private-diagnostic'), false);
        throw new Error('failure receipt lost');
      }
      assert.fail(input.operation);
    },
    invokeMatterModel: (input, hooks) => invokeHostedJobAidProblemModel(input, {
      gatewayChatCompletionsEnabled: true, gatewayUrl: 'http://127.0.0.1:1', gatewayToken: 'synthetic', ...hooks,
      registeredModelRefs: ['miaoda/minimax-m3'],
    }, { requestGateway: async () => {
      if (++modelCalls === 1) return new Response(JSON.stringify({ model: 'synthetic', choices: [{ finish_reason: 'tool_calls',
        message: { role: 'assistant', content: null, tool_calls: [{ id: 'save-call', type: 'function', function: {
          name: 'return_wiselink_assessment_step', arguments: JSON.stringify({ step: { action: 'SAVE_WORK', workJson: '{"roundCompletion":"COMPLETE"}' } }),
        } }] } }] }));
      return new Response(JSON.stringify({ error: { message: 'miaoda/minimax-m3 ended with an incomplete terminal response',
        code: 'incomplete_result', detail: 'private-diagnostic' } }), { status: 400 });
    } }),
  };
  const options = { matterId: 'MAT-one', checkpointRoot };
  await assert.rejects(consumeHostedMatter(options, dependencies), /failure receipt lost/);
  assert.equal((await consumeHostedMatter(options, dependencies)).status, 'MATTER_ASSESSMENT_FAILED');
  assert.equal(modelCalls, 2);
  assert.equal(finishes, 1);
  assert.equal(saved, 1);
  const checkpoint = await createCheckpointStore(join(checkpointRoot, 'matter', 'MAT-one', 'AQ-one'));
  assert.equal((await checkpoint.readOptional('assessment-state')).saved.workRevisionRef, 'MWR-one');
}));
