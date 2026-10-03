import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { DerivedSummaryScopeSelection } from '@shared/derived-summary.interface';
import DerivedSummaryReadingPage from '@client/src/features/derived-summary/DerivedSummaryReadingPage';
import DerivedSummaryComposePage from '@client/src/features/derived-summary/DerivedSummaryComposePage';
import { summaryHead, summaryRevision } from './fixtures/derived-summary';
const { JSDOM } = require('jsdom');
const mockHead = jest.fn();
const mockExact = jest.fn();
const mockStatus = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
let mockSession = 1;
jest.mock('@client/src/api/derived-summary', () => ({
  readDerivedSummary: (...args: unknown[]) => mockHead(...args), readDerivedSummaryRevision: (...args: unknown[]) => mockExact(...args),
  readDerivedSummaryRequest: (...args: unknown[]) => mockStatus(...args), createDerivedSummary: (...args: unknown[]) => mockCreate(...args),
  updateDerivedSummary: (...args: unknown[]) => mockUpdate(...args),
}));
jest.mock('@client/src/api/canonical-host', () => ({ getCanonicalHostClientSessionGeneration: () => mockSession, getCanonicalHostIdentityContext: async () => ({ tenantId: 'tenant-1', userId: 'actor-1' }),
  readDocumentParsingStatus: async (documentVersionId: string) => ({ documentVersionId, documentCode: '787-FTD-fixture', businessRevision: '旧R1', selectedVersionIsCurrent: false }) }));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({ useCurrentUserSession: () => ({ sessionGeneration: mockSession, authenticationRequired: false }) }));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
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
  jest.clearAllMocks(); mockSession = 1;
  mockHead.mockResolvedValue(summaryHead()); mockExact.mockResolvedValue(summaryRevision());
  mockStatus.mockResolvedValue({ summaryId: 'DS-1', attemptRef: 'AQ-1', status: 'FAILED', errorCode: 'MODEL_FAILED', savedSummaryRefs: ['DSR-1'] });
});
afterEach(async () => {
  await act(async () => root?.unmount()); router?.dispose(); dom.window.close();
  for (const [key, descriptor] of oldGlobals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  oldGlobals.clear();
});
async function mount(route: string) {
  router = createMemoryRouter([{ path: '/summaries/new', element: createElement(DerivedSummaryComposePage) },
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
