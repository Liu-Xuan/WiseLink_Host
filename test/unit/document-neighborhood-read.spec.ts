import { bindDocumentReferenceRead, readDocumentNeighborhood } from '@client/src/pages/RelationGraphPage/document-neighborhood-read';
import { buildDocumentNeighborhood, documentNeighborhoodNodeId } from '@client/src/pages/RelationGraphPage/suite-document-neighborhood';
import { buildSuiteGraphPresentation } from '@client/src/pages/RelationGraphPage/suite-graph-presentation';
import { documentStatus, documentQuicklook, referencePreview, referenceMention, familyPage, mattersPage } from './fixtures/document-neighborhood';
jest.mock('@client/src/api/canonical-host', () => ({ readDocumentParsingStatus: jest.fn(), getCanonicalLibraryQuicklook: jest.fn(),
  getCanonicalLibraryTasks: jest.fn(), getRelatedContextPreview: jest.fn(),
  isCanonicalObjectNotFound: (reason: {statusCode?: number}) => reason?.statusCode === 404,
  summarizeCanonicalDocumentReadFailure: (reason: {statusCode?: number}) => ({statusCode: reason?.statusCode}),
}));
jest.mock('@client/src/api/engineering-matter', () => ({getEngineeringMatterDirectory: jest.fn()}));
const api = jest.requireMock('@client/src/api/canonical-host');
const matterApi = jest.requireMock('@client/src/api/engineering-matter');
const request = {documentVersionId: 'dv-r3', readerWorkItemId: 'wi-r3'};
const read = () => readDocumentNeighborhood(request, new AbortController().signal);
beforeEach(() => {
  jest.clearAllMocks();
  api.readDocumentParsingStatus.mockResolvedValue(documentStatus());
  api.getCanonicalLibraryQuicklook.mockResolvedValue(documentQuicklook());
  api.getCanonicalLibraryTasks.mockResolvedValue(familyPage());
  api.getRelatedContextPreview.mockResolvedValue(referencePreview());
  matterApi.getEngineeringMatterDirectory.mockResolvedValue(mattersPage());
});
it('uses exact DV/WorkItem/family reads with bounded pages and no whole-library join', async () => {
  const data = await read();
  expect(api.readDocumentParsingStatus).toHaveBeenCalledWith('dv-r3', expect.any(AbortSignal));
  expect(api.getCanonicalLibraryQuicklook).toHaveBeenCalledWith('wi-r3', expect.any(AbortSignal));
  expect(api.getCanonicalLibraryTasks).toHaveBeenCalledWith({familyId:'family-a',limit:20,cursor:undefined}, expect.any(AbortSignal));
  expect(matterApi.getEngineeringMatterDirectory).toHaveBeenCalledWith({workItemId:'wi-r3',limit:20,cursor:undefined}, expect.any(AbortSignal));
  expect(api.getRelatedContextPreview).toHaveBeenCalledWith('wi-r3',5,expect.any(AbortSignal));
  expect(data.document.documentVersionId).toBe('dv-r3');
});
it('does not treat number-only current R4 resolution as an R3 citation; independent occurrences and receipts survive', async () => {
  const graph = buildDocumentNeighborhood(await read());
  const center = documentNeighborhoodNodeId('dv-r3'), current = documentNeighborhoodNodeId('ftd-r4');
  expect(graph.graph.relations.some(edge => edge.source === center && edge.target === current)).toBe(false);
  const occurrences = graph.graph.relations.filter(edge => edge.type === 'REFERENCE_OCCURRENCE');
  expect(occurrences).toHaveLength(2);
  expect(occurrences.every(edge => edge.authority === 'SOURCE_EXPLICIT')).toBe(true);
  const candidates = graph.graph.relations.filter(edge => edge.type === 'REFERENCE_RESOLUTION_CANDIDATE');
  expect(candidates).toHaveLength(2);
  expect(candidates.every(edge => edge.authority === 'CANDIDATE_ONLY' && edge.currentness === 'UNKNOWN')).toBe(true);
  expect(graph.relations.get(occurrences[0].id)?.receipt?.snapshotRef).toBe('receipt-a');
  expect(graph.relations.get(occurrences[1].id)?.mention?.sourceRefIds).toEqual(['source-2']);
  const presentation = buildSuiteGraphPresentation(graph.graph, {relationMode:'individual',density:6});
  expect(presentation.omittedRelationships).toEqual([]);
  expect(presentation.counts.represented.businessRelationships).toBe(graph.graph.relations.length);
  expect(presentation.elements.find(e => e.group === 'nodes' && e.data.viewKind === 'hub')?.data)
    .toMatchObject({rootKind:'document',businessId:center,virtual:false});
});
it.each(['DENIED','NOT_CHECKED'] as const)('keeps only source occurrences for %s target resolution', async permission => {
  const p = referencePreview(); p.mentions.forEach(m => {m.permissionState = permission;}); api.getRelatedContextPreview.mockResolvedValue(p);
  const graph = buildDocumentNeighborhood(await read());
  expect(graph.targets.has(documentNeighborhoodNodeId('ftd-r4'))).toBe(false);
  expect(graph.graph.relations.filter(e => e.type === 'REFERENCE_OCCURRENCE')).toHaveLength(2);
});
it('supports native DV-only center and marks missing WorkItem-reference scope explicitly', async () => {
  const data = await readDocumentNeighborhood({documentVersionId:'dv-r3'}, new AbortController().signal);
  expect(data.references).toBeNull(); expect(data.matters).toBeNull();
  expect(api.getCanonicalLibraryQuicklook).not.toHaveBeenCalled(); expect(api.getRelatedContextPreview).not.toHaveBeenCalled();
  expect(matterApi.getEngineeringMatterDirectory).not.toHaveBeenCalled();
  expect(data.notices.join('')).toContain('暂无关联阅读工作');
});
it('deduplicates same-family versions but never joins unrelated objects from text similarity', async () => {
  const p = familyPage(); p.items.push({...p.items[1],workItemId:'another-task-same-dv'});api.getCanonicalLibraryTasks.mockResolvedValue(p);
  const graph = buildDocumentNeighborhood(await read());
  expect(graph.graph.relations.filter(e => e.type === 'HAS_VERSION')).toHaveLength(2);
  expect(graph.graph.relations.filter(e => e.type === 'WORK_ITEM_MEMBERSHIP')).toHaveLength(3);
  p.items[1].familyId='different-family'; await expect(read()).rejects.toThrow('同族版本页范围不一致');
});
it('bounds retained reference data and exposes missing server pagination', async () => {
  const p = referencePreview();p.mentions=Array.from({length:300},(_,i)=>referenceMention(i));p.totalMentionCount=300;
  api.getRelatedContextPreview.mockResolvedValue(p);const data=await read();
  expect(data.references?.mentions).toHaveLength(40);expect(data.notices.join('')).toContain('当前显示 40 / 300 条引用出现位置');
  expect(buildDocumentNeighborhood(data).graph.groups.flatMap(g=>g.items).length).toBeLessThanOrEqual(64);
});
it('keeps empty separate from unavailable/partial', async () => {
  api.getRelatedContextPreview.mockRejectedValue(new Error('network'));
  api.getCanonicalLibraryTasks.mockResolvedValue({...familyPage(),items:[]});
  const data=await read();expect(data.references).toBeNull();expect(data.family?.items).toEqual([]);
  expect(data.notices.join('')).toContain('不宣称无引用');
});
it.each([401,403,404])('fails closed on branch authorization status %s', async statusCode => {
  api.getRelatedContextPreview.mockRejectedValue({statusCode}); await expect(read()).rejects.toEqual({statusCode});
});
it('rejects crossed exact document and WorkItem bindings before references or directory reads', async () => {
  api.getCanonicalLibraryQuicklook.mockResolvedValue(documentQuicklook('dv-r4'));
  await expect(read()).rejects.toThrow('未替换所选版本');
  expect(api.getRelatedContextPreview).not.toHaveBeenCalled();expect(matterApi.getEngineeringMatterDirectory).not.toHaveBeenCalled();
});
it.each(['documentVersionId','revision','snapshot-work','snapshot-revision','snapshot-document','mention-document'])('rejects preview binding drift: %s', field => {
  const p=referencePreview();
  if(field==='documentVersionId')p.documentVersionId='wrong';
  if(field==='revision')p.revision=6;
  if(field==='snapshot-work')p.snapshot.workItemRef='other';
  if(field==='snapshot-revision')p.snapshot.inputRevision=6;
  if(field==='snapshot-document')p.snapshot.primaryDocumentVersionRef='other';
  if(field==='mention-document')p.mentions[0].primaryDocumentVersionRef='other';
  expect(()=>bindDocumentReferenceRead(p,documentQuicklook())).toThrow('不一致');
});
