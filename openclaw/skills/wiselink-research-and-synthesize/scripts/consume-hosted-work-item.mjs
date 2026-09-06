#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { consumePendingReviewTurn } from './consume-hosted-review-turn.mjs';
import { invokeHostedInitialModel } from './invoke-hosted-initial-model.mjs';
import { INITIAL_ANALYSIS_OPERATIONS, runInitialAnalysis } from './orchestrate-host-mcp.mjs';
import {
  assertHostedModelGatewayReady,
  createCheckpointStore,
  createHostMcpConnection,
  invokeHostedReviewModel,
  resolveRuntimeConfig,
} from './run-hosted-review-turn.mjs';
import {
  WISELINK_APPLICABILITY_PROMPT_VERSION,
  WISELINK_HOST_MCP_NAME,
  WISELINK_HOST_MCP_VERSION,
  WISELINK_SKILL_VERSION,
} from './validate-payload.mjs';

const STAGE_BY_OPERATION = {
  TRANSLATE: 'translation',
  EXTRACT_APPLICABILITY: 'applicability',
  EVALUATE_JOBAID: 'jobAid',
  SYNTHESIZE_OVERALL: 'overall',
};
const INITIAL_TOOLS = new Set([
  'get_parse_status', 'get_deep_link', 'get_action_attempt_status',
  'heartbeat_action_attempt',
  'begin_translation', 'commit_translation_candidate',
  'begin_applicability_evaluation', 'commit_applicability_candidate',
  'begin_dynamic_evaluation', 'commit_dynamic_evaluation_candidate',
  'begin_overall_synthesis', 'commit_overall_candidate',
]);

/** One native cron tick: one unfinished initial stage, then ordinary Review ticks. */
export async function consumeHostedWorkItem(options, dependencies) {
  const statusResult = await dependencies.callTool('get_parse_status', {
    workItemId: options.workItemId,
  });
  const initial = readInitialStatus(statusResult, options.workItemId);
  if (initialComplete(initial)) {
    return (dependencies.consumeReview ?? consumePendingReviewTurn)(
      { ...options, checkpointRoot: join(options.checkpointRoot, 'review') },
      { callTool: dependencies.callTool, invokeModel: dependencies.invokeReviewModel },
    );
  }
  if (initial.status === 'BUSY' || initial.status === 'NOT_READY') {
    return { status: initial.status, nextOperation: null };
  }
  if (!['REQUIRED', 'WAITING_INPUT'].includes(initial.status) || !initial.nextOperation) {
    return { status: 'REQUIRES_ATTENTION', initialStatus: initial.status, stages: initial.stages };
  }
  const operation = initial.nextOperation;
  if (initial.stages[STAGE_BY_OPERATION[operation]]?.status !== 'PENDING') {
    throw new Error('HOST_INITIAL_STAGE_NOT_PENDING');
  }
  const report = await runHostedInitialStage({ ...options, operation, initial }, dependencies);
  return report;
}

