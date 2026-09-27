#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { consumePendingReviewTurn } from './consume-hosted-review-turn.mjs';
import { consumeHostedMatter } from './consume-hosted-matter.mjs';
import { recoverNativeMatterResponse } from './recover-native-matter-response.mjs';
import { invokeHostedJobAidProblemModel } from './run-jobaid-problem-assessment.mjs';
import { invokeHostedInitialModel } from './invoke-hosted-initial-model.mjs';
import { INITIAL_ASSESSMENT_OPERATIONS, findInitialAssessmentRecovery, initialStageCheckpointPath, initialApplicabilityCheckpointPointerPath,
  assertFreshInitialAssessmentClaim, assertCommittingInitialClaim } from './initial-assessment-recovery.mjs';
import { invokeHostedDocumentActivityModel } from './invoke-hosted-document-activity-model.mjs';
import { consumeHostedDocumentReading } from './consume-hosted-document-reading.mjs';
import { invokeHostedDocumentReadingModel } from './invoke-hosted-document-reading-model.mjs';
import { consumeHostedDocumentActivity } from './consume-hosted-document-activity.mjs';
import { INITIAL_ANALYSIS_OPERATIONS, parseConfigurationEvidenceReevaluationStatus, runInitialAnalysis, runOverallSynthesis } from './orchestrate-host-mcp.mjs';
import {
  assertHostedModelGatewayReady,
  createCheckpointStore,
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
    const recovery = await findInitialAssessmentRecovery(options, initial);
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

/**
 * One native cron tick for the Host-owned automatic queue. The lease token is
 * checkpointed locally for the trusted consumer's ACK only; it is never added
 * to model input, MCP arguments, or returned diagnostics.
 */
export async function consumeAutomaticWorkItemQueueTick(options, dependencies) {
  const { checkpoint, now = () => new Date() } = dependencies;
  if (!checkpoint || typeof checkpoint.readOptional !== 'function' ||
      typeof checkpoint.write !== 'function' ||
      typeof dependencies.nextWorkItem !== 'function' ||
      typeof dependencies.acknowledgeWorkItem !== 'function' ||
      typeof dependencies.consumeWorkItem !== 'function' ||
      typeof dependencies.readInitialStatus !== 'function') {
    throw new Error('AUTO_WORK_ITEM_QUEUE_DEPENDENCIES_INVALID');
  }

  const stored = await checkpoint.readOptional('active-claim');
  let claim = stored === null ? null : validateStoredAutoClaim(stored);
  const storedReviewCursor = claim ? null : await checkpoint.readOptional('review-cursor');
  if (storedReviewCursor !== null &&
      (typeof storedReviewCursor !== 'string' ||
        !/^WI-[A-Za-z0-9_-]{1,93}$/u.test(storedReviewCursor))) {
    throw new Error('AUTO_WORK_ITEM_REVIEW_CURSOR_INVALID');
  }
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

  if (claim?.blockReady) {
    // Older consumers may have persisted an intent to BLOCK a runtime failure.
    // Its response might already have committed, so never send that mutation
    // again without a read-only receipt. Preserve the exact claim for review.
    return automaticWorkItemAttention(claim, 'AUTO_WORK_ITEM_PRIOR_BLOCK_RECEIPT_UNCERTAIN');
  }

  if (!claim || Date.parse(claim.leaseExpiresAt) <= currentTime.getTime()) {
    const previous = claim;
    const next = validateAutoClaimResult(
      await dependencies.nextWorkItem(previous
        ? { resumeWorkItemId: previous.workItemId }
        : storedReviewCursor
          ? { reviewAfterWorkItemId: storedReviewCursor }
          : undefined),
      currentTime,
    );
    if (next.status === 'REVIEW_PENDING' || next.status === 'OVERALL_PENDING') {
      const consumer = next.status === 'REVIEW_PENDING'
        ? dependencies.consumeReview : dependencies.consumeSuccessorOverall;
      if (previous || typeof consumer !== 'function')
        throw new Error('AUTO_WORK_ITEM_SUCCESSOR_DISPATCH_INVALID');
      const result = await consumer(next.status === 'REVIEW_PENDING' ? next.workItemId : next);
      await checkpoint.write('review-cursor', next.reviewAfterWorkItemId);
      return { status: next.status === 'REVIEW_PENDING' ? 'REVIEW_DISPATCHED' : 'OVERALL_DISPATCHED',
        workItemId: next.workItemId, reviewTurnRef: next.reviewTurnRef,
        ...(next.status === 'REVIEW_PENDING' ? { review: result } : { overall: result }) };
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
      await checkpoint.write('active-claim', null);
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
      throw new Error('AUTO_WORK_ITEM_RECLAIM_FENCE_INVALID');
    }
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
    };
    await checkpoint.write('active-claim', claim);
  }

  let statusValue = await dependencies.readInitialStatus(claim.workItemId);
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
  const retry = options.repairStoppedClaim ? null
    : await automaticRetryPlan(statusValue, claim.workItemId,
      dependencies.readSavedWork);
  const repair = options.repairStoppedClaim && claim.consumerStopped && !retry
    ? await repairedRetryPlan(statusValue, claim.workItemId,
      dependencies.readSavedWork, claim.attentionCode, claim.workItemRevision,
      options.repairAttemptRef)
    : null;
  const repairAttentionCode = repair ? claim.attentionCode : null;
  const committingRecovery = claim.consumerStopped && statusValue.status === 'BUSY'
    ? await findInitialAssessmentRecovery({ ...options, workItemId: claim.workItemId }, statusValue)
    : null;
  const repairingRecovery = options.repairStoppedClaim &&
    ['RECOVERY_CANDIDATE', 'RECOVERY_COMMITTING'].includes(committingRecovery?.status) &&
    ['EVALUATE_JOBAID', 'SYNTHESIZE_OVERALL'].includes(committingRecovery.operation) &&
    statusValue.stages?.[STAGE_BY_OPERATION[committingRecovery.operation]]?.requestId ===
      repairRequestId(claim.workItemId, claim.documentVersionId,
        STAGE_BY_OPERATION[committingRecovery.operation], options.repairAttemptRef);
  if (claim.completionReady) {
    claim = { ...claim, completionReady: false };
    await checkpoint.write('active-claim', claim);
  }
  if (claim.consumerStopped && !retry && !repair && !repairingRecovery &&
      !(committingRecovery?.status === 'RECOVERY_COMMITTING' && !options.repairStoppedClaim)) {
    return automaticWorkItemAttention(
      claim,
      claim.attentionCode ?? 'AUTO_WORK_ITEM_CONSUMER_STOPPED',
      statusValue,
    );
  }
  if ((retry || (committingRecovery?.status === 'RECOVERY_COMMITTING' &&
      !options.repairStoppedClaim)) && claim.consumerStopped) {
    claim = { ...claim, consumerStopped: false, attentionCode: null };
    await checkpoint.write('active-claim', claim);
  }

  const report = await dependencies.consumeWorkItem({
    ...options,
    workItemId: claim.workItemId,
    initialStageOnly: true,
    maxInitialStages: 1,
    // New items must use the context returned by Host status; a static
    // WorkItem's context reference cannot be inherited by a queued item.
    applicabilityContextRef: undefined,
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
  statusValue = await dependencies.readInitialStatus(claim.workItemId);
  assertAutomaticClaimStatusBinding(claim, statusValue);
  if (isAutomaticWorkItemDone(statusValue)) {
    claim = { ...claim, completionReady: true };
    await checkpoint.write('active-claim', claim);
    return acknowledgeAndClearAutoClaim(claim, checkpoint, dependencies, report);
  }
  if (report?.status === 'REQUIRES_ATTENTION') {
    claim = {
      ...claim,
      consumerStopped: true,
      attentionCode: safeAutomaticAttentionCode(report.errorCode),
    };
    await checkpoint.write('active-claim', claim);
    return automaticWorkItemAttention(
      claim,
      claim.attentionCode,
      statusValue,
      report,
    );
  }

  if ((repair || repairingRecovery) && claim.consumerStopped) {
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
  };
}

async function acknowledgeAndClearAutoClaim(
  claim,
  checkpoint,
  dependencies,
  report,
) {
  const acknowledgement = validateAutoAcknowledgement(
    await dependencies.acknowledgeWorkItem({
      workItemId: claim.workItemId,
      leaseToken: claim.leaseToken,
      leaseGeneration: claim.leaseGeneration,
    }),
    claim.workItemId,
  );
  await checkpoint.write('active-claim', null);
  return {
    status: 'ACKNOWLEDGED',
    workItemId: claim.workItemId,
    replayed: acknowledgement.replayed,
    acknowledgedAt: acknowledgement.acknowledgedAt,
    consumerStatus: typeof report?.status === 'string' ? report.status : 'COMPLETED',
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
    [],
    'AUTO_WORK_ITEM_CLAIM_CHECKPOINT',
  );
  if (value.schemaVersion !== 'wiselink.auto_work_item_claim.v1' ||
      typeof value.completionReady !== 'boolean' ||
      typeof value.consumerStopped !== 'boolean' ||
      (value.attentionCode !== null &&
        (typeof value.attentionCode !== 'string' ||
          !/^[A-Z][A-Z0-9_:.-]{0,199}$/u.test(value.attentionCode))) ||
      (value.blockReady !== null && !isAutomaticBlockBinding(value.blockReady))) {
    throw new Error('AUTO_WORK_ITEM_CLAIM_CHECKPOINT_INVALID');
  }
  validateClaimFields(value);
  return value;
}

function validateAutoClaimResult(value, now) {
  if (!isRecord(value)) throw new Error('AUTO_WORK_ITEM_CLAIM_RESPONSE_INVALID');
  if (value.status === 'IDLE') {
    assertExactKeys(value, ['status'], ['reviewAfterWorkItemId'], 'AUTO_WORK_ITEM_CLAIM_RESPONSE');
    if (value.reviewAfterWorkItemId !== undefined &&
        !/^WI-[A-Za-z0-9_-]{1,93}$/u.test(value.reviewAfterWorkItemId))
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

function validateClaimFields(value) {
  if (!/^WI-[A-Za-z0-9_-]{1,93}$/u.test(value.workItemId) ||
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

async function automaticRetryPlan(initial, workItemId, readSavedWork) {
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
    const interrupted = ['CANCELLED', 'TIMED_OUT'].includes(observation.attemptStatus);
    const preparationFailed = observation.attemptStatus === 'FAILED' &&
      observation.terminalCode === 'ACTION_ATTEMPT_INITIAL_PREPARATION_FAILED';
    if (!interrupted && !preparationFailed) continue;
    // A failed authorization or changed source requires Host/user resolution,
    // even when the attempt was interrupted before commit.
    if (/(?:ACL|AUTH|PERMISSION|SOURCE_REVOKED|BINDING_CHANGED|VERSION_DRIFT)/u
      .test(observation.terminalCode ?? '')) continue;
    let prefix = 'auto-retry';
    if (/^auto-retry-[0-9a-f]{32}$/u.test(observation.requestId ?? '')) {
      if (typeof readSavedWork !== 'function') continue;
      const saved = await readSavedWork(observation.attemptRef, workItemId);
      const revision = saved?.revision;
      if (saved?.schemaVersion !== 'wiselink.jobaid-work-read.v2' ||
          saved.executionStatus !== observation.attemptStatus ||
          typeof saved.attemptId !== 'string' || !saved.attemptId ||
          !Number.isSafeInteger(saved.inputWorkRevision) ||
          saved.inputWorkRevision < 0 ||
          revision?.actionAttemptId !== saved.attemptId ||
          revision.workItemId !== workItemId ||
          revision.documentVersionId !== initial.documentVersionId ||
          revision.basedOnWorkItemRevision !== initial.workItemRevision ||
          !Number.isSafeInteger(revision.workRevision) ||
          revision.workRevision <= saved.inputWorkRevision) continue;
      prefix = 'auto-resume-2';
    } else if (observation.requestId?.startsWith('auto-')) continue;
    const identity = [workItemId, initial.documentVersionId, stage,
      observation.attemptRef].join(':');
    const requestId = `${prefix}-${createHash('sha256').update(identity)
      .digest('hex').slice(0, 32)}`;
    return { operation, attemptRef: observation.attemptRef, requestId };
  }
  return null;
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
  if (await current()) return { status: 'SUCCESSOR_OVERALL_SAVED', ...binding, recoveredByReadback: true };
  if (await checkpoint.readOptional('run-result'))
    throw new Error('HOSTED_SUCCESSOR_OVERALL_RESULT_DRIFT');
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
  const result = await runOverallSynthesis({
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
          observeModelOutput: (shape, round = 1) => checkpoint.writeOnce(
            `model.output-shape${round === 1 ? '' : '-' + round}`, shape),
          observeCandidateRejection: report => checkpoint.writeOnce(
            `model.candidate-rejection-${report.correctionNo}`, report) },
      ),
  });
  if (!result.ok || !await current())
    throw new Error('HOSTED_SUCCESSOR_OVERALL_RESULT_NOT_CURRENT');
  const report = { status: 'SUCCESSOR_OVERALL_SAVED', ...binding,
    recoveredByReadback: result.outcome === 'COMMIT_RESPONSE_LOSS_RECOVERED_READ_ONLY' };
  await checkpoint.writeOnce('run-result', report);
  return report;
}

export async function runHostedInitialStage(options, dependencies) {
  const { operation, initial } = options;
  if (!INITIAL_ANALYSIS_OPERATIONS.includes(operation)) throw new Error('INITIAL_OPERATION_INVALID');
  const continuationRequestId = options.autoRetryRequestId ??
    initial.stages[STAGE_BY_OPERATION[operation]]?.requestId;
  const initialWorkItemRevision=operation === 'EXTRACT_APPLICABILITY'
    ? (options.assessmentRecovery?.initialWorkItemRevision ?? initial.workItemRevision) : undefined;
  const checkpoint = await createCheckpointStore(initialStageCheckpointPath(
    {...options,initialWorkItemRevision}, operation, continuationRequestId));
  if (operation === 'EXTRACT_APPLICABILITY' && !options.assessmentRecovery) {
    const pointer=await createCheckpointStore(initialApplicabilityCheckpointPointerPath(options));
    await pointer.write('active',{workItemRevision:initialWorkItemRevision,requestId:continuationRequestId ?? null});
  }
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
  const priorRun = await checkpoint.readOptional('run-result');
  if (priorRun && !(options.assessmentRecovery?.status === 'RECOVERY_COMMITTING' &&
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
    const scopedArgs = (['EVALUATE_JOBAID', 'SYNTHESIZE_OVERALL'].includes(operation) ||
      (operation === 'EXTRACT_APPLICABILITY' && name !== 'begin_applicability_evaluation'))
      ? { ...args, workItemId: options.workItemId } : args;
    const count = (callCounts.get(name) ?? 0) + 1;
    callCounts.set(name, count);
    if (name.startsWith('commit_') && args.phase !== 'UPLOAD_PART') finalCommitStarted = true;
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
    const value = freshAssessmentCall || sealedCommitReplay || sealedStatusRead ||
      (options.assessmentRecovery && name.startsWith('begin_') && !recoveryBegin)
      ? await dependencies.callTool(name, scopedArgs) : await checkpoint.remoteStep({
      // Keep c114 checkpoint identity stable for an already-started JobAid run.
      // The exact WorkItem is also frozen in the enclosing checkpoint binding.
      step: `${name}-${count}`, args,
      ambiguousCommit: name.startsWith('commit_'),
      allowExactReplay: exactApplicabilityBeginReplay,
      perform: () => dependencies.callTool(name, scopedArgs),
    });
    if (name.startsWith('begin_') && options.assessmentRecovery?.status === 'RECOVERY_COMMITTING')
      assertCommittingInitialClaim(options.assessmentRecovery.previousClaim,value);
    if (name === 'begin_applicability_evaluation' && recoveryBegin &&
      value.attemptRef !== options.assessmentRecovery.previousAttemptRef)
      throw new Error('INITIAL_APPLICABILITY_BEGIN_ATTEMPT_MISMATCH');
    if (name.startsWith('begin_') && value.status === 'RUNNING') {
      if (options.assessmentRecovery?.status === 'RECOVERY_CANDIDATE')
        assertFreshInitialAssessmentClaim(options.assessmentRecovery.previousClaim, value);
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
    const stageDone = stageStatus === 'SUCCEEDED';
    const report = {
      status: stageDone ? 'INITIAL_STAGE_SAVED' : 'REQUIRES_ATTENTION',
      operation, stageStatus, nextOperation: after.nextOperation,
      outcome: result.outcome, modelCallCount,
      provenance: result.provenance,
      workItemRevision: after.workItemRevision,
      candidateOnly: true,
    };
    // An uncertain result is retained as attention, never converted into a retry.
    if (options.assessmentRecovery?.status === 'RECOVERY_COMMITTING')
      await checkpoint.write('committing-recovery-result', report);
    else await checkpoint.writeOnce('run-result', report);
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
            ...(['EVALUATE_JOBAID', 'SYNTHESIZE_OVERALL', 'EXTRACT_APPLICABILITY'].includes(operation)
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
  if (!occurrences) {
    if (repairs || repairWorkItems || repairAttempts)
      throw new Error('AUTO_WORK_ITEM_QUEUE_OPTIONS_INVALID');
    return false;
  }
  if (occurrences !== 1) throw new Error('AUTO_WORK_ITEM_QUEUE_OPTIONS_INVALID');
  if (repairs > 1) throw new Error('AUTO_WORK_ITEM_QUEUE_OPTIONS_INVALID');
  if (repairWorkItems !== repairs || repairAttempts !== repairs) {
    throw new Error('AUTO_WORK_ITEM_QUEUE_OPTIONS_INVALID');
  }
  const valueOptions = new Set([
    '--checkpoint-root', '--openclaw-config',
    '--repair-work-item-id', '--repair-attempt-ref',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--auto-queue' || arg === '--repair-stopped-claim') continue;
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
    process.stdout.write('Usage: node consume-hosted-work-item.mjs [--auto-queue [--repair-stopped-claim --repair-work-item-id WI-... --repair-attempt-ref AQ-...]] [--work-item-id WI-...] [--matter-id MAT-...] [--document-version-id DV] [--matter-preflight-only | --matter-expected-snapshot SHA256] [--max-initial-stages 1] [--expected-initial-operation EVALUATE_JOBAID|SYNTHESIZE_OVERALL] [--applicability-context-ref REF] [--checkpoint-root PATH] [--openclaw-config PATH] [--native-session-store PATH] [--document-translation-recovery ID] [--activity-run-ref ID] [--reading-run-ref ID] [--lease-owner ID]\nOne native job per authorized subject. Choose exactly one WorkItem, Matter or DocumentVersion; independent jobs use native cron concurrency. --auto-queue is one native cron tick for the Host-enrolled automatic WorkItem queue; it accepts no static subject or stage-specific options. --repair-stopped-claim with both exact identity flags permits one operator-triggered successor only for a stopped claim with a failed no-work JobAid/Overall auto-retry after a bounded gateway change; it is never a cron option. --matter-preflight-only reads current Matter work without dispatch; --matter-expected-snapshot checks that read again before dispatch and stops on a changed snapshot. --max-initial-stages 1 is WorkItem-only and consumes at most the current initial stage, without Review or original-impact work. --expected-initial-operation requires that limit and refuses any entry stage other than the named JobAid or Overall stage.\n');
    return;
  }
  const autoQueue = automaticWorkItemQueueMode(argv);
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
    };
    const result = autoQueue
      ? await consumeAutomaticWorkItemQueueTick({ checkpointRoot, repairStoppedClaim,
        repairWorkItemId, repairAttemptRef }, {
        checkpoint: await createCheckpointStore(join(
          checkpointRoot,
          'automatic-work-item-queue',
          encodeURIComponent(endpoint.origin + endpoint.pathname),
        )),
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
        consumeReview: async reviewWorkItemId => {
          assertHostedModelGatewayReady(runtime);
          return consumePendingReviewTurn({ workItemId: reviewWorkItemId,
            checkpointRoot: join(checkpointRoot, 'review') }, {
            callTool: connection.callTool,
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
      })
      : await consumeHostedWorkItem({
        workItemId,
        matterId,
        matterPreflightOnly,
        matterExpectedSnapshot,
        documentVersionId,
        ...stageLimit,
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
