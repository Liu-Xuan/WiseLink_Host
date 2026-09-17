import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider, useSearchParams } from 'react-router-dom';
import { LibraryPaneScrollProvider, useLibraryPaneScroll } from '../../client/src/pages/WorkspaceHomePage/useLibraryPaneScroll';
const { JSDOM } = require('jsdom');

test('pane positions restore independently, survive remount and reset on a new selection', async () => {
  const dom = new JSDOM('<div id="root"></div>', {url: 'https://example.test'});
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true})) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {configurable: true, writable: true, value});
  }
  function Page() {
    const [params] = useSearchParams();
    const ready = params.get('ready') !== 'no';
    const list = useLibraryPaneScroll<HTMLDivElement>('listY', ready, 1);
    const detail = useLibraryPaneScroll<HTMLDivElement>('quicklookY', ready, 1);
    return createElement('section', null, createElement('div', {...list, id: 'list'}), createElement('div', {...detail, id: 'detail'}));
  }
  const router = createMemoryRouter([{path: '/library', element: createElement(LibraryPaneScrollProvider, {children: createElement(Page)})}], {initialEntries: ['/library?mode=matter&selectedMatterId=A&listY=230&quicklookY=80']});
  const container = dom.window.document.getElementById('root')!;
  let root = createRoot(container);
  try {
    await act(async () => root.render(createElement(RouterProvider, {router})));
    let list = container.querySelector('#list') as HTMLElement;
    expect(list.scrollTop).toBe(230);
    expect((container.querySelector('#detail') as HTMLElement).scrollTop).toBe(80);
    await act(async () => { list.scrollTop = 450; list.dispatchEvent(new dom.window.Event('scroll'));
      const detail = container.querySelector('#detail') as HTMLElement;
      detail.scrollTop = 100; detail.dispatchEvent(new dom.window.Event('scroll')); });
    expect(new URLSearchParams(router.state.location.search).get('listY')).toBe('450');
    expect(new URLSearchParams(router.state.location.search).get('quicklookY')).toBe('100');
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(createElement(RouterProvider, {router})));
    expect((container.querySelector('#list') as HTMLElement).scrollTop).toBe(450);
    await act(async () => { await router.navigate('/library?mode=matter&selectedMatterId=A&listY=80&quicklookY=80'); });
    expect((container.querySelector('#list') as HTMLElement).scrollTop).toBe(80);
    expect((container.querySelector('#detail') as HTMLElement).scrollTop).toBe(80);
    await act(async () => { await router.navigate('/library?mode=matter&selectedMatterId=B&listY=450&quicklookY=0'); });
    expect((container.querySelector('#detail') as HTMLElement).scrollTop).toBe(0);
    await act(async () => { await router.navigate('/library?mode=matter&selectedMatterId=C&ready=no&listY=90'); });
    list = container.querySelector('#list') as HTMLElement;
    await act(async () => { list.scrollTop = 777; list.dispatchEvent(new dom.window.Event('scroll')); });
    expect(new URLSearchParams(router.state.location.search).get('listY')).toBe('90');
    await act(async () => { await router.navigate('/library?mode=matter&selectedMatterId=C&listY=90'); });
    expect((container.querySelector('#list') as HTMLElement).scrollTop).toBe(90);
  } finally {
    await act(async () => root.unmount()); router.dispose(); dom.window.close();
    for (const [key, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
