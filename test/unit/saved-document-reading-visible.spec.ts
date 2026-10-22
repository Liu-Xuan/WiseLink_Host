import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import type { DocumentReadingResponse } from '@shared/document-reading.interface';
import type { CanonicalLibraryDocumentVersionSummary } from '@shared/api.interface';
import SavedDocumentReadingArticle from '@client/src/pages/KnowledgeLookupPage/SavedDocumentReadingArticle';
import { libraryFamily } from './fixtures/canonical-library';
import { savedDocumentReadingFixture, savedDocumentReadingPreview } from './fixtures/saved-document-reading';

const mockRead = jest.fn();
const mockReadIdentityRefetch = jest.fn(async () => ({ error: null }));
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => 1,
  readSavedDocumentReading: (...args: unknown[]) => mockRead(...args),
}));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({
  useCurrentUserSession: () => ({ authenticationRequired: false }),
}));
jest.mock('@client/src/features/matter/useEngineeringMatter', () => ({
  useEngineeringMatterQueryIdentity: () => ({
    identity: { appId: 'test-app', tenantId: 'tenant-1', actorId: 'actor-1', sessionGeneration: 1 },
    identityQuery: { isFetching: false, error: null, refetch: mockReadIdentityRefetch },
  }),
}));

let dom: JSDOM;
let root: Root;
let container: HTMLElement;
const oldGlobals = new Map<string, PropertyDescriptor | undefined>();
const openSource = jest.fn();
const historicalSelfReport = '本结果仅为文件解读候选，不构成机队适用性判断、工程决定、批准、执行或发布；未采用任何事项特定假设，未生成sourceBinding、readCoverage、revision或producer信息。';
const sourceCoverageSelfReport = 'sourceCoverage.unresolvedRanges非空：第1、2、3、5、6页（0基索引0、1、2、4、5）多个单元被标记TEXT_CONFLICT，包括次型号清单、适用范围段、参考文件表、附件II MEDB表格多个单元格及注释等，其结构化内容与PDF文本层未确切对应；本解读基于Host已交付的结构化单元，相关字符级细节（尤其MEDB表格单元格内容与注释）使用前应核对原页。';
const visualSelfReport = '全部6页的结构化单元均已交付读取，但不代表原始PDF所有视觉内容（如表格图像细节）均已核实。';
const attachmentDate = '附件I页眉标注日期为2021年10月21日，属附件自身标注，不是本信函的日期或修订日期；本信函Original日期为2026年4月24日。';
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
  const f = fixture();
  const specificBoundary = '2907C1不能用于RNP AR minima<0.3 NM；2907C2取证尚未完成。';
  const extendedEntry = `${historicalSelfReport} 构型 B 的执行记录仍待核。`;
  f.reading.limitations.push(historicalSelfReport, specificBoundary, extendedEntry);
  f.version.documentReading!.reading = savedDocumentReadingPreview(f.reading);
  const before = JSON.stringify(f);
  mockRead.mockResolvedValue(f.response); await render(f.version);
  expect(mockRead).toHaveBeenCalledWith({ documentVersionId: f.version.documentVersionId,
    parseRunId: 'parse-1', semanticRevision: 1, readingRevision: 1 }, expect.any(AbortSignal));
  for (const text of ['已保存的详细解释。', '仅适用于构型 A。', '构型 B 尚无执行记录。', '第二页图示含义尚未确认。'])
    expect(container.textContent).toContain(text);
  const sourceDetails = container.querySelector('details[aria-label="原文差异与缺项"]')!;
  expect(sourceDetails.hasAttribute('open')).toBe(false);
  expect(sourceDetails.querySelectorAll('li')).toHaveLength(f.reading.readCoverage.sourceCoverage.unresolvedRanges.length);
  expect(sourceDetails.textContent).toContain('diagnostic-only');
  const paragraphs = [...container.querySelectorAll('p')].map(item => item.textContent);
  expect(paragraphs).not.toContain('diagnostic-only');
  expect(paragraphs).not.toContain(historicalSelfReport);
  expect(paragraphs).toContain(specificBoundary);
  expect(paragraphs).toContain(extendedEntry);
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

