import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostAutoWorkItemQueueClient, createHostMcpConnection } from
  '../skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs';
import { assertRuntimeTaskIdentity, assertRuntimeResultIdentity,
  WISELINK_HOST_MCP_NAME, WISELINK_HOST_MCP_VERSION, WISELINK_PROFILE_REF,
  WISELINK_MODEL_POLICY_REF, WISELINK_SKILL_COMPATIBILITY_REF,
  WISELINK_SKILL_VERSION, REVIEW_ALLOWED_OPERATIONS, canonicalSha256,
  validateReviewTask, sealResultEnvelope, validateResultEnvelope } from
  '../skills/wiselink-research-and-synthesize/scripts/validate-payload.mjs';

const codexOptions = {
  modelExecutor: 'CODEX', runtimeAppId: 'app_17gr74pbere',
  hostMcpUrl: 'https://host.example/openapi/wiselink/codex-mcp',
  headers: { authorization: 'Bearer synthetic' },
};

test('Codex queue client posts all four prefixed control paths through the actual factory', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return { ok: true, headers: { get: () => 'application/json' },
      json: async () => ({ status: 'SYNTHETIC' }) };
  };
  const queue = createHostAutoWorkItemQueueClient(codexOptions, fetch);
  await queue.nextWorkItem({});
  await queue.acknowledgeWorkItem({ workItemId: 'WI-1' });
  await queue.blockWorkItem({ workItemId: 'WI-1' });
  await queue.applyPendingModelConfiguration({});
  assert.deepEqual(calls.map(call => new URL(call.url).pathname), [
    '/openapi/wiselink/codex-next-work-item',
    '/openapi/wiselink/codex-ack-work-item',
    '/openapi/wiselink/codex-block-work-item',
    '/openapi/wiselink/codex-apply-pending-model-configuration',
  ]);
  for (const call of calls) {
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.headers.authorization, 'Bearer synthetic');
    assert.equal(call.init.headers['content-type'], 'application/json');
    assert.equal(call.init.redirect, 'error');
  }
});

test('Hosted queue paths retain their legacy route names', async () => {
  const paths = [];
  const queue = createHostAutoWorkItemQueueClient({
    modelExecutor: 'HOSTED', hostMcpUrl: 'https://host.example/openapi/wiselink/openclaw-mcp',
  }, async url => {
    paths.push(new URL(url).pathname);
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({}) };
  });
  await queue.nextWorkItem({});
  await queue.applyPendingModelConfiguration({});
  assert.deepEqual(paths, ['/openapi/wiselink/next-work-item',
    '/openapi/wiselink/apply-pending-model-configuration']);
});

test('MCP transport is constructed at Codex endpoint and pins initialize identity', async () => {
  for (const serverVersion of [
    { name: 'wiselink-openclaw-engineering-assessment', version: '1.2.0' },
    { name: 'wiselink-codex-engineering-assessment', version: '1.1.0' },
    { version: '1.2.0' },
    undefined,
  ]) {
    const constructed = [];
    let closed = 0;
    class FakeTransport {
      constructor(endpoint, options) { constructed.push({ endpoint: String(endpoint), options }); }
    }
    class FakeClient {
      constructor(identity) { constructed.push({ identity }); }
      async connect(transport) { assert.ok(transport instanceof FakeTransport); }
      getServerVersion() { return serverVersion; }
      async close() { closed++; }
      async listTools() { throw new Error('LIST_TOOLS_SHOULD_NOT_RUN'); }
    }
    await assert.rejects(createHostMcpConnection(codexOptions, async () => ({
      Client: FakeClient, StreamableHTTPClientTransport: FakeTransport,
      toolCallOptionsPosition: 2,
    })), /CODEX_HOST_MCP_BINDING_UNAVAILABLE/u);
    assert.equal(closed, 1);
    assert.deepEqual(constructed[0].identity,
      { name: 'wiselink-codex-assessment-driver', version: '1.0.0' });
    assert.equal(constructed[1].endpoint, codexOptions.hostMcpUrl);
    assert.deepEqual(constructed[1].options.requestInit.headers, codexOptions.headers);
  }
  class GoodClient {
    async connect() {}
    getServerVersion() { return { name: 'wiselink-codex-engineering-assessment', version: '1.2.0' }; }
    async listTools() { throw new Error('REACHED_TOOL_DISCOVERY'); }
  }
  await assert.rejects(createHostMcpConnection(codexOptions, async () => ({
    Client: GoodClient, StreamableHTTPClientTransport: class {}, toolCallOptionsPosition: 2,
  })), /REACHED_TOOL_DISCOVERY/u);
});

