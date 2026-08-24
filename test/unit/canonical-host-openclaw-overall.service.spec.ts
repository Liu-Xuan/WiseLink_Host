import type { CanonicalWorkItemProjection } from '@shared/api.interface';

import {
  canonicalJson,
  sealResultEnvelope,
  sealTaskEnvelope,
} from '../../server/modules/action-attempt/action-attempt-envelope';
import type { ActionAttemptRow } from '../../server/modules/action-attempt/action-attempt.types';
import { CanonicalHostOpenClawOverallService } from '../../server/modules/canonical-host/canonical-host-openclaw-overall.service';

const WORK_ITEM_ID = 'WI-OVERALL-REAL';
const ATTEMPT_ID = 'ATT-OVERALL-REAL';
const ATTEMPT_REF = 'AQ-OVERALL-REAL';
const TRIGGER_REF = 'REQ-OVERALL-REAL';
const LEASE_TOKEN = '00000000-0000-4000-8000-000000000002';
const BASE_SHA = 'a'.repeat(64);

describe('CanonicalHostOpenClawOverallService', () => {
  it('rejects before ActionAttempt, WorkItem, or artifact I/O without scope', async () => {
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
    expect(harness.artifactStore.persistAndReadback).not.toHaveBeenCalled();
  });

  it('reserves QUEUED work through the durable lifecycle and returns its lease', async () => {
    const harness = createHarness();
    const begun = await harness.service.begin(WORK_ITEM_ID, []);

    expect(harness.attempts.reserveAndClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: 'OPENCLAW_OVERALL_SYNTHESIS',
        workItemId: WORK_ITEM_ID,
        leaseOwner: 'service:openclaw-real',
        inputRevision: 5,
        baseRevision: 5,
        allowedConnectors: [],
      }),
    );
    expect(begun).toMatchObject({
      attemptRef: ATTEMPT_REF,
      leaseToken: LEASE_TOKEN,
      leaseGeneration: 1,
      selectedDiscoveryRefs: [],
      modelInput: {
        operation: 'SYNTHESIZE_OVERALL_CANDIDATE',
        outputCorrelationRef: TRIGGER_REF,
      },
    });
  });

  it('resumes only the same live principal lease without rebuilding input', async () => {
    const harness = createHarness();
    const resumed = await harness.service.resume(ATTEMPT_REF);

    expect(resumed).toMatchObject({
      attemptRef: ATTEMPT_REF,
      leaseToken: LEASE_TOKEN,
      leaseGeneration: 1,
      modelInput: { outputCorrelationRef: TRIGGER_REF },
    });
    expect(harness.attempts.readScoped).toHaveBeenCalledWith({
      attemptRef: ATTEMPT_REF,
      tenantId: 'tenant-overall',
      workItemId: WORK_ITEM_ID,
    });
    expect(harness.artifactStore.readActualBytes).not.toHaveBeenCalled();
  });

  it('validates ResultEnvelope output, persists bytes, CASes current, then succeeds', async () => {
    const harness = createHarness();
    const result = overallResult();
    const committed = await harness.service.commit(
      ATTEMPT_REF,
      LEASE_TOKEN,
      1,
      result,
    );

    expect(harness.artifactStore.persistAndReadback).toHaveBeenCalledWith(
      new TextEncoder().encode(result.modelOutput!),
    );
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
      status: 'OVERALL_CANDIDATE_READY',
      overallSynthesis: {
        status: 'CANDIDATE_ONLY',
        sourceResultId: TRIGGER_REF,
        basedOnBaseRuleRevision: 1,
        actionAttemptId: ATTEMPT_ID,
      },
    });
  });

  it('reconciles a Host 5xx after CAS from the exact WorkItem projection', async () => {
    const harness = createHarness();
    const overall = {
      status: 'CANDIDATE_ONLY' as const,
      revision: 1,
      sourceResultId: TRIGGER_REF,
      basedOnBaseRuleRevision: 1,
      basedOnBaseRuleArtifactSha256: BASE_SHA,
      basedOnEngineerReviewRevision: null,
      basedOnEngineerReviewArtifactSha256: null,
      discoveryStatus: 'NO_DISCOVERY',
      gap: null,
      candidateRefCount: 0,
      findingCount: 1,
      unresolvedCount: 0,
      authorityLevel: 'candidate_only' as const,
      externalDiscoveryIsEvidence: false as const,
      artifact: artifact('artifact://overall-output', 'c'.repeat(64)),
      actionAttemptId: ATTEMPT_ID,
      staleReason: null,
    };
    harness.workItem.integratedAssessment = {
      ...harness.workItem.integratedAssessment!,
      status: 'OVERALL_CANDIDATE_READY',
      overallSynthesis: overall,
    };
    harness.workItem.revision = 6;
    harness.prepared.row.status = 'COMMITTING';

    await expect(
      harness.service.commit(ATTEMPT_REF, LEASE_TOKEN, 1, overallResult()),
    ).resolves.toMatchObject({ workItemId: WORK_ITEM_ID, workItemRevision: 6 });
    expect(harness.artifactStore.persistAndReadback).not.toHaveBeenCalled();
    expect(harness.registrar.compareAndSet).not.toHaveBeenCalled();
    expect(harness.attempts.finishProjectionSuccess).toHaveBeenCalledTimes(1);
  });

  it('terminalizes stale current as a CAS conflict before artifact persistence', async () => {
    const harness = createHarness();
    harness.workItem.revision = 6;

    await expect(
      harness.service.commit(ATTEMPT_REF, LEASE_TOKEN, 1, overallResult()),
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
  const modelInput = overallModelInput();
  const task = sealTaskEnvelope({
    schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
    actionAttemptId: ATTEMPT_ID,
    operationRef: ATTEMPT_REF,
    taskType: 'OPENCLAW_OVERALL_SYNTHESIS',
    priority: 100,
    tenantId: 'tenant-overall',
    workItemId: WORK_ITEM_ID,
    inputRevision: 5,
    baseRevision: 5,
    documentVersionId: 'DV-737',
    sourceRefs: [
      { ref: 'artifact://package', sha256: 'b'.repeat(64) },
      { ref: 'artifact://base', sha256: BASE_SHA },
    ],
    allowedConnectors: [],
    hostResolvedMissingInputs: [],
    modelInput: {
      modelInput,
      selectedDiscoveryRefs: [],
      providerCodes: [],
    },
    deadline: '2026-08-24T12:00:00.000Z',
    idempotencyKey: 'openclaw-v1:overall:test',
  });
  const row = actionRow(task);
  const prepared = { row, task, result: overallResult(task), recovery: false };
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
    readActualBytes: jest.fn(),
    persistAndReadback: jest.fn(async (bytes: Uint8Array) => ({
      artifact: artifact(
        'artifact://overall-output',
        'c'.repeat(64),
        bytes.byteLength,
      ),
      actualBytes: bytes,
      reused: false,
    })),
  };
  const repository = {
    getDynamicEvaluationActionByAttemptId: jest.fn(async () => ({
      attemptId: 'ATT-BASE',
      workItemId: WORK_ITEM_ID,
      actionType: 'OPENCLAW_DYNAMIC_EVALUATION',
      attemptNo: 4,
      triggerRequestId: 'DYN-RESULT-1',
      requestOrigin: 'OPENCLAW',
      status: 'SUCCEEDED',
      actorUserId: 'service:openclaw-main',
      tenantId: 'tenant-overall',
      createdAt: new Date('2026-08-24T09:00:00.000Z'),
    })),
  };
  const attempts = {
    reserveAndClaim: jest.fn(async () => ({
      attemptRef: ATTEMPT_REF,
      status: 'RUNNING',
      leaseToken: LEASE_TOKEN,
      leaseGeneration: 1,
      leaseExpiresAt: '2026-08-24T11:00:00.000Z',
      task,
      created: true,
      triggerRequestId: TRIGGER_REF,
    })),
    readScoped: jest.fn(async () => ({
      ...row,
      status: 'RUNNING',
      taskEnvelopeJson: canonicalJson(task),
    })),
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
      tenantId: 'tenant-overall',
      workItemId: WORK_ITEM_ID,
      authorizationFingerprint: 'scope:overall-real',
    })),
    authorizeOpenClawAttempt: jest.fn(
      async (input: { attemptRef: string }) => ({
        principalId: 'service:openclaw-real',
        appId: 'app_17bzc551rsg',
        tenantId: 'tenant-overall',
        workItemId: WORK_ITEM_ID,
        attemptRef: input.attemptRef,
        authorizationFingerprint: 'scope:overall-real',
      }),
    ),
  };
  const service = new CanonicalHostOpenClawOverallService(
    registrar as never,
    artifactStore as never,
    repository as never,
    { latestSearchRunsAsOf: jest.fn(async () => []) } as never,
    { prepareDynamicRulesCandidate: jest.fn() } as never,
    {
      modelContext: jest.fn(async () => ({
        revision: null,
        artifactSha256: null,
        reviewCount: 0,
        history: [],
        effective: [],
      })),
    } as never,
    attempts as never,
    scope as never,
  );
  return {
    service,
    workItem,
    prepared,
    registrar,
    artifactStore,
    attempts,
    scope,
  };
}

