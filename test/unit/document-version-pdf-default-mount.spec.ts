import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, Link, RouterProvider, useLocation } from 'react-router-dom';
import DocumentVersionReadingPage from '../../client/src/pages/DocumentParsingPage/DocumentVersionReadingPage';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';
import { documentGraphReadingParams, readGraphReadingState, withGraphReturn } from '../../client/src/pages/RelationGraphPage/suite-graph-return';
import { suiteGraphSourceEventId } from '../../client/src/pages/RelationGraphPage/suite-graph-timeline';
import { activateLibraryGraphReturnSession, readLibraryGraphReturn, saveLibraryGraphReturn } from '../../client/src/pages/RelationGraphPage/library-graph-return-memory';

const { JSDOM } = require('jsdom');

// Mount the current main document page, source workspace, canvas preview and
// authorization-aware byte hook. No historical reader modules are introduced.

jest.mock('@client/src/pages/DocumentParsingPage/document-version-reading.css', () => ({}), { virtual: true });
jest.mock('@client/src/components/ui/button', () => ({
  Button: ({ children, asChild, ...props }: { children: ReactNode; asChild?: boolean }) =>
    asChild ? children : createElement('button', props, children),
}));
jest.mock('@client/src/components/ui/dialog', () => ({
  Dialog: () => null, DialogContent: () => null, DialogHeader: () => null, DialogTitle: () => null,
}));
jest.mock('@client/src/components/business-ui/api/files/service', () => ({
  uploadFile: jest.fn(() => { throw new Error('Unexpected upload during reading'); }),
}));
jest.mock('@client/src/pages/WorkspaceHomePage/DocumentOriginalPreview', () => ({
  DocumentOriginalPreview: ({ children }: { children: ReactNode }) => createElement('span', null, children),
}));
jest.mock('@client/src/pages/DocumentParsingPage/DocumentParsedImage', () => ({
  DocumentParsedImage: () => null,
}));
jest.mock('@client/src/pages/DocumentParsingPage/MineruMarkdownReader', () => ({
  MineruMarkdownReader: ({ markdown }: { markdown?: string }) => createElement('div', null, markdown ?? 'markdown-body'),
}));
jest.mock('@client/src/pages/DocumentParsingPage/SemanticBilingualReader', () => ({
  SemanticBilingualReader: ({ mode, onSourceRefSelect }: { mode: string; onSourceRefSelect?: (unitId: string, sourceRef: string) => void }) => createElement('div',
    { 'data-bilingual': 'rendered', 'data-reading-mode': mode },
    createElement('button', { id: 'select-translation-source', onClick: () => onSourceRefSelect?.('translation-unit', 'SR-TEST-P2') }, '定位译文来源'),
    '双语对照已渲染'),
}));
jest.mock('@client/src/pages/DocumentParsingPage/pdf-document-viewer-loader', () => ({
  loadPdfDocumentViewer: () => Promise.resolve({ default: () => null }),
  LazyPdfDocumentViewer: (props: { sourceUrl: string; targetPage: number; readingScope: string }) =>
    createElement('div', { 'data-pdf': props.sourceUrl, 'data-page': props.targetPage, 'data-scope': props.readingScope }),
}));
import { clearDocumentOriginalMemory } from '../../client/src/utils/document-original-memory';
const mockOriginalRead = jest.fn();
const mockOriginalIdentity = jest.fn();
const mockCreate = jest.fn();
const mockRevoke = jest.fn();

const mockStatus = jest.fn();
const mockReading = jest.fn();
const mockTranslation = jest.fn();
const mockStart = jest.fn();
const mockSessionCallbacks: Array<() => void> = [];
jest.mock('@client/src/api/canonical-host', () => ({
  readDocumentParsingStatus: (...args: unknown[]) => mockStatus(...args),
  readParsedDocument: (...args: unknown[]) => mockReading(...args),
  readDocumentTranslationReading: (...args: unknown[]) => mockTranslation(...args),
  startDocumentParsing: (...args: unknown[]) => mockStart(...args),
  getCanonicalHostClientSessionGeneration: () => 1,
  readDocumentVersionOriginal: (...args: unknown[]) => mockOriginalRead(...args),
  readDocumentVersionOriginalIdentity: (...args: unknown[]) => mockOriginalIdentity(...args),
  subscribeCanonicalHostClientSession: (callback: () => void) => {
    mockSessionCallbacks.push(callback);
    return () => undefined;
  },
}));

function readingPayload() {
  const original = originalFixture();
  Object.assign(original.binding, { documentVersionId: 'DV1', parseRunId: 'PR1', parseRevision: 3 });
  return {
    documentVersionId: 'DV1', parseRunId: 'PR1', parseRevision: 3,
    parser: { name: 'constructed-parser', version: '1.0' },
    titleEnhancement: { status: 'SUCCEEDED' },
    markdown: 'constructed', assets: [],
    projection: { documentVersionId: 'DV1', parseRunId: 'PR1' },
    original,
  };
}

