import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { useSummaryResource } from '@client/src/features/derived-summary/useSummaryResource';

let mockGeneration = 1;
jest.mock('@client/src/api/canonical-host', () => ({ getCanonicalHostClientSessionGeneration: () => mockGeneration }));

describe('summary reading polling with a slow response', () => {
  let dom: JSDOM;
  let root: Root;
  let current: ReturnType<typeof useSummaryResource<string>>;
  let pending: Array<{ signal: AbortSignal; resolve: (value: string) => void; reject: (reason: Error) => void }>;
  let load: jest.Mock<Promise<string>, [AbortSignal]>;
  const original = new Map<string, PropertyDescriptor | undefined>();

  function Reading({ id = 'fleet', session = 1 }: { id?: string; session?: number }) {
    current = useSummaryResource(id, session, load, { preserveWhileLoading: true, pollIntervalMs: 15_000 });
    return createElement('div', null, current.data ?? (current.loading ? 'loading' : current.error));
  }
  async function render(id = 'fleet', session = 1) {
    await act(async () => root.render(createElement(Reading, { id, session })));
  }
  async function advance(ms: number) {
    await act(async () => { await jest.advanceTimersByTimeAsync(ms); });
  }
  beforeEach(() => {
    mockGeneration = 1;
    dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
      IS_REACT_ACT_ENVIRONMENT: true })) {
      original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, value });
    }
    jest.useFakeTimers();
    root = createRoot(dom.window.document.getElementById('root')!);
    pending = [];
    load = jest.fn(signal => new Promise<string>((resolve, reject) => pending.push({ signal, resolve, reject })));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    jest.useRealTimers();
    dom.window.close();
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    original.clear();
  });

  it('finishes a read taking longer than several polling intervals without aborting it', async () => {
    await render();
    await advance(45_000);
    expect(load).toHaveBeenCalledTimes(1);
    expect(pending[0]!.signal.aborted).toBe(false);
    await act(async () => pending[0]!.resolve('机型 Wiki 正文'));
    expect(current.data).toBe('机型 Wiki 正文');
    expect(current.loading).toBe(false);
    await advance(15_000);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('retains the visible result and does not restart a pending read on focus or refresh', async () => {
    await render();
    await act(async () => pending[0]!.resolve('已保存正文'));
    await advance(15_000);
    expect(current.data).toBe('已保存正文');
    await act(async () => {
      dom.window.dispatchEvent(new dom.window.Event('focus'));
      current.refresh();
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(pending[1]!.signal.aborted).toBe(false);
    await act(async () => pending[1]!.resolve('更新正文'));
    expect(current.data).toBe('更新正文');
  });

  it('still aborts the old identity and ignores its late response after navigation', async () => {
    await render();
    await render('other-summary');
    expect(pending[0]!.signal.aborted).toBe(true);
    await act(async () => pending[0]!.resolve('旧页面正文'));
    expect(current.data).toBeNull();
    await act(async () => pending[1]!.resolve('新页面正文'));
    expect(current.data).toBe('新页面正文');
  });

  it('clears the prior body when the subsequent permission check fails', async () => {
    await render();
    await act(async () => pending[0]!.resolve('先前可读正文'));
    await advance(15_000);
    await act(async () => pending[1]!.reject(new Error('不可读取')));
    expect(current.data).toBeNull();
    expect(current.error).toBe('不可读取');
  });

  it('does not show or continue polling a response from an expired user session', async () => {
    await render();
    mockGeneration = 2;
    await act(async () => pending[0]!.resolve('旧账号正文'));
    await advance(30_000);
    expect(current.data).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
    await render('fleet', 2);
    await act(async () => pending[1]!.resolve('当前账号正文'));
    expect(current.data).toBe('当前账号正文');
  });
});
