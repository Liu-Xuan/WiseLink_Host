import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import type { AssessmentReadingResult } from '@shared/assessment-reading.interface';
import LibraryMatterDirectory from '../../client/src/pages/WorkspaceHomePage/LibraryMatterDirectory';
import { LibraryMatterQuicklookContent } from '../../client/src/pages/WorkspaceHomePage/LibraryMatterQuicklook';
import {
  libraryMatterFixture,
  libraryMatterRows,
} from './fixtures/library-matter';

jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => 1,
  subscribeCanonicalHostClientSession: () => () => undefined,
}));
jest.mock('@client/src/features/matter/useEngineeringMatter', () => ({
  __esModule: true,
  default: () => ({ data: null, loading: false, error: null }),
}));
jest.mock('@client/src/components/ui/button', () => ({
  Button: ({ children }: { children: ReactNode }) =>
    createElement('span', null, children),
}));
jest.mock('@client/src/components/ui/input', () => ({ Input: 'input' }));
jest.mock('@client/src/features/matter/SavedAssessmentReading', () => ({
  __esModule: true,
  default: ({ result }: { result: AssessmentReadingResult }) =>
    createElement(
      'section',
      { 'data-result-ref': result.resultRef },
      result.content.lead,
    ),
}));

describe('Guided Atlas library uses saved business reading', () => {
  it('renders the saved row and all decisive limitations without asserting implementation', () => {
    const rows = libraryMatterRows();
    const html = renderToStaticMarkup(
      createElement(
        StaticRouter,
        { location: '/library' },
        createElement(LibraryMatterDirectory, {
          directory: {
            items: rows,
            loading: false,
            loadingMore: false,
            error: null,
            nextCursor: null,
            loadMore: jest.fn(),
          },
          authenticationRequired: false,
          sessionGeneration: 1,
          searchText: '',
          onSearchTextChange: jest.fn(),
          onSearch: jest.fn(),
          onRefresh: jest.fn(),
          onCreateFromTask: jest.fn(),
          filteredByWorkItem: false,
          onViewAll: jest.fn(),
        }),
      ),
    );
    expect(html).toContain(rows[0].result!.listBrief);
    expect(html).toContain(rows[0].result!.decisiveClaims[0].text);
    expect(html).toContain('data-result-ref="test-saved-result"');
    expect(html).toContain('实施与故障：未核实');
    expect(html).toContain('/matters/ui-test-matter');
  });
  it('reads the same substantive result and separates absent source measures and implementation', () => {
    const data = libraryMatterFixture();
    const html = renderToStaticMarkup(
      createElement(
        StaticRouter,
        { location: '/library' },
        createElement(LibraryMatterQuicklookContent, { data }),
      ),
    );
    expect(html).toContain('data-result-ref="test-saved-result"');
    expect(html).toContain(
      data.working.current!.state.substantiveResult!.content.lead,
    );
    expect(html).toContain('当前接口未单独返回资料措施与实施前提');
    expect(html).toContain('不能判断已完成、未实施或无故障');
    expect(html).toContain('核对目标飞机实际软件标准');
    expect(html).toContain('新修订或构型记录到达后重新核对');
  });
});
