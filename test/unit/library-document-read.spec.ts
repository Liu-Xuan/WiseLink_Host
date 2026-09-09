import {
  beginLibraryDocumentsRead,
  mergeLibraryDocumentsRead,
  type LibraryDocumentsRead,
} from '../../client/src/pages/WorkspaceHomePage/library-document-read';
import { libraryDocuments, libraryTasks } from './fixtures/canonical-library';

function empty(
  mode: 'document' | 'tasks',
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
  it('keeps full server counts separate from the loaded page and invalidates all facets on filter changes', () => {
    const first = mergeLibraryDocumentsRead(
      null,
      { ...empty('document'), normalizedFamily: 'SB', ata: '34' },
      {
        ...libraryDocuments(['a'], 'next'),
        totalCount: 100,
        familyCounts: { SB: 120, SL: 30 },
        ataCounts: { '34': 110 },
        aircraftModelCounts: { '737': 125 },
      },
      new Set(),
    );
    expect(first.items).toHaveLength(1);
    expect(first.totalCount).toBe(100);
    expect(first.familyCounts).toEqual({ SB: 120, SL: 30 });
    for (const changed of [
      { normalizedFamily: 'SL', ata: '34' },
      { normalizedFamily: 'SB', ata: '29' },
      { normalizedFamily: 'SB', ata: '34', aircraftModel: '777' },
    ]) {
      const next = beginLibraryDocumentsRead(first, {
        ...empty('document'),
        ...changed,
      });
      expect(next.items).toEqual([]);
      expect(next.totalCount).toBeUndefined();
      expect(next.familyCounts).toBeUndefined();
    }
  });
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
      empty('tasks'),
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
      empty('tasks', '737'),
      libraryTasks(['WI-1']),
      new Set(),
    );
    expect(
      beginLibraryDocumentsRead(tasks, empty('tasks', '777')).items,
    ).toEqual([]);
    expect(
      beginLibraryDocumentsRead(tasks, {
        ...empty('tasks', '737'),
        sessionGeneration: 2,
      }).items,
    ).toEqual([]);
    const next = mergeLibraryDocumentsRead(
      tasks,
      { ...empty('tasks', '737'), loadingMore: true },
      libraryTasks(['WI-1', 'WI-2']),
      new Set(['WI-1']),
    );
    expect(
      next.items.map((item) => item.kind === 'TASK' && item.workItemId),
    ).toEqual(['WI-2']);
  });
});
