import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import SuiteMatterGraphPage from '../../client/src/pages/RelationGraphPage/SuiteMatterGraphPage';
import { libraryMatterFixture } from './fixtures/library-matter';
import { buildSuiteMatterGraph } from '../../client/src/pages/RelationGraphPage/suite-matter-graph';
import type { SuiteMatterGraphViewProps } from '../../client/src/pages/RelationGraphPage/SuiteMatterGraphView';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mockData = libraryMatterFixture();
let mockProps: SuiteMatterGraphViewProps;
let viewMounts = 0;
jest.mock('../../client/src/app/providers/CurrentUserSessionProvider', () => ({ useCurrentUserSession: () => ({ sessionGeneration: 1, authenticationRequired: false }) }));
jest.mock('../../client/src/api/engineering-matter', () => ({ getEngineeringMatterDirectory: jest.fn() }));
jest.mock('@client/src/api/canonical-host', () => ({ getCanonicalHostClientSessionGeneration: () => 1, getCanonicalLibraryDocuments: jest.fn() }));
jest.mock('../../client/src/pages/RelationGraphPage/useSuiteGraphSources', () => ({ useSuiteGraphSources: () => ({ activities: new Map(), sources: [], loading: false, activeSourceId: null, selectSource: jest.fn(), expandSource: jest.fn() }) }));
jest.mock('../../client/src/pages/RelationGraphPage/useSuiteMatterGraph', () => ({ useSuiteMatterGraph: () => ({ graph: buildSuiteMatterGraph(mockData), revision: mockData.working.current, workspace: mockData, loading: false, error: null }) }));
jest.mock('../../client/src/pages/RelationGraphPage/SuiteMatterGraphView', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    __esModule: true,
    default: (props: SuiteMatterGraphViewProps) => {
      mockProps = props;
      React.useEffect(() => { viewMounts += 1; }, []);
      return null;
    },
  };
});

const { JSDOM } = require('jsdom');
let dom: { window: Window & typeof globalThis };
let navigateTo: ReturnType<typeof useNavigate>;
let currentSearch = '';

function Probe() {
  navigateTo = useNavigate();
  currentSearch = useLocation().search;
  return null;
}

describe('SuiteMatterGraphPage navigation state', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test/' });
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  });

  afterAll(() => dom.window.close());

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    viewMounts = 0;
    currentSearch = '';
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
  });

  function renderPage(initialEntry: string) {
    root = createRoot(container);
    root.render(createElement(MemoryRouter, { initialEntries: [initialEntry] },
      createElement(Probe),
      createElement(Routes, null,
        createElement(Route, { path: '/graph', element: createElement(SuiteMatterGraphPage, { matterId: 'ui-test-matter' }) }))));
  }

  it('keeps the view through request errors, explicit retry and another directory page', async () => {
    const api = jest.requireMock('@client/src/api/canonical-host');
    api.getCanonicalLibraryDocuments.mockRejectedValueOnce(new Error('403 FORBIDDEN'))
      .mockResolvedValueOnce({items: [], nextCursor: 'page-2'})
      .mockResolvedValueOnce({items: [], nextCursor: null});
    await act(async () => renderPage('/graph?matterId=ui-test-matter'));
    const mounts = viewMounts;
    await act(async () => mockProps.onPerspectiveChange!('domain'));
    expect(viewMounts).toBe(mounts);
    expect(mockProps.perspectiveError).toBe(true);
    expect(mockProps.perspectiveNotice).toContain('403');
    await act(async () => mockProps.onRetryPerspective!());
    expect(mockProps.perspectiveError).toBe(false);
    expect(mockProps.nextDirectoryPage).toBeDefined();
    await act(async () => mockProps.nextDirectoryPage!());
    expect(api.getCanonicalLibraryDocuments.mock.calls.at(-1)[0].cursor).toBe('page-2');
    expect(mockProps.nextDirectoryPage).toBeUndefined();
    expect(viewMounts).toBe(mounts);
  });

  it('restores new display state from same-identity SPA query navigation and ignores its own writes', async () => {
    await act(async () => renderPage('/graph?matterId=ui-test-matter&density=2'));
    await act(async () => { await Promise.resolve(); });
    expect(mockProps.initialState?.density).toBe(2);
    const mountsAfterInitial = viewMounts;

    await act(async () => { mockProps.onStateChange!({ density: 3 }); });
    await act(async () => { await Promise.resolve(); });
    expect(currentSearch).toContain('density=3');
    expect(viewMounts).toBe(mountsAfterInitial);

    await act(async () => { navigateTo('/graph?matterId=ui-test-matter&density=5&selectedId=i&page=1', { replace: true }); });
    await act(async () => { await Promise.resolve(); });
    expect(mockProps.initialState?.density).toBe(5);
    expect(mockProps.initialState?.selectedId).toBe('i');
    expect(mockProps.initialState?.page).toBe(1);
    expect(viewMounts).toBeGreaterThan(mountsAfterInitial);
    expect(currentSearch).toContain('density=5');
  });
});

describe('SuiteMatterGraphPage mobile layout contract', () => {
  it('declares the hidden desktop switch before the mobile rule that shows it', () => {
    const css = readFileSync(resolve(process.cwd(), 'client/src/pages/RelationGraphPage/suite-matter-graph-page.css'), 'utf8');
    const desktopRule = css.indexOf('.suite-graph-mobile-switch{display:none}');
    const mobileRule = css.indexOf('.suite-graph-mobile-switch{display:flex');
    expect(desktopRule).toBeGreaterThanOrEqual(0);
    expect(mobileRule).toBeGreaterThan(desktopRule);
    expect(css).toContain(".suite-graph-layout[data-mobile-panel='timeline'] .suite-graph-center-panel");
    expect(css).toContain(".suite-graph-layout[data-mobile-panel='wiki'] .suite-graph-work-panel");
  });
});
