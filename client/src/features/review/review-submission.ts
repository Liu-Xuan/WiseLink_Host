import type { ReviewConversationReadModel } from '@shared/api.interface';

export interface ReviewSubmissionIntent {
  requestId: string;
  executionMode?: 'AUTOMATIC';
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
): ReviewSubmissionIntent {
  return (
    pending ?? {
      requestId,
      ...(automaticReviewAvailable(conversation)
        ? { executionMode: 'AUTOMATIC' }
        : {}),
    }
  );
}
