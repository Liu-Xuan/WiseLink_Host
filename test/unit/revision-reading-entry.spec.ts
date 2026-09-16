import {
  completeRevisionPins,
  libraryReadingParams,
  libraryReadingScope,
  parsePositiveSafeInteger,
  readingReturnTarget,
  revisionReadingParams,
  revisionReadingReturnParams,
} from '../../client/src/features/matter/reading-return';
import {
  parseRevisionSide,
  roleUnion,
  sideIdentityComplete,
  validateRevisionEntry,
} from '../../client/src/pages/DocumentParsingPage/document-revision-entry';
import type { DocumentSemanticSection } from '@shared/document-semantic-map.interface';

function makeSection(roleKey: string | null): DocumentSemanticSection {
  return {
    sectionId: 'section',
    headingUnitId: 'heading',
    parentSectionId: null,
    titleRaw: 'title',
    roleKey,
    occurrence: 1,
    bodyUnitIds: [],
    sourceRefIds: [],
    contentState: 'CONTENT',
    emptyLiteral: null,
    mappingSource: 'AUTHOR_HEADING',
  };
}

describe('revisionReadingParams normalization', () => {
  test('keeps only the exact revision identity keys and the controlled library return', () => {
    const params = new URLSearchParams(
      'before=DV1&after=DV2&beforeParseRun=PR1&afterParseRun=PR2' +
        '&beforeSemanticRevision=3&afterSemanticRevision=4&roleKey=SYS' +
        '&focusSide=before&evil=1&returnUrl=https://evil.invalid' +
        '&returnLibraryQuery=mode%3Ddocument%26familyId%3DF1',
    );
    const out = revisionReadingParams(params);
    expect(out.get('before')).toBe('DV1');
    expect(out.get('after')).toBe('DV2');
    expect(out.get('beforeParseRun')).toBe('PR1');
    expect(out.get('afterParseRun')).toBe('PR2');
    expect(out.get('beforeSemanticRevision')).toBe('3');
    expect(out.get('afterSemanticRevision')).toBe('4');
    expect(out.get('roleKey')).toBe('SYS');
    expect(out.get('focusSide')).toBe('before');
    expect(out.get('evil')).toBeNull();
    expect(out.get('returnUrl')).toBeNull();
    expect(out.get('returnLibraryQuery')).toBe(
      libraryReadingParams(
        new URLSearchParams('mode=document&familyId=F1'),
      ).toString(),
    );
  });

  test('drops a non-side focusSide and a non-numeric semantic revision', () => {
    const out = revisionReadingParams(
      new URLSearchParams(
        'before=DV1&after=DV2&focusSide=latest&beforeSemanticRevision=abc',
      ),
    );
    expect(out.get('focusSide')).toBeNull();
    expect(out.get('beforeSemanticRevision')).toBeNull();
    expect(out.get('before')).toBe('DV1');
  });

  test('drops duplicated, empty and illegal pins instead of repairing them', () => {
    const duplicated = revisionReadingParams(
      new URLSearchParams('before=DV1&before=DV2&after=DV3'),
    );
    expect(duplicated.get('before')).toBeNull();
    expect(duplicated.get('after')).toBe('DV3');

    const empty = revisionReadingParams(new URLSearchParams('before=&after=DV2'));
    expect(empty.get('before')).toBeNull();
    expect(empty.get('after')).toBe('DV2');

    for (const semantic of ['abc', '0', '-1', '1.5', '9007199254740992']) {
      const out = revisionReadingParams(
        new URLSearchParams(`before=DV1&beforeSemanticRevision=${semantic}`),
      );
      expect(out.get('beforeSemanticRevision')).toBeNull();
    }
  });

  test('keeps a full positive safe-integer semantic revision without truncation', () => {
    const out = revisionReadingParams(
      new URLSearchParams('before=DV1&beforeSemanticRevision=9007199254740991'),
    );
    expect(out.get('beforeSemanticRevision')).toBe('9007199254740991');
  });

  test('switching role keeps every non-role pin identical', () => {
    const base =
      'before=DV1&after=DV2&beforeParseRun=PR1&afterParseRun=PR2' +
      '&beforeSemanticRevision=1&afterSemanticRevision=2';
    const withSys = revisionReadingParams(new URLSearchParams(`${base}&roleKey=SYS`));
    const withLim = revisionReadingParams(new URLSearchParams(`${base}&roleKey=LIM`));
    for (const key of [
      'before',
      'after',
      'beforeParseRun',
      'afterParseRun',
      'beforeSemanticRevision',
      'afterSemanticRevision',
    ]) {
      expect(withSys.get(key)).toBe(withLim.get(key));
      expect(withSys.get(key)).not.toBeNull();
    }
    expect(withSys.get('roleKey')).toBe('SYS');
    expect(withLim.get('roleKey')).toBe('LIM');
  });
});

