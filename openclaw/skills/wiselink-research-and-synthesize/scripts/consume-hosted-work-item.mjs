#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { consumePendingReviewTurn } from './consume-hosted-review-turn.mjs';
import { consumeHostedMatter } from './consume-hosted-matter.mjs';
import { consumeHierarchicalWikiIdle } from './consume-hierarchical-wiki-queue.mjs';
import { invokeHostedDerivedSummaryModel } from './invoke-hosted-derived-summary-model.mjs';
import { validateSummaryRunBudget } from './derived-summary-native-gateway.mjs';
import { createNativeReviewGatewayPreparer } from './native-temporary-review-gateway.mjs';
import { hostedGatewayTransportFailureDiagnostic } from './request-hosted-gateway.mjs';
import {
  parkCancelledAutomaticClaim, readCancelledClaimExpectation, parseCancelledClaimExpectation,
  matchesCancelledClaim, validateCancelledBlockReceipt, assertCancelledParkIntent,
} from './cancelled-claim-parking.mjs';
import { recoverNativeMatterResponse } from './recover-native-matter-response.mjs';
import { invokeHostedJobAidProblemModel } from './run-jobaid-problem-assessment.mjs';
import { invokeHostedInitialModel } from './invoke-hosted-initial-model.mjs';
import { INITIAL_ASSESSMENT_OPERATIONS, findInitialAssessmentRecovery, initialStageCheckpointPath, initialApplicabilityCheckpointPointerPath,
  assertFreshInitialAssessmentClaim, assertCommittingInitialClaim, optionalInitialStageRequest,
  confirmInitialCommittingRecovery, finishInitialAssessmentPolicyFailure } from './initial-assessment-recovery.mjs';
