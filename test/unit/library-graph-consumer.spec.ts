import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type {
  CanonicalLibraryGraphRequest,
  CanonicalLibraryGraphResponse,
  LibraryGraphCluster,
  LibraryGraphFilters,
  LibraryGraphFamily,
  LibraryGraphVersion,
} from '@shared/library-graph.interface';
import SuiteLibraryGraphPage from '@client/src/pages/RelationGraphPage/SuiteLibraryGraphPage';

jest.mock('@client/src/components/ui/button', () => ({
  Button: ({variant: _variant, size: _size, ...props}: Omit<ComponentProps<'button'>, 'size'> & {variant?: string; size?: string}) =>
    createElement('button', props),
}));
const { JSDOM } = require('jsdom');
const mockGetGraph = jest.fn();
let mockSession = 1;
let mockDenied = false;
let mockUserId = 'actor-1';
let mockCanvasProps: Record<string, any> | undefined;
let mockCamera: { zoom: number; pan: { x: number; y: number } } | null = null;

jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalLibraryGraph: (...args: unknown[]) => mockGetGraph(...args),
  getCanonicalHostClientSessionGeneration: () => mockSession,
  isCanonicalObjectNotFound: (reason: { statusCode?: number }) => reason?.statusCode === 404,
  summarizeCanonicalDocumentReadFailure: (reason: { code?: string; statusCode?: number }) => ({
    code: reason?.code,
    statusCode: reason?.statusCode,
  }),
}));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({
  useCurrentUserSession: () => ({
    sessionGeneration: mockSession,
    authenticationRequired: mockDenied,
    currentUser: { user_id: mockUserId },
  }),
}));
jest.mock('@client/src/pages/RelationGraphPage/suite-library-graph-page.css', () => ({}));
jest.mock('@client/src/pages/RelationGraphPage/SuiteGraphCanvas', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: React.forwardRef((props: Record<string, any>, ref: unknown) => {
      mockCanvasProps = props;
      React.useImperativeHandle(ref, () => ({
        fit: jest.fn(),
        zoomBy: jest.fn(),
        reset: jest.fn(),
        setViewport: (value: typeof mockCamera) => { mockCamera = value; },
        getCore: () => null,
        getLayout: () => null,
        getViewport: () => mockCamera,
      }));
      const elements = props.presentation.elements as Array<{ group: string }>;
      return React.createElement('div', {
        'data-testid': 'library-canvas',
        'data-node-count': elements.filter(element => element.group === 'nodes').length,
        'data-edge-count': elements.filter(element => element.group === 'edges').length,
      });
    }),
  };
});
jest.mock('@client/src/pages/RelationGraphPage/suite-graph-layout-memory', () => ({
  activateGraphLayoutSession: jest.fn(),
  readGraphLayout: jest.fn(),
  saveGraphLayout: jest.fn(),
}));

let dom: InstanceType<typeof JSDOM>;
let root: Root;
let container: HTMLDivElement;
let currentLocation = '';
let navigate: ReturnType<typeof useNavigate>;

