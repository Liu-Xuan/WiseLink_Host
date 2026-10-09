import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import TdmsSourceReading from '@client/src/features/tdms-source/TdmsSourceReading';
import { catalogue, record, relations } from './reader-fixtures';

const { JSDOM } = require('jsdom');
const mockCatalogue = jest.fn();
const mockRecord = jest.fn();
const mockRelations = jest.fn();
const mockLoadGraph = jest.fn();
const mockRejected = jest.fn();
let mockSession = { sessionGeneration: 1, authenticationRequired: false,
  currentUser: { user_id: 'user-A' } };
let mockIdentity = { appId: 'app-A', tenantId: 'tenant-A', actorId: 'actor-A' };
let mockIdentityFetching = false;
let graphRender = jest.fn();
let throwFromGraph = false;

function LoadedGraph({ reading, rootRecord, onClose }: {
  reading: ReturnType<typeof relations>;
  rootRecord?: { sourceRevisionRef: string };
  onClose?: () => void;
}) {
  graphRender(reading, rootRecord);
  if (throwFromGraph) throw new Error('graph renderer failed');
  return createElement('div', { 'data-testid': 'loaded-graph', 'data-ref': reading.sourceRevisionRef },
    createElement('span', null, `loaded ${reading.sourceRevisionRef}`),
    onClose ? createElement('button', { type: 'button', onClick: onClose }, 'close graph') : null);
}

