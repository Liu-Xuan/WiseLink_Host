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
import type { CanonicalLibraryDocumentsResponse } from '@shared/api.interface';
import type { DocumentReadingPreview } from '@shared/document-reading.interface';
import { getCanonicalLibraryDocuments } from '@client/src/api/canonical-host';
import { clearEngineeringMatterQueries, ENGINEERING_MATTER_QUERY_ROOT } from '@client/src/features/matter/useEngineeringMatter';
import KnowledgeLookupPage from '@client/src/pages/KnowledgeLookupPage/KnowledgeLookupPage';
import { libraryDocuments } from './fixtures/canonical-library';

const { JSDOM } = require('jsdom');

const mockCatalogue = jest.fn();
const mockReadWork = jest.fn();
const mockDocuments = jest.mocked(getCanonicalLibraryDocuments);
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

jest.mock('@client/src/api/engineering-matter', () => ({}));
jest.mock('@client/src/api/canonical-host', () => ({
  readEngineeringKnowledgeCatalogue: (...args: unknown[]) => mockCatalogue(...args),
  readEngineeringKnowledgeWork: (...args: unknown[]) => mockReadWork(...args),
  getCanonicalLibraryDocuments: jest.fn(),
  subscribeCanonicalHostClientSession: () => () => undefined,
  getCanonicalHostClientSessionGeneration: () => sessionGeneration,
  getCanonicalHostIdentityContext: async () => ({ tenantId: currentTenant, userId: currentActor }),
}));
jest.mock('@client/src/pages/KnowledgeLookupPage/knowledge-lookup.css', () => ({}));
jest.mock('@client/src/pages/KnowledgeLookupPage/knowledge-suite.css', () => ({}));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({
  useCurrentUserSession: () => ({ sessionGeneration, authenticationRequired: false, currentUser: { user_id: currentActor } }),
}));
jest.mock('@client/src/features/matter/EngineeringIssueBody', () => ({
  __esModule: true,
  default: () => createElement('div', { 'data-testid': 'issue-body' }),
}));
jest.mock('@client/src/pages/DocumentParsingPage/JobAidIssueArticle', () => ({
  JobAidIssueArticle: () => createElement('div', { 'data-testid': 'issue-article' }),
}));
jest.mock('@client/src/features/matter/MatterDocumentSourceDialog', () => ({
  __esModule: true,
  default: () => createElement('div'),
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

async function mount(search = '') {
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

  it('opens the exact historical document version for close reading', async () => {
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
    expect(router.state.location.pathname).toBe('/document-versions/DV-FAM-1-1');
    expect(router.state.location.search).toContain(
      'returnDocumentVersionId=DV-FAM-1-1',
    );
    expect(router.state.location.search).toContain('returnKnowledgeQuery=');
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
  await navigate('/knowledge'); await settle();
  expect(router.state.location.search).toContain('workRef=WR-A');
  expect(mockCatalogue).toHaveBeenCalledTimes(1);
  expect(mockReadWork).toHaveBeenCalledTimes(1);
});
