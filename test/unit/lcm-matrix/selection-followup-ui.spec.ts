import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import { LcmConfigurationLibrary } from '@client/src/pages/WorkspaceHomePage/LcmConfigurationLibrary';
import { lcmNativeCellRecord } from '@server/modules/lcm-export-staging/lcm-native-matrix-records';
import { nativeMatrixFixture } from './native-ui-fixtures';

const body = jest.fn(), authorize = jest.fn(), details = jest.fn(), catalogue = jest.fn();
let data = source();
jest.mock('@client/src/api/canonical-host', () => ({
  readLcmNativeMatrix: (...args: unknown[]) => body(...args),
  authorizeLcmNativeMatrix: (...args: unknown[]) => authorize(...args),
  readLcmNativeMatrixDetails: (...args: unknown[]) => details(...args),
  readLcmPersonalLibrary: async () => ({ hasSource: true, latestSnapshotIds: data.snapshots.map(value => value.snapshotId), snapshotCount: 3 }),
  readLcmSourceSnapshots: (...args: unknown[]) => catalogue(...args),
}));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({
  useCurrentUserSession: () => ({ sessionGeneration: 31, authenticationRequired: false }),
}));
jest.mock('@client/src/pages/WorkspaceHomePage/lcm-matrix.css', () => ({}));
jest.mock('@client/src/pages/WorkspaceHomePage/LcmExcelImport', () => ({ LcmExcelImport: () => null }));
jest.mock('@client/src/pages/WorkspaceHomePage/LcmRuntimeDiagnostic', () => ({ LcmRuntimeDiagnostic: () => null }));
jest.mock('@client/src/components/ui/dialog', () => {
  const react = jest.requireActual<typeof import('react')>('react');
  const frame = ({ children }: { children?: ReactNode }) => react.createElement('div', null, children);
  return { Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => open ? react.createElement('div', { role: 'dialog' }, children) : null,
    DialogContent: frame, DialogTitle: frame, DialogDescription: frame };
});
jest.mock('@client/src/components/ui/select', () => {
  const react = jest.requireActual<typeof import('react')>('react');
  const frame = ({ children }: { children?: ReactNode }) => react.createElement('div', null, children);
  return { Select: frame, SelectContent: frame, SelectItem: frame, SelectTrigger: frame, SelectValue: frame };
});

function source() {
  const original = nativeMatrixFixture();
  const matrices = ['ARJ21-700', 'C909', 'C919-700'].map((model, index) => {
    const entry = structuredClone(original.matrices[0]); entry.snapshotId = String(index + 1).repeat(64);
    entry.managementDomainRef = 'SYNTHETIC_DOMAIN_' + index; entry.matrix.aircraftModel = model;
    entry.matrix.aircraft = entry.matrix.aircraft.slice(0, 3); entry.matrix.rows = entry.matrix.rows.slice(0, 1);
    entry.matrix.rows[0].states = index === 0 ? ['', 3, 1] : index === 1 ? [1, 1, 1] : [2, 2, 2];
    entry.matrix.range.lastRow = 2; entry.matrix.range.lastColumn = 8;
    return entry;
  });
  return { ...original, matrices, snapshots: matrices.map(entry => ({ ...original.snapshots[0],
    snapshotId: entry.snapshotId, coveredAircraftModels: [entry.matrix.aircraftModel], coveredAircraftCount: 3, recordCount: 1,
    originalFileName: '构型统计_' + entry.matrix.aircraftModel + '_2026108161327.xls' })) };
}

