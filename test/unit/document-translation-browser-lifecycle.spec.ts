import type { Root } from 'react-dom/client';
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><body></body>');
const prior = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
  prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act, createElement }: typeof import('react') = require('react');
const { createRoot }: typeof import('react-dom/client') = require('react-dom/client');
let mockSession = 1;
const mockListeners = new Set<() => void>();
const mockPrepare = jest.fn(); const mockContinue = jest.fn();
jest.mock('../../client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => mockSession,
  subscribeCanonicalHostClientSession: (listener: () => void) => { mockListeners.add(listener); return () => mockListeners.delete(listener); },
  prepareDocumentTranslationContinuation: (...args: unknown[]) => mockPrepare(...args),
  continueDocumentTranslation: (...args: unknown[]) => mockContinue(...args),
}));
jest.mock('../../client/src/components/ui/button', () => ({ Button: ({ size: _size, variant: _variant, ...props }: any) => require('react').createElement('button', props) }));
const Component = require('../../client/src/pages/DocumentParsingPage/DocumentTranslationContinuation').default;
let root: Root; let container: HTMLElement;
const onContinued = jest.fn(); const onAccessRejected = jest.fn();
const ready = { state: 'READY', reason: 'CHECK_SAVED_BLOCKS_FIRST', action: 'RESUME_KNOWN_FAILURE', attempt: { attemptRef: 'DTQ-one', status: 'FAILED' } };
async function render(documentVersionId = 'DV-one') { await act(async () => root.render(createElement(Component, {
  documentVersionId, parseRunId: 'PR-one', observationKey: '1', onContinued, onAccessRejected,
}))); }
function button(text: string) { return [...container.querySelectorAll('button')].find(el => el.textContent === text)!; }
async function click(text: string) { await act(async () => button(text).click()); }
beforeEach(() => { mockSession = 1; mockPrepare.mockReset().mockResolvedValue(ready); mockContinue.mockReset(); onContinued.mockReset(); onAccessRejected.mockReset(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); expect(mockListeners.size).toBe(0); });
afterAll(() => { dom.window.close(); for (const [key, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
it('deduplicates rapid clicks and retries a lost receipt using the same predecessor', async () => {
  let reject!: (error: Error) => void;
  mockContinue.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; })).mockResolvedValue({});
  await render();
  await act(async () => { const el = button('检查已保存译文并继续'); el.click(); el.click(); });
  expect(mockContinue).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error('network lost')));
  expect(container.textContent).toContain('受理结果尚未确认');
  await click('核对本次续接');
  expect(mockContinue.mock.calls[1][1]).toEqual(mockContinue.mock.calls[0][1]);
  expect(onContinued).toHaveBeenCalledTimes(1);
});
it('aborts stale POST on session switch and ignores its late success', async () => {
  let resolve!: (value: unknown) => void;
  mockContinue.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await render(); await click('检查已保存译文并继续');
  const signal = mockContinue.mock.calls[0][2];
  await act(async () => { mockSession++; mockListeners.forEach(listener => listener()); });
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({}));
  expect(onContinued).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain('核对本次续接');
});
it('discards an old document GET and clears content on access revocation', async () => {
  let resolve!: (value: unknown) => void;
  mockPrepare.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await render(); await render('DV-two');
  await act(async () => resolve({ ...ready, reason: 'TARGET_READABLE', action: null }));
  expect(container.textContent).toContain('检查已保存译文并继续');
  mockContinue.mockRejectedValue(Object.assign(new Error('access revoked'), { statusCode: 403 }));
  await click('检查已保存译文并继续');
  expect(onAccessRejected).toHaveBeenCalledWith('access revoked');
  expect(container.textContent).not.toContain('检查已保存译文并继续');
});
