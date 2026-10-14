import type { CanonicalLibraryDocumentSummary } from '@shared/api.interface';
import type { CanonicalLibraryFleetCatalog } from '@shared/library-fleet.interface';
import { LibraryAtaHierarchy } from './LibraryAtaHierarchy';
import type { LibraryCatalogFilters, LibraryGrouping } from './library-classification';

interface LibraryHierarchyProps {
  documents: CanonicalLibraryDocumentSummary[];
  selectedId: string;
  hasMore: boolean;
  onSelect: (familyId: string) => void;
  grouping?: LibraryGrouping;
  totalCount?: number;
  filters?: LibraryCatalogFilters;
  onFilterChange?: (filters: LibraryCatalogFilters) => void;
  disabled?: boolean;
  fleetCatalog?: CanonicalLibraryFleetCatalog | null;
}

export function LibraryHierarchy({ documents, selectedId, hasMore, onSelect, filters = {}, fleetCatalog }: LibraryHierarchyProps) {
  return <LibraryAtaHierarchy navigationOnly documents={documents} selectedId={selectedId} hasMore={hasMore}
    onSelect={onSelect} filters={filters} fleetCatalog={fleetCatalog ?? null} />;
}
