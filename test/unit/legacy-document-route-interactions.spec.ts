import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider, useLocation, useParams } from 'react-router-dom';
import { JSDOM } from 'jsdom';
import ReaderPageAdapter from '../../client/src/adapters/ReaderPageAdapter';
import VersionComparisonPageAdapter from '../../client/src/adapters/VersionComparisonPageAdapter';

jest.mock('../../client/src/pages/NotFound/not-found.css', () => ({}));

function AuthorizedReader() {
  const { documentVersionId } = useParams();
  const location = useLocation();
  return createElement('output', { 'data-version': documentVersionId }, location.search);
}

function AuthorizedComparison() {
  const location = useLocation();
  return createElement('output', { 'data-comparison': true }, location.search);
}

async function visit(initial: string) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test/' });
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window,
    document: dom.window.document, navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const router = createMemoryRouter([
    { path: '/reader/:documentId', element: createElement(ReaderPageAdapter) },
    { path: '/version-comparison/:documentId', element: createElement(VersionComparisonPageAdapter) },
    { path: '/document-versions/:documentVersionId', element: createElement(AuthorizedReader) },
    { path: '/document-revisions', element: createElement(AuthorizedComparison) },
    { path: '/library', element: createElement('div', null, '资料库') },
  ], { initialEntries: [initial] });
  const root = createRoot(dom.window.document.getElementById('root')!);
  await act(async () => root.render(createElement(RouterProvider, { router, future: { v7_startTransition: true } })));
  return {
    text: dom.window.document.body.textContent ?? '',
    output: dom.window.document.querySelector('output'),
    path: router.state.location.pathname,
    search: router.state.location.search,
    async close() {
      await act(async () => root.unmount());
      router.dispose();
      dom.window.close();
      for (const [key, descriptor] of prior) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

it('routes an unknown legacy Reader ID through the real version boundary', async () => {
  const page = await visit('/reader/unknown-version?parse=PRUN-1&source=REF-2');
  try {
    expect(page.path).toBe('/document-versions/unknown-version');
    expect(page.output?.getAttribute('data-version')).toBe('unknown-version');
    expect(new URLSearchParams(page.search).get('sourceRef')).toBe('REF-2');
    expect(page.text).not.toContain('Flight Control System');
  } finally { await page.close(); }
});

it('stops an incomplete comparison before any reader or mock content', async () => {
  const page = await visit('/version-comparison/DV-new');
  try {
    expect(page.path).toBe('/version-comparison/DV-new');
    expect(page.output).toBeNull();
    expect(page.text).toContain('缺少要比较的两个文档版本');
    expect(page.text).toContain('阅读指定版本');
    expect(page.text).not.toContain('Rev 45');
  } finally { await page.close(); }
});

it('routes an explicit pair to the existing authorized comparison', async () => {
  const page = await visit('/version-comparison/DV-new?before=DV-old&after=DV-new');
  try {
    expect(page.path).toBe('/document-revisions');
    expect(page.output?.getAttribute('data-comparison')).toBe('true');
    expect(new URLSearchParams(page.search).get('before')).toBe('DV-old');
  } finally { await page.close(); }
});
