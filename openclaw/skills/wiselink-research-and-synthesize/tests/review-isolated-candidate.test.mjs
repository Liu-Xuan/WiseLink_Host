import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { callJsonTool, reviewCliModelOptions, runHostedReviewTurn } from '../scripts/run-hosted-review-turn.mjs';
import { buildTemporaryGatewayConfig } from '../scripts/native-temporary-review-gateway.mjs';
import { canonicalSha256, WISELINK_HOST_MCP_NAME,
  WISELINK_HOST_MCP_VERSION } from '../scripts/validate-payload.mjs';
import { packet, record } from './fixtures/source-statement-v2-wire.fixture.mjs';

const modelRef = 'miaoda/glm-5.3';
const sourceRefId = 'doc:fixture-1';
const source = { sourceRefId, evidenceRef: sourceRefId, kind: 'DOCUMENT_PASSAGE',
  title: 'Fixture passage', versionLabel: 'frozen-v1', excerpt: '原文确认测试范围。',
  locator: 'page 1' };
const catalog = { ...source, workItemId: 'WI-control-plane-only' };
delete catalog.sourceRefId;
const document = { ref: sourceRefId, kind: source.kind, title: source.title,
  versionLabel: source.versionLabel, locator: source.locator };
const artifactRef = 'artifact://fixture/document-1';
const artifactSha256 = 'a'.repeat(64);
const candidate = { answer: '已根据原文形成未保存候选。', sourceRefs: [sourceRefId],
  jobAidWorkingDelta: { schemaVersion: 'wiselink.jobaid-problem-work.v3',
    completionReason: '已核对该段，其他事项待评估。', changeSummary: '补充测试范围判断。',
    issues: [{ issueKey: 'risk', question: '测试范围是什么？',
      body: `测试范围已由原文确认。[[${sourceRefId}]]`, riskScenarios: [],
      measures: [], otherClassifications: [], openQuestions: [],
      requirementHandling: [] }] } };

test('temporary Gateway config has one loopback GLM route and no resolved credential', () => {
  const config = buildTemporaryGatewayConfig({
    profile: { apiKeyRef: { source: 'file', provider: 'official-file', id: '/models/providers/miaoda/apiKey' },
      timeoutSeconds: 120,
      model: { id: 'glm-5.3', name: 'GLM 5.3', input: ['text'],
        contextWindow: 128000, maxTokens: 8192 } },
    baseUrl: 'http://127.0.0.1:19472', nonce: 'a'.repeat(64),
    port: 19473, workspace: '/private/tmp/isolated-review-workspace',
    deadlineAt: Date.now() + 480_000,
  });
  assert.equal(config.gateway.bind, 'loopback');
  assert.equal(config.gateway.auth.mode, 'token');
  assert.deepEqual(config.gateway.auth.token,
    { source: 'env', provider: 'default', id: 'WL_REVIEW_GATEWAY_TOKEN' });
  assert.equal(config.gateway.http.endpoints.chatCompletions.enabled, true);
  assert.equal(config.plugins.enabled, false);
  assert.deepEqual(config.tools, { profile: 'minimal', deny: ['session_status'] });
  assert.equal(config.models.providers.miaoda.api, 'openai-completions');
  assert.equal(config.models.providers.miaoda.baseUrl, 'http://127.0.0.1:19472/v1');
  assert.deepEqual(config.models.providers.miaoda.apiKey,
    { source: 'env', provider: 'default', id: 'WL_REVIEW_UPSTREAM_KEY' });
  assert.equal(config.models.providers.miaoda.headers['x-wiselink-attempt-nonce'],
    'a'.repeat(64));
  assert.deepEqual(Object.keys(config.models.providers), ['miaoda']);
  assert.equal(config.models.providers.miaoda.timeoutSeconds, 120);
  assert.deepEqual(config.agents.list.map((agent) => agent.id), ['wiselink-engineering']);
  assert.deepEqual(config.agents.list[0].model,
    { primary: modelRef, fallbacks: [] });
  assert.deepEqual(config.agents.defaults.models[modelRef], {});
  const extended = buildTemporaryGatewayConfig({
    profile: { timeoutSeconds: 120,
      model: { id: 'glm-5.3', contextWindow: 200000, maxTokens: 64000 } },
    baseUrl: 'http://127.0.0.1:19472', nonce: 'a'.repeat(64),
    port: 19473, workspace: '/private/tmp/isolated-review-workspace',
    deadlineAt: Date.now() + 1_800_000, providerTimeoutSeconds: 1800,
  });
  assert(extended.models.providers.miaoda.timeoutSeconds > 120);
  assert(extended.models.providers.miaoda.timeoutSeconds <= 1800);
  assert.deepEqual(extended.models.providers.miaoda.models,
    [{ id: 'glm-5.3', contextWindow: 200000, maxTokens: 64000 }]);
  const low = buildTemporaryGatewayConfig({
    profile: { timeoutSeconds: 120,
      model: { id: 'glm-5.3', contextWindow: 200000, maxTokens: 64000 } },
    baseUrl: 'http://127.0.0.1:19472', nonce: 'a'.repeat(64),
    port: 19473, workspace: '/private/tmp/isolated-review-workspace',
    deadlineAt: Date.now() + 480_000, reasoningEffort: 'low',
  });
  assert.deepEqual(low.agents.defaults.models[modelRef], {
    params: { extra_body: { reasoning_effort: 'low' } },
  });
  assert.deepEqual(low.models.providers.miaoda.models, extended.models.providers.miaoda.models);
  assert.throws(() => buildTemporaryGatewayConfig({
    profile: { timeoutSeconds: 120,
      model: { id: 'glm-5.3', contextWindow: 200000, maxTokens: 64000 } },
    baseUrl: 'http://127.0.0.1:19472', nonce: 'a'.repeat(64),
    port: 19473, workspace: '/private/tmp/isolated-review-workspace',
    deadlineAt: Date.now() + 480_000, reasoningEffort: 'off',
  }), /NATIVE_GATEWAY_REASONING_EFFORT_INVALID/u);
});

