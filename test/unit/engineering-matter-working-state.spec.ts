import type {
  AssessmentEvidence,
  AssessmentReadingClaim,
  AssessmentReadingResult,
} from '../../shared/assessment-reading.interface';
import type {
  EngineeringMatterWorkingCoverage,
  EngineeringMatterWorkingInputBinding,
  EngineeringMatterWorkingRevisionCommand,
} from '../../shared/matter-working.interface';
import {
  engineeringMatterPendingInputs,
  materializeEngineeringMatterWorkingState,
  parseEngineeringMatterWorkingState,
} from '../../server/modules/canonical-host/engineering-matter-working-state';

const MATTER_ID = 'MAT-1';
const inputA = binding('WI-A', 4, 'DV-A', 'RESULT-A', 3);
const inputB = binding('WI-B', 7, 'DV-B', 'RESULT-B', 2);

describe('Engineering Matter working state materializer', () => {
  it('preserves fixed semantic versions and marks new organization separately from PDF changes', () => {
    const previous = { ...inputA, original: { parseRunId: 'PR-2', parseRevision: 2,
      semantic: { revision: 1, profileRef: 'boeing.ftd.sections.v1' } } };
    const current = { coverage: [coverage(previous, 'NO_MATERIAL_CHANGE', ['SR-2'], 'Read exact chapter context')] } as Parameters<typeof engineeringMatterPendingInputs>[0];
    expect(engineeringMatterPendingInputs(current, [previous])).toEqual([]);
    const latest = { ...previous, original: { ...previous.original, semantic: { ...previous.original.semantic, revision: 2 } } };
    expect(engineeringMatterPendingInputs(current, [latest])[0].reasons).toEqual(['DOCUMENT_SEMANTIC_CHANGED']);
    expect(current!.coverage[0].binding.original?.semantic?.revision).toBe(1);
    expect(() => engineeringMatterPendingInputs(current, [{ ...latest, original: { ...latest.original,
      semantic: { revision: 0, profileRef: 'invalid' } } }])).toThrow('SEMANTIC_BINDING_INVALID');
  });

  it('marks original revisions pending without changing the saved coverage binding', () => {
    const previous = { ...inputA, original: { parseRunId: 'PR-2', parseRevision: 2 } };
    const current = { coverage: [coverage(previous, 'NO_MATERIAL_CHANGE', ['SR-2'], 'Read original revision 2')] } as Parameters<typeof engineeringMatterPendingInputs>[0];
    expect(engineeringMatterPendingInputs(current, [previous])).toEqual([]);
    const latest = { ...previous, original: { parseRunId: 'PR-3', parseRevision: 3 } };
    expect(engineeringMatterPendingInputs(current, [latest])[0].reasons).toEqual(['DOCUMENT_ORIGINAL_CHANGED']);
    expect(current!.coverage[0].binding.original).toEqual(previous.original);
    expect(() => engineeringMatterPendingInputs(current, [{ ...latest, original: { parseRunId: 'PR-3', parseRevision: 0 } }])).toThrow('ORIGINAL_BINDING_INVALID');
  });
  const methodEvidence: AssessmentEvidence = {
    evidenceRef: 'METHOD-1', kind: 'METHOD_CLAUSE', title: 'Risk assessment method',
    versionLabel: null, excerpt: 'Separate the scenario from the likelihood rating.',
    packRef: 'PACK-1', methodRef: 'risk-rating', sourceIdentity: 'controlled-method',
    locator: 'section 3', sourceVersionStatus: 'VERSION_UNCONFIRMED',
  };

  it.each(['CONFIRMED', 'VERSION_UNCONFIRMED'] as const)(
    'saves and reads back method premises with their original %s version status',
    sourceVersionStatus => {
      const source = { ...methodEvidence, sourceVersionStatus };
      const result = readingResult(1, [claim('METHOD-CLAIM', 'Apply the method with its stated limits.', source.evidenceRef)], [source]);
      const saved = materializeEngineeringMatterWorkingState({
        matterId: MATTER_ID, current: null, command: initialCommand(result, []),
      }).state;
      const readback = parseEngineeringMatterWorkingState(JSON.stringify(saved), MATTER_ID);
      expect(readback.substantiveResult?.evidence).toEqual([source]);
      expect(readback.substantiveResult?.candidateOnly).toBe(true);
    },
  );

  it.each([
    ['packRef', '', 'METHOD_PACK_REQUIRED'],
    ['methodRef', '', 'METHOD_REF_REQUIRED'],
    ['sourceIdentity', '', 'SOURCE_IDENTITY_REQUIRED'],
    ['locator', '', 'LOCATOR_REQUIRED'],
    ['sourceVersionStatus', 'UNKNOWN', 'METHOD_VERSION_INVALID'],
    ['kind', 'UNRECOGNIZED', 'KIND_INVALID'],
  ])('rejects invalid method evidence %s before publishing work', (field, value, code) => {
    const result = readingResult(1, [claim('METHOD-CLAIM', 'Method premise.', methodEvidence.evidenceRef)], [methodEvidence]);
    const command = JSON.parse(JSON.stringify(initialCommand(result, [])));
    command.nextSubstantiveResult.evidence[0][field] = value;
    expect(() => materializeEngineeringMatterWorkingState({
      matterId: MATTER_ID, current: null, command,
    })).toThrow(`ENGINEERING_MATTER_WORKING_EVIDENCE_${code}`);
  });

  it('creates a Matter-scoped AssessmentReadingResult from stable claim ids', () => {
    const claimA = claim('CLAIM-A', 'The modification applies.', 'E-A');
    const result = readingResult(
      1,
      [claimA],
      [evidence('E-A', 'WI-A', 'DV-A')],
    );
    const materialized = materializeEngineeringMatterWorkingState({
      matterId: MATTER_ID,
      current: null,
      command: initialCommand(result, [inputA]),
    });

    expect(materialized.resultChanged).toBe(true);
    expect(materialized.coverageChanged).toBe(true);
    expect(materialized.state.substantiveResult).toEqual(result);
    expect(materialized.state.substantiveInputs).toEqual([inputA]);
    expect(materialized.change.addedClaimIds).toEqual(['CLAIM-A']);
  });

  it('applies a correction locally and carries explicitly unchanged claims and evidence byte-for-byte', () => {
    const claimA = claim('CLAIM-A', 'Original applicability.', 'E-A');
    const claimB = claim('CLAIM-B', 'Deadline remains 30 June.', 'E-B');
    const firstResult = readingResult(
      1,
      [claimA, claimB],
      [evidence('E-A', 'WI-A', 'DV-A'), evidence('E-B', 'WI-B', 'DV-B')],
    );
    const first = materializeEngineeringMatterWorkingState({
      matterId: MATTER_ID,
      current: null,
      command: initialCommand(firstResult, [inputA, inputB]),
    }).state;
    const replacement = claim(
      'CLAIM-A',
      'Applicability is conditional on the installed unit.',
      'E-A2',
    );
    const nextResult = readingResult(
      2,
      [replacement, claimB],
      [evidence('E-A2', 'WI-A', 'DV-A'), evidence('E-B', 'WI-B', 'DV-B')],
    );
    const command: EngineeringMatterWorkingRevisionCommand = {
      ...commandBase(1, 'CORRECTION', 'Correct applicability.'),
      nextFocus: null,
      claimDelta: {
        changedBecause: 'Engineer corrected the installed-unit premise.',
        additions: [],
        replacements: [replacement],
        retirements: [],
        explicitlyUnchangedClaimIds: ['CLAIM-B'],
      },
      openQuestionDelta: null,
      reviewConditionDelta: null,
      nextSubstantiveResult: nextResult,
      substantiveInputs: [inputA, inputB],
      coverageUpdates: [
        coverage(inputA, 'SUBSTANTIVE', ['SRC-E-A2'], 'installed-unit passage'),
        coverage(inputB, 'SUBSTANTIVE', ['SRC-E-B'], 'deadline passage'),
      ],
    };

    const corrected = materializeEngineeringMatterWorkingState({
      matterId: MATTER_ID,
      current: first,
      command,
    });

    expect(corrected.state.substantiveResult?.content.claims).toEqual([
      replacement,
      claimB,
    ]);
    expect(corrected.change.replacedClaimIds).toEqual(['CLAIM-A']);
    expect(corrected.change.explicitlyUnchangedClaimIds).toEqual(['CLAIM-B']);
  });

  it('records bounded no-material-change coverage without manufacturing a new result', () => {
    const firstResult = readingResult(
      1,
      [claim('CLAIM-A', 'Existing finding.', 'E-A')],
      [evidence('E-A', 'WI-A', 'DV-A')],
    );
    const first = materializeEngineeringMatterWorkingState({
      matterId: MATTER_ID,
      current: null,
      command: initialCommand(firstResult, [inputA]),
    }).state;
    const command: EngineeringMatterWorkingRevisionCommand = {
      ...commandBase(1, 'MATERIAL_INCORPORATION', 'Reviewed related material.'),
      nextFocus: null,
      claimDelta: null,
      openQuestionDelta: null,
      reviewConditionDelta: null,
      nextSubstantiveResult: null,
      substantiveInputs: [],
      coverageUpdates: [
        coverage(
          inputB,
          'NO_MATERIAL_CHANGE',
          ['SRC-B-12', 'SRC-B-13'],
          'specified SB applicability section',
        ),
      ],
    };

    const next = materializeEngineeringMatterWorkingState({
      matterId: MATTER_ID,
      current: first,
      command,
    });

    expect(next.resultChanged).toBe(false);
    expect(next.coverageChanged).toBe(true);
    expect(next.state.substantiveResult).toBe(first.substantiveResult);
    expect(next.state.coverage).toHaveLength(2);
    expect(next.state.coverage[1]).toMatchObject({
      contribution: 'NO_MATERIAL_CHANGE',
      checkedScope: 'specified SB applicability section',
    });
  });

  it('allows a result supported only by a Host fact without inventing a document input', () => {
    const hostEvidence: AssessmentEvidence = {
      evidenceRef: 'E-HOST-1',
      title: 'Host current fact',
      versionLabel: null,
      excerpt: 'Current controlled value.',
      kind: 'HOST_FACT',
      workItemId: 'WI-A',
      workItemRevision: 4,
      factRef: 'FACT-1',
      recordedAt: '2026-09-08T00:00:00.000Z',
    };
    const result = readingResult(
      1,
      [claim('CLAIM-HOST', 'Controlled value is current.', 'E-HOST-1')],
      [hostEvidence],
    );
    const command = initialCommand(result, []);
    command.coverageUpdates = [];

    const materialized = materializeEngineeringMatterWorkingState({
      matterId: MATTER_ID,
      current: null,
      command,
    });

    expect(materialized.state.substantiveInputs).toEqual([]);
    expect(materialized.state.substantiveResult).toEqual(result);
  });

  it('rejects document evidence outside the bounded checked source set', () => {
    const result = readingResult(
      1,
      [claim('CLAIM-A', 'Finding.', 'E-A')],
      [evidence('E-A', 'WI-A', 'DV-A')],
    );
    const command = initialCommand(result, [inputA]);
    command.coverageUpdates = [
      coverage(inputA, 'SUBSTANTIVE', ['SRC-OTHER'], 'different passage'),
    ];

    expect(() =>
      materializeEngineeringMatterWorkingState({
        matterId: MATTER_ID,
        current: null,
        command,
      }),
    ).toThrow('ENGINEERING_MATTER_WORKING_DOCUMENT_EVIDENCE_NOT_CHECKED');
  });

  it.each(['REVIEW_CONVERSATION', 'ENGINEER_REVIEW_LEDGER'] as const)(
    'preserves the exact %s engineer statement identity',
    (origin) => {
      const common = {
        evidenceRef: 'E-ENGINEER',
        kind: 'ENGINEER_STATEMENT' as const,
        title: 'Engineer statement',
        versionLabel: null,
        excerpt: 'Recorded engineering condition.',
        recordedAt: '2026-09-08T00:00:00.000Z',
      };
      const item: AssessmentEvidence =
        origin === 'REVIEW_CONVERSATION'
          ? {
              ...common,
              origin,
              reviewConversationId: 'RC-1',
              reviewTurnId: 'RT-1',
              engineerSuppliedInputId: 'EI-1',
            }
          : {
              ...common,
              origin,
              workItemId: 'WI-A',
              reviewRevision: 2,
              sequence: 1,
              sourceRefId: 'SRC-1',
              locator: 'review entry 1',
            };
      const result = readingResult(
        1,
        [claim('C-1', 'Condition.', item.evidenceRef)],
        [item],
      );
      const command = initialCommand(result, []);
      expect(
        materializeEngineeringMatterWorkingState({
          matterId: MATTER_ID,
          current: null,
          command,
        }).state.substantiveResult,
      ).toEqual(result);

      const requiredFields =
        origin === 'REVIEW_CONVERSATION'
          ? ['reviewConversationId', 'reviewTurnId', 'engineerSuppliedInputId']
          : [
              'workItemId',
              'reviewRevision',
              'sequence',
              'sourceRefId',
              'locator',
            ];
      for (const field of [...requiredFields, 'origin', 'recordedAt']) {
        const invalid = { ...item, [field]: undefined };
        expect(() =>
          materializeEngineeringMatterWorkingState({
            matterId: MATTER_ID,
            current: null,
            command: {
              ...command,
              nextSubstantiveResult: {
                ...result,
                evidence: [invalid as AssessmentEvidence],
              },
            },
          }),
        ).toThrow();
      }
    },
  );

  it('rejects a late/non-local candidate that silently changes an unchanged claim', () => {
    const claimA = claim('CLAIM-A', 'Finding A.', 'E-A');
    const claimB = claim('CLAIM-B', 'Finding B.', 'E-B');
    const first = materializeEngineeringMatterWorkingState({
      matterId: MATTER_ID,
      current: null,
      command: initialCommand(
        readingResult(
          1,
          [claimA, claimB],
          [evidence('E-A', 'WI-A', 'DV-A'), evidence('E-B', 'WI-B', 'DV-B')],
        ),
        [inputA, inputB],
      ),
    }).state;
    const silentlyChangedB = claim('CLAIM-B', 'Silently changed B.', 'E-B');
    const command: EngineeringMatterWorkingRevisionCommand = {
      ...commandBase(1, 'CORRECTION', 'Change only A.'),
      nextFocus: null,
      claimDelta: {
        changedBecause: 'A changed.',
        additions: [],
        replacements: [claim('CLAIM-A', 'Changed A.', 'E-A')],
        retirements: [],
        explicitlyUnchangedClaimIds: ['CLAIM-B'],
      },
      openQuestionDelta: null,
      reviewConditionDelta: null,
      nextSubstantiveResult: readingResult(
        2,
        [claim('CLAIM-A', 'Changed A.', 'E-A'), silentlyChangedB],
        [evidence('E-A', 'WI-A', 'DV-A'), evidence('E-B', 'WI-B', 'DV-B')],
      ),
      substantiveInputs: [inputA, inputB],
      coverageUpdates: [],
    };

    expect(() =>
      materializeEngineeringMatterWorkingState({
        matterId: MATTER_ID,
        current: first,
        command,
      }),
    ).toThrow('ENGINEERING_MATTER_WORKING_LOCAL_PATCH_MISMATCH');
  });

  it('computes precise pending reasons from current member identities', () => {
    const firstResult = readingResult(
      1,
      [claim('CLAIM-A', 'Finding.', 'E-A')],
      [evidence('E-A', 'WI-A', 'DV-A')],
    );
    const current = materializeEngineeringMatterWorkingState({
      matterId: MATTER_ID,
      current: null,
      command: initialCommand(firstResult, [inputA]),
    }).state;
    const changedA = binding('WI-A', 5, 'DV-A2', 'RESULT-A2', 1);

    expect(engineeringMatterPendingInputs(current, [changedA, inputB])).toEqual(
      [
        {
          inputId: 'WI-A',
          current: changedA,
          covered: inputA,
          reasons: [
            'WORK_ITEM_REVISION_CHANGED',
            'DOCUMENT_VERSION_CHANGED',
            'RESULT_CHANGED',
          ],
        },
        {
          inputId: 'WI-B',
          current: inputB,
          covered: null,
          reasons: ['NOT_COVERED'],
        },
      ],
    );
  });

  it('keeps a read-only input pending until a later substantive disposition', () => {
    const firstResult = readingResult(
      1,
      [claim('CLAIM-A', 'Finding.', 'E-A')],
      [evidence('E-A', 'WI-A', 'DV-A')],
    );
    const first = materializeEngineeringMatterWorkingState({
      matterId: MATTER_ID,
      current: null,
      command: initialCommand(firstResult, [inputA]),
    }).state;
    const next = materializeEngineeringMatterWorkingState({
      matterId: MATTER_ID,
      current: first,
      command: {
        ...commandBase(1, 'MATERIAL_INCORPORATION', 'Read bounded range.'),
        nextFocus: null,
        claimDelta: null,
        openQuestionDelta: null,
        reviewConditionDelta: null,
        nextSubstantiveResult: null,
        substantiveInputs: [],
        coverageUpdates: [coverage(inputB, 'READ_ONLY', ['SRC-B-12'], 'one page')],
      },
    }).state;
    expect(engineeringMatterPendingInputs(next, [inputB])).toEqual([{
      inputId: inputB.inputId,
      current: inputB,
      covered: inputB,
      reasons: ['READ_NOT_PROCESSED'],
    }]);
  });
});

