#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';

const RESULT_SCHEMA = 'wiselink.3_1.openclaw_result_envelope.v1';
const TASK_SCHEMA = 'wiselink.3_1.openclaw_task_envelope.v1';
const EXECUTOR_VERSION = 'wiselink-openclaw-action-attempt-worker.v1';
const MAX_PROCESS_OUTPUT_BYTES = 16 * 1024 * 1024;
const REQUIRED_OPENCLAW_AGENT_ID = 'g2-action-attempt';
const REQUIRED_OPENCLAW_MODEL = 'wiselink/wiselink-direct-llm';
const REQUIRED_OPENCLAW_TOOLS = ['session_status'];
const STRICT_JSON_SYSTEM_PROMPT = [
  'Return exactly one strict JSON object that satisfies every schema, type, byte-budget, and semantic invariant in the user request.',
  'The first output code point must be ASCII { and the last must be ASCII }; emit no Markdown, BOM, zero-width character, prefix, or suffix.',
  'Never change an array field to a scalar or null, even when compacting output.',
].join(' ');

const TASK_CONFIG = {
  dynamic: {
    taskType: 'OPENCLAW_DYNAMIC_EVALUATION',
    beginTool: 'begin_dynamic_evaluation',
    commitTool: 'commit_dynamic_evaluation_candidate',
    promptVersion: 'wiselink.3_1.openclaw_dynamic_prompt.v1',
  },
  overall: {
    taskType: 'OPENCLAW_OVERALL_SYNTHESIS',
    beginTool: 'begin_overall_synthesis',
    commitTool: 'commit_overall_candidate',
    promptVersion: 'wiselink.3_1.openclaw_overall_prompt.v1',
  },
  translation: {
    taskType: 'OPENCLAW_TRANSLATE',
    beginTool: 'begin_translation',
    commitTool: 'commit_translation_candidate',
    promptVersion: 'wiselink.3_1.openclaw_translation_prompt.v1',
  },
};

