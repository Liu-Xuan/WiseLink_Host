import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import DocumentVersionReadingPage from '../../client/src/pages/DocumentParsingPage/DocumentVersionReadingPage';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';

const { JSDOM } = require('jsdom');

jest.mock('@client/src/pages/DocumentParsingPage/document-version-reading.css', () => ({}), { virtual: true });
jest.mock('@client/src/components/ui/button', () => ({
  Button: ({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) =>
    createElement('button', { onClick, disabled }, children),
}));
jest.mock('@client/src/components/ui/dialog', () => ({
  Dialog: () => null, DialogContent: () => null, DialogHeader: () => null, DialogTitle: () => null,
}));
jest.mock('@client/src/pages/WorkspaceHomePage/DocumentOriginalPreview', () => ({
  DocumentOriginalPreview: ({ children }: { children: ReactNode }) => createElement('span', null, children),
}));
jest.mock('@client/src/pages/DocumentParsingPage/DocumentParsedImage', () => ({
  DocumentParsedImage: () => null,
}));
jest.mock('@client/src/pages/DocumentParsingPage/MineruMarkdownReader', () => ({
  MineruMarkdownReader: () => createElement('div', null, 'markdown-body'),
}));
jest.mock('@client/src/pages/DocumentParsingPage/SemanticBilingualReader', () => ({
  SemanticBilingualReader: () => createElement('div', { 'data-bilingual': 'rendered' }, '双语对照已渲染'),
}));
jest.mock('@client/src/pages/DocumentParsingPage/DocumentSourceReadingWorkspace', () => ({
  DocumentSourceReadingWorkspace: (props: { mode: string; onModeChange: (mode: string) => void; bilingualContent: ReactNode }) =>
    createElement('div', { 'data-mode': props.mode },
      createElement('button', { id: 'switch-bilingual', onClick: () => props.onModeChange('bilingual') }, '切中英对照'),
      props.bilingualContent),
}));

const mockStatus = jest.fn();
const mockReading = jest.fn();
const mockTranslation = jest.fn();
const mockSessionCallbacks: Array<() => void> = [];
jest.mock('@client/src/api/canonical-host', () => ({
  readDocumentParsingStatus: (...args: unknown[]) => mockStatus(...args),
  readParsedDocument: (...args: unknown[]) => mockReading(...args),
  readDocumentTranslationReading: (...args: unknown[]) => mockTranslation(...args),
  startDocumentParsing: jest.fn(),
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
    documentVersionId: 'DV1', originalFilename: 'constructed.pdf', runtimeAvailable: true, runtime: { state: 'OK' },
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
    [{ path: '/document-versions/:documentVersionId', element: createElement(DocumentVersionReadingPage) }],
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

it('renders the pinned body before the status read resolves and never requests translation in dual mode', async () => {
  let resolveStatus!: (value: unknown) => void;
  mockStatus.mockImplementation(() => new Promise(resolve => { resolveStatus = resolve; }));
  await mount('parseRunId=PR1');
  expect(mockReading).toHaveBeenCalledTimes(1);
  expect(mockReading).toHaveBeenCalledWith('DV1', 'PR1', expect.anything());
  expect(mockStatus).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('阅读版本 3'); // body painted while status still pending
  expect(container.textContent).toContain('constructed-parser');
  expect(mockTranslation).not.toHaveBeenCalled(); // default dual must not auto-request Chinese
  resolveStatus(statusPayload());
  await act(async () => {});
  expect(container.textContent).toContain('constructed.pdf');
});

it('loads translation only after switching to bilingual mode, once', async () => {
  await mount('parseRunId=PR1');
  expect(mockTranslation).not.toHaveBeenCalled();
  await act(async () => {
    container.querySelector('#switch-bilingual')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });
  expect(mockTranslation).toHaveBeenCalledTimes(1);
  expect(mockTranslation).toHaveBeenCalledWith('DV1', 'PR1', expect.anything());
  expect(container.querySelector('[data-bilingual="rendered"]')).not.toBeNull();
});

it('changing only the external sourceRef anchor does not refetch the body reading', async () => {
  await mount('parseRunId=PR1');
  expect(mockReading).toHaveBeenCalledTimes(1);
  await navigate('/document-versions/DV1?parseRunId=PR1&sourceRef=SR-TEST-P1');
  expect(mockReading).toHaveBeenCalledTimes(1);
  expect(mockStatus).toHaveBeenCalledTimes(1);
});

it('does not poll a pinned run even when the latest run is still running', async () => {
  jest.useFakeTimers();
  try {
    mockStatus.mockResolvedValue({ ...statusPayload(),
      latestRun: { parseRunId: 'PR2', status: 'RUNNING', deadlineAt: '2030-01-01T00:00:00Z' } });
    await mount('parseRunId=PR1');
    expect(mockReading).toHaveBeenCalledTimes(1);
    await act(async () => { jest.advanceTimersByTime(12000); });
    expect(mockStatus).toHaveBeenCalledTimes(1);
    expect(mockReading).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

it('a terminal translation rejection aborts the mounted body load chain and keeps the rejected state visible', async () => {
  const revoked = Object.assign(new Error('中文访问已被撤销'), { statusCode: 403 });
  let resolveStatus!: (value: unknown) => void;
  mockStatus.mockImplementation(() => new Promise(resolve => { resolveStatus = resolve; }));
  mockTranslation.mockRejectedValue(revoked);
  await mount('parseRunId=PR1');
  expect(container.textContent).toContain('阅读版本 3'); // pinned body painted while status pending
  await act(async () => {
    container.querySelector('#switch-bilingual')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('中文访问已被撤销');
  expect(container.textContent).not.toContain('阅读版本 3');
  // The body epoch is aborted: a late status/body resolution must not re-write.
  await act(async () => { resolveStatus(statusPayload()); });
  expect(container.textContent).not.toContain('阅读版本 3');
  expect(container.textContent).not.toContain('constructed.pdf');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('中文访问已被撤销');
  // Explicit retry starts a new epoch: the body reading recovers.
  mockStatus.mockResolvedValue(statusPayload());
  mockTranslation.mockResolvedValue({ documentVersionId: 'DV1', parseRunId: 'PR1',
    execution: { status: 'SUCCEEDED' }, translation: { schemaVersion: 'constructed' } });
  await act(async () => {
    [...container.querySelectorAll('button')].find(item => item.textContent === '刷新')
      ?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });
  expect(container.textContent).toContain('阅读版本 3');
});

it('a 403 rejection aborts the epoch so a late body result cannot re-display over the rejected state', async () => {
  const revoked = Object.assign(new Error('访问已被撤销'), { statusCode: 403 });
  let resolveReading!: (value: unknown) => void;
  mockReading.mockImplementation(() => new Promise(resolve => { resolveReading = resolve; }));
  mockStatus.mockRejectedValue(revoked);
  await mount('parseRunId=PR1');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('访问已被撤销');
  expect(container.textContent).not.toContain('阅读版本 3');
  await act(async () => { resolveReading(readingPayload()); });
  expect(container.textContent).not.toContain('阅读版本 3');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('访问已被撤销');
});
