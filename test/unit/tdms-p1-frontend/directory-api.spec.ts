const request = jest.fn();
jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({ axiosForBackend: request }));
jest.mock('@lark-apaas/client-toolkit/utils/resolveAppUrl', () => ({ resolveAppUrl: (path: string) => path }));
jest.mock('@lark-apaas/client-toolkit/logger', () => ({ logger: { error: jest.fn() } }));

import { getCanonicalLibraryDirectory, getCanonicalLibraryDocuments, invalidateCanonicalHostClientSession } from '@client/src/api/canonical-host';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { JSDOM } from 'jsdom';
import { libraryDocuments, libraryFamily } from '../fixtures/canonical-library';
import { libraryReadingScope, readingReturnTarget } from '@client/src/features/matter/reading-return';
import { DocumentVersionLink } from '@client/src/pages/WorkspaceHomePage/DocumentVersionLink';

describe('library directory and leaf browser contract', () => {
  beforeEach(() => { request.mockReset(); invalidateCanonicalHostClientSession(); });
  it('reads counts for the requested level and sends precise ATA2/ATA4 leaf filters as one GET', async () => {
    request.mockResolvedValueOnce({ status: 200, data: { scope: 'TENANT_DOCUMENT_CATALOG', level: 'ATA4',
      documentCount: 2, versionCount: 4, directDocumentCount: 1, directVersionCount: 2, nodes: [] } });
    await getCanonicalLibraryDirectory({ aircraftModel: '787-9', ata2: '27', fleetFamily: '787' });
    expect(request.mock.calls[0][0].url).toBe('/api/canonical-host/library/directory?aircraftModel=787-9&ata2=27&fleetFamily=787');
    request.mockResolvedValueOnce({ status: 200, data: libraryDocuments([]) });
    await getCanonicalLibraryDocuments({ aircraftModel: '787-9', ata2: '27', ata4: '__DIRECT__', fleetFamily: '787', limit: 24 });
    expect(request.mock.calls[1][0]).toMatchObject({ method: 'GET', params: {
      aircraftModel: '787-9', ata2: '27', ata4: '__DIRECT__', fleetFamily: '787', limit: 24,
    } });
    expect(request.mock.calls.every(([call]) => call.method === 'GET' && !('data' in call))).toBe(true);
  });

  it('rejects mismatched directory levels instead of presenting other node counts', async () => {
    request.mockResolvedValue({ status: 200, data: { scope: 'TENANT_DOCUMENT_CATALOG', level: 'AIRCRAFT_MODEL', nodes: [] } });
    await expect(getCanonicalLibraryDirectory({ aircraftModel: '787-9' })).rejects.toThrow('CANONICAL_LIBRARY_DIRECTORY_BINDING_MISMATCH');
  });

  it('returns from exact-version reading to the same node and separates different ATA scopes', () => {
    const node = new URLSearchParams('mode=document&familyId=F-1&aircraftModel=787-9&ata2=27&ata4=27-11');
    const other = new URLSearchParams(node);
    other.set('ata4', '27-12');
    expect(libraryReadingScope(node)).not.toBe(libraryReadingScope(other));
    const family = libraryFamily('F-1');
    const historical = family.versions[1];
    const markup = renderToStaticMarkup(createElement(StaticRouter, { location: `/library?${node}` },
      createElement(DocumentVersionLink, { version: historical, familyId: family.familyId, children: '原文' })));
    const dom = new JSDOM(markup);
    const route = new URL(dom.window.document.querySelector('a')!.getAttribute('href')!, 'https://test.invalid');
    const returned = new URL(readingReturnTarget(route.searchParams, historical.documentVersionId)!.route, 'https://test.invalid');
    expect(returned.searchParams.get('ata2')).toBe('27');
    expect(returned.searchParams.get('ata4')).toBe('27-11');
    expect(returned.searchParams.get('selectedDocumentVersionId')).toBe(historical.documentVersionId);
    dom.window.close();
  });
});
