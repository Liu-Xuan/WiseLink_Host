import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import EngineeringMatterPage from '@client/src/features/matter/EngineeringMatterPage';
import { libraryMatterFixture } from './fixtures/library-matter';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';

const { JSDOM } = require('jsdom');
const mockWorkspaceGet = jest.fn(), mockWorkGet = jest.fn(), mockReviewGet = jest.fn();
const mockStatusGet = jest.fn(), mockActivityGet = jest.fn();
let mockGeneration = 7;
jest.mock('@client/src/api/engineering-matter', () => ({
  getEngineeringMatterWorkspace: (...args: unknown[]) => mockWorkspaceGet(...args),
  getEngineeringMatterWorkingRevision: (...args: unknown[]) => mockWorkGet(...args),
}));
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => mockGeneration,
  getCanonicalHostIdentityContext: async () => ({ userId: 'actor-test', tenantId: 'tenant-test' }),
  subscribeCanonicalHostClientSession: () => () => undefined,
  getCurrentReviewConversation: (...args: unknown[]) => mockReviewGet(...args),
  readDocumentParsingStatus: (...args: unknown[]) => mockStatusGet(...args),
  readDocumentActivityReading: (...args: unknown[]) => mockActivityGet(...args),
}));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({
  useCurrentUserSession: () => ({ currentUser: { user_id: 'actor-test' }, sessionGeneration: mockGeneration, authenticationRequired: false }),
}));
jest.mock('@client/src/app/providers/CurrentObjectContextProvider', () => ({
  useCurrentObjectContext: () => ({ publishCurrentObject: jest.fn() }),
}));
jest.mock('@client/src/features/review/review-draft-store', () => ({ writeReviewDraft: jest.fn() }));
jest.mock('@client/src/features/workbench/RetainedWorkbenchPanel', () => ({
  __esModule: true, default: ({ active, children }: { active: boolean; children: ReactNode }) => active ? children : null,
}));
jest.mock('@client/src/components/ui/button', () => ({ Button: ({ children, asChild, ...rest }: { children: ReactNode; asChild?: boolean }) => asChild ? children : createElement('button', rest, children) }));
jest.mock('@client/src/features/matter/useReadingLocation', () => ({ __esModule: true, default: () => jest.fn() }));
jest.mock('@client/src/features/matter/ClaimEvidenceDialog', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/features/matter/MemberSavedAssessmentReading', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/features/matter/MatterExecutionSummary', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/features/matter/MatterMembers', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/features/matter/MatterMaterials', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/features/matter/MatterWorkingDetails', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/features/matter/EngineeringIssueSearch', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/features/matter/MatterDocumentSourceDialog', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/features/review/ContinuousReviewPanel', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/features/matter/saved-jobaid-reading.css', () => ({}));
jest.mock('@client/src/pages/DocumentParsingPage/jobaid-problem-workspace.css', () => ({}));
jest.mock('@client/src/features/workitem/workitem-overview.css', () => ({}));
jest.mock('@client/src/features/matter/matter-wiki.css', () => ({}));
jest.mock('@client/src/features/trinity/document-activity-timeline.css', () => ({}));

function workspace() {
  const value = libraryMatterFixture();
  const revision = value.working.current!;
  revision.state.problemWork = jobAidReadingFixture().current!.content;
  // Unrelated registered catalog material must not become the source choice.
  value.matter.catalog.entries = [{ workItemId: 'primary-test', relationRole: 'PRIMARY',
    document: { documentVersionId: 'unrelated-catalogue-document' } }] as typeof value.matter.catalog.entries;
  return value;
}

describe('real Wiki page + read hook + frozen recent changes mount', () => {
  let dom: InstanceType<typeof JSDOM>, root: Root, router: ReturnType<typeof createMemoryRouter>;
  let container: HTMLElement;
  let queryClient: QueryClient;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test/' });
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
      navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
      previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    notifyManager.setScheduler(queueMicrotask);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = dom.window.document.getElementById('root')!;
    root = createRoot(container);
    mockGeneration = 7;
    jest.resetAllMocks();
    mockWorkspaceGet.mockResolvedValue(workspace());
    mockReviewGet.mockResolvedValue({ conversation: null });
    mockStatusGet.mockReturnValue(new Promise(() => undefined));
  });
  afterEach(async () => {
    await act(async () => root.unmount()); router?.dispose(); queryClient.clear(); notifyManager.setScheduler(callback => setTimeout(callback, 0)); dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    previous.clear();
  });
  async function mount(search = '') {
    router = createMemoryRouter([{ path: '/matters/:matterId', element: createElement(EngineeringMatterPage) }],
      { initialEntries: [`/matters/ui-test-matter${search}`] });
    await act(async () => root.render(createElement(QueryClientProvider, { client: queryClient }, createElement(RouterProvider, { router }))));
  }
  async function click(text: string) {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent === text)!;
    await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
  }
  async function sourceChoice() {
    const details = Array.from(container.querySelectorAll('details')).find(item => item.querySelector('summary')?.textContent === '来源活动解释候选')!;
    await act(async () => { details.open = true; details.dispatchEvent(new dom.window.Event('toggle')); });
    const select = container.querySelector<HTMLSelectElement>('[aria-label="时间声明来源"]')!;
    await act(async () => { select.value = select.options[1].value; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
  }

  it('reauthorizes an exact historical work after explicit refresh and clears a new denial', async () => {
    const old = structuredClone(workspace().working.current!);
    old.matterWorkRevisionId = 'old-working-2'; old.workingRevision = 2;
    old.state.problemWork!.issues[0].body = 'ONLY_OLD_SOURCE_AUTHORIZED_BODY';
    mockWorkGet.mockResolvedValueOnce(old).mockRejectedValue(Object.assign(new Error('historical source revoked'), { statusCode: 403 }));
    await mount('?workRef=old-working-2');
    expect(container.textContent).toContain('ONLY_OLD_SOURCE_AUTHORIZED_BODY');
    await click('重新读取');
    console.log(JSON.stringify({case: 'historical-refresh-revocation', workspaceReads: mockWorkspaceGet.mock.calls.length,
      historicalReads: mockWorkGet.mock.calls.length, oldBodyStillVisible: container.textContent?.includes('ONLY_OLD_SOURCE_AUTHORIZED_BODY')}));
    expect(mockWorkspaceGet).toHaveBeenCalledTimes(2);
    expect(mockWorkGet).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain('ONLY_OLD_SOURCE_AUTHORIZED_BODY');
  });

  it('retries a transient exact-history read when the user requests a fresh read', async () => {
    const old = structuredClone(workspace().working.current!);
    old.matterWorkRevisionId = 'old-working-2'; old.workingRevision = 2;
    old.state.problemWork!.issues[0].body = 'RECOVERED_EXACT_HISTORY';
    mockWorkGet.mockRejectedValueOnce(new Error('history temporary unavailable')).mockResolvedValue(old);
    await mount('?workRef=old-working-2');
    expect(container.textContent).toContain('history temporary unavailable');
    await click('重新读取');
    console.log(JSON.stringify({case: 'historical-refresh-retry', workspaceReads: mockWorkspaceGet.mock.calls.length,
      historicalReads: mockWorkGet.mock.calls.length, recoveredBodyVisible: container.textContent?.includes('RECOVERED_EXACT_HISTORY')}));
    expect(mockWorkGet).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('RECOVERED_EXACT_HISTORY');
  });

  it('clears displayed history when the CURRENT scope fresh read is denied (control)', async () => {
    const old = structuredClone(workspace().working.current!);
    old.matterWorkRevisionId = 'old-working-2'; old.workingRevision = 2;
    old.state.problemWork!.issues[0].body = 'OLD_SCOPE_BODY';
    mockWorkGet.mockResolvedValue(old);
    await mount('?workRef=old-working-2');
    mockWorkspaceGet.mockRejectedValueOnce(Object.assign(new Error('current scope revoked'), { statusCode: 403 }));
    await click('重新读取');
    expect(container.textContent).not.toContain('OLD_SCOPE_BODY');
    expect(container.querySelector('[data-work-ref]')).toBeNull();
  });

  function pending<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((done, failed) => { resolve = done; reject = failed; });
    return { promise, resolve, reject };
  }
  function oldRevision(body: string, workRef = 'old-working-2') {
    const old = structuredClone(workspace().working.current!);
    old.matterWorkRevisionId = workRef; old.workingRevision = 2;
    old.state.problemWork!.issues[0].body = body;
    return old;
  }
  it.each([401, 403, 404, 500, undefined])('clears history during recheck, after failure %s, and throughout retry', async statusCode => {
    const old = oldRevision('PREVIOUS_AUTHORIZED_HISTORY');
    const recheck = pending<typeof old>(), retry = pending<typeof old>();
    mockWorkGet.mockResolvedValueOnce(old).mockReturnValueOnce(recheck.promise).mockReturnValueOnce(retry.promise);
    await mount('?workRef=old-working-2');
    expect(container.textContent).toContain('PREVIOUS_AUTHORIZED_HISTORY');
    await click('重新读取');
    expect(mockWorkGet).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain('PREVIOUS_AUTHORIZED_HISTORY');
    expect(container.querySelector('[data-work-ref]')).toBeNull();
    await act(async () => recheck.reject(Object.assign(new Error('history read failed'), statusCode === undefined ? {} : { statusCode })));
    expect(container.textContent).not.toContain('PREVIOUS_AUTHORIZED_HISTORY');
    expect(container.textContent).toContain(
      statusCode && [401, 403, 404].includes(statusCode)
        ? '暂时无法读取指定工作。请重新核对来源与权限。' : 'history read failed',
    );
    await click('重新读取');
    expect(mockWorkGet).toHaveBeenCalledTimes(3);
    expect(container.textContent).not.toContain('PREVIOUS_AUTHORIZED_HISTORY');
    await act(async () => retry.resolve(oldRevision('REAUTHORIZED_EXACT_HISTORY')));
    expect(container.textContent).toContain('REAUTHORIZED_EXACT_HISTORY');
    expect(container.querySelector('[data-work-ref="old-working-2"]')).not.toBeNull();
    expect(mockWorkGet.mock.calls.every(call => call[1] === 'old-working-2')).toBe(true);
  });

  it('rejects obsolete history from two rapid refreshes, while preserving the exact work', async () => {
    const old = oldRevision('INITIAL_HISTORY');
    const first = pending<typeof old>(), second = pending<typeof old>();
    mockWorkGet.mockResolvedValueOnce(old).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await mount('?workRef=old-working-2');
    await click('重新读取');
    await click('重新读取');
    expect(mockWorkGet).toHaveBeenCalledTimes(3);
    await act(async () => first.resolve(oldRevision('OBSOLETE_REFRESH_RESPONSE')));
    expect(container.textContent).not.toContain('OBSOLETE_REFRESH_RESPONSE');
    expect(container.textContent).not.toContain('INITIAL_HISTORY');
    await act(async () => second.resolve(oldRevision('LATEST_AUTHORIZED_RESPONSE')));
    expect(container.textContent).toContain('LATEST_AUTHORIZED_RESPONSE');
  });

  it('rejects an old workRef response after routing to another exact history', async () => {
    const a = pending<ReturnType<typeof oldRevision>>(), b = pending<ReturnType<typeof oldRevision>>();
    mockWorkGet.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    await mount('?workRef=work-A');
    await act(async () => router.navigate('/matters/ui-test-matter?workRef=work-B'));
    await act(async () => b.resolve(oldRevision('WORK_B_BODY', 'work-B')));
    expect(container.textContent).toContain('WORK_B_BODY');
    await act(async () => a.resolve(oldRevision('LATE_WORK_A_BODY', 'work-A')));
    expect(container.textContent).not.toContain('LATE_WORK_A_BODY');
    expect(container.querySelector('[data-work-ref="work-B"]')).not.toBeNull();
  });

  it('rejects an old session history response after the generation changes', async () => {
    const a = pending<ReturnType<typeof oldRevision>>(), b = pending<ReturnType<typeof oldRevision>>();
    mockWorkGet.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    await mount('?workRef=old-working-2');
    mockGeneration = 8;
    await act(async () => router.navigate('/matters/ui-test-matter?workRef=old-working-2&panel=brief'));
    await act(async () => b.resolve(oldRevision('SESSION_8_HISTORY')));
    await act(async () => a.resolve(oldRevision('LATE_SESSION_7_HISTORY')));
    expect(container.textContent).toContain('SESSION_8_HISTORY');
    expect(container.textContent).not.toContain('LATE_SESSION_7_HISTORY');
  });

  it.each([500, undefined])('clears CURRENT data during recheck and after a non-permission failure %s', async statusCode => {
    const recheck = pending<ReturnType<typeof workspace>>();
    await mount();
    expect(container.querySelector('[data-work-ref="test-working-3"]')).not.toBeNull();
    mockWorkspaceGet.mockReturnValueOnce(recheck.promise);
    await click('重新读取');
    expect(container.querySelector('[data-work-ref]')).toBeNull();
    await act(async () => recheck.reject(Object.assign(new Error('temporary current failure'), statusCode === undefined ? {} : { statusCode })));
    expect(container.querySelector('[data-work-ref]')).toBeNull();
    expect(container.textContent).toContain('temporary current failure');
    await click('重新读取');
    expect(container.querySelector('[data-work-ref="test-working-3"]')).not.toBeNull();
  });

  it('always loads the explicit exact work even when that ref is also current', async () => {
    mockWorkGet.mockResolvedValue(oldRevision('EXACT_ROUTE_BODY', 'test-working-3'));
    await mount('?workRef=test-working-3');
    expect(mockWorkGet).toHaveBeenCalledWith('ui-test-matter', 'test-working-3', expect.any(AbortSignal));
    expect(container.textContent).toContain('EXACT_ROUTE_BODY');
    await click('重新读取');
    expect(mockWorkGet).toHaveBeenCalledTimes(2);
  });
});