function workItemProjection(): CanonicalWorkItemProjection {
  return {
    workItemId: WORK_ITEM_ID,
    requestId: 'REQ-OVERALL-WORK',
    revision: 5,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    source: { documentId: 'DOC-737', documentVersionId: 'DV-737' },
    classification: { parserProfileId: 'issuer.boeing.sb' },
    package: {
      packageId: 'PKG-737',
      contractRevision: 'frozen.2',
      contentUnitCount: 1,
      documentIdentity: {
        documentCode: '737-34-3830',
        businessRevision: 'Original Issue',
      },
      artifact: artifact('artifact://package', 'b'.repeat(64)),
    },
    integratedAssessment: {
      status: 'BASE_RULE_CANDIDATE_READY',
      baseRules: {
        status: 'CANDIDATE_ONLY',
        revision: 1,
        sourceResultId: 'openclaw-dynamic://DYN-RESULT-1',
        criterionSetId: 'JACS-ONE',
        criterionCount: 1,
        evaluationItemCount: 1,
        unresolvedCount: 0,
        sourceBoundCandidateCount: 1,
        artifact: artifact('artifact://base', BASE_SHA),
        actionAttemptId: 'ATT-BASE',
      },
      overallSynthesis: null,
      overallForAeoConfirmation: null,
    },
  } as unknown as CanonicalWorkItemProjection;
}

