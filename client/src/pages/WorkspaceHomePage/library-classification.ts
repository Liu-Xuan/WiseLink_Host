import type {
  CanonicalLibraryDocumentSummary,
  CanonicalLibraryDocumentsRequest,
  DocumentMetadataField,
} from '@shared/api.interface';
import type { CanonicalLibraryFleetCatalog } from '@shared/library-fleet.interface';
import { libraryFleetBranches, matchesLibraryFleet } from './library-fleet-classification';

export type LibraryGrouping = 'category' | 'ata' | 'aircraft';

export const LIBRARY_GROUPINGS: { value: LibraryGrouping; label: string }[] = [
  { value: 'category', label: '文档类别' },
  { value: 'ata', label: 'ATA 编号' },
  { value: 'aircraft', label: '文档提及机型' },
];

export interface LibraryCategoryGroup {
  key: string;
  label: string;
  documents: CanonicalLibraryDocumentSummary[];
}

export type LibraryFacetKey = 'normalizedFamily' | 'ata' | 'aircraftModel' | 'fleetFamily' | 'fleetModel';
export type LibraryCatalogFilters = Pick<
  CanonicalLibraryDocumentsRequest,
  LibraryFacetKey
>;
export const LIBRARY_UNCLASSIFIED = '__UNKNOWN__';

export function metadataValues(
  field: DocumentMetadataField | undefined,
): string[] {
  return [
    ...new Set(
      field?.observations.map((item) => item.value).filter(Boolean) ?? [],
    ),
  ];
}

/** Match the server facet: distinct observations from all visible versions. */
export function documentClassificationValues(
  document: CanonicalLibraryDocumentSummary,
  grouping: LibraryGrouping,
): string[] {
  if (grouping === 'category')
    return [document.normalizedFamily || LIBRARY_UNCLASSIFIED];
  const values: string[] = document.versions.flatMap((version) =>
    metadataValues(
      grouping === 'ata'
        ? version.extractedMetadata?.ata
        : version.extractedMetadata?.mentionedAircraftModels,
    ),
  );
  return values.length ? [...new Set(values)] : [LIBRARY_UNCLASSIFIED];
}

/** DM's registered family is a category; filenames and task aircraft are not metadata. */
export function groupLibraryDocuments(
  documents: CanonicalLibraryDocumentSummary[],
  grouping: LibraryGrouping = 'category',
): LibraryCategoryGroup[] {
  const groups: Map<string, LibraryCategoryGroup> = new Map();
  for (const document of documents) {
    for (const key of documentClassificationValues(document, grouping)) {
      const group: LibraryCategoryGroup = groups.get(key) ?? {
        key,
        label: key === LIBRARY_UNCLASSIFIED ? '未分类' : key,
        documents: [],
      };
      group.documents.push(document);
      groups.set(key, group);
    }
  }
  return [...groups.values()].sort((a, b) => {
    if (a.key === LIBRARY_UNCLASSIFIED) return 1;
    if (b.key === LIBRARY_UNCLASSIFIED) return -1;
    return a.label.localeCompare(b.label, 'zh-CN', { numeric: true });
  });
}

export const LIBRARY_GROUPING_FACETS: Record<LibraryGrouping, LibraryFacetKey> = {
  category: 'normalizedFamily', ata: 'ata', aircraft: 'aircraftModel',
};

export function libraryGroupingOrder(first: LibraryGrouping): LibraryGrouping[] {
  return [first, ...LIBRARY_GROUPINGS.map((item) => item.value).filter((value) => value !== first)];
}

export interface LibraryHierarchyGroup extends LibraryCategoryGroup {
  dimension: LibraryGrouping;
  pathFilters: LibraryCatalogFilters;
  children: LibraryHierarchyGroup[];
}

/** All three facets remain active; ordering changes presentation, never filter semantics.
 * Values are family-level observations, not proof that ATA/model co-occur in one version. */
export function buildLibraryHierarchy(
  documents: CanonicalLibraryDocumentSummary[],
  first: LibraryGrouping = 'category',
  filters: LibraryCatalogFilters = {},
  fleetCatalog?: CanonicalLibraryFleetCatalog | null,
): LibraryHierarchyGroup[] {
  const order = libraryGroupingOrder(first);
  const matching = documents.filter((document) => matchesLibraryFleet(document, fleetCatalog ?? null, filters) && order.every((dimension) => {
    const selected = filters[LIBRARY_GROUPING_FACETS[dimension]];
    return !selected || documentClassificationValues(document, dimension).includes(selected);
  }));
  function branch(items: CanonicalLibraryDocumentSummary[], depth: number, pathFilters: LibraryCatalogFilters): LibraryHierarchyGroup[] {
    const dimension = order[depth];
    if (!dimension) return [];
    if (dimension === 'aircraft' && fleetCatalog !== undefined) return libraryFleetBranches(items, fleetCatalog, filters, pathFilters, (members, path) => branch(members, depth + 1, path));
    const facet = LIBRARY_GROUPING_FACETS[dimension];
    return groupLibraryDocuments(items, dimension)
      .filter((group) => !filters[facet] || group.key === filters[facet])
      .map((group) => {
        const path = { ...pathFilters, [facet]: group.key };
        return { ...group, dimension, pathFilters: path, children: branch(group.documents, depth + 1, path) };
      });
  }
  return branch(matching, 0, {});
}
