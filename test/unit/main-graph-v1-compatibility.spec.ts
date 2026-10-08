import { activityReadingReturnParams, readingReturnTarget } from '@client/src/features/matter/reading-return';
import { activateLibraryGraphReturnSession, readLibraryGraphReturn, saveLibraryGraphReturn } from '@client/src/pages/RelationGraphPage/library-graph-return-memory';
import { libraryGraphReturnToken } from '@client/src/pages/RelationGraphPage/suite-graph-return';
import { readDocumentActivityReading, invalidateCanonicalHostClientSession } from '@client/src/api/canonical-host';
import { buildSuiteGraphPresentation } from '@client/src/pages/RelationGraphPage/suite-graph-presentation';
import { documentGraphReadingParams, readGraphReadingState } from '@client/src/pages/RelationGraphPage/suite-graph-return';
import { suiteGraphSourceEventId } from '@client/src/pages/RelationGraphPage/suite-graph-timeline';
import type { SuiteGraphMatter } from '@client/src/pages/RelationGraphPage/suite-graph-model';

const mockRequest = jest.fn();
jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({ axiosForBackend: (input: unknown) => mockRequest(input) }));
jest.mock('@lark-apaas/client-toolkit/logger', () => ({ logger: { error: jest.fn() } }));
jest.mock('@lark-apaas/client-toolkit/utils/resolveAppUrl', () => ({ resolveAppUrl: (url: string) => url }));

beforeEach(() => { mockRequest.mockReset(); invalidateCanonicalHostClientSession(); });

function reading() {
  return { familyId: 'family-r3', binding: { documentVersionId: 'dv-r3', parseRunId: 'parse-r3' },
    candidate: { candidateOnly: true, schemaVersion: 'wiselink.document.activity-candidate.v1', candidateRevision: 7, runRef: 'run-r3',
      sourceBinding: { original: { documentVersionId: 'dv-r3', parseRunId: 'parse-r3' } }, statements: [] } };
}

it('reads exact historical v1 activity through the unchanged main API without schema-v2 opt-in', async () => {
  const data = reading(); const signal = new AbortController().signal;
  mockRequest.mockResolvedValue({ status: 200, data });
  expect(await readDocumentActivityReading({ documentVersionId: 'dv-r3', parseRunId: 'parse-r3', candidateRevision: 7 }, signal)).toBe(data);
  const request = mockRequest.mock.calls[0][0];
  const url = new URL(request.url, 'https://example.test');
  expect(url.pathname).toBe('/api/document-management/document-versions/dv-r3/activity-reading');
  expect([...url.searchParams]).toEqual([['parseRunId', 'parse-r3'], ['candidateRevision', '7']]);
  expect(request.signal).toBe(signal);
  expect(url.searchParams.has('acceptCandidateSchemaV2')).toBe(false);
});

it('keeps main exact-candidate binding rejection after the new graph integration', async () => {
  const data = reading(); data.candidate.candidateRevision = 8;
  mockRequest.mockResolvedValue({ status: 200, data });
  await expect(readDocumentActivityReading({ documentVersionId: 'dv-r3', parseRunId: 'parse-r3', candidateRevision: 7 }))
    .rejects.toThrow('DOCUMENT_ACTIVITY_READING_BINDING_MISMATCH');
});

function graph(rootKind: SuiteGraphMatter['rootKind'] = 'matter'): SuiteGraphMatter {
  return { id: 'root', title: 'Root', rootKind,
    groups: [{ key: 'documents', title: 'Documents', items: [{ id: 'old-r3', title: 'R3' }, { id: 'current-r4', title: 'R4' }] }],
    relations: [
      { id: 'r1', source: 'root', target: 'old-r3', type: 'contains', label: 'registered' },
      { id: 'r2', source: 'root', target: 'current-r4', type: 'contains', label: 'registered' },
    ] };
}

it('preserves the exact old-main bundle ID for relations without new semantics', () => {
  const presentation = buildSuiteGraphPresentation(graph());
  const bundles = presentation.elements.filter(element => element.group === 'edges' && element.data.viewKind === 'bundle');
  expect(bundles.map(element => element.data.id)).toEqual(['sg:bundle:["r1","r2"]']);
  expect(bundles[0].data.relationshipIds).toEqual(['r1', 'r2']);
  expect(presentation.visibleIds).toEqual(['root', 'old-r3', 'current-r4']);
});

