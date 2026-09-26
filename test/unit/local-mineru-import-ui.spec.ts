import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import LocalMineruImport from '../../client/src/pages/DocumentParsingPage/LocalMineruImport';
const upload = jest.fn();
const start = jest.fn();
let generation = 1;
const listeners = new Set<() => void>();
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => generation,
  startDocumentParsing: (...args: unknown[]) => start(...args),
  subscribeCanonicalHostClientSession: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
}));
jest.mock('@client/src/components/business-ui/api/files/service', () => ({ uploadFile: (...args: unknown[]) => upload(...args) }));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
const { JSDOM } = require('jsdom');
let dom: { window: Window & typeof globalThis };
let root: Root;
let container: HTMLDivElement;
const imported = jest.fn();
const receipt = { status: 'PUBLISHED', parseRevision: 2 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function render(documentVersionId = 'DV-A') {
  await act(async () => root.render(createElement(MemoryRouter, { future: { v7_startTransition: true, v7_relativeSplatPath: true } },
    createElement(LocalMineruImport, { documentVersionId, expectedPublishedRevision: 0, onImported: imported }))));
}
async function choose(name = 'candidate.json') {
  const input = container.querySelector('input')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [new dom.window.File(['{"test":1}'], name, { type: 'application/json' })] });
  await act(async () => input.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
}
async function click() { await act(async () => container.querySelector('button')!.click()); }
async function changeSession() { await act(async () => { generation += 1; listeners.forEach(listener => listener()); }); }
beforeAll(() => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test/' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
});
afterAll(() => dom.window.close());
beforeEach(() => {
  generation = 1; listeners.clear(); upload.mockReset(); start.mockReset(); imported.mockReset();
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  upload.mockResolvedValue({ bucketId: 'bucket', filePath: '/uploaded-candidate.json' });
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
it('reuses the exact upload selection and request identity after an import response is lost', async () => {
  start.mockRejectedValueOnce(new Error('IMPORT_RESPONSE_LOST')).mockResolvedValueOnce(receipt);
  await render(); await choose(); await click();
  const first = structuredClone(start.mock.calls[0]);
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('IMPORT_RESPONSE_LOST');
  expect(container.querySelector('button')?.textContent).toBe('核对同一导入请求');
  await click();
  expect(upload).toHaveBeenCalledTimes(1); expect(start).toHaveBeenCalledTimes(2);
  expect(start.mock.calls[1]).toEqual(first);
  expect(first).toEqual(['DV-A', expect.objectContaining({ mode: 'LOCAL_MINERU_IMPORT', requestId: expect.stringMatching(/^mineru-/),
    selection: { bucketId: 'bucket', filePath: '/uploaded-candidate.json' } })]);
  expect(imported).toHaveBeenCalledTimes(1);
});
it('discards a former session upload and lets the next user submit while it is still pending', async () => {
  const oldUpload = deferred<{ bucketId: string; filePath: string }>();
  upload.mockImplementationOnce(() => oldUpload.promise);
  start.mockResolvedValue(receipt);
  await render(); await choose(); await click();
  const oldPath = upload.mock.calls[0][1].filePath;
  await changeSession();
  expect(container.querySelector('button')?.disabled).toBe(true);
  await choose(); await click();
  expect(upload).toHaveBeenCalledTimes(2); expect(start).toHaveBeenCalledTimes(1);
  expect(upload.mock.calls[1][1].filePath).not.toBe(oldPath);
  await act(async () => oldUpload.resolve({ bucketId: 'former-user', filePath: '/old.json' }));
  expect(start).toHaveBeenCalledTimes(1); expect(imported).toHaveBeenCalledTimes(1);
  expect(start.mock.calls[0][1].selection.bucketId).toBe('bucket');
});
it('ignores a late prior-session import result without unlocking a newer operation', async () => {
  const oldImport = deferred<typeof receipt>(); const newImport = deferred<typeof receipt>();
  start.mockImplementationOnce(() => oldImport.promise).mockImplementationOnce(() => newImport.promise);
  await render(); await choose(); await click();
  const oldRequestId = start.mock.calls[0][1].requestId;
  await changeSession(); await choose(); await click();
  expect(start).toHaveBeenCalledTimes(2); expect(start.mock.calls[1][1].requestId).not.toBe(oldRequestId);
  await act(async () => oldImport.resolve(receipt));
  expect(imported).not.toHaveBeenCalled(); expect(container.querySelector('[role="status"]')).toBeNull();
  expect(container.querySelector('button')?.disabled).toBe(true);
  await act(async () => newImport.resolve({ ...receipt, parseRevision: 3 }));
  expect(imported).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role="status"]')?.textContent).toContain('3');
});
it('does not reuse an old document request when the same component receives a new document identity', async () => {
  start.mockRejectedValueOnce(new Error('IMPORT_RESPONSE_LOST')).mockResolvedValue(receipt);
  await render(); await choose(); await click(); const oldRequestId = start.mock.calls[0][1].requestId;
  await render('DV-B'); expect(container.querySelector('button')?.disabled).toBe(true);
  await choose(); await click();
  expect(upload).toHaveBeenCalledTimes(2); expect(start.mock.calls[1][0]).toBe('DV-B');
  expect(start.mock.calls[1][1].requestId).not.toBe(oldRequestId);
});

it('shows a failed replay and its error rather than reporting it as accepted', async () => {
  start.mockRejectedValueOnce(new Error('IMPORT_RESPONSE_LOST'))
    .mockResolvedValueOnce({ status: 'FAILED', parseRevision: 2, errorCode: 'DOCUMENT_PARSE_DEADLINE_EXCEEDED' });
  await render(); await choose(); await click(); await click();
  expect(upload).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('DOCUMENT_PARSE_DEADLINE_EXCEEDED');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('后继解析');
  expect(imported).not.toHaveBeenCalled();
});
