import { useEffect, useState } from 'react';

import type { CanonicalLibraryQuicklookResponse } from '@shared/api.interface';
import {
  getCanonicalHostClientSessionGeneration,
  getCanonicalLibraryQuicklook,
  isCanonicalObjectNotFound,
} from '@client/src/api/canonical-host';
import {
  libraryReadErrorPresentation,
  type LibraryReadErrorPresentation,
} from './library-read-error';

interface LibraryQuicklookRead {
  workItemId: string;
  sessionGeneration: number;
  response: CanonicalLibraryQuicklookResponse | null;
  loading: boolean;
  accessDenied: boolean;
  error: LibraryReadErrorPresentation | null;
}

export function useLibraryQuicklook(
  workItemId: string,
  sessionGeneration: number,
  authenticationRequired: boolean,
  refreshRevision: number,
) {
  const [read, setRead] = useState<LibraryQuicklookRead | null>(null);
  useEffect(() => {
    if (!workItemId || authenticationRequired) return;
    const controller: AbortController = new AbortController();
    const current = (): boolean =>
      !controller.signal.aborted &&
      getCanonicalHostClientSessionGeneration() === sessionGeneration;
    const empty: LibraryQuicklookRead = {
      workItemId,
      sessionGeneration,
      response: null,
      loading: true,
      error: null,
      accessDenied: false,
    };
    setRead((prior: LibraryQuicklookRead | null) => ({
      ...(prior?.workItemId === workItemId &&
      prior.sessionGeneration === sessionGeneration
        ? prior
        : empty),
      loading: true,
      error: null,
      accessDenied: false,
    }));
    void getCanonicalLibraryQuicklook(workItemId, controller.signal)
      .then((response: CanonicalLibraryQuicklookResponse) => {
        if (!current()) return;
        if (response.document.workItemId !== workItemId) {
          throw new Error('CANONICAL_LIBRARY_QUICKLOOK_BINDING_MISMATCH');
        }
        setRead({ ...empty, response, loading: false });
      })
      .catch((reason: unknown) => {
        if (!current()) return;
        setRead((prior: LibraryQuicklookRead | null) => ({
          ...(isCanonicalObjectNotFound(reason) ? empty : (prior ?? empty)),
          loading: false,
          error: libraryReadErrorPresentation(reason),
          accessDenied: isCanonicalObjectNotFound(reason),
        }));
      });
    return () => controller.abort();
  }, [authenticationRequired, refreshRevision, sessionGeneration, workItemId]);

  const visible =
    !authenticationRequired &&
    read?.sessionGeneration === sessionGeneration &&
    read.workItemId === workItemId
      ? read
      : null;
  return {
    data: visible?.response ?? null,
    loading:
      Boolean(workItemId) && (visible?.loading ?? !authenticationRequired),
    error: visible?.error ?? null,
    accessDenied: visible?.accessDenied ?? false,
  };
}
