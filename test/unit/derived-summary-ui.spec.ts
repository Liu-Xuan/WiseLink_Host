import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { DerivedSummaryScopeSelection } from '@shared/derived-summary.interface';
import DerivedSummaryReadingPage from '@client/src/features/derived-summary/DerivedSummaryReadingPage';
import DerivedSummaryComposePage from '@client/src/features/derived-summary/DerivedSummaryComposePage';
import DerivedSummaryListPage from '@client/src/features/derived-summary/DerivedSummaryListPage';
import { summaryExact, summaryHead } from './fixtures/derived-summary';
const { JSDOM } = require('jsdom');
const mockHead = jest.fn();
const mockExact = jest.fn();
const mockStatus = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockList = jest.fn();
let mockSession = 1;
let mockAuthenticationRequired = false;
jest.mock('@client/src/api/derived-summary', () => ({
  readDerivedSummary: (...args: unknown[]) => mockHead(...args), readDerivedSummaryExact: (...args: unknown[]) => mockExact(...args),
  readDerivedSummaryRequest: (...args: unknown[]) => mockStatus(...args), createDerivedSummary: (...args: unknown[]) => mockCreate(...args),
  updateDerivedSummary: (...args: unknown[]) => mockUpdate(...args), listDerivedSummaries: (...args: unknown[]) => mockList(...args),
}));
jest.mock('@client/src/api/canonical-host', () => ({ getCanonicalHostClientSessionGeneration: () => mockSession, getCanonicalHostIdentityContext: async () => ({ tenantId: 'tenant-1', userId: 'actor-1' }),
  readDocumentParsingStatus: async (documentVersionId: string) => ({ documentVersionId, documentCode: '787-FTD-fixture', businessRevision: '旧R1', selectedVersionIsCurrent: false }) }));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({ useCurrentUserSession: () => ({ sessionGeneration: mockSession, authenticationRequired: mockAuthenticationRequired }) }));
