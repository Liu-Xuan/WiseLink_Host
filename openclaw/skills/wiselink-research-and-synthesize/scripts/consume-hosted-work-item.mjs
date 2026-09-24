#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { consumePendingReviewTurn } from './consume-hosted-review-turn.mjs';
import { consumeHostedMatter } from './consume-hosted-matter.mjs';
import { recoverNativeMatterResponse } from './recover-native-matter-response.mjs';
import { invokeHostedJobAidProblemModel } from './run-jobaid-problem-assessment.mjs';
import { invokeHostedInitialModel } from './invoke-hosted-initial-model.mjs';
import { findInitialAssessmentRecovery, initialStageCheckpointPath, assertFreshInitialAssessmentClaim } from './initial-assessment-recovery.mjs';
import { invokeHostedDocumentActivityModel } from './invoke-hosted-document-activity-model.mjs';
import { consumeHostedDocumentReading } from './consume-hosted-document-reading.mjs';
import { invokeHostedDocumentReadingModel } from './invoke-hosted-document-reading-model.mjs';
import { consumeHostedDocumentActivity } from './consume-hosted-document-activity.mjs';
import { INITIAL_ANALYSIS_OPERATIONS, parseConfigurationEvidenceReevaluationStatus, runInitialAnalysis } from './orchestrate-host-mcp.mjs';
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
  'translation_workspace',
  'begin_applicability_evaluation', 'commit_applicability_candidate',
  'begin_dynamic_evaluation', 'commit_dynamic_evaluation_candidate',
  'query_assessment_knowledge', 'read_assessment_sources', 'save_assessment_work', 'read_assessment_work',
  'begin_overall_synthesis', 'commit_overall_candidate',
]);

/** One native job owns one subject; OpenClaw schedules independent jobs concurrently.
 * Dependencies within a WorkItem and shared-work commits remain ordered. */
