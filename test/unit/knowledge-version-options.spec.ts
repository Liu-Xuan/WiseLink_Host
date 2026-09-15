import type { CanonicalLibraryIndexReadResponse } from '@shared/api.interface';
import { buildVersionOptions } from '../../client/src/pages/KnowledgeLookupPage/version-options';

function fixture() {
  return {
    document: {
      documentId: 'doc',
      documentVersionId: 'DV-old',
      documentCode: 'FTD',
      businessRevision: '',
      normalizedFamily: 'FTD',
    },
    currentness: {
      familyId: 'family',
      currentDocumentVersionId: 'DV-new',
      currentGeneration: 2,
      selectedVersionIsCurrent: false,
    },
    libraryIndex: {
      nodes: [
        { id: 'document-version', kind: 'DOCUMENT_VERSION', label: 'DV-old' },
      ],
    },
  } satisfies Pick<
    CanonicalLibraryIndexReadResponse,
    'document' | 'currentness'
  > & { libraryIndex: unknown };
}

test('only the explicit selected business identity becomes a query version, never a structural node ID', () => {
  expect(buildVersionOptions(fixture())).toEqual([
    { versionId: 'DV-old', label: 'FTD', detail: '', isCurrent: false },
  ]);
});

test('does not silently select currentness identity instead of the selected historical document', () => {
  const input = fixture();
  input.currentness.currentDocumentVersionId = 'DV-old';
  expect(buildVersionOptions(input)[0].isCurrent).toBe(true);
  input.document.documentVersionId = '';
  expect(buildVersionOptions(input)).toEqual([]);
});
