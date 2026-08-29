import {
  AEO_EDITING_KNOWLEDGE_VERSION,
  buildAeoDraftLearningInput,
  createAeoDraftAssistanceCandidate,
  recordAeoDraftFeedback,
  regenerateAeoDraftSelection,
  type AeoDraftAssistanceCandidate,
  type AeoDraftAssistanceRequest,
  type AeoDraftFeedbackInput,
  type AeoDraftSuggestion,
  type AeoEditingActionUnit,
  type AeoEditingKnowledgeCandidate,
} from '../../server/modules/aeo-authoring/aeo-editing-knowledge';

describe('AEO draft regeneration feedback versions', () => {
  it('supersedes selected feedback while retaining unselected decisions', () => {
    const knowledge: AeoEditingKnowledgeCandidate = sampleKnowledge();
    const base: AeoDraftAssistanceCandidate = createAeoDraftAssistanceCandidate(
      request(knowledge),
    );
    const unit1: AeoDraftSuggestion = suggestion(base, 'ACTION-001');
    const unit2: AeoDraftSuggestion = suggestion(base, 'ACTION-002');
    const unit3: AeoDraftSuggestion = suggestion(base, 'ACTION-003');
    const decided: AeoDraftAssistanceCandidate = [
      modify('FDBK-1', unit1, '工程师保留的未选中修改。'),
      modify('FDBK-2', unit2, '将被重生成的旧修改。'),
      reject('FDBK-3', unit3),
    ].reduce(
      (draft: AeoDraftAssistanceCandidate, feedback: AeoDraftFeedbackInput) =>
        recordAeoDraftFeedback(draft, feedback),
      base,
    );

    const regenerated: AeoDraftAssistanceCandidate =
      regenerateAeoDraftSelection(
        decided,
        {
          ...request(knowledge),
          selectedUnitIds: ['ACTION-002'],
          expectedGenerationRevision: 1,
        },
        'Refresh the selected candidate after engineer feedback.',
      );
    const learning = buildAeoDraftLearningInput(regenerated);

    expect(suggestion(regenerated, 'ACTION-002').reviewStatus).toBe(
      'PENDING_ENGINEER_REVIEW',
    );
    expect(regenerated.feedback.map((item) => item.feedbackId)).toEqual([
      'FDBK-1',
      'FDBK-3',
    ]);
    expect(learning.modified.map((item) => item.feedbackId)).toEqual([
      'FDBK-1',
    ]);
    expect(learning.rejected.map((item) => item.feedbackId)).toEqual([
      'FDBK-3',
    ]);
    expect(regenerated.supersededFeedback).toEqual([
      expect.objectContaining({
        feedback: expect.objectContaining({ feedbackId: 'FDBK-2' }),
        sourceUnitId: 'ACTION-002',
        activeThroughGenerationRevision: 1,
        supersededAtGenerationRevision: 2,
        reason: 'SELECTED_UNIT_REGENERATED',
      }),
    ]);
    expect(blockBody(regenerated, 'ACTION-001')).toBe(
      '工程师保留的未选中修改。',
    );
    expect(blockBody(regenerated, 'ACTION-002')).toBe('候选步骤 2。');
    expect(blockBody(regenerated, 'ACTION-003')).toBeUndefined();

    const reusedId: AeoDraftAssistanceCandidate = recordAeoDraftFeedback(
      regenerated,
      reject('FDBK-2', suggestion(regenerated, 'ACTION-002'), 2),
    );
    expect(() =>
      recordAeoDraftFeedback(
        reusedId,
        reject('FDBK-2', suggestion(reusedId, 'ACTION-002'), 2),
      ),
    ).toThrow('AEO_DRAFT_FEEDBACK_ID_DUPLICATE: FDBK-2');

    const replayed: AeoDraftAssistanceCandidate = regenerateAeoDraftSelection(
      reusedId,
      {
        ...request(knowledge),
        selectedUnitIds: ['ACTION-002'],
        expectedGenerationRevision: 2,
      },
      'Replay the selected rejected candidate.',
    );
    expect(suggestion(replayed, 'ACTION-002').reviewStatus).toBe(
      'PENDING_ENGINEER_REVIEW',
    );
    expect(blockBody(replayed, 'ACTION-002')).toBe('候选步骤 2。');
    expect(
      buildAeoDraftLearningInput(replayed).rejected.map(
        (item) => item.feedbackId,
      ),
    ).toEqual(['FDBK-3']);
    expect(
      replayed.supersededFeedback
        .filter((item) => item.feedback.feedbackId === 'FDBK-2')
        .map((item) => item.feedback.targetGenerationRevision),
    ).toEqual([1, 2]);
  });

  it('rejects stale feedback before it can overwrite a regenerated unit', () => {
    const knowledge: AeoEditingKnowledgeCandidate = sampleKnowledge();
    const base: AeoDraftAssistanceCandidate = createAeoDraftAssistanceCandidate(
      request(knowledge),
    );
    const staleModify: AeoDraftFeedbackInput = modify(
      'FDBK-STALE',
      suggestion(base, 'ACTION-002'),
      '来自 generation 1 的过期正文。',
      1,
    );
    const regenerated: AeoDraftAssistanceCandidate =
      regenerateAeoDraftSelection(
        base,
        {
          ...request(knowledge),
          selectedUnitIds: ['ACTION-002'],
          expectedGenerationRevision: 1,
        },
        'Regenerate before delayed engineer feedback arrives.',
      );
    const beforeStaleAttempt: string = JSON.stringify(regenerated);

    expect(() => recordAeoDraftFeedback(regenerated, staleModify)).toThrow(
      'AEO_DRAFT_FEEDBACK_GENERATION_CONFLICT: expected 1, current 2',
    );
    expect(JSON.stringify(regenerated)).toBe(beforeStaleAttempt);
    expect(buildAeoDraftLearningInput(regenerated).modified).toEqual([]);
    expect(blockBody(regenerated, 'ACTION-002')).toBe('候选步骤 2。');

    const currentModify: AeoDraftAssistanceCandidate = recordAeoDraftFeedback(
      regenerated,
      modify(
        'FDBK-GEN2',
        suggestion(regenerated, 'ACTION-002'),
        'generation 2 工程师修订。',
        2,
      ),
    );
    expect(currentModify.feedback).toEqual([
      expect.objectContaining({
        feedbackId: 'FDBK-GEN2',
        targetGenerationRevision: 2,
      }),
    ]);
    expect(
      buildAeoDraftLearningInput(currentModify).modified.map(
        (item) => item.feedbackId,
      ),
    ).toEqual(['FDBK-GEN2']);
    expect(blockBody(currentModify, 'ACTION-002')).toBe(
      'generation 2 工程师修订。',
    );
  });

  it('retains distinct old sources and rejects a reused drifting sourceId', () => {
    const original: AeoEditingKnowledgeCandidate = sampleKnowledge();
    const current: AeoDraftAssistanceCandidate =
      createAeoDraftAssistanceCandidate(request(original));
    const revised: AeoEditingKnowledgeCandidate = sampleKnowledge(
      'R00',
      'SRC-AEO-R01',
      1200,
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    );
    const compatible: AeoDraftAssistanceCandidate = regenerateAeoDraftSelection(
      current,
      {
        ...request(revised),
        selectedUnitIds: ['ACTION-002'],
        expectedGenerationRevision: 1,
      },
      'Regenerate one unit from a separately identified revision source.',
    );
    expect(compatible.sources.map((source) => source.sourceId)).toEqual([
      'SRC-AEO-R01',
      'SRC-AEO-R00',
    ]);
    expect(sourceArtifact(compatible, 'ACTION-001')).toContain('R00');
    expect(sourceArtifact(compatible, 'ACTION-002')).toContain('R01');

    const driftingIdentity: AeoEditingKnowledgeCandidate = sampleKnowledge(
      'R00',
      'SRC-AEO-R00',
      1200,
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    );
    const beforeConflict: string = JSON.stringify(current);
    expect(() =>
      regenerateAeoDraftSelection(
        current,
        {
          ...request(driftingIdentity),
          selectedUnitIds: current.suggestions.map(
            (item: AeoDraftSuggestion) => item.sourceUnitId,
          ),
          expectedGenerationRevision: 1,
        },
        'Attempt reuse of a source ID whose actual identity changed.',
      ),
    ).toThrow('AEO_DRAFT_REGENERATION_SOURCE_IDENTITY_CONFLICT: SRC-AEO-R00');
    expect(JSON.stringify(current)).toBe(beforeConflict);
  });

  it('rejects stale generations and cross-matter reuse of the same draftKey', () => {
    const original: AeoEditingKnowledgeCandidate = sampleKnowledge();
    const current: AeoDraftAssistanceCandidate =
      createAeoDraftAssistanceCandidate(request(original));
    const before: string = JSON.stringify(current);
    expect(() =>
      regenerateAeoDraftSelection(
        current,
        {
          ...request(original),
          selectedUnitIds: ['ACTION-001'],
          expectedGenerationRevision: 0,
        },
        'A stale caller cannot regenerate.',
      ),
    ).toThrow('AEO_DRAFT_REGENERATION_GENERATION_CONFLICT');

    const otherMatter: AeoEditingKnowledgeCandidate = {
      ...original,
      documentIdentity: {
        ...original.documentIdentity,
        aeoNumber: 'AEO-B787-45-OTHER',
        expectedHeader: 'AEO-B787-45-OTHER-R00',
        observedHeader: 'AEO-B787-45-OTHER-R00',
      },
      sources: original.sources.map((source) => ({
        ...source,
        observedIdentity: 'AEO-B787-45-OTHER-R00',
      })),
      knowledgeVersion: 'knowledge:other-matter:R00',
    };
    expect(() =>
      regenerateAeoDraftSelection(
        current,
        {
          ...request(otherMatter),
          selectedUnitIds: ['ACTION-001'],
          expectedGenerationRevision: 1,
        },
        'A different AEO cannot reuse this draft identity.',
      ),
    ).toThrow('AEO_DRAFT_REGENERATION_MATTER_IDENTITY_MISMATCH');
    expect(JSON.stringify(current)).toBe(before);
  });
});

