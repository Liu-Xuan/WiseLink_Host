import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { useKnowledgeResources } from '../../client/src/pages/KnowledgeLookupPage/useKnowledgeResources';
import type { EngineeringKnowledgeIdentity, EngineeringKnowledgeRead } from '../../shared/engineering-issue-search.interface';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';

const { JSDOM } = require('jsdom');
let mockSession = 1, mockTenant = 'tenant-test', mockActor = 'actor-test';
const mockRead = jest.fn();
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => mockSession,
  subscribeCanonicalHostClientSession: () => () => undefined,
  getCanonicalHostIdentityContext: async () => ({ tenantId: mockTenant, userId: mockActor }),
  readEngineeringKnowledgeCatalogue: async () => ({ entries: [], nextCursor: null }),
  readEngineeringKnowledgeWork: (...args: unknown[]) => mockRead(...args),
  readJobAidAssessmentWork: jest.fn(),
}));
jest.mock('@client/src/api/engineering-matter', () => ({}));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({
  useCurrentUserSession: () => ({ sessionGeneration: mockSession, authenticationRequired: false,
    currentUser: { user_id: mockActor } }),
}));

const A: EngineeringKnowledgeIdentity = { subjectKind: 'WORK_ITEM', subjectId: 'work-A', workRef: 'revision-A' };
const B: EngineeringKnowledgeIdentity = { subjectKind: 'ENGINEERING_MATTER', subjectId: 'matter-B', workRef: 'revision-B' };
const rootKey = () => ['canonical-host', 'engineering-matter', 'knowledge', 'app-test', mockTenant, mockActor, mockSession];
const workKey = (identity: EngineeringKnowledgeIdentity) => [...rootKey(), 'work', identity.subjectKind, identity.subjectId, identity.workRef];
function reading(identity: EngineeringKnowledgeIdentity, headline = 'saved'): EngineeringKnowledgeRead {
  return { entry: { ...identity, workRevision: 1, current: true, headline, listBrief: headline,
    createdAt: '2026-10-15T00:00:00Z', overviewStatus: 'CURRENT' },
  content: jobAidReadingFixture().current!.content, reading: null };
}
interface Pending {
  identity: EngineeringKnowledgeIdentity;
  signal: AbortSignal;
  resolve(value: EngineeringKnowledgeRead): void;
  reject(reason: unknown): void;
}
let pending: Pending[], dom: InstanceType<typeof JSDOM>, client: QueryClient, root: Root | null, container: HTMLElement;
const oldGlobals = new Map<string, PropertyDescriptor | undefined>();

function View({ selected, enabled }: { selected: EngineeringKnowledgeIdentity | null; enabled: boolean }) {
  const resource = useKnowledgeResources('', 'CURRENT', undefined, selected, null, enabled);
  return createElement('section', null,
    createElement('p', { 'data-reading': true }, resource.read ? `${resource.read.entry.workRef}:${resource.read.entry.headline}` : ''),
    resource.workError ? createElement('p', { role: 'alert' }, 'Access unavailable') : null);
}
async function render(selected: EngineeringKnowledgeIdentity | null, enabled = true) {
  await act(async () => root!.render(createElement(QueryClientProvider, { client }, createElement(View, { selected, enabled }))));
}
function seedIdentity() {
  client.setQueryData(['canonical-host', 'engineering-matter', 'identity', 'app-test', mockActor, mockSession],
    { appId: 'app-test', tenantId: mockTenant, actorId: mockActor, sessionGeneration: mockSession });
  client.setQueryData([...rootKey(), 'catalogue', '', 'CURRENT', null],
    { kind: 'readable', data: { entries: [], nextCursor: null }, sessionGeneration: mockSession });
}
function body() { return container.querySelector('[data-reading]')?.textContent; }

beforeEach(() => {
  mockSession = 1; mockTenant = 'tenant-test'; mockActor = 'actor-test'; pending = [];
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test/' });
  Object.defineProperty(dom.window, 'appId', { value: 'app-test' });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    oldGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  notifyManager.setScheduler(callback => callback());
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, refetchOnWindowFocus: false } } });
  seedIdentity();
  for (const identity of [A, B]) client.setQueryData(workKey(identity),
    { kind: 'readable', data: reading(identity), sessionGeneration: mockSession }, { updatedAt: Date.now() - 60_000 });
  mockRead.mockReset();
  mockRead.mockImplementation((identity: EngineeringKnowledgeIdentity, signal: AbortSignal) =>
    new Promise<EngineeringKnowledgeRead>((resolve, reject) => {
      pending.push({ identity, signal, resolve, reject });
      signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })), { once: true });
    }));
  container = dom.window.document.getElementById('root')!; root = createRoot(container);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null; client.clear(); notifyManager.setScheduler(callback => setTimeout(callback, 0)); dom.window.close();
  for (const [key, descriptor] of oldGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
  oldGlobals.clear();
});

it('reuses the two pending exact reads through twenty switches while keeping the selected cached body', async () => {
  await render(A);
  for (let index = 0; index < 20; index++) {
    const selected = index % 2 === 0 ? B : A;
    await render(selected);
    expect(body()).toBe(`${selected.workRef}:saved`);
  }
  expect(mockRead).toHaveBeenCalledTimes(2);
  expect(pending.every(item => !item.signal.aborted)).toBe(true);
  await act(async () => pending.forEach(item => item.resolve(reading(item.identity, 'fresh'))));
  expect(body()).toBe('revision-A:fresh');
  await render(B);
  expect(body()).toBe('revision-B:fresh');
  expect(mockRead).toHaveBeenCalledTimes(2);
});

it('aborts both outstanding reads when the page unmounts', async () => {
  await render(A); await render(B);
  await act(async () => root!.unmount()); root = null;
  expect(pending).toHaveLength(2);
  expect(pending.every(item => item.signal.aborted)).toBe(true);
});

it('aborts retained reads and hides content when the knowledge view is deactivated', async () => {
  await render(A); await render(B); await render(B, false);
  expect(body()).toBe('');
  expect(pending.every(item => item.signal.aborted)).toBe(true);
});

it.each(['SESSION', 'TENANT', 'ACTOR'] as const)('drops the prior reader scope when %s changes', async change => {
  await render(A); await render(B); const previous = [...pending];
  if (change === 'SESSION') mockSession++;
  if (change === 'TENANT') mockTenant = 'other-tenant';
  if (change === 'ACTOR') mockActor = 'other-actor';
  await act(async () => seedIdentity()); await render(A);
  expect(body()).toBe('');
  expect(previous.every(item => item.signal.aborted)).toBe(true);
});

it('records a denied offscreen exact read so returning to it cannot reveal its old body', async () => {
  await render(A); await render(B);
  await act(async () => pending[0].reject(Object.assign(new Error('Source access revoked'), { statusCode: 403 })));
  expect(body()).toBe('revision-B:saved');
  await render(A);
  expect(body()).toBe('');
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
});

it('bounds the recent-reader set instead of retaining every previously selected request', async () => {
  for (let index = 0; index < 12; index++) await render({ ...A, subjectId: `work-${index}`, workRef: `revision-${index}` });
  expect(pending[0].signal.aborted).toBe(true);
  expect(pending.at(-1)!.signal.aborted).toBe(false);
});
