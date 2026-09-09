import type { CanonicalLibraryDocumentSummary } from '@shared/api.interface';

export type LibraryGrouping = 'category' | 'ata' | 'aircraft' | 'all';

export const LIBRARY_GROUPINGS: { value: LibraryGrouping; label: string }[] = [
  { value: 'category', label: '文档类别' },
  { value: 'ata', label: 'ATA 章节' },
  { value: 'aircraft', label: '机型' },
  { value: 'all', label: '全部文档' },
];

export interface LibraryCategoryGroup {
  key: string;
  label: string;
  documents: CanonicalLibraryDocumentSummary[];
}

/** DM's registered family is a category; filenames and task aircraft are not metadata. */
export function groupLibraryDocuments(
  documents: CanonicalLibraryDocumentSummary[],
): LibraryCategoryGroup[] {
  const groups: Map<string, LibraryCategoryGroup> = new Map();
  for (const document of documents) {
    const category: string = document.normalizedFamily.trim();
    const key: string = category || '__unclassified__';
    const group: LibraryCategoryGroup = groups.get(key) ?? {
      key,
      label: category || '未分类',
      documents: [],
    };
    group.documents.push(document);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.key === '__unclassified__') return 1;
    if (b.key === '__unclassified__') return -1;
    return a.label.localeCompare(b.label, 'zh-CN', { numeric: true });
  });
}