export async function runOpenClawActionAttempt(options, dependencies = {}) {
  const client = dependencies.client ?? createClient();
  const executeOpenClaw =
    dependencies.executeOpenClaw ?? runOpenClawGatewayHttp;
  const preflightOpenClaw =
    dependencies.preflightOpenClaw ?? assertOpenClawGatewayReady;
  const endpoint = new URL(options.hostMcpUrl);
  const headers = hostHeaders(
    options.hostApiKey,
    options.localDevWebUser,
    options.localDevTenantId,
    endpoint,
  );
  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers },
  });
  let activeClaim = null;
  let activeChild = null;
  let interrupted = false;

  const interrupt = async () => {
    if (interrupted) return;
    interrupted = true;
    activeChild?.kill('SIGTERM');
    if (activeClaim) {
      try {
        await callJsonTool(client, 'cancel_action_attempt', {
          attemptRef: activeClaim.attemptRef,
          reason: 'Executor process interrupted before Host commit.',
        });
      } catch {
        // The durable lease/fence still prevents a stale process from committing.
      }
    }
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);

  try {
    await withTransportRetry(() => client.connect(transport));
    const config = TASK_CONFIG[options.task];
    const beginArguments =
      options.task === 'overall'
        ? { workItemId: options.workItemId, providers: options.providers }
        : { workItemId: options.workItemId };
    const claim = await withTransportRetry(() =>
      callJsonTool(client, config.beginTool, beginArguments),
    );
    activeClaim = requiredClaim(claim, config.taskType, options.workItemId);
    const modelInput = modelInputBoundToTask(activeClaim, options.task);

    let result;
    let transportProof = null;
    if (activeClaim.status === 'COMMITTING') {
      result = activeClaim.recoveryResult;
      transportProof = {
        transport: 'HOST_DURABLE_RESULT_REPLAY',
        originalModelVersion: result.modelVersion,
      };
    } else if (activeClaim.task.hostResolvedMissingInputs.length > 0) {
      result = sealResultEnvelope({
        task: activeClaim.task,
        status: 'WAITING_INPUT',
        businessOutcome: 'WAITING_INPUT',
        candidateStatus: 'WAITING_INPUT',
        modelOutput: null,
        missingInputs: activeClaim.task.hostResolvedMissingInputs,
        modelVersion: 'not-invoked',
        promptVersion: config.promptVersion,
        durationMs: 0,
        inputUnits: Buffer.byteLength(canonicalJson(modelInput)),
        outputUnits: 0,
      });
    } else {
      const startedAt = Date.now();
      try {
        const readiness = await withTransportRetry(() =>
          preflightOpenClaw({
            containerName: options.containerName,
            gatewayUrl: options.gatewayUrl,
            gatewayToken: options.gatewayToken,
            agentId: options.agentId,
            timeoutSeconds: Math.min(options.timeoutSeconds, 60),
          }),
        );
        const execution = await executeOpenClaw(
          {
            gatewayUrl: options.gatewayUrl,
            gatewayToken: options.gatewayToken,
            agentId: options.agentId,
            timeoutSeconds: options.timeoutSeconds,
            sessionRef: activeClaim.task.operationRef,
            prompt: buildExecutorPrompt(options.task, modelInput),
            configuredModel: readiness.configuredModel,
          },
          {
            onChild: (child) => {
              activeChild = child;
            },
            heartbeat: () =>
              callJsonTool(client, 'heartbeat_action_attempt', {
                attemptRef: activeClaim.attemptRef,
                leaseToken: activeClaim.leaseToken,
                leaseGeneration: activeClaim.leaseGeneration,
              }),
            heartbeatIntervalMs: options.heartbeatIntervalMs,
          },
        );
        activeChild = null;
        transportProof = {
          transport: 'OPENCLAW_GATEWAY_HTTP',
          gatewayAgent: options.agentId,
          provider: execution.provider,
          model: execution.model,
          stopReason: execution.stopReason,
        };
        result = sealResultEnvelope({
          task: activeClaim.task,
          status: 'SUCCEEDED',
          businessOutcome: 'CANDIDATE_READY',
          candidateStatus: null,
          modelOutput: execution.modelOutput,
          missingInputs: [],
          modelVersion: `${execution.provider}/${execution.model}`,
          promptVersion: config.promptVersion,
          durationMs: execution.durationMs || Date.now() - startedAt,
          inputUnits: Buffer.byteLength(canonicalJson(modelInput)),
          outputUnits: Buffer.byteLength(execution.modelOutput),
        });
      } catch (error) {
        activeChild = null;
        result = sealResultEnvelope({
          task: activeClaim.task,
          status: 'FAILED',
          businessOutcome: 'NOT_PRODUCED',
          candidateStatus: null,
          modelOutput: null,
          missingInputs: [],
          modelVersion: 'openclaw-execution-failed',
          promptVersion: config.promptVersion,
          durationMs: Date.now() - startedAt,
          inputUnits: Buffer.byteLength(canonicalJson(modelInput)),
          outputUnits: 0,
          errorCode: stableErrorCode(error),
          errorDetail: boundedErrorMessage(error),
        });
      }
    }

    const committed = await withTransportRetry(() =>
      callJsonTool(client, config.commitTool, {
        attemptRef: activeClaim.attemptRef,
        leaseToken: activeClaim.leaseToken,
        leaseGeneration: activeClaim.leaseGeneration,
        result,
      }),
    );
    const hostCommitStatus = isRecord(committed)
      ? committed.status
      : undefined;
    const hostRejected = [
      'FAILED',
      'TIMED_OUT',
      'CANCELLED',
      'CONFLICT',
      'OBSOLETE',
    ].includes(hostCommitStatus);
    activeClaim = null;
    return {
      ok: result.status === 'SUCCEEDED' && !hostRejected,
      task: options.task,
      workItemId: options.workItemId,
      attemptRef: result.operationRef,
      actionAttemptId: result.actionAttemptId,
      resultStatus: result.status,
      contentHash: result.contentHash,
      transportProof,
      hostCommitStatus,
      hostCommit: committed,
      nonClaims: [
        'candidate_only',
        'no_engineering_approval',
        'no_release_or_current_selection_change',
      ],
    };
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    await client.close().catch(() => undefined);
  }
}

function createClient() {
  return new Client({
    name: EXECUTOR_VERSION,
    version: '1.0.0',
  });
}

