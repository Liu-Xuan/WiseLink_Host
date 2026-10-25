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
  modelExecutor: 'CODEX', runtimeAppId: 'app_syntheticCodexRuntime',
  hostMcpUrl: 'https://host.example/openapi/wiselink/codex-mcp',
  headers: { authorization: 'Bearer synthetic' },
};

test('Codex queue client posts the three existing prefixed control paths through the actual factory', async () => {
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
  assert.deepEqual(calls.map(call => new URL(call.url).pathname), [
    '/openapi/wiselink/codex-next-work-item',
    '/openapi/wiselink/codex-ack-work-item',
    '/openapi/wiselink/codex-block-work-item',
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
  assert.deepEqual(paths, ['/openapi/wiselink/next-work-item']);
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
  const task = { taskType: 'OPENCLAW_APPLICABILITY_EVALUATION', modelInput: { runtimePolicy: {
    runtimeAppId: 'app_syntheticCodexRuntime', mcpServerName: WISELINK_HOST_MCP_NAME,
    mcpServerVersion: WISELINK_HOST_MCP_VERSION,
  } } };
  assertRuntimeTaskIdentity(task, 'CODEX', codexOptions.runtimeAppId);
  for (const runtimeAppId of ['app_17c3zn24kv2', 'app_otherRuntime'])
    assert.throws(() => assertRuntimeTaskIdentity({ ...task, modelInput: { runtimePolicy: {
      ...task.modelInput.runtimePolicy, runtimeAppId,
    } } }, 'CODEX', codexOptions.runtimeAppId), /RUNTIME_TASK_IDENTITY_MISMATCH/u);
  const result = { toolVersions: { [WISELINK_HOST_MCP_NAME]: '1.2.0', 'model-executor': 'CODEX' } };
  assertRuntimeResultIdentity(result, 'CODEX');
  for (const toolVersions of [
    { [WISELINK_HOST_MCP_NAME]: '1.1.0', 'model-executor': 'CODEX' },
    { [WISELINK_HOST_MCP_NAME]: '1.2.0' },
    { 'wiselink-codex-engineering-assessment': '1.2.0', 'model-executor': 'CODEX' },
  ]) assert.throws(() => assertRuntimeResultIdentity({ toolVersions }, 'CODEX'), /RUNTIME_RESULT_IDENTITY_MISMATCH/u);
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

test('CODEX Review remains outside the initial assessment integration', () => {
  for (const runtimeAppId of ['app_syntheticCodexRuntime', 'app_17c3zn24kv2']) {
    const task = { taskType: 'OPENCLAW_INTERACTIVE_REVIEW', modelInput: {
      executionPolicy: { runtimeAppId } } };
    assert.throws(() => assertRuntimeTaskIdentity(task, 'CODEX', 'app_syntheticCodexRuntime'),
      /CODEX_REVIEW_NOT_IN_INITIAL_SCOPE/u);
    assert.throws(() => validateReviewTask(task.modelInput, { modelExecutor: 'CODEX' }),
      /CODEX_REVIEW_NOT_IN_INITIAL_SCOPE/u);
  }
});