function request(
  knowledge: AeoEditingKnowledgeCandidate,
): AeoDraftAssistanceRequest {
  return {
    draftKey: 'WI-AEO-FEEDBACK-VERSION',
    title: 'Versioned feedback draft candidate',
    knowledge,
    selectedUnitIds: knowledge.actionUnits.map(
      (unit: AeoEditingActionUnit) => unit.unitId,
    ),
    currentSourceRefs: [
      {
        sourceId: knowledge.documentIdentity.primarySourceId,
        locator: knowledge.documentIdentity.identityLocator,
      },
    ],
  };
}

function suggestion(
  draft: AeoDraftAssistanceCandidate,
  unitId: string,
): AeoDraftSuggestion {
  const found: AeoDraftSuggestion | undefined = draft.suggestions.find(
    (item: AeoDraftSuggestion) => item.sourceUnitId === unitId,
  );
  if (!found) {
    throw new Error(`TEST_SUGGESTION_NOT_FOUND: ${unitId}`);
  }
  return found;
}

function modify(
  feedbackId: string,
  target: AeoDraftSuggestion,
  revisedBodyZh: string,
  expectedGenerationRevision = 1,
): AeoDraftFeedbackInput {
  return {
    feedbackId,
    suggestionId: target.suggestionId,
    expectedGenerationRevision,
    decision: 'MODIFY',
    engineerDecisionRef: `ENG-${feedbackId}`,
    note: 'Engineer revision remains candidate-only.',
    revisedBodyZh,
    revisionSourceRefs: target.sourceRefs,
    semanticField: 'BODY',
    reasonCode: 'SOURCE_MISMATCH',
    learningDisposition: 'SERIES_PATTERN_CANDIDATE',
  };
}

