import { act, createElement, useLayoutEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import DocumentVersionReadingPage from '../../client/src/pages/DocumentParsingPage/DocumentVersionReadingPage';
import DocumentWikiReading from '../../client/src/pages/DocumentParsingPage/DocumentWikiReading';
import type { DocumentParseRunSummary } from '@shared/document-parsing.interface';
import type { DocumentOriginalCoverage } from '@shared/document-original.interface';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';
import { savedDocumentReadingFixture } from './fixtures/saved-document-reading';

const { JSDOM } = require('jsdom');

jest.mock('@client/src/pages/DocumentParsingPage/document-version-reading.css', () => ({}), { virtual: true });
// Saved-panel behavior has its own full consumer/retention suite.
jest.mock('@client/src/pages/DocumentParsingPage/DocumentSavedWorkPanels', () => ({ __esModule: true, default: () => null }));
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
  DocumentSourceReadingWorkspace: (props: { mode: string; onModeChange: (mode: string) => void; bilingualContent: ReactNode; initialPage?: number; initialUnitId?: string; onLocationSelect?: (page: number, unitId: string) => void; returnRoute?: string; returnLabel?: string;
    toolbar?: { identity: ReactNode; links?: ReactNode; more?: ReactNode; notices?: ReactNode }; savedPanels?: ReactNode }) =>
    createElement('div', { 'data-mode': props.mode, 'data-initial-page': props.initialPage, 'data-initial-unit': props.initialUnitId },
      createElement('header', null, props.toolbar?.identity, props.toolbar?.links, props.toolbar?.more,
        props.returnRoute ? createElement('a', { href: props.returnRoute }, props.returnLabel) : null),
      props.toolbar?.notices,
      createElement('button', { id: 'select-original-source', onClick: () => props.onLocationSelect?.(2, 'u2') }, '定位原文段落'),
      createElement('button', { id: 'select-unregistered-page', onClick: () => props.onLocationSelect?.(3, 'u2') }, '未登记页'),
      createElement('button', { id: 'select-unknown-source', onClick: () => props.onLocationSelect?.(2, 'unregistered-unit') }, '未知段落'),
      createElement('button', { id: 'switch-bilingual', onClick: () => props.onModeChange('bilingual') }, '切中英对照'),
      createElement('button', { id: 'switch-translation', onClick: () => props.onModeChange('translation') }, '切中文阅读'),
      createElement('button', { id: 'switch-dual', onClick: () => props.onModeChange('dual') }, '切回原文'),
      props.bilingualContent, props.savedPanels),
}));

const mockStatus = jest.fn();
const mockReading = jest.fn();
const mockTranslation = jest.fn();
const mockStart = jest.fn();
const mockSessionCallbacks: Array<() => void> = [];
const mockWiki=jest.fn();
const mockReadIdentityRefetch = jest.fn(async () => ({ error: null }));
jest.mock('@client/src/features/matter/useEngineeringMatter', () => ({
  useEngineeringMatterQueryIdentity: () => ({
    identity: { appId: 'test-app', tenantId: 'tenant-1', actorId: 'actor-1', sessionGeneration: 1 },
    identityQuery: { isFetching: false, error: null, refetch: mockReadIdentityRefetch },
  }),
}));
jest.mock('@client/src/api/document-wiki',()=>({readDocumentWiki:(...args:unknown[])=>mockWiki(...args)}));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider',()=>({useCurrentUserSession:()=>({sessionGeneration:1,authenticationRequired:false})}));
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration:()=>1,
  getCanonicalLibraryDocuments: async () => ({ items: [{ familyId: 'FAM-1', versions: [
    { documentVersionId: 'DV1', readerWorkItemId: '' }, { documentVersionId: 'DV2', readerWorkItemId: '' },
  ] }], nextCursor: null }),
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
  mockWiki.mockReset();
  mockStatus.mockResolvedValue(statusPayload());
  mockReading.mockResolvedValue(readingPayload());
  mockTranslation.mockResolvedValue({
    documentVersionId: 'DV1', parseRunId: 'PR1',
    execution: { status: 'SUCCEEDED' }, translation: { schemaVersion: 'constructed' },
  });
});

test('Wiki guide source reader exposes its validated return and rejects a different document binding', async () => {
  const guide = new URLSearchParams({ wikiRoot: 'DS-11111111-1111-4111-8111-111111111111',
    wikiChapter: 'DS-22222222-2222-4222-8222-222222222222', wikiQuery: 'software', wikiY: '312' }).toString();
  const query = new URLSearchParams({ parseRunId: 'PR1', returnWikiGuideQuery: guide, returnDocumentVersionId: 'DV1' });
  await mount(query.toString());
  const links = Array.from(container.querySelectorAll<HTMLAnchorElement>('a'))
    .filter(link => link.textContent?.includes('返回 Wiki 导览'));
  expect(links.length).toBeGreaterThan(0);
  const target = new URL(links[0].href);
  expect(target.pathname).toBe('/situation'); expect(target.searchParams.get('wikiY')).toBe('312');
  query.set('returnDocumentVersionId', 'DV-other');
  await navigate(`/document-versions/DV1?${query}`);
  expect(Array.from(container.querySelectorAll('a')).some(link => link.textContent?.includes('返回 Wiki 导览'))).toBe(false);
  expect(mockStart).not.toHaveBeenCalled();
});