async function fixture(t, overrides = {}) {
  const reviewTask = JSON.parse(await readFile(new URL('./fixtures/review-turn-task.c2.json',
    import.meta.url), 'utf8'));
  reviewTask.schemaVersion = 'wiselink.3_1.review_turn_task.v1.c5';
  reviewTask.selectedEvaluationItemId = null;
  reviewTask.allowedEvaluationItemIds = [];
  reviewTask.allowedAdoptedInputRefs = [];
  reviewTask.resourceRefs = [{ sourceRefId, resourceArtifactRef: artifactRef,
    resourceArtifactSha256: artifactSha256, value: structuredClone(source) }];
  reviewTask.jobAidContext = { schemaVersion: 'wiselink.jobaid-problem-task.v2',
    sourceCatalog: [structuredClone(catalog)], sourceBindings: [{ workItemId: catalog.workItemId,
      artifactRef, artifactSha256 }], initiallyDeliveredRefs: [],
    modelInput: { purpose: 'PROBLEM_REVIEW', availableSources: [structuredClone(document)],
      deliveredEvidence: [], previousWork: { content: { issues: [] } } },
    previousWork: { content: { issues: [] } } };
  reviewTask.context.purpose = 'UPDATE_ASSESSMENT';
  reviewTask.context.problemAssessment = structuredClone(reviewTask.jobAidContext.modelInput);
  reviewTask.executionPolicy.toolPolicyRef =
    `${WISELINK_HOST_MCP_NAME}@${WISELINK_HOST_MCP_VERSION}#interactive-jobaid-review-c5`;
  if (overrides.nativeSessionKey) reviewTask.actorContextRef = 'ACTX-RS-isolated-fixture';
  overrides.mutateReviewTask?.(reviewTask);
  Object.assign(reviewTask, overrides.reviewTask ?? {});
  const unsealed = { schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
    actionAttemptId: 'ATT-isolated-fixture', operationRef: 'AQ-isolated-fixture',
    taskType: 'OPENCLAW_INTERACTIVE_REVIEW', priority: 100,
    tenantId: 'tenant-control-plane', workItemId: reviewTask.context.workItem.workItemId,
    inputRevision: reviewTask.inputRevision, baseRevision: reviewTask.inputRevision,
    documentVersionId: reviewTask.context.workItem.documentVersionId,
    sourceRefs: reviewTask.resourceRefs.map((item) => ({ ref: item.resourceArtifactRef,
      sha256: item.resourceArtifactSha256 })),
    allowedConnectors: [], hostResolvedMissingInputs: [], modelInput: reviewTask,
    deadline: overrides.taskDeadline ?? new Date(Date.now() + 30 * 60_000).toISOString(),
    idempotencyKey: 'fixture:isolated',
    executionModel: { modelRef, displayName: 'Fixture GLM', providerKind: 'BUILT_IN',
      settingsRevision: 2, selectedAt: '2026-09-06T00:00:00.000Z' } };
  const task = { ...unsealed, inputHash: canonicalSha256(unsealed) };
  const checkpointDir = await mkdtemp(join(tmpdir(), 'wiselink-isolated-review-'));
  t.after(() => rm(checkpointDir, { recursive: true, force: true }));
  const calls = [];
  const bodies = [];
  const callTool = async (name, args, requestOptions) => {
    calls.push({ name, args, requestOptions });
    assert.ok(requestOptions?.signal instanceof AbortSignal);
    assert.ok(Number.isSafeInteger(requestOptions.timeout));
    assert.ok(requestOptions.timeout > 0 && requestOptions.timeout <= 120_000);
    if (['begin_review_turn', 'get_review_turn_context', 'read_source_refs',
      'heartbeat_action_attempt'].includes(name))
      assert.equal(args.workItemId, overrides.expectedRequestWorkItemId ??
        reviewTask.context.workItem.workItemId);
    if (name === 'begin_review_turn') return {
      attemptRef: task.operationRef, status: overrides.status ?? 'RUNNING', task,
      leaseToken: 'fixture-token', leaseGeneration: 3,
      leaseExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      ...(overrides.nativeSessionKey ? {
        nativeSessionKey: `agent:wiselink-engineering:review:${reviewTask.actorContextRef}` } : {}),
      ...(overrides.status === 'COMMITTING' ? { recoveryResult: {} } : {}),
    };
    if (name === 'get_review_turn_context') return {
      schemaVersion: 'wiselink.3_1.review_turn_context.v1.c2',
      attemptRef: overrides.contextAttemptRef ?? task.operationRef,
      reviewConversationRef: reviewTask.reviewConversationRef,
      reviewTurnRef: reviewTask.reviewTurnRef,
      mode: 'INTERACTIVE_REVIEW', selectedEvaluationItemId: null,
      inputRevision: reviewTask.inputRevision,
      allowedOperations: reviewTask.allowedOperations,
      resourceRefs: reviewTask.resourceRefs.map(({ sourceRefId, resourceArtifactRef,
        resourceArtifactSha256 }) => ({ sourceRefId, resourceArtifactRef,
        resourceArtifactSha256 })),
      context: reviewTask.context, executionPolicy: reviewTask.executionPolicy,
    };
    if (name === 'read_source_refs') {
      if (overrides.hangRead) await new Promise((_, reject) => {
        requestOptions.signal.addEventListener('abort', () =>
          reject(requestOptions.signal.reason), { once: true });
      });
      overrides.onRead?.();
      return {
      schemaVersion: 'wiselink.3_1.review_source_refs.v1.c2',
      attemptRef: overrides.readAttemptRef ?? task.operationRef,
      sourceRefs: overrides.readSources ?? args.sourceRefIds.map((id) =>
        reviewTask.resourceRefs.find((item) => item.sourceRefId === id)?.value),
      };
    }
    if (name === 'heartbeat_action_attempt') {
      if (overrides.heartbeatFailure) throw new Error('HOST_LEASE_LOST');
      overrides.onHeartbeat?.();
      return { leaseExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString() };
    }
    assert.fail(`unexpected Host mutation ${name}`);
  };
  const requestGateway = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    if (typeof overrides.gateway === 'function') return overrides.gateway(init);
    return overrides.response ?? Response.json({ model: modelRef, choices: [{
      message: { content: null, tool_calls: [{ id: 'candidate-1', type: 'function',
        function: { name: 'return_wiselink_review_candidate',
          arguments: JSON.stringify(candidate) } }] }, finish_reason: 'tool_calls',
    }] });
  };
  const options = { workItemId: reviewTask.context.workItem.workItemId,
    reviewConversationRef: reviewTask.reviewConversationRef,
    requestId: reviewTask.requestId, checkpointDir,
    isolatedCandidate: true, timeoutMs: 480_000,
    maxCompletionTokens: 8192, maxModelRequests: 1 };
  const dependencies = { callTool, requestGateway,
    modelRuntime: { gatewayChatCompletionsEnabled: true,
      gatewayUrl: 'https://official.invalid', gatewayToken: 'fixture-only',
      configuredModelVersion: 'fixture/provider', registeredModelRefs: [modelRef] } };
  return { options, dependencies, calls, bodies, reviewTask, task };
}

function gatewayTool(name, args, finishReason = 'tool_calls') {
  return Response.json({ model: modelRef, choices: [{
    message: { content: null, tool_calls: [{ id: 'fixture-tool', type: 'function',
      function: { name, arguments: JSON.stringify(args) } }] },
    finish_reason: finishReason,
  }] });
}