function initialCommand(
  result: AssessmentReadingResult,
  inputs: EngineeringMatterWorkingInputBinding[],
): EngineeringMatterWorkingRevisionCommand {
  return {
    ...commandBase(0, 'INITIAL_SYNTHESIS', 'Initial synthesis.'),
    nextFocus: { question: 'What is required?', targetRefs: ['aircraft'] },
    claimDelta: {
      changedBecause: 'Initial synthesis from authorized inputs.',
      additions: result.content.claims,
      replacements: [],
      retirements: [],
      explicitlyUnchangedClaimIds: [],
    },
    openQuestionDelta: {
      upserts: [],
      retirements: [],
      explicitlyUnchangedItemIds: [],
    },
    reviewConditionDelta: {
      upserts: [],
      retirements: [],
      explicitlyUnchangedItemIds: [],
    },
    nextSubstantiveResult: result,
    substantiveInputs: inputs,
    coverageUpdates: inputs.map((input) => {
      const sourceRefIds = result.evidence.flatMap((item) =>
        item.kind === 'DOCUMENT_PASSAGE' &&
        item.workItemId === input.workItemId &&
        item.documentVersionId === input.documentVersionId
          ? [item.sourceRefId]
          : [],
      );
      return coverage(input, 'SUBSTANTIVE', sourceRefIds, 'initial source set');
    }),
  };
}

