import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import EngineeringMatterPage from '../../client/src/features/matter/EngineeringMatterPage';
import SuiteMatterGraphPage from '../../client/src/pages/RelationGraphPage/SuiteMatterGraphPage';
import type { SuiteMatterGraphViewProps } from '../../client/src/pages/RelationGraphPage/SuiteMatterGraphView';
import { libraryMatterFixture } from './fixtures/library-matter';

const { JSDOM } = require('jsdom');

const mockWorkspaceRead = jest.fn();
const mockHistoricalRead = jest.fn();
let mockSession = 1;

jest.mock('@client/src/api/engineering-matter', () => ({
  getEngineeringMatterWorkspace: (...args: unknown[]) =>
    mockWorkspaceRead(...args),
  getEngineeringMatterWorkingRevision: (...args: unknown[]) =>
    mockHistoricalRead(...args),
  getEngineeringMatterDirectory: jest.fn(),
}));
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => mockSession,
  subscribeCanonicalHostClientSession: () => () => {},
  getCanonicalHostIdentityContext: async () => ({
    userId: 'actor-1',
    tenantId: 'tenant-1',
  }),
  getCanonicalLibraryDocuments: jest.fn(),
}));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({
  useCurrentUserSession: () => ({
    currentUser: { user_id: 'actor-1' },
    sessionGeneration: mockSession,
    authenticationRequired: false,
  }),
}));
jest.mock('@client/src/app/providers/CurrentObjectContextProvider', () => ({
  useCurrentObjectContext: () => ({ publishCurrentObject: jest.fn() }),
}));
jest.mock('@client/src/components/ui/button', () => ({
  Button: ({
    children,
    asChild,
    ...props
  }: {
    children: ReactNode;
    asChild?: boolean;
  }) => (asChild ? children : createElement('button', props, children)),
}));
jest.mock('@client/src/features/review/ContinuousReviewPanel', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@client/src/features/workbench/RetainedWorkbenchPanel', () => ({
  __esModule: true,
  default: ({ active, children }: { active: boolean; children: ReactNode }) =>
    active ? children : null,
}));
jest.mock('@client/src/features/matter/useReadingLocation', () => ({
  __esModule: true,
  default: () => jest.fn(),
}));
jest.mock('@client/src/features/matter/reading-location', () => ({
  readReadingLocation: () => null,
  clearReadingLocation: jest.fn(),
  clearMatterReadingLocations: jest.fn(),
  matterReadingScope: (matterId: string, workRef: string) =>
    `${matterId}:${workRef}`,
}));
jest.mock('@client/src/features/matter/AssessmentReadingBrief', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@client/src/features/matter/ClaimEvidenceDialog', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@client/src/features/matter/MatterMembers', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@client/src/features/matter/MatterMaterials', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@client/src/features/matter/MatterWorkingDetails', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@client/src/features/matter/MatterProblemWork', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@client/src/features/matter/OverviewSourceWork', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@client/src/features/matter/EngineeringIssueSearch', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@client/src/features/matter/MatterDocumentSourceDialog', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@client/src/pages/RelationGraphPage/useSuiteGraphSources', () => ({
  useSuiteGraphSources: () => ({
    activities: new Map(),
    sources: [],
    loading: false,
    activeSourceId: null,
    selectSource: jest.fn(),
    expandSource: jest.fn(),
  }),
}));
jest.mock(
  '@client/src/pages/RelationGraphPage/useSuiteGraphDirectoryPage',
  () => ({
    useSuiteGraphDirectoryPage: () => ({
      loaded: true,
      items: [],
      nextCursor: null,
      loading: false,
      error: null,
      retry: jest.fn(),
      loadMore: jest.fn(),
    }),
  }),
);
jest.mock('@client/src/pages/RelationGraphPage/SuiteMatterGraphView', () => ({
  __esModule: true,
  default: (props: SuiteMatterGraphViewProps) =>
    createElement(
      'div',
      {
        'data-work': props.read.workRef ?? '',
        'data-revision': props.revision?.matterWorkRevisionId ?? '',
      },
      createElement(
        'button',
        {
          'data-action': 'open-wiki',
          onClick: props.onOpenWiki,
        },
        'open wiki',
      ),
    ),
}));
jest.mock('@client/src/features/workitem/workitem-overview.css', () => ({}), {
  virtual: true,
});
jest.mock('@client/src/features/matter/matter-wiki.css', () => ({}), {
  virtual: true,
});

