import type { ActionAttemptRow } from '../action-attempt/action-attempt.types';
import type { ActionAttemptRepository } from '../action-attempt/action-attempt.repository';
import { parseCanonicalHostOpenClawAttemptTask } from './canonical-host-openclaw-runtime-policy';
import { parseReviewTurnTaskContract } from './canonical-host-openclaw-review.contract';
import type {
  CanonicalServiceScopeAuthorizationPort,
  CanonicalVerifiedServiceScope,
} from './canonical-service-scope.authorization';

/** Control tools recheck the same current conversation without opening prose,
 * native journals or the sealed result, including QUEUED/cancelled attempts. */
export async function assertCurrentReviewAttemptMetadataScope(input:{
  row:NonNullable<Awaited<ReturnType<ActionAttemptRepository['readReviewScopeMetadata']>>>;
  scope:CanonicalVerifiedServiceScope;serviceScope:CanonicalServiceScopeAuthorizationPort;
}):Promise<void> {
  const {row,scope,serviceScope}=input;
  if(row.actionType!=='OPENCLAW_INTERACTIVE_REVIEW' || !row.conversation || !row.requestId || !row.turn ||
    row.matterScope || !row.taskInputHash || row.inputHash!==row.taskInputHash ||
    row.taskType!==row.actionType || row.taskOperationRef!==row.operationRef || row.taskWorkItemId!==row.workItemId)
    throw reviewAttemptNotFound();
  const current=await serviceScope.authorizeOpenClawReview({operation:'BEGIN_REVIEW',workItemId:row.workItemId,
    reviewConversationRef:row.conversation,requestId:row.requestId});
  if(current.appId!==scope.appId || current.tenantId!==scope.tenantId ||
    current.workItemId!==scope.workItemId || current.principalId!==scope.principalId) throw reviewAttemptNotFound();
}

/** Recheck the persisted Review conversation against the currently configured exact object scope. */
export async function assertCurrentReviewAttemptScope(input: {
  row: ActionAttemptRow;
  scope: CanonicalVerifiedServiceScope;
  serviceScope: CanonicalServiceScopeAuthorizationPort;
}): Promise<void> {
  const { row, scope, serviceScope } = input;
  if (row.actionType !== 'OPENCLAW_INTERACTIVE_REVIEW')
    throw reviewAttemptNotFound();
  const task = parseCanonicalHostOpenClawAttemptTask(row);
  const contract = parseReviewTurnTaskContract(task.modelInput);
  const current = await serviceScope.authorizeOpenClawReview({
    operation: 'BEGIN_REVIEW',
    workItemId: row.workItemId,
    reviewConversationRef: contract.reviewConversationRef,
    requestId: contract.requestId,
  });
  if (
    current.appId !== scope.appId ||
    current.tenantId !== scope.tenantId ||
    current.workItemId !== scope.workItemId ||
    current.principalId !== scope.principalId
  )
    throw reviewAttemptNotFound();
}

function reviewAttemptNotFound(): Error & { code: string; statusCode: number } {
  return Object.assign(new Error('ACTION_ATTEMPT_NOT_FOUND'), {
    code: 'ACTION_ATTEMPT_NOT_FOUND',
    statusCode: 404,
  });
}
