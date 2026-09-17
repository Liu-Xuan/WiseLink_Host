import { graphReadingParams, readGraphReadingState, withGraphReturn } from '../../client/src/pages/RelationGraphPage/suite-graph-return';
import { matterReadingReturnParams, readingReturnTarget } from '../../client/src/features/matter/reading-return';
const query = graphReadingParams('matter-a', 'old-work', {selectedId: '["claim","old-work","c1"]', hiddenGroups: ['evidence'], perspective: 'documents', page: 1, density: 3, relationMode: 'individual', viewport: {zoom: .7, pan: {x: 20, y: -30}}});
it('restores exact graph state after a pinned source and after Wiki', () => {
  const source = new URL(withGraphReturn('/document-versions/dv1?parseRunId=pr1&sourceRef=s1&returnMatterId=old', query), 'https://example.test');
  expect(source.searchParams.has('returnMatterId')).toBe(false);
  expect(source.searchParams.get('sourceRef')).toBe('s1');
  const target = readingReturnTarget(source.searchParams, 'dv1', 'pr1');
  expect(target?.route).toBe(`/graph?${query}`);
  const wiki = new URL(withGraphReturn('/matters/matter-a?workRef=old-work', query), 'https://example.test');
  expect(readingReturnTarget(wiki.searchParams, undefined, null, 'matter-a')?.route).toBe(target?.route);
  wiki.searchParams.set('workRef', 'new-work');
  expect(readingReturnTarget(wiki.searchParams, undefined, null, 'matter-a')).toBeNull();
});
it('rejects destination mismatches, duplicate and mixed return intents', () => {
  const params = new URL(withGraphReturn('/document-versions/dv1?parseRunId=pr1', query), 'https://example.test').searchParams;
  expect(readingReturnTarget(params, 'dv2', 'pr1')).toBeNull();
  expect(readingReturnTarget(params, 'dv1', 'pr2')).toBeNull();
  params.append('returnGraphQuery', query.toString());
  expect(readingReturnTarget(params, 'dv1', 'pr1')).toBeNull();
  params.delete('returnGraphQuery'); params.set('returnGraphQuery', query.toString()); params.set('returnMatterId', 'another');
  expect(readingReturnTarget(params, 'dv1', 'pr1')).toBeNull();
});
it('only restores bounded display state, never arbitrary URLs or invalid numbers', () => {
  const state = readGraphReadingState(new URLSearchParams('page=NaN&density=0&perspective=external&viewport=%7B%22zoom%22%3A999%2C%22pan%22%3A%7B%22x%22%3A0%2C%22y%22%3A0%7D%7D&next=https://evil.test'));
  expect(state).toEqual({});
  expect(readGraphReadingState(query).viewport).toEqual({zoom: .7, pan: {x: 20, y: -30}});
});

it('retains the graph context across Wiki to source and back to the same work', () => {
  const wiki = new URL(withGraphReturn('/matters/matter-a?workRef=old-work', query), 'https://example.test');
  const original = matterReadingReturnParams('matter-a', 'dv1', 'brief', 'old-work', wiki.searchParams);
  const backWiki = readingReturnTarget(original, 'dv1');
  expect(backWiki?.route).toContain('workRef=old-work');
  const restored = new URL(backWiki!.route, 'https://example.test');
  expect(readingReturnTarget(restored.searchParams, undefined, null, 'matter-a')?.route).toBe(`/graph?${query}`);
});

it('adds a bounded graph return only to the supported matter process route', () => {
  const process = new URL(withGraphReturn('/matters/matter-a/process?workRef=old-work', query), 'https://example.test');
  expect(process.pathname).toBe('/matters/matter-a/process');
  expect(process.searchParams.get('returnGraphTargetMatterId')).toBe('matter-a');
  expect(process.searchParams.get('returnGraphTargetWorkRef')).toBe('old-work');
  expect(readingReturnTarget(process.searchParams, undefined, null, 'matter-a')?.route).toBe(`/graph?${query}`);
  expect(withGraphReturn('/matters/matter-a/unknown', query)).toBe('/matters/matter-a/unknown');
});
