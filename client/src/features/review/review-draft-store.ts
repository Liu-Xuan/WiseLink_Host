import {
  getCanonicalHostClientSessionGeneration,
  isCanonicalHostClientSessionAuthenticationRequired,
  subscribeCanonicalHostClientSession,
} from '@client/src/api/canonical-host';

// UI-only text, never a cached assessment, attachment, permission or conversation.
const reviewDrafts: Map<string, string> = new Map();
const reviewDraftListeners: Set<() => void> = new Set();

function publishReviewDraftChange(): void {
  reviewDraftListeners.forEach((listener: () => void) => listener());
}

subscribeCanonicalHostClientSession(() => {
  reviewDrafts.clear();
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
