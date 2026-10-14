import { libraryFamily, libraryMetadata } from '../fixtures/canonical-library';
import type { CanonicalLibraryFleetCatalog } from '@shared/library-fleet.interface';
import { buildLibraryAtaDirectory, type AtaDirectoryNode } from '@client/src/pages/WorkspaceHomePage/library-ata-directory';

const fleet: CanonicalLibraryFleetCatalog = {
  scope: 'CURRENT_TENANT_ACTIVE_FLEET', status: 'AVAILABLE', asOf: '2026-10-14',
  source: { sourceSnapshotId: 'test', sourceRevisionKey: 'test', sourceAsOf: '2026-10-14', authorityRevision: '1' },
  families: [{ fleetFamily: '787', models: ['787-9'] }], unclassifiedAssetCount: 0,
  semantics: 'DOCUMENT_MENTION_CLASSIFICATION_ONLY',
};
const flatten = (nodes: AtaDirectoryNode[]): AtaDirectoryNode[] => nodes.flatMap(node => [node, ...flatten(node.children)]);

describe('TDMS library known and unknown ATA memberships', () => {
  it('keeps ATA2-only metadata at the chapter and does not manufacture an ATA4', () => {
    const document = libraryFamily('chapter-only');
    document.versions = [document.versions[0]];
    document.versions[0].extractedMetadata = libraryMetadata('27', '787-9');
    const nodes = flatten(buildLibraryAtaDirectory([document], fleet));
    const chapter = nodes.find(node => node.level === 'ata2')!;
    expect(chapter.key).toBe('27');
    expect(chapter.children).toEqual([]);
    expect(chapter.directItems?.[0].version.documentVersionId).toBe(document.versions[0].documentVersionId);
    expect(nodes.some(node => node.level === 'ata4')).toBe(false);
  });

  it('deduplicates a family and version at parents with several ATA navigation entries', () => {
    const document = libraryFamily('multi-ata');
    document.versions = [document.versions[0]];
    document.versions[0].extractedMetadata = libraryMetadata('2710', '787-9');
    document.versions[0].extractedMetadata.ata.observations.push({ value: '2720', status: 'PENDING_REVIEW', evidence: [] });
    const roots = buildLibraryAtaDirectory([document, document], fleet);
    const chapter = flatten(roots).find(node => node.level === 'ata2')!;
    expect(chapter.children).toHaveLength(2);
    expect(chapter.items).toHaveLength(1);
    expect(roots[0].items).toHaveLength(1);
  });

  it('keeps missing classification visible without a synthetic child chapter', () => {
    const document = libraryFamily('unknown');
    const unknown = flatten(buildLibraryAtaDirectory([document], null)).find(node => node.key === '__UNKNOWN__')!;
    expect(unknown.children).toEqual([]);
    expect(unknown.directItems).toHaveLength(2);
  });
});
