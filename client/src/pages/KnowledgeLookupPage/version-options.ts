import type { CanonicalLibraryIndexReadResponse } from '@shared/api.interface';

export interface DocumentVersionOption {
  versionId: string;
  label: string;
  detail: string;
  isCurrent: boolean;
}

export function buildVersionOptions(
  index: Pick<CanonicalLibraryIndexReadResponse, 'document' | 'currentness'>,
): DocumentVersionOption[] {
  // LibraryIndex node IDs identify UI structure, not business document versions.
  // This response establishes only the selected document's readable identity.
  const versionId = index.document.documentVersionId;
  if (!versionId.trim()) return [];
  return [
    {
      versionId,
      label: index.document.documentCode || versionId,
      detail: index.document.businessRevision,
      isCurrent: versionId === index.currentness.currentDocumentVersionId,
    },
  ];
}
