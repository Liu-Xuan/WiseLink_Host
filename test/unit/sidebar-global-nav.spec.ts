import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';

const mockGetMatter = jest.fn();

jest.mock('@client/src/components/WiseLinkBrandMark', () => ({
  __esModule: true, default: () => null,
}));

jest.mock('@lark-apaas/client-toolkit/logger', () => ({
  logger: { error: jest.fn() },
}));
jest.mock('@client/src/app/providers/ThemeProvider', () => ({
  useWlTheme: () => ({
    theme: 'light',
    toggleTheme: jest.fn(),
    visualMode: 'default',
    setVisualMode: jest.fn(),
    motionEnabled: true,
    motionPausedByUser: false,
    systemReducedMotion: false,
    toggleMotion: jest.fn(),
  }),
}));
jest.mock('@client/src/app/providers/CurrentObjectContextProvider', () => ({
  useCurrentObjectContext: () => ({ currentObject: null }),
}));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({
  useCurrentUserSession: () => ({
    sessionGeneration: 1,
    authenticationRequired: false,
  }),
}));
jest.mock('@client/src/api/engineering-matter', () => ({
  getEngineeringMatter: (...args: unknown[]) => mockGetMatter(...args),
}));
jest.mock('@client/src/components/ui/dialog', () => ({
  Dialog: ({ children }: { children?: React.ReactNode }) => createElement('div', null, children),
  DialogContent: ({ children }: { children?: React.ReactNode }) => createElement('div', null, children),
  DialogDescription: ({ children }: { children?: React.ReactNode }) => createElement('p', null, children),
  DialogHeader: ({ children }: { children?: React.ReactNode }) => createElement('div', null, children),
  DialogTitle: ({ children }: { children?: React.ReactNode }) => createElement('h2', null, children),
}));

