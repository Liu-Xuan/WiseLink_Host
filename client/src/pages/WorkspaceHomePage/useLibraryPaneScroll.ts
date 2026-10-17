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

/** One synchronous snapshot also lets directory controls preserve same-tick pane positions. */
export function useLibraryReadingParams(session: number) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const shared = useContext(PositionContext);
  const local = useRef<PositionState>({ locationKey: location.key, params, session });
  const state = shared ?? local;
  if (state.current.locationKey !== location.key || state.current.session !== session) {
    state.current = { locationKey: location.key, params, session };
  }
  const update = (change: (next: URLSearchParams) => void): void => {
    if (state.current.session !== session) return;
    const next = new URLSearchParams(state.current.params);
    change(next);
    if (next.toString() === state.current.params.toString()) return;
    state.current.params = next;
    setParams(next, { replace: true, preventScrollReset: true });
  };
  return { params, state, update };
}

/** Each reading pane owns its position; no delayed write may cross a selection. */
export function useLibraryPaneScroll<T extends HTMLElement>(
  key: 'listY' | 'quicklookY',
  ready: boolean,
  session: number,
) {
  const { params, state, update } = useLibraryReadingParams(session);
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
    update(next => {
      if (top === '0') next.delete(key);
      else next.set(key, top);
    });
  };
  return { ref, onScroll };
}
