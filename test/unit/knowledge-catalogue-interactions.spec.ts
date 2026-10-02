import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type {
  EngineeringKnowledgeEntry,
  EngineeringKnowledgePage,
  EngineeringKnowledgeRead,
  EngineeringKnowledgeScope,
} from '@shared/engineering-issue-search.interface';
import type { CanonicalLibraryDocumentsResponse, EngineeringMatterDirectoryResponse } from '@shared/api.interface';
import type { DocumentReadingPreview } from '@shared/document-reading.interface';
import { getCanonicalLibraryDocuments } from '@client/src/api/canonical-host';
import { getEngineeringMatterDirectory } from '@client/src/api/engineering-matter';
import { clearEngineeringMatterQueries, ENGINEERING_MATTER_QUERY_ROOT } from '@client/src/features/matter/useEngineeringMatter';
import KnowledgeLookupPage from '@client/src/pages/KnowledgeLookupPage/KnowledgeLookupPage';
import { libraryDocuments } from './fixtures/canonical-library';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';
import { knowledgeMatterReturnRoute, readingReturnTarget } from '@client/src/features/matter/reading-return';

const { JSDOM } = require('jsdom');
jest.mock('@client/src/features/matter/saved-jobaid-reading.css', () => ({}));
jest.mock('@client/src/pages/DocumentParsingPage/jobaid-problem-workspace.css', () => ({}));

const mockCatalogue = jest.fn();
const mockReadWork = jest.fn();
const mockJobAidWork = jest.fn();
const mockSourcePage = jest.fn();
const mockWrite = jest.fn((..._args: unknown[]) => { throw new Error('Read-only catalogue invoked a write'); });
const mockDocuments = jest.mocked(getCanonicalLibraryDocuments);
const mockMatters = jest.mocked(getEngineeringMatterDirectory);
let sessionGeneration = 1;
let queryClient: QueryClient;
let currentActor = 'actor-test';
let currentTenant = 'tenant-test';

type PreviewReading = NonNullable<DocumentReadingPreview['reading']>;

function previewReading(
  headline: string,
  overrides: Partial<PreviewReading> = {},
): PreviewReading {
  return {
    readingRunRef: `RUN-${headline}`,
    readingRevision: 2,
    headline,
    brief: `来源简明解读 ${headline}`,
    criticalConditions: [`关键条件 ${headline}`],
    limitations: [`认识限制 ${headline}`],
    sourceLimitations: [`来源限制 ${headline}`],
    sourceBinding: {
      original: {
        documentVersionId: 'DV-X',
        parseRunId: 'parse-1',
        parseRevision: 1,
        sourceArtifactId: 'art-1',
        sourceSha256: 'd'.repeat(64),
        sourceByteLength: 200,
      },
      semanticRevision: 1,
    },
    coverageStatus: 'COMPLETE_DELIVERY',
    deliveredUnitCount: 4,
    totalUnitCount: 4,
    savedAt: '2026-09-10T00:00:00.000Z',
    ...overrides,
  };
}

function sourceDocuments(): CanonicalLibraryDocumentsResponse {
  const response = libraryDocuments(['FAM-1']);
  response.items[0].versions = [
    {
      ...response.items[0].versions[0],
      documentReading: {
        status: 'AVAILABLE',
        reading: previewReading('现行版主题', {
          coverageStatus: 'PARTIAL_DELIVERY',
          deliveredUnitCount: 2,
          totalUnitCount: 5,
        }),
      },
    },
    {
      ...response.items[0].versions[1],
      documentReading: {
        status: 'AVAILABLE',
        reading: previewReading('旧版主题'),
      },
    },
  ];
  return response;
}

jest.mock('@client/src/api/engineering-matter', () => ({
  getEngineeringMatterDirectory: jest.fn(),
}));
jest.mock('@client/src/features/matter/SavedAssessmentReading', () => ({
  __esModule: true,
  default: ({ result }: { result: { content: { headline: string } } }) =>
    require('react').createElement('div', null, result.content.headline),
}));
jest.mock('@client/src/api/canonical-host', () => ({
  readEngineeringKnowledgeCatalogue: (...args: unknown[]) => mockCatalogue(...args),
  readEngineeringKnowledgeWork: (...args: unknown[]) => mockReadWork(...args),
  readJobAidAssessmentWork: (...args: unknown[]) => mockJobAidWork(...args),
  readDocumentVersionSourcePage: (...args: unknown[]) => mockSourcePage(...args),
  getCanonicalLibraryDocuments: jest.fn(),
  subscribeCanonicalHostClientSession: () => () => undefined,
  getCanonicalHostClientSessionGeneration: () => sessionGeneration,
  getCanonicalHostIdentityContext: async () => ({ tenantId: currentTenant, userId: currentActor }),
  requestOverallRegeneration: (...args: unknown[]) => mockWrite(...args),
  requestInitialAnalysisContinuation: (...args: unknown[]) => mockWrite(...args),
  referenceEngineeringIssue: (...args: unknown[]) => mockWrite(...args),
}));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/pages/KnowledgeLookupPage/knowledge-lookup.css', () => ({}));
jest.mock('@client/src/pages/KnowledgeLookupPage/knowledge-suite.css', () => ({}));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({
  useCurrentUserSession: () => ({ sessionGeneration, authenticationRequired: false, currentUser: { user_id: currentActor } }),
}));
jest.mock('@client/src/components/ui/dialog', () => {
  const Box = ({ children }: { children: import('react').ReactNode }) => require('react').createElement('div', null, children);
  return { Dialog: Box, DialogContent: Box, DialogHeader: Box, DialogTitle: Box, DialogDescription: Box };
});
jest.mock('@client/src/pages/WorkspaceHomePage/DocumentOriginalPreview', () => ({
  DocumentOriginalPreview: () => require('react').createElement('span', null, '原件入口夹具'),
}));
jest.mock('@client/src/features/matter/OverviewCorrectionNotices', () => ({
  __esModule: true,
  default: () => createElement('div'),
}));
jest.mock('@client/src/features/matter/ReferenceWorkNotices', () => ({
  __esModule: true,
  default: () => createElement('div'),
}));
jest.mock('@client/src/features/matter/OverviewSourceWork', () => ({
  __esModule: true,
  default: () => createElement('div'),
}));

