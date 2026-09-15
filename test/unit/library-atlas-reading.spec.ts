import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import type { AssessmentReadingResult } from '@shared/assessment-reading.interface';
import type { DocumentAssessmentEvidence } from '@client/src/features/matter/assessment-reading';
import { jobAidReadingResult } from '@shared/jobaid-problem-assessment.interface';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';
import LibraryMatterDirectory from '../../client/src/pages/WorkspaceHomePage/LibraryMatterDirectory';
import { LibraryMatterQuicklookContent } from '../../client/src/pages/WorkspaceHomePage/LibraryMatterQuicklook';
import {
  libraryMatterFixture,
  libraryMatterRows,
} from './fixtures/library-matter';

const mockNavigate = jest.fn();
let mockLocateDocument: (source: DocumentAssessmentEvidence) => void;
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));
jest.mock(
  '@client/src/pages/DocumentParsingPage/jobaid-problem-workspace.css',
  () => ({}),
);

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
  default: ({
    result,
    onLocateDocument,
  }: {
    result: AssessmentReadingResult;
    onLocateDocument: typeof mockLocateDocument;
  }) => {
    mockLocateDocument = onLocateDocument;
    return createElement(
      'section',
      { 'data-result-ref': result.resultRef },
      result.content.lead,
    );
  },
}));

function problemFixture(status: 'CURRENT' | 'STALE' | 'NOT_AVAILABLE') {
  const data = libraryMatterFixture();
  const saved = jobAidReadingFixture().current!;
  saved.content.overviewStatus = status;
  if (status === 'NOT_AVAILABLE')
    saved.content.understanding = '问题正文已保存；综合认识尚未形成。';
  const reading = jobAidReadingResult(saved);
  reading.scope = {
    kind: 'ENGINEERING_MATTER',
    matterId: data.matter.matterId,
  };
  const current = data.working.current!;
  current.state.problemWork = saved.content;
  current.state.substantiveResult = reading;
  current.substantiveResultRef = reading.resultRef;
  current.substantiveResultRevision = reading.resultRevision;
  return data;
}

function renderQuicklook(data: ReturnType<typeof libraryMatterFixture>) {
  return renderToStaticMarkup(
    createElement(
      StaticRouter,
      { location: '/library' },
      createElement(LibraryMatterQuicklookContent, { data }),
    ),
  );
}

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
  it('reads saved full problems without treating a non-null result as an available overview', () => {
    const html = renderQuicklook(problemFixture('NOT_AVAILABLE'));
    expect(html).toContain('已保存的问题分析');
    expect(html).toContain('仅对构型 A');
    expect(html).toContain('综合尚未形成');
    expect(html).not.toContain('已保存意见及其范围');
    expect(html).not.toContain('尚未取得已保存的事项阅读结果');
    expect(html).not.toContain('请求状态');
  });
  it('keeps stale coverage separate from failure and exposes problem correction before folded body', () => {
    const data = problemFixture('STALE');
    data.working.current!.correctionNotices = [
      {
        attemptRef: 'AQ-check',
        issueKey: 'issue-test',
        reason: '必须核对构型条件',
        attemptStatus: 'QUEUED',
        correctedWorkRef: null,
      },
    ];
    const html = renderQuicklook(data);
    expect(html).toContain('现有综合尚未覆盖本次问题更新');
    expect(html).toContain('已保存意见 · 尚未覆盖当前问题更新');
    expect(html.indexOf('必须核对构型条件')).toBeLessThan(
      html.indexOf('<details'),
    );
    expect(html).not.toContain('生成失败');
    expect(html).not.toContain('综合更新未完成');
  });
  it('shows explicit failed-but-saved notices even when overview is current, without accuracy claims', () => {
    const data = problemFixture('CURRENT');
    data.working.current!.overviewCorrectionNotices = [
      {
        attemptRef: 'AQ-check',
        targetWorkRef: 'MW-old',
        reason: '核对旧综合',
        attemptStatus: 'FAILED',
        savedWorkRef: 'MW-saved',
        savedWorkingRevision: 4,
      },
    ];
    const html = renderQuicklook(data);
    expect(html).toContain('请求状态：未完成');
    expect(html).toContain('已保存后续工作；保存不等于错误已消除');
    expect(html).toContain('workRef=MW-old');
    expect(html).toContain('workRef=MW-saved');
    expect(html).not.toContain('现有综合尚未覆盖');
  });
  it('retains reference notices at quicklook scope even without a matching issue key', () => {
    const data = problemFixture('CURRENT');
    data.working.current!.referenceWorkNotices = [
      {
        sourceWork: {
          subjectKind: 'ENGINEERING_MATTER',
          subjectId: 'MAT-source',
          workRef: 'MW-source',
          issueKey: 'other',
        },
        evidenceRef: 'prior',
        affectedIssueKeys: [],
        overviewStatus: 'STALE',
        correctionNotices: [],
      },
    ];
    const html = renderQuicklook(data);
    expect(html).toContain('所引工作的问题正文可读；其综合尚未覆盖');
    expect(html).toContain('sourceWorkRef=MW-source');
    expect(html.match(/所引工作的问题正文可读/g)).toHaveLength(1);
  });
  it('uses the shared exact source route with no invented WorkItem or latest parse run', () => {
    renderQuicklook(libraryMatterFixture());
    const source: DocumentAssessmentEvidence = {
      kind: 'DOCUMENT_PASSAGE',
      evidenceRef: 'e1',
      workItemId: null,
      documentVersionId: 'DV/old',
      sourceRefId: 'source/old',
      locator: JSON.stringify({
        parseRunId: 'PRUN/old',
        sourceRefId: 'source/old',
      }),
      title: '原文',
      versionLabel: '导出快照',
      excerpt: '确切来源',
    };
    mockLocateDocument(source);
    const url = new URL(
      mockNavigate.mock.calls.at(-1)![0],
      'https://example.invalid',
    );
    expect(url.pathname).toBe('/document-versions/DV%2Fold');
    expect(url.searchParams.get('parseRunId')).toBe('PRUN/old');
    expect(url.searchParams.get('sourceRef')).toBe('source/old');
    mockLocateDocument({ ...source, locator: 'Page 1' });
    expect(mockNavigate.mock.calls.at(-1)![0]).toContain(
      '/matters/ui-test-matter?sourceDocument=',
    );
    expect(mockNavigate.mock.calls.at(-1)![0]).not.toMatch(/undefined|null/);
  });
});