describe('engineering matter cross-page resource reuse', () => {
  let dom: { window: Window & typeof globalThis };
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let priorGlobals: Map<string, PropertyDescriptor | undefined>;

  beforeAll(() => {
    dom = new JSDOM('<!doctype html><body></body>', {
      url: 'https://example.test/',
    });
    priorGlobals = new Map();
    for (const [key, value] of Object.entries({
      window: dom.window,
      document: dom.window.document,
      HTMLElement: dom.window.HTMLElement,
      IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      priorGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, {
        configurable: true,
        writable: true,
        value,
      });
    }
  });

  afterAll(() => {
    dom.window.close();
    for (const [key, descriptor] of priorGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });

  beforeEach(() => {
    mockSession = 1;
    mockWorkspaceRead.mockReset();
    mockHistoricalRead.mockReset();
    mockWorkspaceRead.mockResolvedValue(libraryMatterFixture());
    container = document.createElement('div');
    document.body.appendChild(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    queryClient.unmount();
    container.remove();
  });

  async function waitUntil(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 20 && !predicate(); attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(predicate()).toBe(true);
  }

  function render(initialEntry: string) {
    function Controls() {
      const navigate = useNavigate();
      return createElement(
        'div',
        null,
        createElement(
          'button',
          {
            'data-action': 'to-current-graph',
            onClick: () =>
              navigate('/graph?matterId=MAT-1&workRef=test-working-3'),
          },
          'current graph',
        ),
        createElement(
          'button',
          {
            'data-action': 'to-history-graph',
            onClick: () => navigate('/graph?matterId=MAT-1&workRef=history-2'),
          },
          'history graph',
        ),
      );
    }
    act(() => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(
            MemoryRouter,
            { initialEntries: [initialEntry] },
            createElement(Controls),
            createElement(
              Routes,
              null,
              createElement(Route, {
                path: '/matters/:matterId',
                element: createElement(EngineeringMatterPage),
              }),
              createElement(Route, {
                path: '/graph',
                element: createElement(SuiteMatterGraphPage, {
                  matterId: 'MAT-1',
                }),
              }),
            ),
          ),
        ),
      );
    });
  }

  async function click(action: string): Promise<void> {
    const button = container.querySelector<HTMLButtonElement>(
      `[data-action="${action}"]`,
    );
    expect(button).not.toBeNull();
    await act(async () => button!.click());
  }

  test('Wiki to graph to Wiki reuses the same current workspace', async () => {
    render('/matters/MAT-1');
    await waitUntil(
      () =>
        container.textContent?.includes(
          '测试事项：软件标准转换与一致性核查',
        ) === true,
    );
    expect(mockWorkspaceRead).toHaveBeenCalledTimes(1);

    await click('to-current-graph');
    await waitUntil(() => container.querySelector('[data-work]') !== null);
    expect(mockWorkspaceRead).toHaveBeenCalledTimes(1);

    await click('open-wiki');
    await waitUntil(
      () =>
        container.textContent?.includes(
          '测试事项：软件标准转换与一致性核查',
        ) === true,
    );
    expect(mockWorkspaceRead).toHaveBeenCalledTimes(1);
  });

  test('Wiki and graph share the same exact historical workRef', async () => {
    const historical = structuredClone(libraryMatterFixture().working.current!);
    historical.matterWorkRevisionId = 'history-2';
    historical.workingRevision = 2;
    mockHistoricalRead.mockResolvedValue(historical);

    render('/matters/MAT-1?workRef=history-2');
    await waitUntil(() => mockHistoricalRead.mock.calls.length === 1);
    expect(mockWorkspaceRead).toHaveBeenCalledTimes(1);

    await click('to-history-graph');
    await waitUntil(
      () =>
        container
          .querySelector('[data-revision]')
          ?.getAttribute('data-revision') === 'history-2',
    );
    expect(mockHistoricalRead).toHaveBeenCalledTimes(1);
    expect(mockWorkspaceRead).toHaveBeenCalledTimes(1);

    await click('open-wiki');
    await waitUntil(
      () =>
        container.textContent?.includes(
          '测试事项：软件标准转换与一致性核查',
        ) === true,
    );
    expect(mockHistoricalRead).toHaveBeenCalledTimes(1);
    expect(mockWorkspaceRead).toHaveBeenCalledTimes(1);
  });
});