test('CLI model projection preserves Hosted Gateway readiness before isolated Host begin',
  async (t) => {
    const ready = await fixture(t);
    ready.dependencies.modelRuntime = reviewCliModelOptions(
      ready.dependencies.modelRuntime, {}, []);
    assert.equal(ready.dependencies.modelRuntime.gatewayChatCompletionsEnabled, true);
    const result = await runHostedReviewTurn(ready.options, ready.dependencies);
    assert.equal(result.outcome, 'CANDIDATE_NOT_SAVED');
    assert.equal(ready.calls[0]?.name, 'begin_review_turn');
    assert.equal(ready.bodies.length, 1);
    assert.equal(ready.calls.some(({ name }) => name === 'commit_review_turn_candidate'), false);

    for (const flag of [false, undefined]) {
      const disabled = await fixture(t);
      disabled.dependencies.modelRuntime = reviewCliModelOptions({
        ...disabled.dependencies.modelRuntime,
        gatewayChatCompletionsEnabled: flag,
      }, {}, []);
      assert.equal(disabled.dependencies.modelRuntime.gatewayChatCompletionsEnabled, flag);
      await assert.rejects(runHostedReviewTurn(disabled.options, disabled.dependencies),
        /REVIEW_GATEWAY_CHAT_COMPLETIONS_DISABLED/u);
      assert.equal(disabled.calls.length, 0);
      assert.equal(disabled.bodies.length, 0);
    }
  });

async function failsBeforeModel(t, overrides, code) {
  const f = await fixture(t, overrides);
  await assert.rejects(runHostedReviewTurn(f.options, f.dependencies), code);
  assert.equal(f.bodies.length, 0);
  assert.equal(f.calls.some(({ name }) => name === 'commit_review_turn_candidate'), false);
  return f;
}

test('isolated Review reads complete Host source and returns an unsaved candidate', async (t) => {
  const f = await fixture(t);
  const result = await runHostedReviewTurn(f.options, f.dependencies);
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'CANDIDATE_NOT_SAVED');
  assert.equal(result.authorityMutations.reviewCandidatePersisted, false);
  assert.equal(result.hostAttemptRef, f.task.operationRef);
  assert.equal(result.hostWorkItemId, f.options.workItemId);
  assert.equal(result.hostReviewTurnRef, f.reviewTask.reviewTurnRef);
  assert.equal(result.hostAttemptStatusAtCandidate, 'RUNNING');
  assert.equal(result.candidate.jobAidWorkingDelta.issues[0].issueKey, 'risk');
  assert.deepEqual(f.calls.map(({ name }) => name), [
    'begin_review_turn', 'get_review_turn_context', 'read_source_refs',
    'heartbeat_action_attempt',
  ]);
  assert.deepEqual(f.bodies[0].tools.map((tool) => tool.function.name),
    ['return_wiselink_review_candidate']);
  assert.equal(f.bodies[0].max_completion_tokens, 8192);
  const delivered = JSON.parse(f.bodies[0].messages[1].content.split('\n').slice(1).join('\n'));
  assert.deepEqual(delivered.sourceRefs, [source]);
  assert.deepEqual(delivered.input.context.problemAssessment.previousWork,
    f.reviewTask.context.problemAssessment.previousWork);
  assert.deepEqual(delivered.input.context.problemAssessment.availableSources, [document]);
  assert.equal((await runHostedReviewTurn(f.options, f.dependencies)).outcome,
    'CANDIDATE_NOT_SAVED');
  assert.equal(f.bodies.length, 1);
  await assert.rejects(runHostedReviewTurn({ ...f.options, maxCompletionTokens: 8191 },
    f.dependencies), /REVIEW_CHECKPOINT_BINDING_MISMATCH/u);
  await assert.rejects(runHostedReviewTurn({ ...f.options, isolatedCandidate: false }, {
    ...f.dependencies, invokeModel: async () => assert.fail('must not run model'),
  }), /REVIEW_CHECKPOINT_BINDING_MISMATCH/u);
});

test('lazy Gateway starts only after the sealed Host begin and closes with a bounded receipt', async (t) => {
  const f = await fixture(t, { nativeSessionKey: true });
  f.options.reasoningEffort = 'low';
  delete f.dependencies.modelRuntime.gatewayUrl;
  delete f.dependencies.modelRuntime.gatewayToken;
  let prepared = 0;
  let closed = 0;
  f.dependencies.prepareGateway = async (binding) => {
    prepared += 1;
    assert.equal(f.calls[0].name, 'begin_review_turn');
    assert.equal(binding.attemptRef, f.task.operationRef);
    assert.equal(binding.workItemId, f.options.workItemId);
    assert.equal(binding.nativeSessionKey,
      `agent:wiselink-engineering:review:${f.reviewTask.actorContextRef}`);
    assert.equal(binding.executionModel.modelRef, modelRef);
    assert.equal(binding.reasoningEffort, 'low');
    assert.ok(Date.parse(binding.deadlineAt) > Date.now());
    return { gatewayUrl: 'http://127.0.0.1:19471', gatewayToken: 'temporary',
      configuredModelVersion: 'untrusted/override',
      close: async () => { closed += 1; },
      getSanitizedReceipt: () => ({ attemptRef: binding.attemptRef,
        modelId: 'glm-5.3', maxCompletionTokens: binding.maxCompletionTokens,
        maxModelRequests: binding.maxModelRequests,
        expectedReasoningEffort: binding.reasoningEffort,
        observedReasoningEffort: f.bodies.length ? 'LOW' : null,
        absoluteDeadline: binding.deadlineAt,
        upstreamDispatchCount: f.bodies.length,
        dispatches: f.bodies.map((_, index) => ({ ordinal: index + 1,
          actualCompletionTokens: f.bodies[index].max_completion_tokens,
          upstreamHttpStatus: 200, transportCompleted: true,
          providerKnownTerminal: true, finishReason: 'tool_calls',
          outcome: 'PROVIDER_TERMINAL' })),
        activeOrdinal: null, unknownTerminal: false,
        upstreamHttpStatus: f.bodies.length ? 200 : null,
        transportCompleted: Boolean(f.bodies.length),
        providerStopConfirmed: Boolean(f.bodies.length),
        outcome: f.bodies.length ? 'PROVIDER_TERMINAL' : 'CREATED',
        finishedAt: new Date().toISOString() }) };
  };
  const result = await runHostedReviewTurn(f.options, f.dependencies);
  assert.equal(result.outcome, 'CANDIDATE_NOT_SAVED');
  assert.equal(prepared, 1);
  assert.equal(closed, 1);
  assert.equal(f.bodies.length, 1);
  const receipt = JSON.parse(await readFile(join(f.options.checkpointDir,
    'gateway-prepare.receipt.json'), 'utf8'));
  assert.equal(receipt.attemptRef, f.task.operationRef);
  assert.equal(receipt.expectedReasoningEffort, 'low');
  assert.equal(receipt.observedReasoningEffort, 'LOW');
  assert.equal(receipt.configuredModelVersion, undefined);
  const assembly = JSON.parse(await readFile(join(f.options.checkpointDir,
    'model.isolated-assembly-1.json'), 'utf8'));
  const response = JSON.parse(await readFile(join(f.options.checkpointDir,
    'model.isolated-response-1.json'), 'utf8'));
  assert.equal(assembly.assembledBodySha256.length, 64);
  assert.equal(assembly.assembledBodyBytes, Buffer.byteLength(
    JSON.stringify(f.bodies[0])));
  assert.deepEqual(assembly.assembledSourceRefIds, [sourceRefId]);
  assert.deepEqual(response.deliveredSourceRefIds, [sourceRefId]);
  assert.deepEqual(response.actualProviderDispatchOrdinals, [1]);
  assert.equal(response.reportedUsage, null);
});

