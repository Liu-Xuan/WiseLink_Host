import {
  calendarSpan,
  timelineItems,
  timelineLaneItems,
  timelinePlacedItems,
} from '../../client/src/features/trinity/document-activity-timeline';
import type { DocumentActivityRevision, DocumentActivityTime } from '@shared/document-activity.interface';

const candidate = (statements: DocumentActivityRevision['statements']): DocumentActivityRevision => ({
  schemaVersion: 'wiselink.document.activity-candidate.v1', candidateOnly: true,
  sourceBinding: { original: { documentVersionId: 'DV1', parseRunId: 'PR1', parseRevision: 1, sourceArtifactId: 'A', sourceSha256: 'S', sourceByteLength: 1 }, semanticRevision: 1 },
  readCoverage: { status: 'DELIVERED_RANGES_ONLY', selection: { sectionIds: [] }, deliveredRanges: [], sourceCoverage: { knownPageCount: 1, readPageIndexes: [], unresolvedRanges: [] } },
  sourceAnchors: [], runRef: 'run-1', candidateRevision: 2, producer: { skillVersion: 's', modelVersion: 'm' }, savedAt: '2026-09-16T00:00:00.000Z', statements,
});

const time = (patch: Partial<DocumentActivityTime>): DocumentActivityTime => ({
  role: 'TARGET', precision: 'DAY', expression: 'CALENDAR', raw: '', quoteIndex: 0, ...patch,
});

describe('document activity timeline model', () => {
  it('keeps source time wording and separates four lanes without using savedAt', () => {
    const result = timelineItems(candidate([
      { statementId: 'S1', statementKey: 'k1', label: '计划', quotes: [], time: { role: 'TARGET', precision: 'DAY', expression: 'CALENDAR', raw: '2026-10-01', quoteIndex: 0 }, statusRaw: 'Q', limitations: [] },
      { statementId: 'S2', statementKey: 'k2', label: '待定', quotes: [], time: { role: 'UNKNOWN', precision: 'UNKNOWN', expression: 'TBD', raw: 'TBD', quoteIndex: 0 }, statusRaw: null, limitations: [] },
    ]));
    expect(result.map((item) => [item.statement.statementId, item.lane, item.displayTime])).toEqual([
      ['S1', 'materials', '2026-10-01'], ['S2', 'materials', 'TBD'],
    ]);
    expect(timelineLaneItems(candidate([]), 'observation')).toEqual([]);
  });

  it('maps explicit-year CALENDAR wording to exact closed intervals and never invents a midpoint day', () => {
    const day = calendarSpan(time({ precision: 'DAY', raw: '2026-10-01' }))!;
    expect(day).toEqual({ start: Date.UTC(2026, 9, 1), end: Date.UTC(2026, 9, 2) - 1, precision: 'DAY' });
    expect(day.start).not.toBe(Date.UTC(2026, 9, 15));
    expect(day.end).not.toBe(Date.UTC(2026, 9, 15));
    expect(calendarSpan(time({ precision: 'DAY', raw: '2026年10月1日' }))).toEqual(day);
    expect(calendarSpan(time({ precision: 'DAY', raw: '2026-02-29' }))).toBeNull();
    expect(calendarSpan(time({ precision: 'MONTH', raw: '2026-10' }))).toEqual({
      start: Date.UTC(2026, 9, 1), end: Date.UTC(2026, 10, 1) - 1, precision: 'MONTH',
    });
    expect(calendarSpan(time({ precision: 'QUARTER', raw: '2026 Q3' }))).toEqual({
      start: Date.UTC(2026, 6, 1), end: Date.UTC(2026, 9, 1) - 1, precision: 'QUARTER',
    });
    expect(calendarSpan(time({ precision: 'QUARTER', raw: '2026年第三季度' }))).toEqual(
      calendarSpan(time({ precision: 'QUARTER', raw: '2026 Q3' })),
    );
    expect(calendarSpan(time({ precision: 'QUARTER', raw: 'Q3 2026' }))).toEqual(
      calendarSpan(time({ precision: 'QUARTER', raw: '2026 Q3' })),
    );
    expect(calendarSpan(time({ precision: 'YEAR', raw: '2026' }))).toEqual({
      start: Date.UTC(2026, 0, 1), end: Date.UTC(2027, 0, 1) - 1, precision: 'YEAR',
    });
  });

  it('keeps the same quarter of different years disjoint on the continuous axis', () => {
    const q25 = calendarSpan(time({ precision: 'QUARTER', raw: '2025 Q3' }))!;
    const q26 = calendarSpan(time({ precision: 'QUARTER', raw: '2026 Q3' }))!;
    expect(q25.end).toBeLessThan(q26.start);
    expect(q25.start).toBe(Date.UTC(2025, 6, 1));
    expect(q26.end).toBe(Date.UTC(2026, 9, 1) - 1);
  });

  it('never places missing-year, TBD, RELATIVE or UNKNOWN wording and keeps the raw', () => {
    for (const wording of [
      time({ precision: 'QUARTER', raw: 'Q3' }),
      time({ precision: 'QUARTER', raw: '第三季度' }),
      time({ precision: 'DAY', raw: '10-01' }),
      time({ precision: 'MONTH', raw: '10月' }),
      time({ precision: 'YEAR', raw: '明年' }),
      time({ precision: 'UNKNOWN', expression: 'TBD', raw: 'TBD' }),
      time({ precision: 'UNKNOWN', expression: 'RELATIVE', raw: '下个月' }),
      time({ precision: 'UNKNOWN', expression: 'UNKNOWN', raw: '' }),
    ])
      expect(calendarSpan(wording)).toBeNull();
    const result = timelineItems(candidate([
      { statementId: 'S1', statementKey: 'k1', label: '相对', quotes: [], time: time({ precision: 'UNKNOWN', expression: 'RELATIVE', raw: '下个月' }), statusRaw: null, limitations: [] },
    ]));
    expect(result[0].span).toBeNull();
    expect(result[0].displayTime).toBe('下个月');
  });

  it('sorts placed items by interval start ascending without touching unplaced wording', () => {
    const items = timelineItems(candidate([
      { statementId: 'LATE', statementKey: 'k1', label: '晚', quotes: [], time: time({ precision: 'QUARTER', raw: '2027 Q1' }), statusRaw: null, limitations: [] },
      { statementId: 'TBD', statementKey: 'k2', label: '待定', quotes: [], time: time({ precision: 'UNKNOWN', expression: 'TBD', raw: 'TBD' }), statusRaw: null, limitations: [] },
      { statementId: 'EARLY', statementKey: 'k3', label: '早', quotes: [], time: time({ precision: 'DAY', raw: '2025-11-20' }), statusRaw: null, limitations: [] },
    ]));
    expect(timelinePlacedItems(items).map((item) => item.statement.statementId)).toEqual(['EARLY', 'LATE']);
  });
});
