import { act, createElement, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider, notifyManager, type Query } from '@tanstack/react-query';
import WikiGuideHomePage from '@client/src/pages/WikiGuideHomePage';
import { wikiGuideReturnRoute, wikiGuideStateParams, wikiGuideIssueAnchor, type WikiGuidePageState } from '@client/src/lib/wiki-guide-route';
import type { WikiGuideNode, WikiGuideNavigationQuery, WikiGuideNavigationPage,
  WikiGuideIssueQuery, WikiGuideIssuePage } from '@shared/wiki-guide.interface';

const { JSDOM } = require('jsdom');
const mockNavigation = jest.fn(), mockIssues = jest.fn();
let mockGeneration = 101, mockAuthenticationRequired = false;
jest.mock('@client/src/api/wiki-guide', () => ({
  readWikiGuideNavigation: (...args: unknown[]) => mockNavigation(...args),
  searchWikiGuideIssues: (...args: unknown[]) => mockIssues(...args),
}));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({
  useCurrentUserSession: () => ({ sessionGeneration: mockGeneration,
    authenticationRequired: mockAuthenticationRequired }),
}));
// JSDOM is installed per case, after React's event-support probe. Adapt its input
// event only; the actual page, routing and TanStack resources remain mounted.
jest.mock('@client/src/components/ui/input', () => ({
  Input: ({ onChange, ...props }: ComponentProps<'input'>) => createElement('input', {
    ...props, onChange, onInput: onChange,
  }),
}));
jest.mock('@client/src/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value?: string; onValueChange(value: string): void; children: ReactNode }) =>
    createElement('select', { value, 'aria-label': '选择 ATA 章节',
      onChange: (event: { target: { value: string } }) => onValueChange(event.target.value) }, children),
  SelectContent: ({ children }: { children: ReactNode }) => children,
  SelectItem: ({ value, children, title }: { value: string; children: ReactNode; title?: string }) => createElement('option', { value, title }, children),
  SelectTrigger: () => null, SelectValue: () => null,
}));
jest.mock('@client/src/pages/WikiGuideHomePage/wiki-guide.css', () => ({}));

const ds = (n: number) => 'DS-00000000-0000-4000-8000-' + String(n).padStart(12, '0');
function node(n: number, kind: 'FLEET' | 'ATA2' | 'ATA4', parent: WikiGuideNode | null,
  title: string, code: string | null = null): WikiGuideNode {
  const value: WikiGuideNode = { summaryId: ds(n), parentSummaryId: parent?.summaryId ?? null,
    scope: { kind, title, fleetFamilyId: parent?.scope.fleetFamilyId ?? (n === 1 ? 'B747' : 'A320'),
      fleetModelIds: parent?.scope.fleetModelIds ?? (n === 1 ? ['B747-8'] : ['A320-200']),
      ata2: kind === 'ATA2' ? code : parent?.scope.ata2 ?? null,
      ata4: kind === 'ATA4' ? code : null, selectionReason: '' },
    currentSummaryRef: 'DSR-' + String(n), currentRevision: 3, wikiId: 'WIKI-' + n,
    enabled: true, currentBodyStatus: 'AVAILABLE', state: 'CURRENT', path: [] };
  value.path = [...parent?.path ?? [], { summaryId: value.summaryId, parentSummaryId: value.parentSummaryId,
    scope: value.scope, currentSummaryRef: value.currentSummaryRef, currentRevision: value.currentRevision }];
  return value;
}
const fleetA = node(1, 'FLEET', null, '机型 A'), fleetB = node(2, 'FLEET', null, '机型 B');
const chapterA = node(3, 'ATA2', fleetA, 'B747-8 ATA 31 指示与记录', '31'), chapterA2 = node(4, 'ATA2', fleetA, '飞行操纵', '27');
const sectionA = node(5, 'ATA4', chapterA, 'B747-8 ATA 31-40 综合显示', '31-40');
const chapterB = node(6, 'ATA2', fleetB, '自动飞行', '22'), sectionB = node(7, 'ATA4', chapterB, '自动驾驶', '22-10');
const sectionMore = node(8, 'ATA4', chapterA, '数据记录', '31-30');
const allNodes = [fleetA, fleetB, chapterA, chapterA2, sectionA, chapterB, sectionB, sectionMore];
const issue = { subjectKind: 'WORK_ITEM' as const, subjectId: 'WI-synthetic', workRef: 'JAWR-synthetic-3',
  workRevision: 3, issueKey: 'I4', question: '已保存的告警条件是什么？', documentVersionId: 'DVI-synthetic',
  paths: [sectionA.path] };