test('missing actual effort is reported before any provider dispatch', async (t) => {
  const f = await fixture(t, { nativeSessionKey: true,
    response: Response.json({ error: { code: 'ADAPTER_REASONING_EFFORT_MISMATCH' } },
      { status: 400 }) });
  f.options.reasoningEffort = 'low';
  f.dependencies.prepareGateway = async (binding) => ({
    gatewayUrl: 'http://127.0.0.1:19471', gatewayToken: 'temporary',
    close: async () => {},
    getSanitizedReceipt: () => ({
      attemptRef: binding.attemptRef, modelId: 'glm-5.3',
      maxCompletionTokens: binding.maxCompletionTokens,
      maxModelRequests: binding.maxModelRequests,
      expectedReasoningEffort: 'low',
      observedReasoningEffort: f.bodies.length ? 'ABSENT' : null,
      absoluteDeadline: binding.deadlineAt, upstreamDispatchCount: 0,
      dispatches: [], activeOrdinal: null, unknownTerminal: false,
      upstreamHttpStatus: null, transportCompleted: false,
      providerStopConfirmed: false,
      outcome: f.bodies.length ? 'INVALID_REQUEST_CLOSED' : 'CREATED',
      finishedAt: f.bodies.length ? new Date().toISOString() : null,
    }),
  });
  await assert.rejects(runHostedReviewTurn(f.options, f.dependencies),
    /REVIEW_PROVIDER_REASONING_EFFORT_NOT_APPLIED/u);
  assert.equal(f.bodies.length, 1);
  assert.equal(f.calls.some(({ name }) => name === 'commit_review_turn_candidate'), false);
});

test('failed lazy preparation is non-replayable and never calls the model', async (t) => {
  const f = await fixture(t);
  delete f.dependencies.modelRuntime.gatewayUrl;
  delete f.dependencies.modelRuntime.gatewayToken;
  let prepared = 0;
  f.dependencies.prepareGateway = async () => { prepared += 1;
    throw new Error('PREPARE_FAILED'); };
  await assert.rejects(runHostedReviewTurn(f.options, f.dependencies), /PREPARE_FAILED/u);
  assert.equal(prepared, 1);
  assert.equal(f.bodies.length, 0);
  await assert.rejects(runHostedReviewTurn(f.options, f.dependencies),
    /REVIEW_ISOLATED_CHECKPOINT_NOT_FRESH/u);
  assert.equal(prepared, 1);
  assert.equal(f.calls.some(({ name }) => name === 'commit_review_turn_candidate'), false);
});

test('invalid prepared route closes before model dispatch', async (t) => {
  const f = await fixture(t);
  delete f.dependencies.modelRuntime.gatewayUrl;
  delete f.dependencies.modelRuntime.gatewayToken;
  let closed = 0;
  f.dependencies.prepareGateway = async () => ({ gatewayUrl: 'https://other.invalid',
    gatewayToken: 'temporary', close: async () => { closed += 1; } });
  await assert.rejects(runHostedReviewTurn(f.options, f.dependencies),
    /REVIEW_GATEWAY_PREPARATION_INVALID/u);
  assert.equal(closed, 1);
  assert.equal(f.bodies.length, 0);
});

test('deadline reached during lazy preparation closes and dispatches nothing',
  { timeout: 5_000 }, async (t) => {
  const f = await fixture(t);
  f.task.deadline = new Date(Date.now() + 2_000).toISOString();
  const unsealedTask = { ...f.task };
  delete unsealedTask.inputHash;
  f.task.inputHash = canonicalSha256(unsealedTask);
  delete f.dependencies.modelRuntime.gatewayUrl;
  delete f.dependencies.modelRuntime.gatewayToken;
  let prepared = 0;
  let closed = 0;
  let markClosed;
  const closeCompleted = new Promise((resolve) => { markClosed = resolve; });
  let prepareSignal;
  let markPreparationStarted;
  const preparationStarted = new Promise((resolve) => { markPreparationStarted = resolve; });
  let releasePreparation;
  const preparationHeld = new Promise((resolve) => { releasePreparation = resolve; });
  f.dependencies.prepareGateway = async ({ signal }) => {
    prepared += 1;
    prepareSignal = signal;
    markPreparationStarted();
    await preparationHeld;
    return { gatewayUrl: 'http://127.0.0.1:19471', gatewayToken: 'temporary',
      close: async () => { closed += 1; markClosed(); } };
  };
  const turn = runHostedReviewTurn(f.options, f.dependencies);
  const first = await Promise.race([
    preparationStarted.then(() => 'preparation-started'),
    turn.then(() => 'turn-completed', () => 'turn-failed'),
  ]);
  assert.equal(first, 'preparation-started');
  assert.equal(prepared, 1);
  assert.equal(prepareSignal.aborted, false);
  await assert.rejects(turn, /REVIEW_ISOLATED_TIMEOUT/u);
  assert.equal(prepareSignal.aborted, true);
  releasePreparation();
  let closeTimer;
  try {
    await Promise.race([closeCompleted, new Promise((_, reject) => {
      closeTimer = setTimeout(() => reject(new Error('LATE_GATEWAY_CLOSE_TIMEOUT')), 1_000);
    })]);
  } finally { clearTimeout(closeTimer); }
  assert.equal(closed, 1);
  assert.equal(f.bodies.length, 0);
  assert.equal(f.calls.some(({ name }) => name === 'commit_review_turn_candidate'), false);
});

test('isolated Host RPC options are passed at either supported SDK position', async () => {
  const options = { timeout: 120_000, signal: new AbortController().signal };
  for (const position of [2, 3]) {
    const calls = [];
    const client = { callTool: async (...args) => {
      calls.push(args);
      throw new Error('SDK_SENTINEL');
    } };
    await assert.rejects(callJsonTool(client, 'read_source_refs',
      { workItemId: 'WI-fixture' }, options, position), /SDK_SENTINEL/u);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][position - 1], options);
  }
  await assert.rejects(callJsonTool({ callTool: () => assert.fail('must not dispatch') },
    'commit_review_turn_candidate', { workItemId: 'WI-fixture' }, options),
  /REVIEW_HOST_MCP_REQUEST_OPTIONS_INVALID/u);
});

test('isolated route agent must match the Host native session before Gateway dispatch', async (t) => {
  const f = await fixture(t, { nativeSessionKey: true });
  f.dependencies.modelRuntime.agentId = 'other-agent';
  await assert.rejects(runHostedReviewTurn(f.options, f.dependencies),
    /REVIEW_NATIVE_SESSION_BINDING_INVALID/u);
  assert.equal(f.bodies.length, 0);
  assert.equal(f.calls.some(({ name }) => name === 'commit_review_turn_candidate'), false);
});

