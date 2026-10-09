import type { DocumentActivityVersionedReadingResponse, DocumentActivityRevisionV2 } from '@shared/document-activity.interface';

/** Synthetic saved bytes only: no source retrieval, generation, or business save. */
export function graphActivityV2(documentVersionId = 'dv-a', parseRunId = 'pr-1', familyId = 'family-dv-a', runRef = 'run-1', candidateRevision = 2): DocumentActivityVersionedReadingResponse & { candidate: DocumentActivityRevisionV2 } {
  const binding = { documentVersionId, parseRunId, parseRevision: 1, sourceArtifactId: 'synthetic-artifact', sourceSha256: 'a'.repeat(64), sourceByteLength: 100 };
  const sourceBinding = { original: binding, semanticRevision: 1 };
  const words = 'Supplier should report completion Q4 2026 TBD after approval LN 2024-2026 only after CIDB';
  return { familyId, binding, sourceSchemaVersion: 'wiselink.document.activity-candidate.v2', candidate: {
    schemaVersion: 'wiselink.document.activity-candidate.v2', candidateOnly: true, runRef, candidateRevision,
    sourceBinding, producer: { skillVersion: 'synthetic', modelVersion: 'not-called' }, savedAt: '2026-10-01T00:00:00Z',
    sourceAnchors: [{ anchorId: 'anchor-1', sourceText: words, sourceUnitId: 'unit-1', payloadPath: 'units[0]', sourceRefIds: ['source-1'], sourceLocators: [] }],
    readCoverage: { status: 'DELIVERED_RANGES_ONLY', selection: { sectionIds: ['S1'] },
      deliveredRanges: [{ sectionId: 'S1', offset: 0, unitIds: ['unit-1'], anchorIds: ['anchor-1'], nextOffset: null }],
      sourceCoverage: { knownPageCount: 1, readPageIndexes: [0], unresolvedRanges: [] } },
    sourceContext: { schemaVersion: 'wiselink.document.activity-source-context.v1', sourceBinding,
      profile: { profileRef: 'generic', selectionBasis: 'NOT_RECORDED', family: null, issuer: null },
      sections: [], organizationWarnings: [] },
    statements: [{ statementId: 'st-1', statementKey: 'source-one', label: 'Saved v2 source',
      quotes: [{ anchorId: 'anchor-1', start: 0, end: words.length, text: words }],
      subject: { raw: 'Supplier', quoteIndex: 0 }, action: { raw: 'report completion', quoteIndex: 0 },
      modality: { raw: 'should', quoteIndex: 0, meaning: 'RECOMMENDED', negationQuoteIndexes: [] },
      status: { raw: ' source reports completed\r\n', quoteIndex: 0, meaning: 'SOURCE_REPORTED_COMPLETED' },
      times: [{ raw: 'Q4 2026', quoteIndex: 0, role: 'TARGET', precision: 'QUARTER', expression: 'CALENDAR' },
        { raw: 'TBD', quoteIndex: 0, role: 'UNKNOWN', precision: 'UNKNOWN', expression: 'TBD' },
        { raw: 'after approval', quoteIndex: 0, role: 'CONDITION', precision: 'UNKNOWN', expression: 'RELATIVE' }],
      technicalIds: [{ raw: 'LN 2024-2026', quoteIndex: 0, kind: 'AIRCRAFT_LINE_NUMBER' }],
      scope: { sectionIds: ['S1'], conditions: [{ raw: 'only after CIDB', quoteIndex: 0, kind: 'PREREQUISITE', appliesTo: 'STATEMENT', sectionIds: [] }], completeness: 'DELIVERED_SCOPE_ONLY' },
      limitations: ['No verified execution claim.'] }],
  } };
}
