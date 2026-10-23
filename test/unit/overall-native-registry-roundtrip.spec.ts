import type { AssessmentTdmsNativeEvidence } from '@shared/assessment-tdms-evidence';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import { parseAssessmentTdmsEvidence } from '@shared/assessment-tdms-evidence';
import { canonicalJson } from '@server/modules/action-attempt/action-attempt-envelope';
import { JOBAID_METHOD_EVIDENCE } from '@server/modules/canonical-host/jobaid-method-pack';
import { overallModelEvidenceRegistry } from '@server/modules/canonical-host/overall-assessment-reading';
import { consumeOpenClawOverallSynthesisOutput, type OpenClawOverallSynthesisInput } from '@server/modules/canonical-host/openclaw-overall-synthesis.processor';
import { tdmsNativeEvidenceFixture } from './fixtures/tdms-native-evidence.fixture';

/** Synthetic input and independently rebuilt reading carrier; no business files. */
function fixture(evidence = tdmsNativeEvidenceFixture()) {
  const input: OpenClawOverallSynthesisInput = {
    operation: 'SYNTHESIZE_OVERALL_CANDIDATE', outputCorrelationRef: 'overall://synthetic',
    applicabilityResult: null,
    baseRuleResult: { documentVersionId: 'DV-synthetic', packageId: 'PKG-synthetic', revision: 1,
      artifactSha256: 'sha256:' + 'a'.repeat(64), unresolvedCount: 0 },
    unifiedSourceContext: { sourceRefs: [], currentDocumentSourceRefIds: [] },
    adoptedDocumentVersions: [], externalDiscoveryResults: [],
    engineerReviewContext: { revision: null, artifactSha256: null, reviewCount: 0, history: [], effective: [] },
    selectiveResynthesis: { mode: 'INITIAL', criterionSetId: 'synthetic', baseRuleRevision: 1,
      baseRuleArtifactSha256: 'a'.repeat(64), staleOverallRevision: null, targetOverallRevision: 1,
      priorEngineerReviewRevision: null, currentEngineerReviewRevision: null,
      affectedCriterionIds: [], reusedCriterionIds: [], adoptedEvidenceSourceRefIds: [] },
    evidenceProjectionVersion: 'SOURCE_CONTEXT_V1',
    evidenceRegistry: overallModelEvidenceRegistry([structuredClone(evidence)], 'SOURCE_CONTEXT_V1'),
  };
  const output = JSON.stringify({
    sourceResultId: input.outputCorrelationRef, documentVersionId: 'DV-synthetic', packageId: 'PKG-synthetic',
    baseRuleRevision: 1, baseRuleArtifactSha256: input.baseRuleResult.artifactSha256,
    engineerReviewRevision: null, engineerReviewArtifactSha256: null,
    discoveryStatus: 'NO_DISCOVERY', gap: null, candidateRefCount: 0, findingCount: 0, unresolvedCount: 0,
    authorityLevel: 'candidate_only', externalDiscoveryIsEvidence: false,
    overallCandidate: 'Source reports a conditional opinion; execution remains unknown.',
    engineeringSummary: { schemaVersion: 'wiselink.3_1.overall_engineering_summary.v2',
      headline: 'Conditional source opinion', listBrief: 'Current applicability requires verification.',
      lead: 'Source reports a conditional opinion; execution remains unknown.',
      claims: [{ claimId: 'C1', text: 'A source-declared opinion supplies context only.', basis: 'SOURCE_FACT',
        premises: [{ evidenceRef: evidence.evidenceRef, role: 'CONTEXT', explanation: 'Exact retained source opinion.',
          limitation: 'No adoption or execution proof.' }] }], decisiveClaimIds: ['C1'] },
    findings: [], missingInputs: [], applicabilityStatus: 'UNKNOWN/WAITING_INPUT',
    engineeringReviewRequired: true, adopted: false, usableAsEvidence: false, providers: {},
  });
  return { input, output, evidence: parseAssessmentTdmsEvidence(structuredClone(evidence)) };
}

function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)]));
  return value;
}

