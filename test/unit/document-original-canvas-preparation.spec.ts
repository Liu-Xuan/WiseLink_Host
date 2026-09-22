import { createHash } from 'node:crypto';
import * as React from 'react';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
let DocumentOriginalCanvasPreview: typeof import('../../client/src/pages/DocumentParsingPage/DocumentOriginalCanvasPreview').default;

const { JSDOM } = require('jsdom');
const mockRead = jest.fn();
const mockIdentity = jest.fn();
let clearMemory: () => void;
const mockImport = jest.fn();
let mockGeneration = 1;
const mockListeners = new Set<() => void>();
jest.mock('@client/src/api/canonical-host', () => ({
  readDocumentVersionOriginal: (...args: unknown[]) => mockRead(...args),
  readDocumentVersionOriginalIdentity: (...args: unknown[]) => mockIdentity(...args),
  getCanonicalHostClientSessionGeneration: () => mockGeneration,
  subscribeCanonicalHostClientSession: (listener: () => void) => {
    mockListeners.add(listener);
    return () => mockListeners.delete(listener);
  },
}));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
// Keep the real dynamic-import loader and React.lazy entry. This thenable is
// assimilated by import(), so its network completion can be controlled.
jest.mock(
  '../../client/src/pages/DocumentParsingPage/PdfDocumentViewer',
  () => ({
    __esModule: true,
    then: (
      resolve: (value: unknown) => void,
      reject: (reason: unknown) => void,
    ) => mockImport().then(resolve, reject),
  }),
);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const viewerModule = {
  default: (props: {
    sourceUrl: string;
    sourceSupportsRange: boolean;
    targetPage: number;
    targetSignal: string;
    targetBoxes: unknown;
    readingScope?: string;
  }) =>
    createElement('div', {
      'data-viewer': props.sourceUrl,
      'data-scope': props.readingScope,
      'data-page': props.targetPage,
      'data-range': String(props.sourceSupportsRange),
      'data-signal': props.targetSignal,
      'data-boxes': JSON.stringify(props.targetBoxes),
    }),
};

let dom: InstanceType<typeof JSDOM>;
let root: Root;
let container: HTMLElement;
let oldGlobals: Map<string, PropertyDescriptor | undefined>;
let oldCreate: PropertyDescriptor | undefined;
let oldRevoke: PropertyDescriptor | undefined;
const mockCreate = jest.fn();
const mockRevoke = jest.fn();

