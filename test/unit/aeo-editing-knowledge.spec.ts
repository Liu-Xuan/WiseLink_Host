import {
  buildAeoDraftLearningInput,
  createAeoDraftAssistanceCandidate,
  diffAeoEditingKnowledgeVersions,
  ingestAeoEditingKnowledgeCandidate,
  recordAeoDraftFeedback,
  regenerateAeoDraftSelection,
  replayAeoDraftFeedback,
  validateAeoEditingInput,
  validateAeoEditingKnowledgeCandidate,
  type AeoDraftAssistanceCandidate,
  type AeoDraftAssistanceRequest,
  type AeoDraftFeedbackInput,
  type AeoEditingKnowledgeCandidate,
} from '../../server/modules/aeo-authoring/aeo-editing-knowledge';

describe('AEO editing knowledge and draft assistance', () => {
  it('runs knowledge -> editable draft -> accept/modify/reject -> replay', () => {
    const knowledge: AeoEditingKnowledgeCandidate =
      ingestAeoEditingKnowledgeCandidate(softwareSample());
    expect(validateAeoEditingKnowledgeCandidate(knowledge)).toEqual({
      valid: true,
      findings: [],
    });
    expect(knowledge.lifecycleStatus).toBe('CANDIDATE_ONLY');
    expect(knowledge.documentState).toBe(
      'CONTROLLED_OR_ISSUED_SAMPLE_APPROVAL_NOT_INDEPENDENTLY_VERIFIED',
    );
    expect(knowledge.structureSkeleton).toMatchObject({
      sectionKeys: ['PREPARE', 'INSTALL', 'CLOSEOUT'],
      performerRolePlaceholders: ['T1', 'T2'],
      signatureGranularities: ['ROW'],
      safetyNoteUnitIds: ['ACTION-001'],
      parameterizedUnitIds: ['ACTION-002'],
    });
    const request: AeoDraftAssistanceRequest = draftRequest(knowledge);
    const base: AeoDraftAssistanceCandidate =
      createAeoDraftAssistanceCandidate(request);
    expect(base.suggestions).toHaveLength(3);
    expect(base.editorBlocks).toHaveLength(3);
    base.editorBlocks.forEach((block) => {
      expect(block.sourceBindings.length).toBeGreaterThan(0);
      expect(block.unresolved[0]?.blocksCheckpoint).toBe(true);
    });
    expect(base.suggestions.map((suggestion) => suggestion.kind)).toEqual([
      'APPLICABLE_TEMPLATE_CANDIDATE',
      'COMPANY_STEP_CANDIDATE',
      'COMPANY_STEP_CANDIDATE',
    ]);

    const feedback: AeoDraftFeedbackInput[] = feedbackFor(base);
    const decided: AeoDraftAssistanceCandidate = feedback.reduce(
      (draft: AeoDraftAssistanceCandidate, input: AeoDraftFeedbackInput) =>
        recordAeoDraftFeedback(draft, input),
      base,
    );
    const learning = buildAeoDraftLearningInput(decided);
    expect(learning.accepted).toHaveLength(1);
    expect(learning.modified).toHaveLength(1);
    expect(learning.rejected).toHaveLength(0);
    expect(learning.companyStepFeedback).toHaveLength(1);
    expect(learning.excludedFromLearning).toEqual([
      expect.objectContaining({
        feedbackId: 'FDBK-3',
        learningDisposition: 'DO_NOT_LEARN',
      }),
    ]);
    expect(learning.modified[0]).toMatchObject({
      targetGenerationRevision: 1,
      semanticTarget: {
        sourceUnitId: 'ACTION-002',
        field: 'BODY',
      },
      before: { bodyZh: '装载软件件号。' },
      after: { bodyZh: '按当前受控源装载软件件号。' },
      reasonCode: 'SOURCE_MISMATCH',
    });
    expect(decided.editorBlocks).toHaveLength(2);
    expect(decided.suggestions[1]?.bodyZh).toBe('按当前受控源装载软件件号。');
    expect(replayAeoDraftFeedback(base, feedback).suggestions).toEqual(
      decided.suggestions,
    );
  });

  it('round-trips, diffs same-matter versions, and regenerates one selection', () => {
    const original: AeoEditingKnowledgeCandidate =
      ingestAeoEditingKnowledgeCandidate(softwareSample());
    const roundTrip: AeoEditingKnowledgeCandidate = JSON.parse(
      JSON.stringify(original),
    ) as AeoEditingKnowledgeCandidate;
    expect(validateAeoEditingKnowledgeCandidate(roundTrip).valid).toBe(true);

    const revisedInput: Record<string, unknown> = softwareSample();
    const identity = revisedInput.documentIdentity as Record<string, unknown>;
    identity.revision = 'R01';
    identity.expectedHeader = 'AEO-B787-45-0002-R01';
    identity.observedHeader = 'AEO-B787-45-0002-R01';
    identity.primarySourceId = 'SRC-AEO-R01-DOCX';
    const sources = revisedInput.sources as Array<Record<string, unknown>>;
    sources[0] = {
      ...sources[0],
      sourceId: 'SRC-AEO-R01-DOCX',
      location: 'artifact://historical/AEO-B787-45-0002-R01.docx',
      actualBytes: 1694000,
      sha256:
        '6165a9d7695603d93e60f87fc63eafcdde99197272695398af568518277e815c',
      observedIdentity: 'AEO-B787-45-0002-R01',
    };
    identity.actualBytes = 1694000;
    const actions = revisedInput.actions as Array<Record<string, unknown>>;
    actions.forEach((action) => {
      const disposition = action.sourceDisposition as Record<string, unknown>;
      disposition.sourceRefs = [
        {
          sourceId: 'SRC-AEO-R01-DOCX',
          locator: `main-row-${Number(action.sequence) + 1}`,
        },
      ];
    });
    actions[1] = {
      ...actions[1],
      text: {
        zh: '按 R01 当前受控源装载软件件号。',
        en: 'Load the software part number from the current R01 controlled source.',
      },
    };
    const revised: AeoEditingKnowledgeCandidate =
      ingestAeoEditingKnowledgeCandidate(revisedInput);
    const diff = diffAeoEditingKnowledgeVersions(original, revised);
    expect(diff.sameMatter).toBe(true);
    expect(
      diff.changes.find((change) => change.unitId === 'ACTION-002'),
    ).toMatchObject({
      change: 'CHANGED',
    });

    const base: AeoDraftAssistanceCandidate = createAeoDraftAssistanceCandidate(
      draftRequest(original),
    );
    expect(() =>
      regenerateAeoDraftSelection(
        base,
        {
          ...draftRequest(revised),
          selectedUnitIds: ['ACTION-002'],
          expectedGenerationRevision: 1,
        },
        'A different issued revision cannot partially replace this draft.',
      ),
    ).toThrow('AEO_DRAFT_REGENERATION_MATTER_IDENTITY_MISMATCH');
    const sameRevisionUpdate: AeoEditingKnowledgeCandidate = {
      ...original,
      actionUnits: original.actionUnits.map((unit) =>
        unit.unitId === 'ACTION-002'
          ? { ...unit, bodyZh: '按 R00 当前受控源装载软件件号。' }
          : unit,
      ),
    };
    const regenerated = regenerateAeoDraftSelection(
      base,
      {
        ...draftRequest(sameRevisionUpdate),
        selectedUnitIds: ['ACTION-002'],
        expectedGenerationRevision: 1,
      },
      'R00 candidate wording was corrected against the same source identity.',
    );
    expect(regenerated.generationRevision).toBe(2);
    expect(regenerated.regenerationHistory[0]).toMatchObject({
      regeneratedUnitIds: ['ACTION-002'],
    });
    expect(regenerated.sources.map((source) => source.sourceId)).toEqual([
      'SRC-AEO-R00-DOCX',
    ]);
    expect(
      regenerated.suggestions.find(
        (suggestion) => suggestion.sourceUnitId === 'ACTION-002',
      )?.bodyZh,
    ).toContain('R00');
  });

  it('normalizes inspectionDetail and preserves explicit missing evidence', () => {
    const knowledge: AeoEditingKnowledgeCandidate =
      ingestAeoEditingKnowledgeCandidate(
        inspectionSample(),
        inspectionProvenance(),
      );
    expect(knowledge.documentIdentity.category).toBe(
      'VISUAL_INSPECTION_WITH_CONDITIONAL_CORRECTION',
    );
    expect(knowledge.actionUnits[0]?.inspectionDetail).toMatchObject({
      method: { type: 'VISUAL' },
      explicitAbsences: ['repeat interval', 'NDT method'],
    });
    expect(knowledge.missingInputs).toEqual(
      expect.arrayContaining([
        expect.stringContaining('repeat interval'),
        expect.stringContaining('NDT method'),
      ]),
    );
  });

  it('rejects wrong actual-byte identity and undeclared SourceRefs', () => {
    const invalid: Record<string, unknown> = softwareSample();
    const identity = invalid.documentIdentity as Record<string, unknown>;
    identity.actualBytes = 1;
    const actions = invalid.actions as Array<Record<string, unknown>>;
    const disposition = actions[0]?.sourceDisposition as Record<
      string,
      unknown
    >;
    disposition.sourceRefs = [{ sourceId: 'UNKNOWN', locator: 'p1' }];
    const codes: string[] = validateAeoEditingInput(invalid).findings.map(
      (finding) => finding.code,
    );
    expect(codes).toEqual(
      expect.arrayContaining(['DOCUMENT_BYTES_MISMATCH', 'UNKNOWN_SOURCE_REF']),
    );
    expect(() => ingestAeoEditingKnowledgeCandidate(invalid)).toThrow(
      'AEO_EDITING_INPUT_INVALID',
    );
  });
});

