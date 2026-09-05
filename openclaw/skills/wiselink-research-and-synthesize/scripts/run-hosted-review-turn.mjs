#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  chmod,
  link,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  HOST_MCP_TOOLS,
  runInteractiveReviewTurn,
} from './orchestrate-host-mcp.mjs';
import {
  WISELINK_HOST_MCP_NAME,
  WISELINK_HOST_MCP_VERSION,
  WISELINK_PROFILE_REF,
  WISELINK_RUNTIME_APP_ID,
  WISELINK_SKILL_VERSION,
  canonicalJson,
  canonicalSha256,
} from './validate-payload.mjs';

const DRIVER_SCHEMA = 'wiselink.3_1.hosted_review_driver.v1';
const MODEL_OUTPUT_SHAPE_SCHEMA = 'wiselink.3_1.review_model_output_shape.v2';
const KNOWN_MODEL_NONDISPATCH_CODES = new Set([
  'REVIEW_GATEWAY_INVALID_JSON_HTTP_404',
]);
const MODEL_INPUT_SCHEMA = 'wiselink.3_1.review_generation_input.v1';
const MODEL_OUTPUT_KEYS = [
  'responseType',
  'answer',
  'sourceRefs',
  'missingInputs',
  'candidateEvidenceRefs',
  'reviewActionDraft',
  'affectedItemIds',
  'warnings',
];
const REVIEW_OUTPUT_FUNCTION_NAME = 'return_wiselink_review_candidate';
const REVIEW_RESPONSE_TYPES = [
  'ANSWER',
  'CLARIFYING_QUESTION',
  'SOURCE_LINK',
  'CANDIDATE_EVIDENCE',
  'REVIEW_ACTION_DRAFT',
  'INPUT_REQUEST',
  'AFFECTED_ITEMS_PREVIEW',
  'TASK_STATUS',
];
const REVIEW_PROMPT_VERSION = 'wiselink.3_1.review_prompt.v1.c16';
const WISELINK_HOST_MCP_CONFIG_KEYS = new Set([
  WISELINK_HOST_MCP_NAME,
  'wiselink_host_controller',
]);
const MAX_SOURCE_REFS = 100;
const MAX_GATEWAY_BYTES = 4 * 1024 * 1024;

/**
 * Execute one review turn with durable, model-external control-plane state.
 * A completed step is replayed only from its 0600 checkpoint. An ambiguous
 * mutating commit is recovered through one read-only status call; no other
 * ambiguous remote step is retried.
 */
export async function runHostedReviewTurn(options, dependencies = {}) {
  const normalized = normalizeRunOptions(options);
  const checkpoint = await createCheckpointStore(normalized.checkpointDir);
  const prior = await checkpoint.readOptional('run-result');
  if (prior) {
    assertRunBinding(prior.binding, normalized);
    return structuredClone(prior.result);
  }

  const remoteCall = dependencies.callTool;
  const invokeModel = dependencies.invokeModel;
  if (typeof remoteCall !== 'function' || typeof invokeModel !== 'function') {
    throw new Error('REVIEW_DRIVER_DEPENDENCY_REQUIRED');
  }

  const callCounts = new Map();
  let beginResult = null;
  const callTool = async (name, args) => {
    if (!HOST_MCP_TOOLS.includes(name)) {
      throw new Error(`REVIEW_DRIVER_TOOL_NOT_ALLOWED:${name}`);
    }
    const count = (callCounts.get(name) ?? 0) + 1;
    callCounts.set(name, count);
    if (count > 1 && name !== 'read_source_refs') {
      throw new Error(`REVIEW_DRIVER_TOOL_REPLAY_FORBIDDEN:${name}`);
    }
    const step = name === 'read_source_refs' && count > 1
      ? `sources-${count}` : toolStep(name);
    const value = await checkpoint.remoteStep({
      step,
      args,
      ambiguousCommit: name === 'commit_review_turn_candidate',
      perform: () => remoteCall(name, structuredClone(args)),
    });
    if (name === 'begin_review_turn') beginResult = value;
    return value;
  };

  const result = await runInteractiveReviewTurn({
    mode: 'INTERACTIVE_REVIEW',
    reviewConversationRef: normalized.reviewConversationRef,
    requestId: normalized.requestId,
    callTool,
    respond: async ({ input, readSourceRefs }) => {
      assertModelInputHasNoControlPlane(input, normalized, beginResult);
      const selectedSourceRefIds = selectSourceRefIds(input);
      const sourceRefs = [];
      for (let offset = 0; offset < selectedSourceRefIds.length; offset += MAX_SOURCE_REFS) {
        sourceRefs.push(...await readSourceRefs(selectedSourceRefIds.slice(offset, offset + MAX_SOURCE_REFS)));
      }
      const generationInput = {
        schemaVersion: MODEL_INPUT_SCHEMA,
        mode: 'INTERACTIVE_REVIEW',
        purpose: 'SUPERVISED_REVIEW_CANDIDATE',
        candidateOnly: true,
        input,
        sourceRefs,
      };
      assertModelInputHasNoControlPlane(
        generationInput,
        normalized,
        beginResult,
      );
      const modelArgsHash = canonicalSha256(generationInput);
      const execution = await checkpoint.remoteStep({
        step: 'model',
        args: generationInput,
        ambiguousCommit: false,
        perform: () =>
          invokeModel(structuredClone(generationInput), {
            sessionDiscriminator: sha256(normalized.requestId),
            observeOutputShape: async (value) =>
              checkpoint.writeOnce('model.output-shape', {
                schemaVersion: DRIVER_SCHEMA,
                step: 'model',
                argsHash: modelArgsHash,
                observedAt: new Date().toISOString(),
                value: validateModelOutputShape(value),
              }),
          }),
      });
      const partial = validateModelExecution(
        execution,
        selectedSourceRefIds,
        input.attachmentRefs,
      );
      return {
        output: {
          schemaVersion: 'wiselink.3_1.review_turn_candidate.v1.c3',
          mode: 'INTERACTIVE_REVIEW',
          reviewConversationRef:
            beginResult.task.modelInput.reviewConversationRef,
          reviewTurnRef: beginResult.task.modelInput.reviewTurnRef,
          responseType: partial.output.responseType,
          answer: partial.output.answer,
          sourceRefs: partial.output.sourceRefs,
          missingInputs: partial.output.missingInputs,
          candidateEvidenceRefs: partial.output.candidateEvidenceRefs,
          reviewActionDraft: partial.output.reviewActionDraft,
          affectedItemIds: partial.output.affectedItemIds,
          warnings: partial.output.warnings,
          runtime: {
            runtimeAppId: WISELINK_RUNTIME_APP_ID,
            profileRef: WISELINK_PROFILE_REF,
          },
        },
        provenance: partial.provenance,
      };
    },
  });

  const report = {
    ok: result.ok === true,
    mode: result.mode,
    operation: result.operation,
    outcome: result.outcome,
    provenance: structuredClone(result.provenance),
    remoteCallCounts: Object.fromEntries([...callCounts].sort()),
    authorityMutations: {
      reviewCandidatePersisted: result.ok === true,
      workItemRevisionChanged: false,
      currentChanged: false,
      staleChanged: false,
      reviewActionExecuted: false,
    },
  };
  await checkpoint.write('run-result', {
    schemaVersion: DRIVER_SCHEMA,
    binding: runBinding(normalized),
    result: report,
  });
  return report;
}

