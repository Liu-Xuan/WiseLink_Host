import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { summaryPendingKey } from '@client/src/features/derived-summary/summary-pending-request';
import type { DerivedSummaryReadModel, DerivedSummaryScopeSelection, RequestDerivedSummaryUpdate } from '@shared/derived-summary.interface';
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
let mockInstruction = '仅工作23四问题，保留历史和未覆盖范围。';
jest.mock('@client/src/api/derived-summary', () => ({
  readDerivedSummary: (...args: unknown[]) => mockHead(...args), readDerivedSummaryExact: (...args: unknown[]) => mockExact(...args),
  readDerivedSummaryRequest: (...args: unknown[]) => mockStatus(...args), createDerivedSummary: (...args: unknown[]) => mockCreate(...args),
  updateDerivedSummary: (...args: unknown[]) => mockUpdate(...args), listDerivedSummaries: (...args: unknown[]) => mockList(...args),
}));
jest.mock('@client/src/api/canonical-host', () => ({ getCanonicalHostClientSessionGeneration: () => mockSession, getCanonicalHostIdentityContext: async () => ({ tenantId: 'tenant-1', userId: 'actor-1' }),
  readDocumentParsingStatus: async (documentVersionId: string) => ({ documentVersionId, documentCode: '787-FTD-fixture', businessRevision: '旧R1', selectedVersionIsCurrent: false }) }));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({ useCurrentUserSession: () => ({ sessionGeneration: mockSession, authenticationRequired: mockAuthenticationRequired }) }));