function draftRequest(
  knowledge: AeoEditingKnowledgeCandidate,
): AeoDraftAssistanceRequest {
  return {
    draftKey: 'WI-AEO-45-0002',
    title: 'AEO editable draft candidate',
    knowledge,
    selectedUnitIds: knowledge.actionUnits.map((unit) => unit.unitId),
    currentSourceRefs: [
      {
        sourceId: knowledge.documentIdentity.primarySourceId,
        locator: knowledge.documentIdentity.identityLocator,
      },
    ],
  };
}

function feedbackFor(
  draft: AeoDraftAssistanceCandidate,
): AeoDraftFeedbackInput[] {
  return [
    {
      feedbackId: 'FDBK-1',
      suggestionId: draft.suggestions[0]!.suggestionId,
      expectedGenerationRevision: draft.generationRevision,
      decision: 'ACCEPT',
      engineerDecisionRef: 'ENG-DEC-1',
      note: 'Accepted for the current editable candidate.',
      semanticField: 'SUGGESTION',
      reasonCode: 'EXECUTABILITY',
      learningDisposition: 'CATEGORY_PATTERN_CANDIDATE',
    },
    {
      feedbackId: 'FDBK-2',
      suggestionId: draft.suggestions[1]!.suggestionId,
      expectedGenerationRevision: draft.generationRevision,
      decision: 'MODIFY',
      engineerDecisionRef: 'ENG-DEC-2',
      note: 'Use the current controlled-source wording.',
      revisedBodyZh: '按当前受控源装载软件件号。',
      revisedBodyEn:
        'Load the software part number from the current controlled source.',
      revisionSourceRefs: draft.suggestions[1]!.sourceRefs,
      semanticField: 'BODY',
      reasonCode: 'SOURCE_MISMATCH',
      learningDisposition: 'SERIES_PATTERN_CANDIDATE',
    },
    {
      feedbackId: 'FDBK-3',
      suggestionId: draft.suggestions[2]!.suggestionId,
      expectedGenerationRevision: draft.generationRevision,
      decision: 'REJECT',
      engineerDecisionRef: 'ENG-DEC-3',
      note: 'The closeout is not applicable to this candidate.',
      semanticField: 'SUGGESTION',
      reasonCode: 'APPLICABILITY',
      learningDisposition: 'DO_NOT_LEARN',
    },
  ];
}

