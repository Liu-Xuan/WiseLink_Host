import { DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA } from '../../shared/document-activity.interface';
import { validateDocumentActivityCandidate, materializeDocumentActivityRevision,
  type DocumentActivityValidationContext } from '../../server/modules/canonical-host/document-activity-candidate';
import { buildTranslationSourcePlan } from '../../server/modules/canonical-host/canonical-translation-source-plan';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';

function fixture() {
  const original = originalFixture();
  original.source.units[0].payload.text = 'Target: Q4 2026, subject to approval. Actual completion: TBD.';
  const plan = buildTranslationSourcePlan({ documentVersionId: original.binding.documentVersionId,
    packageId: original.binding.parseRunId, title: '', source: original.source,
    parsedArtifact: { storeRole: 'UnifiedArtifactStoreCandidate', ref: 'fixture-only', sha256: 'a'.repeat(64),
      byteLength: 1, mediaType: 'application/json' } });
  const context: DocumentActivityValidationContext = {
    sourceBinding: { original: original.binding, semanticRevision: 1 },
    selection: { sectionIds: ['section-fixture'] },
    deliveredAnchors: plan.anchors,
    deliveredRanges: [{ sectionId: 'section-fixture', offset: 0,
      unitIds: original.source.units.map(unit => unit.unitId), anchorIds: plan.anchors.map(anchor => anchor.anchorId), nextOffset: null }],
    sourceCoverage: original.coverage,
  };
  const anchor = plan.anchors.find(item => item.sourceUnitId === 'u1')!;
  const proposal = { schemaVersion: DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA, statements: [{
    statementKey: 'local-1', label: 'Source target',
    quotes: [{ anchorId: anchor.anchorId, start: 0, end: anchor.sourceText.length, text: anchor.sourceText }],
    time: { role: 'TARGET' as const, precision: 'QUARTER' as const, expression: 'CALENDAR' as const,
      raw: 'Q4 2026', quoteIndex: 0 }, statusRaw: null, limitations: ['Subject to approval.'],
  }] };
  return { context, proposal };
}

