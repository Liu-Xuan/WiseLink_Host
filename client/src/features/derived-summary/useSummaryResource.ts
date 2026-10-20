import { useCallback, useEffect, useRef, useState } from 'react';
import { getCanonicalHostClientSessionGeneration } from '@client/src/api/canonical-host';

export function useSummaryResource<T>(key: string, session: number, load: (signal: AbortSignal) => Promise<T>,
  options: { preserveWhileLoading?: boolean; pollIntervalMs?: number } = {}) {
  const [retry, setRetry] = useState(0);
  const inFlight = useRef<AbortController | null>(null);
  const [state, setState] = useState<{ key: string; session: number; data: T | null; loading: boolean; error: string | null } | null>(null);
  const refresh = useCallback(() => {
    if (inFlight.current || session !== getCanonicalHostClientSessionGeneration()) return;
    if (!options.preserveWhileLoading) setState(null);
    setRetry(value => value + 1);
  }, [session, options.preserveWhileLoading]);
  useEffect(() => {
    const request = new AbortController();
    inFlight.current = request;
    const active = () => !request.signal.aborted && session === getCanonicalHostClientSessionGeneration();
    setState(prior => options.preserveWhileLoading && prior?.key === key && prior.session === session ? { ...prior, loading: true, error: null }
      : { key, session, data: null, loading: true, error: null });
    void load(request.signal).then(data => {
      if (active()) setState({ key, session, data, loading: false, error: null });
    }).catch((reason: unknown) => {
      if (active()) setState({ key, session, data: null, loading: false, error: reason instanceof Error ? reason.message : '读取未完成，请重新核对。' });
    }).finally(() => {
      if (inFlight.current === request) inFlight.current = null;
    });
    return () => {
      request.abort();
      if (inFlight.current === request) inFlight.current = null;
    };
  }, [key, session, load, retry, options.preserveWhileLoading]);
  useEffect(() => {
    if (!options.pollIntervalMs) return;
    const timer = window.setInterval(() => {
      // A slow hierarchical read must finish before another poll can replace it.
      if (document.visibilityState === 'visible') refresh();
    }, options.pollIntervalMs);
    return () => window.clearInterval(timer);
  }, [options.pollIntervalMs, refresh]);
  const current = state?.key === key && state.session === session && session === getCanonicalHostClientSessionGeneration() ? state : null;
  useEffect(() => {
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);
  return { data: current?.data ?? null, loading: !current || current.loading, error: current?.error ?? null,
    refresh };
}
