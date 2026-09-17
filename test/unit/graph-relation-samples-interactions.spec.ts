import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import GraphRelationPreviewPage from '../../client/src/pages/GraphRelationPreviewPage/GraphRelationPreviewPage';
import RelationGraphPage from '../../client/src/pages/RelationGraphPage/RelationGraphPage';
import { GRAPH_RELATION_SAMPLE_ENTRIES, GRAPH_RELATION_SAMPLE_PROJECTION } from '../../client/src/features/review/graph-samples';
import { claimKey } from '../../client/src/features/review/GraphRelationSamplesView';
import { getLibraryIndex } from '@client/src/api/canonical-host';
import {
  getEngineeringMatter,
  getEngineeringMatterDirectory,
} from '@client/src/api/engineering-matter';
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
jest.mock('@client/src/api/engineering-matter', () => ({
  getEngineeringMatterDirectory: jest.fn(),
  getEngineeringMatter: jest.fn(),
}));
jest.mock(
  '../../client/src/app/providers/CurrentUserSessionProvider',
  () => ({
    useCurrentUserSession: () => ({
      sessionGeneration: 1,
      authenticationRequired: false,
    }),
  }),
);
jest.mock(
  '../../client/src/pages/RelationGraphPage/SuiteMatterGraphPage',
  () => ({
    __esModule: true,
    default: ({ matterId }: { matterId: string }) =>
      createElement('div', { 'data-testid': 'matter-graph', 'data-matter': matterId }),
  }),
);
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
            props.onNodeOpen({
              id: 'doc-sample-graph-a', kind: 'DOCUMENT', label: 'SB-A 厂家服务通告',
              detail: '同一文件，多时间条目保留稳定身份', state: 'SAMPLE', sourceRef: '',
              documentVersionId: 'dv-sample-b',
            } as Parameters<
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
async function mountProduction(url = '/graph?workItemId=wi-sample-graph-a') {
  (getLibraryIndex as jest.Mock).mockResolvedValue(
    GRAPH_RELATION_SAMPLE_PROJECTION,
  );
  router = createMemoryRouter(
    [
      { path: '/graph', element: createElement(RelationGraphPage) },
      { path: '*', element: createElement('div', null, '目标页面') },
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

it('shows all four Trinity graph scales and keeps unavailable real scopes explicit', async () => {
  await mount();
  expect(button('工程文档')).toBeTruthy();
  expect(button('工程事项')).toBeTruthy();
  expect(button('技术领域')).toBeTruthy();
  expect(button('全景')).toBeTruthy();
  await click('技术领域');
  expect(container.textContent).toContain('「技术领域」模式尚未接通');
  expect(container.textContent).toContain('不展示任何');
  expect(container.textContent).toContain('伪造节点');
  expect(getLibraryIndex).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
});

it('keeps the explicit sample-object action inside the isolated preview', async () => {
  await mount();
  await click('点击同文件图节点');
  await click('查看样例对象');
  expect(router.state.location.pathname).toBe('/dev-preview/graph');
  expect(getLibraryIndex).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
});

it('selects a production graph node before an explicit deep-link navigation', async () => {
  await mountProduction();
  expect(getLibraryIndex).toHaveBeenCalledWith('wi-sample-graph-a');
  expect(container.querySelector('[aria-label="当前关系对象"]')?.textContent).toContain('SB-A 厂家服务通告');
  await click('点击同文件图节点');
  expect(router.state.location.pathname).toBe('/graph');
  expect(container.querySelector('[aria-label="当前关系对象"]')?.textContent).toContain('doc-sample-graph-a');
  await click('打开准确对象');
  expect(router.state.location.pathname).toBe('/work-items/wi-sample-graph-a/documents');
  expect(params().get('documentVersionId')).toBe('dv-sample-b');
});

describe('graph object entry gates', () => {
  beforeEach(() => {
    (getEngineeringMatterDirectory as jest.Mock).mockClear();
    (getEngineeringMatter as jest.Mock).mockClear();
  });

  async function mountEntry(url: string) {
    router = createMemoryRouter(
      [
        { path: '/graph', element: createElement(RelationGraphPage) },
        {
          path: '/activity-graph',
          element: createElement('div', { 'data-testid': 'activity-graph' }, '活动来源关系'),
        },
      ],
      { initialEntries: [url] },
    );
    root = createRoot(container);
    await act(async () => root.render(createElement(RouterProvider, { router })));
  }

  it('routes a document-version-only entry to the activity graph without guessing a matter', async () => {
    await mountEntry('/graph?documentVersionId=dv-9');
    expect(router.state.location.pathname).toBe('/activity-graph');
    expect(new URLSearchParams(router.state.location.search).get('documentVersionId')).toBe('dv-9');
  });

  it('rejects an empty document-version pin instead of falling back', async () => {
    await mountEntry('/graph?documentVersionId=');
    expect(router.state.location.pathname).toBe('/graph');
    expect(container.textContent).toContain('图谱对象参数为空、重复或不合法');
  });

  it('rejects a duplicated document-version pin instead of falling back', async () => {
    await mountEntry('/graph?documentVersionId=a&documentVersionId=b');
    expect(container.textContent).toContain('图谱对象参数为空、重复或不合法');
  });

  it('rejects an orphan work identity that lacks its matter', async () => {
    await mountEntry('/graph?workRef=wr-1');
    expect(container.textContent).toContain('工作身份缺少所属事项');
    expect(getEngineeringMatterDirectory).not.toHaveBeenCalled();
  });

  it('resolves a stable default matter from the authorized directory on a bare entry', async () => {
    (getEngineeringMatterDirectory as jest.Mock).mockResolvedValue({
      items: [{ matterId: 'm-1' }],
    });
    await mountEntry('/graph');
    await act(async () => undefined);
    expect(getEngineeringMatterDirectory).toHaveBeenCalledTimes(1);
    expect(new URLSearchParams(router.state.location.search).get('matterId')).toBe('m-1');
  });

  it('routes a document-version entry with candidate, run, statement, anchor and window intact', async () => {
    await mountEntry('/graph?documentVersionId=DV1&parseRunId=PR1&candidateRevision=3&runRef=R3&statementId=S1&anchor=A1&window=current-year');
    expect(router.state.location.pathname).toBe('/activity-graph');
    const params = new URLSearchParams(router.state.location.search);
    expect(params.get('documentVersionId')).toBe('DV1');
    expect(params.get('parseRunId')).toBe('PR1');
    expect(params.get('candidateRevision')).toBe('3');
    expect(params.get('runRef')).toBe('R3');
    expect(params.get('statementId')).toBe('S1');
    expect(params.get('anchor')).toBe('A1');
    expect(params.get('window')).toBe('current-year');
  });

  it('rejects an orphan parse run without a document version before any directory request', async () => {
    await mountEntry('/graph?parseRunId=PR1');
    expect(container.textContent).toContain('缺少所属文档版本');
    expect(getEngineeringMatterDirectory).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/graph');
  });

  it('rejects a statement or anchor used without a parse run before any directory request', async () => {
    await mountEntry('/graph?documentVersionId=DV1&statementId=S1');
    expect(container.textContent).toContain('未指定解析版本时');
    expect(getEngineeringMatterDirectory).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/graph');
  });

  it('rejects a candidate revision without its run reference before any directory request', async () => {
    await mountEntry('/graph?documentVersionId=DV1&parseRunId=PR1&candidateRevision=3');
    expect(container.textContent).toContain('候选改版与运行标识必须成对出现');
    expect(getEngineeringMatterDirectory).not.toHaveBeenCalled();
  });

  it('routes a matter together with its registered document version to the activity graph', async () => {
    (getEngineeringMatter as jest.Mock).mockResolvedValue({
      catalog: { entries: [{ document: { documentVersionId: 'DV1' } }] },
    });
    await mountEntry('/graph?matterId=M1&documentVersionId=DV1');
    await act(async () => undefined);
    expect(router.state.location.pathname).toBe('/activity-graph');
    expect(new URLSearchParams(router.state.location.search).get('documentVersionId')).toBe('DV1');
  });

  it('blocks a document version that is not registered to the pinned matter', async () => {
    (getEngineeringMatter as jest.Mock).mockResolvedValue({
      catalog: { entries: [{ document: { documentVersionId: 'DV-OTHER' } }] },
    });
    await mountEntry('/graph?matterId=M1&documentVersionId=DV1');
    await act(async () => undefined);
    expect(container.textContent).toContain('该文档版本未登记在当前事项');
    expect(router.state.location.pathname).toBe('/graph');
  });

  it('rejects conflicting matter and work item identities without any directory request', async () => {
    await mountEntry('/graph?matterId=M1&workItemId=WI-1');
    expect(container.textContent).toContain('图谱对象身份不明确');
    expect(getEngineeringMatterDirectory).not.toHaveBeenCalled();
  });

  it('E1 REVIEW: DV redirect preserves exact candidate and presentation pins', async () => {
    await mountEntry('/graph?documentVersionId=DV1&parseRunId=PR1&candidateRevision=3&runRef=R3&statementId=S1&anchor=A1&window=current-year');
    const query = new URLSearchParams(router.state.location.search);
    expect(query.get('parseRunId')).toBe('PR1');
    expect(query.get('candidateRevision')).toBe('3');
    expect(query.get('runRef')).toBe('R3');
    expect(query.get('window')).toBe('current-year');
  });

  it('E1 REVIEW: orphan activity pin must not select a default matter', async () => {
    (getEngineeringMatterDirectory as jest.Mock).mockResolvedValue({items:[]});
    await mountEntry('/graph?parseRunId=PR1');
    expect(getEngineeringMatterDirectory).not.toHaveBeenCalled();
  });

  it('E1 REVIEW R2: graph DV redirect preserves library return', async () => {
    await mountEntry('/graph?documentVersionId=DV1&parseRunId=P1&returnLibraryQuery=mode%3Ddocument');
    expect(new URLSearchParams(router.state.location.search).get('returnLibraryQuery')).toBe('mode=document');
  });
});
