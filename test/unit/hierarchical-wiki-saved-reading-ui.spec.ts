import type { HierarchicalWikiStatus } from '../../shared/hierarchical-wiki.interface';

jest.mock('../../client/src/api/canonical-host', () => ({
  getCanonicalLibraryDocuments: jest.fn(), getCanonicalLibraryFleetCatalog: jest.fn(),
}));
jest.mock('../../client/src/api/hierarchical-wiki', () => ({
  classifyHierarchicalWiki: jest.fn(), delegateHierarchicalWikiMatter: jest.fn(), enableHierarchicalWiki: jest.fn(),
  listHierarchicalWiki: jest.fn(), updateHierarchicalWiki: jest.fn(),
}));
jest.mock('../../client/src/features/review/TaskModelPicker', () => ({ useTaskModelOptions: () => ({ data: null }) }));
jest.mock('../../client/src/features/derived-summary/SavedWorkSelector', () => ({ __esModule: true, default: () => null }));
jest.mock('../../client/src/features/derived-summary/HierarchicalWikiRuntimeDiagnostic', () => ({
  __esModule: true, default: () => null,
}));
jest.mock('../../client/src/features/derived-summary/useSummaryResource', () => ({ useSummaryResource: jest.fn() }));

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
const { MemoryRouter, useLocation } = require('react-router-dom');
const Directory = require('../../client/src/features/derived-summary/HierarchicalWikiDirectory').default;
const { useSummaryResource } = require('../../client/src/features/derived-summary/useSummaryResource');
const item: HierarchicalWikiStatus = {
  wikiId: 'wiki1', summaryId: 'summary1', parentSummaryId: null,
  scope: { kind: 'FLEET', title: 'Saved Wiki title', fleetFamilyId: 'B787', fleetModelIds: [],
    ata2: null, ata4: null, selectionReason: 'Synthetic confirmed scope' },
  state: 'PENDING', enabled: true, desiredGeneration: 4, completedGeneration: 2,
  savedRevision: { summaryRef: 'saved-ref1', revision: 7 }, coveredMembers: [], waiting: [],
  activeRequest: null, firstDirtyAt: null, dueAt: null, errorCode: null,
  coverage: 'AUTHORIZED_CLASSIFIED_HOST_MATERIAL', lastCheckedAt: null, inventoryComplete: true,
};
function Location() {
  const location = useLocation();
  return React.createElement('output', { id: 'location' }, `${location.pathname}${location.search}`);
}
let container: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  useSummaryResource.mockImplementation((key: string) => ({
    data: key.startsWith('hierarchical-wiki-directory:')
      ? { items: [item], candidates: [], classifications: [], nextClassificationCursor: null, observedAt: '2026-10-24T00:00:00Z' }
      : undefined,
    loading: false, error: null, refresh: jest.fn(),
  }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await React.act(async () => root.unmount()); container.remove(); });
afterAll(() => {
  for (const [name, value] of prior) {
    if (value) Object.defineProperty(globalThis, name, value); else Reflect.deleteProperty(globalThis, name);
  }
  dom.window.close();
});

it('opens the directory title at its observed saved revision instead of the later floating head', async () => {
  await React.act(async () => root.render(React.createElement(MemoryRouter,
    { future: { v7_startTransition: true, v7_relativeSplatPath: true } },
    React.createElement(Directory, { session: 1 }), React.createElement(Location))));
  const link = [...container.querySelectorAll<HTMLAnchorElement>('a')].find(value => value.textContent === item.scope.title)!;
  expect(link.getAttribute('href')).toBe('/summaries/summary1?summaryRef=saved-ref1');
  expect(container.textContent).toContain('目录所见保存修订 7');
  await React.act(async () => link.click());
  expect(container.querySelector('#location')!.textContent).toBe('/summaries/summary1?summaryRef=saved-ref1');
});
