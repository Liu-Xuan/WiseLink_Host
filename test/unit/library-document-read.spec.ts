import {
  beginLibraryDocumentsRead,
  mergeLibraryDocumentsRead,
  type LibraryDocumentsRead,
} from '../../client/src/pages/WorkspaceHomePage/library-document-read';
import { libraryDocuments, libraryTasks } from './fixtures/canonical-library';

function empty(
  mode: 'document' | 'matter',
  familyId = '',
): LibraryDocumentsRead {
  return {
    mode,
    familyId,
    search: '',
    sessionGeneration: 1,
    items: [],
    nextCursor: null,
    loading: true,
    loadingMore: false,
    error: null,
  };
}

describe('library documents and tasks stay separate across reads', () => {
  it('deduplicates overlapping family pages while preserving versions within each document', () => {
    const first = mergeLibraryDocumentsRead(
      null,
      empty('document'),
      libraryDocuments(['787', '737'], 'next'),
      new Set(),
    );
    const next = mergeLibraryDocumentsRead(
      first,
      { ...empty('document'), loadingMore: true },
      libraryDocuments(['737', '777']),
      new Set(),
    );
    expect(next.items.map((item) => item.familyId)).toEqual([
      '787',
      '737',
      '777',
    ]);
    expect(
      next.items[0].kind === 'DOCUMENT' && next.items[0].versions,
    ).toHaveLength(2);
  });

  it('preserves independent tasks for the same family, and clears them when switching to documents', () => {
    const tasks = mergeLibraryDocumentsRead(
      null,
      empty('matter'),
      libraryTasks(['WI-1', 'WI-2']),
      new Set(),
    );
    expect(tasks.items.map((item) => item.familyId)).toEqual(['737', '737']);
    expect(beginLibraryDocumentsRead(tasks, empty('document')).items).toEqual(
      [],
    );
    const docs = mergeLibraryDocumentsRead(
      tasks,
      { ...empty('document'), loadingMore: true },
      libraryDocuments(['737']),
      new Set(),
    );
    expect(docs.items).toHaveLength(1);
    expect(docs.items[0].kind).toBe('DOCUMENT');
  });

  it('drops cached rows when family or account changes and keeps revoked tasks out of pagination', () => {
    const tasks = mergeLibraryDocumentsRead(
      null,
      empty('matter', '737'),
      libraryTasks(['WI-1']),
      new Set(),
    );
    expect(
      beginLibraryDocumentsRead(tasks, empty('matter', '777')).items,
    ).toEqual([]);
    expect(
      beginLibraryDocumentsRead(tasks, {
        ...empty('matter', '737'),
        sessionGeneration: 2,
      }).items,
    ).toEqual([]);
    const next = mergeLibraryDocumentsRead(
      tasks,
      { ...empty('matter', '737'), loadingMore: true },
      libraryTasks(['WI-1', 'WI-2']),
      new Set(['WI-1']),
    );
    expect(
      next.items.map((item) => item.kind === 'TASK' && item.workItemId),
    ).toEqual(['WI-2']);
  });
});