function softwareSample(): Record<string, unknown> {
  const sourceRef = (locator: string): Record<string, unknown> => ({
    sourceId: 'SRC-AEO-R00-DOCX',
    locator,
  });
  const action = (
    unitId: string,
    sequence: number,
    phase: string,
    decision: string,
    zh: string,
    en: string,
    parameters: unknown[] = [],
  ): Record<string, unknown> => ({
    unitId,
    sequence,
    phase,
    operation: phase,
    object: '45 LDI DB',
    text: { zh, en },
    parameters,
    conditions: [],
    branches: [],
    sourceDisposition: {
      decision,
      rationale:
        'Observed sample treatment; present-day adoption is not implied.',
      sourceRefs: [sourceRef(`main-row-${sequence + 1}`)],
      reviewStatus: 'CANDIDATE',
    },
    dependencies: [],
    execution: {
      performerRoles: [sequence === 2 ? 'T2' : 'T1'],
      inspectorRoles: ['XXX'],
      signatureGranularity: 'ROW',
      reviewStatus: 'CANDIDATE',
    },
    verifications: [],
    closeout: [],
    reviewStatus: 'CANDIDATE',
  });
  return {
    schemaVersion: '0.1.0',
    recordType: 'local-aeo-editing-knowledge',
    lifecycleStatus: 'CANDIDATE_ONLY',
    documentIdentity: {
      aeoNumber: 'AEO-B787-45-0002',
      revision: 'R00',
      title: 'CMCF 45 LDI DB software installation',
      category: 'SOFTWARE_INSTALLATION_UPDATE',
      actualBytes: 1693595,
      primarySourceId: 'SRC-AEO-R00-DOCX',
      expectedHeader: 'AEO-B787-45-0002-R00',
      observedHeader: 'AEO-B787-45-0002-R00',
      identityLocator: 'active header table, word/header1.xml',
    },
    targetIdentity: {
      applicabilityStatus: 'UNESTABLISHED',
      manufacturerScope: { status: 'SOURCE_CANDIDATE' },
      companyExecutionScope: { status: 'UNESTABLISHED', sourceRefs: [] },
      scopeRelationship: 'UNESTABLISHED',
    },
    sources: [
      {
        sourceId: 'SRC-AEO-R00-DOCX',
        role: 'AEO_ISSUED_OR_CONTROLLED_SAMPLE',
        location: 'artifact://historical/AEO-B787-45-0002-R00.docx',
        actualBytes: 1693595,
        sha256:
          '3a8abe5af15e96e49c384fae9d88000a3594fd95dfef47e8895bf923ab598588',
        observedIdentity: 'AEO-B787-45-0002-R00',
        identityLocator: 'active header table, word/header1.xml',
      },
    ],
    actions: [
      action(
        'ACTION-001',
        1,
        'PREPARE',
        'ADAPT',
        '注意：供电并确认稳定电源。',
        'CAUTION: Supply and confirm stable electrical power.',
      ),
      action(
        'ACTION-002',
        2,
        'INSTALL',
        'COMPANY_ADDED',
        '装载软件件号。',
        'Load the software part number.',
        [{ name: 'softwarePartNumber', value: 'BCG48-45LD-0070' }],
      ),
      action(
        'ACTION-003',
        3,
        'CLOSEOUT',
        'COMPANY_ADDED',
        '恢复初始状态并完成签署占位。',
        'Restore the initial condition and retain the signoff placeholder.',
      ),
    ],
    reviews: [],
    nonClaims: [
      'No current applicability is established.',
      'No approval or release is created.',
      'No completion is recorded.',
    ],
  };
}