test('Wiki member link reads the exact semantic/reading revision and retains full conditions',async()=>{
  const sourceCoverage: DocumentOriginalCoverage = {
    knownPageCount: 2, readPageIndexes: [0],
    unresolvedRanges: [{ pageIndexes: [1], unitIds: [], reason: 'UNREAD',
      message: 'Unseen page retained.', readingImpact: 'LIMITATION' }],
  };
  const coverageBefore = JSON.stringify(sourceCoverage);
  const sourceBinding = { original: originalFixture().binding, semanticRevision: 4 };
  mockWiki.mockResolvedValue({status:'AVAILABLE',sourceBinding,reading:{sourceBinding,readingRunRef:'DRR-1',readingRevision:2,headline:'Saved conditional Wiki',
    brief:{text:'Only after condition X is verified.',quotes:[]},explanation:[{text:'Complete saved explanation; applicability is unconfirmed.',quotes:[]}],
    criticalConditions:[{text:'Do not act before verifying X.',quotes:[]}],limitations:['Selected original has gaps.'],sourceAnchors:[],
    readCoverage:{deliveredUnitIds:['u1'],totalUnitCount:2,status:'PARTIAL_DELIVERY',sourceCoverage}}});
  await mount('parseRunId=PR1&semanticRevision=4&readingRevision=2&readingRunRef=DRR-1');
  expect(mockWiki.mock.calls[0][0]).toEqual({documentVersionId:'DV1',parseRunId:'PR1',semanticRevision:4,readingRevision:2});
  expect(container.textContent).toContain('Complete saved explanation');expect(container.textContent).toContain('Do not act before verifying X.');
  expect(container.textContent).toContain('Unseen page retained.');expect(mockStart).not.toHaveBeenCalled();
  const sourceDetails = container.querySelector('details[aria-label="原文差异与缺项"]')!;
  expect(sourceDetails.hasAttribute('open')).toBe(false);
  expect(sourceDetails.querySelectorAll('li')).toHaveLength(1);
  expect(sourceDetails.textContent).toContain('第 2 页：Unseen page retained.');
  expect(JSON.stringify(sourceCoverage)).toBe(coverageBefore);
});

test('withdrawn exact Wiki stops its body without switching to another revision',async()=>{
  mockWiki.mockResolvedValue({status:'RETRACTED',sourceBinding: { original: originalFixture().binding, semanticRevision: 4 },reading:null});
  await mount('parseRunId=PR1&semanticRevision=4&readingRevision=2&readingRunRef=DRR-1');
  expect(container.textContent).toContain('该文档 Wiki 已撤回');
  expect(mockWiki).toHaveBeenCalledTimes(1);expect(mockStart).not.toHaveBeenCalled();
});

test('changing only the saved Wiki run pin clears the prior body before effects run', async () => {
  const sourceBinding = { original: originalFixture().binding, semanticRevision: 4 };
  mockWiki.mockResolvedValueOnce({ status: 'AVAILABLE', sourceBinding, reading: { sourceBinding,
    readingRunRef: 'DRR-1', readingRevision: 2, headline: 'Previous pinned Wiki body',
    brief: { text: 'Saved engineering explanation.', quotes: [] }, explanation: [],
    criticalConditions: [], limitations: [], sourceAnchors: [],
    readCoverage: { deliveredUnitIds: ['u1'], totalUnitCount: 1, status: 'COMPLETE_DELIVERY',
      sourceCoverage: { unresolvedRanges: [] } },
  } }).mockImplementationOnce(() => new Promise(() => undefined));
  const captures: string[] = [];
  const onAccessRejected = jest.fn(), onLocate = jest.fn();
  function CapturedWiki({ runRef }: { runRef: string }) {
    useLayoutEffect(() => { captures.push(container.textContent ?? ''); }, [runRef]);
    return createElement(DocumentWikiReading, {
      documentVersionId: 'DV1', parseRunId: 'PR1', semanticRevision: 4,
      readingRevision: 2, readingRunRef: runRef, originalBinding: sourceBinding.original, onAccessRejected, onLocate,
    });
  }
  root = createRoot(container);
  await act(async () => { root.render(createElement(CapturedWiki, { runRef: 'DRR-1' })); });
  expect(container.textContent).toContain('Previous pinned Wiki body');
  captures.length = 0;
  await act(async () => { root.render(createElement(CapturedWiki, { runRef: 'DRR-2' })); });
  expect(captures[0]).not.toContain('Previous pinned Wiki body');
  expect(container.textContent).not.toContain('Previous pinned Wiki body');
  expect(mockWiki).toHaveBeenCalledTimes(2);
  expect(mockStart).not.toHaveBeenCalled();
});

