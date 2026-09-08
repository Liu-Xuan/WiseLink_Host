import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import type { EngineeringMatterDirectoryResponse } from '@shared/api.interface';
import type { AssessmentReadingSummary } from '@shared/assessment-reading.interface';

jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }), {
  virtual: true,
});
jest.mock('@client/src/components/ui/input', () => ({ Input: 'input' }), {
  virtual: true,
});

import MatterDirectory from '../../client/src/features/matter/MatterDirectory';
import { LibraryDocumentDirectory } from '../../client/src/pages/WorkspaceHomePage/LibraryDocumentDirectory';
import { libraryViewMode } from '../../client/src/pages/WorkspaceHomePage/library-view-mode';
import { matterDocumentRoute } from '../../client/src/features/matter/matter-navigation';
import { readingReturnTarget } from '../../client/src/features/matter/ReadingReturnLink';
import { libraryTasks } from './fixtures/canonical-library';

const summary: AssessmentReadingSummary = {
  resultRef: 'result-matter-4',
  resultRevision: 4,
  headline: '故障机理已明确，但实施条件仍待核查',
  listBrief: '只适用于已确认的构型；机队尚未匹配。',
  decisiveClaims: Array.from({ length: 5 }, (_, index) => ({
    claimId: `condition-${index}`,
    text: `关键限制 ${index}：不得将该判断理解为实施批准。`,
  })),
};

describe('real matter directory and saved list summaries', () => {
  it('separates real matters from legacy WorkItem links and the document catalog', () => {
    expect(libraryViewMode(new URLSearchParams())).toBe('document');
    expect(libraryViewMode(new URLSearchParams('mode=matter'))).toBe('matter');
    expect(
      libraryViewMode(new URLSearchParams('mode=matter&workItemId=WI-1')),
    ).toBe('matter');
    expect(libraryViewMode(new URLSearchParams('mode=tasks'))).toBe('tasks');
    expect(libraryViewMode(new URLSearchParams('workItemId=WI-1'))).toBe(
      'tasks',
    );
  });

  it('links actual matter IDs and renders every decisive condition without member-result fallback', () => {
    const items: EngineeringMatterDirectoryResponse['items'] = [
      {
        matterId: 'matter/4',
        title: '机队构型工程事项',
        primaryWorkItemId: 'WI-1',
        createdAt: '2026-09-08T02:00:00Z',
        updatedAt: '2026-09-08T03:00:00Z',
        currentMatterRevisionId: 'MR-3',
        workingRevision: 4,
        result: summary,
      },
      {
        matterId: 'matter-new',
        title: '新建事项',
        primaryWorkItemId: 'WI-2',
        createdAt: '2026-09-08T02:00:00Z',
        updatedAt: '2026-09-08T03:00:00Z',
        currentMatterRevisionId: 'MR-1',
        workingRevision: 0,
        result: null,
      },
    ];
    const html = renderToStaticMarkup(
      createElement(
        StaticRouter,
        { location: '/library?mode=matter' },
        createElement(MatterDirectory, {
          directory: {
            items,
            nextCursor: null,
            loading: false,
            loadingMore: false,
            error: null,
            loadMore: jest.fn(),
          },
          authenticationRequired: false,
          search: '',
          searchText: '',
          filteredByWorkItem: false,
          onSearchTextChange: jest.fn(),
          onSearch: jest.fn(),
          onRefresh: jest.fn(),
          onCreateFromTask: jest.fn(),
          onViewAll: jest.fn(),
        }),
      ),
    );
    expect(html).toContain('href="/matters/matter%2F4"');
    expect(html).toContain('data-result-ref="result-matter-4"');
    expect(html).toContain('data-result-revision="4"');
    expect(html).toContain(summary.listBrief);
    summary.decisiveClaims.forEach((claim) =>
      expect(html).toContain(claim.text),
    );
    expect(html).toContain('尚未形成事项综合认识');
    expect(html).not.toContain('/work-items/WI-1/documents');
  });

  it('renders saved summaries for unselected task rows too', () => {
    const response = libraryTasks(['WI-A', 'WI-B']);
    response.items[0].readingSummary = summary;
    response.items[1].readingSummary = {
      ...summary,
      resultRef: 'saved-result-B',
    };
    const html = renderToStaticMarkup(
      createElement(LibraryDocumentDirectory, {
        directory: {
          items: response.items,
          nextCursor: null,
          loading: false,
          loadingMore: false,
          error: null,
          discard: jest.fn(),
          loadMore: jest.fn(),
        },
        authenticationRequired: false,
        search: '',
        searchText: '',
        mode: 'tasks',
        selectedId: 'WI-A',
        quicklookLoading: false,
        onSearchTextChange: jest.fn(),
        onSearch: jest.fn(),
        onRefresh: jest.fn(),
        onSelect: jest.fn(),
      }),
    );
    expect(html).toContain('data-result-ref="saved-result-B"');
    expect(html.split('data-claim-id="condition-4"')).toHaveLength(3);
  });

  it('round trips the exact original member, document version and discussion panel using local routes', () => {
    const route = matterDocumentRoute(
      'matter/a',
      {
        workItemId: 'member/2',
        documentVersionId: 'DV-OLD',
        sourceRefId: 'source-original/3',
      },
      'review',
    );
    const url = new URL(route, 'https://example.invalid');
    expect(url.pathname).toBe('/work-items/member%2F2/documents');
    expect(url.searchParams.get('documentVersionId')).toBe('DV-OLD');
    expect(url.searchParams.get('sourceRef')).toBe('source-original/3');
    expect(readingReturnTarget(url.searchParams)).toEqual({
      route: '/matters/matter%2Fa?panel=review',
      label: '返回事项讨论',
    });
    expect(
      readingReturnTarget(
        new URLSearchParams('returnUrl=https://evil.invalid'),
      ),
    ).toBeNull();
    expect(
      readingReturnTarget(
        new URLSearchParams(
          'returnMatterId=M-1&returnMatterPanel=https://evil.invalid',
        ),
      ),
    ).toEqual({ route: '/matters/M-1', label: '返回事项简报' });
  });
});
