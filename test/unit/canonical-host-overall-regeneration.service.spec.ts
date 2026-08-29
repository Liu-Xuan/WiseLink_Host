import type {
  CanonicalOverallRegenerationSourceIdentity,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import {
  canonicalJson,
  sealTaskEnvelope,
} from '../../server/modules/action-attempt/action-attempt-envelope';
import type { ActionAttemptRow } from '../../server/modules/action-attempt/action-attempt.types';
import { CanonicalHostOverallRegenerationService } from '../../server/modules/canonical-host/canonical-host-overall-regeneration.service';

const SOURCE_DIGEST = '1'.repeat(64);
const PACKAGE_DIGEST = '2'.repeat(64);
const SOURCE_IDENTITY: CanonicalOverallRegenerationSourceIdentity = {
  documentVersionId: 'DV-1',
  sourceArtifactId: 'SRC-ART-1',
  sourceFileSha256: SOURCE_DIGEST,
  packageId: 'PKG-1',
  packageArtifactSha256: PACKAGE_DIGEST,
};

describe('CanonicalHostOverallRegenerationService', () => {
  it('marks a legacy current overall stale, queues the existing runtime once, and replays requestId', async () => {
    const harness = serviceHarness();
    const input = {
      requestId: 'REQ-USER-REGEN-1',
      expectedRevision: 12,
      sourceIdentity: {
        ...SOURCE_IDENTITY,
        sourceFileSha256: `sha256:${SOURCE_DIGEST}`,
        packageArtifactSha256: `sha256:${PACKAGE_DIGEST}`,
      },
    };

    const first = await harness.service.request('WI-1', input, {} as never);

    expect(first).toMatchObject({
      replayed: false,
      regeneration: {
        requestId: 'REQ-USER-REGEN-1',
        requestedFromRevision: 12,
        executionRevision: 13,
        currentWorkItemRevision: 13,
        staleReason: 'USER_REQUESTED_REGENERATION',
        status: 'QUEUED',
        attemptRef: 'AQ-OVERALL-REGEN-1',
        authority: {
          candidateOnly: true,
          reviewActionCreated: false,
          engineeringApprovalChanged: false,
          documentCurrentnessChanged: false,
        },
      },
    });
    expect(harness.current.overallRegenerationRequest).toMatchObject({
      requestedByUserId: 'USER-1',
      sourceIdentity: SOURCE_IDENTITY,
      sourceOverall: { artifactSha256: '6'.repeat(64) },
    });
    expect(harness.current.integratedAssessment).toMatchObject({
      status: 'OVERALL_CANDIDATE_STALE',
      overallSynthesis: {
        revision: 1,
        status: 'STALE',
        staleReason: null,
      },
      overallForAeoConfirmation: null,
    });
    expect(
      harness.current.integratedAssessment?.overallSynthesis
        ?.engineeringSummary,
    ).toBeUndefined();
    expect(harness.current.aeo).toBeNull();
    expect(
      harness.overall.enqueueUserRequestedRegeneration,
    ).toHaveBeenCalledTimes(1);

    const polled = await harness.service.status(
      'WI-1',
      input.requestId,
      {} as never,
    );
    for (const browserModel of [first.regeneration, polled]) {
      const browserJson = JSON.stringify(browserModel);
      for (const forbidden of [
        'requestedByUserId',
        'sourceIdentity',
        'tenantId',
        'USER-1',
        'TENANT-1',
        'DV-1',
        'SRC-ART-1',
        'PKG-1',
        SOURCE_DIGEST,
        PACKAGE_DIGEST,
        'leaseToken',
        'taskEnvelopeJson',
        'modelInput',
      ]) {
        expect(browserJson).not.toContain(forbidden);
      }
    }

    const replay = await harness.service.request(
      'WI-1',
      { ...input, sourceIdentity: SOURCE_IDENTITY },
      {} as never,
    );
    expect(replay.replayed).toBe(true);
    expect(replay.regeneration.attemptRef).toBe('AQ-OVERALL-REGEN-1');
    expect(
      harness.overall.enqueueUserRequestedRegeneration,
    ).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale revision before CAS or ActionAttempt reservation', async () => {
    const harness = serviceHarness();

    await expect(
      harness.service.request(
        'WI-1',
        {
          requestId: 'REQ-STALE',
          expectedRevision: 11,
          sourceIdentity: SOURCE_IDENTITY,
        },
        {} as never,
      ),
    ).rejects.toMatchObject({ code: 'WORK_ITEM_CAS_CONFLICT' });
    expect(harness.registrar.compareAndSet).not.toHaveBeenCalled();
    expect(
      harness.overall.enqueueUserRequestedRegeneration,
    ).not.toHaveBeenCalled();
  });

  it('fails a non-owner fresh-read before WorkItem or queue mutation', async () => {
    const harness = serviceHarness({ denyAccess: true });

    await expect(
      harness.service.request(
        'WI-1',
        {
          requestId: 'REQ-WRONG-ACTOR',
          expectedRevision: 12,
          sourceIdentity: SOURCE_IDENTITY,
        },
        {} as never,
      ),
    ).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
    expect(
      harness.registrar.getTenantScopedByWorkItemId,
    ).not.toHaveBeenCalled();
    expect(harness.registrar.compareAndSet).not.toHaveBeenCalled();
    expect(
      harness.overall.enqueueUserRequestedRegeneration,
    ).not.toHaveBeenCalled();
  });
});

function serviceHarness(options: { denyAccess?: boolean } = {}) {
  let current = legacyWorkItem();
  let queued = false;
  const sessions = {
    resolve: jest.fn().mockResolvedValue({
      actor: {
        tenantId: 'TENANT-1',
        canonicalSubject: { id: 'USER-1' },
      },
    }),
  };
  const objectAccess = {
    freshRead: jest.fn(async () =>
      options.denyAccess
        ? {
            allowed: false,
            code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
            statusCode: 404,
          }
        : {
            allowed: true,
            action: 'REQUEST_OVERALL_REGENERATION',
            workItemId: current.workItemId,
            workItemRevision: current.revision,
            requestId: current.requestId,
            documentVersionId: current.source.documentVersionId,
            tenantId: 'TENANT-1',
            actorUserId: 'USER-1',
            authorizationFingerprint: `AUTH-${current.revision}`,
          },
    ),
  };
  const registrar = {
    getTenantScopedByWorkItemId: jest.fn(async () => current),
    compareAndSet: jest.fn(
      async (input: {
        expectedRevision: number;
        next: Omit<CanonicalWorkItemProjection, 'revision'>;
      }) => {
        if (input.expectedRevision !== current.revision) {
          throw new Error('WORK_ITEM_CAS_CONFLICT');
        }
        current = { ...input.next, revision: current.revision + 1 };
        return current;
      },
    ),
  };
  const clock = { nowIso: jest.fn(() => '2026-08-29T05:00:00.000Z') };
  const overall = {
    enqueueUserRequestedRegeneration: jest.fn(async () => {
      queued = true;
      return { attemptRef: 'AQ-OVERALL-REGEN-1', created: true };
    }),
  };
  const attempts = {
    readExactIdempotency: jest.fn(async () =>
      queued ? queuedAttempt(current.revision) : null,
    ),
  };
  const service = new CanonicalHostOverallRegenerationService(
    sessions as never,
    objectAccess as never,
    registrar as never,
    clock as never,
    overall as never,
    attempts as never,
  );
  return {
    service,
    sessions,
    objectAccess,
    registrar,
    overall,
    attempts,
    get current() {
      return current;
    },
  };
}

function legacyWorkItem(): CanonicalWorkItemProjection {
  return {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: 'WI-1',
    requestId: 'REQ-PARSE-1',
    revision: 12,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    permissionSnapshotVersion: 'AUTH-12',
    parseAuthorization: {
      action: 'PARSE_PDF',
      actorFingerprint: 'ACTOR-1',
      decisionId: 'DECISION-1',
      decisionHash: 'sha256:decision',
      permissionSnapshotVersion: 'AUTH-12',
    },
    source: {
      documentId: 'DOC-1',
      documentVersionId: SOURCE_IDENTITY.documentVersionId,
      parserRequestId: 'REQ-PARSER-1',
      sourceArtifactId: SOURCE_IDENTITY.sourceArtifactId,
      sourceFileSha256: `sha256:${SOURCE_DIGEST}`,
      sourceByteLength: 100,
      driveFileToken: 'DRIVE-1',
      driveSourceVersion: '1',
    },
    classification: {
      status: 'CONFIRMED',
      normalizedFamily: 'SB',
      classifierReleaseId: 'CLASSIFIER-1',
      classifierReleaseHash: '3'.repeat(64),
      parserProfileId: 'boeing-sb',
      parserProfileHash: '4'.repeat(64),
      fingerprint: 'CLASSIFICATION-1',
    },
    package: {
      packageId: SOURCE_IDENTITY.packageId,
      contractId: 'techpub.parsed-package.v1',
      contractRevision: 'frozen.2',
      artifact: artifact(
        'artifact://package',
        SOURCE_IDENTITY.packageArtifactSha256,
      ),
      contentHash: 'content',
      semanticHash: 'semantic',
      provenanceHash: 'provenance',
      coverageHash: 'coverage',
      resultStatus: 'complete',
      title: 'Legacy SB',
      contentUnitCount: 2,
      sourceRefCount: 2,
      readerReceiptId: 'RECEIPT-1',
      fullValidatorProof: {
        validatorId: 'U0Frozen2SchemaSemanticValidator',
        validatorRevision: '1',
        contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
        artifactSha256: SOURCE_IDENTITY.packageArtifactSha256,
      },
    },
    integratedAssessment: {
      status: 'OVERALL_CANDIDATE_READY',
      baseRules: {
        status: 'CANDIDATE_ONLY',
        revision: 1,
        sourceResultId: 'openclaw-dynamic://REQ-DYNAMIC-1',
        criterionSetId: 'JACS-TWO',
        criterionCount: 2,
        evaluationItemCount: 2,
        unresolvedCount: 0,
        sourceBoundCandidateCount: 2,
        artifact: artifact('artifact://base', '5'.repeat(64)),
        actionAttemptId: 'ATT-DYNAMIC-1',
      },
      engineerReviews: null,
      overallSynthesis: {
        status: 'CANDIDATE_ONLY',
        revision: 1,
        sourceResultId: 'openclaw-overall://REQ-OVERALL-1',
        basedOnBaseRuleRevision: 1,
        basedOnBaseRuleArtifactSha256: '5'.repeat(64),
        basedOnEngineerReviewRevision: null,
        basedOnEngineerReviewArtifactSha256: null,
        discoveryStatus: 'NO_DISCOVERY',
        gap: null,
        candidateRefCount: 0,
        findingCount: 1,
        unresolvedCount: 0,
        authorityLevel: 'candidate_only',
        externalDiscoveryIsEvidence: false,
        artifact: artifact('artifact://overall-r1', '6'.repeat(64)),
        actionAttemptId: 'ATT-OVERALL-1',
        staleReason: null,
        overallCandidate: '旧摘要',
      },
      overallForAeoConfirmation: {
        status: 'HUMAN_CONFIRMED',
        authority: 'CANONICAL_WORKITEM_SERVER_FRESH_READ',
        workItemRevision: 12,
        overallRevision: 1,
        overallArtifactRef: 'artifact://overall-r1',
        overallArtifactSha256: '6'.repeat(64),
        actionAttemptId: 'ATT-CONFIRM-1',
        confirmingActorUserId: 'USER-1',
        confirmedAt: '2026-08-28T00:00:00.000Z',
      },
    },
    aeo: null,
    failure: null,
    recordingFailure: null,
  };
}

function queuedAttempt(baseRevision: number): ActionAttemptRow {
  const task = sealTaskEnvelope({
    schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
    actionAttemptId: 'ATT-OVERALL-REGEN-1',
    operationRef: 'AQ-OVERALL-REGEN-1',
    taskType: 'OPENCLAW_OVERALL_SYNTHESIS',
    priority: 100,
    tenantId: 'TENANT-1',
    workItemId: 'WI-1',
    inputRevision: baseRevision,
    baseRevision,
    documentVersionId: SOURCE_IDENTITY.documentVersionId,
    sourceRefs: [],
    allowedConnectors: [],
    hostResolvedMissingInputs: [],
    modelInput: { operation: 'SYNTHESIZE_OVERALL_CANDIDATE' },
    deadline: '2026-08-29T06:00:00.000Z',
    idempotencyKey:
      `openclaw-v1:overall:WI-1:${baseRevision}:` +
      'USER_REQUESTED_REGENERATION:REQ-USER-REGEN-1',
  });
  const now = new Date('2026-08-29T05:00:00.000Z');
  return {
    attemptId: task.actionAttemptId,
    operationRef: task.operationRef,
    triggerRequestId: 'REQ-ATTEMPT-1',
    workItemId: task.workItemId,
    actionType: task.taskType,
    attemptNo: 2,
    status: 'QUEUED',
    requestOrigin: 'OPENCLAW_MCP_V1',
    tenantId: task.tenantId,
    actorUserId: 'service:openclaw-main',
    priority: task.priority,
    inputRevision: task.inputRevision,
    baseRevision: task.baseRevision,
    documentVersionId: task.documentVersionId,
    taskEnvelopeJson: canonicalJson(task),
    taskInputHash: task.inputHash,
    resultEnvelopeJson: null,
    resultContentHash: null,
    idempotencyKey: task.idempotencyKey,
    claimCount: 0,
    retryCount: 0,
    maxAttempts: 3,
    leaseOwner: null,
    leaseToken: null,
    leaseGeneration: 0,
    leaseExpiresAt: null,
    lastHeartbeatAt: null,
    nextAttemptAt: now,
    deadlineAt: new Date(task.deadline),
    cancelRequestedAt: null,
    cancelReason: null,
    terminalReason: null,
    projectionApplied: false,
    executorSessionKey: null,
    commitStartedAt: null,
    leaseSlot: null,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function artifact(ref: string, sha256: string) {
  return {
    storeRole: 'UnifiedArtifactStoreCandidate' as const,
    ref,
    sha256,
    byteLength: 100,
    mediaType: 'application/json' as const,
  };
}