it('keeps the loading preview and saved main reading focused while retaining original differences', async () => {
  const f = fixture();
  const specificUnreadMaterial = '第5页MEDB图表注释尚未读取，U13兼容性仍未确认。';
  f.reading.limitations.push(sourceCoverageSelfReport, visualSelfReport, attachmentDate, specificUnreadMaterial);
  f.version.documentReading!.reading = savedDocumentReadingPreview(f.reading);
  const before = JSON.stringify(f);
  let resolve!: (value: DocumentReadingResponse) => void;
  mockRead.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await render(f.version);
  const previewLines = [...container.querySelectorAll('li')].map(item => item.textContent);
  expect(previewLines).toContain(f.reading.criticalConditions[0].text);
  expect(previewLines).toContain(attachmentDate);
  expect(previewLines).toContain(specificUnreadMaterial);
  expect(previewLines).not.toContain(sourceCoverageSelfReport);
  expect(previewLines).not.toContain(visualSelfReport);
  expect(container.textContent).not.toContain('diagnostic-only');
  await act(async () => resolve(f.response));
  const paragraphs = [...container.querySelectorAll('p')].map(item => item.textContent);
  expect(paragraphs).toContain(attachmentDate);
  expect(paragraphs).toContain(specificUnreadMaterial);
  expect(paragraphs).not.toContain(sourceCoverageSelfReport);
  expect(paragraphs).not.toContain(visualSelfReport);
  const sourceDetails = container.querySelector('details[aria-label="原文差异与缺项"]')!;
  expect(sourceDetails.hasAttribute('open')).toBe(false);
  expect(sourceDetails.querySelectorAll('li')).toHaveLength(f.reading.readCoverage.sourceCoverage.unresolvedRanges.length);
  expect(sourceDetails.textContent).toContain('diagnostic-only');
  expect(JSON.stringify(f)).toBe(before);
});

