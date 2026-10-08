import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import TdmsSourceReading from '@client/src/features/tdms-source/TdmsSourceReading';
import TdmsGraphSourceReading from '@client/src/features/tdms-source/TdmsGraphSourceReading';
import TdmsGraphSourceEntry from '@client/src/features/tdms-source/TdmsGraphSourceEntry';
import { catalogue, record, relations, savedEvidence } from './reader-fixtures';

const { JSDOM } = require('jsdom');
const mockCatalogue = jest.fn();
const mockRecord = jest.fn();
const mockRelations = jest.fn();
const mockWork = jest.fn();
const mockRejected = jest.fn();
let mockSession = { sessionGeneration: 1, authenticationRequired: false,
  currentUser: { user_id: 'user-A' } };
let mockIdentity = { appId: 'app-A', tenantId: 'tenant-A', actorId: 'actor-A' };
let mockIdentityFetching = false;

// These are transport boundaries only. Authorization is proved by the server tests, not by these mocks.
jest.mock('@client/src/api/canonical-host', () => ({
  readTdmsSourceCatalogue: (...args: unknown[]) => mockCatalogue(...args),
  readTdmsSourceRecord: (...args: unknown[]) => mockRecord(...args),
  readTdmsSourceRelations: (...args: unknown[]) => mockRelations(...args),
  readEngineeringKnowledgeWork: (...args: unknown[]) => mockWork(...args),
}));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({
  useCurrentUserSession: () => mockSession,
}));
jest.mock('@client/src/features/matter/useEngineeringMatter', () => ({
  useEngineeringMatterQueryIdentity: () => ({ identity: mockIdentity,
    identityQuery: { isFetching: mockIdentityFetching, error: null, refetch: jest.fn() } }),
}));
jest.mock('@client/src/pages/RelationGraphPage/RelationGraphCanvas', () => ({
  __esModule: true, default: () => createElement('div', { 'data-testid': 'graph-canvas' }),
}));
jest.mock('../../../client/src/features/tdms-source/tdms-source-reading.css', () => ({}));
jest.mock('../../../client/src/features/tdms-source/tdms-relation-graph.css', () => ({}));

let dom: InstanceType<typeof JSDOM>;
let container: HTMLElement;
let root: Root;
const oldGlobals = new Map<string, PropertyDescriptor | undefined>();
const context = { documentVersionId: 'document-version-1' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function renderReader(props: Record<string, unknown> = {}) {
  await act(async () => root.render(createElement(TdmsSourceReading,
    { context, enabled: true, onAccessRejected: mockRejected, ...props })));
}
async function renderGraph(props: Record<string, unknown> = {}) {
  await act(async () => root.render(createElement(TdmsGraphSourceReading,
    { documentVersionId: context.documentVersionId, enabled: true, onAccessRejected: mockRejected, ...props })));
}
async function click(label: string, within: ParentNode = container) {
  const button = Array.from(within.querySelectorAll('button')).find(item =>
    item.textContent?.trim().includes(label)) as HTMLButtonElement | undefined;
  if (!button) throw new Error(`Missing button: ${label}; buttons: ${Array.from(within.querySelectorAll('button')).map(item => item.textContent).join(' | ')}`);
  await act(async () => button.click());
}
const args = (mock: jest.Mock) => mock.mock.calls.map(call => call.slice(0, -1));

beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test/' });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true })) {
    oldGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  container = dom.window.document.getElementById('root')!;
  root = createRoot(container);
  mockSession = { sessionGeneration: 1, authenticationRequired: false, currentUser: { user_id: 'user-A' } };
  mockIdentity = { appId: 'app-A', tenantId: 'tenant-A', actorId: 'actor-A' };
  mockIdentityFetching = false;
  mockCatalogue.mockReset();
  mockRecord.mockReset();
  mockRelations.mockReset();
  mockWork.mockReset();
  mockRejected.mockReset();
  mockCatalogue.mockImplementation(async () => catalogue('revision-A', 'revision-B'));
  mockRecord.mockImplementation(async (ref: string) => record(ref));
  mockRelations.mockImplementation(async (ref: string) => relations(ref));
});
afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  for (const [key, descriptor] of oldGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  oldGlobals.clear();
});

it('Wiki lists directory metadata without reading bodies; exact selection and explicit relation expansion gate both GETs', async () => {
  await renderReader();
  expect(args(mockCatalogue)).toEqual([[context, undefined]]);
  expect(container.textContent).toContain('Directory revision-A');
  expect(container.textContent).not.toContain('Private excerpt');
  expect(mockRecord).not.toHaveBeenCalled();
  expect(mockRelations).not.toHaveBeenCalled();
  await click('Directory revision-B');
  expect(args(mockRecord)).toEqual([['revision-B', context]]);
  expect(container.textContent).toContain('Private excerpt revision-B');
  expect(mockRelations).not.toHaveBeenCalled();
  await click('授权读取此修订的来源关系');
  expect(args(mockRelations)).toEqual([['revision-B', context]]);
  expect(container.querySelector('[aria-label="TDMS 准确来源关系图谱"]')).not.toBeNull();
});