test('Codex task app and result provenance bind strictly without renaming wire fields', () => {
  const task = { taskType: 'OPENCLAW_INTERACTIVE_REVIEW', modelInput: { executionPolicy: {
    runtimeAppId: 'app_17gr74pbere',
    toolPolicyRef: `${WISELINK_HOST_MCP_NAME}@${WISELINK_HOST_MCP_VERSION}#interactive-review-c3`,
  } } };
  assertRuntimeTaskIdentity(task, 'CODEX');
  assert.throws(() => assertRuntimeTaskIdentity({ ...task, modelInput: { executionPolicy: {
    ...task.modelInput.executionPolicy, runtimeAppId: 'app_17c3zn24kv2',
  } } }, 'CODEX'), /RUNTIME_TASK_IDENTITY_MISMATCH/u);
  assert.throws(() => assertRuntimeTaskIdentity({ ...task, modelInput: { executionPolicy: {
    ...task.modelInput.executionPolicy, toolPolicyRef: `${WISELINK_HOST_MCP_NAME}@1.1.0#interactive-review-c3`,
  } } }, 'CODEX'), /RUNTIME_TASK_IDENTITY_MISMATCH/u);
  const result = { toolVersions: { [WISELINK_HOST_MCP_NAME]: '1.2.0', 'model-executor': 'CODEX' } };
  assertRuntimeResultIdentity(result, 'CODEX');
  for (const wrong of [
    { ...result, toolVersions: { [WISELINK_HOST_MCP_NAME]: '1.1.0', 'model-executor': 'CODEX' } },
    { ...result, toolVersions: { [WISELINK_HOST_MCP_NAME]: '1.2.0' } },
    { ...result, toolVersions: { 'wiselink-codex-engineering-assessment': '1.2.0', 'model-executor': 'CODEX' } },
  ]) assert.throws(() => assertRuntimeResultIdentity(wrong, 'CODEX'), /RUNTIME_RESULT_IDENTITY_MISMATCH/u);
});

test('Codex factories reject absent or legacy runtime app before any transport', async () => {
  for (const runtimeAppId of [undefined, 'app_17c3zn24kv2']) {
    const options = { ...codexOptions, runtimeAppId };
    assert.throws(() => createHostAutoWorkItemQueueClient(options, () => {}),
      /CODEX_RUNTIME_APP_ID_CONFIG_INVALID/u);
    await assert.rejects(createHostMcpConnection(options, () => {
      throw new Error('SDK_SHOULD_NOT_LOAD');
    }), /CODEX_RUNTIME_APP_ID_CONFIG_INVALID/u);
  }
});

test('explicit CODEX validators reject an old-app task even when it is correctly re-sealed', () => {
  const input = {
    schemaVersion: 'wiselink.3_1.review_turn_task.v1.c2', mode: 'INTERACTIVE_REVIEW',
    reviewConversationRef: 'RC-1', reviewTurnRef: 'RT-1', requestId: 'REQ-1',
    actorContextRef: 'ACTX-1', inputRevision: 0, selectedEvaluationItemId: null,
    userMessage: 'What is the status?', allowedOperations: REVIEW_ALLOWED_OPERATIONS,
    resourceRefs: [], allowedEvaluationItemIds: [], allowedAdoptedInputRefs: [],
    attachmentRefs: [], context: { purpose: 'CHAT' }, executionPolicy: {
      runtimeAppId: 'app_17gr74pbere', profileRef: WISELINK_PROFILE_REF,
      modelPolicyRef: WISELINK_MODEL_POLICY_REF,
      skillPolicyRef: WISELINK_SKILL_COMPATIBILITY_REF,
      toolPolicyRef: `${WISELINK_HOST_MCP_NAME}@1.2.0#interactive-review-c3`,
    },
  };
  validateReviewTask(input, { modelExecutor: 'CODEX' });
  const basis = {
    schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1', actionAttemptId: 'ATT-1',
    operationRef: 'AQ-1', taskType: 'OPENCLAW_INTERACTIVE_REVIEW', priority: 100,
    tenantId: 'tenant-1', workItemId: 'WI-1', inputRevision: 0, baseRevision: 0,
    documentVersionId: 'DV-1', sourceRefs: [], allowedConnectors: [],
    hostResolvedMissingInputs: [], modelInput: input, deadline: '2099-01-01T00:00:00.000Z',
    idempotencyKey: 'synthetic:review',
  };
  const task = { ...basis, inputHash: canonicalSha256(basis) };
  const sealed = sealResultEnvelope({ task, modelOutput: {}, provenance: {
    modelVersion: 'glm-5.3', promptVersion: 'synthetic-review-prompt',
    skillVersion: WISELINK_SKILL_VERSION,
    toolVersions: { [WISELINK_HOST_MCP_NAME]: '1.2.0', 'model-executor': 'CODEX' },
    runMetrics: { durationMs: 1, inputUnits: 1, outputUnits: 1 },
  } });
  validateResultEnvelope(task, sealed, { modelExecutor: 'CODEX' });
  const oldBasis = { ...basis, modelInput: { ...input, executionPolicy: {
    ...input.executionPolicy, runtimeAppId: 'app_17c3zn24kv2',
  } } };
  const oldTask = { ...oldBasis, inputHash: canonicalSha256(oldBasis) };
  assert.throws(() => validateReviewTask(oldTask.modelInput, { modelExecutor: 'CODEX' }),
    /REVIEW_TASK_RUNTIME_POLICY_INVALID/u);
  assert.throws(() => validateResultEnvelope(oldTask, sealed, { modelExecutor: 'CODEX' }),
    /RUNTIME_TASK_IDENTITY_MISMATCH/u);
});
