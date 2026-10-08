import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { graphActivityV2 } from './fixtures/graph-activity-v2';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import WikiRecentChanges, { type WikiRecentChangesProps } from '../../client/src/features/matter/WikiRecentChanges';
import EngineeringTimelinePage from '../../client/src/pages/EngineeringTimelinePage/EngineeringTimelinePage';
import { validateActivityEntry } from '../../client/src/pages/DocumentParsingPage/document-activity-entry';
import { conversation, jobAidWork, matterWork, sourceReading } from './helpers/wiki-recent-changes.fixture';

const mockReview = jest.fn();
const mockStatus = jest.fn();
const mockActivity = jest.fn();
let mockGeneration = 1;
let mockAuthenticationRequired = false;
let routerLocation = '';
let navigateBack: ReturnType<typeof useNavigate>;
function RouteProbe() { const location = useLocation(); routerLocation = `${location.pathname}${location.search}`; navigateBack = useNavigate(); return null; }
jest.mock('@client/src/api/canonical-host', () => ({
  getCurrentReviewConversation: (...args: unknown[]) => mockReview(...args),
  readDocumentParsingStatus: (...args: unknown[]) => mockStatus(...args),
  readDocumentActivityReading: (...args: unknown[]) => mockActivity(...args),
  getCanonicalHostClientSessionGeneration: () => mockGeneration,
  subscribeCanonicalHostClientSession: () => () => {},
  getCanonicalLibraryDocuments: jest.fn(),
}));
jest.mock('@client/src/api/engineering-matter', () => ({ getEngineeringMatter: jest.fn() }));
jest.mock('@lark-apaas/client-toolkit/logger', () => ({ logger: { error: jest.fn() } }));
jest.mock('@client/src/pages/DocumentParsingPage/DocumentActivityReadingView', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/features/trinity/DocumentActivityGraphView', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({
  useCurrentUserSession: () => ({ sessionGeneration: mockGeneration, authenticationRequired: mockAuthenticationRequired }),
}));
jest.mock('../../client/src/features/trinity/document-activity-timeline.css', () => ({}));
jest.mock('@client/src/components/ui/button', () => ({ Button: ({ children, ...rest }: { children: unknown }) =>
  require('react').createElement('button', rest, children) }));
const source = { label: '登记版本一', documentVersionId: 'DV1', parseRunId: 'PR1', candidateRevision: 2, runRef: 'DA1' };

