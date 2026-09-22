import { act, createElement, lazy, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import Layout from '../../client/src/components/Layout';
import RouteOutletBoundary from '../../client/src/components/RouteOutletBoundary';

const { JSDOM } = require('jsdom');

jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({
  CurrentUserSessionProvider: ({ children }: { children: ReactNode }) =>
    children,
  useCurrentUserSession: () => ({
    currentUser: { user_id: 'actor-1' },
    sessionGeneration: 1,
    authenticationRequired: false,
    profileSettled: true,
  }),
}));
jest.mock('@client/src/api/canonical-host', () => ({
  subscribeCanonicalHostClientSession: () => () => {},
}));
jest.mock('@client/src/api/engineering-matter', () => ({
  getEngineeringMatterWorkspace: jest.fn(),
  getEngineeringMatterWorkingRevision: jest.fn(),
}));
jest.mock('@client/src/features/matter/useEngineeringMatter', () => ({
  __esModule: true,
  default: jest.fn(),
  useEngineeringMatterWorkingRevision: jest.fn(),
  clearEngineeringMatterQueries: jest.fn(async () => undefined),
  ENGINEERING_MATTER_QUERY_ROOT: ['canonical-host', 'engineering-matter'],
}));
jest.mock('@client/src/features/navigation/Sidebar', () => ({
  __esModule: true,
  default: () => createElement('nav', { 'data-testid': 'sidebar' }, '侧栏'),
}));
jest.mock('@client/src/features/navigation/TopBar', () => ({
  __esModule: true,
  default: () => createElement('header', { 'data-testid': 'topbar' }, '顶栏'),
}));
jest.mock('@lark-apaas/client-toolkit/components/UniversalLink', () => ({
  UniversalLink: ({ children, ...props }: { children?: ReactNode }) =>
    createElement('a', props, children),
}));
jest.mock('../../client/src/components/route-outlet-boundary.css', () => ({}), {
  virtual: true,
});
jest.mock('../../client/src/components/app-shell.css', () => ({}), {
  virtual: true,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/** Persistent, non-lazy shell navigation used to leave a failing route. */
function ShellNav() {
  return createElement(
    'nav',
    { 'data-testid': 'shell-nav' },
    createElement(NavLink, { to: '/home' }, '返回首页'),
  );
}

function ShellHost() {
  return createElement(
    'div',
    null,
    createElement(ShellNav),
    createElement(Layout),
  );
}

describe('route outlet boundary', () => {
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

  async function settle(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function renderRoute(element: ReactNode, initialPath: string): void {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          MemoryRouter,
          { initialEntries: [initialPath] },
          createElement(
            Routes,
            null,
            createElement(
              Route,
              { path: '/', element: createElement(ShellHost) },
              createElement(Route, {
                path: 'library',
                element: createElement(RouteOutletBoundary, null, element),
              }),
              createElement(Route, {
                path: 'home',
                element: createElement('h1', null, '首页正文'),
              }),
            ),
          ),
        ),
      ),
    );
  }

  test('a lazy page wait keeps the shell mounted', async () => {
    const pending = deferred<{ default: () => ReactNode }>();
    const LazyPage = lazy(() => pending.promise);
    renderRoute(createElement(LazyPage), '/library');
    await settle();
    expect(container.querySelector('[data-testid="sidebar"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="topbar"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="shell-nav"]')).not.toBeNull();
    expect(container.textContent).toContain('正在加载页面');
  });

  test('a failed page chunk keeps the shell and recovers on navigation', async () => {
    const failing = deferred<{ default: () => ReactNode }>();
    const LazyFail = lazy(() => failing.promise);
    renderRoute(createElement(LazyFail), '/library');
    await settle();
    await act(async () => {
      failing.reject(new Error('chunk unavailable'));
    });
    await settle();
    expect(container.querySelector('[data-testid="sidebar"]')).not.toBeNull();
    expect(container.textContent).toContain('页面加载失败');

    const shell = container.querySelector('[data-testid="sidebar"]');
    await act(async () => {
      (
        container.querySelector('[data-testid="shell-nav"] a') as HTMLElement
      ).click();
    });
    await settle();
    expect(container.querySelector('[data-testid="sidebar"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="sidebar"]')).toBe(shell);
    expect(container.textContent).toContain('首页正文');
  });
});