const entry = (id: string, current = true, workRef = `WR-${id}`): EngineeringKnowledgeEntry => ({
  subjectKind: 'ENGINEERING_MATTER',
  subjectId: id,
  workRef,
  workRevision: current ? 3 : 2,
  current,
  headline: `主题 ${id}`,
  listBrief: `简明认识 ${id}`,
  createdAt: '2026-09-17T00:00:00.000Z',
  overviewStatus: 'CURRENT',
});
const workEntry = (id: string, workRef = `JAWR-${id}`): EngineeringKnowledgeEntry => ({
  ...entry(id, true, workRef), subjectKind: 'WORK_ITEM',
});

const page = (...entries: EngineeringKnowledgeEntry[]): EngineeringKnowledgePage => ({
  entries,
  nextCursor: null,
});

const read = (item: EngineeringKnowledgeEntry): EngineeringKnowledgeRead => ({
  entry: item,
  content: {
    overviewStatus: 'CURRENT',
    understanding: null,
    issues: [],
    evidence: [],
  } as EngineeringKnowledgeRead['content'],
  reading: {} as EngineeringKnowledgeRead['reading'],
});

let root: Root;
let router: ReturnType<typeof createMemoryRouter>;
let dom: InstanceType<typeof JSDOM>;
let container: HTMLElement;
const oldGlobals = new Map<string, PropertyDescriptor | undefined>();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done; reject = fail;
  });
  return { promise, resolve, reject };
}

async function settle(ms = 10) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function mount(search = '?kind=works') {
  router = createMemoryRouter(
    [
      { path: '/knowledge', element: createElement(KnowledgeLookupPage) },
      { path: '*', element: createElement('div') },
    ],
    { initialEntries: [`/knowledge${search}`] },
  );
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: queryClient }, createElement(RouterProvider, { router })));
  });
}

async function remount() {
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: queryClient }, createElement(RouterProvider, { router })));
  });
}

async function navigate(path: string) {
  await act(async () => {
    await router.navigate(path);
  });
}

beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test/' });
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    oldGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  container = dom.window.document.getElementById('root')!;
  sessionGeneration = 1;
  currentActor = 'actor-test'; currentTenant = 'tenant-test';
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  jest.clearAllMocks();
  mockCatalogue.mockResolvedValue(page(entry('A'), entry('B')));
  mockReadWork.mockImplementation((identity: { subjectId: string }) => Promise.resolve(read(entry(identity.subjectId))));
  mockJobAidWork.mockImplementation((id: string) => Promise.resolve({
    current: { workItemId: id, workRevisionRef: `JAWR-${id}` },
  }));
  mockDocuments.mockResolvedValue(sourceDocuments());
  mockMatters.mockResolvedValue({
    items: [], nextCursor: null, fileReadPerformed: false,
  });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  router?.dispose();
  queryClient.clear();
  dom.window.close();
  for (const [key, descriptor] of oldGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  oldGlobals.clear();
});

