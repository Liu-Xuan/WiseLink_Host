import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalSha256, WISELINK_SKILL_VERSION } from '../scripts/validate-payload.mjs';
import { invokeHostedTranslationBlock, normalizeTranslationCheckSeverity, validateTranslationBlockOutput, validateTranslationSemanticBatch } from '../scripts/invoke-hosted-translation-block.mjs';
import { runSemanticTranslation } from '../scripts/run-semantic-translation.mjs';

const model = { modelRef: 'miaoda/minimax-m3', displayName: 'Synthetic M3', providerKind: 'BUILT_IN', settingsRevision: 1, selectedAt: '2026-09-09T00:00:00.000Z' };
const output = { blocks: [{ blockId: 'b1', elements: [{ kind: 'paragraph', translatedText: '合成示例。', anchorIds: ['a1'] }] }] };
function batch(ref = 'GEN-1') {
  return { schemaVersion: 'wiselink.3_1.translation_semantic_batch.v2', workspaceId: 'TW-test', generationRequestRef: ref, purpose: 'GENERATE',
    blocks: [{ blockId: 'b1', anchorIds: ['a1'] }], anchors: [{ anchorId: 'a1', sourceText: 'Synthetic example.' }], documentContext: { title: 'Synthetic' }, dependencies: {} };
}
function options() { return { gatewayUrl: 'https://synthetic.invalid', gatewayToken: 'synthetic-test-token', gatewayChatCompletionsEnabled: true, executionModel: model, registeredModelRefs: [model.modelRef] }; }
function response(value = output, extra = {}) { return { ok: true, status: 200, text: async () => JSON.stringify({ model: 'synthetic-actual-m3', usage: { prompt_tokens: 100, completion_tokens: 32 },
  choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ type: 'function', function: { name: 'return_wiselink_translation_block', arguments: JSON.stringify({ candidateJson: JSON.stringify(value).replaceAll('"b1"', '"B1"').replaceAll('"a1"', '"A1"').replaceAll('"b2"', '"B2"').replaceAll('"a2"', '"A2"') }) } }] } }], ...extra }) }; }

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
  assert.ok(requests.every((request) => request.tool_choice === 'required' && request.parallel_tool_calls === false));
});

function checkBatch() {
  const blocks = [output.blocks[0], { blockId: 'b2', elements: [{ kind: 'paragraph', translatedText: '第二个完整块。', anchorIds: ['a2'] }] }];
  return { ...batch('GEN-check-batch'), purpose: 'CHECK_BATCH',
    blocks: blocks.map((entry) => ({ blockId: entry.blockId, anchorIds: entry.elements[0].anchorIds })),
    anchors: [...batch().anchors, { anchorId: 'a2', sourceText: 'Second complete block.' }],
    checkCandidates: blocks.map((candidate, index) => ({ blockId: candidate.blockId,
      blockRevisionId: `TB-${index + 1}`, rowVersion: 2, candidate })) };
}

test('one batched check preserves all candidate text and aliases without conflicting output shapes', async () => {
  let request; let count = 0;
  const value = { checks: [{ blockId: 'b1', issues: [] }, { blockId: 'b2', issues: [
    { code: 'SYNTHETIC_WARNING', severity: 'REVIEW', message: 'Synthetic uncertainty', anchorIds: ['a2'] },
  ] }] };
  const result = await invokeHostedTranslationBlock(checkBatch(), options(), { requestGateway: async (_url, init) => {
    count++; request = JSON.parse(init.body); return response(value);
  } });
  assert.equal(count, 1); assert.deepEqual(result.output, value);
  const view = JSON.parse(request.messages[1].content);
  assert.deepEqual(view.previousCandidates.map((entry) => entry.elements[0].translatedText), ['合成示例。', '第二个完整块。']);
  assert.deepEqual(view.previousCandidates.map((entry) => entry.blockId), ['B1', 'B2']);
  assert.ok(!JSON.stringify(view).includes('TB-'));
  assert.ok(request.messages[0].content.includes('Return {checks:'));
  assert.ok(!request.messages[0].content.includes('Return {blockId,issues:'));
  assert.ok(request.messages[0].content.includes('["B1","B2"]'));
  assert.ok(request.messages[0].content.includes('exactly 2 entries'));
});

