import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import GraphRelationPreviewPage from '../../client/src/pages/GraphRelationPreviewPage/GraphRelationPreviewPage';
import { GRAPH_RELATION_SAMPLE_ENTRIES } from '../../client/src/features/review/graph-samples';
import { claimKey } from '../../client/src/features/review/GraphRelationSamplesView';
import { getLibraryIndex } from '@client/src/api/canonical-host';
import type { RelationGraphCanvasProps } from '../../client/src/pages/RelationGraphPage/RelationGraphCanvas';

// JSDOM is a development dependency; the production runtime does not use it.
const { JSDOM } = require('jsdom');
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/components/ui/button-group', () => ({
  ButtonGroup: 'div',
}));
jest.mock('@client/src/api/canonical-host', () => ({
  getLibraryIndex: jest.fn(),
  isCanonicalObjectNotFound: jest.fn(),
}));
jest.mock('@lark-apaas/client-toolkit/logger', () => ({
  logger: { error: jest.fn() },
}));
jest.mock(
  '../../client/src/pages/RelationGraphPage/relation-graph.css',
  () => ({}),
);
jest.mock(
  '../../client/src/pages/RelationGraphPage/RelationGraphCanvas',
  () => ({
    __esModule: true,
    default: (props: RelationGraphCanvasProps) =>
      createElement(
        'button',
        {
          onClick: () =>
            props.onNodeOpen({ id: 'doc-sample-graph-a' } as Parameters<
              RelationGraphCanvasProps['onNodeOpen']
            >[0]),
        },
        '点击同文件图节点',
      ),
  }),
);

const entry = GRAPH_RELATION_SAMPLE_ENTRIES[0];
let root: Root;
let container: HTMLElement;
let router: ReturnType<typeof createMemoryRouter>;
let dom: InstanceType<typeof JSDOM>;
const network = jest.fn();
const oldGlobals = new Map<string, PropertyDescriptor | undefined>();
function button(label: string, index = 0): HTMLButtonElement {
  const result = Array.from(container.querySelectorAll('button')).filter(
    (item) => item.textContent === label,
  )[index];
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
async function click(label: string, index = 0) {
  await act(async () => button(label, index).click());
}
async function mount(url = '/dev-preview/graph') {
  router = createMemoryRouter(
    [
      {
        path: '/dev-preview/graph',
        element: createElement(GraphRelationPreviewPage),
      },
    ],
    { initialEntries: [url] },
  );
  root = createRoot(container);
  await act(async () => root.render(createElement(RouterProvider, { router })));
}
function params() {
  return new URLSearchParams(router.state.location.search);
}
function expectSelection(rawValue: string) {
  expect(button(`选择声明 ${rawValue}`).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(params().get('claim')).toBe(
    claimKey(entry.claims.find((claim) => claim.rawValue === rawValue)!),
  );
  expect(params().get('entry')).toBe(entry.entryKey);
}

beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'https://example.test/dev-preview/graph',
  });
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: network,
  })) {
    oldGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  dom.window.XMLHttpRequest = network;
  container = dom.window.document.getElementById('root');
  jest.clearAllMocks();
});
afterEach(async () => {
  await act(async () => root?.unmount());
  router?.dispose();
  dom.window.close();
  for (const [key, descriptor] of oldGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  oldGlobals.clear();
});

it('persists concrete claims, follows back/forward and URL changes, and preserves the claim on the same graph node', async () => {
  await mount();
  expectSelection('2025-Q3');
  await click('选择声明 2025-Q4');
  expectSelection('2025-Q4');
  await click('选择声明 TBD');
  expectSelection('TBD');
  await act(async () => {
    await router.navigate(-1);
  });
  expectSelection('2025-Q4');
  await act(async () => {
    await router.navigate(1);
  });
  expectSelection('TBD');
  await click('点击同文件图节点');
  expectSelection('TBD');
  const url = router.state.location.pathname + router.state.location.search;
  await act(async () => root.unmount());
  router.dispose();
  await mount(url);
  expectSelection('TBD');
  await click(GRAPH_RELATION_SAMPLE_ENTRIES[1].label);
  expect(params().get('entry')).toBe(GRAPH_RELATION_SAMPLE_ENTRIES[1].entryKey);
  expect(container.textContent).toContain('目标 · 条件期限');
  await act(async () => {
    await router.navigate(url);
  });
  expectSelection('TBD');
});

it('opens an isolated source with exact claim return, refresh and history, without a fake-ID request', async () => {
  await mount();
  await click('打开来源', 1);
  expectSelection('2025-Q4');
  expect(params().get('view')).toBe('source');
  expect(router.state.location.pathname).toBe('/dev-preview/graph');
  expect(
    container.querySelector('[aria-label="隔离来源示意"]')?.textContent,
  ).toContain('sec-4.2');
  expect(container.querySelectorAll('a')).toHaveLength(0);
  const sourceUrl =
    router.state.location.pathname + router.state.location.search;
  await act(async () => root.unmount());
  router.dispose();
  await mount(sourceUrl);
  expect(container.querySelector('[aria-label="隔离来源示意"]')).not.toBeNull();
  await click('返回所选条目与声明');
  expectSelection('2025-Q4');
  expect(params().has('view')).toBe(false);
  await act(async () => {
    await router.navigate(-1);
  });
  expect(params().get('view')).toBe('source');
  expectSelection('2025-Q4');
  expect(getLibraryIndex).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
  expect(params().has('readingReturnTarget')).toBe(false);
});

it('retains the source-only entry and its declaration through isolated source return', async () => {
  await mount();
  const sourceOnly = GRAPH_RELATION_SAMPLE_ENTRIES[2];
  await click(sourceOnly.label);
  const selectedKey = claimKey(sourceOnly.claims[0]);
  expect(params().get('entry')).toBe(sourceOnly.entryKey);
  expect(params().get('claim')).toBe(selectedKey);
  await click('打开来源');
  expect(
    container.querySelector('[aria-label="隔离来源示意"]')?.textContent,
  ).toContain(sourceOnly.label);
  await click('返回所选条目与声明');
  expect(params().get('entry')).toBe(sourceOnly.entryKey);
  expect(params().get('claim')).toBe(selectedKey);
  expect(button('选择声明 2025-08-12').getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(getLibraryIndex).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
});
