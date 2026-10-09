import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { useSuiteTdmsSources } from '@client/src/pages/RelationGraphPage/useSuiteTdmsSources';
import EnabledSuiteTdmsSourceLayer from '@client/src/pages/RelationGraphPage/EnabledSuiteTdmsSourceLayer';
import type { SuiteTdmsSourceLayerProps } from '@client/src/pages/RelationGraphPage/SuiteTdmsSourceLayer';
import { buildSuiteMatterGraph, appendSuiteGraphCatalogDocuments } from '@client/src/pages/RelationGraphPage/suite-matter-graph';
import type { SuiteMatterGraphRead } from '@client/src/pages/RelationGraphPage/suite-matter-graph';
import { libraryMatterFixture } from '../fixtures/library-matter';
import { suiteTdmsCatalogue, suiteTdmsSummary, suiteTdmsRecordRead,
  suiteTdmsAssertion, suiteTdmsRelationsRead, suiteProblemOnlyWorkspace, suiteMatterWithCatalogue } from '../fixtures/suite-tdms-mount';

const { JSDOM } = require('jsdom');
const mockCatalogue = jest.fn();
const mockRecord = jest.fn();
const mockRelations = jest.fn();
const mockRejected = jest.fn();
const mockRefetch = jest.fn();
const mockIdentityEnabled = jest.fn();
const mockLayerRecheck = jest.fn();
let mockSession = { authenticationRequired: false, currentUser: { user_id: 'synthetic-user' } };
let mockIdentity = { appId: 'synthetic-app', tenantId: 'synthetic-tenant', actorId: 'synthetic-actor' };
let mockUpdatedAt = 1;
let mockIdentityError: Error | null = null;
let mockFetching = false;

// Synthetic enabled hook only: these transport mocks do not prove Host admission or authorization.
// The real consumer tests leave the immutable UI constant false and never mount this hook.
jest.mock('@client/src/api/canonical-host', () => ({
  readTdmsSourceCatalogue: (...args: unknown[]) => mockCatalogue(...args),
  readTdmsSourceRecord: (...args: unknown[]) => mockRecord(...args),
  readTdmsSourceRelations: (...args: unknown[]) => mockRelations(...args),
}));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({ useCurrentUserSession: () => mockSession }));
jest.mock('@client/src/features/matter/useEngineeringMatter', () => ({
  useEngineeringMatterQueryIdentity: (enabled: boolean) => {
    mockIdentityEnabled(enabled);
    return { identity: mockIdentity, identityQuery: { dataUpdatedAt: mockUpdatedAt,
      isFetching: mockFetching, error: mockIdentityError, refetch: mockRefetch } };
  },
}));

type Input = Parameters<typeof useSuiteTdmsSources>[0];
let observed: ReturnType<typeof useSuiteTdmsSources>;
let dom: InstanceType<typeof JSDOM>;
let root: Root;
const globals = new Map<string, PropertyDescriptor | undefined>();
const initial: Input = { matterId: 'synthetic-matter', workRef: 'saved-work-7', session: 1,
  sourceAccessEpoch: 0, enabled: true, allowCurrentSources: true, onAccessRejected: mockRejected };
let input: Input;
let layerRead: SuiteMatterGraphRead;
let layerOpen: (sourceRevisionRef: string) => void;
function Probe(props: Input) {
  observed = useSuiteTdmsSources(props);
  return createElement('div', {}, JSON.stringify({ body: observed.body.value, relations: observed.relations.value }));
}
async function render(extra: Partial<Input> = {}) {
  input = { ...input, ...extra };
  await act(async () => root.render(createElement(Probe, input)));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
const requests = (mock: jest.Mock) => mock.mock.calls.map(call => call.slice(0, -1));
async function openCatalogue() { await act(async () => observed.toggle()); }

beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>', { url: 'https://synthetic.test/' });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  root = createRoot(dom.window.document.getElementById('root')!);
  input = { ...initial };
  mockSession = { authenticationRequired: false, currentUser: { user_id: 'synthetic-user' } };
  mockIdentity = { appId: 'synthetic-app', tenantId: 'synthetic-tenant', actorId: 'synthetic-actor' };
  mockUpdatedAt = 1; mockIdentityError = null; mockFetching = false;
  for (const mock of [mockCatalogue, mockRecord, mockRelations, mockRejected, mockRefetch, mockIdentityEnabled, mockLayerRecheck]) mock.mockReset();
  mockLayerRecheck.mockResolvedValue(undefined);
  mockRefetch.mockResolvedValue({});
  mockCatalogue.mockResolvedValue(suiteTdmsCatalogue([suiteTdmsSummary('exact-7')]));
  mockRecord.mockImplementation(async (ref: string) => suiteTdmsRecordRead(ref));
  mockRelations.mockImplementation(async (ref: string) => suiteTdmsRelationsRead(ref, [suiteTdmsAssertion(ref, 'assertion-7')]));
});
afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  for (const [key, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
  globals.clear();
});