export async function consumeHostedWorkItem(options, dependencies) {
  assertSingleConsumerSubject(options);
  assertExpectedInitialOperationMode(options);
  if (options.documentVersionId) return consumeHostedDocument(options, dependencies);
  if (options.matterId) return consumeHostedMatter(options, dependencies);
  let statusResult = await dependencies.callTool('get_parse_status', {
    workItemId: options.workItemId,
  });
  let initial = readInitialStatus(statusResult, options.workItemId);
  assertExpectedInitialOperationStatus(options.expectedInitialOperation, initial);
  if (!options.initialStageOnly && initial.status !== 'BUSY' && initial.status !== 'NOT_READY') {
    // An explicit Review is an independent request. In particular, a Matter
    // review can assess parsed material before JobAid/Overall are available.
    // The Host still validates the queued turn's scope and prerequisites.
    const review = await (dependencies.consumeReview ?? consumePendingReviewTurn)(
      { ...options, checkpointRoot: join(options.checkpointRoot, 'review') },
      { callTool: dependencies.callTool, invokeModel: dependencies.invokeReviewModel },
    );
    if (initialComplete(initial)) return review;
    if (review.status !== 'IDLE') {
      return { ...review, initialStatus: initial.status, initialStages: initial.stages };
    }
  }
  if (!options.initialStageOnly && Object.values(initial.stages).some(stage => stage.status === 'CONFLICT' &&
      stage.terminalCode === 'DOCUMENT_ORIGINAL_IMPACT_REVIEW_REQUIRED')) {
    await dependencies.callTool('next_original_assessment', {workItemId:options.workItemId});
    statusResult = await dependencies.callTool('get_parse_status', {workItemId:options.workItemId});
    const next = readInitialStatus(statusResult, options.workItemId);
    if (next.documentVersionId !== initial.documentVersionId) throw new Error('INITIAL_DOCUMENT_VERSION_DRIFT');
    initial = next;
  }
  let assessmentRecovery = await findInitialAssessmentRecovery(options, initial);
  if (options.expectedInitialOperation && assessmentRecovery && assessmentRecovery.operation !== options.expectedInitialOperation)
    throw new Error('INITIAL_EXPECTED_OPERATION_MISMATCH');
  if (assessmentRecovery?.status === 'REQUIRES_ATTENTION') return { ...assessmentRecovery, completedStages: [] };
  if (options.initialStageOnly && options.maxInitialStages !== 1) throw new Error('INITIAL_STAGE_LIMIT_INVALID');
  const limit = options.maxInitialStages ?? INITIAL_ANALYSIS_OPERATIONS.length;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > INITIAL_ANALYSIS_OPERATIONS.length) throw new Error('INITIAL_STAGE_LIMIT_INVALID');
  const tickStartedAt = Date.now();
  const completedStages = [];
  let report;
  for (let index = 0; index < limit; index += 1) {
    if ((initial.status === 'BUSY' && !assessmentRecovery) || initial.status === 'NOT_READY') {
      return { status: initial.status, nextOperation: null, completedStages };
    }
    if (!assessmentRecovery && (!['REQUIRED', 'WAITING_INPUT'].includes(initial.status) || !initial.nextOperation)) {
      return { status: 'REQUIRES_ATTENTION', initialStatus: initial.status, stages: initial.stages, completedStages };
    }
    const operation = assessmentRecovery?.operation ?? initial.nextOperation;
    if (completedStages.includes(operation) || (!assessmentRecovery && initial.stages[STAGE_BY_OPERATION[operation]]?.status !== 'PENDING')) {
      throw new Error('HOST_INITIAL_STAGE_NOT_PENDING');
    }
    const reevaluation = statusResult.configurationEvidenceReevaluation;
    report = await runHostedInitialStage({ ...options, operation, initial, assessmentRecovery,
      ...(operation === 'SYNTHESIZE_OVERALL' && reevaluation && reevaluation.status !== 'SUCCEEDED'
        ? { configurationEvidenceReevaluation: parseConfigurationEvidenceReevaluationStatus(statusResult, options.workItemId) } : {}),
    }, dependencies);
    if (report.status !== 'INITIAL_STAGE_SAVED') return { ...report, completedStages };
    completedStages.push(operation);
    assessmentRecovery = null;
    // Long translations finish their own stage before the native cron's
    // 60-minute limit; leave later stages to a fresh natural tick after 15 minutes.
    // A later natural tick continues from Host status; there is no hidden retry.
    if (!report.nextOperation || Date.now() - tickStartedAt >= 15 * 60_000 || index + 1 === limit) break;
    // A Review accepted during this stage takes priority over background
    // continuation. Observe only; the next natural tick owns its consumption.
    const pending = await dependencies.callTool('get_pending_review_turn', { workItemId: options.workItemId });
    if (!pending || typeof pending.busy !== 'boolean' || !Object.hasOwn(pending, 'next') ||
        (pending.next !== null && (typeof pending.next !== 'object' || Array.isArray(pending.next))))
      throw new Error('INITIAL_REVIEW_QUEUE_STATUS_INVALID');
    if (pending.busy || pending.next) return { ...report, completedStages,
      continuationDeferred: pending.busy ? 'REVIEW_BUSY' : 'REVIEW_PENDING' };
    if (Date.now() - tickStartedAt >= 15 * 60_000) break;
    const next = await dependencies.callTool('get_parse_status', { workItemId: options.workItemId });
    const observed = readInitialStatus(next, options.workItemId);
    if (observed.documentVersionId !== initial.documentVersionId) throw new Error('INITIAL_DOCUMENT_VERSION_DRIFT');
    if (initialComplete(observed) || Date.now() - tickStartedAt >= 15 * 60_000) break;
    initial = observed;
    statusResult = next;
  }
  return { ...report, completedStages };
}