function common(overrides: Partial<CanonicalLibraryGraphResponse> = {}) {
  const base = {
    scope: 'CURRENT_USER_DOCUMENT_CATALOG' as const,
    versionMeaning: 'ALL_READABLE_VERSIONS' as const,
    consistency: 'LIVE_READ' as const,
    relationMeaning: 'CLASSIFICATION_AND_CONTAINMENT_ONLY' as const,
    coverage: { documentReferences: 'NOT_INDEXED' as const, matterMemberships: 'NOT_LOADED' as const },
    counts: { uniqueFamilyCount: 0, readableVersionCountInMatchingFamilies: 0 },
    limit: 50,
    hasMore: false,
    nextCursor: null,
    fileReadPerformed: false as const,
    modelRunPerformed: false as const,
  };
  return Object.assign(base, Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined)));
}
function clusters(items: LibraryGraphCluster[], options: { groupBy?: 'ata' | 'normalizedFamily'; filters?: LibraryGraphFilters; counts?: { uniqueFamilyCount: number; readableVersionCountInMatchingFamilies: number }; hasMore?: boolean; nextCursor?: string | null } = {}): CanonicalLibraryGraphResponse {
  const groupBy = options.groupBy ?? 'ata';
  return {
    ...common({ counts: options.counts, hasMore: options.hasMore, nextCursor: options.nextCursor }),
    level: 'clusters', groupBy, filters: options.filters ?? {}, countScope: 'FILTERED_FAMILIES', clusterCountsOverlap: groupBy === 'ata', items,
  } as CanonicalLibraryGraphResponse;
}
function families(items: LibraryGraphFamily[], options: { groupBy?: 'ata' | 'normalizedFamily'; clusterValue?: string | null; filters?: LibraryGraphFilters; counts?: { uniqueFamilyCount: number; readableVersionCountInMatchingFamilies: number }; hasMore?: boolean; nextCursor?: string | null } = {}): CanonicalLibraryGraphResponse {
  return {
    ...common({ counts: options.counts, hasMore: options.hasMore, nextCursor: options.nextCursor }),
    level: 'families', groupBy: options.groupBy ?? 'ata', clusterValue: options.clusterValue ?? '20',
    filters: options.filters ?? {}, countScope: 'FILTERED_CLUSTER_FAMILIES', items,
  } as CanonicalLibraryGraphResponse;
}
function versions(familyId: string, items: LibraryGraphVersion[], options: { counts?: { uniqueFamilyCount: number; readableVersionCountInMatchingFamilies: number } } = {}): CanonicalLibraryGraphResponse {
  return {
    ...common({ counts: options.counts }),
    level: 'versions', familyId, countScope: 'SELECTED_FAMILY_FRESH_READ', items,
  } as CanonicalLibraryGraphResponse;
}
function cluster(value: string | null, count = 1): LibraryGraphCluster {
  return { kind: 'CLASSIFICATION', value, uniqueFamilyCount: count, readableVersionCountInMatchingFamilies: count * 2 };
}
function family(familyId: string, documentCode = familyId, readableVersionCount = 2): LibraryGraphFamily {
  return { kind: 'FAMILY', familyId, documentId: `doc-${familyId}`, documentCode, normalizedFamily: 'AMM', readableVersionCount };
}
function version(documentVersionId: string, businessRevision: string, isCurrent = false, readerWorkItemId?: string): LibraryGraphVersion {
  return { kind: 'VERSION', documentVersionId, businessRevision, committedAt: '2026-09-01T00:00:00Z', isCurrent,
    ...(readerWorkItemId ? { readerWorkItemId } : {}) };
}
function requestFilters(request: CanonicalLibraryGraphRequest): LibraryGraphFilters {
  if (request.level === 'versions') return {};
  const keys: Array<keyof LibraryGraphFilters> = ['search', 'normalizedFamily', 'ata', 'aircraftModel', 'fleetFamily', 'fleetModel'];
  return Object.fromEntries(keys.filter(key => request[key] !== undefined).map(key => [key, request[key]])) as LibraryGraphFilters;
}
function clusterPageFor(request: CanonicalLibraryGraphRequest, items: LibraryGraphCluster[], options: Parameters<typeof clusters>[1] = {}) {
  return clusters(items, { ...options, groupBy: request.level === 'versions' ? 'ata' : request.groupBy, filters: requestFilters(request) });
}
function familyPageFor(request: CanonicalLibraryGraphRequest, items: LibraryGraphFamily[], options: Parameters<typeof families>[1] = {}) {
  return families(items, { ...options, groupBy: request.level === 'versions' ? 'ata' : request.groupBy,
    clusterValue: request.level === 'families' ? request.clusterValue : '20', filters: requestFilters(request) });
}
function screen() {
  const location = useLocation();
  navigate = useNavigate();
  const [params] = useSearchParams();
  currentLocation = `${location.pathname}${location.search}`;
  if (location.pathname !== '/graph' || params.get('scope') !== 'library') {
    return createElement('div', { 'data-testid': 'non-library-route', 'data-route': currentLocation });
  }
  return createElement(SuiteLibraryGraphPage);
}
function app(entry = '/graph?scope=library') {
  return createElement(MemoryRouter, { initialEntries: [entry] }, createElement(screen));
}
async function render(entry = '/graph?scope=library') {
  await act(async () => root.render(app(entry)));
  await settle();
}
async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}
function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(item => item.textContent?.trim() === label || item.getAttribute('aria-label') === label);
  if (!found) throw new Error(`Missing button ${label}; current text is ${container.textContent}`);
  return found;
}
function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof dom.window.HTMLInputElement
    ? dom.window.HTMLInputElement.prototype : dom.window.HTMLSelectElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(element, value);
  if (element instanceof dom.window.HTMLInputElement) {
    element.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
  } else element.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}
