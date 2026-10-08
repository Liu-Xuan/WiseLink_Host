import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { RelationGraphPage } from '@client/src/pages/RelationGraphPage/RelationGraphPage';
import SuiteMatterGraphPage from '@client/src/pages/RelationGraphPage/SuiteMatterGraphPage';
import type { SuiteMatterGraphViewProps } from '@client/src/pages/RelationGraphPage/SuiteMatterGraphView';
import { buildSuiteMatterGraph } from '@client/src/pages/RelationGraphPage/suite-matter-graph';
import { libraryMatterFixture } from '../fixtures/library-matter';
import { savedEvidence } from './reader-fixtures';

const { JSDOM } = require('jsdom');
const mockNativeGet = jest.fn(), mockSavedWork = jest.fn(), mockIndex = jest.fn();
const mockIdentity = jest.fn(), mockLazyReader = jest.fn(), mockGraphLoader = jest.fn();
const mockNativeLayerModule = jest.fn();
let mockSession = 1, mockDenied = false;
let mockView: SuiteMatterGraphViewProps;
let mockGraphError: string | null = null;
const mockData = libraryMatterFixture();
mockData.working.current!.state.substantiveResult!.evidence.push(savedEvidence('synthetic-native-old'));
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => mockSession,
  getLibraryIndex: (...args: unknown[]) => mockIndex(...args),
  readEngineeringKnowledgeWork: (...args: unknown[]) => mockSavedWork(...args),
  readTdmsSourceCatalogue: (...args: unknown[]) => mockNativeGet(...args),
  readTdmsSourceRecord: (...args: unknown[]) => mockNativeGet(...args),
  readTdmsSourceRelations: (...args: unknown[]) => mockNativeGet(...args),
  getCanonicalLibraryDocuments: jest.fn(), isCanonicalObjectNotFound: () => false,
}));
jest.mock('@client/src/api/engineering-matter', () => ({ getEngineeringMatterDirectory: jest.fn() }));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({ useCurrentUserSession: () => ({
  sessionGeneration: mockSession, authenticationRequired: mockDenied, currentUser: { user_id: 'synthetic-actor' },
}) }));
jest.mock('@client/src/features/matter/useEngineeringMatter', () => ({
  useEngineeringMatterQueryIdentity: (...args: unknown[]) => { mockIdentity(...args); throw new Error('closed native identity hook must not run'); },
}));
jest.mock('@client/src/features/tdms-source/TdmsGraphSourceReading', () => {
  mockLazyReader(); return { __esModule: true, default: () => null };
});
jest.mock('@client/src/pages/RelationGraphPage/EnabledSuiteTdmsSourceLayer', () => {
  mockNativeLayerModule();
  throw new Error('closed real Suite consumer must not evaluate its native layer module');
});
jest.mock('@client/src/features/tdms-source/tdms-relation-graph-loader', () => ({ loadTdmsSourceRelationGraph: (...args: unknown[]) => mockGraphLoader(...args) }));
jest.mock('@client/src/pages/RelationGraphPage/SuiteLibraryGraphPage', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/pages/RelationGraphPage/SuiteDocumentGraphPage', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/pages/RelationGraphPage/useSuiteGraphSources', () => ({ useSuiteGraphSources: () => ({ activities: new Map(), sources: [], loading: false }) }));
jest.mock('@client/src/pages/RelationGraphPage/useSuiteMatterGraph', () => ({ useSuiteMatterGraph: () => ({
  graph: mockDenied || mockGraphError ? null : buildSuiteMatterGraph(mockData),
  revision: mockDenied || mockGraphError ? null : mockData.working.current, workspace: mockData,
  loading: false, error: mockGraphError, refresh: async () => undefined,
}) }));
jest.mock('@client/src/pages/RelationGraphPage/SuiteMatterGraphView', () => ({ __esModule: true,
  default: (props: SuiteMatterGraphViewProps) => { mockView = props; return createElement('div', { 'data-original-view': true }, props.read.graph.title); },
}));
jest.mock('@client/src/pages/RelationGraphPage/RelationGraphCanvas', () => ({ __esModule: true,
  default: () => createElement('div', { 'data-original-canvas': true }),
}));
jest.mock('@client/src/pages/RelationGraphPage/relation-graph.css', () => ({}));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/components/ui/button-group', () => ({ ButtonGroup: 'div' }));
jest.mock('@lark-apaas/client-toolkit/logger', () => ({ logger: { error: jest.fn() } }));

