import type {
  AppendMatterReviewScope,
  ReviewConversationReadModel,
  AppendReviewTextTurnRequest,
  ReviewTurnReadModel,
} from '@shared/api.interface';
import { sameReviewScope } from './review-scope';

export function assessmentDiscussionTurns(
  conversation: ReviewConversationReadModel,
): ReviewTurnReadModel[] {
  const consumed = new Set(
    conversation.turns
      .filter(
        (turn) =>
          turn.purpose === 'UPDATE_ASSESSMENT' &&
          Boolean(turn.assistantCandidate) &&
          sameReviewScope(turn.reviewScope, conversation.reviewScope),
      )
      .flatMap((turn) => turn.includedDiscussionTurnIds ?? []),
  );
  return conversation.turns
    .filter(
      (turn: ReviewTurnReadModel) =>
        turn.purpose === 'CHAT' &&
        !consumed.has(turn.reviewTurnId) &&
        Boolean(turn.assistantCandidate) &&
        sameReviewScope(turn.reviewScope, conversation.reviewScope),
    )
    .sort(
      (a: ReviewTurnReadModel, b: ReviewTurnReadModel) => a.turnNo - b.turnNo,
    );
}

export function latestAssessmentCandidateId(
  turns: ReviewTurnReadModel[],
): string | null {
  return (
    [...turns]
      .sort(
        (a: ReviewTurnReadModel, b: ReviewTurnReadModel) => b.turnNo - a.turnNo,
      )
      .find(
        (turn: ReviewTurnReadModel) =>
          turn.purpose !== 'CHAT' && turn.assistantCandidate,
      )?.reviewTurnId ?? null
  );
}

export function assessmentUpdateRequest(
  requestId: string,
  conversation: ReviewConversationReadModel,
  ids: string[],
  modelRef?: string,
  reviewScope?: AppendMatterReviewScope,
  selectedEvaluationItemId?: string | null,
): AppendReviewTextTurnRequest {
  return {
    requestId,
    purpose: 'UPDATE_ASSESSMENT',
    executionMode: 'AUTOMATIC',
    userMessage: '请基于已确认的对话与资料范围更新评估。',
    includedDiscussionTurnIds: [...ids],
    expectedInputRevision: conversation.currentWorkItemRevision,
    ...(modelRef ? { modelRef } : {}),
    ...(reviewScope ? { reviewScope: { ...reviewScope } } : {}),
    selectedEvaluationItemId,
  };
}

export interface ReviewSubmissionIntent {
  requestId: string;
  executionMode?: 'AUTOMATIC';
  modelRef?: string;
  reviewScope?: AppendMatterReviewScope;
  userMessage?: string;
  selectedEvaluationItemId?: string | null;
}

/** Host-declared support for this conversation, not a browser switch or a live health signal. */
export function automaticReviewAvailable(
  conversation: ReviewConversationReadModel | null,
): boolean {
  return (
    conversation !== null &&
    conversation.status === 'ACTIVE' &&
    'automaticExecutionAvailable' in conversation &&
    conversation.automaticExecutionAvailable === true
  );
}

/** A lost response must be retried with the original mode as well as the original request ID. */
export function reviewSubmissionIntent(
  pending: ReviewSubmissionIntent | null,
  requestId: string,
  conversation: ReviewConversationReadModel,
  modelRef?: string,
  reviewScope?: AppendMatterReviewScope,
): ReviewSubmissionIntent {
  return (
    pending ?? {
      requestId,
      ...(modelRef ? { modelRef } : {}),
      ...(reviewScope ? { reviewScope: { ...reviewScope } } : {}),
      ...(automaticReviewAvailable(conversation)
        ? { executionMode: 'AUTOMATIC' }
        : {}),
    }
  );
}