it('preserves similar self-reports with added facts and specific unread material', async () => {
  const f = fixture();
  const addedFacts = [
    `${sourceCoverageSelfReport} 附件III的NDB兼容位图示尚未读取。`,
    `${visualSelfReport} AFM图4的硬件构型条件尚未确认。`,
    'sourceCoverage.unresolvedRanges中的附件II图表尚未读取，不能确认新增STC构型。',
  ];
  f.reading.limitations.push(...addedFacts);
  f.version.documentReading!.reading = savedDocumentReadingPreview(f.reading);
  const before = JSON.stringify(f);
  mockRead.mockResolvedValue(f.response);
  await render(f.version);
  const paragraphs = [...container.querySelectorAll('p')].map(item => item.textContent);
  for (const fact of addedFacts) expect(paragraphs).toContain(fact);
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
  const f = fixture();
  f.reading.limitations.push(historicalSelfReport);
  f.version.documentReading!.reading = savedDocumentReadingPreview(f.reading);
  mockRead.mockRejectedValue(Object.assign(new Error('full reading unavailable'), { statusCode: 503 }));
  await render(f.version);
  expect(container.textContent).toContain(f.reading.headline);
  expect(container.textContent).toContain(f.reading.brief.text);
  expect(container.textContent).toContain(f.reading.criticalConditions[0].text);
  expect(container.textContent).not.toContain(f.reading.explanation[0].text);
  expect(container.textContent).not.toContain(historicalSelfReport);
  expect(container.textContent).toContain('构型 B 尚无执行记录。');
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

it.each([{ code: 'ERR_NETWORK' }, { statusCode: 503 }])('retains full exact DRR prose and old source links after a temporary failure %j', async failure => {
  const f = fixture();
  const before = JSON.stringify(f);
  mockRead.mockResolvedValueOnce(f.response).mockRejectedValueOnce(Object.assign(new Error('temporary full read failure'), failure));
  await render(f.version);
  await act(async () => dom.window.dispatchEvent(new dom.window.Event('focus')));
  expect(container.textContent).toContain(f.reading.explanation[0].text);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('保留同版正文');
  const source = [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find(button => button.textContent?.includes('Check configuration.'))!;
  await act(async () => source.click());
  const route = new URL(openSource.mock.calls[0][0], 'https://example.test');
  expect(route.searchParams.get('parseRunId')).toBe('parse-1');
  expect(route.searchParams.get('sourceRef')).toBe('source-ref-parse-1');
  expect(JSON.stringify(f)).toBe(before);
});

it('source denial suppresses both old full prose and preview through a later network failure', async () => {
  const f = fixture();
  mockRead.mockResolvedValueOnce(f.response)
    .mockRejectedValueOnce(Object.assign(new Error('source revoked'), { statusCode: 403, code: 'ERR_NETWORK' }))
    .mockRejectedValueOnce(Object.assign(new Error('network unavailable'), { code: 'ERR_NETWORK' }));
  await render(f.version);
  await act(async () => dom.window.dispatchEvent(new dom.window.Event('focus')));
  expect(container.textContent).not.toContain(f.reading.brief.text);
  expect(container.textContent).not.toContain(f.reading.explanation[0].text);
  await act(async () => container.querySelector<HTMLButtonElement>('[role="alert"] button')!.click());
  expect(container.textContent).not.toContain(f.reading.brief.text);
  expect(container.textContent).not.toContain(f.reading.explanation[0].text);
});

it.each(['RETRACTED', 'NOT_GENERATED'] as const)('a fresh %s reply removes previously displayed DRR prose', async status => {
  const f = fixture();
  mockRead.mockResolvedValueOnce(f.response).mockResolvedValueOnce({ ...f.response, status, reading: null });
  await render(f.version);
  await act(async () => dom.window.dispatchEvent(new dom.window.Event('focus')));
  expect(container.textContent).not.toContain(f.reading.brief.text);
  expect(container.textContent).not.toContain(f.reading.explanation[0].text);
  expect(container.textContent).toContain(status === 'RETRACTED' ? '解读已撤回' : '暂无已保存解读');
});

it('an envelope binding mismatch clears prior prose instead of retaining it as a transport failure', async () => {
  const f = fixture();
  mockRead.mockResolvedValueOnce(f.response).mockResolvedValueOnce({ ...f.response, sourceBinding: {
    ...f.response.sourceBinding, original: { ...f.response.sourceBinding.original, sourceSha256: 'b'.repeat(64) },
  } });
  await render(f.version);
  await act(async () => dom.window.dispatchEvent(new dom.window.Event('focus')));
  expect(container.textContent).not.toContain(f.reading.explanation[0].text);
  expect(container.textContent).not.toContain(f.reading.brief.text);
  expect(container.textContent).toContain('DOCUMENT_READING_BINDING_MISMATCH');
});

it('a full-binding change with the same DRR label isolates the old body and rejects its late reply', async () => {
  const f = fixture();
  let resolveOld!: (value: DocumentReadingResponse) => void;
  let resolveNew!: (value: DocumentReadingResponse) => void;
  mockRead.mockResolvedValueOnce(f.response)
    .mockImplementationOnce(() => new Promise<DocumentReadingResponse>(resolve => { resolveOld = resolve; }))
    .mockImplementationOnce(() => new Promise<DocumentReadingResponse>(resolve => { resolveNew = resolve; }));
  await render(f.version);
  await act(async () => dom.window.dispatchEvent(new dom.window.Event('focus')));
  const oldSignal = mockRead.mock.calls[1][1] as AbortSignal;
  const next = structuredClone(f);
  next.reading.sourceBinding.original.parseRunId = 'parse-other';
  next.reading.sourceBinding.semanticRevision = 2;
  next.reading.explanation[0].text = 'New exact binding explanation';
  next.version.documentReading = { status: 'AVAILABLE', reading: savedDocumentReadingPreview(next.reading) };
  next.response = { ...next.response, sourceBinding: next.reading.sourceBinding, reading: next.reading };
  await render(next.version);
  expect(oldSignal.aborted).toBe(true);
  expect(container.textContent).not.toContain(f.reading.explanation[0].text);
  await act(async () => resolveOld(f.response));
  expect(container.textContent).not.toContain(f.reading.explanation[0].text);
  await act(async () => resolveNew(next.response));
  expect(container.textContent).toContain('New exact binding explanation');
});