let dom: InstanceType<typeof JSDOM>, root: Root, router: ReturnType<typeof createMemoryRouter>, container: HTMLElement;
const previous = new Map<string, PropertyDescriptor | undefined>();
beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>', { url: 'https://synthetic.test/?tdms=true' });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  dom.window.localStorage.setItem('TDMS_SOURCE_UI_ENABLED', 'true'); dom.window.sessionStorage.setItem('tdmsEnabled', 'true');
  container = dom.window.document.getElementById('root')!; root = createRoot(container);
  jest.clearAllMocks(); mockSession = 1; mockDenied = false; mockGraphError = null;
  mockIndex.mockResolvedValue({ workItem: { workItemId: 'WI', currentJobAidWorkRevisionRef: 'saved-work' },
    document: { documentVersionId: 'DV', documentCode: 'synthetic-document', businessRevision: 'R1' },
    libraryIndex: { rootLabel: 'synthetic-document', nodes: [], edges: [], limitations: [] },
  });
});
afterEach(async () => {
  await act(async () => root.unmount()); router?.dispose(); dom.window.close();
  for (const [key, value] of previous) { if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); }
  previous.clear();
});
async function mount(suite = true) {
  router = createMemoryRouter([{ path: '/graph', element: suite ? createElement(SuiteMatterGraphPage, { matterId: 'ui-test-matter' }) : createElement(RelationGraphPage) }],
    { initialEntries: [suite ? '/graph?matterId=ui-test-matter&tdms=true' : '/graph?workItemId=WI&workRef=saved-work&tdms=true'] });
  await act(async () => root.render(createElement(RouterProvider, { router })));
}
function closed() {
  for (const mock of [mockNativeGet, mockSavedWork, mockIdentity, mockLazyReader, mockGraphLoader, mockNativeLayerModule]) expect(mock).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain('读取 TDMS'); expect(container.textContent).not.toContain('synthetic-native-old');
}
it('real Suite consumer keeps its original graph and does not project native source nodes or mount source hooks', async () => {
  await mount(); expect(container.querySelector('[data-original-view]')).not.toBeNull();
  expect([...mockView.read.targets.values()].filter(target => target.kind === 'tdms-record' || target.kind === 'tdms-unresolved')).toEqual([]);
  expect(mockView.read.graph.groups.some(group => group.key.includes('tdms'))).toBe(false); closed();
  await act(async () => { window.dispatchEvent(new dom.window.Event('focus')); document.dispatchEvent(new dom.window.Event('visibilitychange')); }); closed();
});
it('real legacy graph reads the ordinary projection once with no native savedWork, GET or lazy import', async () => {
  await mount(false); expect(mockIndex).toHaveBeenCalledTimes(1); expect(container.textContent).toContain('关系图谱'); closed();
});
it.each([401, 403, 404])('real Suite rejection %s drops its old graph without native fallback', async status => {
  await mount(); mockGraphError = `source denied ${status}`;
  await act(async () => router.navigate('/graph?matterId=ui-test-matter&tdms=true&recheck=1'));
  expect(container.querySelector('[data-original-view]')).toBeNull(); closed();
});
it('real Suite session invalidation removes the old graph and cannot mount any native identity or lazy reader', async () => {
  await mount(); mockSession++; mockDenied = true;
  await act(async () => router.navigate('/graph?matterId=ui-test-matter&tdms=true&session=2'));
  expect(container.querySelector('[data-original-view]')).toBeNull(); closed();
});