export async function invokeHostedReviewModel(input, options = {}) {
  const gatewayUrl = requiredUrl(
    options.gatewayUrl,
    'REVIEW_GATEWAY_URL_REQUIRED',
  );
  const gatewayToken = requiredText(
    options.gatewayToken,
    'REVIEW_GATEWAY_TOKEN_REQUIRED',
  );
  const agentId = requiredText(
    options.agentId ?? WISELINK_PROFILE_REF,
    'REVIEW_AGENT_REQUIRED',
  );
  const timeoutMs = positiveInteger(options.timeoutMs, 480_000);
  const configuredModelVersion = requiredText(
    options.configuredModelVersion,
    'REVIEW_MODEL_CONFIG_UNREADABLE',
  );
  const observeOutputShape = options.observeOutputShape;
  if (
    observeOutputShape !== undefined &&
    typeof observeOutputShape !== 'function'
  ) {
    throw new Error('REVIEW_MODEL_OUTPUT_SHAPE_OBSERVER_INVALID');
  }
  const prompt = buildReviewPrompt(input);
  const sessionDiscriminator = requiredText(
    options.sessionDiscriminator ?? canonicalSha256(input),
    'REVIEW_MODEL_SESSION_DISCRIMINATOR_REQUIRED',
  );
  const startedAt = Date.now();
  const endpoint = new URL('/v1/chat/completions', gatewayUrl);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${gatewayToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: `openclaw/${agentId}`,
      user: `review-driver:${sha256(sessionDiscriminator).slice(0, 24)}`,
      messages: [
        {
          role: 'system',
          content:
            `Call ${REVIEW_OUTPUT_FUNCTION_NAME} exactly once to serialize the candidate. Emit no assistant prose. This function has no implementation and is never executed.`,
        },
        { role: 'user', content: prompt },
      ],
      tools: [reviewCandidateFunctionTool()],
      tool_choice: {
        type: 'function',
        function: { name: REVIEW_OUTPUT_FUNCTION_NAME },
      },
      parallel_tool_calls: false,
      n: 1,
      stream: false,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_GATEWAY_BYTES) {
    throw new Error('REVIEW_GATEWAY_RESPONSE_TOO_LARGE');
  }
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`REVIEW_GATEWAY_INVALID_JSON_HTTP_${response.status}`);
  }
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const choice = choices.length === 1 && isRecord(choices[0]) ? choices[0] : null;
  const message = isRecord(choice?.message) ? choice.message : null;
  const outputShape = summarizeHostedReviewModelOutputShape({
    httpStatus: response.status,
    httpOk: response.ok,
    requestedModel: `openclaw/${agentId}`,
    payload,
  });
  if (observeOutputShape) {
    await observeOutputShape(outputShape);
  }
  if (!response.ok) {
    throw new Error(`REVIEW_GATEWAY_HTTP_${response.status}`);
  }
  if (outputShape.hasAnalysis) {
    throw new Error('REVIEW_MODEL_ANALYSIS_FORBIDDEN');
  }
  const { argumentsText, output } = readReviewCandidateArguments(payload);
  const modelVersion = actualModelVersion(
    payload,
    choice,
    message,
    configuredModelVersion,
  );
  return {
    output,
    provenance: {
      modelVersion,
      promptVersion: REVIEW_PROMPT_VERSION,
      skillVersion: WISELINK_SKILL_VERSION,
      toolVersions: {
        [WISELINK_HOST_MCP_NAME]: WISELINK_HOST_MCP_VERSION,
      },
      runMetrics: {
        durationMs: Date.now() - startedAt,
        inputUnits: Buffer.byteLength(prompt),
        outputUnits: Buffer.byteLength(argumentsText),
      },
    },
  };
}

export function isChatCompletionsEnabled(config) {
  return config?.gateway?.http?.endpoints?.chatCompletions?.enabled === true;
}

export function resolveConfiguredModelVersion(
  config,
  agentId = WISELINK_PROFILE_REF,
) {
  const normalizedAgentId = requiredText(
    agentId,
    'REVIEW_AGENT_REQUIRED',
  );
  const agents = config?.agents?.list;
  if (agents !== undefined && !Array.isArray(agents)) {
    throw new Error('REVIEW_MODEL_CONFIG_UNREADABLE');
  }
  const matches = (agents ?? []).filter(
    (agent) => isRecord(agent) && agent.id === normalizedAgentId,
  );
  if (matches.length > 1) {
    throw new Error('REVIEW_MODEL_CONFIG_AMBIGUOUS');
  }
  const modelConfig =
    matches.length === 1 && matches[0].model !== undefined
      ? matches[0].model
      : config?.agents?.defaults?.model;
  const selection =
    typeof modelConfig === 'string'
      ? { primary: modelConfig, fallbacks: [] }
      : isRecord(modelConfig)
        ? {
            primary: modelConfig.primary,
            fallbacks: modelConfig.fallbacks ?? [],
          }
        : null;
  if (!selection) {
    throw new Error('REVIEW_MODEL_CONFIG_UNREADABLE');
  }
  if (
    !Array.isArray(selection.fallbacks) ||
    selection.fallbacks.length > 0
  ) {
    throw new Error('REVIEW_MODEL_FALLBACK_NONEMPTY');
  }
  if (!isReadableActualModel(selection.primary)) {
    throw new Error('REVIEW_MODEL_CONFIG_UNREADABLE');
  }
  return selection.primary.trim();
}