describe('libraryReadingScope directory save key', () => {
  test('preserves the family and filter query used when entering a revision comparison', () => {
    const context = new URLSearchParams(
      'mode=document&familyId=F1&search=pump&ata=21',
    );
    const scope = libraryReadingScope(context);
    expect(scope).toBe(`library:${libraryReadingParams(context).toString()}`);
    expect(scope).toContain('familyId=F1');
    expect(scope).toContain('search=pump');
    expect(scope).toContain('ata=21');
    expect(
      libraryReadingScope(
        new URLSearchParams('mode=document&familyId=F1&search=pump&ata=21'),
      ),
    ).toBe(scope);
  });
});

describe('parseRevisionSide / sideIdentityComplete', () => {
  test('reads exact pins and reports completeness', () => {
    const params = new URLSearchParams(
      'before=DV1&beforeParseRun=PR1&beforeSemanticRevision=2&after=DV2',
    );
    const before = parseRevisionSide(params, 'before');
    expect(before.status).toBe('ok');
    if (before.status !== 'ok') throw new Error('expected ok');
    expect(before.side.documentVersionId).toBe('DV1');
    expect(before.side.parseRunId).toBe('PR1');
    expect(before.side.semanticRevision).toBe(2);
    expect(sideIdentityComplete(before.side)).toBe(true);

    const after = parseRevisionSide(params, 'after');
    expect(after.status).toBe('ok');
    if (after.status !== 'ok') throw new Error('expected ok');
    expect(after.side.parseRunId).toBeNull();
    expect(after.side.semanticRevision).toBeNull();
    expect(sideIdentityComplete(after.side)).toBe(false);
  });

  test('reports a missing side as absent, not invalid', () => {
    expect(
      parseRevisionSide(new URLSearchParams('before=DV1'), 'after').status,
    ).toBe('absent');
  });

  test.each(['', 'abc', '0', '-1', '1.5', '9007199254740992'])(
    'rejects an illegal semantic revision %s',
    (value) => {
      const parsed = parseRevisionSide(
        new URLSearchParams(`before=DV1&beforeSemanticRevision=${value}`),
        'before',
      );
      expect(parsed.status).toBe('invalid');
    },
  );

  test('rejects empty and duplicated identity fields', () => {
    expect(parseRevisionSide(new URLSearchParams('before='), 'before').status).toBe('invalid');
    expect(parseRevisionSide(new URLSearchParams('before=DV1&before=DV2'), 'before').status).toBe('invalid');
    expect(parseRevisionSide(new URLSearchParams('before=DV1&beforeParseRun='), 'before').status).toBe('invalid');
    expect(parseRevisionSide(new URLSearchParams('before=DV1&beforeParseRun=A&beforeParseRun=B'), 'before').status).toBe('invalid');
    expect(parseRevisionSide(new URLSearchParams('before=DV1&beforeSemanticRevision=1&beforeSemanticRevision=2'), 'before').status).toBe('invalid');
  });
});

describe('validateRevisionEntry discovery gate', () => {
  test('accepts a legal partial pair and a fully pinned pair', () => {
    const partial = validateRevisionEntry(new URLSearchParams('before=DV1&after=DV2'));
    expect(partial.ok).toBe(true);
    if (partial.ok) {
      expect(partial.before.documentVersionId).toBe('DV1');
      expect(partial.before.parseRunId).toBeNull();
      expect(partial.after.documentVersionId).toBe('DV2');
    }
    const full = validateRevisionEntry(
      new URLSearchParams(
        'before=DV1&after=DV2&beforeParseRun=PR1&afterParseRun=PR2&beforeSemanticRevision=1&afterSemanticRevision=2',
      ),
    );
    expect(full.ok).toBe(true);
  });

  test('rejects missing, identical, run-colliding, role-duplicated and illegal-pin entries', () => {
    for (const query of [
      'before=DV1',
      'before=DV1&after=DV1',
      'before=DV1&after=DV2&beforeParseRun=PR1&afterParseRun=PR1',
      'before=DV1&after=DV2&roleKey=A&roleKey=B',
      'before=DV1&beforeSemanticRevision=abc&after=DV2',
      'before=DV1&after=DV2&afterSemanticRevision=0',
    ]) {
      expect(validateRevisionEntry(new URLSearchParams(query)).ok).toBe(false);
    }
  });
});

