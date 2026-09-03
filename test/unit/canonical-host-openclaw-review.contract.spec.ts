import {
  sealResultEnvelope,
  sealTaskEnvelope,
} from '../../server/modules/action-attempt/action-attempt-envelope';
import {
  parseReviewTurnCandidateContract,
  parseReviewTurnTaskContract,
  REVIEW_ALLOWED_OPERATIONS,
  REVIEW_MODEL_POLICY_REF,
  REVIEW_MINIMUM_COMPATIBLE_SKILL_VERSION,
  REVIEW_PROFILE_REF,
  REVIEW_RUNTIME_APP_ID,
  REVIEW_SKILL_POLICY_REF,
  REVIEW_TOOL_POLICY_REF,
} from '../../server/modules/canonical-host/canonical-host-openclaw-review.contract';

describe('interactive review C2 task / C2 legacy and C3 current result contract', () => {
  it('accepts a complete candidate-only result bound to the frozen allowlists', () => {
    const task = reviewTask();
    const result = reviewResult(task, {
      responseType: 'REVIEW_ACTION_DRAFT',
      reviewActionDraft: {
        baseRevision: 7,
        evaluationItemId: 'RULE-1',
        proposedStatus: 'confirmed_pass',
        resolvedGapRefs: ['GAP-001'],
        adoptedInputRefs: ['engineer-input:ESI-1'],
        sourceRefs: ['SRC-1'],
        assumptions: [],
        affectedItemIds: ['RULE-1'],
        overallImpact: true,
      },
      affectedItemIds: ['RULE-1'],
    });

    expect(parseReviewTurnCandidateContract({ result, task })).toMatchObject({
      mode: 'INTERACTIVE_REVIEW',
      reviewConversationRef: 'RC-1',
      reviewTurnRef: 'RT-1',
      responseType: 'REVIEW_ACTION_DRAFT',
    });
  });

  it('accepts a c3 DecisionSnapshot when every critical Gap has a controlled disposition', () => {
    const task = reviewTask();
    const uncertaintyDispositions = [
      {
        gapRef: 'GAP-001',
        disposition: 'RESOLVED_BY_EVIDENCE',
        rationale: 'Engineer input supplies the controlled current fact.',
        assumptions: [],
        controlsAndMitigations: [],
        evidenceRefs: ['SRC-1'],
        reviewBy: null,
        reopenTriggers: ['A newer configuration record becomes current.'],
      },
    ];
    const result = reviewResult(task, {
      schemaVersion: 'wiselink.3_1.review_turn_candidate.v1.c3',
      responseType: 'REVIEW_ACTION_DRAFT',
      reviewActionDraft: {
        baseRevision: 7,
        evaluationItemId: 'RULE-1',
        proposedStatus: 'confirmed_pass',
        resolvedGapRefs: ['GAP-001'],
        adoptedInputRefs: ['engineer-input:ESI-1'],
        sourceRefs: ['SRC-1'],
        assumptions: [],
        affectedItemIds: ['RULE-1'],
        overallImpact: true,
        uncertaintyDispositions,
        decisionSnapshot: {
          assessmentAsOf: '2026-08-26T10:00:00.000Z',
          evidenceHorizon: [
            'SOURCE_DOCUMENT_COMPLETE',
            'TARGET_IDENTITY_KNOWN',
          ],
          currentBestJudgment: 'The criterion is satisfied as of the evidence time.',
          alternativeJudgments: [],
          decisionMaturity: 'CONFIRMABLE',
          decisiveFacts: ['The controlled configuration record matches the target.'],
          assumptions: [],
          residualUncertainties: [],
          uncertaintyDispositions,
          controlsAndMitigations: [],
          monitoringPlan: null,
          validUntil: null,
          reviewBy: null,
          reopenTriggers: ['A newer configuration record becomes current.'],
          whatWouldChangeDecision: ['Contradictory controlled configuration evidence.'],
          candidateOnly: true,
        },
      },
      affectedItemIds: ['RULE-1'],
    });

    expect(parseReviewTurnCandidateContract({ result, task })).toMatchObject({
      schemaVersion: 'wiselink.3_1.review_turn_candidate.v1.c3',
      reviewActionDraft: {
        decisionSnapshot: { decisionMaturity: 'CONFIRMABLE' },
        uncertaintyDispositions,
      },
    });
  });

  it('rejects a c3 CONFIRMABLE snapshot while a critical Gap is only RESOLVE_NOW', () => {
    const task = reviewTask();
    const uncertaintyDispositions = [
      {
        gapRef: 'GAP-001',
        disposition: 'RESOLVE_NOW',
        rationale: 'The fact is still required.',
        assumptions: [],
        controlsAndMitigations: [],
        evidenceRefs: [],
        reviewBy: null,
        reopenTriggers: [],
      },
    ];
    const result = reviewResult(task, {
      schemaVersion: 'wiselink.3_1.review_turn_candidate.v1.c3',
      responseType: 'REVIEW_ACTION_DRAFT',
      reviewActionDraft: {
        baseRevision: 7,
        evaluationItemId: 'RULE-1',
        proposedStatus: 'deferred',
        resolvedGapRefs: [],
        adoptedInputRefs: [],
        sourceRefs: ['SRC-1'],
        assumptions: [],
        affectedItemIds: ['RULE-1'],
        overallImpact: true,
        uncertaintyDispositions,
        decisionSnapshot: {
          assessmentAsOf: '2026-08-26T10:00:00.000Z',
          evidenceHorizon: ['SOURCE_DOCUMENT_COMPLETE'],
          currentBestJudgment: 'The current judgment remains deferred.',
          alternativeJudgments: [],
          decisionMaturity: 'CONFIRMABLE',
          decisiveFacts: [],
          assumptions: [],
          residualUncertainties: ['Current part number is unknown.'],
          uncertaintyDispositions,
          controlsAndMitigations: [],
          monitoringPlan: null,
          validUntil: null,
          reviewBy: null,
          reopenTriggers: [],
          whatWouldChangeDecision: ['A controlled current part number.'],
          candidateOnly: true,
        },
      },
      affectedItemIds: ['RULE-1'],
    });

    expect(() => parseReviewTurnCandidateContract({ result, task })).toThrow(
      'REVIEW_RESULT_DECISION_SNAPSHOT_NOT_CONFIRMABLE',
    );
  });

  it('rejects a model-invented gap ref before persistence', () => {
    const task = reviewTask();
    const result = reviewResult(task, {
      responseType: 'REVIEW_ACTION_DRAFT',
      reviewActionDraft: {
        baseRevision: 7,
        evaluationItemId: 'RULE-1',
        proposedStatus: 'confirmed_pass',
        resolvedGapRefs: ['GAP-404'],
        adoptedInputRefs: ['engineer-input:ESI-1'],
        sourceRefs: ['SRC-1'],
        assumptions: [],
        affectedItemIds: ['RULE-1'],
        overallImpact: true,
      },
      affectedItemIds: ['RULE-1'],
    });

    expect(() => parseReviewTurnCandidateContract({ result, task })).toThrow(
      'REVIEW_RESULT_DRAFT_GAP_NOT_ALLOWED',
    );
  });

  it('rejects gap closure without engineer input or attachment evidence', () => {
    const task = reviewTask();
    const result = reviewResult(task, {
      responseType: 'REVIEW_ACTION_DRAFT',
      reviewActionDraft: {
        baseRevision: 7,
        evaluationItemId: 'RULE-1',
        proposedStatus: 'confirmed_pass',
        resolvedGapRefs: ['GAP-001'],
        adoptedInputRefs: [],
        sourceRefs: ['SRC-1'],
        assumptions: [],
        affectedItemIds: ['RULE-1'],
        overallImpact: true,
      },
      affectedItemIds: ['RULE-1'],
    });

    expect(() => parseReviewTurnCandidateContract({ result, task })).toThrow(
      'REVIEW_RESULT_DRAFT_GAP_EVIDENCE_REQUIRED',
    );
  });

  it('rejects a cross-WorkItem SourceRef before persistence', () => {
    const task = reviewTask();
    const result = reviewResult(task, { sourceRefs: ['SRC-OTHER'] });
    expect(() => parseReviewTurnCandidateContract({ result, task })).toThrow(
      'REVIEW_RESULT_SOURCE_REF_NOT_ALLOWED',
    );
  });

  it('rejects SOURCE_LINK without a structured SourceRef before persistence', () => {
    const task = reviewTask();
    const result = reviewResult(task, {
      responseType: 'SOURCE_LINK',
      sourceRefs: [],
    });
    expect(() => parseReviewTurnCandidateContract({ result, task })).toThrow(
      'REVIEW_RESULT_SOURCE_LINK_REF_REQUIRED',
    );
  });

  it('rejects missing actual tool provenance before persistence', () => {
    const task = reviewTask();
    const result = reviewResult(task, {}, {});
    expect(() => parseReviewTurnCandidateContract({ result, task })).toThrow(
      'REVIEW_RESULT_PROVENANCE_INVALID',
    );
  });

  it.each([
    'wiselink-research-and-synthesize.v1',
    'arbitrary-nonempty-skill-version',
  ])(
    'rejects non-frozen actual skill version %s before persistence',
    (skillVersion: string) => {
      const task = reviewTask();
      const result = reviewResult(
        task,
        {},
        { 'wiselink-openclaw-engineering-assessment': '1.2.0' },
        skillVersion,
      );
      expect(() => parseReviewTurnCandidateContract({ result, task })).toThrow(
        'REVIEW_RESULT_PROVENANCE_INVALID',
      );
    },
  );

  it('rejects a draft that targets an evaluation item outside the frozen set', () => {
    const task = reviewTask();
    const result = reviewResult(task, {
      responseType: 'REVIEW_ACTION_DRAFT',
      reviewActionDraft: {
        baseRevision: 7,
        evaluationItemId: 'RULE-OTHER',
        proposedStatus: 'confirmed_pass',
        resolvedGapRefs: [],
        adoptedInputRefs: [],
        sourceRefs: ['SRC-1'],
        assumptions: [],
        affectedItemIds: ['RULE-OTHER'],
        overallImpact: false,
      },
      affectedItemIds: ['RULE-OTHER'],
    });
    expect(() => parseReviewTurnCandidateContract({ result, task })).toThrow(
      'REVIEW_RESULT_DRAFT_ITEM_NOT_ALLOWED',
    );
  });

  it('rejects a draft that invents an adopted input reference', () => {
    const task = reviewTask();
    const result = reviewResult(task, {
      responseType: 'REVIEW_ACTION_DRAFT',
      reviewActionDraft: {
        baseRevision: 7,
        evaluationItemId: 'RULE-1',
        proposedStatus: 'confirmed_pass',
        resolvedGapRefs: [],
        adoptedInputRefs: ['engineer-review:other-work-item'],
        sourceRefs: ['SRC-1'],
        assumptions: [],
        affectedItemIds: ['RULE-1'],
        overallImpact: false,
      },
      affectedItemIds: ['RULE-1'],
    });
    expect(() => parseReviewTurnCandidateContract({ result, task })).toThrow(
      'REVIEW_RESULT_DRAFT_ADOPTED_INPUT_NOT_ALLOWED',
    );
  });
});

