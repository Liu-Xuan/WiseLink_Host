import { createContext, createElement, useContext, useLayoutEffect, useRef, type ReactNode, type UIEvent } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { libraryReadingScope } from '@client/src/features/matter/reading-return';

type PositionState = { locationKey: string; params: URLSearchParams; session?: number };
const PositionContext = createContext<{ current: PositionState } | null>(null);

/** One synchronous URL snapshot for both panes, scoped to this mounted directory. */
export function LibraryPaneScrollProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const state = useRef<PositionState>({ locationKey: location.key, params: new URLSearchParams(location.search) });
  if (state.current.locationKey !== location.key) {
    state.current = { locationKey: location.key, params: new URLSearchParams(location.search) };
  }
  return createElement(PositionContext.Provider, { value: state }, children);
}

/** Each reading pane owns its position; no delayed write may cross a selection. */
export function useLibraryPaneScroll<T extends HTMLElement>(
  key: 'listY' | 'quicklookY',
  ready: boolean,
  session: number,
) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const shared = useContext(PositionContext);
  const local = useRef<PositionState>({ locationKey: location.key, params, session });
  const state = shared ?? local;
  if (state.current.locationKey !== location.key || state.current.session !== session) {
    state.current = { locationKey: location.key, params, session };
  }
  const ref = useRef<T>(null);
  const scope = libraryReadingScope(params);
  const identity = `${session}:${scope}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const restored = useRef('');
  const requestedY = params.getAll(key).length === 1 ? params.get(key) ?? '' : '';
  const y = /^\d{1,7}$/.test(requestedY) ? Number(requestedY) : 0;
  useLayoutEffect(() => {
    restored.current = '';
    if (!ready || !ref.current) return;
    if (ref.current.scrollTop !== y) ref.current.scrollTop = y;
    restored.current = identity;
  }, [identity, ready, y]);
  const onScroll = (event: UIEvent<T>) => {
    if (!ready || restored.current !== identity || currentIdentity.current !== identity) return;
    const top = String(Math.min(9999999, Math.max(0, Math.round(event.currentTarget.scrollTop))));
    const previous = state.current.params;
    if (state.current.session !== session || libraryReadingScope(previous) !== scope) return;
    if (top === (previous.get(key) ?? '0')) return;
    const next = new URLSearchParams(previous);
    if (top === '0') next.delete(key);
    else next.set(key, top);
    state.current.params = next;
    setParams(next, { replace: true, preventScrollReset: true });
  };
  return { ref, onScroll };
}
