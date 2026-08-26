import {
  applicabilityRuntimePolicy,
  parseApplicabilityCandidate,
  validateApplicabilityCandidateBinding,
  type ApplicabilityTaskContract,
} from '../../server/modules/canonical-host/canonical-host-openclaw-applicability.contract';

describe('canonical Host OpenClaw applicability contract', () => {
  it('accepts an exact source-bound candidate using the registered AST vocabulary', () => {
    const task = applicabilityTask();
    const candidate = parseApplicabilityCandidate(candidateFor(task));

    expect(() =>
      validateApplicabilityCandidateBinding(candidate, task),
    ).not.toThrow();
    expect(candidate.expressions[0].expressionAst).toEqual({
      type: 'assert',
      property: 'model',
      operator: 'eq',
      value: 'B737-8',
    });
  });

  it.each([
    [
      'cross-WorkItem SourceRef',
      (value: Record<string, any>) => {
        value.expressions[0].sourceRefIds = ['SRC-OTHER-WORKITEM'];
      },
      'APPLICABILITY_CANDIDATE_SOURCE_REF_MISMATCH',
    ],
    [
      'aircraft number drift',
      (value: Record<string, any>) => {
        value.aircraft.aircraftNumber = 'B-9999';
      },
      'APPLICABILITY_CANDIDATE_TASK_BINDING_MISMATCH',
    ],
    [
      'asOf drift',
      (value: Record<string, any>) => {
        value.aircraft.assessmentAsOf = '2026-08-26';
      },
      'APPLICABILITY_CANDIDATE_TASK_BINDING_MISMATCH',
    ],
    [
      'fleet version drift',
      (value: Record<string, any>) => {
        value.fleetBinding.sourceRevisionKey = 'fleet-r2';
      },
      'APPLICABILITY_CANDIDATE_TASK_BINDING_MISMATCH',
    ],
    [
      'runtime profile drift',
      (value: Record<string, any>) => {
        value.runtime.profileRef = 'forged-profile';
      },
      'APPLICABILITY_RUNTIME_MISMATCH',
    ],
  ])('rejects %s', (_label, mutate, expected) => {
    const task = applicabilityTask();
    const raw = candidateFor(task);
    mutate(raw);
    expect(() => {
      const candidate = parseApplicabilityCandidate(raw);
      validateApplicabilityCandidateBinding(candidate, task);
    }).toThrow(expected);
  });

  it('rejects unsupported and extraction-failed shapes instead of converting them to UNKNOWN', () => {
    const task = applicabilityTask();
    const unsupportedProperty = candidateFor(task);
    unsupportedProperty.expressions[0].expressionAst.property = 'invented';
    expect(() => parseApplicabilityCandidate(unsupportedProperty)).toThrow(
      'APPLICABILITY_AST_ASSERT_UNSUPPORTED',
    );

    const failedExtraction = candidateFor(task);
    failedExtraction.expressions[0].extractionStatus = 'extraction_failed';
    expect(() => parseApplicabilityCandidate(failedExtraction)).toThrow(
      'APPLICABILITY_EXPRESSION_STATUS_INVALID',
    );
  });
});

function applicabilityTask(): ApplicabilityTaskContract {
  return {
    schemaVersion: 'wiselink.3_1.applicability_task.v1',
    operation: 'EXTRACT_APPLICABILITY',
    applicabilityContextRef: 'APCTX-OPAQUE-1',
    inputRevision: 7,
    documentVersionRef: 'DV-1',
    sourcePackage: { packageId: 'PKG-1', contentHash: 'sha256:pkg' },
    bilingualBinding: {
      actionAttemptId: 'ATT-TRANSLATE-1',
      artifactSha256: 'a'.repeat(64),
    },
    aircraft: { aircraftNumber: 'B-1234', assessmentAsOf: '2026-08-27' },
    fleetBinding: {
      bindingRevision: 'binding-r1',
      sourceSnapshotId: 'fleet-snapshot-1',
      sourceRevisionKey: 'fleet-r1',
      authorityRevision: 'authority-r1',
      sourceAsOf: '2026-08-27',
    },
    controlledAircraft: null,
    controlledFacts: [],
    sourceExpressions: [
      {
        expressionId: 'EXP-1',
        text: 'Applicable to Boeing 737-8 airplanes.',
        sourceRefIds: ['SRC-1'],
      },
    ],
    bilingualSourceUnits: [],
    runtimePolicy: applicabilityRuntimePolicy(),
    authority: {
      candidateOnly: true,
      documentTextDoesNotProveFleetApplicability: true,
      hostDeterministicEvaluationRequired: true,
    },
  };
}

function candidateFor(task: ApplicabilityTaskContract): Record<string, any> {
  return {
    schemaVersion: 'wiselink.3_1.applicability_candidate.v1',
    operation: 'EXTRACT_APPLICABILITY',
    candidateStatus: 'CANDIDATE',
    inputRevision: task.inputRevision,
    documentVersionRef: task.documentVersionRef,
    sourcePackage: structuredClone(task.sourcePackage),
    bilingualBinding: structuredClone(task.bilingualBinding),
    aircraft: structuredClone(task.aircraft),
    fleetBinding: structuredClone(task.fleetBinding),
    expressions: [
      {
        expressionId: 'EXP-1',
        sourceRefIds: ['SRC-1'],
        applicabilityLevel: 'document_effectivity',
        contentRef: null,
        extractionStatus: 'extracted',
        expressionAst: {
          type: 'assert',
          property: 'model',
          operator: 'eq',
          value: 'B737-8',
        },
      },
    ],
    runtime: applicabilityRuntimePolicy(),
    authority: {
      candidateOnly: true,
      createsEvidenceRef: false,
      createsClosureDecision: false,
      createsActionReadiness: false,
      createsAirworthinessConclusion: false,
    },
  };
}
