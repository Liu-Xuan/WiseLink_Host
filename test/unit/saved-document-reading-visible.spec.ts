import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import type { DocumentReadingResponse } from '@shared/document-reading.interface';
import type { CanonicalLibraryDocumentVersionSummary } from '@shared/api.interface';
import SavedDocumentReadingArticle from '@client/src/pages/KnowledgeLookupPage/SavedDocumentReadingArticle';
import { libraryFamily } from './fixtures/canonical-library';
import { savedDocumentReadingFixture, savedDocumentReadingPreview } from './fixtures/saved-document-reading';

const mockRead = jest.fn();
jest.mock('@client/src/api/canonical-host', () => ({ readSavedDocumentReading: (...args: unknown[]) => mockRead(...args) }));

let dom: JSDOM;
let root: Root;
let container: HTMLElement;
const oldGlobals = new Map<string, PropertyDescriptor | undefined>();
const openSource = jest.fn();
function fixture() {
  const version = libraryFamily('test').versions[0];
  const reading = savedDocumentReadingFixture(version.documentVersionId);
  version.documentReading = { status: 'SOURCE_CHANGED', reading: savedDocumentReadingPreview(reading) };
  version.parsing = { status: 'PUBLISHED', parseRunId: 'parse-2', latestRevision: 2, publishedRevision: 2 } as never;
  return { version, reading, response: { familyId: 'family-test', sourceBinding: reading.sourceBinding,
    status: 'AVAILABLE', reading } as DocumentReadingResponse };
}
async function render(version: CanonicalLibraryDocumentVersionSummary) {
  await act(async () => { root.render(createElement(SavedDocumentReadingArticle, { version, onOpenSource: openSource })); });
}
beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>');
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    oldGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  container = dom.window.document.getElementById('root')!; root = createRoot(container);
  mockRead.mockReset(); openSource.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount()); dom.window.close();
  for (const [key, descriptor] of oldGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
  oldGlobals.clear();
});

it('shows saved parse-1 explanation after parse-2 publication and opens exact old evidence', async () => {
  const f = fixture(); const before = JSON.stringify(f);
  mockRead.mockResolvedValue(f.response); await render(f.version);
  expect(mockRead).toHaveBeenCalledWith({ documentVersionId: f.version.documentVersionId,
    parseRunId: 'parse-1', semanticRevision: 1, readingRevision: 1 }, expect.any(AbortSignal));
  for (const text of ['已保存的详细解释。', '仅适用于构型 A。', '构型 B 尚无执行记录。', '第二页图示含义尚未确认。'])
    expect(container.textContent).toContain(text);
  expect(container.textContent).not.toContain('diagnostic-only');
  expect(container.textContent).not.toMatch(/来源已变化|不代表|不能代替/);
  const evidence = [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.includes('Check configuration.'))!;
  await act(async () => evidence.click());
  const route = new URL(openSource.mock.calls[0][0], 'https://example.test');
  expect(route.pathname).toBe(`/document-versions/${f.version.documentVersionId}`);
  expect(route.searchParams.get('parseRunId')).toBe('parse-1');
  expect(route.searchParams.get('sourceRef')).toBe('source-ref-parse-1');
  expect(container.querySelector('details:last-child')?.hasAttribute('open')).toBe(false);
  expect(JSON.stringify(f)).toBe(before);
});

it('rejects another document version instead of reusing a matching original hash', async () => {
  const f = fixture(); f.version.documentVersionId = 'DV-other';
  await render(f.version);
  expect(mockRead).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain(f.reading.brief.text);
});

it.each(['parseRunId', 'sourceArtifactId', 'sourceSha256', 'sourceByteLength'] as const)(
  'rejects a mismatched saved source %s and exposes a real read failure', async key => {
    const f = fixture();
    const original = { ...f.reading.sourceBinding.original, [key]: key === 'sourceByteLength' ? 999 : 'other-source' };
    mockRead.mockResolvedValue({ ...f.response, reading: { ...f.reading, sourceBinding: { ...f.reading.sourceBinding, original } } });
    await render(f.version);
    expect(container.textContent).toContain('解读读取失败');
    expect(container.textContent).not.toContain(f.reading.brief.text);
    expect(container.querySelector('[role="alert"] button')?.textContent).toBe('重试');
  },
);

it('honors a fresh access denial and can read again after retry without a model request', async () => {
  const f = fixture(); mockRead.mockRejectedValueOnce(Object.assign(new Error('SOURCE_ACCESS_DENIED'), { statusCode: 403 })).mockResolvedValueOnce(f.response);
  await render(f.version);
  expect(container.textContent).not.toContain(f.reading.brief.text);
  expect(container.textContent).toContain('SOURCE_ACCESS_DENIED');
  await act(async () => container.querySelector<HTMLButtonElement>('[role="alert"] button')!.click());
  expect(container.textContent).toContain(f.reading.explanation[0].text);
  expect(mockRead).toHaveBeenCalledTimes(2);
});

it('keeps the authorized saved preview on an ordinary full-reading failure and reports the actual error', async () => {
  const f = fixture(); mockRead.mockRejectedValue(Object.assign(new Error('full reading unavailable'), { statusCode: 503 }));
  await render(f.version);
  expect(container.textContent).toContain(f.reading.headline);
  expect(container.textContent).toContain(f.reading.brief.text);
  expect(container.textContent).toContain(f.reading.criticalConditions[0].text);
  expect(container.textContent).not.toContain(f.reading.explanation[0].text);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('full reading unavailable');
});

it('keeps retracted content hidden even when a response incorrectly includes its text', async () => {
  const f = fixture(); mockRead.mockResolvedValue({ ...f.response, status: 'RETRACTED' });
  await render(f.version);
  expect(container.textContent).toContain('解读已撤回');
  expect(container.textContent).not.toContain(f.reading.brief.text);
});

it('aborts an old document read when selection changes and ignores its late response', async () => {
  const first = fixture(); let resolve!: (value: DocumentReadingResponse) => void;
  mockRead.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await render(first.version);
  const signal = mockRead.mock.calls[0][1] as AbortSignal;
  const second = fixture(); second.version.documentVersionId = 'DV-next';
  second.reading = savedDocumentReadingFixture('DV-next'); second.reading.headline = '另一份文档';
  second.version.documentReading = { status: 'AVAILABLE', reading: savedDocumentReadingPreview(second.reading) };
  mockRead.mockResolvedValue({ ...second.response, reading: second.reading, sourceBinding: second.reading.sourceBinding });
  await render(second.version);
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(first.response));
  expect(container.textContent).toContain('另一份文档');
  expect(container.textContent).not.toContain(first.reading.headline);
});
