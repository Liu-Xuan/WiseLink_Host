import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import type { CanonicalLibraryFleetCatalog } from '@shared/library-fleet.interface';
import { LibraryAtaHierarchy } from '@client/src/pages/WorkspaceHomePage/LibraryAtaHierarchy';
import { ataDirectoryCode, ataDirectoryTitles, buildLibraryAtaDirectory, type AtaDirectoryNode } from '@client/src/pages/WorkspaceHomePage/library-ata-directory';
import { libraryDocumentReadingRoute, libraryReadingParams, readingReturnTarget } from '@client/src/features/matter/reading-return';
import { libraryFamily, libraryMetadata } from './fixtures/canonical-library';

jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/api/canonical-host', () => ({ getCanonicalHostClientSessionGeneration: () => 1, subscribeCanonicalHostClientSession: () => () => undefined }));

const fleet: CanonicalLibraryFleetCatalog = {
  scope: 'CURRENT_TENANT_ACTIVE_FLEET', status: 'AVAILABLE', asOf: '2026-09-10',
  source: { sourceSnapshotId: 'fixture', sourceRevisionKey: 'fixture', sourceAsOf: '2026-09-10', authorityRevision: '1' },
  families: [{ fleetFamily: '787', models: ['787-9', '787-10'] }, { fleetFamily: '737MAX', models: ['737-8'] }],
  unclassifiedAssetCount: 0, semantics: 'DOCUMENT_MENTION_CLASSIFICATION_ONLY',
};
const flatten = (nodes: AtaDirectoryNode[]): AtaDirectoryNode[] => nodes.flatMap(node => [node, ...flatten(node.children)]);
function classified() {
  const document = libraryFamily('mixed');
  document.versions[0].extractedMetadata = libraryMetadata('23-15', '787-9');
  document.versions[1].extractedMetadata = libraryMetadata('34', '737-8');
  return document;
}

describe('authorized per-version aircraft / ATA browsing projection', () => {
  it('recognizes only explicit ATA observations and does not turn SB numbers into ATA4', () => {
    expect(ataDirectoryCode('23')).toEqual({ ata2: '23', ata4: null });
    for (const value of ['2315', '23-15', '231500', '23-15-00']) expect(ataDirectoryCode(value)).toEqual({ ata2: '23', ata4: '23-15' });
    for (const value of ['737-23-1234', '23-1234 SB', 'ATA 23', '3', '1234567']) expect(ataDirectoryCode(value)).toBeNull();
  });
  it('keeps different aircraft/ATA observations on their exact visible versions', () => {
    const document = classified();
    const roots = buildLibraryAtaDirectory([document], fleet);
    expect(roots.map(node => node.key)).toEqual(['787', '737MAX']);
    expect(flatten([roots[0]]).map(node => node.key)).toEqual(['787', '787-9', '23', '23-15']);
    expect(flatten([roots[1]]).map(node => node.key)).toEqual(['737MAX', '737-8', '34', '__UNKNOWN__']);
    expect(roots[0].items.map(item => item.version.documentVersionId)).toEqual(['DV-mixed-2']);
    expect(roots[1].items.map(item => item.version.documentVersionId)).toEqual(['DV-mixed-1']);
    expect(buildLibraryAtaDirectory([document], fleet, { fleetFamily: '787', ata: '34' })).toEqual([]);
    expect(document.versions).toHaveLength(2);
  });
  it('deduplicates visible version identities and never adds unreturned versions from the attachment dictionary', () => {
    const document = classified();
    document.versions = [document.versions[0], document.versions[0]];
    const roots = buildLibraryAtaDirectory([document, document], fleet);
    expect(roots).toHaveLength(1);
    expect(flatten(roots).every(node => node.items.length === 1)).toBe(true);
    expect(flatten(roots).some(node => node.key === '23-10')).toBe(false);
  });
  it('preserves unknown/outside-fleet material and broad parent observations without manufacturing child mapping', () => {
    const document = libraryFamily('broad');
    document.versions[0].extractedMetadata = libraryMetadata('23', '787');
    document.versions[1].extractedMetadata = libraryMetadata('23-10', '787-9');
    const roots = buildLibraryAtaDirectory([document], fleet);
    expect(roots[0].children.map(node => node.key)).toEqual(['787-9', '__FAMILY_MENTION__']);
    expect(roots[0].children[1].items[0].version.documentVersionId).toBe('DV-broad-2');
    const unknown = libraryFamily('unknown');
    const missingFleet = buildLibraryAtaDirectory([unknown], null);
    expect(flatten(missingFleet).map(node => node.key)).toEqual(['__OUTSIDE_FLEET__', '__UNKNOWN__', '__UNKNOWN__']);
    expect(buildLibraryAtaDirectory([unknown], null, { fleetFamily: '787' })).toEqual([]);
  });
  it('keeps bilingual attachment namespaces and duplicate source locators distinct', () => {
    expect(ataDirectoryTitles('23', 'ispec')[0]).toMatchObject({ titleZH: '通信', titleEN: 'COMMUNICATIONS' });
    expect(ataDirectoryTitles('23-10', 'ispec')[0].titleEN).toBe('Speech Communications');
    expect(ataDirectoryTitles('23-10', 'jasc')[0].titleEN).toBe('HF Communications System');
    expect(ataDirectoryTitles('45-45', 'ispec').flatMap(title => title.sources)).toHaveLength(2);
    expect(ataDirectoryTitles('99-99', 'ispec')).toEqual([]);
  });
  it('renders title provenance, exact historical links and read-only return state', () => {
    const params = new URLSearchParams('catalogView=ata&ataTitleScheme=jasc&fleetFamily=737MAX&search=radio');
    const html = renderToStaticMarkup(createElement(StaticRouter, { location: `/library?${params}` }, createElement(LibraryAtaHierarchy, {
      documents: [classified()], fleetCatalog: fleet, filters: {}, hasMore: true, scheme: 'ispec', onSchemeChange: jest.fn(), onSelect: jest.fn(),
    })));
    expect(html).toContain('机型 → ATA2 → ATA4 → 文档版本');
    expect(html).toContain('COMMUNICATIONS');
    expect(html).toContain('卫星通信');
    expect(html).toContain('ATA4 未细分');
    expect(html).toContain('附件版次及机型映射未核验');
    expect(html).toContain('ATA_iSpec2200_ATA4_CN_EN_complete.xlsx');
    expect(html).toContain('/document-versions/DV-mixed-1');
    const route = new URL(libraryDocumentReadingRoute('DV-mixed-1', params), 'https://example.invalid');
    const returned = new URL(readingReturnTarget(route.searchParams, 'DV-mixed-1')!.route, 'https://example.invalid');
    expect(returned.searchParams.get('catalogView')).toBe('ata');
    expect(returned.searchParams.get('ataTitleScheme')).toBe('jasc');
    expect(returned.searchParams.get('search')).toBe('radio');
    expect(readingReturnTarget(route.searchParams, 'other-version')).toBeNull();
    expect(libraryReadingParams(new URLSearchParams('catalogView=ata&catalogView=tree&ataTitleScheme=jasc&ataTitleScheme=ispec')).has('ataTitleScheme')).toBe(false);
  });
});
