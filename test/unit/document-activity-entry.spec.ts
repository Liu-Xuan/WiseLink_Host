import {
  activityReadingParams,
  completeActivityIdentity,
  completeActivityPins,
} from '../../client/src/features/matter/reading-return';
import {
  activityEntryReason,
  activitySelectionQuery,
  findActivityAnchor,
  findActivityStatement,
  loadActivityEntry,
  planActivityEntry,
  validateActivityEntry,
  type ActivityEntryDeps,
} from '../../client/src/pages/DocumentParsingPage/document-activity-entry';
import type {
  DocumentActivityReadingResponse,
  DocumentActivityRevision,
} from '@shared/document-activity.interface';
import type { DocumentOriginalBinding } from '@shared/document-original.interface';

function makeBinding(): DocumentOriginalBinding {
  return {
    documentVersionId: 'DV1',
    parseRunId: 'PR1',
    parseRevision: 3,
    sourceArtifactId: 'ART1',
    sourceSha256: 'sha',
    sourceByteLength: 10,
  };
}

export function makeCandidate(
  overrides?: Partial<DocumentActivityRevision>,
): DocumentActivityRevision {
  return {
    schemaVersion: 'wiselink.document.activity-candidate.v1',
    runRef: 'run-1',
    candidateRevision: 4,
    candidateOnly: true,
    sourceBinding: { original: makeBinding(), semanticRevision: 3 },
    producer: { skillVersion: 'skill-1', modelVersion: 'model-1' },
    savedAt: '2026-09-15T00:00:00.000Z',
    readCoverage: {
      status: 'DELIVERED_RANGES_ONLY',
      selection: { sectionIds: ['S1'] },
      deliveredRanges: [
        { sectionId: 'S1', offset: 0, unitIds: ['U1'], anchorIds: ['A1'], nextOffset: null },
      ],
      sourceCoverage: { knownPageCount: 2, readPageIndexes: [0], unresolvedRanges: [] },
    },
    statements: [],
    sourceAnchors: [],
    ...overrides,
  };
}

export function makeResponse(
  candidate: DocumentActivityRevision | null,
): DocumentActivityReadingResponse {
  return { binding: makeBinding(), familyId: 'FAM1', candidate };
}

function makeDeps(options: {
  publishedRunId?: string | null;
  candidate?: DocumentActivityRevision | null;
  activityError?: Error;
} = {}) {
  const calls = { status: 0, activity: 0 };
  const deps: ActivityEntryDeps = {
    readParsingStatus: async () => {
      calls.status += 1;
      return {
        publishedRun:
          options.publishedRunId === null || options.publishedRunId === undefined
            ? options.publishedRunId === null
              ? null
              : { parseRunId: 'PR1' }
            : { parseRunId: options.publishedRunId },
      };
    },
    readActivityReading: async () => {
      calls.activity += 1;
      if (options.activityError) throw options.activityError;
      return makeResponse(options.candidate === undefined ? makeCandidate() : options.candidate);
    },
  };
  return { calls, deps };
}

const alwaysCurrent = () => true;

