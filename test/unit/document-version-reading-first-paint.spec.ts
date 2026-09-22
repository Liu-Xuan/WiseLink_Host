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
  expect(container.querySelector('h1')?.textContent).toBe('SB-TEST-001');
  expect(container.textContent).toContain('测试服务通告 · R2 · 库内当前版本');
  expect(container.textContent).toContain('constructed.pdf');
});

it('explains when direct evidence has no task-bound paragraph location', async () => {
  await mount('parseRunId=PR1&unboundEvidence=1');
  expect(container.textContent).toContain('没有工作项执行身份');
  expect(container.textContent).toContain('未猜测任务或具体段落位置');
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

it('loads the same saved translation on demand in Chinese reading mode', async () => {
  await mount('parseRunId=PR1');
  expect(mockTranslation).not.toHaveBeenCalled();
  await act(async () => {
    container.querySelector('#switch-translation')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });
  expect(mockTranslation).toHaveBeenCalledTimes(1);
  expect(mockTranslation).toHaveBeenCalledWith('DV1', 'PR1', expect.anything());
  expect(container.querySelector('[data-reading-mode="translation"]')).not.toBeNull();
});

it('changing only the external sourceRef anchor does not refetch the body reading', async () => {
  await mount('parseRunId=PR1');
  expect(mockReading).toHaveBeenCalledTimes(1);
  await navigate('/document-versions/DV1?parseRunId=PR1&sourceRef=SR-TEST-P1');
  expect(mockReading).toHaveBeenCalledTimes(1);
  expect(mockStatus).toHaveBeenCalledTimes(1);
});

it('lets a later in-page translation source override the URL source until navigation changes it', async () => {
  await mount('parseRunId=PR1&sourceRef=SR-TEST-P1');
  expect(container.querySelector('[data-initial-page="1"]')).not.toBeNull();
  await act(async () => {
    container.querySelector('#switch-bilingual')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });
  await act(async () => {
    container.querySelector('#select-translation-source')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });
  expect(container.querySelector('[data-initial-unit="translation-unit"]')).not.toBeNull();
  expect(container.querySelector('[data-initial-page="1"]')).toBeNull();
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

it('rechecks a busy latest run without rereading an unchanged published body', async () => {
  jest.useFakeTimers();
  try {
    mockStatus.mockResolvedValue({ ...statusPayload(), latestRun: { parseRunId: 'PR2', status: 'RUNNING', deadlineAt: '2030-01-01T00:00:00Z' } });
    await mount();
    expect(mockStatus).toHaveBeenCalledTimes(1);
    expect(mockReading).toHaveBeenCalledTimes(1);
    await act(async () => { jest.advanceTimersByTime(5000); await Promise.resolve(); });
    expect(mockStatus).toHaveBeenCalledTimes(2);
    expect(mockReading).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('constructed');
  } finally { jest.useRealTimers(); }
});

it('reads a newly published run once after polling observes the new run', async () => {
  jest.useFakeTimers();
  try {
    mockStatus.mockResolvedValueOnce({ ...statusPayload(), latestRun: { parseRunId: 'PR2', status: 'RUNNING', deadlineAt: '2030-01-01T00:00:00Z' } })
      .mockResolvedValueOnce({ ...statusPayload(), publishedRun: { parseRunId: 'PR2', parseRevision: 4 }, latestRun: { parseRunId: 'PR2', status: 'PUBLISHED', deadlineAt: '2030-01-01T00:00:00Z' } });
    mockReading.mockResolvedValueOnce(readingPayload()).mockResolvedValueOnce({ ...readingPayload(), parseRunId: 'PR2', parseRevision: 4, markdown: 'new run' });
    await mount();
    await act(async () => { jest.advanceTimersByTime(5000); await Promise.resolve(); await Promise.resolve(); });
    expect(mockStatus).toHaveBeenCalledTimes(2);
    expect(mockReading).toHaveBeenCalledTimes(2);
    expect(mockReading).toHaveBeenLastCalledWith('DV1', 'PR2', expect.anything());
  } finally { jest.useRealTimers(); }
});

it('explicit refresh rereads the same published run', async () => {
  await mount();
  expect(mockReading).toHaveBeenCalledTimes(1);
  await act(async () => {
    [...container.querySelectorAll('button')].find(item => item.textContent === '刷新')
      ?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
  expect(mockReading).toHaveBeenCalledTimes(2);
});

it('restarts the same run after a session event and ignores the prior epoch', async () => {
  let resolveSecond!: (value: unknown) => void;
  mockReading.mockResolvedValueOnce(readingPayload()).mockImplementationOnce(() => new Promise(resolve => { resolveSecond = resolve; }));
  await mount();
  expect(mockReading).toHaveBeenCalledTimes(1);
  await act(async () => { mockSessionCallbacks[0]?.(); await Promise.resolve(); });
  expect(mockReading).toHaveBeenCalledTimes(2);
  await act(async () => { resolveSecond({ ...readingPayload(), original: null, markdown: 'session refreshed' }); });
  expect(container.textContent).toContain('session refreshed');
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

it('independent P1: late old-session body cannot overwrite the same-run new session body', async () => {
  let resolveOld!: (value: unknown) => void;
  mockReading.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
    .mockResolvedValueOnce({ ...readingPayload(), original: null, markdown: 'NEW-SESSION-BODY' });
  await mount();
  await act(async () => { mockSessionCallbacks[0]?.(); });
  expect(mockReading).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain('NEW-SESSION-BODY');
  await act(async () => { resolveOld({ ...readingPayload(), original: null, markdown: 'OLD-SESSION-BODY' }); });
  expect(container.textContent).toContain('NEW-SESSION-BODY');
  expect(container.textContent).not.toContain('OLD-SESSION-BODY');
});

it('independent P1: a status poll 403 clears an already loaded unpinned body and stops polling', async () => {
  jest.useFakeTimers();
  try {
    mockStatus.mockResolvedValueOnce({ ...statusPayload(), latestRun: { parseRunId: 'PR2', status: 'RUNNING', deadlineAt: '2030-01-01T00:00:00Z' } })
      .mockRejectedValue(Object.assign(new Error('POLL-REVOKED'), { statusCode: 403 }));
    mockReading.mockResolvedValue({ ...readingPayload(), original: null, markdown: 'PROTECTED-BODY' });
    await mount();
    expect(container.textContent).toContain('PROTECTED-BODY');
    await act(async () => { jest.advanceTimersByTime(5000); });
    expect(container.textContent).not.toContain('PROTECTED-BODY');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('POLL-REVOKED');
    await act(async () => { jest.advanceTimersByTime(10000); });
    expect(mockStatus).toHaveBeenCalledTimes(2);
    expect(mockReading).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});

it('persists a selected registered paragraph across actual route unmount and history return', async () => {
  await mount('parseRunId=PR1&sourceRef=SR-TEST-P1&returnLibraryQuery=mode%3Ddocument&returnDocumentVersionId=DV1');
  await act(async () => container.querySelector<HTMLButtonElement>('#select-original-source')!.click());
  const state = new URLSearchParams(router.state.location.search);
  expect(state.get('sourceRef')).toBe('SR-TEST-P2');
  expect(state.get('parseRunId')).toBe('PR1');
  expect(state.get('returnLibraryQuery')).toBe('mode=document');
  expect(mockReading).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[data-initial-page="2"]')).not.toBeNull();
  await navigate('/library');
  mockStatus.mockResolvedValue({ ...statusPayload(), publishedRun: { parseRunId: 'PR-NEW', parseRevision: 4 } });
  await act(async () => { await router.navigate(-1); });
  expect(container.querySelector('[data-initial-page="2"]')).not.toBeNull();
  expect(container.querySelector('[data-initial-unit="u2"]')).not.toBeNull();
  expect(mockReading).toHaveBeenCalledTimes(2); // fresh authorized read on real remount
  expect(mockReading).toHaveBeenLastCalledWith('DV1', 'PR1', expect.anything());
});
it('pins an unpinned reader to the saved parse when recording a location and ignores unknown units', async () => {
  await mount();
  await act(async () => container.querySelector<HTMLButtonElement>('#select-unknown-source')!.click());
  expect(router.state.location.search).toBe('');
  await act(async () => container.querySelector<HTMLButtonElement>('#select-original-source')!.click());
  const state = new URLSearchParams(router.state.location.search);
  expect(state.get('parseRunId')).toBe('PR1');
  expect(state.get('sourceRef')).toBe('SR-TEST-P2');
});

it('records the selected registered page of a multi-page unit and rejects an unregistered page', async () => {
  const reading = readingPayload();
  reading.original.source.units[1].sourceRefIds = ['SR-TEST-P1', 'SR-TEST-P2'];
  mockReading.mockResolvedValue(reading);
  await mount('parseRunId=PR1');
  await act(async () => container.querySelector<HTMLButtonElement>('#select-unregistered-page')!.click());
  expect(new URLSearchParams(router.state.location.search).has('sourceRef')).toBe(false);
  await act(async () => container.querySelector<HTMLButtonElement>('#select-original-source')!.click());
  expect(new URLSearchParams(router.state.location.search).get('sourceRef')).toBe('SR-TEST-P2');
  expect(mockReading).toHaveBeenCalledTimes(1);
});
