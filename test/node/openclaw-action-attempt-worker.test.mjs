import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalSha256,
  runOpenClawActionAttempt,
  runOpenClawGatewayHttp,
} from '../../scripts/run-openclaw-action-attempt-worker.mjs';

test('retries only through the real Gateway HTTP path on bounded 503s', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const requests = [];
  const responses = [
    jsonResponse(503, { error: 'unavailable-1' }),
    jsonResponse(503, { error: 'unavailable-2' }),
    jsonResponse(200, {
      choices: [
        {
          finish_reason: 'stop',
          message: { content: '{"candidate":true}' },
        },
      ],
    }),
  ];
  globalThis.fetch = async (endpoint, request) => {
    requests.push({ endpoint, request });
    return responses.shift();
  };
  let abortHandle = null;

  const result = await runOpenClawGatewayHttp(
    {
      gatewayUrl: 'http://127.0.0.1:18789',
      gatewayToken: 'test-secret-never-logged',
      agentId: 'g2-action-attempt',
      configuredModel: 'openai-codex/gpt-5.4',
      timeoutSeconds: 10,
      sessionRef: 'OVR-TEST-RETRY',
      prompt: 'return exact JSON',
    },
    {
      onChild: (handle) => {
        abortHandle = handle;
      },
      heartbeat: async () => undefined,
      heartbeatIntervalMs: 60_000,
    },
  );

  assert.equal(requests.length, 3);
  assert.ok(abortHandle);
  assert.deepEqual(
    {
      modelOutput: result.modelOutput,
      provider: result.provider,
      model: result.model,
      stopReason: result.stopReason,
    },
    {
      modelOutput: '{"candidate":true}',
      provider: 'openai-codex',
      model: 'gpt-5.4',
      stopReason: 'stop',
    },
  );
  assert.equal(
    String(requests[2].endpoint),
    'http://127.0.0.1:18789/v1/chat/completions',
  );
  const body = JSON.parse(String(requests[2].request.body));
  assert.deepEqual(
    { model: body.model, user: body.user, stream: body.stream },
    {
      model: 'openclaw/g2-action-attempt',
      user: 'g2-action-attempt:OVR-TEST-RETRY',
      stream: false,
    },
  );
});

test('rejects the retired WiseLink proxy model before Gateway transport', async () => {
  await assert.rejects(
    runOpenClawGatewayHttp(
      {
        gatewayUrl: 'http://127.0.0.1:18789',
        gatewayToken: 'test-secret-never-logged',
        agentId: 'g2-action-attempt',
        configuredModel: 'wiselink/wiselink-direct-llm',
        timeoutSeconds: 10,
        sessionRef: 'OVR-TEST-RETIRED-PROVIDER',
        prompt: 'return exact JSON',
      },
      {
        onChild: () => undefined,
        heartbeat: async () => undefined,
        heartbeatIntervalMs: 60_000,
      },
    ),
    /OPENCLAW_DEDICATED_AGENT_BINDING_INVALID/,
  );
});

