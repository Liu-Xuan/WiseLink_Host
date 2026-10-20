import type { Root } from 'react-dom/client';
import type { JobAidWorkingReadModel } from '@shared/jobaid-problem-assessment.interface';
import type { JobAidWorkCorrectionChangedField, JobAidWorkCorrectionReceipt, JobAidWorkCorrectionRequest } from '@shared/jobaid-work-correction.interface';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';
const { JSDOM } = require('jsdom');
const dom: { window: Window & typeof globalThis } = new JSDOM('<!doctype html><body></body>', { url: 'https://local-test.invalid/', pretendToBeVisual: true });
const prior = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
  navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
  prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act, createElement }: typeof import('react') = require('react');
const { createRoot }: typeof import('react-dom/client') = require('react-dom/client');
let mockSession = 1;
const mockListeners = new Set<() => void>();
const mockSave = jest.fn();
const mockReceiptRead = jest.fn();
const mockWorkRead = jest.fn();
const mockIdentity = jest.fn();
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => mockSession,
  subscribeCanonicalHostClientSession: (listener: () => void) => { mockListeners.add(listener); return () => mockListeners.delete(listener); },
  getCanonicalHostIdentityContext: (...args: unknown[]) => mockIdentity(...args),
  readJobAidAssessmentWork: (...args: unknown[]) => mockWorkRead(...args),
  saveJobAidWorkCorrection: (...args: unknown[]) => mockSave(...args),
  readJobAidWorkCorrection: (...args: unknown[]) => mockReceiptRead(...args),
}));
jest.mock('@client/src/features/workbench/RetainedWorkbenchPanel', () => ({ useWorkbenchPanelActive: () => true }));
jest.mock('@client/src/components/ui/button', () => ({
  Button: ({ children, variant: _variant, size: _size, ...props }: import('react').ComponentProps<'button'> & { variant?: string; size?: string }) => createElement('button', props, children),
}));
jest.mock('@client/src/features/review/InitialAnalysisContinueButton', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/features/matter/SavedAssessmentReading', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/features/matter/saved-jobaid-reading.css', () => ({}));
jest.mock('@client/src/pages/DocumentParsingPage/jobaid-problem-workspace.css', () => ({}));
const JobAidProblemWorkspace: typeof import('@client/src/pages/DocumentParsingPage/JobAidProblemWorkspace').default =
  require('@client/src/pages/DocumentParsingPage/JobAidProblemWorkspace').default;
const { prepareJobAidCorrection, jobAidCorrectionStorageKey, writePendingJobAidCorrection }:
  typeof import('@client/src/pages/DocumentParsingPage/jobaid-work-correction') = require('@client/src/pages/DocumentParsingPage/jobaid-work-correction');