function statusPayload() {
  return {
    documentVersionId: 'DV1', familyId: 'FAM-1', documentCode: 'SB-TEST-001',
    documentTitle: '测试服务通告', normalizedFamily: 'SB', issuerAuthority: 'OEM',
    businessRevision: 'R2', revisionDate: '2026-09-01', sourceGeneratedDate: '',
    selectedVersionIsCurrent: true, originalFilename: 'constructed.pdf',
    runtimeAvailable: true, runtime: { state: 'CALL_SUCCEEDED' },
    publishedRun: { parseRunId: 'PR1', parseRevision: 3 },
    latestRun: { parseRunId: 'PR1', status: 'PUBLISHED', deadlineAt: '2030-01-01T00:00:00Z' },
  };
}

let root: Root;
let router: ReturnType<typeof createMemoryRouter>;
let dom: InstanceType<typeof JSDOM>;
let container: HTMLElement;
const oldGlobals = new Map<string, PropertyDescriptor | undefined>();

async function mount(query = '') {
  router = createMemoryRouter(
    [{ path: '/document-versions/:documentVersionId', element: createElement(DocumentVersionReadingPage) }, { path: '/library', element: createElement('p', null, 'library') }],
    { initialEntries: [`/document-versions/DV1${query ? `?${query}` : ''}`], future: { v7_relativeSplatPath: true } },
  );
  root = createRoot(container);
  await act(async () => root.render(createElement(RouterProvider, { router, future: { v7_startTransition: true } })));
}

async function navigate(next: string) {
  await act(async () => { await router.navigate(next); });
}

beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test/' });
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    oldGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  Object.defineProperty(dom.window, 'requestAnimationFrame', { value: (callback: FrameRequestCallback) => { callback(0); return 0; } });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollIntoView', { value: () => undefined });
  for (const [key, value] of Object.entries({ createObjectURL: mockCreate, revokeObjectURL: mockRevoke })) {
    oldGlobals.set(`URL.${key}`, Object.getOwnPropertyDescriptor(URL, key));
    Object.defineProperty(URL, key, { configurable: true, value });
  }
  mockCreate.mockImplementation(() => `blob:document-${mockCreate.mock.calls.length}`);
  mockOriginalRead.mockReset().mockResolvedValue(new Blob(['%PDF-test'], { type: 'application/pdf' }));
  mockOriginalIdentity.mockReset();
  container = dom.window.document.getElementById('root');
  jest.clearAllMocks();
  mockSessionCallbacks.length = 0;
  mockStart.mockReset();
  mockStart.mockResolvedValue({});
  mockStatus.mockResolvedValue(statusPayload());
  mockReading.mockResolvedValue(readingPayload());
  mockTranslation.mockResolvedValue({
    documentVersionId: 'DV1', parseRunId: 'PR1',
    execution: { status: 'SUCCEEDED' }, translation: { schemaVersion: 'constructed' },
  });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  router?.dispose();
  clearDocumentOriginalMemory();
  dom.window.close();
  for (const [key, descriptor] of oldGlobals) {
    const target = key.startsWith('URL.') ? URL : globalThis;
    const property = key.replace(/^URL\./, '');
    if (descriptor) Object.defineProperty(target, property, descriptor);
    else Reflect.deleteProperty(target, property);
  }
  oldGlobals.clear();
});

async function clickMode(label: string) {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('.source-reader-mode-tabs button'))
    .find(item => item.textContent === label)!;
  await act(async () => button.click());
}

it.each([375, 760, 761, 899, 900])('opens the real page/workspace/preview composition on ordinary %ipx entry without a load click', async width => {
  Object.defineProperty(dom.window, 'matchMedia', { value: (query: string) => ({
    matches: query === '(min-width: 761px)' ? width >= 761 : width <= 760,
  }) });
  await mount();
  expect(mockOriginalRead).toHaveBeenCalledTimes(1);
  expect(mockOriginalRead).toHaveBeenCalledWith('DV1', expect.any(AbortSignal));
  expect(container.querySelector('[data-pdf]')?.getAttribute('data-page')).toBe('1');
  expect(container.querySelector('[data-pdf]')?.closest('[hidden]')).toBeNull();
  expect(container.textContent).not.toContain('读取受控原件');
  expect(container.textContent).not.toContain('查看原件');
  expect(container.querySelector('.document-reading-maintenance')?.hasAttribute('open')).toBe(false);
  expect(mockTranslation).not.toHaveBeenCalled();
});