it('graph-first selection reads relations first; only a chosen exact node and its authorization button read body, then return to the same root', async () => {
  await renderReader({ graphFirst: true });
  await click('Directory revision-A');
  expect(args(mockRelations)).toEqual([['revision-A', context]]);
  expect(mockRecord).not.toHaveBeenCalled();
  const graph = container.querySelector('[aria-label="TDMS 准确来源关系图谱"]')!;
  await click('准确来源修订 endpoint-B', graph);
  expect(mockRecord).not.toHaveBeenCalled();
  await click('授权展开此准确端点', graph);
  expect(args(mockRecord)).toEqual([['endpoint-B', context]]);
  expect(container.textContent).toContain('Private excerpt endpoint-B');
  await click('返回同一准确来源图谱');
  expect(container.textContent).toContain('准确来源关系概览 revision-A');
  expect(container.textContent).not.toContain('Private excerpt endpoint-B');
  expect(args(mockRelations)).toEqual([
    ['revision-A', context],
    ['revision-A', context],
  ]);
});

it.each([401, 403, 404])('a %s denial clears prior record, relation, and selection and notifies parent without rendering server text', async statusCode => {
  await renderReader();
  await click('Directory revision-A');
  await click('授权读取此修订的来源关系');
  expect(container.textContent).toContain('Private excerpt revision-A');
  expect(container.querySelector('[aria-label="TDMS 准确来源关系图谱"]')).not.toBeNull();
  mockRecord.mockRejectedValueOnce({ statusCode, message: 'SECRET SERVER BODY' });
  await click('Directory revision-B');
  expect(mockRejected).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('原目录、正文与关系已清除');
  expect(container.textContent).not.toContain('Private excerpt revision-A');
  expect(container.textContent).not.toContain('SECRET SERVER BODY');
  expect(container.querySelector('[aria-label="TDMS 来源展开"]')).toBeNull();
  expect(container.querySelector('[aria-label="TDMS 准确来源关系图谱"]')).toBeNull();
});

it('historical saved work waits for matching identity and shows only receipt-bound refs, with no current catalogue request', async () => {
  const savedWork = { subjectKind: 'WORK_ITEM' as const, subjectId: 'item-1', workRef: 'work-old' };
  const pending = deferred<any>();
  mockWork.mockReturnValueOnce(pending.promise);
  await renderGraph({ savedWork });
  expect(args(mockWork)).toEqual([[savedWork]]);
  expect(mockCatalogue).not.toHaveBeenCalled();
  expect(mockRecord).not.toHaveBeenCalled();
  await act(async () => pending.resolve({
    entry: savedWork, content: { evidence: [savedEvidence('saved-A'), savedEvidence('unbound-B', 'other-B')] },
    overall: { readingResult: { evidence: [savedEvidence('saved-A')] } },
  }));
  expect(container.textContent).toContain('saved-A');
  expect(container.textContent).not.toContain('unbound-B');
  expect(mockCatalogue).not.toHaveBeenCalled();
  await click('查看已保存引用的关系概览 saved-A');
  expect(args(mockRelations)).toEqual([['saved-A', context]]);
  expect(mockRecord).not.toHaveBeenCalled();
});

it('rejects a mismatching saved-work response before directory, relations, or body', async () => {
  const savedWork = { subjectKind: 'WORK_ITEM' as const, subjectId: 'item-1', workRef: 'work-old' };
  mockWork.mockResolvedValue({ entry: { ...savedWork, workRef: 'some-other-work' },
    content: { evidence: [savedEvidence('foreign-revision')] } });
  await renderGraph({ savedWork });
  expect(container.textContent).toContain('返回工作身份与所选准确工作不符');
  expect(mockCatalogue).not.toHaveBeenCalled();
  expect(mockRelations).not.toHaveBeenCalled();
  expect(mockRecord).not.toHaveBeenCalled();
});

it('hides late selection, actor, and session responses, including after unmount', async () => {
  const selectionPending = deferred<any>();
  mockRecord.mockImplementationOnce(() => selectionPending.promise);
  await renderReader();
  await click('Directory revision-A');
  await click('Directory revision-B');
  expect(container.textContent).toContain('Private excerpt revision-B');
  await act(async () => selectionPending.resolve(record('revision-A', 'LATE SELECTION SECRET')));
  expect(container.textContent).not.toContain('LATE SELECTION SECRET');

  const actorPending = deferred<any>();
  mockRecord.mockImplementationOnce(() => actorPending.promise);
  await click('Directory revision-A');
  mockIdentity = { ...mockIdentity, actorId: 'actor-B' };
  await renderReader();
  expect(container.textContent).not.toContain('Private excerpt revision-B');
  expect(container.querySelector('[aria-label="TDMS 来源展开"]')).toBeNull();
  await act(async () => actorPending.resolve(record('revision-A', 'LATE ACTOR SECRET')));
  expect(container.textContent).not.toContain('LATE ACTOR SECRET');

  const sessionPending = deferred<any>();
  mockRecord.mockImplementationOnce(() => sessionPending.promise);
  await click('Directory revision-A');
  mockSession = { ...mockSession, sessionGeneration: 2, authenticationRequired: true };
  await renderReader();
  expect(container.textContent).toContain('请先登录');
  await act(async () => sessionPending.resolve(record('revision-A', 'LATE SESSION SECRET')));
  expect(container.textContent).not.toContain('LATE SESSION SECRET');
  mockSession = { ...mockSession, sessionGeneration: 3, authenticationRequired: false };
  await renderReader();
  const unmountPending = deferred<any>();
  mockRecord.mockImplementationOnce(() => unmountPending.promise);
  await click('Directory revision-A');
  await act(async () => root.unmount());
  await act(async () => unmountPending.resolve(record('revision-A', 'LATE UNMOUNT SECRET')));
  root = createRoot(container);
  expect(container.textContent).not.toContain('LATE UNMOUNT SECRET');
});