function readRequest(callIndex = -1): CanonicalLibraryGraphRequest {
  return mockGetGraph.mock.calls.at(callIndex)?.[0] as CanonicalLibraryGraphRequest;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeAll(() => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test' });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
});
afterAll(() => dom.window.close());
beforeEach(() => {
  mockSession = 1; mockDenied = false; mockUserId = 'actor-1'; mockCanvasProps = undefined; mockCamera = null;
  mockGetGraph.mockReset();
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  mockGetGraph.mockImplementation(async (request: CanonicalLibraryGraphRequest) => {
    if (request.level === 'clusters') return clusterPageFor(request, [cluster('20')]);
    if (request.level === 'families') return familyPageFor(request, [family('family-ftd', 'FTD-A')]);
    return versions(request.familyId, [version('dv-r3', 'R3', true)]);
  });
});
afterEach(() => {
  act(() => root.unmount()); container.remove();
});

it('replaces the current family page and caps a 50-item page at 51 nodes and 50 containment edges', async () => {
  const firstItems = Array.from({ length: 50 }, (_, index) => family(`family-${index}`, `DOC-${index}`));
  mockGetGraph.mockImplementation(async (request: CanonicalLibraryGraphRequest) => request.cursor === 'family-page-2'
    ? familyPageFor(request, [family('family-next', 'DOC-NEXT')], { counts: { uniqueFamilyCount: 51, readableVersionCountInMatchingFamilies: 104 } })
    : familyPageFor(request, firstItems, { counts: { uniqueFamilyCount: 51, readableVersionCountInMatchingFamilies: 104 }, hasMore: true, nextCursor: 'family-page-2' }));
  await render('/graph?scope=library&level=families&groupBy=ata&clusterValue=20&cursor=family-page-1');

  expect(container.querySelector('[data-testid="library-canvas"]')?.getAttribute('data-node-count')).toBe('51');
  expect(container.querySelector('[data-testid="library-canvas"]')?.getAttribute('data-edge-count')).toBe('50');
  expect(container.textContent).toContain('51 个唯一文档族');
  expect(container.textContent).toContain('104 个可读版本');
  await act(async () => button('下一页').click()); await settle();

  expect(readRequest().cursor).toBe('family-page-2');
  expect(mockCanvasProps?.presentation.elements.filter((element: { group: string }) => element.group === 'nodes')).toHaveLength(2);
  expect(mockCanvasProps?.presentation.elements.filter((element: { group: string }) => element.group === 'edges')).toHaveLength(1);
  expect(container.textContent).toContain('DOC-NEXT');
  expect(container.textContent).not.toContain('DOC-0');
  expect(container.textContent).toContain('本页 1 个文档族');
});