// Keep the authorization and transport lifecycle real; replace only the costly graph chunk.
jest.mock('@client/src/api/canonical-host', () => ({
  readTdmsSourceCatalogue: (...args: unknown[]) => mockCatalogue(...args),
  readTdmsSourceRecord: (...args: unknown[]) => mockRecord(...args),
  readTdmsSourceRelations: (...args: unknown[]) => mockRelations(...args),
}));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({
  useCurrentUserSession: () => mockSession,
}));
jest.mock('@client/src/features/matter/useEngineeringMatter', () => ({
  useEngineeringMatterQueryIdentity: () => ({ identity: mockIdentity,
    identityQuery: { isFetching: mockIdentityFetching, error: null, refetch: jest.fn() } }),
}));
jest.mock('@client/src/features/tdms-source/tdms-relation-graph-loader', () => ({
  loadTdmsSourceRelationGraph: () => mockLoadGraph(),
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
async function click(label: string, within: ParentNode = container) {
  const button = Array.from(within.querySelectorAll('button')).find(item =>
    item.textContent?.trim().includes(label)) as HTMLButtonElement | undefined;
  if (!button) throw new Error(`Missing button: ${label}; buttons: ${Array.from(within.querySelectorAll('button')).map(item => item.textContent).join(' | ')}`);
  await act(async () => button.click());
}
const args = (mock: jest.Mock) => mock.mock.calls.map(call => call.slice(0, -1));
const graphModule = { default: LoadedGraph } as never;

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
  graphRender = jest.fn();
  throwFromGraph = false;
  mockCatalogue.mockReset().mockImplementation(async () => catalogue('revision-A', 'revision-B'));
  mockRecord.mockReset().mockImplementation(async (ref: string) => record(ref));
  mockRelations.mockReset().mockImplementation(async (ref: string) => relations(ref));
  mockRejected.mockReset();
  mockLoadGraph.mockReset().mockResolvedValue(graphModule);
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

it('record-first loads graph code only after the authorized relation response, with no extra GET or click', async () => {
  await renderReader();
  expect(mockLoadGraph).not.toHaveBeenCalled();
  await click('Directory revision-A');
  expect(args(mockRecord)).toEqual([['revision-A', context]]);
  expect(mockLoadGraph).not.toHaveBeenCalled();
  await click('授权读取此修订的来源关系');
  expect(args(mockRelations)).toEqual([['revision-A', context]]);
  expect(mockLoadGraph).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[data-testid="loaded-graph"]')?.getAttribute('data-ref')).toBe('revision-A');
  expect(graphRender).toHaveBeenCalledWith(expect.objectContaining({ sourceRevisionRef: 'revision-A' }),
    expect.objectContaining({ sourceRevisionRef: 'revision-A' }));
  expect(mockCatalogue).toHaveBeenCalledTimes(1);
  expect(mockRecord).toHaveBeenCalledTimes(1);
  expect(mockRelations).toHaveBeenCalledTimes(1);
});

it('graph-first mounts deferred code on relations alone and does not read the selected record', async () => {
  await renderReader({ graphFirst: true });
  expect(mockLoadGraph).not.toHaveBeenCalled();
  await click('Directory revision-A');
  expect(args(mockRelations)).toEqual([['revision-A', context]]);
  expect(mockRecord).not.toHaveBeenCalled();
  expect(mockLoadGraph).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[data-testid="loaded-graph"]')?.getAttribute('data-ref')).toBe('revision-A');
  expect(graphRender).toHaveBeenCalledWith(expect.objectContaining({ sourceRevisionRef: 'revision-A' }),
    expect.objectContaining({ sourceRevisionRef: 'revision-A' }));
});

it('does not request the graph module while an authorized relation GET is pending', async () => {
  const pending = deferred<ReturnType<typeof relations>>();
  mockRelations.mockReturnValueOnce(pending.promise);
  await renderReader();
  await click('Directory revision-A');
  await click('授权读取此修订的来源关系');
  expect(args(mockRelations)).toEqual([['revision-A', context]]);
  expect(mockLoadGraph).not.toHaveBeenCalled();
  expect(container.textContent).toContain('正在读取此准确修订的获准关系');

  await act(async () => { pending.resolve(relations('revision-A')); await pending.promise; });
  expect(mockLoadGraph).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[data-testid="loaded-graph"]')?.getAttribute('data-ref')).toBe('revision-A');
});

it('shows B before delayed A resolves; returning to A waits for A relations to be fetched again', async () => {
  const pendingAChunk = deferred<typeof graphModule>();
  const pendingBRelations = deferred<ReturnType<typeof relations>>();
  const pendingBackToARelations = deferred<ReturnType<typeof relations>>();
  let aReads = 0;
  mockRelations.mockImplementation((ref: string) => {
    if (ref === 'revision-B') return pendingBRelations.promise;
    aReads += 1;
    return aReads === 1 ? Promise.resolve(relations(ref)) : pendingBackToARelations.promise;
  });
  mockLoadGraph.mockReset().mockReturnValueOnce(pendingAChunk.promise).mockResolvedValue(graphModule);

  await renderReader({ graphFirst: true });
  await click('Directory revision-A');
  expect(mockLoadGraph).toHaveBeenCalledTimes(1);
  await click('Directory revision-B');
  expect(args(mockRelations)).toEqual([['revision-A', context], ['revision-B', context]]);
  expect(mockLoadGraph).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[data-testid="loaded-graph"]')).toBeNull();

  await act(async () => { pendingBRelations.resolve(relations('revision-B')); await pendingBRelations.promise; });
  expect(mockLoadGraph).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[data-testid="loaded-graph"]')?.getAttribute('data-ref')).toBe('revision-B');
  await act(async () => { pendingAChunk.resolve(graphModule); await pendingAChunk.promise; });
  expect(container.querySelector('[data-testid="loaded-graph"]')?.getAttribute('data-ref')).toBe('revision-B');
  expect(graphRender.mock.calls.every(call => call[0].sourceRevisionRef === 'revision-B')).toBe(true);

  await click('返回上一准确来源');
  expect(args(mockRelations)).toEqual([
    ['revision-A', context], ['revision-B', context], ['revision-A', context],
  ]);
  expect(mockLoadGraph).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[data-testid="loaded-graph"]')).toBeNull();
  expect(container.textContent).toContain('正在读取此准确修订的获准关系');
  await act(async () => {
    pendingBackToARelations.resolve(relations('revision-A'));
    await pendingBackToARelations.promise;
  });
  expect(mockLoadGraph).toHaveBeenCalledTimes(3);
  expect(container.querySelector('[data-testid="loaded-graph"]')?.getAttribute('data-ref')).toBe('revision-A');
  expect(mockRecord).not.toHaveBeenCalled();
});

it('reopening a closed graph and retrying a failed module keep the exact ref and do not add body or catalogue reads', async () => {
  await renderReader();
  await click('Directory revision-A');
  await click('授权读取此修订的来源关系');
  await click('close graph');
  expect(container.querySelector('[data-testid="loaded-graph"]')).toBeNull();
  await click('授权读取此修订的来源关系');
  expect(mockLoadGraph).toHaveBeenCalledTimes(2);
  expect(args(mockRelations)).toEqual([['revision-A', context], ['revision-A', context]]);
  expect(container.querySelector('[data-testid="loaded-graph"]')?.getAttribute('data-ref')).toBe('revision-A');
  expect(args(mockRecord)).toEqual([['revision-A', context]]);
  expect(mockCatalogue).toHaveBeenCalledTimes(1);

  // A later chunk failure is local to display; its retry must not repeat any source GET.
  await click('close graph');
  mockLoadGraph.mockRejectedValueOnce(new Error('chunk unavailable'));
  await click('授权读取此修订的来源关系');
  expect(container.textContent).toContain('关系图谱显示未完成');
  await click('重试显示此关系图谱');
  expect(container.querySelector('[data-testid="loaded-graph"]')?.getAttribute('data-ref')).toBe('revision-A');
  expect(mockLoadGraph).toHaveBeenCalledTimes(4);
  expect(mockRelations).toHaveBeenCalledTimes(3);
  expect(mockRecord).toHaveBeenCalledTimes(1);
  expect(mockCatalogue).toHaveBeenCalledTimes(1);
  expect(graphRender.mock.calls.every(call => call[0].sourceRevisionRef === 'revision-A')).toBe(true);
});

it('render errors offer a local retry with the same relation and record refs and no extra GETs', async () => {
  await renderReader();
  await click('Directory revision-A');
  await click('授权读取此修订的来源关系');
  throwFromGraph = true;
  // Force the renderer to throw on a fresh mount after the current authorized graph is reopened.
  await click('close graph');
  await click('授权读取此修订的来源关系');
  expect(container.textContent).toContain('关系图谱显示未完成');
  throwFromGraph = false;
  await click('重试显示此关系图谱');
  expect(container.querySelector('[data-testid="loaded-graph"]')?.getAttribute('data-ref')).toBe('revision-A');
  expect(mockRecord).toHaveBeenCalledTimes(1);
  expect(mockRelations).toHaveBeenCalledTimes(2);
  expect(mockCatalogue).toHaveBeenCalledTimes(1);
  expect(graphRender.mock.calls.every(call => call[0].sourceRevisionRef === 'revision-A')).toBe(true);
});

it.each(['close', 'navigate', 'permission', 'session', 'unmount'] as const)(
  'ignores a delayed graph module after %s and never renders its stale ref', async action => {
    const pending = deferred<typeof graphModule>();
    mockLoadGraph.mockReturnValueOnce(pending.promise);
    await renderReader();
    await click('Directory revision-A');
    await click('授权读取此修订的来源关系');
    expect(mockLoadGraph).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('正在显示此准确来源的关系图谱');

    if (action === 'close') await click('收起来源关系');
    if (action === 'navigate') await click('Directory revision-B');
    if (action === 'permission') await renderReader({ authorizationDenied: true });
    if (action === 'session') {
      mockSession = { ...mockSession, sessionGeneration: 2, authenticationRequired: true };
      await renderReader();
    }
    if (action === 'unmount') {
      await act(async () => root.unmount());
      root = createRoot(container);
    }
    await act(async () => { pending.resolve(graphModule); await pending.promise; });
    expect(container.querySelector('[data-ref="revision-A"]')).toBeNull();
    if (action === 'permission') {
      expect(container.textContent).toContain('原目录、正文与关系已清除');
      expect(mockRejected).toHaveBeenCalledTimes(1);
    }
    if (action === 'session') expect(container.textContent).toContain('请先登录');
    if (action === 'navigate') expect(container.textContent).toContain('Private excerpt revision-B');
  },
);