it('invalidates a same-subject membership epoch, aborts its pending body and requires a fresh directory GET', async () => {
  const pending = deferred<any>();
  mockRecord.mockImplementationOnce(() => pending.promise);
  await renderReader({ authorizationEpoch: 'member-1' });
  await click('Directory revision-A');
  const pendingSignal = mockRecord.mock.calls[0][2] as AbortSignal;
  expect(pendingSignal.aborted).toBe(false);

  await renderReader({ authorizationEpoch: 'member-2' });
  expect(pendingSignal.aborted).toBe(true);
  expect(container.querySelector('[aria-label="TDMS 来源展开"]')).toBeNull();
  expect(mockCatalogue).toHaveBeenCalledTimes(2);
  await act(async () => pending.resolve(record('revision-A', 'LATE MEMBER SECRET')));
  expect(container.textContent).not.toContain('LATE MEMBER SECRET');
  await click('Directory revision-A');
  expect(mockRecord).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain('Private excerpt revision-A');
});

it('a trusted permission-denied notification immediately hides body and relations and rejects late reads', async () => {
  await renderReader({ authorizationEpoch: 'member-1' });
  await click('Directory revision-A');
  await click('授权读取此修订的来源关系');
  expect(container.textContent).toContain('Private excerpt revision-A');
  expect(container.querySelector('[aria-label="TDMS 准确来源关系图谱"]')).not.toBeNull();

  const pending = deferred<any>();
  mockRecord.mockImplementationOnce(() => pending.promise);
  await click('Directory revision-B');
  const pendingSignal = mockRecord.mock.calls[1][2] as AbortSignal;
  await renderReader({ authorizationEpoch: 'member-1', authorizationDenied: true });
  expect(pendingSignal.aborted).toBe(true);
  expect(container.textContent).toContain('原目录、正文与关系已清除');
  expect(container.textContent).not.toContain('Private excerpt');
  expect(container.querySelector('[aria-label="TDMS 准确来源关系图谱"]')).toBeNull();
  await act(async () => pending.resolve(record('revision-B', 'LATE REVOKED SECRET')));
  expect(container.textContent).not.toContain('LATE REVOKED SECRET');
  expect(mockRejected).toHaveBeenCalledTimes(1);
});

it('disabling and re-enabling the same scope cannot revive a pre-pause response', async () => {
  const pending = deferred<any>();
  mockCatalogue.mockImplementationOnce(() => pending.promise);
  await renderReader();
  const pendingSignal = mockCatalogue.mock.calls[0][2] as AbortSignal;
  await renderReader({ enabled: false });
  expect(pendingSignal.aborted).toBe(true);
  await act(async () => pending.resolve(catalogue('old-secret')));
  expect(container.textContent).not.toContain('old-secret');
  await renderReader({ enabled: true });
  expect(mockCatalogue).toHaveBeenCalledTimes(2);
  expect(container.textContent).not.toContain('old-secret');
  expect(container.textContent).toContain('Directory revision-A');
});

it('revalidates an open exact read on foreground without displaying its prior body while waiting', async () => {
  await renderReader();
  await click('Directory revision-A');
  expect(container.textContent).toContain('Private excerpt revision-A');

  const pending = deferred<any>();
  mockRecord.mockImplementationOnce(() => pending.promise);
  await act(async () => dom.window.dispatchEvent(new dom.window.Event('focus')));
  expect(mockCatalogue).toHaveBeenCalledTimes(2);
  expect(mockRecord).toHaveBeenCalledTimes(2);
  expect(container.textContent).not.toContain('Private excerpt revision-A');
  await act(async () => pending.resolve(record('revision-A')));
  expect(container.textContent).toContain('Private excerpt revision-A');
});

it('closed graph entry has no controls and cannot activate a source read', async () => {
  const onLayerChange = jest.fn();
  await act(async () => root.render(createElement(TdmsGraphSourceEntry,
    { documentVersionId: context.documentVersionId, onLayerChange })));
  expect(container.textContent).toBe('');
  expect(container.querySelector('button')).toBeNull();
  expect(mockCatalogue).not.toHaveBeenCalled();
  expect(mockWork).not.toHaveBeenCalled();
  expect(onLayerChange).not.toHaveBeenCalled();
});
