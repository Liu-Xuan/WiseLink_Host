import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import type { LcmMatrixResponse } from '@shared/lcm-matrix.interface';
import type { WiseLinkMonitorElement } from '@client/src/pages/DocumentParsingPage/runtime-monitor/monitor-types';
import { nativeMatrixFixture, nativeSnapshotId } from './native-ui-fixtures';

const body = jest.fn(), authorize = jest.fn(), catalogue = jest.fn();
let generation = 1;
jest.mock('@client/src/api/canonical-host', () => ({
  readLcmNativeMatrix: (...args: unknown[]) => body(...args),
  authorizeLcmNativeMatrix: (...args: unknown[]) => authorize(...args),
  readLcmPersonalLibrary: async () => ({ hasSource: true, latestSnapshotIds: [nativeSnapshotId], snapshotCount: 1 }),
  readLcmSourceSnapshots: (...args: unknown[]) => catalogue(...args),
}));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({
  useCurrentUserSession: () => ({ sessionGeneration: generation, authenticationRequired: false }),
}));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/pages/WorkspaceHomePage/lcm-matrix.css', () => ({}));
jest.mock('@client/src/pages/WorkspaceHomePage/LcmExcelImport', () => ({ LcmExcelImport: () => null }));
jest.mock('@client/src/pages/WorkspaceHomePage/LcmEvidenceDrawer', () => ({ LcmEvidenceDrawer: () => null }));
jest.mock('@client/src/pages/WorkspaceHomePage/LcmMatrixScopeDialog', () => ({ LcmMatrixScopeDialog: () => null }));
jest.mock('@client/src/pages/WorkspaceHomePage/LcmMatrixToolbar', () => ({ LcmMatrixToolbar: (props: {
  onField(key: string, value: string): void;
}) => {
  const react = jest.requireActual<typeof import('react')>('react');
  return react.createElement('button', { onClick: () => props.onField('search', 'FAC') }, '本地筛选 FAC');
} }));
jest.mock('@client/src/pages/WorkspaceHomePage/LcmMatrixGrid', () => ({ LcmMatrixGrid: (props: {
  index: LcmMatrixResponse; onAircraft(ref: string): void;
}) => {
  const react = jest.requireActual<typeof import('react')>('react');
  return react.createElement('button', { onClick: () => props.onAircraft(props.index.aircraftOrder[0]) }, '本地查看单机');
} }));

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://test.invalid/library', pretendToBeVisual: true });
dom.window.scrollTo = () => undefined;
const globals = new Map<string, PropertyDescriptor | undefined>();
dom.window.HTMLElement.prototype.scrollIntoView = jest.fn();
for (const [name, value] of Object.entries({
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  customElements: dom.window.customElements, CustomEvent: dom.window.CustomEvent,
  requestAnimationFrame: dom.window.requestAnimationFrame, cancelAnimationFrame: dom.window.cancelAnimationFrame,
  ResizeObserver: class { observe() {} disconnect() {} }, IS_REACT_ACT_ENVIRONMENT: true,
})) {
  globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
const { LcmConfigurationLibrary } = require('../../../client/src/pages/WorkspaceHomePage/LcmConfigurationLibrary');
let container: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  generation = 1;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  body.mockReset().mockResolvedValue(nativeMatrixFixture()); authorize.mockReset().mockResolvedValue({ binding: nativeMatrixFixture().binding });
  catalogue.mockReset().mockResolvedValue({ snapshots: nativeMatrixFixture().snapshots, hasMore: false, nextAfter: null });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); });
afterAll(() => {
  dom.window.close();
  for (const [name, value] of globals) {
    if (value) Object.defineProperty(globalThis, name, value); else Reflect.deleteProperty(globalThis, name);
  }
});
async function render() {
  await act(async () => root.render(createElement(QueryClientProvider, { client },
    createElement(MemoryRouter, { initialEntries: ['/library?mode=lcm&lcmSnapshotId=' + nativeSnapshotId],
      future: { v7_startTransition: true, v7_relativeSplatPath: true } }, createElement(LcmConfigurationLibrary)))));
}
async function open(): Promise<WiseLinkMonitorElement> {
  await act(async () => {
    const details = container.querySelector<HTMLDetailsElement>('[aria-label="LCM 运行诊断"]')!;
    details.open = true; details.dispatchEvent(new dom.window.Event('toggle'));
  });
  return container.querySelector('wiselink-monitor') as WiseLinkMonitorElement;
}
async function click(label: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label)!;
  await act(async () => button.click());
}

it('expands without extra reads and keeps the successful observation time through local filters and single-aircraft navigation', async () => {
  await render(); expect(container.querySelector('wiselink-monitor')).toBeNull();
  const first = await open(), observedAt = first.runtime!.meta.observedAt;
  expect(Number.isFinite(Date.parse(observedAt))).toBe(true);
  expect(first.runtime!.nodes[0].inputRefs[0].ref).toBe(nativeSnapshotId);
  expect(body).toHaveBeenCalledTimes(1); expect(authorize).not.toHaveBeenCalled();
  await click('本地筛选 FAC'); expect(container.querySelector('wiselink-monitor')).toBeNull();
  expect((await open()).runtime!.meta.observedAt).toBe(observedAt);
  await click('本地查看单机'); const single = await open();
  expect(single.runtime!.nodes[1].label).toBe('当前单机构型阅读');
  expect(single.runtime!.meta.observedAt).toBe(observedAt); expect(body).toHaveBeenCalledTimes(1);
});

it('focuses the current read surface from an allowed snapshot and rereads only through the existing parent callback', async () => {
  await render(); const monitor = await open();
  await act(async () => monitor.shadowRoot!.querySelector<HTMLButtonElement>('[data-node="business.software_configuration"]')!.click());
  await act(async () => monitor.shadowRoot!.querySelector<HTMLButtonElement>('[data-nav="source"]')!.click());
  expect(document.activeElement?.getAttribute('aria-label')).toBe('当前构型矩阵阅读');
  expect(body).toHaveBeenCalledTimes(1);
  await act(async () => monitor.shadowRoot!.querySelector<HTMLButtonElement>('#refresh')!.click());
  expect(body).toHaveBeenCalledTimes(2);
  expect(container.querySelector('wiselink-monitor')).toBeNull();
});

it('removes an expanded graph and private snapshots when the existing metadata authorization is revoked', async () => {
  await render(); await open();
  authorize.mockRejectedValueOnce(Object.assign(new Error('denied'), { statusCode: 403 }));
  await act(async () => window.dispatchEvent(new dom.window.Event('focus')));
  expect(container.querySelector('[aria-label="LCM 运行诊断"]')).toBeNull();
  expect(container.textContent).not.toContain('LOCAL-SYNTHETIC-MATRIX.xls');
  expect(body).toHaveBeenCalledTimes(1);
});

it('immediately hides the previous graph during a new session and ignores a late old body', async () => {
  await render(); await open();
  let oldFinish!: (value: ReturnType<typeof nativeMatrixFixture>) => void;
  body.mockImplementationOnce(() => new Promise(resolve => { oldFinish = resolve; }));
  generation = 2; await render();
  expect(container.querySelector('[aria-label="LCM 运行诊断"]')).toBeNull();
  body.mockImplementationOnce(() => new Promise(() => {})); generation = 3; await render();
  await act(async () => oldFinish(nativeMatrixFixture()));
  expect(container.querySelector('[aria-label="LCM 运行诊断"]')).toBeNull();
  expect(container.textContent).not.toContain('LOCAL-SYNTHETIC-MATRIX.xls');
});