let root: Root;
let container: HTMLElement;
let page: JobAidWorkingReadModel;
const updated = jest.fn();
function fixture(): JobAidWorkingReadModel {
  const value = jobAidReadingFixture();
  value.executionStatus = null;
  value.latestAttempt = null;
  value.current!.workRevisionRef = 'JAWR-base';
  value.current!.content.readSourceRefs = ['evidence-test'];
  value.current!.content.issues[0].riskScenarios[0].severity = { label: '未定级', reason: '原比较归因仍待核对。', basisRefs: ['evidence-test'] };
  return value;
}
function receipt(input: JobAidWorkCorrectionRequest): JobAidWorkCorrectionReceipt {
  const work = structuredClone(fixture().current!);
  work.workRevisionRef = 'JAWR-successor'; work.workRevision = input.baseWorkRevision + 1;
  work.previousWorkRevisionRef = input.baseWorkRef; work.requestId = input.requestId;
  work.actionAttemptId = 'ATT-manual'; work.basedOnWorkItemRevision = input.expectedWorkItemRevision;
  work.content.overviewStatus = 'STALE';
  for (const change of input.changes) {
    const issue = work.content.issues.find(item => item.issueKey === change.issueKey)!;
    if (change.field === 'ISSUE_BODY') issue.body = change.newValue;
    else issue.riskScenarios[change.scenarioIndex].severity!.reason = change.newValue;
  }
  return { schemaVersion: 'wiselink.jobaid-work-correction-receipt.v1', requestId: input.requestId,
    executionKind: 'HOST_MANUAL_CORRECTION', modelRequests: 0, semanticReanalysisPerformed: false,
    status: 'SAVED', executionAttemptId: work.actionAttemptId, workItemId: work.workItemId,
    baseWorkRef: input.baseWorkRef, baseWorkRevision: input.baseWorkRevision,
    workRevisionRef: work.workRevisionRef, workRevision: work.workRevision, workItemRevision: input.expectedWorkItemRevision,
    changedFields: input.changes.map((item): JobAidWorkCorrectionChangedField => item.field === 'ISSUE_BODY'
      ? { field: item.field, issueKey: item.issueKey, issueRef: item.issueRef }
      : { field: item.field, issueKey: item.issueKey, issueRef: item.issueRef, scenarioIndex: item.scenarioIndex }),
    adopted: false, candidateCarrierAdvanced: false, replayed: false, work };
}
const missing = () => Object.assign(new Error('not found'), { statusCode: 404, code: 'JOBAID_CORRECTION_REQUEST_NOT_FOUND' });
const network = () => Object.assign(new Error('network'), { code: 'ERR_NETWORK' });
const storageKey = () => jobAidCorrectionStorageKey({ userId: 'native-owner', tenantId: 'tenant-one' }, page.workItemId);
async function mount(): Promise<void> {
  await act(async () => { root.render(createElement(JobAidProblemWorkspace, { workItemId: page.workItemId,
    baseRevision: 7, baseReadConfirmed: true, baseReadProof: {}, onLocateDocument: jest.fn(), onUpdated: updated })); });
}
async function click(label: string): Promise<void> {
  const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => button.click());
}
async function fill(label: string, value: string): Promise<void> {
  const node = Array.from(container.querySelectorAll('label')).find(item => item.textContent === label);
  const element = document.getElementById(node!.htmlFor) as HTMLTextAreaElement | HTMLSelectElement;
  await act(async () => {
    const prototype = element.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLSelectElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new dom.window.Event(element.tagName === 'TEXTAREA' ? 'input' : 'change', { bubbles: true }));
  });
}
async function edit(): Promise<void> {
  await click('更正文案');
  await fill('问题正文', '核对后的完整候选正文。 [[evidence-test]]');
  await fill('严重性理由 · 情景 1', '保留灾难假设的未验证性质，不作比较归因。');
  await fill('实际贡献方式', 'AI_ASSISTED');
  await fill('更正理由', '基于既有已核内容删除比较归因，未新增制造商事实。');
}
beforeEach(() => {
  mockSession = 1; jest.clearAllMocks();
  page = fixture(); window.sessionStorage.clear();
  mockIdentity.mockReset().mockResolvedValue({ userId: 'native-owner', tenantId: 'tenant-one' });
  mockWorkRead.mockReset().mockImplementation(async () => structuredClone(page));
  mockReceiptRead.mockReset().mockRejectedValue(missing());
  mockSave.mockReset().mockImplementation(async (_id: string, input: JobAidWorkCorrectionRequest) => {
    const saved = receipt(input); page.current = saved.work; page.overallStatus = 'STALE'; return saved;
  });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); expect(mockListeners.size).toBe(0); });
afterAll(() => { dom.window.close(); for (const [key, descriptor] of prior) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} });

test('edits both explicit text fields against the current exact snapshot and refreshes the existing reader', async () => {
  await mount(); const original = structuredClone(page.current!);
  await edit(); await click('保存更正');
  expect(mockSave).toHaveBeenCalledTimes(1);
  const input = mockSave.mock.calls[0][1] as JobAidWorkCorrectionRequest;
  expect(input).toMatchObject({ baseWorkRef: original.workRevisionRef, baseWorkRevision: original.workRevision, expectedWorkItemRevision: 7 });
  expect(input.changes.map(item => item.field)).toEqual(['ISSUE_BODY', 'RISK_SEVERITY_REASON']);
  expect(input.changes[0]).toMatchObject({ expectedOldValue: original.content.issues[0].body,
    issueKey: original.content.issues[0].issueKey, issueRef: original.content.issues[0].issueRef, evidenceRefs: ['evidence-test'] });
  expect(input.changes[1]).toMatchObject({ expectedOldValue: '原比较归因仍待核对。',
    expectedScenario: original.content.issues[0].riskScenarios[0], scenarioIndex: 0 });
  expect(input.changes[1].reason).toContain('AI 整理，经本人核对');
  expect(input.changes[1].reason).toContain('未正式采用');
  expect(page.current!.content.issues[0].riskScenarios[0]).toEqual({ ...original.content.issues[0].riskScenarios[0],
    severity: { ...original.content.issues[0].riskScenarios[0].severity!, reason: input.changes[1].newValue } });
  expect(mockWorkRead).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[data-work-revision-ref="JAWR-successor"]')).not.toBeNull();
  expect(container.textContent).toContain('整体意见仍需按该工作版本更新');
  expect(container.textContent).toContain('未定级');
  expect(window.sessionStorage.getItem(storageKey())).toBeNull();
  expect(updated).toHaveBeenCalledTimes(1);
});

