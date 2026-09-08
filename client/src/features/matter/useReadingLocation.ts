import { useLayoutEffect, useRef } from 'react';

import {
  readReadingLocation,
  saveReadingLocation,
  type ReadingLocation,
} from './reading-location';

export default function useReadingLocation(
  scopeKey: string,
  session: number,
  ready: boolean,
  selection: Omit<ReadingLocation, 'scrollY'>,
): () => void {
  const restoredRef = useRef<boolean>(false);
  const savedBeforeLeaveRef = useRef<boolean>(false);
  const selectionRef = useRef<Omit<ReadingLocation, 'scrollY'>>(selection);
  selectionRef.current = selection;
  useLayoutEffect(() => {
    if (!ready || restoredRef.current) return;
    restoredRef.current = true;
    const saved: ReadingLocation | null = readReadingLocation(scopeKey);
    if (saved) {
      const trigger: HTMLButtonElement | undefined = Array.from(
        document.querySelectorAll<HTMLButtonElement>('[data-claim-trigger]'),
      ).find(
        (element: HTMLButtonElement) =>
          element.dataset.claimTrigger === saved.focusClaimId,
      );
      if (trigger && !saved.claim && !trigger.closest('[inert], [hidden]')) {
        const details: HTMLDetailsElement | null = trigger.closest('details');
        if (details) details.open = true;
        trigger.focus({ preventScroll: true });
      }
      window.scrollTo({ top: saved.scrollY, behavior: 'instant' });
    }
  }, [ready, scopeKey]);
  useLayoutEffect(
    () => () => {
      if (!savedBeforeLeaveRef.current && restoredRef.current) {
        saveReadingLocation(
          scopeKey,
          { ...selectionRef.current, scrollY: window.scrollY },
          session,
        );
      }
    },
    [scopeKey, session],
  );
  return (): void => {
    savedBeforeLeaveRef.current = true;
    saveReadingLocation(
      scopeKey,
      { ...selectionRef.current, scrollY: window.scrollY },
      session,
    );
  };
}
