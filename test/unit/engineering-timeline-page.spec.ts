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
const mockSessionCallbacks = new Set<() => void>();
let mockDetail: any = null;
let mockGraph: any = null;
jest.mock('@client/src/api/canonical-host', () => ({
  readDocumentParsingStatus: (...args: unknown[]) => mockStatus(...args),
  readDocumentActivityReading: (...args: unknown[]) => mockActivity(...args),
  subscribeCanonicalHostClientSession: (callback: () => void) => { mockSessionCallbacks.add(callback); return () => mockSessionCallbacks.delete(callback); },
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
    mockStatus.mockReset(); mockActivity.mockReset(); mockDetail = null; mockSessionCallbacks.clear();
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
  function saved(runRef = 'run-2') {
    return { familyId: 'F1', binding: {documentVersionId:'DV1', parseRunId:'PR1'}, candidate: {
      runRef, candidateRevision:2, savedAt:'2026-09-16T00:00:00Z', sourceAnchors:[],
      statements: ['S1','S2'].map(statementId=>({statementId, label:statementId, time:null, quotes:[{anchorId: statementId === 'S1' ? 'A1' : 'A2'}], statusRaw:null, limitations:[]})),
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

});