function reviewTask() {
  return parseReviewTurnTaskContract(
    sealTaskEnvelope({
      schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
      actionAttemptId: 'ATT-1',
      operationRef: 'AQ-1',
      taskType: 'OPENCLAW_INTERACTIVE_REVIEW',
      priority: 100,
      tenantId: 'tenant-1',
      workItemId: 'WI-1',
      inputRevision: 7,
      baseRevision: 7,
      documentVersionId: 'DV-1',
      sourceRefs: [],
      allowedConnectors: [],
      hostResolvedMissingInputs: [],
      modelInput: {
        schemaVersion: 'wiselink.3_1.review_turn_task.v1.c2',
        mode: 'INTERACTIVE_REVIEW',
        reviewConversationRef: 'RC-1',
        reviewTurnRef: 'RT-1',
        requestId: 'REQ-1',
        actorContextRef: `ACTX-${'a'.repeat(64)}`,
        inputRevision: 7,
        selectedEvaluationItemId: null,
        userMessage: 'Review this item.',
        allowedOperations: [...REVIEW_ALLOWED_OPERATIONS],
        resourceRefs: [
          {
            sourceRefId: 'SRC-1',
            resourceArtifactRef: 'artifact://package',
            resourceArtifactSha256: 'a'.repeat(64),
            value: { sourceRefId: 'SRC-1', pageStart: 1, pageEnd: 1 },
          },
        ],
        allowedEvaluationItemIds: ['RULE-1'],
        allowedAdoptedInputRefs: ['engineer-input:ESI-1'],
        attachmentRefs: [],
        context: {
          evaluation: {
            items: [],
            gapLedger: {
              schemaVersion: 'wiselink.3_1.assessment_gap_ledger_projection.v1',
              inputRevision: 7,
              baseRuleRevision: 1,
              currentness: 'CURRENT',
              candidateOnly: true,
              gaps: [
                {
                  gapRef: 'GAP-001',
                  missingInputId: 'aircraft.currentPartNumber',
                  materiality: 'P0_DECISION_CRITICAL',
                  queryability: 'REVIEW_QUERYABLE',
                  resolutionStatus: 'OPEN',
                  affectedCriterionIds: ['RULE-1'],
                  authority: {
                    owner: 'CANONICAL_HOST',
                    modelMayClose: false,
                  },
                },
              ],
            },
          },
        },
        executionPolicy: {
          runtimeAppId: REVIEW_RUNTIME_APP_ID,
          profileRef: REVIEW_PROFILE_REF,
          modelPolicyRef: REVIEW_MODEL_POLICY_REF,
          skillPolicyRef: REVIEW_SKILL_POLICY_REF,
          toolPolicyRef: REVIEW_TOOL_POLICY_REF,
        },
      },
      deadline: '2026-08-26T10:10:00.000Z',
      idempotencyKey: 'review:1',
    }).modelInput,
  );
}