jest.mock('@client/src/components/ui/button', () => ({ Button: ({ asChild: _asChild, ...props }: import('react').ComponentProps<'button'> & { asChild?: boolean }) => createElement('button', props) }));
jest.mock('@client/src/components/ui/textarea', () => ({ Textarea: ({ onChange }: { onChange: (event: { target: { value: string } }) => void }) => createElement('button', { onClick: () => onChange({ target: { value: '仅工作23四问题，保留历史和未覆盖范围。' } }) }, '填写生成要求') }));
jest.mock('@client/src/components/ui/checkbox', () => ({ Checkbox: ({ checked, disabled, onCheckedChange }: { checked: boolean; disabled: boolean; onCheckedChange: (value: boolean) => void }) => createElement('button', { disabled, 'aria-label': '确认选定范围', onClick: () => onCheckedChange(!checked) }, String(checked)) }));
jest.mock('@client/src/features/derived-summary/DerivedSummaryBody', () => ({ __esModule: true, default: ({ revision }: { revision: { content: { body: string } } }) => createElement('div', { 'data-body': true }, revision.content.body) }));
jest.mock('@client/src/features/derived-summary/SavedWorkSelector', () => ({ __esModule: true, default: ({ onAdd }: { onAdd: (value: unknown) => void }) => createElement('button', { onClick: () => onAdd({ member: { kind: 'WORK_ITEM_WORK', workItemId: 'WI-explicit', documentVersionId: 'DV-old', workRef: 'JAWR-work23', workRevision: 23, issueKeys: ['I1', 'I2', 'I3', 'I4'] }, headline: '四个确切问题', current: true }) }, '明确加入四个问题') }));
jest.mock('@client/src/features/derived-summary/ChildSummarySelector', () => ({ __esModule: true, default: () => createElement('p', null, '子概述尚未选定') }));
jest.mock('@client/src/features/derived-summary/SummaryScopeFields', () => ({ __esModule: true, default: ({ scope, onChange }: { scope: DerivedSummaryScopeSelection; onChange: (value: DerivedSummaryScopeSelection) => void }) => createElement('button', { onClick: () => onChange({ ...scope, selectionReason: '仅旧DV工作23，未覆盖新版本。' }) }, '明确范围理由') }));
jest.mock('@client/src/features/review/TaskModelPicker', () => ({ __esModule: true, default: ({ value }: { value: string }) => createElement('p', null, value), useTaskModelOptions: () => ({ ready: true, data: { options: [{ modelRef: 'miaoda/glm-5.3', available: true }] } }) }));
let dom: InstanceType<typeof JSDOM>, root: Root, container: HTMLElement, router: ReturnType<typeof createMemoryRouter>;
const oldGlobals = new Map<string, PropertyDescriptor | undefined>();
beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test/' });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, sessionStorage: dom.window.sessionStorage, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    oldGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  container = dom.window.document.getElementById('root')!;
  jest.clearAllMocks(); mockSession = 1; mockAuthenticationRequired = false;
  mockHead.mockResolvedValue(summaryHead()); mockExact.mockResolvedValue(summaryExact());
  const { current: _current, memberNotices: _notices, ...metadata } = summaryHead();
  mockList.mockResolvedValue([metadata]);
  mockStatus.mockResolvedValue({ summaryId: 'DS-1', attemptRef: 'AQ-1', status: 'FAILED', errorCode: 'MODEL_FAILED', savedSummaryRefs: ['DSR-1'] });
});
afterEach(async () => {
  await act(async () => root?.unmount()); router?.dispose(); dom.window.close();
  for (const [key, descriptor] of oldGlobals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  oldGlobals.clear();
});
async function mount(route: string) {
  router = createMemoryRouter([{ path: '/summaries', element: createElement(DerivedSummaryListPage) }, { path: '/summaries/new', element: createElement(DerivedSummaryComposePage) },
    { path: '/summaries/:summaryId', element: createElement(DerivedSummaryReadingPage) }, { path: '*', element: createElement('div') }], { initialEntries: [route] });
  root = createRoot(container); await act(async () => { root.render(createElement(RouterProvider, { router, future: { v7_startTransition: true } })); });
}
async function click(text: string) {
  const button = Array.from(container.querySelectorAll('button')).find(element => element.textContent?.includes(text));
  if (!button) throw new Error(`button missing: ${text}`);
  await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
}
test('exact historical reading keeps old body and upper child ref while source changes remain visible', async () => {
  await mount('/summaries/DS-1?summaryRef=DSR-1&attemptRef=AQ-1');
  expect(container.textContent).toContain('确切正文 DSR-1'); expect(container.textContent).not.toContain('确切正文 DSR-2');
  expect(container.textContent).toContain('历史保存修订'); expect(container.textContent).toContain('当前工作已有新变化');
  expect(container.textContent).toContain('历史文档版本');
  expect(container.textContent).toContain('其他 ATA4 未纳入'); expect(container.textContent).toContain('MODEL_FAILED');
  const upper = Array.from(container.querySelectorAll('a')).find(link => link.textContent?.includes('形成上层'))!;
  expect(new URL(upper.href).searchParams.get('fromSummaryRef')).toBe('DSR-1');
  expect(mockExact).toHaveBeenCalledWith('DS-1', 'DSR-1', expect.anything()); expect(mockCreate).not.toHaveBeenCalled();
  expect(mockHead).not.toHaveBeenCalled();
});
test('V1 source A remains readable when V2 added source B has been revoked', async () => {
  mockHead.mockRejectedValue(new Error('V2_SOURCE_B_REVOKED'));
  const exact = summaryExact();
  exact.revision.content.body = 'V1 仅依据仍获权来源 A';
  exact.revision.members[0].rootRefs = ['SOURCE-A'];
  mockExact.mockResolvedValue(exact);
  await mount('/summaries/DS-1?summaryRef=DSR-1');
  expect(container.textContent).toContain('V1 仅依据仍获权来源 A');
  expect(container.textContent).toContain('历史保存修订'); expect(container.textContent).not.toContain('V2_SOURCE_B_REVOKED');
  expect(mockHead).not.toHaveBeenCalled(); expect(mockExact).toHaveBeenCalledWith('DS-1', 'DSR-1', expect.anything());
});
test('historical member replaced in V2 displays its selected fresh notice instead of saved current flag', async () => {
  const replaced = summaryHead();
  replaced.current!.members[0].member = { kind: 'WORK_ITEM_WORK', workItemId: 'WI-2', documentVersionId: 'DV-2', workRef: 'JAWR-new', workRevision: 4, issueKeys: ['I2'] };
  replaced.memberNotices = [{ member: replaced.current!.members[0].member, current: true, limitations: [] }];
  mockHead.mockResolvedValue(replaced);
  const exact = summaryExact();
  exact.revision.members[0].current = true;
  exact.memberNotices[0] = { member: exact.revision.members[0].member, current: false, limitations: ['本历史工作已被后继替换，新变化未覆盖'] };
  mockExact.mockResolvedValue(exact);
  await mount('/summaries/DS-1?summaryRef=DSR-1');
  expect(container.textContent).toContain('本历史工作已被后继替换，新变化未覆盖');
  expect(container.textContent).toContain('历史依据或成员工作已变化'); expect(container.textContent).not.toContain('当前成员工作');
  expect(mockHead).not.toHaveBeenCalled();
});
test('missing selected fresh notice never falls back to a saved current assertion', async () => {
  const exact = summaryExact(); exact.revision.members[0].current = true; exact.memberNotices = [];
  mockExact.mockResolvedValue(exact);
  await mount('/summaries/DS-1?summaryRef=DSR-1');
  expect(container.textContent).toContain('成员现行性未能重新核对'); expect(container.textContent).not.toContain('当前成员工作');
});
test('owned summary directory reads metadata without loading revoked current bodies', async () => {
  mockHead.mockRejectedValue(new Error('CURRENT_SOURCE_REVOKED'));
  await mount('/summaries');
  expect(container.textContent).toContain('B787 ATA46-00 选定资料');
  expect(container.textContent).toContain('正文与成员来源在打开时重新核权');
  expect(container.textContent).not.toContain('确切正文'); expect(container.textContent).not.toContain('CURRENT_SOURCE_REVOKED');
  expect(mockHead).not.toHaveBeenCalled(); expect(mockExact).not.toHaveBeenCalled();
});
test('failed fresh source reauthorization removes previously readable body', async () => {
  await mount('/summaries/DS-1?summaryRef=DSR-1'); expect(container.textContent).toContain('确切正文 DSR-1');
  mockExact.mockRejectedValueOnce(new Error('保留来源已无权访问，停止展示正文。'));
  await click('重新核权');
  expect(container.textContent).toContain('保留来源已无权访问'); expect(container.textContent).not.toContain('确切正文 DSR-1');
});
test('duplicated exact pins never read or replace with current pointer', async () => {
  await mount('/summaries/DS-1?summaryRef=old&summaryRef=new');
  expect(container.textContent).toContain('链接无效'); expect(mockHead).not.toHaveBeenCalled(); expect(mockExact).not.toHaveBeenCalled();
});
test('new scope and upper child URL do not implicitly select members or start generation', async () => {
  await mount('/summaries/new?kind=ATA2&fleetFamilyId=B787&ata2=46&title=有限范围&fromSummaryId=DS-1&fromSummaryRef=DSR-1');
  expect(container.textContent).toContain('尚未选定成员'); expect(container.textContent).toContain('miaoda/glm-5.3');
  expect(mockCreate).not.toHaveBeenCalled(); expect(mockHead).not.toHaveBeenCalled();
});
async function prepareSelection() {
  await click('明确范围理由'); await click('明确加入四个问题');
  await click('填写生成要求');
  await act(async () => container.querySelector('[aria-label="确认选定范围"]')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
}
test('unknown acceptance retains identical requestId, members and Hosted model on explicit retry', async () => {
  await mount('/summaries/new?kind=ATA4&fleetFamilyId=B787&ata2=46&ata4=46-00&title=有限范围');
  await prepareSelection();
  mockCreate.mockRejectedValueOnce(new Error('网络结果未知')).mockResolvedValueOnce({ summaryId: 'DS-1', attemptRef: 'AQ-1' });
  await click('提交选定范围'); expect(mockCreate).toHaveBeenCalledTimes(1);
  const original = mockCreate.mock.calls[0][0];
  expect(original).toMatchObject({ modelRef: 'miaoda/glm-5.3', members: [{ workRef: 'JAWR-work23', workRevision: 23, documentVersionId: 'DV-old', issueKeys: ['I1', 'I2', 'I3', 'I4'] }] });
  await act(async () => root.unmount()); router.dispose();
  await mount('/summaries/new?kind=ATA4&fleetFamilyId=B787&ata2=46&ata4=46-00&title=有限范围');
  expect(container.textContent).toContain('已恢复尚待核对的原请求');
  await click('用同一请求'); expect(mockCreate.mock.calls[1][0]).toEqual(original);
  expect(router.state.location.search).toBe('?attemptRef=AQ-1');
  expect(dom.window.sessionStorage.length).toBe(0);
});
test('explicit pre-acceptance validation rejection permits reselection without an automatic new request', async () => {
  await mount('/summaries/new?kind=ATA4&fleetFamilyId=B787&ata2=46&ata4=46-00&title=有限范围');
  await prepareSelection();
  mockCreate.mockRejectedValueOnce(Object.assign(new Error('成员选择无效'), { statusCode: 400 }));
  await click('提交选定范围'); expect(container.textContent).toContain('请求未受理');
  await click('重新读取并选择'); expect(dom.window.sessionStorage.length).toBe(0);
  expect(mockCreate).toHaveBeenCalledTimes(1); expect(container.textContent).toContain('明确加入四个问题');
});


const unchangedContext = { state: 'UNCHANGED_HOST_CONTEXT' as const, sourceAuthority: 'CATALOG_SELECTED' as const,
  sourceCurrentness: 'UNKNOWN' as const, coverage: 'SELECTED_MEMBERS_ONLY' as const,
  reasons: ['PUBLISHER_CURRENTNESS_UNKNOWN'] };
test('head route retains context status independently of its current saved pointer', async () => {
  const head = summaryHead(); head.contextStatus = unchangedContext; mockHead.mockResolvedValue(head);
  await mount('/summaries/DS-1');
  expect(container.textContent).toContain('当前保存修订'); expect(container.textContent).toContain('Host 上下文未变化');
  expect(container.textContent).toContain('UNKNOWN'); expect(container.textContent).toContain('仅覆盖实际选取成员');
  expect(container.textContent).not.toContain('UNCHANGED_HOST_CONTEXT'); expect(mockExact).not.toHaveBeenCalled();
});
test('exact changed-context warning retains the exact saved body and does not expose vector details', async () => {
  const exact = summaryExact(); exact.contextStatus = { ...unchangedContext, state: 'RECHECK_REQUIRED',
    reasons: ['CHANGED_SOURCES', 'DOCUMENT_LIFECYCLE_NOT_FENCED', 'PUBLISHER_CURRENTNESS_UNKNOWN', '<script>private-vector</script>'] };
  mockExact.mockResolvedValue(exact); await mount('/summaries/DS-1?summaryRef=DSR-1');
  expect(container.textContent).toContain('上下文需要重新核对'); expect(container.textContent).toContain('解析或语义登记已变化');
  expect(container.textContent).toContain('确切正文 DSR-1'); expect(container.textContent).not.toContain('private-vector');
  expect(container.textContent).not.toContain('contextBasis'); expect(container.querySelector('script')).toBeNull();
});
test('missing status shows legacy unchecked without replacing historical body', async () => {
  await mount('/summaries/DS-1?summaryRef=DSR-1');
  expect(container.textContent).toContain('上下文依据尚未核对'); expect(container.textContent).toContain('未记录上下文依据');
  expect(container.textContent).toContain('确切正文 DSR-1');
});
test('fresh context recheck changes status while preserving exact route pins', async () => {
  mockExact.mockResolvedValueOnce({ ...summaryExact(), contextStatus: unchangedContext });
  await mount('/summaries/DS-1?summaryRef=DSR-1');
  mockExact.mockResolvedValueOnce({ ...summaryExact(), contextStatus: { ...unchangedContext, state: 'RECHECK_REQUIRED', reasons: ['CHANGED_WORKITEMS'] } });
  await click('重新核权'); expect(container.textContent).toContain('相关工作或结果状态已变化');
  expect(container.textContent).toContain('确切正文 DSR-1'); expect(mockHead).not.toHaveBeenCalled();
  expect(mockExact.mock.calls.every(call => call[1] === 'DSR-1')).toBe(true);
});
test('authentication gate clears exact saved body and context state', async () => {
  mockExact.mockResolvedValue({ ...summaryExact(), contextStatus: unchangedContext });
  await mount('/summaries/DS-1?summaryRef=DSR-1'); mockAuthenticationRequired = true; mockSession++;
  await act(async () => { root.render(createElement(RouterProvider, { router, future: { v7_startTransition: true } }));
    await router.navigate('/summaries/DS-1?summaryRef=DSR-1&attemptRef=AQ-auth'); });
  expect(container.textContent).toContain('请先登录'); expect(container.textContent).not.toContain('确切正文 DSR-1');
  expect(container.textContent).not.toContain('Host 上下文未变化'); expect(mockStatus).not.toHaveBeenCalled();
});
test('new session ignores an old pending exact response and its context state', async () => {
  let resolveOld!: (value: ReturnType<typeof summaryExact>) => void;
  mockExact.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  await mount('/summaries/DS-1?summaryRef=DSR-1'); mockSession++;
  const fresh = summaryExact(); fresh.revision.summaryRef = 'DSR-2'; fresh.revision.content.body = '确切正文 DSR-2'; fresh.contextStatus = { ...unchangedContext, state: 'RECHECK_REQUIRED', reasons: ['CHANGED_SOURCES'] };
  mockExact.mockResolvedValueOnce(fresh);
  await act(async () => { await router.navigate('/summaries/DS-1?summaryRef=DSR-2'); });
  await act(async () => { resolveOld({ ...summaryExact(), contextStatus: unchangedContext }); });
  expect(container.textContent).toContain('确切正文 DSR-2'); expect(container.textContent).not.toContain('确切正文 DSR-1');
  expect(container.textContent).toContain('上下文需要重新核对'); expect(container.textContent).not.toContain('Host 上下文未变化');
});
test('unsaved CONFLICT offers explicit reread and reselection without dispatch', async () => {
  const head = summaryHead(); head.current = null; head.currentSummaryRef = null; head.currentRevision = 0;
  mockHead.mockResolvedValue(head); mockStatus.mockResolvedValue({ summaryId: 'DS-1', attemptRef: 'AQ-conflict',
    status: 'CONFLICT', errorCode: 'DERIVED_SUMMARY_CONTEXT_CHANGED', savedSummaryRefs: [] });
  await mount('/summaries/DS-1?attemptRef=AQ-conflict');
  expect(container.textContent).toContain('尚无已保存'); expect(container.textContent).toContain('CONFLICT');
  const link = Array.from(container.querySelectorAll('a')).find(item => item.textContent?.includes('重新选取范围'))!;
  expect(new URL(link.href).pathname).toBe('/summaries/DS-1/update'); expect(mockCreate).not.toHaveBeenCalled(); expect(mockUpdate).not.toHaveBeenCalled();
});
