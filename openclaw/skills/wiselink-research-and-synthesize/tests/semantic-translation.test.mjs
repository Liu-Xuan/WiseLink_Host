import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalSha256, WISELINK_SKILL_VERSION } from '../scripts/validate-payload.mjs';
import { invokeHostedTranslationBlock, validateTranslationBlockOutput } from '../scripts/invoke-hosted-translation-block.mjs';
import { runSemanticTranslation } from '../scripts/run-semantic-translation.mjs';

const model = { modelRef: 'miaoda/minimax-m3', displayName: 'Synthetic M3', providerKind: 'BUILT_IN', settingsRevision: 1, selectedAt: '2026-09-09T00:00:00.000Z' };
const output = { blocks: [{ blockId: 'b1', elements: [{ kind: 'paragraph', translatedText: '合成示例。', anchorIds: ['a1'] }] }] };
function batch(ref = 'GEN-1') {
  return { schemaVersion: 'wiselink.3_1.translation_semantic_batch.v2', workspaceId: 'TW-test', generationRequestRef: ref, purpose: 'GENERATE',
    blocks: [{ blockId: 'b1', anchorIds: ['a1'] }], anchors: [{ anchorId: 'a1', sourceText: 'Synthetic example.' }], documentContext: { title: 'Synthetic' }, dependencies: {} };
}
function options() { return { gatewayUrl: 'https://synthetic.invalid', gatewayToken: 'synthetic-test-token', gatewayChatCompletionsEnabled: true, executionModel: model, registeredModelRefs: [model.modelRef] }; }
function response(value = output, extra = {}) { return { ok: true, status: 200, text: async () => JSON.stringify({ model: 'synthetic-actual-m3', usage: { prompt_tokens: 100, completion_tokens: 32 },
  choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ type: 'function', function: { name: 'return_wiselink_translation_block', arguments: JSON.stringify({ candidateJson: JSON.stringify(value).replaceAll('"b1"', '"B1"').replaceAll('"a1"', '"A1"') }) } }] } }], ...extra }) }; }

test('each registered generation has one short native session and actual provenance', async () => {
  const requests = [];
  for (const ref of ['GEN-1', 'GEN-2']) {
    const result = await invokeHostedTranslationBlock(batch(ref), options(), { requestGateway: async (_url, init) => { requests.push(JSON.parse(init.body)); return response(); } });
    assert.equal(result.actualExecution.modelVersion, 'synthetic-actual-m3');
    assert.equal(result.actualExecution.skillVersion, WISELINK_SKILL_VERSION);
    assert.equal(result.actualExecution.generatedAt, null); assert.deepEqual(result.output, output);
  }
  assert.deepEqual(requests.map((request) => request.user), ['translation:GEN-1', 'translation:GEN-2']);
  assert.ok(requests.every((request) => request.messages.length === 2 && request.tools.length === 1));
});

test('the official profile-only response keeps complete blocks with an explicitly unreported model version', async () => {
  let requests = 0; const observed = [];
  const result = await invokeHostedTranslationBlock(batch(), {
    ...options(), observeModelOutput: async (shape) => observed.push(shape),
  }, { requestGateway: async () => { requests++;
    return response(output, { model: 'openclaw/wiselink-engineering', id: 'chatcmpl-synthetic-gateway' });
  } });
  assert.equal(requests, 1);
  assert.deepEqual(result.output, output);
  assert.equal(result.actualExecution.modelVersion, 'configured-route:miaoda/minimax-m3');
  assert.equal(result.actualExecution.providerRequestId, null, 'Gateway response ID is not a provider request ID');
  assert.equal(observed[0].configuredModelRef, model.modelRef);
  assert.equal(observed[0].reportedModelVersion, null);
  assert.equal(observed[0].modelProvenanceSource, 'CONFIGURED_ROUTE_ONLY');
  assert.equal(observed[0].gatewayResponseId, 'chatcmpl-synthetic-gateway');
  assert.equal(result.provenance.modelVersion, result.actualExecution.modelVersion);
});

test('gateway model metadata is recorded as reported and never replaced by a configured route', async () => {
  const observed = [];
  const result = await invokeHostedTranslationBlock(batch(), { ...options(), observeModelOutput: async (shape) => observed.push(shape) },
    { requestGateway: async () => response(output, { model: 'synthetic-reported-model' }) });
  assert.equal(result.actualExecution.modelVersion, 'synthetic-reported-model');
  assert.equal(observed[0].reportedModelVersion, 'synthetic-reported-model');
  assert.equal(observed[0].modelProvenanceSource, 'GATEWAY_RESPONSE');
});

