import type { ActionAttemptRow } from '../action-attempt/action-attempt.types';
import { parseCanonicalHostOpenClawAttemptTask } from './canonical-host-openclaw-runtime-policy';
import { parseReviewTurnTaskContract } from './canonical-host-openclaw-review.contract';
import type {
  CanonicalServiceScopeAuthorizationPort,
  CanonicalVerifiedServiceScope,
} from './canonical-service-scope.authorization';

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
