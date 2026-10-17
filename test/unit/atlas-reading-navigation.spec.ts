import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { AtlasHostRead } from '@client/src/features/atlas/useAtlasHost';
import type { AtlasLocation } from '@client/src/features/atlas/atlas-model';

const documentVersionId = 'DV-FTD-OLD';
const directory = new URLSearchParams({
  expandedFamilyIds: 'family-expanded',
  familyId: 'family-selected',
  listY: '735',
  mode: 'document',
  selectedDocumentVersionId: documentVersionId,
});
let mockHost: AtlasHostRead;
const mockLoadActivityEntry = jest.fn();

jest.mock('@client/src/features/atlas/useAtlasHost', () => ({
  atlasReadKey: (location: AtlasLocation, session: number) =>
    JSON.stringify([location, session]),
  useAtlasHost: () => mockHost,
}));
jest.mock('@client/src/api/canonical-host', () => ({
  subscribeCanonicalHostClientSession: () => () => undefined,
  getCanonicalHostClientSessionGeneration: () => 1,
}));
jest.mock('@client/src/api/engineering-matter', () => ({}));
jest.mock('@lark-apaas/client-toolkit/logger', () => ({
  logger: { error: jest.fn() },
}));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({
  useCurrentUserSession: () => ({
    sessionGeneration: 1,
    authenticationRequired: false,
  }),
}));
jest.mock('@client/src/app/providers/CurrentObjectContextProvider', () => ({
  ...jest.requireActual(
    '@client/src/app/providers/CurrentObjectContextProvider',
  ),
  useCurrentObjectContext: () => ({ currentObject: null }),
}));
jest.mock('@client/src/app/providers/ThemeProvider', () => ({
  useWlTheme: () => ({
    theme: 'light',
    visualMode: 'default',
    reduceTransparency: true,
    toggleTheme: jest.fn(),
    setVisualMode: jest.fn(),
    motionEnabled: false,
    motionPausedByUser: false,
    systemReducedMotion: true,
    toggleMotion: jest.fn(),
  }),
}));
jest.mock('@client/src/components/CurrentUserControl', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@client/src/components/WiseLinkBrandMark', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@client/src/features/atlas/AtlasGraph', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@client/src/features/atlas/AtlasClassification', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@client/src/features/atlas/AtlasExampleReading', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@client/src/features/atlas/atlas.css', () => ({}));
jest.mock('@client/src/features/matter/SavedAssessmentReading', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock(
  '@client/src/pages/DocumentParsingPage/document-activity-entry',
  () => ({
    ...jest.requireActual(
      '@client/src/pages/DocumentParsingPage/document-activity-entry',
    ),
    loadActivityEntry: (...args: unknown[]) => mockLoadActivityEntry(...args),
  }),
);
jest.mock('@client/src/features/trinity/DocumentActivityGraphView', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@client/src/features/trinity/DocumentActivityTimelineView', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock(
  '@client/src/pages/DocumentParsingPage/DocumentActivityReadingView',
  () => ({ __esModule: true, default: () => null }),
);
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/components/ui/dialog', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const Open = React.createContext(false);
  const block = ({ children }: { children?: ReactNode }) =>
    React.createElement('div', null, children);
  return {
    Dialog: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
      React.createElement(Open.Provider, { value: Boolean(open) }, children),
    DialogContent: ({ children }: { children?: ReactNode }) =>
      React.useContext(Open)
        ? React.createElement('div', null, children)
        : null,
    DialogTitle: block,
    DialogDescription: block,
    DialogHeader: block,
  };
});

import TopBar from '@client/src/features/navigation/TopBar';
import Sidebar from '@client/src/features/navigation/Sidebar';
import EngineeringTimelinePage from '@client/src/pages/EngineeringTimelinePage/EngineeringTimelinePage';
import { libraryReadingParams } from '@client/src/features/matter/reading-return';
import {
  documentGraphReadingParams,
  graphReadingParams,
} from '@client/src/pages/RelationGraphPage/suite-graph-return';

