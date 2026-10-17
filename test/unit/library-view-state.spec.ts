import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider, useSearchParams } from 'react-router-dom';
import { JSDOM } from 'jsdom';
import { getCanonicalLibraryDocuments, getCanonicalLibraryDirectory } from '@client/src/api/canonical-host';
import { getEngineeringMatterDirectory } from '@client/src/api/engineering-matter';
import useMatterDirectory from '@client/src/features/matter/useMatterDirectory';
import { useLibraryDocuments } from '@client/src/pages/WorkspaceHomePage/useLibraryDocuments';
import { useLibraryViewState } from '@client/src/pages/WorkspaceHomePage/useLibraryViewState';
import { LibraryWorkspaceHeader } from '@client/src/pages/WorkspaceHomePage/LibraryWorkspaceHeader';
import { LibrarySourceDirectory } from '@client/src/pages/WorkspaceHomePage/LibrarySourceDirectory';
import { libraryViewMode } from '@client/src/pages/WorkspaceHomePage/library-view-mode';
import { libraryDocuments } from './fixtures/canonical-library';
import { libraryMatterRows } from './fixtures/library-matter';
import type { CanonicalLibraryDocumentsResponse } from '@shared/api.interface';

let generation = 1;
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => generation,
  getCanonicalLibraryDocuments: jest.fn(), getCanonicalLibraryTasks: jest.fn(),
  getCanonicalLibraryDirectory: jest.fn(), isCanonicalObjectNotFound: () => false,
}));
jest.mock('@client/src/api/engineering-matter', () => ({ getEngineeringMatterDirectory: jest.fn() }));

function Directory({ session: initialSession }: { session: number }) {
  const [session, setSession] = useState(initialSession);
  const [params, setParams] = useSearchParams();
  const mode = libraryViewMode(params);
  const state = useLibraryViewState(params, session);
  const document = state.viewParams('document'), matter = state.viewParams('matter');
  const docs = useLibraryDocuments(document.get('search') ?? '', session, false, 0, 'document', '', true,
    { ata2: document.get('ata2') ?? '' });
  const matters = useMatterDirectory(matter.get('search') ?? '', '', session, state.visited('matter'), 0);
  return createElement('div', null,
    createElement('button', { 'data-new-session': true, onClick: () => { generation++; setSession(generation); } }, 'New test session'),
    createElement(LibraryWorkspaceHeader, { mode, onModeChange: target => setParams(state.switchParams(target)),
      children: createElement('span', null, '本地接收内容') }),
    createElement('aside', null, createElement(LibrarySourceDirectory, { search: document.get('search') ?? '',
      filters: { ata2: document.get('ata2') ?? '' }, sessionGeneration: session,
      authenticationRequired: false, refreshRevision: 0, scheme: 'ispec',
      onFilterChange: () => undefined })),
    createElement('output', { 'data-query': true }, params.toString()),
    createElement('output', { 'data-tasks': true }, state.viewParams('tasks').toString()),
    createElement('output', { 'data-docs': true }, docs.items.map(item => item.kind === 'DOCUMENT' ? item.familyId : '').join(',')),
    createElement('output', { 'data-matters': true }, matters.items.map(item => item.matterId).join(',')));
}

