import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import DocumentActivityTimelineView from '../../client/src/features/trinity/DocumentActivityTimelineView';
import { readingReturnTarget } from '../../client/src/features/matter/reading-return';
import EngineeringTimelinePage from '../../client/src/pages/EngineeringTimelinePage/EngineeringTimelinePage';

const mockStatus = jest.fn();
const mockActivity = jest.fn();
const mockLibraryDocuments = jest.fn();
const mockMatter = jest.fn();
const mockSessionCallbacks = new Set<() => void>();
let mockSessionGen = 1;
let mockDetail: any = null;
let mockGraph: any = null;
jest.mock('@lark-apaas/client-toolkit/logger', () => ({ logger: { error: jest.fn() } }));
jest.mock('@client/src/api/canonical-host', () => ({
  readDocumentParsingStatus: (...args: unknown[]) => mockStatus(...args),
  readDocumentActivityReading: (...args: unknown[]) => mockActivity(...args),
  getCanonicalLibraryDocuments: (...args: unknown[]) => mockLibraryDocuments(...args),
  getCanonicalHostClientSessionGeneration: () => mockSessionGen,
  subscribeCanonicalHostClientSession: (callback: () => void) => { mockSessionCallbacks.add(callback); return () => mockSessionCallbacks.delete(callback); },
}));
jest.mock('@client/src/api/engineering-matter', () => ({
  getEngineeringMatter: (...args: unknown[]) => mockMatter(...args),
}));
jest.mock('../../client/src/app/providers/CurrentUserSessionProvider', () => ({
  useCurrentUserSession: () => ({ sessionGeneration: mockSessionGen, authenticationRequired: false }),
}));
jest.mock('@client/src/pages/DocumentParsingPage/DocumentActivityReadingView', () => ({
  __esModule: true, default: (props: any) => { mockDetail = props; return createElement('div', { 'data-testid': 'reading-detail', 'data-statement': props.selectedStatementId }, 'detail'); },
}));

jest.mock('@client/src/features/trinity/DocumentActivityGraphView', () => ({
  __esModule: true, default: (props: any) => { mockGraph = props; return createElement('div', { 'data-testid': 'graph-view' }); },
}));
jest.mock('../../client/src/features/trinity/document-activity-timeline.css', () => ({}));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/components/ui/badge', () => ({ Badge: 'span' }));

describe('engineering timeline view', () => {
  it('asks for an exact library version instead of using an example', () => {
    const html = renderToStaticMarkup(createElement(DocumentActivityTimelineView, {
      reading: null, selectedStatementId: null, onSelectStatement: jest.fn(), onOpenReading: jest.fn(),
    }));
    expect(html).toContain('从资料库选择准确版本');
    expect(html).toContain('不默认使用示例或其他版本');
  });

  it('draws a quarter as a range and keeps TBD outside the calendar map', () => {
    const binding = {
      documentVersionId: 'DV1', parseRunId: 'PR1', parseRevision: 1,
      sourceArtifactId: 'SA1', sourceSha256: 'a'.repeat(64), sourceByteLength: 1,
    };
    const candidate = {
      schemaVersion: 'wiselink.document.activity-candidate.v1', candidateOnly: true,
      sourceBinding: { original: binding, semanticRevision: 1 },
      readCoverage: { status: 'DELIVERED_RANGES_ONLY', selection: { sectionIds: [] }, deliveredRanges: [], sourceCoverage: { knownPageCount: 0, readPageIndexes: [], unresolvedRanges: [] } },
      sourceAnchors: [], runRef: 'run', candidateRevision: 1,
      producer: { skillVersion: 's', modelVersion: 'm' }, savedAt: '2026-09-16',
      statements: [
        { statementId: 'Q', statementKey: 'q', label: '季度预计', quotes: [], time: { role: 'TARGET', precision: 'QUARTER', expression: 'CALENDAR', raw: '2026 Q4', quoteIndex: 0 }, statusRaw: null, limitations: [] },
        { statementId: 'T', statementKey: 't', label: '时间待定', quotes: [], time: { role: 'UNKNOWN', precision: 'UNKNOWN', expression: 'TBD', raw: 'TBD', quoteIndex: 0 }, statusRaw: null, limitations: [] },
      ],
    } as any;
    const html = renderToStaticMarkup(createElement(DocumentActivityTimelineView, {
      reading: { familyId: 'F1', binding, candidate }, selectedStatementId: 'T',
      onSelectStatement: jest.fn(), onOpenReading: jest.fn(),
    }));
    const map = html.match(/<svg[\s\S]*?<\/svg>/u)?.[0] ?? '';
    expect(map).toContain('activity-map-range');
    expect(map).not.toContain('TBD');
    expect(map).toMatch(/<text x="125" y="24" text-anchor="middle">1月<\/text>/u);
    expect(html).toContain('日期未定／尚无可计算时间');
  });
});