it('enabled synthetic Suite hook waits for an explicit directory action and keeps all record/relation refs exact', async () => {
  await render();
  expect(mockCatalogue).not.toHaveBeenCalled(); expect(mockRecord).not.toHaveBeenCalled();
  await openCatalogue();
  expect(mockRefetch).toHaveBeenCalledTimes(1);
  expect(requests(mockCatalogue)).toEqual([[{ matterId: 'synthetic-matter' }, undefined]]);
  expect(mockRecord).not.toHaveBeenCalled(); expect(mockRelations).not.toHaveBeenCalled();
  await act(async () => observed.readRelations('exact-7'));
  expect(requests(mockRelations)).toEqual([['exact-7', { matterId: 'synthetic-matter' }]]);
  await act(async () => observed.readBody('exact-7'));
  expect(requests(mockRecord)).toEqual([['exact-7', { matterId: 'synthetic-matter' }]]);
  expect(observed.bodyRef).toBe('exact-7'); expect(observed.body.value?.receipt.sourceRevisionRef).toBe('exact-7');
});

it('historical saved work can request only an explicit exact body and never the current directory or current relations', async () => {
  await render({ allowCurrentSources: false, workRef: 'historical-work-2' });
  await act(async () => observed.readBody('saved-exact-2'));
  expect(requests(mockRecord)).toEqual([['saved-exact-2', { matterId: 'synthetic-matter' }]]);
  await openCatalogue(); await act(async () => observed.readRelations('saved-exact-2'));
  expect(mockCatalogue).not.toHaveBeenCalled(); expect(mockRelations).not.toHaveBeenCalled();
  expect(mockRecord).toHaveBeenCalledTimes(1); expect(observed.canReadRelations).toBe(false);
});

it.each([401, 403, 404])('synthetic %s rejection clears every source resource without a latest-version retry', async statusCode => {
  await render(); await openCatalogue();
  await act(async () => observed.readRelations('exact-7'));
  await act(async () => observed.readBody('exact-7'));
  expect(observed.body.value).not.toBeNull(); expect(observed.relations.value).not.toBeNull();
  mockRecord.mockRejectedValueOnce({ statusCode, message: 'SECRET RESPONSE BODY' });
  await act(async () => observed.readBody('denied-exact-8'));
  expect(observed.body.value).toBeNull(); expect(observed.relations.value).toBeNull(); expect(observed.catalogue.value).toBeNull();
  expect(observed.bodyRef).toBeNull(); expect(observed.relationRef).toBeNull(); expect(observed.accessBlocked).toBe(true);
  expect(mockRejected).toHaveBeenCalledTimes(1);
  await act(async () => { observed.readBody('exact-7'); observed.readRelations('exact-7'); });
  expect(mockRecord).toHaveBeenCalledTimes(2); expect(mockRelations).toHaveBeenCalledTimes(1);
  expect(dom.window.document.body.textContent).not.toContain('SECRET RESPONSE BODY');
});