test('replays a Host commit after transport 5xx without a second model run', async () => {
  const modelInput = { purpose: 'EVALUATE_DYNAMIC_RULES' };
  const unsealedTask = {
    schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
    actionAttemptId: 'ATT-WORKER-RETRY',
    operationRef: 'DYN-WORKER-RETRY',
    taskType: 'OPENCLAW_DYNAMIC_EVALUATION',
    priority: 100,
    tenantId: 'tenant-worker-test',
    workItemId: 'WI-WORKER-TEST',
    inputRevision: 3,
    baseRevision: 3,
    documentVersionId: 'DV-WORKER-TEST',
    sourceRefs: [],
    allowedConnectors: [],
    hostResolvedMissingInputs: [],
    modelInput,
    deadline: '2026-08-24T12:10:00.000Z',
    idempotencyKey: 'worker-test:dynamic:3',
  };
  const task = {
    ...unsealedTask,
    inputHash: canonicalSha256(unsealedTask),
  };
  const claim = {
    attemptRef: task.operationRef,
    status: 'RUNNING',
    leaseToken: '00000000-0000-4000-8000-000000000001',
    leaseGeneration: 1,
    leaseExpiresAt: '2026-08-24T12:01:00.000Z',
    task,
    modelInput,
  };
  let commitCalls = 0;
  let committedResult = null;
  const client = {
    connect: async () => undefined,
    close: async () => undefined,
    callTool: async ({ name, arguments: args }) => {
      if (name === 'begin_dynamic_evaluation') return toolResult(claim);
      if (name === 'heartbeat_action_attempt') {
        return toolResult({ leaseExpiresAt: claim.leaseExpiresAt });
      }
      if (name === 'commit_dynamic_evaluation_candidate') {
        commitCalls += 1;
        if (commitCalls < 3) throw new Error('HOST_TRANSPORT_HTTP_503');
        committedResult = args.result;
        return toolResult({
          workItemId: task.workItemId,
          status: 'BASE_RULE_CANDIDATE_READY',
        });
      }
      throw new Error(`UNEXPECTED_TOOL:${name}`);
    },
  };
  let executeCalls = 0;

  const result = await runOpenClawActionAttempt(
    {
      task: 'dynamic',
      hostMcpUrl: 'http://127.0.0.1:3000/openclaw-mcp',
      hostApiKey: '',
      gatewayUrl: 'http://127.0.0.1:18789',
      gatewayToken: 'test-secret-never-logged',
      workItemId: task.workItemId,
      providers: [],
      containerName: 'openclaw-test',
      agentId: 'g2-action-attempt',
      timeoutSeconds: 10,
      heartbeatIntervalMs: 60_000,
    },
    {
      client,
      executeOpenClaw: async () => {
        executeCalls += 1;
        return {
          modelOutput: '{"candidate":true}',
          provider: 'openai-codex',
          model: 'gpt-5.4',
          durationMs: 10,
          stopReason: 'stop',
        };
      },
      preflightOpenClaw: async () => ({
        configuredModel: 'openai-codex/gpt-5.4',
      }),
    },
  );

  assert.equal(executeCalls, 1);
  assert.equal(commitCalls, 3);
  assert.equal(result.ok, true);
  assert.equal(result.resultStatus, 'SUCCEEDED');
  assert.equal(result.transportProof.transport, 'OPENCLAW_GATEWAY_HTTP');
  assert.equal(result.transportProof.provider, 'openai-codex');
  assert.equal(result.transportProof.model, 'gpt-5.4');
  assert.equal(committedResult.modelVersion, 'openai-codex/gpt-5.4');
});