test('a committed response lost in transit is recovered by GET of the same id without a second POST', async () => {
  mockSave.mockImplementation(async (_id: string, input: JobAidWorkCorrectionRequest) => {
    const saved = receipt(input); page.current = saved.work; mockReceiptRead.mockResolvedValue(saved); throw network();
  });
  await mount(); await edit(); await click('保存更正');
  const input = mockSave.mock.calls[0][1] as JobAidWorkCorrectionRequest;
  expect(mockReceiptRead).toHaveBeenCalledWith(page.workItemId, input.requestId);
  expect(mockSave).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[data-work-revision-ref="JAWR-successor"]')).not.toBeNull();
  expect(window.sessionStorage.getItem(storageKey())).toBeNull();
});

test('unknown save plus missing GET retains the exact command and retries only that same request after another GET', async () => {
  mockSave.mockRejectedValueOnce(network());
  await mount(); await edit(); await click('保存更正');
  const input = structuredClone(mockSave.mock.calls[0][1]) as JobAidWorkCorrectionRequest;
  expect(container.textContent).toContain('保存结果尚未确认');
  expect(container.querySelector('form')).toBeNull();
  const stored = window.sessionStorage.getItem(storageKey())!;
  expect(JSON.parse(stored).request).toEqual({ schemaVersion: input.schemaVersion, requestId: input.requestId,
    baseWorkRef: input.baseWorkRef, baseWorkRevision: input.baseWorkRevision, expectedWorkItemRevision: input.expectedWorkItemRevision });
  expect(stored).not.toContain('expectedOldValue');
  expect(stored).not.toContain('newValue');
  expect(stored).not.toContain('expectedScenario');
  expect(stored).not.toContain(input.changes[0].newValue);
  expect(stored).not.toContain(input.changes[0].reason);
  await click('重试同一请求');
  expect(mockSave).toHaveBeenCalledTimes(2);
  expect(mockSave.mock.calls[1][1]).toEqual(input);
  expect(mockReceiptRead).toHaveBeenCalledTimes(2);
  expect(mockReceiptRead.mock.invocationCallOrder[1]).toBeLessThan(mockSave.mock.invocationCallOrder[1]);
});

test('reload restores only the matching native actor request and uses its immutable receipt even if latest already moved on', async () => {
  mockSave.mockRejectedValueOnce(network());
  await mount(); await edit(); await click('保存更正');
  const input = mockSave.mock.calls[0][1] as JobAidWorkCorrectionRequest;
  const saved = receipt(input);
  page.current = { ...saved.work, workRevisionRef: 'JAWR-later', workRevision: saved.workRevision + 1 };
  mockReceiptRead.mockResolvedValue(saved);
  await act(async () => root.unmount()); root = createRoot(container); await mount();
  expect(mockSave).toHaveBeenCalledTimes(1);
  expect(mockReceiptRead).toHaveBeenLastCalledWith(page.workItemId, input.requestId);
  expect(container.textContent).toContain(`已确认工作修订 ${saved.workRevision}`);
  expect(container.querySelector('[data-work-revision-ref="JAWR-later"]')).not.toBeNull();
  expect(window.sessionStorage.getItem(storageKey())).toBeNull();
});

test('an unconfirmed request is never cleared by a denial that may have happened after commit', async () => {
  const denied = Object.assign(new Error('denied'), { statusCode: 404, code: 'CANONICAL_WORK_ITEM_NOT_FOUND' });
  mockSave.mockRejectedValue(denied); mockReceiptRead.mockRejectedValue(denied);
  await mount(); await edit(); await click('保存更正');
  expect(container.textContent).toContain('当前身份无法操作此事项');
  expect(window.sessionStorage.getItem(storageKey())).not.toBeNull();
  expect(container.textContent).not.toContain('重试同一请求');
  await click('核对上次保存结果');
  expect(mockSave).toHaveBeenCalledTimes(1);
});