function inspectionSample(): Record<string, unknown> {
  return {
    recordType: 'local-aeo-inspection-editing-knowledge',
    status: 'CANDIDATE_ONLY',
    sampleRef: 'SRC-AEO-310034-R00-DOCX',
    inspectionDefinition: {
      area: { relativeLocation: 'behind the E1-1 shelf' },
      method: { type: 'VISUAL' },
      referenceCondition: {
        required: 'Fiber-optic line excluded from final tie.',
      },
      thresholdsAndLimits: [],
      findingClassification: { scheme: 'BINARY_ONLY' },
      repeatInterval: { status: 'NOT_PRESENT' },
      ndt: { method: 'NOT_PRESENT' },
      recording: { inStepRecord: ['Yes/No'] },
    },
    actionUnits: [
      {
        unitId: 'AEO-310034-2',
        phase: 'INSPECTION',
        operation: 'VISUALLY_INSPECT',
        object: 'W2008 and W2008-0004FO-16',
        zh: '目视检查 W2008 光纤线束位置。',
        en: 'Visually inspect the W2008 fiber-optic routing.',
        sourceDisposition: 'ADOPT_TRANSLATE_AND_ADD_EXECUTION_BRANCH',
        sourceRefs: ['SRC-AEO-310034-R00-DOCX#main-row-2'],
        role: 'T2',
        inspectionRole: 'XXX',
      },
    ],
    inspectionSpecificFieldEvidence: [
      { field: 'repeat interval', status: 'NOT_PRESENT' },
      { field: 'NDT method', status: 'NOT_PRESENT' },
    ],
    requiredEngineerDecisions: [],
    manufacturerToCompanyTransformations: [],
  };
}

function inspectionProvenance(): Record<string, unknown> {
  return {
    recordType: 'local-aeo-inspection-sample-provenance',
    status: 'CANDIDATE_ONLY',
    sample: {
      aeoNo: 'AEO-B737-31-0034',
      revision: 'R00',
      category: 'VISUAL_INSPECTION_WITH_CONDITIONAL_CORRECTION',
      topic: 'Inspect W2008-0004FO-16 routing and conditionally retie.',
    },
    sources: [
      {
        sourceId: 'SRC-AEO-310034-R00-DOCX',
        role: 'AEO_SECTION2_EDITABLE_SAMPLE',
        path: 'artifact://historical/AEO-B737-31-0034-R00.docx',
        bytes: 7818039,
        sha256:
          '45b412e1898db25e58e2400d69aca30f1860629deed487b1f3cb0d610dd6d722',
        observedIdentity: 'AEO-B737-31-0034-R00',
        identityLocator: 'word/header1.xml',
      },
    ],
    nonClaims: [],
  };
}
