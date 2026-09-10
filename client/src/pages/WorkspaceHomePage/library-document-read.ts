import type {
  CanonicalLibraryDocumentSummary,
  CanonicalLibraryDocumentsResponse,
  CanonicalLibraryWorkItemSummary,
  CanonicalLibraryTasksResponse,
} from '@shared/api.interface';
import type { LibraryReadErrorPresentation } from './library-read-error';

export interface LibraryDocumentsRead {
  mode: 'document' | 'tasks';
  familyId: string;
  search: string;
  sessionGeneration: number;
  items: LibraryDirectoryEntry[];
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: LibraryReadErrorPresentation | null;
  normalizedFamily?: string;
  ata?: string;
  aircraftModel?: string;
  fleetFamily?: string;
  fleetModel?: string;
  totalCount?: number;
  familyCounts?: Record<string, number>;
  ataCounts?: Record<string, number>;
  aircraftModelCounts?: Record<string, number>;
}

function sameFilters(
  a: LibraryDocumentsRead,
  b: LibraryDocumentsRead,
): boolean {
  return (
    (a.normalizedFamily ?? '') === (b.normalizedFamily ?? '') &&
    (a.ata ?? '') === (b.ata ?? '') &&
    (a.aircraftModel ?? '') === (b.aircraftModel ?? '') &&
    (a.fleetFamily ?? '') === (b.fleetFamily ?? '') &&
    (a.fleetModel ?? '') === (b.fleetModel ?? '')
  );
}

export type LibraryDirectoryEntry =
  | CanonicalLibraryDocumentSummary
  | CanonicalLibraryWorkItemSummary;

export function libraryEntryId(entry: LibraryDirectoryEntry): string {
  return entry.kind === 'DOCUMENT' ? entry.familyId : entry.workItemId;
}

export function beginLibraryDocumentsRead(
  prior: LibraryDocumentsRead | null,
  empty: LibraryDocumentsRead,
): LibraryDocumentsRead {
  return {
    ...(prior?.sessionGeneration === empty.sessionGeneration &&
    prior.search === empty.search &&
    prior.mode === empty.mode &&
    prior.familyId === empty.familyId &&
    sameFilters(prior, empty)
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
  response: CanonicalLibraryDocumentsResponse | CanonicalLibraryTasksResponse,
  discarded: Set<string>,
): LibraryDocumentsRead {
  const previous: LibraryDirectoryEntry[] =
    empty.loadingMore &&
    prior?.sessionGeneration === empty.sessionGeneration &&
    prior.search === empty.search &&
    prior.mode === empty.mode &&
    prior.familyId === empty.familyId &&
    sameFilters(prior, empty)
      ? prior.items
      : [];
  const seen: Set<string> = new Set(discarded);
  const items: LibraryDirectoryEntry[] = [];
  for (const item of [...previous, ...response.items]) {
    const id = libraryEntryId(item);
    if (seen.has(id)) continue;
    seen.add(id);
    items.push(item);
  }
  return {
    ...empty,
    items,
    nextCursor: response.nextCursor,
    loading: false,
    loadingMore: false,
    ...(response.scope === 'CURRENT_USER_DOCUMENT_CATALOG'
      ? {
          totalCount: response.totalCount,
          familyCounts: response.familyCounts,
          ataCounts: response.ataCounts,
          aircraftModelCounts: response.aircraftModelCounts,
        }
      : {}),
  };
}