function commandBase(
  expectedWorkingRevision: number,
  updateKind: EngineeringMatterWorkingRevisionCommand['updateKind'],
  changeSummary: string,
) {
  return {
    requestId: `REQ-${expectedWorkingRevision}-${updateKind}`,
    expectedWorkingRevision,
    basedOnMatterRevisionId: 'MREV-2',
    updateKind,
    changeSummary,
  };
}

function binding(
  workItemId: string,
  workItemRevision: number,
  documentVersionId: string,
  resultRef: string | null,
  resultRevision: number | null,
): EngineeringMatterWorkingInputBinding {
  return {
    inputId: workItemId,
    workItemId,
    workItemRevision,
    documentVersionId,
    resultRef,
    resultRevision,
  };
}

function coverage(
  input: EngineeringMatterWorkingInputBinding,
  contribution: EngineeringMatterWorkingCoverage['contribution'],
  checkedSourceRefIds: string[],
  checkedScope: string,
): EngineeringMatterWorkingCoverage {
  return {
    binding: input,
    contribution,
    checkedSourceRefIds,
    checkedScope,
    reason:
      contribution === 'SUBSTANTIVE'
        ? 'Contributed to the saved result.'
        : 'Read within the checked scope; no claim changed.',
  };
}

function readingResult(
  resultRevision: number,
  claims: AssessmentReadingClaim[],
  evidenceItems: AssessmentEvidence[],
): AssessmentReadingResult {
  return {
    resultRef: 'MATTER-RESULT-1',
    resultRevision,
    scope: { kind: 'ENGINEERING_MATTER', matterId: MATTER_ID },
    content: {
      schemaVersion: 'wiselink.3_1.assessment_reading.v1',
      headline: 'Engineering reading',
      listBrief: 'One-line brief',
      lead: 'Evidence-bound result.',
      claims,
      decisiveClaimIds: claims.map((item) => item.claimId),
    },
    evidence: evidenceItems,
    candidateOnly: true,
  };
}

function claim(
  claimId: string,
  text: string,
  evidenceRef: string,
): AssessmentReadingClaim {
  return {
    claimId,
    text,
    basis: 'CONDITIONAL_INFERENCE',
    premises: [
      {
        evidenceRef,
        role: 'SUPPORTS',
        explanation: 'The cited passage supports the claim.',
        limitation: null,
      },
    ],
  };
}

function evidence(
  evidenceRef: string,
  workItemId: string,
  documentVersionId: string,
): AssessmentEvidence {
  return {
    evidenceRef,
    title: evidenceRef,
    versionLabel: '1',
    excerpt: 'Bound source passage.',
    kind: 'DOCUMENT_PASSAGE',
    workItemId,
    documentVersionId,
    sourceRefId: `SRC-${evidenceRef}`,
    locator: 'page 1',
  };
}
