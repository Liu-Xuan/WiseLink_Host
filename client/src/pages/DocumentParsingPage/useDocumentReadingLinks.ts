import { useCallback, useEffect, useState } from 'react';
import {
  getCanonicalHostClientSessionGeneration,
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
export function useDocumentReadingLinks(status: DocumentParsingStatus | null, refresh: number, readingScope = '') {
  const [session, setSession] = useState(getCanonicalHostClientSessionGeneration);
  const [retry, setRetry] = useState(0);
  const [snapshot, setSnapshot] = useState<LinksSnapshot | null>(null);
  const identity: string = JSON.stringify([
    status?.documentVersionId, status?.familyId, status?.documentCode,
    status?.normalizedFamily, readingScope, session, refresh, retry,
  ]);
  const refreshSavedWork = useCallback(() => {
    setSnapshot(null); setRetry(value => value + 1);
  }, []);
  useEffect(() => {
    window.addEventListener('focus', refreshSavedWork);
    return () => window.removeEventListener('focus', refreshSavedWork);
  }, [refreshSavedWork]);
  useEffect(() => subscribeCanonicalHostClientSession(() => {
    setSnapshot(null);
    setSession(getCanonicalHostClientSessionGeneration());
  }), []);
  useEffect(() => {
    setSnapshot(null);
    if (!status) return;
    const controller: AbortController = new AbortController();
    const generation: number = getCanonicalHostClientSessionGeneration();
    const current = (): boolean => !controller.signal.aborted &&
      generation === getCanonicalHostClientSessionGeneration();
    void readDocumentReadingLinks(status, controller.signal).then((links: DocumentReadingLinks) => {
      if (current()) setSnapshot({ identity, links });
    }).catch((reason: unknown) => {
      if (!current()) return;
      const error: string = reason instanceof Error ? reason.message : '评估关联读取未完成，请刷新重试。';
      setSnapshot({ identity, links: {
        ...EMPTY_DOCUMENT_READING_LINKS, assessmentNote: error, wikiNote: error, error,
      } });
    });
    return () => controller.abort();
  }, [identity]);
  const links = snapshot?.identity === identity && session === getCanonicalHostClientSessionGeneration()
    ? snapshot.links : EMPTY_DOCUMENT_READING_LINKS;
  const rejectSavedWork = useCallback((error: string): void => setSnapshot({ identity, links: {
    ...EMPTY_DOCUMENT_READING_LINKS, assessmentNote: error, wikiNote: error, error,
  } }), [identity]);
  return { ...links, loading: Boolean(status && snapshot?.identity !== identity),
    scopeIdentity: identity, refreshSavedWork, rejectSavedWork };
}
