import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import type AtlasGraph from '@client/src/features/atlas/AtlasGraph';
import SuiteLibraryGraphPage from '@client/src/pages/RelationGraphPage/SuiteLibraryGraphPage';
import { getCanonicalLibraryDocuments } from '@client/src/api/canonical-host';
import { getEngineeringMatterDirectory, getEngineeringMatter } from '@client/src/api/engineering-matter';
import { libraryDocuments, libraryMetadata } from './fixtures/canonical-library';
import { libraryMatterFixture } from './fixtures/library-matter';
import { readLibraryGraphReturn } from '@client/src/pages/RelationGraphPage/library-graph-return-memory';
import type { CanonicalLibraryDocumentsResponse } from '@shared/api.interface';
import { readingReturnTarget } from '@client/src/features/matter/reading-return';

jest.mock('@client/src/components/ui/button', () => ({ Button: ({ variant: _variant, size: _size, ...props }: Omit<ComponentProps<'button'>, 'size'> & { variant?: string; size?: string }) => createElement('button', props) }));
let mockSession = 1, mockDenied = false, mockUserId = 'actor-1';
let mockCanvasProps: ComponentProps<typeof AtlasGraph> | null = null;
jest.mock('@client/src/api/canonical-host', () => ({ getCanonicalLibraryDocuments: jest.fn(), getCanonicalLibraryGraph: jest.fn(), getCanonicalHostClientSessionGeneration: () => mockSession,
  isCanonicalObjectNotFound: (reason: { statusCode?: number }) => reason?.statusCode === 404,
  summarizeCanonicalDocumentReadFailure: (reason: { statusCode?: number }) => ({ statusCode: reason?.statusCode }) }));
jest.mock('@client/src/api/engineering-matter', () => ({ getEngineeringMatterDirectory: jest.fn(), getEngineeringMatter: jest.fn() }));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({ useCurrentUserSession: () => ({ sessionGeneration: mockSession, authenticationRequired: mockDenied, currentUser: { user_id: mockUserId } }) }));
jest.mock('@client/src/pages/RelationGraphPage/suite-library-graph-page.css', () => ({}));
jest.mock('@client/src/features/atlas/AtlasGraph', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const cytoscape = jest.requireActual<typeof import('cytoscape')>('cytoscape');
  return { __esModule: true, default: (props: ComponentProps<typeof AtlasGraph>) => {
    mockCanvasProps = props;
    React.useEffect(() => {
      const cy = cytoscape({ headless: true, elements: [...props.graph.nodes.map(node => ({ data: node })), ...props.graph.edges.map(edge => ({ data: edge }))], layout: { name: 'preset' } });
      props.api.current = cy; props.onReady(true);
      return () => { cy.destroy(); props.api.current = null; };
    }, [props.graph]);
    return React.createElement('div', { 'data-testid': 'library-canvas', 'data-node-count': props.graph.nodes.length, 'data-edge-count': props.graph.edges.length });
  } };
});
const { JSDOM } = require('jsdom');
let dom: { window: Window & typeof globalThis }, root: Root, container: HTMLDivElement;
let navigate: ReturnType<typeof useNavigate>, currentLocation = '';
const docs = jest.mocked(getCanonicalLibraryDocuments), directory = jest.mocked(getEngineeringMatterDirectory), matterRead = jest.mocked(getEngineeringMatter);
function Probe() {
  const location = useLocation(); currentLocation = location.pathname + location.search; navigate = useNavigate();
  return new URLSearchParams(location.search).get('scope') === 'library' ? createElement(SuiteLibraryGraphPage) : createElement('div', null, 'existing detail route');
}
async function render(entry = '/graph?scope=library') {
  root = createRoot(container);
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: [entry] }, createElement(Probe))));
}
async function click(label: string) {
  const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent === label || item.getAttribute('aria-label') === label);
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
beforeAll(() => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test/' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
});
afterAll(() => dom.window.close());
beforeEach(() => {
  jest.resetAllMocks(); mockSession = 1; mockDenied = false; mockUserId = 'actor-1'; mockCanvasProps = null;
  const catalog = libraryDocuments(['a']);
  catalog.items[0].versions[0].extractedMetadata = libraryMetadata('3461');
  catalog.items[0].versions[1].extractedMetadata = libraryMetadata('3141');
  docs.mockResolvedValue(catalog); directory.mockResolvedValue({ items: [], nextCursor: null, fileReadPerformed: false });
  container = document.createElement('div'); document.body.appendChild(container);
});
afterEach(() => { act(() => root?.unmount()); container.remove(); });