test('empty HTTP 200 and timeout statuses never cause hidden generation retries', async () => {
  const cases = [
    [{ ok: true, status: 200, text: async () => JSON.stringify({ choices: [] }) }, 'OUTPUT_CONTRACT', 'KNOWN_FAILURE'],
    [{ ok: false, status: 408, text: async () => JSON.stringify({ error: { code: 'upstream_error' } }) }, 'UPSTREAM', 'GENERATION_UNKNOWN'],
  ];
  for (const [reply, origin, outcome] of cases) {
    let requests = 0;
    await assert.rejects(invokeHostedTranslationBlock(batch(), options(), { requestGateway: async () => { requests++; return reply; } }), (error) => {
      assert.equal(error.translationFailure.origin, origin); assert.equal(error.translationFailure.outcome, outcome); return true;
    });
    assert.equal(requests, 1);
  }
});

test('transport loss differs from proven preconnection failure and neither redispatches', async () => {
  for (const [code, outcome] of [['ECONNRESET', 'GENERATION_UNKNOWN'], ['ENOTFOUND', 'KNOWN_FAILURE']]) {
    let requests = 0;
    await assert.rejects(invokeHostedTranslationBlock(batch(), options(), { requestGateway: async () => { requests++; throw Object.assign(new Error('Synthetic network failure'), { code }); } }),
      (error) => error.translationFailure.outcome === outcome);
    assert.equal(requests, 1);
  }
});

test('model output preserves whole block order and permits only a complete block prefix', () => {
  const source = { ...batch(), blocks: [...batch().blocks, { blockId: 'b2', anchorIds: ['a2'] }] };
  validateTranslationBlockOutput(source, output);
  assert.throws(() => validateTranslationBlockOutput(source, { blocks: [{ ...output.blocks[0], blockId: 'b2' }] }), /BLOCK_ORDER/u);
  assert.throws(() => validateTranslationBlockOutput(source, { blocks: [{ blockId: 'b1', elements: [{ ...output.blocks[0].elements[0], anchorIds: ['a2'] }] }] }), /ELEMENT_INVALID/u);
});

test('saved response loss replays the exact save after reading Host state and does not call the model twice', async () => {
  const calls = []; let requests = 0; let nextNo = 0; const saves = [];
  const result = await runSemanticTranslation({ begin: begin(), requestId: 'synthetic-run', translate: async () => { requests++; return execution(); },
    callTool: async (name, args) => {
      calls.push([name, args.phase]); if (name === 'heartbeat_action_attempt') return {};
      if (args.phase === 'NEXT') return nextNo++ === 0 ? delivery(batch()) : { action: 'DONE' };
      if (args.phase === 'READ') return { generationRequests: [{ status: 'SAVED' }] };
      if (args.phase === 'SAVE') { saves.push(args); if (saves.length === 1) throw new Error('SYNTHETIC_SAVE_RESPONSE_LOSS'); return { generationRequestRef: 'GEN-1', blocks: [{}] }; }
      if (args.phase === 'ASSEMBLE') return assembled(); assert.fail(args.phase);
    } });
  assert.equal(requests, 1); assert.deepEqual(saves[0], saves[1]);
  assert.ok(calls.some(([, phase]) => phase === 'READ'));
  assert.deepEqual(JSON.parse(result.result.modelOutput), assembled());
  assert.equal(JSON.parse(result.result.modelOutput).blocks, undefined);
});

test('unknown generation is recorded and stops; a previously unresolved request never generates again', async () => {
  const failures = [];
  await assert.rejects(runSemanticTranslation({ begin: begin(), requestId: 'synthetic-run',
    translate: async () => { throw Object.assign(new Error('SYNTHETIC_NATIVE_UNKNOWN'), { translationFailure: { code: 'NATIVE_UNKNOWN', origin: 'TRANSPORT', outcome: 'GENERATION_UNKNOWN', retryable: false } }); },
    callTool: async (name, args) => {
      if (name === 'heartbeat_action_attempt') return {};
      if (args.phase === 'NEXT') return delivery(batch());
      if (args.phase === 'RECORD_FAILURE') { failures.push(args); return {}; }
      assert.fail(args.phase);
    } }), /NATIVE_UNKNOWN/u);
  assert.equal(failures.length, 1); assert.equal(failures[0].error.outcome, 'GENERATION_UNKNOWN');
  await assert.rejects(runSemanticTranslation({ begin: begin(), requestId: 'synthetic-resume', translate: () => assert.fail('Unknown request must not regenerate'),
    callTool: async (name) => name === 'heartbeat_action_attempt' ? {} : { action: 'UNRESOLVED_GENERATION' } }), /OUTCOME_UNKNOWN/u);
});

