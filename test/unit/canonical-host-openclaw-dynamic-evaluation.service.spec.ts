import type { CanonicalWorkItemProjection } from '@shared/api.interface';

import {
  sealResultEnvelope,
  sealTaskEnvelope,
} from '../../server/modules/action-attempt/action-attempt-envelope';
import type { ActionAttemptRow } from '../../server/modules/action-attempt/action-attempt.types';
import { CanonicalHostOpenClawDynamicEvaluationService } from '../../server/modules/canonical-host/canonical-host-openclaw-dynamic-evaluation.service';

const WORK_ITEM_ID = 'WI-DYNAMIC-150';
const ATTEMPT_ID = 'ATT-DYNAMIC-REAL';
const ATTEMPT_REF = 'AQ-DYNAMIC-REAL';
const LEASE_TOKEN = '00000000-0000-4000-8000-000000000001';

describe('CanonicalHostOpenClawDynamicEvaluationService', () => {
  it('rejects before ActionAttempt or WorkItem I/O when service scope is absent', async () => {
    const harness = createHarness();
    harness.scope.authorizeOpenClawAttempt.mockRejectedValueOnce(
      Object.assign(new Error('scope unavailable'), {
        code: 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE',
        statusCode: 503,
      }),
    );

    await expect(
      harness.service.commit(ATTEMPT_REF, LEASE_TOKEN, 1, {}),
    ).rejects.toMatchObject({
      code: 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE',
      statusCode: 503,
    });
    expect(harness.attempts.prepareCommit).not.toHaveBeenCalled();
    expect(
      harness.registrar.getTenantScopedByWorkItemId,
    ).not.toHaveBeenCalled();
    expect(harness.artifactStore.persistAndReadback).not.toHaveBeenCalled();
  });

  it('uses the durable queue claim and returns its exact fencing lease', async () => {
    const harness = createHarness();
    const begun = await harness.service.begin(WORK_ITEM_ID);

    expect(harness.attempts.reserveAndClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: WORK_ITEM_ID,
        taskType: 'OPENCLAW_DYNAMIC_EVALUATION',
        leaseOwner: 'service:openclaw-real',
        inputRevision: 5,
        baseRevision: 5,
      }),
    );
    expect(begun).toMatchObject({
      attemptRef: ATTEMPT_REF,
      status: 'RUNNING',
      leaseToken: LEASE_TOKEN,
      leaseGeneration: 1,
      modelInput: { purpose: 'EVALUATE_DYNAMIC_RULES' },
    });
    expect(harness.processor.buildRequest.mock.calls[0][2]).toMatchObject({
      expectedRevision: 5,
    });
  });

  it('consumes only ResultEnvelope.modelOutput, persists actual bytes, CASes, then finalizes', async () => {
    const harness = createHarness();
    const result = dynamicResult();
    const committed = await harness.service.commit(
      ATTEMPT_REF,
      LEASE_TOKEN,
      1,
      result,
    );

    expect(harness.attempts.prepareCommit).toHaveBeenCalledWith({
      attemptRef: ATTEMPT_REF,
      tenantId: 'tenant-dynamic',
      workItemId: WORK_ITEM_ID,
      principalId: 'service:openclaw-real',
      leaseToken: LEASE_TOKEN,
      leaseGeneration: 1,
      result,
    });
    expect(harness.processor.consumeOutput).toHaveBeenCalledWith(
      expect.any(Object),
      result.modelOutput,
    );
    expect(harness.artifactStore.persistAndReadback).toHaveBeenCalledTimes(1);
    expect(harness.registrar.compareAndSet).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: WORK_ITEM_ID,
        expectedRevision: 5,
        syncPrimaryAttempt: false,
      }),
    );
    expect(harness.attempts.finishProjectionSuccess).toHaveBeenCalledTimes(1);
    expect(committed).toMatchObject({
      workItemId: WORK_ITEM_ID,
      workItemRevision: 6,
      status: 'BASE_RULE_CANDIDATE_READY',
      baseRules: {
        criterionCount: 2,
        evaluationItemCount: 2,
        actionAttemptId: ATTEMPT_ID,
      },
    });
  });

  it('fails closed if a rebuilt private request drifts from the sealed TaskEnvelope input', async () => {
    const harness = createHarness();
    harness.prepared.task.modelInput = {
      purpose: 'EVALUATE_DYNAMIC_RULES',
      expectedSelfCheck: { criterionSetId: 'DRIFTED' },
    };

    await expect(
      harness.service.commit(ATTEMPT_REF, LEASE_TOKEN, 1, dynamicResult()),
    ).resolves.toMatchObject({
      status: 'FAILED',
      projectionApplied: false,
      terminalReason: 'HOST_RESULT_GATE_REJECTED',
    });
    expect(harness.attempts.finishResultGateFailure).toHaveBeenCalledWith(
      harness.prepared,
      expect.objectContaining({
        message: 'DYNAMIC_EVALUATION_TASK_MODEL_INPUT_DRIFT',
      }),
    );
    expect(harness.processor.consumeOutput).not.toHaveBeenCalled();
    expect(harness.artifactStore.persistAndReadback).not.toHaveBeenCalled();
    expect(harness.registrar.compareAndSet).not.toHaveBeenCalled();
  });

  it('reconciles a post-CAS 5xx replay from the WorkItem projection', async () => {
    const harness = createHarness();
    const result = dynamicResult();
    harness.workItem.integratedAssessment = {
      status: 'BASE_RULE_CANDIDATE_READY',
      baseRules: {
        status: 'CANDIDATE_ONLY',
        revision: 1,
        sourceResultId: 'openclaw-dynamic://REQ-DYNAMIC-REAL',
        criterionSetId: 'JACS-DYNAMIC-2',
        criterionCount: 2,
        evaluationItemCount: 2,
        unresolvedCount: 1,
        sourceBoundCandidateCount: 2,
        artifact: artifact('artifact://dynamic-output'),
        actionAttemptId: ATTEMPT_ID,
      },
      engineerReviews: null,
      overallSynthesis: null,
      overallForAeoConfirmation: null,
    };
    harness.workItem.revision = 6;
    harness.prepared.row.status = 'COMMITTING';

    await expect(
      harness.service.commit(ATTEMPT_REF, LEASE_TOKEN, 1, result),
    ).resolves.toMatchObject({ workItemId: WORK_ITEM_ID, workItemRevision: 6 });
    expect(harness.artifactStore.persistAndReadback).not.toHaveBeenCalled();
    expect(harness.registrar.compareAndSet).not.toHaveBeenCalled();
    expect(harness.attempts.finishProjectionSuccess).toHaveBeenCalledTimes(1);
  });

  it('terminalizes a CAS race without a second projection write', async () => {
    const harness = createHarness();
    harness.workItem.revision = 6;

    await expect(
      harness.service.commit(ATTEMPT_REF, LEASE_TOKEN, 1, dynamicResult()),
    ).rejects.toThrow('WORK_ITEM_CAS_CONFLICT');
    expect(harness.attempts.finishProjectionConflict).toHaveBeenCalledWith({
      prepared: harness.prepared,
      currentRevision: 6,
    });
    expect(harness.artifactStore.persistAndReadback).not.toHaveBeenCalled();
  });
});