describe('global graph entry consumes the exact library reading return', () => {
  let dom: JSDOM, root: Root, container: HTMLElement;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  beforeAll(() => {
    dom = new JSDOM('<!doctype html><body></body>', {
      url: 'https://example.test/',
    });
    for (const [key, value] of Object.entries({
      window: dom.window,
      document: dom.window.document,
      navigator: dom.window.navigator,
      HTMLElement: dom.window.HTMLElement,
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
    mockHost = {
      key: 'selected-document',
      loading: false,
      graph: {
        nodes: [
          {
            id: 'old-ftd',
            kind: 'document',
            code: '737MAX-FTD-34-17005',
            title: '737MAX-FTD-34-17005_Doc_07092025.pdf',
            sourceRefs: [],
            workItemId: 'WI-FTD-OLD',
            documentVersionId,
          },
        ],
        edges: [],
        notices: [],
      },
    };
    mockLoadActivityEntry.mockReset().mockResolvedValue({
      reading: { binding: { documentVersionId, parseRunId: 'PR-OLD' } },
      replaceQuery: 'parseRunId=PR-OLD',
      error: null,
      unreadable: null,
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function Shell() {
    const location = useLocation();
    return createElement(
      'div',
      null,
      createElement(
        'output',
        { id: 'route' },
        location.pathname + location.search,
      ),
      createElement(TopBar, {
        pathname: location.pathname,
        search: location.search,
        mobileNavOpen: false,
        onToggleMobile: () => undefined,
      }),
      createElement(Sidebar, {
        mobileOpen: false,
        onMobileClose: () => undefined,
      }),
      location.pathname === '/activity-graph'
        ? createElement(EngineeringTimelinePage, { view: 'graph' })
        : null,
    );
  }
  const route = () =>
    new URL(
      container.querySelector('#route')!.textContent!,
      'https://example.test',
    );
  async function click(label: string) {
    const button = [...container.querySelectorAll('button')].find(
      (value) =>
        value.getAttribute('aria-label') === label ||
        value.textContent?.trim() === label,
    );
    expect(button).toBeDefined();
    await act(async () => button!.click());
  }
  async function mount(path = `/library?${directory}`) {
    await act(async () =>
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: [path] },
          createElement(Shell),
        ),
      ),
    );
  }
  async function selectAtlasDocument() {
    await click('打开图谱与自动演示');
    const object = container.querySelector<HTMLButtonElement>('.atlas-object');
    expect(object?.textContent).toContain('737MAX-FTD-34-17005');
    await act(async () => object!.click());
  }
  async function backToDirectory() {
    const back =
      container.querySelector<HTMLButtonElement>('.wl-pagebar-back')!;
    expect(back.disabled).toBe(false);
    await act(async () => back.click());
    expect(route().pathname).toBe('/library');
    expect(route().searchParams.toString()).toBe(
      libraryReadingParams(directory).toString(),
    );
  }

  it('TopBar Atlas selected old-version WorkItem reader returns to the complete directory URL', async () => {
    await mount();
    await selectAtlasDocument();
    await click('进入原文与已有意见');
    expect(route().pathname).toBe('/work-items/WI-FTD-OLD/analysis');
    expect(route().searchParams.get('documentVersionId')).toBe(
      documentVersionId,
    );
    expect(route().searchParams.get('returnDocumentVersionId')).toBe(
      documentVersionId,
    );
    await backToDirectory();
  });

  it('TopBar Atlas direct exact-source action uses the same directory return', async () => {
    await mount();
    await selectAtlasDocument();
    await click('阅读准确来源');
    expect(route().pathname).toBe(`/document-versions/${documentVersionId}`);
    await backToDirectory();
  });

  it('Sidebar object graph retains the URL before catalog loading and after real parse-run replacement', async () => {
    await mount();
    const graph = container.querySelector<HTMLAnchorElement>(
      'a[aria-label="当前对象图谱"]',
    )!;
    expect(graph).not.toBeNull();
    await act(async () => graph.click());
    expect(route().pathname).toBe('/activity-graph');
    expect(mockLoadActivityEntry).toHaveBeenCalledTimes(1);
    expect(route().searchParams.get('parseRunId')).toBe('PR-OLD');
    expect(route().searchParams.get('returnDocumentVersionId')).toBe(
      documentVersionId,
    );
    await backToDirectory();
  });

  it('Atlas keeps the original directory selection while reading another exact WorkItem/version', async () => {
    mockHost.graph.nodes[0].workItemId = 'WI-OTHER';
    mockHost.graph.nodes[0].documentVersionId = 'DV-OTHER';
    await mount(
      `/document-versions/${documentVersionId}?${new URLSearchParams({
        returnDocumentVersionId: documentVersionId,
        returnLibraryQuery: directory.toString(),
      })}`,
    );
    await selectAtlasDocument();
    await click('进入原文与已有意见');
    expect(route().pathname).toBe('/work-items/WI-OTHER/analysis');
    expect(route().searchParams.get('documentVersionId')).toBe('DV-OTHER');
    expect(route().searchParams.get('returnDocumentVersionId')).toBe(
      'DV-OTHER',
    );
    await backToDirectory();
  });

  it('Atlas returns through the exact document graph before its original directory', async () => {
    const graph = documentGraphReadingParams(
      documentVersionId,
      'WI-FTD-OLD',
      { selectedId: 'registered-source', density: 3 },
      new URLSearchParams({
        returnDocumentVersionId: documentVersionId,
        returnLibraryQuery: directory.toString(),
      }),
    );
    await mount(`/graph?${graph}`);
    await selectAtlasDocument();
    await click('进入原文与已有意见');
    await act(async () =>
      container.querySelector<HTMLButtonElement>('.wl-pagebar-back')!.click(),
    );
    expect(route().pathname).toBe('/graph');
    expect(route().searchParams.get('selectedId')).toBe('registered-source');
    expect(route().searchParams.get('density')).toBe('3');
    expect(route().searchParams.get('readerWorkItemId')).toBe('WI-FTD-OLD');
    await backToDirectory();
  });

  it('Sidebar document graph round trip retains its parent after activity discovery', async () => {
    const graph = documentGraphReadingParams(
      documentVersionId,
      'WI-FTD-OLD',
      { selectedId: 'old-source', density: 4 },
      new URLSearchParams({
        returnDocumentVersionId: documentVersionId,
        returnLibraryQuery: directory.toString(),
      }),
    );
    await mount(`/graph?${graph}`);
    await act(async () =>
      container
        .querySelector<HTMLAnchorElement>('a[aria-label="当前对象图谱"]')!
        .click(),
    );
    expect(route().pathname).toBe('/activity-graph');
    expect(route().searchParams.get('parseRunId')).toBe('PR-OLD');
    await act(async () =>
      container.querySelector<HTMLButtonElement>('.wl-pagebar-back')!.click(),
    );
    expect(route().pathname).toBe('/graph');
    expect(route().searchParams.get('selectedId')).toBe('old-source');
    expect(route().searchParams.get('density')).toBe('4');
    await backToDirectory();
  });

  it('graph rejection stays disabled before and after real parse discovery replacement', async () => {
    let finishDiscovery!: (result: unknown) => void;
    mockLoadActivityEntry.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishDiscovery = resolve;
        }),
    );
    await mount(
      `/document-versions/${documentVersionId}?${new URLSearchParams({
        documentVersionId,
        returnDocumentVersionId: 'DV-FOREIGN',
        returnGraphQuery: `scope=document&documentVersionId=${documentVersionId}`,
      })}`,
    );
    await act(async () =>
      container
        .querySelector<HTMLAnchorElement>('a[aria-label="当前对象图谱"]')!
        .click(),
    );
    expect(route().pathname).toBe('/activity-graph');
    expect(
      container.querySelector<HTMLButtonElement>('.wl-pagebar-back')!.disabled,
    ).toBe(true);
    await act(async () =>
      finishDiscovery({
        reading: { binding: { documentVersionId, parseRunId: 'PR-OLD' } },
        replaceQuery: 'parseRunId=PR-OLD',
        error: null,
        unreadable: null,
      }),
    );
    expect(route().searchParams.get('parseRunId')).toBe('PR-OLD');
    expect(route().searchParams.has('returnGraphQuery')).toBe(true);
    const back =
      container.querySelector<HTMLButtonElement>('.wl-pagebar-back')!;
    expect(back.disabled).toBe(true);
    await act(async () => back.click());
    expect(route().pathname).toBe('/activity-graph');
  });

  it('Atlas preserves the saved matter graph work revision', async () => {
    const graph = graphReadingParams('MAT-EXACT', 'MWREV-HISTORICAL', {
      selectedId: 'saved-source',
      perspective: 'documents',
    });
    await mount(`/graph?${graph}`);
    await selectAtlasDocument();
    await click('进入原文与已有意见');
    await act(async () =>
      container.querySelector<HTMLButtonElement>('.wl-pagebar-back')!.click(),
    );
    expect(route().pathname).toBe('/graph');
    expect(route().searchParams.get('matterId')).toBe('MAT-EXACT');
    expect(route().searchParams.get('workRef')).toBe('MWREV-HISTORICAL');
    expect(route().searchParams.get('selectedId')).toBe('saved-source');
  });
});