describe('validateActivityEntry', () => {
  test('accepts an empty query (full discovery) and a fully pinned query', () => {
    expect(validateActivityEntry(new URLSearchParams('')).ok).toBe(true);
    const full = validateActivityEntry(
      new URLSearchParams('parseRunId=PR1&candidateRevision=4&runRef=run-1&statementId=ST1&anchor=A1'),
    );
    expect(full.ok).toBe(true);
    if (full.ok) {
      expect(full.parseRunId).toBe('PR1');
      expect(full.candidateRevision).toBe(4);
      expect(full.runRef).toBe('run-1');
      expect(full.statementId).toBe('ST1');
      expect(full.anchor).toBe('A1');
    }
  });

  test('rejects illegal, empty and duplicated pins', () => {
    for (const query of [
      'parseRunId=',
      'parseRunId=A&parseRunId=B',
      'candidateRevision=abc',
      'candidateRevision=0',
      'candidateRevision=-1',
      'candidateRevision=1.5',
      'candidateRevision=9007199254740992',
      'candidateRevision=1&candidateRevision=2',
      'runRef=',
      'runRef=A&runRef=B',
      'statementId=',
      'anchor=',
      'anchor=A&anchor=B',
      'window=',
      'window=bogus',
      'window=all&window=current-year',
    ]) {
      expect(validateActivityEntry(new URLSearchParams(query)).ok).toBe(false);
    }
  });

  test('rejects a statement or anchor selection without a parse run', () => {
    for (const query of ['statementId=ST1', 'anchor=A1']) {
      expect(validateActivityEntry(new URLSearchParams(query)).ok).toBe(false);
    }
  });

  test('candidateRevision and runRef must appear as a pair; a half pair is rejected with or without a parse run', () => {
    for (const query of ['candidateRevision=4', 'runRef=run-1']) {
      const entry = validateActivityEntry(new URLSearchParams(query));
      expect(entry.ok).toBe(false);
      expect(activityEntryReason(entry)).toContain('不能单独使用');
    }
    for (const query of ['parseRunId=PR1&candidateRevision=4', 'parseRunId=PR1&runRef=run-1']) {
      const entry = validateActivityEntry(new URLSearchParams(query));
      expect(entry.ok).toBe(false);
      expect(activityEntryReason(entry)).toContain('必须成对出现');
    }
  });
});

describe('planActivityEntry zero-request gate', () => {
  test('blocked plans never read; parse-run-less entries discover the published run', () => {
    const blocked = planActivityEntry('DV1', validateActivityEntry(new URLSearchParams('runRef=run-1')));
    expect(blocked.mode).toBe('blocked');
    expect(planActivityEntry('DV1', validateActivityEntry(new URLSearchParams(''))).mode).toBe('discover-run');
  });

  test('a pinned run reads with the exact identity and discovers only when candidate and runRef are both absent', () => {
    const discovery = planActivityEntry(
      'DV1',
      validateActivityEntry(new URLSearchParams('parseRunId=PR1')),
    );
    expect(discovery).toMatchObject({ mode: 'read', discovery: true, request: { documentVersionId: 'DV1', parseRunId: 'PR1' } });
    expect('candidateRevision' in (discovery as { request: object }).request).toBe(false);
    const pinned = planActivityEntry(
      'DV1',
      validateActivityEntry(new URLSearchParams('parseRunId=PR1&candidateRevision=4&runRef=run-1')),
    );
    expect(pinned).toMatchObject({ mode: 'read', discovery: false, request: { parseRunId: 'PR1', candidateRevision: 4 } });
  });

  test('a half candidate pair is blocked and never plans a read', () => {
    for (const query of ['parseRunId=PR1&candidateRevision=4', 'parseRunId=PR1&runRef=run-1']) {
      expect(planActivityEntry('DV1', validateActivityEntry(new URLSearchParams(query))).mode).toBe('blocked');
    }
  });
});

