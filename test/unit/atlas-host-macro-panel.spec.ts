import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import AtlasWorkspace from '@client/src/features/atlas/AtlasWorkspace';
import type { AtlasHostRead } from '@client/src/features/atlas/useAtlasHost';
import {
  initialAtlasLocation,
  type AtlasLocation,
} from '@client/src/features/atlas/atlas-model';
import {
  buildLibraryMacroGraph,
  macroMatterId,
  macroVersionId,
} from '@client/src/pages/RelationGraphPage/library-macro-graph';
import type { AtlasHostMacro } from '@client/src/features/atlas/atlas-host-macro';
import { libraryFamily, libraryMetadata } from './fixtures/canonical-library';
import { libraryMatterFixture } from './fixtures/library-matter';

let mockHost: AtlasHostRead;
let mockLocation: AtlasLocation;
let mockGraph: { location: AtlasLocation; variant: string };
jest.mock('@client/src/features/atlas/useAtlasHost', () => ({
  atlasReadKey: (location: AtlasLocation, session: number) =>
    JSON.stringify([location, session]),
  useAtlasHost: (location: AtlasLocation) => {
    mockLocation = location;
    return mockHost;
  },
}));
jest.mock('@client/src/api/canonical-host', () => ({}));
jest.mock('@client/src/api/engineering-matter', () => ({}));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({
  useCurrentUserSession: () => ({
    sessionGeneration: 1,
    authenticationRequired: false,
  }),
}));
jest.mock('@client/src/app/providers/ThemeProvider', () => ({
  useWlTheme: () => ({
    theme: 'light',
    visualMode: 'default',
    reduceTransparency: true,
    toggleTheme: jest.fn(),
  }),
}));
jest.mock('@client/src/features/atlas/AtlasGraph', () => ({
  __esModule: true,
  default: (props: typeof mockGraph) => {
    mockGraph = props;
    return null;
  },
}));
jest.mock('@client/src/features/atlas/AtlasClassification', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@client/src/features/atlas/AtlasExampleReading', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@client/src/features/atlas/GuidePlayer', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@client/src/features/matter/SavedAssessmentReading', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@client/src/features/atlas/atlas.css', () => ({}));

function fixture(): AtlasHostMacro {
  const document = libraryFamily('family-a');
  document.versions[0].extractedMetadata = libraryMetadata('3461');
  document.versions[1].extractedMetadata = libraryMetadata('3141');
  const matter = libraryMatterFixture().matter;
  const read: AtlasHostMacro['read'] = {
    documents: [document],
    matters: [matter],
    coverage: {
      documents: 'COMPLETE',
      matters: 'COMPLETE',
      references: 'NOT_INDEXED',
    },
    issues: [],
  };
  return { ...buildLibraryMacroGraph(read, 'ata', false), read };
}

