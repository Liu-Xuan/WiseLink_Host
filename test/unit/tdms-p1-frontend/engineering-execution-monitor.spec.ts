import type { Root } from 'react-dom/client';
import type { TdmsFileServiceRecordReadResponse } from '@shared/tdms-file-service-import.interface';
import type { WiseLinkMonitorElement } from '@client/src/pages/DocumentParsingPage/runtime-monitor/monitor-types';
import { adaptEngineeringExecutionRead, engineeringExecutionDiagnosticReference, engineeringExecutionMonitorScope,
  engineeringExecutionSourceRef } from '@client/src/features/tdms-source/tdms-engineering-execution-monitor';
import { sourceRead } from './fixtures';

let sessionGeneration = 1;
const sourcePage = jest.fn();
const sourceHistory = jest.fn();
const sourceRecord = jest.fn();
const sourceRelations = jest.fn();
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => sessionGeneration,
  subscribeCanonicalHostClientSession: () => () => undefined,
  isCanonicalHostClientSessionAuthenticationRequired: () => false,
  readTdmsDocumentSource: (...args: unknown[]) => sourcePage(...args),
  readTdmsSourceHistory: (...args: unknown[]) => sourceHistory(...args),
  readTdmsSourceRecord: (...args: unknown[]) => sourceRecord(...args),
  readTdmsSourceRelations: (...args: unknown[]) => sourceRelations(...args),
}));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
dom.window.scrollTo = () => undefined;
dom.window.HTMLElement.prototype.scrollIntoView = jest.fn();
const prior = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, customElements: dom.window.customElements, CustomEvent: dom.window.CustomEvent,
  requestAnimationFrame: dom.window.requestAnimationFrame, cancelAnimationFrame: dom.window.cancelAnimationFrame,
  IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} disconnect() {} } })) {
  prior.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
const { act, createElement }: typeof import('react') = require('react');
const { createRoot }: typeof import('react-dom/client') = require('react-dom/client');
const { MemoryRouter }: typeof import('react-router-dom') = require('react-router-dom');
const { TdmsRecordDetails }: typeof import('@client/src/features/tdms-source/TdmsRecordDetails') = require('@client/src/features/tdms-source/TdmsRecordDetails');
const { TdmsDocumentSourceReading }: typeof import('@client/src/features/tdms-source/TdmsDocumentSourceReading') = require('@client/src/features/tdms-source/TdmsDocumentSourceReading');
const parentScope = 'app:tenant:actor:session:document';

function reading(revision = 'engineering-1'): TdmsFileServiceRecordReadResponse {
  const read = sourceRead(revision);
  read.record.recordKind = 'ENGINEERING_FILE'; read.record.content = {};
  read.record.capturedAt = '2026-10-15T00:00:00.000Z';
  read.receipt.readAt = '2026-10-22T00:00:00.000Z';
  read.bodyReadPolicy!.kind = 'NON_OPINION_SOURCE';
  read.engineeringExecution = {
    sourceRevisionRef: revision, sourceRecordId: read.record.sourceRecordId,
    sourceVersion: read.record.sourceVersion, businessVersion: read.record.businessVersion ?? null,
    requirementCoverage: 'NOT_CAPTURED', targetAircraftCoverage: 'UNKNOWN', executionVerified: false,
    windows: [{ tableId: 'status-window', tableTitle: 'Related Status', sourceLocator: '#status',
      observedAt: '2026-10-13T00:00:00.000Z', enumerationState: 'VALUE', stopReason: null,
      reportedRowCount: 2, observedAircraftCount: 1, sourceViewEvidence: null,
      rows: [0, 1].map(index => ({ sourceRecordId: `status-${index}`, number: `Status ${index}`,
        stateRaw: 'Completed', sourceModifiedRaw: '2026-10-12 09:00',
        executionStatus: { engineeringDocumentRef: read.record.sourceRecordId, engineeringDocumentNumber: 'AEO-TEST',
          assetRef: 'aircraft-1', assetNumber: 'SYNTHETIC-AIRCRAFT', feedbackRef: 'feedback-1', feedbackNumber: 'Feedback 1',
          executedDateRaw: '2026-10-12', expiredDateRaw: null, stateComments: null, operatorBase: null } })),
    }],
  };
  return read;
}

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  sessionGeneration = 1;
  [sourcePage, sourceHistory, sourceRecord, sourceRelations].forEach(mock => mock.mockReset());
  (dom.window.HTMLElement.prototype.scrollIntoView as jest.Mock).mockClear();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
afterAll(() => {
  for (const [name, value] of prior) {
    if (value) Object.defineProperty(globalThis, name, value); else Reflect.deleteProperty(globalThis, name);
  }
  dom.window.close();
});
async function mountDetail(read: TdmsFileServiceRecordReadResponse, scope = parentScope, onRefresh?: () => void) {
  await act(async () => root.render(createElement(MemoryRouter,
    { future: { v7_startTransition: true, v7_relativeSplatPath: true } },
    createElement(TdmsRecordDetails, { read, monitorScopeKey: scope, onRefresh }))));
}
async function openMonitor(): Promise<WiseLinkMonitorElement> {
  const detail = host.querySelector<HTMLDetailsElement>('[aria-label="当前单机来源运行图"]')!;
  await act(async () => { detail.open = true; detail.dispatchEvent(new dom.window.Event('toggle')); });
  return host.querySelector('wiselink-monitor') as WiseLinkMonitorElement;
}

it('projects only exact read tables and rows, separates all observation times, and leaves business/request coverage unknown', () => {
  const read = reading(); const before = JSON.stringify(read);
  const runtime = adaptEngineeringExecutionRead(read, parentScope)!;
  expect(JSON.stringify(read)).toBe(before);
  expect(runtime.nodes.map(node => node.id)).toEqual(['business.aeo_execution', 'surface.reading']);
  expect(runtime.scope.id).toBe(read.record.sourceRevisionRef);
  expect(runtime.meta.observedAt).toBe(read.receipt.readAt);
  expect(runtime.meta.scopeKey).toContain(parentScope);
  expect(runtime.meta.scopeKey).toContain(read.receipt.permissionRevision);
  expect(runtime.nodes[0].sourceObservedAt).toBe(read.record.observedAt);
  expect(runtime.nodes[0].summary).toContain(read.record.capturedAt);
  expect(runtime.nodes[0].summary).toContain(read.engineeringExecution!.windows[0].observedAt);
  expect(runtime.nodes[0].artifact).toContain('2 条来源行、1 个飞机原生身份');
  expect(runtime.nodes[0].coverage).toMatchObject({ label: expect.stringContaining('未知'), tone: 'wait' });
  expect(runtime.nodes[0].business).toContain('不证明业务完成');
  expect(runtime.nodes.every(node => node.requests.length === 0 && node.requestCompleteness === 'not_provided')).toBe(true);
  expect(runtime.resources).toBeUndefined();
  expect(JSON.stringify(runtime)).not.toMatch(/completedAt|\d+%/u);
  expect(runtime.edges[0]).toMatchObject({ templateId: 'artifact.reading', status: 'consumed',
    refs: [engineeringExecutionSourceRef('engineering-1', 'status-window'),
      engineeringExecutionSourceRef('engineering-1', 'status-window', 'status-0'),
      engineeringExecutionSourceRef('engineering-1', 'status-window', 'status-1')] });
  expect(runtime.nodes[1].inputRefs).toEqual(runtime.nodes[0].outputs);
});

it('keeps an empty source window readable without inventing target completeness or absent artifacts', () => {
  const read = reading(); read.engineeringExecution!.windows[0].rows = [];
  const runtime = adaptEngineeringExecutionRead(read)!;
  expect(runtime.nodes[0].artifact).toContain('0 条来源行');
  expect(runtime.nodes[0].coverageScope).toContain('不计算整份完成率');
  expect(runtime.edges[0].refs).toEqual([engineeringExecutionSourceRef('engineering-1', 'status-window')]);
  read.engineeringExecution!.windows = [];
  expect(adaptEngineeringExecutionRead(read)!.edges).toEqual([]);
  delete read.engineeringExecution;
  expect(adaptEngineeringExecutionRead(read)).toBeNull();
});

it('refuses mismatched revisions and receipts, and never inspects a denied body', () => {
  const read = reading(); read.engineeringExecution!.sourceRevisionRef = 'wrong';
  expect(() => adaptEngineeringExecutionRead(read)).toThrow('不一致');
  read.engineeringExecution!.sourceRevisionRef = read.record.sourceRevisionRef;
  read.receipt.sourceRevisionRef = 'wrong';
  expect(() => adaptEngineeringExecutionRead(read)).toThrow('不一致');
  const denied = reading(); delete denied.bodyReadPolicy;
  const getter = jest.fn(() => { throw new Error('private body inspected'); });
  Object.defineProperty(denied, 'engineeringExecution', { get: getter });
  expect(adaptEngineeringExecutionRead(denied)).toBeNull();
  expect(getter).not.toHaveBeenCalled();
});

it('accepts only the same current receipt, source revision and exact table or row navigation', () => {
  const read = reading(); const runtime = adaptEngineeringExecutionRead(read, parentScope)!;
  const ref = engineeringExecutionSourceRef('engineering-1', 'status-window', 'status-0');
  const detail = { kind: 'artifact' as const, nodeId: 'business.aeo_execution', scopeKey: runtime.meta.scopeKey,
    subjectRef: 'engineering-1', ref };
  expect(engineeringExecutionDiagnosticReference(detail, runtime)).toBe(ref);
  expect(engineeringExecutionDiagnosticReference({ ...detail, kind: 'source', nodeId: 'surface.reading' }, runtime)).toBe(ref);
  for (const patch of [{ scopeKey: 'old-session' }, { subjectRef: 'old-revision' }, { nodeId: 'wrong' },
    { ref: engineeringExecutionSourceRef('engineering-1', 'other-window', 'status-0') }, { kind: 'request' as const }]) {
    expect(engineeringExecutionDiagnosticReference({ ...detail, ...patch }, runtime)).toBeNull();
  }
  const newer = reading(); newer.receipt.receiptRef = 'new-receipt';
  expect(engineeringExecutionMonitorScope(newer)).not.toBe(engineeringExecutionMonitorScope(read));
  expect(engineeringExecutionDiagnosticReference(detail, adaptEngineeringExecutionRead(newer, parentScope)!)).toBeNull();
});

it('uses real table/row navigation, keeps the table entrance, and hides refresh without a parent callback', async () => {
  const read = reading(); await mountDetail(read);
  expect(host.querySelector('table')).not.toBeNull();
  expect(host.querySelector('wiselink-monitor')).toBeNull();
  const monitor = await openMonitor();
  expect(monitor.shadowRoot!.querySelector('#refresh')).toBeNull();
  const rowRef = engineeringExecutionSourceRef('engineering-1', 'status-window', 'status-1');
  const button = Array.from(monitor.shadowRoot!.querySelectorAll<HTMLButtonElement>('[data-nav="artifact"]'))
    .find(item => item.dataset.ref === rowRef)!;
  await act(async () => button.click());
  expect(document.activeElement?.getAttribute('data-tdms-execution-ref')).toBe(rowRef);
  expect(dom.window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  const tableRef = engineeringExecutionSourceRef('engineering-1', 'status-window');
  const tableButton = Array.from(monitor.shadowRoot!.querySelectorAll<HTMLButtonElement>('[data-nav="artifact"]'))
    .find(item => item.dataset.ref === tableRef)!;
  await act(async () => tableButton.click());
  expect(document.activeElement?.getAttribute('data-tdms-execution-ref')).toBe(tableRef);
  expect(sourcePage).not.toHaveBeenCalled(); expect(sourceRecord).not.toHaveBeenCalled();
  expect(sourceHistory).not.toHaveBeenCalled(); expect(sourceRelations).not.toHaveBeenCalled();
});

it('renders refresh only with a callback and stops an old refresh control after callback removal', async () => {
  const read = reading(); const onRefresh = jest.fn();
  await mountDetail(read, parentScope, onRefresh);
  const monitor = await openMonitor();
  const button = monitor.shadowRoot!.querySelector<HTMLButtonElement>('#refresh')!;
  await act(async () => button.click()); expect(onRefresh).toHaveBeenCalledTimes(1);
  const event = jest.fn(); monitor.addEventListener('wiselink-refresh', event);
  await mountDetail(read);
  expect(monitor.shadowRoot!.querySelector('#refresh')).toBeNull();
  await act(async () => button.click());
  expect(event).not.toHaveBeenCalled(); expect(onRefresh).toHaveBeenCalledTimes(1);
  // Standalone web component users retain their existing default refresh affordance.
  const standalone = document.createElement('wiselink-monitor') as WiseLinkMonitorElement;
  document.body.append(standalone);
  expect(standalone.shadowRoot!.querySelector('#refresh')).not.toBeNull(); standalone.remove();
});

it('clears the old graph for a new session, receipt, object, mismatch or body denial', async () => {
  const read = reading(); await mountDetail(read); const monitor = await openMonitor();
  await mountDetail(read, 'other-tenant-session');
  expect(host.querySelector('wiselink-monitor')).toBeNull(); expect(monitor.isConnected).toBe(false);
  await openMonitor();
  const newer = reading('engineering-2'); await mountDetail(newer, 'other-tenant-session');
  expect(host.querySelector('wiselink-monitor')).toBeNull();
  const current = await openMonitor();
  expect(current.runtime!.scope.id).toBe('engineering-2');
  const mismatched = reading('engineering-2'); mismatched.receipt.sourceRevisionRef = 'old';
  await mountDetail(mismatched, 'other-tenant-session');
  expect(host.querySelector('wiselink-monitor')).toBeNull(); expect(host.textContent).toContain('读取回执不一致');
  const denied = reading('engineering-2'); delete denied.bodyReadPolicy;
  await mountDetail(denied, 'other-tenant-session');
  expect(host.querySelector('wiselink-monitor')).toBeNull(); expect(host.querySelector('table')).toBeNull();
});

it('reuses the actual document parent reload, performs no graph reads, and clears the graph on a denied refresh', async () => {
  sourcePage.mockResolvedValueOnce({ documentVersionId: 'DV-1', sourceStatus: 'AVAILABLE',
    records: [reading()], hasMore: false, nextAfter: null });
  await act(async () => root.render(createElement(MemoryRouter,
    { future: { v7_startTransition: true, v7_relativeSplatPath: true } },
    createElement(TdmsDocumentSourceReading, { documentVersionId: 'DV-1' }))));
  expect(sourcePage).toHaveBeenCalledTimes(1);
  const monitor = await openMonitor();
  expect(sourcePage).toHaveBeenCalledTimes(1);
  sourcePage.mockRejectedValueOnce({ statusCode: 403 });
  await act(async () => monitor.shadowRoot!.querySelector<HTMLButtonElement>('#refresh')!.click());
  expect(sourcePage).toHaveBeenCalledTimes(2);
  expect(sourcePage.mock.calls[1][0]).toEqual({ documentVersionId: 'DV-1', limit: 12 });
  expect(host.querySelector('wiselink-monitor')).toBeNull(); expect(host.querySelector('table')).toBeNull();
  expect(host.textContent).toContain('原意见及关系已清除');
  expect(sourceRecord).not.toHaveBeenCalled(); expect(sourceHistory).not.toHaveBeenCalled(); expect(sourceRelations).not.toHaveBeenCalled();
});
