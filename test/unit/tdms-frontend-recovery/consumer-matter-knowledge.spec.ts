import KnowledgeLookupPage from '@client/src/pages/KnowledgeLookupPage/KnowledgeLookupPage';
import { libraryDocuments } from '../fixtures/canonical-library';
import { summaryKnowledge } from '../fixtures/derived-summary';
import { savedEvidence } from './reader-fixtures';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import EngineeringMatterPage from '@client/src/features/matter/EngineeringMatterPage';
import { libraryMatterFixture } from '../fixtures/library-matter';
import { jobAidReadingFixture } from '../semantic-reading-ui.fixtures';

const { JSDOM } = require('jsdom');
const mockWorkspaceGet = jest.fn(), mockWorkGet = jest.fn(), mockReviewGet = jest.fn();
const mockStatusGet = jest.fn(), mockActivityGet = jest.fn();
let mockGeneration = 7;
const mockNativeGet = jest.fn(), mockNativeReaderImport = jest.fn(), mockGraphLoader = jest.fn();
const mockKnowledge = jest.fn(), mockKnowledgeCatalogue = jest.fn();
jest.mock('@client/src/features/tdms-source/TdmsSourceReading', () => { mockNativeReaderImport(); return { __esModule: true, default: () => null }; });
jest.mock('@client/src/features/tdms-source/tdms-relation-graph-loader', () => ({ loadTdmsSourceRelationGraph: (...args: unknown[]) => mockGraphLoader(...args) }));
jest.mock('@client/src/api/engineering-matter', () => ({
  getEngineeringMatterDirectory: async () => ({ items: [], nextCursor: null }),
  getEngineeringMatterWorkspace: (...args: unknown[]) => mockWorkspaceGet(...args),
  getEngineeringMatterWorkingRevision: (...args: unknown[]) => mockWorkGet(...args),
}));
jest.mock('@client/src/api/canonical-host', () => ({
  readTdmsSourceCatalogue: (...args: unknown[]) => mockNativeGet(...args),
  readTdmsSourceRecord: (...args: unknown[]) => mockNativeGet(...args),
  readTdmsSourceRelations: (...args: unknown[]) => mockNativeGet(...args),
  readEngineeringKnowledgeCatalogue: (...args: unknown[]) => mockKnowledgeCatalogue(...args),
  readEngineeringKnowledgeWork: (...args: unknown[]) => mockKnowledge(...args),
  getCanonicalLibraryDocuments: async () => libraryDocuments(['FAM-1']),
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

jest.mock('@client/src/pages/KnowledgeLookupPage/knowledge-lookup.css', () => ({}));
jest.mock('@client/src/pages/KnowledgeLookupPage/knowledge-suite.css', () => ({}));

function workspace() {
  const value = libraryMatterFixture();
  const revision = value.working.current!;
  revision.state.problemWork = jobAidReadingFixture().current!.content;
  revision.state.problemWork.evidence.push(savedEvidence('synthetic-native-old'));
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
    const work = summaryKnowledge(); work.content.evidence.push(savedEvidence('synthetic-native-old'));
    mockKnowledge.mockResolvedValue(work); mockKnowledgeCatalogue.mockResolvedValue({ entries: [work.entry], nextAfter: null });
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


  function closed() {
    expect(mockNativeGet).not.toHaveBeenCalled(); expect(mockNativeReaderImport).not.toHaveBeenCalled(); expect(mockGraphLoader).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('TDMS 来源目录');
  }
  it('real current Matter consumer keeps its saved article and mounts no TDMS layer despite saved exact native refs', async () => {
    dom.window.localStorage.setItem('TDMS_SOURCE_UI_ENABLED', 'true'); await mount('?tdms=true');
    expect(container.textContent).toContain('软件标准转换'); closed(); expect(mockKnowledge).not.toHaveBeenCalled();
    const count = mockWorkspaceGet.mock.calls.length;
    await act(async () => { dom.window.dispatchEvent(new dom.window.Event('focus')); document.dispatchEvent(new dom.window.Event('visibilitychange')); });
    closed(); expect(mockWorkspaceGet.mock.calls.length).toBeGreaterThanOrEqual(count);
  });
  it.each([401,403,404])('real historical Matter denial %s removes its old saved article with native channel still closed', async status => {
    const old = structuredClone(workspace().working.current!); old.matterWorkRevisionId = 'old-working'; old.state.problemWork!.issues[0].body = 'ONLY_AUTHORIZED_OLD_BODY';
    mockWorkGet.mockResolvedValueOnce(old).mockRejectedValue(Object.assign(new Error('source denied'), { statusCode: status }));
    await mount('?workRef=old-working&tdms=true'); expect(container.textContent).toContain('ONLY_AUTHORIZED_OLD_BODY'); closed();
    await click('重新读取'); expect(container.textContent).not.toContain('ONLY_AUTHORIZED_OLD_BODY'); closed();
    expect(mockWorkGet).toHaveBeenCalledTimes(2); expect(mockKnowledge).not.toHaveBeenCalled();
  });
  async function mountKnowledge(query: string) {
    router = createMemoryRouter([{ path: '/knowledge', element: createElement(KnowledgeLookupPage) }], { initialEntries: ['/knowledge?'+query] });
    await act(async () => root.render(createElement(QueryClientProvider, { client: queryClient }, createElement(RouterProvider, { router }))));
  }
  it('real saved-work Knowledge consumer preserves exact ordinary work reading without extra TDMS savedWork/catalogue reads', async () => {
    await mountKnowledge('kind=works&subjectKind=WORK_ITEM&subjectId=WI-1&workRef=JAWR-1&tdms=true');
    expect(mockKnowledge).toHaveBeenCalledTimes(1); expect(mockKnowledge.mock.calls[0][0]).toEqual({subjectKind:'WORK_ITEM',subjectId:'WI-1',workRef:'JAWR-1'});
    expect(container.textContent).toContain('当时的工程认识'); closed();
  });
  it('real document Knowledge consumer reads ordinary catalogue and leaves native source entry unmounted', async () => {
    await mountKnowledge('kind=sources&tdms=true'); expect(container.textContent).toContain('工程文档与确切版本');
    closed(); expect(mockKnowledge).not.toHaveBeenCalled();
  });
  it('real Matter consumer session generation switch masks a late old workspace and keeps native reads closed', async () => {
    let old!: (value: ReturnType<typeof workspace>) => void; mockWorkspaceGet.mockImplementationOnce(() => new Promise(yes => { old = yes; }));
    await mount('?tdms=true'); mockGeneration++; mockWorkspaceGet.mockRejectedValue(Object.assign(new Error('new session denied'), {statusCode:401}));
    await act(async () => router.navigate('/matters/ui-test-matter?tdms=true&session=8'));
    await act(async () => old(workspace())); expect(container.textContent).not.toContain('软件标准转换'); closed();
  });
});
