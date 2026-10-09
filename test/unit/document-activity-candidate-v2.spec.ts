import {
  DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2, DOCUMENT_ACTIVITY_SOURCE_CONTEXT_SCHEMA,
  type DocumentActivityCandidateProposalV2, type DocumentActivitySourceContext,
} from '../../shared/document-activity.interface';
import { DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA } from '../../shared/document-activity-quote-selection';
import { validateDocumentActivityCandidate, materializeDocumentActivityQuoteSelection, materializeDocumentActivityRevision,
  type DocumentActivityValidationContext } from '../../server/modules/canonical-host/document-activity-candidate';
import { buildTranslationSourcePlan } from '../../server/modules/canonical-host/canonical-translation-source-plan';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';

function fixture() {
  const original = originalFixture();
  original.source.units[0].payload.text = '😀 Supplier plans release in Q4 2026; expected approval in March 2027. Actual installation TBD. LN 2024-2026. Only after CIDB, do not install.';
  const plan = buildTranslationSourcePlan({ documentVersionId: original.binding.documentVersionId, packageId: original.binding.parseRunId,
    title: '', source: original.source, parsedArtifact: { storeRole: 'UnifiedArtifactStoreCandidate', ref: 'fixture-only',
      sha256: 'b'.repeat(64), byteLength: 1, mediaType: 'application/json' } });
  const anchor = plan.anchors.find(value => value.sourceUnitId === 'u1')!;
  const sourceBinding = { original: original.binding, semanticRevision: 1 };
  const sourceContext: DocumentActivitySourceContext = { schemaVersion: DOCUMENT_ACTIVITY_SOURCE_CONTEXT_SCHEMA, sourceBinding,
    profile: { profileRef: 'generic.author-sections.v1', selectionBasis: 'NOT_RECORDED', family: null, issuer: null },
    sections: [{ sectionId: 'leaf', parentSectionId: 'parent', titleRaw: null, roleKey: null, headingUnitId: null,
      deliveredUnitIds: ['u1'], contextForSectionIds: [] }, { sectionId: 'parent', parentSectionId: null, titleRaw: null,
      roleKey: null, headingUnitId: null, deliveredUnitIds: ['u2'], contextForSectionIds: ['leaf'] }], organizationWarnings: [] };
  const context: DocumentActivityValidationContext = { sourceBinding, selection: { sectionIds: ['leaf'] },
    deliveredRanges: [{ sectionId: 'leaf', offset: 0, unitIds: original.source.units.map(value => value.unitId),
      anchorIds: plan.anchors.map(value => value.anchorId), nextOffset: null }], deliveredAnchors: plan.anchors,
    sourceCoverage: original.coverage, sourceContext };
  const proposal: DocumentActivityCandidateProposalV2 = { schemaVersion: DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2, statements: [{
    statementKey: 'source-1', label: 'Source wording', quotes: [{ anchorId: anchor.anchorId, start: 0,
      end: anchor.sourceText.length, text: anchor.sourceText }], subject: { raw: 'Supplier', quoteIndex: 0 },
    action: { raw: 'release', quoteIndex: 0 }, modality: { raw: 'plans', quoteIndex: 0, meaning: 'PLANNED', negationQuoteIndexes: [0] },
    status: { raw: 'TBD', quoteIndex: 0, meaning: 'UNKNOWN' }, times: [
      { raw: 'Q4 2026', quoteIndex: 0, role: 'TARGET', expression: 'CALENDAR', precision: 'QUARTER' },
      { raw: 'March 2027', quoteIndex: 0, role: 'UNKNOWN', expression: 'CALENDAR', precision: 'MONTH' },
      { raw: 'TBD', quoteIndex: 0, role: 'UNKNOWN', expression: 'TBD', precision: 'UNKNOWN' }],
    technicalIds: [{ raw: 'LN 2024-2026', quoteIndex: 0, kind: 'AIRCRAFT_LINE_NUMBER' }],
    scope: { sectionIds: ['leaf'], conditions: [{ raw: 'Only after CIDB', quoteIndex: 0, kind: 'PREREQUISITE',
      appliesTo: 'SECTION', sectionIds: ['leaf'] }], completeness: 'DELIVERED_SCOPE_ONLY' },
    limitations: ['Expected approval is a forecast; source classification remains a candidate.'] }] };
  return { proposal, context, anchor };
}

