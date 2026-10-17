import { useCallback, useEffect, useLayoutEffect, useRef, useState, type UIEvent } from 'react';
import {
  clearLibraryDirectoryReading,
  libraryDirectoryNodeState,
  libraryDirectoryReadingParams,
  LIBRARY_DIRECTORY_READING_KEYS,
} from '@client/src/features/matter/library-directory-reading';
import { useLibraryReadingParams } from './useLibraryPaneScroll';

function directoryDisplaySnapshot(params: URLSearchParams): string {
  return JSON.stringify(LIBRARY_DIRECTORY_READING_KEYS.map((key: string) => params.getAll(key)));
}

/** URL display state only; every remount still reads the current authorized directory. */
export function useLibraryDirectoryReading(
  scope: string, session: number, refresh: number, authenticationRequired: boolean,
) {
  const { params, update } = useLibraryReadingParams(session);
  const boundary: string = JSON.stringify([scope, session, refresh, authenticationRequired]);
  const raw: string = directoryDisplaySnapshot(params);
  const previous = useRef<{ boundary: string; rejected: string | null }>({ boundary, rejected: null });
  if (previous.current.boundary !== boundary) previous.current = { boundary, rejected: raw };
  else if (previous.current.rejected !== raw) previous.current.rejected = null;
  const safe: URLSearchParams = libraryDirectoryReadingParams(params);
  const valid: boolean = !authenticationRequired && previous.current.rejected !== raw &&
    safe.get('directorySession') === String(session);
  const [readyBoundary, setReadyBoundary] = useState<string>('');
  const ready: boolean = !authenticationRequired && readyBoundary === boundary;
  const latest = useRef({ raw, update });
  latest.current = { raw, update };
  useEffect(() => {
    if (!valid) update(clearLibraryDirectoryReading);
  }, [boundary, raw, valid]);
  const onReadyChange = useCallback((value: boolean): void => {
    setReadyBoundary(value ? boundary : '');
  }, [boundary]);
  const onAccessRejected = useCallback((): void => {
    previous.current.rejected = latest.current.raw;
    latest.current.update(clearLibraryDirectoryReading);
    setReadyBoundary('');
  }, []);
  const expandedNodes: Record<string, boolean> = valid
    ? libraryDirectoryNodeState(safe.get('directoryNodes') ?? '') ?? {} : {};
  const onNodeChange = (node: string, open: boolean): void => {
    if (authenticationRequired) return;
    update(next => {
      const nodes: Record<string, boolean> = next.get('directorySession') === String(session) &&
        previous.current.rejected !== directoryDisplaySnapshot(next)
        ? libraryDirectoryNodeState(next.get('directoryNodes') ?? '') ?? {} : {};
      nodes[node] = open;
      next.set('directorySession', String(session));
      next.set('directoryNodes', Object.keys(nodes).sort().map((key: string) => `${key}:${nodes[key] ? '1' : '0'}`).join(','));
    });
  };
  const ref = useRef<HTMLElement>(null);
  const restored = useRef<string>('');
  const y: number = valid ? Number(safe.get('directoryY') ?? 0) : 0;
  useLayoutEffect(() => {
    restored.current = '';
    if (!ready || !ref.current) return;
    ref.current.scrollTop = y;
    restored.current = boundary;
  }, [boundary, ready, y]);
  const onScroll = (event: UIEvent<HTMLElement>): void => {
    if (!ready || restored.current !== boundary) return;
    const y: string = String(Math.min(9999999, Math.max(0, Math.round(event.currentTarget.scrollTop))));
    update(next => {
      next.set('directorySession', String(session));
      if (y === '0') next.delete('directoryY');
      else next.set('directoryY', y);
    });
  };
  return { ref, onScroll, navigation: { expandedNodes, onNodeChange, onReadyChange, onAccessRejected } };
}
