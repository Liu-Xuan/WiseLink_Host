import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useLibraryDefaultSelection(
  mode: 'matter' | 'document' | 'tasks',
  firstId: string | undefined,
  loading: boolean,
  hasError: boolean,
  authenticationRequired: boolean,
): void {
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    if (mode === 'tasks' || loading || hasError || authenticationRequired || !firstId)
      return;
    const key: string = mode === 'matter' ? 'selectedMatterId' : 'familyId';
    if (params.get(key)?.trim()) return;
    // A version-only deep link is incomplete, but must not silently pick another document.
    if (mode === 'document' && params.get('selectedDocumentVersionId')?.trim())
      return;
    const next: URLSearchParams = new URLSearchParams(params);
    next.set('mode', mode);
    next.set(key, firstId);
    setParams(next, { replace: true });
  }, [authenticationRequired, firstId, hasError, loading, mode, params, setParams]);
}