beforeEach(() => {
  mockRead.mockReset();
  mockIdentity.mockReset();
  mockImport.mockReset();
  mockCreate.mockReset();
  mockRevoke.mockReset();
  mockGeneration = 1;
  mockImport.mockResolvedValue(viewerModule);
  // Reset only this consumer/loader module graph per test; the renderer and
  // hooks must keep the same React instance. Each test exercises a cold import.
  jest.doMock('react', () => React);
  jest.isolateModules(() => {
    DocumentOriginalCanvasPreview =
      require('../../client/src/pages/DocumentParsingPage/DocumentOriginalCanvasPreview').default;
    clearMemory = require('../../client/src/utils/document-original-memory').clearDocumentOriginalMemory;
  });
  dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test/' });
  oldGlobals = new Map();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    oldGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  oldCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  oldRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: mockCreate,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: mockRevoke,
  });
  mockCreate.mockImplementation(
    () => `blob:test-${mockCreate.mock.calls.length}`,
  );
  container = dom.window.document.getElementById('root');
  root = createRoot(container);
});
afterEach(async () => {
  try {
    await act(async () => root.unmount());
    clearMemory();
    expect(mockListeners.size).toBe(0);
  } finally {
    dom.window.close();
    for (const [key, descriptor] of oldGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    if (oldCreate) Object.defineProperty(URL, 'createObjectURL', oldCreate);
    else Reflect.deleteProperty(URL, 'createObjectURL');
    if (oldRevoke) Object.defineProperty(URL, 'revokeObjectURL', oldRevoke);
    else Reflect.deleteProperty(URL, 'revokeObjectURL');
    jest.dontMock('react');
  }
});

async function render(documentVersionId = 'DV1', autoLoad = false, page = 3) {
  await act(async () =>
    root.render(
      createElement(DocumentOriginalCanvasPreview, {
        documentVersionId,
        autoLoad,
        page,
        targetSignal: 'source-3',
        readingScope: `${documentVersionId}:PR-1:R2`,
        targetBoxes: {
          boxes: [[10, 20, 30, 40]],
          viewportWidth: 600,
          viewportHeight: 800,
        },
      }),
    ),
  );
}
function button(text: string): HTMLButtonElement {
  const item = Array.from(container.querySelectorAll('button')).find(
    (node) => node.textContent === text,
  );
  if (!item) throw new Error(`Missing button: ${text}`);
  return item;
}
const pdf = () => new Blob(['%PDF-test'], { type: 'application/pdf' });

test('opens only on intent, starts both preparations, shows chunk failure and retries without rereading bytes', async () => {
  const chunk = deferred<typeof viewerModule>();
  const file = deferred<Blob>();
  mockImport.mockReturnValueOnce(chunk.promise);
  mockRead.mockReturnValueOnce(file.promise);
  await render();
  expect(mockImport).not.toHaveBeenCalled();
  expect(mockRead).not.toHaveBeenCalled();
  await act(async () => {
    const open = button('读取受控原件');
    open.click();
    open.click();
  });
  expect(mockImport).toHaveBeenCalledTimes(1);
  expect(mockRead).toHaveBeenCalledTimes(1);
  expect(mockRead.mock.calls[0][0]).toBe('DV1');
  expect(container.querySelector('[data-viewer]')).toBeNull();
  await act(async () => file.resolve(pdf()));
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[data-viewer]')).toBeNull();
  await act(async () => chunk.reject(new Error('chunk offline')));
  expect(container.textContent).toContain('PDF 阅读组件加载失败');
  expect(container.textContent).not.toContain('原件读取失败');
  const retry = deferred<typeof viewerModule>();
  mockImport.mockReturnValueOnce(retry.promise);
  await act(async () => button('重试 PDF 阅读组件').click());
  expect(mockImport).toHaveBeenCalledTimes(2);
  expect(mockRead).toHaveBeenCalledTimes(1);
  await act(async () => retry.resolve(viewerModule));
  const viewer = container.querySelector('[data-viewer]');
  expect(viewer?.getAttribute('data-page')).toBe('3');
  expect(viewer?.getAttribute('data-scope')).toBe('DV1:PR-1:R2');
  expect(viewer?.getAttribute('data-range')).toBe('false');
  expect(viewer?.getAttribute('data-signal')).toBe('source-3');
  expect(viewer?.getAttribute('data-boxes')).toContain('[10,20,30,40]');
  await render('DV1', false, 4);
  expect(
    container.querySelector('[data-viewer]')?.getAttribute('data-page'),
  ).toBe('4');
  expect(mockRead).toHaveBeenCalledTimes(1);
  await act(async () => root.render(null));
  expect(mockRevoke).toHaveBeenCalledWith('blob:test-1');
});

test('a ready module does not hide file failure; retry and version/session changes keep original ownership', async () => {
  const file = deferred<Blob>();
  mockRead.mockReturnValueOnce(file.promise);
  await render('DV1', true);
  expect(mockRead).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[data-viewer]')).toBeNull();
  await act(async () => file.reject(new Error('permission denied')));
  expect(container.textContent).toContain('原件读取失败');
  expect(container.textContent).not.toContain('PDF 阅读组件加载失败');
  mockRead.mockResolvedValueOnce(pdf());
  await act(async () => button('读取受控原件').click());
  expect(container.querySelector('[data-viewer]')).not.toBeNull();
  const oldFile = deferred<Blob>();
  mockRead.mockReturnValueOnce(oldFile.promise);
  await render('DV2', true);
  expect(mockRevoke).toHaveBeenCalledWith('blob:test-1');
  const oldSignal: AbortSignal = mockRead.mock.calls[2][1];
  const newFile = deferred<Blob>();
  mockRead.mockReturnValueOnce(newFile.promise);
  await render('DV3', true);
  expect(oldSignal.aborted).toBe(true);
  await act(async () => oldFile.resolve(pdf()));
  expect(mockCreate).toHaveBeenCalledTimes(1);
  await act(async () => newFile.resolve(pdf()));
  expect(
    container.querySelector('[data-viewer]')?.getAttribute('data-viewer'),
  ).toBe('blob:test-2');
  await act(async () => {
    mockGeneration += 1;
    mockListeners.forEach((listener) => listener());
  });
  expect(container.querySelector('[data-viewer]')).toBeNull();
  expect(mockRevoke).toHaveBeenCalledWith('blob:test-2');
  expect(container.textContent).toContain('登录状态已变化');
  expect(mockRead).toHaveBeenCalledTimes(4);
  const exited = deferred<Blob>();
  mockRead.mockReturnValueOnce(exited.promise);
  await act(async () => button('读取受控原件').click());
  const signal: AbortSignal = mockRead.mock.calls[4][1];
  await act(async () => {
    mockGeneration += 1;
    mockListeners.forEach((listener) => listener());
  });
  expect(signal.aborted).toBe(true);
  await act(async () => exited.resolve(pdf()));
  expect(mockCreate).toHaveBeenCalledTimes(2);
});

test('autoLoad starts a cold module and file concurrently; module-first completion waits for bytes', async () => {
  const chunk = deferred<typeof viewerModule>();
  const file = deferred<Blob>();
  mockImport.mockReturnValueOnce(chunk.promise);
  mockRead.mockReturnValueOnce(file.promise);
  await render('DV1', true);
  expect(mockImport).toHaveBeenCalledTimes(1);
  expect(mockRead).toHaveBeenCalledTimes(1);
  await act(async () => chunk.resolve(viewerModule));
  expect(container.querySelector('[data-viewer]')).toBeNull();
  await render('DV1', true, 7);
  expect(mockRead).toHaveBeenCalledTimes(1);
  await act(async () => file.resolve(pdf()));
  expect(
    container.querySelector('[data-viewer]')?.getAttribute('data-page'),
  ).toBe('7');
});

test('unmount aborts pending bytes and ignores both late completions', async () => {
  const chunk = deferred<typeof viewerModule>();
  const file = deferred<Blob>();
  mockImport.mockReturnValueOnce(chunk.promise);
  mockRead.mockReturnValueOnce(file.promise);
  await render('DV1', true);
  const signal: AbortSignal = mockRead.mock.calls[0][1];
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
  expect(mockListeners.size).toBe(0);
  await act(async () => {
    file.resolve(pdf());
    chunk.resolve(viewerModule);
  });
  expect(mockCreate).not.toHaveBeenCalled();
  expect(container.querySelector('[data-viewer]')).toBeNull();
});

test('switching versions without reading intent aborts the old request and does not download the new version', async () => {
  const chunk = deferred<typeof viewerModule>();
  const file = deferred<Blob>();
  mockImport.mockReturnValueOnce(chunk.promise);
  mockRead.mockReturnValueOnce(file.promise);
  await render();
  await act(async () => button('读取受控原件').click());
  const signal: AbortSignal = mockRead.mock.calls[0][1];
  await render('DV2');
  expect(signal.aborted).toBe(true);
  expect(mockRead).toHaveBeenCalledTimes(1);
  await act(async () => {
    file.resolve(pdf());
    chunk.resolve(viewerModule);
  });
  expect(mockCreate).not.toHaveBeenCalled();
  expect(container.querySelector('[data-viewer]')).toBeNull();
  mockRead.mockResolvedValueOnce(pdf());
  await act(async () => button('读取受控原件').click());
  expect(mockRead).toHaveBeenLastCalledWith('DV2', expect.any(AbortSignal));
  expect(container.querySelector('[data-viewer]')).not.toBeNull();
});

test('session exit while both preparations are pending never mounts the late result or auto-retries', async () => {
  const chunk = deferred<typeof viewerModule>();
  const file = deferred<Blob>();
  mockImport.mockReturnValueOnce(chunk.promise);
  mockRead.mockReturnValueOnce(file.promise);
  await render('DV1', true);
  const signal: AbortSignal = mockRead.mock.calls[0][1];
  await act(async () => {
    mockGeneration += 1;
    mockListeners.forEach((listener) => listener());
  });
  expect(signal.aborted).toBe(true);
  await act(async () => {
    file.resolve(pdf());
    chunk.resolve(viewerModule);
  });
  expect(mockCreate).not.toHaveBeenCalled();
  expect(mockRead).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('登录状态已变化');
  expect(container.querySelector('[data-viewer]')).toBeNull();
});

test('measures repeated original returns with an 8 MiB synthetic PDF and balanced URLs', async () => {
  const bytes = new Uint8Array(8 * 1024 * 1024);
  bytes.set(new TextEncoder().encode('%PDF-1.7\n'));
  const sample = new Blob([bytes], { type: 'application/pdf' });
  mockRead.mockResolvedValue(sample);
  mockIdentity.mockResolvedValue({ documentVersionId: 'DV-return', sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: sample.size });
  for (let i = 0; i < 3; i++) {
    await render('DV-return', true);
    for (let wait=0;wait<100 && !container.querySelector('[data-viewer]');wait++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 2)); });
    expect(container.querySelector('[data-viewer]')).not.toBeNull();
    await act(async () => root.render(null));
  }
  expect(mockRead).toHaveBeenCalledTimes(1);
  expect(mockIdentity).toHaveBeenCalledTimes(2);
  expect(mockRead.mock.calls.length * sample.size).toBe(8 * 1024 * 1024);
  expect(mockCreate).toHaveBeenCalledTimes(3);
  expect(mockRevoke).toHaveBeenCalledTimes(3);
});
