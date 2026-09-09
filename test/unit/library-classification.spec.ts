import { groupLibraryDocuments } from '../../client/src/pages/WorkspaceHomePage/library-classification';
import { libraryFamily, libraryMetadata } from './fixtures/canonical-library';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { LibraryHierarchy } from '../../client/src/pages/WorkspaceHomePage/LibraryHierarchy';

jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock(
  '@lark-apaas/client-toolkit/utils/resolveAppUrl',
  () => ({ resolveAppUrl: (path: string) => path }),
  { virtual: true },
);

describe('library category hierarchy', () => {
  it('renders category/family/version levels and exact historical reader links', () => {
    const html = renderToStaticMarkup(
      createElement(
        StaticRouter,
        { location: '/library' },
        createElement(LibraryHierarchy, {
          documents: [libraryFamily('first')],
          selectedId: 'first',
          hasMore: true,
          onSelect: jest.fn(),
        }),
      ),
    );
    expect(html).toContain('资料分类（含历史版本）');
    expect(html).toContain('已加载 1 份');
    expect(html).toContain('仅覆盖已加载');
    expect(html).toContain('历史版本');
    expect(html).toContain(
      '/work-items/WI-OLD/documents?node=reader&amp;tab=reader',
    );
    expect(html).toContain('is-selected');
  });
  it('groups registered categories while preserving families and all versions', () => {
    const first = libraryFamily('first');
    const second = { ...libraryFamily('second'), normalizedFamily: 'SL' };
    const third = libraryFamily('third');
    const groups = groupLibraryDocuments([first, second, third]);
    expect(groups.map((group) => group.label)).toEqual(['SB', 'SL']);
    expect(groups[0].documents).toEqual([first, third]);
    expect(groups[0].documents[0].versions).toEqual(first.versions);
  });

  it('uses observations from all visible versions, deduplicating a family in each facet', () => {
    const document = libraryFamily('history');
    document.versions[0].extractedMetadata = libraryMetadata('34', '737');
    document.versions[1].extractedMetadata = libraryMetadata('29', '737');
    expect(
      groupLibraryDocuments([document], 'ata').map((item) => item.label),
    ).toEqual(['29', '34']);
    expect(
      groupLibraryDocuments([document], 'aircraft')[0].documents,
    ).toHaveLength(1);
    expect(
      groupLibraryDocuments([libraryFamily('unread')], 'ata')[0].label,
    ).toBe('未分类');
  });

  it('opens a taskless historical version through its exact original endpoint', () => {
    const document = libraryFamily('without-task');
    document.versions[1].readerWorkItemId = '';
    document.versions[1].documentVersionId = 'DV/exact-old';
    const html = renderToStaticMarkup(
      createElement(
        StaticRouter,
        { location: '/library' },
        createElement(LibraryHierarchy, {
          documents: [document],
          selectedId: '',
          hasMore: false,
          totalCount: 7,
          grouping: 'aircraft',
          onSelect: jest.fn(),
        }),
      ),
    );
    expect(html).toContain(
      '/api/document-management/document-versions/DV%2Fexact-old/original',
    );
    expect(html).not.toContain('/work-items//');
    expect(html).toContain('共 7 份');
    expect(html).toContain('非适用性');
    expect(html).toContain('可能来自历史版本');
  });

  it('keeps missing categories unclassified without interpreting names or identifiers', () => {
    const document = {
      ...libraryFamily('missing'),
      normalizedFamily: '',
      documentCode: '737-34-3830',
    };
    const groups = groupLibraryDocuments([document, libraryFamily('known')]);
    expect(groups.map((group) => group.label)).toEqual(['SB', '未分类']);
    expect(groups[1].documents[0]).toBe(document);
  });

  it('updates counts when further pages arrive rather than inventing catalog totals', () => {
    expect(
      groupLibraryDocuments([libraryFamily('a')])[0].documents,
    ).toHaveLength(1);
    expect(
      groupLibraryDocuments([libraryFamily('a'), libraryFamily('b')])[0]
        .documents,
    ).toHaveLength(2);
    expect(groupLibraryDocuments([])).toEqual([]);
  });

  it('does not mutate the input order or merge different families of one category', () => {
    const items = [libraryFamily('b'), libraryFamily('a')];
    const groups = groupLibraryDocuments(items);
    expect(groups[0].documents.map((item) => item.familyId)).toEqual([
      'b',
      'a',
    ]);
    expect(items.map((item) => item.familyId)).toEqual(['b', 'a']);
  });
});
