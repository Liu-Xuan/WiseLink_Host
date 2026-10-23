import type { ActionAttemptRepository } from '../action-attempt/action-attempt.repository';
import type { ReviewTurnAuthorizationMetadata } from '../review-persistence/review-conversation.repository';

/** Finite proof only. Full task/result parsing follows current Source admission. */
export async function committedSuccessorRevision(
  input:{tenantId:string;principalId:string;workItemId:string;actorUserId:string},
  turn:ReviewTurnAuthorizationMetadata,currentRevision:number,attempts?:ActionAttemptRepository,
):Promise<boolean> {
  const receipt=turn.jobAidWorkingUpdate;
  if(!attempts || receipt?.status!=='APPLIED' || !receipt.workRevisionRef ||
    turn.overallRequested!==true || currentRevision!==turn.inputRevision+1) return false;
  const proof=await attempts.readSuccessorRecoveryMetadata({tenantId:input.tenantId,workItemId:input.workItemId,
    idempotencyKey:`openclaw-successor-overall:${input.workItemId}:${turn.reviewTurnId}`});
  if(!proof || proof.owner!==input.actorUserId || proof.currentRevision!==currentRevision || !proof.projectionMatches) return false;
  const row=proof.attempt,binding=row.successorBinding;
  return Boolean(row.tenantId===input.tenantId && row.workItemId===input.workItemId &&
    row.actionType==='OPENCLAW_OVERALL_SYNTHESIS' && row.actorUserId==='service:openclaw-main' &&
    ['COMMITTING','SUCCEEDED'].includes(row.status) && row.baseRevision===turn.inputRevision &&
    row.inputRevision===turn.inputRevision && (row.leaseOwner===null || row.leaseOwner===input.principalId) &&
    row.taskInputHash && row.inputHash===row.taskInputHash && row.taskType===row.actionType &&
    row.taskOperationRef===row.operationRef && row.taskWorkItemId===row.workItemId && row.sealedSuccess &&
    row.successorReviewTurnRef===turn.reviewTurnId && binding && typeof binding==='object' &&
    !Array.isArray(binding) && 'reviewConversationRef' in binding && binding.reviewConversationRef===turn.reviewConversationId &&
    'requestId' in binding && binding.requestId===turn.requestId && 'inputRevision' in binding && binding.inputRevision===turn.inputRevision &&
    'workRevisionRef' in binding && binding.workRevisionRef===receipt.workRevisionRef);
}
