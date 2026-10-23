import { useCallback, useSyncExternalStore } from 'react';

import { getCanonicalHostClientSessionGeneration } from '@client/src/api/canonical-host';

import {
  readReviewDraft,
  subscribeReviewDraft,
  writeReviewDraft,
  readPendingReviewChat,
  writePendingReviewChat,
  readUnconfirmedReviewChats,
  retainUnconfirmedReviewChat,
} from './review-draft-store';
import type { ReviewChatSendIntent } from './review-submission';
const EMPTY_UNCONFIRMED_REVIEW_CHATS: readonly ReviewChatSendIntent[] = [];

export function useUnconfirmedReviewChats(
  scopeKey: string,
): [readonly ReviewChatSendIntent[], () => void] {
  const session = getCanonicalHostClientSessionGeneration();
  const retained = useSyncExternalStore(
    subscribeReviewDraft,
    () => readUnconfirmedReviewChats(scopeKey),
    () => EMPTY_UNCONFIRMED_REVIEW_CHATS,
  );
  const retainPending = useCallback(
    (): void => retainUnconfirmedReviewChat(scopeKey, session),
    [scopeKey, session],
  );
  return [retained, retainPending];
}

export function usePendingReviewChat(
  scopeKey: string,
): [
  ReviewChatSendIntent | null,
  (pending: ReviewChatSendIntent | null) => void,
] {
  const session = getCanonicalHostClientSessionGeneration();
  const pending = useSyncExternalStore(
    subscribeReviewDraft,
    () => readPendingReviewChat(scopeKey),
    () => null,
  );
  const setPending = useCallback(
    (next: ReviewChatSendIntent | null): void =>
      writePendingReviewChat(scopeKey, next, session),
    [scopeKey, session],
  );
  return [pending, setPending];
}

export default function useReviewDraft(
  scopeKey: string,
): [string, (text: string) => void] {
  const session: number = getCanonicalHostClientSessionGeneration();
  const message: string = useSyncExternalStore(
    subscribeReviewDraft,
    () => readReviewDraft(scopeKey),
    () => '',
  );
  const setMessage: (text: string) => void = useCallback(
    (text: string): void => writeReviewDraft(scopeKey, text, session),
    [scopeKey, session],
  );
  return [message, setMessage];
}