export async function runHostedInitialStage(options, dependencies) {
  const { operation, initial } = options;
  if (!INITIAL_ANALYSIS_OPERATIONS.includes(operation)) throw new Error('INITIAL_OPERATION_INVALID');
  const checkpoint = await createCheckpointStore(join(
    options.checkpointRoot, encodeURIComponent(options.workItemId), 'initial', operation,
  ));
  const binding = await checkpoint.readOptional('binding');
  const exactBinding = {
    workItemId: options.workItemId, documentVersionId: initial.documentVersionId, operation,
  };
  if (binding && Object.entries(exactBinding).some(([key, value]) => binding[key] !== value)) {
    throw new Error('INITIAL_CHECKPOINT_BINDING_MISMATCH');
  }
  const runBinding = binding ?? { ...exactBinding, requestId: randomUUID() };
  if (!binding) await checkpoint.writeOnce('binding', runBinding);
  // A completed initial stage is not an instruction to rerun it if Host state drifts.
  if (await checkpoint.readOptional('run-result')) throw new Error('INITIAL_COMPLETED_STAGE_HOST_DRIFT');
  const contextRef = initial.applicabilityContextRef ?? options.applicabilityContextRef;
  if (operation === 'EXTRACT_APPLICABILITY' && !contextRef?.trim()) {
    throw new Error('INITIAL_APPLICABILITY_CONTEXT_REQUIRED');
  }
  const callCounts = new Map();
  let startedAttempt = null;
  let finalCommitStarted = false;
  let modelCallCount = 0;
  const callTool = async (name, args) => {
    if (!INITIAL_TOOLS.has(name)) throw new Error('INITIAL_TOOL_NOT_ALLOWED');
    const count = (callCounts.get(name) ?? 0) + 1;
    callCounts.set(name, count);
    if (name.startsWith('commit_') && args.phase !== 'UPLOAD_PART') finalCommitStarted = true;
    const value = await checkpoint.remoteStep({
      step: `${name}-${count}`, args,
      ambiguousCommit: name.startsWith('commit_'),
      perform: () => dependencies.callTool(name, args),
    });
    if (name.startsWith('begin_') && value.status === 'RUNNING') startedAttempt = value.attemptRef;
    return value;
  };
  const invoke = async (modelInput) => checkpoint.remoteStep({
    step: 'model', args: modelInput, ambiguousCommit: false,
    perform: () => {
      modelCallCount += 1;
      return dependencies.invokeInitialModel({ operation, modelInput }, {
        sessionDiscriminator: runBinding.requestId,
      });
    },
  });
  try {
    const result = await (dependencies.runInitial ?? runInitialAnalysis)({
      mode: 'INITIAL_ANALYSIS', operation, workItemId: options.workItemId,
      expectedWorkItemId: options.workItemId,
      applicabilityContextRef: contextRef,
      requestId: runBinding.requestId,
      providers: [], callTool,
      translate: invoke, extractApplicability: invoke,
      evaluateDynamicRules: invoke, synthesizeOverall: invoke,
      runtimeProvenance: dependencies.runtimeProvenance,
    });
    const afterResult = await dependencies.callTool('get_parse_status', { workItemId: options.workItemId });
    const after = readInitialStatus(afterResult, options.workItemId);
    if (after.documentVersionId !== initial.documentVersionId) throw new Error('INITIAL_DOCUMENT_VERSION_DRIFT');
    const stageStatus = after.stages[STAGE_BY_OPERATION[operation]]?.status;
    const stageDone = stageStatus === 'SUCCEEDED' ||
      (operation === 'EXTRACT_APPLICABILITY' && stageStatus === 'WAITING_INPUT');
    const report = {
      status: stageDone ? 'INITIAL_STAGE_SAVED' : 'REQUIRES_ATTENTION',
      operation, stageStatus, nextOperation: after.nextOperation,
      outcome: result.outcome, modelCallCount,
      provenance: result.provenance,
      workItemRevision: after.workItemRevision,
      candidateOnly: true,
    };
    // An uncertain result is retained as attention, never converted into a retry.
    await checkpoint.writeOnce('run-result', report);
    return report;
  } catch (error) {
    if (startedAttempt && !finalCommitStarted) {
      try {
        await checkpoint.remoteStep({
          step: 'stop-attempt', args: { attemptRef: startedAttempt }, ambiguousCommit: false,
          perform: () => dependencies.callTool('cancel_action_attempt', {
            attemptRef: startedAttempt, reason: `HOSTED_INITIAL_EXECUTION_FAILED:${errorCode(error)}`,
          }),
        });
      } catch (cancelError) {
        throw new Error(`HOSTED_INITIAL_CANCEL_FAILED:${errorCode(error)}:${errorCode(cancelError)}`, { cause: error });
      }
    }
    throw error;
  }
}