it('shows all graph levels in one reused Atlas canvas, with no expansion buttons or permanent prose/sidebar', async () => {
  await render();
  expect(mockCanvasProps?.variant).toBe('macro');
  expect(mockCanvasProps?.graph.nodes).toHaveLength(7);
  expect(new Set(mockCanvasProps?.graph.nodes.map(node => node.kind))).toEqual(new Set(['classification', 'family', 'document']));
  expect(container.querySelector('aside')).toBeNull();
  expect(container.textContent).not.toMatch(/展开|分类簇的位置|每页最多/);
});
it('fits the network instead of applying an incompatible grid camera from an old bookmark', async () => {
  const oldCamera = JSON.stringify({ zoom: 3, pan: { x: 9000, y: 8000 } });
  await render(`/graph?scope=library&selectedId=library:version:DV-a-1&viewport=${encodeURIComponent(oldCamera)}`);
  expect(mockCanvasProps?.location.selected).toBe('library:version:DV-a-1');
  expect(mockCanvasProps!.api.current!.zoom()).not.toBe(3);
  expect(mockCanvasProps!.api.current!.pan()).not.toEqual({ x: 9000, y: 8000 });
});
it('keeps point selection, hover/camera controls and the object sidebar free of extra data calls', async () => {
  await render(); const calls = docs.mock.calls.length + directory.mock.calls.length;
  await click('图谱对象清单');
  await act(async () => mockCanvasProps!.onSelect('library:version:DV-a-1'));
  expect(container.textContent).toContain('打开文档图谱');
  await click('关闭图谱侧栏');
  expect(container.querySelector('aside')).toBeNull();
  expect(mockCanvasProps?.graph.nodes).toHaveLength(7);
  expect(docs.mock.calls.length + directory.mock.calls.length).toBe(calls);
});
it('opens the existing exact-version graph and restores macro identity, camera and dragged geometry on return', async () => {
  await render();
  await act(async () => mockCanvasProps!.onSelect('library:version:DV-a-1'));
  const core = mockCanvasProps!.api.current!;
  core.getElementById('library:version:DV-a-1').position({ x: 71, y: 96 });
  core.viewport({ zoom: .6, pan: { x: 22, y: -30 } });
  await click('打开文档图谱');
  const query = new URL(currentLocation, 'https://example.test').searchParams;
  expect(query.get('scope')).toBe('document'); expect(query.get('documentVersionId')).toBe('DV-a-1'); expect(query.get('readerWorkItemId')).toBe('WI-OLD');
  const saved = readLibraryGraphReturn(query.get('returnLibrarySnapshot')!, mockSession)!;
  await act(async () => navigate(`/graph?${saved.query}`));
  expect(mockCanvasProps?.location.selected).toBe('library:version:DV-a-1');
  expect(mockCanvasProps!.api.current!.zoom()).toBe(.6);
  expect(mockCanvasProps!.api.current!.getElementById('library:version:DV-a-1').position()).toEqual({ x: 71, y: 96 });
});
it('returns from direct exact-source reading to the same macro filter, selection and last camera/geometry', async () => {
  await render('/graph?scope=library&ata=3141&search=SB');
  await act(async () => mockCanvasProps!.onSelect('library:version:DV-a-1'));
  const core = mockCanvasProps!.api.current!;
  core.getElementById('library:version:DV-a-1').position({ x: 91, y: -26 });
  core.viewport({ zoom: .8, pan: { x: 17, y: 36 } });
  await click('阅读准确来源');
  const source = new URL(currentLocation, 'https://example.test');
  expect(source.pathname).toBe('/document-versions/DV-a-1');
  expect(source.searchParams.get('returnDocumentVersionId')).toBe('DV-a-1');
  expect(readingReturnTarget(source.searchParams, 'DV-other')).toBeNull();
  const target = readingReturnTarget(source.searchParams, 'DV-a-1')!;
  expect(target.label).toBe('返回全库图谱');
  const returned = new URL(target.route, 'https://example.test').searchParams;
  expect(returned.get('scope')).toBe('library');
  expect(returned.get('ata')).toBe('3141'); expect(returned.get('search')).toBe('SB');
  expect(returned.get('macroView')).toBe('network'); expect(returned.get('displaySession')).toBe('1');
  expect(returned.has('layoutSnapshot')).toBe(true);
  await act(async () => navigate(target.route));
  expect(mockCanvasProps?.location.selected).toBe('library:version:DV-a-1');
  expect(mockCanvasProps!.api.current!.zoom()).toBe(.8);
  expect(mockCanvasProps!.api.current!.pan()).toEqual({ x: 17, y: 36 });
  expect(mockCanvasProps!.api.current!.getElementById('library:version:DV-a-1').position()).toEqual({ x: 91, y: -26 });
});
it('opens the preserved matter graph with an explicit macro return token', async () => {
  const matter = libraryMatterFixture().matter; matter.materials = [];
  directory.mockResolvedValue({ items: [{ matterId: matter.matterId, title: matter.title, primaryWorkItemId: null, createdAt: '', updatedAt: '', currentMatterRevisionId: matter.currentRevision.matterRevisionId, workingRevision: 1, result: null }], nextCursor: null, fileReadPerformed: false });
  matterRead.mockResolvedValue(matter);
  await render(); await act(async () => mockCanvasProps!.onSelect(`library:matter:${matter.matterId}`));
  await click('打开事项图谱');
  const query = new URL(currentLocation, 'https://example.test').searchParams;
  expect(query.get('matterId')).toBe(matter.matterId); expect(query.has('scope')).toBe(false);
  expect(readLibraryGraphReturn(query.get('returnLibrarySnapshot')!, 1)?.query).toContain('scope=library');
});
it('expresses missing reference index and failed matter read only in the optional status panel', async () => {
  directory.mockRejectedValue(Object.assign(new Error('offline'), { statusCode: 503 }));
  await render(); expect(container.textContent).toContain('部分读取'); expect(container.textContent).not.toContain('NOT_INDEXED');
  expect(container.textContent).toContain('事项未读'); expect(container.textContent).not.toContain('0 事项');
  await click('图谱读取状态');
  expect(container.textContent).toContain('NOT_INDEXED'); expect(container.textContent).toContain('READ_FAILED');
  expect(container.textContent).not.toContain('没有登记资料连接');
});
it('makes filter changes a fresh macro scope and preserves special ATA values in requests', async () => {
  await render();
  const matching = libraryDocuments(['special']);
  matching.items[0].versions[0].extractedMetadata = libraryMetadata('24-41');
  docs.mockResolvedValue(matching);
  await act(async () => navigate('/graph?scope=library&level=families&groupBy=ata&clusterValue=24-41'));
  expect(docs.mock.calls.at(-1)?.[0]).toMatchObject({ ata: '24-41' });
  expect(mockCanvasProps?.graph.nodes.some(node => node.documentVersionId === 'DV-special-1')).toBe(true);
  expect(container.querySelector('[data-testid="library-canvas"]')).not.toBeNull();
});
it('clears data and private display state on denied sessions and actor changes', async () => {
  await render('/graph?scope=library&selectedId=library:version:DV-a-1&displaySession=1');
  mockSession = 2; mockUserId = 'actor-2'; mockDenied = true;
  await act(async () => navigate('/graph?scope=library&selectedId=library:version:DV-a-1&displaySession=1'));
  expect(container.querySelector('[data-testid="library-canvas"]')).toBeNull();
  expect(new URL(currentLocation, 'https://example.test').searchParams.has('selectedId')).toBe(false);
  expect(container.textContent).toContain('请先登录');
});
it('ignores a late read from the previous actor even if the mocked transport does not honor abort', async () => {
  let resolveOld: (page: CanonicalLibraryDocumentsResponse) => void = () => undefined;
  docs.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  await render();
  mockSession = 2; mockUserId = 'actor-2'; docs.mockResolvedValue(libraryDocuments(['new-actor']));
  await act(async () => navigate('/graph?scope=library&displaySession=2'));
  await act(async () => resolveOld(libraryDocuments(['old-actor'])));
  expect(mockCanvasProps?.graph.nodes.some(node => node.familyId === 'new-actor')).toBe(true);
  expect(mockCanvasProps?.graph.nodes.some(node => node.familyId === 'old-actor')).toBe(false);
  expect(container.querySelector('[data-testid="library-canvas"]')).not.toBeNull();
});
it('removes all objects on catalog access failure and lets an explicit retry reread the same scope', async () => {
  await render(); docs.mockRejectedValueOnce(Object.assign(new Error('denied'), { statusCode: 403 }));
  await click('重新核对当前范围');
  expect(container.querySelector('[data-testid="library-canvas"]')).toBeNull();
  await click('重试同一范围');
  expect(container.querySelector('[data-testid="library-canvas"]')).not.toBeNull();
});
it('shows an explicit rendering-budget error and keeps filters available without clipping source objects', async () => {
  const page = libraryDocuments(['oversize']);
  page.items[0].versions[0].extractedMetadata = libraryMetadata();
  page.items[0].versions[0].extractedMetadata!.ata.observations = Array.from({ length: 1025 }, (_, index) => ({ value: `raw-${index}`, status: 'PENDING_REVIEW', evidence: [] }));
  docs.mockResolvedValue(page);
  await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('超过 1024');
  expect(container.querySelector('[data-testid="library-canvas"]')).toBeNull();
  await click('筛选');
  expect(container.querySelector('aside[aria-label="全库筛选"]')).not.toBeNull();
});