it('separates explicit document semantics while preserving legacy bundle grouping and IDs', () => {
  const input = graph('document');
  input.relations.push({ id: 'candidate', source: 'root', target: 'current-r4', type: 'REFERENCE_CANDIDATE', label: 'candidate',
    authority: 'CANDIDATE_ONLY', currentness: 'UNKNOWN' });
  const presentation = buildSuiteGraphPresentation(input);
  const hub = presentation.elements.find(element => element.data.viewKind === 'hub');
  expect(hub?.data).toMatchObject({ businessId: 'root', rootKind: 'document', virtual: false });
  const bundles = presentation.elements.filter(element => element.group === 'edges' && element.data.viewKind === 'bundle');
  expect(bundles.map(element => element.data.id)).toEqual(['sg:bundle:["r1","r2"]', 'sg:bundle:["candidate"]']);
  expect(bundles[1].data).toMatchObject({ authority: 'CANDIDATE_ONLY', currentness: 'UNKNOWN', relationshipIds: ['candidate'] });
});

it('preserves v1 event selection and exact pins in document returns, without accepting v2 time-suffixed identities', () => {
  const pins = { documentVersionId: 'dv-r3', familyId: 'family-r3', parseRunId: 'parse-r3', candidateRevision: 7,
    runRef: 'run-r3', statementId: 's1', anchorId: 'a1' };
  const eventId = suiteGraphSourceEventId(pins);
  expect(JSON.parse(eventId)).toEqual(['event', 'dv-r3', 'parse-r3', '7', 'run-r3', 's1']);
  const state = readGraphReadingState(documentGraphReadingParams('dv-r3', 'wi-r3', { eventId, eventPins: pins }));
  expect(state).toMatchObject({ eventId, eventPins: pins });
  const suffixed = JSON.stringify([...JSON.parse(eventId), 'time', '0']);
  const v2State = readGraphReadingState(documentGraphReadingParams('dv-r3', 'wi-r3', { eventId: suffixed, eventPins: pins }));
  expect(v2State.eventPins).toBeUndefined();
});


it('preserves exact macro→R3 neighborhood→v1 timeline→original→timeline→neighborhood→macro return identities', () => {
  activateLibraryGraphReturnSession(1, true);
  const macro = { query: 'scope=library&level=versions&familyId=family-r3&cursor=exact-page&selectedId=library%3Aversion%3Adv-r3&displaySession=1',
    parent: 'scope=library&level=families&groupBy=ata&clusterValue=20&search=737', root: 'scope=library&groupBy=ata&search=737' };
  const token = saveLibraryGraphReturn(macro, 1)!;
  const pins = { documentVersionId: 'dv-r3', familyId: 'family-r3', parseRunId: 'parse-r3', candidateRevision: 7,
    runRef: 'run-r3', statementId: 's1', anchorId: 'a1' };
  const document = documentGraphReadingParams('dv-r3', 'wi-r3', { selectedId: 'document:dv-r3',
    eventId: suiteGraphSourceEventId(pins), eventPins: pins, viewport: {zoom: 1.2, pan: {x: 7, y: 9}} });
  document.set('returnLibrarySnapshot', token);
  const timeline = new URLSearchParams({ documentVersionId: 'dv-r3', familyId: 'family-r3', parseRunId: 'parse-r3',
    candidateRevision: '7', runRef: 'run-r3', statementId: 's1', anchor: 'a1',
    returnGraphQuery: document.toString(), returnDocumentVersionId: 'dv-r3', returnGraphParseRunId: 'parse-r3' });
  const original = activityReadingReturnParams(timeline.toString(), 'dv-r3', 'timeline');
  const timelineBack = readingReturnTarget(original, 'dv-r3', 'parse-r3')!;
  expect(timelineBack.route).toContain('/timeline?');
  const timelineRestored = new URL(timelineBack.route, 'https://example.test');
  expect(timelineRestored.searchParams.get('candidateRevision')).toBe('7');
  expect(timelineRestored.searchParams.get('runRef')).toBe('run-r3');
  expect(timelineRestored.searchParams.get('statementId')).toBe('s1');
  const neighborhoodBack = readingReturnTarget(timelineRestored.searchParams, 'dv-r3', 'parse-r3')!;
  const neighborhood = new URL(neighborhoodBack.route, 'https://example.test').searchParams;
  expect(neighborhood.get('scope')).toBe('document');
  expect(neighborhood.get('documentVersionId')).toBe('dv-r3');
  expect(neighborhood.get('readerWorkItemId')).toBe('wi-r3');
  expect(readGraphReadingState(neighborhood).eventPins).toEqual(pins);
  expect(readGraphReadingState(neighborhood).viewport).toEqual({zoom: 1.2, pan: {x: 7, y: 9}});
  expect(readLibraryGraphReturn(libraryGraphReturnToken(neighborhood)!, 1)).toEqual(macro);
  expect(readingReturnTarget(original, 'dv-r4', 'parse-r3')).toBeNull();
  expect(readingReturnTarget(original, 'dv-r3', 'current-parse')).toBeNull();
});
