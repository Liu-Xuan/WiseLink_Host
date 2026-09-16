import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import DocumentRevisionReadingPage from '@client/src/pages/DocumentParsingPage/DocumentRevisionReadingPage';

const { JSDOM } = require('jsdom');
const mockRead = jest.fn();
const mockSemantic = jest.fn();
const mockParsing = jest.fn();
jest.mock('@client/src/api/canonical-host', () => ({
  readDocumentRevisionReading: (...args: unknown[]) => mockRead(...args),
  readDocumentSemanticReading: (...args: unknown[]) => mockSemantic(...args),
  readDocumentParsingStatus: (...args: unknown[]) => mockParsing(...args),
  subscribeCanonicalHostClientSession: () => () => undefined,
}));
jest.mock('@client/src/pages/DocumentParsingPage/DocumentRevisionReadingView', () => ({
  __esModule: true,
  default: ({ reading }: { reading: { marker: string } }) =>
    createElement('div', { 'data-reading': reading.marker }, reading.marker),
}));
jest.mock('../../client/src/pages/DocumentParsingPage/document-revision-reading.css', () => ({}));
jest.mock('@client/src/components/ui/badge', () => ({ Badge: 'span' }));
jest.mock('@client/src/components/ui/card', () => ({ Card: 'section', CardContent: 'div', CardHeader: 'header', CardTitle: 'h2' }));
jest.mock('@client/src/components/ui/button', () => ({
  Button: ({ children, variant: _variant, ...props }: { children: ReactNode; variant?: string }) =>
    createElement('button', props, children),
}));
let root: Root;
let router: ReturnType<typeof createMemoryRouter>;
let dom: InstanceType<typeof JSDOM>;
let container: HTMLElement;
const oldGlobals = new Map<string, PropertyDescriptor | undefined>();
function url(role: string | null = 'A', before = 'DV-old') {
  const params = new URLSearchParams({ before, beforeParseRun: `PR-${before}`,
    beforeSemanticRevision: '1', after: 'DV-new', afterParseRun: 'PR-new', afterSemanticRevision: '1' });
  if (role !== null) params.set('roleKey', role);
  return `/document-revisions?${params}`;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function mount(initial = url()) {
  router = createMemoryRouter([{ path: '/document-revisions', element: createElement(DocumentRevisionReadingPage) }],
    { initialEntries: [initial], future: { v7_relativeSplatPath: true } });
  root = createRoot(container);
  await act(async () => root.render(createElement(RouterProvider, { router, future: { v7_startTransition: true } })));
}
async function navigate(next: string) {
  await act(async () => { await router.navigate(next); });
}
beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test/' });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    oldGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  container = dom.window.document.getElementById('root');
  jest.clearAllMocks();
  mockRead.mockReset().mockImplementation(async (request: { roleKey: string }) => ({ marker: `reading-${request.roleKey}` }));
  mockSemantic.mockReset().mockResolvedValue({ familyId: 'family-test', semanticMap: {
    semanticRevision: 1, sections: [{ roleKey: 'A' }, { roleKey: 'B' }] } });
});
afterEach(async () => {
  await act(async () => root?.unmount());
  router?.dispose(); dom.window.close();
  for (const [key, descriptor] of oldGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  oldGlobals.clear();
});
it('hides the previous result for invalid or absent role, and keeps a working role picker', async () => {
  await mount();
  expect(container.querySelector('[data-reading="reading-A"]')).not.toBeNull();
  await navigate(url('unknown'));
  expect(container.querySelector('[data-reading]')).toBeNull();
  expect(container.textContent).toContain('不在这两端');
  expect(container.querySelectorAll('button')).toHaveLength(2);
  expect(mockRead).toHaveBeenCalledTimes(1);
  await navigate(url(null));
  expect(container.querySelector('[data-reading]')).toBeNull();
  expect(container.textContent).not.toContain('正在读取');
  await act(async () => { (container.querySelectorAll('button')[1] as HTMLButtonElement).click(); });
  expect(container.querySelector('[data-reading="reading-B"]')).not.toBeNull();
  expect(mockSemantic).toHaveBeenCalledTimes(2);
});
it('does not request old resolved pins when URL pins change or become invalid', async () => {
  await mount();
  const pending = deferred<unknown>();
  mockSemantic.mockImplementation(() => pending.promise);
  await navigate(url('A', 'DV-other'));
  expect(mockRead).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[data-reading]')).toBeNull();
  await navigate(url().replace('beforeSemanticRevision=1', 'beforeSemanticRevision=0'));
  expect(mockRead).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[data-reading]')).toBeNull();
  await act(async () => pending.resolve({ familyId: 'family-test', semanticMap: { semanticRevision: 1, sections: [{ roleKey: 'A' }] } }));
  expect(mockRead).toHaveBeenCalledTimes(1);
});
it('ignores a late response from a previous role and clears an abandoned loading state', async () => {
  const pending = deferred<unknown>();
  mockRead.mockImplementationOnce(() => pending.promise);
  await mount();
  await navigate(url('B'));
  expect(container.querySelector('[data-reading="reading-B"]')).not.toBeNull();
  await act(async () => pending.resolve({ marker: 'late-A' }));
  expect(container.querySelector('[data-reading="late-A"]')).toBeNull();
  expect(container.querySelector('[data-reading="reading-B"]')).not.toBeNull();
  mockRead.mockImplementationOnce(() => new Promise(() => undefined));
  await navigate(url('A'));
  await navigate(url(null));
  expect(container.textContent).not.toContain('正在读取');
  expect(container.querySelector('[data-reading]')).toBeNull();
});
it('shows an empty role union without fabricating a comparison', async () => {
  mockSemantic.mockResolvedValue({ familyId: 'family-test', semanticMap: { semanticRevision: 1, sections: [] } });
  await mount(url(null));
  expect(container.textContent).toContain('没有可比较的内容角色');
  expect(mockRead).not.toHaveBeenCalled();
});