describe('actual LCM toolbar, matrix, single-aircraft and evidence display (synthetic sources)', () => {
  let dom: JSDOM, root: Root, router: ReturnType<typeof createMemoryRouter>, client: QueryClient, container: HTMLElement;
  const globals = new Map<string, PropertyDescriptor | undefined>();
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://test.invalid/library', pretendToBeVisual: true });
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
      navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
      requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
      cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
      ResizeObserver: class { observe(): void {} disconnect(): void {} },
    })) {
      globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    notifyManager.setScheduler(queueMicrotask); data = source();
    container = document.getElementById('root')!; root = createRoot(container);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    body.mockReset().mockResolvedValue(data); authorize.mockReset().mockResolvedValue({ binding: data.binding });
    catalogue.mockReset().mockResolvedValue({ snapshots: data.snapshots, hasMore: false, nextAfter: null });
    details.mockReset().mockResolvedValue({ binding: data.binding, nextAfter: null, originalUnavailableReason: 'LOCAL_REFERENCE_ONLY',
      records: [{ snapshot: data.snapshots[0], softwareRef: 'synthetic', aircraftRef: 'synthetic', lcmSoftwareName: 'FAC',
        record: lcmNativeCellRecord(data.matrices[0].matrix, 0, 0) }] });
  });
  afterEach(async () => {
    await act(async () => { await client.cancelQueries(); root.unmount(); client.clear(); });
    router.dispose(); notifyManager.setScheduler(callback => setTimeout(callback, 0)); dom.window.close();
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
    globals.clear();
  });
  async function mount(model?: string) {
    const params = new URLSearchParams({ mode: 'lcm' });
    data.snapshots.forEach(value => params.append('lcmSnapshotId', value.snapshotId));
    if (model) params.append('aircraftModel', model);
    router = createMemoryRouter([{ path: '/library', element: createElement(LcmConfigurationLibrary) }],
      { initialEntries: ['/library?' + params], future: { v7_relativeSplatPath: true } });
    await act(async () => root.render(createElement(QueryClientProvider, { client },
      createElement(RouterProvider, { router, future: { v7_startTransition: true } }))));
    await settle();
  }
  async function settle() { await act(async () => { await new Promise(done => setTimeout(done, 0)); }); }
  async function click(element: HTMLElement | undefined | null) {
    expect(element).toBeDefined(); expect(element).not.toBeNull();
    await act(async () => element!.click()); await settle();
  }
  const modelButton = (value: string) => container.querySelector<HTMLButtonElement>('[data-model-value="' + value + '"]')!;
  const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find(value => value.textContent === text);

  it('has visible selected controls, independent raw alias choices, repeat-toggle, multi-select, clear and browser history', async () => {
    await mount();
    const buttons = [...container.querySelectorAll('.mx-models button')];
    expect(buttons.map(value => value.textContent)).toEqual(['全部机型', 'C909（原 ARJ21-700）', 'C909', 'C919-700']);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true'); expect(buttons[0].querySelector('svg')).not.toBeNull();
    expect(modelButton('ARJ21-700').title).toBe('ARJ21-700');
    await click(modelButton('ARJ21-700'));
    expect(modelButton('ARJ21-700').getAttribute('aria-pressed')).toBe('true');
    expect(modelButton('ARJ21-700').querySelector('svg')).not.toBeNull();
    expect(modelButton('C909').getAttribute('aria-pressed')).toBe('false');
    expect(new URLSearchParams(router.state.location.search).getAll('aircraftModel')).toEqual(['ARJ21-700']);
    await click(modelButton('C909'));
    expect(new URLSearchParams(router.state.location.search).getAll('aircraftModel')).toEqual(['ARJ21-700', 'C909']);
    await act(async () => router.navigate(-1)); await settle();
    expect(modelButton('ARJ21-700').getAttribute('aria-pressed')).toBe('true');
    expect(modelButton('C909').getAttribute('aria-pressed')).toBe('false');
    await act(async () => router.navigate(1)); await settle();
    expect(modelButton('C909').getAttribute('aria-pressed')).toBe('true');
    await click(modelButton('ARJ21-700'));
    expect(new URLSearchParams(router.state.location.search).getAll('aircraftModel')).toEqual(['C909']);
    await click(modelButton('C909'));
    expect(new URLSearchParams(router.state.location.search).has('aircraftModel')).toBe(false);
    await click(modelButton('ARJ21-700')); await click(button('全部机型'));
    expect(new URLSearchParams(router.state.location.search).has('aircraftModel')).toBe(false);
    expect(button('全部机型')!.getAttribute('aria-pressed')).toBe('true');
    expect(body).toHaveBeenCalledTimes(1);
    expect(data.matrices.map(value => value.matrix.aircraftModel)).toEqual(['ARJ21-700', 'C909', 'C919-700']);
  });

  it('renders only indexed blank cells as none, keeps unknown distinct and reuses the raw source in the single-aircraft view', async () => {
    const before = structuredClone(data);
    await mount('ARJ21-700'); await click(container.querySelector('[aria-label="展开 FAC"]'));
    const cells = [...container.querySelectorAll<HTMLButtonElement>('.mx-child .mx-data-cell')];
    expect(cells.find(value => value.getAttribute('aria-label')?.includes('LOCAL-001'))?.textContent).toBe('无');
    expect(cells.find(value => value.getAttribute('aria-label')?.includes('LOCAL-002'))?.textContent).toBe('？');
    expect(cells.find(value => value.getAttribute('aria-label')?.includes('LOCAL-002'))?.getAttribute('aria-label')).toContain('未知');
    expect(cells.find(value => value.getAttribute('aria-label')?.includes('LOCAL-003'))?.textContent).toBe('1');
    expect(container.querySelector('.mx-legend')?.textContent).toContain('空白＝无');
    const aircraft = button('LOCAL-001 ↗')!; expect(aircraft.title).toBe('C909'); await click(aircraft);
    const table = container.querySelector('.mx-aircraft-table')!;
    expect(table.querySelector('header')?.textContent).toContain('C909');
    expect(table.querySelector('[data-native-value=""]')?.textContent).toBe('无');
    expect([...table.querySelectorAll('tbody td')].filter(value => value.textContent === '无')).toHaveLength(3);
    await click(button('返回矩阵')); expect(container.querySelector('.mx-scroll')).not.toBeNull();
    expect(body).toHaveBeenCalledTimes(1); expect(data).toEqual(before);
  });

  it('uses the same none and display alias in exact evidence while its GET keeps the original model and source fields', async () => {
    await mount('ARJ21-700'); await click(container.querySelector('[aria-label="展开 FAC"]'));
    const cell = [...container.querySelectorAll<HTMLButtonElement>('.mx-child .mx-data-cell')]
      .find(value => value.getAttribute('aria-label')?.includes('LOCAL-001'));
    await click(cell);
    const evidence = container.querySelector('.mx-evidence-records')!;
    const model = [...evidence.querySelectorAll('dt')].find(value => value.textContent === '机型 / 机尾')?.nextElementSibling!;
    expect(model.textContent).toBe('C909 · LOCAL-001'); expect(model.getAttribute('title')).toBe('ARJ21-700');
    for (const label of ['允装', '实装', '原始状态']) {
      const value = [...evidence.querySelectorAll('dt')].find(item => item.textContent === label)?.nextElementSibling;
      expect(value?.textContent).toBe('无');
    }
    expect(evidence.textContent).toContain(data.snapshots[0].originalFileName);
    expect(details.mock.calls[0][0].query.aircraftModel).toBe('ARJ21-700');
    expect(body).toHaveBeenCalledTimes(1); expect(details).toHaveBeenCalledTimes(1);
    expect(data.matrices[0].matrix.rows[0].states[0]).toBe('');
  });
});