test('failed isolated checkpoint cannot resume as ordinary Review', async (t) => {
  const f = await fixture(t, { readSources: [] });
  await assert.rejects(runHostedReviewTurn(f.options, f.dependencies),
    /HOST_MCP_REVIEW_SOURCE_REF_READBACK_INVALID/u);
  const priorCalls = f.calls.length;
  let modelCalls = 0;
  await assert.rejects(runHostedReviewTurn({ ...f.options, isolatedCandidate: false }, {
    ...f.dependencies, invokeModel: async () => { modelCalls += 1; return {}; },
  }), /REVIEW_CHECKPOINT_MODE_BINDING_MISMATCH/u);
  assert.equal(f.calls.length, priorCalls);
  assert.equal(modelCalls, 0);
  assert.equal(f.calls.some(({ name }) => name === 'commit_review_turn_candidate'), false);
});

test('expired task and abortable Host read stop before Gateway dispatch', async (t) => {
  await failsBeforeModel(t, { taskDeadline: new Date(Date.now() - 1_000).toISOString() },
    /REVIEW_ISOLATED_TIMEOUT/u);
  const f = await fixture(t, { taskDeadline: new Date(Date.now() + 100).toISOString(),
    hangRead: true });
  let watchdog;
  try {
    await Promise.race([
      assert.rejects(runHostedReviewTurn(f.options, f.dependencies),
        /REVIEW_ISOLATED_TIMEOUT/u),
      // Keep the event loop alive for AbortSignal.timeout's unref'd timer. This
      // guard only fails a hung test; the Host read still ends on its signal.
      new Promise((_, reject) => {
        watchdog = setTimeout(() => reject(new Error('HOST_READ_ABORT_NOT_OBSERVED')),
          2_000);
      }),
    ]);
  } finally {
    clearTimeout(watchdog);
  }
  assert.equal(f.bodies.length, 0);
  assert.deepEqual(f.calls.map(({ name }) => name),
    ['begin_review_turn', 'get_review_turn_context', 'read_source_refs']);
});

test('isolated Review requires explicit budgets and rejects caller preload data', async (t) => {
  for (const change of [{ workItemId: undefined }, { maxModelRequests: 0 },
    { maxCompletionTokens: undefined },
    { timeoutMs: 0 }, { reasoningEffort: 'off' },
    { preloadedSources: [source] }]) {
    const f = await fixture(t);
    await assert.rejects(runHostedReviewTurn({ ...f.options, ...change }, f.dependencies),
      /REVIEW_WORK_ITEM_ID_REQUIRED|REVIEW_MAX_MODEL_REQUESTS_INVALID|REVIEW_ISOLATED_TIMEOUT_INVALID|REVIEW_ISOLATED_BUDGET_REQUIRED|REVIEW_REASONING_EFFORT_INVALID|REVIEW_ISOLATED_PRELOAD_FORBIDDEN/u);
    assert.equal(f.calls.length, 0);
  }
  const f = await fixture(t);
  await assert.rejects(runHostedReviewTurn(f.options, {
    ...f.dependencies, modelRuntime: { ...f.dependencies.modelRuntime,
      preloadedSources: [source] },
  }), /REVIEW_ISOLATED_PRELOAD_FORBIDDEN/u);
  assert.equal(f.calls.length, 0);
});

test('old or cancelled Host state and wrong attempt stop before model', async (t) => {
  const wrongWorkItem = await fixture(t, { expectedRequestWorkItemId: 'WI-wrong' });
  await assert.rejects(runHostedReviewTurn({ ...wrongWorkItem.options,
    workItemId: 'WI-wrong' }, wrongWorkItem.dependencies),
  /REVIEW_ISOLATED_WORK_ITEM_BINDING_MISMATCH/u);
  assert.deepEqual(wrongWorkItem.calls.map(({ name }) => name), ['begin_review_turn']);
  await failsBeforeModel(t, { status: 'COMMITTING' },
    /REVIEW_ISOLATED_COMMITTING_FORBIDDEN|HOST_MCP_COMMITTING/u);
  await failsBeforeModel(t, { status: 'CANCELLED' }, /HOST_MCP_/u);
  await failsBeforeModel(t, { contextAttemptRef: 'AQ-wrong' },
    /HOST_MCP_REVIEW_CONTEXT_INVALID/u);
  await failsBeforeModel(t, { readAttemptRef: 'AQ-wrong' },
    /HOST_MCP_REVIEW_SOURCE_REF_READBACK_INVALID/u);
  const f = await fixture(t, { readSources: [] });
  await assert.rejects(runHostedReviewTurn(f.options, f.dependencies),
    /HOST_MCP_REVIEW_SOURCE_REF_READBACK_INVALID/u);
  await assert.rejects(runHostedReviewTurn(f.options, f.dependencies),
    /REVIEW_ISOLATED_CHECKPOINT_NOT_FRESH/u);
  assert.equal(f.bodies.length, 0);
});

test('document directory and exact Host readback must cover every readable document', async (t) => {
  const directory = (task) => task.context.problemAssessment.availableSources;
  await failsBeforeModel(t, { mutateReviewTask: (task) => {
    directory(task).length = 0;
    task.jobAidContext.modelInput.availableSources.length = 0;
  } }, /REVIEW_ISOLATED_DOCUMENT_COVERAGE_INVALID/u);
  await failsBeforeModel(t, { mutateReviewTask: (task) => {
    directory(task).push({ ...document, ref: 'doc:extra' });
    task.jobAidContext.modelInput.availableSources.push({ ...document, ref: 'doc:extra' });
  } }, /REVIEW_ISOLATED_DOCUMENT_COVERAGE_INVALID/u);
  await failsBeforeModel(t, { mutateReviewTask: (task) => {
    directory(task)[0].versionLabel = 'wrong-version';
    task.jobAidContext.modelInput.availableSources[0].versionLabel = 'wrong-version';
  } }, /REVIEW_ISOLATED_DOCUMENT_BINDING_INVALID/u);
  await failsBeforeModel(t, { readSources: [] },
    /HOST_MCP_REVIEW_SOURCE_REF_READBACK_INVALID/u);
  await failsBeforeModel(t, { readSources: [{ ...source, excerpt: 'different body' }] },
    /HOST_MCP_REVIEW_JOBAID_SOURCE_BINDING_INVALID/u);
  await failsBeforeModel(t, { readSources: [{ ...source, versionLabel: 'wrong-version' }] },
    /REVIEW_ISOLATED_SOURCE_CONTENT_MISMATCH/u);
});