function readInitialStatus(value, workItemId) {
  const status = value?.initialAnalysis;
  if (value?.entry?.workItemId !== workItemId || !status || status.candidateOnly !== true ||
    typeof status.documentVersionId !== 'string' || !status.documentVersionId ||
    !Number.isSafeInteger(status.workItemRevision) || !status.stages ||
    !['NOT_READY', 'REQUIRED', 'BUSY', 'WAITING_INPUT', 'FAILED', 'CONFLICT', 'SUCCEEDED'].includes(status.status) ||
    (status.nextOperation !== null && !INITIAL_ANALYSIS_OPERATIONS.includes(status.nextOperation))) {
    throw new Error('HOST_INITIAL_STATUS_UNAVAILABLE');
  }
  for (const stage of Object.values(STAGE_BY_OPERATION)) {
    if (!['PENDING', 'BUSY', 'SUCCEEDED', 'WAITING_INPUT', 'FAILED', 'CONFLICT'].includes(status.stages[stage]?.status)) {
      throw new Error('HOST_INITIAL_STATUS_INVALID');
    }
  }
  return status;
}

function initialComplete(value) {
  return ['SUCCEEDED', 'WAITING_INPUT'].includes(value.status) && value.nextOperation === null &&
    value.stages.translation.status === 'SUCCEEDED' &&
    ['SUCCEEDED', 'WAITING_INPUT'].includes(value.stages.applicability.status) &&
    value.stages.jobAid.status === 'SUCCEEDED' && value.stages.overall.status === 'SUCCEEDED';
}

function errorCode(error) {
  const text = String(error?.code ?? error?.message ?? 'HOSTED_INITIAL_FAILED');
  return /^[A-Z][A-Z0-9_:.-]{0,199}$/u.test(text)
    ? text : text.match(/^[A-Z][A-Z0-9_]{0,119}/u)?.[0] ?? 'HOSTED_INITIAL_FAILED';
}

function option(argv, name) {
  const index = argv.indexOf(name);
  return index < 0 ? undefined : argv[index + 1];
}

async function main(argv, env) {
  if (argv.includes('--help')) {
    process.stdout.write('Usage: node consume-hosted-work-item.mjs --work-item-id WI-... [--applicability-context-ref REF] [--checkpoint-root PATH] [--openclaw-config PATH]\nOne initial-analysis stage or one pending candidate-only review per native cron tick.\n');
    return;
  }
  const workItemId = option(argv, '--work-item-id');
  if (!workItemId?.trim()) throw new Error('INITIAL_WORK_ITEM_ID_REQUIRED');
  const runtime = await resolveRuntimeConfig(argv, env);
  assertHostedModelGatewayReady(runtime);
  const connection = await createHostMcpConnection(runtime);
  try {
    const result = await consumeHostedWorkItem({
      workItemId,
      applicabilityContextRef: option(argv, '--applicability-context-ref'),
      checkpointRoot: option(argv, '--checkpoint-root') ?? join(homedir(), '.openclaw', 'wiselink-work-item-runs'),
    }, {
      callTool: connection.callTool,
      invokeInitialModel: (input, hooks) => invokeHostedInitialModel(input, { ...runtime, ...hooks }),
      invokeReviewModel: (input, hooks) => invokeHostedReviewModel(input, { ...runtime, ...hooks }),
      runtimeProvenance: {
        modelVersion: runtime.configuredModelVersion,
        promptVersion: WISELINK_APPLICABILITY_PROMPT_VERSION,
        skillVersion: WISELINK_SKILL_VERSION,
        toolVersions: { [WISELINK_HOST_MCP_NAME]: WISELINK_HOST_MCP_VERSION },
        runMetrics: { durationMs: 0, inputUnits: 0, outputUnits: 0 },
      },
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === 'REQUIRES_ATTENTION') process.exitCode = 1;
  } finally {
    await connection.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).catch((error) => {
    process.stderr.write(`${errorCode(error)}\n`);
    process.exitCode = 1;
  });
}