function createHarness() {
  const workItem = workItemProjection();
  const task = taskEnvelope(workItem);
  const row = actionRow(task);
  const prepared = { row, task, result: dynamicResult(task), recovery: false };
  const registrar = {
    getTenantScopedByWorkItemId: jest.fn(async () => workItem),
    compareAndSet: jest.fn(
      async (input: {
        expectedRevision: number;
        next: Omit<CanonicalWorkItemProjection, 'revision'>;
      }) => ({ ...input.next, revision: input.expectedRevision + 1 }),
    ),
  };
  const artifactStore = {
    persistAndReadback: jest.fn(async (bytes: Uint8Array) => ({
      artifact: artifact('artifact://dynamic-output', bytes.byteLength),
      actualBytes: bytes,
      reused: false,
    })),
  };
  const assessment = {
    prepareDynamicRulesCandidate: jest.fn(async () => ({
      dynamicRulesInput: {},
      overall: { transport: {} },
    })),
  };
  const processor = {
    buildRequest: jest.fn(() => ({
      privateEnvelope: {
        callerCorrelationRef: 'REQ-DYNAMIC-REAL',
        correlation: {},
      },
      modelInput: {
        purpose: 'EVALUATE_DYNAMIC_RULES',
        expectedSelfCheck: { criterionSetId: 'JACS-DYNAMIC-2' },
      },
    })),
    consumeOutput: jest.fn(() => ({
      ruleResults: [{ sourceRefs: ['SRC-1'] }, { sourceRefs: ['SRC-2'] }],
      overallSelfCheck: { rulesWithMissingInputs: 1 },
      criterionCount: 2,
    })),
  };
  const attempts = {
    reserveAndClaim: jest.fn(
      async (input: {
        buildModelInput(
          identity: Record<string, unknown>,
        ): Promise<Record<string, unknown>>;
      }) => {
        const modelInput = await input.buildModelInput({
          attemptId: ATTEMPT_ID,
          operationRef: ATTEMPT_REF,
          triggerRequestId: 'REQ-DYNAMIC-REAL',
          attemptNo: 1,
          createdAt: new Date('2026-08-24T10:00:00.000Z'),
        });
        return {
          attemptRef: ATTEMPT_REF,
          status: 'RUNNING',
          leaseToken: LEASE_TOKEN,
          leaseGeneration: 1,
          leaseExpiresAt: '2026-08-24T11:00:00.000Z',
          task: { ...task, modelInput },
          created: true,
          triggerRequestId: 'REQ-DYNAMIC-REAL',
        };
      },
    ),
    prepareCommit: jest.fn(async () => prepared),
    finishProjectionSuccess: jest.fn(async () => ({
      attemptRef: ATTEMPT_REF,
      status: 'SUCCEEDED',
      projectionApplied: true,
      terminalReason: 'PROJECTION_CAS_APPLIED',
    })),
    finishProjectionConflict: jest.fn(),
    finishResultGateFailure: jest.fn(async () => ({
      attemptRef: ATTEMPT_REF,
      status: 'FAILED',
      projectionApplied: false,
      terminalReason: 'HOST_RESULT_GATE_REJECTED',
    })),
  };
  const scope = {
    authorizeOpenClawWorkItem: jest.fn(async () => ({
      principalId: 'service:openclaw-real',
      appId: 'app_17bzc551rsg',
      tenantId: 'tenant-dynamic',
      workItemId: WORK_ITEM_ID,
      authorizationFingerprint: 'scope:dynamic-real',
    })),
    authorizeOpenClawAttempt: jest.fn(async () => ({
      principalId: 'service:openclaw-real',
      appId: 'app_17bzc551rsg',
      tenantId: 'tenant-dynamic',
      workItemId: WORK_ITEM_ID,
      attemptRef: ATTEMPT_REF,
      authorizationFingerprint: 'scope:dynamic-real',
    })),
  };
  const service = new CanonicalHostOpenClawDynamicEvaluationService(
    registrar as never,
    artifactStore as never,
    assessment as never,
    processor as never,
    { assertLedgerCompatibleWithDynamicBytes: jest.fn() } as never,
    attempts as never,
    scope as never,
  );
  return {
    service,
    workItem,
    prepared,
    registrar,
    artifactStore,
    processor,
    attempts,
    scope,
  };
}

