import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useSuiteGraphDirectoryPage } from '../../client/src/pages/RelationGraphPage/useSuiteGraphDirectoryPage';
const {JSDOM} = require('jsdom');
jest.mock('@client/src/api/canonical-host', () => ({getCanonicalHostClientSessionGeneration: () => 1}));
const load = jest.fn();
const key = (item: {id: string}) => item.id;
let current: ReturnType<typeof useSuiteGraphDirectoryPage<{id: string}>>;
function Probe({enabled = true}: {enabled?: boolean}) { current = useSuiteGraphDirectoryPage(enabled, 1, load, key); return null; }
let root: Root, container: HTMLDivElement, dom: {window: Window & typeof globalThis};
beforeAll(() => {dom = new JSDOM('<body/>'); Object.assign(globalThis, {window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true});});
afterAll(() => dom.window.close());
beforeEach(() => {load.mockReset(); container = document.createElement('div'); root = createRoot(container);});
afterEach(() => act(() => root.unmount()));
it('reads one page per action, merges distinct identities and never scans in background', async () => {
  load.mockResolvedValueOnce({items:[{id:'a'}],nextCursor:'next'}).mockResolvedValueOnce({items:[{id:'a'},{id:'b'}],nextCursor:null});
  await act(async () => root.render(createElement(Probe)));
  expect(load).toHaveBeenCalledTimes(1);
  expect(current.nextCursor).toBe('next');
  await act(async () => current.loadMore());
  expect(load.mock.calls[1][0]).toBe('next');
  expect(current.items.map(item => item.id)).toEqual(['a','b']);
  expect(current.nextCursor).toBeNull();
});
it('clears old authorized rows after a denied continuation and retries first page explicitly', async () => {
  load.mockResolvedValueOnce({items:[{id:'secret-old'}],nextCursor:'next'}).mockRejectedValueOnce(new Error('403 FORBIDDEN')).mockResolvedValueOnce({items:[{id:'new'}],nextCursor:null});
  await act(async () => root.render(createElement(Probe)));
  await act(async () => current.loadMore());
  expect(current.items).toEqual([]); expect(current.error).toContain('403');
  expect(load).toHaveBeenCalledTimes(2);
  await act(async () => current.retry());
  expect(load.mock.calls[2][0]).toBeUndefined();
  expect(current.items).toEqual([{id:'new'}]);
});
it('discards late inactive responses and allows resuming a cancelled next page', async () => {
  let resolve: (value: unknown) => void = () => {};
  load.mockResolvedValueOnce({items:[{id:'a'}],nextCursor:'next'}).mockImplementationOnce(() => new Promise(done => {resolve=done;})).mockResolvedValueOnce({items:[{id:'b'}],nextCursor:null});
  await act(async () => root.render(createElement(Probe)));
  await act(async () => current.loadMore());
  const signal = load.mock.calls[1][1] as AbortSignal;
  await act(async () => root.render(createElement(Probe, {enabled:false})));
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({items:[{id:'late'}],nextCursor:null}));
  await act(async () => root.render(createElement(Probe)));
  expect(current.loading).toBe(false); expect(current.items).toEqual([{id:'a'}]);
  await act(async () => current.loadMore());
  expect(current.items.map(item=>item.id)).toEqual(['a','b']);
});
