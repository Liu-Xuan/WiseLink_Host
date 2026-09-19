import {
  legacyComparisonTarget,
  legacyReaderTarget,
} from '../../client/src/adapters/legacy-document-routes';

describe('legacy document URLs remain exact and never open Suite samples', () => {
  it('maps an exact historical run and source to the authorized reader with return context', () => {
    const params = new URLSearchParams({
      parse: 'PRUN-old', source: 'REF/old',
      returnDocumentVersionId: 'DV/old',
      returnLibraryQuery: 'mode=document&familyId=FAM-1&listY=90',
    });
    const result = legacyReaderTarget('DV/old', params, '#section-2');
    expect(result.reason).toBeUndefined();
    const url = new URL(result.route!, 'https://example.test');
    expect(url.pathname).toBe('/document-versions/DV%2Fold');
    expect(url.searchParams.get('parseRunId')).toBe('PRUN-old');
    expect(url.searchParams.get('sourceRef')).toBe('REF/old');
    expect(url.searchParams.get('returnLibraryQuery')).toBe('mode=document&familyId=FAM-1&listY=90');
    expect(url.hash).toBe('#section-2');
    expect(url.searchParams.has('parse')).toBe(false);
  });

  it('rejects ambiguous, empty and unbound source pins instead of falling back to latest', () => {
    for (const raw of [
      'parse=OLD&parseRunId=NEW',
      'parseRunId=OLD&parseRunId=NEW',
      'parse=',
      'parse=%20OLD',
      'sourceRef=REF-only',
      'parseRunId=OLD&source=REF&sourceRef=REF',
      'parseRunId=OLD&documentVersionId=OTHER',
    ]) {
      expect(legacyReaderTarget('DV-1', new URLSearchParams(raw)).route).toBeUndefined();
    }
    expect(legacyReaderTarget('DV-1', new URLSearchParams('parseRunId=OLD')).route)
      .toBe('/document-versions/DV-1?parseRunId=OLD');
  });

  it('requires two distinct explicit versions and binds the route to the comparison target', () => {
    expect(legacyComparisonTarget('DV-new', new URLSearchParams()).reason)
      .toContain('缺少要比较的两个文档版本');
    expect(legacyComparisonTarget('DV-other', new URLSearchParams('before=DV-old&after=DV-new')).reason)
      .toContain('不一致');
    expect(legacyComparisonTarget('DV-new', new URLSearchParams('before=DV-old&after=DV-new&after=DV-other')).route)
      .toBeUndefined();
    const query = new URLSearchParams({
      before: 'DV-old', after: 'DV-new', beforeParseRun: 'PRUN-old',
      afterParseRun: 'PRUN-new', beforeSemanticRevision: '1',
      afterSemanticRevision: '2', roleKey: 'ftd.milestones',
      returnLibraryQuery: 'mode=document&familyId=FAM-1',
    });
    const result = legacyComparisonTarget('DV-new', query, '#changes');
    expect(result.route).toBe(`/document-revisions?${query}#changes`);
  });

  it('allows an unknown well-formed ID only through the real authorized reader', () => {
    expect(legacyReaderTarget('unknown-version', new URLSearchParams()).route)
      .toBe('/document-versions/unknown-version');
    expect(legacyReaderTarget('', new URLSearchParams()).route).toBeUndefined();
  });
});