describe('parsePositiveSafeInteger', () => {
  test('accepts positive safe integers only', () => {
    expect(parsePositiveSafeInteger('1')).toBe(1);
    expect(parsePositiveSafeInteger('42')).toBe(42);
    expect(parsePositiveSafeInteger('9007199254740991')).toBe(9007199254740991);
  });

  test('rejects zero, signs, decimals, non-digits and values above MAX_SAFE_INTEGER', () => {
    for (const value of ['0', '-1', '+1', '1.5', 'abc', '', '1e2', '9007199254740992', '99999999999999999']) {
      expect(parsePositiveSafeInteger(value)).toBeNull();
    }
  });
});

describe('completeRevisionPins', () => {
  test('returns both ends only when all six pins are legal and distinct', () => {
    const pins = completeRevisionPins(
      new URLSearchParams(
        'before=DV1&after=DV2&beforeParseRun=PR1&afterParseRun=PR2&beforeSemanticRevision=1&afterSemanticRevision=2',
      ),
    );
    expect(pins).not.toBeNull();
    expect(pins!.before).toEqual({ dv: 'DV1', run: 'PR1', semanticRevision: 1 });
    expect(pins!.after).toEqual({ dv: 'DV2', run: 'PR2', semanticRevision: 2 });
  });

  test('returns null on any missing, illegal, duplicated or colliding pin', () => {
    for (const query of [
      'before=DV1&after=DV2&beforeParseRun=PR1&afterParseRun=PR2&beforeSemanticRevision=1',
      'before=DV1&after=DV2&beforeParseRun=PR1&afterParseRun=PR2&beforeSemanticRevision=abc&afterSemanticRevision=2',
      'before=DV1&before=DV9&after=DV2&beforeParseRun=PR1&afterParseRun=PR2&beforeSemanticRevision=1&afterSemanticRevision=2',
      'before=DV1&after=DV1&beforeParseRun=PR1&afterParseRun=PR2&beforeSemanticRevision=1&afterSemanticRevision=2',
      'before=DV1&after=DV2&beforeParseRun=PR1&afterParseRun=PR1&beforeSemanticRevision=1&afterSemanticRevision=2',
    ]) {
      expect(completeRevisionPins(new URLSearchParams(query))).toBeNull();
    }
  });
});

describe('roleUnion', () => {
  test('keeps non-null roles in first-seen order, dedups repeats, preserves one-sided roles', () => {
    const beforeSide = [makeSection('SYS'), makeSection(null), makeSection('PWR')];
    const afterSide = [makeSection('PWR'), makeSection('SYS'), makeSection('NAV')];
    expect(roleUnion([beforeSide, afterSide])).toEqual(['SYS', 'PWR', 'NAV']);
  });

  test('returns empty when all roles are missing', () => {
    expect(roleUnion([[makeSection(null)], []])).toEqual([]);
  });
});

