import { createHash } from 'node:crypto';
import { act, createElement, StrictMode, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import DocumentOriginalCanvasPreview from '../../client/src/pages/DocumentParsingPage/DocumentOriginalCanvasPreview';
import { clearDocumentOriginalMemory } from '../../client/src/utils/document-original-memory';

const { JSDOM } = require('jsdom');
const mockRead = jest.fn();
const mockIdentity = jest.fn();
const mockLoad = jest.fn();
const mockCreate = jest.fn();
const mockRevoke = jest.fn();
const mockListeners = new Set<() => void>();
let mockGeneration = 1;

// Keep the real authorization-aware hook and memory implementation. Only the
// Host API boundary, PDF renderer boundary and browser object URLs are stubbed.
jest.mock('@client/src/api/canonical-host', () => ({
  readDocumentVersionOriginal: (...args: unknown[]) => mockRead(...args),
  readDocumentVersionOriginalIdentity: (...args: unknown[]) =>
    mockIdentity(...args),
  getCanonicalHostClientSessionGeneration: () => mockGeneration,
  subscribeCanonicalHostClientSession: (listener: () => void) => {
    mockListeners.add(listener);
    return () => mockListeners.delete(listener);
  },
}));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock(
  '../../client/src/pages/DocumentParsingPage/pdf-document-viewer-loader',
  () => ({
    loadPdfDocumentViewer: () => mockLoad(),
    LazyPdfDocumentViewer: (props: {
      sourceUrl: string;
      sourceSupportsRange: boolean;
      readingScope: string;
      targetPage: number;
      targetSignal: string;
    }) =>
      createElement('div', {
        'data-viewer': props.sourceUrl,
        'data-scope': props.readingScope,
        'data-page': props.targetPage,
        'data-signal': props.targetSignal,
        'data-range': String(props.sourceSupportsRange),
      }),
  }),
);

type Props = ComponentProps<typeof DocumentOriginalCanvasPreview>;
type Identity = {
  documentVersionId: string;
  sha256: string;
  byteLength: number;
};
let dom: InstanceType<typeof JSDOM>;
let root: Root;
let container: HTMLElement;
let oldGlobals: Map<string, PropertyDescriptor | undefined>;
let oldCreate: PropertyDescriptor | undefined;
let oldRevoke: PropertyDescriptor | undefined;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture(id = 'DV-A') {
  const bytes = Buffer.from(`%PDF-1.7\n${id}\n%%EOF`);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const identity: Identity = {
    documentVersionId: id,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: blob.size,
  };
  return { blob, identity };
}
function element(props: Partial<Props> = {}) {
  const id = props.documentVersionId ?? 'DV-A';
  return createElement(DocumentOriginalCanvasPreview, {
    documentVersionId: id,
    readingScope: `${id}:PR-1:R2`,
    page: 2,
    targetSignal: 'source-2',
    ...props,
  });
}
async function render(props: Partial<Props> = {}) {
  await act(async () => root.render(element(props)));
}
async function leave() {
  await act(async () => root.render(null));
}
function viewer() {
  return container.querySelector('[data-viewer]');
}
function button(label: string) {
  const result = Array.from(container.querySelectorAll('button')).find(
    (item: HTMLButtonElement) => item.textContent === label,
  );
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
async function waitForViewer() {
  // WebCrypto's real SHA-256 work completes outside React's microtask queue.
  for (let attempt = 0; attempt < 100 && !viewer(); attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2));
    });
  }
  expect(viewer()).not.toBeNull();
}
async function changeSession() {
  await act(async () => {
    mockGeneration += 1;
    [...mockListeners].forEach((listener: () => void) => listener());
  });
}