function hostHeaders(apiKey, localDevWebUser, localDevTenantId, endpoint) {
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  if (!localDevWebUser) return headers;
  if (
    endpoint.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '::1'].includes(endpoint.hostname)
  ) {
    throw new Error('OPENCLAW_LOCAL_DEV_IDENTITY_REQUIRES_LOOPBACK_HOST');
  }
  const webUser = parseLocalDevWebUser(localDevWebUser);
  if (
    String(webUser.app_id || '') !== 'app_17bzc551rsg' ||
    String(webUser.tenant_id || '') !== String(localDevTenantId || '') ||
    !String(webUser.user_id || '').trim()
  ) {
    throw new Error('OPENCLAW_LOCAL_DEV_IDENTITY_BINDING_INVALID');
  }
  const csrfToken = 'local-dev-csrf';
  return {
    ...headers,
    'x-larkgw-suda-webuser': encodeURIComponent(JSON.stringify(webUser)),
    'x-suda-csrf-token': csrfToken,
    cookie: `suda-csrf-token=${csrfToken}`,
  };
}

function parseLocalDevWebUser(value) {
  try {
    return JSON.parse(value);
  } catch {
    return JSON.parse(value.replaceAll('\\"', '"'));
  }
}

async function callJsonTool(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  const textBlocks = Array.isArray(result.content)
    ? result.content.filter((item) => item.type === 'text')
    : [];
  if (result.isError === true || textBlocks.length !== 1) {
    throw new ToolExecutionError(
      `Host MCP tool ${name} failed: ${boundedText(textBlocks[0]?.text, 500)}`,
    );
  }
  try {
    return JSON.parse(textBlocks[0].text);
  } catch {
    throw new ToolExecutionError(`Host MCP tool ${name} returned invalid JSON.`);
  }
}

async function withTransportRetry(operation, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ToolExecutionError) throw error;
      lastError = error;
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

function requiredClaim(value, taskType, workItemId) {
  if (!isRecord(value) || !isRecord(value.task)) {
    throw new Error('OPENCLAW_CLAIM_INVALID');
  }
  const task = value.task;
  if (
    task.schemaVersion !== TASK_SCHEMA ||
    task.taskType !== taskType ||
    task.workItemId !== workItemId ||
    task.operationRef !== value.attemptRef ||
    !['RUNNING', 'COMMITTING'].includes(value.status) ||
    typeof value.leaseToken !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value.leaseToken,
    ) ||
    !Number.isSafeInteger(value.leaseGeneration) ||
    value.leaseGeneration <= 0 ||
    typeof value.leaseExpiresAt !== 'string' ||
    !Number.isFinite(Date.parse(value.leaseExpiresAt)) ||
    !Array.isArray(task.sourceRefs) ||
    !Array.isArray(task.hostResolvedMissingInputs)
  ) {
    throw new Error('OPENCLAW_CLAIM_BINDING_INVALID');
  }
  const { inputHash, ...unsealed } = task;
  if (
    typeof inputHash !== 'string' ||
    inputHash !== canonicalSha256(unsealed)
  ) {
    throw new Error('OPENCLAW_TASK_INPUT_HASH_MISMATCH');
  }
  if (value.status === 'COMMITTING') {
    return {
      ...value,
      recoveryResult: requiredRecoveryResult(value.recoveryResult, task),
    };
  }
  if ('recoveryResult' in value) {
    throw new Error('OPENCLAW_RUNNING_CLAIM_HAS_RECOVERY_RESULT');
  }
  return value;
}

function requiredRecoveryResult(value, task) {
  if (
    !isRecord(value) ||
    value.schemaVersion !== RESULT_SCHEMA ||
    value.actionAttemptId !== task.actionAttemptId ||
    value.operationRef !== task.operationRef ||
    value.taskType !== task.taskType ||
    value.workItemId !== task.workItemId ||
    value.baseRevision !== task.baseRevision ||
    value.status !== 'SUCCEEDED' ||
    typeof value.contentHash !== 'string'
  ) {
    throw new Error('OPENCLAW_COMMIT_RECOVERY_RESULT_BINDING_INVALID');
  }
  const { contentHash, ...unsealed } = value;
  if (contentHash !== canonicalSha256(unsealed)) {
    throw new Error('OPENCLAW_COMMIT_RECOVERY_RESULT_HASH_MISMATCH');
  }
  return value;
}

