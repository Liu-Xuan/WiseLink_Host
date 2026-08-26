import {
  sealResultEnvelope,
  sealTaskEnvelope,
} from '../../server/modules/action-attempt/action-attempt-envelope';
import {
  parseReviewTurnCandidateContract,
  parseReviewTurnTaskContract,
  REVIEW_ALLOWED_OPERATIONS,
  REVIEW_MODEL_POLICY_REF,
  REVIEW_PROFILE_REF,
  REVIEW_RUNTIME_APP_ID,
  REVIEW_SKILL_POLICY_REF,
  REVIEW_TOOL_POLICY_REF,
} from '../../server/modules/canonical-host/canonical-host-openclaw-review.contract';

describe('interactive review C2 task/result contract', () => {
  it('accepts a complete candidate-only result bound to the frozen allowlists', () => {
    const task = reviewTask();
    const result = reviewResult(task, {
      responseType: 'REVIEW_ACTION_DRAFT',
      reviewActionDraft: {
        baseRevision: 7,
        evaluationItemId: 'RULE-1',
        proposedStatus: 'confirmed_pass',
        adoptedInputRefs: [],
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

  it('rejects a cross-WorkItem SourceRef before persistence', () => {
    const task = reviewTask();
    const result = reviewResult(task, { sourceRefs: ['SRC-OTHER'] });
    expect(() => parseReviewTurnCandidateContract({ result, task })).toThrow(
      'REVIEW_RESULT_SOURCE_REF_NOT_ALLOWED',
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
        { 'wiselink-openclaw-engineering-assessment': '1.1.0' },
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
        allowedAdoptedInputRefs: [],
        attachmentRefs: [],
        context: { evaluation: { items: [] } },
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
    'wiselink-openclaw-engineering-assessment': '1.1.0',
  },
  skillVersion: string = REVIEW_SKILL_POLICY_REF,
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
    modelVersion: 'GLM-5.1',
    promptVersion: 'review-prompt.v1',
    skillVersion,
    toolVersions,
    runMetrics: { durationMs: 1, inputUnits: 1, outputUnits: 1 },
    errorCode: null,
    errorDetail: null,
  });
}
