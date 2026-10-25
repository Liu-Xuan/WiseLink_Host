import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { invokeHostedDocumentReadingModel, READING_PROPOSAL_FUNCTION_NAME } from './invoke-hosted-document-reading-model.mjs';
import { createCheckpointStore, resolveRuntimeConfig, runHostedReviewTurn } from './run-hosted-review-turn.mjs';

const executionModel = { modelRef: 'miaoda/glm-5.3', displayName: 'GLM 5.3',
  providerKind: 'BUILT_IN', settingsRevision: 1, selectedAt: '2026-10-25T00:00:00.000Z' };
const codexOptions = { codexBinary: '/usr/bin/codex', configPath: '/tmp/codex-config.toml',
  runRoot: '/tmp/codex-runs' };
const input = {
  sourceBinding: { documentVersionId: 'DV-1' },
  sourceCoverage: { unresolvedRanges: [] },
  units: [{ unitId: 'U1', text: 'No approval is required except for installation.', sourceRefIds: ['SR1'] }],
  deliveredRanges: [{ offset: 0, unitIds: ['U1'], nextOffset: null }],
  anchors: [{ anchorId: 'A1', sourceUnitId: 'U1', payloadPath: '/text',
    sourceText: 'No approval is required except for installation.', sourceRefIds: ['SR1'],
    sourceLocators: [{ sourceRefId: 'SR1', page: 1 }] }],
};

test('reading driver uses explicit Codex request without Hosted URL or credential', async () => {
  const calls = [];
  const result = await invokeHostedDocumentReadingModel(input, {
    modelExecutor: 'CODEX', codexOptions, executionModel,
    configuredModelVersion: 'configured-route:miaoda/glm-5.3',
  }, { requestGateway: async (endpoint, init) => {
    calls.push({ endpoint, init });
    return { status: 200, ok: true, text: async () => JSON.stringify({
      model: 'glm-5.3', choices: [{ finish_reason: 'tool_calls', message: {
        role: 'assistant', tool_calls: [{ id: 'codex-1', type: 'function', function: {
          name: READING_PROPOSAL_FUNCTION_NAME,
          arguments: JSON.stringify({ schemaVersion: 'wiselink.document.reading.v1',
            headline: '批准条件', brief: { text: '一般无需批准，安装除外。', quotes: [{ anchorId: 'A1' }] },
            explanation: [{ text: '安装是例外。', quotes: [{ anchorId: 'A1' }] }],
            criticalConditions: [], limitations: [] }),
        } }],
      } }],
    }) };
  } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].endpoint, null);
  assert.equal(calls[0].init.headers.authorization, undefined);
  assert.equal(calls[0].init.headers['x-openclaw-model'], 'miaoda/glm-5.3');
  assert.equal(result.modelVersion, 'glm-5.3');
  assert.deepEqual(result.proposal.brief.quotes, [{ anchorId: 'A1', start: 0,
    end: input.anchors[0].sourceText.length, text: input.anchors[0].sourceText }]);
});

test('Codex runtime requires an explicit executable, config and run root', async () => {
  await assert.rejects(resolveRuntimeConfig(['--model-executor', 'CODEX'],
    { WL_CODEX_RUNTIME_APP_ID: 'app_syntheticCodexRuntime' }),
    /CODEX_RUNTIME_CONFIG_REQUIRED/u);
  const runtime = await resolveRuntimeConfig([
    '--model-executor', 'CODEX', '--codex-binary', codexOptions.codexBinary,
    '--codex-config', codexOptions.configPath, '--codex-run-root', codexOptions.runRoot,
  ], { WL_REVIEW_HOST_MCP_URL: 'https://example.invalid/openapi/wiselink/codex-mcp',
    WL_CODEX_RUNTIME_APP_ID: 'app_syntheticCodexRuntime' });
  assert.equal(runtime.modelExecutor, 'CODEX');
  assert.equal(runtime.runtimeAppId, 'app_syntheticCodexRuntime');
  assert.equal(runtime.gatewayUrl, undefined);
  assert.equal(runtime.gatewayToken, undefined);
  assert.deepEqual(runtime.registeredModelRefs, ['miaoda/glm-5.3']);
});

test('reading refuses a selected non-GLM route before any model request', async () => {
  let requests = 0;
  await assert.rejects(invokeHostedDocumentReadingModel(input, {
    modelExecutor: 'CODEX', codexOptions,
    executionModel: { ...executionModel, modelRef: 'miaoda/minimax-m3' },
    configuredModelVersion: 'configured-route:miaoda/minimax-m3',
  }, { requestGateway: async () => { requests++; throw new Error('SHOULD_NOT_DISPATCH'); } }),
  /CODEX_EXECUTION_MODEL_ROUTE_UNSUPPORTED/u);
  assert.equal(requests, 0);
});

test('Codex Review refuses a legacy sealed COMMITTING checkpoint before any Host call', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wiselink-review-executor-test-'));
  try {
    const store = await createCheckpointStore(directory);
    await store.writeOnce('begin.result', { value: { status: 'COMMITTING', task: {
      modelInput: { jobAidContext: { tdmsReviewContext: { mode: 'BOUNDED_NATIVE_READ' } } },
    } } });
    await store.writeOnce('commit.started', { legacy: true });
    let hostCalls = 0;
    await assert.rejects(runHostedReviewTurn({ reviewConversationRef: 'RC-fixture',
      requestId: 'REQ-fixture', checkpointDir: directory }, {
      modelRuntime: { modelExecutor: 'CODEX', codexOptions },
      callTool: async () => { hostCalls++; throw new Error('HOST_MUST_NOT_BE_CALLED'); },
    }), /REVIEW_CODEX_LEGACY_MODEL_CHECKPOINT_FORBIDDEN/u);
    assert.equal(hostCalls, 0);
    assert.equal(await store.readOptional('model-executor'), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
