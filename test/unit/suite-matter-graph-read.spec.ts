import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { libraryMatterFixture } from './fixtures/library-matter';
import { useSuiteMatterGraph } from '../../client/src/pages/RelationGraphPage/useSuiteMatterGraph';
import type { EngineeringMatterWorkingRevisionReadModel } from '../../shared/matter-working.interface';
const { JSDOM } = require('jsdom');
const mockRead = jest.fn();
let mockSession = 1;
const mockWorkspace = {
  data: libraryMatterFixture(),
  error: null,
  loading: false,
  refresh: jest.fn(),
};
jest.mock('../../client/src/features/matter/useEngineeringMatter', () => {
  const actual = jest.requireActual(
    '../../client/src/features/matter/useEngineeringMatter',
  );
  return { ...actual, __esModule: true, default: () => mockWorkspace };
});
jest.mock('../../client/src/api/engineering-matter', () => ({
  getEngineeringMatterWorkingRevision: (...args: unknown[]) =>
    mockRead(...args),
}));
jest.mock('../../client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => mockSession,
  subscribeCanonicalHostClientSession: () => () => {},
  getCanonicalHostIdentityContext: async () => ({
    userId: 'actor-1',
    tenantId: 'tenant-1',
  }),
}));
jest.mock('../../client/src/app/providers/CurrentUserSessionProvider', () => ({
  useCurrentUserSession: () => ({
    currentUser: { user_id: 'actor-1' },
    sessionGeneration: mockSession,
    authenticationRequired: false,
  }),
}));

test('historical graph does not substitute current work or display cancelled or revoked responses', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  const pending = new Map<
    string,
    (value: EngineeringMatterWorkingRevisionReadModel) => void
  >();
  mockRead.mockImplementation(
    (_matter: string, ref: string) =>
      new Promise((resolve) => pending.set(ref, resolve)),
  );
  function Probe({
    workRef,
    denied = false,
  }: {
    workRef: string;
    denied?: boolean;
  }) {
    const state = useSuiteMatterGraph(
      'ui-test-matter',
      workRef,
      mockSession,
      denied,
    );
    return createElement(
      'div',
      null,
      state.graph?.workRef ?? (state.error || 'waiting'),
    );
  }
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const waitForPending = async (workRef: string): Promise<void> => {
    for (let attempt = 0; attempt < 20 && !pending.has(workRef); attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(pending.has(workRef)).toBe(true);
  };
  const waitForText = async (text: string): Promise<void> => {
    for (
      let attempt = 0;
      attempt < 20 && !container.textContent?.includes(text);
      attempt += 1
    ) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(container.textContent).toContain(text);
  };
  const history = (workRef: string) => ({
    ...structuredClone(mockWorkspace.data.working.current!),
    matterWorkRevisionId: workRef,
    workingRevision: 1,
  });
  try {
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(Probe, { workRef: 'old-a' }),
        ),
      ),
    );
    await waitForPending('old-a');
    expect(container.textContent).toBe('waiting');
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(Probe, { workRef: 'old-b' }),
        ),
      ),
    );
    await waitForPending('old-b');
    await act(async () => pending.get('old-a')!(history('old-a')));
    expect(container.textContent).toBe('waiting');
    await act(async () => pending.get('old-b')!(history('old-b')));
    await waitForText('old-b');
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(Probe, { workRef: 'old-c' }),
        ),
      ),
    );
    mockSession++;
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(Probe, { workRef: 'old-c', denied: true }),
        ),
      ),
    );
    await act(async () => pending.get('old-c')!(history('old-c')));
    expect(container.textContent).not.toContain('old-c');
    expect(container.textContent).not.toContain('test-working-3');
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
    queryClient.unmount();
    dom.window.close();
    for (const [key, value] of prior) {
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