function overallModelInput() {
  return {
    operation: 'SYNTHESIZE_OVERALL_CANDIDATE' as const,
    outputCorrelationRef: TRIGGER_REF,
    baseRuleResult: {
      sourceResultId: 'openclaw-dynamic://DYN-RESULT-1',
      revision: 1,
      artifactSha256: `sha256:${BASE_SHA}`,
      documentVersionId: 'DV-737',
      packageId: 'PKG-737',
      packageArtifactSha256: `sha256:${'b'.repeat(64)}`,
      criterionSetId: 'JACS-ONE',
      criterionCount: 1,
      evaluationItemCount: 1,
      unresolvedCount: 0,
      sourceBoundCandidateCount: 1,
      items: [],
    },
    unifiedSourceContext: {
      documentVersionId: 'DV-737',
      packageId: 'PKG-737',
      packageArtifactSha256: `sha256:${'b'.repeat(64)}`,
      contractRevision: 'frozen.2',
      contentUnitCount: 1,
      sourceRefCount: 1,
      sourceRefs: [
        { sourceRefId: 'SRC-001', locator: 'page 1-1', excerpt: null },
      ],
    },
    adoptedDocumentVersions: [],
    externalDiscoveryResults: [],
    engineerReviewContext: {
      revision: null,
      artifactSha256: null,
      reviewCount: 0,
      history: [],
      effective: [],
    },
  };
}