export function summarizeHostedReviewModelOutputShape({
  httpStatus,
  httpOk,
  requestedModel,
  payload,
}) {
  const choices = Array.isArray(payload?.choices) ? payload.choices : [];
  const choice = isRecord(choices[0]) ? choices[0] : null;
  const message = isRecord(choice?.message) ? choice.message : null;
  const content = message?.content;
  const serializedContent = diagnosticContent(content);
  const hasAnalysisWrapper = analysisWrapper(content);
  const toolCalls = Array.isArray(message?.tool_calls)
    ? message.tool_calls
    : [];
  const toolCall = toolCalls.length === 1 && isRecord(toolCalls[0])
    ? toolCalls[0]
    : null;
  const outputFunction = isRecord(toolCall?.function)
    ? toolCall.function
    : null;
  const argumentsText = outputFunction?.arguments;
  const serializedArguments =
    typeof argumentsText === 'string' ? argumentsText : null;
  const argumentsParseResult = rawJsonParseResult(argumentsText);
  const reportedModel = diagnosticToken(
    [
      message?.model,
      message?.model_version,
      choice?.model,
      payload?.model_version,
      payload?.model,
      payload?._meta?.modelVersion,
      payload?._meta?.model,
    ].find((value) => typeof value === 'string' && value.trim() !== ''),
  );
  const reportedProvider = diagnosticToken(
    [
      message?.provider,
      choice?.provider,
      payload?.provider,
      payload?._meta?.provider,
    ].find((value) => typeof value === 'string' && value.trim() !== ''),
  );
  const finishReason = diagnosticToken(choice?.finish_reason);
  const hasAnalysis =
    hasAnalysisWrapper ||
    hasNonEmptyValue(message?.analysis) ||
    hasNonEmptyValue(message?.reasoning) ||
    hasNonEmptyValue(message?.reasoning_content) ||
    (Array.isArray(content) &&
      content.some(
        (item) =>
          isRecord(item) &&
          ['analysis', 'reasoning'].includes(String(item.type).toLowerCase()),
      ));
  const assistantContentBlank = isBlankAssistantContent(content);
  const expectedFunctionNameMatched =
    outputFunction?.name === REVIEW_OUTPUT_FUNCTION_NAME;
  const functionArgumentsAccepted = argumentsParseResult === 'OBJECT';
  const outputChannelAccepted =
    choices.length === 1 &&
    toolCalls.length === 1 &&
    toolCall?.type === 'function' &&
    expectedFunctionNameMatched &&
    typeof argumentsText === 'string' &&
    assistantContentBlank &&
    !hasAnalysis &&
    functionArgumentsAccepted;
  return {
    schemaVersion: MODEL_OUTPUT_SHAPE_SCHEMA,
    http: {
      status: Number.isSafeInteger(httpStatus) ? httpStatus : null,
      ok: httpOk === true,
    },
    routing: {
      requestedModel: diagnosticToken(requestedModel),
      reportedProvider,
      reportedModel,
    },
    finishReason:
      finishReason ??
      (typeof choice?.finish_reason === 'string' ? 'UNREADABLE' : null),
    choiceCount: choices.length,
    hasAnalysis,
    outputChannel: outputChannelAccepted
      ? 'FUNCTION_ARGUMENTS'
      : 'REJECTED',
    assistantContent: {
      type: diagnosticContentType(content),
      byteLength:
        serializedContent === null
          ? null
          : Buffer.byteLength(serializedContent),
      isBlank: assistantContentBlank,
      sha256: serializedContent === null ? null : sha256(serializedContent),
    },
    toolCall: {
      count: toolCalls.length,
      type: diagnosticToken(toolCall?.type),
      nameMatched: expectedFunctionNameMatched,
      argumentsType: diagnosticContentType(argumentsText),
      byteLength:
        serializedArguments === null
          ? null
          : Buffer.byteLength(serializedArguments),
      rawJsonParseResult: argumentsParseResult,
      strictJsonObjectAccepted: functionArgumentsAccepted,
      sha256:
        serializedArguments === null ? null : sha256(serializedArguments),
    },
  };
}

export function assertHostedModelGatewayReady(runtime) {
  if (runtime?.gatewayChatCompletionsEnabled !== true) {
    throw new Error('REVIEW_GATEWAY_CHAT_COMPLETIONS_DISABLED');
  }
}

export async function prepareKnownModelNonDispatchRecovery(options) {
  const checkpointDir = requiredText(
    options?.checkpointDir,
    'REVIEW_CHECKPOINT_DIRECTORY_REQUIRED',
  );
  const failureCode = requiredText(
    options?.failureCode,
    'REVIEW_MODEL_RECOVERY_FAILURE_CODE_REQUIRED',
  );
  if (!KNOWN_MODEL_NONDISPATCH_CODES.has(failureCode)) {
    throw new Error('REVIEW_MODEL_RECOVERY_FAILURE_NOT_PROVEN_NONDISPATCH');
  }
  const evidencePath = requiredText(
    options?.evidencePath,
    'REVIEW_MODEL_RECOVERY_EVIDENCE_REQUIRED',
  );
  const evidenceInfo = await stat(evidencePath);
  if (!evidenceInfo.isFile() || evidenceInfo.size > 4096) {
    throw new Error('REVIEW_MODEL_RECOVERY_EVIDENCE_INVALID');
  }
  const evidence = await readFile(evidencePath, 'utf8');
  const evidenceLines = evidence
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (
    canonicalJson(evidenceLines) !==
    canonicalJson([failureCode, 'FIRST_RUN_EXIT=1'])
  ) {
    throw new Error('REVIEW_MODEL_RECOVERY_EVIDENCE_INVALID');
  }

  const checkpoint = await createCheckpointStore(checkpointDir);
  for (const step of ['begin', 'context', 'sources']) {
    if (
      !(await checkpoint.readOptional(`${step}.started`)) ||
      !(await checkpoint.readOptional(`${step}.result`))
    ) {
      throw new Error(`REVIEW_MODEL_RECOVERY_${step.toUpperCase()}_INCOMPLETE`);
    }
  }
  const originalStarted = await checkpoint.readOptional('model.started');
  const archivedStarted = await checkpoint.readOptional(
    'model.known-nondispatch',
  );
  const modelResult = await checkpoint.readOptional('model.result');
  const recovery = await checkpoint.readOptional('model.recovery');

  if (recovery) {
    if (
      recovery.schemaVersion !== DRIVER_SCHEMA ||
      recovery.step !== 'model' ||
      recovery.failureCode !== failureCode
    ) {
      throw new Error('REVIEW_MODEL_RECOVERY_BINDING_MISMATCH');
    }
    if (!archivedStarted) {
      if (!originalStarted || recovery.argsHash !== originalStarted.argsHash) {
        throw new Error('REVIEW_MODEL_RECOVERY_BINDING_MISMATCH');
      }
      await rename(
        join(checkpointDir, 'model.started.json'),
        join(checkpointDir, 'model.known-nondispatch.json'),
      );
      await chmod(join(checkpointDir, 'model.known-nondispatch.json'), 0o600);
      return { prepared: true, replayed: true };
    }
    if (recovery.argsHash !== archivedStarted.argsHash) {
      throw new Error('REVIEW_MODEL_RECOVERY_BINDING_MISMATCH');
    }
    if (modelResult) return { prepared: true, replayed: true };
    if (originalStarted) {
      throw new Error('REVIEW_MODEL_RECOVERY_OUTCOME_UNKNOWN');
    }
    return { prepared: true, replayed: true };
  }

  if (
    (await checkpoint.readOptional('commit.started')) ||
    (await checkpoint.readOptional('commit.result'))
  ) {
    throw new Error('REVIEW_MODEL_RECOVERY_COMMIT_ALREADY_STARTED');
  }
  if (!originalStarted || archivedStarted || modelResult) {
    throw new Error('REVIEW_MODEL_RECOVERY_CHECKPOINT_STATE_INVALID');
  }
  await checkpoint.write('model.recovery', {
    schemaVersion: DRIVER_SCHEMA,
    step: 'model',
    failureCode,
    argsHash: originalStarted.argsHash,
    preparedAt: new Date().toISOString(),
  });
  await rename(
    join(checkpointDir, 'model.started.json'),
    join(checkpointDir, 'model.known-nondispatch.json'),
  );
  await chmod(join(checkpointDir, 'model.known-nondispatch.json'), 0o600);
  return { prepared: true, replayed: false };
}

