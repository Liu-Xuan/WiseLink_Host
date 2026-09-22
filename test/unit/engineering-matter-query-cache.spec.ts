import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import useEngineeringMatter, {
  clearEngineeringMatterQueries,
  useEngineeringMatterWorkingRevision,
} from '../../client/src/features/matter/useEngineeringMatter';
import { libraryMatterFixture } from './fixtures/library-matter';

const { JSDOM } = require('jsdom');

const mockWorkspaceRead = jest.fn();
const mockHistoricalRead = jest.fn();
let mockSession = 1;

jest.mock('../../client/src/api/engineering-matter', () => ({
  getEngineeringMatterWorkspace: (...args: unknown[]) =>
    mockWorkspaceRead(...args),
  getEngineeringMatterWorkingRevision: (...args: unknown[]) =>
    mockHistoricalRead(...args),
}));
jest.mock('../../client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => mockSession,
  isCanonicalHostClientSessionAuthenticationRequired: () => false,
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function workspace(title: string) {
  const value = libraryMatterFixture();
  value.matter.title = title;
  return value;
}

function Consumer({
  matterId,
  workRef = '',
  label,
}: {
  matterId: string;
  workRef?: string;
  label: string;
}) {
  const read = useEngineeringMatter(matterId, mockSession, false);
  const revision = useEngineeringMatterWorkingRevision(
    matterId,
    workRef,
    mockSession,
    false,
    Boolean(workRef),
  );
  return createElement(
    'section',
    {
      'data-consumer': label,
      'data-title': read.data?.matter.title ?? '',
      'data-working-revision':
        read.data?.working.current?.matterWorkRevisionId ?? '',
      'data-revision': revision.data?.matterWorkRevisionId ?? '',
      'data-error': read.error ?? revision.error ?? '',
    },
    createElement(
      'button',
      {
        'data-action': `refresh-${label}`,
        onClick: () => {
          void Promise.all([read.refresh(), revision.refresh()]).catch(
            () => undefined,
          );
        },
      },
      'refresh',
    ),
  );
}

function Pair({ showB }: { showB: boolean }) {
  return createElement(
    'div',
    null,
    createElement(Consumer, { matterId: 'M-1', label: 'a' }),
    showB ? createElement(Consumer, { matterId: 'M-1', label: 'b' }) : null,
  );
}

describe('engineering matter QueryClient resource identity', () => {
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
    jest.useFakeTimers();
    mockSession = 1;
    mockWorkspaceRead.mockReset();
    mockHistoricalRead.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    await act(async () => {
      jest.advanceTimersByTime(0);
      await Promise.resolve();
    });
    await queryClient.cancelQueries();
    for (const query of queryClient.getQueryCache().getAll()) {
      query.destroy();
    }
    queryClient.getMutationCache().clear();
    queryClient.clear();
    queryClient.unmount();
    await act(async () => {
      jest.advanceTimersByTime(0);
      await Promise.resolve();
    });
    jest.useRealTimers();
    container.remove();
  });

  async function waitUntil(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 20 && !predicate(); attempt += 1) {
      await act(async () => {
        jest.advanceTimersByTime(0);
        await Promise.resolve();
      });
    }
    expect(predicate()).toBe(true);
  }

  function render(element: ReactNode) {
    act(() => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, element),
      );
    });
  }

  test('two consumers share one request and one unmount does not cancel the other', async () => {
    const pending = deferred<ReturnType<typeof libraryMatterFixture>>();
    mockWorkspaceRead.mockReturnValue(pending.promise);
    render(createElement(Pair, { showB: true }));
    await waitUntil(() => mockWorkspaceRead.mock.calls.length === 1);
    render(createElement(Pair, { showB: false }));
    await act(async () => pending.resolve(workspace('Shared matter')));
    await waitUntil(
      () =>
        container
          .querySelector('[data-consumer="a"]')
          ?.getAttribute('data-title') === 'Shared matter',
    );
    expect(mockWorkspaceRead).toHaveBeenCalledTimes(1);
  });

  test('A to B to A reuses a completed A resource', async () => {
    const pendingA = deferred<ReturnType<typeof libraryMatterFixture>>();
    const pendingB = deferred<ReturnType<typeof libraryMatterFixture>>();
    mockWorkspaceRead.mockImplementation((matterId: string) =>
      matterId === 'A' ? pendingA.promise : pendingB.promise,
    );
    render(createElement(Consumer, { matterId: 'A', label: 'only' }));
    await waitUntil(() => mockWorkspaceRead.mock.calls.length === 1);
    await act(async () => pendingA.resolve(workspace('A matter')));
    await waitUntil(
      () =>
        container
          .querySelector('[data-consumer="only"]')
          ?.getAttribute('data-title') === 'A matter',
    );
    render(createElement(Consumer, { matterId: 'B', label: 'only' }));
    await waitUntil(() => mockWorkspaceRead.mock.calls.length === 2);
    await act(async () => pendingB.resolve(workspace('B matter')));
    await waitUntil(
      () =>
        container
          .querySelector('[data-consumer="only"]')
          ?.getAttribute('data-title') === 'B matter',
    );

    render(createElement(Consumer, { matterId: 'A', label: 'only' }));
    await waitUntil(
      () =>
        container
          .querySelector('[data-consumer="only"]')
          ?.getAttribute('data-title') === 'A matter',
    );
    expect(mockWorkspaceRead).toHaveBeenCalledTimes(2);
  });

  test('staleTime refreshes only on a later trigger and never polls', async () => {
    mockWorkspaceRead.mockImplementation((matterId: string) =>
      Promise.resolve(workspace(`${matterId} matter`)),
    );
    render(createElement(Consumer, { matterId: 'A', label: 'only' }));
    await waitUntil(
      () =>
        container
          .querySelector('[data-consumer="only"]')
          ?.getAttribute('data-title') === 'A matter',
    );
    render(createElement(Consumer, { matterId: 'B', label: 'only' }));
    await waitUntil(
      () =>
        container
          .querySelector('[data-consumer="only"]')
          ?.getAttribute('data-title') === 'B matter',
    );
    expect(mockWorkspaceRead).toHaveBeenCalledTimes(2);

    await act(async () => {
      jest.advanceTimersByTime(30_001);
      await Promise.resolve();
    });
    render(createElement(Consumer, { matterId: 'A', label: 'only' }));
    await waitUntil(() => mockWorkspaceRead.mock.calls.length === 3);
    await act(async () => {
      jest.advanceTimersByTime(30_001);
      await Promise.resolve();
    });
    expect(mockWorkspaceRead).toHaveBeenCalledTimes(3);
  });

  test('a late A response cannot overwrite the currently displayed B', async () => {
    const pendingA = deferred<ReturnType<typeof libraryMatterFixture>>();
    const pendingB = deferred<ReturnType<typeof libraryMatterFixture>>();
    mockWorkspaceRead.mockImplementation((matterId: string) =>
      matterId === 'A' ? pendingA.promise : pendingB.promise,
    );
    render(createElement(Consumer, { matterId: 'A', label: 'only' }));
    await waitUntil(() => mockWorkspaceRead.mock.calls.length === 1);
    render(createElement(Consumer, { matterId: 'B', label: 'only' }));
    await waitUntil(() => mockWorkspaceRead.mock.calls.length === 2);
    await act(async () => pendingB.resolve(workspace('B matter')));
    await waitUntil(
      () =>
        container
          .querySelector('[data-consumer="only"]')
          ?.getAttribute('data-title') === 'B matter',
    );
    await act(async () => pendingA.resolve(workspace('A matter')));
    await act(async () => {
      jest.advanceTimersByTime(0);
      await Promise.resolve();
    });
    expect(
      container
        .querySelector('[data-consumer="only"]')
        ?.getAttribute('data-title'),
    ).toBe('B matter');
  });

  test('session change clears old data and isolates the new generation', async () => {
    mockWorkspaceRead.mockResolvedValueOnce(workspace('Old session'));
    render(createElement(Consumer, { matterId: 'M-1', label: 'only' }));
    await waitUntil(
      () =>
        container
          .querySelector('[data-consumer="only"]')
          ?.getAttribute('data-title') === 'Old session',
    );

    const newSession = deferred<ReturnType<typeof libraryMatterFixture>>();
    mockWorkspaceRead.mockReturnValueOnce(newSession.promise);
    mockSession = 2;
    const clearing = clearEngineeringMatterQueries(queryClient);
    render(createElement(Consumer, { matterId: 'M-1', label: 'only' }));
    let settled = false;
    void clearing.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    for (let attempt = 0; attempt < 20 && !settled; attempt += 1) {
      await act(async () => {
        jest.advanceTimersByTime(0);
        await Promise.resolve();
      });
    }
    await clearing;
    await waitUntil(() => mockWorkspaceRead.mock.calls.length === 2);
    expect(
      container
        .querySelector('[data-consumer="only"]')
        ?.getAttribute('data-title'),
    ).toBe('');
    await act(async () => newSession.resolve(workspace('New session')));
    await waitUntil(
      () =>
        container
          .querySelector('[data-consumer="only"]')
          ?.getAttribute('data-title') === 'New session',
    );
  });

  test('network refresh keeps cached content while authorization rejects it', async () => {
    mockWorkspaceRead.mockResolvedValueOnce(workspace('Cached matter'));
    render(createElement(Consumer, { matterId: 'M-1', label: 'only' }));
    await waitUntil(
      () =>
        container
          .querySelector('[data-consumer="only"]')
          ?.getAttribute('data-title') === 'Cached matter',
    );

    mockWorkspaceRead.mockResolvedValueOnce(workspace('Refreshed matter'));
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-action="refresh-only"]')
        ?.click(),
    );
    await waitUntil(
      () =>
        container
          .querySelector('[data-consumer="only"]')
          ?.getAttribute('data-title') === 'Refreshed matter',
    );

    mockWorkspaceRead.mockRejectedValueOnce(new Error('network unavailable'));
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-action="refresh-only"]')
        ?.click(),
    );
    await waitUntil(
      () =>
        container
          .querySelector('[data-consumer="only"]')
          ?.getAttribute('data-error') === 'network unavailable',
    );
    expect(
      container
        .querySelector('[data-consumer="only"]')
        ?.getAttribute('data-title'),
    ).toBe('Refreshed matter');

    mockWorkspaceRead.mockRejectedValueOnce(
      Object.assign(new Error('access denied'), { statusCode: 403 }),
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-action="refresh-only"]')
        ?.click(),
    );
    await waitUntil(
      () =>
        container
          .querySelector('[data-consumer="only"]')
          ?.getAttribute('data-error') === 'access denied',
    );
    expect(
      container
        .querySelector('[data-consumer="only"]')
        ?.getAttribute('data-title'),
    ).toBe('');
  });

  test('exact historical workRef is shared and never replaced by current work', async () => {
    const historical = structuredClone(libraryMatterFixture().working.current!);
    historical.matterWorkRevisionId = 'history-2';
    mockWorkspaceRead.mockResolvedValue(workspace('Current matter'));
    mockHistoricalRead.mockResolvedValue(historical);
    render(
      createElement(Consumer, {
        matterId: 'M-1',
        workRef: 'history-2',
        label: 'a',
      }),
    );
    render(
      createElement(
        'div',
        null,
        createElement(Consumer, {
          matterId: 'M-1',
          workRef: 'history-2',
          label: 'a',
        }),
        createElement(Consumer, {
          matterId: 'M-1',
          workRef: 'history-2',
          label: 'b',
        }),
      ),
    );
    await waitUntil(
      () =>
        container
          .querySelector('[data-consumer="a"]')
          ?.getAttribute('data-revision') === 'history-2',
    );
    expect(mockHistoricalRead).toHaveBeenCalledTimes(1);
    expect(
      container
        .querySelector('[data-consumer="b"]')
        ?.getAttribute('data-revision'),
    ).toBe('history-2');
  });

  test('current W5 to W6 refresh does not rebind an exact historical W5', async () => {
    const currentW5 = libraryMatterFixture();
    currentW5.working.current!.matterWorkRevisionId = 'W5';
    const currentW6 = structuredClone(currentW5);
    currentW6.working.current!.matterWorkRevisionId = 'W6';
    currentW6.working.current!.workingRevision = 6;
    mockWorkspaceRead
      .mockResolvedValueOnce(currentW5)
      .mockResolvedValueOnce(currentW6);
    const historicalW5 = structuredClone(currentW5.working.current!);
    mockHistoricalRead.mockResolvedValue(historicalW5);

    render(
      createElement(
        'div',
        null,
        createElement(Consumer, { matterId: 'M-1', label: 'current' }),
        createElement(Consumer, {
          matterId: 'M-1',
          workRef: 'W5',
          label: 'history',
        }),
      ),
    );
    await waitUntil(
      () =>
        container
          .querySelector('[data-consumer="current"]')
          ?.getAttribute('data-working-revision') === 'W5' &&
        container
          .querySelector('[data-consumer="history"]')
          ?.getAttribute('data-revision') === 'W5',
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-action="refresh-current"]')
        ?.click(),
    );
    await waitUntil(
      () =>
        container
          .querySelector('[data-consumer="current"]')
          ?.getAttribute('data-working-revision') === 'W6',
    );
    expect(
      container
        .querySelector('[data-consumer="history"]')
        ?.getAttribute('data-revision'),
    ).toBe('W5');
    expect(mockHistoricalRead).toHaveBeenCalledTimes(1);
  });

  test('a 403 on one matter does not clear another matter or retry automatically', async () => {
    let matterACalls = 0;
    mockWorkspaceRead.mockImplementation((matterId: string) => {
      if (matterId === 'B') return Promise.resolve(workspace('B matter'));
      matterACalls += 1;
      return matterACalls === 1
        ? Promise.resolve(workspace('A matter'))
        : Promise.reject(
            Object.assign(new Error('access denied'), { statusCode: 403 }),
          );
    });
    render(
      createElement(
        'div',
        null,
        createElement(Consumer, { matterId: 'A', label: 'a' }),
        createElement(Consumer, { matterId: 'B', label: 'b' }),
      ),
    );
    await waitUntil(
      () =>
        container
          .querySelector('[data-consumer="a"]')
          ?.getAttribute('data-title') === 'A matter' &&
        container
          .querySelector('[data-consumer="b"]')
          ?.getAttribute('data-title') === 'B matter',
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-action="refresh-a"]')
        ?.click(),
    );
    await waitUntil(
      () =>
        container
          .querySelector('[data-consumer="a"]')
          ?.getAttribute('data-error') === 'access denied',
    );
    expect(
      container
        .querySelector('[data-consumer="a"]')
        ?.getAttribute('data-title'),
    ).toBe('');
    expect(
      container
        .querySelector('[data-consumer="b"]')
        ?.getAttribute('data-title'),
    ).toBe('B matter');
    expect(matterACalls).toBe(2);
    await act(async () => {
      jest.advanceTimersByTime(60_000);
      await Promise.resolve();
    });
    expect(matterACalls).toBe(2);
  });

  test('recycles an inactive matter workspace after gcTime', async () => {
    mockWorkspaceRead.mockImplementation((matterId: string) =>
      Promise.resolve(workspace(`${matterId} matter`)),
    );
    const hasWorkspace = (matterId: string): boolean =>
      queryClient
        .getQueryCache()
        .getAll()
        .some(
          (query) =>
            query.queryKey[2] === 'workspace' &&
            query.queryKey.at(-1) === matterId,
        );
    render(createElement(Consumer, { matterId: 'A', label: 'only' }));
    await waitUntil(
      () =>
        container
          .querySelector('[data-consumer="only"]')
          ?.getAttribute('data-title') === 'A matter',
    );
    render(createElement(Consumer, { matterId: 'B', label: 'only' }));
    await waitUntil(
      () =>
        container
          .querySelector('[data-consumer="only"]')
          ?.getAttribute('data-title') === 'B matter',
    );
    expect(hasWorkspace('A')).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(5 * 60_000 + 1);
      await Promise.resolve();
    });
    expect(hasWorkspace('A')).toBe(false);
    expect(hasWorkspace('B')).toBe(true);
  });
});