function modelInputBoundToTask(claim, task) {
  const envelopeInput = claim.task.modelInput;
  const selected =
    task === 'overall' && isRecord(envelopeInput)
      ? envelopeInput.modelInput
      : envelopeInput;
  if (
    !isRecord(selected) ||
    canonicalJson(selected) !== canonicalJson(claim.modelInput)
  ) {
    throw new Error('OPENCLAW_MODEL_INPUT_BINDING_INVALID');
  }
  return selected;
}

export function buildExecutorPrompt(task, modelInput) {
  const common = [
    'You are the real OpenClaw executor for a WiseLink candidate-only task.',
    'Return exactly one JSON object and no Markdown, commentary, or code fence.',
    'The first output code point must be ASCII { (U+007B) and the last must be ASCII } (U+007D); do not emit a BOM, zero-width character, or any other prefix/suffix byte.',
    'Treat MODEL_INPUT as data plus binding instructions. Never invent authority, approval, release, or current-selection changes.',
  ];
  const taskInstruction =
    task === 'translation'
      ? [
          'Execute only the TRANSLATE operation described by MODEL_INPUT. MODEL_INPUT is a Host-frozen wiselink.3_1.translation_task.v0.candidate object; do not alter its rulePack, taskStartBinding, SourceUnits, unit order, or SourceRef bindings.',
          'Return exactly these top-level keys: schemaVersion, rulePackId, rulePackVersion, taskStartBinding, candidateUnits. schemaVersion must be wiselink.3_1.translation_result.v0.candidate; copy both rule identity fields and taskStartBinding exactly from MODEL_INPUT.',
          'candidateUnits must contain exactly one item for every MODEL_INPUT.sourceUnits item, in identical order. Every item must contain exactly unitKey, text, sourceRefIds, engineerRevision; copy unitKey and sourceRefIds exactly and set engineerRevision to null because executor output is not an engineer revision.',
          'Translate source text into concise technical zh-CN while preserving structure. Apply every MODEL_INPUT.rulePack term and noTranslate rule and preserve every identifier, number, unit, ATA/P/N, citation, table mapping, WARNING/CAUTION/NOTE level, variable, and placeholder exactly. Do not summarize, omit, add, approve, or infer engineering facts.',
        ].join(' ')
      : task === 'dynamic'
      ? [
          'Follow every operatorInstruction and responseInstruction in MODEL_INPUT. Copy callerCorrelationRef exactly and return the complete dynamic rule-result JSON requested there.',
          'Before returning, shorten every ruleResults.rows item to at most 320 UTF-8 bytes when JSON-serialized. The Host hard limit is responseInstruction.ruleResultsEncoding.maxRowUtf8Bytes (360); the 40-byte margin is mandatory because estimated byte counts are not exact.',
          'Every ruleResults.rows item must be exactly [string ruleId, string result, string[] factsConsidered, string ruleApplication, string analysisSummary, string conclusion, string[] sourceRefs, string[] missingInputs, boolean humanReviewRequired]. factsConsidered, sourceRefs, and missingInputs must always be JSON arrays, including for zero or one item; never replace an array with a scalar, object, or null to save bytes.',
          'Apply these Host semantic invariants row by row from criterionTable: predicateResult UNKNOWN requires humanReviewRequired=true; predicateResult TRUE forbids BLOCKED_MISSING_INPUT and requires missingInputs=[]; predicateResult FALSE forbids PASS, FAIL, CONDITIONAL, 通过, or 不通过 in result; BLOCKED_MISSING_INPUT requires a nonempty missingInputs array; every missingInputs/sourceRefs value must come only from that criterion row; and a non-FALSE row with sourceEvidenceCandidateIds must retain factsConsidered or sourceRefs when its result is unknown, waiting, or blocked.',
        ].join(' ')
      : [
          'Return the complete SYNTHESIZE_OVERALL_CANDIDATE JSON.',
          'The top-level object must contain exactly these keys and no others: sourceResultId, documentVersionId, packageId, baseRuleRevision, baseRuleArtifactSha256, engineerReviewRevision, engineerReviewArtifactSha256, discoveryStatus, gap, candidateRefCount, findingCount, unresolvedCount, authorityLevel, externalDiscoveryIsEvidence, overallCandidate, findings, missingInputs, applicabilityStatus, engineeringReviewRequired, adopted, usableAsEvidence, providers.',
          'Copy sourceResultId from MODEL_INPUT.outputCorrelationRef; copy documentVersionId, packageId, baseRuleRevision, baseRuleArtifactSha256, and unresolvedCount from MODEL_INPUT.baseRuleResult; copy both engineerReview fields from MODEL_INPUT.engineerReviewContext.',
          'authorityLevel must be candidate_only; externalDiscoveryIsEvidence, adopted, and usableAsEvidence must be false; engineeringReviewRequired must be true; applicabilityStatus must be UNKNOWN/WAITING_INPUT or CANDIDATE_REVIEW_REQUIRED.',
          'All narrative is candidate-only. Never state 已确认适用, 已确认不适用, 确认该机队适用, 确认该机队不适用, 已批准, 批准执行, 批准放行, 可直接实施, 可以直接实施, approved, airworthiness conclusion, confirmed applicable, confirmed inapplicable, or safe to release.',
          'findings must be an array; each item must contain exactly finding:string, basis:string, sourceRefIds:string[], assumptions:string[], uncertainty:string. findingCount must equal findings.length, and sourceRefIds may only use MODEL_INPUT.unifiedSourceContext.sourceRefs.',
          'missingInputs must be string[]. gap is string or null. When MODEL_INPUT.externalDiscoveryResults is empty, discoveryStatus must be NO_DISCOVERY, candidateRefCount must be 0, and providers must be {}.',
        ].join(' ');
  return `${[...common, taskInstruction].join('\n')}\n\nMODEL_INPUT:\n${canonicalJson(modelInput)}`;
}

