import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { JSDOM } from 'jsdom';
import ReaderWorkspaceVisualPreviewPage from '../../client/src/pages/DocumentParsingPage/ReaderWorkspaceVisualPreviewPage';

jest.mock('../../client/src/pages/DocumentParsingPage/document-version-reading.css', () => ({}));
jest.mock('../../client/src/pages/WorkspaceHomePage/DocumentOriginalPreview', () => ({
  DocumentOriginalInlinePreview: () => createElement('div', { 'data-testid': 'mock-production-pdf' }),
}));
jest.mock('../../client/src/pages/DocumentParsingPage/DocumentOriginalCanvasPreview', () => ({
  __esModule: true,
  default: () => createElement('div', { 'data-testid': 'mock-production-pdf-canvas' }),
}));
jest.mock('@client/src/components/ui/button', () => ({
  Button: ({ asChild, children, ...props }: { asChild?: boolean; children?: ReactNode }) =>
    asChild ? children : createElement('button', props, children),
}));

it('renders the isolated Reader fixture without requesting a production document', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test/' });
  const prior = new Map<string, PropertyDescriptor | undefined>();
  const network = jest.fn();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    fetch: network,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const router = createMemoryRouter([
    { path: '/dev-preview/reader-workspace', element: createElement(ReaderWorkspaceVisualPreviewPage) },
  ], { initialEntries: ['/dev-preview/reader-workspace'] });
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => root.render(createElement(RouterProvider, { router })));
    expect(dom.window.document.querySelector(
      '[data-preview="isolated-reader-fixture"]',
    )).not.toBeNull();
    expect(dom.window.document.body.textContent).toContain('SB-A R02 · Reader 视觉样例');
    expect(dom.window.document.querySelector('[aria-label="构造原件第 1 页"]')).not.toBeNull();
    expect(dom.window.document.querySelector('[data-testid="mock-production-pdf"]')).toBeNull();
    expect(dom.window.document.querySelector(
      '[data-testid="mock-production-pdf-canvas"]',
    )).toBeNull();
    expect(network).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    router.dispose();
    dom.window.close();
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
