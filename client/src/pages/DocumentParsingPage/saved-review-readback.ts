import type { CurrentReviewConversationResponse } from '@shared/api.interface';
import { reviewErrorRevokesReadback } from '@client/src/features/review/continuous-review-state';

/** Allows an independent authorized read, never access to cached document data. */
export function documentFailureAllowsReviewReadback(cause: unknown): boolean {
  if (reviewErrorRevokesReadback(cause)) return false;
  if (typeof cause !== 'object' || cause === null) return false;
  const error: Record<string, unknown> = cause as Record<string, unknown>;
  const response: unknown = error.response;
  const status: unknown =
    error.statusCode ??
    (typeof response === 'object' && response !== null && 'status' in response
      ? response.status
      : null);
  return typeof status === 'number' && status >= 500 && status <= 599;
}

interface SavedReviewReadbackCallbacks {
  workItemId: string;
  isCurrent(): boolean;
  read(workItemId: string): Promise<CurrentReviewConversationResponse>;
  onFresh(response: CurrentReviewConversationResponse): void;
  onError(cause: unknown): void;
  onSettled(): void;
}

export async function runSavedReviewReadback(
  callbacks: SavedReviewReadbackCallbacks,
): Promise<void> {
  try {
    const response: CurrentReviewConversationResponse = await callbacks.read(
      callbacks.workItemId,
    );
    if (!callbacks.isCurrent()) return;
    if (
      response.conversation &&
      response.conversation.workItemId !== callbacks.workItemId
    ) {
      throw Object.assign(new Error('REVIEW_CONVERSATION_OBJECT_NOT_FOUND'), {
        code: 'REVIEW_CONVERSATION_OBJECT_NOT_FOUND',
        statusCode: 404,
      });
    }
    callbacks.onFresh(response);
  } catch (cause) {
    if (callbacks.isCurrent()) callbacks.onError(cause);
  } finally {
    if (callbacks.isCurrent()) callbacks.onSettled();
  }
}
