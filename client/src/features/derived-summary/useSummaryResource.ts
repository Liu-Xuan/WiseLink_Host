import { useCallback, useEffect, useRef, useState } from 'react';
import { getCanonicalHostClientSessionGeneration } from '@client/src/api/canonical-host';
import { isTemporarySummaryReadError } from './summary-read-error';

interface SummaryResourceOptions {
  preserveWhileLoading?: boolean;
  preserveAfterTemporaryError?: boolean;
  pollIntervalMs?: number;
  enabled?: boolean;
  visible?: boolean;
  refreshOnFocus?: boolean;
}

export function useSummaryResource<T>(key: string, session: number, load: (signal: AbortSignal) => Promise<T>,
  options: SummaryResourceOptions = {}) {
  const enabled = options.enabled !== false, visible = options.visible !== false;
  const preserve = Boolean(options.preserveWhileLoading || options.preserveAfterTemporaryError);
  // Only rejection keys are remembered, never another copy of saved prose.
  // A later transport failure must not restore a preview denied in this session.
  const withheld = useRef({ session, keys: new Set<string>() });
  if (withheld.current.session !== session) withheld.current = { session, keys: new Set<string>() };
  if (!visible) withheld.current.keys.add(key);
  const scope = useRef({ key, session, visible, revision: 0 });
  if (scope.current.key !== key || scope.current.session !== session || scope.current.visible !== visible)
    scope.current = { key, session, visible, revision: scope.current.revision + 1 };
  const scopeRevision = scope.current.revision;
  const [retry, setRetry] = useState(0);
  const inFlight = useRef<AbortController | null>(null);
  const [state, setState] = useState<{ key: string; session: number; scopeRevision: number; data: T | null;
    loading: boolean; error: string | null; temporaryError: boolean; retainedAfterError: boolean } | null>(null);
  const refresh = useCallback(() => {
    if (inFlight.current || !visible || scope.current.key !== key ||
      session !== getCanonicalHostClientSessionGeneration()) return;
    if (!preserve) setState(null);
    setRetry(value => value + 1);
  }, [key, session, visible, preserve]);
  useEffect(() => {
    if (!visible) { setState(null); return; }
    if (!enabled) {
      setState(prior => prior?.key === key && prior.session === session && prior.scopeRevision === scopeRevision
        ? { ...prior, loading: false } : null);
      return;
    }
    const request = new AbortController();
    inFlight.current = request;
    const active = () => !request.signal.aborted && scope.current.revision === scopeRevision &&
      scope.current.visible && session === getCanonicalHostClientSessionGeneration();
    setState(prior => preserve && prior?.key === key && prior.session === session && prior.scopeRevision === scopeRevision
      ? { ...prior, loading: true, error: null, temporaryError: false, retainedAfterError: false }
      : { key, session, scopeRevision, data: null, loading: true, error: null,
        temporaryError: false, retainedAfterError: false });
    void load(request.signal).then(data => {
      if (!active()) return;
      withheld.current.keys.delete(key);
      setState({ key, session, scopeRevision, data, loading: false, error: null,
        temporaryError: false, retainedAfterError: false });
    }).catch((reason: unknown) => {
      if (!active()) return;
      const temporaryError = isTemporarySummaryReadError(reason);
      if (!temporaryError) withheld.current.keys.add(key);
      setState(prior => {
        const data = options.preserveAfterTemporaryError && temporaryError &&
          prior?.key === key && prior.session === session && prior.scopeRevision === scopeRevision
          ? prior.data : null;
        return { key, session, scopeRevision, data, loading: false, temporaryError,
          retainedAfterError: data !== null,
          error: reason instanceof Error ? reason.message : '读取未完成，请重新核对。' };
      });
    }).finally(() => {
      if (inFlight.current === request) inFlight.current = null;
    });
    return () => {
      request.abort();
      if (inFlight.current === request) inFlight.current = null;
    };
  }, [key, session, scopeRevision, visible, enabled, load, retry, preserve, options.preserveAfterTemporaryError]);
  useEffect(() => {
    if (!options.pollIntervalMs) return;
    const timer = window.setInterval(() => {
      // A slow hierarchical read must finish before another poll can replace it.
      if (document.visibilityState === 'visible') refresh();
    }, options.pollIntervalMs);
    return () => window.clearInterval(timer);
  }, [options.pollIntervalMs, refresh]);
  const current = visible && state?.key === key && state.session === session && state.scopeRevision === scopeRevision &&
    session === getCanonicalHostClientSessionGeneration() ? state : null;
  useEffect(() => {
    if (options.refreshOnFocus === false) return;
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh, options.refreshOnFocus]);
  return { data: current?.data ?? null, loading: visible && enabled && (!current || current.loading),
    error: current?.error ?? null, temporaryError: current?.temporaryError ?? false,
    retainedAfterError: current?.retainedAfterError ?? false, withheld: withheld.current.keys.has(key), refresh };
}