describe('knowledge catalogue identity and reading lifecycle', () => {
  it.each(['CURRENT', 'STALE', 'NOT_AVAILABLE'] as const)('does not infer WorkItem Overall coverage from saved root status %s', async (overviewStatus) => {
    const selected: EngineeringKnowledgeEntry = { ...entry('A'), subjectKind: 'WORK_ITEM', overviewStatus };
    const item = read(selected);
    item.content = { ...jobAidReadingFixture().current!.content, overviewStatus };
    mockCatalogue.mockResolvedValue(page(selected));
    mockReadWork.mockResolvedValue(item);
    await mount('?subjectKind=WORK_ITEM&subjectId=A&workRef=WR-A');
    await settle();
    const preview = container.querySelector<HTMLElement>('.knowledge-preview')!;
    expect(preview.textContent).toContain('这份问题分析尚无与该修订绑定的综合意见');
    expect(preview.querySelector('[aria-label="确切综合意见"]')).toBeNull();
    expect(preview.textContent).toContain('尚未确认构型，不得认定必须实施。');
    expect(preview.textContent).not.toContain('综合尚未覆盖。本页');
    expect(mockReadWork).toHaveBeenCalledTimes(1);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('reads actual saved judgment and conditions in place with no additional work read or write', async () => {
    const selected = entry('A', false, 'WR-A-old');
    const item = read(selected);
    item.content = jobAidReadingFixture().current!.content;
    mockCatalogue.mockResolvedValue(page(selected));
    mockReadWork.mockResolvedValue(item);
    await mount('?scope=HISTORICAL&subjectKind=ENGINEERING_MATTER&subjectId=A&workRef=WR-A-old&knowledgeIssueKey=issue-test&listY=55&articleY=77');
    await settle();
    const preview = container.querySelector<HTMLElement>('.knowledge-preview')!;
    expect(preview.textContent).toContain('尚未确认构型，不得认定必须实施。');
    for (const text of ['未按要求核实构型', '当前构型是什么？', '仅对构型 A', '不能替代有效性验证']) {
      const node = Array.from(preview.querySelectorAll('p')).find(node => node.textContent?.includes(text));
      expect(node).toBeDefined();
      expect(node?.closest('details')).toBeNull();
    }
    expect(preview.scrollTop).toBe(77);
    const before = router.state.location.search;
    const details = preview.querySelector<HTMLDetailsElement>('.wl-jobaid-evidence')!;
    await act(async () => { details.open = true; details.dispatchEvent(new dom.window.Event('toggle')); });
    expect(preview.textContent).toContain('仅适用于构型 A。');
    expect(router.state.location.search).toBe(before);
    expect(preview.scrollTop).toBe(77);
    expect(mockReadWork).toHaveBeenCalledTimes(1);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('deduplicates exact saved problems, shows their recorded state and opens them without generation', async () => {
    const item = read(entry('A'));
    const issue = jobAidReadingFixture().current!.content.issues[0];
    item.content.issues = [issue, structuredClone(issue), { ...structuredClone(issue), issueKey: 'another', question: '另一个问题' }];
    mockReadWork.mockResolvedValue(item);
    await mount('?subjectKind=ENGINEERING_MATTER&subjectId=A&workRef=WR-A');
    await settle();
    expect(container.querySelectorAll('.knowledge-issue-directory tbody tr')).toHaveLength(2);
    expect(container.textContent).toContain('条件待确认');
    expect(container.textContent).toContain('1 项待核');
    expect(container.querySelectorAll('[data-saved-issue-key]')).toHaveLength(2);
    const button = container.querySelector<HTMLButtonElement>('[data-issue-key="issue-test"] button')!;
    await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    expect(router.state.location.search).toContain('knowledgeIssueKey=issue-test');
    expect(container.querySelectorAll('[data-saved-issue-key]')).toHaveLength(1);
    expect(mockReadWork).toHaveBeenCalledTimes(1);
    const wiki = container.querySelector<HTMLAnchorElement>('.knowledge-actions a')!;
    const url = new URL(wiki.href);
    expect(url.pathname).toBe('/matters/A');
    expect(url.searchParams.get('workRef')).toBe('WR-A');
    const returned = knowledgeMatterReturnRoute(url.searchParams, 'A', 'WR-A')!;
    expect(new URL(returned, 'https://example.invalid').searchParams.get('knowledgeIssueKey')).toBe('issue-test');
    expect(knowledgeMatterReturnRoute(url.searchParams, 'B', 'WR-A')).toBeNull();
    expect(knowledgeMatterReturnRoute(url.searchParams, 'A', 'WR-B')).toBeNull();
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('preserves conflicting saved variants and clears a problem pin when switching works', async () => {
    const issue = jobAidReadingFixture().current!.content.issues[0];
    mockReadWork.mockImplementation((identity: { subjectId: string }) => Promise.resolve({ ...read(entry(identity.subjectId)),
      content: { ...read(entry(identity.subjectId)).content, issues: identity.subjectId === 'A' ? [issue, { ...structuredClone(issue), body: '另一份保存解释' }] : [] },
    }));
    await mount('?subjectKind=ENGINEERING_MATTER&subjectId=A&workRef=WR-A&knowledgeIssueKey=issue-test');
    await settle();
    expect(container.querySelectorAll('.knowledge-issue-directory tbody tr')).toHaveLength(1);
    expect(container.querySelectorAll('[data-saved-issue-key]')).toHaveLength(2);
    expect(container.textContent).toContain('2 份不同保存内容');
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.knowledge-hit'));
    await act(async () => buttons[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    await settle();
    expect(router.state.location.search).not.toContain('knowledgeIssueKey');
    expect(container.querySelector('.knowledge-issue-directory')).toBeNull();
    expect(mockWrite).not.toHaveBeenCalled();
  });
  it('reads the catalogue and automatically selects and reads the first entry without a query', async () => {
    await mount();
    await settle();

    expect(mockCatalogue).toHaveBeenCalledWith('','CURRENT', undefined, expect.anything());
    expect(mockReadWork).toHaveBeenCalledWith(
      { subjectKind: 'ENGINEERING_MATTER', subjectId: 'A', workRef: 'WR-A' },
      expect.anything(),
    );
    expect(router.state.location.search).toContain('subjectId=A');
    expect(container.textContent).toContain('主题 A');
  });

  it('shows the exact saved Overall briefly and keeps its detail folded', async () => {
    const item = workEntry('WI-TARGET');
    item.listBrief = '综合短意见';
    const knowledge = read(item);
    knowledge.overall = {
      status: 'CANDIDATE_ONLY',
      readingResult: {
        resultRef: 'OVERALL-1', resultRevision: 1,
        scope: { kind: 'WORK_ITEM', workItemId: 'WI-TARGET', documentVersionId: 'DV-1' },
        content: { schemaVersion: 'wiselink.3_1.assessment_reading.v1',
          headline: '综合主题', listBrief: '综合短意见', lead: '完整综合概览',
          claims: [], decisiveClaimIds: [] },
        evidence: [], candidateOnly: true,
      },
    };
    mockReadWork.mockResolvedValue(knowledge);
    await mount('?subjectKind=WORK_ITEM&subjectId=WI-TARGET&workRef=JAWR-WI-TARGET');
    await settle();
    const overall = container.querySelector('[aria-label="确切综合意见"]')!;
    expect(overall.textContent).toContain('综合短意见');
    expect(overall.querySelector('details')?.open).toBe(false);
    expect(container.querySelector('.knowledge-preview .article-lead')).toBeNull();
    expect(overall.querySelector('p')?.textContent).toBe('综合短意见');
    expect(container.querySelector('.knowledge-preview')?.textContent)
      .not.toContain('尚无与该修订绑定的综合意见');
  });

  it('opens the exact saved WorkItem from a deep link even when the catalogue starts with an older matter', async () => {
    mockReadWork.mockImplementation((identity: EngineeringKnowledgeEntry) =>
      Promise.resolve(read(identity.subjectKind === 'WORK_ITEM'
        ? workEntry(identity.subjectId, identity.workRef) : entry(identity.subjectId))));
    await mount('?workItemId=WI-TARGET');
    await settle();
    await settle();

    expect(mockJobAidWork).toHaveBeenCalledWith('WI-TARGET', expect.anything());
    expect(mockReadWork).toHaveBeenCalledWith(
      { subjectKind: 'WORK_ITEM', subjectId: 'WI-TARGET', workRef: 'JAWR-WI-TARGET' },
      expect.anything(),
    );
    expect(router.state.location.search).toContain('subjectId=WI-TARGET');
    expect(router.state.location.search).not.toContain('workItemId=');
    expect(container.querySelector('.knowledge-preview')?.textContent).toContain('主题 WI-TARGET');
  });

  it('keeps an exact historical work pin instead of replacing it with the current WorkItem revision', async () => {
    await mount('?workItemId=WI-TARGET&subjectKind=WORK_ITEM&subjectId=WI-TARGET&workRef=JAWR-OLD');
    await settle();

    expect(mockJobAidWork).not.toHaveBeenCalled();
    expect(mockReadWork).toHaveBeenCalledWith(
      { subjectKind: 'WORK_ITEM', subjectId: 'WI-TARGET', workRef: 'JAWR-OLD' },
      expect.anything(),
    );
    expect(router.state.location.search).toContain('workRef=JAWR-OLD');
  });

  it('does not select unrelated catalogue work when a requested WorkItem has no saved revision', async () => {
    mockJobAidWork.mockResolvedValue({ current: null });
    await mount('?workItemId=WI-EMPTY');
    await settle();

    expect(mockReadWork).not.toHaveBeenCalled();
    expect(container.querySelector('.knowledge-preview')?.textContent).toContain('尚无可读的已保存工作');
    expect(router.state.location.search).toBe('?workItemId=WI-EMPTY');
  });

  it('does not let a late WorkItem lookup replace a newer deep link', async () => {
    const pendingA = deferred<{ current: { workItemId: string; workRevisionRef: string } }>();
    const pendingB = deferred<{ current: { workItemId: string; workRevisionRef: string } }>();
    mockJobAidWork.mockImplementation((id: string) =>
      id === 'WI-A' ? pendingA.promise : pendingB.promise);
    mockReadWork.mockImplementation((identity: EngineeringKnowledgeEntry) =>
      Promise.resolve(read(workEntry(identity.subjectId, identity.workRef))));
    await mount('?workItemId=WI-A');
    await settle();
    await navigate('/knowledge?workItemId=WI-B');
    await act(async () => pendingA.resolve({
      current: { workItemId: 'WI-A', workRevisionRef: 'JAWR-WI-A' },
    }));
    await settle();
    expect(router.state.location.search).toBe('?workItemId=WI-B');
    expect(mockReadWork).not.toHaveBeenCalled();
    await act(async () => pendingB.resolve({
      current: { workItemId: 'WI-B', workRevisionRef: 'JAWR-WI-B' },
    }));
    await settle();
    await settle();
    expect(router.state.location.search).toContain('subjectId=WI-B');
    expect(mockReadWork).toHaveBeenCalledWith(
      { subjectKind: 'WORK_ITEM', subjectId: 'WI-B', workRef: 'JAWR-WI-B' },
      expect.anything(),
    );
  });

  it('rejects a duplicate WorkItem deep link without selecting catalogue content', async () => {
    await mount('?workItemId=WI-A&workItemId=WI-B');
    await settle();
    expect(mockJobAidWork).not.toHaveBeenCalled();
    expect(mockReadWork).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('身份无效');
  });

  it.each([
    '?subjectKind=ENGINEERING_MATTER&subjectId=A',
    '?subjectKind=ENGINEERING_MATTER&subjectId=A&workRef=WR-A&workRef=WR-B',
  ])('does not auto-select or read with an incomplete or duplicate work identity: %s', async (search) => {
    await mount(search);
    await settle();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('身份不完整');
    expect(mockReadWork).not.toHaveBeenCalled();
    expect(router.state.location.search).toBe(search);
  });

  it('does not let a late A response replace the selected B article', async () => {
    const pendingA = deferred<EngineeringKnowledgeRead>();
    const pendingB = deferred<EngineeringKnowledgeRead>();
    mockReadWork.mockImplementation((identity: { subjectId: string }) =>
      identity.subjectId === 'A' ? pendingA.promise : pendingB.promise,
    );
    await mount();
    await settle();
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.knowledge-hit'));
    await act(async () => buttons[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    await act(async () => pendingA.resolve(read(entry('A'))));
    await settle();
    expect(container.querySelector('.knowledge-preview')?.textContent).not.toContain('主题 A');
    await act(async () => pendingB.resolve(read(entry('B'))));
    await settle();
    expect(container.textContent).toContain('主题 B');
    expect(router.state.location.search).toContain('subjectId=B');
  });

  it('clears A article scroll before selecting B and does not carry articleY into B', async () => {
    await mount();
    await settle();
    const article = container.querySelector<HTMLElement>('.knowledge-preview')!;
    Object.defineProperty(article, 'scrollTop', { configurable: true, writable: true, value: 123 });
    await act(async () => article.dispatchEvent(new dom.window.Event('scroll', { bubbles: true })));
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.knowledge-hit'));
    await act(async () => buttons[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    expect(router.state.location.search).not.toContain('articleY=');
    expect(router.state.location.search).toContain('subjectId=B');
  });

  it('clears the selected article and scroll pins when moving to the next catalogue page', async () => {
    mockCatalogue.mockImplementation((_query: string, _scope: EngineeringKnowledgeScope, after?: string) =>
      Promise.resolve(after === 'CURSOR-2'
        ? page(entry('C'))
        : { ...page(entry('A')), nextCursor: 'CURSOR-2' }),
    );
    await mount();
    await settle();
    const article = container.querySelector<HTMLElement>('.knowledge-preview')!;
    Object.defineProperty(article, 'scrollTop', { configurable: true, writable: true, value: 77 });
    await act(async () => article.dispatchEvent(new dom.window.Event('scroll', { bubbles: true })));
    const next = Array.from(container.querySelectorAll<HTMLButtonElement>('.knowledge-pagination button'))
      .find((button) => button.textContent?.includes('下一批'))!;
    await act(async () => next.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    expect(router.state.location.search).toContain('after=CURSOR-2');
    expect(router.state.location.search).not.toContain('articleY=');
    expect(router.state.location.search).not.toContain('workRef=WR-A');
    await settle();
    expect(router.state.location.search).toContain('subjectId=C');
    expect(container.textContent).toContain('主题 C');
  });

  it('keeps selection and scope in the URL and rereads the exact identity after remount navigation', async () => {
    await mount('?query=hydraulic&subjectKind=ENGINEERING_MATTER&subjectId=A&workRef=WR-A&scope=CURRENT');
    await settle();
    const scope = container.querySelector<HTMLSelectElement>('[aria-label="知识版本范围"]')!;
    await act(async () => {
      scope.value = 'ALL';
      scope.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
    expect(router.state.location.search).toContain('query=hydraulic');
    expect(router.state.location.search).toContain('scope=ALL');
    expect(router.state.location.search).not.toContain('workRef=WR-A');
    await navigate('/knowledge?query=hydraulic&scope=ALL&subjectKind=ENGINEERING_MATTER&subjectId=A&workRef=WR-A');
    await settle();
    expect(mockReadWork).toHaveBeenLastCalledWith(
      { subjectKind: 'ENGINEERING_MATTER', subjectId: 'A', workRef: 'WR-A' },
      expect.anything(),
    );
  });

  it('clears old article content when the authenticated session generation changes', async () => {
    await mount();
    await settle();
    expect(container.textContent).toContain('主题 A');
    const pending = deferred<EngineeringKnowledgePage>();
    mockCatalogue.mockReturnValueOnce(pending.promise);
    mockReadWork.mockImplementation((identity: { subjectId: string }) =>
      identity.subjectId === 'C' ? Promise.resolve(read(entry('C'))) : new Promise(() => undefined),
    );
    sessionGeneration = 2;
    await remount();
    await settle();
    expect(container.querySelector('.knowledge-preview')?.textContent).not.toContain('主题 A');
    await act(async () => pending.resolve(page(entry('C'))));
    await settle();
    expect(container.textContent).toContain('主题 C');
  });
});

describe('knowledge source documents reading', () => {
  it('defaults to the document Wiki and shows registered matters by exact work item', async () => {
    const related: EngineeringMatterDirectoryResponse = {
      items: [{
        matterId: 'MAT-1', title: '液压故障事项', primaryWorkItemId: 'WI-NEW',
        createdAt: '2026-09-17T00:00:00.000Z', updatedAt: '2026-09-18T00:00:00.000Z',
        currentMatterRevisionId: 'MW-1', workingRevision: 1,
        result: null, overallStatus: 'NOT_AVAILABLE',
      }],
      nextCursor: null, fileReadPerformed: false,
    };
    mockMatters.mockResolvedValue(related);
    await mount('?');
    await settle();
    expect(mockCatalogue).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-label="文档 Wiki"]')?.textContent)
      .toContain('现行版主题');
    expect(container.querySelector('.knowledge-source[aria-current="true"]')?.textContent)
      .toContain('现行版主题');
    expect(mockMatters).toHaveBeenCalledWith(
      { workItemId: 'WI-NEW', limit: 24 }, expect.anything(),
    );
    expect(container.querySelector<HTMLAnchorElement>('a[href="/matters/MAT-1"]')
      ?.textContent).toContain('液压故障事项');
    await act(async () => container.querySelector<HTMLButtonElement>(
      '.knowledge-actions button',
    )!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    const returned = new URLSearchParams(router.state.location.search);
    expect(new URLSearchParams(returned.get('returnKnowledgeQuery') ?? '')
      .get('documentVersionId')).toBe('DV-FAM-1-2');
  });

  it('lists matters by matter ID and opens the existing matter Wiki', async () => {
    mockMatters.mockResolvedValue({
      items: [{ matterId: 'MAT-2', title: '真实事项', primaryWorkItemId: null,
        createdAt: '2026-09-17T00:00:00.000Z', updatedAt: '2026-09-18T00:00:00.000Z',
        currentMatterRevisionId: 'MW-2', workingRevision: 3,
        result: null }],
      nextCursor: null, fileReadPerformed: false,
    });
    await mount('?kind=matters');
    await settle();
    expect(container.querySelector('[aria-label="工程事项目录"]')?.textContent)
      .toContain('真实事项');
    expect(container.querySelector<HTMLAnchorElement>('a[href="/matters/MAT-2"]')
      ?.textContent).toContain('打开事项 Wiki');
  });

  it('shows the current version and expandable family history, each with its own saved reading', async () => {
    mockDocuments.mockResolvedValue(sourceDocuments());
    await mount('?kind=sources');
    await settle();
    expect(container.textContent).toContain('现行版主题');
    expect(container.textContent).toContain('部分覆盖：已送达 2/5');
    expect(container.textContent).not.toContain('旧版主题');
    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="展开版本历史"]',
    )!;
    await act(async () =>
      toggle.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })),
    );
    expect(container.textContent).toContain('旧版主题');
    expect(container.textContent).toContain('历史版本');
  });

  it('expands key conditions and limitations per version without leaving the list', async () => {
    mockDocuments.mockResolvedValue(sourceDocuments());
    await mount('?kind=sources');
    await settle();
    const toggle = container.querySelector<HTMLButtonElement>(
      '.knowledge-source-conditions-toggle',
    )!;
    expect(toggle.textContent).toContain('关键条件与阅读限制（3）');
    await act(async () =>
      toggle.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })),
    );
    expect(container.textContent).toContain('认识限制 现行版主题');
    expect(container.textContent).toContain('来源限制 现行版主题');
    expect(router.state.location.pathname).toBe('/knowledge');
  });

  it('reads a historical document version in the Wiki before close reading', async () => {
    mockDocuments.mockResolvedValue(sourceDocuments());
    await mount('?kind=sources');
    await settle();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="展开版本历史"]')!
        .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })),
    );
    const historicalRow = container.querySelector<HTMLElement>(
      '.knowledge-source-history',
    )!;
    await act(async () =>
      historicalRow.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true }),
      ),
    );
    expect(router.state.location.pathname).toBe('/knowledge');
    expect(router.state.location.search).toContain('documentVersionId=DV-FAM-1-1');
    expect(container.querySelector('.knowledge-source-history[aria-current="true"]')?.textContent)
      .toContain('旧版主题');
    expect(container.querySelector('[aria-label="文档 Wiki"]')?.textContent).toContain('旧版主题');
    await act(async () =>
      container.querySelector<HTMLButtonElement>('.knowledge-actions button')!
        .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })),
    );
    expect(router.state.location.pathname).toBe('/document-versions/DV-FAM-1-1');
    expect(router.state.location.search).toContain(
      'returnDocumentVersionId=DV-FAM-1-1',
    );
    expect(router.state.location.search).toContain('returnKnowledgeQuery=');
    const returned = readingReturnTarget(new URLSearchParams(router.state.location.search), 'DV-FAM-1-1');
    expect(new URL(returned!.route, 'https://example.invalid').searchParams.get('kind')).toBe('sources');
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('never shows a stale reading and keeps history expandable without a current version', async () => {
    const response = libraryDocuments(['FAM-2']);
    const [newer, older] = response.items[0].versions;
    response.items[0].versions = [
      {
        ...newer,
        selectedVersionIsCurrent: false,
        documentReading: {
          status: 'SOURCE_CHANGED',
          reading: previewReading('过期主题'),
        },
      },
      { ...older, selectedVersionIsCurrent: false },
    ];
    mockDocuments.mockResolvedValue(response);
    await mount('?kind=sources');
    await settle();
    expect(container.textContent).toContain('当前版本不可见');
    expect(container.textContent).not.toContain('过期主题');
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="展开版本历史"]')!
        .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })),
    );
    expect(container.textContent).toContain('来源已变化');
    expect(container.textContent).toContain('当前接口未返回该版本解读');
    expect(container.textContent).not.toContain('过期主题');
    expect(container.textContent).not.toContain('来源简明解读 过期主题');
  });
});