describe('loadActivityEntry', () => {
  test('issues zero requests for a blocked entry', async () => {
    const { calls, deps } = makeDeps();
    const result = await loadActivityEntry({
      documentVersionId: 'DV1',
      entry: validateActivityEntry(new URLSearchParams('candidateRevision=abc')),
      baseParams: new URLSearchParams('candidateRevision=abc'),
      deps,
      signal: new AbortController().signal,
      current: alwaysCurrent,
    });
    expect(result.error).toContain('候选改版号');
    expect(calls.status).toBe(0);
    expect(calls.activity).toBe(0);
  });

  test('an invalid window issues zero requests instead of being normalized away', async () => {
    for (const query of ['window=', 'window=bogus', 'window=all&window=current-year']) {
      const { calls, deps } = makeDeps();
      const params = new URLSearchParams(query);
      const result = await loadActivityEntry({
        documentVersionId: 'DV1',
        entry: validateActivityEntry(params),
        baseParams: params,
        deps,
        signal: new AbortController().signal,
        current: alwaysCurrent,
      });
      expect(result.error).toContain('时间窗参数');
      expect(calls.status).toBe(0);
      expect(calls.activity).toBe(0);
    }
  });

  test('a half candidate pair issues zero requests even with a parse run', async () => {
    const { calls, deps } = makeDeps();
    const result = await loadActivityEntry({
      documentVersionId: 'DV1',
      entry: validateActivityEntry(new URLSearchParams('parseRunId=PR1&candidateRevision=4')),
      baseParams: new URLSearchParams('parseRunId=PR1&candidateRevision=4'),
      deps,
      signal: new AbortController().signal,
      current: alwaysCurrent,
    });
    expect(result.error).toContain('必须成对出现');
    expect(calls.status).toBe(0);
    expect(calls.activity).toBe(0);
  });

  test('full discovery without a published run is unreadable and never reads activity', async () => {
    const { calls, deps } = makeDeps({ publishedRunId: null });
    const result = await loadActivityEntry({
      documentVersionId: 'DV1',
      entry: validateActivityEntry(new URLSearchParams('')),
      baseParams: new URLSearchParams(''),
      deps,
      signal: new AbortController().signal,
      current: alwaysCurrent,
    });
    expect(result.unreadable).toContain('没有已发布的解析版本');
    expect(calls.activity).toBe(0);
  });

  test('full discovery writes the complete pins back when a candidate exists', async () => {
    const { deps } = makeDeps({ candidate: makeCandidate() });
    const result = await loadActivityEntry({
      documentVersionId: 'DV1',
      entry: validateActivityEntry(new URLSearchParams('')),
      baseParams: new URLSearchParams('evil=1'),
      deps,
      signal: new AbortController().signal,
      current: alwaysCurrent,
    });
    expect(result.error).toBeNull();
    expect(result.replaceQuery).not.toBeNull();
    const query = new URLSearchParams(result.replaceQuery ?? '');
    expect(query.get('parseRunId')).toBe('PR1');
    expect(query.get('candidateRevision')).toBe('4');
    expect(query.get('runRef')).toBe('run-1');
    expect(query.get('evil')).toBeNull();
  });

  test('full discovery with a null candidate pins only the discovered parse run', async () => {
    const { deps } = makeDeps({ candidate: null });
    const result = await loadActivityEntry({
      documentVersionId: 'DV1',
      entry: validateActivityEntry(new URLSearchParams('')),
      baseParams: new URLSearchParams(''),
      deps,
      signal: new AbortController().signal,
      current: alwaysCurrent,
    });
    expect(result.reading?.candidate).toBeNull();
    const query = new URLSearchParams(result.replaceQuery ?? '');
    expect(query.get('parseRunId')).toBe('PR1');
    expect(query.get('candidateRevision')).toBeNull();
    expect(query.get('runRef')).toBeNull();
  });

  test('an explicit candidate pair with no saved candidate errors instead of falling back', async () => {
    const { calls, deps } = makeDeps({ candidate: null });
    const result = await loadActivityEntry({
      documentVersionId: 'DV1',
      entry: validateActivityEntry(new URLSearchParams('parseRunId=PR1&candidateRevision=9&runRef=run-x')),
      baseParams: new URLSearchParams('parseRunId=PR1&candidateRevision=9&runRef=run-x'),
      deps,
      signal: new AbortController().signal,
      current: alwaysCurrent,
    });
    expect(result.error).toContain('run-x');
    expect(result.error).toContain('没有已保存的活动候选');
    expect(result.reading).toBeNull();
    expect(result.replaceQuery).toBeNull();
    expect(calls.activity).toBe(1);
  });

  test('a pinned runRef mismatching the saved candidate errors and never re-points', async () => {
    const { calls, deps } = makeDeps({ candidate: makeCandidate({ runRef: 'run-1' }) });
    const result = await loadActivityEntry({
      documentVersionId: 'DV1',
      entry: validateActivityEntry(new URLSearchParams('parseRunId=PR1&candidateRevision=4&runRef=run-other')),
      baseParams: new URLSearchParams('parseRunId=PR1&candidateRevision=4&runRef=run-other'),
      deps,
      signal: new AbortController().signal,
      current: alwaysCurrent,
    });
    expect(result.error).toContain('运行标识与已保存候选不一致');
    expect(result.reading).toBeNull();
    expect(calls.activity).toBe(1);
  });

  test('a pinned runRef without any saved candidate errors', async () => {
    const { deps } = makeDeps({ candidate: null });
    const result = await loadActivityEntry({
      documentVersionId: 'DV1',
      entry: validateActivityEntry(new URLSearchParams('parseRunId=PR1&candidateRevision=4&runRef=run-1')),
      baseParams: new URLSearchParams('parseRunId=PR1&candidateRevision=4&runRef=run-1'),
      deps,
      signal: new AbortController().signal,
      current: alwaysCurrent,
    });
    expect(result.error).toContain('没有已保存的活动候选');
    expect(result.reading).toBeNull();
  });

  test('an obsolete session discards the late response', async () => {
    const { deps } = makeDeps();
    let current = true;
    const depsWithSwitch: ActivityEntryDeps = {
      ...deps,
      readActivityReading: async (request, signal) => {
        const response = await deps.readActivityReading(request, signal);
        current = false;
        return response;
      },
    };
    await expect(
      loadActivityEntry({
        documentVersionId: 'DV1',
        entry: validateActivityEntry(new URLSearchParams('parseRunId=PR1')),
        baseParams: new URLSearchParams('parseRunId=PR1'),
        deps: depsWithSwitch,
        signal: new AbortController().signal,
        current: () => current,
      }),
    ).rejects.toThrow('DOCUMENT_ACTIVITY_ENTRY_OBSOLETE');
  });
});