describe('synthetic Overall native registry actual consumer', () => {
  it('accepts an independently cloned and parsed carrier', () => {
    const f = fixture();
    expect(() => consumeOpenClawOverallSynthesisOutput(f.input, f.output, [f.evidence])).not.toThrow();
  });
  it('accepts independent sealed JSON input and carrier round trips', () => {
    const f = fixture();
    expect(() => consumeOpenClawOverallSynthesisOutput(JSON.parse(JSON.stringify(f.input)), f.output,
      JSON.parse(JSON.stringify([f.evidence])))).not.toThrow();
  });
  it('accepts canonical JSON and different object key insertion orders', () => {
    const f = fixture();
    expect(() => consumeOpenClawOverallSynthesisOutput(JSON.parse(canonicalJson(reverseKeys(f.input))), f.output,
      JSON.parse(JSON.stringify(reverseKeys([f.evidence]))))).not.toThrow();
  });
  const changes: Array<[string, (e: AssessmentTdmsNativeEvidence) => void]> = [
    ['recordRef', e => { e.nativeSource.recordRef = 'another-record'; }],
    ['sourceRevisionRef', e => { e.nativeSource.sourceRevisionRef = e.nativeScope.sourceRevisionRef =
      e.nativeReadReceipt.sourceRevisionRef = e.nativeScope.processingSetBinding.assessmentObservationRef = 'another-observation'; }],
    ['generation', e => { e.nativeScope.processingSetBinding.generation += 1; }],
    ['cohort', e => { e.nativeScope.processingSetBinding.cohortRef = 'another-cohort'; }],
    ['member', e => { e.nativeScope.processingSetBinding.memberRef = 'another-member'; }],
    ['selector', e => { e.nativeScope.fieldSelectors[0].selector = e.nativeSource.fieldSelectors[0].selector = '/another-selector'; }],
    ['receiptRef', e => { e.nativeReadReceipt.receiptRef = 'another-receipt'; }],
    ['taskContextRef', e => { e.nativeReadReceipt.taskContextRef = 'another-task'; }],
    ['permissionRevision', e => { e.nativeReadReceipt.permissionRevision = 'another-permission'; }],
    ['fieldPath', e => { e.nativeReadReceipt.fieldPaths[0] = e.nativeScope.fieldSelectors[0].fieldPath =
      e.nativeSource.fieldSelectors[0].fieldPath = 'content.opinions[1]'; }],
  ];
  it.each(changes)('rejects legal nested %s drift by registry value comparison', (_name, change) => {
    const f = fixture(); const changed = structuredClone(f.evidence); change(changed);
    // Establish a legal carrier so the failure is not a schema/parser rejection.
    expect(() => parseAssessmentTdmsEvidence(changed)).not.toThrow();
    f.input.evidenceRegistry = overallModelEvidenceRegistry([changed], 'SOURCE_CONTEXT_V1');
    expect(() => consumeOpenClawOverallSynthesisOutput(f.input, f.output, [f.evidence]))
      .toThrow('OVERALL_READING_EVIDENCE_INPUT_MISMATCH');
  });
  it.each(['nativeSource', 'nativeScope', 'nativeReadReceipt'])('rejects missing or nonstructural %s', key => {
    for (const replacement of [undefined, null, 'primitive', 7]) {
      const f = fixture(); const actual = f.input.evidenceRegistry![0] as unknown as Record<string, unknown>;
      if (replacement === undefined) delete actual[key]; else actual[key] = replacement;
      expect(() => consumeOpenClawOverallSynthesisOutput(f.input, f.output, [f.evidence])).toThrow();
    }
  });
  it('rejects an unknown registry key', () => {
    const f = fixture(); Object.assign(f.input.evidenceRegistry![0], { extra: true });
    expect(() => consumeOpenClawOverallSynthesisOutput(f.input, f.output, [f.evidence])).toThrow('OVERALL_READING_EVIDENCE_INPUT_SHAPE_INVALID');
  });
  it('preserves nested array order rather than sorting it', () => {
    const e = tdmsNativeEvidenceFixture();
    e.nativeSource.fieldSelectors.push({ fieldPath: 'content.opinions[1]', selector: '/assessments/1/other' });
    e.nativeScope.fieldSelectors.push({ fieldPath: 'content.opinions[1]', selector: '/assessments/1/other' });
    e.nativeReadReceipt.fieldPaths.push('content.opinions[1]');
    const f = fixture(e); const changed = structuredClone(e); changed.nativeReadReceipt.fieldPaths.reverse();
    expect(() => parseAssessmentTdmsEvidence(changed)).not.toThrow();
    f.input.evidenceRegistry = overallModelEvidenceRegistry([changed], 'SOURCE_CONTEXT_V1');
    expect(() => consumeOpenClawOverallSynthesisOutput(f.input, f.output, [f.evidence])).toThrow('OVERALL_READING_EVIDENCE_INPUT_MISMATCH');
  });
});

