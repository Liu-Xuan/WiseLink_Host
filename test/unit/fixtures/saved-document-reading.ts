import type { DocumentReadingPreview, DocumentReadingRevision } from '@shared/document-reading.interface';

export function savedDocumentReadingFixture(documentVersionId = 'DV-test'): DocumentReadingRevision {
  const quote = { anchorId: 'anchor-old', start: 0, end: 20, text: 'Check configuration.' };
  return {
    schemaVersion: 'wiselink.document.reading.v1', candidateOnly: true,
    readingRunRef: `DRR-${documentVersionId}`, readingRevision: 1,
    headline: '已保存文档解读', brief: { text: '先核对构型。', quotes: [quote] },
    explanation: [{ text: '已保存的详细解释。', quotes: [quote] }],
    criticalConditions: [{ text: '仅适用于构型 A。', quotes: [quote] }],
    limitations: ['构型 B 尚无执行记录。'],
    sourceBinding: { original: { documentVersionId, parseRunId: 'parse-1', parseRevision: 1,
      sourceArtifactId: 'artifact-original', sourceSha256: 'a'.repeat(64), sourceByteLength: 200 }, semanticRevision: 1 },
    readCoverage: { status: 'PARTIAL_DELIVERY', deliveredUnitIds: ['old-unit'], totalUnitCount: 2,
      sourceCoverage: { knownPageCount: 2, readPageIndexes: [0], unresolvedRanges: [
        { pageIndexes: [1], unitIds: ['other-unit'], reason: 'FIGURE_UNINTERPRETED', readingImpact: 'LIMITATION', message: '第二页图示含义尚未确认。' },
        { pageIndexes: [0], unitIds: ['old-unit'], reason: 'STRUCTURE_UNCERTAIN', readingImpact: 'DIAGNOSTIC', message: 'diagnostic-only' },
      ] } },
    sourceAnchors: [{ anchorId: quote.anchorId, sourceUnitId: 'old-unit', payloadPath: '/payload/text',
      sourceText: quote.text, sourceRefIds: ['source-ref-parse-1'], sourceLocators: [] }],
    producer: { skillVersion: 'synthetic', modelVersion: 'not-called' }, savedAt: '2026-10-01T00:00:00Z',
  };
}

export function savedDocumentReadingPreview(reading: DocumentReadingRevision): NonNullable<DocumentReadingPreview['reading']> {
  return {
    readingRunRef: reading.readingRunRef, readingRevision: reading.readingRevision,
    headline: reading.headline, brief: reading.brief.text,
    criticalConditions: reading.criticalConditions.map(item => item.text), limitations: reading.limitations,
    sourceLimitations: reading.readCoverage.sourceCoverage.unresolvedRanges
      .filter(item => item.readingImpact !== 'DIAGNOSTIC').map(item => item.message),
    sourceBinding: reading.sourceBinding, coverageStatus: reading.readCoverage.status,
    deliveredUnitCount: reading.readCoverage.deliveredUnitIds.length, totalUnitCount: reading.readCoverage.totalUnitCount,
    savedAt: reading.savedAt,
  };
}
