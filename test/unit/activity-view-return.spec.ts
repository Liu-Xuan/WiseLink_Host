import { activityReadingReturnParams, readingReturnTarget } from '../../client/src/features/matter/reading-return';

const query = 'parseRunId=PR1&candidateRevision=4&runRef=RUN4&statementId=ST2&anchor=ANCHOR2';
describe('activity view exact reading return', () => {
  it.each(['timeline', 'graph'] as const)('returns to %s with the actual statement and anchor', (view) => {
    const result = readingReturnTarget(activityReadingReturnParams(query, 'DV1', view), 'DV1', 'PR1')!;
    const target = new URL(result.route, 'https://example.test');
    expect(target.pathname).toBe(view === 'timeline' ? '/timeline' : '/activity-graph');
    expect(target.searchParams.get('documentVersionId')).toBe('DV1');
    expect(target.searchParams.get('statementId')).toBe('ST2');
    expect(target.searchParams.get('anchor')).toBe('ANCHOR2');
    expect(target.searchParams.get('candidateRevision')).toBe('4');
    expect(target.searchParams.get('runRef')).toBe('RUN4');
  });
  it('does not manufacture a statement for a candidate-level source anchor', () => {
    const params = new URLSearchParams(query); params.delete('statementId');
    const target = readingReturnTarget(activityReadingReturnParams(params.toString(), 'DV1', 'timeline'), 'DV1', 'PR1')!;
    expect(new URL(target.route, 'https://example.test').searchParams.has('statementId')).toBe(false);
  });
  it.each(['https://example.test', '', 'timeline&unsafe=1'])('rejects invalid view %s', (view) => {
    const params = activityReadingReturnParams(query, 'DV1'); params.set('returnActivityView', view);
    expect(readingReturnTarget(params, 'DV1', 'PR1')).toBeNull();
  });
  it('rejects duplicate, nested, wrong-source and half-pin contexts', () => {
    const params = activityReadingReturnParams(query, 'DV1', 'timeline');
    expect(readingReturnTarget(params, 'DV2', 'PR1')).toBeNull();
    expect(readingReturnTarget(params, 'DV1', 'PR2')).toBeNull();
    params.append('returnActivityView', 'graph');
    expect(readingReturnTarget(params, 'DV1', 'PR1')).toBeNull();
    expect(readingReturnTarget(activityReadingReturnParams(`${query}&returnActivityView=graph`, 'DV1', 'timeline'), 'DV1', 'PR1')).toBeNull();
    expect(readingReturnTarget(activityReadingReturnParams('parseRunId=PR1&runRef=RUN4', 'DV1', 'timeline'), 'DV1', 'PR1')).toBeNull();
  });
  it('preserves the existing activity reading route by default', () => {
    expect(readingReturnTarget(activityReadingReturnParams(query, 'DV1'), 'DV1', 'PR1')?.route).toContain('/document-versions/DV1/activities?');
  });
});
