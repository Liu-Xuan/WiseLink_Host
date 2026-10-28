import { readingReturnTarget } from '@client/src/features/matter/reading-return';

const ORIGIN = 'DV-SB-R01', TARGET = 'DV-AEO-R00';
const ORIGIN_QUERY = new URLSearchParams({ kind: 'sources', documentVersionId: ORIGIN,
  normalizedFamily: 'SB', query: 'SB-1', after: 'sb-page-2', listY: '120', articleY: '45' });
function intent(): URLSearchParams {
  return new URLSearchParams({ returnKnowledgeQuery: ORIGIN_QUERY.toString(),
    returnKnowledgeOriginDocumentVersionId: ORIGIN, returnDocumentVersionId: TARGET });
}
function read(params: URLSearchParams, target = TARGET, path = `/document-versions/${TARGET}`) {
  return readingReturnTarget(params, target, null, undefined, undefined, path);
}

it('binds the reader to the target and returns to the distinct original Wiki selection', () => {
  const target = read(intent());
  expect(target?.label).toBe('返回工程知识');
  const route = new URL(target!.route, 'https://example.test');
  expect(route.pathname).toBe('/knowledge');
  expect(Object.fromEntries(route.searchParams)).toEqual(Object.fromEntries(ORIGIN_QUERY));
});

const invalid: Array<{ name: string; change(params: URLSearchParams): void }> = [
  { name: 'blank origin', change: params => { params.set('returnKnowledgeOriginDocumentVersionId', ''); } },
  { name: 'whitespace origin', change: params => { params.set('returnKnowledgeOriginDocumentVersionId', ` ${ORIGIN}`); } },
  { name: 'duplicate origin', change: params => { params.append('returnKnowledgeOriginDocumentVersionId', ORIGIN); } },
  { name: 'missing target', change: params => { params.delete('returnDocumentVersionId'); } },
  { name: 'blank target', change: params => { params.set('returnDocumentVersionId', ''); } },
  { name: 'duplicate target', change: params => { params.append('returnDocumentVersionId', TARGET); } },
  { name: 'missing Wiki intent', change: params => { params.delete('returnKnowledgeQuery'); } },
  { name: 'duplicate Wiki intent', change: params => { params.append('returnKnowledgeQuery', ORIGIN_QUERY.toString()); } },
  { name: 'wrong origin pin', change: params => { params.set('returnKnowledgeQuery', 'kind=sources&documentVersionId=OTHER'); } },
  { name: 'missing origin pin', change: params => { params.set('returnKnowledgeQuery', 'kind=sources'); } },
  { name: 'duplicate origin pin', change: params => { params.set('returnKnowledgeQuery', `kind=sources&documentVersionId=${ORIGIN}&documentVersionId=${ORIGIN}`); } },
  { name: 'wrong Wiki kind', change: params => { params.set('returnKnowledgeQuery', `kind=works&documentVersionId=${ORIGIN}`); } },
  { name: 'implicit Wiki kind', change: params => { params.set('returnKnowledgeQuery', `documentVersionId=${ORIGIN}`); } },
  { name: 'saved-work identity', change: params => { params.set('returnKnowledgeQuery', `${ORIGIN_QUERY}&subjectKind=WORK_ITEM&subjectId=W&workRef=R`); } },
  { name: 'unknown nested key', change: params => { params.set('returnKnowledgeQuery', `${ORIGIN_QUERY}&writeIntent=1`); } },
];
it.each(invalid)('rejects $name instead of falling into another return mode', ({ change }) => {
  const params = intent(); change(params);
  expect(read(params)).toBeNull();
});

it.each(['returnLibraryQuery', 'returnGraphQuery', 'returnWikiGuideQuery', 'returnMatterId',
  'returnWorkItemId', 'returnUnknownDestination'])('rejects mixed %s intent before old branches', key => {
  const params = intent(); params.set(key, 'unexpected');
  expect(read(params)).toBeNull();
});
it.each(['/library', `/document-versions/OTHER`, `/document-versions/${TARGET}/activities`, ''])
  ('rejects a foreign or missing document path %s', path => {
    expect(read(intent(), TARGET, path)).toBeNull();
  });
it('rejects a different current document despite otherwise matching URL pins', () => {
  expect(read(intent(), 'OTHER')).toBeNull();
});
it('preserves the original same-document rule for links without an origin marker', () => {
  const params = intent(); params.delete('returnKnowledgeOriginDocumentVersionId');
  expect(read(params)).toBeNull();
  params.set('returnDocumentVersionId', ORIGIN);
  expect(read(params, ORIGIN, `/document-versions/${ORIGIN}`)?.route)
    .toContain(`documentVersionId=${ORIGIN}`);
  expect(read(params, TARGET)).toBeNull();
});