it('drills from cluster to family to fresh exact R3 version and opens document scope without macro filters', async () => {
  mockGetGraph.mockImplementation(async (request: CanonicalLibraryGraphRequest) => {
    if (request.level === 'clusters') return clusterPageFor(request, [cluster('20')]);
    if (request.level === 'families') return familyPageFor(request, [family('family-ftd', 'FTD-A')]);
    return versions(request.familyId, [version('dv-r3', 'R3'), version('dv-r4', 'R4', true)], { counts: { uniqueFamilyCount: 1, readableVersionCountInMatchingFamilies: 2 } });
  });
  await render('/graph?scope=library&level=clusters&groupBy=ata&search=FTD&ata=20');
  await act(async () => button('ATA 20').click());
  await act(async () => button('展开此分类簇').click()); await settle();
  const familyRead = readRequest();
  expect(familyRead.level).toBe('families');
  expect(familyRead.level === 'families' ? familyRead.clusterValue : null).toBe('20');

  await act(async () => button('FTD-A').click());
  await act(async () => button('查看族内版本').click()); await settle();
  const freshVersionRequest = readRequest();
  expect(freshVersionRequest).toEqual({ level: 'versions', familyId: 'family-ftd', limit: 50 });
  expect(container.textContent).toContain('所选文档族重新核权');
  await act(async () => button('R3').click());
  await act(async () => button('以此准确版本查看邻域').click()); await settle();

  const documentRoute = new URL(currentLocation, 'https://example.test');
  expect(documentRoute.pathname).toBe('/graph');
  expect(documentRoute.searchParams.get('scope')).toBe('document');
  expect(documentRoute.searchParams.get('documentVersionId')).toBe('dv-r3');
  expect(documentRoute.searchParams.get('returnLibrarySnapshot')).toMatch(/^lr-[a-f0-9-]{36}$/u);
  expect(documentRoute.searchParams.has('familyId')).toBe(false);
  expect(documentRoute.searchParams.has('search')).toBe(false);
  expect(documentRoute.searchParams.has('ata')).toBe(false);
  expect(documentRoute.searchParams.has('level')).toBe(false);
});

it('exposes the existing graph modes and opens exact versions directly from the visible list', async () => {
  mockGetGraph.mockImplementation(async (request: CanonicalLibraryGraphRequest) => {
    if (request.level === 'clusters') return clusterPageFor(request, [cluster('20')]);
    if (request.level === 'families') return familyPageFor(request, [family('family-ftd', 'FTD-A')]);
    return versions(request.familyId, [version('dv-r3', 'R3', false, 'wi-r3')]);
  });
  await render('/graph?scope=library');
  expect(container.querySelector('nav[aria-label="图谱模式"] a[href="/graph"]')?.textContent).toBe('事项关系图谱');
  expect(container.querySelector<HTMLDetailsElement>('.suite-library-list')?.open).toBe(true);
  expect(button('文档关系图谱').disabled).toBe(true);
  await act(async () => button('展开 ATA 20').click()); await settle();
  expect(container.textContent).toContain('选择一个文档族');
  await act(async () => button('展开 FTD-A').click()); await settle();
  expect(container.textContent).toContain('选择一个准确版本');
  await act(async () => button('打开文档关系图谱 R3').click()); await settle();
  const route = new URL(currentLocation, 'https://example.test');
  expect(route.searchParams.get('scope')).toBe('document');
  expect(route.searchParams.get('documentVersionId')).toBe('dv-r3');
  expect(route.searchParams.get('readerWorkItemId')).toBe('wi-r3');
  expect(route.searchParams.has('ata')).toBe(false);
  expect(mockGetGraph).toHaveBeenCalledTimes(3);
});

it.each([403,404])('clears the graph and reports an unreadable directory scope for HTTP %s', async statusCode => {
  mockGetGraph.mockRejectedValueOnce({statusCode});
  await render('/graph?scope=library');
  expect(container.textContent).toContain('当前账户无法读取此目录范围');
  expect(container.textContent).not.toContain('工程评估');
  expect(container.querySelector('[data-testid="library-canvas"]')).toBeNull();
});