type MethodEvidence = Extract<AssessmentEvidence, { kind: 'METHOD_CLAUSE' }>;
function methodFixture(methodRef = 'method:risk') {
  const f = fixture();
  const method = structuredClone(JOBAID_METHOD_EVIDENCE.find(
    (item): item is MethodEvidence => item.kind === 'METHOD_CLAUSE' && item.evidenceRef === methodRef,
  )!);
  const evidence = [f.evidence, method];
  f.input.evidenceRegistry = overallModelEvidenceRegistry(evidence, 'SOURCE_CONTEXT_V1');
  const output = JSON.parse(f.output);
  output.engineeringSummary.claims.push({
    claimId: 'C2', text: '可能性仍需核对单机和机队暴露；方法定义不证明实际发生率。', basis: 'CONDITIONAL_INFERENCE',
    premises: [{ evidenceRef: method.evidenceRef, role: 'CONTEXT', explanation: method.classificationDefinitions![0].definitionQuote,
      limitation: '未取得实际暴露及发生记录，保持未知。' }],
  });
  output.engineeringSummary.decisiveClaimIds.push('C2');
  return { ...f, output: JSON.stringify(output), method, evidence, summary: output.engineeringSummary };
}

describe.each(['method:risk', 'method:severity-definitions'])('%s Overall method definitions actual consumer', methodRef => {
  it('accepts independently sealed input and carrier with exact definition content', () => {
    const f = methodFixture(methodRef);
    const input = JSON.parse(canonicalJson(reverseKeys(f.input)));
    const evidence = JSON.parse(JSON.stringify(f.evidence));
    expect(input.evidenceRegistry[1].classificationDefinitions).not.toBe(f.method.classificationDefinitions);
    expect(input.evidenceRegistry[1].classificationDefinitions).toEqual(f.method.classificationDefinitions);
    const consumed = consumeOpenClawOverallSynthesisOutput(input, f.output, evidence);
    expect(consumed.engineeringSummary).toEqual(f.summary);
    expect(evidence).toEqual(f.evidence);
  });

  const changes: Array<[string, (definitions: NonNullable<MethodEvidence['classificationDefinitions']>) => void]> = [
    ['dimension', definitions => { definitions[0].dimension = definitions[0].dimension === 'SEVERITY' ? 'LIKELIHOOD' : 'SEVERITY'; }],
    ['label', definitions => { definitions[0].label = 'altered label'; }],
    ['definitionQuote', definitions => { definitions[0].definitionQuote = 'altered definition'; }],
    ['order', definitions => { definitions.reverse(); }],
    ['missing entry', definitions => { definitions.pop(); }],
    ['extra entry', definitions => { definitions.push({ ...definitions[0] }); }],
  ];
  it.each(changes)('rejects %s drift from the exact Host method carrier', (_name, change) => {
    const f = methodFixture(methodRef);
    change(f.input.evidenceRegistry![1].classificationDefinitions!);
    expect(() => consumeOpenClawOverallSynthesisOutput(f.input, f.output, f.evidence))
      .toThrow('OVERALL_READING_EVIDENCE_INPUT_MISMATCH');
  });

  it('keeps absent legacy definitions absent and rejects one-sided omission', () => {
    const f = methodFixture(methodRef);
    delete f.input.evidenceRegistry![1].classificationDefinitions;
    expect(() => consumeOpenClawOverallSynthesisOutput(f.input, f.output, f.evidence))
      .toThrow('OVERALL_READING_EVIDENCE_INPUT_SHAPE_INVALID');
    delete f.method.classificationDefinitions;
    expect(() => consumeOpenClawOverallSynthesisOutput(f.input, f.output, f.evidence)).not.toThrow();
  });
});