test('ordered batches reject missing or reordered source readback before model', async (t) => {
  const second = { ...source, sourceRefId: 'doc:fixture-2',
    evidenceRef: 'doc:fixture-2', title: 'Second passage', locator: 'page 2' };
  const mutateReviewTask = (task) => {
    task.resourceRefs.push({ sourceRefId: second.sourceRefId,
      resourceArtifactRef: 'artifact://fixture/document-2',
      resourceArtifactSha256: 'b'.repeat(64), value: second });
    task.jobAidContext.sourceCatalog.push({ ...second,
      sourceRefId: undefined, workItemId: 'WI-second' });
    delete task.jobAidContext.sourceCatalog[1].sourceRefId;
    task.jobAidContext.sourceBindings.push({ workItemId: 'WI-second',
      artifactRef: 'artifact://fixture/document-2', artifactSha256: 'b'.repeat(64) });
    const next = { ref: second.sourceRefId, kind: second.kind,
      title: second.title, versionLabel: second.versionLabel, locator: second.locator };
    task.jobAidContext.modelInput.availableSources.push(next);
    task.context.problemAssessment.availableSources.push(next);
  };
  await failsBeforeModel(t, { mutateReviewTask, readSources: [second, source] },
    /HOST_MCP_REVIEW_SOURCE_REF_BINDING_INVALID/u);
  await failsBeforeModel(t, { mutateReviewTask, readSources: [source] },
    /HOST_MCP_REVIEW_SOURCE_REF_READBACK_INVALID/u);
});

test('read deadline and oversized frozen input stop before Gateway dispatch', async (t) => {
  let now = 0;
  t.mock.method(Date, 'now', () => now);
  await failsBeforeModel(t, { onRead: () => { now = 480_001; } },
    /REVIEW_ISOLATED_TIMEOUT/u);
  await failsBeforeModel(t, { mutateReviewTask: (task) => {
    const longExcerpt = 'source passage '.repeat(300_000);
    task.resourceRefs[0].value.excerpt = longExcerpt;
    task.jobAidContext.sourceCatalog[0].excerpt = longExcerpt;
  } }, /REVIEW_ISOLATED_INPUT_TOO_LARGE/u);
});

test('deadline reached after Host heartbeat stops before Gateway dispatch', async (t) => {
  let now = 0;
  t.mock.method(Date, 'now', () => now);
  const f = await failsBeforeModel(t, { onHeartbeat: () => { now = 480_001; } },
    /REVIEW_ISOLATED_TIMEOUT/u);
  assert.equal(f.calls.filter(({ name }) => name === 'heartbeat_action_attempt').length, 1);
});

test('lease loss and non-candidate or truncated responses never commit or retry', async (t) => {
  await failsBeforeModel(t, { heartbeatFailure: true }, /HOST_LEASE_LOST/u);
  for (const [response, expected] of [
    [gatewayTool('read_wiselink_review_sources', { sourceRefIds: [sourceRefId] }),
      /REVIEW_ISOLATED_CANDIDATE_TOOL_REQUIRED/u],
    [gatewayTool('return_wiselink_review_candidate', candidate, 'length'),
      /REVIEW_ISOLATED_RESPONSE_TRUNCATED/u],
    [gatewayTool('return_wiselink_review_candidate', { ...candidate, answer: '' }),
      /REVIEW_MODEL_ANSWER_REQUIRED/u],
    [gatewayTool('return_wiselink_review_candidate', { ...candidate,
      jobAidWorkingDelta: { ...candidate.jobAidWorkingDelta,
        issues: [{ ...candidate.jobAidWorkingDelta.issues[0], issueKey: 'outside' }] } }),
      /REVIEW_ISSUE_OUT_OF_SCOPE/u],
    [Response.json({ choices: [{ message: { content: null, tool_calls: [
      { id: 'one', type: 'function', function: {
        name: 'return_wiselink_review_candidate', arguments: JSON.stringify(candidate) } },
      { id: 'two', type: 'function', function: {
        name: 'return_wiselink_review_candidate', arguments: JSON.stringify(candidate) } },
    ] } }] }), /REVIEW_GATEWAY_OUTPUT_FUNCTION_COUNT_INVALID/u],
  ]) {
    const f = await fixture(t, { response, mutateReviewTask: (task) => {
      task.context.issueEditScope = { targetIssueKeys: ['risk'] };
    } });
    await assert.rejects(runHostedReviewTurn(f.options, f.dependencies), expected);
    assert.equal(f.bodies.length, 1);
    assert.equal(f.calls.some(({ name }) => name === 'commit_review_turn_candidate'), false);
  }
});

function preparedFailureGateway(f) {
  let closed = 0;
  f.dependencies.prepareGateway = async () => ({
    gatewayUrl: 'http://127.0.0.1:19471',
    gatewayToken: 'temporary',
    close: async () => { closed += 1; },
  });
  return () => closed;
}

function preparedLedgerGateway(f, { known = true, dispatchesPerRequest = 1,
  finishReason = null } = {}) {
  let closed = 0;
  f.dependencies.prepareGateway = async (binding) => ({
    gatewayUrl: 'http://127.0.0.1:19471', gatewayToken: 'temporary',
    close: async () => { closed += 1; },
    getSanitizedReceipt: () => {
      const count = f.bodies.length * dispatchesPerRequest;
      return { attemptRef: binding.attemptRef, modelId: 'glm-5.3',
        maxCompletionTokens: binding.maxCompletionTokens,
        maxModelRequests: binding.maxModelRequests,
        absoluteDeadline: binding.deadlineAt,
        upstreamDispatchCount: count,
        dispatches: Array.from({ length: count }, (_, index) => ({
          ordinal: index + 1,
          actualCompletionTokens: f.options.maxCompletionTokens,
          upstreamHttpStatus: index < dispatchesPerRequest ? 502 : 200,
          transportCompleted: true, providerKnownTerminal: known,
          finishReason,
          outcome: known ? 'PROVIDER_TERMINAL' : 'TERMINAL_UNPROVEN',
        })),
        activeOrdinal: null, unknownTerminal: !known && count > 0,
        upstreamHttpStatus: count ? 502 : null,
        transportCompleted: count > 0, providerStopConfirmed: known && count > 0,
        outcome: count ? known ? 'PROVIDER_TERMINAL' : 'TERMINAL_UNPROVEN' : 'CREATED',
        finishedAt: count ? new Date().toISOString() : null };
    },
  });
  return () => closed;
}

test('known native 502 gets one corrected full-input request with current dispatch proof',
  async (t) => {
    let calls = 0;
    const f = await fixture(t, { gateway: () => ++calls === 1
      ? Response.json({ error: { message:
        'tool_choice=required was not satisfied by the agent response' } },
      { status: 502 })
      : gatewayTool('return_wiselink_review_candidate', candidate) });
    f.options.maxModelRequests = 2;
    const closed = preparedLedgerGateway(f);
    const result = await runHostedReviewTurn(f.options, f.dependencies);
    assert.equal(result.outcome, 'CANDIDATE_NOT_SAVED');
    assert.equal(f.bodies.length, 2);
    assert.deepEqual(f.bodies[1].messages[1], f.bodies[0].messages[1]);
    assert.equal(f.bodies[1].messages.length, f.bodies[0].messages.length + 1);
    assert.match(f.bodies[1].messages.at(-1).content, /required candidate tool call/u);
    assert.equal(closed(), 1);
  });