it.each(['actor', 'tenant', 'session', 'matter', 'work', 'authorizationEpoch'] as const)(
  'synthetic %s change aborts a pending exact body and masks its late response', async changed => {
    await render(); const pending = deferred<ReturnType<typeof suiteTdmsRecordRead>>();
    mockRecord.mockReturnValueOnce(pending.promise);
    await act(async () => observed.readBody('old-exact-7'));
    const signal = mockRecord.mock.calls[0][2] as AbortSignal;
    if (changed === 'actor') mockIdentity = { ...mockIdentity, actorId: 'actor-new' };
    if (changed === 'tenant') mockIdentity = { ...mockIdentity, tenantId: 'tenant-new' };
    await render(changed === 'session' ? { session: 2 } : changed === 'matter' ? { matterId: 'matter-new' }
      : changed === 'work' ? { workRef: 'work-new' } : changed === 'authorizationEpoch' ? { sourceAccessEpoch: 2 } : {});
    expect(signal.aborted).toBe(true); expect(observed.bodyRef).toBeNull(); expect(observed.body.value).toBeNull();
    await act(async () => pending.resolve(suiteTdmsRecordRead('old-exact-7', 'LATE PRIVATE SOURCE')));
    expect(observed.body.value).toBeNull(); expect(dom.window.document.body.textContent).not.toContain('LATE PRIVATE SOURCE');
    expect(mockRecord).toHaveBeenCalledTimes(1);
  },
);

it('synthetic identity fetching/authentication failure masks prior source body and blocks new GETs', async () => {
  await render(); await act(async () => observed.readBody('exact-7'));
  mockFetching = true; await render(); expect(observed.body.value).toBeNull();
  await act(async () => observed.readBody('another-exact-8')); expect(mockRecord).toHaveBeenCalledTimes(1);
  mockFetching = false; mockSession = { ...mockSession, authenticationRequired: true }; await render({ session: 2 });
  expect(observed.body.value).toBeNull(); expect(mockIdentityEnabled).toHaveBeenLastCalledWith(false);
  expect(observed.canReadBody).toBe(false);
});

it('disabling a synthetic hook aborts pending reads and reopening cannot resurrect the old response', async () => {
  const pending = deferred<ReturnType<typeof suiteTdmsRecordRead>>();
  mockRecord.mockReturnValueOnce(pending.promise); await render();
  await act(async () => observed.readBody('old-exact-7'));
  const signal = mockRecord.mock.calls[0][2] as AbortSignal;
  await render({ enabled: false }); expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(suiteTdmsRecordRead('old-exact-7', 'PAUSED PRIVATE SOURCE')));
  await render({ enabled: true }); expect(observed.body.value?.receipt.sourceRevisionRef).toBe('old-exact-7');
  expect(mockRecord).toHaveBeenCalledTimes(2);
  expect(dom.window.document.body.textContent).not.toContain('PAUSED PRIVATE SOURCE');
});

it('a disabled synthetic hook leaves the identity query disabled and record/relation actions issue zero GETs', async () => {
  await render({ enabled: false });
  await act(async () => { observed.readBody('exact-7'); observed.readRelations('exact-7'); });
  expect(mockIdentityEnabled).toHaveBeenLastCalledWith(false);
  expect(mockCatalogue).not.toHaveBeenCalled(); expect(mockRecord).not.toHaveBeenCalled(); expect(mockRelations).not.toHaveBeenCalled();
});

it('unmount aborts a pending exact read with no hidden latest request', async () => {
  const pending = deferred<ReturnType<typeof suiteTdmsRecordRead>>();
  mockRecord.mockReturnValueOnce(pending.promise); await render();
  await act(async () => observed.readBody('exact-7'));
  const signal = mockRecord.mock.calls[0][2] as AbortSignal;
  await act(async () => root.unmount()); expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(suiteTdmsRecordRead('exact-7')));
  root = createRoot(dom.window.document.getElementById('root')!); expect(mockRecord).toHaveBeenCalledTimes(1);
});