test('runs TRANSLATE through dedicated begin/commit tools and seals its ResultEnvelope', async () => {
  const modelInput = {
    schemaVersion: 'wiselink.3_1.translation_task.v0.candidate',
    sourceUnits: [
      {
        unitKey: 'UNIT-1',
        kind: 'paragraph',
        text: 'WARNING airplane 5 kg',
        sourceRefIds: ['SRC-1'],
      },
    ],
    rulePack: {
      meta: {
        schemaVersion: 'wiselink.3_1.translation_rule_pack.v0.candidate',
        rulePackId: 'wiselink.host.translation-rules.zh-cn.v1',
        rulePackVersion: '1.0.0',
        label: 'test',
        targetLocale: 'zh-CN',
        sourceLocales: ['en'],
      },
      terms: [],
      noTranslate: [],
      deterministic: {},
    },
    taskStartBinding: {
      documentId: 'DOC-1',
      revisionId: 'DV-1',
      sbdPackageId: 'PKG-1',
      sbdContentHash: 'hash-1',
      tcpPackageId: null,
      tcpContentHash: null,
    },
  };
  const unsealedTask = {
    schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
    actionAttemptId: 'ATT-TRANSLATE-1',
    operationRef: 'TRN-TRANSLATE-1',
    taskType: 'OPENCLAW_TRANSLATE',
    priority: 100,
    tenantId: 'tenant-worker-test',
    workItemId: 'WI-TRANSLATE-1',
    inputRevision: 7,
    baseRevision: 7,
    documentVersionId: 'DV-1',
    sourceRefs: [{ ref: 'artifact://frozen.2', sha256: 'a'.repeat(64) }],
    allowedConnectors: [],
    hostResolvedMissingInputs: [],
    modelInput,
    deadline: '2026-08-24T12:10:00.000Z',
    idempotencyKey: 'worker-test:translation:7',
  };
  const task = {
    ...unsealedTask,
    inputHash: canonicalSha256(unsealedTask),
  };
  const claim = {
    attemptRef: task.operationRef,
    status: 'RUNNING',
    leaseToken: '00000000-0000-4000-8000-000000000011',
    leaseGeneration: 1,
    leaseExpiresAt: '2026-08-24T12:01:00.000Z',
    task,
    modelInput,
  };
  let committed = null;
  const client = {
    connect: async () => undefined,
    close: async () => undefined,
    callTool: async ({ name, arguments: args }) => {
      if (name === 'begin_translation') return toolResult(claim);
      if (name === 'commit_translation_candidate') {
        committed = args.result;
        return toolResult({
          workItemId: task.workItemId,
          workItemRevision: 8,
          status: 'CANDIDATE_ONLY',
        });
      }
      throw new Error(`UNEXPECTED_TOOL:${name}`);
    },
  };
  let executorPrompt = '';
  const modelOutput = JSON.stringify({
    schemaVersion: 'wiselink.3_1.translation_result.v0.candidate',
    rulePackId: modelInput.rulePack.meta.rulePackId,
    rulePackVersion: modelInput.rulePack.meta.rulePackVersion,
    taskStartBinding: modelInput.taskStartBinding,
    candidateUnits: [
      {
        unitKey: 'UNIT-1',
        text: '警告 飞机 5 kg',
        sourceRefIds: ['SRC-1'],
        engineerRevision: null,
      },
    ],
  });

  const result = await runOpenClawActionAttempt(
    {
      task: 'translation',
      hostMcpUrl: 'http://127.0.0.1:3000/openclaw-mcp',
      hostApiKey: '',
      gatewayUrl: 'http://127.0.0.1:18789',
      gatewayToken: 'test-secret-never-logged',
      workItemId: task.workItemId,
      providers: [],
      containerName: 'openclaw-test',
      agentId: 'g2-action-attempt',
      timeoutSeconds: 10,
      heartbeatIntervalMs: 60_000,
    },
    {
      client,
      executeOpenClaw: async (input) => {
        executorPrompt = input.prompt;
        return {
          modelOutput,
          provider: 'openai-codex',
          model: 'gpt-5.4',
          durationMs: 10,
          stopReason: 'stop',
        };
      },
      preflightOpenClaw: async () => ({
        configuredModel: 'openai-codex/gpt-5.4',
      }),
    },
  );

  assert.match(
    executorPrompt,
    /exactly one item for every MODEL_INPUT\.sourceUnits/,
  );
  assert.equal(committed.taskType, 'OPENCLAW_TRANSLATE');
  assert.equal(committed.modelOutput, modelOutput);
  assert.equal(
    committed.promptVersion,
    'wiselink.3_1.openclaw_translation_prompt.v1',
  );
  assert.equal(result.ok, true);
  assert.equal(result.hostCommitStatus, 'CANDIDATE_ONLY');
});

