import type {
  CanonicalWorkItemProjection,
  ReviewTurnAssistantCandidate,
} from '../../shared/api.interface';
import {
  sealResultEnvelope,
  sealTaskEnvelope,
} from '../../server/modules/action-attempt/action-attempt-envelope';
import type {
  OpenClawResultEnvelope,
  OpenClawTaskEnvelope,
} from '../../server/modules/action-attempt/action-attempt-envelope.types';
import type {
  ActionAttemptRow,
  ReserveAndClaimInput,
} from '../../server/modules/action-attempt/action-attempt.types';
import { REVIEW_SKILL_POLICY_REF } from '../../server/modules/canonical-host/canonical-host-openclaw-review.contract';
import { CanonicalHostOpenClawReviewService } from '../../server/modules/canonical-host/canonical-host-openclaw-review.service';

describe('CanonicalHostOpenClawReviewService', () => {
  it('derives the user/work item/revision from C1 persistence and freezes exact SourceRefs', async () => {
    const harness = reviewHarness();
    const begin = await harness.service.begin('RC-1', 'request-1');

    expect(harness.attempts.reserveAndClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: 'WI-1',
        tenantId: 'tenant-1',
        actorUserId: 'actor-1',
        inputRevision: 7,
        baseRevision: 7,
        taskType: 'OPENCLAW_INTERACTIVE_REVIEW',
      }),
    );
    expect(begin.task.modelInput).toMatchObject({
      mode: 'INTERACTIVE_REVIEW',
      reviewConversationRef: 'RC-1',
      reviewTurnRef: 'RT-1',
      requestId: 'request-1',
      inputRevision: 7,
      selectedEvaluationItemId: null,
      resourceRefs: [expect.objectContaining({ sourceRefId: 'SRC-1' })],
    });
    expect(JSON.stringify(begin.task.modelInput)).not.toContain('actor-1');
    expect(JSON.stringify(begin.task.modelInput)).not.toContain('tenant-1');
    expect(JSON.stringify(begin.task.modelInput)).not.toContain(
      'openClawSessionKey',
    );
  });

  it('returns only exact frozen allowlisted SourceRefs and rejects any other ref', async () => {
    const harness = reviewHarness();
    await harness.service.begin('RC-1', 'request-1');

    await expect(
      harness.service.readSourceRefs('AQ-REVIEW-1', ['SRC-OTHER']),
    ).rejects.toMatchObject({ code: 'REVIEW_TURN_NOT_FOUND' });
    await expect(
      harness.service.readSourceRefs('AQ-REVIEW-1', ['SRC-1']),
    ).resolves.toMatchObject({
      sourceRefs: [{ sourceRefId: 'SRC-1', pageStart: 1, pageEnd: 1 }],
    });
  });

  it('returns the durable COMMITTING recovery envelope without a currentness write', async () => {
    const harness = reviewHarness();
    const begin = await harness.service.begin('RC-1', 'request-1');
    const result = harness.result(begin.task, {
      'wiselink-openclaw-engineering-assessment': '1.1.0',
    });
    harness.setCommittingRecovery(result);

    await expect(
      harness.service.status(begin.attemptRef),
    ).resolves.toMatchObject({
      attemptRef: 'AQ-REVIEW-1',
      status: 'COMMITTING',
      recoveryAvailable: true,
      projectionApplied: false,
      recoveryResult: result,
    });
    expect(harness.workItems.loadTenantScopedProjection).toHaveBeenCalledTimes(
      1,
    );
  });

  it('rejects missing actual provenance before ActionAttempt or review mutation', async () => {
    const harness = reviewHarness();
    const begin = await harness.service.begin('RC-1', 'request-1');
    const result = harness.result(begin.task, {});

    await expect(
      harness.service.commit(
        begin.attemptRef,
        begin.leaseToken,
        begin.leaseGeneration,
        result,
      ),
    ).rejects.toThrow('REVIEW_RESULT_PROVENANCE_INVALID');
    expect(harness.attempts.prepareCommit).not.toHaveBeenCalled();
    expect(
      harness.conversations.persistAssistantCandidate,
    ).not.toHaveBeenCalled();
  });

  it('rejects an old skill version before ActionAttempt or review mutation', async () => {
    const harness = reviewHarness();
    const begin = await harness.service.begin('RC-1', 'request-1');
    const result = harness.result(
      begin.task,
      { 'wiselink-openclaw-engineering-assessment': '1.1.0' },
      'wiselink-research-and-synthesize.v1',
    );

    await expect(
      harness.service.commit(
        begin.attemptRef,
        begin.leaseToken,
        begin.leaseGeneration,
        result,
      ),
    ).rejects.toThrow('REVIEW_RESULT_PROVENANCE_INVALID');
    expect(harness.attempts.prepareCommit).not.toHaveBeenCalled();
    expect(
      harness.conversations.persistAssistantCandidate,
    ).not.toHaveBeenCalled();
  });

  it('persists only the ReviewTurn candidate and terminalizes without projection/CAS', async () => {
    const harness = reviewHarness();
    const begin = await harness.service.begin('RC-1', 'request-1');
    const result = harness.result(begin.task, {
      'wiselink-openclaw-engineering-assessment': '1.1.0',
    });

    const committed = await harness.service.commit(
      begin.attemptRef,
      begin.leaseToken,
      begin.leaseGeneration,
      result,
    );

    expect(committed).toMatchObject({
      attemptRef: 'AQ-REVIEW-1',
      status: 'SUCCEEDED',
      authority: {
        candidatePersisted: true,
        reviewActionExecuted: false,
        workItemRevisionChanged: false,
        currentChanged: false,
        staleMarked: false,
      },
    });
    expect(
      harness.conversations.persistAssistantCandidate,
    ).toHaveBeenCalledTimes(1);
    expect(
      harness.attempts.finishCandidatePersistenceSuccess,
    ).toHaveBeenCalledTimes(1);
    expect(harness.workItems.loadTenantScopedProjection).toHaveBeenCalled();
  });

  it('rejects an expired lease before ActionAttempt recovery or review mutation', async () => {
    const harness = reviewHarness();
    const begin = await harness.service.begin('RC-1', 'request-1');
    harness.expireLease();
    const result = harness.result(begin.task, {
      'wiselink-openclaw-engineering-assessment': '1.1.0',
    });

    await expect(
      harness.service.commit(
        begin.attemptRef,
        begin.leaseToken,
        begin.leaseGeneration,
        result,
      ),
    ).rejects.toMatchObject({ code: 'ACTION_ATTEMPT_LEASE_EXPIRED' });
    expect(harness.attempts.prepareCommit).not.toHaveBeenCalled();
    expect(
      harness.conversations.persistAssistantCandidate,
    ).not.toHaveBeenCalled();
  });
});

