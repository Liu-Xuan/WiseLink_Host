import type {
  CanonicalLibraryDocumentSummary,
  CanonicalLibraryDocumentsResponse,
} from '@shared/api.interface';
import type { LibraryReadErrorPresentation } from './library-read-error';

export interface LibraryDocumentsRead {
  search: string;
  sessionGeneration: number;
  items: CanonicalLibraryDocumentSummary[];
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: LibraryReadErrorPresentation | null;
}

export function beginLibraryDocumentsRead(
  prior: LibraryDocumentsRead | null,
  empty: LibraryDocumentsRead,
): LibraryDocumentsRead {
  return {
    ...(prior?.sessionGeneration === empty.sessionGeneration &&
    prior.search === empty.search
      ? prior
      : empty),
    loading: true,
    loadingMore: empty.loadingMore,
    error: null,
  };
}

export function mergeLibraryDocumentsRead(
  prior: LibraryDocumentsRead | null,
  empty: LibraryDocumentsRead,
  response: CanonicalLibraryDocumentsResponse,
  discarded: Set<string>,
): LibraryDocumentsRead {
  const previous: CanonicalLibraryDocumentSummary[] =
    empty.loadingMore &&
    prior?.sessionGeneration === empty.sessionGeneration &&
    prior.search === empty.search
      ? prior.items
      : [];
  const seen: Set<string> = new Set(discarded);
  const items: CanonicalLibraryDocumentSummary[] = [];
  for (const item of [...previous, ...response.items]) {
    if (seen.has(item.workItemId)) continue;
    seen.add(item.workItemId);
    items.push(item);
  }
  return {
    ...empty,
    items,
    nextCursor: response.nextCursor,
    loading: false,
    loadingMore: false,
  };
}