it('restores per-entry scope, selection and camera across browser Back and Forward', async () => {
  const clusterId = 'library:cluster:"20"';
  const clusterCamera = { zoom: 1.1, pan: { x: 17, y: -8 } };
  const familyCamera = { zoom: 0.72, pan: { x: -30, y: 55 } };
  await render(`/graph?scope=library&selectedId=${encodeURIComponent(clusterId)}&viewport=${encodeURIComponent(JSON.stringify(clusterCamera))}`);
  expect(mockCanvasProps?.initialViewport).toEqual(clusterCamera);
  expect(container.textContent).toContain('ATA 20');
  await act(async () => button('展开此分类簇').click()); await settle();
  expect(new URL(currentLocation, 'https://example.test').searchParams.get('level')).toBe('families');
  await act(async () => { mockCamera = familyCamera; mockCanvasProps?.onViewport?.(familyCamera); });
  await act(async () => button('FTD-A').click()); await settle();
  expect(new URL(currentLocation, 'https://example.test').searchParams.get('selectedId')).toBe('library:family:family-ftd');
  expect(JSON.parse(new URL(currentLocation, 'https://example.test').searchParams.get('viewport')!)).toEqual(familyCamera);

  await act(async () => navigate(-1)); await settle();
  const back = new URL(currentLocation, 'https://example.test');
  expect(back.searchParams.get('scope')).toBe('library');
  expect(back.searchParams.get('level')).toBe('clusters');
  expect(back.searchParams.get('selectedId')).toBe(clusterId);
  expect(JSON.parse(back.searchParams.get('viewport')!)).toEqual(clusterCamera);
  await act(async () => navigate(1)); await settle();

  const forward = new URL(currentLocation, 'https://example.test');
  expect(forward.searchParams.get('scope')).toBe('library');
  expect(forward.searchParams.get('level')).toBe('families');
  expect(forward.searchParams.get('selectedId')).toBe('library:family:family-ftd');
  expect(JSON.parse(forward.searchParams.get('viewport')!)).toEqual(familyCamera);
  expect(mockCanvasProps?.initialViewport).toEqual(familyCamera);
  expect(mockCanvasProps?.selectedId).toBe('library:family:family-ftd');
});

it('keeps filtered cluster root and cursor through selection, pan, family drill, and the root breadcrumb', async () => {
  const rootCamera = { zoom: 1.3, pan: { x: 42, y: 18 } };
  mockGetGraph.mockImplementation(async (request: CanonicalLibraryGraphRequest) => {
    if (request.level === 'clusters') return request.cursor === 'cluster-page-2'
      ? clusterPageFor(request, [cluster('20')])
      : clusterPageFor(request, [cluster('10')], { hasMore: true, nextCursor: 'cluster-page-2' });
    if (request.level === 'families') return familyPageFor(request, [family('family-ftd', 'FTD-A')]);
    return versions(request.familyId, [version('dv-r3', 'R3', true)]);
  });
  await render('/graph?scope=library&groupBy=ata&search=FTD');
  await act(async () => button('下一页').click()); await settle();
  expect(readRequest().cursor).toBe('cluster-page-2');
  await act(async () => { mockCamera = rootCamera; mockCanvasProps?.onViewport?.(rootCamera); });
  await act(async () => button('ATA 20').click());
  await act(async () => button('展开此分类簇').click()); await settle();
  expect(readRequest()).toMatchObject({ level: 'families', clusterValue: '20', groupBy: 'ata', search: 'FTD' });

  const familyCamera = { zoom: 0.8, pan: { x: -21, y: 64 } };
  await act(async () => { mockCamera = familyCamera; mockCanvasProps?.onViewport?.(familyCamera); });
  await act(async () => button('FTD-A').click());
  await act(async () => button('查看族内版本').click()); await settle();
  expect(readRequest()).toEqual({ level: 'versions', familyId: 'family-ftd', limit: 50 });
  await act(async () => button('返回分类簇').click()); await settle();
  expect(readRequest()).toMatchObject({level:'families',clusterValue:'20',search:'FTD'});
  const restoredFamily = new URL(currentLocation,'https://example.test');
  expect(restoredFamily.searchParams.get('selectedId')).toBe('library:family:family-ftd');
  expect(JSON.parse(restoredFamily.searchParams.get('viewport')!)).toEqual(familyCamera);
  await act(async () => button('全库概览').click()); await settle();

  const restoredRoot = new URL(currentLocation, 'https://example.test');
  expect(restoredRoot.searchParams.get('scope')).toBe('library');
  expect(restoredRoot.searchParams.get('level')).toBe('clusters');
  expect(restoredRoot.searchParams.get('groupBy')).toBe('ata');
  expect(restoredRoot.searchParams.get('search')).toBe('FTD');
  expect(restoredRoot.searchParams.get('cursor')).toBe('cluster-page-2');
  expect(restoredRoot.searchParams.get('selectedId')).toBe('library:cluster:"20"');
  expect(JSON.parse(restoredRoot.searchParams.get('viewport')!)).toEqual(rootCamera);
});