function reviewHarness() {
  const workItem = parsedWorkItem();
  const conversation = {
    reviewConversationId: 'RC-1',
    tenantId: 'tenant-1',
    actorId: 'actor-1',
    workItemId: 'WI-1',
    openClawAgentId: 'wiselink-engineering',
    openClawSessionKey: 'review:server-owned-secret',
    startedAtRevision: 7,
    lastSyncedRevision: 7,
    status: 'ACTIVE',
    createdAt: new Date('2026-08-26T10:00:00.000Z'),
    lastActiveAt: new Date('2026-08-26T10:01:00.000Z'),
    closedAt: null,
  };
  const turn = {
    reviewTurnId: 'RT-1',
    reviewConversationId: 'RC-1',
    engineerSuppliedInputId: 'ESI-1',
    turnNo: 1,
    requestId: 'request-1',
    inputRevision: 7,
    userMessage: 'Please review rule 1.',
    inputType: 'ENGINEER_TEXT',
    adoptionStatus: 'CANDIDATE_UNADOPTED',
    candidateText: 'Please review rule 1.',
    assistantCandidate: null,
    createdAt: new Date('2026-08-26T10:01:00.000Z'),
  };
  let task: OpenClawTaskEnvelope | null = null;
  let row: ActionAttemptRow | null = null;
  const conversations = {
    loadById: jest.fn(async () => ({ conversation, turns: [turn] })),
    loadTurnById: jest.fn(async () => turn),
    hasActiveOfficialActorMapping: jest.fn(async () => true),
    persistAssistantCandidate: jest.fn(async (input) => {
      const assistantCandidate: ReviewTurnAssistantCandidate = {
        ...input.candidate,
        completedAt: '2026-08-26T10:02:00.000Z',
      };
      return {
        turn: { ...turn, assistantCandidate },
        replayed: false,
      };
    }),
  };
  const workItems = {
    loadTenantScopedProjection: jest.fn(async () => ({
      row: {
        requestedByUserId: 'actor-1',
        revision: 7,
      },
      projection: workItem,
    })),
  };
  const engineerReviews = {
    pageContext: jest.fn(async () => ({
      criterionSetId: 'RULESET-1',
      baseRuleRevision: 1,
      ledger: null,
      items: [
        {
          criterionId: 'RULE-1',
          dynamicResult: 'PASS',
          candidateConclusion: 'Candidate conclusion',
          humanReviewRequired: true,
          factsConsidered: ['fact'],
          ruleApplication: 'rule',
          analysisSummary: 'analysis',
          sourceRefs: ['SRC-1'],
          missingInputs: [],
          latestReview: null,
        },
      ],
    })),
    modelContext: jest.fn(async () => ({
      revision: null,
      artifactSha256: null,
      reviewCount: 0,
      history: [],
      effective: [],
    })),
  };
  const attempts = {
    reserveAndClaim: jest.fn(async (input: ReserveAndClaimInput) => {
      const modelInput = await input.buildModelInput({
        attemptId: 'ATT-REVIEW-1',
        operationRef: 'AQ-REVIEW-1',
        triggerRequestId: 'REQ-REVIEW-1',
        attemptNo: 1,
        createdAt: new Date('2026-08-26T10:00:00.000Z'),
      });
      task = sealTaskEnvelope({
        schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
        actionAttemptId: 'ATT-REVIEW-1',
        operationRef: 'AQ-REVIEW-1',
        taskType: input.taskType,
        priority: 100,
        tenantId: input.tenantId,
        workItemId: input.workItemId,
        inputRevision: input.inputRevision,
        baseRevision: input.baseRevision,
        documentVersionId: input.documentVersionId,
        sourceRefs: input.sourceRefs ?? [],
        allowedConnectors: input.allowedConnectors ?? [],
        hostResolvedMissingInputs: input.hostResolvedMissingInputs ?? [],
        modelInput,
        deadline: '2099-08-26T10:10:00.000Z',
        idempotencyKey: input.idempotencyKey,
      });
      row = actionAttemptRow(task);
      return {
        attemptRef: task.operationRef,
        status: 'RUNNING' as const,
        leaseToken: '00000000-0000-4000-8000-000000000001',
        leaseGeneration: 1,
        leaseExpiresAt: '2099-08-26T10:01:00.000Z',
        task,
        created: true,
        triggerRequestId: 'REQ-REVIEW-1',
      };
    }),
    readScoped: jest.fn(async () => row!),
    prepareCommit: jest.fn(async (input) => ({
      row: { ...row!, status: 'COMMITTING' },
      task: task!,
      result: input.result,
      recovery: false,
    })),
    finishCandidatePersistenceSuccess: jest.fn(async () => ({
      attemptRef: 'AQ-REVIEW-1',
      status: 'SUCCEEDED',
      projectionApplied: false,
      terminalReason: 'REVIEW_TURN_CANDIDATE_PERSISTED',
    })),
    projectTerminal: jest.fn(),
  };
  const artifactStore = {
    readActualBytes: jest.fn(async () =>
      new TextEncoder().encode(
        JSON.stringify({
          sourceRefs: [
            { sourceRefId: 'SRC-1', pageStart: 1, pageEnd: 1 },
            { sourceRefId: 'SRC-UNUSED', pageStart: 2, pageEnd: 2 },
          ],
        }),
      ),
    ),
  };
  const serviceScope = {
    authorizeOpenClawWorkItem: jest.fn(async () => verifiedScope()),
    authorizeOpenClawAttempt: jest.fn(async () => ({
      ...verifiedScope(),
      attemptRef: 'AQ-REVIEW-1',
    })),
  };
  const service = new CanonicalHostOpenClawReviewService(
    conversations as never,
    workItems as never,
    engineerReviews as never,
    attempts as never,
    artifactStore as never,
    serviceScope as never,
  );
  return {
    service,
    attempts,
    conversations,
    workItems,
    expireLease() {
      row = {
        ...row!,
        leaseExpiresAt: new Date('2020-01-01T00:00:00.000Z'),
      };
    },
    setCommittingRecovery(result: OpenClawResultEnvelope) {
      row = {
        ...row!,
        status: 'COMMITTING',
        resultEnvelopeJson: JSON.stringify(result),
        resultContentHash: result.contentHash,
        commitStartedAt: new Date('2026-08-26T10:02:00.000Z'),
      };
    },
    result(
      selectedTask: OpenClawTaskEnvelope,
      toolVersions: Record<string, string>,
      skillVersion: string = REVIEW_SKILL_POLICY_REF,
    ): OpenClawResultEnvelope {
      return sealResultEnvelope({
        schemaVersion: 'wiselink.3_1.openclaw_result_envelope.v1',
        actionAttemptId: selectedTask.actionAttemptId,
        operationRef: selectedTask.operationRef,
        taskType: 'OPENCLAW_INTERACTIVE_REVIEW',
        workItemId: selectedTask.workItemId,
        baseRevision: selectedTask.baseRevision,
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
            runtimeAppId: 'app_17c3zn24kv2',
            profileRef: 'wiselink-engineering',
          },
        }),
        outputArtifactRefs: [],
        sourceRefs: [...selectedTask.sourceRefs],
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
    },
  };
}