describe('engineering timeline page gates', () => {
  const { JSDOM } = require('jsdom');
  let dom: InstanceType<typeof JSDOM>;
  let root: Root;
  let container: HTMLElement;
  let router: ReturnType<typeof createMemoryRouter>;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test/' });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
    Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
    container = dom.window.document.getElementById('root');
    mockStatus.mockReset(); mockActivity.mockReset(); mockLibraryDocuments.mockReset(); mockMatter.mockReset(); mockSessionGen = 1; mockDetail = null; mockSessionCallbacks.clear();
  });
  afterEach(() => { act(() => root?.unmount()); router?.dispose(); dom.window.close(); });

  async function mount(path: string) {
    router = createMemoryRouter([{ path: '/document-versions/:documentVersionId/engineering-timeline', element: createElement(EngineeringTimelinePage) }, {path:'/timeline', element:createElement(EngineeringTimelinePage)}, {path:'/activity-graph', element:createElement(EngineeringTimelinePage, {view:'graph'})}, {path:'/document-versions/:documentVersionId/activities', element:createElement('div', null, 'activities')}], { initialEntries: [path] });
    root = createRoot(container);
    await act(async () => root.render(createElement(RouterProvider, { router })));
  }

  it('blocks a half candidate pin before any request and renders the validation error', async () => {
    await mount('/document-versions/DV1/engineering-timeline?parseRunId=PR1&runRef=run-only');
    expect(mockStatus).not.toHaveBeenCalled();
    expect(mockActivity).not.toHaveBeenCalled();
    expect(container.textContent).toContain('候选改版与运行标识必须成对出现');
  });

  it('distinguishes an exact source with no saved candidate from source discovery', async () => {
    mockActivity.mockResolvedValue({ familyId: 'F1', binding: { documentVersionId: 'DV1', parseRunId: 'PR1' }, candidate: null });
    await mount('/document-versions/DV1/engineering-timeline?parseRunId=PR1');
    await act(async () => undefined);
    expect(mockActivity).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('当前准确来源尚无已保存候选');
    expect(container.textContent).not.toContain('从资料库选择准确版本');
  });

  it('updates the URL immediately when a saved statement is selected', async () => {
    mockActivity.mockResolvedValue({
      familyId: 'F1', binding: { documentVersionId: 'DV1', parseRunId: 'PR1' },
      candidate: {
        schemaVersion: 'wiselink.document.activity-candidate.v1', candidateOnly: true,
        sourceBinding: { original: { documentVersionId: 'DV1', parseRunId: 'PR1' }, semanticRevision: 1 },
        readCoverage: { status: 'DELIVERED_RANGES_ONLY', selection: { sectionIds: [] }, deliveredRanges: [], sourceCoverage: { knownPageCount: 0, readPageIndexes: [], unresolvedRanges: [] } },
        sourceAnchors: [], runRef: 'run-2', candidateRevision: 2, producer: { skillVersion: 's', modelVersion: 'm' }, savedAt: '2026-09-16T00:00:00.000Z',
        statements: [{ statementId: 'S1', statementKey: 'k1', label: '厂商计划', quotes: [], time: { role: 'TARGET', precision: 'UNKNOWN', expression: 'TBD', raw: 'Q/TBD', quoteIndex: 0 }, statusRaw: null, limitations: [] }],
      },
    });
    await mount('/document-versions/DV1/engineering-timeline?parseRunId=PR1&candidateRevision=2&runRef=run-2');
    await act(async () => undefined);
    const statement = container.querySelector('.activity-timeline-select') as HTMLElement;
    expect(statement).not.toBeNull();
    await act(async () => statement.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    expect(router.state.location.search).toContain('statementId=S1');
  });
  it('resolves a stable default document version from the authorized catalog when none is pinned', async () => {
    mockStatus.mockImplementation(() => new Promise(() => undefined));
    mockLibraryDocuments.mockResolvedValue({ items: [
      { documentId: 'D1', versions: [ { documentVersionId: 'DV-OLD', selectedVersionIsCurrent: false }, { documentVersionId: 'DV-CUR', selectedVersionIsCurrent: true } ] },
    ] });
    await mount('/timeline');
    await act(async () => undefined);
    expect(mockLibraryDocuments).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe('/timeline');
    expect(new URLSearchParams(router.state.location.search).get('documentVersionId')).toBe('DV-CUR');
  });

  it('shows a page-scoped empty state without claiming the whole catalog has no versions', async () => {
    mockLibraryDocuments.mockResolvedValue({ items: [], nextCursor: null });
    await mount('/timeline');
    await act(async () => undefined);
    expect(mockLibraryDocuments).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('本页未取到当前版本');
    expect(container.textContent).toContain('这不代表当前账号没有任何文档版本');
    expect(container.textContent).toContain('当前已读到目录末尾');
    expect(new URLSearchParams(router.state.location.search).get('documentVersionId')).toBeNull();
  });

  function matterEntry(documentVersionId: string, selectedVersionIsCurrent: boolean) {
    return {
      workItemId: 'WI-1', relationRole: 'PRIMARY', linkedAtWorkItemRevision: 1, currentWorkItemRevision: 1,
      workItemChangedSinceLink: false, workItemStatus: 'ACTIVE',
      document: { documentId: `DOC-${documentVersionId}`, documentVersionId, documentCode: 'C', businessRevision: 'R1', normalizedFamily: 'F' },
      documentCurrentness: { familyId: 'F', currentDocumentVersionId: selectedVersionIsCurrent ? documentVersionId : null, currentGeneration: 1, selectedVersionIsCurrent },
      sourceNavigation: { status: 'NOT_PARSED', sourceRefCount: 0, structuredContentPath: null },
    };
  }

  it('blocks an orphan parse run pin without touching the document catalog or a matter', async () => {
    await mount('/timeline?parseRunId=PR1');
    await act(async () => undefined);
    expect(mockLibraryDocuments).not.toHaveBeenCalled();
    expect(mockMatter).not.toHaveBeenCalled();
    expect(container.textContent).toContain('缺少所属文档版本');
    expect(new URLSearchParams(router.state.location.search).get('documentVersionId')).toBeNull();
  });

  it('blocks orphan candidate pins without touching the document catalog or a matter', async () => {
    await mount('/timeline?candidateRevision=2&runRef=run-2');
    await act(async () => undefined);
    expect(mockLibraryDocuments).not.toHaveBeenCalled();
    expect(mockMatter).not.toHaveBeenCalled();
    expect(container.textContent).toContain('未指定解析版本时');
  });

  it('resolves a matter entry from the matter registered sources instead of the global catalog', async () => {
    mockMatter.mockResolvedValue({ catalog: { entries: [matterEntry('DV-OLD', false), matterEntry('DV-CUR', true)] } });
    await mount('/timeline?matterId=M1');
    await act(async () => undefined);
    expect(mockMatter).toHaveBeenCalledTimes(1);
    expect(mockLibraryDocuments).not.toHaveBeenCalled();
    expect(new URLSearchParams(router.state.location.search).get('documentVersionId')).toBe('DV-CUR');
  });

  it('blocks a matter entry that registers no document version without falling back to the global catalog', async () => {
    mockMatter.mockResolvedValue({ catalog: { entries: [] } });
    await mount('/timeline?matterId=M1');
    await act(async () => undefined);
    expect(mockLibraryDocuments).not.toHaveBeenCalled();
    expect(container.textContent).toContain('该事项没有已登记的文档版本');
    expect(new URLSearchParams(router.state.location.search).get('documentVersionId')).toBeNull();
  });

  it('keeps a matter read failure blocked instead of swapping to another object', async () => {
    mockMatter.mockRejectedValue(new Error('forbidden'));
    await mount('/timeline?matterId=M1');
    await act(async () => undefined);
    expect(mockLibraryDocuments).not.toHaveBeenCalled();
    expect(container.textContent).toContain('事项来源读取受阻');
    expect(new URLSearchParams(router.state.location.search).get('documentVersionId')).toBeNull();
  });

  it('rejects an invalid empty matter id before any catalog or matter request', async () => {
    await mount('/timeline?matterId=');
    await act(async () => undefined);
    expect(mockMatter).not.toHaveBeenCalled();
    expect(mockLibraryDocuments).not.toHaveBeenCalled();
    expect(container.textContent).toContain('事项标识为空、重复或不合法');
  });

  it('keeps the time window when resolving the global default document', async () => {
    mockLibraryDocuments.mockResolvedValue({ items: [
      { documentId: 'D1', versions: [ { documentVersionId: 'DV-CUR', selectedVersionIsCurrent: true } ] },
    ], nextCursor: null });
    await mount('/timeline?window=current-year');
    await act(async () => undefined);
    const params = new URLSearchParams(router.state.location.search);
    expect(params.get('documentVersionId')).toBe('DV-CUR');
    expect(params.get('window')).toBe('current-year');
  });

  function saved(runRef = 'run-2') {
    return { familyId: 'F1', binding: {documentVersionId:'DV1', parseRunId:'PR1'}, candidate: {
      runRef, candidateRevision:2, savedAt:'2026-09-16T00:00:00Z', sourceAnchors:[],
      statements: ['S1','S2'].map(statementId=>({statementId, label:statementId, time:null, quotes:[{anchorId: statementId === 'S1' ? 'A1' : 'A2'}], statusRaw:null, limitations:[]})),
    }};
  }
  const thisYear = new Date().getFullYear();
  function windowedSaved() {
    return { familyId: 'F1', binding: {documentVersionId:'DV1', parseRunId:'PR1'}, candidate: {
      schemaVersion: 'wiselink.document.activity-candidate.v1', candidateOnly: true,
      sourceBinding: { original: {documentVersionId:'DV1', parseRunId:'PR1'}, semanticRevision: 1 },
      readCoverage: { status: 'DELIVERED_RANGES_ONLY', selection: { sectionIds: [] }, deliveredRanges: [], sourceCoverage: { knownPageCount: 0, readPageIndexes: [], unresolvedRanges: [] } },
      runRef:'run-2', candidateRevision:2, producer:{skillVersion:'s', modelVersion:'m'},
      savedAt:'2026-09-16T00:00:00Z', sourceAnchors:[],
      statements: [
        { statementId:'S-IN', statementKey:'k-in', label:'窗口内', quotes:[{anchorId:'A1', start:0, end:1, text:'x'}], time:{ role:'TARGET', precision:'DAY', expression:'CALENDAR', raw:`${thisYear}-03-05`, quoteIndex:0 }, statusRaw:null, limitations:[] },
        { statementId:'S-OUT', statementKey:'k-out', label:'窗口外', quotes:[], time:{ role:'TARGET', precision:'QUARTER', expression:'CALENDAR', raw:`${thisYear - 1} Q3`, quoteIndex:0 }, statusRaw:null, limitations:[] },
      ],
    }};
  }
  const pinned = '/timeline?documentVersionId=DV1&parseRunId=PR1&candidateRevision=2&runRef=run-2';
  it('follows external URL selection without re-reading the same saved candidate', async () => {
    mockActivity.mockResolvedValue(saved());
    await mount(`${pinned}&statementId=S1`);
    expect(mockDetail.selectedStatementId).toBe('S1');
    await act(async()=>{await router.navigate(`${pinned}&statementId=S2`);});
    expect(mockActivity).toHaveBeenCalledTimes(1);
    expect(mockDetail.selectedStatementId).toBe('S2');
  });
  it('reloads after a session change and discards a late response from the previous session', async () => {
    let resolveOld: (value: unknown) => void = () => undefined;
    mockActivity.mockImplementationOnce(()=>new Promise(r=>{resolveOld=r;})).mockResolvedValueOnce(saved());
    await mount(`${pinned}&statementId=S1`);
    await act(async()=>{mockSessionCallbacks.forEach(callback=>callback());});
    expect(mockActivity).toHaveBeenCalledTimes(2);
    expect(mockDetail.selectedStatementId).toBe('S1');
    await act(async()=>{resolveOld(saved('old-session-run'));});
    expect(mockDetail.candidate.runRef).toBe('run-2');
    expect(container.textContent).not.toContain('正在读取');
  });
  it('returns with actual clicked statement and anchor, including candidate-level anchors', async () => {
    mockActivity.mockResolvedValue(saved());
    await mount(`${pinned}&statementId=S1`);
    const statementBack = new URLSearchParams(mockDetail.returnParamsFor(mockDetail.binding, 'S2', 'A2'));
    const nested = new URLSearchParams(statementBack.get('returnActivityQuery')!);
    expect(nested.get('statementId')).toBe('S2'); expect(nested.get('anchor')).toBe('A2');
    expect(statementBack.get('returnActivityView')).toBe('timeline');
    const candidateBack = new URLSearchParams(mockDetail.returnParamsFor(mockDetail.binding, null, 'A2'));
    expect(new URLSearchParams(candidateBack.get('returnActivityQuery')!).has('statementId')).toBe(false);
    expect(mockDetail.returnParamsFor({...mockDetail.binding, parseRunId:'OTHER'}, 'S2','A2')).toBeNull();
    expect(container.querySelector('button button')).toBeNull();
    const anchor = [...container.querySelectorAll('button')].find(button=>button.textContent === '锚点 A2')!;
    await act(async()=>{anchor.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));});
    expect(router.state.location.pathname).toBe('/document-versions/DV1/activities');
    expect(new URLSearchParams(router.state.location.search).get('statementId')).toBe('S2');
    expect(new URLSearchParams(router.state.location.search).get('anchor')).toBe('A2');
  });
  it('keeps an explicitly missing candidate as an error without a second empty-state message', async () => {
    mockActivity.mockResolvedValue({familyId:'F1', binding:{documentVersionId:'DV1',parseRunId:'PR1'},candidate:null});
    await mount(pinned);
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(container.textContent).toContain('没有已保存的活动候选');
    expect(container.textContent).not.toContain('从资料库选择准确版本');
  });

  it('preserves the exact selected statement and anchor through graph and timeline', async () => {
    const response = saved();
    response.candidate.sourceAnchors = [{anchorId:'A2', sourceRefIds:[]}] as any;
    mockActivity.mockResolvedValue(response);
    await mount(`${pinned}&statementId=S2&anchor=A2`);
    const graphButton = [...container.querySelectorAll('.activity-timeline-item.selected button')].find(button=>button.textContent === '进入图谱')!;
    await act(async()=>graphButton.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
    expect(router.state.location.pathname).toBe('/activity-graph');
    expect(mockGraph.selectedStatementId).toBe('S2'); expect(mockGraph.selectedAnchorId).toBe('A2');
    const readsBeforeSelection = mockActivity.mock.calls.length;
    await act(async()=>mockGraph.onSelectLocation('S1','A1'));
    expect(mockActivity).toHaveBeenCalledTimes(readsBeforeSelection);
    expect(new URLSearchParams(router.state.location.search).get('statementId')).toBe('S1');
    expect(new URLSearchParams(router.state.location.search).get('anchor')).toBe('A1');
    const back = new URLSearchParams(mockDetail.returnParamsFor(mockDetail.binding,'S2','A2'));
    expect(back.get('returnActivityView')).toBe('graph');
    await act(async()=>mockGraph.onReturnTimeline());
    expect(router.state.location.pathname).toBe('/timeline');
    expect(new URLSearchParams(router.state.location.search).get('anchor')).toBe('A1');
  });
  it('switching windows never re-reads the same saved candidate and keeps the window in the URL', async () => {
    mockActivity.mockResolvedValue(windowedSaved());
    await mount(`${pinned}&window=all`);
    await act(async () => undefined);
    expect(mockActivity).toHaveBeenCalledTimes(1);
    const currentYearButton = container.querySelector('[data-window="current-year"]') as HTMLElement;
    await act(async () => { currentYearButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    expect(mockActivity).toHaveBeenCalledTimes(1);
    expect(router.state.location.search).toContain('window=current-year');
    expect(container.textContent).toContain('窗口内 1 条 · 窗口外 1 条');
  });

  it('keeps a selected statement outside the window as marked context and never counts it in the window', async () => {
    mockActivity.mockResolvedValue(windowedSaved());
    await mount(`${pinned}&window=current-year&statementId=S-OUT`);
    await act(async () => undefined);
    expect(container.textContent).toContain('窗口外声明 · 保留为上下文');
    expect(container.querySelector('.activity-window-context .activity-timeline-item.selected')).not.toBeNull();
    expect(container.textContent).toContain('该声明在当前时间窗外');
    expect(container.textContent).toContain('窗口内 1 条');
    expect(container.textContent).not.toContain('窗口内 2 条');
  });

  it('rejects an out-of-whitelist window value before any request', async () => {
    await mount(`${pinned}&window=bogus`);
    expect(mockStatus).not.toHaveBeenCalled();
    expect(mockActivity).not.toHaveBeenCalled();
    expect(container.textContent).toContain('时间窗参数不在允许范围内');
  });

  it('rejects a duplicated window pin before any request', async () => {
    await mount(`${pinned}&window=all&window=all`);
    expect(mockStatus).not.toHaveBeenCalled();
    expect(mockActivity).not.toHaveBeenCalled();
    expect(container.textContent).toContain('时间窗参数出现重复');
  });

  it('keeps DV/parse/candidate/run/statement/anchor/window through timeline, graph, reading and return', async () => {
    mockActivity.mockResolvedValue(windowedSaved());
    await mount(`${pinned}&window=current-year&statementId=S-IN&anchor=A1`);
    await act(async () => undefined);
    const graphButton = [...container.querySelectorAll('.activity-timeline-item.selected button')].find(button => button.textContent === '进入图谱')!;
    await act(async () => graphButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    expect(router.state.location.pathname).toBe('/activity-graph');
    let graphQuery = new URLSearchParams(router.state.location.search);
    expect(graphQuery.get('documentVersionId')).toBe('DV1');
    expect(graphQuery.get('parseRunId')).toBe('PR1');
    expect(graphQuery.get('candidateRevision')).toBe('2');
    expect(graphQuery.get('runRef')).toBe('run-2');
    expect(graphQuery.get('statementId')).toBe('S-IN');
    expect(graphQuery.get('anchor')).toBe('A1');
    expect(graphQuery.get('window')).toBe('current-year');
    await act(async () => mockGraph.onReturnTimeline());
    expect(router.state.location.pathname).toBe('/timeline');
    expect(new URLSearchParams(router.state.location.search).get('window')).toBe('current-year');
    const anchorButton = [...container.querySelectorAll('.activity-timeline-item.selected button')].find(button => button.textContent === '锚点 A1')!;
    await act(async () => anchorButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    expect(router.state.location.pathname).toBe('/document-versions/DV1/activities');
    const readingQuery = new URLSearchParams(router.state.location.search);
    expect(readingQuery.get('statementId')).toBe('S-IN');
    expect(readingQuery.get('anchor')).toBe('A1');
    expect(readingQuery.get('window')).toBe('current-year');
    const nested = new URLSearchParams(readingQuery.get('returnActivityQuery')!);
    expect(nested.get('parseRunId')).toBe('PR1');
    expect(nested.get('candidateRevision')).toBe('2');
    expect(nested.get('runRef')).toBe('run-2');
    expect(nested.get('statementId')).toBe('S-IN');
    expect(nested.get('anchor')).toBe('A1');
    expect(nested.get('window')).toBe('current-year');
    const target = readingReturnTarget(readingQuery, 'DV1', 'PR1');
    expect(target).not.toBeNull();
    expect(target!.route).toContain('/timeline?');
    expect(target!.route).toContain('window=current-year');
    await act(async () => { await router.navigate(target!.route); });
    expect(router.state.location.pathname).toBe('/timeline');
    const backQuery = new URLSearchParams(router.state.location.search);
    expect(backQuery.get('statementId')).toBe('S-IN');
    expect(backQuery.get('anchor')).toBe('A1');
    expect(backQuery.get('window')).toBe('current-year');
    const lastRequest = mockActivity.mock.calls[mockActivity.mock.calls.length - 1][0];
    expect(lastRequest).toEqual({ documentVersionId: 'DV1', parseRunId: 'PR1', candidateRevision: 2 });
  });

  it('issues no second request when the window changes while the first read is still pending', async () => {
    let resolveRead: (value: unknown) => void = () => undefined;
    mockActivity.mockImplementation(() => new Promise((resolve) => { resolveRead = resolve; }));
    await mount(`${pinned}&window=all`);
    expect(mockActivity).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('正在读取');
    await act(async () => { await router.navigate(`${pinned}&window=current-year`); });
    expect(mockActivity).toHaveBeenCalledTimes(1);
    await act(async () => { resolveRead(windowedSaved()); });
    expect(container.textContent).toContain('窗口内 1 条 · 窗口外 1 条');
    expect(container.querySelector('[data-window="current-year"].active')).not.toBeNull();
  });

  it('keeps the newest window when an unpinned discovery finishes after a window change', async () => {
    let resolveRead: (value: unknown) => void = () => undefined;
    mockStatus.mockResolvedValue({ publishedRun: { parseRunId: 'PR1' } });
    mockActivity.mockImplementation(() => new Promise((resolve) => { resolveRead = resolve; }));
    await mount('/timeline?documentVersionId=DV1&window=all');
    expect(mockStatus).toHaveBeenCalledTimes(1);
    expect(mockActivity).toHaveBeenCalledTimes(1);
    await act(async () => { await router.navigate('/timeline?documentVersionId=DV1&window=current-year'); });
    expect(mockActivity).toHaveBeenCalledTimes(1);
    await act(async () => { resolveRead(windowedSaved()); });
    const query = new URLSearchParams(router.state.location.search);
    expect(query.get('window')).toBe('current-year');
    expect(query.get('parseRunId')).toBe('PR1');
    expect(query.get('candidateRevision')).toBe('2');
    expect(query.get('runRef')).toBe('run-2');
  });

  it('nests library context when opening details so the exact timeline return remains valid', async () => {
    mockActivity.mockResolvedValue(saved());
    await mount(`${pinned}&returnLibraryQuery=${encodeURIComponent('mode=document&search=777')}`);
    const readButton = [...container.querySelectorAll('button')].find(button=>button.textContent === '阅读原文依据')!;
    await act(async()=>readButton.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
    const query = new URLSearchParams(router.state.location.search);
    expect(query.has('returnLibraryQuery')).toBe(false);
    const target = readingReturnTarget(query);
    expect(target).not.toBeNull();
    expect(JSON.stringify(target)).toContain('/timeline?');
    expect(new URLSearchParams(query.get('returnActivityQuery')!).get('returnLibraryQuery')).toBe('mode=document&search=777');
  });

  it('E1 REVIEW: orphan parse run never receives a catalog default DV', async () => {
    mockLibraryDocuments.mockResolvedValue({items:[{versions:[{documentVersionId:'UNRELATED',selectedVersionIsCurrent:true}]}]});
    mockActivity.mockImplementation(() => new Promise(() => undefined));
    await mount('/timeline?parseRunId=PR-EXPLICIT');
    expect(mockLibraryDocuments).not.toHaveBeenCalled();
  });

  it('E1 REVIEW: explicit matter never receives a global document default', async () => {
    mockLibraryDocuments.mockResolvedValue({items:[]});
    await mount('/timeline?matterId=M1');
    expect(mockLibraryDocuments).not.toHaveBeenCalled();
  });

  it('E1 REVIEW: old-session catalog cannot navigate after session invalidation', async () => {
    let complete!: (result: unknown) => void;
    mockLibraryDocuments.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    mockStatus.mockImplementation(() => new Promise(() => undefined));
    await mount('/timeline');
    const oldComplete = complete;
    await act(async () => { mockSessionGen += 1; mockSessionCallbacks.forEach(callback => callback()); });
    await act(async () => { oldComplete({items:[{versions:[{documentVersionId:'OLD-ACTOR-DV',selectedVersionIsCurrent:true}]}]}); });
    expect(router.state.location.search).not.toContain('OLD-ACTOR-DV');
  });

});
