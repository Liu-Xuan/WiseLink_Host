import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, Link, RouterProvider, useSearchParams } from 'react-router-dom';
import { JSDOM } from 'jsdom';
import { getCanonicalLibraryDirectory } from '@client/src/api/canonical-host';
import { LibrarySourceDirectoryPane } from '@client/src/pages/WorkspaceHomePage/LibrarySourceDirectoryPane';
import { LibraryPaneScrollProvider, useLibraryPaneScroll } from '@client/src/pages/WorkspaceHomePage/useLibraryPaneScroll';
import { DocumentVersionLink } from '@client/src/pages/WorkspaceHomePage/DocumentVersionLink';
import { libraryReadingParams, libraryReadingScope, readingReturnTarget } from '@client/src/features/matter/reading-return';
import { useLibraryViewState } from '@client/src/pages/WorkspaceHomePage/useLibraryViewState';
import type { CanonicalLibraryDirectoryResponse } from '@shared/library-directory.interface';
import { documentGraphReadingParams } from '@client/src/pages/RelationGraphPage/suite-graph-return';
import { libraryFamily } from './fixtures/canonical-library';

jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalLibraryDirectory: jest.fn(),
  getCanonicalHostClientSessionGeneration: () => generation,
  subscribeCanonicalHostClientSession: () => () => undefined,
}));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));

const family = libraryFamily('return-family');
const version = family.versions[1];
const models = '["737-800","737-900"]';
const original = new URLSearchParams({ mode: 'document', search: 'FTD45',
  familyId: family.familyId, selectedDocumentVersionId: version.documentVersionId,
  expandedFamilyIds: family.familyId, listY: '1058', quicklookY: '81',
  aircraftModels: models, ata2: '32', ata4: '32-10' });
let generation = 1;

function Page() {
  const [params, setParams] = useSearchParams();
  const [session, setSession] = useState(generation);
  const [refresh, setRefresh] = useState(0);
  const [authenticationRequired, setAuthenticationRequired] = useState(false);
  const viewState = useLibraryViewState(params, session);
  const document = viewState.viewParams('document');
  const list = useLibraryPaneScroll<HTMLDivElement>('listY', true, session);
  const detail = useLibraryPaneScroll<HTMLDivElement>('quicklookY', true, session);
  return createElement('section', null,
    createElement('button', { id: 'refresh', onClick: () => setRefresh(value => value + 1) }, '刷新目录'),
    createElement('button', { id: 'session', onClick: () => { generation++; setSession(generation); } }, '切换会话'),
    createElement('button', { id: 'authentication', onClick: () => setAuthenticationRequired(true) }, '重新登录'),
    createElement('button', { id: 'matter', onClick: () => setParams(viewState.switchParams('matter')) }, '工程事项'),
    createElement('button', { id: 'document', onClick: () => setParams(viewState.switchParams('document')) }, '工程文档'),
    createElement(LibrarySourceDirectoryPane, { search: document.get('search') ?? '',
      filters: { ata2: document.get('ata2') ?? '', ata4: document.get('ata4') ?? '',
        aircraftModels: document.get('aircraftModels') ?? '' },
      sessionGeneration: session, authenticationRequired, refreshRevision: refresh,
      scheme: 'ispec', onFilterChange: () => undefined }),
    createElement('div', { ...list, id: 'list' }),
    createElement('div', { ...detail, id: 'detail' }),
    createElement(DocumentVersionLink, { version, familyId: family.familyId, children: '阅读原件' }));
}

function Reader() {
  const [params] = useSearchParams();
  const target = readingReturnTarget(params, version.documentVersionId);
  return createElement('section', null,
    target ? createElement(Link, { to: target.route, id: 'return' }, target.label) : null,
    createElement(Link, { to: `/graph?${documentGraphReadingParams(version.documentVersionId,
      version.readerWorkItemId ?? '', {}, params)}`, id: 'graph' }, '关系图谱'));
}