beforeEach(() => {
  clearDocumentOriginalMemory();
  mockRead.mockReset();
  mockIdentity.mockReset();
  mockLoad.mockReset().mockResolvedValue(undefined);
  mockCreate
    .mockReset()
    .mockImplementation(() => `blob:mount-${mockCreate.mock.calls.length}`);
  mockRevoke.mockReset();
  mockGeneration = 1;
  dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'https://example.test/',
  });
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
  container = dom.window.document.getElementById('root');
  root = createRoot(container);
});
afterEach(async () => {
  try {
    await act(async () => root.unmount());
    clearDocumentOriginalMemory();
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
  }
});

test('omitted autoLoad starts authorized bytes and PDF preparation without a load-button prerequisite', async () => {
  const file = deferred<Blob>();
  const module = deferred<void>();
  mockRead.mockReturnValueOnce(file.promise);
  mockLoad.mockReturnValueOnce(module.promise);
  await render();
  expect(mockRead).toHaveBeenCalledWith('DV-A', expect.any(AbortSignal));
  expect(mockRead).toHaveBeenCalledTimes(1);
  expect(mockLoad).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role="status"]')).not.toBeNull();
  expect(container.querySelectorAll('button')).toHaveLength(0);
  expect(viewer()).toBeNull();
  await act(async () => module.resolve());
  await render({ page: 7, targetSignal: 'source-7' });
  expect(viewer()).toBeNull();
  expect(mockRead).toHaveBeenCalledTimes(1);
  await act(async () => file.resolve(fixture().blob));
  expect(viewer()?.getAttribute('data-viewer')).toBe('blob:mount-1');
  expect(viewer()?.getAttribute('data-scope')).toBe('DV-A:PR-1:R2');
  expect(viewer()?.getAttribute('data-page')).toBe('7');
  expect(viewer()?.getAttribute('data-signal')).toBe('source-7');
  expect(viewer()?.getAttribute('data-range')).toBe('false');
  expect(mockIdentity).not.toHaveBeenCalled();
});

test('default file-first completion waits for the PDF module and then mounts without user intent', async () => {
  const module = deferred<void>();
  mockLoad.mockReturnValueOnce(module.promise);
  mockRead.mockResolvedValueOnce(fixture().blob);
  await render();
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(viewer()).toBeNull();
  expect(container.querySelectorAll('button')).toHaveLength(0);
  await act(async () => module.resolve());
  expect(viewer()).not.toBeNull();
  expect(mockRead).toHaveBeenCalledTimes(1);
});

test('default module failure remains retryable without an automatic retry loop or another byte download', async () => {
  mockLoad.mockRejectedValueOnce(new Error('chunk unavailable'));
  mockRead.mockResolvedValueOnce(fixture().blob);
  await render();
  expect(container.textContent).toContain('PDF 阅读组件加载失败');
  expect(container.textContent).not.toContain('原件读取失败');
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(viewer()).toBeNull();
  await render({ page: 6 });
  expect(mockLoad).toHaveBeenCalledTimes(1);
  expect(mockRead).toHaveBeenCalledTimes(1);
  const retry = deferred<void>();
  mockLoad.mockReturnValueOnce(retry.promise);
  await act(async () => button('重试 PDF 阅读组件').click());
  expect(mockLoad).toHaveBeenCalledTimes(2);
  expect(mockRead).toHaveBeenCalledTimes(1);
  expect(viewer()).toBeNull();
  await act(async () => retry.resolve());
  expect(viewer()?.getAttribute('data-page')).toBe('6');
  expect(mockCreate).toHaveBeenCalledTimes(1);
});

test('denied default access is visible, never loops on rerender, and permits one explicit retry', async () => {
  mockRead.mockRejectedValueOnce(new Error('403 permission denied'));
  await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    '403 permission denied',
  );
  expect(mockCreate).not.toHaveBeenCalled();
  expect(viewer()).toBeNull();
  await render({ page: 3 });
  await render({ page: 4 });
  expect(mockRead).toHaveBeenCalledTimes(1);
  const retry = deferred<Blob>();
  mockRead.mockReturnValueOnce(retry.promise);
  await act(async () => {
    const retryButton = button('重试读取原件');
    retryButton.click();
    retryButton.click();
  });
  expect(mockRead).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  await act(async () => retry.resolve(fixture().blob));
  expect(viewer()?.getAttribute('data-page')).toBe('4');
  expect(mockCreate).toHaveBeenCalledTimes(1);
});