jest.mock('@client/src/components/CurrentUserControl', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/features/atlas/AtlasLauncher', () => ({ __esModule: true, default: () => null }));
import TopBar from '../../client/src/features/navigation/TopBar';
import Sidebar from '../../client/src/features/navigation/Sidebar';
import { useLibraryDefaultSelection } from '../../client/src/pages/WorkspaceHomePage/useLibraryDefaultSelection';

describe('sidebar global navigation identity', () => {
  const { JSDOM } = require('jsdom');
  let dom: InstanceType<typeof JSDOM>;
  let root: Root;
  let container: HTMLElement;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'https://example.test/',
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: dom.window,
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: dom.window.document,
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: dom.window.navigator,
    });
    Object.defineProperty(globalThis, 'HTMLElement', {
      configurable: true,
      value: dom.window.HTMLElement,
    });
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      configurable: true,
      value: true,
    });
    container = dom.window.document.getElementById('root');
    mockGetMatter.mockReset();
  });
  afterEach(() => {
    act(() => root?.unmount());
    dom.window.close();
  });

  function Toolbar() {
    const location = useLocation();
    return createElement('div', null, createElement('output', { id: 'route' }, location.pathname + location.search),
      createElement(TopBar, { pathname: location.pathname, search: location.search, mobileNavOpen: false, onToggleMobile: () => undefined }));
  }

  function LibraryDefaultSelection() {
    const location = useLocation();
    useLibraryDefaultSelection('document', 'FAMILY-1', location.pathname !== '/library', false, false);
    return null;
  }

  async function mount(path: string, selectLibraryDefault = false) {
    root = createRoot(container);
    await act(async () =>
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: [path] },
          createElement(Toolbar),
          selectLibraryDefault ? createElement(LibraryDefaultSelection) : null,
          createElement(Sidebar, {
            mobileOpen: false,
            onMobileClose: () => undefined,
          }),
        ),
      ),
    );
    await act(async () => undefined);
  }

  function href(label: string): string | null {
    return (
      container
        .querySelector(`a[aria-label="${label}"]`)
        ?.getAttribute('href') ?? null
    );
  }

  it('returns from the global Library button to the exact graph through the product toolbar', async () => {
    const viewport = { zoom: 0.9348, pan: { x: -118.5, y: -138.05 } };
    const graph = new URLSearchParams({ matterId: 'M1', workRef: 'MWREV-16',
      viewport: JSON.stringify(viewport), layoutMode: 'force', density: '4',
      selectedId: 'issue-2', wikiTab: 'basis',
      returnKnowledgeQuery: 'subjectKind=ENGINEERING_MATTER&subjectId=M1&workRef=MWREV-16' });
    await mount(`/graph?${graph}`, true);
    const library = container.querySelector<HTMLAnchorElement>('a[aria-label="资料库"]')!;
    await act(async () => library.click());
    expect(container.querySelector('#route')?.textContent).toMatch(/^\/library\?/);
    expect(container.querySelector('#route')?.textContent).toContain('familyId=FAMILY-1');
    const back = container.querySelector<HTMLButtonElement>('button[aria-label="返回关系图谱"]');
    expect(back).not.toBeNull();
    expect(back?.disabled).toBe(false);
    await act(async () => back!.click());
    const restored = new URL(container.querySelector('#route')!.textContent!, 'https://example.test');
    expect(restored.pathname).toBe('/graph');
    for (const [key, value] of graph) expect(restored.searchParams.get(key)).toBe(value);
  });

  it.each([
    '', 'matterId=M1&matterId=M2', 'matterId=M1&workRef=',
    'matterId=M1&workRef=W1&workRef=W2', 'https://outside.test/graph',
    'matterId=M1&documentVersionId=DV1',
  ])('rejects malformed global graph return %s without a Library fallback', async raw => {
    await mount(`/library?${new URLSearchParams({ returnLibraryGraphQuery: raw })}`);
    expect(container.querySelector<HTMLButtonElement>('.wl-pagebar-back')?.disabled).toBe(true);
  });

  it('defers graph Matter source discovery until opening the timeline', async () => {
    await mount('/graph?matterId=M1');
    expect(mockGetMatter).not.toHaveBeenCalled();
    expect(href('工程时间轴')).toBe('/timeline?matterId=M1');
    expect(href('关系图谱')).toBe('/graph?matterId=M1');
  });

  it('preserves the current Matter identity without a background sidebar read', async () => {
    await mount('/matters/M1');
    expect(mockGetMatter).not.toHaveBeenCalled();
    expect(href('工程时间轴')).toBe('/timeline?matterId=M1');
  });

  it('forwards the matter identity instead of clearing it when no source is registered', async () => {
    await mount('/matters/M1');
    expect(href('工程时间轴')).toBe('/timeline?matterId=M1');
  });

  it('keeps an exact pinned document version when linking to the timeline', async () => {
    await mount('/timeline?documentVersionId=DV9');
    expect(href('工程时间轴')).toBe('/timeline?documentVersionId=DV9');
  });

  it('carries the library matter and document selection into graph and timeline', async () => {
    await mount('/library?selectedMatterId=M7&selectedDocumentVersionId=DV7');
    expect(href('关系图谱')).toBe('/graph?matterId=M7');
    expect(href('工程时间轴')).toBe('/timeline?documentVersionId=DV7');
  });

  it('keeps an invalid empty matter pin visibly blocked instead of degrading to a bare default entry', async () => {
    await mount('/graph?matterId=');
    expect(mockGetMatter).not.toHaveBeenCalled();
    expect(href('工程时间轴')).toBe('/timeline?matterId=');
    expect(href('关系图谱')).toBe('/graph?matterId=');
  });

  it('E1 REVIEW R2: pending matter source preserves matter in timeline target', async () => {
    await mount('/graph?matterId=M1');
    expect(href('工程时间轴')).toBe('/timeline?matterId=M1');
  });

  it('E1 REVIEW R2: sidebar preserves exact activity pins and return', async () => {
    await mount('/timeline?documentVersionId=DV9&parseRunId=P9&candidateRevision=2&runRef=R9&window=current-year&returnLibraryQuery=mode%3Ddocument');
    const q = new URLSearchParams(href('关系图谱')!.split('?')[1]);
    expect(q.get('parseRunId')).toBe('P9');
    expect(q.get('candidateRevision')).toBe('2');
    expect(q.get('runRef')).toBe('R9');
    expect(q.get('returnLibraryQuery')).toBe('mode=document');
  });

  it('E1 REVIEW R2: invalid library pin cannot become bare default nav', async () => {
    await mount('/library?selectedDocumentVersionId=');
    expect(href('工程时间轴')).not.toBe('/timeline');
    expect(href('关系图谱')).not.toBe('/graph');
  });

  it('E1 REVIEW R2: explicit version wins over matter current source', async () => {
    await mount('/graph?matterId=M1&documentVersionId=DV-HIST');
    expect(new URLSearchParams(href('工程时间轴')!.split('?')[1]).get('documentVersionId')).toBe('DV-HIST');
  });

  it('E1 FINAL: query historical work identity survives graph sidebar link', async () => { await mount('/graph?matterId=M1&workRef=MWREV-HIST'); expect(new URLSearchParams(href('关系图谱')!.split('?')[1]).get('workRef')).toBe('MWREV-HIST'); });

  it('E1 FINAL: graph sidebar preserves explicit activity identity even with matter context', async () => { await mount('/graph?matterId=M1&documentVersionId=DV-HIST&parseRunId=P1&candidateRevision=2&runRef=R2&returnLibraryQuery=mode%3Ddocument'); const query = new URLSearchParams(href('关系图谱')!.split('?')[1]); expect(query.get('documentVersionId')).toBe('DV-HIST'); expect(query.get('parseRunId')).toBe('P1'); expect(query.get('returnLibraryQuery')).toBe('mode=document'); });
  it('keeps the saved knowledge matter and revision instead of opening a default matter', async () => {
    await mount('/knowledge?subjectKind=ENGINEERING_MATTER&subjectId=M-SAVED&workRef=MWREV-OLD&articleY=19000');
    const graph = new URL(href('关系图谱')!, 'https://example.test');
    expect(graph.searchParams.get('matterId')).toBe('M-SAVED');
    expect(graph.searchParams.get('workRef')).toBe('MWREV-OLD');
    expect(new URLSearchParams(graph.searchParams.get('returnKnowledgeQuery')!).get('articleY')).toBe('19000');
    expect(mockGetMatter).not.toHaveBeenCalled();
    await act(async () => container.querySelector<HTMLAnchorElement>('a[aria-label="关系图谱"]')!.click());
    const back = container.querySelector<HTMLButtonElement>('.wl-pagebar-back')!;
    expect(back.getAttribute('aria-label')).toBe('返回工程知识');
    await act(async () => back.click());
    const restored = new URL(container.querySelector('#route')!.textContent!, 'https://example.test');
    expect(restored.pathname).toBe('/knowledge');
    expect(restored.searchParams.get('subjectId')).toBe('M-SAVED');
    expect(restored.searchParams.get('workRef')).toBe('MWREV-OLD');
    expect(restored.searchParams.get('articleY')).toBe('19000');
  });

  it.each([
    'subjectKind=ENGINEERING_MATTER&subjectId=M-SAVED',
    'subjectKind=ENGINEERING_MATTER&subjectId=M-SAVED&workRef=',
    'subjectKind=ENGINEERING_MATTER&subjectId=M-SAVED&subjectId=M-OTHER&workRef=W',
    'subjectKind=ENGINEERING_MATTER&subjectId=M-SAVED&workRef=W&workRef=OTHER',
    'subjectKind=UNKNOWN&subjectId=M-SAVED&workRef=W',
    'subjectKind=ENGINEERING_MATTER&subjectId=M-SAVED&workRef=W&matterId=M-OTHER',
    'subjectKind=ENGINEERING_MATTER&subjectId=M-SAVED&workRef=W&documentVersionId=DV-OTHER',
  ])('does not turn invalid or conflicting knowledge identity into a default graph: %s', async (query) => {
    await mount(`/knowledge?${query}`);
    expect(href('关系图谱')).toBe('/graph?matterId=');
  });

  it('keeps a document work revision explicit so an unsupported graph cannot silently resolve current work', async () => {
    await mount('/knowledge?subjectKind=WORK_ITEM&subjectId=WI-SAVED&workRef=W-OLD');
    expect(href('关系图谱')).toBe('/graph?workItemId=WI-SAVED&workRef=W-OLD');
  });

  it('retains the ordinary unselected graph entry outside a pinned knowledge work', async () => {
    await mount('/knowledge?query=example');
    expect(href('关系图谱')).toBe('/graph');
  });

});
