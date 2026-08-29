import {
  consumeAeoRoutineRevisionReplay,
  recordAeoRoutineRevisionFeedback,
  replayAeoRoutineRevisionSlots,
  type AeoRoutineRevisionReplayCandidate,
} from '../../server/modules/aeo-authoring/aeo-editing-knowledge';

describe('AEO routine parameter revision assistance', () => {
  it('directly consumes the five-slot R26 -> R27 candidate replay', () => {
    const candidate: AeoRoutineRevisionReplayCandidate =
      consumeAeoRoutineRevisionReplay(
        categoryProjection(),
        revisionPattern(),
        revisionProvenance(),
      );
    expect(candidate).toMatchObject({
      lifecycleStatus: 'CANDIDATE_ONLY',
      documentState: 'CANDIDATE_REVISION',
      targetRevision: 'R27',
      status: 'READY_FOR_ENGINEER_REVIEW',
      unexpectedTextChanges: 0,
      continuityCheck: {
        valid: true,
        tnlPreviousEcl: '310E-BFT-00P-84',
        baselineNewLsp: '310E-BFT-00P-84',
        candidateOldLsp: '310E-BFT-00P-84',
      },
    });
    expect(candidate.slotEdits.map((edit) => edit.slot)).toEqual([
      'headerRevision',
      'step2Msp',
      'step2NewLsp',
      'step3NewLsp',
      'step4OldLsp',
    ]);
    expect(candidate.compatibilityReview.map((item) => item.field)).toEqual(
      expect.arrayContaining([
        'customer',
        'aimsHardware',
        'ops',
        'boeingDatabase',
        'qrh',
      ]),
    );
    expect(candidate.compatibilityReview.map((item) => item.field)).not.toEqual(
      expect.arrayContaining(['msp', 'lsp', 'previousEcl']),
    );
    expect(
      candidate.compatibilityReview.every(
        (item) => item.disposition === 'REVIEW_ONLY_NOT_AUTO_WRITTEN',
      ),
    ).toBe(true);
  });

  it('replays selected slots and records the existing feedback projection', () => {
    const base: AeoRoutineRevisionReplayCandidate =
      consumeAeoRoutineRevisionReplay(
        categoryProjection(),
        revisionPattern(),
        revisionProvenance(),
      );
    const partial: AeoRoutineRevisionReplayCandidate =
      replayAeoRoutineRevisionSlots(
        base,
        ['step2Msp', 'step4OldLsp'],
        'Replay only the TNL parameter fields selected by the engineer.',
      );
    expect(partial.activeReplaySlots).toEqual(['step2Msp', 'step4OldLsp']);
    expect(partial.replayRevision).toBe(2);

    const projection: Record<string, unknown> = feedbackProjection();
    const decided: AeoRoutineRevisionReplayCandidate =
      recordAeoRoutineRevisionFeedback(partial, projection, projection.example);
    expect(decided.feedbackEvents).toHaveLength(1);
    expect(decided.feedbackEvents[0]).toMatchObject({
      targetLocator: expect.objectContaining({ field: 'oldLspToDelete' }),
      before: { value: '316F-BFT-00N-G4' },
      after: { value: '310E-BFT-00P-84', state: 'CANDIDATE_ONLY' },
      reasonCode: 'SOURCE_MISMATCH',
      learningDisposition: 'SERIES_PATTERN_CANDIDATE',
    });
    expect(
      decided.slotEdits.find((edit) => edit.slot === 'step4OldLsp'),
    ).toMatchObject({
      editableValue: '310E-BFT-00P-84',
      reviewStatus: 'MODIFIED_CANDIDATE',
      engineerFeedbackId: 'fb-local-example-r27-step4-001',
    });
    expect(decided.authority).toBe(
      'ROUTINE_REVISION_ASSISTANCE_NOT_APPROVAL_NOT_RELEASE',
    );
  });

  it('blocks a TNL Previous ECL continuity break', () => {
    const provenance: Record<string, unknown> = revisionProvenance();
    const sources = provenance.sources as Array<Record<string, unknown>>;
    const baseline = sources.find(
      (source) => source.sourceId === 'SRC-AEO-B777-31-1017-R26-DOCX',
    )!;
    baseline.observedParameters = {
      ...(baseline.observedParameters as Record<string, unknown>),
      newLsp: 'UNRELATED-LSP',
    };
    const blocked: AeoRoutineRevisionReplayCandidate =
      consumeAeoRoutineRevisionReplay(
        categoryProjection(),
        revisionPattern(),
        provenance,
      );
    expect(blocked.status).toBe('BLOCKED');
    expect(blocked.continuityCheck.valid).toBe(false);
    expect(blocked.blockers).toContain('TNL Previous ECL continuity mismatch.');
  });
});