it('resets the cursor when filters are applied or the grouping changes', async () => {
  await render('/graph?scope=library&level=families&groupBy=ata&clusterValue=20&cursor=family-cursor&normalizedFamily=AMM');
  await act(async () => button('检索').click()); await settle();
  let request = readRequest();
  expect(request).toMatchObject({ level: 'clusters', groupBy: 'ata', normalizedFamily: 'AMM' });
  expect(request.cursor).toBeUndefined();

  await act(async () => navigate('/graph?scope=library&level=clusters&groupBy=ata&cursor=cluster-cursor&search=kept'));
  await settle();
  const group = container.querySelector<HTMLSelectElement>('select[aria-label="概览分组方式"]')!;
  await act(async () => setValue(group, 'normalizedFamily')); await settle();
  request = readRequest();
  expect(request).toMatchObject({ level: 'clusters', groupBy: 'normalizedFamily', search: 'kept' });
  expect(request.cursor).toBeUndefined();
});

it('shows empty and partial-count pages with explicit unindexed/not-loaded coverage', async () => {
  mockGetGraph.mockImplementation(async (request: CanonicalLibraryGraphRequest) => request.level !== 'versions' && request.search === 'partial'
    ? clusterPageFor(request, [cluster('20')], { counts: { uniqueFamilyCount: 17, readableVersionCountInMatchingFamilies: 39 }, hasMore: true, nextCursor: 'p2' })
    : clusterPageFor(request, [], { counts: { uniqueFamilyCount: 0, readableVersionCountInMatchingFamilies: 0 } }));
  await render();
  expect(container.textContent).toContain('当前范围没有可读对象');
  expect(container.textContent).toContain('0 个唯一文档族');
  expect(container.textContent).toContain('NOT_INDEXED');
  expect(container.textContent).toContain('NOT_LOADED');

  await act(async () => navigate('/graph?scope=library&search=partial')); await settle();
  expect(container.textContent).toContain('17 个唯一文档族');
  expect(container.textContent).toContain('39 个可读版本');
  expect(container.textContent).toContain('本页 1 个分类簇');
  expect(container.textContent).toContain('仍有后续页');
});

it('retries ordinary read failures and clears an invalid-cursor page before returning to the first page', async () => {
  mockGetGraph.mockRejectedValueOnce(new Error('temporary host failure')).mockResolvedValueOnce(clusters([cluster('20')]));
  await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('重试同一范围');
  await act(async () => button('重试同一范围').click()); await settle();
  expect(mockGetGraph).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain('ATA 20');

  mockGetGraph.mockImplementation(async (request: CanonicalLibraryGraphRequest) => request.cursor
    ? Promise.reject({ code: 'LIBRARY_GRAPH_CURSOR_INVALID' })
    : clusters([cluster('30')]));
  await act(async () => navigate('/graph?scope=library&cursor=expired')); await settle();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('旧页已清除');
  expect(container.textContent).not.toContain('ATA 20');
  await act(async () => button('重新读取同范围首页').click()); await settle();
  expect(readRequest()).toMatchObject({ level: 'clusters', groupBy: 'ata' });
  expect(readRequest().cursor).toBeUndefined();
  expect(container.textContent).toContain('ATA 30');
});

