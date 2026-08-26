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
      'false-AND invalid boolean',
      {
        type: 'and',
        children: [
          { type: 'literal', value: false },
          {
            type: 'assert',
            property: 'optionInstalled',
            operator: 'eq',
            qualifier: 'OPT-X',
            value: 'true',
          },
        ],
      },
    ],
    [
      'true-OR invalid number',
      {
        type: 'or',
        children: [
          { type: 'literal', value: true },
          {
            type: 'assert',
            property: 'lineNumber',
            operator: 'range',
            value: { min: 100, max: '200' },
          },
        ],
      },
    ],
  ])('rejects every invalid AST child before Kleene: %s', (_label, ast) => {
    const raw = candidateFor(applicabilityTask());
    raw.expressions[0].expressionAst = ast;
    expect(() => parseApplicabilityCandidate(raw)).toThrow(
      'APPLICABILITY_AST_VALUE_TYPE_INVALID',
    );
  });

  it.each([
    [
      'boolean',
      {
        property: 'optionInstalled',
        operator: 'eq',
        qualifier: 'OPT-X',
        value: true,
      },
    ],
    ['number', { property: 'lineNumber', operator: 'gte', value: 100 }],
    [
      'number in',
      { property: 'lineNumber', operator: 'in', value: [100, 200] },
    ],
    [
      'number range',
      {
        property: 'lineNumber',
        operator: 'range',
        value: { min: 100, max: 200 },
      },
    ],
    [
      'date',
      { property: 'deliveryDate', operator: 'lte', value: '2026-08-27' },
    ],
    [
      'date in',
      {
        property: 'deliveryDate',
        operator: 'in',
        value: ['2026-08-26', '2026-08-27'],
      },
    ],
    [
      'date range',
      {
        property: 'deliveryDate',
        operator: 'range',
        value: { min: '2026-08-01', max: '2026-08-27' },
      },
    ],
  ])('accepts registry-shaped %s values', (_label, assertion) => {
    const raw = candidateFor(applicabilityTask());
    raw.expressions[0].expressionAst = { type: 'assert', ...assertion };
    expect(() => parseApplicabilityCandidate(raw)).not.toThrow();
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

  it('rejects model-controlled applicabilityLevel/contentRef fields', () => {
    const raw = candidateFor(applicabilityTask());
    raw.expressions[0].applicabilityLevel = 'inline';
    raw.expressions[0].contentRef = 'UNIT-FORGED';
    expect(() => parseApplicabilityCandidate(raw)).toThrow(
      'APPLICABILITY_CANDIDATE_EXACT_SHAPE_REQUIRED',
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
        assignmentId: 'ASSIGN-1',
        targetKind: 'module',
        targetId: 'MODULE-1',
        targetSourceRefIds: ['SRC-1'],
        applicabilityLevel: 'document_effectivity',
        contentRef: null,
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
