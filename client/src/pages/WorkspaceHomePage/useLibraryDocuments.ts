import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getCanonicalHostClientSessionGeneration,
  getCanonicalLibraryDocuments,
  isCanonicalObjectNotFound,
} from '@client/src/api/canonical-host';
import { libraryReadErrorPresentation } from './library-read-error';
import {
  beginLibraryDocumentsRead,
  mergeLibraryDocumentsRead,
  type LibraryDocumentsRead,
} from './library-document-read';

export function useLibraryDocuments(
  search: string,
  sessionGeneration: number,
  authenticationRequired: boolean,
  refreshRevision: number,
) {
  const [read, setRead] = useState<LibraryDocumentsRead | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const discardedRef = useRef<Set<string>>(new Set());
  const readPage = useCallback(
    async (cursor?: string): Promise<void> => {
      controllerRef.current?.abort();
      if (authenticationRequired) return;
      if (!cursor) discardedRef.current = new Set();
      const controller: AbortController = new AbortController();
      controllerRef.current = controller;
      const current = (): boolean =>
        !controller.signal.aborted &&
        getCanonicalHostClientSessionGeneration() === sessionGeneration;
      const empty: LibraryDocumentsRead = {
        search,
        sessionGeneration,
        items: [],
        nextCursor: null,
        loading: true,
        loadingMore: Boolean(cursor),
        error: null,
      };
      setRead((prior: LibraryDocumentsRead | null) =>
        beginLibraryDocumentsRead(prior, empty),
      );
      try {
        const response = await getCanonicalLibraryDocuments(
          { search, ...(cursor ? { cursor } : {}), limit: 24 },
          controller.signal,
        );
        if (!current()) return;
        setRead((prior: LibraryDocumentsRead | null) =>
          mergeLibraryDocumentsRead(
            prior,
            empty,
            response,
            discardedRef.current,
          ),
        );
      } catch (reason: unknown) {
        if (!current()) return;
        setRead((prior: LibraryDocumentsRead | null) => ({
          ...(isCanonicalObjectNotFound(reason) ? empty : (prior ?? empty)),
          loading: false,
          loadingMore: false,
          error: libraryReadErrorPresentation(reason),
        }));
      }
    },
    [authenticationRequired, search, sessionGeneration],
  );

  useEffect(() => {
    void readPage();
    return () => controllerRef.current?.abort();
  }, [readPage, refreshRevision]);

  const visible =
    !authenticationRequired &&
    read?.sessionGeneration === sessionGeneration &&
    read.search === search
      ? read
      : null;
  const discard = useCallback((workItemId: string): void => {
    discardedRef.current.add(workItemId);
    setRead((prior: LibraryDocumentsRead | null) =>
      prior
        ? {
            ...prior,
            items: prior.items.filter((item) => item.workItemId !== workItemId),
          }
        : null,
    );
  }, []);
  return {
    items: visible?.items ?? [],
    nextCursor: visible?.nextCursor ?? null,
    loading: visible?.loading ?? !authenticationRequired,
    loadingMore: visible?.loadingMore ?? false,
    error: visible?.error ?? null,
    discard,
    loadMore: (): void => {
      if (visible?.nextCursor && !visible.loading)
        void readPage(visible.nextCursor);
    },
  };
}