export async function assertOpenClawGatewayReady(input) {
  if (input.agentId !== REQUIRED_OPENCLAW_AGENT_ID) {
    throw new Error('OPENCLAW_DEDICATED_AGENT_REQUIRED');
  }
  const gatewayUrl = validatedGatewayUrl(input.gatewayUrl);
  requiredText(input.gatewayToken, 'OPENCLAW_GATEWAY_TOKEN_REQUIRED');
  const policy = await readOpenClawAgentPolicy(input);
  if (
    policy.agentId !== REQUIRED_OPENCLAW_AGENT_ID ||
    policy.modelPrimary !== REQUIRED_OPENCLAW_MODEL ||
    policy.modelFallbackCount !== 0 ||
    policy.toolsProfile !== 'minimal' ||
    canonicalJson(policy.toolsAllow) !== canonicalJson(REQUIRED_OPENCLAW_TOOLS) ||
    !Array.isArray(policy.skills) ||
    policy.skills.length !== 0 ||
    policy.chatCompletionsEnabled !== true ||
    !Array.isArray(policy.pluginsAllow) ||
    !policy.pluginsAllow.includes('wiselink')
  ) {
    throw new Error('OPENCLAW_DEDICATED_AGENT_POLICY_INVALID');
  }
  const health = await gatewayJsonRequest({
    gatewayUrl,
    gatewayToken: input.gatewayToken,
    path: '/healthz',
    method: 'GET',
    timeoutSeconds: input.timeoutSeconds,
  });
  if (health.ok !== true || health.status !== 'live') {
    throw new Error('OPENCLAW_GATEWAY_NOT_LIVE');
  }
  return {
    gatewayUrl: gatewayUrl.toString(),
    agentId: REQUIRED_OPENCLAW_AGENT_ID,
    configuredModel: REQUIRED_OPENCLAW_MODEL,
  };
}

