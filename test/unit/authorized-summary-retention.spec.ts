import { act, createElement, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import { useAuthorizedSummaryResource } from '@client/src/features/derived-summary/useAuthorizedSummaryResource';

let mockSession = 1, mockActor = 'actor-A', mockTenant = 'tenant-A', mockAuthenticationRequired = false;
const mockIdentity = jest.fn();
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => mockSession,
  getCanonicalHostIdentityContext: (...args: unknown[]) => mockIdentity(...args),
  subscribeCanonicalHostClientSession: () => () => undefined,
}));
jest.mock('@client/src/api/engineering-matter', () => ({
  getEngineeringMatterWorkspace: () => { throw new Error('UNEXPECTED_WORKSPACE_READ'); },
  getEngineeringMatterWorkingRevision: () => { throw new Error('UNEXPECTED_MATTER_READ'); },
}));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({
  useCurrentUserSession: () => ({ currentUser: { user_id: mockActor },
    sessionGeneration: mockSession, authenticationRequired: mockAuthenticationRequired }),
}));

interface PendingRead {
  signal: AbortSignal;
  resolve(value: string): void;
  reject(reason: Error): void;
}
let dom: JSDOM, root: Root, container: HTMLElement, client: QueryClient;
let pending: PendingRead[], load: jest.Mock<Promise<string>, [AbortSignal]>;
let current: ReturnType<typeof useAuthorizedSummaryResource<string>>;
let commits: Array<string | null>;
const globals = new Map<string, PropertyDescriptor | undefined>();

function Reading({ binding }: { binding: string }) {
  current = useAuthorizedSummaryResource(binding, mockSession, load);
  useLayoutEffect(() => { commits.push(current.data); });
  return createElement('section', null,
    createElement('p', { 'data-body': true }, current.data ?? ''),
    createElement('p', { 'data-retained': current.retainedAfterError, 'data-withheld': current.withheld },
      current.error ?? ''),
  );
}
async function settle() {
  for (let index = 0; index < 3; index++)
    await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); });
}
async function render(binding = 'DV1:parse-1:semantic-1:DRR-1:r1') {
  await act(async () => root.render(createElement(QueryClientProvider, { client },
    createElement(Reading, { binding }))));
  await settle();
}
async function refresh() {
  await act(async () => { await current.refresh(); });
  await settle();
}
async function resolveRead(index: number, body: string) {
  await act(async () => pending[index].resolve(body));
  await settle();
}
function body() { return container.querySelector('[data-body]')?.textContent; }

beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test/', pretendToBeVisual: true });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  Reflect.set(dom.window, 'appId', 'app-A');
  mockSession = 1; mockActor = 'actor-A'; mockTenant = 'tenant-A'; mockAuthenticationRequired = false;
  mockIdentity.mockReset().mockImplementation(async () => ({ userId: mockActor, tenantId: mockTenant }));
  pending = []; commits = [];
  load = jest.fn(signal => new Promise<string>((resolve, reject) => pending.push({ signal, resolve, reject })));
  container = dom.window.document.getElementById('root')!;
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear(); dom.window.close();
  for (const [key, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
  globals.clear();
});

it('retains only the displayed exact revision on a same-identity transport failure', async () => {
  await render();
  await resolveRead(0, 'Exact DRR-1; revision 1; applicability unconfirmed.');
  await refresh();
  expect(body()).toContain('Exact DRR-1');
  await act(async () => pending[1].reject(Object.assign(new Error('network interrupted'), { code: 'ERR_NETWORK' })));
  expect(body()).toBe('Exact DRR-1; revision 1; applicability unconfirmed.');
  expect(current.retainedAfterError).toBe(true);
  expect(current.error).toBe('network interrupted');
  expect(mockIdentity).toHaveBeenCalledWith({ fresh: true });
});