function workItemProjection(): CanonicalWorkItemProjection {
  return {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: WORK_ITEM_ID,
    requestId: 'REQ-WORK-ITEM',
    revision: 5,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    permissionSnapshotVersion: 'permission-dynamic',
    parseAuthorization: {
      action: 'PARSE_PDF',
      actorFingerprint: 'actor',
      decisionId: 'decision',
      decisionHash: 'decision-hash',
      permissionSnapshotVersion: 'permission-dynamic',
    },
    source: {
      documentId: 'DOC-DYNAMIC',
      documentVersionId: 'DV-DYNAMIC',
      parserRequestId: 'PARSER-REQ',
      sourceArtifactId: 'SOURCE-ARTIFACT',
      sourceFileSha256: 'b'.repeat(64),
      sourceByteLength: 100,
      driveFileToken: 'drive-token',
      driveSourceVersion: '1',
    },
    classification: {
      status: 'CONFIRMED',
      normalizedFamily: 'SB',
      classifierReleaseId: 'classifier',
      classifierReleaseHash: 'hash',
      parserProfileId: 'issuer.boeing',
      parserProfileHash: 'profile-hash',
      fingerprint: 'fingerprint',
    },
    package: {
      packageId: 'PKG-DYNAMIC',
      contractId: 'techpub.parsed-package.v1',
      contractRevision: 'frozen.2',
      artifact: artifact('artifact://package'),
      contentHash: 'c'.repeat(64),
      semanticHash: 'd'.repeat(64),
      provenanceHash: 'e'.repeat(64),
      coverageHash: 'f'.repeat(64),
      resultStatus: 'complete',
      title: 'Dynamic test',
      contentUnitCount: 2,
      sourceRefCount: 2,
      readerReceiptId: 'reader-receipt',
      fullValidatorProof: {
        validatorId: 'U0Frozen2SchemaSemanticValidator',
        validatorRevision: 'v1',
        contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
        artifactSha256: 'a'.repeat(64),
      },
    },
    integratedAssessment: null,
    failure: null,
    recordingFailure: null,
  };
}

