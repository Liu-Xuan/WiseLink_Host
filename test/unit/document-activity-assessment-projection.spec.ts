import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type { DocumentActivityValidationContext } from '../../server/modules/canonical-host/document-activity-candidate';
import { DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA } from '@shared/document-activity.interface';
import { materializeDocumentActivityRevision, validateDocumentActivityCandidate } from '../../server/modules/canonical-host/document-activity-candidate';
import { projectSavedDocumentActivityForAssessment, readProjectedDocumentActivityStatement } from '../../server/modules/canonical-host/document-activity-assessment-projection';
import { buildTranslationSourcePlan } from '../../server/modules/canonical-host/canonical-translation-source-plan';
import { documentOriginalEngineeringReading } from '../../server/modules/canonical-host/document-original-engineering-reading';
import { buildDocumentSemanticMap, selectDocumentSemanticSection } from '../../server/modules/document-management/src/hosted/nest/document-semantic-map';
import { GENERIC_SEMANTIC_PROFILE } from '../../server/modules/document-management/src/hosted/nest/document-semantic-profile';
import { documentOriginalReadingCoverage } from '../../server/modules/document-management/src/hosted/nest/document-original-adapter';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';

/** Public constructed fixture only. No gold/holdout, DB, OCR or model. */
function fixture(text = 'Target Q4 2026; completion TBD. should retain TLS and LN 1400-1420. 😀', crossModule = false) {
  const original = originalFixture();
  const seed = original.source.units[0];
  original.source.units.unshift(
    { ...structuredClone(seed), unitId: 'h-parent', kind: 'heading', order: -3, payload: { text: 'Source conditions', level: 1 } },
    { ...structuredClone(seed), unitId: 'condition', order: -2, payload: { text: 'Only when X holds; otherwise do not use method M.' } },
    { ...structuredClone(seed), unitId: 'h-child', kind: 'heading', order: -1, payload: { text: 'Planned actions', level: 2 } },
  );
  original.source.units.find(unit => unit.unitId === 'u1')!.payload.text = text;
  if (crossModule) {
    original.source.modules.push({ moduleId: 'other', order: 1 });
    original.source.units.filter(unit => ['h-child', 'u1', 'u2'].includes(unit.unitId))
      .forEach(unit => { unit.moduleId = 'other'; });
  }
  const semanticMap = buildDocumentSemanticMap({ original, semanticRevision: 3, profile: GENERIC_SEMANTIC_PROFILE });
  const plan = buildTranslationSourcePlan({ documentVersionId: original.binding.documentVersionId,
    packageId: original.binding.parseRunId, title: '', source: original.source,
    parsedArtifact: { storeRole: 'UnifiedArtifactStoreCandidate', ref: 'constructed-not-read',
      sha256: 'b'.repeat(64), byteLength: 1, mediaType: 'application/json' } });
  const selected = selectDocumentSemanticSection(original, semanticMap, 'section:h-child');
  const ids = new Set([...selected.unitIds, ...selected.contextUnitIds]);
  const units = original.source.units.filter(unit => ids.has(unit.unitId));
  const anchors = plan.anchors.filter(anchor => ids.has(anchor.sourceUnitId));
  const context: DocumentActivityValidationContext = {
    sourceBinding: { original: original.binding, semanticRevision: semanticMap.semanticRevision },
    selection: { sectionIds: ['section:h-child'] }, deliveredAnchors: anchors,
    deliveredRanges: [{ sectionId: 'section:h-child', offset: 0, unitIds: units.map(unit => unit.unitId),
      anchorIds: anchors.map(anchor => anchor.anchorId), nextOffset: null }],
    sourceCoverage: documentOriginalReadingCoverage(original),
  };
  const anchor = anchors.find(value => value.sourceUnitId === 'u1')!;
  const table = anchors.find(value => value.sourceText === '12 kPa')!;
  const candidate = validateDocumentActivityCandidate({ schemaVersion: DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA, statements: [
    { statementKey: 'planned', label: '  Source target 😀\n',
      quotes: [{ anchorId: anchor.anchorId, start: 0, end: anchor.sourceText.length, text: anchor.sourceText }],
      time: text.includes('Q4 2026') ? { role: 'TARGET', precision: 'QUARTER', expression: 'CALENDAR', raw: 'Q4 2026', quoteIndex: 0 } : null,
      statusRaw: text.includes('TBD') ? 'TBD' : null, limitations: ['  subject to approval\n', 'Unresolved source scope'] },
    { statementKey: 'pressure', label: 'Source table limit',
      quotes: [{ anchorId: table.anchorId, start: 0, end: table.sourceText.length, text: table.sourceText }],
      time: null, statusRaw: null, limitations: ['Only when X'] },
  ] }, context);
  const savedRevision = materializeDocumentActivityRevision(candidate, { runRef: 'DAR-fixture', candidateRevision: 7,
    statementIds: ['DAS-fixture-1', 'DAS-fixture-2'], producer: { skillVersion: 'constructed', modelVersion: 'not-called' },
    savedAt: '2026-09-16T00:00:00Z' });
  const originalEvidence = documentOriginalEngineeringReading({ original, structuredSource: original.source,
    run: { documentVersionId: original.binding.documentVersionId, parseRunId: original.binding.parseRunId,
      parseRevision: original.binding.parseRevision,
      manifestArtifact: { relativePath: 'original/manifest.json', readback: 'VERIFIED', sha256: 'b'.repeat(64), byteLength: 1 } },
  } as never, 0, 20, crossModule ? null : semanticMap).evidence;
  return { savedRevision, original, semanticMap, originalEvidence };
}
const roots = ['DOCUMENT_ORIGINAL:DV-TEST:PR-TEST-2:SR-TEST-P1', 'DOCUMENT_ORIGINAL:DV-TEST:PR-TEST-2:SR-TEST-P2'];

