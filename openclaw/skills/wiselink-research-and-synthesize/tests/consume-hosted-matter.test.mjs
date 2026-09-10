import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { consumeHostedMatter } from '../scripts/consume-hosted-matter.mjs';
import { WISELINK_SKILL_VERSION, WISELINK_HOST_MCP_NAME, WISELINK_HOST_MCP_VERSION } from '../scripts/validate-payload.mjs';

async function fixture(run) {
  const checkpointRoot = await mkdtemp(join(tmpdir(), 'matter-consumer-'));
  try { await run(checkpointRoot); } finally { await rm(checkpointRoot, { recursive: true, force: true }); }
}
const task = { schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v2', taskType: 'OPENCLAW_MATTER_ASSESSMENT',
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
