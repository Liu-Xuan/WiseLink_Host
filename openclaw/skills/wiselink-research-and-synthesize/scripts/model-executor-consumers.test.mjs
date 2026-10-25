import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { invokeHostedDocumentReadingModel, READING_PROPOSAL_FUNCTION_NAME } from './invoke-hosted-document-reading-model.mjs';
import { createCheckpointStore, resolveRuntimeConfig, runHostedReviewTurn } from './run-hosted-review-turn.mjs';
import { automaticWorkItemQueueMode } from './consume-hosted-work-item.mjs';

const executionModel = { modelRef: 'miaoda/glm-5.3', displayName: 'GLM 5.3',
  providerKind: 'BUILT_IN', settingsRevision: 1, selectedAt: '2026-10-25T00:00:00.000Z' };
const codexOptions = { codexBinary: '/usr/bin/codex', configPath: '/tmp/codex-config.toml',
  runRoot: '/tmp/codex-runs' };
const codexSettings = [
  ['--codex-binary', 'codexBinary', 'WL_CODEX_BINARY'],
  ['--codex-config', 'configPath', 'WL_CODEX_CONFIG_PATH'],
  ['--codex-run-root', 'runRoot', 'WL_CODEX_RUN_ROOT'],
];
const hostedMcpUrl = 'https://example.invalid/openapi/wiselink/openclaw-mcp';
const codexMcpUrl = 'https://example.invalid/openapi/wiselink/codex-mcp';

function codexRuntimeEnv(overrides = {}) {
  return {
    WL_MODEL_EXECUTOR: 'CODEX', WL_CODEX_RUNTIME_APP_ID: 'app_syntheticCodexRuntime',
    WL_CODEX_BINARY: codexOptions.codexBinary, WL_CODEX_CONFIG_PATH: codexOptions.configPath,
    WL_CODEX_RUN_ROOT: codexOptions.runRoot, WL_REVIEW_HOST_MCP_URL: codexMcpUrl,
    ...overrides,
  };
}