// Invoke the actual enabled inner solely in this synthetic harness; the production outer constant is never overridden.
async function renderLayer(extra: Partial<SuiteTdmsSourceLayerProps> = {}) {
  const props: SuiteTdmsSourceLayerProps = { read: buildSuiteMatterGraph(libraryMatterFixture()),
    matterId: 'synthetic-matter', workRef: 'saved-work-7', session: 1, allowCurrentSources: true,
    openDocument: jest.fn(), onAccessRejected: mockLayerRecheck,
    children: (read, openSource) => {
      layerRead = read; layerOpen = openSource;
      return createElement('div', { 'data-synthetic-base-graph': true }, read.graph.title);
    }, ...extra };
  await act(async () => root.render(createElement(MemoryRouter, {}, createElement(EnabledSuiteTdmsSourceLayer, props))));
}
async function clickLayer(label: string) {
  const button = Array.from(dom.window.document.querySelectorAll('button')).find((item: HTMLButtonElement) => item.textContent?.includes(label)) as HTMLButtonElement | undefined;
  if (!button) throw new Error('Missing synthetic layer button: ' + label);
  await act(async () => button.click());
}
it('actual synthetic enabled inner preserves the base graph, explicitly projects directory metadata, then reads only selected exact relations/body', async () => {
  mockCatalogue.mockResolvedValue(suiteTdmsCatalogue([suiteTdmsSummary('exact-7', { relatedDocumentVersionIds: ['document-bound-v1'] })]));
  const workspace = suiteMatterWithCatalogue();
  // Match the real page's original registered-document projection; catalogue metadata alone is not a graph node.
  await renderLayer({ read: appendSuiteGraphCatalogDocuments(buildSuiteMatterGraph(workspace), workspace.matter.catalog.entries) });
  expect(mockCatalogue).not.toHaveBeenCalled(); expect(mockRecord).not.toHaveBeenCalled();
  expect(dom.window.document.querySelector('[data-synthetic-base-graph]')).not.toBeNull();
  await clickLayer('读取 TDMS 来源目录');
  expect([...layerRead.targets.values()].some(target => target.kind === 'tdms-record' && target.sourceRevisionRef === 'exact-7')).toBe(true);
  expect(mockRecord).not.toHaveBeenCalled(); expect(mockRelations).not.toHaveBeenCalled();
  await clickLayer('读取此准确来源关系'); await clickLayer('读取此准确来源正文');
  expect(requests(mockRecord)).toEqual([['exact-7', { matterId: 'synthetic-matter' }]]);
  expect(requests(mockRelations)).toEqual([['exact-7', { matterId: 'synthetic-matter' }]]);
  expect(dom.window.document.body.textContent).toContain('准确来源正文 exact-7');
});
it.each([401,403,404])('actual synthetic enabled inner hides graph and old sources during a %s rejection recheck', async statusCode => {
  const recheck = deferred<void>(); mockLayerRecheck.mockReturnValueOnce(recheck.promise);
  await renderLayer(); await clickLayer('读取 TDMS 来源目录'); await clickLayer('读取此准确来源正文');
  expect(dom.window.document.body.textContent).toContain('准确来源正文 exact-7');
  mockRecord.mockRejectedValueOnce({statusCode, message:'PRIVATE DENIED SOURCE'});
  await clickLayer('读取此准确来源正文');
  expect(mockLayerRecheck).toHaveBeenCalledTimes(1);
  expect(dom.window.document.querySelector('[data-synthetic-base-graph]')).toBeNull();
  expect(dom.window.document.body.textContent).not.toContain('准确来源正文 exact-7');
  expect(dom.window.document.body.textContent).not.toContain('PRIVATE DENIED SOURCE');
  await act(async () => recheck.resolve());
  expect([...layerRead.targets.values()].some(target => target.kind === 'tdms-record' || target.kind === 'tdms-unresolved')).toBe(false);
  expect(dom.window.document.body.textContent).not.toContain('准确来源正文 exact-7');
  expect(mockRecord).toHaveBeenCalledTimes(2); expect(mockCatalogue).toHaveBeenCalledTimes(1);
});
it('actual synthetic historical inner keeps saved exact pins and cannot load a current directory or current relation projection', async () => {
  await renderLayer({ read: buildSuiteMatterGraph(suiteProblemOnlyWorkspace('saved-exact-2')),
    allowCurrentSources: false, workRef: 'historical-work-2' });
  expect(dom.window.document.body.textContent).toContain('固定保存工作');
  expect([...layerRead.targets.values()].some(target => target.kind === 'tdms-record' && target.sourceRevisionRef === 'saved-exact-2')).toBe(true);
  await act(async () => layerOpen('saved-exact-2'));
  expect(requests(mockRecord)).toEqual([['saved-exact-2', {matterId:'synthetic-matter'}]]);
  expect(mockCatalogue).not.toHaveBeenCalled(); expect(mockRelations).not.toHaveBeenCalled();
  expect(dom.window.document.body.textContent).toContain('准确来源正文 saved-exact-2');
});