jest.mock('@client/src/components/ui/button', () => ({ Button: ({ asChild: _asChild, ...props }: import('react').ComponentProps<'button'> & { asChild?: boolean }) => createElement('button', props) }));
jest.mock('@client/src/components/ui/textarea', () => ({ Textarea: ({ onChange }: { onChange: (event: { target: { value: string } }) => void }) => createElement('button', { onClick: () => onChange({ target: { value: mockInstruction } }) }, '填写生成要求') }));
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
  jest.clearAllMocks(); mockSession = 1; mockAuthenticationRequired = false; mockInstruction = '仅工作23四问题，保留历史和未覆盖范围。';
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
    { path: '/summaries/:summaryId/update', element: createElement(DerivedSummaryComposePage) }, { path: '/summaries/:summaryId', element: createElement(DerivedSummaryReadingPage) }, { path: '*', element: createElement('div') }], { initialEntries: [route] });
  root = createRoot(container); await act(async () => { root.render(createElement(RouterProvider, { router, future: { v7_startTransition: true } })); });
}
async function click(text: string) {
  const button = Array.from(container.querySelectorAll('button')).find(element => element.textContent?.includes(text) || element.getAttribute('aria-label') === text);
  if (!button) throw new Error(`button missing: ${text}`);
  await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
}
test('exact historical reading keeps old body and upper child ref while source changes remain visible', async () => {
  const exact = summaryExact();
  exact.revision.members[0].leaves = [exact.revision.members[0].member,
    { kind: 'DERIVED_SUMMARY', summaryId: 'DS-child', summaryRef: 'DSR-child-exact', summaryRevision: 4 }];
  mockExact.mockResolvedValue(exact);
  await mount('/summaries/DS-1?summaryRef=DSR-1&attemptRef=AQ-1');
  expect(container.textContent).toContain('确切正文 DSR-1'); expect(container.textContent).not.toContain('确切正文 DSR-2');
  expect(container.textContent).toContain('历史保存修订'); expect(container.textContent).toContain('当前工作已有新变化');
  expect(container.textContent).toContain('历史文档版本');
  expect(container.textContent).toContain('其他 ATA4 未纳入'); expect(container.textContent).toContain('MODEL_FAILED');
  const upper = Array.from(container.querySelectorAll('a')).find(link => link.textContent?.includes('形成上层'))!;
  expect(new URL(upper.href).searchParams.get('fromSummaryRef')).toBe('DSR-1');
  const workLeaf = Array.from(container.querySelectorAll('a')).find(link => link.textContent === '叶子工作：JAWR-1')!;
  expect(Object.fromEntries(new URL(workLeaf.href).searchParams)).toEqual({ subjectKind: 'WORK_ITEM', subjectId: 'WI-1', workRef: 'JAWR-1' });
  const childLeaf = Array.from(container.querySelectorAll('a')).find(link => link.textContent === '叶子工作：DSR-child-exact')!;
  expect(new URL(childLeaf.href).pathname).toBe('/summaries/DS-child');
  expect(new URL(childLeaf.href).searchParams.get('summaryRef')).toBe('DSR-child-exact');
  expect(mockExact).toHaveBeenCalledWith('DS-1', 'DSR-1', expect.anything()); expect(mockCreate).not.toHaveBeenCalled();
  expect(mockHead).not.toHaveBeenCalled();
});
test.each([
  { delivered: true, used: true, readLabel: 'Host已读取成员工作', citationLabel: '正文直接引用成员工作' },
  { delivered: true, used: false, readLabel: 'Host已读取成员工作', citationLabel: '正文未直接引用成员工作' },
  { delivered: false, used: true, readLabel: 'Host未读取成员工作', citationLabel: '正文直接引用成员工作' },
  { delivered: false, used: false, readLabel: 'Host未读取成员工作', citationLabel: '正文未直接引用成员工作' },
])('coverage independently records Host READ $delivered and body citation $used', async ({ delivered, used, readLabel, citationLabel }) => {
  const exact = summaryExact(); Object.assign(exact.revision.coverage[0], { delivered, used });
  const before = JSON.stringify(exact); mockExact.mockResolvedValue(exact);
  await mount('/summaries/DS-1?summaryRef=DSR-1');
  const coverage = container.querySelector('[aria-label="确切成员与覆盖"]')!;
  expect(coverage.textContent).toContain(`${readLabel} · ${citationLabel}`);
  expect(coverage.textContent).toContain('覆盖记录仅表示Host读取与正文直接引用，不证明模型已接收完整正文或完成综合');
  expect(coverage.textContent).toContain('仅覆盖选定问题');
  expect(coverage.textContent).not.toContain('已交付输入');
  expect(coverage.textContent).not.toContain('未交付完整输入');
  expect(JSON.stringify(exact)).toBe(before);
});
test('missing coverage asserts neither Host READ nor body direct citation', async () => {
  const exact = summaryExact(); exact.revision.coverage = []; mockExact.mockResolvedValue(exact);
  await mount('/summaries/DS-1?summaryRef=DSR-1');
  const coverage = container.querySelector('[aria-label="确切成员与覆盖"]')!;
  expect(coverage.textContent).toContain('覆盖记录不可用，不能扩大已覆盖范围');
  for (const label of ['Host已读取成员工作', 'Host未读取成员工作', '正文直接引用成员工作', '正文未直接引用成员工作'])
    expect(coverage.textContent).not.toContain(label);
});
const legacyCoverageLimitation = '成员已交付，但正文未直接引用；不能宣称已对该成员完成综合。';
test.each([legacyCoverageLimitation, `${legacyCoverageLimitation} 另有待核条件。`])('normalizes only the exact legacy coverage limitation: %s', async limitation => {
  const exact = summaryExact();
  exact.revision.coverage[0].used = false; exact.revision.coverage[0].limitation = limitation;
  exact.revision.members[0].limitations.push(legacyCoverageLimitation, '成员条件须保留。');
  exact.memberNotices[0].limitations.push('来源新版尚未核对。');
  exact.revision.content.limitations.push('正文范围限制须保留。');
  const before = JSON.stringify(exact); mockExact.mockResolvedValue(exact);
  await mount('/summaries/DS-1?summaryRef=DSR-1');
  const coverage = container.querySelector('[aria-label="确切成员与覆盖"]')!;
  const paragraphs = Array.from(coverage.querySelectorAll('p')).map(item => item.textContent);
  expect(paragraphs).toContain(limitation === legacyCoverageLimitation ? '正文未直接引用该成员工作。' : limitation);
  if (limitation === legacyCoverageLimitation) expect(paragraphs).not.toContain(legacyCoverageLimitation);
  expect(Array.from(coverage.querySelectorAll('li')).map(item => item.textContent)).toContain(legacyCoverageLimitation);
  for (const retained of ['成员条件须保留。', '来源新版尚未核对。', '构型待核', '当前工作已有新变化，原概述未覆盖'])
    expect(coverage.textContent).toContain(retained);
  expect(container.textContent).toContain('正文范围限制须保留。');
  expect(container.textContent).toContain('确切正文 DSR-1');
  expect(JSON.stringify(exact)).toBe(before);
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

// These are isolated UI/HTTP-mock checks, not Host revision admission or source authority.
const pendingCommand = (): RequestDerivedSummaryUpdate => ({ requestId: 'REQ-revision-fixed', purpose: 'REVISE_SAVED_SUMMARY',
  expectedSummaryRevision: 2, scope: summaryHead().scope, members: summaryHead().current!.members.map(item => item.member),
  instruction: '只修改明确目标', modelRef: 'miaoda/glm-5.3' });
async function chooseRevision() {
  const radio = container.querySelector<HTMLInputElement>('input[value="REVISE_SAVED_SUMMARY"]');
  if (!radio) throw new Error('revision choice missing');
  await act(async () => radio.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
}
test('new summary exposes no revision choice and sends explicit synthesis only', async () => {
  await mount('/summaries/new?kind=ATA4&fleetFamilyId=B787&ata2=46&ata4=46-00&title=有限范围');
  expect(container.querySelector('input[value="REVISE_SAVED_SUMMARY"]')).toBeNull();
  await prepareSelection(); mockCreate.mockRejectedValueOnce(new Error('结果未知')); await click('提交选定范围');
  expect(mockCreate.mock.calls[0][0]).toMatchObject({ purpose: 'SYNTHESIZE' });
  expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('expectedSummaryRevision'); expect(mockUpdate).not.toHaveBeenCalled();
});
test('explicit revision uses the exact current saved version and does not fabricate prior context', async () => {
  await mount('/summaries/DS-1/update'); await prepareSelection();
  await chooseRevision(); expect(container.querySelector('[aria-label="确认选定范围"]')!.textContent).toBe('false');
  await click('确认选定范围');
  const link = Array.from(container.querySelectorAll('a')).find(item => item.textContent?.includes('查看准确保存概述'))!;
  expect(new URL(link.href).searchParams.get('summaryRef')).toBe('DSR-2');
  mockUpdate.mockRejectedValueOnce(new Error('结果未知')); await click('提交修改要求');
  expect(mockUpdate).toHaveBeenCalledTimes(1); expect(mockUpdate.mock.calls[0][0]).toBe('DS-1');
  const input = mockUpdate.mock.calls[0][1];
  expect(input).toMatchObject({ purpose: 'REVISE_SAVED_SUMMARY', expectedSummaryRevision: 2, instruction: '仅工作23四问题，保留历史和未覆盖范围。' });
  for (const key of ['priorRef', 'previousSummary', 'revisionContext', 'modelInput']) expect(input).not.toHaveProperty(key);
  expect(container.textContent).toContain('上版概述不新增原始证据');
});
test('update defaults to synthesis even when the instruction contains revision words', async () => {
  mockInstruction = '修订上一版，但尚未选择修订任务';
  await mount('/summaries/DS-1/update'); await prepareSelection();
  mockUpdate.mockRejectedValueOnce(new Error('结果未知')); await click('提交选定范围');
  expect(mockUpdate.mock.calls[0][1]).toMatchObject({ purpose: 'SYNTHESIZE', expectedSummaryRevision: 2 });
});
const invalidRevisionTargets: Array<[string, (head: DerivedSummaryReadModel) => void]> = [
  ['unsaved', head => { head.current = null; head.currentSummaryRef = null; head.currentRevision = 0; }],
  ['missing ref', head => { head.currentSummaryRef = null; }],
  ['blank ref', head => { head.currentSummaryRef = ' '; head.current!.summaryRef = ' '; }],
  ['wrong ref', head => { head.currentSummaryRef = 'DSR-other'; }],
  ['wrong revision', head => { head.current!.revision = 1; }],
  ['fractional revision', head => { head.currentRevision = 2.5; head.current!.revision = 2.5; }],
  ['out of range revision', head => { head.currentRevision = 2147483647; head.current!.revision = 2147483647; }],
  ['wrong saved summary', head => { head.current!.summaryId = 'DS-other'; }],
  ['not candidate', head => { head.current!.candidateOnly = false as true; }],
];
test.each(invalidRevisionTargets)('invalid saved target %s cannot offer or create a new revision request', async (_label, mutate) => {
  const head = summaryHead(); mutate(head); mockHead.mockResolvedValue(head);
  await mount('/summaries/DS-1/update'); await prepareSelection();
  const radio = container.querySelector<HTMLInputElement>('input[value="REVISE_SAVED_SUMMARY"]')!;
  expect(radio.disabled).toBe(true); expect(container.textContent).not.toContain('查看准确保存概述');
  // Even a script bypassing the disabled UI cannot bypass submit's exact-target guard.
  radio.disabled = false; await chooseRevision(); await click('确认选定范围'); await click('提交修改要求');
  expect(container.textContent).toContain('没有可核权的准确保存概述'); expect(mockUpdate).not.toHaveBeenCalled(); expect(mockCreate).not.toHaveBeenCalled();
  expect(dom.window.sessionStorage.length).toBe(0);
});
test('revision replay preserves the complete original command after the head advances', async () => {
  const original = pendingCommand(); const text = JSON.stringify(original);
  const key = summaryPendingKey('tenant-1', 'actor-1', 'DS-1'); dom.window.sessionStorage.setItem(key, text);
  const head = summaryHead(); head.currentRevision = 3; head.currentSummaryRef = 'DSR-3'; head.current!.revision = 3; head.current!.summaryRef = 'DSR-3';
  mockHead.mockResolvedValue(head); mockUpdate.mockRejectedValueOnce(new Error('仍未知')).mockResolvedValueOnce({ summaryId: 'DS-1', attemptRef: 'AQ-1' });
  await mount('/summaries/DS-1/update'); expect(container.textContent).toContain('原请求锁定保存修订 2；目前指针为 3');
  expect(container.textContent).not.toContain('查看准确保存概述'); await click('用同一请求');
  const first = mockUpdate.mock.calls[0][1]; expect(first).toEqual(original); expect(dom.window.sessionStorage.getItem(key)).toBe(text);
  await click('用同一请求'); expect(mockUpdate.mock.calls[1][1]).toBe(first); expect(router.state.location.search).toBe('?attemptRef=AQ-1');
  expect(dom.window.sessionStorage.length).toBe(0);
});
test('legacy pending retries without adding purpose or following the new saved revision', async () => {
  const { purpose: _purpose, ...legacy } = pendingCommand(); const key = summaryPendingKey('tenant-1', 'actor-1', 'DS-1');
  dom.window.sessionStorage.setItem(key, JSON.stringify(legacy)); await mount('/summaries/DS-1/update');
  mockUpdate.mockRejectedValueOnce(new Error('未知')); await click('用同一请求');
  expect(mockUpdate.mock.calls[0][1]).toEqual(legacy); expect(mockUpdate.mock.calls[0][1]).not.toHaveProperty('purpose');
  expect(dom.window.sessionStorage.getItem(key)).toBe(JSON.stringify(legacy));
});
test('malicious revision pending in a new-summary slot blocks dispatch and preserves the failed snapshot', async () => {
  const key = summaryPendingKey('tenant-1', 'actor-1'); const text = JSON.stringify(pendingCommand()); dom.window.sessionStorage.setItem(key, text);
  await mount('/summaries/new'); expect(container.textContent).toContain('本地保留请求无法读取');
  expect(mockCreate).not.toHaveBeenCalled(); expect(mockUpdate).not.toHaveBeenCalled(); expect(dom.window.sessionStorage.getItem(key)).toBe(text);
});
test('two synchronous submit clicks dispatch one command before React busy state updates', async () => {
  await mount('/summaries/DS-1/update'); await prepareSelection(); await chooseRevision(); await click('确认选定范围');
  let reject!: (reason: Error) => void; mockUpdate.mockImplementationOnce(() => new Promise((_resolve, no) => { reject = no; }));
  const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.includes('提交修改要求'))!;
  await act(async () => { button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  expect(mockUpdate).toHaveBeenCalledTimes(1); expect(container.textContent).toContain('正在核对受理');
  await act(async () => reject(new Error('未知'))); expect(container.textContent).toContain('用同一请求核对受理结果');
  mockUpdate.mockRejectedValueOnce(new Error('仍未知')); await click('用同一请求'); expect(mockUpdate.mock.calls[1][1]).toBe(mockUpdate.mock.calls[0][1]);
});
test('storage failure prevents dispatch and releases the synchronous guard for a later explicit submit', async () => {
  await mount('/summaries/DS-1/update'); await prepareSelection(); await chooseRevision(); await click('确认选定范围');
  const write = jest.spyOn(dom.window.Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('quota'); });
  try {
    await click('提交修改要求'); expect(mockUpdate).not.toHaveBeenCalled(); expect(container.textContent).toContain('无法保留原请求快照');
    mockUpdate.mockRejectedValueOnce(new Error('未知')); await click('提交修改要求'); expect(mockUpdate).toHaveBeenCalledTimes(1);
  } finally { write.mockRestore(); }
});
test('late acceptance after session invalidation cannot clear pending or navigate', async () => {
  const original = pendingCommand(); const key = summaryPendingKey('tenant-1', 'actor-1', 'DS-1'); const text = JSON.stringify(original);
  dom.window.sessionStorage.setItem(key, text); let resolve!: (receipt: { summaryId: string; attemptRef: string }) => void;
  mockUpdate.mockImplementationOnce(() => new Promise(yes => { resolve = yes; })); await mount('/summaries/DS-1/update'); await click('用同一请求');
  mockSession++; mockAuthenticationRequired = true;
  await act(async () => { root.render(createElement(RouterProvider, { router, future: { v7_startTransition: true } })); await router.navigate('/summaries/DS-1/update?session=2'); });
  await act(async () => resolve({ summaryId: 'DS-1', attemptRef: 'AQ-late' }));
  expect(container.textContent).toContain('请先登录'); expect(router.state.location.pathname).toBe('/summaries/DS-1/update');
  expect(dom.window.sessionStorage.getItem(key)).toBe(text); expect(mockUpdate).toHaveBeenCalledTimes(1);
});
test('explicit revision rejection requires reset before a fresh selected command', async () => {
  const original = pendingCommand(); const key = summaryPendingKey('tenant-1', 'actor-1', 'DS-1'); dom.window.sessionStorage.setItem(key, JSON.stringify(original));
  mockUpdate.mockRejectedValueOnce(Object.assign(new Error('版本冲突'), { code: 'DERIVED_SUMMARY_REVISION_CONFLICT' }));
  await mount('/summaries/DS-1/update'); await click('用同一请求'); expect(container.textContent).toContain('请求未受理');
  expect(dom.window.sessionStorage.getItem(key)).toBe(JSON.stringify(original)); await click('重新读取并选择');
  expect(dom.window.sessionStorage.length).toBe(0); expect(mockUpdate).toHaveBeenCalledTimes(1); expect(router.state.location.pathname).toBe('/summaries/DS-1');
  await act(async () => router.navigate('/summaries/DS-1/update')); await prepareSelection();
  mockUpdate.mockRejectedValueOnce(new Error('未知')); await click('提交选定范围');
  const fresh = mockUpdate.mock.calls[1][1]; expect(fresh.purpose).toBe('SYNTHESIZE'); expect(fresh.requestId).not.toBe(original.requestId);
});
