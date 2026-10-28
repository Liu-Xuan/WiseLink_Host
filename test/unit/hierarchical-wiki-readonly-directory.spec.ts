import type { HierarchicalWikiList } from '../../shared/hierarchical-wiki.interface';

jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({ axiosForBackend: jest.fn() }));
jest.mock('../../client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => 1,
  requireCanonicalHostClientAuthentication: jest.fn(),
  getCanonicalLibraryDocuments: async () => ({ items: [] }),
  getCanonicalLibraryFleetCatalog: async () => ({ families: [] }),
}));
jest.mock('../../client/src/features/review/TaskModelPicker', () => ({ useTaskModelOptions: () => ({ data: null }) }));
jest.mock('../../client/src/features/derived-summary/SavedWorkSelector', () => ({ __esModule: true, default: () => null }));
jest.mock('../../client/src/features/derived-summary/HierarchicalWikiRuntimeDiagnostic', () => ({
  __esModule: true,
  default: ({ onRefresh }: { onRefresh: () => void }) => require('react').createElement('button', { onClick: onRefresh }, '读取最新状态'),
}));

const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
const prior = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  prior.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
const React = require('react');
const { createRoot } = require('react-dom/client');
const { MemoryRouter } = require('react-router-dom');
const { axiosForBackend: transport } = require('@lark-apaas/client-toolkit/utils/getAxiosForBackend');
const Directory = require('../../client/src/features/derived-summary/HierarchicalWikiDirectory').default;
const listing: HierarchicalWikiList = {
  items: [{
    wikiId: 'wiki-synthetic', summaryId: 'summary-synthetic', parentSummaryId: null,
    scope: { kind: 'FLEET', title: 'Synthetic Wiki', fleetFamilyId: 'B787', fleetModelIds: [],
      ata2: null, ata4: null, selectionReason: 'Explicit synthetic scope' },
    state: 'QUEUED', enabled: true, desiredGeneration: 1, completedGeneration: 0,
    savedRevision: null, coveredMembers: [], waiting: [], firstDirtyAt: null, dueAt: null, errorCode: null,
    activeRequest: { requestId: 'request-synthetic', attemptRef: 'AQ-synthetic', status: 'QUEUED', claimCount: 0, executorSessionKey: null },
    coverage: 'AUTHORIZED_CLASSIFIED_HOST_MATERIAL', lastCheckedAt: null, inventoryComplete: true,
  }],
  classifications: [], candidates: [], nextClassificationCursor: null, sourceCurrentness: 'UNKNOWN',
};
let container: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  jest.useFakeTimers();
  transport.mockReset();
  transport.mockResolvedValue({ data: listing });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove(); jest.useRealTimers();
});
afterAll(() => {
  for (const [name, descriptor] of prior) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
  }
  dom.window.close();
});

it('mount, visible polling and manual refresh only GET; the existing explicit pause button alone submits its exact POST', async () => {
  await React.act(async () => root.render(React.createElement(MemoryRouter, null, React.createElement(Directory, { session: 1 }))));
  expect(transport).toHaveBeenCalledTimes(1);
  await React.act(async () => { await jest.advanceTimersByTimeAsync(15_000); });
  expect(transport).toHaveBeenCalledTimes(2);
  const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text)!;
  await React.act(async () => button('读取最新状态').click());
  expect(transport).toHaveBeenCalledTimes(3);
  for (const [request] of transport.mock.calls) {
    expect(request).toMatchObject({ method: 'GET', url: '/api/canonical-host/hierarchical-wiki', data: undefined });
  }
  expect(container.textContent).toContain('排队等待执行');
  await React.act(async () => button('暂停自动更新').click());
  const writes = transport.mock.calls.map(([request]: [Record<string, unknown>]) => request)
    .filter((request: Record<string, unknown>) => request.method !== 'GET');
  expect(writes).toEqual([expect.objectContaining({
    method: 'POST', url: '/api/canonical-host/hierarchical-wiki/summary-synthetic', data: { enabled: false },
  })]);
  expect(transport).toHaveBeenCalledTimes(5); // explicit update + the original post-action read
});
