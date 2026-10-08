import { activateLibraryGraphReturnSession, readLibraryGraphReturn, saveLibraryGraphReturn } from '@client/src/pages/RelationGraphPage/library-graph-return-memory';
import { libraryGraphReadingParams } from '@client/src/pages/RelationGraphPage/library-graph-route';
import { documentGraphReadingParams, graphReturnTarget, libraryGraphReturnToken, withGraphReturn } from '@client/src/pages/RelationGraphPage/suite-graph-return';
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
