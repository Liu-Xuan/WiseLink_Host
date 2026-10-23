import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getCanonicalHostClientSessionGeneration,
  getDocumentParsingPage,
  isCanonicalHostClientSessionAuthenticationRequired,
  requireCanonicalHostClientAuthentication,
} from '@client/src/api/canonical-host';
import { useWorkbenchPanelActive } from '@client/src/features/workbench/RetainedWorkbenchPanel';
import type { CanonicalDocumentParsingPageResponse, CanonicalLibraryQuicklookResponse } from '@shared/api.interface';
import { assertDocumentReadingVersion } from './document-parsing-load';
import { isTemporaryJobAidReadFailure } from './useJobAidWorkingRead';

/** Quicklook supplies an exact association; this independent read authorizes the workspace. */
export function useDocumentAssessmentPage(input: {
  association: CanonicalLibraryQuicklookResponse;
  documentVersionId: string;
  sessionGeneration: number;
  associationRefreshing: boolean;
  wikiError?: string | null;
  onRejected(message: string): void;
}) {
  const active: boolean = useWorkbenchPanelActive();
  const workItemId: string = input.association.document.workItemId;
  const scope: string = JSON.stringify([input.sessionGeneration, input.documentVersionId, workItemId]);
  const epoch = useRef(0);
  const latest = useRef({ scope, onRejected: input.onRejected });
  latest.current = { scope, onRejected: input.onRejected };
  const [state, setState] = useState<{
    scope: string; page: CanonicalDocumentParsingPageResponse | null; loading: boolean; error: string | null;
    association?: CanonicalLibraryQuicklookResponse; wikiError?: string | null;
  }>({ scope, page: null, loading: true, error: null });

  const reject = useCallback((message: string): void => {
    epoch.current++;
    setState({ scope, page: null, loading: false, error: message });
    latest.current.onRejected(message);
  }, [scope]);

  const refresh = useCallback(async (fresh?: CanonicalDocumentParsingPageResponse): Promise<void> => {
    const readingEpoch: number = ++epoch.current;
    const current = (): boolean => readingEpoch === epoch.current && latest.current.scope === scope &&
      input.sessionGeneration === getCanonicalHostClientSessionGeneration() &&
      !isCanonicalHostClientSessionAuthenticationRequired();
    if (!current()) return;
    setState(previous => ({ scope, page: previous.scope === scope ? previous.page : null, loading: true, error: null }));
    try {
      const response: CanonicalDocumentParsingPageResponse = fresh ??
        await getDocumentParsingPage(workItemId, '', { freshness: 'mutation' });
      if (!current()) return;
      assertDocumentReadingVersion(response, workItemId, input.documentVersionId);
      if (input.association.document.documentVersionId !== input.documentVersionId) throw new Error('评估关联与文档版本不一致。');
      setState({ scope, page: response, loading: false, error: null,
        association: input.association, wikiError: input.wikiError });
    } catch (reason: unknown) {
      if (!current()) return;
      const failure = reason as { statusCode?: number; code?: string };
      const message: string = reason instanceof Error ? reason.message : '评估工作暂未读回，请重试。';
      if (failure.statusCode === 401) {
        requireCanonicalHostClientAuthentication(input.sessionGeneration);
        return;
      }
      if (!isTemporaryJobAidReadFailure(failure)) {
        reject(message);
        return;
      }
      setState(previous => ({ scope, page: previous.scope === scope ? previous.page : null, loading: false, error: message }));
    }
  }, [scope, workItemId, input.documentVersionId, input.sessionGeneration, input.association, input.wikiError, reject]);

  useEffect(() => {
    if (!active || input.associationRefreshing) return;
    void refresh();
    return () => { epoch.current++; };
  }, [active, input.association, input.associationRefreshing, input.wikiError, refresh]);
  useEffect(() => () => { epoch.current++; }, []);

  const page: CanonicalDocumentParsingPageResponse | null = state.scope === scope &&
    input.sessionGeneration === getCanonicalHostClientSessionGeneration() &&
    !isCanonicalHostClientSessionAuthenticationRequired() ? state.page : null;
  const refreshing: boolean = input.associationRefreshing || state.loading;
  return { page, refreshing, error: state.scope === scope ? state.error : null,
    verified: Boolean(page && !refreshing && !state.error && state.association === input.association && state.wikiError === input.wikiError), refresh, reject };
}