test('unknown terminal or exhausted actual provider slots forbids correction replay',
  async (t) => {
    for (const scenario of [
      { known: false, dispatchesPerRequest: 1,
        failure: 'REVIEW_PROVIDER_TERMINAL_UNKNOWN' },
      { known: true, dispatchesPerRequest: 2,
        failure: 'REVIEW_GATEWAY_HTTP_502' },
    ]) {
      const f = await fixture(t, { gateway: () => Response.json({ error: { message:
        'tool_choice=required was not satisfied by the agent response' } },
      { status: 502 }) });
      f.options.maxModelRequests = 2;
      preparedLedgerGateway(f, scenario);
      await assert.rejects(runHostedReviewTurn(f.options, f.dependencies),
        (error) => error.message === scenario.failure);
      assert.equal(f.bodies.length, 1);
    }
  });

test('provider length terminal stops even when outer Gateway labels it known 502',
  async (t) => {
    const f = await fixture(t, { gateway: () => Response.json({ error: { message:
      'request ended with an incomplete terminal response.' } }, { status: 502 }) });
    f.options.maxModelRequests = 2;
    preparedLedgerGateway(f, { finishReason: 'length' });
    await assert.rejects(runHostedReviewTurn(f.options, f.dependencies),
      /REVIEW_ISOLATED_RESPONSE_TRUNCATED/u);
    assert.equal(f.bodies.length, 1);
  });

async function captureNativeFailureStderr(run) {
  const previous = process.stderr.write;
  let output = '';
  process.stderr.write = (chunk) => {
    output += String(chunk);
    return true;
  };
  try { await run(); } finally { process.stderr.write = previous; }
  return output;
}

test('isolated 502 records only known native failure codes and retains the original error', async (t) => {
  const cases = [
    ['request ended with an incomplete terminal response.',
      'INCOMPLETE_TERMINAL_RESPONSE'],
    ['tool_choice=required was not satisfied by the agent response',
      'TOOL_CHOICE_NOT_SATISFIED'],
  ];
  for (const [message, expectedCode] of cases) {
    const sensitive = 'PRIVATE_PROVIDER_BODY_SECRET_SENTINEL';
    const f = await fixture(t, { response: Response.json({
      error: { message }, provider: sensitive, body: sensitive,
    }, { status: 502 }) });
    const closed = preparedFailureGateway(f);
    const stderr = await captureNativeFailureStderr(async () => {
      await assert.rejects(runHostedReviewTurn(f.options, f.dependencies),
        (error) => error.message === 'REVIEW_GATEWAY_HTTP_502');
    });
    const receiptPath = join(f.options.checkpointDir, 'model.native-failure.json');
    const receiptText = await readFile(receiptPath, 'utf8');
    const receipt = JSON.parse(receiptText);
    assert.deepEqual(Object.keys(receipt).sort(), [
      'attemptRefHash', 'httpStatus', 'nativeFailureCode', 'observedAt',
      'schemaVersion',
    ]);
    assert.equal(receipt.schemaVersion, 'wiselink.review.native_failure.v1');
    assert.equal(receipt.httpStatus, 502);
    assert.equal(receipt.nativeFailureCode, expectedCode);
    assert.equal(receipt.attemptRefHash, createHash('sha256')
      .update(f.task.operationRef).digest('hex'));
    assert.ok(Number.isFinite(Date.parse(receipt.observedAt)));
    assert.equal((await stat(receiptPath)).mode & 0o777, 0o600);
    assert.equal(stderr, `REVIEW_NATIVE_FAILURE_CODE=${expectedCode}\n`);
    assert.equal(receiptText.includes(sensitive), false);
    assert.equal(stderr.includes(sensitive), false);
    assert.equal(f.bodies.length, 1);
    assert.equal(closed(), 1);
    assert.equal(f.calls.some(({ name }) => name === 'commit_review_turn_candidate'), false);
  }
});

test('isolated 502 unknown body fails without a correction replay', async (t) => {
  for (const response of [
    Response.json({ error: { message: 'PRIVATE_PROVIDER_BODY_SECRET_SENTINEL' } },
      { status: 502 }),
    new Response('PRIVATE_PROVIDER_BODY_SECRET_SENTINEL', { status: 502 }),
  ]) {
    const f = await fixture(t, { response });
    const closed = preparedFailureGateway(f);
    const stderr = await captureNativeFailureStderr(async () => {
      await assert.rejects(runHostedReviewTurn(f.options, f.dependencies),
        (error) => ['REVIEW_GATEWAY_HTTP_502',
          'REVIEW_GATEWAY_INVALID_JSON_HTTP_502'].includes(error.message));
    });
    await assert.rejects(readFile(join(f.options.checkpointDir,
      'model.native-failure.json')), { code: 'ENOENT' });
    assert.equal(stderr, '');
    assert.equal(f.bodies.length, 1);
    assert.equal(closed(), 1);
    assert.equal(f.calls.some(({ name }) => name === 'commit_review_turn_candidate'), false);
  }
});

test('isolated non-502 leaves no native failure receipt', async (t) => {
  const f = await fixture(t, { response: Response.json({
    error: { message: 'PRIVATE_PROVIDER_BODY_SECRET_SENTINEL' },
  }, { status: 401 }) });
  const closed = preparedFailureGateway(f);
  const stderr = await captureNativeFailureStderr(async () => {
    await assert.rejects(runHostedReviewTurn(f.options, f.dependencies),
      (error) => error.message === 'REVIEW_GATEWAY_HTTP_401');
  });
  await assert.rejects(readFile(join(f.options.checkpointDir,
    'model.native-failure.json')), { code: 'ENOENT' });
  assert.equal(stderr, '');
  assert.equal(f.bodies.length, 1);
  assert.equal(closed(), 1);
});

test('isolated 502 receipt write failure reports a fixed code and preserves cleanup', async (t) => {
  const sensitive = 'PRIVATE_PROVIDER_BODY_SECRET_SENTINEL';
  const f = await fixture(t, { response: Response.json({
    error: { message: 'tool_choice=required was not satisfied by the agent response' },
    provider: sensitive,
  }, { status: 502 }) });
  const closed = preparedFailureGateway(f);
  const receiptPath = join(f.options.checkpointDir, 'model.native-failure.json');
  await writeFile(receiptPath, 'existing-receipt', { mode: 0o600 });
  const stderr = await captureNativeFailureStderr(async () => {
    await assert.rejects(runHostedReviewTurn(f.options, f.dependencies),
      (error) => error.message === 'REVIEW_GATEWAY_HTTP_502');
  });
  assert.equal(await readFile(receiptPath, 'utf8'), 'existing-receipt');
  assert.equal(stderr,
    'REVIEW_NATIVE_FAILURE_RECEIPT_WRITE_FAILED\n' +
    'REVIEW_NATIVE_FAILURE_CODE=TOOL_CHOICE_NOT_SATISFIED\n');
  assert.equal(stderr.includes(sensitive), false);
  assert.equal(f.bodies.length, 1);
  assert.equal(closed(), 1);
  assert.equal(f.calls.some(({ name }) => name === 'commit_review_turn_candidate'), false);
});