test('reuses the exact saved knowledge and catalogue on a fresh same-session route return', async () => {
  await mount('?subjectKind=ENGINEERING_MATTER&subjectId=A&workRef=WR-A');
  await settle();
  expect(container.querySelector('.knowledge-preview')?.textContent).toContain('主题 A');
  await navigate('/library');
  await navigate('/knowledge?subjectKind=ENGINEERING_MATTER&subjectId=A&workRef=WR-A');
  await settle();
  expect(container.querySelector('.knowledge-preview')?.textContent).toContain('主题 A');
  expect(mockCatalogue).toHaveBeenCalledTimes(1);
  expect(mockReadWork).toHaveBeenCalledTimes(1);
});

test('a stale saved work is withheld during refresh and a denial replaces it across remounts', async () => {
  const route = '/knowledge?subjectKind=ENGINEERING_MATTER&subjectId=A&workRef=WR-A';
  await mount(route.slice('/knowledge'.length)); await settle();
  const rejection = deferred<EngineeringKnowledgeRead>();
  mockReadWork.mockReturnValueOnce(rejection.promise);
  await act(async () => { void queryClient.invalidateQueries({ predicate: query => query.queryKey.includes('work') }); });
  await settle();
  expect(container.querySelector('.knowledge-preview')?.textContent).not.toContain('主题 A');
  // Explicit rejection, without changing the selected saved identity.
  const failure = Object.assign(new Error('source access revoked'), { statusCode: 403 });
  await act(async () => rejection.reject(failure));
  await settle();
  expect(container.querySelector('.knowledge-preview')?.textContent).toContain('source access revoked');
  await navigate('/library'); await navigate(route); await settle();
  expect(mockReadWork).toHaveBeenCalledTimes(2);
  expect(container.querySelector('.knowledge-preview')?.textContent).not.toContain('主题 A');
  mockReadWork.mockResolvedValueOnce(read(entry('A')));
  const retryButton = [...container.querySelectorAll('button')].find(button => button.textContent === '重试')!;
  await act(async () => retryButton.click()); await settle();
  expect(mockReadWork).toHaveBeenCalledTimes(3);
  expect(container.querySelector('.knowledge-preview')?.textContent).toContain('主题 A');
});

