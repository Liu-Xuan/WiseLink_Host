import { activateLibraryGraphReturnSession, readLibraryGraphReturn, saveLibraryGraphReturn } from '@client/src/pages/RelationGraphPage/library-graph-return-memory';
import { libraryGraphReadingParams } from '@client/src/pages/RelationGraphPage/library-graph-route';
import { documentGraphReadingParams, graphReturnTarget, libraryGraphReturnToken, withGraphReturn } from '@client/src/pages/RelationGraphPage/suite-graph-return';
import { libraryReadingParams, readingReturnTarget } from '@client/src/features/matter/reading-return';
beforeEach(() => activateLibraryGraphReturnSession(1,true));
it('preserves a long exact macro page through selected-document source return without enlarging the existing source URL budget', () => {
  const query=libraryGraphReadingParams({level:'versions',familyId:'f-r3',cursor:'x'.repeat(8192),limit:50},{selectedId:'library:version:old-r3',viewport:{zoom:1.4,pan:{x:33,y:44}}},1).toString();
  const parent=libraryGraphReadingParams({level:'families',groupBy:'ata',clusterValue:'20',search:'737',limit:50}).toString();
  const root=libraryGraphReadingParams({level:'clusters',groupBy:'ata',search:'737',limit:50}).toString();
  const token=saveLibraryGraphReturn({query,parent,root},1)!;
  const doc=documentGraphReadingParams('old-r3',undefined,{});doc.set('returnLibrarySnapshot',token);
  const updated=documentGraphReadingParams('old-r3',undefined,{selectedId:'doc-old-r3'},doc);
  const source=withGraphReturn('/document-versions/old-r3',updated);
  expect(source.length).toBeLessThan(12000);
  const target=graphReturnTarget(new URLSearchParams(source.split('?')[1]),'old-r3',null)!;
  expect(target.route).toContain('scope=document');expect(target.route).toContain('documentVersionId=old-r3');
  const returned=new URLSearchParams(target.route.split('?')[1]);
  expect(libraryGraphReturnToken(returned)).toBe(token);expect(readLibraryGraphReturn(token,1)).toEqual({query,parent,root});
});
it('never restores another session and clears old snapshots when authorization changes', () => {
  const token=saveLibraryGraphReturn({query:'scope=library'},1)!;
  expect(readLibraryGraphReturn(token,2)).toBeNull();expect(readLibraryGraphReturn(token,1)).toBeNull();
  const second=saveLibraryGraphReturn({query:'scope=library'},1)!;
  activateLibraryGraphReturnSession(1,true);expect(readLibraryGraphReturn(second,1)).toBeNull();
});
it('caps snapshots at eight entries, expires them and returns detached display state', () => {
  const tokens=Array.from({length:9},() => saveLibraryGraphReturn({query:'scope=library'},1)!);
  expect(readLibraryGraphReturn(tokens[0],1)).toBeNull();
  const saved=readLibraryGraphReturn(tokens[8],1)!;saved.query='scope=library&search=changed';
  expect(readLibraryGraphReturn(tokens[8],1)!.query).toBe('scope=library');
  const now=Date.now();const spy=jest.spyOn(Date,'now').mockReturnValue(now+31*60*1000);
  try {expect(readLibraryGraphReturn(tokens[8],1)).toBeNull();} finally {spy.mockRestore();}
});
it('rejects malformed, unbounded and mixed identity return intent', () => {
  expect(saveLibraryGraphReturn({query:'scope=library&documentVersionId=secret'},1)).toBeUndefined();
  expect(saveLibraryGraphReturn({query:'scope=library',parent:'scope=document&documentVersionId=dv'},1)).toBeUndefined();
  expect(libraryGraphReturnToken(new URLSearchParams('returnLibrarySnapshot=arbitrary'))).toBeNull();
  const token=saveLibraryGraphReturn({query:'scope=library'},1)!;
  expect(libraryGraphReturnToken(new URLSearchParams(`returnLibrarySnapshot=${token}&returnLibrarySnapshot=${token}`))).toBeNull();
});

it('keeps an exact directory return through graph view replacement and an original-source round trip', () => {
  const directory = libraryReadingParams(new URLSearchParams({ mode: 'document', familyId: 'family-r3',
    selectedDocumentVersionId: 'old-r3', search: '737-SL-34-258', normalizedFamily: 'SL',
    ata2: '34', ata4: '3462', aircraftModels: JSON.stringify(['737-700', '737-800']),
    listY: '735', quicklookY: '81', expandedFamilyIds: 'family-r3,another-family' }));
  const origin = new URLSearchParams({ returnDocumentVersionId: 'old-r3', returnLibraryQuery: directory.toString() });
  const graph = documentGraphReadingParams('old-r3', 'wi-r3', {}, origin);
  const updated = documentGraphReadingParams('old-r3', 'wi-r3', {
    selectedId: 'another-registered-version', density: 3, viewport: { zoom: .8, pan: { x: 22, y: 33 } },
  }, graph);
  const source = new URL(withGraphReturn('/document-versions/old-r3', updated), 'https://example.test');
  const back = graphReturnTarget(source.searchParams, 'old-r3')!;
  const returned = new URL(back.route, 'https://example.test').searchParams;
  expect(returned.get('returnDocumentVersionId')).toBe('old-r3');
  expect(returned.get('readerWorkItemId')).toBe('wi-r3');
  expect(returned.get('returnLibraryQuery')).toBe(directory.toString());
  expect(readingReturnTarget(returned, 'old-r3')?.route).toBe(`/library?${directory}`);
});

