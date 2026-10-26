import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getCanonicalHostClientSessionGeneration,
  isCanonicalHostClientSessionAuthenticationRequired,
  requireCanonicalHostClientAuthentication,
  subscribeCanonicalHostClientSession,
} from '@client/src/api/canonical-host';
import type { DocumentParsingStatus } from '@shared/document-parsing.interface';
import {
  EMPTY_DOCUMENT_READING_LINKS,
  readDocumentReadingLinks,
  type DocumentReadingLinks,
} from './document-reading-links';

interface LinksSnapshot {
  identity: string;
  links: DocumentReadingLinks;
}

/** Keep related saved views inside the same version and browser session. */
export function useDocumentReadingLinks(status: DocumentParsingStatus | null, refresh: number, readingScope = '',
  locator: { workItemId: string | null; error: string | null } = { workItemId: null, error: null }) {
  const [session, setSession] = useState(getCanonicalHostClientSessionGeneration);
  const [retry, setRetry] = useState(0);
  const [snapshot, setSnapshot] = useState<LinksSnapshot | null>(null);
  const [loadingIdentity, setLoadingIdentity] = useState<string | null>(null);
  const epoch = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const identity: string = JSON.stringify([
    status?.documentVersionId, status?.familyId, status?.documentCode,
    status?.normalizedFamily, session, locator.workItemId, locator.error,
  ]);
  const refreshSavedWork = useCallback(() => {
    setRetry(value => value + 1);
  }, []);
  useEffect(() => {
    window.addEventListener('focus', refreshSavedWork);
    return () => window.removeEventListener('focus', refreshSavedWork);
  }, [refreshSavedWork]);
  useEffect(() => subscribeCanonicalHostClientSession(() => {
    epoch.current++; controllerRef.current?.abort();
    setSnapshot(null);
    setLoadingIdentity(null);
    setSession(getCanonicalHostClientSessionGeneration());
  }), []);
  useEffect(() => {
    if (!status || isCanonicalHostClientSessionAuthenticationRequired()) return;
    if (locator.error) {
      setLoadingIdentity(null);
      setSnapshot({ identity, links: { ...EMPTY_DOCUMENT_READING_LINKS,
        assessmentNote: locator.error, wikiNote: locator.error, error: locator.error } });
      return;
    }
    const controller: AbortController = new AbortController();
    controllerRef.current = controller;
    const readingEpoch: number = ++epoch.current;
    setLoadingIdentity(identity);
    const generation: number = getCanonicalHostClientSessionGeneration();
    const current = (): boolean => !controller.signal.aborted &&
      readingEpoch === epoch.current &&
      generation === getCanonicalHostClientSessionGeneration();
    const receive = (links: DocumentReadingLinks): void => {
      if (!current()) return;
      setSnapshot({ identity, links });
      setLoadingIdentity(null);
    };
    void readDocumentReadingLinks(status, controller.signal, receive, locator.workItemId ?? undefined).then((links: DocumentReadingLinks) => {
      receive(links);
    }).catch((reason: unknown) => {
      if (!current()) return;
      const statusCode: number | null = reason && typeof reason === 'object' && 'statusCode' in reason
        ? Number(reason.statusCode) : null;
      if (statusCode === 401) {
        requireCanonicalHostClientAuthentication(generation);
        return;
      }
      const error: string = reason instanceof Error ? reason.message : '评估关联读取未完成，请刷新重试。';
      setLoadingIdentity(null);
      setSnapshot({ identity, links: {
        ...EMPTY_DOCUMENT_READING_LINKS, assessmentNote: error, wikiNote: error, error,
      } });
    });
    return () => { controller.abort(); };
  }, [identity, readingScope, refresh, retry]);
  const links = status && !isCanonicalHostClientSessionAuthenticationRequired() &&
    snapshot?.identity === identity && session === getCanonicalHostClientSessionGeneration()
    ? snapshot.links : EMPTY_DOCUMENT_READING_LINKS;
  const rejectSavedWork = useCallback((error: string): void => {
    epoch.current++; controllerRef.current?.abort(); setLoadingIdentity(null);
    setSnapshot({ identity, links: {
      ...EMPTY_DOCUMENT_READING_LINKS, assessmentNote: error, wikiNote: error, error,
    } });
  }, [identity]);
  const rejectWiki = useCallback((error: string): void => {
    epoch.current++; controllerRef.current?.abort(); setLoadingIdentity(null);
    setSnapshot(previous => previous?.identity === identity ? { identity, links: {
      ...previous.links, knowledge: undefined, wikiRoute: null, wikiLoading: false, wikiError: error, wikiNote: error,
    } } : previous);
  }, [identity]);
  return { ...links, loading: Boolean(status && (snapshot?.identity !== identity || loadingIdentity === identity)),
    scopeIdentity: JSON.stringify([session, status?.documentVersionId]), sessionGeneration: session,
    refreshSavedWork, rejectSavedWork, rejectWiki };
}