describe('activitySelectionQuery', () => {
  test('sets a statement selection and keeps every pin identical', () => {
    const base = new URLSearchParams('parseRunId=PR1&candidateRevision=4&runRef=run-1');
    const out = new URLSearchParams(activitySelectionQuery(base, 'DV1', { statementId: 'ST1' }));
    expect(out.get('parseRunId')).toBe('PR1');
    expect(out.get('candidateRevision')).toBe('4');
    expect(out.get('runRef')).toBe('run-1');
    expect(out.get('statementId')).toBe('ST1');
  });

  test('clears a selection when passed null', () => {
    const base = new URLSearchParams('parseRunId=PR1&statementId=ST1&anchor=A1');
    const out = new URLSearchParams(activitySelectionQuery(base, 'DV1', { statementId: null, anchor: null }));
    expect(out.get('statementId')).toBeNull();
    expect(out.get('anchor')).toBeNull();
    expect(out.get('parseRunId')).toBe('PR1');
  });

  test('keeps a bound timeline parent while changing the reader selection', () => {
    const parent = new URLSearchParams({
      documentVersionId: 'DV1',
      parseRunId: 'PR1',
      candidateRevision: '4',
      runRef: 'run-1',
      statementId: 'ST-parent',
    });
    const base = new URLSearchParams({
      parseRunId: 'PR1',
      candidateRevision: '4',
      runRef: 'run-1',
      statementId: 'ST-reader',
      returnActivityQuery: parent.toString(),
      returnActivityView: 'timeline',
    });
    const out = new URLSearchParams(
      activitySelectionQuery(base, 'DV1', { statementId: 'ST-next' }),
    );
    expect(out.get('statementId')).toBe('ST-next');
    expect(out.get('returnActivityView')).toBe('timeline');
    expect(new URLSearchParams(out.get('returnActivityQuery')!).get('statementId'))
      .toBe('ST-parent');
  });
});

describe('selection lookup', () => {
  test('finds only real statements and anchors; unknown ids resolve to null', () => {
    const candidate = makeCandidate({
      statements: [
        {
          statementId: 'ST1',
          statementKey: 'K1',
          label: '生效',
          time: { raw: '2024-05-01', role: 'EFFECTIVE', precision: 'DAY', expression: 'CALENDAR', quoteIndex: 0 },
          statusRaw: 'EFFECTIVE',
          quotes: [{ anchorId: 'A1', start: 0, end: 1, text: 'x' }],
          limitations: [],
        },
      ],
      sourceAnchors: [
        { anchorId: 'A1', sourceUnitId: 'U1', payloadPath: '/text', sourceText: 'xy', sourceRefIds: [], sourceLocators: [] },
      ],
    });
    expect(findActivityStatement(candidate, 'ST1')?.statementId).toBe('ST1');
    expect(findActivityStatement(candidate, 'ST-unknown')).toBeNull();
    expect(findActivityAnchor(candidate, 'A1')?.anchorId).toBe('A1');
    expect(findActivityAnchor(candidate, 'A-unknown')).toBeNull();
    expect(findActivityStatement(null, 'ST1')).toBeNull();
  });
});