export async function createHostMcpConnection(options) {
  const endpoint = new URL(
    requiredUrl(options.hostMcpUrl, 'REVIEW_HOST_MCP_URL_REQUIRED'),
  );
  const headers = isRecord(options.headers) ? options.headers : {};
  const { Client, StreamableHTTPClientTransport } = await loadMcpSdk();
  const client = new Client({
    name: 'wiselink-hosted-review-driver',
    version: '1.0.0',
  });
  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers },
  });
  await client.connect(transport);
  const serverVersion = client.getServerVersion?.();
  if (
    serverVersion?.name !== WISELINK_HOST_MCP_NAME ||
    serverVersion?.version !== WISELINK_HOST_MCP_VERSION
  ) {
    throw new Error('REVIEW_HOST_MCP_IDENTITY_MISMATCH');
  }
  const tools = await client.listTools();
  validateHostToolMetadata(tools);
  return {
    callTool: async (name, args) => callJsonTool(client, name, args),
    hasTool: (name) => tools.tools.some((tool) => tool.name === name),
    close: async () => client.close(),
  };
}

function validateHostToolMetadata(value) {
  const tools = Array.isArray(value?.tools) ? value.tools : [];
  // The pending-work query is an additive control-plane capability. It does
  // not change the established C3 model/commit contract or the required tools.
  const names = tools.map(({ name }) => name)
    .filter((name) => name !== 'get_pending_review_turn').sort();
  const expected = [...HOST_MCP_TOOLS].sort();
  if (canonicalJson(names) !== canonicalJson(expected)) {
    throw new Error('REVIEW_HOST_MCP_EXACT20_MISMATCH');
  }
  const commit = tools.find(
    ({ name }) => name === 'commit_review_turn_candidate',
  );
  const properties = Object.keys(commit?.inputSchema?.properties ?? {}).sort();
  const required = [...(commit?.inputSchema?.required ?? [])].sort();
  const expectedCommit = [
    'attemptRef',
    'leaseGeneration',
    'leaseToken',
    'resultJson',
  ].sort();
  if (
    commit?.inputSchema?.additionalProperties !== false ||
    canonicalJson(properties) !== canonicalJson(expectedCommit) ||
    canonicalJson(required) !== canonicalJson(expectedCommit)
  ) {
    throw new Error('REVIEW_HOST_MCP_COMMIT_SCHEMA_MISMATCH');
  }
}

async function callJsonTool(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  const textBlocks = Array.isArray(result?.content)
    ? result.content.filter((item) => item?.type === 'text')
    : [];
  if (result?.isError === true || textBlocks.length !== 1) {
    throw new Error(`REVIEW_HOST_MCP_TOOL_FAILED:${name}`);
  }
  try {
    return JSON.parse(textBlocks[0].text);
  } catch {
    throw new Error(`REVIEW_HOST_MCP_TOOL_INVALID_JSON:${name}`);
  }
}

async function createCheckpointStore(directory) {
  const root = requiredText(directory, 'REVIEW_CHECKPOINT_DIRECTORY_REQUIRED');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  return {
    readOptional: (step) => readCheckpointOptional(root, step),
    write: (step, value) => writeCheckpoint(root, step, value),
    writeOnce: (step, value) => writeCheckpointOnce(root, step, value),
    remoteStep: async ({ step, args, ambiguousCommit, perform }) => {
      const argsHash = canonicalSha256(args);
      const completed = await readCheckpointOptional(root, `${step}.result`);
      if (completed) {
        assertCheckpointHash(completed, argsHash, step);
        return structuredClone(completed.value);
      }
      const started = await readCheckpointOptional(root, `${step}.started`);
      if (started) {
        assertCheckpointHash(started, argsHash, step);
        if (ambiguousCommit) {
          throw new Error('REVIEW_COMMIT_OUTCOME_UNKNOWN');
        }
        throw new Error(`REVIEW_${step.toUpperCase()}_OUTCOME_UNKNOWN`);
      }
      await writeCheckpoint(root, `${step}.started`, {
        schemaVersion: DRIVER_SCHEMA,
        step,
        argsHash,
        startedAt: new Date().toISOString(),
      });
      const value = await perform();
      await writeCheckpoint(root, `${step}.result`, {
        schemaVersion: DRIVER_SCHEMA,
        step,
        argsHash,
        finishedAt: new Date().toISOString(),
        value,
      });
      return structuredClone(value);
    },
  };
}