export async function runOpenClawGatewayHttp(input, control) {
  if (
    input.agentId !== REQUIRED_OPENCLAW_AGENT_ID ||
    input.configuredModel !== REQUIRED_OPENCLAW_MODEL
  ) {
    throw new Error('OPENCLAW_DEDICATED_AGENT_BINDING_INVALID');
  }
  const gatewayUrl = validatedGatewayUrl(input.gatewayUrl);
  const controller = new AbortController();
  control.onChild({ kill: () => controller.abort() });
  let heartbeatFailure = null;
  let heartbeatRunning = false;
  const heartbeatTimer = setInterval(async () => {
    if (heartbeatRunning || heartbeatFailure) return;
    heartbeatRunning = true;
    try {
      await control.heartbeat();
    } catch (error) {
      heartbeatFailure = error;
      controller.abort();
    } finally {
      heartbeatRunning = false;
    }
  }, control.heartbeatIntervalMs);
  heartbeatTimer.unref();
  const startedAt = Date.now();
  try {
    const payload = await gatewayJsonRequest({
      gatewayUrl,
      gatewayToken: input.gatewayToken,
      path: '/v1/chat/completions',
      method: 'POST',
      timeoutSeconds: input.timeoutSeconds,
      signal: controller.signal,
      body: {
        model: `openclaw/${input.agentId}`,
        user: `g2-action-attempt:${input.sessionRef}`,
        messages: [
          { role: 'system', content: STRICT_JSON_SYSTEM_PROMPT },
          { role: 'user', content: input.prompt },
        ],
        stream: false,
      },
    });
    if (heartbeatFailure) throw heartbeatFailure;
    const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
    const message = isRecord(choice) && isRecord(choice.message)
      ? choice.message
      : null;
    if (Array.isArray(message?.tool_calls) && message.tool_calls.length > 0) {
      throw new Error('OPENCLAW_UNEXPECTED_TOOL_CALL');
    }
    const modelOutput = requiredText(
      message?.content,
      'OPENCLAW_MODEL_OUTPUT_MISSING',
    );
    return {
      modelOutput,
      provider: 'wiselink',
      model: 'wiselink-direct-llm',
      durationMs: Date.now() - startedAt,
      stopReason:
        isRecord(choice) && typeof choice.finish_reason === 'string'
          ? boundedText(choice.finish_reason, 120)
          : '',
    };
  } finally {
    clearInterval(heartbeatTimer);
  }
}

async function readOpenClawAgentPolicy(input) {
  const probe = [
    'const fs=require("node:fs");',
    'const c=JSON.parse(fs.readFileSync("/home/node/.openclaw/openclaw.json","utf8"));',
    'const id=process.argv[1];',
    'const list=Array.isArray(c?.agents?.list)?c.agents.list:[];',
    'const a=list.find((entry)=>entry?.id===id)||null;',
    'const m=a?.model;',
    'const primary=typeof m==="string"?m:m?.primary||"";',
    'const fallbacks=Array.isArray(m?.fallbacks)?m.fallbacks:[];',
    'process.stdout.write(JSON.stringify({agentId:a?id:"",modelPrimary:primary,modelFallbackCount:fallbacks.length,toolsProfile:a?.tools?.profile||"",toolsAllow:Array.isArray(a?.tools?.allow)?a.tools.allow:[],skills:Array.isArray(a?.skills)?a.skills:null,chatCompletionsEnabled:c?.gateway?.http?.endpoints?.chatCompletions?.enabled===true,pluginsAllow:Array.isArray(c?.plugins?.allow)?c.plugins.allow:[]}));',
  ].join('');
  const output = await runProcess('docker', [
    'exec',
    input.containerName,
    'node',
    '-e',
    probe,
    input.agentId,
  ]);
  return extractJsonObject(output.stdout);
}

async function runProcess(command, args) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  const stdout = { value: '', overflow: false };
  const stderr = { value: '', overflow: false };
  const collect = (target) => (chunk) => {
    const next = target.value + chunk.toString('utf8');
    if (Buffer.byteLength(next) > MAX_PROCESS_OUTPUT_BYTES) {
      target.overflow = true;
      child.kill('SIGTERM');
      return;
    }
    target.value = next;
  };
  child.stdout.on('data', collect(stdout));
  child.stderr.on('data', collect(stderr));
  const exit = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  if (stdout.overflow || stderr.overflow) {
    throw new Error('OPENCLAW_PROCESS_OUTPUT_LIMIT_EXCEEDED');
  }
  if (exit.code !== 0) {
    throw new Error(
      `OPENCLAW_POLICY_PROBE_FAILED:${exit.code ?? exit.signal}:${boundedText(stderr.value, 500)}`,
    );
  }
  return { stdout: stdout.value, stderr: stderr.value };
}