const navPage = (items: WikiGuideNode[], nextCursor: string | null = null): WikiGuideNavigationPage => ({ items, nextCursor });
const issuePage = (items = [issue], nextCursor: string | null = null): WikiGuideIssuePage =>
  ({ items, nextCursor, coverage: 'CONFIRMED_WIKI_MEMBERS' });
const chapterCursor = Buffer.from('chapter-page-2').toString('base64url');
const issueCursor = Buffer.from('issue-page-2').toString('base64url');
const sectionCursor = Buffer.from('section-page-2').toString('base64url');
function normalNavigation(query: WikiGuideNavigationQuery): Promise<WikiGuideNavigationPage> {
  if (query.summaryId) return Promise.resolve(navPage(allNodes.filter(item => item.summaryId === query.summaryId)));
  if (query.search) return Promise.resolve(navPage([sectionA]));
  if (!query.parentSummaryId) return Promise.resolve(navPage([fleetA, fleetB]));
  return Promise.resolve(navPage(allNodes.filter(item => item.parentSummaryId === query.parentSummaryId && item !== sectionMore)));
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('Wiki guide actual page and GET resource lifecycle (synthetic metadata)', () => {
  let dom: InstanceType<typeof JSDOM>, root: Root, router: ReturnType<typeof createMemoryRouter>;
  let container: HTMLElement, scroller: HTMLElement, client: QueryClient;
  const removedQueries = new Set<Query>();
  let unsubscribeCache: () => void;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><div data-reading-scroll-container><div id="root"></div></div>', { url: 'https://local.invalid/' });
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
      navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
      previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    notifyManager.setScheduler(queueMicrotask);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    unsubscribeCache = client.getQueryCache().subscribe(event => {
      if (event.type === 'removed') removedQueries.add(event.query);
    });
    container = dom.window.document.getElementById('root')!;
    scroller = dom.window.document.querySelector('[data-reading-scroll-container]')!;
    root = createRoot(container);
    mockGeneration += 1; mockAuthenticationRequired = false;
    mockNavigation.mockReset().mockImplementation(normalNavigation);
    mockIssues.mockReset().mockResolvedValue(issuePage());
  });
  afterEach(async () => {
    await act(async () => {
      await client.cancelQueries(); root.unmount(); client.clear();
    });
    // Access denial removes a query while its fetch is still settling. Its final
    // scheduleGc can outlive cache removal; dispose those detached test observers too.
    for (const query of removedQueries) query.destroy();
    removedQueries.clear(); unsubscribeCache(); router?.dispose();
    jest.restoreAllMocks();
    notifyManager.setScheduler(callback => setTimeout(callback, 0)); dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    previous.clear();
  });
  const query = (search = '', y = 0, chapter = chapterA.summaryId) => wikiGuideStateParams({
    rootSummaryId: fleetA.summaryId, chapterSummaryId: chapter, search, scrollTop: y,
  }).toString();
  async function mount(search = '') {
    router = createMemoryRouter([
      { path: '/situation', element: createElement(WikiGuideHomePage) },
      { path: '/summaries/:id', element: createElement('p', { 'data-existing-reader-route': true }, '既有阅读入口') },
      { path: '/knowledge', element: createElement('p', { 'data-existing-reader-route': true }, '既有精确工作入口') },
    ], { initialEntries: ['/situation' + (search ? '?' + search : '')], future: { v7_relativeSplatPath: true } });
    await act(async () => root.render(createElement(QueryClientProvider, { client },
      createElement(RouterProvider, { router, future: { v7_startTransition: true } }))));
    await settle();
  }
  async function settle(ms = 0) { await act(async () => { await new Promise(done => setTimeout(done, ms)); }); }
  async function click(text: string, selector = 'button') {
    const target = [...container.querySelectorAll<HTMLElement>(selector)].find(item => item.textContent === text);
    expect(target).toBeDefined();
    await act(async () => target!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })));
    await settle();
  }

  it('loads only bounded GET metadata initially and on chapter switches, with exact saved reader links', async () => {
    await mount();
    expect(container.querySelector('h2')?.textContent).toBe('ATA 章节');
    expect(container.textContent).toContain('综合显示');
    const chapterButton = container.querySelector<HTMLButtonElement>('.wg-chapter[aria-current="true"]')!;
    expect(chapterButton.textContent).toBe('31指示/记录系统');
    expect(chapterButton.title).toBe(chapterA.scope.title);
    const mobileOption = container.querySelector<HTMLOptionElement>('option[value="' + chapterA.summaryId + '"]')!;
    expect(mobileOption.textContent).toBe('31 · 指示/记录系统');
    expect(mobileOption.title).toBe(chapterA.scope.title);
    expect(container.querySelector('.wg-chapter-title h2')?.textContent).toBe(chapterA.scope.title);
    expect(mockIssues).not.toHaveBeenCalled();
    expect(mockNavigation.mock.calls.map(([input]) => input)).toEqual([
      { limit: 20 }, { parentSummaryId: fleetA.summaryId, limit: 20 },
      { parentSummaryId: chapterA.summaryId, limit: 20 },
    ]);
    expect(new URLSearchParams(router.state.location.search).get('wikiChapter')).toBe(chapterA.summaryId);
    const href = [...container.querySelectorAll<HTMLAnchorElement>('a')].find(link => link.textContent === '阅读本章 Wiki')!.getAttribute('href')!;
    expect(href).toContain('/summaries/' + chapterA.summaryId + '?summaryRef=DSR-3&');
    expect(container.querySelector<HTMLAnchorElement>('a[href="/knowledge?kind=works"]')).not.toBeNull();
    await click('27飞行操纵');
    expect(mockNavigation).toHaveBeenLastCalledWith({ parentSummaryId: chapterA2.summaryId, limit: 20 }, expect.any(AbortSignal));
    expect(mockIssues).not.toHaveBeenCalled();
    expect(container.textContent).toContain('暂无子章节 Wiki');
  });

  it('does not equate a metadata pointer with current body availability', async () => {
    mockNavigation.mockImplementation((input: WikiGuideNavigationQuery) => {
      if (input.parentSummaryId === chapterA.summaryId) return Promise.resolve(navPage([
        { ...sectionA, currentSummaryRef: null, currentRevision: 0, state: 'EMPTY' },
        { ...sectionMore, currentBodyStatus: 'UPDATING_SCOPE' },
      ]));
      return normalNavigation(input);
    });
    await mount(query());
    const entries = [...container.querySelectorAll('.wg-section-entry')];
    expect(entries[0].textContent).toContain('尚无已保存正文');
    expect(entries[0].querySelector('a')).toBeNull();
    expect(entries[1].textContent).toContain('上次保存修订 3');
    expect(entries[1].querySelector('a')?.getAttribute('href')).toContain('summaryRef=DSR-8');
  });

  it('restores an off-page root and chapter by exact node/path GET without scanning every page', async () => {
    mockNavigation.mockImplementation((input: WikiGuideNavigationQuery) => {
      if (!input.summaryId && !input.parentSummaryId) return Promise.resolve(navPage([], 'more-roots'));
      if (input.parentSummaryId === fleetB.summaryId) return Promise.resolve(navPage([], 'more-chapters'));
      return normalNavigation(input);
    });
    await mount(new URLSearchParams({ wikiChapter: chapterB.summaryId, wikiY: '340' }).toString());
    expect(container.textContent).toContain('自动驾驶');
    expect(mockNavigation).toHaveBeenCalledWith({ summaryId: chapterB.summaryId }, expect.any(AbortSignal));
    expect(mockNavigation).toHaveBeenCalledWith({ summaryId: fleetB.summaryId }, expect.any(AbortSignal));
    expect(mockNavigation.mock.calls.some(([input]) => input.after)).toBe(false);
    expect(new URLSearchParams(router.state.location.search).get('wikiRoot')).toBe(fleetB.summaryId);
    expect(scroller.scrollTop).toBe(340);
  });

  it('searches registered chapters and exact CURRENT issues under one model, displays full paths and pages by 20', async () => {
    mockNavigation.mockImplementation((input: WikiGuideNavigationQuery) => input.search
      ? Promise.resolve(input.after ? navPage([sectionA, sectionMore]) : navPage([sectionA], chapterCursor))
      : normalNavigation(input));
    mockIssues.mockImplementation((input: WikiGuideIssueQuery) => Promise.resolve(input.after
      ? issuePage([{ ...issue, issueKey: 'I5', question: '第二个已保存问题' }]) : issuePage([issue], issueCursor)));
    await mount(query('告警'));
    expect(container.querySelector('#global-search')?.getAttribute('aria-label')).toBe('搜索章节或已保存问题');
    expect(mockIssues).toHaveBeenCalledWith({ rootSummaryId: fleetA.summaryId, search: '告警', scope: 'CURRENT', limit: 20 }, expect.any(AbortSignal));
    const paths = [...container.querySelectorAll<HTMLElement>('.wg-result-path')];
    expect(paths.every(path => path.textContent === 'B747-8 / ATA 31 指示/记录系统 / ATA 31-40 中央计算机')).toBe(true);
    expect(paths.every(path => path.title.includes(chapterA.scope.title) && path.title.includes(sectionA.scope.title))).toBe(true);
    const issueHref = [...container.querySelectorAll<HTMLAnchorElement>('a')].find(item => item.textContent === issue.question)!.getAttribute('href')!;
    const issueParams = new URL(issueHref, 'https://local.invalid').searchParams;
    expect(issueParams.get('workRef')).toBe(issue.workRef);
    expect(issueParams.get('knowledgeIssueKey')).toBe('I4');
    await click('更多章节结果'); await click('更多问题');
    expect(container.querySelectorAll('.wg-results > li')).toHaveLength(4);
    expect(mockIssues).toHaveBeenLastCalledWith(expect.objectContaining({ after: issueCursor, limit: 20 }), expect.any(AbortSignal));
    expect(mockNavigation).toHaveBeenCalledWith(expect.objectContaining({ search: '告警', after: chapterCursor, limit: 20 }), expect.any(AbortSignal));
  });

  it('keeps a bounded-search 503 as an explicit failure instead of an empty complete result', async () => {
    mockIssues.mockRejectedValue(Object.assign(new Error('知识目录暂时无法读取，请重试。'), { statusCode: 503 }));
    mockNavigation.mockImplementation((input: WikiGuideNavigationQuery) => input.search ? Promise.resolve(navPage([])) : normalNavigation(input));
    await mount(query('告警'));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('暂时无法读取');
    expect(container.textContent).not.toContain('未找到匹配');
    expect(mockIssues).toHaveBeenCalledTimes(1);
  });

  it('preserves model/chapter/current scroll and restores the clicked summary focus even before scroll debounce', async () => {
    await mount(query('', 90));
    scroller.scrollTop = 777;
    await act(async () => scroller.dispatchEvent(new dom.window.Event('scroll')));
    await click('阅读本章 Wiki', 'a');
    const reader = router.state.location;
    expect(reader.pathname).toBe('/summaries/' + chapterA.summaryId);
    const back = wikiGuideReturnRoute(new URLSearchParams(reader.search).get('returnWikiGuideQuery'))!;
    expect(new URL(back, 'https://local.invalid').searchParams.get('wikiY')).toBe('777');
    await act(async () => router.navigate(-1)); await settle();
    expect(new URLSearchParams(router.state.location.search).get('wikiY')).toBe('777');
    expect(scroller.scrollTop).toBe(777);
    expect(container.querySelector('[aria-current="true"]')?.textContent).toBe('31指示/记录系统');
    expect(dom.window.document.activeElement?.textContent).toBe('阅读本章 Wiki');
  });

  it('restores the exact search and issue trigger after an existing knowledge reader round trip', async () => {
    await mount(query('告警', 220));
    scroller.scrollTop = 505;
    await click(issue.question, 'a');
    const params = new URLSearchParams(router.state.location.search);
    expect(router.state.location.pathname).toBe('/knowledge');
    expect(params.get('subjectId')).toBe(issue.subjectId);
    expect(params.get('workRef')).toBe(issue.workRef);
    await act(async () => router.navigate(wikiGuideReturnRoute(params.get('returnWikiGuideQuery'))!)); await settle();
    expect(container.querySelector<HTMLInputElement>('#global-search')?.value).toBe('告警');
    expect(scroller.scrollTop).toBe(505);
    expect(dom.window.document.activeElement?.textContent).toBe(issue.question);
  });

  it.each(['success', 'old401'] as const)('ignores a late old-model %s after changing model', async outcome => {
    const pending = deferred<WikiGuideNavigationPage>(); let oldSignal: AbortSignal | null = null;
    mockNavigation.mockImplementation((input: WikiGuideNavigationQuery, signal: AbortSignal) => {
      if (input.parentSummaryId === chapterA.summaryId) { oldSignal = signal; return pending.promise; }
      return normalNavigation(input);
    });
    await mount(query());
    await click('A320-200');
    expect(oldSignal?.aborted).toBe(true);
    expect(container.textContent).toContain('自动驾驶');
    await act(async () => outcome === 'success' ? pending.resolve(navPage([sectionA]))
      : pending.reject(Object.assign(new Error('old denied'), { statusCode: 401 })));
    await settle();
    expect(container.textContent).toContain('自动驾驶');
    expect(container.textContent).not.toContain('综合显示');
    expect(container.textContent).not.toContain('此知识内容暂不可读取');
  });

  it.each([401, 403])('clears the current generation metadata on %i, then refreshes through new GETs', async statusCode => {
    await mount(query());
    mockNavigation.mockRejectedValueOnce(Object.assign(new Error('access removed'), { statusCode }));
    await click('刷新');
    expect(container.textContent).not.toContain('综合显示');
    expect(container.textContent).toContain('此知识内容暂不可读取');
    // Mounted disabled observers can retain empty query entries; no payload survives.
    expect(client.getQueriesData({ queryKey: ['wiki-guide', mockGeneration] }).every(([, value]) => value === undefined)).toBe(true);
    mockNavigation.mockImplementation(normalNavigation);
    await click('刷新');
    expect(container.textContent).toContain('综合显示');
  });

  it('never relabels a previous-session payload under the next login generation', async () => {
    await mount(query());
    const pending = deferred<WikiGuideNavigationPage>();
    mockNavigation.mockReturnValue(pending.promise); mockGeneration += 1;
    await act(async () => router.navigate('/situation?' + query('', 12)));
    expect(container.textContent).not.toContain('综合显示');
    expect(container.querySelector('.wg-workbench')).toBeNull();
    await act(async () => pending.resolve(navPage([fleetA, fleetB]))); await settle();
    expect(mockNavigation.mock.calls.length).toBeGreaterThan(3);
  });

  it.each(['SECTIONS', 'SEARCH_CHAPTERS', 'ISSUES'] as const)(
    'returns to only the exact second %s page and trigger viewport after the cache has gone', async kind => {
      const secondIssue = { ...issue, issueKey: 'I5', question: '分页中的第二个问题' };
      mockNavigation.mockImplementation((input: WikiGuideNavigationQuery) => {
        if (input.search) return Promise.resolve(input.after ? navPage([sectionMore]) : navPage([sectionA], chapterCursor));
        if (input.parentSummaryId === chapterA.summaryId) return Promise.resolve(input.after ? navPage([sectionMore]) : navPage([sectionA], sectionCursor));
        return normalNavigation(input);
      });
      mockIssues.mockImplementation((input: WikiGuideIssueQuery) => Promise.resolve(input.after
        ? issuePage([secondIssue]) : issuePage([issue], issueCursor)));
      await mount(query(kind === 'SECTIONS' ? '' : '告警'));
      await click(kind === 'SECTIONS' ? '更多子章节' : kind === 'SEARCH_CHAPTERS' ? '更多章节结果' : '更多问题');
      const anchor = kind === 'ISSUES' ? wikiGuideIssueAnchor(secondIssue) : sectionMore.summaryId;
      const after = kind === 'SECTIONS' ? sectionCursor : kind === 'SEARCH_CHAPTERS' ? chapterCursor : issueCursor;
      const find = (key: string) => [...container.querySelectorAll<HTMLAnchorElement>('[data-wiki-read-key]')]
        .find(link => link.dataset.wikiReadKey === key);
      const trigger = find(anchor)!;
      expect(trigger).toBeDefined();
      let returned = false;
      jest.spyOn(dom.window.HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const top = this === scroller ? 100 : this.dataset.wikiReadKey === anchor
          ? returned ? 500 - scroller.scrollTop : 260 : 0;
        return { top, left: 0, right: 100, bottom: top + 30, x: 0, y: top, width: 100, height: 30, toJSON: () => ({}) };
      });
      scroller.scrollTop = 680;
      await act(async () => trigger.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })));
      const encoded = new URLSearchParams(router.state.location.search).get('returnWikiGuideQuery')!;
      const pageState = new URLSearchParams(encoded);
      expect(Object.fromEntries([...pageState].filter(([key]) => ['wikiPage', 'wikiAfter', 'wikiAnchor', 'wikiOffset'].includes(key))))
        .toEqual({ wikiPage: kind, wikiAfter: after, wikiAnchor: anchor, wikiOffset: '160' });
      client.clear(); // The reader can outlive the five-minute metadata cache.
      mockNavigation.mockClear(); mockIssues.mockClear(); scroller.scrollTop = 0; returned = true;
      await act(async () => router.navigate(wikiGuideReturnRoute(encoded)!)); await settle();
      const reads = kind === 'ISSUES' ? mockIssues.mock.calls.map(([input]) => input)
        : mockNavigation.mock.calls.map(([input]) => input).filter(input => kind === 'SECTIONS'
          ? input.parentSummaryId === chapterA.summaryId : Boolean(input.search));
      expect(reads).toEqual([expect.objectContaining({ after, limit: 20 })]);
      expect(scroller.scrollTop).toBe(240);
      expect(dom.window.document.activeElement).toBe(find(anchor));
      expect(container.textContent).not.toContain('返回项暂不可定位');
      if (kind !== 'ISSUES') expect(find(sectionA.summaryId)).toBeUndefined();
      const otherLink = container.querySelector<HTMLAnchorElement>('a[href="/knowledge?kind=works"]')!;
      otherLink.focus(); scroller.scrollTop = 300;
      await act(async () => scroller.dispatchEvent(new dom.window.Event('scroll'))); await settle(180);
      expect(new URLSearchParams(router.state.location.search).get('wikiOffset')).toBe('100');
      expect(scroller.scrollTop).toBe(300);
      expect(dom.window.document.activeElement).toBe(otherLink);
      await click('回到首项');
      expect(new URLSearchParams(router.state.location.search).has('wikiPage')).toBe(false);
      if (kind === 'ISSUES') expect(mockIssues).toHaveBeenLastCalledWith(expect.not.objectContaining({ after }), expect.any(AbortSignal));
      else expect(mockNavigation).toHaveBeenCalledWith(expect.objectContaining({ ...(kind === 'SECTIONS'
        ? { parentSummaryId: chapterA.summaryId } : { rootSummaryId: fleetA.summaryId, search: '告警' }), limit: 20 }), expect.any(AbortSignal));
    });

  it.each(['removed', 'wrong-scope'] as const)('does not claim a %s return trigger was restored or scan preceding pages', async failure => {
    mockNavigation.mockImplementation((input: WikiGuideNavigationQuery) => {
      if (input.parentSummaryId === chapterA.summaryId && input.after) return failure === 'removed'
        ? Promise.resolve(navPage([sectionA]))
        : Promise.reject(Object.assign(new Error('知识读取未完成，请重试。'), { statusCode: 400 }));
      return normalNavigation(input);
    });
    const page: WikiGuidePageState = { kind: 'SECTIONS', after: sectionCursor, anchor: sectionMore.summaryId, offset: 80 };
    await mount(wikiGuideStateParams({ rootSummaryId: fleetA.summaryId, chapterSummaryId: chapterA.summaryId,
      search: '', scrollTop: 9000, page }).toString());
    expect(container.textContent).toContain('返回项暂不可定位');
    if (failure === 'wrong-scope') expect(container.querySelector('[role="alert"]')?.textContent).toBe('知识读取未完成，请重试。');
    expect(scroller.scrollTop).toBe(0);
    expect(mockNavigation.mock.calls.map(([input]) => input).filter(input => input.parentSummaryId === chapterA.summaryId))
      .toEqual([{ parentSummaryId: chapterA.summaryId, after: sectionCursor, limit: 20 }]);
    await click('B747-8');
    const cleared = new URLSearchParams(router.state.location.search);
    expect(['wikiPage', 'wikiAfter', 'wikiAnchor', 'wikiOffset'].some(key => cleared.has(key))).toBe(false);
    expect(container.textContent).not.toContain('返回项暂不可定位');
  });

  it('debounces the one search input and stops all discovery reads while authentication is required', async () => {
    await mount(query());
    const input = container.querySelector<HTMLInputElement>('#global-search')!;
    await act(async () => { input.value = '告警'; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    expect(mockIssues).not.toHaveBeenCalled();
    await settle(280);
    expect(mockIssues).toHaveBeenCalledTimes(1);
    mockAuthenticationRequired = true;
    const calls = mockNavigation.mock.calls.length;
    await act(async () => router.navigate('/situation?' + query('告警', 1)));
    expect(container.textContent).toContain('请先登录');
    expect(container.textContent).not.toContain(issue.question);
    expect(mockNavigation).toHaveBeenCalledTimes(calls);
  });
});