import { invokeHostedDocumentActivityModel } from './invoke-hosted-document-activity-model.mjs';
import { consumeHostedDocumentReading } from './consume-hosted-document-reading.mjs';
import { invokeHostedDocumentReadingModel } from './invoke-hosted-document-reading-model.mjs';
import { runDocumentSemanticTranslationStep } from './run-document-semantic-translation.mjs';
import { consumeHostedDocumentActivity } from './consume-hosted-document-activity.mjs';
import { INITIAL_ANALYSIS_OPERATIONS, parseConfigurationEvidenceReevaluationStatus, runInitialAnalysis, runOverallSynthesis } from './orchestrate-host-mcp.mjs';
import {
  assertHostedModelGatewayReady,
  createCheckpointStore,
  readCheckpointCandidate,
  createHostAutoWorkItemQueueClient,
  createHostMcpConnection,
  invokeHostedReviewModel,
  resolveRuntimeConfig,
} from './run-hosted-review-turn.mjs';
import {
  WISELINK_APPLICABILITY_PROMPT_VERSION,
  WISELINK_HOST_MCP_NAME,
  WISELINK_HOST_MCP_VERSION,
  WISELINK_SKILL_VERSION,
  canonicalSha256,
  validateResultEnvelope,
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

// Only registered tools used by these consumers may appear in a diagnostic.
// Tool names are lowercase protocol identifiers, not arbitrary exception text.
const HOST_ERROR_TOOLS = new Set([...INITIAL_TOOLS,
  'next_original_assessment', 'next_matter_assessment', 'begin_matter_assessment',
  'matter_action_attempt', 'read_matter_current_work', 'resume_overall_synthesis',
  'document_work', 'document_reading', 'read_document_original', 'document_translation',
  'cancel_action_attempt', 'get_pending_review_turn', 'begin_review_turn',
  'get_review_turn_context', 'read_source_refs', 'commit_review_turn_candidate',
]);

/** One native job owns one subject; OpenClaw schedules independent jobs concurrently.
 * Dependencies within a WorkItem and shared-work commits remain ordered. */
export async function consumeHostedWorkItem(options, dependencies) {
  assertSingleConsumerSubject(options);
  assertExpectedInitialOperationMode(options);
  assertJobAidRunLimits(options);
  if (options.workItemId && (await readExplicitJobAidBudgets(options)).length && !options.jobAidRunLimits)
    throw new Error('JOBAID_RUN_LIMIT_REQUIRED');
  if ((options.matterPreflightOnly || options.matterExpectedSnapshot !== undefined) && !options.matterId)
    throw new Error('MATTER_PREFLIGHT_TARGET_REQUIRED');
  if (options.matterPreflightOnly && options.matterExpectedSnapshot !== undefined)
    throw new Error('MATTER_PREFLIGHT_MODE_AMBIGUOUS');
  if (options.documentVersionId) return consumeHostedDocument(options, dependencies);
  if (options.matterId) return consumeHostedMatter(options, dependencies);
  let statusResult = await dependencies.callTool('get_parse_status', {
    workItemId: options.workItemId,
  });
  let initial = readInitialStatus(statusResult, options.workItemId);
  assertExpectedInitialOperationStatus(options.expectedInitialOperation, initial);
  assertExplicitInitialStageRequest(options, initial);
  if (options.queueCommitRecovery) {
    const recovery = await confirmInitialCommittingRecovery(options, initial, dependencies);
    if (!options.initialStageOnly || options.maxInitialStages !== 1 ||
        !isDeepStrictEqual(recovery, options.queueCommitRecovery))
      throw new Error('AUTO_WORK_ITEM_COMMITTING_RECOVERY_CHANGED');
    const report = await runHostedInitialStage({ ...options, operation: recovery.operation,
      initial, assessmentRecovery: recovery }, dependencies);
    // This invocation only replays the original commit. A later normal tick
    // must obtain Host authorization for the next persisted stage.
    return { ...report, completedStages: report.status === 'INITIAL_STAGE_SAVED' ? [recovery.operation] : [] };
  }
  if (options.repairingRecovery) {
    const operation = options.repairExpectedOperation;
    const stage = STAGE_BY_OPERATION[operation];
    const observation = initial.stages?.[stage];
    if (!options.repairStoppedClaim || !['EVALUATE_JOBAID', 'SYNTHESIZE_OVERALL'].includes(operation) ||
        initial.status !== 'BUSY' ||
        initial.workItemRevision !== options.repairWorkItemRevision ||
        observation?.status !== 'BUSY' ||
        observation.requestId !== options.repairRequestId ||
        observation.attemptRef !== options.repairActiveAttemptRef) {
      throw new Error('AUTO_WORK_ITEM_REPAIR_RECOVERY_CHANGED');
    }
    const recovery = await findInitialAssessmentRecovery(options, initial, dependencies);
    if (!recovery || recovery.operation !== operation ||
        !['RECOVERY_CANDIDATE', 'RECOVERY_COMMITTING'].includes(recovery.status)) {
      throw new Error('AUTO_WORK_ITEM_REPAIR_RECOVERY_CHANGED');
    }
    return runHostedInitialStage({ ...options, operation, initial,
      assessmentRecovery: recovery }, dependencies);
  }
  if (options.autoRetry) {
    const retry = await (options.repairStoppedClaim ? repairedRetryPlan : automaticRetryPlan)(
      initial, options.workItemId,
      attemptRef => dependencies.callTool('read_assessment_work', {
        attemptRef, workItemId: options.workItemId,
      }), options.repairAttentionCode, options.repairWorkItemRevision,
      options.repairAttemptRef);
    if (!retry || retry.operation !== options.autoRetry.operation ||
        retry.requestId !== options.autoRetry.requestId ||
        retry.attemptRef !== options.autoRetry.attemptRef) {
      throw new Error('AUTO_WORK_ITEM_RETRY_STATUS_CHANGED');
    }
    return runHostedInitialStage({
      ...options,
      operation: retry.operation,
      initial,
      autoRetryRequestId: retry.requestId,
    }, dependencies);
  }
  if (!options.initialStageOnly && initial.status !== 'BUSY' && initial.status !== 'NOT_READY') {
    // An explicit Review is an independent request. In particular, a Matter
    // review can assess parsed material before JobAid/Overall are available.
    // The Host still validates the queued turn's scope and prerequisites.
    const review = await (dependencies.consumeReview ?? consumePendingReviewTurn)(
      { ...options, checkpointRoot: join(options.checkpointRoot, 'review') },
      { callTool: dependencies.callTool, hasTool: dependencies.hasTool, invokeModel: dependencies.invokeReviewModel },
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
  let assessmentRecovery = await findInitialAssessmentRecovery(options, initial, dependencies);
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

async function consumeSuccessorOverallPointer(pointer, checkpoint, consume) {
  let result;
  try {
    result = await consume(pointer);
  } catch (error) {
    const terminalCode = error?.hostToolName === 'begin_overall_synthesis' &&
      ['ACTION_ATTEMPT_ALREADY_FAILED', 'ACTION_ATTEMPT_ALREADY_CANCELLED',
        'ACTION_ATTEMPT_ALREADY_CONFLICT', 'ACTION_ATTEMPT_ALREADY_OBSOLETE',
        'ACTION_ATTEMPT_ALREADY_TIMED_OUT'].includes(error?.hostErrorCode)
      ? error.hostErrorCode : null;
    if (!terminalCode) throw error;
    // The Host has definitively closed this exact attempt. Keep its failure
    // record there, then release only the local pointer so later work can run.
    await checkpoint.write('review-cursor', pointer.reviewAfterWorkItemId);
    await checkpoint.write('active-successor-overall', null);
    return { status: 'REQUIRES_ATTENTION', workItemId: pointer.workItemId,
      reviewTurnRef: pointer.reviewTurnRef, errorCode: terminalCode };
  }
  await checkpoint.write('review-cursor', pointer.reviewAfterWorkItemId);
  await checkpoint.write('active-successor-overall', null);
  return { status: 'OVERALL_DISPATCHED', workItemId: pointer.workItemId,
    reviewTurnRef: pointer.reviewTurnRef, overall: result };
}

/**
 * One native cron tick for the Host-owned automatic queue. The lease token is
 * checkpointed locally for the trusted consumer's ACK only; it is never added
 * to model input, MCP arguments, or returned diagnostics.
 */
export async function consumeAutomaticWorkItemQueueTick(options, dependencies) {
  if (typeof dependencies.checkpoint?.withActiveClaimOwner !== 'function')
    throw new Error('AUTO_WORK_ITEM_QUEUE_DEPENDENCIES_INVALID');
  if ((options.parkCancelledClaim && (options.finishBlockedClaim || options.repairStoppedClaim)) ||
      (options.finishCancelledClaim && (!options.finishBlockedClaim || options.parkCancelledClaim)))
    throw new Error('AUTO_WORK_ITEM_CANCELLATION_OPTIONS_INVALID');
  const report = await dependencies.checkpoint.withActiveClaimOwner(() => options.parkCancelledClaim
    ? parkCancelledAutomaticClaim(options, { ...dependencies, validateClaim: validateStoredAutoClaim })
    : options.finishBlockedClaim ? finishBlockedAutomaticClaim(options, dependencies)
      : consumeAutomaticQueueTurn(options, dependencies));
  return { ...report, ...checkpointWarnings(report?.localCheckpointWarnings, dependencies.checkpoint.diagnostics) };
}

export function automaticQueueBatchOptions(argv) {
  const flags = ['--queue-max-items', '--queue-tick-budget-ms'];
  if (flags.some(flag => argv.filter(arg => arg === flag).length > 1 ||
      argv.some(arg => arg.startsWith(flag + '='))))
    throw new Error('AUTO_QUEUE_BATCH_OPTIONS_INVALID');
  const maxQueueItems = Number(option(argv, flags[0]) ?? 4);
  const queueTickBudgetMs = Number(option(argv, flags[1]) ?? 15 * 60_000);
  if (!Number.isSafeInteger(maxQueueItems) || maxQueueItems < 1 || maxQueueItems > 16 ||
      !Number.isSafeInteger(queueTickBudgetMs) || queueTickBudgetMs < 1000 || queueTickBudgetMs > 15 * 60_000)
    throw new Error('AUTO_QUEUE_BATCH_OPTIONS_INVALID');
  return { maxQueueItems, queueTickBudgetMs };
}

function completedAutomaticDispatch(report) {
  if (['ACKNOWLEDGED', 'WIKI_DISPATCHED', 'WIKI_MATTER_DISPATCHED'].includes(report?.status)) return true;
  if (report?.status === 'REVIEW_DISPATCHED')
    return ['CANDIDATE_SAVED', 'IDLE'].includes(report.review?.status);
  if (report?.status === 'OVERALL_DISPATCHED') return report.overall?.status === 'SUCCESSOR_OVERALL_SAVED';
  return report?.status === 'DOCUMENT_DISPATCHED' &&
    ['DOCUMENT_READY', 'DOCUMENT_READY_WITH_LIMITATIONS', 'READING_SAVED', 'IDLE'].includes(report.document?.status);
}

async function automaticQueueBoundary(checkpoint) {
  return (await Promise.all(['active-claim', 'active-wiki', 'active-successor-overall']
    .map(key => checkpoint.readOptional(key)))).every(value => value === null);
}

async function consumeAutomaticQueueTurn(options, dependencies) {
  if (options.repairStoppedClaim || typeof dependencies.consumeWikiIdle !== 'function')
    return consumeAutomaticWorkItemQueueTickOwned(options, dependencies);
  const { checkpoint } = dependencies;
  // Existing work, provider UNKNOWN and successor recovery precede the fairness
  // cursor. A damaged new cursor can never preempt or block those recoveries.
  if (!await automaticQueueBoundary(checkpoint)) {
    const report = await consumeAutomaticWorkItemQueueTickOwned(options, dependencies);
    if ((completedAutomaticDispatch(report) || report.status === 'WIKI_ATTENTION') &&
        await automaticQueueBoundary(checkpoint))
      await checkpoint.write('queue-turn', report.status.startsWith('WIKI_') ? 'WORK' : 'WIKI');
    return report;
  }
  const turn = await checkpoint.readOptional('queue-turn');
  if (turn !== null && !['WORK', 'WIKI'].includes(turn)) throw new Error('AUTO_QUEUE_TURN_INVALID');
  let wiki;
  const nextWiki = () => wiki ??= Promise.resolve().then(() => dependencies.consumeWikiIdle());
  if (turn === 'WIKI' && await automaticQueueBoundary(checkpoint)) {
    const result = await nextWiki();
    const releasedAttention = result.status === 'WIKI_ATTENTION' && await automaticQueueBoundary(checkpoint);
    if (!['IDLE', 'ATTENTION'].includes(result.status) && !releasedAttention) {
      if (completedAutomaticDispatch(result) && await automaticQueueBoundary(checkpoint))
        await checkpoint.write('queue-turn', 'WORK');
      return result;
    }
    // An empty Wiki queue yields to ordinary work in the same tick. Preserve an
    // explicit discovery ATTENTION without calling or generating that Wiki twice.
    await checkpoint.write('queue-turn', 'WORK');
  }
  const report = await consumeAutomaticWorkItemQueueTickOwned(options, {
    ...dependencies, consumeWikiIdle: nextWiki,
  });
  if (completedAutomaticDispatch(report) && await automaticQueueBoundary(checkpoint))
    await checkpoint.write('queue-turn', report.status.startsWith('WIKI_') ? 'WORK' : 'WIKI');
  const observedWiki = wiki ? await wiki : null;
  return ['ATTENTION', 'WIKI_ATTENTION'].includes(observedWiki?.status) && report !== observedWiki
    ? { ...report, wikiAttention: observedWiki } : report;
}

/** One endpoint owner remains held across a bounded sequential batch. Never
 * start another subject after pending/UNKNOWN/attention or an active pointer. */
export async function consumeAutomaticWorkItemQueueBatch(options, dependencies) {
  if (options.repairStoppedClaim || options.finishBlockedClaim || options.parkCancelledClaim)
    return consumeAutomaticWorkItemQueueTick(options, dependencies);
  const limits = automaticQueueBatchOptions([
    '--queue-max-items', String(options.maxQueueItems ?? 4),
    '--queue-tick-budget-ms', String(options.queueTickBudgetMs ?? 15 * 60_000),
  ]);
  if (typeof dependencies.checkpoint?.withActiveClaimOwner !== 'function')
    throw new Error('AUTO_WORK_ITEM_QUEUE_DEPENDENCIES_INVALID');
  const monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
  const startedAt = monotonicNow();
  const reports = [];
  let stopReason = 'ITEM_LIMIT';
  await dependencies.checkpoint.withActiveClaimOwner(async () => {
    for (let index = 0; index < limits.maxQueueItems; index += 1) {
      const report = await consumeAutomaticQueueTurn(options, dependencies);
      reports.push(report);
      if ((!completedAutomaticDispatch(report) && report?.status !== 'EXPLICIT_BUDGET_DEFERRED') ||
          !await automaticQueueBoundary(dependencies.checkpoint)) {
        stopReason = 'PENDING_OR_IDLE';
        break;
      }
      if (monotonicNow() - startedAt >= limits.queueTickBudgetMs) {
        stopReason = 'TIME_BUDGET';
        break;
      }
    }
  });
  const report = reports.length === 1 ? reports[0] : { status: 'AUTO_QUEUE_BATCH', reports };
  return { ...report, queueBatch: { ...limits, processedItems: reports.length, stopReason },
    ...checkpointWarnings(dependencies.checkpoint.diagnostics) };
}

function checkpointWarnings(...sources) {
  const warnings = sources.filter(Array.isArray).flat();
  return warnings.length ? { localCheckpointWarnings: warnings } : {};
}

async function consumeAutomaticWorkItemQueueTickOwned(options, dependencies) {
  const { checkpoint, now = () => new Date() } = dependencies;
  if (!checkpoint || typeof checkpoint.readOptional !== 'function' ||
      typeof checkpoint.write !== 'function' ||
      typeof dependencies.nextWorkItem !== 'function' ||
      typeof dependencies.acknowledgeWorkItem !== 'function' ||
      typeof dependencies.consumeWorkItem !== 'function' ||
      typeof dependencies.readInitialStatus !== 'function') {
    throw new Error('AUTO_WORK_ITEM_QUEUE_DEPENDENCIES_INVALID');
  }

  let claim = await readCheckpointCandidate(checkpoint, 'active-claim', validateStoredAutoClaim);
  const claimAtStart = claim;
  let reclaimedQueueGrant = false;
  let queueCommitRecovery = null;
  let renewedCommitStatus = null;
  const activeWiki = await checkpoint.readOptional('active-wiki');
  if (activeWiki !== null) {
    if (options.repairStoppedClaim || typeof dependencies.consumeWikiIdle !== 'function' ||
        (claim && !stoppedUnknownWikiEnabled(claim, options, dependencies)))
      throw new Error('AUTO_WORK_ITEM_WIKI_CHECKPOINT_CONFLICT');
    if (claim) {
      if (await checkpoint.readOptional('active-successor-overall') !== null)
        throw new Error('AUTO_WORK_ITEM_WIKI_CHECKPOINT_CONFLICT');
      return attentionWithWiki(automaticWorkItemAttention(claim, claim.attentionCode), dependencies);
    }
    // UNKNOWN provider state owns this endpoint until exact cleanup is proven,
    // including when new user work has arrived or automatic Wiki was paused.
    return dependencies.consumeWikiIdle();
  }
  const storedReviewCursor = claim ? null : await checkpoint.readOptional('review-cursor');
  const storedDocumentCursor = claim ? null : await checkpoint.readOptional('document-cursor');
  if (storedReviewCursor !== null &&
      (typeof storedReviewCursor !== 'string' ||
        !/^WI-[A-Za-z0-9_-]{1,93}$/u.test(storedReviewCursor))) {
    throw new Error('AUTO_WORK_ITEM_REVIEW_CURSOR_INVALID');
  }
  if (storedDocumentCursor !== null &&
      (typeof storedDocumentCursor !== 'string' ||
        !/^(?:attempt|acquisition):[A-Za-z0-9_-]{1,96}$/u.test(storedDocumentCursor)))
    throw new Error('AUTO_WORK_ITEM_DOCUMENT_CURSOR_INVALID');
  if (options.repairStoppedClaim &&
      (!claim?.consumerStopped || claim.completionReady || claim.blockReady ||
        claim.workItemId !== options.repairWorkItemId ||
        !/^AQ-[A-Za-z0-9-]{1,93}$/u.test(options.repairAttemptRef ?? ''))) {
    throw new Error('AUTO_WORK_ITEM_REPAIR_CLAIM_UNAVAILABLE');
  }
  const currentTime = now();
  if (!(currentTime instanceof Date) || !Number.isFinite(currentTime.getTime())) {
    throw new Error('AUTO_WORK_ITEM_QUEUE_CLOCK_INVALID');
  }
  const savedSuccessor = await checkpoint.readOptional('active-successor-overall');
  const activeSuccessor = savedSuccessor === null ? null : validateStoredSuccessorOverall(savedSuccessor, currentTime);
  if (activeSuccessor) {
    if (claim || options.repairStoppedClaim || typeof dependencies.consumeSuccessorOverall !== 'function')
      throw new Error('AUTO_WORK_ITEM_SUCCESSOR_CHECKPOINT_CONFLICT');
    return consumeSuccessorOverallPointer(activeSuccessor, checkpoint, dependencies.consumeSuccessorOverall);
  }

  if (claim) {
    const deferred = await deferExplicitJobAidClaim(options, claim, checkpoint);
    if (deferred) return deferred;
  }

  if (claim?.blockReady) {
    // Only a complete terminal-stage intent from this path can replay its
    // original idempotent BLOCK. Legacy runtime-failure intents stay unknown.
    if (claim.consumerStopped && !claim.completionReady &&
        isInitialStageRequestBinding(claim.stoppedStageRequest) &&
        claim.stoppedStageRequest.workItemId === claim.workItemId &&
        claim.stoppedStageRequest.documentVersionId === claim.documentVersionId &&
        claim.stoppedStageRequest.workItemRevision === claim.workItemRevision &&
        STAGE_BY_OPERATION[claim.stoppedStageRequest.operation] === claim.blockReady.stage)
      return settleTerminalAutomaticClaim(claim, checkpoint, dependencies);
    return automaticWorkItemAttention(claim, 'AUTO_WORK_ITEM_PRIOR_BLOCK_RECEIPT_UNCERTAIN');
  }

  if (!claim || Date.parse(claim.leaseExpiresAt) <= currentTime.getTime()) {
    const previous = claim;
    const next = validateAutoClaimResult(
      await dependencies.nextWorkItem(previous
        ? { resumeWorkItemId: previous.workItemId }
        : storedReviewCursor
          ? { reviewAfterWorkItemId: storedReviewCursor }
          : storedDocumentCursor
            ? { documentAfterRef: storedDocumentCursor }
          : undefined),
      currentTime,
    );
    if (next.status === 'REVIEW_PENDING' || next.status === 'OVERALL_PENDING') {
      const consumer = next.status === 'REVIEW_PENDING'
        ? dependencies.consumeReview : dependencies.consumeSuccessorOverall;
      if (previous || typeof consumer !== 'function')
        throw new Error('AUTO_WORK_ITEM_SUCCESSOR_DISPATCH_INVALID');
      if (next.status === 'OVERALL_PENDING') await checkpoint.write('active-successor-overall', next);
      if (next.status === 'OVERALL_PENDING')
        return consumeSuccessorOverallPointer(next, checkpoint, consumer);
      const result = await consumer(next.workItemId);
      await checkpoint.write('review-cursor', next.reviewAfterWorkItemId);
      return { status: 'REVIEW_DISPATCHED',
        workItemId: next.workItemId, reviewTurnRef: next.reviewTurnRef,
        review: result };
    }
    if (next.status === 'DOCUMENT_PENDING') {
      if (previous || options.repairStoppedClaim ||
          typeof dependencies.consumeDocument !== 'function')
        throw new Error('AUTO_DOCUMENT_DISPATCH_INVALID');
      await checkpoint.write('document-cursor', next.documentAfterRef);
      const result = await dependencies.consumeDocument(next.documentVersionId, next.deliveryRef);
      return { status: 'DOCUMENT_DISPATCHED',
        documentVersionId: next.documentVersionId, deliveryRef: next.deliveryRef, document: result };
    }
    if (next.status === 'IDLE') {
      if (previous) {
        if (previous.completionReady) {
          return acknowledgeAndClearAutoClaim(
            previous,
            checkpoint,
            dependencies,
          );
        }
        return automaticWorkItemAttention(
          previous,
          'AUTO_WORK_ITEM_EXPIRED_RECLAIM_UNAVAILABLE',
        );
      }
      if (next.reviewAfterWorkItemId !== undefined || storedReviewCursor !== null)
        await checkpoint.write('review-cursor', next.reviewAfterWorkItemId ?? null);
      if (next.documentAfterRef !== undefined || storedDocumentCursor !== null)
        await checkpoint.write('document-cursor', next.documentAfterRef ?? null);
      await checkpoint.write('active-claim', null);
      if (typeof dependencies.consumeWikiIdle === 'function') return dependencies.consumeWikiIdle();
      return { status: 'IDLE' };
    }
    if (previous && next.workItemId !== previous.workItemId) {
      throw new Error('AUTO_WORK_ITEM_RECLAIM_SCOPE_MISMATCH');
    }
    if (previous && (next.requestId !== previous.requestId ||
        next.documentVersionId !== previous.documentVersionId)) {
      throw new Error('AUTO_WORK_ITEM_RECLAIM_BINDING_MISMATCH');
    }
    if (options.repairStoppedClaim && previous &&
        next.workItemRevision !== previous.workItemRevision) {
      throw new Error('AUTO_WORK_ITEM_REPAIR_REVISION_CHANGED');
    }
    if (previous && (next.leaseGeneration <= previous.leaseGeneration ||
        next.leaseToken === previous.leaseToken)) {
      if (options.repairStoppedClaim || next.leaseGeneration !== previous.leaseGeneration ||
          next.leaseToken !== previous.leaseToken || next.workItemRevision !== previous.workItemRevision)
        throw new Error('AUTO_WORK_ITEM_RECLAIM_FENCE_INVALID');
      renewedCommitStatus = await dependencies.readInitialStatus(next.workItemId);
      assertAutomaticClaimStatusBinding(next, renewedCommitStatus);
      if (renewedCommitStatus.workItemRevision !== previous.workItemRevision)
        throw new Error('AUTO_WORK_ITEM_RECLAIM_FENCE_INVALID');
      queueCommitRecovery = await confirmInitialCommittingRecovery(
        { workItemId: next.workItemId }, renewedCommitStatus, dependencies);
    }
    reclaimedQueueGrant = previous !== null && queueCommitRecovery === null;
    claim = {
      schemaVersion: 'wiselink.auto_work_item_claim.v1',
      workItemId: next.workItemId,
      requestId: next.requestId,
      documentVersionId: next.documentVersionId,
      workItemRevision: next.workItemRevision,
      leaseToken: next.leaseToken,
      leaseGeneration: next.leaseGeneration,
      leaseExpiresAt: next.leaseExpiresAt,
      completionReady: previous?.completionReady ?? false,
      consumerStopped: previous?.consumerStopped ?? false,
      attentionCode: previous?.attentionCode ?? null,
      blockReady: previous?.blockReady ?? null,
      ...(previous?.stoppedStageRequest !== undefined
        ? { stoppedStageRequest: previous.stoppedStageRequest } : {}),
      ...(previous?.stoppedWorkItemRevision !== undefined
        ? { stoppedWorkItemRevision: previous.stoppedWorkItemRevision }
        : previous?.consumerStopped && next.workItemRevision !== previous.workItemRevision
          ? { stoppedWorkItemRevision: previous.workItemRevision } : {}),
    };
    await checkpoint.write('active-claim', claim);
  }

  const deferred = await deferExplicitJobAidClaim(options, claim, checkpoint);
  if (deferred) return deferred;

  let statusValue = renewedCommitStatus ?? await dependencies.readInitialStatus(claim.workItemId);
  assertAutomaticClaimStatusBinding(claim, statusValue);
  if (options.repairStoppedClaim &&
      statusValue.workItemRevision !== claim.workItemRevision) {
    throw new Error('AUTO_WORK_ITEM_REPAIR_REVISION_CHANGED');
  }
  if (options.repairStoppedClaim &&
      !['FAILED', 'BUSY'].includes(statusValue.status)) {
    throw new Error('AUTO_WORK_ITEM_REPAIR_STAGE_CHANGED');
  }
  if (isAutomaticWorkItemDone(statusValue)) {
    claim = { ...claim, completionReady: true };
    await checkpoint.write('active-claim', claim);
    return acknowledgeAndClearAutoClaim(claim, checkpoint, dependencies);
  }
  if (statusValue.status === 'NOT_READY') {
    let preparation;
    try {
      if (typeof dependencies.prepareOriginal !== 'function') {
        throw new Error('AUTO_WORK_ITEM_ORIGINAL_PREPARATION_UNAVAILABLE');
      }
      // Only the WorkItem identity reaches MCP. The Host validates its active
      // queue lease; lease tokens remain in the private claim/REST boundary.
      preparation = await dependencies.prepareOriginal(claim.workItemId);
    } catch (error) {
      preparation = { status: 'REQUIRES_ATTENTION',
        documentVersionId: claim.documentVersionId, errorCode: errorCode(error) };
    }
    if (!isRecord(preparation) || !['ORIGINAL_PREPARING', 'ORIGINAL_READY',
      'BUSY', 'REQUIRES_ATTENTION'].includes(preparation.status)) {
      throw new Error('AUTO_WORK_ITEM_ORIGINAL_PREPARATION_INVALID');
    }
    if (preparation.documentVersionId !== claim.documentVersionId) {
      throw new Error('AUTO_WORK_ITEM_STATUS_SOURCE_CHANGED');
    }
    const report = { status: preparation.status, workItemId: claim.workItemId,
      documentVersionId: claim.documentVersionId,
      ...(typeof preparation.parseRunId === 'string' ? { parseRunId: preparation.parseRunId } : {}),
      ...(preparation.status === 'REQUIRES_ATTENTION'
        ? { errorCode: safeAutomaticAttentionCode(preparation.errorCode) } : {}) };
    await checkpoint.write('last-original-preparation', report);
    statusValue = await dependencies.readInitialStatus(claim.workItemId);
    assertAutomaticClaimStatusBinding(claim, statusValue);
    if (report.status === 'REQUIRES_ATTENTION') {
      return automaticWorkItemAttention(claim, report.errorCode, statusValue, report);
    }
    if (statusValue.status === 'NOT_READY' || report.status === 'BUSY') {
      return { status: 'IN_PROGRESS', workItemId: claim.workItemId,
        requestId: claim.requestId, documentVersionId: claim.documentVersionId,
        leaseGeneration: claim.leaseGeneration, leaseExpiresAt: claim.leaseExpiresAt,
        nextOperation: statusValue.nextOperation, stages: statusValue.stages,
        consumerStatus: report.status };
    }
    if (isAutomaticWorkItemDone(statusValue)) {
      claim = { ...claim, completionReady: true };
      await checkpoint.write('active-claim', claim);
      return acknowledgeAndClearAutoClaim(claim, checkpoint, dependencies, report);
    }
  }
  let confirmedPreparation = null;
  if (!options.repairStoppedClaim && !queueCommitRecovery &&
      ['FAILED', 'CONFLICT'].includes(statusValue.status) &&
      ['jobAid', 'overall'].some(stage => explicitInitialPreparationStage(statusValue.stages?.[stage]))) {
    try {
      confirmedPreparation = await confirmExplicitInitialPreparationFailure(options, claim, statusValue, dependencies);
    } catch (error) {
      return automaticWorkItemAttention(claim, safeAutomaticAttentionCode(errorCode(error)), statusValue);
    }
  }
  const retry = options.repairStoppedClaim ? null
    : await automaticRetryPlan(statusValue, claim.workItemId,
      dependencies.readSavedWork);
  const repair = options.repairStoppedClaim && claim.consumerStopped && !retry
    ? await repairedRetryPlan(statusValue, claim.workItemId,
      dependencies.readSavedWork, claim.attentionCode, claim.workItemRevision,
      options.repairAttemptRef)
    : null;
  const repairAttentionCode = repair ? claim.attentionCode : null;
  const terminal = !options.repairStoppedClaim && !retry && !queueCommitRecovery
    ? terminalAutomaticClaim(claim, statusValue, confirmedPreparation) : null;
  if (terminal) {
    if (typeof dependencies.blockWorkItem !== 'function' || typeof checkpoint.writeOnceOrEqual !== 'function')
      return automaticWorkItemAttention(claim, 'AUTO_WORK_ITEM_BLOCK_FINALIZATION_UNAVAILABLE', statusValue);
    if (!isDeepStrictEqual(await checkpoint.readOptional('active-claim'), claim))
      throw new Error('AUTO_WORK_ITEM_CLAIM_CHANGED');
    claim = { ...claim, consumerStopped: true, blockReady: terminal.blockReady,
      stoppedStageRequest: terminal.stoppedStageRequest };
    // The exact existing queue and stage identities survive a lost response.
    // Persist before POST; no local failure or timeout invents a terminal stage.
    await checkpoint.write('active-claim', claim);
    return settleTerminalAutomaticClaim(claim, checkpoint, dependencies);
  }
  const committingRecovery = queueCommitRecovery ?? (claim.consumerStopped && statusValue.status === 'BUSY'
    ? await findInitialAssessmentRecovery({ ...options, workItemId: claim.workItemId }, statusValue, dependencies)
    : null);
  const closingRecovery = committingRecovery?.status === 'RECOVERY_CANDIDATE' && committingRecovery.closeOnly
    ? committingRecovery : null;
  const repairingRecovery = options.repairStoppedClaim &&
    ['RECOVERY_CANDIDATE', 'RECOVERY_COMMITTING'].includes(committingRecovery?.status) &&
    ['EVALUATE_JOBAID', 'SYNTHESIZE_OVERALL'].includes(committingRecovery.operation) &&
    statusValue.stages?.[STAGE_BY_OPERATION[committingRecovery.operation]]?.requestId ===
      repairRequestId(claim.workItemId, claim.documentVersionId,
        STAGE_BY_OPERATION[committingRecovery.operation], options.repairAttemptRef);
  const explicitStageRequest = claim.consumerStopped && !retry && !repair &&
    !committingRecovery && !options.repairStoppedClaim
    ? await stoppedClaimExplicitStageRequest(options, claim, statusValue, checkpoint, now, reclaimedQueueGrant)
    : null;
  if (claim.completionReady) {
    claim = { ...claim, completionReady: false };
    await checkpoint.write('active-claim', claim);
  }
  if (claim.consumerStopped && !retry && !repair && !repairingRecovery && !closingRecovery && !explicitStageRequest &&
      !(committingRecovery?.status === 'RECOVERY_COMMITTING' && !options.repairStoppedClaim)) {
    const attention = automaticWorkItemAttention(
      claim,
      claim.attentionCode ?? 'AUTO_WORK_ITEM_CONSUMER_STOPPED',
      statusValue,
    );
    // Only this existing no-progress branch may yield. A new/reclaimed grant
    // or changed latch must finish its ordinary tick before any Wiki work.
    return stoppedUnknownWikiEnabled(claim, options, dependencies) && isDeepStrictEqual(claim, claimAtStart)
      ? attentionWithWiki(attention, dependencies) : attention;
  }
  if (explicitStageRequest) {
    if (!isDeepStrictEqual(await checkpoint.readOptional('active-claim'), claim))
      throw new Error('AUTO_WORK_ITEM_EXPLICIT_CLAIM_CHANGED');
    // An intent is durable before clearing the queue latch. An interrupted
    // wakeup cannot treat this same request as a fresh explicit instruction.
    await checkpoint.writeOnce(explicitStageWakeupStep(explicitStageRequest.requestId), {
      schemaVersion: 'wiselink.auto_work_item_explicit_stage_wakeup.v1',
      ...explicitStageRequest,
      autoRequestId: claim.requestId,
      leaseGeneration: claim.leaseGeneration,
      priorAttentionCode: claim.attentionCode,
      priorStoppedStageRequest: claim.stoppedStageRequest ?? null,
    });
  }
  if ((retry || closingRecovery || (committingRecovery?.status === 'RECOVERY_COMMITTING' &&
      !options.repairStoppedClaim)) && claim.consumerStopped) {
    claim = { ...claim, consumerStopped: false, attentionCode: null };
    await checkpoint.write('active-claim', claim);
  }

  const consumedOperation = queueCommitRecovery?.operation ?? closingRecovery?.operation ?? retry?.operation ?? repair?.operation ?? statusValue.nextOperation;
  const consumedRequestId = retry?.requestId ?? repair?.requestId ??
    statusValue.stages?.[STAGE_BY_OPERATION[consumedOperation]]?.requestId;
  const consumedWorkItemRevision = statusValue.workItemRevision;
  let report;
  try {
    report = await dependencies.consumeWorkItem({
      ...options,
      workItemId: claim.workItemId,
      initialStageOnly: true,
      maxInitialStages: 1,
      // New items must use the context returned by Host status; a static
      // WorkItem's context reference cannot be inherited by a queued item.
      applicabilityContextRef: undefined,
      ...(queueCommitRecovery ? { queueCommitRecovery } : {}),
      ...(explicitStageRequest ? { explicitStageRequest } : {}),
      ...(retry || repair ? { autoRetry: retry ?? repair } : {}),
      ...(repair ? { repairStoppedClaim: true, repairAttentionCode,
        repairWorkItemRevision: claim.workItemRevision,
        repairAttemptRef: options.repairAttemptRef } : {}),
      ...(repairingRecovery ? { repairingRecovery: true, repairStoppedClaim: true,
        repairWorkItemRevision: claim.workItemRevision,
        repairExpectedOperation: committingRecovery.operation,
        repairRequestId: statusValue.stages[STAGE_BY_OPERATION[committingRecovery.operation]].requestId,
        repairActiveAttemptRef: statusValue.stages[STAGE_BY_OPERATION[committingRecovery.operation]].attemptRef } : {}),
    });
  } catch (error) {
    // This receipt proves only this settled invocation failed. A concurrent
    // owner may have replaced or cleared the shared claim; never write it here.
    const invocationId = randomUUID();
    const gatewayTransportFailure = hostedGatewayTransportFailureDiagnostic(error);
    try {
      await checkpoint.writeOnce(`consumer-failure-${invocationId}`, {
        schemaVersion: 'wiselink.auto_work_item_invocation_failure.v1',
        invocationId,
        status: 'FAILED_INVOCATION',
        workItemId: claim.workItemId,
        requestId: claim.requestId,
        documentVersionId: claim.documentVersionId,
        workItemRevision: claim.workItemRevision,
        leaseGeneration: claim.leaseGeneration,
        leaseExpiresAt: claim.leaseExpiresAt,
        attentionCode: safeAutomaticAttentionCode(errorCode(error)),
        ...(gatewayTransportFailure ? { gatewayTransportFailure } : {}),
      });
    } catch (persistenceError) {
      throw new AggregateError([error, persistenceError],
        'AUTO_WORK_ITEM_FAILURE_CHECKPOINT_UNCONFIRMED');
    }
    throw error;
  }
  statusValue = await dependencies.readInitialStatus(claim.workItemId);
  assertAutomaticClaimStatusBinding(claim, statusValue);
  if (explicitStageRequest && !isDeepStrictEqual(await checkpoint.readOptional('active-claim'), claim))
    throw new Error('AUTO_WORK_ITEM_EXPLICIT_CLAIM_CHANGED');
  if (explicitStageRequest && report?.status !== 'REQUIRES_ATTENTION' &&
      !confirmedExplicitStageReport(report, explicitStageRequest, statusValue))
    return automaticWorkItemAttention(claim, 'AUTO_WORK_ITEM_EXPLICIT_REPORT_UNCONFIRMED', statusValue, report);
  const completedStage = explicitStageRequest ??
    (/^AQ-[A-Za-z0-9-]{1,93}$/u.test(report?.attemptRef ?? '') ? {
      workItemId: claim.workItemId, documentVersionId: claim.documentVersionId,
      workItemRevision: consumedWorkItemRevision, operation: consumedOperation,
      requestId: consumedRequestId ?? statusValue.stages?.[STAGE_BY_OPERATION[consumedOperation]]?.requestId,
      attemptRef: report.attemptRef,
    } : null);
  // The queue lease spans serial stages. Only this consumed stage's exact
  // successful Host projection may advance its local revision, never a read
  // of an unrelated later revision while the claim is stopped.
  if (report?.status === 'INITIAL_STAGE_SAVED' && completedStage &&
      confirmedExplicitStageReport(report, completedStage, statusValue) &&
      statusValue.workItemRevision > claim.workItemRevision) {
    if (!isDeepStrictEqual(await checkpoint.readOptional('active-claim'), claim))
      throw new Error('AUTO_WORK_ITEM_EXPLICIT_CLAIM_CHANGED');
    claim = { ...claim, workItemRevision: statusValue.workItemRevision };
    await checkpoint.write('active-claim', claim);
  }
  if (isAutomaticWorkItemDone(statusValue)) {
    claim = { ...claim, completionReady: true };
    await checkpoint.write('active-claim', claim);
    return acknowledgeAndClearAutoClaim(claim, checkpoint, dependencies, report);
  }
  if (report?.status === 'REQUIRES_ATTENTION') {
    const stoppedStageRequest = initialStageRequestBinding(
      claim, statusValue, consumedOperation, consumedRequestId);
    claim = {
      ...claim,
      consumerStopped: true,
      attentionCode: safeAutomaticAttentionCode(report.errorCode),
      ...(stoppedStageRequest || claim.stoppedStageRequest !== undefined
        ? { stoppedStageRequest } : {}),
      ...(claim.stoppedWorkItemRevision !== undefined
        ? { stoppedWorkItemRevision: stoppedStageRequest?.workItemRevision ?? claim.workItemRevision } : {}),
    };
    await checkpoint.write('active-claim', claim);
    return automaticWorkItemAttention(
      claim,
      claim.attentionCode,
      statusValue,
      report,
    );
  }

  // Keep an explicit wakeup stopped across a thrown/uncertain invocation.
  // Only a settled non-attention report releases its old queue latch.
  if ((explicitStageRequest || repair || repairingRecovery) && claim.consumerStopped) {
    claim = { ...claim, consumerStopped: false, attentionCode: null };
    await checkpoint.write('active-claim', claim);
  }

  return {
    status: 'IN_PROGRESS',
    workItemId: claim.workItemId,
    requestId: claim.requestId,
    documentVersionId: claim.documentVersionId,
    leaseGeneration: claim.leaseGeneration,
    leaseExpiresAt: claim.leaseExpiresAt,
    nextOperation: statusValue.nextOperation,
    stages: statusValue.stages,
    consumerStatus: typeof report?.status === 'string' ? report.status : 'UNKNOWN',
    ...checkpointWarnings(report?.localCheckpointWarnings),
  };
}

function terminalAutomaticClaim(claim, initial, confirmedPreparation = null) {
  if (claim.completionReady || initial.workItemId !== claim.workItemId || initial.documentVersionId !== claim.documentVersionId ||
      initial.workItemRevision !== claim.workItemRevision || !['FAILED', 'CONFLICT'].includes(initial.status) ||
      initial.nextOperation !== null || !isRecord(initial.stages) ||
      Object.values(initial.stages).some(stage => ['QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'].includes(stage?.attemptStatus)))
    return null;
  for (const [operation, stage] of Object.entries(STAGE_BY_OPERATION)) {
    const observed = initial.stages[stage];
    if (confirmedPreparation && operation !== confirmedPreparation.operation) continue;
    if (['EVALUATE_JOBAID', 'SYNTHESIZE_OVERALL'].includes(operation) && explicitInitialPreparationStage(observed) &&
        !isDeepStrictEqual(initialStageRequestBinding(claim, initial, operation, observed.requestId), confirmedPreparation)) continue;
    if (!['FAILED', 'CONFLICT'].includes(observed?.status) ||
        !['FAILED', 'CONFLICT', 'TIMED_OUT', 'OBSOLETE'].includes(observed.attemptStatus)) continue;
    const stoppedStageRequest = initialStageRequestBinding(claim, initial, operation, observed.requestId);
    if (stoppedStageRequest) return { blockReady: { stage, status: observed.status }, stoppedStageRequest };
  }
  return null;
}

function explicitInitialRequestId(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function explicitInitialPreparationStage(stage) {
  return stage?.status === 'FAILED' && stage.attemptStatus === 'FAILED' &&
    stage.terminalCode === 'ACTION_ATTEMPT_INITIAL_PREPARATION_FAILED' && explicitInitialRequestId(stage.requestId);
}

function explicitInitialPreparationBinding(claim, initial) {
  if (claim.completionReady || initial.candidateOnly !== true || initial.status !== 'FAILED' || initial.nextOperation !== null ||
      !isRecord(initial.stages) || Object.values(initial.stages).some(stage => stage?.status === 'BUSY' ||
        ['QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'].includes(stage?.attemptStatus))) return null;
  const candidates = ['EVALUATE_JOBAID', 'SYNTHESIZE_OVERALL'].flatMap(operation => {
    const stage = initial.stages[STAGE_BY_OPERATION[operation]];
    if (!explicitInitialPreparationStage(stage)) return [];
    const binding = initialStageRequestBinding(claim, initial, operation, stage.requestId);
    return binding ? [binding] : [];
  });
  const binding = candidates.length === 1 ? candidates[0] : null;
  return binding && (claim.stoppedStageRequest == null || isDeepStrictEqual(claim.stoppedStageRequest, binding)) &&
    (claim.stoppedWorkItemRevision === undefined || claim.stoppedWorkItemRevision === binding.workItemRevision) ? binding : null;
}

async function confirmExplicitInitialPreparationFailure(options, claim, initial, dependencies) {
  const binding = explicitInitialPreparationBinding(claim, initial);
  if (!binding || typeof dependencies.callTool !== 'function') throw new Error('AUTO_WORK_ITEM_INITIAL_PREPARATION_UNCONFIRMED');
  const observed = await dependencies.callTool('get_action_attempt_status', {
    attemptRef: binding.attemptRef, workItemId: binding.workItemId,
  });
  if (observed?.attemptRef !== binding.attemptRef || observed.taskType !==
      (binding.operation === 'EVALUATE_JOBAID' ? 'OPENCLAW_DYNAMIC_EVALUATION' : 'OPENCLAW_OVERALL_SYNTHESIS') ||
      observed.status !== 'FAILED' || observed.terminalReason !== 'ACTION_ATTEMPT_INITIAL_PREPARATION_FAILED' ||
      observed.recoveryAvailable !== false || observed.commitStartedAt !== null || observed.resultContentHash !== null ||
      observed.projectionApplied !== false || Object.hasOwn(observed, 'recoveryResult'))
    throw new Error('AUTO_WORK_ITEM_INITIAL_PREPARATION_UNCONFIRMED');
  // The attempt status intentionally has no DVI. Fresh initial status on both
  // sides supplies that exact binding, including the Host-owned UUID and AQ.
  const fresh = await dependencies.readInitialStatus(claim.workItemId);
  if (!isDeepStrictEqual(explicitInitialPreparationBinding(claim, fresh), binding))
    throw new Error('AUTO_WORK_ITEM_INITIAL_PREPARATION_CHANGED');
  for (const requestId of [binding.requestId, initialPreparationRetryRequestId(binding.workItemId,
    binding.documentVersionId, STAGE_BY_OPERATION[binding.operation], binding.attemptRef)]) {
    await assertUnexecutedInitialPreparationCheckpoint(options, { ...binding, requestId });
  }
  return binding;
}

async function assertUnexecutedInitialPreparationCheckpoint(options, binding) {
  if (!isAbsolute(options.checkpointRoot ?? '')) throw new Error('AUTO_WORK_ITEM_INITIAL_PREPARATION_CHECKPOINT_UNCONFIRMED');
  const directory = initialStageCheckpointPath({ ...options, workItemId: binding.workItemId }, binding.operation, binding.requestId);
  // Do not open a mutable store: its mkdir/chmod/quarantine would alter the old
  // UNKNOWN evidence. Inspect only these two exact namespaces, never old roots.
  let current = options.checkpointRoot;
  for (const part of ['', encodeURIComponent(binding.workItemId), 'initial', binding.operation, 'requests', binding.requestId]) {
    if (part) current = join(current, part);
    let info;
    try { info = await lstat(current); }
    catch (error) { if (error?.code === 'ENOENT' && current !== options.checkpointRoot) return; throw error; }
    if (!info.isDirectory() || info.isSymbolicLink() || current === directory && info.mode & 0o077)
      throw new Error('AUTO_WORK_ITEM_INITIAL_PREPARATION_CHECKPOINT_UNCONFIRMED');
  }
  const begin = `${INITIAL_ASSESSMENT_OPERATIONS[binding.operation].begin}-1`;
  const allowed = ['binding.json', 'get_parse_status-1.started.json', 'get_parse_status-1.result.json', `${begin}.started.json`];
  const entries = await readdir(directory);
  if (entries.some(name => !allowed.includes(name))) throw new Error('AUTO_WORK_ITEM_INITIAL_PREPARATION_CHECKPOINT_UNCONFIRMED');
  const expectedBinding = { workItemId: binding.workItemId, documentVersionId: binding.documentVersionId,
    operation: binding.operation, requestId: binding.requestId };
  const values = new Map();
  for (const name of entries) {
    const path = join(directory, name), info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o077)
      throw new Error('AUTO_WORK_ITEM_INITIAL_PREPARATION_CHECKPOINT_UNCONFIRMED');
    values.set(name, JSON.parse(await readFile(path, 'utf8')));
  }
  if (entries.length && !isDeepStrictEqual(values.get('binding.json'), expectedBinding))
    throw new Error('AUTO_WORK_ITEM_INITIAL_PREPARATION_CHECKPOINT_UNCONFIRMED');
  for (const [name, value] of values) {
    if (name === 'binding.json') continue;
    const step = name.replace(/\.(?:started|result)\.json$/u, '');
    const args = { workItemId: binding.workItemId, ...(step === begin
      ? { ...(binding.operation === 'SYNTHESIZE_OVERALL' ? { providers: [] } : {}), requestId: binding.requestId } : {}) };
    if (value?.schemaVersion !== 'wiselink.3_1.hosted_review_driver.v1' || value.step !== step || value.argsHash !== canonicalSha256(args))
      throw new Error('AUTO_WORK_ITEM_INITIAL_PREPARATION_CHECKPOINT_UNCONFIRMED');
    if (name === 'get_parse_status-1.result.json' &&
        readInitialStatus(value.value, binding.workItemId).documentVersionId !== binding.documentVersionId)
      throw new Error('AUTO_WORK_ITEM_INITIAL_PREPARATION_CHECKPOINT_UNCONFIRMED');
  }
}

function terminalBlockedReceipt(value, claim, expectedReceipt) {
  const expectedCode = `AUTO_WORK_ITEM_STAGE_${claim.blockReady.stage.toUpperCase()}_${claim.blockReady.status}`;
  const keys = ['status', 'workItemId', 'blockedCode', 'blockedAt', 'replayed'];
  if (!isRecord(value) || Object.keys(value).length !== keys.length ||
      !Object.keys(value).every(key => keys.includes(key)) || value.status !== 'BLOCKED' ||
      value.workItemId !== claim.workItemId || value.blockedCode !== expectedCode ||
      typeof value.replayed !== 'boolean' || typeof value.blockedAt !== 'string' ||
      !Number.isFinite(Date.parse(value.blockedAt)) || new Date(value.blockedAt).toISOString() !== value.blockedAt ||
      (expectedReceipt && (value.replayed !== true || value.blockedAt !== expectedReceipt.blockedAt)))
    throw new Error('AUTO_WORK_ITEM_BLOCK_RECEIPT_INVALID');
  return value;
}

async function settleTerminalAutomaticClaim(claim, checkpoint, dependencies) {
  if (typeof dependencies.blockWorkItem !== 'function' || typeof checkpoint.writeOnceOrEqual !== 'function')
    return automaticWorkItemAttention(claim, 'AUTO_WORK_ITEM_BLOCK_FINALIZATION_UNAVAILABLE');
  if (!isDeepStrictEqual(await checkpoint.readOptional('active-claim'), claim))
    throw new Error('AUTO_WORK_ITEM_CLAIM_CHANGED');
  const input = { workItemId: claim.workItemId, leaseToken: claim.leaseToken, leaseGeneration: claim.leaseGeneration };
  let receipt;
  let confirmed;
  try {
    receipt = terminalBlockedReceipt(await dependencies.blockWorkItem(input), claim);
    // The same ordinary POST reads its persisted receipt after BLOCK. It cannot
    // block another grant: Host binds the original token and generation.
    confirmed = receipt.replayed ? receipt
      : terminalBlockedReceipt(await dependencies.blockWorkItem(input), claim, receipt);
  } catch (error) {
    if (!receipt) return { ...automaticWorkItemAttention(claim, 'AUTO_WORK_ITEM_BLOCK_RECEIPT_UNCERTAIN'),
      blockErrorCode: safeAutomaticAttentionCode(errorCode(error)) };
    return { ...receipt, claimRetained: true, localFinalizationPending: true,
      errorCode: safeAutomaticAttentionCode(errorCode(error)) };
  }
  try {
    if (!isDeepStrictEqual(await checkpoint.readOptional('active-claim'), claim))
      throw new Error('AUTO_WORK_ITEM_CLAIM_CHANGED');
    await checkpoint.writeOnceOrEqual(`blocked-claim-${claim.workItemId}-g${claim.leaseGeneration}`, {
      schemaVersion: 'wiselink.auto_work_item_blocked_claim_archive.v1', claim, receipt: confirmed,
    });
    if (!isDeepStrictEqual(await checkpoint.readOptional('active-claim'), claim))
      throw new Error('AUTO_WORK_ITEM_CLAIM_CHANGED');
    await checkpoint.write('active-claim', null);
  } catch (error) {
    // Host BLOCK is already confirmed. Keep the original intent/receipt path
    // recoverable when a local archive or cleanup cannot be persisted.
    return { ...confirmed, claimRetained: true, localFinalizationPending: true,
      errorCode: safeAutomaticAttentionCode(errorCode(error)) };
  }
  return { status: 'BLOCKED_CLAIM_FINALIZED', workItemId: claim.workItemId, requestId: claim.requestId,
    documentVersionId: claim.documentVersionId, leaseGeneration: claim.leaseGeneration,
    blockedCode: confirmed.blockedCode, blockedAt: confirmed.blockedAt, alreadyFinalized: receipt.replayed };
}

function validBlockedClaimExpectation(options) {
  return /^WI-[A-Za-z0-9_-]{1,93}$/u.test(options.finishWorkItemId) &&
    /^REQ-[A-Za-z0-9_-]{1,92}$/u.test(options.finishRequestId) &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/u.test(options.finishDocumentVersionId) &&
    Number.isSafeInteger(options.finishLeaseGeneration) && options.finishLeaseGeneration >= 1 &&
    typeof options.finishBlockedAt === 'string' && Number.isFinite(Date.parse(options.finishBlockedAt)) &&
    new Date(options.finishBlockedAt).toISOString() === options.finishBlockedAt;
}

function matchesBlockedClaimExpectation(claim, options) {
  return claim?.workItemId === options.finishWorkItemId &&
    claim.requestId === options.finishRequestId &&
    claim.documentVersionId === options.finishDocumentVersionId &&
    claim.leaseGeneration === options.finishLeaseGeneration;
}

function validatedBlockedReceipt(value, options) {
  if (options.finishCancelledClaim)
    return validateCancelledBlockReceipt(value, options.cancellationExpectation,
      { replayOnly: true, blockedAt: options.finishBlockedAt });
  const keys = ['status', 'workItemId', 'blockedCode', 'blockedAt', 'replayed'];
  if (!isRecord(value) || Object.keys(value).length !== keys.length ||
      !Object.keys(value).every(key => keys.includes(key)) || value.status !== 'BLOCKED' ||
      value.workItemId !== options.finishWorkItemId || value.replayed !== true ||
      value.blockedAt !== options.finishBlockedAt ||
      !/^AUTO_WORK_ITEM_STAGE_(?:TRANSLATION|APPLICABILITY|JOBAID|OVERALL)_(?:FAILED|CONFLICT)$/u.test(value.blockedCode))
    throw new Error('AUTO_WORK_ITEM_BLOCK_RECEIPT_INVALID');
  return value;
}

function validateBlockedClaimArchive(value, options) {
  try {
    assertExactKeys(value, ['schemaVersion', 'claim', 'receipt',
      ...(options.finishCancelledClaim ? ['cancellationExpectation'] : [])], [], 'AUTO_WORK_ITEM_BLOCK_ARCHIVE');
    if (value.schemaVersion !== (options.finishCancelledClaim
      ? 'wiselink.auto_work_item_cancelled_claim_archive.v1' : 'wiselink.auto_work_item_blocked_claim_archive.v1') ||
        !matchesBlockedClaimExpectation(validateStoredAutoClaim(value.claim), options))
      throw new Error('INVALID_BINDING');
    if (options.finishCancelledClaim && (!matchesCancelledClaim(value.claim, options.cancellationExpectation) ||
        JSON.stringify(parseCancelledClaimExpectation(value.cancellationExpectation)) !==
          JSON.stringify(options.cancellationExpectation))) throw new Error('INVALID_BINDING');
    validatedBlockedReceipt(value.receipt, options);
  } catch { throw new Error('AUTO_WORK_ITEM_BLOCK_ARCHIVE_INVALID'); }
}

async function finishBlockedAutomaticClaim(options, dependencies) {
  const { checkpoint, blockWorkItem } = dependencies;
  if (!validBlockedClaimExpectation(options) || options.repairStoppedClaim ||
      typeof blockWorkItem !== 'function' || typeof checkpoint.writeOnceOrEqual !== 'function')
    throw new Error('AUTO_WORK_ITEM_BLOCK_FINALIZATION_OPTIONS_INVALID');
  if (options.finishCancelledClaim) {
    const cancellationExpectation = await readCancelledClaimExpectation(options.parkExpectationFile);
    if (cancellationExpectation.workItemId !== options.finishWorkItemId ||
        cancellationExpectation.leaseGeneration !== options.finishLeaseGeneration ||
        cancellationExpectation.expectedCancellation.requestId !== options.finishRequestId ||
        cancellationExpectation.expectedCancellation.documentVersionId !== options.finishDocumentVersionId)
      throw new Error('AUTO_WORK_ITEM_CANCELLATION_EXPECTATION_INVALID');
    options = { ...options, cancellationExpectation };
  }
  const archiveKey = `blocked-claim-${options.finishWorkItemId}-g${options.finishLeaseGeneration}`;
  const stored = await checkpoint.readOptional('active-claim');
  const claim = stored === null ? null : validateStoredAutoClaim(stored);
  const archived = await checkpoint.readOptional(archiveKey);
  if (archived !== null) validateBlockedClaimArchive(archived, options);
  const result = receipt => ({ status: 'BLOCKED_CLAIM_FINALIZED',
    workItemId: options.finishWorkItemId, requestId: options.finishRequestId,
    documentVersionId: options.finishDocumentVersionId,
    leaseGeneration: options.finishLeaseGeneration,
    blockedCode: receipt.blockedCode, blockedAt: receipt.blockedAt });
  if (!matchesBlockedClaimExpectation(claim, options)) {
    if (archived !== null) return { ...result(archived.receipt), alreadyFinalized: true };
    throw new Error('AUTO_WORK_ITEM_BLOCKED_CLAIM_CHANGED');
  }
  if (!claim.consumerStopped || claim.completionReady || claim.blockReady !== null)
    throw new Error('AUTO_WORK_ITEM_BLOCKED_CLAIM_CHANGED');
  if (options.finishCancelledClaim && !matchesCancelledClaim(claim, options.cancellationExpectation))
    throw new Error('AUTO_WORK_ITEM_BLOCKED_CLAIM_CHANGED');
  if (options.finishCancelledClaim) assertCancelledParkIntent(await checkpoint.readOptional(
    `cancelled-park-${claim.workItemId}-g${claim.leaseGeneration}`),
  claim, options.cancellationExpectation, validateStoredAutoClaim);
  // This is the explicit, approved idempotent BLOCK POST, not a read-only API.
  // Only an exact existing replay is a release receipt; local failure/not-found
  // and a freshly created BLOCK can never silently clear this checkpoint.
  const receipt = validatedBlockedReceipt(await blockWorkItem({
    workItemId: claim.workItemId, leaseToken: claim.leaseToken,
    leaseGeneration: claim.leaseGeneration,
    ...(options.finishCancelledClaim ? {
      expectedCancellation: options.cancellationExpectation.expectedCancellation, replayOnly: true,
    } : {}),
  }), options);
  if (options.finishCancelledClaim && JSON.stringify(validateStoredAutoClaim(
    await checkpoint.readOptional('active-claim'))) !== JSON.stringify(claim))
    throw new Error('AUTO_WORK_ITEM_BLOCKED_CLAIM_CHANGED');
  await checkpoint.writeOnceOrEqual(archiveKey, {
    schemaVersion: options.finishCancelledClaim
      ? 'wiselink.auto_work_item_cancelled_claim_archive.v1' : 'wiselink.auto_work_item_blocked_claim_archive.v1', claim, receipt,
    ...(options.finishCancelledClaim ? { cancellationExpectation: options.cancellationExpectation } : {}),
  });
  await checkpoint.write('active-claim', null);
  return { ...result(receipt), alreadyFinalized: false };
}

async function acknowledgeAndClearAutoClaim(
  claim,
  checkpoint,
  dependencies,
  report,
) {
  if (!isDeepStrictEqual(await checkpoint.readOptional('active-claim'), claim))
    throw new Error('AUTO_WORK_ITEM_CLAIM_CHANGED');
  const acknowledgement = validateAutoAcknowledgement(
    await dependencies.acknowledgeWorkItem({
      workItemId: claim.workItemId,
      leaseToken: claim.leaseToken,
      leaseGeneration: claim.leaseGeneration,
    }),
    claim.workItemId,
  );
  if (isDeepStrictEqual(await checkpoint.readOptional('active-claim'), claim)) {
    if (typeof checkpoint.writeAuxiliary === 'function') await checkpoint.writeAuxiliary('active-claim', null);
    else await checkpoint.write('active-claim', null);
  }
  return {
    status: 'ACKNOWLEDGED',
    workItemId: claim.workItemId,
    replayed: acknowledgement.replayed,
    acknowledgedAt: acknowledgement.acknowledgedAt,
    consumerStatus: typeof report?.status === 'string' ? report.status : 'COMPLETED',
    ...checkpointWarnings(report?.localCheckpointWarnings),
  };
}

function validateStoredAutoClaim(value) {
  if (!isRecord(value)) throw new Error('AUTO_WORK_ITEM_CLAIM_CHECKPOINT_INVALID');
  assertExactKeys(
    value,
    [
      'schemaVersion', 'workItemId', 'requestId', 'documentVersionId',
      'workItemRevision', 'leaseToken', 'leaseGeneration', 'leaseExpiresAt',
      'completionReady', 'consumerStopped', 'attentionCode', 'blockReady',
    ],
    ['stoppedStageRequest', 'stoppedWorkItemRevision'],
    'AUTO_WORK_ITEM_CLAIM_CHECKPOINT',
  );
  if (value.schemaVersion !== 'wiselink.auto_work_item_claim.v1' ||
      typeof value.completionReady !== 'boolean' ||
      typeof value.consumerStopped !== 'boolean' ||
      (value.attentionCode !== null &&
        (typeof value.attentionCode !== 'string' ||
          !/^[A-Z][A-Z0-9_:.-]{0,199}$/u.test(value.attentionCode))) ||
      (value.blockReady !== null && !isAutomaticBlockBinding(value.blockReady)) ||
      (value.stoppedStageRequest !== undefined && value.stoppedStageRequest !== null &&
        !isInitialStageRequestBinding(value.stoppedStageRequest)) ||
      (value.stoppedWorkItemRevision !== undefined &&
        (!Number.isSafeInteger(value.stoppedWorkItemRevision) || value.stoppedWorkItemRevision < 0))) {
    throw new Error('AUTO_WORK_ITEM_CLAIM_CHECKPOINT_INVALID');
  }
  validateClaimFields(value);
  return value;
}

function validateAutoClaimResult(value, now) {
  if (!isRecord(value)) throw new Error('AUTO_WORK_ITEM_CLAIM_RESPONSE_INVALID');
  if (value.status === 'DOCUMENT_PENDING') {
    assertExactKeys(value, ['status', 'documentVersionId', 'deliveryRef', 'documentAfterRef'], [],
      'AUTO_WORK_ITEM_CLAIM_RESPONSE');
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/u.test(value.documentVersionId))
      throw new Error('AUTO_WORK_ITEM_CLAIM_RESPONSE_INVALID');
    if (!/^(?:work-item:WI(?:-[A-Za-z0-9_-]{1,93})?|acquisition:[A-Za-z0-9_-]{1,96})$/u.test(value.deliveryRef))
      throw new Error('AUTO_WORK_ITEM_CLAIM_RESPONSE_INVALID');
    if (value.deliveryRef.startsWith('acquisition:')
      ? value.documentAfterRef !== value.deliveryRef
      : !/^attempt:[A-Za-z0-9_-]{1,96}$/u.test(value.documentAfterRef))
      throw new Error('AUTO_WORK_ITEM_CLAIM_RESPONSE_INVALID');
    return value;
  }
  if (value.status === 'IDLE') {
    assertExactKeys(value, ['status'], ['reviewAfterWorkItemId', 'documentAfterRef'], 'AUTO_WORK_ITEM_CLAIM_RESPONSE');
    if (value.reviewAfterWorkItemId !== undefined &&
        !/^WI-[A-Za-z0-9_-]{1,93}$/u.test(value.reviewAfterWorkItemId))
      throw new Error('AUTO_WORK_ITEM_CLAIM_RESPONSE_INVALID');
    if (value.documentAfterRef !== undefined &&
        !/^(?:attempt|acquisition):[A-Za-z0-9_-]{1,96}$/u.test(value.documentAfterRef))
      throw new Error('AUTO_WORK_ITEM_CLAIM_RESPONSE_INVALID');
    return value;
  }
  if (value.status === 'REVIEW_PENDING' || value.status === 'OVERALL_PENDING') {
    assertExactKeys(value,
      ['status', 'workItemId', 'reviewTurnRef', 'reviewAfterWorkItemId'],
      value.status === 'OVERALL_PENDING' ? ['workRevisionRef'] : [],
      'AUTO_WORK_ITEM_CLAIM_RESPONSE');
    if (!/^WI-[A-Za-z0-9_-]{1,93}$/u.test(value.workItemId) ||
        !/^RT-[A-Za-z0-9_-]{1,93}$/u.test(value.reviewTurnRef) ||
        (value.status === 'OVERALL_PENDING' && !/^JAWR-[A-Za-z0-9_-]{1,93}$/u.test(value.workRevisionRef)) ||
        value.reviewAfterWorkItemId !== value.workItemId)
      throw new Error('AUTO_WORK_ITEM_CLAIM_RESPONSE_INVALID');
    return value;
  }
  assertExactKeys(
    value,
    [
      'status', 'workItemId', 'requestId', 'documentVersionId',
      'workItemRevision', 'leaseToken', 'leaseGeneration', 'leaseExpiresAt',
    ],
    [],
    'AUTO_WORK_ITEM_CLAIM_RESPONSE',
  );
  if (value.status !== 'CLAIMED') {
    throw new Error('AUTO_WORK_ITEM_CLAIM_RESPONSE_INVALID');
  }
  validateClaimFields(value);
  if (Date.parse(value.leaseExpiresAt) <= now.getTime()) {
    throw new Error('AUTO_WORK_ITEM_CLAIM_RESPONSE_EXPIRED');
  }
  return value;
}

function validateStoredSuccessorOverall(value, now) {
  try {
    const pointer = validateAutoClaimResult(value, now);
    if (pointer.status === 'OVERALL_PENDING') return pointer;
  } catch { /* A malformed checkpoint cannot select a different task. */ }
  throw new Error('AUTO_WORK_ITEM_SUCCESSOR_CHECKPOINT_INVALID');
}

function validateClaimFields(value) {
  if (typeof value.workItemId !== 'string' || typeof value.requestId !== 'string' ||
      typeof value.documentVersionId !== 'string' || typeof value.leaseToken !== 'string' ||
      !/^WI-[A-Za-z0-9_-]{1,93}$/u.test(value.workItemId) ||
      !/^REQ-[A-Za-z0-9_-]{1,92}$/u.test(value.requestId) ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/u.test(value.documentVersionId) ||
      !Number.isSafeInteger(value.workItemRevision) || value.workItemRevision < 0 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.leaseToken) ||
      !Number.isSafeInteger(value.leaseGeneration) || value.leaseGeneration < 1 ||
      typeof value.leaseExpiresAt !== 'string' || !Number.isFinite(Date.parse(value.leaseExpiresAt))) {
    throw new Error('AUTO_WORK_ITEM_CLAIM_RESPONSE_INVALID');
  }
}

function validateAutoAcknowledgement(value, workItemId) {
  if (!isRecord(value)) throw new Error('AUTO_WORK_ITEM_ACK_RESPONSE_INVALID');
  assertExactKeys(
    value,
    ['status', 'workItemId', 'replayed', 'acknowledgedAt'],
    [],
    'AUTO_WORK_ITEM_ACK_RESPONSE',
  );
  if (value.status !== 'ACKNOWLEDGED' || value.workItemId !== workItemId ||
      typeof value.replayed !== 'boolean' ||
      typeof value.acknowledgedAt !== 'string' ||
      !Number.isFinite(Date.parse(value.acknowledgedAt))) {
    throw new Error('AUTO_WORK_ITEM_ACK_RESPONSE_INVALID');
  }
  return value;
}

function isAutomaticWorkItemDone(initial) {
  return initialComplete(initial);
}

function assertAutomaticClaimStatusBinding(claim, initial) {
  if (!isRecord(initial) || initial.documentVersionId !== claim.documentVersionId) {
    throw new Error('AUTO_WORK_ITEM_STATUS_SOURCE_CHANGED');
  }
}

function isInitialStageRequestBinding(value) {
  return isRecord(value) && JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify(['attemptRef', 'documentVersionId', 'operation', 'requestId', 'workItemId', 'workItemRevision']) &&
    typeof value.workItemId === 'string' && /^WI-[A-Za-z0-9_-]{1,93}$/u.test(value.workItemId) &&
    typeof value.documentVersionId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/u.test(value.documentVersionId) &&
    Number.isSafeInteger(value.workItemRevision) && value.workItemRevision >= 0 &&
    INITIAL_ANALYSIS_OPERATIONS.includes(value.operation) &&
    (value.requestId === null || (typeof value.requestId === 'string' &&
      /^[A-Za-z0-9_-]{1,64}$/u.test(value.requestId))) &&
    typeof value.attemptRef === 'string' && /^AQ-[A-Za-z0-9-]{1,93}$/u.test(value.attemptRef);
}

function initialStageRequestBinding(claim, initial, operation, requestId) {
  const stage = initial.stages?.[STAGE_BY_OPERATION[operation]];
  if (!stage || (Object.hasOwn(stage, 'requestId') && typeof stage.requestId !== 'string') ||
      (requestId !== undefined && typeof requestId !== 'string')) return null;
  if (initial.workItemId !== claim.workItemId || initial.documentVersionId !== claim.documentVersionId ||
      initial.workItemRevision !== claim.workItemRevision || stage?.requestId !== requestId) return null;
  const binding = { workItemId: claim.workItemId, documentVersionId: claim.documentVersionId,
    workItemRevision: claim.workItemRevision, operation, requestId: requestId ?? null, attemptRef: stage?.attemptRef };
  return isInitialStageRequestBinding(binding) ? binding : null;
}

function pendingExplicitInitialStageRequest(claim, initial, hostQueueTakeover = false) {
  const operation = initial.nextOperation;
  const stage = initial.stages?.[STAGE_BY_OPERATION[operation]];
  if (initial.candidateOnly !== true || !['REQUIRED', 'WAITING_INPUT'].includes(initial.status) ||
      !['TRANSLATE', 'EVALUATE_JOBAID', 'SYNTHESIZE_OVERALL'].includes(operation) ||
      stage?.status !== 'PENDING' || stage.attemptStatus !== 'QUEUED' || stage.terminalCode !== null ||
      typeof stage.requestId !== 'string' ||
      !(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(stage.requestId) ||
        hostQueueTakeover && /^[0-9a-f]{64}$/u.test(stage.requestId)) ||
      Object.values(initial.stages).some(observation => observation.status === 'BUSY' ||
        ['RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'].includes(observation.attemptStatus))) return null;
  if (operation !== 'TRANSLATE' &&
      (!['SUCCEEDED', 'PENDING', 'FAILED', 'CONFLICT'].includes(initial.stages.translation?.status) ||
        !['SUCCEEDED', 'WAITING_INPUT'].includes(initial.stages.applicability?.status) ||
        (operation === 'SYNTHESIZE_OVERALL' && initial.stages.jobAid?.status !== 'SUCCEEDED'))) return null;
  return initialStageRequestBinding(claim, initial, operation, stage.requestId);
}

function explicitStageWakeupStep(requestId) {
  return `explicit-stage-wakeup-${requestId}`;
}

function confirmedExplicitStageReport(report, expected, initial) {
  const stage = initial.stages?.[STAGE_BY_OPERATION[expected.operation]];
  if (!isRecord(report) || report.operation !== expected.operation || report.candidateOnly !== true ||
      !Number.isSafeInteger(report.modelCallCount) || report.modelCallCount < 0 ||
      initial.workItemId !== expected.workItemId || initial.documentVersionId !== expected.documentVersionId ||
      stage?.attemptRef !== expected.attemptRef) return false;
  if (report.status === 'INITIAL_STAGE_SAVED') {
    // A successful projection keeps the exact attemptRef but may omit its
    // continuation UUID; its applied WorkItem revision may also advance.
    return report.stageStatus === 'SUCCEEDED' && stage.status === 'SUCCEEDED' &&
      stage.attemptStatus === 'SUCCEEDED' && (!stage.requestId || stage.requestId === expected.requestId) &&
      report.workItemRevision === initial.workItemRevision &&
      Number.isSafeInteger(initial.workItemRevision) && initial.workItemRevision >= expected.workItemRevision;
  }
  return report.status === 'BUSY' && report.nextOperation === null && initial.status === 'BUSY' &&
    initial.nextOperation === null && initial.workItemRevision === expected.workItemRevision &&
    stage.status === 'BUSY' && stage.requestId === expected.requestId &&
    ['RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'].includes(stage.attemptStatus);
}

async function stoppedClaimExplicitStageRequest(options, claim, initial, checkpoint, now, hostQueueTakeover = false) {
  const currentTime = now();
  if (!(currentTime instanceof Date) || !Number.isFinite(currentTime.getTime()))
    throw new Error('AUTO_WORK_ITEM_QUEUE_CLOCK_INVALID');
  if (claim.completionReady || claim.blockReady || !isAbsolute(options.checkpointRoot ?? '') ||
      Date.parse(claim.leaseExpiresAt) <= currentTime.getTime() ||
      /(?:ACL|AUTH|PERMISSION|SOURCE_REVOKED|BINDING_CHANGED|VERSION_DRIFT)/u.test(claim.attentionCode ?? '')) return null;
  const binding = pendingExplicitInitialStageRequest(claim, initial, hostQueueTakeover);
  const stopped = claim.stoppedStageRequest;
  if (!binding || (claim.stoppedWorkItemRevision !== undefined &&
      claim.stoppedWorkItemRevision !== binding.workItemRevision) || (stopped && (stopped.requestId === binding.requestId ||
      stopped.workItemId !== binding.workItemId || stopped.documentVersionId !== binding.documentVersionId ||
      stopped.workItemRevision !== binding.workItemRevision))) return null;
  if (typeof checkpoint.hasEntries !== 'function' || typeof checkpoint.writeOnce !== 'function')
    throw new Error('AUTO_WORK_ITEM_QUEUE_DEPENDENCIES_INVALID');
  if (await checkpoint.hasEntries(explicitStageWakeupStep(binding.requestId))) return null;
  return await unusedInitialStageCheckpoint(options, binding) ? binding : null;
}

async function unusedInitialStageCheckpoint(options, binding) {
  // Legacy claims have no stopped request identity. A queued UUID alone is
  // insufficient: its exact independent namespace must have no intent at all,
  // including incomplete/temp files. No earlier namespace is read or changed.
  const root = options.checkpointRoot;
  let directory = root;
  try {
    for (const segment of ['', encodeURIComponent(binding.workItemId), 'initial', binding.operation,
      'requests', binding.requestId]) {
      if (segment) directory = join(directory, segment);
      let info;
      try { info = await lstat(directory); }
      catch (error) {
        if (error?.code === 'ENOENT' && directory !== root) return true;
        throw error;
      }
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error('AUTO_WORK_ITEM_EXPLICIT_CHECKPOINT_UNAVAILABLE');
    }
    const entries = await readdir(directory);
    if (entries.length === 0) return true;
    // An operator may prepare only this new Host request's opt-in budget.
    // Any execution intent, reservation or prior binding still forbids replay.
    if (!options.jobAidRunLimits || entries.length !== 1 || entries[0] !== 'jobaid-run-budget.json') return false;
    const budgetPath = join(directory, entries[0]);
    const info = await lstat(budgetPath);
    if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o077) return false;
    const budget = JSON.parse(await readFile(budgetPath, 'utf8'));
    return budget.explicitOnly === true && budget.active === null &&
      isDeepStrictEqual(budget.selection, problemContinuationBudgetSelection(binding)) &&
      isDeepStrictEqual(budget.limits, options.jobAidRunLimits) &&
      isDeepStrictEqual(budget.counts, { modelRequests: 0, saves: 0, finishes: 0 });
  } catch (error) {
    throw new Error('AUTO_WORK_ITEM_EXPLICIT_CHECKPOINT_UNAVAILABLE', { cause: error });
  }
}

function assertExplicitInitialStageRequest(options, initial) {
  if (options.explicitStageRequest === undefined) return;
  const expected = options.explicitStageRequest;
  if (!isInitialStageRequestBinding(expected) || typeof expected.requestId !== 'string') throw new Error('AUTO_WORK_ITEM_EXPLICIT_STAGE_CHANGED');
  const current = pendingExplicitInitialStageRequest(expected, initial, /^[0-9a-f]{64}$/u.test(expected.requestId));
  if (!options.initialStageOnly || options.maxInitialStages !== 1 || options.workItemId !== expected?.workItemId ||
      !current ||
      Object.keys(expected).some(key => expected[key] !== current[key]))
    throw new Error('AUTO_WORK_ITEM_EXPLICIT_STAGE_CHANGED');
}

async function automaticRetryPlan(initial, workItemId) {
  if (!isRecord(initial) || initial.status !== 'FAILED' ||
      initial.nextOperation !== null || !isRecord(initial.stages) ||
      typeof initial.documentVersionId !== 'string') return null;
  for (const [stage, operation] of [
    ['jobAid', 'EVALUATE_JOBAID'],
    ['overall', 'SYNTHESIZE_OVERALL'],
  ]) {
    const observation = initial.stages[stage];
    if (observation?.status !== 'FAILED' ||
        typeof observation.attemptRef !== 'string' || !observation.attemptRef) continue;
    const preparationFailed = observation.attemptStatus === 'FAILED' &&
      observation.terminalCode === 'ACTION_ATTEMPT_INITIAL_PREPARATION_FAILED';
    if (!preparationFailed) continue;
    // A failed authorization or changed source requires Host/user resolution,
    // even when the attempt was interrupted before commit.
    if (/(?:ACL|AUTH|PERMISSION|SOURCE_REVOKED|BINDING_CHANGED|VERSION_DRIFT)/u
      .test(observation.terminalCode ?? '')) continue;
    // Cancelled/timed-out provider state does not prove generation stopped.
    // Only the Host's before-execution preparation failure may use this old
    // bounded retry. Partial progress never authorizes an automatic new model run.
    if (explicitInitialRequestId(observation.requestId) ||
        typeof observation.requestId === 'string' && observation.requestId.startsWith('auto-')) continue;
    const requestId = initialPreparationRetryRequestId(workItemId, initial.documentVersionId, stage, observation.attemptRef);
    return { operation, attemptRef: observation.attemptRef, requestId };
  }
  return null;
}

function initialPreparationRetryRequestId(workItemId, documentVersionId, stage, attemptRef) {
  return `auto-retry-${createHash('sha256').update([workItemId, documentVersionId, stage, attemptRef].join(':'))
    .digest('hex').slice(0, 32)}`;
}

// A repaired consumer may make one operator-triggered successor after the
// automatic no-work retry was exhausted. The Host remains authoritative for
// the exact task, current source, authorization, stage and new attempt.
async function repairedRetryPlan(
  initial, workItemId, readSavedWork, attentionCode, workItemRevision,
  expectedAttemptRef,
) {
  if (attentionCode !== 'JOBAID_GATEWAY_HTTP_400:INCOMPLETE_TERMINAL_RESPONSE' ||
      initial?.status !== 'FAILED' || initial.nextOperation !== null ||
      initial.workItemRevision !== workItemRevision ||
      typeof initial.documentVersionId !== 'string' ||
      !isRecord(initial.stages) || typeof readSavedWork !== 'function') return null;
  for (const [stage, operation] of [
    ['jobAid', 'EVALUATE_JOBAID'],
    ['overall', 'SYNTHESIZE_OVERALL'],
  ]) {
    const observation = initial.stages[stage];
    if (observation?.status !== 'FAILED' ||
        !['CANCELLED', 'TIMED_OUT'].includes(observation.attemptStatus) ||
        observation.attemptRef !== expectedAttemptRef ||
        !/^auto-retry-[0-9a-f]{32}$/u.test(observation.requestId ?? '') ||
        observation.terminalCode !==
          'JOBAID_GATEWAY_HTTP_400:INCOMPLETE_TERMINAL_RESPONSE') continue;
    const saved = await readSavedWork(observation.attemptRef, workItemId);
    if (saved?.schemaVersion !== 'wiselink.jobaid-work-read.v2' ||
        saved.executionStatus !== observation.attemptStatus ||
        typeof saved.attemptId !== 'string' || !saved.attemptId ||
        !Number.isSafeInteger(saved.inputWorkRevision) ||
        saved.inputWorkRevision < 0 || saved.revision !== null) continue;
    return { operation, attemptRef: observation.attemptRef,
      requestId: repairRequestId(workItemId, initial.documentVersionId,
        stage, observation.attemptRef) };
  }
  return null;
}

function repairRequestId(workItemId, documentVersionId, stage, attemptRef) {
  const identity = [workItemId, documentVersionId, stage,
    attemptRef, WISELINK_SKILL_VERSION].join(':');
  return `auto-repair-${createHash('sha256').update(identity)
    .digest('hex').slice(0, 32)}`;
}

function isAutomaticBlockBinding(value) {
  return isRecord(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify(['stage', 'status']) &&
    ['translation', 'applicability', 'jobAid', 'overall'].includes(value.stage) &&
    ['FAILED', 'CONFLICT'].includes(value.status);
}

function stoppedUnknownWikiEnabled(claim, options, dependencies) {
  return claim?.consumerStopped === true && claim.completionReady === false && claim.blockReady === null &&
    claim.attentionCode === 'INITIAL_ASSESSMENT_MODEL_OUTCOME_UNKNOWN' &&
    !options.repairStoppedClaim && !options.finishBlockedClaim && !options.parkCancelledClaim &&
    !options.finishCancelledClaim && typeof dependencies.consumeWikiIdle === 'function';
}

async function attentionWithWiki(attention, dependencies) {
  // This awaited call still owns the endpoint FD lock. It neither resumes nor
  // proves termination of the stopped ordinary provider; keep its fault visible.
  try { return { ...attention, wiki: await dependencies.consumeWikiIdle() }; }
  catch (error) {
    return { ...attention, wiki: { status: 'WIKI_ATTENTION', errorCode: safeAutomaticAttentionCode(errorCode(error)) } };
  }
}

function automaticWorkItemAttention(claim, errorCode, initial, report) {
  return {
    status: 'REQUIRES_ATTENTION',
    workItemId: claim.workItemId,
    requestId: claim.requestId,
    documentVersionId: claim.documentVersionId,
    leaseGeneration: claim.leaseGeneration,
    errorCode,
    ...(initial ? {
      initialStatus: initial.status,
      nextOperation: initial.nextOperation,
      stages: initial.stages,
    } : {}),
    ...(typeof report?.status === 'string' ? { consumerStatus: report.status } : {}),
    ...checkpointWarnings(report?.localCheckpointWarnings),
  };
}

function safeAutomaticAttentionCode(value) {
  const toolFailure = typeof value === 'string'
    ? value.match(/^REVIEW_HOST_MCP_TOOL_FAILED:([a-z_]+)(?::([A-Z][A-Z0-9_]{0,159}))?$/u) : null;
  if (toolFailure && value.length <= 200 && HOST_ERROR_TOOLS.has(toolFailure[1])) return value;
  return typeof value === 'string' && /^[A-Z][A-Z0-9_:.-]{0,199}$/u.test(value)
    ? value : 'AUTO_WORK_ITEM_CONSUMER_STOPPED';
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value, required, optional, code) {
  if (!isRecord(value)) throw new Error(`${code}_INVALID`);
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(value).some(key => !allowed.has(key))) {
    throw new Error(`${code}_UNKNOWN_FIELD`);
  }
  if (required.some(key => !Object.hasOwn(value, key))) {
    throw new Error(`${code}_MISSING_FIELD`);
  }
}

/** A completed WorkItem may receive a separately authorized Review update.
 * Its Overall uses the Review's saved work revision, never the initial-stage cursor. */
export async function runHostedSuccessorOverall(pointer, dependencies) {
  if (!/^WI-[A-Za-z0-9_-]{1,93}$/u.test(pointer?.workItemId ?? '') ||
      !/^RT-[A-Za-z0-9_-]{1,93}$/u.test(pointer?.reviewTurnRef ?? '') ||
      !/^JAWR-[A-Za-z0-9_-]{1,93}$/u.test(pointer?.workRevisionRef ?? '') ||
      typeof pointer.checkpointRoot !== 'string' ||
      typeof dependencies?.callTool !== 'function' ||
      typeof dependencies?.invokeInitialModel !== 'function')
    throw new Error('HOSTED_SUCCESSOR_OVERALL_INPUT_INVALID');
  const checkpoint = await createCheckpointStore(join(pointer.checkpointRoot,
    'successor-overall', pointer.workItemId, pointer.reviewTurnRef));
  const binding = { workItemId: pointer.workItemId, reviewTurnRef: pointer.reviewTurnRef,
    workRevisionRef: pointer.workRevisionRef };
  const stored = await checkpoint.readOptional('binding');
  if (stored && Object.entries(binding).some(([key, value]) => stored[key] !== value))
    throw new Error('HOSTED_SUCCESSOR_OVERALL_CHECKPOINT_BINDING_CHANGED');
  if (!stored) await checkpoint.writeOnce('binding', binding);
  const current = async () => {
    const status = await dependencies.callTool('get_parse_status', {
      workItemId: pointer.workItemId, successorReviewTurnRef: pointer.reviewTurnRef,
    });
    return status?.integratedAssessmentSummary?.overallSynthesis?.basedOnJobAidWorkRevisionRef === pointer.workRevisionRef;
  };
  const savedResult = await checkpoint.readOptional('run-result');
  if (savedResult) {
    if (!await current()) throw new Error('HOSTED_SUCCESSOR_OVERALL_RESULT_DRIFT');
    return savedResult;
  }
  const observeCandidateRejection = async report => {
    const legacyStep = `model.candidate-rejection-${report.correctionNo}`;
    const legacy = await checkpoint.readOptional(legacyStep);
    if (legacy?.modelRound === report.modelRound &&
        legacy?.correctionNo === report.correctionNo)
      return checkpoint.writeOnceOrEqual(legacyStep, report);
    return checkpoint.writeOnceOrEqual(
      `model.candidate-rejection-${report.modelRound}-${report.correctionNo}`, report);
  };
  let executionModel;
  let taskDeadline;
  const callTool = async (name, args) => {
    if (!INITIAL_TOOLS.has(name)) throw new Error('HOSTED_SUCCESSOR_OVERALL_TOOL_NOT_ALLOWED');
    const value = await dependencies.callTool(name, { ...args, workItemId: pointer.workItemId });
    if (name === 'begin_overall_synthesis') {
      executionModel = value.task?.executionModel;
      taskDeadline = value.task?.deadline;
    }
    return value;
  };
  // A transient failure before commit keeps the exact Host attempt claim
  // recoverable. The Host owns its bounded lease/deadline and terminal status.
  let result;
  try { result = await runOverallSynthesis({
      ...binding,
      successorReviewTurnRef: pointer.reviewTurnRef,
      successorWorkRevisionRef: pointer.workRevisionRef,
      callTool,
      synthesizeOverall: (modelInput, hooks = {}) => dependencies.invokeInitialModel(
        { operation: 'SYNTHESIZE_OVERALL', modelInput },
        { executionModel, taskDeadline, assessmentCheckpoint: checkpoint,
          sessionDiscriminator: pointer.reviewTurnRef,
          heartbeat: hooks.heartbeat, timeoutMs: hooks.timeoutMs,
          readAssessmentSources: hooks.readAssessmentSources,
          queryAssessmentKnowledge: hooks.queryAssessmentKnowledge,
          saveAssessmentWork: hooks.saveAssessmentWork,
          readAssessmentWork: hooks.readAssessmentWork,
          assessmentBinding: hooks.assessmentBinding,
          observeModelOutput: (shape, round = 1) => checkpoint.writeOnceOrEqual(
            `model.output-shape${round === 1 ? '' : '-' + round}`, shape),
          observeCandidateRejection },
      ),
  }); }
  catch (error) {
    // The exact idempotent attempt may have finished after our last response
    // was lost. Host authorization still checks the turn and saved revision.
    if (error?.hostToolName !== 'begin_overall_synthesis' ||
        error.hostErrorCode !== 'ACTION_ATTEMPT_ALREADY_SUCCEEDED' || !await current()) throw error;
    const recovered = { status: 'SUCCESSOR_OVERALL_SAVED', ...binding, recoveredByReadback: true };
    await checkpoint.writeOnce('run-result', recovered);
    return recovered;
  }
  if ((!result.ok && result.outcome !== 'COMMITTING_REPLAYED') || !await current())
    throw new Error('HOSTED_SUCCESSOR_OVERALL_RESULT_NOT_CURRENT');
  const report = { status: 'SUCCESSOR_OVERALL_SAVED', ...binding,
    recoveredByReadback: result.outcome === 'COMMIT_RESPONSE_LOSS_RECOVERED_READ_ONLY' };
  await checkpoint.writeOnce('run-result', report);
  return report;
}

export async function runHostedInitialStage(options, dependencies) {
  const { operation, initial } = options;
  assertJobAidRunLimits(options, operation);
  if (!INITIAL_ANALYSIS_OPERATIONS.includes(operation)) throw new Error('INITIAL_OPERATION_INVALID');
  const continuationRequestId = Object.hasOwn(options, 'autoRetryRequestId')
    ? optionalInitialStageRequest(options, 'autoRetryRequestId')
    : optionalInitialStageRequest(initial.stages[STAGE_BY_OPERATION[operation]]);
  if (options.explicitStageRequest &&
      (options.explicitStageRequest.operation !== operation ||
        options.explicitStageRequest.requestId !== continuationRequestId ||
        !await unusedInitialStageCheckpoint(options, options.explicitStageRequest)))
    throw new Error('AUTO_WORK_ITEM_EXPLICIT_CHECKPOINT_CHANGED');
  const initialWorkItemRevision=operation === 'EXTRACT_APPLICABILITY'
    ? (options.assessmentRecovery?.initialWorkItemRevision ?? initial.workItemRevision) : undefined;
  const checkpoint = await createCheckpointStore(initialStageCheckpointPath(
    {...options,initialWorkItemRevision}, operation, continuationRequestId));
  if (operation === 'EXTRACT_APPLICABILITY' && !options.assessmentRecovery) {
    const pointer=await createCheckpointStore(initialApplicabilityCheckpointPointerPath(options));
    await pointer.write('active',{workItemRevision:initialWorkItemRevision,requestId:continuationRequestId ?? null});
  }
  const binding = await readCheckpointCandidate(checkpoint, 'binding', value => {
    if (!isRecord(value) || value.workItemId !== options.workItemId ||
        value.documentVersionId !== initial.documentVersionId || value.operation !== operation ||
        !Object.hasOwn(value, 'requestId') ||
        (value.requestId !== null && (typeof value.requestId !== 'string' ||
          !/^[A-Za-z0-9_-]{1,64}$/u.test(value.requestId))))
      throw new Error('INITIAL_CHECKPOINT_REQUEST_INVALID');
    return value;
  });
  const exactBinding = {
    workItemId: options.workItemId, documentVersionId: initial.documentVersionId, operation,
  };
  if (binding && Object.entries(exactBinding).some(([key, value]) => binding[key] !== value)) {
    throw new Error('INITIAL_CHECKPOINT_BINDING_MISMATCH');
  }
  if (binding && continuationRequestId && binding.requestId !== continuationRequestId)
    throw new Error('INITIAL_CHECKPOINT_REQUEST_MISMATCH');
  const preparedBudget = (await readExplicitJobAidBudgets(options))
    .find(item => item.state.selection.operation === operation);
  const budgetSelection = ['EVALUATE_JOBAID', 'SYNTHESIZE_OVERALL'].includes(operation)
    ? { ...exactBinding, requestId: continuationRequestId ?? null } : undefined;
  const requestScopedBudget = preparedBudget && continuationRequestId &&
    preparedBudget.state.selection.requestId !== continuationRequestId;
  if (requestScopedBudget) {
    if (options.explicitStageRequest === undefined) throw new Error('JOBAID_RUN_LIMIT_SELECTION_CHANGED');
    assertExplicitProblemContinuationRequest(options, initial, operation);
    if (preparedBudget.state.selection.requestId !== null ||
        preparedBudget.state.selection.documentVersionId !== initial.documentVersionId ||
        (await checkpoint.readOptional('jobaid-run-budget'))?.explicitOnly !== true)
      throw new Error('JOBAID_CONTINUATION_BUDGET_REQUIRED');
  }
  const budgetCheckpoint = requestScopedBudget ? checkpoint : preparedBudget?.checkpoint ?? (options.jobAidRunLimits
    ? await createCheckpointStore(initialStageCheckpointPath(options, operation)) : checkpoint);
  const jobAidBudget = await createJobAidRunBudget(budgetCheckpoint, options.jobAidRunLimits,
    Boolean(binding), budgetSelection);
  const runBinding = binding ?? { ...exactBinding, requestId: continuationRequestId ??
    (operation === 'EXTRACT_APPLICABILITY' ? randomUUID() : null) };
  if (!binding) await checkpoint.writeOnce('binding', runBinding);
  // A completed initial stage is not an instruction to rerun it if Host state drifts.
  const priorRun = await readCheckpointCandidate(checkpoint, 'run-result');
  if (priorRun && !(options.assessmentRecovery && priorRun.attemptStatus === 'UNKNOWN') &&
      !(options.assessmentRecovery?.status === 'RECOVERY_COMMITTING' &&
    priorRun.status === 'REQUIRES_ATTENTION' && priorRun.operation === operation &&
    priorRun.stageStatus === 'BUSY'))
    throw new Error('INITIAL_COMPLETED_STAGE_HOST_DRIFT');
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
    if (options.queueCommitRecovery && !['get_parse_status', 'get_action_attempt_status',
      INITIAL_ASSESSMENT_OPERATIONS[operation].begin, INITIAL_ASSESSMENT_OPERATIONS[operation].commit].includes(name))
      throw new Error('AUTO_WORK_ITEM_COMMITTING_RECOVERY_TOOL_REJECTED');
    if (options.queueCommitRecovery && name.startsWith('commit_') &&
        (args.attemptRef !== options.queueCommitRecovery.attemptRef ||
         args.result?.contentHash !== options.queueCommitRecovery.resultContentHash))
      throw new Error('AUTO_WORK_ITEM_COMMITTING_RECOVERY_CHANGED');
    const scopedArgs = (['EVALUATE_JOBAID', 'SYNTHESIZE_OVERALL'].includes(operation) ||
      (operation === 'EXTRACT_APPLICABILITY' && name !== 'begin_applicability_evaluation'))
      ? { ...args, workItemId: options.workItemId } : args;
    const count = (callCounts.get(name) ?? 0) + 1;
    callCounts.set(name, count);
    if (!jobAidBudget && name.startsWith('commit_') && args.phase !== 'UPLOAD_PART') finalCommitStarted = true;
    const freshAssessmentCall = problemAssessment && !name.startsWith('commit_');
    const recoveryBegin = options.assessmentRecovery?.status === 'RECOVERY_BEGIN';
    const sealedCommitReplay = options.assessmentRecovery?.status === 'RECOVERY_COMMITTING' &&
      name === INITIAL_ASSESSMENT_OPERATIONS[operation].commit;
    const sealedStatusRead = options.assessmentRecovery?.status === 'RECOVERY_COMMITTING' &&
      name === 'get_action_attempt_status';
    const exactApplicabilityBeginReplay = operation === 'EXTRACT_APPLICABILITY' &&
      name === 'begin_applicability_evaluation' &&
      (recoveryBegin ||
        (['REQUIRED', 'WAITING_INPUT'].includes(initial.status) &&
          initial.nextOperation === 'EXTRACT_APPLICABILITY' &&
          initial.stages.applicability?.status === 'PENDING')) &&
      await checkpoint.readOptional('begin_applicability_evaluation-1.started') &&
      !await checkpoint.readOptional('begin_applicability_evaluation-1.result') &&
      !await checkpoint.readOptional('model.started') &&
      !await checkpoint.readOptional('commit_applicability_candidate-1.started');
    const dispatch = async () => {
      const perform = () => {
        if (name.startsWith('commit_') && args.phase !== 'UPLOAD_PART') finalCommitStarted = true;
        return dependencies.callTool(name, scopedArgs);
      };
      const kind = name === 'save_assessment_work' ? 'saves'
        : ['commit_dynamic_evaluation_candidate', 'commit_overall_candidate'].includes(name) ? 'finishes' : null;
      return jobAidBudget && kind ? jobAidBudget.dispatch(kind, perform, args) : perform();
    };
    const value = freshAssessmentCall || sealedCommitReplay || sealedStatusRead ||
      (options.assessmentRecovery && name.startsWith('begin_') && !recoveryBegin)
      ? await dispatch() : await checkpoint.remoteStep({
      // Keep c114 checkpoint identity stable for an already-started JobAid run.
      // The exact WorkItem is also frozen in the enclosing checkpoint binding.
      step: `${name}-${count}`, args,
      ambiguousCommit: name.startsWith('commit_'),
      allowExactReplay: exactApplicabilityBeginReplay,
      perform: dispatch,
    });
    if (requestScopedBudget && name.startsWith('begin_')) {
      const expected = options.explicitStageRequest;
      const task = value.task;
      const key = operation === 'EVALUATE_JOBAID' ? 'dynamic' : 'overall';
      if (name !== INITIAL_ASSESSMENT_OPERATIONS[operation].begin || value.status !== 'RUNNING' ||
          value.attemptRef !== expected.attemptRef || task?.operationRef !== expected.attemptRef ||
          task.workItemId !== expected.workItemId || task.documentVersionId !== expected.documentVersionId ||
          task.inputRevision !== expected.workItemRevision || task.baseRevision !== expected.workItemRevision ||
          task.idempotencyKey !== `openclaw-v2:${key}:${expected.workItemId}:${expected.documentVersionId}:${expected.requestId}`)
        throw new Error('AUTO_WORK_ITEM_EXPLICIT_STAGE_CHANGED');
    }
    await jobAidBudget?.reconcile(name, value);
    if (name.startsWith('begin_') && options.assessmentRecovery?.status === 'RECOVERY_COMMITTING')
      assertCommittingInitialClaim(options.assessmentRecovery.previousClaim ??
        { attemptRef: options.assessmentRecovery.attemptRef }, value);
    if (name.startsWith('begin_') && options.queueCommitRecovery) {
      validateResultEnvelope(value.task, value.recoveryResult, { allowHistoricalSkillVersion: true });
      if (value.task.workItemId !== options.workItemId || value.task.documentVersionId !== initial.documentVersionId ||
          value.task.inputRevision !== initial.workItemRevision ||
          value.recoveryResult.contentHash !== options.queueCommitRecovery.resultContentHash)
        throw new Error('AUTO_WORK_ITEM_COMMITTING_RECOVERY_CHANGED');
    }
    if (name === 'begin_applicability_evaluation' && recoveryBegin &&
      value.attemptRef !== options.assessmentRecovery.previousAttemptRef)
      throw new Error('INITIAL_APPLICABILITY_BEGIN_ATTEMPT_MISMATCH');
    if (name.startsWith('begin_') && value.status === 'RUNNING') {
      if (options.assessmentRecovery?.status === 'RECOVERY_CANDIDATE')
        assertFreshInitialAssessmentClaim(options.assessmentRecovery.previousClaim, value);
      problemAssessment = ['wiselink.jobaid-problem-task.v2','wiselink.jobaid-problem-task.v3'].includes(value.modelInput?.schemaVersion);
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
    if (options.queueCommitRecovery) throw new Error('AUTO_WORK_ITEM_COMMITTING_RECOVERY_MODEL_REJECTED');
    const assessment = problemAssessment && ['wiselink.jobaid-problem-task.v2','wiselink.jobaid-problem-task.v3'].includes(modelInput.schemaVersion);
    if (jobAidBudget && !assessment) throw new Error('JOBAID_RUN_LIMIT_PROTOCOL_REQUIRED');
    const perform = () => {
      modelCallCount += 1;
      return dependencies.invokeInitialModel({ operation, modelInput }, {
        executionModel,
        ...(assessment ? { assessmentCheckpoint: checkpoint, taskDeadline } : {}),
        heartbeat: runtimeHooks.heartbeat,
        timeoutMs: runtimeHooks.timeoutMs,
        sessionDiscriminator: runtimeHooks.sessionDiscriminator ?? runBinding.requestId ?? startedAttempt,
        readAssessmentSources: runtimeHooks.readAssessmentSources,
        queryAssessmentKnowledge: runtimeHooks.queryAssessmentKnowledge,
        saveAssessmentWork: runtimeHooks.saveAssessmentWork,
        readAssessmentWork: runtimeHooks.readAssessmentWork,
        ...(jobAidBudget ? { runModelRequest: perform => jobAidBudget.dispatch('modelRequests', perform) } : {}),
        assessmentBinding: runtimeHooks.assessmentBinding,
        observeModelOutput: (shape, round = 1) => checkpoint.observeAuxiliary(
          `${runtimeHooks.checkpointKey ?? 'model'}.output-shape${round === 1 ? '' : '-' + round}`, shape,
        ),
        observeTranslationFidelity: (report, round) => checkpoint.observeAuxiliary(
          `model.translation-fidelity-${round}`, report,
        ),
        observeCandidateRejection: (report) => checkpoint.observeAuxiliary(
          `model.candidate-rejection-${Number.isSafeInteger(report.modelRound)
            ? `${report.modelRound}-${report.correctionNo}` : report.correctionNo}`, report,
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
      ...(runBinding.requestId ? { requestId: runBinding.requestId } : {}),
      ...(continuationRequestId ? { continuationRequestId } : {}),
      ...(options.configurationEvidenceReevaluation ? { configurationEvidenceReevaluation: options.configurationEvidenceReevaluation } : {}),
      providers: [], callTool,
      ...(options.assessmentRecovery?.closeOnly ? { recoverAssessmentExecution: begin =>
        finishInitialAssessmentPolicyFailure({ checkpoint, recovery: options.assessmentRecovery, begin, callTool }) } : {}),
      translate: invoke, extractApplicability: invoke,
      evaluateDynamicRules: invoke, synthesizeOverall: invoke,
      runtimeProvenance: dependencies.runtimeProvenance,
    });
    const afterResult = await dependencies.callTool('get_parse_status', { workItemId: options.workItemId });
    const after = readInitialStatus(afterResult, options.workItemId);
    if (after.documentVersionId !== initial.documentVersionId) throw new Error('INITIAL_DOCUMENT_VERSION_DRIFT');
    const stageStatus = after.stages[STAGE_BY_OPERATION[operation]]?.status;
    const stageDone = stageStatus === 'SUCCEEDED';
    const report = {
      status: stageDone ? 'INITIAL_STAGE_SAVED' : 'REQUIRES_ATTENTION',
      operation, stageStatus, nextOperation: after.nextOperation,
      ...(startedAttempt ?? options.assessmentRecovery?.previousClaim?.attemptRef ?? options.assessmentRecovery?.attemptRef
        ? { attemptRef: startedAttempt ?? options.assessmentRecovery.previousClaim?.attemptRef ?? options.assessmentRecovery.attemptRef } : {}),
      outcome: result.outcome, modelCallCount,
      ...(result.errorCode ? { errorCode: result.errorCode } : {}),
      ...(result.executionKind === 'HOST_SAVED_WORK_RECONCILIATION' && result.modelRequests === 0
        ? { executionKind: result.executionKind, modelRequests: 0 } : {}),
      provenance: result.provenance,
      workItemRevision: after.workItemRevision,
      candidateOnly: true,
      ...(jobAidBudget ? { jobAidRunBudget: jobAidBudget.snapshot() } : {}),
    };
    // An uncertain result is retained as attention, never converted into a retry.
    if (options.assessmentRecovery?.status === 'RECOVERY_COMMITTING')
      await checkpoint.writeAuxiliary('committing-recovery-result', report);
    else if (options.assessmentRecovery && priorRun)
      await checkpoint.writeAuxiliary('assessment-recovery-result', report);
    else await checkpoint.writeAuxiliary('run-result', report);
    return checkpoint.diagnostics.length
      ? { ...report, localCheckpointWarnings: [...checkpoint.diagnostics] } : report;
  } catch (error) {
    if (error?.message === 'INITIAL_ASSESSMENT_STILL_OWNED')
      return { status: 'BUSY', operation, nextOperation: null, modelCallCount, candidateOnly: true };
    if (startedAttempt && (!finalCommitStarted || jobAidBudget)) {
      // Unknown provider/transport state is not user cancellation. Only the
      // orchestrator's validated failed ResultEnvelope may finish a known failure.
      const gatewayTransportFailure = hostedGatewayTransportFailureDiagnostic(error);
      const report = { status: 'REQUIRES_ATTENTION', operation, attemptRef: startedAttempt,
        attemptStatus: 'UNKNOWN', errorCode: errorCode(error), modelCallCount, candidateOnly: true,
        ...(jobAidBudget ? { jobAidRunBudget: jobAidBudget.snapshot() } : {}),
        ...(gatewayTransportFailure ? { gatewayTransportFailure } : {}) };
      await checkpoint.writeAuxiliary('run-result', report);
      return checkpoint.diagnostics.length
        ? { ...report, localCheckpointWarnings: [...checkpoint.diagnostics] } : report;
    }
    throw error;
  }
}

function readInitialStatus(value, workItemId) {
  const status = value?.initialAnalysis;
  if (value?.entry?.workItemId !== workItemId || !status || status.candidateOnly !== true ||
    (status.workItemId !== undefined && status.workItemId !== workItemId) ||
    typeof status.documentVersionId !== 'string' || !status.documentVersionId ||
    !Number.isSafeInteger(status.workItemRevision) || !status.stages ||
    !['NOT_READY', 'REQUIRED', 'BUSY', 'WAITING_INPUT', 'FAILED', 'CONFLICT', 'SUCCEEDED'].includes(status.status) ||
    (status.nextOperation !== null && !INITIAL_ANALYSIS_OPERATIONS.includes(status.nextOperation))) {
    throw new Error('HOST_INITIAL_STATUS_UNAVAILABLE');
  }
  for (const stage of Object.values(STAGE_BY_OPERATION)) {
    optionalInitialStageRequest(status.stages[stage]);
    if (!['PENDING', 'BUSY', 'SUCCEEDED', 'WAITING_INPUT', 'FAILED', 'CONFLICT'].includes(status.stages[stage]?.status)) {
      throw new Error('HOST_INITIAL_STATUS_INVALID');
    }
  }
  return { ...status, workItemId };
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
      HOST_ERROR_TOOLS.has(error.hostToolName)) {
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

const JOBAID_RUN_LIMIT_FLAGS = {
  modelRequests: '--jobaid-max-model-requests',
  saves: '--jobaid-max-saves',
  finishes: '--jobaid-max-finishes',
};

function assertJobAidRunLimits(options, operation) {
  const limits = options.jobAidRunLimits;
  if (limits === undefined) return;
  const keys = Object.keys(JOBAID_RUN_LIMIT_FLAGS);
  if (!isRecord(limits) || Object.keys(limits).length !== keys.length ||
      keys.some(key => !Number.isSafeInteger(limits[key]) || limits[key] < 1))
    throw new Error('JOBAID_RUN_LIMIT_INVALID');
  if (!options.workItemId || options.matterId || options.documentVersionId ||
      options.initialStageOnly !== true || options.maxInitialStages !== 1 ||
      !['EVALUATE_JOBAID', 'SYNTHESIZE_OVERALL'].includes(options.expectedInitialOperation) ||
      (operation !== undefined && operation !== options.expectedInitialOperation) ||
      options.autoRetry || options.repairingRecovery || options.repairStoppedClaim || options.queueCommitRecovery)
    throw new Error('JOBAID_RUN_LIMIT_SCOPE_INVALID');
}

/** Opt-in limits apply only to one explicitly selected problem-assessment stage. */
export function jobAidRunLimitOptions(argv, options) {
  const flags = Object.values(JOBAID_RUN_LIMIT_FLAGS);
  if (argv.some(arg => arg.startsWith('--jobaid-') && !flags.includes(arg)))
    throw new Error('JOBAID_RUN_LIMIT_INVALID');
  const present = flags.some(flag => argv.some(arg => arg === flag || arg.startsWith(`${flag}=`)));
  if (!present) return {};
  const limits = {};
  for (const [key, flag] of Object.entries(JOBAID_RUN_LIMIT_FLAGS)) {
    const value = option(argv, flag);
    if (argv.filter(arg => arg === flag).length !== 1 ||
        argv.some(arg => arg.startsWith(`${flag}=`)) || !/^[1-9]\d*$/u.test(value ?? ''))
      throw new Error('JOBAID_RUN_LIMIT_INVALID');
    limits[key] = Number(value);
  }
  assertJobAidRunLimits({ ...options, jobAidRunLimits: limits });
  return { jobAidRunLimits: limits };
}

/** Reuse the stage checkpoint: reserved calls survive a restart and cannot gain
 * more quota by changing/removing options. A lost outcome permits reads only.
 * Reservations are conservative if a process stops before dispatch; they are
 * never a claim about Gateway-internal provider dispatches.
 */
async function createJobAidRunBudget(checkpoint, limits, hasBinding, selection) {
  const step = 'jobaid-run-budget';
  let state = await checkpoint.readOptional(step);
  if (!limits && !state) return null;
  if (!limits) throw new Error('JOBAID_RUN_LIMIT_REQUIRED');
  limits = { ...limits };
  if (!state) {
    if (hasBinding) throw new Error('JOBAID_RUN_LIMIT_LEGACY_CHECKPOINT');
    state = { limits, counts: { modelRequests: 0, saves: 0, finishes: 0 }, active: null,
      ...(selection ? { explicitOnly: true, selection } : {}) };
    await checkpoint.writeOnce(step, state);
  } else if (!isDeepStrictEqual(state.limits, limits) ||
      Object.keys(limits).some(key => !Number.isSafeInteger(state.counts?.[key]) ||
        state.counts[key] < 0 || state.counts[key] > limits[key]) ||
      (state.active !== null && !Object.hasOwn(limits, state.active?.kind))) {
    throw new Error('JOBAID_RUN_LIMIT_CHECKPOINT_CHANGED');
  }
  if (selection && !isDeepStrictEqual(state.selection, selection))
    throw new Error('JOBAID_RUN_LIMIT_SELECTION_CHANGED');
  const complete = async () => {
    state = { ...state, active: null };
    await checkpoint.write(step, state);
  };
  return {
    snapshot: () => ({ limits: { ...state.limits }, dispatchReservations: { ...state.counts },
      pendingOutcome: state.active?.kind ?? null, upstreamDispatchCount: null }),
    dispatch: async (kind, perform, args = {}) => {
      if (state.active) throw new Error('JOBAID_RUN_OUTCOME_UNKNOWN');
      if (state.counts[kind] >= limits[kind]) {
        const label = kind === 'modelRequests' ? 'MODEL_HTTP' : kind === 'saves' ? 'SAVE' : 'FINISH';
        throw new Error(`JOBAID_${label}_BUDGET_EXHAUSTED`);
      }
      // Exclusive existing checkpoint writes also stop competing consumers
      // from reserving the same ordinal before either dispatches.
      await checkpoint.writeOnce(`${step}-${kind}-${state.counts[kind] + 1}`, {
        kind, ordinal: state.counts[kind] + 1,
      });
      state = { ...state, counts: { ...state.counts, [kind]: state.counts[kind] + 1 },
        active: { kind, ...(kind === 'saves' ? { requestId: args.requestId } : {}),
          ...(kind === 'finishes' ? { attemptRef: args.attemptRef, contentHash: args.result?.contentHash } : {}) } };
      await checkpoint.write(step, state);
      let value;
      try { value = await perform(); }
      catch (error) {
        // Host materializes requirementHandling before work.save. This exact
        // received validation rejection is a known non-write, still charged
        // against the SAVE cap. Other Host errors may follow a committed write.
        if (kind === 'saves' && error?.receivedHostToolError === true &&
            error.hostToolName === 'save_assessment_work' &&
            error.hostErrorCode === 'JOBAID_REQUIREMENTS_INVALID') await complete();
        throw error;
      }
      await complete();
      return value;
    },
    reconcile: async (name, value) => {
      const active = state.active;
      if ((name === 'read_assessment_work' && active?.kind === 'saves' &&
          typeof active.requestId === 'string' && value?.revision?.requestId === active.requestId) ||
          (name === 'get_action_attempt_status' && active?.kind === 'finishes' &&
          typeof active.contentHash === 'string' && value?.attemptRef === active.attemptRef &&
          value?.resultContentHash === active.contentHash && ['SUCCEEDED', 'WAITING_INPUT', 'FAILED'].includes(value?.status)))
        await complete();
    },
  };
}

/** Prepare only the two existing stage budgets before a controlled initial run.
 * The selection is WI/operation scoped: a later request suffix is not new quota.
 * This writes local control metadata only and never claims or calls Host.
 */
export async function prepareExplicitJobAidRunBudgets(options) {
  assertSingleConsumerSubject({ workItemId: options.workItemId, matterId: options.matterId });
  if (!isAbsolute(options.checkpointRoot ?? '') ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/u.test(options.documentVersionId ?? '') ||
      options.matterId)
    throw new Error('JOBAID_RUN_LIMIT_SELECTION_INVALID');
  const stages = [['EVALUATE_JOBAID', options.jobAidRunLimits],
    ['SYNTHESIZE_OVERALL', options.overallRunLimits]];
  for (const [operation, limits] of stages) {
    assertJobAidRunLimits({ ...options, documentVersionId: undefined, initialStageOnly: true,
      maxInitialStages: 1, expectedInitialOperation: operation, jobAidRunLimits: limits });
    if (!limits) throw new Error('JOBAID_RUN_LIMIT_INVALID');
  }
  const prepared = [];
  for (const [operation, limits] of stages) {
    const checkpoint = await createCheckpointStore(initialStageCheckpointPath(options, operation));
    const selection = { workItemId: options.workItemId, documentVersionId: options.documentVersionId,
      operation, requestId: null };
    const budget = await createJobAidRunBudget(checkpoint, limits,
      (await checkpoint.readOptional('binding')) !== null, selection);
    prepared.push({ operation, ...budget.snapshot() });
  }
  return { workItemId: options.workItemId, documentVersionId: options.documentVersionId, prepared };
}

function problemContinuationBudgetSelection(binding) {
  return { workItemId: binding.workItemId, documentVersionId: binding.documentVersionId,
    operation: binding.operation, requestId: binding.requestId };
}

function assertExplicitProblemContinuationRequest(options, initial, operation) {
  assertExplicitInitialStageRequest(options, initial);
  const binding = options.explicitStageRequest;
  if (!binding || binding.operation !== operation || !['EVALUATE_JOBAID', 'SYNTHESIZE_OVERALL'].includes(operation) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(binding.requestId ?? ''))
    throw new Error('AUTO_WORK_ITEM_EXPLICIT_STAGE_CHANGED');
  return binding;
}

/** Opt-in control preparation for one normal Host continuation. Its limits
 * are supplied by the reviewed run configuration, not a product-wide ledger.
 * The previous stage budget and its UNKNOWN outcome remain untouched. */
export async function prepareExplicitJobAidContinuationBudget(options, dependencies) {
  assertSingleConsumerSubject(options);
  assertJobAidRunLimits(options, options.expectedInitialOperation);
  if (!isAbsolute(options.checkpointRoot ?? '') || !options.jobAidRunLimits ||
      typeof dependencies?.callTool !== 'function') throw new Error('JOBAID_RUN_LIMIT_SELECTION_INVALID');
  const initial = readInitialStatus(await dependencies.callTool('get_parse_status',
    { workItemId: options.workItemId }), options.workItemId);
  assertExpectedInitialOperationStatus(options.expectedInitialOperation, initial);
  const binding = assertExplicitProblemContinuationRequest(options, initial, options.expectedInitialOperation);
  const previous = (await readExplicitJobAidBudgets(options))
    .find(item => item.state.selection.operation === binding.operation);
  if (!previous || previous.state.selection.requestId !== null ||
      previous.state.selection.documentVersionId !== binding.documentVersionId)
    throw new Error('JOBAID_CONTINUATION_ORIGINAL_BUDGET_REQUIRED');
  if (!await unusedInitialStageCheckpoint(options, binding))
    throw new Error('AUTO_WORK_ITEM_EXPLICIT_CHECKPOINT_CHANGED');
  const checkpoint = await createCheckpointStore(initialStageCheckpointPath(options, binding.operation, binding.requestId));
  const selection = problemContinuationBudgetSelection(binding);
  const budget = await createJobAidRunBudget(checkpoint, options.jobAidRunLimits, false, selection);
  return { status: 'EXPLICIT_CONTINUATION_BUDGET_PREPARED', selection,
    previousRunBudget: { limits: { ...previous.state.limits },
      dispatchReservations: { ...previous.state.counts }, pendingOutcome: previous.state.active?.kind ?? null },
    ...budget.snapshot() };
}

async function readExplicitJobAidBudgets(options) {
  if (!options.workItemId || typeof options.checkpointRoot !== 'string') return [];
  const budgets = [];
  for (const operation of ['EVALUATE_JOBAID', 'SYNTHESIZE_OVERALL']) {
    const directory = initialStageCheckpointPath(options, operation).trim();
    try { await lstat(join(directory, 'jobaid-run-budget.json')); }
    catch (error) { if (error?.code === 'ENOENT') continue; throw error; }
    const checkpoint = await createCheckpointStore(directory);
    const state = await checkpoint.readOptional('jobaid-run-budget');
    const selected = state?.selection;
    if (!isRecord(state) || state.explicitOnly !== true || !isRecord(selected) ||
        !isDeepStrictEqual(Object.keys(selected).sort(), ['documentVersionId', 'operation', 'requestId', 'workItemId']) ||
        selected.workItemId !== options.workItemId || selected.operation !== operation ||
        !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/u.test(selected.documentVersionId ?? '') ||
        (selected.requestId !== null && !/^[A-Za-z0-9_-]{1,64}$/u.test(selected.requestId ?? '')) ||
        !isRecord(state.limits) || !isRecord(state.counts) ||
        !isDeepStrictEqual(Object.keys(state.limits).sort(), ['finishes', 'modelRequests', 'saves']) ||
        !isDeepStrictEqual(Object.keys(state.counts).sort(), ['finishes', 'modelRequests', 'saves']) ||
        Object.keys(state.limits).some(key => !Number.isSafeInteger(state.limits[key]) || state.limits[key] < 1 ||
          !Number.isSafeInteger(state.counts[key]) || state.counts[key] < 0 || state.counts[key] > state.limits[key]) ||
        (state.active !== null && !Object.hasOwn(state.limits, state.active?.kind)))
      throw new Error('JOBAID_RUN_LIMIT_CHECKPOINT_CHANGED');
    budgets.push({ checkpoint, state });
  }
  if (budgets.some(item => item.state.selection.documentVersionId !== budgets[0].state.selection.documentVersionId))
    throw new Error('JOBAID_RUN_LIMIT_SELECTION_CHANGED');
  return budgets;
}

async function deferExplicitJobAidClaim(options, claim, automaticCheckpoint) {
  const [budget] = await readExplicitJobAidBudgets({ ...options, workItemId: claim.workItemId });
  if (!budget) return null;
  if (budget.state.selection.documentVersionId !== claim.documentVersionId)
    throw new Error('JOBAID_RUN_LIMIT_SELECTION_CHANGED');
  // Retain the exact real lease and all UNKNOWN/attention fields before ending
  // this local automatic consumption. This is neither Host ACK nor BLOCK.
  const receipt = `jobaid-run-budget-automatic-claim-${claim.leaseGeneration}-${randomUUID()}`;
  await budget.checkpoint.writeOnce(receipt, claim);
  if (!isDeepStrictEqual(await budget.checkpoint.readOptional(receipt), claim) ||
      !isDeepStrictEqual(await automaticCheckpoint.readOptional('active-claim'), claim))
    throw new Error('AUTO_WORK_ITEM_CLAIM_CHANGED');
  await automaticCheckpoint.write('active-claim', null);
  return { status: 'EXPLICIT_BUDGET_DEFERRED', workItemId: claim.workItemId,
    documentVersionId: claim.documentVersionId, leaseGeneration: claim.leaseGeneration,
    preservedClaimStep: receipt };
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
      !['EVALUATE_JOBAID', 'SYNTHESIZE_OVERALL', 'EXTRACT_APPLICABILITY'].includes(
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

export function automaticWorkItemQueueMode(argv) {
  const occurrences = argv.filter(arg => arg === '--auto-queue').length;
  const repairs = argv.filter(arg => arg === '--repair-stopped-claim').length;
  const repairWorkItems = argv.filter(arg => arg === '--repair-work-item-id').length;
  const repairAttempts = argv.filter(arg => arg === '--repair-attempt-ref').length;
  const recoveries = argv.filter(arg => arg === '--document-translation-recovery').length;
  const finishes = argv.filter(arg => arg === '--finish-blocked-claim').length;
  const wiki = argv.filter(arg => arg === '--wiki-idle').length;
  const parks = argv.filter(arg => arg === '--park-cancelled-claim').length;
  const cancelledFinishes = argv.filter(arg => arg === '--finish-cancelled-claim').length;
  const expectations = argv.filter(arg => arg === '--park-expectation-file').length;
  const batchFlags = argv.some(arg => arg.startsWith('--queue-'));
  const finishFields = ['--finish-work-item-id', '--finish-request-id', '--finish-document-version-id',
    '--finish-lease-generation', '--finish-blocked-at'];
  if (finishes > 1 || finishFields.some(flag => argv.filter(arg => arg === flag).length !== finishes) ||
      parks > 1 || cancelledFinishes > 1 || (cancelledFinishes && finishes !== 1) ||
      expectations !== parks + cancelledFinishes ||
      (parks && (finishes || repairs || recoveries)) ||
      (finishes && (repairs || recoveries))) throw new Error('AUTO_WORK_ITEM_QUEUE_OPTIONS_INVALID');
  if (wiki > 1 || (wiki && (repairs || finishes || parks || cancelledFinishes)))
    throw new Error('AUTO_WORK_ITEM_QUEUE_OPTIONS_INVALID');
  if (!occurrences) {
    if (wiki || batchFlags) throw new Error('AUTO_WORK_ITEM_QUEUE_OPTIONS_INVALID');
    if (repairs || repairWorkItems || repairAttempts || finishes || parks || cancelledFinishes || expectations)
      throw new Error('AUTO_WORK_ITEM_QUEUE_OPTIONS_INVALID');
    return false;
  }
  if (occurrences !== 1) throw new Error('AUTO_WORK_ITEM_QUEUE_OPTIONS_INVALID');
  if (batchFlags && (repairs || finishes || parks || cancelledFinishes))
    throw new Error('AUTO_WORK_ITEM_QUEUE_OPTIONS_INVALID');
  automaticQueueBatchOptions(argv);
  if (recoveries > 1 || (recoveries && !/^[A-Za-z0-9_-]{1,96}$/u.test(
    option(argv, '--document-translation-recovery') ?? '')))
    throw new Error('AUTO_WORK_ITEM_QUEUE_OPTIONS_INVALID');
  if (repairs > 1) throw new Error('AUTO_WORK_ITEM_QUEUE_OPTIONS_INVALID');
  if (repairWorkItems !== repairs || repairAttempts !== repairs) {
    throw new Error('AUTO_WORK_ITEM_QUEUE_OPTIONS_INVALID');
  }
  const valueOptions = new Set([
    '--checkpoint-root', '--openclaw-config',
    '--repair-work-item-id', '--repair-attempt-ref',
    '--document-translation-recovery', '--park-expectation-file', ...finishFields,
    '--wiki-timeout-ms', '--wiki-max-completion-tokens', '--wiki-max-model-requests',
    '--wiki-reasoning-effort', '--wiki-provider-timeout-seconds',
    '--queue-max-items', '--queue-tick-budget-ms',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (['--auto-queue', '--repair-stopped-claim', '--finish-blocked-claim',
      '--park-cancelled-claim', '--finish-cancelled-claim', '--wiki-idle'].includes(arg)) continue;
    if (arg.startsWith('--wiki-') && !wiki) throw new Error('AUTO_WORK_ITEM_QUEUE_OPTIONS_INVALID');
    if (!valueOptions.has(arg)) {
      throw new Error('AUTO_WORK_ITEM_QUEUE_OPTION_NOT_ALLOWED');
    }
    const value = argv[index + 1];
    if (typeof value !== 'string' || !value.trim() || value.startsWith('--')) {
      throw new Error('AUTO_WORK_ITEM_QUEUE_OPTIONS_INVALID');
    }
    index += 1;
  }
  if (repairs &&
      (!/^WI-[A-Za-z0-9_-]{1,93}$/u.test(option(argv, '--repair-work-item-id') ?? '') ||
        !/^AQ-[A-Za-z0-9-]{1,93}$/u.test(option(argv, '--repair-attempt-ref') ?? ''))) {
    throw new Error('AUTO_WORK_ITEM_QUEUE_OPTIONS_INVALID');
  }
  if (finishes && (!/^[1-9][0-9]{0,8}$/u.test(option(argv, '--finish-lease-generation') ?? '') ||
      !validBlockedClaimExpectation({ finishWorkItemId: option(argv, '--finish-work-item-id'),
        finishRequestId: option(argv, '--finish-request-id'),
        finishDocumentVersionId: option(argv, '--finish-document-version-id'),
        finishLeaseGeneration: Number(option(argv, '--finish-lease-generation')),
        finishBlockedAt: option(argv, '--finish-blocked-at') })))
    throw new Error('AUTO_WORK_ITEM_QUEUE_OPTIONS_INVALID');
  return true;
}

function assertExpectedInitialOperationMode(options) {
  if (options.expectedInitialOperation === undefined) return;
  if (!['EVALUATE_JOBAID', 'SYNTHESIZE_OVERALL', 'EXTRACT_APPLICABILITY'].includes(options.expectedInitialOperation) || !options.workItemId ||
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
  { documentVersionId, deliveryRef, activityRunRef, readingRunRef, leaseOwner },
  { callTool, documentTranslationCheckpoint, activityCheckpoint, invokeActivityModel, readingCheckpoint, invokeReadingModel, invokeTranslationModel }) {
  const startedAt = Date.now();
  if (deliveryRef && (!/^(?:work-item:WI(?:-[A-Za-z0-9_-]{1,93})?|acquisition:[A-Za-z0-9_-]{1,96})$/u.test(deliveryRef)
      || activityRunRef)) throw new Error('DOCUMENT_DELIVERY_REF_INVALID');
  const unscopedTool = callTool;
  const scopedTool = deliveryRef ? (name, args) => unscopedTool(name,
    ['document_work', 'document_reading', 'document_translation', 'read_document_original'].includes(name)
      ? { ...args, deliveryRef } : args) : callTool;
  callTool = scopedTool;
  if (activityRunRef && readingRunRef) throw new Error('DOCUMENT_CONSUMER_RUN_AMBIGUOUS');
  const consumeReading = runRef => consumeHostedDocumentReading(
    { documentVersionId, runRef, leaseOwner },
    { callTool, invokeModel: invokeReadingModel, checkpointFactory: readingCheckpoint });
  if (readingRunRef) return consumeReading(readingRunRef);
  const state = await callTool('document_work', { action: 'STATUS', documentVersionId });
  if (state?.documentVersionId !== documentVersionId) throw new Error('DOCUMENT_CONSUMER_SCOPE_MISMATCH');
  if (state.documentDelivery !== undefined && state.documentDelivery !== null &&
      (!isRecord(state.documentDelivery) ||
        typeof state.documentDelivery.reading !== 'boolean' ||
        !['NONE', 'ZH_FULL'].includes(state.documentDelivery.translation)))
    throw new Error('DOCUMENT_DELIVERY_SELECTION_INVALID');
  // An already-accepted activity run is consumed first: state.nextActivityRunRef
  // is the only discovery of a run an explicit ACTIVITY_BEGIN created, and an
  // explicit recovery ref addresses that old run directly. The consumer never
  // generates work and never sends ACTIVITY_BEGIN; a null discovery with no
  // parse run stays idle with zero model calls.
  const runRef = deliveryRef ? null : activityRunRef ?? state.nextActivityRunRef ?? null;
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
  if (run.status === 'PUBLISHED') return advancePublishedDocument(state, run, documentVersionId,
    callTool, documentTranslationCheckpoint, deliveryRef, invokeTranslationModel);

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
      return advancePublishedDocument(fresh, fresh.latestRun, documentVersionId,
        callTool, documentTranslationCheckpoint, deliveryRef, invokeTranslationModel);
    }
  }
  return { ...result, documentVersionId };
}

async function advancePublishedDocument(state, run, documentVersionId, callTool, documentTranslationCheckpoint, deliveryRef, invokeTranslationModel) {
    const indexRun = state.nextSourceProjectionRunId ?? run.parseRunId;
    if (typeof indexRun !== 'string' || !/^[A-Za-z0-9_-]{1,96}$/.test(indexRun)) throw new Error('DOCUMENT_SOURCE_PROJECTION_RUN_INVALID');
    const projectionPromise = Promise.resolve().then(() =>
      callTool('document_work', { action: 'INDEX', documentVersionId, parseRunId: indexRun }));
    if (state.documentDelivery?.translation === 'NONE') {
      const indexed = await projectionPromise;
      assertSourceProjection(indexed, documentVersionId, indexRun);
      return { status: 'DOCUMENT_READY', documentVersionId,
        parseRunId: run.parseRunId, sourceProjection: indexed,
        translation: { status: 'NOT_REQUESTED' } };
    }
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
      advanceDocumentTranslationWithRecovery(documentVersionId, run, callTool,
        documentTranslationCheckpoint, beforeStart, deliveryRef, invokeTranslationModel),
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
async function advanceDocumentTranslationWithRecovery(documentVersionId, run, callTool, checkpointFactory, beforeStart, deliveryRef, invokeTranslationModel) {
  const checkpoint = await checkpointFactory?.(run.parseRunId);
  const blocked = await checkpoint?.readOptional('admission-blocked');
  if (blocked) {
    if (blocked.documentVersionId !== documentVersionId || blocked.parseRunId !== run.parseRunId || blocked.operation !== 'START' || blocked.errorCode !== 'DOCUMENT_TRANSLATION_ADMISSION_DENIED')
      throw new Error('DOCUMENT_TRANSLATION_CHECKPOINT_INVALID');
    return { status: 'REQUIRES_ATTENTION', documentVersionId, parseRunId: run.parseRunId,
      translation: blocked };
  }
  try {
    const observeModelOutput = checkpoint ? ({ attemptRef, generationRequestRef, shape, round }) => {
      if (![1, 2].includes(round) || shape?.operation !== 'TRANSLATE' ||
          shape.generationRequestRef !== generationRequestRef)
        throw new Error('DOCUMENT_TRANSLATION_MODEL_OBSERVATION_INVALID');
      const key = createHash('sha256').update(JSON.stringify([
        attemptRef, generationRequestRef, round])).digest('hex').slice(0, 32);
      // The adapter supplies only bounded output shape and error codes. Never
      // checkpoint response prose, function arguments or gateway credentials.
      return checkpoint.writeOnce(`model.output-shape-${key}`, shape);
    } : undefined;
    return await advanceDocumentTranslation(documentVersionId, run, callTool, beforeStart,
      deliveryRef, invokeTranslationModel, observeModelOutput);
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

async function advanceDocumentTranslation(documentVersionId, run, callTool, beforeStart,
  deliveryRef, invokeTranslationModel, observeModelOutput) {
    const binding = { documentVersionId, parseRunId: run.parseRunId };
    const translation = await callTool('document_translation', { action: 'STATUS', ...binding });
    if (translation?.documentVersionId !== documentVersionId) throw new Error('DOCUMENT_TRANSLATION_SCOPE_MISMATCH');
    if (translation.status === 'IDLE') {
      if (translation.semanticReady === true && translation.parseRunId !== run.parseRunId)
        throw new Error('DOCUMENT_TRANSLATION_RUN_MISMATCH');
      if (translation.semanticReady !== true && !await beforeStart()) return { status: 'REQUIRES_ATTENTION', ...binding,
        semanticPreparation: { status: 'FAILED', errorCode: 'DOCUMENT_SEMANTIC_NOT_READY' } };
      const requestId = deliveryRef ? `auto-translation-${createHash('sha256').update(deliveryRef).digest('hex').slice(0, 32)}`
        : `translation-${run.parseRunId}`;
      const started = await callTool('document_translation', { action: 'START', ...binding, requestId });
      if (started?.documentVersionId !== documentVersionId || started.parseRunId !== run.parseRunId || !started.attemptRef)
        throw new Error('DOCUMENT_TRANSLATION_START_MISMATCH');
      return started;
    }
    if (translation.parseRunId !== run.parseRunId || !translation.attemptRef) throw new Error('DOCUMENT_TRANSLATION_RUN_MISMATCH');
    if (translation.status === 'FAILED' && translation.errorCode === 'DOCUMENT_PLUGIN_QUOTA_EXHAUSTED' && deliveryRef) {
      const requestId = `auto-translation-${createHash('sha256').update(deliveryRef).digest('hex').slice(0, 32)}:hosted-m3`;
      return callTool('document_translation', { action: 'RECOVER', ...binding,
        attemptRef: translation.attemptRef, requestId });
    }
    if (translation.status === 'FAILED' &&
        translation.errorCode === 'DOCUMENT_TRANSLATION_DEADLINE_EXPIRED' &&
        translation.expiredRecoveryAvailable === true && deliveryRef) {
      try {
        const resumed = await callTool('document_translation', { action: 'RECOVER_EXPIRED',
          ...binding, attemptRef: translation.attemptRef });
        if (resumed?.documentVersionId !== documentVersionId ||
            resumed.parseRunId !== run.parseRunId || !resumed.attemptRef ||
            resumed.attemptRef === translation.attemptRef)
          throw new Error('DOCUMENT_TRANSLATION_EXPIRED_SUCCESSOR_MISMATCH');
        return resumed;
      } catch (error) {
        if (!error?.hostErrorCode?.startsWith('DOCUMENT_TRANSLATION_EXPIRED_') &&
            !['DOCUMENT_TRANSLATION_RECOVERY_SOURCE_CHANGED',
              'DOCUMENT_TRANSLATION_RECOVERY_PLAN_CHANGED'].includes(error?.hostErrorCode)) throw error;
        return { ...translation, status: 'REQUIRES_ATTENTION',
          recoveryErrorCode: error.hostErrorCode };
      }
    }
    if (translation.errorCode || ['FAILED','CANCELLED'].includes(translation.status))
      return { ...translation, status: 'REQUIRES_ATTENTION' };
    if (translation.status === 'SUCCEEDED') {
      if (deliveryRef && translation.progress?.completeness === 'PARTIAL' &&
          translation.partialRepairAvailable === true) {
        const continued = await callTool('document_translation', { action: 'CONTINUE_PARTIAL', ...binding,
          attemptRef: translation.attemptRef });
        if (continued?.documentVersionId !== documentVersionId || continued.parseRunId !== run.parseRunId ||
            !continued.attemptRef || continued.attemptRef === translation.attemptRef)
          throw new Error('DOCUMENT_TRANSLATION_PARTIAL_SUCCESSOR_MISMATCH');
        return continued;
      }
      return { ...translation,
        status: translation.progress?.completeness && translation.progress.completeness !== 'COMPLETE'
          ? 'DOCUMENT_READY_WITH_LIMITATIONS' : 'DOCUMENT_READY' };
    }
    if (!['QUEUED','RUNNING','RETRY_SCHEDULED'].includes(translation.status)) throw new Error('DOCUMENT_TRANSLATION_STATUS_INVALID');
    const result = await runDocumentSemanticTranslationStep(translation, { callTool,
      translate: invokeTranslationModel, observeModelOutput });
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

export function matterPreflightMode(argv, matterId) {
  if (argv.some(arg => arg.startsWith('--matter-preflight-only=') ||
      arg.startsWith('--matter-expected-snapshot=')))
    throw new Error('MATTER_PREFLIGHT_OPTION_INVALID');
  const matterPreflightOnly = argv.includes('--matter-preflight-only');
  const hasExpectedSnapshot = argv.includes('--matter-expected-snapshot');
  if ((matterPreflightOnly || hasExpectedSnapshot) && !matterId)
    throw new Error('MATTER_PREFLIGHT_TARGET_REQUIRED');
  if (matterPreflightOnly && hasExpectedSnapshot)
    throw new Error('MATTER_PREFLIGHT_MODE_AMBIGUOUS');
  const matterExpectedSnapshot = option(argv, '--matter-expected-snapshot');
  if (argv.filter(arg => arg === '--matter-preflight-only').length > 1 ||
      argv.filter(arg => arg === '--matter-expected-snapshot').length > 1 ||
      (hasExpectedSnapshot && !/^[a-f0-9]{64}$/u.test(matterExpectedSnapshot ?? '')))
    throw new Error('MATTER_PREFLIGHT_SNAPSHOT_INVALID');
  return { matterPreflightOnly, matterExpectedSnapshot };
}

async function main(argv, env) {
  if (argv.includes('--help')) {
    process.stdout.write('Usage: node consume-hosted-work-item.mjs [--auto-queue [--park-cancelled-claim --park-expectation-file ABSOLUTE_0600_JSON] [--document-translation-recovery ID] [--repair-stopped-claim --repair-work-item-id WI-... --repair-attempt-ref AQ-...] [--finish-blocked-claim --finish-work-item-id WI-... --finish-request-id REQ-... --finish-document-version-id DV --finish-lease-generation N --finish-blocked-at UTC [--finish-cancelled-claim --park-expectation-file ABSOLUTE_0600_JSON]]] [--work-item-id WI-...] [--matter-id MAT-...] [--document-version-id DV] [--matter-preflight-only | --matter-expected-snapshot SHA256] [--max-initial-stages 1] [--expected-initial-operation EVALUATE_JOBAID|SYNTHESIZE_OVERALL] [--applicability-context-ref REF] [--checkpoint-root PATH] [--openclaw-config PATH] [--native-session-store PATH] [--activity-run-ref ID] [--reading-run-ref ID] [--lease-owner ID]\nOne native job per authorized subject. Choose exactly one WorkItem, Matter or DocumentVersion; independent jobs use native cron concurrency. --auto-queue is one native cron tick for the Host-enrolled automatic WorkItem queue; it accepts no static subject or stage-specific options. After Host admission repair, one document translation recovery ID may be added to the existing cron so the next natural tick checks Host again without clearing the old checkpoint. --repair-stopped-claim with both exact identity flags permits one operator-triggered successor only for a stopped claim with a failed no-work JobAid/Overall auto-retry after a bounded gateway change; it is never a cron option. --finish-blocked-claim is an operator-only exact existing BLOCK replay finalization; it archives the original claim/receipt under the endpoint owner lock, never ACKs a failure, and leaves new dispatch to the next natural tick. It requires Linux util-linux flock; competing owners and unsupported locking fail closed. --park-cancelled-claim is a separate operator-only, single BLOCK POST for the exact latest cancelled JobAid; it always retains the stopped claim and provider UNKNOWN. Only --finish-cancelled-claim with an exact private expectation file extends finalization to an existing cancellation BLOCK replay; it cannot create a fresh BLOCK or retry an unknown POST. Both require the compatible Host and a normal Skill/MCP installation, and are never cron options. --matter-preflight-only reads current Matter work without dispatch; --matter-expected-snapshot checks that read again before dispatch and stops on a changed snapshot. --max-initial-stages 1 is WorkItem-only and consumes at most the current initial stage, without Review or original-impact work. --expected-initial-operation requires that limit and refuses any entry stage other than the named JobAid or Overall stage.\n');
    process.stdout.write('Wiki idle consumption: add --wiki-idle --wiki-timeout-ms N --wiki-max-completion-tokens N --wiki-max-model-requests N to --auto-queue, with --openclaw-config PATH; optionally --wiki-reasoning-effort low|high|max and --wiki-provider-timeout-seconds N. Uses the existing Hosted GLM5.3 profile, endpoint owner lock and capacity. An unresolved active-wiki checkpoint resumes before new user work; provider UNKNOWN or durable Host COMMITTING keeps it pinned. Platform backstop reserves the same Host queue. Install compatible Host/MCP/schema before enabling these flags.\n');
    process.stdout.write('Explicit problem-assessment run limits: with --work-item-id WI-... --max-initial-stages 1 --expected-initial-operation EVALUATE_JOBAID|SYNTHESIZE_OVERALL, optionally supply all three --jobaid-max-model-requests N --jobaid-max-saves N --jobaid-max-finishes N (positive integers). These cap local Hosted Gateway HTTP attempts, actual save_assessment_work calls and the selected stage commit calls. FINISH with workJson consumes a SAVE too. Each stage retains its own limits and dispatch reservations in its existing checkpoint; a lost outcome or exhausted budget stops without retry, forced save/finish, or advancing to another stage. They do not bound Gateway-internal provider dispatches. Without these flags normal behavior is unchanged.\n');
    process.stdout.write('Controlled queue runs may prepare both existing stage budgets with prepareExplicitJobAidRunBudgets before claiming the exact WI. The budgets bind WI/operation and original request, so another request suffix cannot reset them. Natural automatic consumption retains a protected WI claim in that stage checkpoint and defers it without Host ACK/BLOCK; other queue items may continue. Host NEXT may still claim it again after lease expiry and perform its normal grant/attempt/takeover writes before this local guard sees it. This is not permanent preclaim exclusion.\n');
    process.stdout.write('Automatic queue: --queue-max-items 1..16 (default 4), --queue-tick-budget-ms 1000..900000 (default 900000). Subjects run sequentially under the same endpoint lock; the time budget is checked between subjects and never aborts a running request. With --wiki-idle, completed ordinary work and Wiki alternate at free subject boundaries; empty Wiki probes yield in the same tick. Operator recovery remains one operation.\n');
    return;
  }
  const autoQueue = automaticWorkItemQueueMode(argv);
  const wikiIdle = argv.includes('--wiki-idle');
  const wikiBudget = wikiIdle ? validateSummaryRunBudget({ timeoutMs: Number(option(argv, '--wiki-timeout-ms')),
    maxCompletionTokens: Number(option(argv, '--wiki-max-completion-tokens')),
    maxModelRequests: Number(option(argv, '--wiki-max-model-requests')),
    reasoningEffort: option(argv, '--wiki-reasoning-effort') ?? 'low',
    ...(option(argv, '--wiki-provider-timeout-seconds') ? {
      providerTimeoutSeconds: Number(option(argv, '--wiki-provider-timeout-seconds')) } : {}) }) : undefined;
  if (wikiIdle && !option(argv, '--openclaw-config')) throw new Error('WIKI_CONFIG_PATH_REQUIRED');
  const repairStoppedClaim = argv.includes('--repair-stopped-claim');
  const repairWorkItemId = repairStoppedClaim ? option(argv, '--repair-work-item-id') : undefined;
  const repairAttemptRef = repairStoppedClaim ? option(argv, '--repair-attempt-ref') : undefined;
  const workItemId = option(argv, '--work-item-id');
  const matterId = option(argv, '--matter-id');
  const documentVersionId = option(argv, '--document-version-id');
  if (autoQueue) {
    if (workItemId || matterId || documentVersionId) {
      throw new Error('AUTO_WORK_ITEM_QUEUE_STATIC_SUBJECT_FORBIDDEN');
    }
  } else {
    assertSingleConsumerSubject({ workItemId, matterId, documentVersionId });
  }
  const { matterPreflightOnly, matterExpectedSnapshot } = autoQueue
    ? { matterPreflightOnly: false, matterExpectedSnapshot: undefined }
    : matterPreflightMode(argv, matterId);
  const stageLimit = autoQueue
    ? {}
    : initialStageLimit(argv, workItemId, matterId, documentVersionId);
  const jobAidLimits = jobAidRunLimitOptions(argv, {
    workItemId, matterId, documentVersionId, ...stageLimit,
  });
  const runtime = await resolveRuntimeConfig(argv, env);
  if (!autoQueue && !matterPreflightOnly) assertHostedModelGatewayReady(runtime);
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
    const consumerDependencies = {
      callTool: connection.callTool,
      hasTool: connection.hasTool,
      documentTranslationCheckpoint,
      activityCheckpoint,
      readingCheckpoint,
      invokeReadingModel: (input, hooks) => invokeHostedDocumentReadingModel(input, { ...runtime, ...hooks }),
      invokeTranslationModel: (input, hooks) => invokeHostedInitialModel({ operation: 'TRANSLATE', modelInput: input },
        { ...runtime, ...hooks }),
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
    };
    const automaticCheckpoint = autoQueue ? await createCheckpointStore(join(checkpointRoot,
      'automatic-work-item-queue', encodeURIComponent(endpoint.origin + endpoint.pathname))) : null;
    const result = autoQueue
      ? await consumeAutomaticWorkItemQueueBatch({ checkpointRoot, repairStoppedClaim,
        ...automaticQueueBatchOptions(argv),
        repairWorkItemId, repairAttemptRef, finishBlockedClaim: argv.includes('--finish-blocked-claim'),
        parkCancelledClaim: argv.includes('--park-cancelled-claim'),
        finishCancelledClaim: argv.includes('--finish-cancelled-claim'),
        parkExpectationFile: option(argv, '--park-expectation-file'),
        finishWorkItemId: option(argv, '--finish-work-item-id'),
        finishRequestId: option(argv, '--finish-request-id'),
        finishDocumentVersionId: option(argv, '--finish-document-version-id'),
        finishLeaseGeneration: Number(option(argv, '--finish-lease-generation')),
        finishBlockedAt: option(argv, '--finish-blocked-at') }, {
        checkpoint: automaticCheckpoint,
        callTool: connection.callTool,
        ...createHostAutoWorkItemQueueClient(runtime),
        readInitialStatus: async id => readInitialStatus(
          await connection.callTool('get_parse_status', { workItemId: id }),
          id,
        ),
        prepareOriginal: workItemId => connection.callTool(
          'next_original_assessment', { workItemId },
        ),
        readSavedWork: async (attemptRef, workItemId) => connection.callTool(
          'read_assessment_work', { attemptRef, workItemId },
        ),
        consumeWorkItem: async item => {
          assertHostedModelGatewayReady(runtime);
          return consumeHostedWorkItem(item, consumerDependencies);
        },
        consumeDocument: async (selectedVersionId, deliveryRef) => {
          assertHostedModelGatewayReady(runtime);
          const endpointKey = encodeURIComponent(endpoint.origin + endpoint.pathname);
          return consumeHostedDocument({ documentVersionId: selectedVersionId, deliveryRef,
            leaseOwner }, { ...consumerDependencies,
            documentTranslationCheckpoint: parseRunId => {
              if (!/^[A-Za-z0-9_-]{1,96}$/u.test(parseRunId))
                throw new Error('DOCUMENT_TRANSLATION_RUN_INVALID');
              return createCheckpointStore(join(checkpointRoot,
                'document-translation', endpointKey, selectedVersionId,
                encodeURIComponent(deliveryRef),
                parseRunId, recovery));
            },
            activityCheckpoint: ({ runRef }) => {
              if (!/^[A-Za-z0-9_-]{1,96}$/u.test(runRef))
                throw new Error('ACTIVITY_RUN_REF_INVALID');
              return createCheckpointStore(join(checkpointRoot,
                'document-activity', endpointKey, selectedVersionId,
                encodeURIComponent(deliveryRef), runRef));
            },
            readingCheckpoint: ({ runRef }) => {
              if (!/^[A-Za-z0-9_-]{1,96}$/u.test(runRef))
                throw new Error('READING_RUN_REF_INVALID');
              return createCheckpointStore(join(checkpointRoot,
                'document-reading', endpointKey, selectedVersionId,
                encodeURIComponent(deliveryRef), runRef));
            },
          });
        },
        consumeReview: async reviewWorkItemId => {
          assertHostedModelGatewayReady(runtime);
          return consumePendingReviewTurn({ workItemId: reviewWorkItemId,
            checkpointRoot: join(checkpointRoot, 'review') }, {
            callTool: connection.callTool,
            hasTool: connection.hasTool,
            invokeModel: (input, hooks) => invokeHostedReviewModel(input, { ...runtime, ...hooks }),
          });
        },
        consumeSuccessorOverall: async pointer => {
          assertHostedModelGatewayReady(runtime);
          return runHostedSuccessorOverall({ ...pointer, checkpointRoot }, {
            callTool: connection.callTool,
            invokeInitialModel: (input, hooks) => invokeHostedInitialModel(input, { ...runtime, ...hooks }),
          });
        },
        ...(wikiIdle ? { consumeWikiIdle: async () => {
          assertHostedModelGatewayReady(runtime);
          return consumeHierarchicalWikiIdle({ enabled: true, runBudget: wikiBudget, checkpointRoot,
            endpointKey: encodeURIComponent(endpoint.origin + endpoint.pathname) }, {
            checkpoint: automaticCheckpoint, callTool: connection.callTool,
            createGatewayPreparer: () => createNativeReviewGatewayPreparer({
              sourceConfigPath: option(argv, '--openclaw-config') }),
            invokeModel: (input, hooks) => invokeHostedDerivedSummaryModel(input, { ...runtime, ...hooks }),
            invokeMatterModel: (input, hooks, deps) => invokeHostedJobAidProblemModel(input, { ...runtime, ...hooks }, deps),
          });
        } } : {}),
      })
      : await consumeHostedWorkItem({
        workItemId,
        matterId,
        matterPreflightOnly,
        matterExpectedSnapshot,
        documentVersionId,
        ...stageLimit,
        ...jobAidLimits,
        applicabilityContextRef: option(argv, '--applicability-context-ref'),
        checkpointRoot,
        activityRunRef,
        readingRunRef,
        leaseOwner,
      }, consumerDependencies);
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