test('different saved revisions are not replaced by a fresh current-work cache', async () => {
  await mount('?subjectKind=ENGINEERING_MATTER&subjectId=A&workRef=WR-A'); await settle();
  mockReadWork.mockResolvedValueOnce(read({ ...entry('A'), workRef: 'WR-OLD', headline: '历史完整正文' }));
  await navigate('/knowledge?subjectKind=ENGINEERING_MATTER&subjectId=A&workRef=WR-OLD'); await settle();
  expect(mockReadWork).toHaveBeenLastCalledWith({ subjectKind: 'ENGINEERING_MATTER', subjectId: 'A', workRef: 'WR-OLD' }, expect.anything());
  expect(container.querySelector('.knowledge-preview')?.textContent).toContain('历史完整正文');
});

test('actor and tenant scope changes cannot reuse another account saved body', async () => {
  await mount('?subjectKind=ENGINEERING_MATTER&subjectId=A&workRef=WR-A'); await settle();
  currentActor = 'actor-other'; currentTenant = 'tenant-other';
  const pending = deferred<EngineeringKnowledgeRead>(); mockReadWork.mockReturnValueOnce(pending.promise);
  await remount(); await settle();
  expect(container.querySelector('.knowledge-preview')?.textContent).not.toContain('主题 A');
  expect(mockReadWork).toHaveBeenCalledTimes(2);
  await act(async () => pending.resolve(read({ ...entry('A'), headline: '另一账户的可见正文' }))); await settle();
  expect(container.querySelector('.knowledge-preview')?.textContent).toContain('另一账户的可见正文');
});

