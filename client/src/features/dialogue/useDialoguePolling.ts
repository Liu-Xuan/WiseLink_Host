import { useEffect, type RefObject } from 'react';
import type { DialogueThreadReadModel } from '@shared/dialogue.interface';
import { dialogueNeedsRefresh } from './dialogue-state';

export function useDialoguePolling(
  thread: DialogueThreadReadModel | null,
  paused: boolean,
  until: RefObject<number>,
  refresh: (quiet?: boolean) => void,
) {
  useEffect(() => {
    if (paused || !dialogueNeedsRefresh(thread)) return;
    const timer = setInterval(() => {
      if (Date.now() > until.current) {
        clearInterval(timer);
        return;
      }
      if (document.visibilityState === 'visible') refresh(true);
    }, 5000);
    return () => clearInterval(timer);
  }, [thread, paused, until, refresh]);
}
