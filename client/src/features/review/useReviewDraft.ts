import { useCallback, useSyncExternalStore } from 'react';

import { getCanonicalHostClientSessionGeneration } from '@client/src/api/canonical-host';

import {
  readReviewDraft,
  subscribeReviewDraft,
  writeReviewDraft,
} from './review-draft-store';

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
