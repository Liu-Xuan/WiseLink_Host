import type { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';
import type { ActionAttemptRepository } from '../action-attempt/action-attempt.repository';
import {
  parseCanonicalHostOpenClawAttemptTask,
  parseCanonicalHostOpenClawStoredResult,
} from './canonical-host-openclaw-runtime-policy';

/** A projection written before the final ack may recover only its exact +1 revision. */
export async function committedSuccessorRevision(
  input: {
    tenantId: string;
    principalId: string;
    workItemId: string;
  },
  turn: import('../review-persistence/review-conversation.repository').PersistedReviewTurn,
  currentRevision: number,
  workItems: MiaodaWorkItemRepository,
  attempts?: ActionAttemptRepository,
): Promise<boolean> {
  const receipt = turn.assistantCandidate?.jobAidWorkingUpdate;
  if (
    !attempts ||
    !receipt?.workRevisionRef ||
    receipt.status !== 'APPLIED' ||
    turn.overallRequested !== true ||
    currentRevision !== turn.inputRevision + 1
  )
    return false;
  const row = await attempts.readLatestByExactIdempotency({
    tenantId: input.tenantId,
    idempotencyKey: `openclaw-successor-overall:${input.workItemId}:${turn.reviewTurnId}`,
  });
  if (
    !row ||
    row.tenantId !== input.tenantId ||
    row.workItemId !== input.workItemId ||
    row.actionType !== 'OPENCLAW_OVERALL_SYNTHESIS' ||
    !['COMMITTING', 'SUCCEEDED'].includes(row.status) ||
    row.baseRevision !== turn.inputRevision ||
    row.inputRevision !== turn.inputRevision ||
    (row.leaseOwner !== null && row.leaseOwner !== input.principalId)
  )
    return false;
  const task = parseCanonicalHostOpenClawAttemptTask(row);
  const binding = task.modelInput.successorOverallBinding;
  if (
    task.modelInput.successorReviewTurnRef !== turn.reviewTurnId ||
    !binding ||
    typeof binding !== 'object' ||
    Array.isArray(binding) ||
    !('reviewConversationRef' in binding) ||
    binding.reviewConversationRef !== turn.reviewConversationId ||
    !('requestId' in binding) ||
    binding.requestId !== turn.requestId ||
    !('inputRevision' in binding) ||
    binding.inputRevision !== turn.inputRevision ||
    !('workRevisionRef' in binding) ||
    binding.workRevisionRef !== receipt.workRevisionRef
  )
    return false;
  parseCanonicalHostOpenClawStoredResult({ row, task });
  const current = await workItems.loadTenantScopedProjection(
    input.workItemId,
    input.tenantId,
  );
  const overall = current?.projection?.integratedAssessment?.overallSynthesis;
  return Boolean(
    current &&
    current.row.revision === currentRevision &&
    current.row.requestedByUserId === row.actorUserId &&
    current.projection?.revision === currentRevision &&
    overall?.actionAttemptId === row.attemptId &&
    overall.basedOnJobAidWorkRevisionRef === receipt.workRevisionRef,
  );
}
