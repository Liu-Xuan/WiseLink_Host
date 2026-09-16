import { timelineItems, timelineLaneItems } from '../../client/src/features/trinity/document-activity-timeline';
import type { DocumentActivityRevision } from '@shared/document-activity.interface';

const candidate = (statements: DocumentActivityRevision['statements']): DocumentActivityRevision => ({
  schemaVersion: 'wiselink.document.activity-candidate.v1', candidateOnly: true,
  sourceBinding: { original: { documentVersionId: 'DV1', parseRunId: 'PR1', parseRevision: 1, sourceArtifactId: 'A', sourceSha256: 'S', sourceByteLength: 1 }, semanticRevision: 1 },
  readCoverage: { status: 'DELIVERED_RANGES_ONLY', selection: { sectionIds: [] }, deliveredRanges: [], sourceCoverage: { knownPageCount: 1, readPageIndexes: [], unresolvedRanges: [] } },
  sourceAnchors: [], runRef: 'run-1', candidateRevision: 2, producer: { skillVersion: 's', modelVersion: 'm' }, savedAt: '2026-09-16T00:00:00.000Z', statements,
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
});