test('a definite CAS rejection plus no receipt clears the old request and refreshes for a fresh edit', async () => {
  mockSave.mockRejectedValue(Object.assign(new Error('conflict'), { statusCode: 409, code: 'JOBAID_CORRECTION_BASE_CONFLICT' }));
  await mount(); await edit(); await click('保存更正');
  expect(window.sessionStorage.getItem(storageKey())).toBeNull();
  expect(container.textContent).toContain('本次更正未保存');
  expect(mockWorkRead).toHaveBeenCalledTimes(2);
  expect(mockSave).toHaveBeenCalledTimes(1);
});

test('a mismatched immutable receipt stays unconfirmed and does not refresh the read model', async () => {
  mockSave.mockImplementation(async (_id: string, input: JobAidWorkCorrectionRequest) => ({ ...receipt(input), requestId: 'another-request' }));
  mockReceiptRead.mockImplementation(async (_id: string, id: string) => ({ ...receipt(mockSave.mock.calls[0][1]), requestId: `${id}-other` }));
  await mount(); await edit(); await click('保存更正');
  expect(container.textContent).toContain('保存结果尚未确认');
  expect(window.sessionStorage.getItem(storageKey())).not.toBeNull();
  expect(mockWorkRead).toHaveBeenCalledTimes(1);
  expect(updated).not.toHaveBeenCalled();
});

test('another native actor never restores the first actors pending command', async () => {
  const work = page.current!;
  const pending = prepareJobAidCorrection(work, 7, { issueKey: work.content.issues[0].issueKey,
    body: '候选更正。 [[evidence-test]]', severityReasons: ['原比较归因仍待核对。'], reason: '核对',
    contribution: 'AI_ASSISTED', evidenceRefs: ['evidence-test'] }, 'request-private-owner');
  writePendingJobAidCorrection(storageKey(), pending);
  mockIdentity.mockResolvedValue({ userId: 'another-native-user', tenantId: 'tenant-one' });
  await mount();
  expect(mockReceiptRead).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain('request-private-owner');
  expect(container.textContent).not.toContain('核对上次保存结果');
});

test('session change suppresses late save and does not send a recovery request as a different identity', async () => {
  let done: (value: JobAidWorkCorrectionReceipt) => void = () => undefined;
  mockSave.mockImplementation(() => new Promise(resolve => { done = resolve; }));
  await mount(); await edit(); await click('保存更正');
  const input = mockSave.mock.calls[0][1] as JobAidWorkCorrectionRequest;
  page = { ...fixture(), current: null };
  await act(async () => { mockSession++; for (const listener of mockListeners) listener(); });
  const beforeLateReceipt = updated.mock.calls.length;
  await act(async () => done(receipt(input)));
  expect(mockReceiptRead).not.toHaveBeenCalled();
  expect(updated).toHaveBeenCalledTimes(beforeLateReceipt);
  expect(container.querySelector('[data-work-revision-ref]')).toBeNull();
});

test('request preparation rejects citations outside the exact saved delivery registry', () => {
  const work = page.current!;
  expect(() => prepareJobAidCorrection(work, 7, { issueKey: work.content.issues[0].issueKey,
    body: '新增说法。 [[not-delivered]]', severityReasons: ['原比较归因仍待核对。'], reason: '核对',
    contribution: 'ENGINEER', evidenceRefs: ['evidence-test'] }, 'manual-invalid')).toThrow('引文必须来自所选依据');
});


test('reload with no receipt keeps only request identity and cannot rebuild or resend the old payload', async () => {
  mockSave.mockRejectedValue(network());
  await mount(); await edit(); await click('保存更正');
  const input = mockSave.mock.calls[0][1] as JobAidWorkCorrectionRequest;
  page.current!.content.issues[0].body = '外部产生的新当前值，不能重建原请求。';
  await act(async () => root.unmount()); root = createRoot(container); await mount();
  expect(mockReceiptRead).toHaveBeenLastCalledWith(page.workItemId, input.requestId);
  expect(container.textContent).toContain('尚未查到原请求回执');
  expect(container.textContent).not.toContain('重试同一请求');
  const editButton = Array.from(container.querySelectorAll('button')).find(item => item.textContent === '更正文案')!;
  expect(editButton.disabled).toBe(true);
  await click('核对上次保存结果');
  expect(mockSave).toHaveBeenCalledTimes(1);
  expect(JSON.parse(window.sessionStorage.getItem(storageKey())!).request.requestId).toBe(input.requestId);
});