test('the existing session boundary removes inactive knowledge resources', async () => {
  await mount('?subjectKind=ENGINEERING_MATTER&subjectId=A&workRef=WR-A'); await settle();
  expect(queryClient.getQueryCache().findAll({ queryKey: ENGINEERING_MATTER_QUERY_ROOT }).length).toBeGreaterThan(0);
  await navigate('/library'); sessionGeneration++;
  await clearEngineeringMatterQueries(queryClient);
  expect(queryClient.getQueryCache().findAll({ queryKey: ENGINEERING_MATTER_QUERY_ROOT })).toHaveLength(0);
});

test('expired knowledge resources reread instead of treating retained data as fresh forever', async () => {
  const route = '/knowledge?subjectKind=ENGINEERING_MATTER&subjectId=A&workRef=WR-A';
  await mount(route.slice('/knowledge'.length)); await settle();
  await navigate('/library');
  for (const cached of queryClient.getQueryCache().findAll({ predicate: item => item.queryKey.includes('knowledge') })) {
    queryClient.setQueryData(cached.queryKey, cached.state.data, { updatedAt: Date.now() - 31_000 });
  }
  await navigate(route); await settle();
  expect(mockCatalogue).toHaveBeenCalledTimes(2);
  expect(mockReadWork).toHaveBeenCalledTimes(2);
  expect(container.querySelector('.knowledge-preview')?.textContent).toContain('主题 A');
});