it('Host frozen producer saved assessment projection preserves optional metadata while keeping actual version independent', () => {
  const input = fixture();
  input.savedRevision.producer.executionModel = { modelRef: 'miaoda/glm-5.3', displayName: 'GLM5.3', providerKind: 'BUILT_IN',
    settingsRevision: 1, selectedAt: '2026-10-12T00:00:00.000Z' };
  const before = JSON.stringify(input);
  expect(projectSavedDocumentActivityForAssessment(input).records).toHaveLength(2);
  expect(JSON.stringify(input)).toBe(before);
  expect(input.savedRevision.producer.modelVersion).toBe('not-called');
});

it('Host frozen producer saved assessment projection rejects malformed optional metadata rather than stripping it', () => {
  for (const pin of [null, { modelRef: 'unbound' }, { modelRef: 'miaoda/glm-5.3', displayName: 'GLM5.3',
    providerKind: 'BUILT_IN', settingsRevision: 1, selectedAt: '2026-10-12T00:00:00.000Z', extra: true }]) {
    const input = fixture(); input.savedRevision.producer.executionModel = pin as never;
    expect(() => projectSavedDocumentActivityForAssessment(input)).toThrow();
  }
});

describe('saved Activity v1 assessment projection (D0 only)', () => {
  it('preserves source bytes, exact identities and legacy markers without semantic inventions', () => {
    const input = fixture(); const before = JSON.stringify(input);
    const projected = projectSavedDocumentActivityForAssessment(input);
    expect(projected).toMatchObject({ schemaVersion: 'wiselink.document.activity-assessment-projection.v1',
      availability: 'AVAILABLE', sourceBinding: input.savedRevision.sourceBinding });
    expect(projected.entries.map(entry => entry.ref)).toEqual(['DOCUMENT_ACTIVITY:DAR-fixture:7:DAS-fixture-1', 'DOCUMENT_ACTIVITY:DAR-fixture:7:DAS-fixture-2']);
    projected.records.forEach((record, index) => {
      expect(JSON.stringify(record.statement)).toBe(JSON.stringify(input.savedRevision.statements[index]));
      expect(record).toMatchObject({ candidateOnly: true, sourceSchemaVersion: DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA,
        semanticFieldsAvailability: 'LEGACY_PARTIAL', scopeBasis: 'LEGACY_RUN_SCOPE' });
      for (const key of ['subject', 'action', 'modality', 'status', 'times', 'technicalIds', 'scope']) expect(record.statement).not.toHaveProperty(key);
    });
    expect(projected.entries[0].label).toBe(input.savedRevision.statements[0].label);
    expect(projected.activityContexts).toEqual([{ runRef: 'DAR-fixture', candidateRevision: 7, readCoverage: input.savedRevision.readCoverage }]);
    expect(projected.limitations.join(' ')).toMatch(/已交付|delivered/iu);
    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.stringify(projectSavedDocumentActivityForAssessment(input))).toBe(JSON.stringify(projected));
  });
  it('distinguishes no saved from saved-empty delivered scope without document-wide absence', () => {
    const input = fixture();
    const missing = projectSavedDocumentActivityForAssessment({ ...input, savedRevision: null, originalEvidence: [] });
    expect(missing).toMatchObject({ availability: 'NOT_SAVED', entries: [], records: [], activityContexts: [] });
    input.savedRevision.statements = [];
    const empty = projectSavedDocumentActivityForAssessment(input);
    expect(empty).toMatchObject({ availability: 'AVAILABLE', entries: [], records: [], activityContexts: [{ readCoverage: input.savedRevision.readCoverage }] });
    expect(empty.limitations).not.toEqual(missing.limitations);
    expect(empty.limitations.join(' ')).toMatch(/此次|范围|scope/iu);
    expect(empty.limitations.join(' ')).not.toMatch(/全文无|no activities in the document/iu);
  });
  it('retains every delivered run root and table path, including unquoted conditions', () => {
    const projected = projectSavedDocumentActivityForAssessment(fixture());
    expect(projected.records[0].rootRefs).toEqual([roots[0]]);
    expect(projected.records[1].rootRefs).toEqual([roots[1]]);
    expect(projected.records.every(record => JSON.stringify(record.requiredContextRootRefs) === JSON.stringify(roots))).toBe(true);
    expect(projected.records[1].quoteLocators[0]).toMatchObject({ sourceUnitId: 'u2', payloadPath: '/payload/rowGroups/0/rows/0/cells/1/inlineContent/0/text',
      sourceRefIds: ['SR-TEST-P2'], rootRefs: [roots[1]] });
    expect(readProjectedDocumentActivityStatement(projected, projected.records[1].reference)).toEqual(projected.records[1]);
  });
  it('deduplicates roots despite repeated receipts/multiple statements on the same source', () => {
    const input = fixture();
    input.savedRevision.readCoverage.deliveredRanges.push(structuredClone(input.savedRevision.readCoverage.deliveredRanges[0]));
    input.originalEvidence.push(structuredClone(input.originalEvidence[0]));
    const second = structuredClone(input.savedRevision.statements[0]); second.statementId = 'DAS-same-root'; second.statementKey = 'same-root';
    input.savedRevision.statements.push(second);
    const projected = projectSavedDocumentActivityForAssessment(input);
    expect(projected.records[2].rootRefs).toEqual(projected.records[0].rootRefs);
    expect(new Set(projected.records.flatMap(record => [...record.rootRefs, ...record.requiredContextRootRefs]))).toEqual(new Set(roots));
    expect(projected.activityContexts).toHaveLength(1);
    expect(projected.activityContexts[0].readCoverage.deliveredRanges).toHaveLength(2);
  });
  it.each(['documentVersionId', 'parseRunId', 'parseRevision', 'sourceArtifactId', 'sourceSha256', 'sourceByteLength'] as const)(
    'rejects mismatched original %s without fallback', key => {
      const input = fixture(); const binding = input.savedRevision.sourceBinding.original;
      if (typeof binding[key] === 'number') Object.assign(binding, { [key]: Number(binding[key]) + 1 });
      else Object.assign(binding, { [key]: `${String(binding[key])}-changed` });
      expect(() => projectSavedDocumentActivityForAssessment(input)).toThrow('SOURCE_BINDING_MISMATCH');
    });
  it('rejects cross-semantic/map references, missing/duplicate Host identities and wrong exact triples', () => {
    const input = fixture(); input.savedRevision.sourceBinding.semanticRevision += 1;
    expect(() => projectSavedDocumentActivityForAssessment(input)).toThrow('SEMANTIC_REVISION_MISMATCH');
    const mapWrong = fixture(); mapWrong.semanticMap.binding.parseRunId = 'PR-other';
    expect(() => projectSavedDocumentActivityForAssessment(mapWrong)).toThrow('SOURCE_BINDING_MISMATCH');
    const edits: Array<(value: ReturnType<typeof fixture>) => void> = [
      value => { value.savedRevision.runRef = ''; }, value => { value.savedRevision.candidateRevision = 0; },
      value => { value.savedRevision.statements[1].statementId = value.savedRevision.statements[0].statementId; },
    ];
    for (const edit of edits) { const bad = fixture(); edit(bad); expect(() => projectSavedDocumentActivityForAssessment(bad)).toThrow(); }
    const projection = projectSavedDocumentActivityForAssessment(fixture()); const reference = projection.records[0].reference;
    for (const wrong of [{ ...reference, runRef: 'DAR-other' }, { ...reference, candidateRevision: 8 }, { ...reference, statementId: 'DAS-other' }]) {
      expect(() => readProjectedDocumentActivityStatement(projection, wrong)).toThrow('STATEMENT_REFERENCE_NOT_FOUND');
    }
  });
  it('rejects altered quotes/unquoted anchors/paths/locators/receipt membership/coverage', () => {
    const edits: Array<(value: ReturnType<typeof fixture>) => void> = [
      value => { value.savedRevision.statements[0].quotes[0].text += ' changed'; },
      value => { value.savedRevision.sourceAnchors[0].sourceText += ' forged'; },
      value => { value.savedRevision.sourceAnchors[0].payloadPath = '/payload/wrong'; },
      value => { value.savedRevision.sourceAnchors[0].sourceLocators[0].artifactId = 'wrong'; },
      value => { value.savedRevision.readCoverage.deliveredRanges[0].anchorIds.pop(); },
      value => { value.savedRevision.readCoverage.deliveredRanges[0].unitIds.pop(); },
      value => { value.savedRevision.readCoverage.deliveredRanges[0].offset = 1; },
      value => { value.savedRevision.readCoverage.selection.sectionIds.push('unknown-undelivered-section'); },
      value => { value.savedRevision.readCoverage.sourceCoverage.unresolvedRanges = []; },
    ];
    for (const edit of edits) { const input = fixture(); edit(input); expect(() => projectSavedDocumentActivityForAssessment(input)).toThrow(); }
  });
  it('refuses missing/wrong-parse/changed-text/changed-locator/conflicting duplicate roots', () => {
    const edits: Array<(value: ReturnType<typeof fixture>) => void> = [
      value => { value.originalEvidence.pop(); },
      value => { value.originalEvidence[0].evidenceRef = 'DOCUMENT_ORIGINAL:DV-TEST:PR-other:SR-TEST-P1'; },
      value => { value.originalEvidence[0].excerpt += ' changed'; },
      value => { value.originalEvidence[0].locator = JSON.stringify({ parseRunId: 'PR-other' }); },
      value => { value.originalEvidence.push({ ...value.originalEvidence[0], excerpt: 'conflicting duplicate' }); },
    ];
    for (const edit of edits) { const input = fixture(); edit(input); expect(() => projectSavedDocumentActivityForAssessment(input)).toThrow(/ROOT|EVIDENCE/u); }
  });
  it('does not treat page/figure listings or a directory as delivered body', () => {
    const input = fixture(); const first = input.savedRevision.readCoverage.deliveredRanges[0];
    input.savedRevision.readCoverage.deliveredRanges = [{ ...first, unitIds: first.unitIds.slice(0, 1), anchorIds: first.anchorIds.slice(0, 1), nextOffset: 1 }];
    input.savedRevision.sourceAnchors = input.savedRevision.sourceAnchors.slice(0, 1); input.savedRevision.statements = [];
    const projected = projectSavedDocumentActivityForAssessment(input);
    expect(projected.activityContexts[0].readCoverage.deliveredRanges[0].nextOffset).toBe(1);
    expect(projected).not.toHaveProperty('initiallyDeliveredRefs');
    expect(projected.activityContexts[0].readCoverage.sourceCoverage.knownPageCount).toBe(3);
    expect(projected.activityContexts[0].readCoverage.sourceCoverage.unresolvedRanges).toEqual(input.savedRevision.readCoverage.sourceCoverage.unresolvedRanges);
  });
  it('retains >64KiB complete records without a budget gate and returns detached snapshots', () => {
    const input = fixture('TBD 😀 '.repeat(12000)); const projected = projectSavedDocumentActivityForAssessment(input);
    expect(Buffer.byteLength(JSON.stringify(projected))).toBeGreaterThan(64 * 1024);
    expect(projected.records[0].statement.quotes[0].text).toBe(input.savedRevision.statements[0].quotes[0].text);
    const record = readProjectedDocumentActivityStatement(projected, projected.records[0].reference); record.statement.label = 'mutated getter';
    expect(projected.records[0].statement.label).not.toBe('mutated getter');
    projected.records[0].statement.quotes[0].text = 'mutated'; projected.activityContexts[0].readCoverage.selection.sectionIds.length = 0;
    expect(input.savedRevision.statements[0].quotes[0].text.length).toBeGreaterThan(64000);
    expect(input.savedRevision.readCoverage.selection.sectionIds).toHaveLength(1);
  });
  it('rejects v2 additions instead of silently accepting or rewriting them', () => {
    const input = fixture(); Object.assign(input.savedRevision.statements[0], { modality: { meaning: 'REQUIRED' } });
    expect(() => projectSavedDocumentActivityForAssessment(input)).toThrow('SHAPE_INVALID');
    const bad = fixture(); Object.assign(bad.savedRevision, { candidateOnly: false });
    expect(() => projectSavedDocumentActivityForAssessment(bad)).toThrow('SAVED_REVISION_INVALID');
  });
  it('preserves the existing exact UTF-16 quote contract, including partial surrogate slices', () => {
    const input = fixture('😀');
    const quote = input.savedRevision.statements[0].quotes[0];
    quote.end = 1; quote.text = quote.text.slice(0, 1);
    const projected = projectSavedDocumentActivityForAssessment(input);
    expect(projected.records[0].statement.quotes[0]).toEqual(quote);
    expect(projected.records[0].statement.quotes[0].text.charCodeAt(0)).toBe(0xD83D);
  });
  it('reuses base-reader roots even when semantic translation cannot reparent across modules', () => {
    const input = fixture('TBD', true);
    expect(projectSavedDocumentActivityForAssessment(input).records).toHaveLength(2);
  });
  it('requires real original carriers rather than candidate/host fact roots', () => {
    const input = fixture();
    const root: AssessmentEvidence = { evidenceRef: input.originalEvidence[0].evidenceRef, kind: 'PRIOR_RESULT', title: 'not original',
      versionLabel: null, excerpt: 'hint only', resultRef: 'other', resultRevision: 1, originalEvidenceRefs: [] };
    expect(() => projectSavedDocumentActivityForAssessment({ ...input, originalEvidence: [root] })).toThrow('ROOT_EVIDENCE_INVALID');
  });
});