test('complete saved prefix is retained and final assembly retries only the same request', async () => {
  let nextNo = 0; let assembledNo = 0; const phases = [];
  const larger = { ...batch(), blocks: [...batch().blocks, { blockId: 'b2', anchorIds: ['a2'] }] };
  const result = await runSemanticTranslation({ begin: begin(), requestId: 'synthetic-run', translate: async () => execution(),
    callTool: async (name, args) => {
      if (name === 'heartbeat_action_attempt') return {};
      phases.push(args.phase);
      if (args.phase === 'NEXT') return nextNo++ === 0 ? delivery(larger) : { action: 'DONE' };
      if (args.phase === 'SAVE') return { generationRequestRef: 'GEN-1', blocks: [{}] };
      if (args.phase === 'RECORD_FAILURE') { assert.equal(args.error.code, 'TRANSLATION_BATCH_PREFIX_ONLY'); return {}; }
      if (args.phase === 'READ') return {};
      if (args.phase === 'ASSEMBLE') { if (++assembledNo === 1) throw new Error('SYNTHETIC_ASSEMBLY_RESPONSE_LOSS'); return { ...assembled(), completeness: 'PARTIAL' }; }
      assert.fail(args.phase);
    } });
  assert.equal(result.completeness, 'PARTIAL'); assert.equal(assembledNo, 2);
  assert.deepEqual(phases.slice(0, 3), ['NEXT', 'SAVE', 'RECORD_FAILURE']);
});

test('a normal attempt can assemble entirely saved work without attributing a new model call', async () => {
  const result = await runSemanticTranslation({ begin: begin(), requestId: 'synthetic-all-reused',
    translate: () => assert.fail('Persisted work must not regenerate'),
    callTool: async (name, args) => {
      if (name === 'heartbeat_action_attempt') return {};
      if (args.phase === 'NEXT') return { action: 'DONE' };
      if (args.phase === 'ASSEMBLE') return assembled();
      assert.fail(args.phase);
    } });
  assert.equal(result.modelRequestCount, 0);
  assert.equal(result.result.modelVersion, 'host-assembly/no-model-call');
  assert.equal(result.result.skillVersion, WISELINK_SKILL_VERSION);
  assert.deepEqual(JSON.parse(result.result.modelOutput).manifest, assembled().manifest);
});

function begin() {
  const fields = { schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1', actionAttemptId: 'ATT-synthetic', operationRef: 'AQ-synthetic', taskType: 'OPENCLAW_TRANSLATE',
    priority: 1, tenantId: 'tenant-synthetic', workItemId: 'WI-synthetic', inputRevision: 1, baseRevision: 1, documentVersionId: 'dv-synthetic',
    sourceRefs: [{ ref: 'artifact://synthetic/source', sha256: '1'.repeat(64) }], allowedConnectors: [], hostResolvedMissingInputs: [],
    modelInput: { schemaVersion: 'wiselink.3_1.translation_task.v2', workspaceId: 'TW-test' }, executionModel: model,
    deadline: new Date(Date.now() + 600_000).toISOString(), idempotencyKey: 'synthetic-key' };
  return { task: { ...fields, inputHash: canonicalSha256(fields) }, attemptRef: fields.operationRef, leaseToken: '00000000-0000-4000-8000-000000000001', leaseGeneration: 1 };
}
function delivery(value) { const bytes = Buffer.from(JSON.stringify(value)); return { schemaVersion: 'wiselink.3_1.translation_batch_delivery.v2', action: value.purpose,
  workspaceId: value.workspaceId, generationRequestRef: value.generationRequestRef, blockIds: value.blocks.map((block) => block.blockId), targetBlockRevisionId: null,
  targetRowVersion: null, delivery: { partIndex: 0, partCount: 1, byteLength: bytes.length, payloadBase64: bytes.toString('base64') } }; }
function execution() { return { output, actualExecution: { modelRef: model.modelRef, modelVersion: 'synthetic-m3' },
  provenance: { modelVersion: 'synthetic-m3', runMetrics: { inputUnits: 100, outputUnits: 32 } } }; }
function assembled() { return { schemaVersion: 'wiselink.3_1.translation_final_result.v2', workspaceId: 'TW-test', completeness: 'COMPLETE',
  manifest: { workspaceId: 'TW-test', planRevision: 1, contextRevision: 1, workspaceRowVersion: 7, blockRevisions: [{ blockId: 'b1', blockRevisionId: 'TB-synthetic', contentRevision: 1 }] },
  artifact: { storeRole: 'UnifiedArtifactStoreCandidate', ref: 'artifact://synthetic/final', sha256: '2'.repeat(64), byteLength: 1, mediaType: 'application/json' } }; }