test('clearing an invalid pin can select the first authorized cached catalogue entry', async () => {
  await mount('?subjectId=A'); await settle();
  expect(mockReadWork).not.toHaveBeenCalled();
  await navigate('/knowledge?kind=works'); await settle();
  expect(router.state.location.search).toContain('workRef=WR-A');
  expect(mockCatalogue).toHaveBeenCalledTimes(1);
  expect(mockReadWork).toHaveBeenCalledTimes(1);
});


test('refresh within staleTime withholds the saved body and full saved brief remains available', async () => {
  const saved = read(entry('A'));
  saved.entry.listBrief = '已保存简明意见。' + '中段文字。'.repeat(100) + 'ONLY_IF_TAIL_CONDITION';
  mockReadWork.mockResolvedValueOnce(saved);
  await mount('?subjectKind=ENGINEERING_MATTER&subjectId=A&workRef=WR-A'); await settle();
  expect(container.querySelector('.knowledge-preview')?.textContent).toContain('ONLY_IF_TAIL_CONDITION');
  const pending = deferred<EngineeringKnowledgeRead>(); mockReadWork.mockReturnValueOnce(pending.promise);
  await act(async () => { void queryClient.refetchQueries({ predicate: query => query.queryKey.includes('work') }); });
  await settle();
  expect(container.querySelector('.knowledge-preview')?.textContent).not.toContain('主题 A');
  await act(async () => pending.resolve(saved)); await settle();
  expect(container.querySelector('.knowledge-preview')?.textContent).toContain('ONLY_IF_TAIL_CONDITION');
});

