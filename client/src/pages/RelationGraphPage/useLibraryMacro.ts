import { useEffect, useState } from 'react';
import type { CanonicalLibraryGraphRequest } from '@shared/library-graph.interface';
import { getCanonicalHostClientSessionGeneration } from '@client/src/api/canonical-host';
import { libraryReadErrorPresentation } from '../WorkspaceHomePage/library-read-error';
import { readLibraryMacro, type LibraryMacroRead } from './library-macro-read';

export function useLibraryMacro(request: CanonicalLibraryGraphRequest, session: number, denied: boolean) {
  const key = JSON.stringify([request, session]);
  const [state, setState] = useState<{ key: string; read: LibraryMacroRead | null; error: string | null }>({ key, read: null, error: null });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ key, read: null, error: denied ? '请先登录，再读取当前账户可访问的图谱。' : null });
    if (!denied) void readLibraryMacro(request, controller.signal).then(read => {
      if (!controller.signal.aborted && getCanonicalHostClientSessionGeneration() === session) setState({ key, read, error: null });
    }).catch(reason => {
      if (!controller.signal.aborted && getCanonicalHostClientSessionGeneration() === session) setState({ key, read: null, error: libraryReadErrorPresentation(reason).message });
    });
    return () => controller.abort();
  }, [key, retry, denied, session]);
  return { read: !denied && state.key === key ? state.read : null, error: state.key === key ? state.error : null, refresh: () => setRetry(value => value + 1) };
}