function reject(
  feedbackId: string,
  target: AeoDraftSuggestion,
  expectedGenerationRevision = 1,
): AeoDraftFeedbackInput {
  return {
    feedbackId,
    suggestionId: target.suggestionId,
    expectedGenerationRevision,
    decision: 'REJECT',
    engineerDecisionRef: `ENG-${feedbackId}`,
    note: 'Engineer rejected this candidate suggestion.',
    semanticField: 'SUGGESTION',
    reasonCode: 'APPLICABILITY',
    learningDisposition: 'SERIES_PATTERN_CANDIDATE',
  };
}

function blockBody(
  draft: AeoDraftAssistanceCandidate,
  unitId: string,
): string | null | undefined {
  const target: AeoDraftSuggestion = suggestion(draft, unitId);
  const block = draft.editorBlocks.find(
    (item) => item.blockId === target.suggestionId,
  );
  return block?.blockType === 'PARAGRAPH' ? block.bodyZh : undefined;
}

function sourceArtifact(
  draft: AeoDraftAssistanceCandidate,
  unitId: string,
): string | undefined {
  const target: AeoDraftSuggestion = suggestion(draft, unitId);
  return draft.editorBlocks.find(
    (block) => block.blockId === target.suggestionId,
  )?.sourceBindings[0]?.sourceArtifactRef;
}