test.each(['404 original unavailable', 'DOCUMENT_ORIGINAL_NOT_PDF'])(
  'does not fabricate or display a PDF when the original API reports %s',
  async (message: string) => {
    mockRead.mockRejectedValueOnce(new Error(message));
    await render({ documentVersionId: 'DV-missing' });
    expect(mockRead).toHaveBeenCalledWith(
      'DV-missing',
      expect.any(AbortSignal),
    );
    expect(container.textContent).toContain(message);
    expect(viewer()).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
    await render({ documentVersionId: 'DV-missing', page: 8 });
    expect(mockRead).toHaveBeenCalledTimes(1);
    expect(mockIdentity).not.toHaveBeenCalled();
  },
);

test('switching exact versions aborts the old read and ignores late bytes without caching them', async () => {
  const oldFile = deferred<Blob>();
  const newFile = deferred<Blob>();
  mockRead
    .mockReturnValueOnce(oldFile.promise)
    .mockReturnValueOnce(newFile.promise);
  await render();
  const oldSignal: AbortSignal = mockRead.mock.calls[0][1];
  await render({ documentVersionId: 'DV-B' });
  expect(oldSignal.aborted).toBe(true);
  expect(mockRead).toHaveBeenNthCalledWith(2, 'DV-B', expect.any(AbortSignal));
  expect(viewer()).toBeNull();
  await act(async () => newFile.resolve(fixture('DV-B').blob));
  expect(viewer()?.getAttribute('data-scope')).toBe('DV-B:PR-1:R2');
  await act(async () => oldFile.resolve(fixture().blob));
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(viewer()?.getAttribute('data-viewer')).toBe('blob:mount-1');
  mockRead.mockResolvedValueOnce(fixture().blob);
  await render();
  expect(mockRead).toHaveBeenNthCalledWith(3, 'DV-A', expect.any(AbortSignal));
  expect(mockIdentity).not.toHaveBeenCalled();
  expect(mockRevoke).toHaveBeenCalledWith('blob:mount-1');
  expect(viewer()?.getAttribute('data-scope')).toBe('DV-A:PR-1:R2');
});

test('session identity changes clear a displayed PDF and require a fresh explicit authorized read', async () => {
  mockRead.mockResolvedValue(fixture().blob);
  await render();
  expect(viewer()).not.toBeNull();
  await changeSession();
  expect(viewer()).toBeNull();
  expect(mockRevoke).toHaveBeenCalledWith('blob:mount-1');
  expect(container.textContent).toContain('登录状态已变化');
  await render({ page: 5 });
  expect(mockRead).toHaveBeenCalledTimes(1);
  await act(async () => button('重试读取原件').click());
  expect(mockRead).toHaveBeenCalledTimes(2);
  expect(mockIdentity).not.toHaveBeenCalled();
  expect(viewer()?.getAttribute('data-viewer')).toBe('blob:mount-2');
});

test('session changes while default loading reject late bytes and never automatically retry', async () => {
  const file = deferred<Blob>();
  mockRead.mockReturnValueOnce(file.promise);
  await render();
  const signal: AbortSignal = mockRead.mock.calls[0][1];
  await changeSession();
  expect(signal.aborted).toBe(true);
  await act(async () => file.resolve(fixture().blob));
  await render({ page: 6 });
  expect(mockRead).toHaveBeenCalledTimes(1);
  expect(mockCreate).not.toHaveBeenCalled();
  expect(viewer()).toBeNull();
  mockRead.mockResolvedValueOnce(fixture().blob);
  await act(async () => button('重试读取原件').click());
  expect(mockRead).toHaveBeenCalledTimes(2);
  expect(mockIdentity).not.toHaveBeenCalled();
  expect(viewer()).not.toBeNull();
});

