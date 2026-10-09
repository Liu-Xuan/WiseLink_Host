import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import DocumentVersionReadingPage from '../../../client/src/pages/DocumentParsingPage/DocumentVersionReadingPage';
import { originalFixture } from '../document-parsing/fixtures/document-original.fixture';

const { JSDOM } = require('jsdom');

jest.mock('@client/src/pages/DocumentParsingPage/document-version-reading.css', () => ({}), { virtual: true });
jest.mock('@client/src/components/ui/button', () => ({
  Button: ({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) =>
    createElement('button', { onClick, disabled }, children),
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
jest.mock('@client/src/pages/DocumentParsingPage/DocumentSourceReadingWorkspace', () => ({
  DocumentSourceReadingWorkspace: (props: { mode: string; onModeChange: (mode: string) => void; bilingualContent: ReactNode; initialPage?: number; initialUnitId?: string; onLocationSelect?: (page: number, unitId: string) => void }) =>
    createElement('div', { 'data-mode': props.mode, 'data-initial-page': props.initialPage, 'data-initial-unit': props.initialUnitId },
      createElement('button', { id: 'select-original-source', onClick: () => props.onLocationSelect?.(2, 'u2') }, '定位原文段落'),
      createElement('button', { id: 'select-unregistered-page', onClick: () => props.onLocationSelect?.(3, 'u2') }, '未登记页'),
      createElement('button', { id: 'select-unknown-source', onClick: () => props.onLocationSelect?.(2, 'unregistered-unit') }, '未知段落'),
      createElement('button', { id: 'switch-bilingual', onClick: () => props.onModeChange('bilingual') }, '切中英对照'),
      createElement('button', { id: 'switch-translation', onClick: () => props.onModeChange('translation') }, '切中文阅读'),
      props.bilingualContent),
}));

const mockNativeGet = jest.fn();
const mockNativeWork = jest.fn();
const mockNativeReaderImport = jest.fn();
const mockGraphLoader = jest.fn();
jest.mock('@client/src/features/tdms-source/TdmsSourceReading', () => { mockNativeReaderImport(); return { __esModule: true, default: () => null }; });
jest.mock('@client/src/features/tdms-source/tdms-relation-graph-loader', () => ({ loadTdmsSourceRelationGraph: (...args: unknown[]) => mockGraphLoader(...args) }));
const mockStatus = jest.fn();
const mockReading = jest.fn();
const mockTranslation = jest.fn();
const mockStart = jest.fn();
const mockSessionCallbacks: Array<() => void> = [];
jest.mock('@client/src/api/canonical-host', () => ({
  readTdmsSourceCatalogue: (...args: unknown[]) => mockNativeGet(...args),
  readTdmsSourceRecord: (...args: unknown[]) => mockNativeGet(...args),
  readTdmsSourceRelations: (...args: unknown[]) => mockNativeGet(...args),
  readEngineeringKnowledgeWork: (...args: unknown[]) => mockNativeWork(...args),
  readDocumentParsingStatus: (...args: unknown[]) => mockStatus(...args),
  readParsedDocument: (...args: unknown[]) => mockReading(...args),
  readDocumentTranslationReading: (...args: unknown[]) => mockTranslation(...args),
  startDocumentParsing: (...args: unknown[]) => mockStart(...args),
  subscribeCanonicalHostClientSession: (callback: () => void) => {
    mockSessionCallbacks.push(callback);
    return () => undefined;
  },
}));

function readingPayload() {
  return {
    documentVersionId: 'DV1', parseRunId: 'PR1', parseRevision: 3,
    parser: { name: 'constructed-parser', version: '1.0' },
    titleEnhancement: { status: 'SUCCEEDED' },
    markdown: 'constructed', assets: [],
    projection: { documentVersionId: 'DV1', parseRunId: 'PR1' },
    original: originalFixture(),
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
  dom.window.close();
  for (const [key, descriptor] of oldGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  oldGlobals.clear();
});


function closed() {
  expect(mockNativeGet).not.toHaveBeenCalled(); expect(mockNativeWork).not.toHaveBeenCalled();
  expect(mockNativeReaderImport).not.toHaveBeenCalled(); expect(mockGraphLoader).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain('TDMS');
}
it('real document consumer retains the pinned original/body and ignores browser activation values with zero native calls/lazy', async () => {
  dom.window.localStorage.setItem('TDMS_SOURCE_UI_ENABLED', 'true'); dom.window.sessionStorage.setItem('tdmsEnabled', 'true');
  await mount('parseRunId=PR1&tdms=true&TDMS_SOURCE_UI_ENABLED=true');
  expect(container.textContent).toContain('阅读版本 3'); expect(container.querySelector('[data-mode="dual"]')).not.toBeNull();
  closed(); await act(async () => { dom.window.dispatchEvent(new dom.window.Event('focus')); document.dispatchEvent(new dom.window.Event('visibilitychange')); }); closed();
  expect(mockReading).toHaveBeenCalledTimes(1); expect(mockReading.mock.calls[0].slice(0,2)).toEqual(['DV1', 'PR1']);
  expect(mockTranslation).not.toHaveBeenCalled(); expect(mockStart).not.toHaveBeenCalled();
});
it.each([401,403,404])('real document denial %s clears old body while native layer stays unmounted', async status => {
  await mount('parseRunId=PR1'); expect(container.textContent).toContain('阅读版本 3');
  mockReading.mockRejectedValueOnce(Object.assign(new Error('source rejected'), { statusCode: status }));
  await navigate('/document-versions/DV1?parseRunId=PR2&tdms=true');
  expect(container.textContent).not.toContain('阅读版本 3'); closed();
  expect(mockReading.mock.calls.at(-1)?.slice(0,2)).toEqual(['DV1','PR2']);
});
it('real document session invalidation cannot restore a late old pinned body or activate native reads', async () => {
  let old!: (value: unknown) => void; mockReading.mockImplementationOnce(() => new Promise(yes => { old = yes; }));
  await mount('parseRunId=PR1');
  mockReading.mockRejectedValue(Object.assign(new Error('new session denied'), { statusCode: 401 }));
  await act(async () => { for (const callback of mockSessionCallbacks) callback(); });
  await act(async () => old(readingPayload()));
  expect(container.textContent).not.toContain('阅读版本 3'); closed();
});
