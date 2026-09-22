import { act, createElement, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import EngineeringMatterPage from '../../client/src/features/matter/EngineeringMatterPage';
import { libraryMatterFixture } from './fixtures/library-matter';

const { JSDOM } = require('jsdom');
const mockHistoricalRead = jest.fn(
  (_matterId: string, _workRef: string, _signal?: AbortSignal) =>
    new Promise((_resolve, reject) => {
      _signal?.addEventListener(
        'abort',
        () =>
          reject(
            Object.assign(new Error('aborted'), {
              name: 'AbortError',
            }),
          ),
        { once: true },
      );
    }),
);
const mockRefresh = jest.fn();
let mockWorkspace: {
  data: ReturnType<typeof libraryMatterFixture> | null;
  loading: boolean;
  error: string | null;
  refresh: typeof mockRefresh;
};
let rerenderWorkspace: (() => void) | null = null;

function WorkspaceHarness() {
  const [, setRenderCount] = useState<number>(0);
  rerenderWorkspace = () => setRenderCount((count: number) => count + 1);
  return createElement(EngineeringMatterPage);
}

jest.mock('@client/src/api/engineering-matter', () => ({
  getEngineeringMatterWorkingRevision: (
    matterId: string,
    workRef: string,
    signal?: AbortSignal,
  ) => mockHistoricalRead(matterId, workRef, signal),
}));
jest.mock('@client/src/features/matter/useEngineeringMatter', () => {
  const actual = jest.requireActual(
    '@client/src/features/matter/useEngineeringMatter',
  );
  return {
    ...actual,
    __esModule: true,
    default: () => mockWorkspace,
  };
});
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({
  useCurrentUserSession: () => ({
    currentUser: { user_id: 'user-1' },
    sessionGeneration: 7,
    authenticationRequired: false,
  }),
}));
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => 7,
  subscribeCanonicalHostClientSession: () => () => {},
  getCanonicalHostIdentityContext: async () => ({
    userId: 'user-1',
    tenantId: 'tenant-1',
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
jest.mock('@client/src/features/workbench/RetainedWorkbenchPanel', () => ({
  __esModule: true,
  default: ({ active, children }: { active: boolean; children: ReactNode }) =>
    active ? children : null,
}));
jest.mock('@client/src/features/review/ContinuousReviewPanel', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@client/src/features/matter/useReadingLocation', () => ({
  __esModule: true,
  default: () => jest.fn(),
}));
jest.mock('@client/src/features/matter/reading-location', () => ({
  readReadingLocation: () => null,
  clearReadingLocation: jest.fn(),
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
jest.mock('@client/src/features/workitem/workitem-overview.css', () => ({}), {
  virtual: true,
});
jest.mock('@client/src/features/matter/matter-wiki.css', () => ({}), {
  virtual: true,
});

it('does not restart the same historical read when the current workspace arrives', async () => {
  const dom = new JSDOM('<div id="root"></div>', {
    url: 'https://example.test/',
  });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  mockWorkspace = {
    data: null,
    loading: true,
    error: null,
    refresh: mockRefresh,
  };
  mockHistoricalRead.mockClear();
  const router = createMemoryRouter(
    [{ path: '/matters/:matterId', element: createElement(WorkspaceHarness) }],
    { initialEntries: ['/matters/test-matter?workRef=OLD-WORK'] },
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(RouterProvider, { router }),
        ),
      ),
    );
    for (
      let attempt = 0;
      attempt < 20 && mockHistoricalRead.mock.calls.length === 0;
      attempt += 1
    ) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(mockHistoricalRead).toHaveBeenCalledTimes(1);
    mockWorkspace = {
      data: libraryMatterFixture(),
      loading: false,
      error: null,
      refresh: mockRefresh,
    };
    await act(async () => rerenderWorkspace?.());
    expect(dom.window.document.body.textContent).toContain(
      '测试事项：软件标准转换与一致性核查',
    );
    expect(mockHistoricalRead).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
    queryClient.unmount();
    router.dispose();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
