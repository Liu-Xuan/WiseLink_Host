import {
  situationFocusRoute,
  situationReadingQuery,
  withSituationReturn,
} from '../../client/src/features/trinity/situation-reading';
import { readingReturnTarget } from '../../client/src/features/matter/reading-return';

describe('engineering situation reading return', () => {
  it('returns an exact document source to the selected source category and page', () => {
    const route = withSituationReturn(
      '/document-versions/DV-1?returnMatterId=MAT-1&returnMatterWorkRef=MW-3&returnDocumentVersionId=DV-1',
      'MAT-1',
      new URLSearchParams({ source: 'documents' }),
      418,
    );
    expect(route).not.toBeNull();
    const reader = new URL(route!, 'https://example.test');
    expect(reader.searchParams.has('returnMatterId')).toBe(false);
    expect(reader.searchParams.has('returnMatterWorkRef')).toBe(false);
    expect(readingReturnTarget(reader.searchParams, 'DV-1')).toEqual({
      route: '/matters/MAT-1/posture?pageY=418&source=documents',
      label: '返回当前工程态势',
    });
    expect(readingReturnTarget(reader.searchParams, 'DV-other')).toBeNull();
  });

  it('binds a saved work target to the exact matter and work revision', () => {
    const route = withSituationReturn(
      '/matters/MAT-1?panel=brief&workRef=MW-3',
      'MAT-1',
      new URLSearchParams({ stage: 'update' }),
      72,
    );
    const target = new URL(route!, 'https://example.test');
    expect(readingReturnTarget(
      target.searchParams, undefined, null, 'MAT-1', 'MW-3',
    )).toEqual({
      route: '/matters/MAT-1/posture?pageY=72&stage=update',
      label: '返回当前工程态势',
    });
    expect(readingReturnTarget(
      target.searchParams, undefined, null, 'MAT-1', 'MW-other',
    )).toBeNull();
    expect(readingReturnTarget(
      target.searchParams, undefined, null, 'MAT-other', 'MW-3',
    )).toBeNull();
    target.searchParams.append('workRef', 'MW-3');
    expect(readingReturnTarget(
      target.searchParams, undefined, null, 'MAT-1', 'MW-3',
    )).toBeNull();
  });

  it('rejects conflicting, duplicated and mixed parent state', () => {
    const invalidStates = [
      'stage=analysis&source=documents',
      'stage=analysis&stage=review',
      'source=unknown',
      'pageY=-1',
      'pageY=10000001',
      'stage=analysis&arbitrary=value',
    ];
    for (const nested of invalidStates) {
      const params = new URLSearchParams({
        returnSituationMatterId: 'MAT-1',
        returnSituationQuery: nested,
        returnDocumentVersionId: 'DV-1',
      });
      expect(readingReturnTarget(params, 'DV-1')).toBeNull();
    }
    const mixed = new URLSearchParams({
      returnSituationMatterId: 'MAT-1',
      returnSituationQuery: 'source=documents',
      returnDocumentVersionId: 'DV-1',
      returnLibraryQuery: 'mode=document',
    });
    expect(readingReturnTarget(mixed, 'DV-1')).toBeNull();
    const stray = new URLSearchParams({
      returnSituationMatterId: 'MAT-1',
      returnSituationQuery: 'source=documents',
      returnDocumentVersionId: 'DV-1',
      returnGraphTargetMatterId: 'MAT-1',
    });
    expect(readingReturnTarget(stray, 'DV-1')).toBeNull();
  });

  it('preserves one comparison selection while dropping stale scroll position', () => {
    const source = situationReadingQuery(new URLSearchParams({
      source: 'documents', pageY: '800',
    }));
    expect(source?.toString()).toBe('source=documents');
    expect(situationReadingQuery(new URLSearchParams({
      stage: 'analysis', source: 'documents',
    }))).toBeNull();
    expect(situationFocusRoute(
      'MAT-2',
      new URLSearchParams({ source: 'documents', pageY: '800' }),
      true,
    )).toBe('/matters/MAT-2/posture?source=documents');
    expect(situationFocusRoute(
      'MAT-2',
      new URLSearchParams({ source: 'documents' }),
      false,
    )).toBe('/matters/MAT-2/posture');
  });

  it('allows a focused matter to return to its default posture panel', () => {
    const route = withSituationReturn(
      '/matters/MAT-1?panel=brief&workRef=MW-3',
      'MAT-1',
      new URLSearchParams(),
    );
    const target = new URL(route!, 'https://example.test');
    expect(target.searchParams.get('returnSituationQuery')).toBe('');
    expect(readingReturnTarget(
      target.searchParams, undefined, null, 'MAT-1', 'MW-3',
    )).toEqual({
      route: '/matters/MAT-1/posture',
      label: '返回当前工程态势',
    });
  });

  it('refuses cross-matter and pre-existing unrelated return targets', () => {
    expect(withSituationReturn(
      '/matters/MAT-2?workRef=MW-3',
      'MAT-1',
      new URLSearchParams({ stage: 'review' }),
    )).toBeNull();
    expect(withSituationReturn(
      '/document-versions/DV-1?returnGraphQuery=matterId%3DMAT-1',
      'MAT-1',
      new URLSearchParams({ source: 'documents' }),
    )).toBeNull();
  });
});