describe('Wiki embedding of existing reads (DOM + mocked HTTP boundaries)', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLElement;
  let props: WikiRecentChangesProps;
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test/' });
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
      navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true }))
      Object.defineProperty(globalThis, key, { configurable: true, value });
    container = dom.window.document.getElementById('root')!;
    root = createRoot(container);
    mockReview.mockReset(); mockStatus.mockReset(); mockActivity.mockReset();
    mockGeneration = 1; mockAuthenticationRequired = false;
    mockReview.mockResolvedValue({ conversation: null, currentWorkItemRevision: 5 });
    mockStatus.mockResolvedValue({ publishedRun: { parseRunId: 'PR1' } });
    mockActivity.mockResolvedValue(sourceReading);
    props = { work: matterWork, mode: 'CURRENT', authorizedSessionGeneration: 1,
      reviewWorkItemId: 'WI1', sources: [source] };
  });
  afterEach(() => { act(() => root.unmount()); dom.window.close(); });
  async function render(next = props) {
    props = next;
    await act(async () => root.render(createElement(MemoryRouter, { basename: '/app', initialEntries: ['/app/wiki'] }, createElement(RouteProbe), createElement(WikiRecentChanges, props))));
  }
  async function expand() {
    const details = [...container.querySelectorAll('details')].find(item => item.querySelector('summary')?.textContent === '来源活动解释候选')!;
    await act(async () => { details.open = true; details.dispatchEvent(new dom.window.Event('toggle')); });
  }
  async function select(index = 1) {
    const element = container.querySelector('select')!;
    await act(async () => { element.value = element.options[index].value;
      element.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
  }

  it('defaults to the exact save and current actor Matter scope, with zero source/model reads', async () => {
    await render();
    expect(container.textContent).toContain('本工作实际变化');
    expect(container.textContent).toContain('保存固定核查范围');
    expect(container.textContent).toContain('候选保存不代表正式采用或工程执行');
    expect(mockReview).toHaveBeenCalledWith('WI1', { kind: 'ENGINEERING_MATTER', matterId: 'M1' });
    expect(mockActivity).not.toHaveBeenCalled(); expect(mockStatus).not.toHaveBeenCalled();
  });

  it('does not read current conversation or candidate for a historical work even with full source pins', async () => {
    await render({ ...props, mode: 'HISTORICAL' });
    await expand(); await select();
    expect(mockReview).not.toHaveBeenCalled(); expect(mockActivity).not.toHaveBeenCalled();
    expect(mockStatus).not.toHaveBeenCalled();
    expect(container.textContent).toContain('不会读取最新候选');
    expect(container.querySelector('[data-work-ref="MW-2"]')).not.toBeNull();
  });

  it('does not fill an absent work with current discussion or demo history', async () => {
    await render({ ...props, work: null });
    expect(mockReview).not.toHaveBeenCalled();
    expect(container.textContent).toContain('没有可核对的已保存工作');
    expect(container.textContent).not.toContain('2024-03-15');
  });

  it('rejects mixed current conversation scope and clears the supplied save', async () => {
    mockReview.mockResolvedValue({ conversation: conversation(), currentWorkItemRevision: 5 });
    await render();
    expect(container.textContent).toContain('访问已失效');
    expect(container.textContent).not.toContain('保存固定核查范围');
  });

  it.each([401, 403, 404])('clears save and source choices after current GET denial %i', async statusCode => {
    mockReview.mockRejectedValue(Object.assign(new Error('denied'), { statusCode }));
    await render();
    expect(container.textContent).toContain('已停止展示保存记录');
    expect(container.querySelector('select')).toBeNull();
  });

  it('keeps an independently saved work after transient receipt failure without inventing updates', async () => {
    mockReview.mockRejectedValue(new Error('temporary unavailable'));
    await render();
    expect(container.textContent).toContain('保存固定核查范围');
    expect(container.textContent).toContain('回执读取失败');
    expect(container.querySelector('[data-review-turn]')).toBeNull();
  });

  it('does not render or request anything from another login generation', async () => {
    mockGeneration = 2;
    await render();
    expect(mockReview).not.toHaveBeenCalled(); expect(mockActivity).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('保存固定核查范围');
    expect(container.textContent).toContain('重新读取');
  });

  it('discards a late receipt response after actor/session changed', async () => {
    let resolve!: (value: unknown) => void;
    mockReview.mockReturnValue(new Promise(value => { resolve = value; }));
    await render({ ...props, work: jobAidWork });
    mockGeneration = 2;
    await render();
    await act(async () => resolve({ conversation: conversation(), currentWorkItemRevision: 5 }));
    expect(container.querySelector('[data-review-turn]')).toBeNull();
    expect(container.textContent).not.toContain('保存固定问题更正');
  });

  it('requires both explicit expansion and a registered source selection, then reads exact candidate', async () => {
    await render(); await expand();
    expect(mockActivity).not.toHaveBeenCalled(); // No default first document.
    await select();
    expect(mockStatus).not.toHaveBeenCalled();
    expect(mockActivity).toHaveBeenCalledTimes(1);
    expect(mockActivity.mock.calls[0][0]).toEqual({ documentVersionId: 'DV1', parseRunId: 'PR1', candidateRevision: 2, acceptCandidateSchemaV2: true });
    expect(container.textContent).toContain('来源目标计划');
    expect(container.textContent).toContain('TBD');
    const link = container.querySelector('a[href^="/app/timeline?"]')!;
    const query = new URLSearchParams(link.getAttribute('href')!.split('?')[1]);
    expect(Object.fromEntries(query)).toMatchObject({ documentVersionId: 'DV1', parseRunId: 'PR1', candidateRevision: '2', runRef: 'DA1' });
    await act(async () => {
      link.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true }));
      (link as HTMLAnchorElement).focus();
    });
    expect(dom.window.document.activeElement).toBe(link);
    expect(routerLocation).toBe('/wiki');
    expect(mockActivity).toHaveBeenCalledTimes(1);
    expect(mockStatus).not.toHaveBeenCalled();
    const window = container.querySelector('button[data-window="current-year"]')!;
    await act(async () => window.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    expect(mockActivity).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('泳道尚无实际记录接入');
    expect(container.querySelector('.activity-timeline-item.execution, .activity-timeline-item.observation, .activity-timeline-item.knowledge')).toBeNull();
  });

  it('uses discovery only for an explicitly selected current source and pins the returned identity', async () => {
    await render({ ...props, sources: [{ label: '登记版本一', documentVersionId: 'DV1' }] });
    await expand(); await select();
    expect(mockStatus).toHaveBeenCalledWith('DV1', expect.any(AbortSignal));
    expect(mockActivity.mock.calls[0][0]).toEqual({ documentVersionId: 'DV1', parseRunId: 'PR1', acceptCandidateSchemaV2: true });
    expect(container.querySelector('a[href^="/app/timeline?"]')?.getAttribute('href')).toContain('runRef=DA1');
  });

  it('activates the exact standalone href with a keyboard click and preserves the selected window', async () => {
    await render(); await expand(); await select();
    await act(async () => container.querySelector<HTMLButtonElement>('button[data-window="current-year"]')!.click());
    const link = container.querySelector<HTMLAnchorElement>('a[href^="/app/timeline?"]')!;
    const href = link.getAttribute('href')!;
    const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 0 });
    await act(async () => link.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect('/app' + routerLocation).toBe(href);
    expect(Object.fromEntries(new URL(href, 'https://example.test').searchParams)).toEqual({
      documentVersionId: 'DV1', parseRunId: 'PR1', candidateRevision: '2', runRef: 'DA1', window: 'current-year',
    });
    expect(mockActivity).toHaveBeenCalledTimes(1);
    expect(mockStatus).not.toHaveBeenCalled();
  });

  it.each([
    ['control', { ctrlKey: true }], ['command', { metaKey: true }],
    ['shift', { shiftKey: true }], ['alt', { altKey: true }], ['middle', { button: 1 }],
  ] as const)('preserves native %s activation of the standalone link', async (_name, options) => {
    await render(); await expand(); await select();
    const link = container.querySelector<HTMLAnchorElement>('a[href^="/app/timeline?"]')!;
    const href = link.getAttribute('href');
    let routerPreventedDefault: boolean | undefined;
    // Observe after React; suppress only JSDOM's unsupported native navigation.
    dom.window.document.addEventListener('click', event => {
      routerPreventedDefault = event.defaultPrevented;
      event.preventDefault();
    }, { once: true });
    await act(async () => link.dispatchEvent(new dom.window.MouseEvent('click', {
      bubbles: true, cancelable: true, ...options,
    })));
    expect(routerPreventedDefault).toBe(false);
    expect(routerLocation).toBe('/wiki');
    expect(link.getAttribute('href')).toBe(href);
    expect(mockActivity).toHaveBeenCalledTimes(1);
    expect(mockStatus).not.toHaveBeenCalled();
  });

  it.each([false, true])('routes exact encoded source/statement pins and window (anchor=%s)', async openAnchor => {
    const pins = { documentVersionId: 'DV_1-main', parseRunId: 'PR/一 &?#', runRef: 'DA/一 &?#', statementId: 'S/一 &?#', anchor: 'A/一 &?#' };
    const reading = graphActivityV2(pins.documentVersionId, pins.parseRunId, 'F1', pins.runRef, 12);
    reading.candidate.statements[0].statementId = pins.statementId;
    reading.candidate.statements[0].quotes[0].anchorId = pins.anchor;
    reading.candidate.sourceAnchors[0].anchorId = pins.anchor;
    mockActivity.mockResolvedValue(reading);
    await render({ ...props, sources: [{ label: '编码来源', documentVersionId: pins.documentVersionId,
      parseRunId: pins.parseRunId, runRef: pins.runRef, candidateRevision: 12 }] });
    await expand(); await select();
    await act(async () => container.querySelector<HTMLButtonElement>('button[data-window="current-year"]')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('.activity-timeline-select')!.click());
    const action = [...container.querySelectorAll('button')].find(button =>
      button.textContent === (openAnchor ? `锚点 ${pins.anchor}` : '阅读原文依据'))!;
    await act(async () => action.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, detail: 0 })));
    const target = new URL(routerLocation, 'https://example.test');
    expect(target.pathname).toBe(`/document-versions/${encodeURIComponent(pins.documentVersionId)}/activities`);
    expect(Object.fromEntries(target.searchParams)).toEqual({ documentVersionId: pins.documentVersionId,
      parseRunId: pins.parseRunId, candidateRevision: '12', runRef: pins.runRef, statementId: pins.statementId,
      window: 'current-year', ...(openAnchor ? { anchor: pins.anchor } : {}),
    });
    expect(validateActivityEntry(target.searchParams)).toEqual({ ok: true, parseRunId: pins.parseRunId,
      candidateRevision: 12, runRef: pins.runRef, statementId: pins.statementId, anchor: openAnchor ? pins.anchor : null,
    });
    expect(mockActivity).toHaveBeenCalledTimes(1);
    expect(mockStatus).not.toHaveBeenCalled();
  });

  it('opens a copied standalone href through the actual timeline Router entry with no prior Wiki reads', async () => {
    await render(); await expand(); await select();
    await act(async () => container.querySelector<HTMLButtonElement>('button[data-window="current-year"]')!.click());
    const href = container.querySelector<HTMLAnchorElement>('a[href^="/app/timeline?"]')!.getAttribute('href')!;
    act(() => root.unmount());
    root = createRoot(container);
    mockActivity.mockClear(); mockStatus.mockClear(); mockReview.mockClear();
    await act(async () => root.render(createElement(MemoryRouter, { basename: '/app', initialEntries: [href] },
      createElement(RouteProbe), createElement(Routes, null,
        createElement(Route, { path: '/timeline', element: createElement(EngineeringTimelinePage) })))));
    expect('/app' + routerLocation).toBe(href);
    expect(mockReview).not.toHaveBeenCalled();
    expect(mockStatus).not.toHaveBeenCalled();
    expect(mockActivity).toHaveBeenCalledTimes(1);
    expect(mockActivity).toHaveBeenCalledWith({ documentVersionId: 'DV1', parseRunId: 'PR1', candidateRevision: 2, acceptCandidateSchemaV2: true }, expect.any(AbortSignal));
    expect(container.querySelector('.activity-timeline-item')).not.toBeNull();
    expect(new URL(routerLocation, 'https://example.test').searchParams.get('window')).toBe('current-year');
  });

  it('renders all saved v2 times and routes source/anchor/timeline through the basename without a page reload', async () => {
    const reading = graphActivityV2('DV1', 'PR1', 'F1', 'DA1');
    mockActivity.mockResolvedValue(reading);
    await render(); await expand(); await select();
    expect(mockActivity.mock.calls[0][0].acceptCandidateSchemaV2).toBe(true);
    const rows = container.querySelectorAll('article.activity-timeline-item');
    expect(rows).toHaveLength(3);
    expect([...rows].map(row => row.querySelector('.activity-time')?.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining('Q4 2026'), expect.stringContaining('TBD'), expect.stringContaining('after approval'),
    ]));
    await act(async () => container.querySelector<HTMLButtonElement>('.activity-timeline-select')!.click());
    expect(container.querySelector('[data-testid="activity-statement-semantics"]')?.textContent).toContain('来源声称已完成');
    expect(container.textContent).toContain(' source reports completed\r\n');
    expect(container.textContent).toContain('LN 2024-2026');
    const anchor = [...container.querySelectorAll('button')].find(button => button.textContent === '锚点 anchor-1')!;
    await act(async () => anchor.click());
    const target = new URL(routerLocation, 'https://example.test');
    expect(target.pathname).toBe('/document-versions/DV1/activities');
    expect(Object.fromEntries(target.searchParams)).toMatchObject({ documentVersionId: 'DV1', parseRunId: 'PR1', candidateRevision: '2', runRef: 'DA1', statementId: 'st-1', anchor: 'anchor-1' });
    // Router navigation retains the mounted reader and basename-aware Link output.
    expect(mockActivity).toHaveBeenCalledTimes(1);
    const timelineLink = container.querySelector<HTMLAnchorElement>('a[href^="/app/timeline?"]')!;
    expect(timelineLink).not.toBeNull();
    await act(async () => timelineLink.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })));
    expect(routerLocation).toContain('/timeline?');
    expect(new URL(routerLocation, 'https://example.test').searchParams.get('runRef')).toBe('DA1');
    await act(async () => navigateBack(-1));
    expect(routerLocation).toContain('/document-versions/DV1/activities?');
    expect(mockActivity).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: '半候选', documentVersionId: 'DV1', parseRunId: 'PR1', runRef: 'DA1' },
    { label: '空解析', documentVersionId: 'DV1', parseRunId: '' },
  ])('refuses invalid explicit source identity without discovery or fallback: $label', async invalid => {
    await render({ ...props, sources: [invalid] }); await expand(); await select();
    expect(mockStatus).not.toHaveBeenCalled(); expect(mockActivity).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('refuses a mismatched saved run instead of replacing explicit candidate pins', async () => {
    mockActivity.mockResolvedValue({ ...sourceReading, candidate: { ...sourceReading.candidate, runRef: 'DA-other' } });
    await render(); await expand(); await select();
    expect(container.textContent).toContain('运行标识与已保存候选不一致');
    expect(container.textContent).not.toContain('来源目标计划');
    expect(mockActivity).toHaveBeenCalledTimes(1);
  });

  it('clears the work after selected-source access is revoked', async () => {
    mockActivity.mockRejectedValue(Object.assign(new Error('revoked'), { statusCode: 403 }));
    await render(); await expand(); await select();
    expect(container.textContent).toContain('已停止展示保存记录');
    expect(container.textContent).not.toContain('保存固定核查范围');
  });

  it('does not refetch for new inline props with the same persistent work and source identity', async () => {
    await render(); await expand(); await select();
    const initialReviewCalls = mockReview.mock.calls.length;
    expect(mockActivity).toHaveBeenCalledTimes(1);
    await render({ ...props, work: structuredClone(matterWork), sources: [{ ...source, label: '同版标签' }] });
    expect(mockReview).toHaveBeenCalledTimes(initialReviewCalls);
    expect(mockActivity).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('来源目标计划');
  });

  it('clears selection and discards an old receipt when the exact work prop changes', async () => {
    let resolve!: (value: unknown) => void;
    mockReview.mockReturnValueOnce(new Promise(value => { resolve = value; }));
    await render({ ...props, work: jobAidWork });
    const nextWork = structuredClone(jobAidWork);
    if (nextWork.kind !== 'WORK_ITEM') throw new Error('fixture');
    nextWork.revision.workRevisionRef = 'JW-3'; nextWork.revision.workRevision = 3;
    nextWork.revision.content.changeSummary = '下一工作保存';
    await render({ ...props, work: nextWork });
    await act(async () => resolve({ conversation: conversation(), currentWorkItemRevision: 5 }));
    expect(mockReview).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-work-ref="JW-2"]')).toBeNull();
    expect(container.querySelector('[data-work-ref="JW-3"]')).not.toBeNull();
    expect(container.querySelector('[data-review-turn]')).toBeNull();
  });

  it('discards a late source response after selecting a different registered exact source', async () => {
    let resolve!: (value: unknown) => void;
    mockActivity.mockReturnValueOnce(new Promise(value => { resolve = value; }));
    const reading2 = structuredClone(sourceReading);
    reading2.binding.documentVersionId = 'DV2'; reading2.binding.parseRunId = 'PR2';
    reading2.candidate.runRef = 'DA2';
    reading2.candidate.sourceBinding.original = { ...reading2.binding };
    reading2.candidate.statements[0].label = '来源二声明';
    mockActivity.mockResolvedValueOnce(reading2);
    await render({ ...props, sources: [source, { label: '登记版本二', documentVersionId: 'DV2',
      parseRunId: 'PR2', candidateRevision: 2, runRef: 'DA2' }] });
    await expand(); await select(1); await select(2);
    await act(async () => resolve(sourceReading));
    expect(mockActivity).toHaveBeenCalledTimes(2);
    expect(mockActivity.mock.calls[1][0]).toEqual({ documentVersionId: 'DV2', parseRunId: 'PR2', candidateRevision: 2, acceptCandidateSchemaV2: true });
    expect(container.textContent).toContain('来源二声明');
    expect(container.textContent).not.toContain('来源目标计划');
    expect(container.querySelector('a[href^="/app/timeline?"]')?.getAttribute('href')).toContain('documentVersionId=DV2');
  });

  it('does not silently repoint a selected source when its candidate identity prop changes', async () => {
    await render(); await expand(); await select();
    await render({ ...props, sources: [{ ...source, candidateRevision: 3, runRef: 'DA3' }] });
    expect(container.querySelector('select')?.value).toBe('');
    expect(container.textContent).not.toContain('来源目标计划');
    expect(mockActivity).toHaveBeenCalledTimes(1);
  });

  it('hides selected source and old work when session generation changes', async () => {
    await render(); await expand(); await select();
    mockGeneration = 2; await render();
    expect(container.textContent).not.toContain('保存固定核查范围');
    expect(container.textContent).not.toContain('来源目标计划');
    expect(container.querySelector('select')).toBeNull();
    expect(mockActivity).toHaveBeenCalledTimes(1);
  });

  it('clears every visible source/record after a source 404, without retaining a previous candidate', async () => {
    mockActivity.mockRejectedValue(Object.assign(new Error('missing'), { statusCode: 404 }));
    await render(); await expand(); await select();
    expect(container.textContent).not.toContain('保存固定核查范围');
    expect(container.textContent).not.toContain('来源目标计划');
    expect(container.querySelector('select')).toBeNull();
  });
});