function categoryProjection(): Record<string, unknown> {
  return {
    recordType: 'aeo-editing-v0-local-consumer-projection',
    projectionVersion: 'candidate-2026-08-30',
    status: 'CANDIDATE_ONLY',
    categoryPatterns: [
      {
        category: 'ROUTINE_PARAMETER_REVISION_UPDATE',
        sampleRefs: ['AEO-B777-31-1017-R25-R27'],
        observedSectionCandidate: [
          'general control',
          'copy new ECL to MAT',
          'install new ECL',
          'delete previous ECL',
          'restore',
          'completion signature and safety checklist',
        ],
        ruleStrength:
          'ONE_HISTORICAL_TRANSITION_PLUS_ONE_CANDIDATE_REPLAY_SUPPORT_THIS_AEO_SERIES_ONLY',
      },
    ],
  };
}

function revisionPattern(): Record<string, unknown> {
  const change = (
    slot: string,
    oldValue: string,
    newValue: string,
  ): Record<string, unknown> => ({
    slot,
    old: oldValue,
    new: newValue,
    ooxmlEvidence: `exact OOXML evidence for ${slot}`,
  });
  return {
    recordType: 'aeo-editing-v0-category-knowledge-candidate',
    status: 'CANDIDATE_ONLY',
    category: 'ROUTINE_PARAMETER_REVISION_UPDATE',
    sampleRef: 'AEO-B777-31-1017-R25-R27',
    stableCandidateSkeleton: [
      { sequence: 1, phase: 'GENERAL_CONTROL' },
      { sequence: 6, phase: 'COMPLETION_AND_SAFETY' },
    ],
    transitions: [
      {
        transitionId: 'R26_TO_R27',
        evidenceState: 'NON_ISSUED_CANDIDATE_REPLAY',
        source: 'SRC-TNL-3104-BFT-00R-04',
        baseline: 'SRC-AEO-B777-31-1017-R26-DOCX',
        result: 'SRC-AEO-B777-31-1017-R27-DOCX',
        semanticChanges: [
          change('headerRevision', 'R26', 'R27'),
          change('step2Msp', '243W0011-12734', '243W0011-12974'),
          change('step2NewLsp', '310E-BFT-00P-84', '3104-BFT-00R-04'),
          change('step3NewLsp', '310E-BFT-00P-84', '3104-BFT-00R-04'),
          change('step4OldLsp', '316F-BFT-00N-G4', '310E-BFT-00P-84'),
        ],
        unexpectedTextChanges: 0,
        approvalState: 'NOT_ESTABLISHED',
      },
    ],
    semanticSlotLocators: [
      'headerRevision',
      'step2Msp',
      'step2NewLsp',
      'step3NewLsp',
      'step4OldLsp',
    ].map((slot: string) => ({
      slot,
      locatorStrategy: `semantic locator for ${slot}`,
    })),
    nonGeneralizable: [
      'The five-slot pattern is supported only for this AEO series.',
    ],
  };
}