async function mount() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test/' });
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window,
    document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const router = createMemoryRouter([
    { path: '/library', element: createElement(LibraryPaneScrollProvider, { children: createElement(Page) }) },
    { path: '/document-versions/:id', element: createElement(Reader) },
    { path: '/graph', element: createElement(Reader) },
  ], { initialEntries: [`/library?${original}`] });
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  await act(async () => root.render(createElement(RouterProvider, { router })));
  return { dom, router, container,
    query: () => new URLSearchParams(router.state.location.search),
    click: async (selector: string) => act(async () => {
      const element = container.querySelector<HTMLElement>(selector);
      expect(element).not.toBeNull();
      element!.click();
    }),
    close: async () => {
      await act(async () => root.unmount()); router.dispose(); dom.window.close();
      for (const [key, descriptor] of prior) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

beforeEach(() => {
  generation = 1;
  jest.mocked(getCanonicalLibraryDirectory).mockReset().mockImplementation(async input => ({
    scope: 'TENANT_DOCUMENT_CATALOG', level: input.ata2 ? 'ATA4' : 'ATA2',
    documentCount: 2, versionCount: 2, directDocumentCount: 0, directVersionCount: 0,
    nodes: (input.ata2 ? [`${input.ata2}-10`] : ['32', '34']).map(value => ({
      level: input.ata2 ? 'ATA4' : 'ATA2', value, documentCount: 1, versionCount: 1,
      directDocumentCount: 0, directVersionCount: 0, rawValues: [], hasChildren: !input.ata2,
    })),
  }));
});

it.each(['reader', 'graph'])('restores the shared ATA tree after a %s route unmount and return', async hop => {
  const page = await mount();
  try {
    await page.click('.library-directory-expand[aria-label*="ATA34 "]');
    // Explicitly closed selected paths must remain closed as well.
    await page.click('.library-directory-expand[aria-label*="ATA32 "]');
    const sidebar = page.container.querySelector<HTMLElement>('.suite-library-folder')!;
    await act(async () => {
      sidebar.scrollTop = 327;
      sidebar.dispatchEvent(new page.dom.window.Event('scroll'));
    });
    await page.click('a');
    expect(page.container.querySelector('.library-source-directory')).toBeNull();
    if (hop === 'graph') await page.click('#graph');
    await page.click('#return');
    expect(page.query().get('familyId')).toBe(family.familyId);
    expect(page.query().get('selectedDocumentVersionId')).toBe(version.documentVersionId);
    expect(page.query().get('expandedFamilyIds')).toBe(family.familyId);
    expect(page.query().get('aircraftModels')).toBe(models);
    expect(page.query().get('search')).toBe('FTD45');
    expect(page.query().get('ata4')).toBe('32-10');
    expect(page.container.querySelector<HTMLElement>('#list')?.scrollTop).toBe(1058);
    expect(page.container.querySelector<HTMLElement>('#detail')?.scrollTop).toBe(81);
    expect(page.container.querySelector('.library-directory-expand[aria-label*="ATA34 "]')?.getAttribute('aria-expanded')).toBe('true');
    expect(page.container.querySelector('.library-directory-expand[aria-label*="ATA32 "]')?.getAttribute('aria-expanded')).toBe('false');
    expect(page.container.querySelector<HTMLElement>('.suite-library-folder')?.scrollTop).toBe(327);
    expect(libraryReadingParams(page.query()).toString()).toBe(page.query().toString());
    expect(getCanonicalLibraryDirectory).toHaveBeenCalledTimes(5); // root + selected32 + opened34, then fresh root + opened34
  } finally { await page.close(); }
});

it('shares expansion and sidebar position across mounted document/matter switches', async () => {
  const page = await mount();
  try {
    await page.click('.library-directory-expand[aria-label*="ATA34 "]');
    const aside = page.container.querySelector<HTMLElement>('.suite-library-folder')!;
    await act(async () => {
      aside.scrollTop = 260;
      aside.dispatchEvent(new page.dom.window.Event('scroll'));
    });
    const query = libraryReadingParams(page.query()).toString();
    await page.click('#matter');
    expect(page.query().get('directoryNodes')).toBe('34:1');
    expect(page.query().get('directoryY')).toBe('260');
    await page.click('#document');
    expect(page.container.querySelector('.suite-library-folder')).toBe(aside);
    expect(page.query().toString()).toBe(query);
    expect(aside.scrollTop).toBe(260);
    expect(getCanonicalLibraryDirectory).toHaveBeenCalledTimes(3);
  } finally { await page.close(); }
});

it.each(['refresh', 'session', 'authentication', 'search', 'models'])(
  'discards URL expansion and sidebar scroll at the actual %s boundary', async boundary => {
    const page = await mount();
    try {
      await page.click('.library-directory-expand[aria-label*="ATA34 "]');
      const aside = page.container.querySelector<HTMLElement>('.suite-library-folder')!;
      await act(async () => {
        aside.scrollTop = 330;
        aside.dispatchEvent(new page.dom.window.Event('scroll'));
      });
      if (boundary === 'search' || boundary === 'models') {
        const next = page.query();
        next.set(boundary === 'search' ? 'search' : 'aircraftModels', boundary === 'search' ? 'different-source' : '["A320"]');
        await act(async () => { await page.router.navigate(`/library?${next}`); });
      } else await page.click(`#${boundary}`);
      for (const key of ['directoryNodes', 'directorySession', 'directoryY']) expect(page.query().has(key)).toBe(false);
      if (boundary !== 'authentication') {
        expect(page.container.querySelector('.library-directory-expand[aria-label*="ATA34 "]')?.getAttribute('aria-expanded')).toBe('false');
        expect(aside.scrollTop).toBe(0);
      } else expect(page.container.querySelector('.library-source-directory-node')).toBeNull();
    } finally { await page.close(); }
  },
);

it('waits for restored open children before restoring or recording sidebar scroll', async () => {
  const page = await mount();
  try {
    await page.click('.library-directory-expand[aria-label*="ATA34 "]');
    const aside = page.container.querySelector<HTMLElement>('.suite-library-folder')!;
    await act(async () => {
      aside.scrollTop = 480;
      aside.dispatchEvent(new page.dom.window.Event('scroll'));
    });
    await page.click('a');
    const normal = jest.mocked(getCanonicalLibraryDirectory).getMockImplementation()!;
    let finish!: (value: CanonicalLibraryDirectoryResponse) => void;
    jest.mocked(getCanonicalLibraryDirectory).mockImplementation((input, signal) => input.ata2 === '34'
      ? new Promise(resolve => { finish = resolve; }) : normal(input, signal));
    await page.click('#return');
    const restored = page.container.querySelector<HTMLElement>('.suite-library-folder')!;
    expect(restored.scrollTop).toBe(0);
    await act(async () => restored.dispatchEvent(new page.dom.window.Event('scroll')));
    expect(page.query().get('directoryY')).toBe('480');
    await act(async () => finish(await normal({ layout: 'ATA', ata2: '34' })));
    expect(restored.scrollTop).toBe(480);
  } finally { await page.close(); }
});

it.each([401, 403, 404])('clears restored directory intent when a child read is rejected (%s)', async statusCode => {
  const page = await mount();
  try {
    await page.click('.library-directory-expand[aria-label*="ATA34 "]');
    await page.click('a');
    const normal = jest.mocked(getCanonicalLibraryDirectory).getMockImplementation()!;
    jest.mocked(getCanonicalLibraryDirectory).mockImplementation((input, signal) => input.ata2 === '34'
      ? Promise.reject({ statusCode }) : normal(input, signal));
    await page.click('#return');
    expect(page.container.querySelector('.library-source-directory-node')).toBeNull();
    expect(page.container.textContent).toContain('原目录已清除');
    for (const key of ['directoryNodes', 'directorySession', 'directoryY']) expect(page.query().has(key)).toBe(false);
    jest.mocked(getCanonicalLibraryDirectory).mockImplementation(normal);
    await page.click('.library-source-directory > button');
    await page.click('.library-directory-expand[aria-label*="ATA34 "]');
    expect(page.query().get('directoryNodes')).toBe('34:1');
    expect(page.container.querySelector('.library-directory-expand[aria-label*="ATA34 "]')?.getAttribute('aria-expanded')).toBe('true');
  } finally { await page.close(); }
});

it('does not restore a former actor sidebar after the directory was unmounted', async () => {
  const page = await mount();
  try {
    await page.click('.library-directory-expand[aria-label*="ATA34 "]');
    await page.click('a');
    generation = 2;
    await page.click('#return');
    expect(page.query().has('directoryNodes')).toBe(false);
    expect(page.query().has('directorySession')).toBe(false);
    expect(page.container.querySelector('.library-directory-expand[aria-label*="ATA34 "]')?.getAttribute('aria-expanded')).toBe('false');
    await page.click('.library-directory-expand[aria-label*="ATA34 "]');
    expect(page.query().get('directorySession')).toBe('2');
    expect(page.query().get('directoryNodes')).toBe('34:1');
  } finally { await page.close(); }
});

it('keeps an unknown source error visible through URL scroll updates and only retries explicitly', async () => {
  const page = await mount();
  try {
    const normal = jest.mocked(getCanonicalLibraryDirectory).getMockImplementation()!;
    jest.mocked(getCanonicalLibraryDirectory).mockImplementation((input, signal) => input.ata2 === '34'
      ? Promise.reject(new Error('UNKNOWN_SOURCE_FAILURE')) : normal(input, signal));
    await page.click('.library-directory-expand[aria-label*="ATA34 "]');
    expect(page.container.querySelector('.library-source-directory [role="alert"]')?.textContent).toContain('来源读取未完成');
    const calls = jest.mocked(getCanonicalLibraryDirectory).mock.calls.length;
    const aside = page.container.querySelector<HTMLElement>('.suite-library-folder')!;
    await act(async () => {
      aside.scrollTop = 190;
      aside.dispatchEvent(new page.dom.window.Event('scroll'));
      const list = page.container.querySelector<HTMLElement>('#list')!;
      list.scrollTop = 1090;
      list.dispatchEvent(new page.dom.window.Event('scroll'));
    });
    expect(page.query().get('directoryY')).toBe('190');
    expect(page.query().get('listY')).toBe('1090');
    expect(page.container.querySelector('.library-source-directory [role="alert"]')?.textContent).toContain('来源读取未完成');
    expect(getCanonicalLibraryDirectory).toHaveBeenCalledTimes(calls);
    jest.mocked(getCanonicalLibraryDirectory).mockImplementation(normal);
    await page.click('.library-source-directory [role="alert"] button');
    expect(page.container.querySelector('.library-source-directory [role="alert"]')).toBeNull();
    expect(getCanonicalLibraryDirectory).toHaveBeenCalledTimes(calls + 1);
  } finally { await page.close(); }
});

it('validates bounded directory display parameters without changing the business reading scope', () => {
  const params = new URLSearchParams(original);
  params.set('directorySession', '1'); params.set('directoryNodes', '34:1,32:0'); params.set('directoryY', '327');
  expect(libraryReadingParams(params).get('directoryNodes')).toBe('32:0,34:1');
  expect(libraryReadingScope(params)).toBe(libraryReadingScope(original));
  for (const bad of ['34:1,34:0', 'http://outside.example:1', '34:2', '34:1\n', '34:1,'.repeat(300)]) {
    params.set('directoryNodes', bad);
    expect(libraryReadingParams(params).has('directoryNodes')).toBe(false);
  }
  params.set('directoryY', '-1');
  expect(libraryReadingParams(params).has('directoryY')).toBe(false);
  params.append('directorySession', '2');
  expect(libraryReadingParams(params).has('directorySession')).toBe(false);
});
