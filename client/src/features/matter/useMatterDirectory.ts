import { useCallback, useEffect, useRef, useState } from 'react';
import { getCanonicalHostClientSessionGeneration } from '@client/src/api/canonical-host';
import {
  getEngineeringMatterDirectory,
  type EngineeringMatterClientError,
} from '@client/src/api/engineering-matter';
import type { EngineeringMatterDirectoryResponse } from '@shared/api.interface';

interface MatterDirectoryState extends EngineeringMatterDirectoryResponse {
  scope: string;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
}

export default function useMatterDirectory(
  search: string,
  workItemId: string,
  sessionGeneration: number,
  enabled: boolean,
  refreshRevision: number,
) {
  const scope: string = JSON.stringify([sessionGeneration, search, workItemId]);
  const [state, setState] = useState<MatterDirectoryState | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const readPage = useCallback(
    async (cursor?: string): Promise<void> => {
      controllerRef.current?.abort();
      if (!enabled) return;
      const controller: AbortController = new AbortController();
      controllerRef.current = controller;
      const current = (): boolean =>
        !controller.signal.aborted &&
        getCanonicalHostClientSessionGeneration() === sessionGeneration;
      const empty: MatterDirectoryState = {
        scope,
        items: [],
        nextCursor: null,
        fileReadPerformed: false,
        loading: true,
        loadingMore: Boolean(cursor),
        error: null,
      };
      setState((prior) => ({
        ...(prior?.scope === scope ? prior : empty),
        loading: true,
        loadingMore: Boolean(cursor),
        error: null,
      }));
      try {
        const response = await getEngineeringMatterDirectory(
          { search, workItemId: workItemId || undefined, cursor, limit: 24 },
          controller.signal,
        );
        if (!current()) return;
        setState((prior) => {
          const items = new Map(
            (cursor && prior?.scope === scope ? prior.items : []).map(
              (item) => [item.matterId, item],
            ),
          );
          response.items.forEach((item) => items.set(item.matterId, item));
          return {
            ...empty,
            ...response,
            items: [...items.values()],
            loading: false,
            loadingMore: false,
          };
        });
      } catch (cause: unknown) {
        if (!current()) return;
        const error: EngineeringMatterClientError | null =
          cause instanceof Error ? cause : null;
        const revoked = [401, 403, 404].includes(error?.statusCode ?? 0);
        setState((prior) => ({
          ...(prior?.scope === scope && !revoked ? prior : empty),
          loading: false,
          loadingMore: false,
          error: error?.message ?? '事项目录读取失败，请重试。',
        }));
      }
    },
    [enabled, scope, search, workItemId, sessionGeneration],
  );
  useEffect(() => {
    void readPage();
    return () => controllerRef.current?.abort();
  }, [readPage, refreshRevision]);
  const visible = enabled && state?.scope === scope ? state : null;
  return {
    items: visible?.items ?? [],
    nextCursor: visible?.nextCursor ?? null,
    loading: visible?.loading ?? enabled,
    loadingMore: visible?.loadingMore ?? false,
    error: visible?.error ?? null,
    loadMore: (): void => {
      if (visible?.nextCursor && !visible.loading)
        void readPage(visible.nextCursor);
    },
  };
}
