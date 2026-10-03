import { useEffect, useState } from 'react';
import { getCanonicalHostClientSessionGeneration } from '@client/src/api/canonical-host';

export function useSummaryResource<T>(key: string, session: number, load: (signal: AbortSignal) => Promise<T>) {
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ key: string; data: T | null; loading: boolean; error: string | null } | null>(null);
  useEffect(() => {
    const request = new AbortController();
    const active = () => !request.signal.aborted && session === getCanonicalHostClientSessionGeneration();
    setState({ key, data: null, loading: true, error: null });
    void load(request.signal).then(data => {
      if (active()) setState({ key, data, loading: false, error: null });
    }).catch((reason: unknown) => {
      if (active()) setState({ key, data: null, loading: false, error: reason instanceof Error ? reason.message : '读取未完成，请重新核对。' });
    });
    return () => request.abort();
  }, [key, session, load, retry]);
  const current = state?.key === key && session === getCanonicalHostClientSessionGeneration() ? state : null;
  useEffect(() => {
    const refresh = () => { setState(null); setRetry(value => value + 1); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  return { data: current?.data ?? null, loading: !current || current.loading, error: current?.error ?? null,
    refresh: () => { setState(null); setRetry(value => value + 1); } };
}
