import { useCallback, useEffect, useRef, useState } from 'react';
import { getCanonicalHostClientSessionGeneration } from '@client/src/api/canonical-host';

/** One authorized page per explicit action; no background full-directory scan. */
export function useSuiteGraphDirectoryPage<T>(enabled: boolean, session: number,
  load: (cursor: string | undefined, signal: AbortSignal) => Promise<{ items: T[]; nextCursor?: string | null }>,
  keyOf: (item: T) => string,
) {
  const [state, setState] = useState<{items: T[]; nextCursor: string | null; loaded: boolean; loading: boolean; error: string | null}>({items: [], nextCursor: null, loaded: false, loading: false, error: null});
  const stateRef = useRef(state); stateRef.current = state;
  const controller = useRef<AbortController | null>(null);
  const lastCursor = useRef<string | undefined>(undefined);
  const request = useCallback((cursor?: string) => {
    if (!enabled) return;
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    lastCursor.current = cursor;
    setState(previous => ({...previous, loading: true, error: null}));
    void load(cursor, current.signal).then(page => {
      if (current.signal.aborted || getCanonicalHostClientSessionGeneration() !== session) return;
      setState(previous => {
        const items = new Map((cursor ? previous.items : []).map(item => [keyOf(item), item]));
        page.items.forEach(item => items.set(keyOf(item), item));
        return {items: [...items.values()], nextCursor: page.nextCursor ?? null, loaded: true, loading: false, error: null};
      });
    }).catch((cause: unknown) => {
      if (current.signal.aborted || getCanonicalHostClientSessionGeneration() !== session) return;
      // A failed authorization must not leave the previously delivered page visible.
      lastCursor.current = undefined;
      setState({items: [], nextCursor: null, loaded: false, loading: false, error: cause instanceof Error ? cause.message : '读取授权目录失败。'});
    });
  }, [enabled, session, load, keyOf]);
  useEffect(() => {
    if (enabled && !stateRef.current.loaded && !stateRef.current.error) request();
    return () => { controller.current?.abort(); setState(previous => previous.loading ? {...previous, loading: false} : previous); };
  }, [enabled, request]);
  return {...state, retry: () => request(lastCursor.current), loadMore: () => {
    if (!state.loading && state.nextCursor) request(state.nextCursor);
  }};
}