test('the real source dialog is removed on pending saved-work refresh and ignores its late text', async () => {
  const saved = read(entry('A'));
  const fixture = jobAidReadingFixture().current!.content;
  saved.content = fixture;
  const evidence = fixture.evidence.find(item => item.kind === 'DOCUMENT_PASSAGE')!;
  if (evidence.kind !== 'DOCUMENT_PASSAGE') throw new Error('Passage fixture required');
  saved.content.understanding = `Saved source [[${evidence.evidenceRef}]]`;
  mockReadWork.mockResolvedValueOnce(saved);
  const source = deferred<import('@shared/document-source-reading.interface').DocumentSourceReading>();
  mockSourcePage.mockReturnValueOnce(source.promise);
  await mount('?subjectKind=ENGINEERING_MATTER&subjectId=A&workRef=WR-A'); await settle();
  const button = [...container.querySelectorAll('button')].find(item => item.textContent?.includes('前往这份文档的原文'));
  expect(button).toBeDefined();
  await act(async () => button!.click()); await settle();
  expect(container.textContent).toContain('事项材料原文');
  expect(mockSourcePage).toHaveBeenCalledTimes(1);
  const pending = deferred<EngineeringKnowledgeRead>(); mockReadWork.mockReturnValueOnce(pending.promise);
  await act(async () => { void queryClient.refetchQueries({ predicate: query => query.queryKey.includes('work') }); }); await settle();
  expect(container.textContent).not.toContain('事项材料原文');
  await act(async () => source.resolve({ documentVersionId:evidence.documentVersionId,
    sourceSha256:'a'.repeat(64), sourceByteLength:100, pageCount:1, extractionScope:'NATIVE_TEXT_LAYER',
    pages:[{page:1,sourceRefId:'source-ref-test',text:'LATE_SOURCE_TEXT',textLayerStatus:'PRESENT',visualContentVerified:false,evidence:null}] }));
  await act(async () => pending.reject(Object.assign(new Error('revoked'),{statusCode:403}))); await settle();
  expect(container.textContent).not.toContain('LATE_SOURCE_TEXT');
  expect(container.textContent).not.toContain('事项材料原文');
});

test('same actor with a new tenant/session cannot display or accept late old-tenant knowledge', async () => {
  const old = deferred<EngineeringKnowledgeRead>(); mockReadWork.mockReturnValueOnce(old.promise);
  await mount('?subjectKind=ENGINEERING_MATTER&subjectId=A&workRef=WR-A'); await settle();
  currentTenant = 'tenant-other'; sessionGeneration++;
  const pending = deferred<EngineeringKnowledgeRead>(); mockReadWork.mockReturnValueOnce(pending.promise);
  await remount(); await settle();
  await act(async () => old.resolve(read({ ...entry('A'),headline:'OLD_TENANT_BODY' }))); await settle();
  expect(container.textContent).not.toContain('OLD_TENANT_BODY');
  await act(async () => pending.resolve(read({ ...entry('A'),headline:'NEW_TENANT_BODY' }))); await settle();
  expect(container.textContent).toContain('NEW_TENANT_BODY');
  const keys=queryClient.getQueryCache().getAll().filter(query=>query.queryKey.includes('knowledge')).map(query=>query.queryKey);
  expect(keys.some(key=>key.includes('tenant-other')&&key.includes(2))).toBe(true);
  expect(mockWrite).not.toHaveBeenCalled();
});

test('fresh manual refetch removes old knowledge before the response is received', async () => {
  await mount('?subjectKind=ENGINEERING_MATTER&subjectId=A&workRef=WR-A'); await settle();
  const pending=deferred<EngineeringKnowledgeRead>();mockReadWork.mockReturnValueOnce(pending.promise);
  await act(async()=>{void queryClient.refetchQueries({predicate:query=>query.queryKey.includes('work')});});await settle();
  expect(mockReadWork).toHaveBeenCalledTimes(2);
  expect(container.querySelector('.knowledge-preview')?.textContent).not.toContain('主题 A');
  await act(async()=>pending.reject(Object.assign(new Error('read unavailable'),{statusCode:404})));await settle();
  expect(container.querySelector('.knowledge-preview')?.textContent).not.toContain('主题 A');
});


test('a tenant-only identity refresh for the same actor and session rejects a late old-tenant response', async () => {
  const old=deferred<EngineeringKnowledgeRead>();mockReadWork.mockReturnValueOnce(old.promise);
  await mount('?subjectKind=ENGINEERING_MATTER&subjectId=A&workRef=WR-A');await settle();
  const pending=deferred<EngineeringKnowledgeRead>();mockReadWork.mockReturnValueOnce(pending.promise);
  currentTenant='tenant-only-new';
  await act(async()=>{void queryClient.refetchQueries({predicate:query=>query.queryKey.includes('identity')});});await settle();
  expect(mockReadWork).toHaveBeenCalledTimes(2);
  expect(sessionGeneration).toBe(1);expect(currentActor).toBe('actor-test');
  await act(async()=>old.resolve(read({...entry('A'),headline:'OLD_TENANT_RESPONSE'})));await settle();
  expect(container.querySelector('.knowledge-preview')?.textContent).not.toContain('OLD_TENANT_RESPONSE');
  await act(async()=>pending.resolve(read({...entry('A'),headline:'TENANT_ONLY_NEW_RESPONSE'})));await settle();
  expect(container.querySelector('.knowledge-preview')?.textContent).toContain('TENANT_ONLY_NEW_RESPONSE');
  const keys=queryClient.getQueryCache().getAll().filter(query=>query.queryKey.includes('work')).map(query=>query.queryKey);
  expect(keys.some(key=>key.includes('tenant-only-new')&&key.includes('actor-test')&&key.includes(1))).toBe(true);
  expect(mockWrite).not.toHaveBeenCalled();
});
