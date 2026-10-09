import type { MatterMaterialLink } from '@shared/matter-material.interface';
import { selectMatterDocumentSources, matterDocumentSourceLabel } from '../../client/src/features/matter/matter-document-sources';
import { buildSuiteMatterGraph } from '../../client/src/pages/RelationGraphPage/suite-matter-graph';
import { libraryMatterFixture } from './fixtures/library-matter';
function member(id: string, familyId = 'family-a'): MatterMaterialLink { return {materialId: id, scope: 'registered', contribution: 'source', origin: 'DEFAULT_INTAKE', disposition: 'INCLUDED', basis: [], kind: 'MEMBER', familyId, documentVersionId: id}; }
function expected(status: 'NOT_ACQUIRED' | 'PARTIALLY_ACQUIRED' | 'ACQUIRED', ids: string[]): MatterMaterialLink { return {...member('expect'), kind: 'EXPECTED', familyId: null, documentVersionId: null, expected: {issuer: null, documentNumber: 'Pending SB', description: 'Expected source', expectedContribution: 'supplement', expectedDate: null, sourceAsOf: '2026-10-07', publicationStatus: 'PLANNED', acquisitionStatus: status, fulfilledBy: ids.map(documentVersionId => ({documentVersionId, familyId: 'family-a', scope: 'registered fulfillment'}))}}; }
function read(materials: MatterMaterialLink[]) { const read = libraryMatterFixture(); read.matter.materials = materials; return read; }
describe('shared exact current matter document source resolution', () => {
  it('includes member, related and acquired expected identities once, retaining different versions of one family', () => {
    const data = read([member('R3'), {...member('R4'),kind: 'RELATED'}, expected('PARTIALLY_ACQUIRED',['R3','R2'])]);
    expect(selectMatterDocumentSources(data.matter).map(source => source.document.documentVersionId)).toEqual(['R3','R4','R2']);
    expect(matterDocumentSourceLabel(selectMatterDocumentSources(data.matter)[0])).toBe('R3');
    const graph = buildSuiteMatterGraph(data);
    expect([...graph.targets.values()].filter(target => target.kind === 'material' || target.kind === 'document')).toHaveLength(5);
  });
  it('does not convert an unacquired expected identity or basis citation into an acquired source', () => {
    const data = read([{...member('R3'), disposition: 'EXCLUDED'}, {...expected('NOT_ACQUIRED', ['bad-fulfilled']), basis: [{documentVersionId:'basis-only',sourceRefId:'ref'}]}]);
    expect(selectMatterDocumentSources(data.matter)).toEqual([]);
    expect([...buildSuiteMatterGraph(data).targets.values()].filter(target => target.kind === 'document')).toEqual([]);
  });
  it('does not resurrect an excluded material from the legacy catalog', () => {
    const data = read([{...member('R3'),disposition:'EXCLUDED'}]);
    data.matter.catalog.entries = [{document:{documentVersionId:'R3'},documentCurrentness:{familyId:'family-a'}}] as typeof data.matter.catalog.entries;
    expect(selectMatterDocumentSources(data.matter)).toEqual([]);
  });
  it('uses legacy catalog metadata without inventing WorkItem navigation for native materials', () => {
    const data = read([member('R3')]);
    data.matter.catalog.entries = [{workItemId:'WI',document:{documentVersionId:'R2',documentCode:'SB',businessRevision:'2'},documentCurrentness:{familyId:'family-a'}}] as typeof data.matter.catalog.entries;
    const sources = selectMatterDocumentSources(data.matter);
    expect(sources.map(source => source.document.documentVersionId)).toEqual(['R3','R2']);
    expect(sources[0].catalogEntry).toBeUndefined();
    expect(sources[1].catalogEntry?.workItemId).toBe('WI');
    expect(matterDocumentSourceLabel(sources[1])).toBe('SB · 2');
  });
  it('fails closed for conflicting family identities instead of choosing the last record', () => {
    expect(() => selectMatterDocumentSources(read([member('R3'),member('R3','other')]).matter)).toThrow('身份冲突');
  });
  it('never injects current material into an exact saved work graph', () => {
    const data = read([member('today-only')]);
    const revision = data.working.current!;
    const graph = buildSuiteMatterGraph(data, {workRef:revision.matterWorkRevisionId,revision});
    expect([...graph.targets.values()].some(target => target.kind === 'material' || target.kind === 'document')).toBe(false);
  });
  it('rejects conflicting legacy identities even when one matches the native material', () => {
    const data = read([member('R3')]);
    data.matter.catalog.entries = [
      {document:{documentVersionId:'R3'},documentCurrentness:{familyId:'other'}},
      {document:{documentVersionId:'R3'},documentCurrentness:{familyId:'family-a'}},
    ] as typeof data.matter.catalog.entries;
    expect(() => selectMatterDocumentSources(data.matter)).toThrow('身份冲突');
  });

});