test('unmount aborts default loading and ignores late bytes/module completion on a later mount', async () => {
  const file = deferred<Blob>();
  const module = deferred<void>();
  mockRead.mockReturnValueOnce(file.promise);
  mockLoad.mockReturnValueOnce(module.promise);
  await render();
  const signal: AbortSignal = mockRead.mock.calls[0][1];
  await leave();
  expect(signal.aborted).toBe(true);
  expect(mockListeners.size).toBe(0);
  await act(async () => {
    file.resolve(fixture().blob);
    module.resolve();
  });
  expect(mockCreate).not.toHaveBeenCalled();
  mockRead.mockResolvedValueOnce(fixture().blob);
  await render();
  expect(mockRead).toHaveBeenCalledTimes(2);
  expect(mockIdentity).not.toHaveBeenCalled();
  expect(viewer()).not.toBeNull();
});

test('every warm default remount waits for exact-version reauthorization before creating a fresh URL', async () => {
  const sample = fixture();
  mockRead.mockResolvedValueOnce(sample.blob);
  await render();
  await leave();
  expect(mockRevoke).toHaveBeenCalledWith('blob:mount-1');
  const authorization = deferred<Identity>();
  mockIdentity.mockReturnValueOnce(authorization.promise);
  await render();
  expect(mockIdentity).toHaveBeenCalledWith('DV-A', expect.any(AbortSignal));
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(viewer()).toBeNull();
  await act(async () => authorization.resolve(sample.identity));
  await waitForViewer();
  expect(viewer()?.getAttribute('data-viewer')).toBe('blob:mount-2');
  expect(mockCreate).toHaveBeenLastCalledWith(sample.blob);
  await leave();
  mockIdentity.mockResolvedValueOnce(sample.identity);
  await render();
  await waitForViewer();
  expect(mockRead).toHaveBeenCalledTimes(1);
  expect(mockIdentity).toHaveBeenCalledTimes(2);
  expect(viewer()?.getAttribute('data-viewer')).toBe('blob:mount-3');
});

test.each(['403 revoked', '503 identity unavailable'])(
  'warm revalidation failure (%s) never falls back to cached bytes and permits a fresh explicit retry',
  async (message: string) => {
    mockRead.mockResolvedValue(fixture().blob);
    await render();
    await leave();
    mockIdentity.mockRejectedValueOnce(new Error(message));
    await render();
    expect(container.textContent).toContain(message);
    expect(viewer()).toBeNull();
    expect(mockRead).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    await render({ page: 9 });
    expect(mockIdentity).toHaveBeenCalledTimes(1);
    expect(mockRead).toHaveBeenCalledTimes(1);
    await act(async () => button('重试读取原件').click());
    expect(mockRead).toHaveBeenCalledTimes(2);
    expect(viewer()).not.toBeNull();
  },
);

test('default version switches partition warm bytes by the exact document version', async () => {
  const first = fixture();
  const second = fixture('DV-B');
  mockRead.mockResolvedValueOnce(first.blob).mockResolvedValueOnce(second.blob);
  await render();
  await render({ documentVersionId: 'DV-B' });
  expect(mockRead).toHaveBeenCalledTimes(2);
  expect(mockIdentity).not.toHaveBeenCalled();
  expect(mockCreate).toHaveBeenLastCalledWith(second.blob);
  mockIdentity.mockResolvedValueOnce(first.identity);
  await render();
  await waitForViewer();
  expect(mockRead).toHaveBeenCalledTimes(2);
  expect(mockIdentity).toHaveBeenCalledWith('DV-A', expect.any(AbortSignal));
  expect(mockCreate).toHaveBeenLastCalledWith(first.blob);
  expect(viewer()?.getAttribute('data-scope')).toBe('DV-A:PR-1:R2');
});

