import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import type { LcmMatrixResponse, LcmMatrixDetailResponse, LcmMatrixQuery } from '@shared/lcm-matrix.interface';

const details = jest.fn();
jest.mock('@client/src/api/canonical-host', () => ({
  readLcmNativeMatrixDetails: (...args: unknown[]) => details(...args), downloadLcmOriginal: jest.fn(),
}));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({
  useCurrentUserSession: () => ({ sessionGeneration: 1, authenticationRequired: false }),
}));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/components/ui/dialog', () => {
  const react = jest.requireActual<typeof import('react')>('react');
  const frame = ({ children }: { children?: React.ReactNode }) => react.createElement('div', null, children);
  return { Dialog: frame, DialogContent: frame, DialogTitle: frame, DialogDescription: frame };
});
import { LcmEvidenceDrawer } from '@client/src/pages/WorkspaceHomePage/LcmEvidenceDrawer';

describe('LCM details preserve the same in-flight semantic read', () => {
  let dom: JSDOM, root: Root, container: HTMLDivElement, client: QueryClient;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><body></body>', { url: 'https://test.invalid/library' });
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
      navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); details.mockReset();
  });
  afterEach(async () => {
    await act(async () => root.unmount()); client.clear(); dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
    originals.clear();
  });

  it('does not cancel details when a new matrix window recreates identical binding/selection objects', async () => {
    const matrix: LcmMatrixResponse = { binding: { readSetRef: 'readset', projectionRevision: 'r2', scopeRef: 'scope',
      permissionRevision: 'p1', filterHash: 'filter', orderRef: 'order' }, sourceMode: 'CANDIDATE', snapshots: [],
      aircraftIndex: [], aircraftOrder: [], orderGroups: [], softwareIndex: [], softwareGroups: [],
      anchorSoftwareRef: null, anchorCleared: false, rowStart: 0, columnStart: 0, columns: [] };
    let finish!: (value: LcmMatrixDetailResponse) => void;
    details.mockImplementation(() => new Promise<LcmMatrixDetailResponse>(resolve => { finish = resolve; }));
    const unchanged = jest.fn();
    const render = async (value: LcmMatrixResponse) => {
      await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(LcmEvidenceDrawer, {
        query: { snapshotIds: ['a'.repeat(64)] }, matrix: value, selection: { softwareRef: 'unit-software' },
        onClose: unchanged, onLost: unchanged, onSort: unchanged,
      }))));
    };
    await render(matrix);
    const signal: AbortSignal = details.mock.calls[0][1];
    await render({ ...matrix, binding: { ...matrix.binding }, columnStart: 1 });
    expect(signal.aborted).toBe(false); expect(details).toHaveBeenCalledTimes(1);
    await act(async () => finish({ binding: matrix.binding, records: [], nextAfter: null, originalUnavailableReason: null }));
    expect(container.querySelector('[role=alert]')).toBeNull();
  });
  it('does not deduplicate a changed model scope into the previous in-flight detail read', async () => {
    const matrix: LcmMatrixResponse = { binding: { readSetRef: 'readset', projectionRevision: 'r2', scopeRef: 'scope',
      permissionRevision: 'p1', filterHash: 'native-local-filters', orderRef: 'order' }, sourceMode: 'CANDIDATE', snapshots: [],
      aircraftIndex: [], aircraftOrder: [], orderGroups: [], softwareIndex: [], softwareGroups: [],
      anchorSoftwareRef: null, anchorCleared: false, rowStart: 0, columnStart: 0, columns: [] };
    const finishes: Array<(value: LcmMatrixDetailResponse) => void> = [];
    details.mockImplementation(() => new Promise<LcmMatrixDetailResponse>(resolve => finishes.push(resolve)));
    const unchanged = jest.fn();
    const render = async (query: LcmMatrixQuery) => {
      await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(LcmEvidenceDrawer, {
        query, matrix, selection: { softwareRef: 'same-software' }, onClose: unchanged, onLost: unchanged, onSort: unchanged,
      }))));
    };
    await render({ snapshotIds: ['a'.repeat(64)], aircraftModel: 'B737-8' });
    const signal: AbortSignal = details.mock.calls[0][1];
    await render({ snapshotIds: ['a'.repeat(64)], aircraftModels: ['B737-8', 'A320-200'] });
    expect(signal.aborted).toBe(true); expect(details).toHaveBeenCalledTimes(2);
    expect(details.mock.calls[1][0].query.aircraftModels).toEqual(['B737-8', 'A320-200']);
    await act(async () => finishes[0]({ binding: matrix.binding, records: [], nextAfter: null, originalUnavailableReason: 'LOCAL_REFERENCE_ONLY' }));
    expect(container.textContent).not.toContain('原件当前仅有本地来源引用');
    await act(async () => finishes[1]({ binding: matrix.binding, records: [], nextAfter: null, originalUnavailableReason: null }));
    expect(container.textContent).toContain('没有匹配源记录。');
  });
});
