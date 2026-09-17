import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type {
  EngineeringKnowledgeEntry,
  EngineeringKnowledgePage,
  EngineeringKnowledgeRead,
  EngineeringKnowledgeScope,
} from '@shared/engineering-issue-search.interface';
import KnowledgeLookupPage from '@client/src/pages/KnowledgeLookupPage/KnowledgeLookupPage';

const { JSDOM } = require('jsdom');

const mockCatalogue = jest.fn();
const mockReadWork = jest.fn();
let sessionGeneration = 1;

jest.mock('@client/src/api/canonical-host', () => ({
  readEngineeringKnowledgeCatalogue: (...args: unknown[]) => mockCatalogue(...args),
  readEngineeringKnowledgeWork: (...args: unknown[]) => mockReadWork(...args),
  getCanonicalLibraryDocuments: jest.fn(),
}));
jest.mock('@client/src/pages/KnowledgeLookupPage/knowledge-lookup.css', () => ({}));
jest.mock('@client/src/pages/KnowledgeLookupPage/knowledge-suite.css', () => ({}));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({
  useCurrentUserSession: () => ({ sessionGeneration, authenticationRequired: false }),
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
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function settle(ms = 10) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function mount(search = '') {
  router = createMemoryRouter(
    [{ path: '/knowledge', element: createElement(KnowledgeLookupPage) }],
    { initialEntries: [`/knowledge${search}`] },
  );
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(RouterProvider, { router }));
  });
}

async function remount() {
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(RouterProvider, { router }));
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
  jest.clearAllMocks();
  mockCatalogue.mockResolvedValue(page(entry('A'), entry('B')));
  mockReadWork.mockImplementation((identity: { subjectId: string }) => Promise.resolve(read(entry(identity.subjectId))));
});

afterEach(async () => {
  await act(async () => root?.unmount());
  router?.dispose();
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
