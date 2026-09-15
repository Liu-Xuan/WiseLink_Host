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
): (targetScopeKey?: string) => void {
  const restoredRef = useRef<boolean>(false);
  const savedBeforeLeaveRef = useRef<boolean>(false);
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const selectionRef = useRef<Omit<ReadingLocation, 'scrollY'>>(selection);
  selectionRef.current = selection;
  useLayoutEffect(() => {
    restoredRef.current = false;
    savedBeforeLeaveRef.current = false;
  }, [scopeKey, session]);
  useLayoutEffect(() => {
    if (!ready || restoredRef.current) return;
    restoredRef.current = true;
    const saved: ReadingLocation | null = readReadingLocation(scopeKey);
    if (saved) {
      document
        .querySelectorAll<HTMLDetailsElement>('details[data-issue-ref]')
        .forEach((element) => {
          element.open =
            saved.expandedIssueRefs?.includes(element.dataset.issueRef ?? '') ??
            false;
        });
      document
        .querySelectorAll<HTMLDetailsElement>('details[data-reading-key]')
        .forEach((element) => {
          element.open =
            saved.expandedDirectoryKeys?.includes(
              element.dataset.readingKey ?? '',
            ) ?? element.open;
        });
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
      if (
        readyRef.current &&
        !savedBeforeLeaveRef.current &&
        restoredRef.current
      ) {
        saveReadingLocation(
          scopeKey,
          captureReadingLocation(selectionRef.current),
          session,
        );
      }
    },
    [scopeKey, session],
  );
  return (targetScopeKey = scopeKey): void => {
    if (!readyRef.current) return;
    savedBeforeLeaveRef.current = true;
    saveReadingLocation(
      targetScopeKey,
      captureReadingLocation(selectionRef.current),
      session,
    );
  };
}

export function captureReadingLocation(
  selection: Omit<ReadingLocation, 'scrollY'>,
): ReadingLocation {
  return {
    ...selection,
    scrollY: window.scrollY,
    expandedIssueRefs: Array.from(
      document.querySelectorAll<HTMLDetailsElement>(
        'details[data-issue-ref][open]',
      ),
    )
      .map((element) => element.dataset.issueRef!)
      .filter(Boolean),
    expandedDirectoryKeys: Array.from(
      document.querySelectorAll<HTMLDetailsElement>(
        'details[data-reading-key][open]',
      ),
    )
      .map((element) => element.dataset.readingKey!)
      .filter(Boolean),
  };
}