async function readCheckpointOptional(root, step) {
  const path = join(root, `${step}.json`);
  try {
    const info = await stat(path);
    if ((info.mode & 0o077) !== 0) {
      throw new Error(`REVIEW_CHECKPOINT_PERMISSIONS_INVALID:${step}`);
    }
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeCheckpoint(root, step, value) {
  const path = join(root, `${step}.json`);
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${canonicalJson(value)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  await chmod(path, 0o600);
}

async function writeCheckpointOnce(root, step, value) {
  const path = join(root, `${step}.json`);
  const temporary = `${path}.${process.pid}.once.tmp`;
  await writeFile(temporary, `${canonicalJson(value)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  await chmod(temporary, 0o600);
  try {
    await link(temporary, path);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(`REVIEW_CHECKPOINT_ALREADY_EXISTS:${step}`);
    }
    throw error;
  } finally {
    await unlink(temporary).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
  await chmod(path, 0o600);
}

function toolStep(name) {
  return (
    {
      begin_review_turn: 'begin',
      get_review_turn_context: 'context',
      read_source_refs: 'sources',
      commit_review_turn_candidate: 'commit',
      get_action_attempt_status: 'status',
    }[name] ?? `tool-${name}`
  );
}

function selectSourceRefIds(input) {
  const available = new Set(input.availableSourceRefIds ?? []);
  const selected = input.selectedEvaluationItemId;
  const items = Array.isArray(input.context?.evaluation?.items)
    ? input.context.evaluation.items
    : [];
  const item = items.find(({ criterionId }) => criterionId === selected);
  const preferred = Array.isArray(item?.sourceRefs) ? item.sourceRefs : [];
  const attachments = Array.isArray(input.attachmentRefs)
    ? input.attachmentRefs
    : [];
  const ids = [
    ...(preferred.length > 0 ? preferred : [...available]),
    ...attachments,
  ].filter((id) => available.has(id));
  const unique = [...new Set(ids)];
  return unique;
}

function validateModelExecution(
  value,
  readSourceRefIds,
  candidateEvidenceRefIds,
) {
  if (
    !isRecord(value) ||
    !isRecord(value.output) ||
    !isRecord(value.provenance)
  ) {
    throw new Error('REVIEW_MODEL_EXECUTION_INVALID');
  }
  const output = value.output;
  if (
    canonicalJson(Object.keys(output).sort()) !==
    canonicalJson([...MODEL_OUTPUT_KEYS].sort())
  ) {
    throw new Error('REVIEW_MODEL_OUTPUT_KEYS_INVALID');
  }
  if (!REVIEW_RESPONSE_TYPES.includes(output.responseType)) {
    throw new Error('REVIEW_MODEL_RESPONSE_TYPE_INVALID');
  }
  requiredText(output.answer, 'REVIEW_MODEL_ANSWER_REQUIRED');
  for (const key of [
    'sourceRefs',
    'missingInputs',
    'candidateEvidenceRefs',
    'affectedItemIds',
    'warnings',
  ]) {
    if (
      !Array.isArray(output[key]) ||
      output[key].some(
        (item) => typeof item !== 'string' || item.trim() === '',
      ) ||
      new Set(output[key]).size !== output[key].length
    ) {
      throw new Error(`REVIEW_MODEL_${key.toUpperCase()}_INVALID`);
    }
  }
  if (output.responseType === 'SOURCE_LINK' && output.sourceRefs.length === 0) {
    throw new Error('REVIEW_MODEL_SOURCE_LINK_REF_REQUIRED');
  }
  const allowed = new Set(readSourceRefIds);
  if (
    [...output.sourceRefs, ...output.candidateEvidenceRefs].some(
      (sourceRefId) => !allowed.has(sourceRefId),
    )
  ) {
    throw new Error('REVIEW_MODEL_SOURCE_REF_NOT_READ');
  }
  const allowedCandidateEvidence = new Set(candidateEvidenceRefIds ?? []);
  if (
    output.candidateEvidenceRefs.some(
      (sourceRefId) => !allowedCandidateEvidence.has(sourceRefId),
    )
  ) {
    throw new Error('REVIEW_MODEL_CANDIDATE_EVIDENCE_REF_NOT_ATTACHMENT');
  }
  const hasDraft = isRecord(output.reviewActionDraft);
  if (
    (output.responseType === 'REVIEW_ACTION_DRAFT') !== hasDraft ||
    (output.reviewActionDraft !== null && !hasDraft)
  ) {
    throw new Error('REVIEW_MODEL_DRAFT_RESPONSE_MISMATCH');
  }
  if (
    output.responseType === 'CANDIDATE_EVIDENCE' &&
    output.candidateEvidenceRefs.length === 0
  ) {
    throw new Error('REVIEW_MODEL_CANDIDATE_EVIDENCE_REQUIRED');
  }
  if (
    output.responseType === 'AFFECTED_ITEMS_PREVIEW' &&
    output.affectedItemIds.length === 0
  ) {
    throw new Error('REVIEW_MODEL_AFFECTED_ITEMS_REQUIRED');
  }
  if (
    [
      'ANSWER',
      'CLARIFYING_QUESTION',
      'SOURCE_LINK',
      'INPUT_REQUEST',
      'TASK_STATUS',
    ].includes(output.responseType) &&
    (output.candidateEvidenceRefs.length > 0 ||
      output.affectedItemIds.length > 0)
  ) {
    throw new Error('REVIEW_MODEL_READ_ONLY_SIDE_EFFECT_INVALID');
  }
  return value;
}

function assertModelInputHasNoControlPlane(value, options, begin) {
  const serialized = JSON.stringify(value);
  const forbidden = [
    options.reviewConversationRef,
    options.requestId,
    begin?.attemptRef,
    begin?.leaseToken,
    begin?.task?.actionAttemptId,
    begin?.task?.operationRef,
    begin?.task?.modelInput?.reviewTurnRef,
    begin?.task?.workItemId,
  ].filter((item) => typeof item === 'string' && item.length > 0);
  if (forbidden.some((item) => serialized.includes(item))) {
    throw new Error('REVIEW_MODEL_CONTROL_PLANE_VALUE_FORBIDDEN');
  }
}

function validateModelOutputJson(value) {
  if (!isRecord(value)) throw new Error('REVIEW_MODEL_OUTPUT_INVALID');
  return value;
}

function validateModelOutputShape(value) {
  const fail = () => {
    throw new Error('REVIEW_MODEL_OUTPUT_SHAPE_INVALID');
  };
  if (
    !isRecord(value) ||
    value.schemaVersion !== MODEL_OUTPUT_SHAPE_SCHEMA ||
    canonicalJson(Object.keys(value).sort()) !==
      canonicalJson(
        [
          'schemaVersion',
          'http',
          'routing',
          'finishReason',
          'choiceCount',
          'hasAnalysis',
          'outputChannel',
          'assistantContent',
          'toolCall',
        ].sort(),
      ) ||
    !isRecord(value.http) ||
    canonicalJson(Object.keys(value.http).sort()) !==
      canonicalJson(['status', 'ok'].sort()) ||
    !isRecord(value.routing) ||
    canonicalJson(Object.keys(value.routing).sort()) !==
      canonicalJson(
        ['requestedModel', 'reportedProvider', 'reportedModel'].sort(),
      ) ||
    !isRecord(value.assistantContent) ||
    !isRecord(value.toolCall)
  ) {
    fail();
  }
  if (
    canonicalJson(Object.keys(value.assistantContent).sort()) !==
      canonicalJson(['type', 'byteLength', 'isBlank', 'sha256'].sort()) ||
    canonicalJson(Object.keys(value.toolCall).sort()) !==
      canonicalJson(
        [
          'count',
          'type',
          'nameMatched',
          'argumentsType',
          'byteLength',
          'rawJsonParseResult',
          'strictJsonObjectAccepted',
          'sha256',
        ].sort(),
      ) ||
    (value.http.status !== null && !Number.isSafeInteger(value.http.status)) ||
    typeof value.http.ok !== 'boolean' ||
    !Number.isSafeInteger(value.choiceCount) ||
    value.choiceCount < 0 ||
    typeof value.hasAnalysis !== 'boolean' ||
    !['FUNCTION_ARGUMENTS', 'REJECTED'].includes(value.outputChannel) ||
    ![
      'string',
      'array',
      'object',
      'null',
      'number',
      'boolean',
      'missing',
    ].includes(value.assistantContent.type) ||
    !nullableNonNegativeInteger(value.assistantContent.byteLength) ||
    typeof value.assistantContent.isBlank !== 'boolean' ||
    (value.assistantContent.sha256 !== null &&
      !/^[0-9a-f]{64}$/u.test(value.assistantContent.sha256)) ||
    !Number.isSafeInteger(value.toolCall.count) ||
    value.toolCall.count < 0 ||
    (value.toolCall.type !== null &&
      diagnosticToken(value.toolCall.type) !== value.toolCall.type) ||
    typeof value.toolCall.nameMatched !== 'boolean' ||
    ![
      'string',
      'array',
      'object',
      'null',
      'number',
      'boolean',
      'missing',
    ].includes(value.toolCall.argumentsType) ||
    !nullableNonNegativeInteger(value.toolCall.byteLength) ||
    ![
      'OBJECT',
      'ARRAY',
      'NULL',
      'STRING',
      'NUMBER',
      'BOOLEAN',
      'INVALID',
      'NON_STRING',
    ].includes(value.toolCall.rawJsonParseResult) ||
    typeof value.toolCall.strictJsonObjectAccepted !== 'boolean' ||
    (value.toolCall.sha256 !== null &&
      !/^[0-9a-f]{64}$/u.test(value.toolCall.sha256)) ||
    ![value.finishReason, ...Object.values(value.routing)].every(
      (item) => item === null || diagnosticToken(item) === item,
    )
  ) {
    fail();
  }
  return structuredClone(value);
}

function nullableNonNegativeInteger(value) {
  return value === null || (Number.isSafeInteger(value) && value >= 0);
}

function readReviewCandidateArguments(payload) {
  if (!Array.isArray(payload?.choices) || payload.choices.length !== 1) {
    throw new Error('REVIEW_GATEWAY_CHOICE_COUNT_INVALID');
  }
  const choice = payload.choices[0];
  const message = isRecord(choice?.message) ? choice.message : null;
  if (!message) throw new Error('REVIEW_GATEWAY_MESSAGE_INVALID');
  if (!isBlankAssistantContent(message.content)) {
    throw new Error('REVIEW_GATEWAY_ASSISTANT_CONTENT_FORBIDDEN');
  }
  if (!Array.isArray(message.tool_calls) || message.tool_calls.length !== 1) {
    throw new Error('REVIEW_GATEWAY_OUTPUT_FUNCTION_COUNT_INVALID');
  }
  const toolCall = message.tool_calls[0];
  if (!isRecord(toolCall) || toolCall.type !== 'function') {
    throw new Error('REVIEW_GATEWAY_OUTPUT_FUNCTION_TYPE_INVALID');
  }
  if (
    !isRecord(toolCall.function) ||
    toolCall.function.name !== REVIEW_OUTPUT_FUNCTION_NAME
  ) {
    throw new Error('REVIEW_GATEWAY_OUTPUT_FUNCTION_NAME_INVALID');
  }
  const argumentsText = toolCall.function.arguments;
  if (typeof argumentsText !== 'string') {
    throw new Error('REVIEW_GATEWAY_OUTPUT_FUNCTION_ARGUMENTS_REQUIRED');
  }
  return {
    argumentsText,
    output: parseStrictJsonObject(argumentsText),
  };
}

function parseStrictJsonObject(value) {
  if (typeof value !== 'string') {
    throw new Error('REVIEW_MODEL_STRICT_JSON_REQUIRED');
  }
  const normalized = value.trim();
  if (!normalized.startsWith('{') || !normalized.endsWith('}')) {
    throw new Error('REVIEW_MODEL_STRICT_JSON_REQUIRED');
  }
  try {
    return validateModelOutputJson(JSON.parse(normalized));
  } catch (error) {
    if (error?.message === 'REVIEW_MODEL_OUTPUT_INVALID') throw error;
    throw new Error('REVIEW_MODEL_JSON_INVALID');
  }
}

function rawJsonParseResult(value) {
  if (typeof value !== 'string') return 'NON_STRING';
  try {
    const parsed = JSON.parse(value.trim());
    if (isRecord(parsed)) return 'OBJECT';
    if (Array.isArray(parsed)) return 'ARRAY';
    if (parsed === null) return 'NULL';
    return typeof parsed === 'string'
      ? 'STRING'
      : typeof parsed === 'number'
        ? 'NUMBER'
        : 'BOOLEAN';
  } catch {
    return 'INVALID';
  }
}

function diagnosticContent(value) {
  if (value === undefined) return null;
  return typeof value === 'string' ? value : canonicalJson(value);
}

function diagnosticContentType(value) {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function diagnosticToken(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,159}$/u.test(normalized)
    ? normalized
    : null;
}

function analysisWrapper(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  return (
    /^<(?:analysis|think)(?:\s[^>]*)?>/iu.test(normalized) ||
    /<\/(?:analysis|think)>$/iu.test(normalized)
  );
}

function hasNonEmptyValue(value) {
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return isRecord(value) && Object.keys(value).length > 0;
}

function isBlankAssistantContent(value) {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '')
  );
}

function reviewCandidateFunctionTool() {
  const stringArray = {
    type: 'array',
    items: { type: 'string', minLength: 1 },
    uniqueItems: true,
  };
  return {
    type: 'function',
    function: {
      name: REVIEW_OUTPUT_FUNCTION_NAME,
      description:
        'Serialization-only WiseLink review candidate output. It has no implementation and is never executed.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: [...MODEL_OUTPUT_KEYS],
        properties: {
          responseType: { type: 'string', enum: [...REVIEW_RESPONSE_TYPES] },
          answer: { type: 'string', minLength: 1 },
          sourceRefs: structuredClone(stringArray),
          missingInputs: structuredClone(stringArray),
          candidateEvidenceRefs: structuredClone(stringArray),
          reviewActionDraft: {
            anyOf: [{ type: 'object' }, { type: 'null' }],
          },
          affectedItemIds: structuredClone(stringArray),
          warnings: structuredClone(stringArray),
        },
      },
    },
  };
}

function buildReviewPrompt(input) {
  return [
    'Generate one candidate-only WiseLink engineering review response from the engineer message and the current Host-frozen context.',
    `Call ${REVIEW_OUTPUT_FUNCTION_NAME} exactly once. It is only a serialization channel and will not be executed. Emit no prose outside its arguments.`,
    'Use sourceRefs and candidateEvidenceRefs only from SOURCE_REFS read this turn. Never invent facts, IDs, evidence, adoption, approval, publication, confirmation, current changes, or gap closure.',
    'When the engineer asks to locate, cite, or return a SourceRef, use SOURCE_LINK and include at least one relevant sourceRefs entry read this turn. SOURCE_LINK with an empty sourceRefs array is invalid.',
    'For an explanation, source link, clarification, input request, or task status, set candidateEvidenceRefs and affectedItemIds to [] and reviewActionDraft to null.',
    'Use CANDIDATE_EVIDENCE only when the engineer asks to analyze supplied or Host-authorized evidence; keep reviewActionDraft null and include every proposed evidence ref in candidateEvidenceRefs.',
    'Ordinary questions, corrections, additional material, or revisions to a working judgment do not require a ReviewAction. Return an answer or candidate evidence and continue the discussion.',
    'Use REVIEW_ACTION_DRAFT only when the engineer explicitly asks to formally adopt evidence or change the adopted business judgment, assumptions, conservative bound, or monitoring/review controls.',
    'A reviewActionDraft must contain exactly: baseRevision, evaluationItemId, proposedStatus, resolvedGapRefs, adoptedInputRefs, sourceRefs, assumptions, affectedItemIds, overallImpact, uncertaintyDispositions, decisionSnapshot.',
    'Each uncertainty disposition must contain exactly: gapRef, disposition, rationale, assumptions, controlsAndMitigations, evidenceRefs, reviewBy, reopenTriggers.',
    'decisionSnapshot must contain exactly: assessmentAsOf, evidenceHorizon, currentBestJudgment, alternativeJudgments, decisionMaturity, decisiveFacts, assumptions, residualUncertainties, uncertaintyDispositions, controlsAndMitigations, monitoringPlan, validUntil, reviewBy, reopenTriggers, whatWouldChangeDecision, candidateOnly. Its uncertaintyDispositions must exactly equal the draft list and candidateOnly must be true.',
    'Copy only allowed revision, evaluation item, adopted input, source, attachment, and gap refs from INPUT. A draft proposes change but never confirms or executes it.',
    'State the current best bounded judgment, remaining uncertainty, and what would change the judgment when relevant.',
    'Use context.commonContext when supplied: continue prior discussion and later engineer corrections, distinguishing historical working answers from adopted inputs and current evidence. Report omitted history or unavailable RAG honestly. Procedural-reference catalogs and historical attachment names do not mean their contents were read.',
    'Do not call any other tool. The driver exclusively owns begin, context, SourceRef read, commit, and status.',
    `INPUT:\n${canonicalJson(input)}`,
  ].join('\n');
}

function actualModelVersion(
  payload,
  choice,
  message,
  configuredModelVersion,
) {
  const candidates = [
    message?.model,
    message?.model_version,
    choice?.model,
    payload?.model_version,
    payload?.model,
    payload?._meta?.modelVersion,
    payload?._meta?.model,
    configuredModelVersion,
  ];
  const model = candidates.find(isReadableActualModel);
  if (!model) throw new Error('REVIEW_MODEL_PROVENANCE_UNREADABLE');
  const provider = [
    message?.provider,
    choice?.provider,
    payload?.provider,
    payload?._meta?.provider,
  ].find((value) => typeof value === 'string' && value.trim() !== '');
  return provider && !String(model).includes('/')
    ? `${provider.trim()}/${String(model).trim()}`
    : String(model).trim();
}

function isReadableActualModel(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  const normalized = value.trim().toLowerCase();
  return !(
    normalized === 'unknown' ||
    normalized === 'fallback' ||
    normalized === 'default' ||
    normalized === 'main' ||
    normalized === WISELINK_PROFILE_REF ||
    normalized.startsWith('openclaw/')
  );
}

function normalizeRunOptions(value) {
  if (!isRecord(value)) throw new Error('REVIEW_DRIVER_OPTIONS_REQUIRED');
  return {
    reviewConversationRef: requiredText(
      value.reviewConversationRef,
      'REVIEW_CONVERSATION_REF_REQUIRED',
    ),
    requestId: requiredText(value.requestId, 'REVIEW_REQUEST_ID_REQUIRED'),
    checkpointDir: requiredText(
      value.checkpointDir,
      'REVIEW_CHECKPOINT_DIRECTORY_REQUIRED',
    ),
  };
}

function runBinding(options) {
  return {
    reviewConversationRefHash: sha256(options.reviewConversationRef),
    requestIdHash: sha256(options.requestId),
  };
}

function assertRunBinding(value, options) {
  if (canonicalJson(value) !== canonicalJson(runBinding(options))) {
    throw new Error('REVIEW_CHECKPOINT_BINDING_MISMATCH');
  }
}

function assertCheckpointHash(value, argsHash, step) {
  if (value?.schemaVersion !== DRIVER_SCHEMA || value.argsHash !== argsHash) {
    throw new Error(`REVIEW_CHECKPOINT_ARGUMENT_MISMATCH:${step}`);
  }
}

async function loadMcpSdk() {
  try {
    const module = await import('@modelcontextprotocol/client');
    if (module.Client && module.StreamableHTTPClientTransport) return module;
  } catch {
    // Official Hosted OpenClaw installs the v1 SDK under its global package.
  }
  const roots = [
    '/home/gem/.npm-global/lib/node_modules/openclaw/node_modules/@modelcontextprotocol/sdk/dist/esm',
    '/home/node/.npm-global/lib/node_modules/openclaw/node_modules/@modelcontextprotocol/sdk/dist/esm',
  ];
  for (const root of roots) {
    try {
      const client = await import(
        pathToFileURL(join(root, 'client/index.js')).href
      );
      const transport = await import(
        pathToFileURL(join(root, 'client/streamableHttp.js')).href
      );
      if (client.Client && transport.StreamableHTTPClientTransport) {
        return {
          Client: client.Client,
          StreamableHTTPClientTransport:
            transport.StreamableHTTPClientTransport,
        };
      }
    } catch {
      // Try the next official global runtime path.
    }
  }
  throw new Error('REVIEW_MCP_SDK_NOT_FOUND');
}

export async function resolveRuntimeConfig(argv, env) {
  const explicitConfigPath =
    option(argv, '--openclaw-config') || env.OPENCLAW_CONFIG_PATH || '';
  const candidates = openClawConfigCandidates(argv, env);
  const readable = [];
  for (const configPath of candidates) {
    try {
      readable.push({
        configPath,
        config: JSON.parse(await readFile(configPath, 'utf8')),
      });
    } catch {
      // Candidate paths are intentionally probed read-only. An explicit path
      // remains fail-closed below instead of falling through to another file.
    }
  }
  if (explicitConfigPath && readable.length !== 1) {
    throw new Error('REVIEW_OPENCLAW_CONFIG_UNREADABLE');
  }
  const matched = readable
    .map(({ configPath, config }) => ({
      configPath,
      config,
      mcp: findMcpConfig(config),
    }))
    .filter(({ mcp }) => mcp !== null);
  if (matched.length > 1) {
    const uniqueBindings = new Set(
      matched.map(({ config, mcp }) =>
        canonicalJson({
          url: mcp.url,
          headers: mcp.headers ?? {},
          gatewayPort: config?.gateway?.port ?? null,
          gatewayToken: config?.gateway?.auth?.token ?? null,
        }),
      ),
    );
    if (uniqueBindings.size > 1) {
      throw new Error('REVIEW_OPENCLAW_CONFIG_AMBIGUOUS');
    }
  }
  const selected = matched[0] ?? readable[0] ?? { config: {}, mcp: null };
  const { config, mcp } = selected;
  if (!mcp && !env.WL_REVIEW_HOST_MCP_URL) {
    throw new Error('REVIEW_HOST_MCP_CONFIG_NOT_FOUND');
  }
  const hostMcpUrl = env.WL_REVIEW_HOST_MCP_URL || mcp?.url;
  const headers = parseHeaders(
    env.WL_REVIEW_HOST_MCP_HEADERS_JSON,
    mcp?.headers,
  );
  const port = config?.gateway?.port;
  const gatewayUrl =
    env.WL_REVIEW_GATEWAY_URL ||
    (Number.isSafeInteger(port) ? `http://127.0.0.1:${port}` : '');
  const gatewayToken =
    env.WL_REVIEW_GATEWAY_TOKEN || config?.gateway?.auth?.token || '';
  const agentId = option(argv, '--agent') || WISELINK_PROFILE_REF;
  return {
    hostMcpUrl,
    headers,
    gatewayUrl,
    gatewayToken,
    gatewayChatCompletionsEnabled: isChatCompletionsEnabled(config),
    configuredModelVersion: resolveConfiguredModelVersion(config, agentId),
  };
}

export function openClawConfigCandidates(
  argv,
  env,
  { homeDirectory = homedir(), workingDirectory = process.cwd() } = {},
) {
  const explicit =
    option(argv, '--openclaw-config') || env.OPENCLAW_CONFIG_PATH;
  if (explicit) return [resolve(explicit)];

  const candidates = [];
  if (env.OPENCLAW_STATE_DIR) {
    candidates.push(join(resolve(env.OPENCLAW_STATE_DIR), 'openclaw.json'));
  }
  candidates.push(join(resolve(homeDirectory), '.openclaw', 'openclaw.json'));

  let current = resolve(workingDirectory);
  for (let depth = 0; depth < 8; depth += 1) {
    candidates.push(join(current, 'openclaw.json'));
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return [...new Set(candidates)];
}

export function findMcpConfig(root) {
  const matches = [];
  const visit = (value, path = []) => {
    if (!value || typeof value !== 'object') return;
    if (
      typeof value.url === 'string' &&
      (path.some((segment) => WISELINK_HOST_MCP_CONFIG_KEYS.has(segment)) ||
        value.name === WISELINK_HOST_MCP_NAME)
    ) {
      matches.push(value);
    }
    for (const [key, child] of Object.entries(value)) {
      visit(child, [...path, key]);
    }
  };
  visit(root);
  if (matches.length > 1) throw new Error('REVIEW_HOST_MCP_CONFIG_AMBIGUOUS');
  return matches[0] ?? null;
}

function parseHeaders(serialized, fallback) {
  if (!serialized) return isRecord(fallback) ? fallback : {};
  try {
    const value = JSON.parse(serialized);
    if (!isRecord(value)) throw new Error();
    return value;
  } catch {
    throw new Error('REVIEW_HOST_MCP_HEADERS_INVALID');
  }
}

function option(argv, name) {
  const index = argv.indexOf(name);
  return index < 0 ? '' : argv[index + 1] || '';
}

function requiredText(value, code) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(code);
  return value.trim();
}

function requiredUrl(value, code) {
  const text = requiredText(value, code);
  try {
    return new URL(text).toString();
  } catch {
    throw new Error(code);
  }
}

function positiveInteger(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('REVIEW_POSITIVE_INTEGER_REQUIRED');
  }
  return value;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function usage() {
  return [
    'Usage: node scripts/run-hosted-review-turn.mjs --review-conversation-ref RC-... --request-id ... --checkpoint-dir /private/path',
    'Known non-dispatch recovery: --recover-known-model-nondispatch REVIEW_GATEWAY_INVALID_JSON_HTTP_404 --failure-evidence-file /private/log',
    'Runtime config is read from OpenClaw. Explicit env overrides: WL_REVIEW_HOST_MCP_URL, WL_REVIEW_HOST_MCP_HEADERS_JSON, WL_REVIEW_GATEWAY_URL, WL_REVIEW_GATEWAY_TOKEN.',
  ].join('\n');
}

async function main(argv, env) {
  if (argv.includes('--help')) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const options = {
    reviewConversationRef: option(argv, '--review-conversation-ref'),
    requestId: option(argv, '--request-id'),
    checkpointDir: option(argv, '--checkpoint-dir'),
  };
  const runtime = await resolveRuntimeConfig(argv, env);
  assertHostedModelGatewayReady(runtime);
  const recoveryFailureCode = option(argv, '--recover-known-model-nondispatch');
  if (recoveryFailureCode) {
    await prepareKnownModelNonDispatchRecovery({
      checkpointDir: options.checkpointDir,
      failureCode: recoveryFailureCode,
      evidencePath: option(argv, '--failure-evidence-file'),
    });
  }
  const connection = await createHostMcpConnection(runtime);
  try {
    const result = await runHostedReviewTurn(options, {
      callTool: connection.callTool,
      invokeModel: (input, hooks = {}) =>
        invokeHostedReviewModel(input, {
          gatewayUrl: runtime.gatewayUrl,
          gatewayToken: runtime.gatewayToken,
          agentId: option(argv, '--agent') || WISELINK_PROFILE_REF,
          configuredModelVersion: runtime.configuredModelVersion,
          sessionDiscriminator: hooks.sessionDiscriminator,
          timeoutMs: positiveInteger(
            Number.parseInt(option(argv, '--timeout-ms'), 10) || undefined,
            480_000,
          ),
          observeOutputShape: hooks.observeOutputShape,
        }),
    });
    process.stdout.write(`${canonicalJson(result)}\n`);
  } finally {
    await connection.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2), process.env).catch((error) => {
    process.stderr.write(`${error?.message || 'REVIEW_DRIVER_FAILED'}\n`);
    process.exitCode = 1;
  });
}