function revisionProvenance(): Record<string, unknown> {
  const source = (
    sourceId: string,
    role: string,
    bytes: number,
    observedIdentity: string,
    observedParameters: Record<string, unknown>,
  ): Record<string, unknown> => ({
    sourceId,
    role,
    path: `artifact://historical/${sourceId}`,
    bytes,
    sha256: 'a'.repeat(64),
    observedIdentity,
    observedParameters,
  });
  return {
    recordType: 'local-aeo-routine-revision-sample-provenance',
    status: 'CANDIDATE_ONLY',
    sources: [
      source(
        'SRC-AEO-B777-31-1017-R26-DOCX',
        'NEXT_ISSUED_SECTION2_EDITABLE_SAMPLE',
        3881415,
        'AEO-B777-31-1017-R26',
        {
          msp: '243W0011-12734',
          newLsp: '310E-BFT-00P-84',
          oldLspToDelete: '316F-BFT-00N-G4',
        },
      ),
      {
        ...source(
          'SRC-AEO-B777-31-1017-R27-DOCX',
          'NON_ISSUED_SECTION2_CANDIDATE_REPLAY',
          3852815,
          'AEO-B777-31-1017-R27',
          {
            msp: '243W0011-12974',
            newLsp: '3104-BFT-00R-04',
            oldLspToDelete: '310E-BFT-00P-84',
          },
        ),
        issuedStatus: 'NOT_ESTABLISHED',
      },
      {
        ...source(
          'SRC-TNL-3104-BFT-00R-04',
          'MANUFACTURER_PARAMETER_SOURCE_FOR_R27_CANDIDATE',
          97550,
          'TNL-3104-BFT-00R-04, Revision Release June 2026',
          {},
        ),
        parameterMap: {
          msp: '243W0011-12974',
          lsp: '3104-BFT-00R-04',
          previousEcl: '310E-BFT-00P-84',
          customer: 'Air China',
          aimsHardware: 'AIMS-2 PN4089400-901',
          ops: 'HNP5A-AL03-1012',
          boeingDatabase: '311A-BFT-00H-00',
          qrh: 'D632W001-BEJ, June 15 2026, No.59',
          configurationNotes: 'None',
        },
      },
    ],
    nonClaims: ['R27 is a candidate replay only.'],
  };
}

function feedbackProjection(): Record<string, unknown> {
  return {
    recordType: 'aeo-editing-v0-engineer-feedback-projection',
    status: 'CANDIDATE_ONLY',
    requiredFields: [
      'feedbackId',
      'documentRef',
      'documentStateAtEdit',
      'categoryAtEdit',
      'targetLocator',
      'changeKind',
      'before',
      'after',
      'sourceRefs',
      'reasonCode',
      'engineerRationale',
      'learningDisposition',
      'recordedAt',
    ],
    example: {
      feedbackId: 'fb-local-example-r27-step4-001',
      documentRef: {
        aeoNo: 'AEO-B777-31-1017',
        revisionCandidate: 'R27',
        workingCopyRef: 'LOCAL_CANDIDATE_REF_REQUIRED',
      },
      documentStateAtEdit: 'CANDIDATE_REVISION',
      categoryAtEdit: 'ROUTINE_PARAMETER_REVISION_UPDATE',
      targetLocator: {
        section: 'SECTION_2',
        actionSequence: 4,
        field: 'oldLspToDelete',
      },
      changeKind: 'PARAMETER_CHANGE',
      before: { value: '316F-BFT-00N-G4' },
      after: { value: '310E-BFT-00P-84', state: 'CANDIDATE_ONLY' },
      sourceRefs: [
        {
          sourceId: 'SRC-TNL-3104-BFT-00R-04',
          locator: 'page 1, Previous ECL row',
        },
        {
          sourceId: 'SRC-AEO-B777-31-1017-R26-DOCX',
          locator: 'step 2/3 new LSP',
        },
      ],
      reasonCode: 'SOURCE_MISMATCH',
      engineerRationale:
        'Keep the candidate deletion object continuous with the exact prior LSP.',
      learningDisposition: 'SERIES_PATTERN_CANDIDATE',
      recordedAt: '2026-08-30T00:00:00+08:00',
    },
  };
}
