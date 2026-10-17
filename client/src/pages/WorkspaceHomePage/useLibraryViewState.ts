import { useRef } from 'react';
import { libraryReadingParams } from '@client/src/features/matter/reading-return';
import { libraryViewMode, type LibraryViewMode } from './library-view-mode';
import { LIBRARY_DIRECTORY_READING_KEYS } from '@client/src/features/matter/library-directory-reading';

const SHARED_DIRECTORY_KEYS = [
  'ata', 'ata2', 'ata4', 'aircraftModel', 'aircraftModels',
  'fleetFamily', 'fleetModel', 'ataTitleScheme',
] as const;

interface LibraryViewState {
  session: number;
  directoryScope: string;
  views: Partial<Record<LibraryViewMode, URLSearchParams>>;
}

/** Only mounted-page reading state; business data and authorization stay in their readers. */
export function useLibraryViewState(params: URLSearchParams, session: number) {
  const mode: LibraryViewMode = libraryViewMode(params);
  const readingParams = new URLSearchParams(params);
  readingParams.set('mode', mode);
  const safe: URLSearchParams = libraryReadingParams(readingParams);
  const directoryScope: string = JSON.stringify(SHARED_DIRECTORY_KEYS.map(key => safe.get(key)));
  const state = useRef<LibraryViewState>({ session, directoryScope, views: {} });
  if (state.current.session !== session) state.current = { session, directoryScope, views: {} };
  if (state.current.directoryScope !== directoryScope) {
    for (const view of Object.values(state.current.views)) {
      for (const key of ['familyId', 'selectedDocumentVersionId', 'selectedMatterId', 'listY', 'quicklookY']) view.delete(key);
    }
    state.current.directoryScope = directoryScope;
  }
  state.current.views[mode] = safe;

  const viewParams = (target: LibraryViewMode): URLSearchParams => {
    const next = new URLSearchParams(state.current.views[target] ?? { mode: target });
    next.set('mode', target);
    for (const key of [...SHARED_DIRECTORY_KEYS, ...LIBRARY_DIRECTORY_READING_KEYS]) {
      const value: string | null = safe.get(key);
      if (value) next.set(key, value);
      else next.delete(key);
    }
    // A document identity is never a matter selection, and vice versa.
    if (target !== 'document') {
      next.delete('selectedDocumentVersionId');
      next.delete('expandedFamilyIds');
    }
    if (target === 'matter') next.delete('familyId');
    if (target !== 'matter') next.delete('selectedMatterId');
    if (target === 'document') next.delete('workItemId');
    return next;
  };

  const switchParams = (target: LibraryViewMode): URLSearchParams => {
    const next = new URLSearchParams(params);
    // Keep validated return intents carried by the shell; replace only directory state.
    for (const key of libraryReadingParams(params).keys()) next.delete(key);
    for (const key of ['familyId', 'selectedDocumentVersionId', 'selectedMatterId', 'workItemId']) next.delete(key);
    for (const [key, value] of viewParams(target)) next.set(key, value);
    return next;
  };

  return {
    viewParams,
    switchParams,
    visited: (target: LibraryViewMode): boolean => Boolean(state.current.views[target]),
  };
}
