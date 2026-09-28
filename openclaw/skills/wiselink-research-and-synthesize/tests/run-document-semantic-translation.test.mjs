import assert from 'node:assert/strict';
import test from 'node:test';
import { runDocumentSemanticTranslationStep } from '../scripts/run-document-semantic-translation.mjs';

const identity = { documentVersionId: 'DV-test', parseRunId: 'PR-test', attemptRef: 'DTQ-test' };
const fence = { attemptRef: identity.attemptRef, principalId: 'document-principal',
  leaseToken: '00000000-0000-4000-8000-000000000001', leaseGeneration: 2 };
const executionModel = { modelRef: 'm3probe/minimax-m3', displayName: 'M3 Probe Large',
  providerKind: 'CUSTOM', settingsRevision: 0, selectedAt: '2026-09-29T00:00:00.000Z' };
const task = { ...identity, workspaceId: 'TW-test', deadline: new Date(Date.now() + 600_000).toISOString(),
  modelInput: { documentProducer: 'HOSTED_M3', workspaceId: 'TW-test' } };
const batch = { schemaVersion: 'wiselink.3_1.translation_semantic_batch.v2', workspaceId: 'TW-test',
  generationRequestRef: 'GEN-test', purpose: 'GENERATE', blocks: [
    { blockId: 'b1', anchorIds: ['a1'] }, { blockId: 'b2', anchorIds: ['a2'] }],
  anchors: [{ anchorId: 'a1', sourceText: 'One.' }, { anchorId: 'a2', sourceText: 'Two.' }],
  documentContext: { title: 'Fixture' }, dependencies: {} };
function delivery() {
  const bytes = Buffer.from(JSON.stringify(batch));
  return { schemaVersion: 'wiselink.3_1.translation_batch_delivery.v2', action: 'GENERATE',
    workspaceId: batch.workspaceId, generationRequestRef: batch.generationRequestRef,
    blockIds: batch.blocks.map(block => block.blockId), targetBlockRevisionId: null,
    targetRowVersion: null, delivery: { partIndex: 0, partCount: 1,
      byteLength: bytes.length, payloadBase64: bytes.toString('base64') } };
}
function harness({ next, translate }) {
  const calls = [];
  const callTool = async (name, input) => {
    assert.equal(name, 'document_translation'); calls.push(input);
    if (input.action === 'CLAIM') return { ...identity, status: 'RUNNING', fence, task, executionModel };
    if (input.action === 'HEARTBEAT') return { renewed: true, attemptRef: identity.attemptRef };
    if (input.action === 'RELEASE') return { released: true, attemptRef: identity.attemptRef };
    if (input.action === 'FINISH') return { ...identity, status: 'SUCCEEDED', progress: { completeness: 'COMPLETE' } };
    if (input.action === 'WORKSPACE') {
      if (input.workspaceCommand.phase === 'READ') return { generationRequestCount: 0, retryableFailureCount: 0 };
      if (input.workspaceCommand.phase === 'NEXT') return next();
      if (input.workspaceCommand.phase === 'SAVE') return { generationRequestRef: batch.generationRequestRef,
        blocks: input.workspaceCommand.candidates.map(candidate => ({ blockId: candidate.blockId })) };
      if (input.workspaceCommand.phase === 'RECORD_FAILURE') return { generationRequestRef: batch.generationRequestRef };
    }
    throw new Error(`UNEXPECTED_${input.action}_${input.workspaceCommand?.phase}`);
  };
  return { calls, callTool, translate };
}

test('document Hosted generation saves a prefix, closes its request, then finishes', async () => {
  let nextCount = 0;
  const h = harness({ next: () => ++nextCount === 1 ? delivery() : { action: 'DONE' },
    translate: async () => ({ output: { blocks: [{ blockId: 'b1', elements: [{ kind: 'paragraph',
      translatedText: '一。', anchorIds: ['a1'] }] }] }, actualExecution: { modelRef: executionModel.modelRef } }) });
  const result = await runDocumentSemanticTranslationStep(identity, h);
  assert.equal(result.status, 'SUCCEEDED');
  const actions = h.calls.map(call => call.action === 'WORKSPACE' ? call.workspaceCommand.phase : call.action);
  assert.deepEqual(actions.filter(action => ['SAVE','RECORD_FAILURE','FINISH','RELEASE'].includes(action)),
    ['SAVE','RECORD_FAILURE','FINISH']);
  assert.equal(h.calls.find(call => call.workspaceCommand?.phase === 'RECORD_FAILURE').workspaceCommand.error.code,
    'TRANSLATION_BATCH_PREFIX_ONLY');
  assert.deepEqual(h.calls.filter(call => call.workspaceCommand?.phase === 'NEXT').map(call => call.workspaceCommand.requestId),
    ['document:DTQ-test:batch-0','document:DTQ-test:batch-0']);
});

test('unknown generation remains registered and does not dispatch a replacement model call', async () => {
  let modelCalls = 0;
  const h = harness({ next: delivery,
    translate: async () => { modelCalls++; throw new Error('response lost'); } });
  const result = await runDocumentSemanticTranslationStep(identity, h);
  assert.equal(result.status, 'REQUIRES_ATTENTION');
  assert.equal(modelCalls, 1);
  assert.deepEqual(h.calls.filter(call => ['RECORD_FAILURE','RELEASE'].includes(call.action === 'WORKSPACE'
    ? call.workspaceCommand.phase : call.action)).map(call => call.action === 'WORKSPACE'
    ? call.workspaceCommand.phase : call.action), ['RECORD_FAILURE','RELEASE']);
  assert.equal(h.calls.find(call => call.workspaceCommand?.phase === 'RECORD_FAILURE').workspaceCommand.error.outcome,
    'GENERATION_UNKNOWN');
});

test('known retryable model failure keeps attempt active for the next tick', async () => {
  const h = harness({ next: delivery, translate: async () => {
    throw Object.assign(new Error('rate limited'), { translationFailure: { origin: 'GATEWAY',
      code: 'TRANSLATION_GATEWAY_RATE_LIMITED', outcome: 'KNOWN_FAILURE', retryable: true } });
  } });
  const result = await runDocumentSemanticTranslationStep(identity, h);
  assert.equal(result.status, 'RUNNING');
  assert.equal(h.calls.some(call => call.action === 'FAIL' || call.action === 'FINISH'), false);
  assert.equal(h.calls.at(-1).action, 'RELEASE');
});