function taskEnvelope(workItem: CanonicalWorkItemProjection) {
  return sealTaskEnvelope({
    schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
    actionAttemptId: ATTEMPT_ID,
    operationRef: ATTEMPT_REF,
    taskType: 'OPENCLAW_DYNAMIC_EVALUATION',
    priority: 100,
    tenantId: 'tenant-dynamic',
    workItemId: WORK_ITEM_ID,
    inputRevision: 5,
    baseRevision: 5,
    documentVersionId: workItem.source.documentVersionId,
    sourceRefs: [
      {
        ref: workItem.package!.artifact.ref,
        sha256: workItem.package!.artifact.sha256,
      },
    ],
    allowedConnectors: [],
    hostResolvedMissingInputs: [],
    modelInput: {
      purpose: 'EVALUATE_DYNAMIC_RULES',
      expectedSelfCheck: { criterionSetId: 'JACS-DYNAMIC-2' },
    },
    deadline: '2026-08-24T12:00:00.000Z',
    idempotencyKey: 'openclaw-v1:dynamic:test',
  });
}

function dynamicResult(task = taskEnvelope(workItemProjection())) {
  return sealResultEnvelope({
    schemaVersion: 'wiselink.3_1.openclaw_result_envelope.v1',
    actionAttemptId: task.actionAttemptId,
    operationRef: task.operationRef,
    taskType: task.taskType,
    workItemId: task.workItemId,
    baseRevision: task.baseRevision,
    status: 'SUCCEEDED',
    businessOutcome: 'CANDIDATE_READY',
    candidateStatus: null,
    modelOutput: JSON.stringify({ callerCorrelationRef: 'REQ-DYNAMIC-REAL' }),
    outputArtifactRefs: [],
    sourceRefs: [...task.sourceRefs],
    factsConsidered: [],
    missingInputs: [],
    conflicts: [],
    warnings: [],
    modelVersion: 'openclaw-real',
    promptVersion: 'dynamic-prompt-v1',
    skillVersion: 'dynamic-skill-v1',
    toolVersions: { host: '006146b' },
    runMetrics: { durationMs: 1, inputUnits: 1, outputUnits: 1 },
    errorCode: null,
    errorDetail: null,
  });
}

function actionRow(task: ReturnType<typeof taskEnvelope>): ActionAttemptRow {
  const now = new Date('2026-08-24T10:00:00.000Z');
  return {
    attemptId: ATTEMPT_ID,
    operationRef: ATTEMPT_REF,
    triggerRequestId: 'REQ-DYNAMIC-REAL',
    workItemId: WORK_ITEM_ID,
    actionType: 'OPENCLAW_DYNAMIC_EVALUATION',
    attemptNo: 1,
    status: 'COMMITTING',
    requestOrigin: 'OPENCLAW_MCP_V1',
    tenantId: 'tenant-dynamic',
    actorUserId: 'service:openclaw-main',
    priority: 100,
    inputRevision: 5,
    baseRevision: 5,
    documentVersionId: 'DV-DYNAMIC',
    taskEnvelopeJson: JSON.stringify(task),
    taskInputHash: task.inputHash,
    resultEnvelopeJson: null,
    resultContentHash: null,
    idempotencyKey: task.idempotencyKey,
    claimCount: 1,
    retryCount: 0,
    maxAttempts: 3,
    leaseOwner: 'service:openclaw-real',
    leaseToken: LEASE_TOKEN,
    leaseGeneration: 1,
    leaseExpiresAt: new Date('2026-08-24T11:00:00.000Z'),
    lastHeartbeatAt: now,
    nextAttemptAt: null,
    deadlineAt: new Date(task.deadline),
    cancelRequestedAt: null,
    cancelReason: null,
    terminalReason: null,
    projectionApplied: false,
    executorSessionKey: null,
    commitStartedAt: now,
    leaseSlot: 0,
    startedAt: now,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function artifact(ref: string, byteLength = 100) {
  return {
    storeRole: 'UnifiedArtifactStoreCandidate' as const,
    ref,
    sha256: 'a'.repeat(64),
    byteLength,
    mediaType: 'application/json' as const,
  };
}
