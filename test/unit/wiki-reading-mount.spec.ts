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
    jest.clearAllMocks();
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

  it('passes only the exact read work, same-scope unique primary and saved source choices', async () => {
    await mount();
    expect(container.querySelector('[data-work-ref="test-working-3"]')).not.toBeNull();
    expect(mockReviewGet).toHaveBeenCalledWith('primary-test', { kind: 'ENGINEERING_MATTER', matterId: 'ui-test-matter' });
    expect(mockReviewGet).toHaveBeenCalledTimes(1);
    const options = Array.from(container.querySelectorAll('select option')).map(item => item.textContent);
    expect(options).toContain('原文适用条件 · 修订 1');
    expect(options.join('')).not.toContain('unrelated-catalogue-document');
    expect(mockStatusGet).not.toHaveBeenCalled(); expect(mockActivityGet).not.toHaveBeenCalled();
    expect(container.textContent).toContain('该工作的关联回执未取得');
    await sourceChoice();
    expect(mockStatusGet).toHaveBeenCalledWith('document-test', expect.any(AbortSignal));
    expect(mockWorkspaceGet).toHaveBeenCalledTimes(1);
  });

  it('keeps historical work and source context exact without current receipt or latest reads', async () => {
    const old = structuredClone(workspace().working.current!);
    old.matterWorkRevisionId = 'old-working-2'; old.workingRevision = 2;
    old.state.problemWork!.issues[0].body = '历史保存判断不得替换。';
    mockWorkGet.mockResolvedValue(old);
    await mount('?workRef=old-working-2');
    expect(container.querySelector('[data-work-ref="old-working-2"]')).not.toBeNull();
    expect(container.textContent).toContain('历史保存判断不得替换');
    expect(mockReviewGet).not.toHaveBeenCalled();
    await sourceChoice();
    expect(mockStatusGet).not.toHaveBeenCalled(); expect(mockActivityGet).not.toHaveBeenCalled();
    expect(container.textContent).toContain('不会读取最新候选');
  });

  it('does not select a Review anchor when primary membership is ambiguous', async () => {
    const value = workspace();
    value.matter.catalog.entries.push({ ...value.matter.catalog.entries[0], workItemId: 'another-primary' });
    mockWorkspaceGet.mockResolvedValue(value);
    await mount();
    expect(container.querySelector('[data-work-ref="test-working-3"]')).not.toBeNull();
    expect(mockReviewGet).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404])('clears both saved body and recent changes after matter GET denial %i', async (statusCode) => {
    await mount();
    expect(container.querySelector('[data-saved-context-issue]')).not.toBeNull();
    mockWorkspaceGet.mockRejectedValueOnce(Object.assign(new Error('permission removed'), { statusCode }));
    await click('重新读取');
    expect(container.querySelector('[data-saved-context-issue]')).toBeNull();
    expect(container.querySelector('[data-work-ref]')).toBeNull();
    expect(container.textContent).not.toContain('当前构型是什么？');
  });

  it('does not relabel prior payload with a later session generation', async () => {
    await mount();
    expect(container.querySelector('[data-work-ref="test-working-3"]')).not.toBeNull();
    const reviewReads = mockReviewGet.mock.calls.length;
    mockGeneration = 8;
    mockWorkspaceGet.mockReturnValue(new Promise(() => undefined));
    await act(async () => router.navigate('/matters/ui-test-matter?panel=brief'));
    expect(container.querySelector('[data-work-ref]')).toBeNull();
    expect(container.querySelector('[data-saved-context-issue]')).toBeNull();
    expect(mockReviewGet).toHaveBeenCalledTimes(reviewReads);
  });
});