async function gatewayJsonRequest(input, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await gatewayJsonRequestOnce(input);
    } catch (error) {
      lastError = error;
      if (
        input.signal?.aborted ||
        !(error instanceof GatewayTransportError) ||
        !error.retryable ||
        attempt === maxAttempts
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
  throw lastError;
}

async function gatewayJsonRequestOnce(input) {
  const endpoint = new URL(input.path, input.gatewayUrl);
  const timeoutSignal = AbortSignal.timeout(input.timeoutSeconds * 1000);
  const signal = input.signal
    ? AbortSignal.any([input.signal, timeoutSignal])
    : timeoutSignal;
  let response;
  try {
    response = await fetch(endpoint, {
      method: input.method,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${input.gatewayToken}`,
        ...(input.body ? { 'content-type': 'application/json' } : {}),
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
      signal,
    });
  } catch (cause) {
    throw new GatewayTransportError('OPENCLAW_GATEWAY_NETWORK_ERROR', true, {
      cause,
    });
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_PROCESS_OUTPUT_BYTES) {
    throw new Error('OPENCLAW_GATEWAY_OUTPUT_LIMIT_EXCEEDED');
  }
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new GatewayTransportError(
      `OPENCLAW_GATEWAY_INVALID_JSON_HTTP_${response.status}`,
      response.status >= 500,
    );
  }
  if (!response.ok) {
    throw new GatewayTransportError(
      `OPENCLAW_GATEWAY_HTTP_${response.status}`,
      [502, 503, 504].includes(response.status),
    );
  }
  if (!isRecord(payload)) throw new Error('OPENCLAW_GATEWAY_PAYLOAD_INVALID');
  return payload;
}

function validatedGatewayUrl(value) {
  const url = new URL(requiredText(value, 'OPENCLAW_GATEWAY_URL_REQUIRED'));
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '::1'].includes(url.hostname))
  ) {
    throw new Error('OPENCLAW_GATEWAY_URL_INVALID');
  }
  return url;
}

function sealResultEnvelope(input) {
  const base = {
    schemaVersion: RESULT_SCHEMA,
    actionAttemptId: input.task.actionAttemptId,
    operationRef: input.task.operationRef,
    taskType: input.task.taskType,
    workItemId: input.task.workItemId,
    baseRevision: input.task.baseRevision,
    status: input.status,
    businessOutcome: input.businessOutcome,
    candidateStatus: input.candidateStatus,
    modelOutput: input.modelOutput,
    outputArtifactRefs: [],
    sourceRefs: structuredClone(input.task.sourceRefs),
    factsConsidered: input.task.sourceRefs.map((item) => item.ref),
    missingInputs: structuredClone(input.missingInputs),
    conflicts: [],
    warnings: [],
    modelVersion: input.modelVersion,
    promptVersion: input.promptVersion,
    skillVersion: EXECUTOR_VERSION,
    toolVersions: {
      openclaw: 'gateway-http-chat-completions',
      mcp: 'streamable-http',
    },
    runMetrics: {
      durationMs: input.durationMs,
      inputUnits: input.inputUnits,
      outputUnits: input.outputUnits,
    },
    errorCode: input.errorCode ?? null,
    errorDetail: input.errorDetail ?? null,
  };
  return { ...base, contentHash: canonicalSha256(base) };
}

function extractJsonObject(value) {
  const clean = String(value).replace(/\u001b\[[0-9;]*m/gu, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('OPENCLAW_CLI_JSON_MISSING');
  try {
    return JSON.parse(clean.slice(start, end + 1));
  } catch {
    throw new Error('OPENCLAW_CLI_JSON_INVALID');
  }
}

export function canonicalJson(value) {
  return JSON.stringify(sortJson(value));
}

export function canonicalSha256(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJson(value[key])]),
  );
}

function parseOptions(argv, env) {
  if (argv.includes('--help')) return { help: true };
  const task = option(argv, '--task') || 'dynamic';
  const hostMcpUrl = option(argv, '--host-mcp-url') || env.WL_OPENCLAW_HOST_MCP_URL;
  const gatewayUrl =
    option(argv, '--gateway-url') || env.WL_OPENCLAW_GATEWAY_URL;
  const gatewayToken = env.WL_OPENCLAW_GATEWAY_TOKEN?.trim() || '';
  const workItemId = option(argv, '--work-item-id');
  if (!TASK_CONFIG[task]) {
    throw new Error('WORKER_TASK_MUST_BE_DYNAMIC_OVERALL_OR_TRANSLATION');
  }
  if (!hostMcpUrl) throw new Error('WL_OPENCLAW_HOST_MCP_URL_REQUIRED');
  if (!gatewayUrl) throw new Error('WL_OPENCLAW_GATEWAY_URL_REQUIRED');
  if (!gatewayToken) throw new Error('WL_OPENCLAW_GATEWAY_TOKEN_REQUIRED');
  if (!workItemId?.startsWith('WI-')) throw new Error('WORK_ITEM_ID_REQUIRED');
  return {
    help: false,
    task,
    hostMcpUrl,
    hostApiKey: env.WL_OPENCLAW_HOST_API_KEY?.trim() || '',
    localDevWebUser:
      env.NODE_ENV === 'development' && env.MIAODA_LOCAL_DEV === '1'
        ? env.SUDA_WEBUSER?.trim() || ''
        : '',
    localDevTenantId:
      env.NODE_ENV === 'development' && env.MIAODA_LOCAL_DEV === '1'
        ? env.WL_OPENCLAW_SERVICE_TENANT_ID?.trim() || ''
        : '',
    gatewayUrl,
    gatewayToken,
    workItemId,
    providers: splitList(option(argv, '--providers')),
    containerName:
      option(argv, '--container') ||
      env.WL_OPENCLAW_CONTAINER_NAME ||
      'wiselink-openclaw-1',
    agentId: option(argv, '--agent') || REQUIRED_OPENCLAW_AGENT_ID,
    timeoutSeconds: positiveInteger(option(argv, '--timeout-seconds'), 480),
    heartbeatIntervalMs: positiveInteger(
      option(argv, '--heartbeat-seconds'),
      20,
    ) * 1000,
  };
}

function option(argv, name) {
  const index = argv.indexOf(name);
  return index < 0 ? '' : argv[index + 1] || '';
}

function splitList(value) {
  if (!value) return [];
  const items = value
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  if (
    new Set(items).size !== items.length ||
    items.some((item) => !['AIRBUS', 'BOEING', 'COMAC'].includes(item))
  ) {
    throw new Error('OPENCLAW_PROVIDERS_INVALID');
  }
  return items;
}

function positiveInteger(value, fallback) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('WORKER_POSITIVE_INTEGER_REQUIRED');
  }
  return parsed;
}

function stableErrorCode(error) {
  const value = error instanceof Error ? error.message : String(error);
  return (
    value
      .split(':', 1)[0]
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9._-]+/gu, '_')
      .slice(0, 160) || 'OPENCLAW_EXECUTOR_FAILED'
  );
}

function boundedErrorMessage(error) {
  return boundedText(error instanceof Error ? error.message : String(error), 2000);
}

function boundedText(value, maxLength) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

function requiredText(value, code) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(code);
  return value.trim();
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class ToolExecutionError extends Error {}

class GatewayTransportError extends Error {
  constructor(message, retryable, options) {
    super(message, options);
    this.retryable = retryable;
  }
}

function usage() {
  return [
    'Usage:',
    '  node scripts/run-openclaw-action-attempt-worker.mjs --task dynamic|overall|translation --work-item-id WI-...',
    '',
    'Required environment:',
    '  WL_OPENCLAW_HOST_MCP_URL=https://.../api/openapi/wiselink/openclaw-mcp',
    '  WL_OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789',
    '  WL_OPENCLAW_GATEWAY_TOKEN=<dedicated gateway token>',
    '',
    'Optional environment:',
    '  WL_OPENCLAW_HOST_API_KEY=<gateway API key> (never pass the key on argv)',
    '  WL_OPENCLAW_CONTAINER_NAME=wiselink-0-10-openclaw-1',
    '  MIAODA_LOCAL_DEV=1 + SUDA_WEBUSER=<local gateway identity> (loopback Host only)',
  ].join('\n');
}

async function main() {
  try {
    const options = parseOptions(process.argv.slice(2), process.env);
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    const result = await runOpenClawActionAttempt(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ ok: false, errorCode: stableErrorCode(error), message: boundedErrorMessage(error) })}\n`,
    );
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : '';
if (import.meta.url === invokedPath) await main();