describe('source v2 strict preservation (synthetic, no semantic-certification claim)', () => {
  it('preserves ordered multi-time roles, forecast/TBD, negation, technical ranges and raw bytes through immutable materialization', () => {
    const f = fixture(); const validated = validateDocumentActivityCandidate(f.proposal, f.context);
    expect(validated.statements).toEqual(f.proposal.statements);
    expect(validated.statements[0].times.map(value => value.raw)).toEqual(['Q4 2026','March 2027','TBD']);
    const saved = materializeDocumentActivityRevision(validated, { runRef: 'DAR-saved', candidateRevision: 7,
      statementIds: ['DAS-host'], producer: { skillVersion: 'fixture', modelVersion: 'not-called' }, savedAt: '2026-10-06T00:00:00Z' });
    expect(saved.statements[0]).toEqual({ ...f.proposal.statements[0], statementId: 'DAS-host' });
    expect(saved.sourceContext).toEqual(f.context.sourceContext); expect(saved.statements[0]).not.toHaveProperty('time');
    f.proposal.statements[0].times[0].raw = 'later mutation'; expect(saved.statements[0].times[0].raw).toBe('Q4 2026');
  });
  it('resolves exact UTF-16 quote selections without reordering indexes or degrading v2 fields', () => {
    const f = fixture(); const selection = { ...f.proposal, quoteSelectionSchemaVersion: DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA,
      statements: f.proposal.statements.map(statement => ({ ...statement, quotes: [{ anchorId: f.anchor.anchorId, text: f.anchor.sourceText }] })) };
    const canonical = materializeDocumentActivityQuoteSelection(selection, { sourceBinding: f.context.sourceBinding,
      expectedSourceBinding: f.context.sourceBinding, anchors: f.context.deliveredAnchors, allowedAnchorIds: [f.anchor.anchorId] });
    expect(canonical).toEqual(f.proposal); expect(validateDocumentActivityCandidate(canonical, f.context).statements).toEqual(f.proposal.statements);
  });
  it.each(['subject','action','modality','status'] as const)('rejects an unquoted %s or wrong indexed quote', field => {
    const f = fixture(); f.proposal.statements[0][field]!.raw = 'invented';
    expect(() => validateDocumentActivityCandidate(f.proposal, f.context)).toThrow(`${field.toUpperCase()}_NOT_QUOTED`);
  });
  it('does not accept unquoted technical IDs, wrong precision, missing negation or scope support', () => {
    const mutate = (fn: (f: ReturnType<typeof fixture>) => void, error: string) => { const f = fixture(); fn(f);
      expect(() => validateDocumentActivityCandidate(f.proposal, f.context)).toThrow(error); };
    mutate(f => { f.proposal.statements[0].technicalIds[0].quoteIndex = 1; }, 'TECHNICAL_ID_NOT_QUOTED');
    mutate(f => { f.proposal.statements[0].times[2].precision = 'DAY'; }, 'TIME_PRECISION_INVALID');
    mutate(f => { f.proposal.statements[0].modality!.negationQuoteIndexes = [1]; }, 'NEGATION_INDEX_INVALID');
    mutate(f => { f.proposal.statements[0].modality!.negationQuoteIndexes = [0,0]; }, 'NEGATION_INDEX_INVALID');
    mutate(f => { f.proposal.statements[0].scope.sectionIds = ['unread']; }, 'SCOPE_NOT_DELIVERED');
    mutate(f => { f.proposal.statements[0].scope.conditions[0].appliesTo = 'DOCUMENT'; }, 'CONDITION_SCOPE_INVALID');
    mutate(f => { f.context.sourceContext!.sections[0].deliveredUnitIds = []; }, 'CONDITION_SCOPE_UNSUPPORTED');
  });
  it('accepts a quoted prerequisite in a delivered ancestor for its supported leaf without promoting it to execution', () => {
    const f = fixture(); const parent = f.context.deliveredAnchors.find(value => value.sourceText === 'Only when X')!;
    const statement = f.proposal.statements[0]; statement.quotes.push({ anchorId: parent.anchorId, start: 0, end: 11, text: 'Only when X' });
    statement.scope.conditions = [{ raw: 'Only when X', quoteIndex: 1, kind: 'CONDITION', appliesTo: 'SECTION', sectionIds: ['leaf'] }];
    expect(validateDocumentActivityCandidate(f.proposal, f.context).statements[0].scope.conditions).toEqual(statement.scope.conditions);
    f.context.sourceContext!.sections[1].contextForSectionIds = [];
    expect(() => validateDocumentActivityCandidate(f.proposal, f.context)).toThrow('CONDITION_SCOPE_UNSUPPORTED');
  });
  it('allows null cues, empty times/scope and zero statements without claiming source-wide absence', () => {
    const f = fixture(); const statement = f.proposal.statements[0]; statement.subject = null; statement.action = null;
    statement.modality = null; statement.status = null; statement.times = []; statement.technicalIds = [];
    statement.scope = { sectionIds: [], conditions: [], completeness: 'UNRESOLVED' };
    expect(validateDocumentActivityCandidate(f.proposal, f.context).statements).toEqual(f.proposal.statements);
    f.proposal.statements = []; expect(validateDocumentActivityCandidate(f.proposal, f.context).statements).toEqual([]);
    expect(() => validateDocumentActivityCandidate(f.proposal, { ...f.context, sourceContext: undefined })).toThrow('SOURCE_CONTEXT_REQUIRED');
  });
  it('rejects v1 fields, unknown schema and source-context drift instead of reinterpreting history', () => {
    const f = fixture(); expect(() => validateDocumentActivityCandidate({ ...f.proposal, schemaVersion: 'unknown' }, f.context)).toThrow('SHAPE_INVALID');
    expect(() => validateDocumentActivityCandidate({ ...f.proposal, statements: [{ ...f.proposal.statements[0], time: null }] }, f.context)).toThrow('SHAPE_INVALID');
    f.context.sourceContext = structuredClone(f.context.sourceContext!); f.context.sourceContext.sourceBinding.original.sourceSha256 = 'c'.repeat(64);
    expect(() => validateDocumentActivityCandidate(f.proposal, f.context)).toThrow('SOURCE_CONTEXT_REQUIRED');
  });
});