function reviewResult(
  task: ReturnType<typeof reviewTask>,
  overrides: Record<string, unknown> = {},
  toolVersions: Record<string, string> = {
    'wiselink-openclaw-engineering-assessment': '1.2.0',
  },
  skillVersion: string = REVIEW_MINIMUM_COMPATIBLE_SKILL_VERSION,
) {
  return sealResultEnvelope({
    schemaVersion: 'wiselink.3_1.openclaw_result_envelope.v1',
    actionAttemptId: 'ATT-1',
    operationRef: 'AQ-1',
    taskType: 'OPENCLAW_INTERACTIVE_REVIEW',
    workItemId: 'WI-1',
    baseRevision: 7,
    status: 'SUCCEEDED',
    businessOutcome: 'CANDIDATE_READY',
    candidateStatus: null,
    modelOutput: JSON.stringify({
      schemaVersion: 'wiselink.3_1.review_turn_candidate.v1.c2',
      mode: 'INTERACTIVE_REVIEW',
      reviewConversationRef: 'RC-1',
      reviewTurnRef: 'RT-1',
      responseType: 'ANSWER',
      answer: 'Candidate answer.',
      sourceRefs: ['SRC-1'],
      missingInputs: [],
      candidateEvidenceRefs: [],
      reviewActionDraft: null,
      affectedItemIds: [],
      warnings: [],
      runtime: {
        runtimeAppId: REVIEW_RUNTIME_APP_ID,
        profileRef: REVIEW_PROFILE_REF,
      },
      ...overrides,
    }),
    outputArtifactRefs: [],
    sourceRefs: [],
    factsConsidered: [],
    missingInputs: [],
    conflicts: [],
    warnings: [],
    modelVersion: 'GLM-5.3',
    promptVersion: 'review-prompt.v1',
    skillVersion,
    toolVersions,
    runMetrics: { durationMs: 1, inputUnits: 1, outputUnits: 1 },
    errorCode: null,
    errorDetail: null,
  });
}