async function withRuntimeConfig(run) {
  const directory = await mkdtemp(join(tmpdir(), 'wiselink-runtime-config-test-'));
  const configPath = join(directory, 'openclaw.json');
  try {
    await writeFile(configPath, JSON.stringify({
      gateway: { port: 18789, auth: { token: 'synthetic-gateway-token' },
        http: { endpoints: { chatCompletions: { enabled: true } } } },
      agents: { defaults: { model: { primary: 'miaoda/glm-5.3', fallbacks: [] },
        models: { 'miaoda/glm-5.3': {} } } },
    }));
    await run(configPath, directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function queueArgv(configPath, wikiIdle = false) {
  return ['--auto-queue', '--openclaw-config', configPath, ...(wikiIdle ? [
    '--wiki-idle', '--wiki-timeout-ms', '1800000',
    '--wiki-max-completion-tokens', '16384', '--wiki-max-model-requests', '4',
  ] : [])];
}

for (const wikiIdle of [false, true]) {
  test(`runtime resolver accepts env-only CODEX for legal automatic queue${wikiIdle ? ' with Wiki idle' : ''}`, async () => {
    await withRuntimeConfig(async configPath => {
      const argv = queueArgv(configPath, wikiIdle);
      assert.equal(automaticWorkItemQueueMode(argv), true);
      const runtime = await resolveRuntimeConfig(argv, codexRuntimeEnv());
      assert.equal(runtime.modelExecutor, 'CODEX');
      assert.equal(runtime.runtimeAppId, 'app_syntheticCodexRuntime');
      assert.deepEqual(runtime.codexOptions, codexOptions);
      assert.equal(runtime.sourceConfigPath, configPath);
      assert.equal(runtime.hostMcpUrl, codexMcpUrl);
      assert.equal(runtime.gatewayUrl, undefined);
      assert.equal(runtime.gatewayToken, undefined);
      assert.throws(() => automaticWorkItemQueueMode([...argv, '--model-executor', 'CODEX']),
        /AUTO_WORK_ITEM_QUEUE_OPTION_NOT_ALLOWED/u);
    });
  });
}

test('runtime resolver loads env-only CODEX from exact batch queue configuration', async () => {
  await withRuntimeConfig(async (configPath, directory) => {
    const headers = { Authorization: 'Bearer synthetic' };
    await writeFile(configPath, JSON.stringify({ mcpServers: {
      'wiselink-codex-engineering-assessment': {
        name: 'wiselink-codex-engineering-assessment', url: codexMcpUrl, headers,
      },
    } }));
    const argv = ['--auto-queue', '--queue-max-items', '1', '--queue-tick-budget-ms', '900000',
      '--checkpoint-root', join(directory, 'checkpoint'), '--openclaw-config', configPath];
    const env = codexRuntimeEnv();
    delete env.WL_REVIEW_HOST_MCP_URL;
    delete env.WL_REVIEW_HOST_MCP_HEADERS_JSON;
    assert.equal(automaticWorkItemQueueMode(argv), true);
    const runtime = await resolveRuntimeConfig(argv, env);
    assert.equal(runtime.modelExecutor, 'CODEX');
    assert.deepEqual(runtime.codexOptions, codexOptions);
    assert.equal(runtime.sourceConfigPath, configPath);
    assert.equal(runtime.hostMcpUrl, codexMcpUrl);
    assert.deepEqual(runtime.headers, headers);
    assert.equal(runtime.gatewayUrl, undefined);
    assert.equal(runtime.gatewayToken, undefined);
  });
});

test('runtime resolver preserves default HOSTED for legal automatic queue argv', async () => {
  await withRuntimeConfig(async configPath => {
    for (const wikiIdle of [false, true]) {
      const argv = queueArgv(configPath, wikiIdle);
      assert.equal(automaticWorkItemQueueMode(argv), true);
      const runtime = await resolveRuntimeConfig(argv, { WL_REVIEW_HOST_MCP_URL: hostedMcpUrl });
      assert.equal(runtime.modelExecutor, 'HOSTED');
      assert.equal(runtime.codexOptions, undefined);
      assert.equal(runtime.gatewayUrl, 'http://127.0.0.1:18789');
      assert.equal(runtime.configuredModelVersion, 'miaoda/glm-5.3');
    }
  });
});

test('runtime resolver honors explicit executor and Codex paths before environment', async () => {
  await withRuntimeConfig(async configPath => {
    const hosted = await resolveRuntimeConfig(['--openclaw-config', configPath,
      '--model-executor', 'HOSTED'], codexRuntimeEnv({
      WL_CODEX_RUNTIME_APP_ID: '', WL_CODEX_BINARY: 'relative', WL_REVIEW_HOST_MCP_URL: hostedMcpUrl,
    }));
    assert.equal(hosted.modelExecutor, 'HOSTED');
    assert.equal(hosted.codexOptions, undefined);
    const explicit = await resolveRuntimeConfig(['--openclaw-config', configPath,
      '--model-executor', 'CODEX', ...codexSettings.flatMap(([flag, key]) => [flag, codexOptions[key]])],
    codexRuntimeEnv({ WL_MODEL_EXECUTOR: 'HOSTED', WL_CODEX_BINARY: 'relative',
      WL_CODEX_CONFIG_PATH: 'relative', WL_CODEX_RUN_ROOT: 'relative' }));
    assert.equal(explicit.modelExecutor, 'CODEX');
    assert.deepEqual(explicit.codexOptions, codexOptions);
  });
});

test('runtime resolver merges each explicit Codex path with the remaining environment paths', async () => {
  await withRuntimeConfig(async configPath => {
    for (const [flag, key] of codexSettings) {
      const explicitPath = `/tmp/synthetic-explicit-${key}`;
      const runtime = await resolveRuntimeConfig(['--openclaw-config', configPath,
        '--model-executor', 'CODEX', flag, explicitPath], codexRuntimeEnv());
      assert.deepEqual(runtime.codexOptions, { ...codexOptions, [key]: explicitPath });
    }
  });
});

test('runtime resolver refuses invalid and explicitly empty executors instead of falling back', async () => {
  await withRuntimeConfig(async configPath => {
    for (const value of ['UNRECOGNIZED', '']) {
      await assert.rejects(resolveRuntimeConfig(['--openclaw-config', configPath],
        codexRuntimeEnv({ WL_MODEL_EXECUTOR: value })), /MODEL_EXECUTOR_UNSUPPORTED/u);
      await assert.rejects(resolveRuntimeConfig(['--openclaw-config', configPath,
        '--model-executor', value], codexRuntimeEnv()), /MODEL_EXECUTOR_UNSUPPORTED/u);
    }
    await assert.rejects(resolveRuntimeConfig(['--openclaw-config', configPath,
      '--model-executor'], codexRuntimeEnv()), /MODEL_EXECUTOR_UNSUPPORTED/u);
  });
});

test('runtime resolver keeps missing, relative and explicitly empty Codex paths fail closed', async () => {
  await withRuntimeConfig(async configPath => {
    for (const [flag, , envKey] of codexSettings) {
      for (const value of [undefined, 'relative-path']) {
        await assert.rejects(resolveRuntimeConfig(queueArgv(configPath),
          codexRuntimeEnv({ [envKey]: value })), /CODEX_RUNTIME_CONFIG_REQUIRED/u);
      }
      for (const tail of [[flag, ''], [flag]]) {
        await assert.rejects(resolveRuntimeConfig(['--openclaw-config', configPath,
          '--model-executor', 'CODEX', ...tail], codexRuntimeEnv()), /CODEX_RUNTIME_CONFIG_REQUIRED/u);
      }
    }
  });
});

test('runtime resolver retains explicit Codex runtime app identity validation', async () => {
  await withRuntimeConfig(async configPath => {
    for (const runtimeAppId of [undefined, '', 'not-an-app']) {
      await assert.rejects(resolveRuntimeConfig(queueArgv(configPath),
        codexRuntimeEnv({ WL_CODEX_RUNTIME_APP_ID: runtimeAppId })), /CODEX_RUNTIME_APP_ID_CONFIG_INVALID/u);
    }
  });
});

test('runtime resolver retains unreadable configuration and missing MCP failures', async () => {
  await withRuntimeConfig(async (configPath, directory) => {
    for (const env of [codexRuntimeEnv(), { WL_REVIEW_HOST_MCP_URL: hostedMcpUrl }]) {
      await assert.rejects(resolveRuntimeConfig(queueArgv(join(directory, 'missing.json')), env),
        /REVIEW_OPENCLAW_CONFIG_UNREADABLE/u);
      await assert.rejects(resolveRuntimeConfig(queueArgv(configPath), { ...env,
        WL_REVIEW_HOST_MCP_URL: undefined }), /REVIEW_HOST_MCP_CONFIG_NOT_FOUND/u);
    }
  });
});

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
  await withRuntimeConfig(async configPath => {
    await assert.rejects(resolveRuntimeConfig(['--model-executor', 'CODEX'],
      { WL_CODEX_RUNTIME_APP_ID: 'app_syntheticCodexRuntime' }),
      /CODEX_RUNTIME_CONFIG_REQUIRED/u);
    const runtime = await resolveRuntimeConfig([
      '--openclaw-config', configPath, '--model-executor', 'CODEX',
      '--codex-binary', codexOptions.codexBinary,
      '--codex-config', codexOptions.configPath, '--codex-run-root', codexOptions.runRoot,
    ], { WL_REVIEW_HOST_MCP_URL: codexMcpUrl,
      WL_CODEX_RUNTIME_APP_ID: 'app_syntheticCodexRuntime' });
    assert.equal(runtime.modelExecutor, 'CODEX');
    assert.equal(runtime.runtimeAppId, 'app_syntheticCodexRuntime');
    assert.equal(runtime.gatewayUrl, undefined);
    assert.equal(runtime.gatewayToken, undefined);
    assert.deepEqual(runtime.registeredModelRefs, ['miaoda/glm-5.3']);
  });
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
