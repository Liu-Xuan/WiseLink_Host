import type { Root } from 'react-dom/client';
import type { JobAidWorkingReadState } from '../../client/src/pages/DocumentParsingPage/useJobAidWorkingRead';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';
import { tdmsNativeEvidenceFixture } from './fixtures/tdms-native-evidence.fixture';
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
dom.window.scrollTo = () => undefined;
const prior = new Map<string, PropertyDescriptor | undefined>();
for (const name of ['window', 'document', 'HTMLElement', 'customElements', 'CustomEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'fetch', 'IS_REACT_ACT_ENVIRONMENT', 'ResizeObserver']) {
  prior.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: dom.window[name] });
}
const fetchSpy = jest.fn(() => { throw new Error('Diagnostics must use the existing parent response'); });
Object.assign(globalThis, { fetch: fetchSpy, IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} disconnect() {} } });
const { act, createElement }: typeof import('react') = require('react');
const { createRoot }: typeof import('react-dom/client') = require('react-dom/client');
const { default: Diagnostic }: typeof import('../../client/src/pages/DocumentParsingPage/runtime-monitor/WorkItemRuntimeDiagnostic') = require('../../client/src/pages/DocumentParsingPage/runtime-monitor/WorkItemRuntimeDiagnostic');
let root: Root;
let host: HTMLElement;
const refresh = jest.fn();
const navigate = jest.fn();
function reading(): JobAidWorkingReadState {
  const data = jobAidReadingFixture();
  data.current!.content.evidence = [tdmsNativeEvidenceFixture()];
  data.current!.createdAt = '2026-10-04T10:00:00Z';
  return { data, error: null, isRefreshing: false, temporaryError: false, baseFallbackAllowed: true,
    observedAt: '2026-10-23T12:00:00Z', refresh };
}
async function render(read: JobAidWorkingReadState, generation = 1, workItemId = 'work-item-test') {
  await act(async () => root.render(createElement(Diagnostic, { read, workItemId, sessionGeneration: generation,
    onRefresh: refresh, onOpenPanel: navigate, onOpenWorkRevision: navigate })));
}
function element() { return host.querySelector('wiselink-monitor')!; }
function shadow() { return element().shadowRoot!; }
function detail() { return host.querySelector('[aria-label="已保存 TDMS 来源详情"]'); }
async function click(selector: string) {
  const button = shadow().querySelector(selector) as HTMLButtonElement;
  expect(button).not.toBeNull();
  await act(async () => button.click());
}
async function openSource() {
  await click('[data-view="flow"]');
  await click('[data-node="business.company_records"]');
  const button = shadow().querySelector('[data-nav="source"]') as HTMLButtonElement;
  const ref = button.dataset.ref!;
  await act(async () => button.click());
  return ref;
}
async function emit(ref: string, extra: Record<string, string> = {}) {
  await act(async () => element().dispatchEvent(new CustomEvent('wiselink-navigate', { detail: {
    kind: 'source', nodeId: 'business.company_records', scopeKey: '1:work-item-test', subjectRef: 'work-item-test', ref, ...extra,
  } })));
}
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); refresh.mockReset(); navigate.mockReset(); fetchSpy.mockClear(); });
afterEach(async () => { expect(fetchSpy).not.toHaveBeenCalled(); await act(async () => root.unmount()); host.remove(); });
afterAll(() => { for (const [name, value] of prior) { if (value) Object.defineProperty(globalThis, name, value); else Reflect.deleteProperty(globalThis, name); } dom.window.close(); });

it('opens the exact saved source from the real monitor and shows versions, receipt, body and saved-work binding', async () => {
  const read = reading();
  await render(read);
  await openSource();
  expect(shadow().textContent).toContain('历史 READ 2026-10-03T10:00:00Z');
  expect(shadow().textContent).toContain('UNKNOWN');
  await click('[data-node="assessment.research"]');
  expect(shadow().textContent).toContain('work-before-test');
  expect(shadow().textContent).toContain('该工作来源证据未在本次响应中提供');
  const text = detail()!.textContent!;
  for (const value of ['TDMS 技术对象版次 R00', 'TDMS 技术对象迭代 2', '业务文件版次 B', 'assessment-observation-1', 'native-receipt-1',
    'task-1', 'work-current-test', 'request-test', 'attempt-test', 'fixture-capture-1', 'content.opinions[0]', 'If installed, verify configuration.']) expect(text).toContain(value);
  expect(text).not.toContain(read.observedAt);
  expect(navigate).not.toHaveBeenCalled();
  await click('[data-node="business.company_records"]');
  await click('[data-nav="artifact"]');
  expect(navigate).toHaveBeenCalledWith(reading().data!.current!.workRevisionRef);
  await click('#refresh');
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('resolves against the latest same-scope response and rejects old receipt, wrong node and wrong scope navigation', async () => {
  const read = reading();
  await render(read);
  const oldRef = await openSource();
  const next = reading();
  const evidence = tdmsNativeEvidenceFixture();
  evidence.nativeReadReceipt.receiptRef = 'replacement-receipt';
  evidence.excerpt = 'Replacement body from the next parent response';
  next.data!.current!.content.evidence = [evidence];
  await render(next);
  expect(detail()).toBeNull();
  await emit(oldRef);
  expect(detail()).toBeNull();
  await openSource();
  expect(detail()!.textContent).toContain(evidence.excerpt);
  const close = detail()!.querySelector('button')!;
  await act(async () => close.click());
  const ref = (shadow().querySelector('[data-nav="source"]') as HTMLButtonElement).dataset.ref!;
  for (const extra of [{ scopeKey: 'old-scope' }, { subjectRef: 'another-work' }, { nodeId: 'assessment.overall' }]) {
    await emit(ref, extra);
    expect(detail()).toBeNull();
  }
  expect(navigate).not.toHaveBeenCalled();
});

it('retains the labelled previous observation on temporary error and removes body immediately when authority or scope changes', async () => {
  const read = reading();
  await render(read);
  await openSource();
  await render({ ...read, error: 'network', temporaryError: true });
  expect(host.textContent).toContain('保留上次获权观察');
  expect(detail()).not.toBeNull();
  await render({ ...read, data: null, error: 'denied', observedAt: null, temporaryError: false });
  expect(detail()).toBeNull();
  expect(host.textContent).not.toContain(tdmsNativeEvidenceFixture().excerpt);
  await render(read, 2);
  expect(detail()).toBeNull();
  await openSource();
  await render(read, 2, 'another-work');
  expect(detail()).toBeNull();
});

it('shows a malformed native-carrier gap without offering a readable body', async () => {
  const read = reading();
  const malformed = tdmsNativeEvidenceFixture();
  malformed.nativeSource.state = { rawCode: 'Pending', rawName: 'Pending' };
  read.data!.current!.content.evidence = [malformed];
  await render(read);
  await click('[data-view="flow"]');
  await click('[data-node="business.company_records"]');
  expect(shadow().textContent).toContain('未建立读取关系');
  expect(shadow().querySelector('[data-nav="source"]')).toBeNull();
  expect(detail()).toBeNull();
  expect(host.textContent).not.toContain(malformed.excerpt);
});