function actionAttemptRow(task: OpenClawTaskEnvelope): ActionAttemptRow {
  const now = new Date('2026-08-26T10:00:00.000Z');
  return {
    attemptId: task.actionAttemptId,
    operationRef: task.operationRef,
    triggerRequestId: 'REQ-REVIEW-1',
    workItemId: task.workItemId,
    actionType: task.taskType,
    attemptNo: 1,
    status: 'RUNNING',
    requestOrigin: 'OPENCLAW_MCP_V1',
    tenantId: task.tenantId,
    actorUserId: 'actor-1',
    priority: 100,
    inputRevision: task.inputRevision,
    baseRevision: task.baseRevision,
    documentVersionId: task.documentVersionId,
    taskEnvelopeJson: JSON.stringify(task),
    taskInputHash: task.inputHash,
    resultEnvelopeJson: null,
    resultContentHash: null,
    idempotencyKey: task.idempotencyKey,
    claimCount: 1,
    retryCount: 0,
    maxAttempts: 3,
    leaseOwner: 'service:openclaw',
    leaseToken: '00000000-0000-4000-8000-000000000001',
    leaseGeneration: 1,
    leaseExpiresAt: new Date('2099-08-26T10:01:00.000Z'),
    lastHeartbeatAt: now,
    nextAttemptAt: now,
    deadlineAt: new Date('2099-08-26T10:10:00.000Z'),
    cancelRequestedAt: null,
    cancelReason: null,
    terminalReason: null,
    projectionApplied: false,
    executorSessionKey: null,
    commitStartedAt: null,
    leaseSlot: 0,
    startedAt: now,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function verifiedScope() {
  return {
    principalId: 'service:openclaw',
    appId: 'app_17bzc551rsg',
    tenantId: 'tenant-1',
    workItemId: 'WI-1',
    authorizationFingerprint: 'sha256:scope',
  };
}

function parsedWorkItem(): CanonicalWorkItemProjection {
  return {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: 'WI-1',
    requestId: 'WORK-REQ-1',
    revision: 7,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    permissionSnapshotVersion: 'permission-v1',
    parseAuthorization: {
      action: 'PARSE_PDF',
      actorFingerprint: 'actor-fingerprint',
      decisionId: 'decision-1',
      decisionHash: 'decision-hash',
      permissionSnapshotVersion: 'permission-v1',
    },
    source: {
      documentId: 'DOC-1',
      documentVersionId: 'DV-1',
      parserRequestId: 'PARSER-1',
      sourceArtifactId: 'SOURCE-1',
      sourceFileSha256: 'b'.repeat(64),
      sourceByteLength: 100,
      driveFileToken: 'drive-token',
      driveSourceVersion: 'drive-version',
    },
    classification: {
      status: 'CONFIRMED',
      normalizedFamily: 'SB',
      classifierReleaseId: 'classifier',
      classifierReleaseHash: 'classifier-hash',
      parserProfileId: 'parser',
      parserProfileHash: 'parser-hash',
      fingerprint: 'fingerprint',
    },
    package: {
      packageId: 'PKG-1',
      contractId: 'techpub.parsed-package.v1',
      contractRevision: 'frozen.2',
      artifact: {
        storeRole: 'UnifiedArtifactStoreCandidate',
        ref: 'artifact://package',
        sha256: 'a'.repeat(64),
        byteLength: 100,
        mediaType: 'application/json',
      },
      contentHash: 'content-hash',
      semanticHash: 'semantic-hash',
      provenanceHash: 'provenance-hash',
      coverageHash: 'coverage-hash',
      resultStatus: 'complete',
      title: 'Test package',
      contentUnitCount: 1,
      sourceRefCount: 2,
      readerReceiptId: 'receipt-1',
      fullValidatorProof: {
        validatorId: 'U0Frozen2SchemaSemanticValidator',
        validatorRevision: 'validator-v1',
        contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
        artifactSha256: 'a'.repeat(64),
      },
    },
    integratedAssessment: {
      status: 'BASE_RULE_CANDIDATE_READY',
      baseRules: {
        status: 'CANDIDATE_ONLY',
        revision: 1,
        sourceResultId: 'openclaw-dynamic://1',
        criterionSetId: 'RULESET-1',
        criterionCount: 1,
        evaluationItemCount: 1,
        unresolvedCount: 0,
        sourceBoundCandidateCount: 1,
        artifact: {
          storeRole: 'UnifiedArtifactStoreCandidate',
          ref: 'artifact://base',
          sha256: 'c'.repeat(64),
          byteLength: 100,
          mediaType: 'application/json',
        },
        actionAttemptId: 'ATT-BASE-1',
      },
      engineerReviews: null,
      overallSynthesis: null,
      overallForAeoConfirmation: null,
    },
    translation: null,
    assessment: null,
    aeo: null,
    failure: null,
    recordingFailure: null,
  };
}
