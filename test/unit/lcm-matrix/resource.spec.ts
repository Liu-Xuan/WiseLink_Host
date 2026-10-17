import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import { useLcmMatrixResource, LCM_MATRIX_QUERY_ROOT } from '@client/src/pages/WorkspaceHomePage/useLcmMatrixResource';

describe('matrix raw/derived browser state and cancellation isolation', () => {
  let dom: JSDOM, root: Root, element: HTMLDivElement, client: QueryClient;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><body></body>', { url: 'https://test.invalid' });
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
      navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    element = document.createElement('div'); document.body.append(element);
    root = createRoot(element); client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(async () => {
    await act(async () => root.unmount()); client.clear(); dom.window.close();
    for (const [key, value] of originals) {
      if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key);
    }
    originals.clear();
  });
  const onLost = jest.fn();
  function Probe({ scope, load }: { scope: string; load(signal: AbortSignal): Promise<string> }) {
    const state = useLcmMatrixResource(scope, true, load, onLost);
    return createElement('div', null, state.value ?? state.error ?? 'pending');
  }
  async function render(scope: string, load: (signal: AbortSignal) => Promise<string>) {
    await act(async () => root.render(createElement(QueryClientProvider, { client },
      createElement(Probe, { scope, load }))));
  }
  it('clears private data immediately on scope/account changes and ignores a late old response', async () => {
    const first = async () => 'PRIVATE_USER_A'; await render('actor-A/readset-old', first);
    expect(element.textContent).toBe('PRIVATE_USER_A');
    let finishOld!: (value: string) => void, finishNew!: (value: string) => void;
    const old = jest.fn((signal: AbortSignal) => new Promise<string>(resolve => { finishOld = resolve; void signal; }));
    await render('actor-A/scope-pending', old);
    const current = (signal: AbortSignal) => new Promise<string>(resolve => { finishNew = resolve; void signal; });
    await render('actor-B/readset-new', current);
    expect(element.textContent).not.toContain('PRIVATE_USER_A');
    await act(async () => finishOld('LATE_PRIVATE_USER_A'));
    expect(element.textContent).not.toContain('LATE_PRIVATE_USER_A');
    await act(async () => finishNew('AUTHORIZED_USER_B'));
    expect(element.textContent).toBe('AUTHORIZED_USER_B');
    expect(client.getQueriesData({ queryKey: LCM_MATRIX_QUERY_ROOT }).some(([key]) => String(key).includes('actor-A'))).toBe(false);
  });
  it('reports revoked access and removes previously derived state', async () => {
    onLost.mockClear(); await render('scope-1', async () => 'PRIVATE');
    await render('scope-2', async () => { throw Object.assign(new Error('denied'), { statusCode: 403 }); });
    expect(element.textContent).not.toContain('PRIVATE');
    expect(onLost).toHaveBeenCalled();
  });
});
