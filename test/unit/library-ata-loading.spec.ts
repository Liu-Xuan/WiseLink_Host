import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { JSDOM } from 'jsdom';
import type { CanonicalLibraryDocumentsResponse } from '@shared/api.interface';
import type { CanonicalLibraryFleetCatalog } from '@shared/library-fleet.interface';
import { getCanonicalLibraryDocuments, getCanonicalLibraryFleetCatalog } from '@client/src/api/canonical-host';
import { LibraryDocumentDirectory } from '@client/src/pages/WorkspaceHomePage/LibraryDocumentDirectory';
import { useLibraryDocuments } from '@client/src/pages/WorkspaceHomePage/useLibraryDocuments';
import { useLibraryFleetCatalog } from '@client/src/pages/WorkspaceHomePage/useLibraryFleetCatalog';
import { libraryDocuments, libraryMetadata } from './fixtures/canonical-library';

jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/components/ui/input', () => ({ Input: 'input' }));
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => 1,
  subscribeCanonicalHostClientSession: () => () => undefined,
  getCanonicalLibraryDocuments: jest.fn(),
  getCanonicalLibraryTasks: jest.fn(),
  getCanonicalLibraryFleetCatalog: jest.fn(),
  isCanonicalObjectNotFound: () => false,
  summarizeCanonicalDocumentReadFailure: () => ({ code: 'ERR_NETWORK', sourceUnavailable: false }),
}));

const fleet: CanonicalLibraryFleetCatalog = {
  scope: 'CURRENT_TENANT_ACTIVE_FLEET', status: 'AVAILABLE', asOf: '2026-09-10',
  source: { sourceSnapshotId: 'fixture', sourceRevisionKey: 'fixture', sourceAsOf: '2026-09-10', authorityRevision: '1' },
  families: [{ fleetFamily: '787', models: ['787-9'] }], unclassifiedAssetCount: 0,
  semantics: 'DOCUMENT_MENTION_CLASSIFICATION_ONLY',
};

