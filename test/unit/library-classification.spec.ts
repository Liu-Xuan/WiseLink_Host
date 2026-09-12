import { buildLibraryHierarchy, groupLibraryDocuments, libraryGroupingOrder, type LibraryGrouping } from '../../client/src/pages/WorkspaceHomePage/library-classification';
import { libraryFamily, libraryMetadata } from './fixtures/canonical-library';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { LibraryHierarchy } from '../../client/src/pages/WorkspaceHomePage/LibraryHierarchy';

jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/api/canonical-host', () => ({ getCanonicalHostClientSessionGeneration: () => 1 }));
jest.mock(
  '@lark-apaas/client-toolkit/utils/resolveAppUrl',
  () => ({ resolveAppUrl: (path: string) => path }),
  { virtual: true },
);

describe('library category hierarchy', () => {
  it.each<LibraryGrouping>(['category', 'ata', 'aircraft'])('uses all dimensions with %s first and preserves all three filters', (first) => {
    const matching = libraryFamily('matching');
    matching.versions[0].extractedMetadata = libraryMetadata('34', '737');
    matching.versions[1].extractedMetadata = libraryMetadata('29', '777');
    const other = libraryFamily('other');
    other.versions[0].extractedMetadata = libraryMetadata('34', '787');
    const filters = { normalizedFamily: 'SB', ata: '29', aircraftModel: '777' };
    const tree = buildLibraryHierarchy([matching, other], first, filters);
    expect(tree).toHaveLength(1);
    const path = [tree[0], tree[0].children[0], tree[0].children[0].children[0]];
    expect(path.map((node) => node.dimension)).toEqual(libraryGroupingOrder(first));
    expect(path[2].children).toEqual([]);
    expect(path[2].pathFilters).toEqual(filters);
    expect(path[2].documents).toEqual([matching]);
    expect(path[2].documents[0].versions).toHaveLength(2);
    expect(filters).toEqual({ normalizedFamily: 'SB', ata: '29', aircraftModel: '777' });
  });

  it('prunes nonselected branches and returns no rows for an impossible intersection', () => {
    const item = libraryFamily('multi');
    item.versions[0].extractedMetadata = libraryMetadata('34', '737');
    item.versions[1].extractedMetadata = libraryMetadata('29', '777');
    const tree = buildLibraryHierarchy([item], 'category', { ata: '34' });
    expect(tree[0].children.map((node) => node.key)).toEqual(['34']);
    expect(tree[0].children[0].children.map((node) => node.key)).toEqual(['737', '777']);
    expect(buildLibraryHierarchy([item], 'ata', { ata: '34', aircraftModel: '787' })).toEqual([]);
    expect(buildLibraryHierarchy([item], 'ata', { ata: '__UNKNOWN__' })).toEqual([]);
  });

  it('keeps a real unclassified path in every missing dimension', () => {
    const item = { ...libraryFamily('unknown'), normalizedFamily: '' };
    const tree = buildLibraryHierarchy([item], 'aircraft');
    const leaf = tree[0].children[0].children[0];
    expect(leaf.pathFilters).toEqual({ normalizedFamily: '__UNKNOWN__', ata: '__UNKNOWN__', aircraftModel: '__UNKNOWN__' });
    expect(leaf.documents).toEqual([item]);
  });

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
      '/document-versions/DV-first-1',
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
    document.versions[1].extractedMetadata = libraryMetadata();
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
      'href="/document-versions/DV%2Fexact-old"',
    );
    expect(html).not.toContain('/work-items//');
    expect(html).not.toContain('/original');
    expect(html).toContain('查看原件与解析');
    expect(html).toContain('<strong>R1</strong>');
    expect(html).toContain('<span>历史版本</span>');
    expect(html).toContain('old.pdf');
    expect(html).toContain('测试原文标题');
    expect(html).toContain('aria-label="SB-without-task 版本"');
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