test('a temporary DRR refresh failure retains its exact full body; source denial clears it and the original', async () => {
  const reading = savedDocumentReadingFixture('DV1');
  const sourceBinding = { original: originalFixture().binding, semanticRevision: 4 };
  reading.sourceBinding = sourceBinding; reading.readingRevision = 2; reading.readingRunRef = 'DRR-1';
  mockWiki.mockResolvedValueOnce({ status: 'AVAILABLE', sourceBinding, reading })
    .mockRejectedValueOnce(Object.assign(new Error('temporary DRR failure'), { statusCode: 503 }))
    .mockRejectedValueOnce(Object.assign(new Error('source denied'), { statusCode: 403 }));
  await mount('parseRunId=PR1&semanticRevision=4&readingRevision=2&readingRunRef=DRR-1');
  await act(async () => dom.window.dispatchEvent(new dom.window.Event('focus')));
  expect(container.textContent).toContain(reading.explanation[0].text);
  expect(container.querySelector('[aria-label="文档解读"] [role="alert"]')?.textContent).toContain('保留同版正文');
  await act(async () => dom.window.dispatchEvent(new dom.window.Event('focus')));
  expect(container.textContent).not.toContain(reading.explanation[0].text);
  expect(container.querySelector('[data-mode]')).toBeNull();
  expect(mockStart).not.toHaveBeenCalled();
});

test.each(['parseRunId=PR1&readingRevision=2','parseRunId=PR1&semanticRevision=4&semanticRevision=5&readingRevision=2'])
  ('invalid exact Wiki parameters are visible and never select another reading: %s',async query=>{
    await mount(query);expect(container.textContent).toContain('确切版本参数不完整或有重复');expect(mockWiki).not.toHaveBeenCalled();
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
  expect(container.querySelector('.document-reading-toolbar-identity p')?.textContent).toBe('测试服务通告');
  expect(container.querySelector('.document-reading-business-version')?.textContent).toBe('R2');
  expect(container.querySelector('.document-reading-more-panel')?.textContent).toContain('R2 · 库内当前版本');
  expect(container.textContent).toContain('constructed.pdf');
});

it('keeps a published body in loading state until it arrives with document processing collapsed', async () => {
  let resolveStatus!: (value: unknown) => void;
  let resolveReading!: (value: unknown) => void;
  mockStatus.mockImplementationOnce(() => new Promise(resolve => { resolveStatus = resolve; }));
  mockReading.mockImplementationOnce(() => new Promise(resolve => { resolveReading = resolve; }));
  await mount();
  expect(container.textContent).toContain('正在读取文档状态…');
  expect(container.textContent).not.toContain('尚无已发布的解析内容');
  expect(mockReading).not.toHaveBeenCalled();
  await act(async () => { resolveStatus(statusPayload()); });
  expect(container.querySelector('details')?.open).toBe(false);
  expect(mockReading).toHaveBeenCalledWith('DV1', 'PR1', expect.anything());
  expect(container.textContent).toContain('正在读取已发布的解析内容…');
  expect(container.textContent).not.toContain('尚无已发布的解析内容');
  await act(async () => { resolveReading(readingPayload()); });
  expect(container.querySelector('details')?.open).toBe(false);
  expect(container.textContent).toContain('阅读版本 3');
  expect(container.querySelector('[data-mode="dual"]')).not.toBeNull();
  expect(container.textContent).not.toContain('正在读取已发布的解析内容');
});

it('shows an empty state only after status confirms there is no published run', async () => {
  mockStatus.mockResolvedValueOnce({ ...statusPayload(), publishedRun: null, latestRun: null });
  await mount();
  expect(container.textContent).toContain('尚无已发布的解析内容');
  expect(mockReading).not.toHaveBeenCalled();
});

it('replaces the published loading state with a read error when the body request fails', async () => {
  let rejectReading!: (error: Error) => void;
  mockReading.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectReading = reject; }));
  await mount();
  expect(container.textContent).toContain('正在读取已发布的解析内容…');
  await act(async () => { rejectReading(new Error('正文读取失败')); });
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('正文读取失败');
  expect(container.textContent).toContain('内容未能读回，请查看上方错误或刷新重试。');
  expect(container.textContent).not.toContain('尚无已发布的解析内容');
  expect(container.textContent).not.toContain('正在读取已发布的解析内容');
});