describe('independent source activity candidates (isolated original fixtures)', () => {
  it('preserves precise quarter, conditions and source limitations without inventing a date or work identity', () => {
    const { context, proposal } = fixture();
    const candidate = validateDocumentActivityCandidate(proposal, context);
    expect(candidate.statements[0].time).toEqual(proposal.statements[0].time);
    expect(candidate.readCoverage).toMatchObject({ status: 'DELIVERED_RANGES_ONLY', sourceCoverage: context.sourceCoverage });
    expect(candidate.sourceAnchors[0].sourceText).toContain('subject to approval');
    expect(candidate).not.toHaveProperty('workRef');
    expect(candidate.statements[0]).not.toHaveProperty('statementId');
    const saved = materializeDocumentActivityRevision(candidate, { runRef: 'run-host', candidateRevision: 2,
      statementIds: ['statement-host'], producer: { skillVersion: 'fixture', modelVersion: 'fixture' }, savedAt: '2026-09-16T00:00:00Z' });
    expect(saved).toMatchObject({ candidateOnly: true, candidateRevision: 2, statements: [{ statementId: 'statement-host' }] });
  });
  it('rejects model-written binding, coverage, IDs and activity equivalence', () => {
    const { context, proposal } = fixture();
    for (const field of ['sourceBinding', 'readCoverage', 'runRef'])
      expect(() => validateDocumentActivityCandidate({ ...proposal, [field]: {} }, context)).toThrow('SHAPE_INVALID');
    for (const field of ['statementId', 'activityId', 'sameActivity'])
      expect(() => validateDocumentActivityCandidate({ ...proposal, statements: [{ ...proposal.statements[0], [field]: 'invented' }] }, context)).toThrow('SHAPE_INVALID');
  });
  it('requires exact quotation from an actual delivered anchor, even if a different source has equal text', () => {
    const { context, proposal } = fixture();
    const bad = structuredClone(proposal);
    bad.statements[0].quotes[0].text += ' confirmed';
    expect(() => validateDocumentActivityCandidate(bad, context)).toThrow('QUOTE_MISMATCH');
    bad.statements[0].quotes[0] = { ...proposal.statements[0].quotes[0], anchorId: 'other-source' };
    expect(() => validateDocumentActivityCandidate(bad, context)).toThrow('QUOTE_NOT_DELIVERED');
    expect(() => validateDocumentActivityCandidate(proposal, { ...context, deliveredRanges: [] })).toThrow('HOST_CONTEXT_INVALID');
  });
  it('retains exact table cell path and context instead of flattening a table into inferred prose', () => {
    const { context, proposal } = fixture();
    const cell = context.deliveredAnchors.find(anchor => anchor.sourceText === '12 kPa')!;
    const result = validateDocumentActivityCandidate({ ...proposal, statements: [{ ...proposal.statements[0],
      quotes: [{ anchorId: cell.anchorId, start: 0, end: 6, text: '12 kPa' }], time: null }] }, context);
    const savedCell = result.sourceAnchors.find(anchor => anchor.anchorId === cell.anchorId)!;
    expect(savedCell.payloadPath).toBe('/payload/rowGroups/0/rows/0/cells/1/inlineContent/0/text');
    expect(savedCell.sourceRefIds).toEqual(['SR-TEST-P2']);
    expect(result.sourceAnchors.some(anchor => anchor.sourceText === 'Only when X')).toBe(true);
  });
  it('keeps TBD explicit, rejects invented time or status, and distinguishes quarter from frequency', () => {
    const { context, proposal } = fixture();
    const statement = proposal.statements[0];
    const tbd = { ...statement.time, role: 'OCCURRED', expression: 'TBD', precision: 'UNKNOWN', raw: 'TBD' };
    const validateTime = (time: unknown) => validateDocumentActivityCandidate({ ...proposal, statements: [{ ...statement, time }] }, context);
    expect(validateTime(tbd).statements[0].time).toEqual(tbd);
    expect(() => validateTime({ ...tbd, precision: 'DAY' })).toThrow('TIME_PRECISION_INVALID');
    expect(() => validateTime({ ...statement.time, precision: 'QUARTERLY' })).toThrow('SHAPE_INVALID');
    expect(() => validateTime({ ...statement.time, raw: '2026-12-31' })).toThrow('TIME_NOT_QUOTED');
    expect(() => validateDocumentActivityCandidate({ ...proposal, statements: [{ ...statement, statusRaw: 'completed' }] }, context)).toThrow('STATUS_NOT_QUOTED');
  });
  it('allows no statement in an actually delivered range without claiming document-wide absence', () => {
    const { context, proposal } = fixture();
    const result = validateDocumentActivityCandidate({ ...proposal, statements: [] }, context);
    expect(result.statements).toEqual([]);
    expect(result.readCoverage.sourceCoverage.unresolvedRanges.length).toBeGreaterThan(0);
    expect(result.readCoverage.status).toBe('DELIVERED_RANGES_ONLY');
  });
  it('rejects duplicate local keys and Host IDs, and does not mutate earlier revisions', () => {
    const { context, proposal } = fixture();
    expect(() => validateDocumentActivityCandidate({ ...proposal, statements: [proposal.statements[0], proposal.statements[0]] }, context)).toThrow('STATEMENT_KEY_DUPLICATE');
    const candidate = validateDocumentActivityCandidate(proposal, context);
    const saved = materializeDocumentActivityRevision(candidate, { runRef: 'run', candidateRevision: 1,
      statementIds: ['host-1'], producer: { skillVersion: 'fixture', modelVersion: 'fixture' }, savedAt: '2026-09-16T00:00:00Z' });
    candidate.statements[0].label = 'Later mutation';
    expect(saved.statements[0].label).toBe('Source target');
    expect(() => materializeDocumentActivityRevision(candidate, { runRef: 'run', candidateRevision: 1,
      statementIds: [], producer: { skillVersion: 'fixture', modelVersion: 'fixture' }, savedAt: '2026-09-16T00:00:00Z' })).toThrow('HOST_IDENTITY_INVALID');
  });
});
