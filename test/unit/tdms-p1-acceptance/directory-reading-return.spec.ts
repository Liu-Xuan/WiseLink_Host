import {
  libraryDocumentReadingRoute,
  libraryReadingParams,
  libraryReadingScope,
  readingReturnTarget,
} from '../../../client/src/features/matter/reading-return';

describe('independent exact directory scope across document reading', () => {
  it('preserves direct ATA2 selection, fleet and the exact document version on return', () => {
    const state = new URLSearchParams({ mode: 'document', aircraftModel: 'MODEL-A',
      ata2: '27', ata4: '__DIRECT__', fleetFamily: 'SYNTHETIC-FLEET',
      selectedDocumentVersionId: 'DV-history-R01', expandedFamilyIds: 'a,b', listY: '120' });
    const route = libraryDocumentReadingRoute('DV-history-R01', state);
    const query = new URL(route, 'https://synthetic.invalid').searchParams;
    const target = readingReturnTarget(query, 'DV-history-R01');
    expect(target).not.toBeNull();
    const returned = new URL(target!.route, 'https://synthetic.invalid').searchParams;
    expect(returned.get('ata2')).toBe('27');
    expect(returned.get('ata4')).toBe('__DIRECT__');
    expect(returned.get('aircraftModel')).toBe('MODEL-A');
    expect(returned.get('fleetFamily')).toBe('SYNTHETIC-FLEET');
    expect(returned.get('selectedDocumentVersionId')).toBe('DV-history-R01');
    expect(readingReturnTarget(query, 'DV-current-R02')).toBeNull();
  });

  it('isolates a leaf from its parent, sibling, raw ATA and unknown scope in read caches', () => {
    const scopes = [
      { ata2: '27', ata4: '__DIRECT__' }, { ata2: '27' },
      { ata2: '27', ata4: '27-11' }, { ata2: '27', ata4: '27-21' },
      { ata: '27-11' }, { ata2: '__UNKNOWN__' }, { ata2: '__RAW__' },
    ].map(value => libraryReadingScope(new URLSearchParams({ mode: 'document', ...value })));
    expect(new Set(scopes).size).toBe(scopes.length);
    const first = new URLSearchParams({ mode: 'document', ata2: '27', ata4: '27-11', listY: '1' });
    const scrolled = new URLSearchParams(first); scrolled.set('listY', '200');
    expect(libraryReadingScope(first)).toBe(libraryReadingScope(scrolled));
  });

  it('does not preserve duplicate node pins or a write intent in a reading return', () => {
    const supplied = new URLSearchParams('mode=document&ata2=27&ata2=28&ata4=27-11&runModel=1&returnURL=https://evil.invalid');
    const normalized = libraryReadingParams(supplied);
    expect(normalized.has('ata2')).toBe(false);
    expect(normalized.has('runModel')).toBe(false);
    expect(normalized.has('returnURL')).toBe(false);
    const route = libraryDocumentReadingRoute('DV-R01', supplied);
    const query = new URL(route, 'https://synthetic.invalid').searchParams;
    expect(query.get('returnLibraryQuery')).not.toContain('runModel');
    expect(query.get('returnLibraryQuery')).not.toContain('evil.invalid');
  });
});