it('ignores delayed A results after route B replaces the current read', async () => {
  const slow = deferred<CanonicalLibraryGraphResponse>();
  mockGetGraph.mockImplementation((request: CanonicalLibraryGraphRequest) => request.level !== 'versions' && request.search === 'A'
    ? slow.promise : Promise.resolve(clusterPageFor(request, [cluster('B')])));
  await act(async () => root.render(app('/graph?scope=library&search=A')));
  await act(async () => navigate('/graph?scope=library&search=B')); await settle();
  expect(container.textContent).toContain('ATA B');
  expect((mockGetGraph.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
  await act(async () => { slow.resolve(clusterPageFor(readRequest(0), [cluster('A')])); await Promise.resolve(); }); await settle();
  expect(container.textContent).toContain('ATA B');
  expect(container.textContent).not.toContain('ATA A');
});

it('clears old labels and selection on logout/session change and on a denied reread', async () => {
  await render('/graph?scope=library&selectedId=library%3Acluster%3A%2220%22');
  expect(container.textContent).toContain('ATA 20');
  expect(mockCanvasProps?.selectedId).toBe('library:cluster:"20"');

  mockSession = 2; mockUserId = 'actor-2'; mockDenied = true;
  await act(async () => root.render(app('/graph?scope=library&selectedId=library%3Acluster%3A%2220%22')));
  expect(container.textContent).toContain('请先登录');
  expect(container.textContent).not.toContain('ATA 20');
  expect(container.textContent).not.toContain('选择一个簇');

  mockDenied = false;
  mockGetGraph.mockResolvedValueOnce(clusters([cluster('40')])).mockRejectedValueOnce({ statusCode: 401 });
  await act(async () => root.render(app('/graph?scope=library'))); await settle();
  expect(container.textContent).toContain('ATA 40');
  await act(async () => button('重新核对当前范围').click()); await settle();
  expect(container.textContent).not.toContain('ATA 40');
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
});

it('clears actor A display ancestry for authorized actor B even when family IDs overlap', async () => {
  const actorACamera = { zoom: 1.25, pan: { x: 12, y: -26 } };
  await render(`/graph?scope=library&groupBy=ata&search=FTD&cursor=actor-a-page&selectedId=library%3Acluster%3A%2220%22&viewport=${encodeURIComponent(JSON.stringify(actorACamera))}`);
  await act(async () => button('展开此分类簇').click()); await settle();
  const actorBCamera = { zoom: 0.76, pan: { x: -14, y: 31 } };
  await act(async () => { mockCamera = actorBCamera; mockCanvasProps?.onViewport?.(actorBCamera); });
  await act(async () => button('FTD-A').click()); await settle();
  expect(new URL(currentLocation, 'https://example.test').searchParams.get('selectedId')).toBe('library:family:family-ftd');

  mockSession = 2; mockUserId = 'actor-2'; mockDenied = false;
  await act(async () => root.render(app(currentLocation))); await settle();
  expect(container.textContent).toContain('FTD-A'); // same readable family ID exists for actor B
  expect(container.textContent).toContain('选择一个文档族');
  expect(mockCanvasProps?.selectedId).toBeUndefined();
  const actorBPage = new URL(currentLocation, 'https://example.test');
  expect(actorBPage.searchParams.get('level')).toBe('families');
  expect(actorBPage.searchParams.has('selectedId')).toBe(false);
  expect(actorBPage.searchParams.has('viewport')).toBe(false);
  expect(actorBPage.searchParams.get('displaySession')).toBe('2');

  await act(async () => button('全库概览').click()); await settle();
  const actorBRoot = new URL(currentLocation, 'https://example.test');
  expect(actorBRoot.searchParams.get('scope')).toBe('library');
  expect(actorBRoot.searchParams.get('level')).toBe('clusters');
  expect(actorBRoot.searchParams.has('cursor')).toBe(false); // actor A's paginated root is not revived
  expect(actorBRoot.searchParams.has('selectedId')).toBe(false);
  expect(actorBRoot.searchParams.has('viewport')).toBe(false);
});


it('keeps the real React consumer bounded across thirty explicit drill and breadcrumb-return cycles',async()=>{
  await render();
  for(let cycle=0;cycle<30;cycle++) {
    await act(async()=>button('ATA 20').click());
    await act(async()=>button('展开此分类簇').click());await settle();
    expect(mockCanvasProps?.presentation.elements.filter((e:{group:string})=>e.group==='nodes')).toHaveLength(2);
    expect(mockCanvasProps?.presentation.elements.filter((e:{group:string})=>e.group==='edges')).toHaveLength(1);
    expect(container.querySelectorAll('.suite-library-list li')).toHaveLength(1);
    await act(async()=>button('全库概览').click());await settle();
    expect(mockCanvasProps?.presentation.elements.filter((e:{group:string})=>e.group==='nodes')).toHaveLength(1);
    expect(mockCanvasProps?.presentation.elements.filter((e:{group:string})=>e.group==='edges')).toHaveLength(0);
    expect(container.querySelectorAll('.suite-library-list li')).toHaveLength(1);
    expect(container.textContent).not.toContain('FTD-A');
  }
  expect(mockGetGraph).toHaveBeenCalledTimes(61);
});
