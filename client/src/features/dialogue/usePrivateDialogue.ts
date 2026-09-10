import { useCallback, useEffect, useRef, useState } from 'react';
import {
  readDialogue,
  type DialogueClientError,
} from '@client/src/api/dialogues';
import type { DialogueThreadReadModel } from '@shared/dialogue.interface';
import { mergeDialogueRead } from './dialogue-state';
import { useDialoguePolling } from './useDialoguePolling';
import { DialogueRequests } from './dialogue-requests';

export type DialogueOperation = (
  signal: AbortSignal,
) => Promise<DialogueThreadReadModel>;

export function usePrivateDialogue(initialThreadRef?: string) {
  const [thread, setThread] = useState<DialogueThreadReadModel | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState<(() => void) | null>(null);
  const [denied, setDenied] = useState(false);
  const requests = useRef(new DialogueRequests());
  const alive = useRef(true);
  const pollUntil = useRef(Date.now() + 120_000);
  const execute = useCallback(
    async (
      operation: DialogueOperation,
      options?: {
        mutation?: boolean;
        older?: boolean;
        background?: boolean;
        done?: () => void;
      },
    ): Promise<void> => {
      if (!alive.current) return;
      const controller = requests.current.start(Boolean(options?.background));
      if (!controller) return;
      setBusy(!options?.background);
      setRefreshing(Boolean(options?.background));
      setError('');
      setRetry(null);
      try {
        const next = await operation(controller.signal);
        if (!alive.current || controller.signal.aborted) return;
        setThread((previous) => mergeDialogueRead(previous, next));
        if (options?.mutation) pollUntil.current = Date.now() + 120_000;
        options?.done?.();
      } catch (reason: unknown) {
        if (!alive.current || controller.signal.aborted) return;
        const status = (reason as DialogueClientError)?.statusCode;
        if ([401, 403, 404].includes(status ?? 0)) {
          setThread(null);
          setDenied(true);
        }
        setError(
          reason instanceof Error ? reason.message : '请求失败，请重试。',
        );
        if (
          !options?.background &&
          ![401, 403, 404, 409, 400, 422].includes(status ?? 0)
        )
          setRetry(() => () => {
            void execute(operation, options);
          });
      } finally {
        if (requests.current.finish(controller)) {
          if (alive.current) {
            setBusy(false);
            setRefreshing(false);
          }
        }
      }
    },
    [],
  );
  useEffect(() => {
    alive.current = true;
    if (initialThreadRef)
      void execute((signal) => readDialogue(initialThreadRef, signal));
    return () => {
      alive.current = false;
      requests.current.stop();
    };
  }, [execute, initialThreadRef]);
  const refresh = useCallback(
    (quiet = false) => {
      const ref = thread?.threadRef ?? initialThreadRef;
      if (ref)
        void execute((signal) => readDialogue(ref, signal), {
          background: quiet,
        });
    },
    [execute, initialThreadRef, thread?.threadRef],
  );
  useDialoguePolling(
    thread,
    busy || Boolean(error) || denied,
    pollUntil,
    refresh,
  );
  return { thread, busy, refreshing, error, retry, denied, execute, refresh };
}