describe('global Host macro panel uses the authorized projection and exact navigation', () => {
  let dom: JSDOM, root: Root, container: HTMLElement;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const navigate = jest.fn();
  beforeAll(() => {
    dom = new JSDOM('<!doctype html><body></body>', {
      url: 'https://example.test/',
    });
    for (const [key, value] of Object.entries({
      window: dom.window,
      document: dom.window.document,
      navigator: dom.window.navigator,
      IS_REACT_ACT_ENVIRONMENT: true,
      requestAnimationFrame: (fn: FrameRequestCallback) =>
        setTimeout(() => fn(0), 1),
      cancelAnimationFrame: clearTimeout,
    })) {
      previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, {
        configurable: true,
        writable: true,
        value,
      });
    }
  });
  afterAll(() => {
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  beforeEach(() => {
    const macro = fixture();
    mockHost = { key: 'test', graph: macro.graph, macro, loading: false };
    navigate.mockClear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  async function mount(
    view: 'panorama' | 'domain' = 'panorama',
    selected = '',
  ) {
    await act(async () =>
      root.render(
        createElement(AtlasWorkspace, {
          onClose: jest.fn(),
          onNavigate: navigate,
          initialSnapshot: {
            location: { ...initialAtlasLocation, view, selected },
            scroll: 0,
            draft: '',
          },
        }),
      ),
    );
  }
  const click = (label: string) => {
    const button = [...container.querySelectorAll('button')].find(
      (value) => value.textContent?.trim() === label,
    );
    expect(button).toBeDefined();
    act(() => button!.click());
  };
  it('renders the shared macro network and real coverage rather than an empty example fallback', async () => {
    await mount();
    expect(mockGraph.variant).toBe('macro');
    expect(mockGraph.location.view).toBe('network');
    expect(container.querySelector('.atlas-count')?.textContent).toMatch(
      /[1-9]\d* 对象/,
    );
    expect(
      container.querySelector('[aria-label="全景读取覆盖"]')?.textContent,
    ).toContain('未建立全库索引');
    expect(container.textContent).not.toContain('切换到示例');
  });
  it.each(['loading', 'error'] as const)(
    'keeps %s distinct from a successful zero-object panorama',
    async (state) => {
      mockHost = {
        key: 'test',
        graph: { nodes: [], edges: [], notices: [] },
        loading: state === 'loading',
        error: state === 'error' ? '实际目录读取失败' : undefined,
      };
      await mount();
      expect(container.querySelector('.atlas-count')?.textContent).toBe(
        state === 'loading' ? '正在读取' : '读取受阻',
      );
      expect(container.textContent).not.toContain('当前已读取范围没有可读对象');
      if (state === 'error')
        expect(
          container.querySelector('[role="alert"]')?.textContent,
        ).toContain('实际目录读取失败');
    },
  );
  it('states a successful empty read as empty only within the read scope', async () => {
    mockHost = {
      key: 'test',
      graph: { nodes: [], edges: [], notices: [] },
      loading: false,
    };
    await mount();
    expect(container.textContent).toContain('当前已读取范围没有可读对象');
  });
  it('shows raw observed ATA in Host domain and leaves example FMC values out of the Host control', async () => {
    await mount('domain');
    const input = container.querySelector<HTMLSelectElement>(
      '[aria-label="按原文 ATA 筛选"]',
    )!;
    expect([...input.options].map((option) => option.value)).toEqual([
      '',
      '3461',
      '3141',
    ]);
    expect(container.querySelector('[aria-label="技术领域"]')).toBeNull();
    expect(
      container.querySelector('.atlas-scene-heading h2')?.textContent,
    ).toBe('文档 ATA 分类');
    await act(async () => {
      input.value = '3141';
      input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
    expect(mockLocation.hostAta).toBe('3141');
    expect(mockLocation.domain).toBe('fmc');
  });
  it('opens the selected old version and pins the saved-reader request to that same version', async () => {
    await mount('panorama', macroVersionId('DV-family-a-1'));
    click('阅读准确来源');
    expect(navigate).toHaveBeenLastCalledWith(
      '/document-versions/DV-family-a-1',
    );
    click('读取此确切版本关系');
    expect(mockLocation).toMatchObject({
      view: 'documents',
      focus: 'WI-OLD',
      documentVersionId: 'DV-family-a-1',
    });
  });
  it('uses the raw matter identity rather than the projected macro node id', async () => {
    await mount('panorama', macroMatterId('ui-test-matter'));
    click('读取此事项与已保存意见');
    expect(mockLocation).toMatchObject({
      view: 'matter',
      focus: 'ui-test-matter',
    });
  });
  it('still opens an exact document source without inventing a saved WorkItem reader', async () => {
    const node = mockHost.graph.nodes.find(
      (item) => item.documentVersionId === 'DV-family-a-1',
    )!;
    delete node.workItemId;
    await mount('panorama', node.id);
    expect(container.textContent).not.toContain('进入原文与已有意见');
    click('阅读准确来源');
    expect(navigate).toHaveBeenLastCalledWith(
      '/document-versions/DV-family-a-1',
    );
  });
});
