import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider, useSearchParams } from 'react-router-dom';
import { JSDOM } from 'jsdom';
import type {
  CanonicalLibraryDocumentsResponse,
  EngineeringMatterDirectoryResponse,
} from '@shared/api.interface';
import {
  getCanonicalLibraryDocuments,
} from '@client/src/api/canonical-host';
import { getEngineeringMatterDirectory } from '@client/src/api/engineering-matter';
import useMatterDirectory from '../../client/src/features/matter/useMatterDirectory';
import { useLibraryDocuments } from '../../client/src/pages/WorkspaceHomePage/useLibraryDocuments';
import { libraryViewMode } from '../../client/src/pages/WorkspaceHomePage/library-view-mode';
import { useLibraryDefaultSelection } from '../../client/src/pages/WorkspaceHomePage/useLibraryDefaultSelection';

jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => 1,
  getCanonicalLibraryDocuments: jest.fn(),
  getCanonicalLibraryTasks: jest.fn(),
  isCanonicalObjectNotFound: () => false,
}));
jest.mock('@client/src/api/engineering-matter', () => ({
  getEngineeringMatterDirectory: jest.fn(),
}));

function matter(matterId: string): EngineeringMatterDirectoryResponse {
  return {
    items: [{ matterId, title: matterId, primaryWorkItemId: null,
      createdAt: '2026-09-20', updatedAt: '2026-09-20',
      currentMatterRevisionId: 'MR-1', workingRevision: 1, result: null }],
    nextCursor: null, fileReadPerformed: false,
  };
}

function document(familyId: string): CanonicalLibraryDocumentsResponse {
  return {
    scope: 'CURRENT_USER_DOCUMENT_CATALOG', totalCount: 1,
    familyCounts: {}, ataCounts: {}, aircraftModelCounts: {},
    order: 'FAMILY_CREATED_AT_DESC_FAMILY_ID_DESC',
    items: [{ kind: 'DOCUMENT', familyId, documentId: familyId,
      documentCode: familyId, normalizedFamily: familyId,
      issuerAuthority: 'OEM', createdAt: '2026-09-20',
      updatedAt: '2026-09-20', versions: [], workItemCount: 0 }],
    nextCursor: null, fileReadPerformed: false,
  };
}

function DirectoryPage() {
  const [params] = useSearchParams();
  const mode = libraryViewMode(params);
  const matters = useMatterDirectory('', '', 1, mode === 'matter', 0);
  const documents = useLibraryDocuments('', 1, false, 0, 'document', '', mode === 'document');
  useLibraryDefaultSelection(
    mode,
    mode === 'matter' ? matters.items[0]?.matterId : documents.items[0]?.kind === 'DOCUMENT'
      ? documents.items[0].familyId : undefined,
    mode === 'matter' ? matters.loading : documents.loading,
    mode === 'matter' ? Boolean(matters.error) : Boolean(documents.error),
    false,
  );
  return createElement('output', null, params.toString());
}

it('uses a fresh authorized first item after returning to either library mode', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test/' });
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window,
    document: dom.window.document, navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  jest.mocked(getEngineeringMatterDirectory)
    .mockResolvedValueOnce(matter('MAT-A'))
    .mockResolvedValueOnce(matter('MAT-B'));
  jest.mocked(getCanonicalLibraryDocuments)
    .mockResolvedValueOnce(document('FAM-1'))
    .mockResolvedValueOnce(document('FAM-2'));
  const router = createMemoryRouter([{ path: '/library', element: createElement(DirectoryPage) }],
    { initialEntries: ['/library?mode=matter'] });
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => root.render(createElement(RouterProvider, { router })));
    expect(new URLSearchParams(router.state.location.search).get('selectedMatterId')).toBe('MAT-A');
    await act(async () => { await router.navigate('/library?mode=document'); });
    expect(new URLSearchParams(router.state.location.search).get('familyId')).toBe('FAM-1');
    await act(async () => { await router.navigate('/library?mode=matter'); });
    expect(new URLSearchParams(router.state.location.search).get('selectedMatterId')).toBe('MAT-B');
    await act(async () => { await router.navigate('/library?mode=document'); });
    expect(new URLSearchParams(router.state.location.search).get('familyId')).toBe('FAM-2');
  } finally {
    await act(async () => root.unmount());
    router.dispose();
    dom.window.close();
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    jest.clearAllMocks();
  }
});