function sampleKnowledge(
  revision = 'R00',
  sourceId = 'SRC-AEO-R00',
  actualBytes = 1000,
  sha256 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
): AeoEditingKnowledgeCandidate {
  const header = `AEO-B787-45-TEST-${revision}`;
  const sourceRef = (sequence: number) => ({
    sourceId,
    locator: `main-row-${sequence}`,
  });
  const action = (sequence: number): AeoEditingActionUnit => ({
    unitId: `ACTION-00${sequence}`,
    sequence,
    phase: sequence === 3 ? 'CLOSEOUT' : 'INSTALL',
    operation: 'EDIT_CANDIDATE',
    object: 'test object',
    bodyZh: `候选步骤 ${sequence}。`,
    bodyEn: `Candidate step ${sequence}.`,
    parameters: [],
    conditions: [],
    dependencies: [],
    branches: [],
    sourceDisposition: sequence === 1 ? 'ADAPT' : 'COMPANY_ADDED',
    sourceRefs: [sourceRef(sequence)],
    performerRoles: ['T1'],
    inspectorRoles: ['XXX'],
    signatureGranularity: 'ROW',
    verifications: [],
    closeout: [],
    safetyNotes: [],
    inspectionDetail: null,
    reviewStatus: 'CANDIDATE',
  });
  const actions: AeoEditingActionUnit[] = [action(1), action(2), action(3)];
  return {
    schemaVersion: AEO_EDITING_KNOWLEDGE_VERSION,
    lifecycleStatus: 'CANDIDATE_ONLY',
    documentState:
      'CONTROLLED_OR_ISSUED_SAMPLE_APPROVAL_NOT_INDEPENDENTLY_VERIFIED',
    authority: 'EDITING_ASSISTANCE_NOT_APPROVAL_NOT_RELEASE',
    documentIdentity: {
      aeoNumber: 'AEO-B787-45-TEST',
      revision,
      title: 'AEO feedback regeneration sample',
      category: 'SOFTWARE_INSTALLATION_UPDATE',
      actualBytes,
      primarySourceId: sourceId,
      expectedHeader: header,
      observedHeader: header,
      identityLocator: 'active header table',
    },
    knowledgeVersion: `knowledge:${revision}`,
    sources: [
      {
        sourceId,
        role: 'AEO_ISSUED_OR_CONTROLLED_SAMPLE',
        artifactRef: `artifact://historical/${sourceId}-${header}.docx`,
        actualBytes,
        sha256,
        observedIdentity: header,
        identityLocator: 'active header table',
      },
    ],
    actionUnits: actions,
    structureSkeleton: {
      sectionKeys: ['INSTALL', 'CLOSEOUT'],
      performerRolePlaceholders: ['T1'],
      inspectorRolePlaceholders: ['XXX'],
      signatureGranularities: ['ROW'],
      safetyNoteUnitIds: [],
      parameterizedUnitIds: [],
    },
    applicableTemplateCandidateUnitIds: ['ACTION-001'],
    companyStepCandidateUnitIds: ['ACTION-002', 'ACTION-003'],
    missingInputs: [],
    conflicts: [],
    producerEvidence: {
      sourceSelection: null,
      figureUnits: [],
      reviewFlags: [],
      companyAddedOrSpecializedControls: [],
      sourceCandidatesRequiringDecision: [],
      nonGeneralizable: [],
    },
    sampleSupport: {
      sampleCount: 1,
      inferenceRule: 'FREQUENCY_NEVER_ESTABLISHES_ENGINEERING_REQUIREMENT',
    },
    nonClaims: ['Candidate only; no approval or release is created.'],
  };
}
