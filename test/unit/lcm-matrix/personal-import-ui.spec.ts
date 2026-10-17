import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

const upload = jest.fn(), resolveUpload = jest.fn(), importExcel = jest.fn();
let generation = 1;
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => generation,
  resolveLcmExcelUpload: (...args: unknown[]) => resolveUpload(...args),
  importLcmExcel: (...args: unknown[]) => importExcel(...args),
}));
jest.mock('@client/src/components/business-ui/api/files/service', () => ({ uploadFile: (...args: unknown[]) => upload(...args) }));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/components/ui/input', () => ({ Input: 'input' }));
import { LcmExcelImport } from '@client/src/pages/WorkspaceHomePage/LcmExcelImport';

describe('personal Excel import response recovery', () => {
  let dom: JSDOM, root: Root, container: HTMLDivElement;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><body></body>', { url: 'https://test.invalid/library' });
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
      navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    container = dom.window.document.createElement('div'); dom.window.document.body.append(container);
    root = createRoot(container); generation = 1;
    [upload, resolveUpload, importExcel].forEach(mock => mock.mockReset());
  });
  afterEach(async () => {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
    originals.clear();
  });
  async function select(onImported: jest.Mock): Promise<void> {
    await act(async () => root.render(createElement(StrictMode, null,
      createElement(LcmExcelImport, { sessionGeneration: generation, disabled: false, onImported }))));
    const input = container.querySelector('input[type=file]')!;
    Object.defineProperty(input, 'files', { configurable: true,
      value: [new dom.window.File(['unit bytes'], '构型统计_LOCAL_2026108.xls')] });
    await act(async () => input.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
  }
  async function submit(): Promise<void> {
    await act(async () => container.querySelector('button')!.click());
  }
  const selection = (path: string) => ({ bucketId: 'owned-bucket', filePath: path, expectedProviderObjectId: 'owned-provider-id' });

  it('survives StrictMode remount and completes the same request after a lost upload response', async () => {
    const done = jest.fn();
    resolveUpload.mockResolvedValueOnce({ selection: null }).mockImplementation(async ({ filePath }: { filePath: string }) =>
      ({ selection: selection(filePath) }));
    upload.mockRejectedValueOnce(Object.assign(new Error('upload response lost'), { code: 'ECONNRESET' }));
    importExcel.mockImplementation(async (input: { requestId: string }) => ({ requestId: input.requestId, snapshotId: 'a'.repeat(64), sourceRowCount: 226, aircraftColumnCount: 104, stateCellCount: 23504 }));
    await select(done); expect(container.textContent).toContain('状态日 2026-10-08'); await submit();
    expect(importExcel.mock.calls[0][0]).not.toHaveProperty('context');
    expect(upload).toHaveBeenCalledTimes(1); expect(importExcel).toHaveBeenCalledTimes(1);
    expect(importExcel.mock.calls[0][0].selection).toEqual(selection(resolveUpload.mock.calls[0][0].filePath));
    expect(done).toHaveBeenCalledTimes(1); expect(container.textContent).toContain('已保存 1 份 Excel');
    expect(container.textContent).toContain('226 源行'); expect(container.textContent).toContain('104 飞机列');
    expect(container.textContent).toContain('23,504 状态格');
  });

  it('keeps an unresolved failure visible and recovers by metadata on the same deliberate retry', async () => {
    const done = jest.fn();
    resolveUpload.mockResolvedValueOnce({ selection: null }).mockResolvedValueOnce({ selection: null });
    upload.mockRejectedValueOnce(new Error('upload result unknown'));
    await select(done); await submit();
    expect(container.querySelector('[role=alert]')?.textContent).toContain('upload result unknown');
    expect(done).not.toHaveBeenCalled(); expect(importExcel).not.toHaveBeenCalled();
    const path: string = resolveUpload.mock.calls[0][0].filePath;
    resolveUpload.mockResolvedValueOnce({ selection: selection(path) });
    importExcel.mockImplementation(async (input: { requestId: string }) => ({ requestId: input.requestId, snapshotId: 'b'.repeat(64), sourceRowCount: 226, aircraftColumnCount: 104, stateCellCount: 23504 }));
    await submit();
    expect(upload).toHaveBeenCalledTimes(1); expect(importExcel.mock.calls[0][0].selection.filePath).toBe(path);
    expect(path).toContain(importExcel.mock.calls[0][0].requestId); expect(done).toHaveBeenCalledTimes(1);
  });
  it('clears the importing status after a server failure and permits retrying the same deliberate import', async () => {
    const done = jest.fn();
    resolveUpload.mockImplementation(async ({ filePath }: { filePath: string }) => ({ selection: selection(filePath) }));
    importExcel.mockRejectedValueOnce(Object.assign(new Error('22P02'), { statusCode: 500 }));
    await select(done); await submit();
    expect(container.textContent).toContain('导入失败，请重试。');
    expect(container.textContent).not.toContain('正在导入');
    expect(container.textContent).not.toContain('权限');
    expect(container.querySelector('button')?.disabled).toBe(false);
    const original = importExcel.mock.calls[0][0];
    importExcel.mockResolvedValueOnce({ requestId: original.requestId, snapshotId: 'a'.repeat(64),
      sourceRowCount: 226, aircraftColumnCount: 104, stateCellCount: 23504 });
    await submit();
    expect(importExcel.mock.calls[1][0]).toEqual(original);
    expect(container.textContent).toContain('226 源行'); expect(done).toHaveBeenCalledTimes(1);
  });

});