export async function runHostedInitialStage(options, dependencies) {
  const { operation, initial } = options;
  if (!INITIAL_ANALYSIS_OPERATIONS.includes(operation)) throw new Error('INITIAL_OPERATION_INVALID');
  const continuationRequestId = initial.stages[STAGE_BY_OPERATION[operation]]?.requestId;
  const checkpoint = await createCheckpointStore(initialStageCheckpointPath(options, operation, continuationRequestId));
  const binding = await checkpoint.readOptional('binding');
  const exactBinding = {
    workItemId: options.workItemId, documentVersionId: initial.documentVersionId, operation,
  };
  if (binding && Object.entries(exactBinding).some(([key, value]) => binding[key] !== value)) {
    throw new Error('INITIAL_CHECKPOINT_BINDING_MISMATCH');
  }
  if (binding && continuationRequestId && binding.requestId !== continuationRequestId)
    throw new Error('INITIAL_CHECKPOINT_REQUEST_MISMATCH');
  const runBinding = binding ?? { ...exactBinding, requestId: continuationRequestId ?? randomUUID() };
  if (!binding) await checkpoint.writeOnce('binding', runBinding);
  // A completed initial stage is not an instruction to rerun it if Host state drifts.
  if (await checkpoint.readOptional('run-result')) throw new Error('INITIAL_COMPLETED_STAGE_HOST_DRIFT');
  const contextRef = initial.applicabilityContextRef ?? options.applicabilityContextRef;
  if (operation === 'EXTRACT_APPLICABILITY' && !contextRef?.trim()) {
    throw new Error('INITIAL_APPLICABILITY_CONTEXT_REQUIRED');
  }
  const callCounts = new Map();
  let startedAttempt = null;
  let executionModel;
  let finalCommitStarted = false;
  let modelCallCount = 0;
  let problemAssessment = false;
  let taskDeadline;
  const callTool = async (name, args) => {
    if (!INITIAL_TOOLS.has(name)) throw new Error('INITIAL_TOOL_NOT_ALLOWED');
    const scopedArgs = ['EVALUATE_JOBAID', 'SYNTHESIZE_OVERALL'].includes(operation)
      ? { ...args, workItemId: options.workItemId } : args;
    const count = (callCounts.get(name) ?? 0) + 1;
    callCounts.set(name, count);
    if (name.startsWith('commit_') && args.phase !== 'UPLOAD_PART') finalCommitStarted = true;
    const freshAssessmentCall = problemAssessment && !name.startsWith('commit_');
    const value = freshAssessmentCall || (options.assessmentRecovery && name.startsWith('begin_'))
      ? await dependencies.callTool(name, scopedArgs) : await checkpoint.remoteStep({
      // Keep c114 checkpoint identity stable for an already-started JobAid run.
      // The exact WorkItem is also frozen in the enclosing checkpoint binding.
      step: `${name}-${count}`, args,
      ambiguousCommit: name.startsWith('commit_'),
      perform: () => dependencies.callTool(name, scopedArgs),
    });
    if (name.startsWith('begin_') && value.status === 'RUNNING') {
      if (options.assessmentRecovery) assertFreshInitialAssessmentClaim(options.assessmentRecovery.previousClaim, value);
      problemAssessment = value.modelInput?.schemaVersion === 'wiselink.jobaid-problem-task.v2';
      if (problemAssessment) {
        await checkpoint.write('assessment-current-claim', value);
        taskDeadline = value.task?.deadline;
      }
      startedAttempt = value.attemptRef;
      executionModel = value.task?.executionModel ?? value.taskBinding?.executionModel;
    }
    return value;
  };
  const invoke = async (modelInput, runtimeHooks = {}) => {
    const assessment = problemAssessment && modelInput.schemaVersion === 'wiselink.jobaid-problem-task.v2';
    const perform = () => {
      modelCallCount += 1;
      return dependencies.invokeInitialModel({ operation, modelInput }, {
        executionModel,
        ...(assessment ? { assessmentCheckpoint: checkpoint, taskDeadline } : {}),
        heartbeat: runtimeHooks.heartbeat,
        timeoutMs: runtimeHooks.timeoutMs,
        sessionDiscriminator: runtimeHooks.sessionDiscriminator ?? runBinding.requestId,
        readAssessmentSources: runtimeHooks.readAssessmentSources,
        queryAssessmentKnowledge: runtimeHooks.queryAssessmentKnowledge,
        saveAssessmentWork: runtimeHooks.saveAssessmentWork,
        readAssessmentWork: runtimeHooks.readAssessmentWork,
        observeModelOutput: (shape, round = 1) => checkpoint.writeOnce(
          `${runtimeHooks.checkpointKey ?? 'model'}.output-shape${round === 1 ? '' : '-' + round}`, shape,
        ),
        observeTranslationFidelity: (report, round) => checkpoint.writeOnce(
          `model.translation-fidelity-${round}`, report,
        ),
        observeCandidateRejection: (report) => checkpoint.writeOnce(
          `model.candidate-rejection-${report.correctionNo}`, report,
        ),
      });
    };
    // A durable round owns its exact response and save request identities.
    // Legacy outer model.started without this marker remains unknown.
    if (assessment && await checkpoint.readOptional('assessment-enabled')) return perform();
    return checkpoint.remoteStep({ step: runtimeHooks.checkpointKey ?? 'model', args: modelInput,
      ambiguousCommit: false, perform });
  };
  try {
    const result = await (dependencies.runInitial ?? runInitialAnalysis)({
      mode: 'INITIAL_ANALYSIS', operation, workItemId: options.workItemId,
      expectedWorkItemId: options.workItemId,
      applicabilityContextRef: contextRef,
      requestId: runBinding.requestId,
      ...(continuationRequestId ? { continuationRequestId } : {}),
      ...(options.configurationEvidenceReevaluation ? { configurationEvidenceReevaluation: options.configurationEvidenceReevaluation } : {}),
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
    if (error?.message === 'INITIAL_ASSESSMENT_STILL_OWNED')
      return { status: 'BUSY', operation, nextOperation: null, modelCallCount, candidateOnly: true };
    if (startedAttempt && !finalCommitStarted) {
      try {
        const stopped = await checkpoint.remoteStep({
          step: 'stop-attempt', args: { attemptRef: startedAttempt }, ambiguousCommit: false,
          perform: () => dependencies.callTool('cancel_action_attempt', {
            attemptRef: startedAttempt,
            ...(['EVALUATE_JOBAID', 'SYNTHESIZE_OVERALL'].includes(operation)
              ? { workItemId: options.workItemId } : {}),
            reason: `HOSTED_INITIAL_EXECUTION_FAILED:${errorCode(error)}`,
          }),
        });
        if (stopped.attemptRef !== startedAttempt || stopped.status !== 'CANCELLED')
          throw new Error('HOSTED_INITIAL_STOP_NOT_CONFIRMED');
        const report = {
          status: 'REQUIRES_ATTENTION', operation,
          attemptRef: startedAttempt, attemptStatus: stopped.status,
          errorCode: errorCode(error), modelCallCount, candidateOnly: true,
        };
        await checkpoint.writeOnce('run-result', report);
        return report;
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
    ['SUCCEEDED', 'WAITING_INPUT'].includes(value.stages.applicability.status) &&
    value.stages.jobAid.status === 'SUCCEEDED' && value.stages.overall.status === 'SUCCEEDED';
}

export function errorCode(error) {
  // Preserve the actual internal call site in cron output. The generic code
  // filter below deliberately rejects lowercase prose and used to erase it.
  if (error?.receivedHostToolError === true && typeof error.hostToolName === 'string' &&
      /^[a-z]+(?:_[a-z]+)*$/u.test(error.hostToolName) && error.hostToolName.length <= 80) {
    const hostCode = typeof error.hostErrorCode === 'string' && /^[A-Z][A-Z0-9_]{0,159}$/u.test(error.hostErrorCode)
      ? error.hostErrorCode : null;
    return `REVIEW_HOST_MCP_TOOL_FAILED:${error.hostToolName}${hostCode ? ':' + hostCode : ''}`;
  }
  const text = String(error?.hostErrorCode ?? error?.code ?? error?.message ?? 'HOSTED_INITIAL_FAILED');
  return /^[A-Z][A-Z0-9_:.-]{0,199}$/u.test(text)
    ? text : text.match(/^[A-Z][A-Z0-9_]{0,119}/u)?.[0] ?? 'HOSTED_INITIAL_FAILED';
}

function option(argv, name) {
  const index = argv.indexOf(name);
  return index < 0 ? undefined : argv[index + 1];
}

export function initialStageLimit(argv, workItemId, matterId, documentVersionId) {
  if (argv.some(arg => arg.startsWith('--max-initial-stages='))) {
    throw new Error('INITIAL_STAGE_LIMIT_INVALID');
  }
  if (argv.some(arg => arg.startsWith('--expected-initial-operation=')))
    throw new Error('INITIAL_EXPECTED_OPERATION_INVALID');
  const occurrences = argv.filter(arg => arg === '--max-initial-stages').length;
  const expectedOccurrences = argv.filter(arg => arg === '--expected-initial-operation').length;
  if (expectedOccurrences && (expectedOccurrences !== 1 ||
      !['EVALUATE_JOBAID', 'SYNTHESIZE_OVERALL'].includes(
        option(argv, '--expected-initial-operation')) ||
      occurrences !== 1)) throw new Error('INITIAL_EXPECTED_OPERATION_INVALID');
  if (!occurrences) return {};
  if (occurrences !== 1 || option(argv, '--max-initial-stages') !== '1' ||
      !workItemId || matterId || documentVersionId) {
    throw new Error('INITIAL_STAGE_LIMIT_INVALID');
  }
  return { maxInitialStages: 1, initialStageOnly: true,
    ...(expectedOccurrences ? { expectedInitialOperation: option(argv, '--expected-initial-operation') } : {}) };
}

function assertExpectedInitialOperationMode(options) {
  if (options.expectedInitialOperation === undefined) return;
  if (!['EVALUATE_JOBAID', 'SYNTHESIZE_OVERALL'].includes(options.expectedInitialOperation) || !options.workItemId ||
      options.matterId || options.documentVersionId || !options.initialStageOnly || options.maxInitialStages !== 1)
    throw new Error('INITIAL_EXPECTED_OPERATION_INVALID');
}

function assertExpectedInitialOperationStatus(expected, initial) {
  if (!expected) return;
  const pending = ['REQUIRED', 'WAITING_INPUT'].includes(initial.status) &&
    initial.nextOperation === expected && initial.stages[STAGE_BY_OPERATION[expected]]?.status === 'PENDING';
  const recovering = initial.status === 'BUSY' && initial.nextOperation === null &&
    initial.stages[STAGE_BY_OPERATION[expected]]?.status === 'BUSY';
  if (!pending && !recovering) throw new Error('INITIAL_EXPECTED_OPERATION_MISMATCH');
}

export async function consumeHostedDocument(
  { documentVersionId, activityRunRef, readingRunRef, leaseOwner },
  { callTool, documentTranslationCheckpoint, activityCheckpoint, invokeActivityModel, readingCheckpoint, invokeReadingModel }) {
  const startedAt = Date.now();
  if (activityRunRef && readingRunRef) throw new Error('DOCUMENT_CONSUMER_RUN_AMBIGUOUS');
  const consumeReading = runRef => consumeHostedDocumentReading(
    { documentVersionId, runRef, leaseOwner },
    { callTool, invokeModel: invokeReadingModel, checkpointFactory: readingCheckpoint });
  if (readingRunRef) return consumeReading(readingRunRef);
  const state = await callTool('document_work', { action: 'STATUS', documentVersionId });
  if (state?.documentVersionId !== documentVersionId) throw new Error('DOCUMENT_CONSUMER_SCOPE_MISMATCH');
  // An already-accepted activity run is consumed first: state.nextActivityRunRef
  // is the only discovery of a run an explicit ACTIVITY_BEGIN created, and an
  // explicit recovery ref addresses that old run directly. The consumer never
  // generates work and never sends ACTIVITY_BEGIN; a null discovery with no
  // parse run stays idle with zero model calls.
  const runRef = activityRunRef ?? state.nextActivityRunRef ?? null;
  if (runRef) {
    return consumeHostedDocumentActivity(
      { documentVersionId, runRef, leaseOwner },
      { callTool, invokeModel: invokeActivityModel, checkpointFactory: activityCheckpoint });
  }
  // Discovery consumes only runs already accepted by Host READING_BEGIN.
  if (state.nextReadingRunRef) return consumeReading(state.nextReadingRunRef);
  const run = state.latestRun;
  if (!run) return { status: 'IDLE', documentVersionId };
  if (run.documentVersionId !== documentVersionId || !run.parseRunId) throw new Error('DOCUMENT_CONSUMER_RUN_MISMATCH');
  if (run.status === 'PUBLISHED') return advancePublishedDocument(state, run, documentVersionId, callTool, documentTranslationCheckpoint);

  if (run.errorCode || run.status === 'FAILED' || !state.runtimeAvailable || Date.parse(run.deadlineAt) <= Date.now()) {
    return { status: 'REQUIRES_ATTENTION', documentVersionId, parseRunId: run.parseRunId,
      errorCode: run.errorCode ?? 'DOCUMENT_STEP_UNAVAILABLE' };
  }
  if (!['RUNNING', 'STAGING'].includes(run.status) || !Number.isFinite(Date.parse(run.deadlineAt))) throw new Error('DOCUMENT_CONSUMER_STATUS_INVALID');
  const result = await callTool('document_work', { action: 'STEP', documentVersionId, parseRunId: run.parseRunId });
  if (result?.parseRunId !== run.parseRunId || !['BUSY', 'STAGING', 'PUBLISHED', 'FAILED'].includes(result.status)) {
    throw new Error('DOCUMENT_CONSUMER_STEP_INVALID');
  }
  if (result.status === 'PUBLISHED' && Date.now() - startedAt < 10_000) {
    // One explicit success may continue into the existing published phase, but
    // never infer success from a lost receipt, repeat a parse STEP, or consume a
    // newly queued activity/reading in the same tick. Host performs fresh ACLs.
    const fresh = await callTool('document_work', { action: 'STATUS', documentVersionId });
    if (fresh?.documentVersionId !== documentVersionId) throw new Error('DOCUMENT_CONSUMER_SCOPE_MISMATCH');
    if (fresh.latestRun && (fresh.latestRun.documentVersionId !== documentVersionId || !fresh.latestRun.parseRunId))
      throw new Error('DOCUMENT_CONSUMER_RUN_MISMATCH');
    if (Date.now() - startedAt < 10_000 && !fresh.nextActivityRunRef && !fresh.nextReadingRunRef &&
        fresh.latestRun?.documentVersionId === documentVersionId &&
        fresh.latestRun.parseRunId === run.parseRunId && fresh.latestRun.status === 'PUBLISHED') {
      return advancePublishedDocument(fresh, fresh.latestRun, documentVersionId, callTool, documentTranslationCheckpoint);
    }
  }
  return { ...result, documentVersionId };
}

async function advancePublishedDocument(state, run, documentVersionId, callTool, documentTranslationCheckpoint) {
    const indexRun = state.nextSourceProjectionRunId ?? run.parseRunId;
    if (typeof indexRun !== 'string' || !/^[A-Za-z0-9_-]{1,96}$/.test(indexRun)) throw new Error('DOCUMENT_SOURCE_PROJECTION_RUN_INVALID');
    const projectionPromise = Promise.resolve().then(() =>
      callTool('document_work', { action: 'INDEX', documentVersionId, parseRunId: indexRun }));
    // STATUS and existing-work recovery remain independent of derived indexing.
    // Only a new START depends on semantics for this exact current parse, not
    // whichever historical pending run the index queue selected.
    const beforeStart = async () => {
      let prepared;
      try {
        prepared = await (indexRun === run.parseRunId ? projectionPromise :
          callTool('document_work', { action: 'INDEX', documentVersionId, parseRunId: run.parseRunId }));
      } catch {
        // INDEX may fail after persisting semantics (for example search writes).
        // Re-read the Host's narrow exact registration instead of guessing from
        // a failed derived index. Old Hosts omit this field and fail closed.
        const readiness = await callTool('document_translation', {
          action: 'STATUS', documentVersionId, parseRunId: run.parseRunId });
        if (readiness?.documentVersionId !== documentVersionId || readiness.parseRunId !== run.parseRunId)
          throw new Error('DOCUMENT_TRANSLATION_SCOPE_MISMATCH');
        return readiness.status === 'IDLE' && readiness.semanticReady === true;
      }
      assertSourceProjection(prepared, documentVersionId, run.parseRunId);
      return true;
    };
    const outcomes = await Promise.allSettled([
      projectionPromise,
      advanceDocumentTranslationWithRecovery(documentVersionId, run, callTool, documentTranslationCheckpoint, beforeStart),
    ]);
    const [projection, translation] = outcomes;
    if (translation.status === 'rejected') throw translation.reason;
    if (projection.status === 'rejected') return { ...translation.value, status: 'REQUIRES_ATTENTION',
      sourceProjection: { status: 'FAILED', errorCode: 'DOCUMENT_SOURCE_PROJECTION_FAILED' } };
    const indexed = projection.value;
    assertSourceProjection(indexed, documentVersionId, indexRun);
    return { ...translation.value, sourceProjection: indexed };
}

function assertSourceProjection(indexed, documentVersionId, parseRunId) {
  if (indexed?.documentVersionId !== documentVersionId || indexed.parseRunId !== parseRunId ||
      !['INDEXED','PROGRESS','RETRY','NO_PENDING'].includes(indexed.status))
    throw new Error('DOCUMENT_SOURCE_PROJECTION_RESULT_INVALID');
}

// This checkpoint records an operation stop, not a Host task or a successful
// translation. A new parse run can still advance through the branch above.
async function advanceDocumentTranslationWithRecovery(documentVersionId, run, callTool, checkpointFactory, beforeStart) {
  const checkpoint = await checkpointFactory?.(run.parseRunId);
  const blocked = await checkpoint?.readOptional('admission-blocked');
  if (blocked) {
    if (blocked.documentVersionId !== documentVersionId || blocked.parseRunId !== run.parseRunId || blocked.operation !== 'START' || blocked.errorCode !== 'DOCUMENT_TRANSLATION_ADMISSION_DENIED')
      throw new Error('DOCUMENT_TRANSLATION_CHECKPOINT_INVALID');
    return { status: 'REQUIRES_ATTENTION', documentVersionId, parseRunId: run.parseRunId,
      translation: blocked };
  }
  try {
    return await advanceDocumentTranslation(documentVersionId, run, callTool, beforeStart);
  } catch (error) {
    if (error?.receivedHostToolError !== true || error.hostToolName !== 'document_translation' ||
        error.hostErrorCode !== 'DOCUMENT_TRANSLATION_ADMISSION_DENIED' || !checkpoint) throw error;
    const stopped = { status: 'BLOCKED', operation: 'START', documentVersionId, parseRunId: run.parseRunId,
      errorCode: error.hostErrorCode, observedAt: new Date().toISOString(),
      recoveryAction: 'REPAIR_HOST_ADMISSION_THEN_SET_DOCUMENT_TRANSLATION_RECOVERY' };
    await checkpoint.writeOnce('admission-blocked', stopped);
    return { status: 'REQUIRES_ATTENTION', documentVersionId, parseRunId: run.parseRunId, translation: stopped };
  }
}

async function advanceDocumentTranslation(documentVersionId, run, callTool, beforeStart) {
    const binding = { documentVersionId, parseRunId: run.parseRunId };
    const translation = await callTool('document_translation', { action: 'STATUS', ...binding });
    if (translation?.documentVersionId !== documentVersionId) throw new Error('DOCUMENT_TRANSLATION_SCOPE_MISMATCH');
    if (translation.status === 'IDLE') {
      if (translation.semanticReady === true && translation.parseRunId !== run.parseRunId)
        throw new Error('DOCUMENT_TRANSLATION_RUN_MISMATCH');
      if (translation.semanticReady !== true && !await beforeStart()) return { status: 'REQUIRES_ATTENTION', ...binding,
        semanticPreparation: { status: 'FAILED', errorCode: 'DOCUMENT_SEMANTIC_NOT_READY' } };
      const started = await callTool('document_translation', { action: 'START', ...binding, requestId: `translation-${run.parseRunId}` });
      if (started?.documentVersionId !== documentVersionId || started.parseRunId !== run.parseRunId || !started.attemptRef)
        throw new Error('DOCUMENT_TRANSLATION_START_MISMATCH');
      return started;
    }
    if (translation.parseRunId !== run.parseRunId || !translation.attemptRef) throw new Error('DOCUMENT_TRANSLATION_RUN_MISMATCH');
    if (translation.errorCode || ['FAILED','CANCELLED'].includes(translation.status))
      return { ...translation, status: 'REQUIRES_ATTENTION' };
    if (translation.status === 'SUCCEEDED') return { ...translation, status: 'DOCUMENT_READY' };
    if (!['QUEUED','RUNNING','RETRY_SCHEDULED'].includes(translation.status)) throw new Error('DOCUMENT_TRANSLATION_STATUS_INVALID');
    const result = await callTool('document_translation', { action: 'STEP', ...binding, attemptRef: translation.attemptRef });
    if (result?.documentVersionId !== documentVersionId || result.parseRunId !== run.parseRunId ||
        result.attemptRef !== translation.attemptRef) throw new Error('DOCUMENT_TRANSLATION_STEP_MISMATCH');
    return result;
}

function assertSingleConsumerSubject({ workItemId, matterId, documentVersionId }) {
  const hasWorkItem = typeof workItemId === 'string' && Boolean(workItemId.trim());
  const hasMatter = typeof matterId === 'string' && Boolean(matterId.trim());
  const hasDocument = typeof documentVersionId === 'string' && Boolean(documentVersionId.trim());
  if ([hasWorkItem, hasMatter, hasDocument].filter(Boolean).length !== 1) throw new Error('CONSUMER_SINGLE_SUBJECT_REQUIRED');
  if ((hasWorkItem && !/^WI-\S+$/.test(workItemId)) ||
      (hasMatter && !/^MAT-\S+$/.test(matterId)) ||
      (hasDocument && !/^[A-Za-z0-9_-]{1,96}$/u.test(documentVersionId))) throw new Error('CONSUMER_SUBJECT_INVALID');
}

async function main(argv, env) {
  if (argv.includes('--help')) {
    process.stdout.write('Usage: node consume-hosted-work-item.mjs [--work-item-id WI-...] [--matter-id MAT-...] [--document-version-id DV] [--max-initial-stages 1] [--expected-initial-operation EVALUATE_JOBAID|SYNTHESIZE_OVERALL] [--applicability-context-ref REF] [--checkpoint-root PATH] [--openclaw-config PATH] [--native-session-store PATH] [--document-translation-recovery ID] [--activity-run-ref ID] [--reading-run-ref ID] [--lease-owner ID]\nOne native job per authorized subject. Choose exactly one WorkItem, Matter or DocumentVersion; independent jobs use native cron concurrency. --max-initial-stages 1 is WorkItem-only and consumes at most the current initial stage, without Review or original-impact work. --expected-initial-operation requires that limit and refuses any entry stage other than the named JobAid or Overall stage.\n');
    return;
  }
  const workItemId = option(argv, '--work-item-id');
  const matterId = option(argv, '--matter-id');
  const documentVersionId = option(argv, '--document-version-id');
  assertSingleConsumerSubject({ workItemId, matterId, documentVersionId });
  const stageLimit = initialStageLimit(argv, workItemId, matterId, documentVersionId);
  const runtime = await resolveRuntimeConfig(argv, env);
  assertHostedModelGatewayReady(runtime);
  const activityRunRef = option(argv, '--activity-run-ref');
  if (activityRunRef !== undefined && !/^[A-Za-z0-9_-]{1,96}$/u.test(activityRunRef))
    throw new Error('ACTIVITY_RUN_REF_INVALID');
  const readingRunRef = option(argv, '--reading-run-ref');
  if (readingRunRef !== undefined && !/^[A-Za-z0-9_-]{1,96}$/u.test(readingRunRef))
    throw new Error('READING_RUN_REF_INVALID');
  if ((readingRunRef || activityRunRef) && !documentVersionId) throw new Error('DOCUMENT_CONSUMER_TARGET_REQUIRED');
  if (readingRunRef && activityRunRef) throw new Error('DOCUMENT_CONSUMER_RUN_AMBIGUOUS');
  const leaseOwner = option(argv, '--lease-owner') ?? `openclaw:${runtime.agentId}`;
  const recovery = option(argv, '--document-translation-recovery') ?? 'initial';
  if (!/^[A-Za-z0-9_-]{1,96}$/.test(recovery)) throw new Error('DOCUMENT_TRANSLATION_RECOVERY_INVALID');
  const checkpointRoot = option(argv, '--checkpoint-root') ?? join(homedir(), '.openclaw', 'wiselink-work-item-runs');
  const endpoint = new URL(runtime.hostMcpUrl);
  const documentTranslationCheckpoint = documentVersionId ? parseRunId => {
    if (!/^[A-Za-z0-9_-]{1,96}$/.test(parseRunId)) throw new Error('DOCUMENT_TRANSLATION_RUN_INVALID');
    return createCheckpointStore(join(checkpointRoot, 'document-translation',
      encodeURIComponent(endpoint.origin + endpoint.pathname), documentVersionId, parseRunId, recovery));
  } : undefined;
  // Activity checkpoints live under endpoint (origin+path, never the token) +
  // documentVersionId + runRef; every file 0600 inside a 0700 root.
  const activityCheckpoint = documentVersionId ? ({ runRef }) => {
    if (!/^[A-Za-z0-9_-]{1,96}$/u.test(runRef)) throw new Error('ACTIVITY_RUN_REF_INVALID');
    return createCheckpointStore(join(checkpointRoot, 'document-activity',
      encodeURIComponent(endpoint.origin + endpoint.pathname), documentVersionId, runRef));
  } : undefined;
  const readingCheckpoint = documentVersionId ? ({ runRef }) => {
    if (!/^[A-Za-z0-9_-]{1,96}$/u.test(runRef)) throw new Error('READING_RUN_REF_INVALID');
    return createCheckpointStore(join(checkpointRoot, 'document-reading',
      encodeURIComponent(endpoint.origin + endpoint.pathname), documentVersionId, runRef));
  } : undefined;
  const connection = await createHostMcpConnection(runtime);
  try {
    const result = await consumeHostedWorkItem({
      workItemId,
      matterId,
      documentVersionId,
      ...stageLimit,
      applicabilityContextRef: option(argv, '--applicability-context-ref'),
      checkpointRoot,
      activityRunRef,
      readingRunRef,
      leaseOwner,
    }, {
      callTool: connection.callTool,
      documentTranslationCheckpoint,
      activityCheckpoint,
      readingCheckpoint,
      invokeReadingModel: (input, hooks) => invokeHostedDocumentReadingModel(input, { ...runtime, ...hooks }),
      invokeActivityModel: (input, hooks) => invokeHostedDocumentActivityModel(input, { ...runtime, ...hooks }),
      ...(option(argv, '--native-session-store') ? { recoverNativeMatterResponse: input => recoverNativeMatterResponse({
        ...input, storePath: option(argv, '--native-session-store'),
      }) } : {}),
      invokeInitialModel: (input, hooks) => invokeHostedInitialModel(input, { ...runtime, ...hooks }),
      invokeReviewModel: (input, hooks) => invokeHostedReviewModel(input, { ...runtime, ...hooks }),
      invokeMatterModel: (input, hooks) => invokeHostedJobAidProblemModel(input, { ...runtime, ...hooks }),
      runtimeProvenance: {
        modelVersion: runtime.configuredModelVersion,
        promptVersion: WISELINK_APPLICABILITY_PROMPT_VERSION,
        skillVersion: WISELINK_SKILL_VERSION,
        toolVersions: { [WISELINK_HOST_MCP_NAME]: WISELINK_HOST_MCP_VERSION },
        runMetrics: { durationMs: 0, inputUnits: 0, outputUnits: 0 },
      },
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
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
