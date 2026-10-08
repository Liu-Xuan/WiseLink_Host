import { useEffect, useState } from 'react';
import { getCanonicalHostClientSessionGeneration } from '@client/src/api/canonical-host';
import { libraryReadErrorPresentation } from '@client/src/pages/WorkspaceHomePage/library-read-error';
import { readDocumentNeighborhood, type DocumentNeighborhoodRead, type DocumentNeighborhoodRequest } from './document-neighborhood-read';

/** Identity, request and session guards drop late reads even if an endpoint cannot abort. */
export function useDocumentNeighborhood(request: DocumentNeighborhoodRequest, session: number, denied: boolean) {
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify([request.documentVersionId, request.readerWorkItemId ?? null,
    request.familyCursor ?? null, request.matterCursor ?? null, session, denied, retry]);
  const [state, setState] = useState<{key: string; read: DocumentNeighborhoodRead | null; error: string | null}>({ key: '', read: null, error: null });
  useEffect(() => {
    if (denied) { setState({ key, read: null, error: null }); return; }
    const controller = new AbortController();
    setState({ key, read: null, error: null });
    const current = () => !controller.signal.aborted && getCanonicalHostClientSessionGeneration() === session;
    void readDocumentNeighborhood(request, controller.signal).then(read => {
      if (current()) setState({ key, read, error: null });
    }).catch(reason => {
      if (current()) setState({ key, read: null, error: libraryReadErrorPresentation(reason).message });
    });
    return () => controller.abort();
  }, [key, denied, session]); // key contains every exact request field.
  const visible = !denied && state.key === key ? state : null;
  return { read: visible?.read ?? null, loading: !denied && !visible?.read && !visible?.error,
    error: denied ? '请先登录以读取授权文档。' : visible?.error ?? null,
    refresh: () => setRetry(value => value + 1) };
}
