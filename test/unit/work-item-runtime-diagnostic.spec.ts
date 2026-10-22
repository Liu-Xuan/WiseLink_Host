import type { Root } from 'react-dom/client';
import type { JobAidWorkingReadState } from '../../client/src/pages/DocumentParsingPage/useJobAidWorkingRead';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
dom.window.scrollTo = () => undefined;
const prior = new Map<string, PropertyDescriptor | undefined>();
for (const name of ['window', 'document', 'HTMLElement', 'customElements', 'CustomEvent', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  prior.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: dom.window[name] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} disconnect() {} } });
const { act, createElement }: typeof import('react') = require('react');
const { createRoot }: typeof import('react-dom/client') = require('react-dom/client');
const { default: Diagnostic }: typeof import('../../client/src/pages/DocumentParsingPage/runtime-monitor/WorkItemRuntimeDiagnostic') = require('../../client/src/pages/DocumentParsingPage/runtime-monitor/WorkItemRuntimeDiagnostic');
let root: Root;
let host: HTMLElement;
const refresh = jest.fn();
const navigate = jest.fn();
function reading(): JobAidWorkingReadState {
  return { data: jobAidReadingFixture(), error: null, isRefreshing: false, temporaryError: false, baseFallbackAllowed: true,
    observedAt: '2026-10-22T12:00:00Z', refresh };
}
async function render(read: JobAidWorkingReadState) {
  await act(async () => root.render(createElement(Diagnostic, {
    read, workItemId: jobAidReadingFixture().workItemId, sessionGeneration: 1,
    onRefresh: refresh, onOpenPanel: navigate,
  })));
}
function element() { return host.querySelector('wiselink-monitor')!; }
function shadow() { return element().shadowRoot!; }
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); refresh.mockReset(); navigate.mockReset(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
afterAll(() => { for (const [name, value] of prior) { if (value) Object.defineProperty(globalThis, name, value); else Reflect.deleteProperty(globalThis, name); } dom.window.close(); });
it('renders the actual custom element, refreshes through parent and preserves selection on a same-scope observation', async () => {
  const read = reading();
  await render(read);
  expect(shadow().textContent).toContain('仅最新调查尝试');
  await act(async () => (shadow().querySelector('#refresh') as HTMLButtonElement).click());
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => (shadow().querySelector('[data-view="flow"]') as HTMLButtonElement).click());
  const original = element();
  await render({ ...read, observedAt: '2026-10-22T12:01:00Z' });
  expect(element()).toBe(original);
  expect((element() as unknown as { view: string }).view).toBe('flow');
});
it('retains the last timestamp on temporary failure, clears revoked content, and rejects stale navigation', async () => {
  const read = reading();
  await render({ ...read, error: 'network', temporaryError: true });
  expect(host.textContent).toContain('保留上次获权观察');
  expect(shadow().textContent).toContain('JobAid 调查');
  await act(async () => element().dispatchEvent(new CustomEvent('wiselink-navigate', { detail: { kind: 'artifact', nodeId: 'assessment.research', scopeKey: 'old' } })));
  expect(navigate).not.toHaveBeenCalled();
  await act(async () => element().dispatchEvent(new CustomEvent('wiselink-navigate', { detail: { kind: 'artifact', nodeId: 'assessment.research', scopeKey: `1:${read.data!.workItemId}`, subjectRef: read.data!.workItemId, ref: read.data!.current!.workRevisionRef } })));
  expect(navigate).toHaveBeenCalledWith('assessment');
  await render({ ...read, data: null, observedAt: null, error: 'denied', temporaryError: false });
  expect(shadow().textContent).not.toContain('JobAid 调查');
  expect(shadow().textContent).not.toContain('已保存工作');
});

it('shows refreshing without replacing the observation and rejects a stale same-scope attempt', async () => {
  const read = reading();
  read.data = { ...read.data!, latestAttempt: { attemptId: 'attempt-new', status: 'RUNNING', inputRevision: 2 } };
  await render({ ...read, isRefreshing: true });
  expect(shadow().textContent).toContain('刷新中');
  const detail = { kind: 'request', nodeId: 'assessment.research', scopeKey: `1:${read.data.workItemId}`, subjectRef: read.data.workItemId, recordKind: 'attempt', ref: 'attempt-old', attemptId: 'attempt-old' };
  await act(async () => element().dispatchEvent(new CustomEvent('wiselink-navigate', { detail })));
  expect(navigate).not.toHaveBeenCalled();
  await act(async () => element().dispatchEvent(new CustomEvent('wiselink-navigate', { detail: { ...detail, ref: 'attempt-new', attemptId: 'attempt-new' } })));
  expect(navigate).toHaveBeenCalledWith('review');
});

it('keeps four native event timestamps distinct and does not turn creation into queue/readiness time', async () => {
  const read = reading();
  const latest = { attemptId: 'timed-attempt', status: 'SUCCEEDED', inputRevision: 2,
    createdAt: '2026-10-22T11:00:00Z', startedAt: '2026-10-22T11:01:00Z',
    firstSavedAt: '2026-10-22T11:02:00Z', completedAt: '2026-10-22T11:03:00Z' };
  read.data = { ...read.data!, latestAttempt: latest };
  await render(read);
  await act(async () => (shadow().querySelector('[data-request="timed-attempt"]') as HTMLButtonElement).click());
  for (const label of ['请求记录', '执行开始', '首次有效保存', '执行终态']) expect(shadow().textContent).toContain(label);
  for (const time of [latest.createdAt, latest.startedAt, latest.firstSavedAt, latest.completedAt]) expect(shadow().textContent).toContain(time);
  expect(host.textContent).toContain('就绪、首次可读与 ACK 时间尚未提供');
});