it('retains unbound evidence context in the collapsed document information', async () => {
  await mount('parseRunId=PR1&unboundEvidence=1');
  expect(container.querySelector('.document-reading-more-panel')?.textContent).toContain('此保存依据未提供工作项身份');
  expect(container.querySelector('.document-reading-more')?.hasAttribute('open')).toBe(false);
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

async function switchReadingMode(id: 'switch-bilingual' | 'switch-translation' | 'switch-dual'): Promise<void> {
  await act(async () => container.querySelector<HTMLButtonElement>(`#${id}`)!.click());
}

it('translation view group keeps the in-flight response when switching between Chinese layouts', async () => {
  const pending: Array<{ signal: AbortSignal; resolve: (value: unknown) => void }> = [];
  mockTranslation.mockImplementation((_documentId: string, _parseId: string, signal: AbortSignal) =>
    new Promise(resolve => pending.push({ signal, resolve })));
  await mount('parseRunId=PR1');
  await switchReadingMode('switch-bilingual');
  expect(pending).toHaveLength(1);
  await switchReadingMode('switch-translation');
  await switchReadingMode('switch-bilingual');
  expect(pending).toHaveLength(1);
  expect(pending[0].signal.aborted).toBe(false);
  await act(async () => pending[0].resolve({
    documentVersionId: 'DV1', parseRunId: 'PR1', execution: { status: 'SUCCEEDED' },
    translation: { schemaVersion: 'constructed' },
  }));
  expect(container.querySelector('[data-bilingual="rendered"]')).not.toBeNull();
  expect(mockStart).not.toHaveBeenCalled();
});

it('translation view group reuses the saved response but performs a fresh read after returning from original mode', async () => {
  await mount('parseRunId=PR1');
  await switchReadingMode('switch-bilingual');
  await switchReadingMode('switch-translation');
  expect(container.querySelector('[data-reading-mode="translation"]')).not.toBeNull();
  await switchReadingMode('switch-bilingual');
  expect(mockTranslation).toHaveBeenCalledTimes(1);
  await switchReadingMode('switch-dual');
  expect(container.querySelector('[data-bilingual="rendered"]')).toBeNull();
  await switchReadingMode('switch-translation');
  expect(mockTranslation).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[data-reading-mode="translation"]')).not.toBeNull();
  expect(mockStart).not.toHaveBeenCalled();
});

it('translation view group preserves its existing polling deadline instead of restarting the read', async () => {
  jest.useFakeTimers();
  try {
    mockTranslation.mockResolvedValue({
      documentVersionId: 'DV1', parseRunId: 'PR1', execution: { status: 'RUNNING' },
      translation: { schemaVersion: 'constructed' },
    });
    await mount('parseRunId=PR1');
    await switchReadingMode('switch-bilingual');
    await act(async () => { jest.advanceTimersByTime(4000); });
    await switchReadingMode('switch-translation');
    expect(mockTranslation).toHaveBeenCalledTimes(1);
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(mockTranslation).toHaveBeenCalledTimes(2);
    expect(mockStart).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});

it.each([401, 403, 404])('translation view group still rejects both bodies on a continued request returning %s', async statusCode => {
  const pending: Array<{ reject: (reason: Error) => void }> = [];
  mockTranslation.mockImplementation(() => new Promise((_resolve, reject) => pending.push({ reject })));
  let resolveStatus!: (value: unknown) => void;
  mockStatus.mockImplementation(() => new Promise(resolve => { resolveStatus = resolve; }));
  await mount('parseRunId=PR1');
  await switchReadingMode('switch-bilingual');
  await switchReadingMode('switch-translation');
  await act(async () => pending[0].reject(Object.assign(new Error('中文读取拒绝'), { statusCode })));
  expect(container.textContent).not.toContain('阅读版本 3');
  expect(container.querySelector('[data-bilingual="rendered"]')).toBeNull();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('中文读取拒绝');
  await act(async () => resolveStatus(statusPayload()));
  expect(container.textContent).not.toContain('阅读版本 3');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('中文读取拒绝');
  expect(mockStart).not.toHaveBeenCalled();
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


it('an explicit failed-parse retry keeps one predecessor request after a lost response', async () => {
  const predecessor = 'PRUN-00000000-0000-0000-0000-000000000015';
  mockStatus.mockResolvedValue({ ...statusPayload(), latestRun: {
    parseRunId: predecessor, status: 'FAILED', deadlineAt: '2000-01-01T00:00:00Z',
    errorCode: 'HOSTED_MODEL_QUOTA_EXHAUSTED',
  } });
  mockStart.mockRejectedValueOnce(new Error('响应丢失')).mockResolvedValueOnce({});
  await mount();
  expect(mockStart).not.toHaveBeenCalled(); // Displaying an error is never automatic retry authorization.
  await act(async () => {
    [...container.querySelectorAll('button')].find(item => item.textContent === '重新解析')?.click();
  });
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('响应丢失');
  await act(async () => {
    [...container.querySelectorAll('button')].find(item => item.textContent === '核对解析请求')?.click();
  });
  expect(mockStart).toHaveBeenCalledTimes(2);
  expect(mockStart.mock.calls[0]).toEqual(['DV1', {
    requestId: `parse-resume-${predecessor}`, expectedPublishedRevision: 3,
  }]);
  expect(mockStart.mock.calls[1]).toEqual(mockStart.mock.calls[0]);
  expect(container.textContent).toContain('constructed');
});


it('shows a persisted quota pause instead of progress and stops status polling while retaining saved reading', async () => {
  jest.useFakeTimers();
  try {
    mockStatus.mockResolvedValue({ ...statusPayload(), latestRun: {
      parseRunId: 'PRUN-00000000-0000-0000-0000-000000000016', status: 'STAGING',
      deadlineAt: '2030-01-01T00:00:00Z', errorCode: 'DOCUMENT_PLUGIN_QUOTA_EXHAUSTED', verifiedArtifacts: 0,
    } });
    await mount();
    expect(container.textContent).toContain('文档解析服务额度已用尽。');
    expect(container.textContent).not.toContain('正在保存并核验产物');
    expect(container.textContent).not.toContain('正在解析原件');
    expect(container.textContent).toContain('constructed');
    const button = [...container.querySelectorAll('button')].find(item => item.textContent === '等待接续');
    expect(button?.disabled).toBe(true);
    expect(container.querySelector('details')?.textContent).toContain('DOCUMENT_PLUGIN_QUOTA_EXHAUSTED');
    await act(async () => { jest.advanceTimersByTime(15000); });
    expect(mockStatus).toHaveBeenCalledTimes(1);
    expect(mockReading).toHaveBeenCalledTimes(1);
    expect(mockStart).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});

it('shows waiting for the local parser without implying saved or running work', async () => {
  mockStatus.mockResolvedValue({ ...statusPayload(), latestRun: {
    parseRunId: 'PRUN-00000000-0000-0000-0000-000000000017', status: 'RUNNING',
    deadlineAt: '2030-01-01T00:00:00Z', errorCode: null, verifiedArtifacts: 0,
    executionMode: 'LOCAL_MINERU_WORKER', waitingForLocalWorker: true,
  } });
  await mount();
  expect(container.textContent).toContain('等待本机解析器接续。');
  expect(container.textContent).not.toContain('正在保存并核验产物');
  expect(container.textContent).not.toContain('正在解析原件');
  expect(container.textContent).toContain('constructed');
  const button = [...container.querySelectorAll('button')].find(item => item.textContent === '等待本机解析');
  expect(button?.disabled).toBe(true);
  expect(mockStart).not.toHaveBeenCalled();
});


it.each(['FAILED', 'STAGING'])('explicit current-settings restart creates a stable new request for %s and keeps saved reading', async status => {
  mockStatus.mockResolvedValue({ ...statusPayload(), latestRun: {
    parseRunId: 'PRUN-00000000-0000-0000-0000-000000000018', status,
    deadlineAt: '2000-01-01T00:00:00Z', errorCode: 'DOCUMENT_PLUGIN_QUOTA_EXHAUSTED',
  } });
  mockStart.mockRejectedValueOnce(new Error('响应丢失')).mockResolvedValueOnce({});
  await mount();
  const restart = [...container.querySelectorAll('button')].find(item => item.textContent === '按当前设置重新解析');
  expect(restart?.closest('details')).not.toBeNull();
  expect(mockStart).not.toHaveBeenCalled();
  await act(async () => restart?.click());
  const first = mockStart.mock.calls[0];
  expect(first).toEqual(['DV1', { requestId: expect.stringMatching(/^parse-[a-f0-9-]+$/), expectedPublishedRevision: 3 }]);
  expect(first[1].requestId).not.toMatch(/^parse-resume-/);
  expect([...container.querySelectorAll('button')].find(item => item.textContent === '重新解析')?.disabled).toBe(true);
  await act(async () => [...container.querySelectorAll('button')].find(item => item.textContent === '核对当前设置请求')?.click());
  expect(mockStart.mock.calls[1]).toEqual(first);
  expect(container.textContent).toContain('constructed');
});

it('hides current-settings restart for published or still-active runs', async () => {
  await mount();
  expect(container.textContent).not.toContain('按当前设置重新解析');
  mockStatus.mockResolvedValue({ ...statusPayload(), latestRun: { parseRunId: 'ACTIVE', status: 'STAGING', deadlineAt: '2030-01-01T00:00:00Z' } });
  await act(async () => [...container.querySelectorAll('button')].find(item => item.textContent === '刷新')?.click());
  expect(container.textContent).not.toContain('按当前设置重新解析');
});

it('clears the pending current-settings request on session change and ignores its late rejection', async () => {
  mockStatus.mockResolvedValue({ ...statusPayload(), latestRun: { parseRunId: 'FAILED', status: 'FAILED', deadlineAt: '2000-01-01T00:00:00Z' } });
  let rejectStart!: (error: Error) => void;
  mockStart.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectStart = reject; }));
  await mount();
  await act(async () => [...container.querySelectorAll('button')].find(item => item.textContent === '按当前设置重新解析')?.click());
  const oldRequest = mockStart.mock.calls[0][1].requestId;
  await act(async () => mockSessionCallbacks[0]!());
  await act(async () => rejectStart(new Error('OLD_SESSION_RESPONSE')));
  expect(container.textContent).not.toContain('OLD_SESSION_RESPONSE');
  const restart = [...container.querySelectorAll('button')].find(item => item.textContent === '按当前设置重新解析');
  expect(restart?.disabled).toBe(false);
  await act(async () => restart?.click());
  expect(mockStart.mock.calls[1][1].requestId).not.toBe(oldRequest);
});

const importPredecessor = 'PRUN-00000000-0000-0000-0000-000000000021';
const importSuccessor = 'PRUN-00000000-0000-0000-0000-000000000022';
function importReceipt(changes: Partial<DocumentParseRunSummary> = {}): DocumentParseRunSummary {
  return {
    documentVersionId: 'DV1', parseRunId: importSuccessor, parseRevision: 7,
    executionMode: 'LOCAL_MINERU_IMPORT', waitingForLocalWorker: false,
    status: 'STAGING', verifiedArtifacts: 1, errorCode: null,
    startedAt: '2026-10-12T07:00:00Z', deadlineAt: '2030-01-01T00:00:00Z', completedAt: null,
    ...changes,
  };
}
function importStatus(run: DocumentParseRunSummary) {
  return { ...statusPayload(), documentVersionId: run.documentVersionId, latestRun: run,
    publishedRun: run.status === 'PUBLISHED' ? run : null };
}
function expiredImportStatus() {
  return importStatus(importReceipt({ parseRunId: importPredecessor, parseRevision: 6,
    verifiedArtifacts: 9, deadlineAt: '2000-01-01T00:00:00Z' }));
}
async function clickParseButton(label: string) {
  await act(async () => {
    const button = [...container.querySelectorAll('button')].find(item => item.textContent === label);
    expect(button).toBeDefined(); button!.click();
  });
}

it('continues a recovered import one visible step at a time with the exact recovery request and no upload', async () => {
  mockStatus.mockResolvedValue(expiredImportStatus());
  for (const receipt of [importReceipt(), importReceipt({ verifiedArtifacts: 2 }),
    importReceipt({ status: 'PUBLISHED', verifiedArtifacts: 24, completedAt: '2026-10-12T07:10:00Z' })]) {
    mockStart.mockImplementationOnce(async () => { mockStatus.mockResolvedValue(importStatus(receipt)); return receipt; });
  }
  mockReading.mockResolvedValue({ ...readingPayload(), parseRunId: importSuccessor, parseRevision: 7 });
  await mount();
  await clickParseButton('解析文档');
  expect(container.textContent).toContain('导入版本 7 的本次回执：已核验 1 个文件。');
  expect(container.textContent).toContain('执行期限：2030-01-01T00:00:00Z');
  expect(container.textContent).not.toContain('导入本机 MinerU 解析');
  expect(mockStart).toHaveBeenCalledTimes(1);
  await clickParseButton('核对同一导入请求（继续一步）');
  expect(container.textContent).toContain('导入版本 7 的本次回执：已核验 2 个文件。');
  await clickParseButton('核对同一导入请求（继续一步）');
  expect(mockStart).toHaveBeenCalledTimes(3);
  for (const call of mockStart.mock.calls) expect(call).toEqual(['DV1', {
    requestId: `parse-resume-${importPredecessor}`, expectedPublishedRevision: 0,
  }]);
  expect(jest.requireMock('@client/src/components/business-ui/api/files/service').uploadFile).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain('核对同一导入请求（继续一步）');
  expect(container.textContent).toContain('已核验 24 个文件。已发布。');
  expect(mockReading).toHaveBeenLastCalledWith('DV1', importSuccessor, expect.anything());
});

it('keeps an unknown recovery outcome checkable after a fresh status read observes a busy import', async () => {
  mockStatus.mockResolvedValue(expiredImportStatus());
  mockStart.mockImplementationOnce(async () => {
    mockStatus.mockResolvedValue(importStatus(importReceipt())); throw new Error('响应丢失');
  }).mockResolvedValueOnce(importReceipt({ verifiedArtifacts: 2 }));
  await mount(); await clickParseButton('解析文档');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('响应丢失');
  expect(mockStart).toHaveBeenCalledTimes(1);
  await clickParseButton('刷新');
  const check = [...container.querySelectorAll('button')].find(item => item.textContent === '核对解析请求');
  expect(check?.disabled).toBe(false);
  await clickParseButton('核对解析请求');
  expect(mockStart.mock.calls[1]).toEqual(mockStart.mock.calls[0]);
  expect(mockStart.mock.calls[1][1].requestId).toBe(`parse-resume-${importPredecessor}`);
  expect(container.textContent).toContain('核对同一导入请求（继续一步）');
});

it('prevents two synchronous clicks from submitting overlapping admission or continuation steps', async () => {
  mockStatus.mockResolvedValue(expiredImportStatus());
  let resolveStart!: (value: DocumentParseRunSummary) => void;
  mockStart.mockImplementationOnce(() => new Promise(resolve => { resolveStart = resolve; }));
  await mount();
  await act(async () => {
    const button = [...container.querySelectorAll('button')].find(item => item.textContent === '解析文档')!;
    button.click(); button.click();
  });
  expect(mockStart).toHaveBeenCalledTimes(1);
  expect([...container.querySelectorAll('button')].find(item => item.textContent === '正在受理…')?.disabled).toBe(true);
  mockStatus.mockResolvedValue(importStatus(importReceipt()));
  await act(async () => resolveStart(importReceipt()));
  mockStart.mockResolvedValueOnce(importReceipt({ verifiedArtifacts: 2 }));
  await act(async () => {
    const button = [...container.querySelectorAll('button')].find(item => item.textContent === '核对同一导入请求（继续一步）')!;
    button.click(); button.click();
  });
  expect(mockStart).toHaveBeenCalledTimes(2);
  expect(mockStart.mock.calls[1]).toEqual(mockStart.mock.calls[0]);
});

it.each(['session', 'document'])('discards a pending import recovery on %s change and ignores its late response', async change => {
  mockStatus.mockResolvedValue(expiredImportStatus());
  let resolveStart!: (value: DocumentParseRunSummary) => void;
  mockStart.mockImplementationOnce(() => new Promise(resolve => { resolveStart = resolve; }));
  await mount(); await clickParseButton('解析文档');
  mockStatus.mockResolvedValue(importStatus(importReceipt({ documentVersionId: change === 'document' ? 'DV2' : 'DV1' })));
  if (change === 'session') await act(async () => mockSessionCallbacks[0]!());
  else await navigate('/document-versions/DV2');
  await act(async () => resolveStart(importReceipt()));
  expect(container.textContent).not.toContain('核对同一导入请求（继续一步）');
  expect(container.textContent).not.toContain('导入版本 7 的本次回执');
  expect([...container.querySelectorAll('button')].find(item => item.textContent === '正在解析…')?.disabled).toBe(true);
  expect(mockStart).toHaveBeenCalledTimes(1);
});

it('keeps the admitted CAS on a later check and exposes a revision conflict without creating a different request', async () => {
  mockStatus.mockResolvedValue(expiredImportStatus());
  mockStart.mockImplementationOnce(async () => { mockStatus.mockResolvedValue(importStatus(importReceipt())); return importReceipt(); });
  await mount(); await clickParseButton('解析文档');
  mockStatus.mockResolvedValue({ ...importStatus(importReceipt()), publishedRun: { parseRunId: 'OTHER-PUBLISHED', parseRevision: 1 } });
  mockReading.mockResolvedValue({ ...readingPayload(), parseRunId: 'OTHER-PUBLISHED' });
  await clickParseButton('刷新');
  mockStart.mockRejectedValueOnce(Object.assign(new Error('已发布版本发生变化，请刷新核对。'), { code: 'DOCUMENT_PARSE_REVISION_CONFLICT' }));
  await clickParseButton('核对同一导入请求（继续一步）');
  expect(mockStart.mock.calls[1]).toEqual(mockStart.mock.calls[0]);
  expect(mockStart.mock.calls[1][1].expectedPublishedRevision).toBe(0);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('已发布版本发生变化');
  expect(container.textContent).not.toContain('核对同一导入请求（继续一步）');
  expect(mockStart).toHaveBeenCalledTimes(2);
});

it('rejects a continuation response for a different run while preserving the original request for readback', async () => {
  mockStatus.mockResolvedValue(expiredImportStatus());
  mockStart.mockImplementationOnce(async () => { mockStatus.mockResolvedValue(importStatus(importReceipt())); return importReceipt(); })
    .mockResolvedValueOnce(importReceipt({ parseRunId: 'PRUN-00000000-0000-0000-0000-000000000023', parseRevision: 8 }));
  await mount(); await clickParseButton('解析文档');
  await clickParseButton('核对同一导入请求（继续一步）');
  expect(mockStart.mock.calls[1]).toEqual(mockStart.mock.calls[0]);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('接续结果与原导入版本不一致');
  expect(container.textContent).toContain('导入版本 7 的本次回执');
  expect(container.textContent).not.toContain('导入版本 8 的本次回执');
  expect([...container.querySelectorAll('button')].find(item => item.textContent === '核对同一导入请求（继续一步）')?.disabled).toBe(false);
});

it('does not turn a hosted local worker recovery into an explicit import continuation', async () => {
  mockStatus.mockResolvedValue(importStatus(importReceipt({ parseRunId: importPredecessor, parseRevision: 6,
    executionMode: 'LOCAL_MINERU_WORKER', waitingForLocalWorker: true, deadlineAt: '2000-01-01T00:00:00Z' })));
  const worker = importReceipt({ executionMode: 'LOCAL_MINERU_WORKER', waitingForLocalWorker: true });
  mockStart.mockImplementationOnce(async () => { mockStatus.mockResolvedValue(importStatus(worker)); return worker; });
  await mount(); await clickParseButton('解析文档');
  expect(container.textContent).not.toContain('核对同一导入请求（继续一步）');
  expect([...container.querySelectorAll('button')].find(item => item.textContent === '等待本机解析')?.disabled).toBe(true);
  expect(mockStart).toHaveBeenCalledTimes(1);
});

it.each(['FAILED', 'EXPIRED'])('shows an import %s receipt without inviting another step on the expired request', async terminal => {
  mockStatus.mockResolvedValue(expiredImportStatus());
  const result = terminal === 'FAILED' ? importReceipt({ status: 'FAILED', errorCode: 'DOCUMENT_PARSE_DEADLINE_EXCEEDED' })
    : importReceipt({ deadlineAt: '2000-01-01T00:00:00Z' });
  mockStart.mockImplementationOnce(async () => { mockStatus.mockResolvedValue(importStatus(result)); return result; });
  await mount(); await clickParseButton('解析文档');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(terminal === 'FAILED' ? 'DOCUMENT_PARSE_DEADLINE_EXCEEDED' : '执行期限已过');
  expect(container.textContent).not.toContain('核对同一导入请求（继续一步）');
  expect(mockStart).toHaveBeenCalledTimes(1);
});

it('uses polling only for readback and never advances an accepted import automatically', async () => {
  jest.useFakeTimers();
  try {
    mockStatus.mockResolvedValue(expiredImportStatus());
    mockStart.mockImplementationOnce(async () => { mockStatus.mockResolvedValue(importStatus(importReceipt())); return importReceipt(); });
    await mount(); await clickParseButton('解析文档');
    await act(async () => { jest.advanceTimersByTime(15000); });
    expect(mockStatus.mock.calls.length).toBeGreaterThan(2);
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect([...container.querySelectorAll('button')].find(item => item.textContent === '核对同一导入请求（继续一步）')?.disabled).toBe(false);
  } finally { jest.useRealTimers(); }
});

it('keeps a lost step outcome visible across status polling and checks the same request explicitly', async () => {
  jest.useFakeTimers();
  try {
    mockStatus.mockResolvedValue(expiredImportStatus());
    mockStart.mockImplementationOnce(async () => { mockStatus.mockResolvedValue(importStatus(importReceipt())); return importReceipt(); })
      .mockRejectedValueOnce(new Error('接续响应丢失，请核对原请求。'))
      .mockResolvedValueOnce(importReceipt({ verifiedArtifacts: 2 }));
    await mount(); await clickParseButton('解析文档');
    await clickParseButton('核对同一导入请求（继续一步）');
    await act(async () => { jest.advanceTimersByTime(15000); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('接续响应丢失');
    expect(mockStart).toHaveBeenCalledTimes(2);
    await clickParseButton('核对同一导入请求（继续一步）');
    expect(mockStart).toHaveBeenCalledTimes(3);
    expect(mockStart.mock.calls[2]).toEqual(mockStart.mock.calls[0]);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  } finally { jest.useRealTimers(); }
});

it.each(['status', 'translation'])('invalidates an in-flight import recovery after a concurrent %s access rejection', async rejectedRead => {
  mockStatus.mockResolvedValue(rejectedRead === 'translation' ? { ...expiredImportStatus(), publishedRun: { parseRunId: 'PR1', parseRevision: 3 } }
    : expiredImportStatus());
  let resolveStart!: (value: DocumentParseRunSummary) => void;
  mockStart.mockImplementationOnce(() => new Promise(resolve => { resolveStart = resolve; }));
  await mount(); await clickParseButton(rejectedRead === 'translation' ? '重新解析' : '解析文档');
  const denied = Object.assign(new Error('导入接续权限已撤销'), { statusCode: 403 });
  if (rejectedRead === 'status') {
    mockStatus.mockRejectedValueOnce(denied); await clickParseButton('刷新');
  } else {
    mockTranslation.mockRejectedValueOnce(denied);
    await act(async () => container.querySelector<HTMLButtonElement>('#switch-bilingual')!.click());
  }
  const reads = mockStatus.mock.calls.length;
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('导入接续权限已撤销');
  await act(async () => resolveStart(importReceipt()));
  expect(mockStatus).toHaveBeenCalledTimes(reads);
  expect(container.textContent).not.toContain('导入版本 7 的本次回执');
  expect(container.textContent).not.toContain('核对同一导入请求（继续一步）');
  expect(container.textContent).not.toContain('constructed');
  mockStatus.mockResolvedValue(importStatus(importReceipt()));
  await clickParseButton('刷新');
  expect([...container.querySelectorAll('button')].find(item => item.textContent === '正在解析…')?.disabled).toBe(true);
  expect(mockStart).toHaveBeenCalledTimes(1);
});

it('clears the admitted continuation and saved reading when its explicit POST is denied', async () => {
  mockStatus.mockResolvedValue({ ...expiredImportStatus(), publishedRun: { parseRunId: 'PR1', parseRevision: 3 } });
  mockStart.mockImplementationOnce(async () => {
    mockStatus.mockResolvedValue({ ...importStatus(importReceipt()), publishedRun: { parseRunId: 'PR1', parseRevision: 3 } });
    return importReceipt();
  }).mockRejectedValueOnce(Object.assign(new Error('候选读取权限已撤销'), { statusCode: 403 }));
  await mount(); await clickParseButton('重新解析');
  expect(container.textContent).toContain('constructed');
  await clickParseButton('核对同一导入请求（继续一步）');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('候选读取权限已撤销');
  expect(container.textContent).not.toContain('constructed');
  expect(container.textContent).not.toContain('导入版本 7 的本次回执');
  expect(container.textContent).not.toContain('核对解析请求');
  expect(mockStart.mock.calls[1]).toEqual(mockStart.mock.calls[0]);
  expect(mockStart).toHaveBeenCalledTimes(2);
});
