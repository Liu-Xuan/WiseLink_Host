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
async function render(read: JobAidWorkingReadState, scope: { workItemId?: string; sessionGeneration?: number } = {}) {
  await act(async () => root.render(createElement(Diagnostic, {
    read, workItemId: jobAidReadingFixture().workItemId, sessionGeneration: 1,
    ...scope,
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
  expect(host.textContent).toContain('就绪与首次可读时间尚未提供');
  expect(host.textContent).toContain('外层自动处理 ACK 时间尚未提供');
});

it.each(['RUNNING', 'COMMITTING'])('renders an older outer ACK independently from the newer %s attempt and its times', async status => {
  const read = reading();
  const acknowledgedAt = '2026-10-21T10:00:00Z';
  read.data = { ...read.data!, autoProcessingAcknowledgement: {
    workItemId: read.data!.workItemId, requestId: 'original-outer-request', documentVersionId: 'DV-test', acknowledgedAt,
  }, latestAttempt: { attemptId: 'new-inner-attempt', status, inputRevision: 2,
    createdAt: '2026-10-22T11:00:00Z', startedAt: '2026-10-22T11:01:00Z', completedAt: null } };
  await render(read);
  const acknowledgement = host.querySelector('[aria-label="外层自动处理 ACK"]');
  expect(acknowledgement?.textContent).toContain('原请求 original-outer-request');
  expect(acknowledgement?.querySelector('time')?.dateTime).toBe(acknowledgedAt);
  await act(async () => (shadow().querySelector('[data-request="new-inner-attempt"]') as HTMLButtonElement).click());
  expect(shadow().textContent).toContain(status);
  expect(shadow().textContent).toContain('2026-10-22T11:00:00Z');
  expect(shadow().textContent).toContain('2026-10-22T11:01:00Z');
  expect(shadow().textContent).not.toContain(acknowledgedAt);
  expect(host.textContent).toContain('就绪与首次可读时间尚未提供');
  expect(host.textContent).not.toContain('外层自动处理 ACK 时间尚未提供');
});

it('preserves the acknowledged observation during refresh/error and clears it on null, revoked data or object change', async () => {
  const read = reading();
  read.data = { ...read.data!, autoProcessingAcknowledgement: {
    workItemId: read.data!.workItemId, requestId: 'retained-outer-request',
    documentVersionId: 'DV-test', acknowledgedAt: '2026-10-21T10:00:00Z',
  } };
  await render({ ...read, isRefreshing: true });
  expect(host.textContent).toContain('retained-outer-request');
  await render({ ...read, error: 'network', temporaryError: true });
  expect(host.textContent).toContain('retained-outer-request');
  expect(host.textContent).toContain('保留上次获权观察');
  await render({ ...read, data: { ...read.data, autoProcessingAcknowledgement: null } });
  expect(host.textContent).not.toContain('retained-outer-request');
  await render(read, { workItemId: 'another-authorized-object' });
  expect(host.textContent).not.toContain('retained-outer-request');
  await render({ ...read, data: null, error: 'denied' }, { sessionGeneration: 2 });
  expect(host.textContent).not.toContain('retained-outer-request');
});


it.each(['RUNNING', 'COMMITTING', 'SUCCEEDED'])('shows the selected Overall %s times alongside independent research and ACK, with bounded navigation', async status => {
  const read = reading();
  read.data = { ...read.data!, autoProcessingAcknowledgement: {
    workItemId: read.data!.workItemId, requestId: 'outer-ack', documentVersionId: 'DV-test',
    acknowledgedAt: '2026-10-21T10:00:00Z',
  }, latestAttempt: { attemptId: 'dynamic-done', status: 'SUCCEEDED', inputRevision: 2 },
  selectedExecution: { actionType: 'OPENCLAW_OVERALL_SYNTHESIS', attemptId: 'overall-selected',
    attemptRef: 'actual-overall-operation', status, createdAt: '2026-10-23T01:00:00Z',
    startedAt: '2026-10-23T01:01:00Z', completedAt: status === 'SUCCEEDED' ? '2026-10-23T01:03:00Z' : null } };
  await render(read);
  expect(host.textContent).toContain('outer-ack');
  expect(shadow().textContent).toContain('有限观察');
  expect(shadow().querySelector('[data-request="dynamic-done"]')).not.toBeNull();
  await act(async () => (shadow().querySelector('[data-request="overall-selected"]') as HTMLButtonElement).click());
  for (const time of ['2026-10-23T01:00:00Z', '2026-10-23T01:01:00Z']) expect(shadow().textContent).toContain(time);
  expect(shadow().textContent).toContain('查看综合面板');
  expect(shadow().textContent).toContain('不定位单条尝试');
  const detail = { kind: 'request', nodeId: 'assessment.overall', scopeKey: `1:${read.data.workItemId}`,
    subjectRef: read.data.workItemId, recordKind: 'attempt', ref: 'overall-selected', attemptId: 'overall-selected' };
  for (const wrong of [{ ...detail, nodeId: 'assessment.research' }, { ...detail, attemptId: 'wrong' },
    { ...detail, requestId: 'overall-selected' }]) {
    await act(async () => element().dispatchEvent(new CustomEvent('wiselink-navigate', { detail: wrong })));
  }
  expect(navigate).not.toHaveBeenCalled();
  await act(async () => element().dispatchEvent(new CustomEvent('wiselink-navigate', { detail })));
  expect(navigate).toHaveBeenCalledWith('assessment');
});

it('replaces a same-status selected identity in the current view and clears it on object/session/revocation', async () => {
  const read = reading();
  read.data = { ...read.data!, selectedExecution: { actionType: 'OPENCLAW_OVERALL_SYNTHESIS',
    attemptId: 'overall-old', attemptRef: 'old-operation', status: 'RUNNING',
    createdAt: '2026-10-23T01:00:00Z', startedAt: null, completedAt: null } };
  await render(read);
  const next = { ...read, data: { ...read.data, selectedExecution: {
    ...read.data.selectedExecution!, attemptId: 'overall-new', attemptRef: 'new-operation',
  } } };
  await render(next);
  expect(shadow().querySelector('[data-request="overall-old"]')).toBeNull();
  expect(shadow().querySelector('[data-request="overall-new"]')).not.toBeNull();
  await act(async () => element().dispatchEvent(new CustomEvent('wiselink-navigate', { detail: {
    kind: 'request', nodeId: 'assessment.overall', scopeKey: `1:${read.data!.workItemId}`,
    recordKind: 'attempt', ref: 'overall-old', attemptId: 'overall-old',
  } })));
  expect(navigate).not.toHaveBeenCalled();
  await render(next, { workItemId: 'other-object' });
  expect(shadow().querySelector('[data-request="overall-new"]')).toBeNull();
  await render({ ...next, data: null, error: 'denied', observedAt: null }, { sessionGeneration: 2 });
  expect(shadow().textContent).not.toContain('overall-new');
});