async function mount(url: string) {
  const dom = new JSDOM('<div id="library-workspace-navigation"></div><div id="library-workspace-actions"></div><div id="root"></div>', { url: 'https://example.test/' });
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const session = 1;
  const router = createMemoryRouter([{ path: '/library', element: createElement(Directory, { session }) }],
    { initialEntries: [url] });
  const root = createRoot(dom.window.document.getElementById('root')!);
  await act(async () => root.render(createElement(RouterProvider, { router })));
  return { dom, router,
    query: () => new URLSearchParams(router.state.location.search),
    switch: async (name: string) => act(async () => {
      const button = [...dom.window.document.querySelectorAll('nav button')].find(value => value.textContent === name);
      button!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
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
  jest.mocked(getCanonicalLibraryDocuments).mockResolvedValue(libraryDocuments(['doc-first']));
  jest.mocked(getEngineeringMatterDirectory).mockResolvedValue({ items: libraryMatterRows(), nextCursor: null, fileReadPerformed: false });
  jest.mocked(getCanonicalLibraryDirectory).mockImplementation(async input => ({
    scope: 'TENANT_DOCUMENT_CATALOG', level: input.ata2 ? 'ATA4' : 'ATA2',
    documentCount: 1, versionCount: 2, directDocumentCount: 0, directVersionCount: 0,
    nodes: [{ level: input.ata2 ? 'ATA4' : 'ATA2', value: input.ata2 ? '32-10' : '32',
      documentCount: 1, versionCount: 2, directDocumentCount: 0, directVersionCount: 0,
      rawValues: [], hasChildren: !input.ata2 }],
  }));
});
afterEach(() => jest.clearAllMocks());

it('shares one mounted tree and keeps separate searches, selections and list positions', async () => {
  const page = await mount('/library?mode=document&search=doc&familyId=doc-first&selectedDocumentVersionId=DV-doc-first-1&expandedFamilyIds=doc-first&listY=140&quicklookY=60&ata2=32');
  try {
    const tree = page.dom.window.document.querySelector('.library-source-directory');
    await page.switch('工程事项');
    expect(page.query().get('ata2')).toBe('32');
    expect(page.query().has('familyId')).toBe(false);
    expect(page.query().has('selectedDocumentVersionId')).toBe(false);
    expect(page.query().has('search')).toBe(false);
    await act(async () => { await page.router.navigate('/library?mode=matter&ata2=32&search=matter&selectedMatterId=doc-first&listY=240&quicklookY=90'); });
    await page.switch('工程文档');
    expect(page.query().get('familyId')).toBe('doc-first');
    expect(page.query().get('selectedDocumentVersionId')).toBe('DV-doc-first-1');
    expect(page.query().get('expandedFamilyIds')).toBe('doc-first');
    expect(page.query().get('search')).toBe('doc');
    expect(page.query().get('listY')).toBe('140');
    expect(page.query().has('selectedMatterId')).toBe(false);
    await page.switch('工程事项');
    expect(page.query().get('search')).toBe('matter');
    expect(page.query().get('selectedMatterId')).toBe('doc-first');
    expect(page.query().get('listY')).toBe('240');
    expect(page.dom.window.document.querySelector('.library-source-directory')).toBe(tree);
    expect(getCanonicalLibraryDocuments).toHaveBeenCalledTimes(1);
    expect(getEngineeringMatterDirectory).toHaveBeenCalledTimes(2); // first visit, then its own submitted search
    expect(getCanonicalLibraryDirectory).toHaveBeenCalledTimes(2); // root and the selected ATA2 child
    expect(page.dom.window.document.querySelectorAll('.library-workspace-header')).toHaveLength(0);
  } finally { await page.close(); }
});

it('does not restart the pending document acquisition during a fast round trip', async () => {
  let settle!: (value: CanonicalLibraryDocumentsResponse) => void;
  jest.mocked(getCanonicalLibraryDocuments).mockReturnValueOnce(new Promise(resolve => { settle = resolve; }));
  const page = await mount('/library?mode=document');
  try {
    const signal = jest.mocked(getCanonicalLibraryDocuments).mock.calls[0][1];
    await page.switch('工程事项');
    await page.switch('工程文档');
    expect(signal?.aborted).toBe(false);
    expect(getCanonicalLibraryDocuments).toHaveBeenCalledTimes(1);
    await act(async () => settle(libraryDocuments(['same-inflight-document'])));
    expect(page.dom.window.document.querySelector('[data-docs]')?.textContent).toBe('same-inflight-document');
  } finally { await page.close(); }
});

it('invalidates the document query on a real input change and rejects its late old response', async () => {
  let settle!: (value: CanonicalLibraryDocumentsResponse) => void;
  jest.mocked(getCanonicalLibraryDocuments).mockReturnValueOnce(new Promise(resolve => { settle = resolve; }));
  const page = await mount('/library?mode=document&search=old');
  try {
    const signal = jest.mocked(getCanonicalLibraryDocuments).mock.calls[0][1];
    await act(async () => { await page.router.navigate('/library?mode=document&search=new'); });
    expect(signal?.aborted).toBe(true);
    await act(async () => settle(libraryDocuments(['obsolete-document'])));
    expect(page.dom.window.document.querySelector('[data-docs]')?.textContent).toBe('doc-first');
    expect(getCanonicalLibraryDocuments).toHaveBeenCalledTimes(2);
  } finally { await page.close(); }
});

it('clears inactive view state and reacquires lists at the real session boundary', async () => {
  const page = await mount('/library?mode=document&familyId=doc-first&listY=140');
  try {
    await page.switch('工程事项');
    await act(async () => { await page.router.navigate('/library?mode=matter&search=old-actor-search&selectedMatterId=old-actor-matter&listY=240'); });
    await page.switch('工程文档');
    jest.mocked(getCanonicalLibraryDocuments).mockResolvedValueOnce(libraryDocuments(['new-session-document']));
    await act(async () => {
      page.dom.window.document.querySelector('[data-new-session]')!
        .dispatchEvent(new page.dom.window.MouseEvent('click', { bubbles: true }));
    });
    expect(page.dom.window.document.querySelector('[data-docs]')?.textContent).toBe('new-session-document');
    await page.switch('工程事项');
    expect(page.query().has('search')).toBe(false);
    expect(page.query().has('selectedMatterId')).toBe(false);
    expect(page.query().has('listY')).toBe(false);
    expect(jest.mocked(getEngineeringMatterDirectory).mock.calls.at(-1)?.[0]?.search).toBe('');
  } finally { await page.close(); }
});

it('drops inactive selections and positions when the common directory scope changes', async () => {
  const page = await mount('/library?mode=document&familyId=doc-first&selectedDocumentVersionId=DV-doc-first-1&listY=140&ata2=32');
  try {
    await page.switch('工程事项');
    await act(async () => { await page.router.navigate('/library?mode=matter&ata2=34'); });
    await page.switch('工程文档');
    expect(page.query().get('ata2')).toBe('34');
    expect(page.query().has('familyId')).toBe(false);
    expect(page.query().has('selectedDocumentVersionId')).toBe(false);
    expect(page.query().has('listY')).toBe(false);
    expect(getCanonicalLibraryDocuments).toHaveBeenCalledTimes(2);
  } finally { await page.close(); }
});

it('preserves the existing workItem-only task deep link without mixing it into document selection', async () => {
  const page = await mount('/library?workItemId=WI-legacy&familyId=legacy-family');
  try {
    const taskState = new URLSearchParams(page.dom.window.document.querySelector('[data-tasks]')?.textContent ?? '');
    expect(taskState.get('mode')).toBe('tasks');
    expect(taskState.get('workItemId')).toBe('WI-legacy');
    expect(taskState.get('familyId')).toBe('legacy-family');
    await page.switch('工程文档');
    expect(page.query().has('workItemId')).toBe(false);
    expect(page.query().has('familyId')).toBe(false);
  } finally { await page.close(); }
});
