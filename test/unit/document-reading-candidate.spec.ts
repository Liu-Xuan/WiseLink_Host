import { DOCUMENT_READING_SCHEMA } from '../../shared/document-reading.interface';
import { validateDocumentReading, materializeDocumentReading,
  type DocumentReadingValidationContext } from '../../server/modules/canonical-host/document-reading-candidate';
import { buildTranslationSourcePlan } from '../../server/modules/canonical-host/canonical-translation-source-plan';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';

function fixture() {
  const original = originalFixture();
  original.source.units[0].payload.text = 'Applicability is not confirmed until configuration is verified.';
  const plan = buildTranslationSourcePlan({ documentVersionId: original.binding.documentVersionId,
    packageId: original.binding.parseRunId, title: '', source: original.source,
    parsedArtifact: { storeRole: 'UnifiedArtifactStoreCandidate', ref: 'fixture-only', sha256: 'a'.repeat(64),
      byteLength: 1, mediaType: 'application/json' } });
  const unitIds = original.source.units.map(unit => unit.unitId);
  const context: DocumentReadingValidationContext = {
    sourceBinding: { original: original.binding, semanticRevision: 1 }, sourceUnitIds: unitIds,
    sourceCoverage: original.coverage, deliveredAnchors: plan.anchors,
    delivered: [{ offset: 0, unitIds, anchorIds: plan.anchors.map(anchor => anchor.anchorId), nextOffset: null }],
  };
  const anchor = plan.anchors.find(item => item.sourceUnitId === 'u1')!;
  const item = { text: '构型核实前，尚不能确认适用。',
    quotes: [{ anchorId: anchor.anchorId, start: 0, end: anchor.sourceText.length, text: anchor.sourceText }] };
  return { context, proposal: { schemaVersion: DOCUMENT_READING_SCHEMA, headline: '构型核实与适用条件',
    brief: item, explanation: [item], criticalConditions: [item], limitations: ['仅为文件解读，未确认机队适用。'] } };
}

describe('independent document reading candidates', () => {
  it('saves short and complete reading together without losing a decisive negative or source limitation', () => {
    const { context, proposal } = fixture();
    const candidate = validateDocumentReading(proposal, context);
    const saved = materializeDocumentReading(candidate, { readingRunRef: 'DRR-fixture', readingRevision: 2,
      producer: { skillVersion: 'fixture', modelVersion: 'fixture' }, savedAt: '2026-09-17T00:00:00Z' });
    expect(saved.brief.text).toBe('构型核实前，尚不能确认适用。');
    expect(saved.readCoverage.status).toBe('COMPLETE_DELIVERY');
    expect(saved.readCoverage.sourceCoverage.unresolvedRanges).toEqual(context.sourceCoverage.unresolvedRanges);
    expect(saved.readCoverage.sourceCoverage.unresolvedRanges.length).toBeGreaterThan(0);
    expect(saved).not.toHaveProperty('statements');
    expect(saved).not.toHaveProperty('candidateRevision');
    candidate.brief.text = 'changed';
    expect(saved.brief.text).toBe(proposal.brief.text);
  });

  it('accepts useful partial reading but never calls it whole-document delivery', () => {
    const { context, proposal } = fixture();
    const first = context.sourceUnitIds[0];
    const anchors = context.deliveredAnchors.filter(anchor => anchor.sourceUnitId === first);
    const result = validateDocumentReading(proposal, { ...context, deliveredAnchors: anchors,
      delivered: [{ offset: 0, unitIds: [first], anchorIds: anchors.map(anchor => anchor.anchorId), nextOffset: 1 }] });
    expect(result.readCoverage).toMatchObject({ status: 'PARTIAL_DELIVERY', deliveredUnitIds: [first], totalUnitCount: context.sourceUnitIds.length });
  });

  it('rejects forged coverage or binding and quotations not actually delivered', () => {
    const { context, proposal } = fixture();
    for (const field of ['sourceBinding', 'readCoverage', 'readingRevision', 'candidateOnly'])
      expect(() => validateDocumentReading({ ...proposal, [field]: {} }, context)).toThrow('SHAPE_INVALID');
    const altered = structuredClone(proposal);
    altered.brief.quotes[0].text += ' confirmed';
    expect(() => validateDocumentReading(altered, context)).toThrow('QUOTE_MISMATCH');
    altered.brief.quotes[0] = { ...proposal.brief.quotes[0], anchorId: 'other-document' };
    expect(() => validateDocumentReading(altered, context)).toThrow('QUOTE_NOT_DELIVERED');
    expect(() => validateDocumentReading(proposal, { ...context, delivered: [] })).toThrow('DELIVERY_ANCHOR_INVALID');
  });

  it('does not infer complete coverage from duplicated or mispositioned pagination receipts', () => {
    const { context, proposal } = fixture();
    const receipt = context.delivered[0];
    expect(() => validateDocumentReading(proposal, { ...context, delivered: [receipt, receipt] })).toThrow('DELIVERY_INVALID');
    expect(() => validateDocumentReading(proposal, { ...context, delivered: [{ ...receipt, offset: 1 }] })).toThrow('DELIVERY_INVALID');
    expect(() => validateDocumentReading(proposal, { ...context, delivered: [{ ...receipt, unitIds: receipt.unitIds.slice(0, 1) }] })).toThrow('DELIVERY_INVALID');
  });
});
