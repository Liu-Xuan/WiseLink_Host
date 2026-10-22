import type { DocumentTranslationContinuationPreparation } from '@shared/document-translation-browser.interface';
import type { DocumentTranslationAttemptRepository } from '../action-attempt/document-translation-attempt.repository';
import type { DocumentTranslationTaskEnvelope } from '../action-attempt/document-translation-task-envelope';
import type { CanonicalTranslationWorkspaceRepository } from './canonical-translation-workspace.repository';
import { buildTranslationWorkspaceReadingV2 } from './canonical-translation-v2-quality';
import { documentTranslationRepairableBlockIds } from './document-translation-repair-scope';

export type BrowserTranslationAttempt = NonNullable<Awaited<ReturnType<DocumentTranslationAttemptRepository['latest']>>>;
export type BrowserTranslationSnapshot = Awaited<ReturnType<CanonicalTranslationWorkspaceRepository['readSnapshot']>>;
type Decision = Pick<DocumentTranslationContinuationPreparation, 'state' | 'reason' | 'action'>;
const reconcile = (reason: string): Decision => ({ state: 'REQUIRES_RECONCILIATION', reason, action: null });

export function translationRequestBelongsToDelivery(row: BrowserTranslationAttempt, root: string): boolean {
  return [root, `${root}:hosted-m3`, `${root}:partial-repair`, `${root}:partial-repair-v2`,
    `${root}:known-failure`, `${root}:expired-resume`, `${root}:resume-${row.attemptNo}`]
    .includes(row.triggerRequestId ?? '');
}

/** A read-only preview. The existing reservation transaction remains the final authority. */
export function browserTranslationDecision(row: BrowserTranslationAttempt, task: DocumentTranslationTaskEnvelope,
  snapshot: BrowserTranslationSnapshot, root: string, now = new Date()): Decision {
  if (row.status === 'COMMITTING') return reconcile('COMMIT_IN_PROGRESS');
  const { workspace, revisions } = snapshot;
  const generations = workspace.generationRequests;
  if (generations.some(item => item.status === 'REGISTERED' || item.error?.outcome === 'GENERATION_UNKNOWN'))
    return reconcile('GENERATION_OUTCOME_UNKNOWN');
  if (['QUEUED', 'RUNNING', 'RETRY_SCHEDULED'].includes(row.status))
    return { state: 'ACTIVE', reason: 'EXISTING_EXECUTION', action: null };
  // An attempt that expired before its first claim has never attached itself
  // to the workspace. recoverExpired validates a null or older terminal
  // coordinator under the document/workspace locks at reservation time.
  const unclaimedExpiry = row.status === 'FAILED' && row.errorCode === 'DOCUMENT_TRANSLATION_DEADLINE_EXPIRED';
  if (!unclaimedExpiry && workspace.activeAttemptId !== row.attemptId) return reconcile('COORDINATOR_CHANGED');
  if (row.cancelRequestedAt !== null) return reconcile('CANCEL_REQUESTED');
  if (row.status === 'SUCCEEDED') {
    const reading = buildTranslationWorkspaceReadingV2(workspace, revisions);
    if (reading.completeness !== 'PARTIAL') return { state: 'COMPLETE', reason: 'TARGET_READABLE', action: null };
    if (row.terminalReason === 'REMAINING_LIMITATIONS' && row.resultEnvelopeJson &&
        ![`${root}:partial-repair`, `${root}:partial-repair-v2`].includes(row.triggerRequestId ?? '') &&
        documentTranslationRepairableBlockIds(reading).length > 0)
      return { state: 'READY', reason: 'REPAIR_REMAINING_BLOCKS', action: 'CONTINUE_PARTIAL' };
    return reconcile('REMAINING_SOURCE_OR_REPAIR_LIMITATIONS');
  }
  if (row.status !== 'FAILED' || !row.errorCode || !row.terminalReason || row.resultEnvelopeJson !== null ||
      row.resultContentHash !== null || row.projectionApplied || row.commitStartedAt !== null ||
      workspace.resultArtifact || workspace.resultManifest ||
      (row.leaseOwner !== null && row.leaseExpiresAt !== null && row.leaseExpiresAt > now))
    return reconcile('ORIGINAL_EXECUTION_REQUIRES_REVIEW');
  const prior = generations.filter(item => item.attemptId === row.attemptId);
  if (row.errorCode === 'DOCUMENT_TRANSLATION_DEADLINE_EXPIRED') {
    if (!task.expiredRecovery && row.deadlineAt !== null && row.deadlineAt <= now &&
        row.claimCount === 0 && row.startedAt === null && row.leaseOwner === null && row.leaseToken === null &&
        row.leaseExpiresAt === null && prior.length === 0 &&
        !revisions.some(revision => revision.provenance.originAttemptId === row.attemptId))
      return { state: 'READY', reason: 'UNCLAIMED_EXECUTION_EXPIRED', action: 'RECOVER_EXPIRED' };
    return reconcile('EXPIRED_EXECUTION_REQUIRES_REVIEW');
  }
  if (task.recoveryOf || task.modelInput.retranslateBlockIds ||
      !prior.some(item => item.status === 'FAILED' && item.error?.outcome === 'KNOWN_FAILURE') ||
      prior.some(item => item.status !== 'SAVED' && !(item.status === 'FAILED' && item.error?.outcome === 'KNOWN_FAILURE')))
    return reconcile('ORIGINAL_EXECUTION_REQUIRES_REVIEW');
  const savedRefs = new Set(generations.filter(item => item.status === 'SAVED').map(item => item.generationRequestRef));
  const saved = revisions.some(revision => savedRefs.has(revision.provenance.generationRequestRef));
  const savedLineage = row.triggerRequestId === root ||
    (row.triggerRequestId === `${root}:known-failure` && task.knownFailureRecovery?.kind === 'KNOWN_FAILURE') ||
    (row.triggerRequestId === `${root}:expired-resume` && task.expiredRecovery?.rootRequestId === root) ||
    (row.triggerRequestId === `${root}:resume-${row.attemptNo}` &&
      task.knownFailureRecovery?.kind === 'SAVED_KNOWN_FAILURE' && task.knownFailureRecovery.rootRequestId === root);
  if (saved && savedLineage)
    return { state: 'READY', reason: 'CHECK_SAVED_BLOCKS_FIRST', action: 'RESUME_KNOWN_FAILURE' };
  if (!saved && row.triggerRequestId === root && !task.knownFailureRecovery &&
      !task.expiredRecovery && prior.every(item => item.status === 'FAILED'))
    return { state: 'READY', reason: 'KNOWN_FAILURE_WITHOUT_OUTPUT', action: 'RECOVER_KNOWN_FAILURE' };
  return reconcile('ORIGINAL_EXECUTION_REQUIRES_REVIEW');
}