it.each(['duplicate', 'unbounded', 'conflicting', 'wrong-version', 'empty'] as const)(
  'keeps %s directory return intent rejected after graph view replacement', kind => {
    const origin = new URLSearchParams({ returnLibraryQuery: 'mode=document&selectedDocumentVersionId=old-r3',
      returnDocumentVersionId: 'old-r3' });
    if (kind === 'duplicate') origin.append('returnLibraryQuery', origin.get('returnLibraryQuery')!);
    if (kind === 'unbounded') origin.set('returnLibraryQuery', 'x'.repeat(8193));
    if (kind === 'conflicting') origin.set('returnWorkItemId', 'foreign-work');
    if (kind === 'wrong-version') origin.set('returnDocumentVersionId', 'another-version');
    if (kind === 'empty') origin.set('returnLibraryQuery', '');
    const graph = documentGraphReadingParams('old-r3', 'wi-r3', { density: 4 }, origin);
    expect(graph.has('returnLibraryQuery')).toBe(true);
    expect(readingReturnTarget(graph, 'old-r3')).toBeNull();
  },
);

const malformedDocumentGraphDirectories: Array<[string, string]> = [
  ['absolute URL', 'https://example.invalid/library?selectedDocumentVersionId=old-r3'],
  ['duplicate selection', 'mode=document&familyId=family-r3&selectedDocumentVersionId=old-r3&selectedDocumentVersionId=other-r4'],
  ['empty selection', 'mode=document&selectedDocumentVersionId='],
  ['illegal selection', 'mode=document&selectedDocumentVersionId=old-r3%0A'],
  ['matter domain', 'mode=matter&selectedMatterId=matter-a'],
  ['task domain', 'mode=tasks&workItemId=wi-r3'],
  ['mixed domain', 'mode=document&selectedDocumentVersionId=old-r3&selectedMatterId=matter-a'],
  ['nested return conflict', 'mode=document&selectedDocumentVersionId=old-r3&returnWorkItemId=foreign-work'],
];
it.each(malformedDocumentGraphDirectories)(
  'document graph nested directory rejects %s through view and source replacements',
  (_kind: string, raw: string) => {
    const origin: URLSearchParams = new URLSearchParams({
      returnDocumentVersionId: 'old-r3', returnLibraryQuery: raw,
    });
    const graph: URLSearchParams = documentGraphReadingParams('old-r3', 'wi-r3', {}, origin);
    const updated: URLSearchParams = documentGraphReadingParams('old-r3', 'wi-r3', { density: 4 }, graph);
    expect(updated.get('returnLibraryQuery')).toBe(raw);
    expect(readingReturnTarget(graph, 'old-r3')).toBeNull();
    expect(readingReturnTarget(updated, 'old-r3')).toBeNull();
    const source: URL = new URL(withGraphReturn('/document-versions/old-r3', updated), 'https://example.test');
    const returned: URLSearchParams = new URL(graphReturnTarget(source.searchParams, 'old-r3')!.route,
      'https://example.test').searchParams;
    expect(returned.has('returnLibraryQuery')).toBe(true);
    expect(readingReturnTarget(returned, 'old-r3')).toBeNull();
  },
);

it('document graph nested directory keeps a mode-less original selection after centering another version', () => {
  const raw: string = 'familyId=family-r3&selectedDocumentVersionId=old-r3&expandedFamilyIds=family-z,family-a&listY=735';
  const directory: URLSearchParams = libraryReadingParams(new URLSearchParams(raw));
  const graph: URLSearchParams = documentGraphReadingParams('current-r4', 'wi-r4', {},
    new URLSearchParams({ returnDocumentVersionId: 'current-r4', returnLibraryQuery: raw }));
  expect(readingReturnTarget(graph, 'current-r4')?.route).toBe(`/library?${directory}`);
  expect(directory.get('selectedDocumentVersionId')).toBe('old-r3');
  expect(directory.get('expandedFamilyIds')).toBe('family-a,family-z');
});

it('document graph nested directory validation leaves existing library-scope task returns intact', () => {
  const params: URLSearchParams = new URLSearchParams({ scope: 'library',
    returnDocumentVersionId: 'old-r3', returnLibraryQuery: 'mode=tasks&workItemId=wi-r3' });
  expect(readingReturnTarget(params, 'old-r3')).toEqual({
    route: '/library?mode=tasks&workItemId=wi-r3', label: '返回任务快览',
  });
});
