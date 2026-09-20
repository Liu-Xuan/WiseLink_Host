import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { JSDOM } from 'jsdom';
import ReaderPage from '../../client/src/pages/ReaderPage';

jest.mock('../../client/src/pages/ReaderPage/reader.css', () => ({}));
jest.mock('../../client/src/pages/ReaderPage/ReaderHeader', () => ({
  __esModule: true,
  default: ({ onOpenRevision }: { onOpenRevision(): void }) =>
    createElement('button', { onClick: onOpenRevision }, '版本比较'),
}));
jest.mock('../../client/src/pages/ReaderPage/ReaderControls', () => ({
  __esModule: true, default: () => createElement('div'),
}));
jest.mock('../../client/src/pages/ReaderPage/ReaderLayout', () => ({
  __esModule: true, default: () => createElement('div'),
}));

it('keeps the Suite sample Reader comparison action in dev-preview', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test/' });
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  jest.useFakeTimers();
  const router = createMemoryRouter([
    { path: '/dev-preview/reader/:documentId', element: createElement(ReaderPage) },
    { path: '/dev-preview/version-comparison/:documentId', element: createElement('output', null, '预览比较') },
  ], { initialEntries: ['/dev-preview/reader/DV%2Fold'] });
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => root.render(createElement(RouterProvider, { router, future: { v7_startTransition: true } })));
    await act(async () => { jest.advanceTimersByTime(300); });
    const button = dom.window.document.querySelector('button');
    expect(button?.textContent).toBe('版本比较');
    await act(async () => button?.click());
    expect(router.state.location.pathname).toBe('/dev-preview/version-comparison/DV%2Fold');
    expect(dom.window.document.body.textContent).toContain('预览比较');
  } finally {
    await act(async () => root.unmount());
    router.dispose();
    jest.useRealTimers();
    dom.window.close();
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
