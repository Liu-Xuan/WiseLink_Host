import { buildLibraryMacroGraph, macroVersionId, macroMatterId, macroFamilyId } from '@client/src/pages/RelationGraphPage/library-macro-graph';
import type { LibraryMacroRead } from '@client/src/pages/RelationGraphPage/library-macro-read';
import { libraryFamily, libraryMetadata } from './fixtures/canonical-library';
import { libraryMatterFixture } from './fixtures/library-matter';
import { activateGraphLayoutSession, readGraphLayout, saveGraphLayout } from '@client/src/pages/RelationGraphPage/suite-graph-layout-memory';

function fixture(): LibraryMacroRead {
  const document = libraryFamily('family-a');
  document.versions[0].extractedMetadata = libraryMetadata('3461');
  document.versions[1].extractedMetadata = libraryMetadata('3141');
  return { documents: [document], matters: [], coverage: { documents: 'COMPLETE', matters: 'COMPLETE', references: 'NOT_INDEXED' }, issues: [] };
}
it('renders all ATA2/ATA4, family and exact-version levels simultaneously', () => {
  const read = fixture(), graph = buildLibraryMacroGraph(read, 'ata', false);
  expect(graph.counts).toMatchObject({ classifications: 4, families: 1, versions: 2, matters: 0 });
  expect(graph.graph.nodes.some(node => node.id === 'library:ata2:34' && node.title.includes('导航'))).toBe(true);
  expect(graph.graph.edges).toEqual(expect.arrayContaining([
    expect.objectContaining({ source: 'library:ata4:34-61', target: macroVersionId('DV-family-a-2'), kind: 'CLASSIFIED_AS' }),
    expect.objectContaining({ source: 'library:ata4:31-41', target: macroVersionId('DV-family-a-1'), kind: 'CLASSIFIED_AS' }),
    expect.objectContaining({ source: macroFamilyId('family-a'), target: macroVersionId('DV-family-a-1'), kind: 'HAS_VERSION' }),
  ]));
  expect(graph.graph.edges.some(edge => edge.source === 'library:ata4:34-61' && edge.target === macroVersionId('DV-family-a-1'))).toBe(false);
  expect(graph.graph.edges.some(edge => /REFERS|REFERENCE|REVISES/.test(edge.kind))).toBe(false);
});
it('keeps special, missing, empty and unresolved raw observations without guessing chapter mappings', () => {
  const read = fixture(), version = read.documents[0].versions[0];
  version.extractedMetadata!.ata.observations = ['24-41', '31-39', '4600-00', '', 'mystery', '3461'].map(value => ({ value, status: 'PENDING_REVIEW', evidence: [] }));
  read.documents[0].versions[1].extractedMetadata = null;
  const graph = buildLibraryMacroGraph(read, 'ata', false);
  for (const value of ['24-41', '31-39', '4600-00', '', 'mystery']) expect(graph.targets.get(`library:cluster:${JSON.stringify(value)}`)).toMatchObject({ kind: 'classification', raw: [value] });
  expect(graph.targets.has('library:cluster:null')).toBe(true);
  expect(graph.targets.has('library:ata2:24')).toBe(false);
  expect(graph.targets.has('library:ata4:46-00')).toBe(false);
});
it('uses included exact material links, preserves isolated matters, and excludes expected/excluded or mismatched versions', () => {
  const read = fixture(), matter = libraryMatterFixture().matter;
  matter.materials = [
    { materialId: 'included', kind: 'MEMBER', familyId: 'family-a', documentVersionId: 'DV-family-a-1', disposition: 'INCLUDED', scope: '', contribution: '', basis: [], origin: 'ENGINEER' },
    { materialId: 'excluded', kind: 'MEMBER', familyId: 'family-a', documentVersionId: 'DV-family-a-2', disposition: 'EXCLUDED', scope: '', contribution: '', basis: [], origin: 'ENGINEER' },
    { materialId: 'mismatch', kind: 'RELATED', familyId: 'other-family', documentVersionId: 'DV-family-a-2', disposition: 'INCLUDED', scope: '', contribution: '', basis: [], origin: 'ENGINEER' },
  ];
  const isolated = { ...matter, matterId: 'isolated', materials: [] };
  read.matters = [matter, isolated];
  const graph = buildLibraryMacroGraph(read, 'ata', false);
  expect(graph.counts.matters).toBe(2);
  expect(graph.counts.materials).toBe(1);
  expect(graph.graph.edges.find(edge => edge.kind === 'MATTER_MATERIAL')).toMatchObject({ source: macroMatterId(matter.matterId), target: macroVersionId('DV-family-a-1') });
  expect(graph.graph.edges.some(edge => edge.source === macroMatterId('isolated'))).toBe(false);
  expect(graph.outsideLinks).toBe(1);
  expect(buildLibraryMacroGraph(read, 'ata', true).counts.matters).toBe(1);
});
it('never resurrects excluded native materials from the legacy WorkItem catalog', () => {
  const read = fixture(), matter = libraryMatterFixture().matter;
  matter.materials = [];
  matter.catalog.entries = [{ workItemId: 'WI-OLD', relationRole: 'PRIMARY', linkedAtWorkItemRevision: 1,
    currentWorkItemRevision: 1, workItemChangedSinceLink: false, workItemStatus: 'CURRENT',
    document: { documentId: 'doc-a', documentVersionId: 'DV-family-a-1', documentCode: 'SB-a', businessRevision: 'R1', normalizedFamily: 'SB' },
    documentCurrentness: { familyId: 'family-a', currentDocumentVersionId: 'DV-family-a-2', currentGeneration: 2, selectedVersionIsCurrent: false },
    sourceNavigation: { status: 'NOT_PARSED', sourceRefCount: 0, structuredContentPath: null } }];
  read.matters = [matter];
  expect(buildLibraryMacroGraph(read, 'ata', false).counts.materials).toBe(0);
  delete matter.materials;
  const legacy = buildLibraryMacroGraph(read, 'ata', false);
  expect(legacy.counts.materials).toBe(1);
  expect(legacy.graph.edges.some(edge => edge.kind === 'WORK_ITEM_MEMBERSHIP')).toBe(true);
  expect(legacy.graph.edges.some(edge => edge.kind === 'MATTER_MATERIAL')).toBe(false);
});
it('deduplicates identical memberships and retains all versions in category mode', () => {
  const read = fixture();
  read.documents[0].versions[0].extractedMetadata!.ata.observations.push(read.documents[0].versions[0].extractedMetadata!.ata.observations[0]);
  const graph = buildLibraryMacroGraph(read, 'normalizedFamily', false);
  expect(graph.counts).toMatchObject({ classifications: 1, families: 1, versions: 2 });
  expect(new Set(graph.graph.edges.map(edge => edge.id)).size).toBe(graph.graph.edges.length);
});
it('retains macro geometry beyond the detail-view node cap within the existing session and byte budgets', () => {
  activateGraphLayoutSession(21, false);
  const snapshot = { nodes: Array.from({ length: 650 }, (_, index) => ({ id: `macro-${index}`, base: { x: 0, y: 0 }, position: { x: index, y: 0 }, w: 0, h: 0, baseW: 0, baseH: 0 })) };
  expect(saveGraphLayout('macro', snapshot)).toBeUndefined();
  const token = saveGraphLayout('macro', snapshot, undefined, 1024)!;
  expect(readGraphLayout(token, 'macro')?.nodes).toHaveLength(650);
  activateGraphLayoutSession(22, false);
  expect(readGraphLayout(token, 'macro')).toBeUndefined();
});
it('rejects a graph exceeding its rendering budget explicitly without clipping unknown classifications', () => {
  const read = fixture();
  read.documents[0].versions[0].extractedMetadata!.ata.observations = Array.from({ length: 1025 }, (_, index) => ({ value: `raw-${index}`, status: 'PENDING_REVIEW', evidence: [] }));
  expect(() => buildLibraryMacroGraph(read, 'ata', false)).toThrow('超过 1024');
});