describe('readingReturnTarget revision branch', () => {
  const revisionQuery = revisionReadingParams(
    new URLSearchParams(
      'before=DV1&after=DV2&beforeParseRun=PR1&afterParseRun=PR2' +
        '&beforeSemanticRevision=1&afterSemanticRevision=2&roleKey=SYS',
    ),
  ).toString();

  test('returns the pinned revision route for a matching side and run', () => {
    const params = new URLSearchParams(
      revisionReadingReturnParams(revisionQuery, 'before', 'DV1'),
    );
    const target = readingReturnTarget(params, 'DV1', 'PR1');
    expect(target).not.toBeNull();
    expect(target!.label).toBe('返回改版比较');
    const query = new URL(target!.route, 'https://example.invalid').searchParams;
    expect(target!.route.startsWith('/document-revisions?')).toBe(true);
    expect(query.get('before')).toBe('DV1');
    expect(query.get('after')).toBe('DV2');
    expect(query.get('focusSide')).toBe('before');
    expect(query.get('roleKey')).toBe('SYS');
  });

  test('rejects when the reader binding does not match the side version', () => {
    const params = new URLSearchParams(
      revisionReadingReturnParams(revisionQuery, 'before', 'DV1'),
    );
    expect(readingReturnTarget(params, 'DV-other', 'PR1')).toBeNull();
  });

  test('rejects when both ends resolve to the same version', () => {
    const sameQuery = revisionReadingParams(
      new URLSearchParams('before=DV1&after=DV1&beforeParseRun=PR1&roleKey=SYS'),
    ).toString();
    const params = new URLSearchParams(
      revisionReadingReturnParams(sameQuery, 'before', 'DV1'),
    );
    expect(readingReturnTarget(params, 'DV1')).toBeNull();
  });

  test('rejects a requestedRun that differs from the pinned side run', () => {
    const params = new URLSearchParams(
      revisionReadingReturnParams(revisionQuery, 'before', 'DV1'),
    );
    expect(readingReturnTarget(params, 'DV1', 'PR-other')).toBeNull();
    expect(readingReturnTarget(params, 'DV1', 'PR1')).not.toBeNull();
  });

  test('rejects an unknown side and a missing side token', () => {
    const noSide = new URLSearchParams({
      returnDocumentVersionId: 'DV1',
      returnRevisionQuery: revisionQuery,
    });
    expect(readingReturnTarget(noSide, 'DV1')).toBeNull();
    const badSide = new URLSearchParams({
      returnDocumentVersionId: 'DV1',
      returnRevisionQuery: revisionQuery,
      returnRevisionSide: 'latest',
    });
    expect(readingReturnTarget(badSide, 'DV1')).toBeNull();
  });

  test('stays mutually exclusive with matter and library returns', () => {
    const withMatter = new URLSearchParams(
      revisionReadingReturnParams(revisionQuery, 'before', 'DV1'),
    );
    withMatter.set('returnMatterId', 'M1');
    expect(readingReturnTarget(withMatter, 'DV1')).toBeNull();

    const withLibrary = new URLSearchParams(
      revisionReadingReturnParams(revisionQuery, 'before', 'DV1'),
    );
    withLibrary.set('returnLibraryQuery', 'mode=document&familyId=F1');
    expect(readingReturnTarget(withLibrary, 'DV1')).toBeNull();
  });

  test('rejects a nested query that is missing any of the six pins', () => {
    for (const missing of [
      'before=DV1&after=DV2&beforeParseRun=PR1&afterParseRun=PR2&beforeSemanticRevision=1',
      'before=DV1&after=DV2&beforeParseRun=PR1&afterParseRun=PR2&afterSemanticRevision=2',
      'before=DV1&after=DV2&afterParseRun=PR2&beforeSemanticRevision=1&afterSemanticRevision=2',
    ]) {
      const params = new URLSearchParams(
        revisionReadingReturnParams(missing, 'before', 'DV1'),
      );
      expect(readingReturnTarget(params, 'DV1')).toBeNull();
    }
  });

  test('rejects a nested query with an illegal, duplicated or role-duplicated pin', () => {
    for (const bad of [
      'before=DV1&after=DV2&beforeParseRun=PR1&afterParseRun=PR2&beforeSemanticRevision=abc&afterSemanticRevision=2',
      'before=DV1&after=DV2&beforeParseRun=PR1&afterParseRun=PR2&beforeSemanticRevision=0&afterSemanticRevision=2',
      'before=DV1&before=DV9&after=DV2&beforeParseRun=PR1&afterParseRun=PR2&beforeSemanticRevision=1&afterSemanticRevision=2',
      'before=DV1&after=DV2&beforeParseRun=PR1&afterParseRun=PR2&beforeSemanticRevision=1&afterSemanticRevision=2&roleKey=A&roleKey=B',
    ]) {
      const params = new URLSearchParams(
        revisionReadingReturnParams(bad, 'before', 'DV1'),
      );
      expect(readingReturnTarget(params, 'DV1')).toBeNull();
    }
  });
});
