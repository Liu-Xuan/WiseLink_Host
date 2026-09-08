import type {
  ReviewConversationReadModel,
  ReviewScopeSelection,
  ReviewTurnReadModel,
  ReviewTurnAssistantCandidate,
} from '@shared/api.interface';

export type ReviewSourceBinding = NonNullable<
  ReviewTurnAssistantCandidate['sourceBindings']
>[number];

export function reviewSourceBinding(
  turn: ReviewTurnReadModel,
  sourceRefId: string,
): ReviewSourceBinding | null {
  const matches: ReviewSourceBinding[] = (
    turn.assistantCandidate?.sourceBindings ?? []
  ).filter(
    (binding: ReviewSourceBinding) => binding.sourceRefId === sourceRefId,
  );
  return matches.length === 1 ? matches[0] : null;
}

export function sameReviewScope(
  left: ReviewScopeSelection | null | undefined,
  right: ReviewScopeSelection | null | undefined,
): boolean {
  if (left?.kind === 'ENGINEERING_MATTER') {
    return (
      right?.kind === 'ENGINEERING_MATTER' && left.matterId === right.matterId
    );
  }
  return right?.kind !== 'ENGINEERING_MATTER';
}

/** Host must filter the history; the browser refuses, rather than guessing, a mixed response. */
export function assertReviewConversationScope(
  conversation: ReviewConversationReadModel | null,
  workItemId: string,
  scope?: ReviewScopeSelection,
): void {
  if (!conversation) return;
  if (
    conversation.workItemId !== workItemId ||
    !sameReviewScope(conversation.reviewScope, scope) ||
    conversation.turns.some(
      (turn: ReviewTurnReadModel) =>
        !sameReviewScope(turn.reviewScope, scope) ||
        (turn.assistantCandidate?.matterWorkingUpdate &&
          (scope?.kind !== 'ENGINEERING_MATTER' ||
            turn.assistantCandidate.matterWorkingUpdate.matterId !==
              scope.matterId)),
    )
  )
    throw new Error('REVIEW_CONVERSATION_OBJECT_NOT_FOUND');
}