test('failed checks record the first invalid field without retaining model or source text or redispatching', async () => {
  const empty = { blockId: 'b1', issues: [] };
  const finding = { code: 'SYNTHETIC', severity: 'REVIEW', message: 'Synthetic private candidate text', anchorIds: ['a2'] };
  const cases = [
    [{ checks: [empty] }, '$.checks', 'CHECK_COUNT_MISMATCH'],
    [{ checks: [{ blockId: 'b2', issues: [] }, empty] }, '$.checks[0].blockId', 'BLOCK_ORDER_OR_SCOPE_MISMATCH'],
    [{ checks: [empty, { blockId: 'b2', issues: null }] }, '$.checks[1].issues', 'ARRAY_REQUIRED'],
    [{ checks: [empty, { blockId: 'b2', issues: [{ ...finding, severity: 'WARNING' }] }] }, '$.checks[1].issues[0].severity', 'UNSUPPORTED_SEVERITY'],
    [{ checks: [empty, { blockId: 'b2', issues: [{ ...finding, message: '' }] }] }, '$.checks[1].issues[0].message', 'NONEMPTY_STRING_REQUIRED'],
    [{ checks: [empty, { blockId: 'b2', issues: [{ ...finding, anchorIds: [] }] }] }, '$.checks[1].issues[0].anchorIds', 'NONEMPTY_ANCHOR_ARRAY_REQUIRED'],
    [{ checks: [empty, { blockId: 'b2', issues: [{ ...finding, anchorIds: ['a1'] }] }] }, '$.checks[1].issues[0].anchorIds', 'ANCHOR_OUTSIDE_BLOCK'],
    [{ checks: [empty, { blockId: 'b2', issues: [{ ...finding, ['Synthetic private unexpected key']: true }] }] }, '$.checks[1].issues[0]', 'EXACT_FIELDS_REQUIRED'],
  ];
  for (const [value, path, reason] of cases) {
    let requests = 0;
    const observations = [];
    await assert.rejects(invokeHostedTranslationBlock(checkBatch(), {
      ...options(), observeModelOutput: async (shape, round) => observations.push({ shape, round }),
    }, { requestGateway: async () => { requests++; return response(value); } }), /TRANSLATION_(?:SEMANTIC_REVIEW_INVALID|OUTPUT_KEYS_INVALID)/u);
    assert.equal(requests, 1);
    assert.equal(observations.length, 2);
    assert.equal(observations[1].round, 2);
    assert.equal(observations[1].shape.stage, 'OUTPUT_VALIDATION');
    assert.equal(observations[1].shape.validation.path, path);
    assert.equal(observations[1].shape.validation.reason, reason);
    assert.ok(!JSON.stringify(observations).includes('Synthetic private'));
    assert.ok(!JSON.stringify(observations).includes('Second complete block.'));
  }
});

test('a 29-block check accepts equivalent severity casing while retaining the blocking finding and every binding', async () => {
  const source = checkBatch();
  source.blocks = Array.from({ length: 29 }, (_, index) => ({ blockId: `b${index + 1}`, anchorIds: [`a${index + 1}`] }));
  source.anchors = source.blocks.map((block, index) => ({ anchorId: block.anchorIds[0], sourceText: `Synthetic source ${index + 1}.` }));
  source.checkCandidates = source.blocks.map((block, index) => ({ blockId: block.blockId, blockRevisionId: `TB-${index + 1}`, rowVersion: 2,
    candidate: { blockId: block.blockId, elements: [{ kind: 'paragraph', translatedText: `合成译文 ${index + 1}。`, anchorIds: block.anchorIds }] } }));
  const modelOutput = { checks: source.blocks.map((_block, index) => ({ blockId: `B${index + 1}`, issues: index === 7 ? [
    { code: 'SYNTHETIC_NEGATION_CHANGED', severity: 'block', message: 'Synthetic condition was changed.', anchorIds: ['A8'] },
  ] : [] })) };
  let calls = 0;
  const result = await invokeHostedTranslationBlock(source, options(), { requestGateway: async () => { calls++; return response(modelOutput); } });
  assert.equal(calls, 1);
  assert.deepEqual(result.output.checks.map((check) => check.blockId), source.blocks.map((block) => block.blockId));
  assert.deepEqual(result.output.checks[7].issues, [
    { code: 'SYNTHETIC_NEGATION_CHANGED', severity: 'BLOCK', message: 'Synthetic condition was changed.', anchorIds: ['a8'] },
  ]);
  assert.equal(modelOutput.checks[7].issues[0].severity, 'block');
  for (const severity of ['warning', ' BLOCK ', '', null]) {
    const raw = { blockId: 'b1', issues: [{ code: 'TEST', severity, message: 'Synthetic', anchorIds: ['a1'] }] };
    assert.throws(() => validateTranslationBlockOutput({ purpose: 'CHECK', blocks: source.blocks.slice(0, 1) }, normalizeTranslationCheckSeverity('CHECK', raw)), /SEMANTIC_REVIEW_INVALID/u);
  }
});