test('recovers a durable COMMITTING result without invoking OpenClaw again', async () => {
  const modelInput = { purpose: 'EVALUATE_DYNAMIC_RULES' };
  const unsealedTask = {
    schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
    actionAttemptId: 'ATT-WORKER-COMMITTING',
    operationRef: 'DYN-WORKER-COMMITTING',
    taskType: 'OPENCLAW_DYNAMIC_EVALUATION',
    priority: 100,
    tenantId: 'tenant-worker-test',
    workItemId: 'WI-WORKER-COMMITTING',
    inputRevision: 8,
    baseRevision: 8,
    documentVersionId: 'DV-WORKER-COMMITTING',
    sourceRefs: [],
    allowedConnectors: [],
    hostResolvedMissingInputs: [],
    modelInput,
    deadline: '2026-08-24T12:10:00.000Z',
    idempotencyKey: 'worker-test:dynamic:8',
  };
  const task = {
    ...unsealedTask,
    inputHash: canonicalSha256(unsealedTask),
  };
  const unsealedResult = {
    schemaVersion: 'wiselink.3_1.openclaw_result_envelope.v1',
    actionAttemptId: task.actionAttemptId,
    operationRef: task.operationRef,
    taskType: task.taskType,
    workItemId: task.workItemId,
    baseRevision: task.baseRevision,
    status: 'SUCCEEDED',
    businessOutcome: 'CANDIDATE_READY',
    candidateStatus: null,
    modelOutput: '{"candidate":true}',
    outputArtifactRefs: [],
    sourceRefs: [],
    factsConsidered: [],
    missingInputs: [],
    conflicts: [],
    warnings: [],
    modelVersion: 'openai-codex/gpt-5.4',
    promptVersion: 'dynamic-prompt-v1',
    skillVersion: 'worker-v1',
    toolVersions: { openclaw: 'gateway-http-chat-completions' },
    runMetrics: { durationMs: 10, inputUnits: 1, outputUnits: 1 },
    errorCode: null,
    errorDetail: null,
  };
  const recoveryResult = {
    ...unsealedResult,
    contentHash: canonicalSha256(unsealedResult),
  };
  let committedResult = null;
  const client = {
    connect: async () => undefined,
    close: async () => undefined,
    callTool: async ({ name, arguments: args }) => {
      if (name === 'begin_dynamic_evaluation') {
        return toolResult({
          attemptRef: task.operationRef,
          status: 'COMMITTING',
          leaseToken: '00000000-0000-4000-8000-000000000008',
          leaseGeneration: 2,
          leaseExpiresAt: '2026-08-24T12:01:00.000Z',
          task,
          modelInput,
          recoveryResult,
        });
      }
      if (name === 'commit_dynamic_evaluation_candidate') {
        committedResult = args.result;
        return toolResult({
          attemptRef: task.operationRef,
          status: 'SUCCEEDED',
          projectionApplied: true,
          terminalReason: 'COMMIT_RECONCILED_FROM_PROJECTION',
        });
      }
      throw new Error(`UNEXPECTED_TOOL:${name}`);
    },
  };
  let executeCalls = 0;
  let preflightCalls = 0;

  const result = await runOpenClawActionAttempt(
    {
      task: 'dynamic',
      hostMcpUrl: 'http://127.0.0.1:3000/openclaw-mcp',
      hostApiKey: '',
      gatewayUrl: 'http://127.0.0.1:18789',
      gatewayToken: 'test-secret-never-logged',
      workItemId: task.workItemId,
      providers: [],
      containerName: 'openclaw-test',
      agentId: 'g2-action-attempt',
      timeoutSeconds: 10,
      heartbeatIntervalMs: 60_000,
    },
    {
      client,
      executeOpenClaw: async () => {
        executeCalls += 1;
        throw new Error('OPENCLAW_MUST_NOT_RUN_DURING_COMMIT_RECOVERY');
      },
      preflightOpenClaw: async () => {
        preflightCalls += 1;
        throw new Error('PREFLIGHT_MUST_NOT_RUN_DURING_COMMIT_RECOVERY');
      },
    },
  );

  assert.equal(executeCalls, 0);
  assert.equal(preflightCalls, 0);
  assert.deepEqual(committedResult, recoveryResult);
  assert.equal(result.ok, true);
  assert.equal(result.transportProof.transport, 'HOST_DURABLE_RESULT_REPLAY');
  assert.equal(result.hostCommitStatus, 'SUCCEEDED');
});

function jsonResponse(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function toolResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    isError: false,
  };
}