it('same-identity focus checks do not abort or restart a slow saved-body read', async () => {
  await render();
  let finishIdentity!: (value: { userId: string; tenantId: string }) => void;
  mockIdentity.mockImplementationOnce(() => new Promise(resolve => { finishIdentity = resolve; }));
  let refreshing!: Promise<void>;
  await act(async () => { refreshing = current.refresh(); });
  await settle();
  expect(pending[0].signal.aborted).toBe(false);
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () => {
    finishIdentity({ userId: mockActor, tenantId: mockTenant });
    await refreshing;
  });
  await settle();
  expect(pending[0].signal.aborted).toBe(false);
  expect(load).toHaveBeenCalledTimes(1);
  await resolveRead(0, 'Slow exact body completed');
  expect(body()).toBe('Slow exact body completed');
});

it('same-scope identity unavailability retains prior data but identity denial then a 5xx cannot revive it', async () => {
  await render(); await resolveRead(0, 'Authorized saved body');
  mockIdentity.mockRejectedValueOnce(Object.assign(new Error('identity unavailable'), { statusCode: 503 }));
  await refresh();
  expect(body()).toBe('Authorized saved body');
  expect(current.retainedAfterError).toBe(true);
  mockIdentity.mockRejectedValueOnce(Object.assign(new Error('identity denied'), { statusCode: 403 }));
  await refresh();
  expect(body()).toBe('');
  mockIdentity.mockRejectedValueOnce(Object.assign(new Error('identity unavailable again'), { statusCode: 503 }));
  await refresh();
  expect(body()).toBe('');
  expect(current.withheld).toBe(true);
  await refresh();
  expect(body()).toBe('');
  await resolveRead(1, 'Fresh source authorization succeeded');
  expect(body()).toBe('Fresh source authorization succeeded');
});

it.each(['actor', 'app', 'session'] as const)('changing %s isolates the old body before effects and ignores its late reply', async change => {
  await render(); await resolveRead(0, 'Old scope body'); await refresh();
  commits.length = 0;
  if (change === 'actor') mockActor = 'actor-B';
  if (change === 'app') Reflect.set(dom.window, 'appId', 'app-B');
  if (change === 'session') mockSession++;
  await render();
  expect(commits[0]).toBeNull();
  expect(pending[1].signal.aborted).toBe(true);
  await resolveRead(1, 'Late old scope body');
  expect(body()).toBe('');
  await resolveRead(2, 'New scope body');
  expect(body()).toBe('New scope body');
});

it('a tenant-only identity refresh aborts the old-tenant read and never assigns it to the new tenant', async () => {
  await render(); await resolveRead(0, 'Tenant A exact body'); await refresh();
  mockTenant = 'tenant-B';
  await act(async () => { await client.refetchQueries({ predicate: query => query.queryKey[2] === 'identity' }); });
  await settle();
  expect(body()).toBe('');
  expect(pending[1].signal.aborted).toBe(true);
  await resolveRead(1, 'Late tenant A body');
  expect(body()).toBe('');
  await resolveRead(2, 'Tenant B authorized body');
  expect(body()).toBe('Tenant B authorized body');
});

it('an exact saved-ref switch never displays or revives the previous revision', async () => {
  await render(); await resolveRead(0, 'DRR-1 exact body'); await refresh();
  commits.length = 0;
  await render('DV1:parse-1:semantic-1:DRR-2:r2');
  expect(commits[0]).toBeNull();
  await resolveRead(1, 'Late DRR-1 body');
  expect(body()).toBe('');
  await resolveRead(2, 'DRR-2 exact body');
  expect(body()).toBe('DRR-2 exact body');
});

it('authentication loss hides content immediately and a late reply cannot restore it', async () => {
  await render(); await resolveRead(0, 'Saved body'); await refresh();
  mockAuthenticationRequired = true; commits.length = 0;
  await render();
  expect(commits[0]).toBeNull();
  await resolveRead(1, 'Late body after authentication loss');
  expect(body()).toBe('');
});