function documents(family = 'radio'): CanonicalLibraryDocumentsResponse {
  const response = libraryDocuments([family]);
  response.items[0].versions.forEach(version => { version.extractedMetadata = libraryMetadata('2310', '787-9'); });
  return response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function DirectoryPage() {
  const [revision, setRevision] = useState(0);
  const directory = useLibraryDocuments('', 1, false, revision, 'document', '');
  const fleetRead = useLibraryFleetCatalog(1, true, revision);
  return createElement(LibraryDocumentDirectory, {
    directory, fleet: fleetRead, authenticationRequired: false, search: '', searchText: '',
    mode: 'document', selectedId: '', quicklookLoading: false, onSearchTextChange: () => undefined,
    onSearch: event => event.preventDefault(), onRefresh: () => setRevision(value => value + 1),
    onSelect: () => undefined, presentation: { view: 'ata', grouping: 'category' },
  });
}

describe('ATA directory with the synchronous compact title catalog', () => {
  let dom: JSDOM;
  let root: Root;
  let router: ReturnType<typeof createMemoryRouter>;
  const globals = new Map<string, PropertyDescriptor | undefined>();
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(getCanonicalLibraryFleetCatalog).mockResolvedValue(fleet);
    dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test/' });
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
      navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
      globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    root = createRoot(dom.window.document.getElementById('root')!);
    router = createMemoryRouter([
      { path: '/library', element: createElement(DirectoryPage) },
      { path: '/away', element: createElement('p', null, 'Away') },
    ], { initialEntries: ['/library?catalogView=ata&ataTitleScheme=ispec'] });
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    router.dispose();
    dom.window.close();
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    globals.clear();
  });
  const text = () => dom.window.document.body.textContent ?? '';
  async function click(label: string) {
    const button = [...dom.window.document.querySelectorAll('button')].find(item =>
      item.getAttribute('aria-label') === label || item.textContent === label,
    );
    expect(button).toBeDefined();
    await act(async () => button!.click());
  }

  it('automatically reads authorized documents and fleet in parallel, with titles on the first populated render', async () => {
    const read = deferred<CanonicalLibraryDocumentsResponse>();
    jest.mocked(getCanonicalLibraryDocuments).mockReturnValueOnce(read.promise);
    await act(async () => root.render(createElement(RouterProvider, { router })));
    expect(getCanonicalLibraryDocuments).toHaveBeenCalledTimes(1);
    expect(getCanonicalLibraryFleetCatalog).toHaveBeenCalledTimes(1);
    expect(text()).toContain('正在读取工程文档');
    await act(async () => read.resolve(documents()));
    expect(text()).toContain('语音通信');
    expect(text()).toContain('通信');
    expect(text()).toContain('ATA23-10');
    expect(text()).not.toContain('目录暂不可用');
    expect(dom.window.document.querySelector('a[href*="DV-radio-1"]')).not.toBeNull();
    expect(dom.window.document.querySelector('a[href*="DV-radio-2"]')).not.toBeNull();
  });

  it('keeps historical scheme URLs readable without visible switches or another directory read and returns with fresh authorization', async () => {
    jest.mocked(getCanonicalLibraryDocuments).mockResolvedValueOnce(documents()).mockResolvedValueOnce(documents('returned'));
    await act(async () => root.render(createElement(RouterProvider, { router })));
    expect(text()).not.toContain('JASC');
    expect(text()).not.toContain('iSpec');
    await act(async () => { await router.navigate('/library?catalogView=ata&ataTitleScheme=jasc'); });
    expect(text()).toContain('HF通信系统');
    expect(text()).not.toContain('语音通信');
    await act(async () => { await router.navigate('/library?catalogView=ata&ataTitleScheme=ispec'); });
    expect(text()).toContain('语音通信');
    expect(getCanonicalLibraryDocuments).toHaveBeenCalledTimes(1);
    expect(getCanonicalLibraryFleetCatalog).toHaveBeenCalledTimes(1);
    await act(async () => { await router.navigate('/away'); });
    await act(async () => { await router.navigate(-1); });
    expect(text()).toContain('语音通信');
    expect(getCanonicalLibraryDocuments).toHaveBeenCalledTimes(2);
    expect(dom.window.document.querySelector('a[href*="DV-returned-1"]')).not.toBeNull();
    expect(dom.window.document.querySelector('a[href*="DV-radio-1"]')).toBeNull();
  });

  it('keeps both title and exact version directory through refresh failure, then recovers in place', async () => {
    const refresh = deferred<CanonicalLibraryDocumentsResponse>();
    jest.mocked(getCanonicalLibraryDocuments).mockResolvedValueOnce(documents()).mockReturnValueOnce(refresh.promise)
      .mockResolvedValueOnce(documents('recovered'));
    await act(async () => root.render(createElement(RouterProvider, { router })));
    await click('刷新工程文档');
    expect(text()).toContain('语音通信');
    expect(dom.window.document.querySelector('a[href*="DV-radio-1"]')).not.toBeNull();
    await act(async () => refresh.reject(new Error('network failure')));
    expect(text()).toContain('以下保留上次成功读取的目录');
    expect(text()).toContain('语音通信');
    expect(dom.window.document.querySelector('a[href*="DV-radio-1"]')).not.toBeNull();
    await click('重试');
    expect(text()).toContain('语音通信');
    expect(text()).not.toContain('未能更新');
    expect(dom.window.document.querySelector('a[href*="DV-recovered-1"]')).not.toBeNull();
    expect(dom.window.document.querySelector('a[href*="DV-radio-1"]')).toBeNull();
  });

  it('recovers from an initial failed read without a reload or an added title-loading gate', async () => {
    jest.mocked(getCanonicalLibraryDocuments).mockRejectedValueOnce(new Error('network failure'))
      .mockResolvedValueOnce(documents());
    await act(async () => root.render(createElement(RouterProvider, { router })));
    expect(text()).toContain('目录暂不可用');
    await click('重试');
    expect(text()).toContain('语音通信');
    expect(text()).not.toContain('目录暂不可用');
    expect(getCanonicalLibraryDocuments).toHaveBeenCalledTimes(2);
  });
  it('pins the exact historical ATA leaf on row selection instead of selecting the family current version', async () => {
    jest.mocked(getCanonicalLibraryDocuments).mockResolvedValueOnce(documents());
    await act(async () => root.render(createElement(RouterProvider, { router })));
    const historical = dom.window.document.querySelector<HTMLElement>('tr[data-document-version-id="DV-radio-1"]');
    expect(historical).not.toBeNull();
    await act(async () => historical!.click());
    expect(new URLSearchParams(router.state.location.search).get('selectedDocumentVersionId')).toBe('DV-radio-1');
    expect(new URLSearchParams(router.state.location.search).get('familyId')).toBe('radio');
    expect(getCanonicalLibraryDocuments).toHaveBeenCalledTimes(1);
  });

  it('keeps navigation in a closed toolbar overlay and makes its actions non-submitting', async () => {
    jest.mocked(getCanonicalLibraryDocuments).mockResolvedValueOnce(documents());
    await act(async () => root.render(createElement(RouterProvider, { router })));
    const options = dom.window.document.querySelector<HTMLDetailsElement>('.suite-directory-options')!;
    expect(options.open).toBe(false);
    expect(options.parentElement?.tagName).toBe('FORM');
    expect(dom.window.document.querySelector('.library-tree-recent-wrapper .library-category-tree')).toBeNull();
    expect([...options.querySelectorAll('button')].every(button => button.type === 'button')).toBe(true);
  });

});