test.each(['digest', 'length'])(
  'warm %s mismatches download current authorized bytes before default display',
  async (mismatch: string) => {
    const first = fixture();
    const replacement = fixture('DV-A replacement');
    mockRead
      .mockResolvedValueOnce(first.blob)
      .mockResolvedValueOnce(replacement.blob);
    await render();
    await leave();
    mockIdentity.mockResolvedValueOnce({
      ...first.identity,
      ...(mismatch === 'digest'
        ? { sha256: 'a'.repeat(64) }
        : { byteLength: first.blob.size + 1 }),
    });
    await render();
    await waitForViewer();
    expect(mockRead).toHaveBeenCalledTimes(2);
    expect(mockRead).toHaveBeenLastCalledWith('DV-A', expect.any(AbortSignal));
    expect(mockCreate).toHaveBeenLastCalledWith(replacement.blob);
  },
);

test('a warm authorization completed after an identity change cannot resurrect cached bytes', async () => {
  const sample = fixture();
  mockRead.mockResolvedValue(sample.blob);
  await render();
  await leave();
  const authorization = deferred<Identity>();
  mockIdentity.mockReturnValueOnce(authorization.promise);
  await render();
  const signal: AbortSignal = mockIdentity.mock.calls[0][1];
  await changeSession();
  expect(signal.aborted).toBe(true);
  await act(async () => authorization.resolve(sample.identity));
  expect(viewer()).toBeNull();
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(mockRead).toHaveBeenCalledTimes(1);
  await act(async () => button('重试读取原件').click());
  expect(mockRead).toHaveBeenCalledTimes(2);
  expect(viewer()).not.toBeNull();
});

test('late warm authorization cannot replace the newer exact-version PDF or preserve stale authorization', async () => {
  const first = fixture();
  const second = fixture('DV-B');
  mockRead.mockResolvedValueOnce(first.blob).mockResolvedValueOnce(second.blob);
  await render();
  await leave();
  const authorization = deferred<Identity>();
  mockIdentity.mockReturnValueOnce(authorization.promise);
  await render();
  const signal: AbortSignal = mockIdentity.mock.calls[0][1];
  await render({ documentVersionId: 'DV-B' });
  expect(signal.aborted).toBe(true);
  expect(viewer()?.getAttribute('data-scope')).toBe('DV-B:PR-1:R2');
  await act(async () => authorization.resolve(first.identity));
  expect(mockCreate).toHaveBeenCalledTimes(2);
  expect(mockCreate).toHaveBeenLastCalledWith(second.blob);
  expect(viewer()?.getAttribute('data-viewer')).toBe('blob:mount-2');
  mockRead.mockResolvedValueOnce(first.blob);
  await render();
  expect(mockRead).toHaveBeenNthCalledWith(3, 'DV-A', expect.any(AbortSignal));
  expect(mockIdentity).toHaveBeenCalledTimes(1);
  expect(viewer()?.getAttribute('data-scope')).toBe('DV-A:PR-1:R2');
});

test('explicit autoLoad=false still defers PDF work and later exact versions until reading intent', async () => {
  mockRead.mockResolvedValue(fixture().blob);
  await render({ autoLoad: false });
  expect(mockRead).not.toHaveBeenCalled();
  expect(mockLoad).not.toHaveBeenCalled();
  await act(async () => button('读取受控原件').click());
  expect(mockRead).toHaveBeenCalledTimes(1);
  expect(viewer()).not.toBeNull();
  await render({ documentVersionId: 'DV-B', autoLoad: false });
  expect(viewer()).toBeNull();
  expect(mockRead).toHaveBeenCalledTimes(1);
  await act(async () => button('读取受控原件').click());
  expect(mockRead).toHaveBeenLastCalledWith('DV-B', expect.any(AbortSignal));
  expect(viewer()).not.toBeNull();
});

test('StrictMode default mount discards the superseded effect and leaves only one current authorized download', async () => {
  mockRead.mockResolvedValueOnce(fixture().blob);
  await act(async () =>
    root.render(createElement(StrictMode, null, element())),
  );
  expect(mockRead).toHaveBeenCalledTimes(1);
  expect(mockRead.mock.calls[0][1].aborted).toBe(false);
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(viewer()).not.toBeNull();
});