test('batched checks reject missing, reordered or cross-block results and changed target mappings', () => {
  const source = checkBatch();
  const checks = [{ blockId: 'b1', issues: [] }, { blockId: 'b2', issues: [] }];
  validateTranslationSemanticBatch(source); validateTranslationBlockOutput(source, { checks });
  for (const invalid of [{ checks: checks.slice(0, 1) }, { checks: [...checks].reverse() },
    { checks: [checks[0], { blockId: 'b2', issues: [{ code: 'TEST', severity: 'BLOCK', message: 'Synthetic', anchorIds: ['a1'] }] }] }])
    assert.throws(() => validateTranslationBlockOutput(source, invalid), /SEMANTIC_REVIEW_INVALID/u);
  assert.throws(() => validateTranslationSemanticBatch({ ...source, checkCandidates: [...source.checkCandidates].reverse() }), /TARGET_REQUIRED/u);
});

test('a stop response without the required function remains rejected and records only bounded shape', async () => {
  const observed = []; let count = 0;
  await assert.rejects(invokeHostedTranslationBlock(batch(), { ...options(), observeModelOutput: async (shape) => observed.push(shape) },
    { requestGateway: async () => { count++; return response(output, { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Synthetic non-candidate response' } }] }); } }),
    /OUTPUT_CHANNEL_INVALID/u);
  assert.equal(count, 1); assert.equal(observed[0].toolCall.count, 0);
  assert.equal(observed[0].assistantContent.type, 'string'); assert.equal(observed[0].assistantContent.isBlank, false);
  assert.ok(!JSON.stringify(observed).includes('Synthetic non-candidate response'));
});

test('batch-check response loss repeats exactly one save while retaining one model call', async () => {
  const source = checkBatch(); const checks = source.blocks.map((entry) => ({ blockId: entry.blockId, issues: [] }));
  let nextNo = 0; let requests = 0; const saves = [];
  await runSemanticTranslation({ begin: begin(), requestId: 'synthetic-batch-check',
    translate: async () => { requests++; return { ...execution(), output: { checks } }; },
    callTool: async (name, args) => {
      if (name === 'heartbeat_action_attempt') return {};
      if (args.phase === 'NEXT') { assert.equal(args.batchSemanticChecks, true); return nextNo++ === 0 ? delivery(source) : { action: 'DONE' }; }
      if (args.phase === 'READ') return {};
      if (args.phase === 'CHECK_BATCH') {
        saves.push(args); if (saves.length === 1) throw new Error('SYNTHETIC_CHECK_SAVE_RESPONSE_LOSS');
        return { generationRequestRef: source.generationRequestRef, blocks: source.checkCandidates.map(({ candidate: _candidate, ...target }) => target) };
      }
      if (args.phase === 'ASSEMBLE') return assembled(); assert.fail(args.phase);
    } });
  assert.equal(requests, 1); assert.deepEqual(saves[0], saves[1]); assert.deepEqual(saves[0].semanticReviews, checks);
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
  ...(value.checkCandidates ? { checkTargets: value.checkCandidates.map(({ candidate: _candidate, ...target }) => target) } : {}),
  targetRowVersion: null, delivery: { partIndex: 0, partCount: 1, byteLength: bytes.length, payloadBase64: bytes.toString('base64') } }; }
function execution() { return { output, actualExecution: { modelRef: model.modelRef, modelVersion: 'synthetic-m3' },
  provenance: { modelVersion: 'synthetic-m3', runMetrics: { inputUnits: 100, outputUnits: 32 } } }; }
function assembled() { return { schemaVersion: 'wiselink.3_1.translation_final_result.v2', workspaceId: 'TW-test', completeness: 'COMPLETE',
  manifest: { workspaceId: 'TW-test', planRevision: 1, contextRevision: 1, workspaceRowVersion: 7, blockRevisions: [{ blockId: 'b1', blockRevisionId: 'TB-synthetic', contentRevision: 1 }] },
  artifact: { storeRole: 'UnifiedArtifactStoreCandidate', ref: 'artifact://synthetic/final', sha256: '2'.repeat(64), byteLength: 1, mediaType: 'application/json' } }; }
