import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import WorkItemAnalysisRedirect from '../../client/src/pages/DocumentParsingPage/WorkItemAnalysisRedirect';
import { libraryQuicklook } from './fixtures/canonical-library';

const mockQuicklook = jest.fn();
let mockGeneration = 1;
let mockRequired = false;
const mockSessions = new Set<() => void>();
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalLibraryQuicklook: (...args: unknown[]) => mockQuicklook(...args),
  getCanonicalHostClientSessionGeneration: () => mockGeneration,
  isCanonicalHostClientSessionAuthenticationRequired: () => mockRequired,
  subscribeCanonicalHostClientSession: (callback: () => void) => {
    mockSessions.add(callback); return () => mockSessions.delete(callback);
  },
}));

const { JSDOM } = require('jsdom');
let dom: InstanceType<typeof JSDOM>, root: Root;
let router: ReturnType<typeof createMemoryRouter>;
const globals = new Map<string, PropertyDescriptor | undefined>();
function association(id = 'WI-OLD', documentVersionId = 'DV-OLD') {
  const result = libraryQuicklook(id); result.document.documentVersionId = documentVersionId; return result;
}
async function mount(query = 'panel=assessment') {
  router = createMemoryRouter([
    { path: '/work-items/:workItemId/analysis', element: createElement(WorkItemAnalysisRedirect) },
    { path: '/document-versions/:documentVersionId', element: createElement('p', null, 'Document workspace') },
  ], { initialEntries: [`/work-items/WI-OLD/analysis?${query}#saved-location`], future: { v7_relativeSplatPath: true } });
  await act(async () => root.render(createElement(RouterProvider, { router, future: { v7_startTransition: true } })));
}
beforeAll(() => {
  dom = new JSDOM('<div id="root"></div>');
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
});
beforeEach(() => {
  mockGeneration = 1; mockRequired = false; mockSessions.clear(); mockQuicklook.mockReset();
  mockQuicklook.mockResolvedValue(association()); root = createRoot(document.getElementById('root')!);
});
afterEach(async () => { await act(async () => root.unmount()); router.dispose(); });
afterAll(() => {
  dom.window.close(); for (const [key, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
});

it('replaces an authorized old route with its exact DVI and preserves the panel, source and return state', async () => {
  await mount('panel=review&documentVersionId=DV-OLD&criterion=JAC-1&parseRunId=PR-OLD&sourceRef=SR-OLD&returnDocumentVersionId=DV-OLD&returnLibraryQuery=mode%3Dtasks%26workItemId%3DWI-RETURN%26listY%3D643');
  expect(mockQuicklook).toHaveBeenCalledTimes(1); expect(mockQuicklook.mock.calls[0][0]).toBe('WI-OLD');
  expect(router.state.location.pathname).toBe('/document-versions/DV-OLD');
  const query = new URLSearchParams(router.state.location.search);
  expect(query.get('workItemId')).toBe('WI-OLD'); expect(query.get('assessmentTab')).toBe('review');
  expect(query.get('assessmentCriterion')).toBe('JAC-1'); expect(query.get('parseRunId')).toBe('PR-OLD');
  expect(query.get('sourceRef')).toBe('SR-OLD'); expect(query.get('returnLibraryQuery')).toContain('WI-RETURN');
  expect(router.state.location.hash).toBe('#saved-location'); expect(router.state.historyAction).toBe('REPLACE');
});

it.each(['foreign-version', 'foreign-work', 'denied'] as const)('keeps %s rejected without opening a substitute version', async failure => {
  if (failure === 'denied') mockQuicklook.mockRejectedValue(Object.assign(new Error('当前请求未获准。'), { statusCode: 403 }));
  else mockQuicklook.mockResolvedValue(association(failure === 'foreign-work' ? 'WI-FOREIGN' : 'WI-OLD', 'DV-FOREIGN'));
  await mount('panel=assessment&documentVersionId=DV-OLD');
  expect(router.state.location.pathname).toBe('/work-items/WI-OLD/analysis');
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
  expect(document.body.textContent).not.toContain('Document workspace');
});

it('ignores an old successful association after a new task is opened', async () => {
  let finish!: (value: ReturnType<typeof association>) => void;
  mockQuicklook.mockImplementation((id: string) => id === 'WI-OLD' ? new Promise(resolve => { finish = resolve; })
    : Promise.resolve(association('WI-NEW', 'DV-NEW')));
  await mount(); await act(async () => router.navigate('/work-items/WI-NEW/analysis?panel=overall'));
  expect(router.state.location.pathname).toBe('/document-versions/DV-NEW');
  await act(async () => finish(association()));
  expect(router.state.location.pathname).toBe('/document-versions/DV-NEW');
  expect(new URLSearchParams(router.state.location.search).get('workItemId')).toBe('WI-NEW');
});

it('does not navigate from a late response after session revocation', async () => {
  let finish!: (value: ReturnType<typeof association>) => void;
  mockQuicklook.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await mount(); await act(async () => { mockRequired = true; mockGeneration++; mockSessions.forEach(callback => callback()); });
  await act(async () => finish(association()));
  expect(router.state.location.pathname).toBe('/work-items/WI-OLD/analysis');
  expect(document.body.textContent).not.toContain('Document workspace');
});