function overallResult(
  task = sealTaskEnvelope({
    schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
    actionAttemptId: ATTEMPT_ID,
    operationRef: ATTEMPT_REF,
    taskType: 'OPENCLAW_OVERALL_SYNTHESIS',
    priority: 100,
    tenantId: 'tenant-overall',
    workItemId: WORK_ITEM_ID,
    inputRevision: 5,
    baseRevision: 5,
    documentVersionId: 'DV-737',
    sourceRefs: [
      { ref: 'artifact://package', sha256: 'b'.repeat(64) },
      { ref: 'artifact://base', sha256: BASE_SHA },
    ],
    allowedConnectors: [],
    hostResolvedMissingInputs: [],
    modelInput: {
      modelInput: overallModelInput(),
      selectedDiscoveryRefs: [],
      providerCodes: [],
    },
    deadline: '2026-08-24T12:00:00.000Z',
    idempotencyKey: 'openclaw-v1:overall:test',
  }),
) {
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
    modelOutput: validOutput(),
    outputArtifactRefs: [],
    sourceRefs: [...task.sourceRefs],
    factsConsidered: [],
    missingInputs: [],
    conflicts: [],
    warnings: [],
    modelVersion: 'openclaw-real',
    promptVersion: 'overall-prompt-v1',
    skillVersion: 'overall-skill-v1',
    toolVersions: { host: '006146b' },
    runMetrics: { durationMs: 1, inputUnits: 1, outputUnits: 1 },
    errorCode: null,
    errorDetail: null,
  });
}

function validOutput(): string {
  return JSON.stringify({
    sourceResultId: TRIGGER_REF,
    documentVersionId: 'DV-737',
    packageId: 'PKG-737',
    baseRuleRevision: 1,
    baseRuleArtifactSha256: `sha256:${BASE_SHA}`,
    engineerReviewRevision: null,
    engineerReviewArtifactSha256: null,
    discoveryStatus: 'NO_DISCOVERY',
    gap: null,
    candidateRefCount: 0,
    findingCount: 1,
    unresolvedCount: 0,
    authorityLevel: 'candidate_only',
    externalDiscoveryIsEvidence: false,
    overallCandidate: '候选综合：仍需工程师复核。',
    findings: [
      {
        finding: '候选发现',
        basis: '来源定位 SRC-001',
        sourceRefIds: ['SRC-001'],
        assumptions: [],
        uncertainty: '需工程师复核',
      },
    ],
    missingInputs: [],
    applicabilityStatus: 'CANDIDATE_REVIEW_REQUIRED',
    engineeringReviewRequired: true,
    adopted: false,
    usableAsEvidence: false,
    providers: {},
  });
}

function actionRow(
  task: ReturnType<typeof sealTaskEnvelope>,
): ActionAttemptRow {
  const now = new Date('2026-08-24T10:00:00.000Z');
  return {
    attemptId: ATTEMPT_ID,
    operationRef: ATTEMPT_REF,
    triggerRequestId: TRIGGER_REF,
    workItemId: WORK_ITEM_ID,
    actionType: 'OPENCLAW_OVERALL_SYNTHESIS',
    attemptNo: 1,
    status: 'COMMITTING',
    requestOrigin: 'OPENCLAW_MCP_V1',
    tenantId: 'tenant-overall',
    actorUserId: 'service:openclaw-main',
    priority: 100,
    inputRevision: 5,
    baseRevision: 5,
    documentVersionId: 'DV-737',
    taskEnvelopeJson: canonicalJson(task),
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

function artifact(ref: string, sha256: string, byteLength = 1) {
  return {
    storeRole: 'UnifiedArtifactStoreCandidate' as const,
    ref,
    sha256,
    byteLength,
    mediaType: 'application/json' as const,
  };
}
