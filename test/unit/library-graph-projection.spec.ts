import type { CanonicalLibraryGraphResponse } from '@shared/library-graph.interface';
import { readLibraryGraphEntry, libraryGraphReadingParams } from '@client/src/pages/RelationGraphPage/library-graph-route';
import { buildLibraryGraphPresentation } from '@client/src/pages/RelationGraphPage/suite-library-graph';
import { validateLibraryGraphPage } from '@client/src/pages/RelationGraphPage/library-graph-read';
jest.mock('@client/src/api/canonical-host', () => ({}));
const base = {scope:'TENANT_DOCUMENT_CATALOG',versionMeaning:'ALL_READABLE_VERSIONS',consistency:'LIVE_READ',relationMeaning:'CLASSIFICATION_AND_CONTAINMENT_ONLY',coverage:{documentReferences:'NOT_INDEXED',matterMemberships:'NOT_LOADED'},counts:{uniqueFamilyCount:12000,readableVersionCountInMatchingFamilies:50000},limit:50,hasMore:true,nextCursor:'next',fileReadPerformed:false,modelRunPerformed:false} as const;
const page:CanonicalLibraryGraphResponse = {...base,level:'clusters',groupBy:'ata',filters:{},countScope:'FILTERED_FAMILIES',clusterCountsOverlap:true,items:Array.from({length:50},(_,i) => ({kind:'CLASSIFICATION',value:String(i),uniqueFamilyCount:500,readableVersionCountInMatchingFamilies:2000}))};
it('keeps 50k aggregate counts but only 50 native cluster points and no invented connections', () => {
  const p = buildLibraryGraphPresentation(page);
  expect(p.elements).toHaveLength(50);expect(p.elements.every(e => e.group === 'nodes' && e.data.nativePoint)).toBe(true);
  expect(p.counts.shown.cards).toBe(0);expect(p.counts.represented.businessRelationships).toBe(0);
});
it('bounds families and versions at 51 native nodes and 50 display-only edges', () => {
  const families:CanonicalLibraryGraphResponse = {...base,level:'families',groupBy:'ata',clusterValue:'20',filters:{},countScope:'FILTERED_CLUSTER_FAMILIES',items:Array.from({length:50},(_,i) => ({kind:'FAMILY',familyId:`f-${i}`,documentId:`d-${i}`,documentCode:`SB-${i}`,normalizedFamily:'SB',readableVersionCount:1000}))};
  const versions:CanonicalLibraryGraphResponse = {...base,level:'versions',familyId:'f-old',countScope:'SELECTED_FAMILY_FRESH_READ',items:Array.from({length:50},(_,i) => ({kind:'VERSION',documentVersionId:`dv-${i}`,businessRevision:`R${i}`,committedAt:'2026-10-01',isCurrent:i === 49}))};
  for (const p of [families,versions].map(buildLibraryGraphPresentation)) {
    expect(p.elements.filter(e => e.group === 'nodes')).toHaveLength(51);
    expect(p.elements.filter(e => e.group === 'edges')).toHaveLength(50);
    expect(p.elements.filter(e => e.group === 'edges').every(e => e.classes?.includes('display-edge') && e.data.relationMeaning === 'CLASSIFICATION_AND_CONTAINMENT_ONLY')).toBe(true);
  }
});
it('replaces 30 drill/back cycles without changing the active page bound', () => {
  for (let i=0;i<30;i++) expect(buildLibraryGraphPresentation(page).elements).toHaveLength(50);
  expect(() => buildLibraryGraphPresentation({...page,items:[...page.items,page.items[0]]})).toThrow('UNBOUNDED');
});
it('keeps missing and literal empty classification distinct; strips filters on selected-family versions', () => {
  expect(readLibraryGraphEntry(new URLSearchParams('scope=library&level=families&clusterMissing=true'))).toEqual({kind:'library',request:{level:'families',groupBy:'ata',clusterValue:null,limit:50}});
  expect(readLibraryGraphEntry(new URLSearchParams('scope=library&level=families&clusterValue='))).toEqual({kind:'library',request:{level:'families',groupBy:'ata',clusterValue:'',limit:50}});
  const query = libraryGraphReadingParams({level:'versions',familyId:'old-family'});
  expect(query.has('ata')).toBe(false);expect(query.has('groupBy')).toBe(false);
  expect(readLibraryGraphEntry(query)).toEqual({kind:'library',request:{level:'versions',familyId:'old-family',limit:50}});
});
it.each(['scope=library&cursor=', 'scope=library&cursor=space+cursor', 'scope=library&groupBy=unknown',
  'scope=library&search=x&search=y','scope=library&fleetModel=737','scope=library&fleetFamily=737&aircraftModel=737',
  'scope=library&level=families&clusterMissing=false','scope=library&level=families&clusterMissing=true&clusterValue=',
  'scope=library&workItemId=w','scope=library&readerWorkItemId=w','scope=library&window=w'])('fails closed for invalid or ambiguous macro route %s', query => {
  expect(readLibraryGraphEntry(new URLSearchParams(query)).kind).toBe('invalid');
});
it('rejects an oversized or wrong-scope response before showing any partial graph', () => {
  expect(validateLibraryGraphPage(page,{level:'clusters',groupBy:'ata',limit:50})).toBe(page);
  expect(() => validateLibraryGraphPage({...page,items:[...page.items,page.items[0]]},{level:'clusters',groupBy:'ata',limit:50})).toThrow('RESPONSE_INVALID');
  expect(() => validateLibraryGraphPage({...page,coverage:{...page.coverage,documentReferences:'COMPLETE' as never}},{level:'clusters',groupBy:'ata',limit:50})).toThrow('RESPONSE_INVALID');
});

it('accepts an exact reader navigation hint but rejects malformed or empty reader identities', () => {
  const request = { level: 'versions' as const, familyId: 'f', limit: 50 };
  const versionPage: CanonicalLibraryGraphResponse = { ...base, limit: 50, hasMore: false, nextCursor: null,
    level: 'versions', familyId: 'f', countScope: 'SELECTED_FAMILY_FRESH_READ',
    items: [{ kind: 'VERSION', documentVersionId: 'dv-r3', businessRevision: 'R3', committedAt: '2026-10-01', isCurrent: false,
      readerWorkItemId: 'wi-r3' }] };
  expect(validateLibraryGraphPage(versionPage, request)).toBe(versionPage);
  for (const readerWorkItemId of ['', 'x'.repeat(97), 'bad\u0000id', null]) {
    expect(() => validateLibraryGraphPage({ ...versionPage,
      items: [{ ...versionPage.items[0], readerWorkItemId } as never] }, request)).toThrow('RESPONSE_INVALID');
  }
});