test('isolated V2 assembly and known-terminal correction retain exact current statements, roots and request', async (t) => {
  const receipt = packet([record()]);
  const roots = receipt.evidence.filter((entry) => entry.kind === 'DOCUMENT_PASSAGE');
  const currentText = '仅核对当前来源陈述，保留日期角色 UNKNOWN 和实施状态未知。';
  const nextCandidate = structuredClone(candidate);
  nextCandidate.sourceRefs = [roots[0].evidenceRef];
  nextCandidate.jobAidWorkingDelta.issues[0].body = `来源仅报告其状态，未证明实际实施。[[${roots[0].evidenceRef}]]`;
  let requests = 0;
  const f = await fixture(t, {
    mutateReviewTask: (review) => {
      const assessment = { schemaVersion: 'wiselink.jobaid-problem-task.v2',
        purpose: 'PROBLEM_REVIEW', evidenceProjectionVersion: 'SOURCE_CONTEXT_V2',
        sourceStatements: receipt.sourceStatements, activityContexts: receipt.activityContexts,
        availableSources: receipt.evidence.map((entry) => ({ ref: entry.evidenceRef,
          kind: entry.kind, title: entry.title, versionLabel: entry.versionLabel, locator: entry.locator })),
        deliveredEvidence: receipt.evidence, previousWork: { content: { issues: [] } } };
      review.resourceRefs = roots.map((entry) => ({ sourceRefId: entry.evidenceRef,
        resourceArtifactRef: artifactRef, resourceArtifactSha256: artifactSha256,
        value: { ...entry, sourceRefId: entry.evidenceRef } }));
      review.jobAidContext = { schemaVersion: 'wiselink.jobaid-problem-task.v2',
        sourceCatalog: receipt.evidence.map((entry) => entry.kind === 'DOCUMENT_PASSAGE'
          ? { ...entry, workItemId: review.context.workItem.workItemId,
            documentVersionId: record().sourceBinding.original.documentVersionId,
            sourceRefId: entry.evidenceRef.split(':').at(-1) }
          : { ...entry, resultRef: record().reference.runRef,
            resultRevision: record().reference.candidateRevision }),
        sourceBindings: [{ workItemId: review.context.workItem.workItemId,
          artifactRef, artifactSha256 }], initiallyDeliveredRefs: receipt.sourceRefs,
        sourceActivityProjections: [{ records: receipt.sourceStatements,
          activityContexts: receipt.activityContexts }], modelInput: assessment,
        previousWork: assessment.previousWork };
      review.userMessage = currentText;
      review.context.engineerInput = { text: currentText, attachmentRefs: [] };
      review.context.problemAssessment = assessment;
    },
    gateway: () => ++requests === 1
      ? Response.json({ error: { message: 'tool_choice=required was not satisfied by the agent response' } }, { status: 502 })
      : gatewayTool('return_wiselink_review_candidate', nextCandidate),
  });
  // Both exact roots belong to one frozen artifact; envelope artifact refs
  // remain unique while its model resource handles retain both passages.
  f.task.sourceRefs = [{ ref: artifactRef, sha256: artifactSha256 }];
  const unsealed = { ...f.task };
  delete unsealed.inputHash;
  f.task.inputHash = canonicalSha256(unsealed);
  f.options.maxModelRequests = 2;
  const closed = preparedLedgerGateway(f);
  const result = await runHostedReviewTurn(f.options, f.dependencies);
  assert.equal(result.outcome, 'CANDIDATE_NOT_SAVED');
  assert.equal(result.authorityMutations.reviewCandidatePersisted, false);
  assert.equal(closed(), 1);
  assert.equal(f.bodies.length, 2);
  assert.deepEqual(f.calls.filter(({ name }) => name === 'read_source_refs')
    .flatMap(({ args }) => args.sourceRefIds), roots.map((entry) => entry.evidenceRef));
  for (const body of f.bodies) {
    const delivered = JSON.parse(body.messages[1].content.split('\n').slice(1).join('\n'));
    assert.equal(delivered.input.userMessage, currentText);
    assert.equal(delivered.input.context.engineerInput.text, currentText);
    assert.deepEqual(delivered.input.context.problemAssessment.sourceStatements, receipt.sourceStatements);
    assert.deepEqual(delivered.input.context.problemAssessment.activityContexts, receipt.activityContexts);
    assert.deepEqual(delivered.input.context.problemAssessment.deliveredEvidence, receipt.evidence);
    assert.deepEqual(delivered.sourceRefs, f.reviewTask.resourceRefs.map((entry) => entry.value));
    assert.equal(delivered.input.context.problemAssessment.sourceStatements[0].statement.times[1].role, 'UNKNOWN');
    assert.equal(delivered.input.context.problemAssessment.sourceStatements[0].statement.times[2].raw, 'TBD');
    assert.equal(delivered.input.context.problemAssessment.sourceStatements[0].scopeBasis, 'ACTUAL_DELIVERED_RUN_SCOPE');
  }
  assert.deepEqual(f.bodies[1].messages[1], f.bodies[0].messages[1]);
  assert.ok(f.calls.every(({ name }) => ['begin_review_turn', 'get_review_turn_context',
    'read_source_refs', 'heartbeat_action_attempt'].includes(name)));
});

test('completed isolated result replay does not prepare, read, dispatch, commit or finish', async (t) => {
  const f = await fixture(t);
  let prepared = 0;
  const closed = preparedLedgerGateway(f);
  const prepare = f.dependencies.prepareGateway;
  f.dependencies.prepareGateway = async (binding) => { prepared++; return prepare(binding); };
  const result = await runHostedReviewTurn(f.options, f.dependencies);
  assert.equal(result.ok, false);
  assert.equal(prepared, 1);
  assert.equal(closed(), 1);
  const before = await readFile(join(f.options.checkpointDir, 'run-result.json'), 'utf8');
  const replayed = await runHostedReviewTurn(f.options, {
    callTool: async () => assert.fail('saved isolated result must not contact Host'),
    requestGateway: async () => assert.fail('saved isolated result must not dispatch'),
    prepareGateway: async () => assert.fail('saved isolated result must not prepare'),
  });
  assert.deepEqual(replayed, result);
  assert.equal(await readFile(join(f.options.checkpointDir, 'run-result.json'), 'utf8'), before);
});

test('unknown isolated provider terminal closes once and restart never re-arms or dispatches', async (t) => {
  const f = await fixture(t, { gateway: () => Response.json({ error: {
    message: 'tool_choice=required was not satisfied by the agent response',
  } }, { status: 502 }) });
  f.options.maxModelRequests = 2;
  const closed = preparedLedgerGateway(f, { known: false });
  await assert.rejects(runHostedReviewTurn(f.options, f.dependencies), /REVIEW_PROVIDER_TERMINAL_UNKNOWN/u);
  const hostCalls = f.calls.length;
  assert.equal(f.bodies.length, 1);
  assert.equal(closed(), 1);
  await assert.rejects(runHostedReviewTurn(f.options, f.dependencies), /REVIEW_ISOLATED_CHECKPOINT_NOT_FRESH/u);
  assert.equal(f.calls.length, hostCalls);
  assert.equal(f.bodies.length, 1);
  assert.equal(closed(), 1);
});
