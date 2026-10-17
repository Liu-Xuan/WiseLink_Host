import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import type { LcmMatrixResponse } from '@shared/lcm-matrix.interface';
import { nativeMatrixFixture, nativeSnapshotId } from './native-ui-fixtures';

const body = jest.fn(), authorize = jest.fn(), details = jest.fn(), catalogue = jest.fn();
let generation: number = 1;
jest.mock('@client/src/api/canonical-host', () => ({
  readLcmNativeMatrix: (...args: unknown[]) => body(...args),
  authorizeLcmNativeMatrix: (...args: unknown[]) => authorize(...args),
  readLcmNativeMatrixDetails: (...args: unknown[]) => details(...args),
  readLcmPersonalLibrary: async () => ({ hasSource: true, latestSnapshotIds: [nativeSnapshotId], snapshotCount: 1 }),
  readLcmSourceSnapshots: (...args: unknown[]) => catalogue(...args),
}));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({
  useCurrentUserSession: () => ({ sessionGeneration: generation, authenticationRequired: false }),
}));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/pages/WorkspaceHomePage/lcm-matrix.css', () => ({}));
jest.mock('@client/src/pages/WorkspaceHomePage/LcmExcelImport', () => ({ LcmExcelImport: () => null }));
jest.mock('@client/src/pages/WorkspaceHomePage/LcmEvidenceDrawer', () => ({ LcmEvidenceDrawer: () => {
  const react = jest.requireActual<typeof import('react')>('react');
  return react.createElement('div', { 'data-testid': 'evidence' }, '当前证据');
} }));
jest.mock('@client/src/pages/WorkspaceHomePage/LcmMatrixScopeDialog', () => ({ LcmMatrixScopeDialog: (props: {
  kind: string | null; onApply(values: string[], date?: string): void;
}) => {
  const react = jest.requireActual<typeof import('react')>('react');
  return props.kind === 'snapshots' ? react.createElement('div', null,
    react.createElement('button', { onClick: () => props.onApply([], '2026-10-10') }, '选择空日期'),
    react.createElement('button', { onClick: () => props.onApply(['b'.repeat(64)], '2026-10-09') }, '选择新日期')) : null;
} }));
jest.mock('@client/src/pages/WorkspaceHomePage/LcmMatrixToolbar', () => ({ LcmMatrixToolbar: (props: {
  onField(key: string, value: string | null): void; onModel(model: string | null): void; onReadSet(): void;
  snapshots: Array<{ originalFileName: string }>;
}) => {
  const react = jest.requireActual<typeof import('react')>('react');
  return react.createElement('div', null,
    react.createElement('button', { onClick: () => props.onField('search', 'FAC') }, '筛选 FAC'),
    ...['A321', 'B737-8'].map(model => react.createElement('button', { key: model, onClick: () => props.onModel(model) }, '机型 ' + model)),
    react.createElement('button', { onClick: () => props.onModel(null) }, '全部机型'),
    react.createElement('button', { onClick: props.onReadSet }, '选择状态日'),
    react.createElement('output', { 'data-testid': 'catalogue' }, props.snapshots.map(value => value.originalFileName).join('|')));
} }));
jest.mock('@client/src/pages/WorkspaceHomePage/LcmMatrixGrid', () => ({ LcmMatrixGrid: (props: {
  index: LcmMatrixResponse; expanded: Set<string>; onExpand(ref: string): void;
  onSort(ref: string): void; onAircraft(ref: string): void; onSelect(selection: { softwareRef: string }): void;
  onWindow(value: { rowStart: number; rowLimit: number; columnStart: number; columnLimit: number }): void;
}) => {
  const react = jest.requireActual<typeof import('react')>('react');
  const fac = props.index.softwareIndex.find(software => software.lcmSoftwareName === 'FAC')!;
  return react.createElement('div', { 'data-testid': 'local-grid' },
    react.createElement('output', null, 'FAC ' + fac.parts[0].confirmedInstalledAircraftCount),
    react.createElement('button', { onClick: () => props.onExpand(fac.softwareRef) },
      props.expanded.has(fac.softwareRef) ? '折叠 FAC' : '展开 FAC'),
    react.createElement('button', { onClick: () => props.onSort(fac.softwareRef) }, '按 FAC 排列'),
    react.createElement('button', { onClick: () => props.onSelect({ softwareRef: fac.softwareRef }) }, '读取 FAC 证据'),
    react.createElement('button', { onClick: () => props.onAircraft(props.index.aircraftOrder[0]) }, '查看单机'),
    react.createElement('button', { onClick: () => props.onWindow({ rowStart: 0, rowLimit: 1, columnStart: 3, columnLimit: 4 }) }, '移动视口'));
} }));
function RouteControls() {
  const location = useLocation(), navigate = useNavigate();
  return createElement('div', null,
    createElement('output', { 'data-testid': 'route' }, location.search),
    createElement('button', { onClick: () => navigate(-1) }, '后退'),
    createElement('button', { onClick: () => navigate(1) }, '前进'));
}
import { LcmConfigurationLibrary } from '@client/src/pages/WorkspaceHomePage/LcmConfigurationLibrary';