it('opens the exact sourceRef page and changes source targets without rereading bytes or body', async () => {
  await mount('parseRunId=PR1&sourceRef=SR-TEST-P2');
  expect(container.querySelector('[data-pdf]')?.getAttribute('data-page')).toBe('2');
  expect(JSON.parse(container.querySelector('[data-pdf]')!.getAttribute('data-scope')!)).toEqual([
    'DV1', 'PR1', 3, 'ART-TEST', 'a'.repeat(64),
  ]);
  await navigate('/document-versions/DV1?parseRunId=PR1&sourceRef=SR-TEST-P1');
  expect(container.querySelector('[data-pdf]')?.getAttribute('data-page')).toBe('1');
  expect(mockOriginalRead).toHaveBeenCalledTimes(1);
  expect(mockReading).toHaveBeenCalledTimes(1);
  expect(mockOriginalIdentity).not.toHaveBeenCalled();
});

it('honors deliberate text and translation modes and retains the existing PDF instance for returning', async () => {
  await mount();
  const pdf = container.querySelector('[data-pdf]');
  for (const label of ['仅原文', '中英对照', '中文阅读']) {
    await clickMode(label);
    expect(container.querySelector('[data-pdf]')).toBe(pdf);
    expect(pdf?.closest('[hidden]')).not.toBeNull();
  }
  await clickMode('仅原件');
  expect(pdf?.closest('[hidden]')).toBeNull();
  await clickMode('原文＋原件');
  expect(pdf?.closest('[hidden]')).toBeNull();
  expect(mockOriginalRead).toHaveBeenCalledTimes(1);
  expect(mockTranslation).toHaveBeenCalledTimes(2); // Each deliberately selected translation mode performs its existing read.
});

it('keeps the existing markdown fallback without inventing a structured original', async () => {
  mockReading.mockResolvedValueOnce({ ...readingPayload(), original: null });
  await mount();
  expect(container.textContent).toContain('constructed');
  expect(container.querySelector('.source-reader-workspace')).toBeNull();
  expect(mockOriginalRead).not.toHaveBeenCalled();
});


it('mounts an exact graph source as default PDF and returns through the real router with its pins, camera and macro ancestry', async () => {
  activateLibraryGraphReturnSession(1, true);
  const macro = { query: 'scope=library&level=versions&familyId=FAM-1&cursor=exact-page&displaySession=1',
    parent: 'scope=library&level=families&groupBy=ata&clusterValue=20', root: 'scope=library&groupBy=ata' };
  const token = saveLibraryGraphReturn(macro, 1)!;
  const pins = { documentVersionId: 'DV1', familyId: 'FAM-1', parseRunId: 'PR1', candidateRevision: 7,
    runRef: 'RUN-R2', statementId: 'ST-R2', anchorId: 'ANCHOR-R2' };
  const viewport = { zoom: 1.2, pan: { x: 37, y: -14 } };
  const graph = documentGraphReadingParams('DV1', 'WI-R2', { selectedId: 'document:DV1',
    eventId: suiteGraphSourceEventId(pins), eventPins: pins, viewport });
  graph.set('returnLibrarySnapshot', token);
  const sourceRoute = withGraphReturn('/document-versions/DV1?parseRunId=PR1&sourceRef=SR-TEST-P2', graph);
  function GraphRoute() {
    const location = useLocation();
    return createElement('div', { 'data-graph-query': location.search },
      createElement(Link, { to: sourceRoute }, '查看原文'));
  }
  router = createMemoryRouter([
    { path: '/graph', element: createElement(GraphRoute) },
    { path: '/document-versions/:documentVersionId', element: createElement(DocumentVersionReadingPage) },
  ], { initialEntries: [`/graph?${graph}`], future: { v7_relativeSplatPath: true } });
  root = createRoot(container);
  await act(async () => root.render(createElement(RouterProvider, { router, future: { v7_startTransition: true } })));
  await act(async () => container.querySelector<HTMLAnchorElement>('a')!.click());
  expect(router.state.location.pathname).toBe('/document-versions/DV1');
  expect(container.querySelector('[data-pdf]')?.getAttribute('data-page')).toBe('2');
  expect(mockOriginalRead).toHaveBeenCalledTimes(1);
  expect(mockReading).toHaveBeenCalledWith('DV1', 'PR1', expect.any(AbortSignal));
  expect(container.textContent).not.toContain('读取受控原件');
  const back = Array.from(container.querySelectorAll<HTMLAnchorElement>('.source-reader-toolbar a'))
    .find(link => link.textContent === '返回关系图谱');
  expect(back?.textContent).toBe('返回关系图谱');
  await act(async () => back!.click());
  expect(router.state.location.pathname).toBe('/graph');
  const restored = new URLSearchParams(router.state.location.search);
  expect(restored.get('documentVersionId')).toBe('DV1');
  expect(restored.get('readerWorkItemId')).toBe('WI-R2');
  expect(readGraphReadingState(restored).eventPins).toEqual(pins);
  expect(readGraphReadingState(restored).viewport).toEqual(viewport);
  expect(readLibraryGraphReturn(restored.get('returnLibrarySnapshot')!, 1)).toEqual(macro);
  expect(mockRevoke).toHaveBeenCalledTimes(1);
});