describe('activityReadingParams / completeActivityPins', () => {
  test('normalization keeps only exact pins and the controlled library return', () => {
    const out = activityReadingParams(
      new URLSearchParams(
        'parseRunId=PR1&candidateRevision=4&runRef=run-1&statementId=ST1&anchor=A1' +
          '&evil=1&returnUrl=https://evil.invalid&returnLibraryQuery=mode%3Ddocument%26familyId%3DF1',
      ),
    );
    expect(out.get('parseRunId')).toBe('PR1');
    expect(out.get('candidateRevision')).toBe('4');
    expect(out.get('runRef')).toBe('run-1');
    expect(out.get('statementId')).toBe('ST1');
    expect(out.get('anchor')).toBe('A1');
    expect(out.get('evil')).toBeNull();
    expect(out.get('returnUrl')).toBeNull();
    expect(out.get('returnLibraryQuery')).toContain('familyId=F1');
  });

  test('drops duplicated, empty and illegal pins instead of repairing them', () => {
    expect(activityReadingParams(new URLSearchParams('parseRunId=A&parseRunId=B')).get('parseRunId')).toBeNull();
    expect(activityReadingParams(new URLSearchParams('parseRunId=')).get('parseRunId')).toBeNull();
    expect(activityReadingParams(new URLSearchParams('candidateRevision=abc')).get('candidateRevision')).toBeNull();
    expect(activityReadingParams(new URLSearchParams('candidateRevision=0')).get('candidateRevision')).toBeNull();
    expect(activityReadingParams(new URLSearchParams('runRef=&statementId=ST1')).get('runRef')).toBeNull();
  });

  test('completeActivityPins requires all four legal pins', () => {
    expect(
      completeActivityPins(new URLSearchParams('parseRunId=PR1&candidateRevision=4&runRef=run-1&statementId=ST1')),
    ).toEqual({ parseRunId: 'PR1', candidateRevision: 4, runRef: 'run-1', statementId: 'ST1' });
    for (const query of [
      'parseRunId=PR1&candidateRevision=4&runRef=run-1',
      'parseRunId=PR1&candidateRevision=abc&runRef=run-1&statementId=ST1',
      'parseRunId=A&parseRunId=B&candidateRevision=4&runRef=run-1&statementId=ST1',
    ]) {
      expect(completeActivityPins(new URLSearchParams(query))).toBeNull();
    }
  });
});

describe('completeActivityIdentity', () => {
  const base = 'parseRunId=PR1&candidateRevision=4&runRef=run-1';

  test('requires the route run and candidate pair; statementId and anchor are optional', () => {
    expect(completeActivityIdentity(new URLSearchParams(base))).toEqual({
      parseRunId: 'PR1', candidateRevision: 4, runRef: 'run-1', statementId: null, anchor: null, window: null,
    });
    expect(completeActivityIdentity(new URLSearchParams(`${base}&statementId=ST1&anchor=A1&window=current-year`))).toEqual({
      parseRunId: 'PR1', candidateRevision: 4, runRef: 'run-1', statementId: 'ST1', anchor: 'A1', window: 'current-year',
    });
  });

  test('any missing identity pin or explicit bad/duplicated selection rejects the whole identity', () => {
    for (const query of [
      'parseRunId=PR1&runRef=run-1',
      'parseRunId=PR1&candidateRevision=4',
      'candidateRevision=4&runRef=run-1',
      `${base}&statementId=`,
      `${base}&statementId=A&statementId=B`,
      `${base}&anchor=A1&anchor=A2`,
    ]) {
      expect(completeActivityIdentity(new URLSearchParams(query))).toBeNull();
    }
  });
});