describe('native LCM body is loaded once per read set; view interactions stay local', () => {
  let dom: JSDOM, root: Root, container: HTMLDivElement, client: QueryClient;
  const originals: Map<string, PropertyDescriptor | undefined> = new Map();
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><body></body>', { url: 'https://test.invalid/library', pretendToBeVisual: true });
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
      navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); generation = 1;
    body.mockReset().mockResolvedValue(nativeMatrixFixture());
    authorize.mockReset().mockResolvedValue({ binding: nativeMatrixFixture().binding }); details.mockReset();
    catalogue.mockReset().mockResolvedValue({ snapshots: nativeMatrixFixture().snapshots, hasMore: false, nextAfter: null });
  });
  afterEach(async () => {
    await act(async () => root.unmount()); client.clear(); dom.window.close();
    for (const [key, value] of originals) {
      if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key);
    }
    originals.clear();
  });
  async function render(route = '/library?mode=lcm&lcmSnapshotId=' + nativeSnapshotId): Promise<void> {
    await act(async () => root.render(createElement(QueryClientProvider, { client },
      createElement(MemoryRouter, { initialEntries: [route],
        future: { v7_startTransition: true, v7_relativeSplatPath: true } }, createElement(LcmConfigurationLibrary), createElement(RouteControls)))));
  }
  async function click(text: string): Promise<void> {
    const button: HTMLButtonElement | undefined = [...container.querySelectorAll('button')]
      .find((item: HTMLButtonElement) => item.textContent === text);
    expect(button).toBeDefined(); await act(async () => button!.click());
  }
  it('keeps expansion, ordering, visible window and single-aircraft reads local, with 69 unique FAC aircraft', async () => {
    await render(); expect(container.textContent).toContain('FAC 69');
    await click('展开 FAC'); await click('折叠 FAC'); await click('按 FAC 排列'); await click('移动视口');
    await click('筛选 FAC');
    await click('查看单机');
    expect(container.textContent).toContain('FIN-A'); expect(container.textContent).toContain('FIN-B');
    expect(container.querySelector('[data-native-value="1"]')).not.toBeNull();
    expect(body).toHaveBeenCalledTimes(1); expect(details).not.toHaveBeenCalled();
    await click('返回矩阵'); expect(container.textContent).toContain('FAC 69');
    expect(body).toHaveBeenCalledTimes(1);
  });
  it('focus checks authorization metadata only and clears the retained body/index on failure', async () => {
    await render();
    await act(async () => window.dispatchEvent(new dom.window.Event('focus')));
    expect(authorize).toHaveBeenCalledWith({ snapshotIds: [nativeSnapshotId], binding: nativeMatrixFixture().binding }, expect.any(AbortSignal));
    expect(body).toHaveBeenCalledTimes(1);
    authorize.mockRejectedValueOnce(Object.assign(new Error('denied'), { statusCode: 403 }));
    await act(async () => window.dispatchEvent(new dom.window.Event('focus')));
    expect(container.querySelector('[data-testid=local-grid]')).toBeNull();
    expect(container.textContent).not.toContain('FAC 69'); expect(body).toHaveBeenCalledTimes(1);
  });
  it('reports a metadata 500 as a read failure, clears the old matrix, and supports deliberate reload', async () => {
    await render();
    authorize.mockRejectedValueOnce(Object.assign(new Error('LCM_HOST_DATABASE_UNAVAILABLE'), { statusCode: 500 }));
    await act(async () => window.dispatchEvent(new dom.window.Event('focus')));
    expect(container.querySelector('[data-testid=local-grid]')).toBeNull();
    expect(container.textContent).toContain('LCM 读取失败，请重试。');
    expect(container.textContent).not.toContain('权限已变化');
    await click('重新读取'); expect(container.textContent).toContain('FAC 69');
    expect(body).toHaveBeenCalledTimes(2);
  });
  it('keeps an initial body 500 distinct from lost permission and allows a deliberate retry', async () => {
    body.mockRejectedValueOnce(Object.assign(new Error('LCM_HOST_DATABASE_UNAVAILABLE'), { statusCode: 500 }));
    await render();
    expect(container.querySelector('[data-testid=local-grid]')).toBeNull();
    expect(container.textContent).toContain('来源读取未完成，请重试');
    expect(container.textContent).not.toContain('权限已变化');
    expect(container.textContent).not.toContain('所选来源暂不可读');
    await click('重新读取'); expect(container.textContent).toContain('FAC 69');
    expect(body).toHaveBeenCalledTimes(2);
  });

  it('keeps model multi-selection, clear and browser history local, closing prior evidence immediately', async () => {
    await render(); await click('读取 FAC 证据'); expect(container.querySelector('[data-testid=evidence]')).not.toBeNull();
    await click('机型 A321'); expect(container.querySelector('[data-testid=evidence]')).toBeNull();
    await click('机型 B737-8');
    expect(container.querySelector('[data-testid=route]')?.textContent).toContain('aircraftModel=A321&aircraftModel=B737-8');
    expect(body).toHaveBeenCalledTimes(1); expect(catalogue.mock.calls[0][0]).not.toHaveProperty('aircraftModel');
    await click('后退'); expect(container.querySelector('[data-testid=route]')?.textContent).not.toContain('B737-8');
    await click('前进'); expect(container.querySelector('[data-testid=route]')?.textContent).toContain('B737-8');
    await click('全部机型'); expect(container.querySelector('[data-testid=route]')?.textContent).not.toContain('aircraftModel');
    expect(container.textContent).toContain('FAC 69'); expect(body).toHaveBeenCalledTimes(1);
  });
  it('retains an empty selected date and never fills the latest body into that date', async () => {
    await render(); await click('读取 FAC 证据');
    await click('选择状态日'); await click('选择空日期');
    expect(container.querySelector('[data-testid=route]')?.textContent).toContain('lcmStateDate=2026-10-10');
    expect(container.querySelector('[data-testid=route]')?.textContent).not.toContain('lcmSnapshotId');
    expect(container.querySelector('[data-testid=local-grid]')).toBeNull();
    expect(container.querySelector('[data-testid=evidence]')).toBeNull();
    expect(container.textContent).toContain('所选状态日 2026-10-10：0 个已读取快照。');
    expect(body).toHaveBeenCalledTimes(1);
    await click('后退'); expect(container.textContent).toContain('FAC 69');
  });
  it('does not reuse old catalogue history when a new date re-enables reads after access loss', async () => {
    catalogue.mockResolvedValueOnce({ snapshots: [{ ...nativeMatrixFixture().snapshots[0], snapshotId: 'c'.repeat(64), originalFileName: 'old-sensitive-history.xls' }],
      hasMore: false, nextAfter: null });
    await render(); expect(container.textContent).toContain('old-sensitive-history.xls');
    authorize.mockRejectedValueOnce(Object.assign(new Error('denied'), { statusCode: 403 }));
    await act(async () => window.dispatchEvent(new dom.window.Event('focus')));
    expect(container.textContent).not.toContain('old-sensitive-history.xls');
    catalogue.mockImplementationOnce(() => new Promise(() => {})); body.mockImplementationOnce(() => new Promise(() => {}));
    await click('选择状态日'); await click('选择新日期');
    expect(container.querySelector('[data-testid=route]')?.textContent).toContain('lcmStateDate=2026-10-09');
    expect(container.textContent).not.toContain('old-sensitive-history.xls');
    expect(container.querySelector('[data-testid=local-grid]')).toBeNull(); expect(body).toHaveBeenCalledTimes(2);
  });
  it('retains catalogue pages and exact pinned metadata when reading more history', async () => {
    const first = { ...nativeMatrixFixture().snapshots[0], snapshotId: 'c'.repeat(64), originalFileName: 'first-page.xls' };
    const second = { ...first, snapshotId: 'd'.repeat(64), originalFileName: 'second-page.xls' };
    catalogue.mockResolvedValueOnce({ snapshots: [first], hasMore: true, nextAfter: 'page2' })
      .mockResolvedValueOnce({ snapshots: [second], hasMore: false, nextAfter: null });
    await render(); await click('读取下一批历史快照');
    expect(container.textContent).toContain('first-page.xls'); expect(container.textContent).toContain('second-page.xls');
    expect(container.textContent).toContain('LOCAL-SYNTHETIC-MATRIX.xls');
    expect(catalogue.mock.calls[1][0]).toEqual({ after: 'page2', limit: 50 });
  });
});
