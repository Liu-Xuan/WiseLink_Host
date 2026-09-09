import type {
  CanonicalLibraryDocumentSummary,
  CanonicalLibraryDocumentsRequest,
  DocumentMetadataField,
} from '@shared/api.interface';

export type LibraryGrouping = 'category' | 'ata' | 'aircraft' | 'all';

export const LIBRARY_GROUPINGS: { value: LibraryGrouping; label: string }[] = [
  { value: 'category', label: '文档类别' },
  { value: 'ata', label: 'ATA 章节' },
  { value: 'aircraft', label: '文档提及机型' },
  { value: 'all', label: '全部文档' },
];

export interface LibraryCategoryGroup {
  key: string;
  label: string;
  documents: CanonicalLibraryDocumentSummary[];
}

export type LibraryFacetKey = 'normalizedFamily' | 'ata' | 'aircraftModel';
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
  if (grouping === 'all') return ['all'];
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
