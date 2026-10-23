import {
  getCanonicalHostClientSessionGeneration,
  isCanonicalHostClientSessionAuthenticationRequired,
  subscribeCanonicalHostClientSession,
} from '@client/src/api/canonical-host';
import type { ReviewChatSendIntent } from './review-submission';

// UI-only drafts and unconfirmed send intents, never cached permissions or results.
const reviewDrafts: Map<string, string> = new Map();
const pendingReviewChats: Map<string, ReviewChatSendIntent> = new Map();
const unconfirmedReviewChats: Map<string, readonly ReviewChatSendIntent[]> =
  new Map();
const EMPTY_UNCONFIRMED_CHATS: readonly ReviewChatSendIntent[] = [];
const reviewDraftListeners: Set<() => void> = new Set();

function publishReviewDraftChange(): void {
  reviewDraftListeners.forEach((listener: () => void) => listener());
}

subscribeCanonicalHostClientSession(() => {
  reviewDrafts.clear();
  pendingReviewChats.clear();
  unconfirmedReviewChats.clear();
  publishReviewDraftChange();
});

export function subscribeReviewDraft(listener: () => void): () => void {
  reviewDraftListeners.add(listener);
  return () => reviewDraftListeners.delete(listener);
}

export function readReviewDraft(scopeKey: string): string {
  if (isCanonicalHostClientSessionAuthenticationRequired()) return '';
  return reviewDrafts.get(scopeKey) ?? '';
}

export function readPendingReviewChat(
  scopeKey: string,
): ReviewChatSendIntent | null {
  if (isCanonicalHostClientSessionAuthenticationRequired()) return null;
  return pendingReviewChats.get(scopeKey) ?? null;
}

export function writePendingReviewChat(
  scopeKey: string,
  pending: ReviewChatSendIntent | null,
  session: number,
): void {
  if (
    session !== getCanonicalHostClientSessionGeneration() ||
    isCanonicalHostClientSessionAuthenticationRequired()
  )
    return;
  pendingReviewChats.delete(scopeKey);
  if (pending) pendingReviewChats.set(scopeKey, pending);
  publishReviewDraftChange();
}

export function readUnconfirmedReviewChats(
  scopeKey: string,
): readonly ReviewChatSendIntent[] {
  if (isCanonicalHostClientSessionAuthenticationRequired())
    return EMPTY_UNCONFIRMED_CHATS;
  return unconfirmedReviewChats.get(scopeKey) ?? EMPTY_UNCONFIRMED_CHATS;
}

/** Explicitly retain an unresolved send; this is neither cancellation nor failure. */
export function retainUnconfirmedReviewChat(
  scopeKey: string,
  session: number,
): void {
  if (
    session !== getCanonicalHostClientSessionGeneration() ||
    isCanonicalHostClientSessionAuthenticationRequired()
  )
    return;
  const pending = pendingReviewChats.get(scopeKey);
  if (!pending) return;
  const retained = readUnconfirmedReviewChats(scopeKey);
  if (
    !retained.some(
      (item) =>
        item.reviewConversationId === pending.reviewConversationId &&
        item.request.requestId === pending.request.requestId,
    )
  )
    unconfirmedReviewChats.set(scopeKey, [...retained, pending]);
  pendingReviewChats.delete(scopeKey);
  // Never turn the unresolved question into a new-message draft automatically.
  if (reviewDrafts.get(scopeKey)?.trim() === pending.request.userMessage)
    reviewDrafts.delete(scopeKey);
  publishReviewDraftChange();
}

export function writeReviewDraft(
  scopeKey: string,
  text: string,
  session: number,
): void {
  if (
    session !== getCanonicalHostClientSessionGeneration() ||
    isCanonicalHostClientSessionAuthenticationRequired()
  )
    return;
  reviewDrafts.delete(scopeKey);
  if (text) reviewDrafts.set(scopeKey, text);
  publishReviewDraftChange();
}
