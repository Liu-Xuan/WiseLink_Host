import type { CanonicalWorkItemProjection } from '@shared/api.interface';

import {
  canonicalJson,
  sealResultEnvelope,
  sealTaskEnvelope,
} from '../../server/modules/action-attempt/action-attempt-envelope';
import type { ActionAttemptRow } from '../../server/modules/action-attempt/action-attempt.types';
import { CanonicalHostOpenClawOverallService } from '../../server/modules/canonical-host/canonical-host-openclaw-overall.service';
import { CANONICAL_HOST_OPENCLAW_RUNTIME_POLICY } from '../../server/modules/canonical-host/canonical-host-openclaw-runtime-policy';
import { createConfigurationEvidenceReevaluation } from '../../server/modules/canonical-host/configuration-evidence/configuration-evidence-reevaluation.state';

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

  it('freezes the current Host applicability artifact into the Overall task input vector', async () => {
    const harness = createHarness();
    harness.workItem.applicability = applicabilityProjection();

    await harness.service.begin(WORK_ITEM_ID, []);

    const reservation = (
      harness.attempts.reserveAndClaim.mock.calls as unknown[][]
    ).at(-1)?.[0] as
      | { sourceRefs?: Array<{ ref: string; sha256: string }> }
      | undefined;
    expect(reservation?.sourceRefs).toEqual(
      expect.arrayContaining([
        {
          ref: 'artifact://applicability',
          sha256: 'f'.repeat(64),
        },
      ]),
    );
  });

  it('lets a Host-marked user regeneration reach the same begin path without discovery', async () => {
    const harness = createHarness();
    const priorOverall = {
      status: 'STALE' as const,
      revision: 1,
      sourceResultId: 'openclaw-overall://PRIOR',
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
      artifact: artifact('artifact://prior-overall', 'd'.repeat(64)),
      actionAttemptId: 'ATT-PRIOR-OVERALL',
      staleReason: null,
    };
    harness.workItem.integratedAssessment = {
      ...harness.workItem.integratedAssessment!,
      status: 'OVERALL_CANDIDATE_STALE',
      overallSynthesis: priorOverall,
    };
    harness.workItem.overallRegenerationRequest = {
      schemaVersion: 'wiselink.3_1.overall_regeneration_request.v1',
      requestId: 'REQ-USER-REGEN',
      requestedByUserId: 'USER-1',
      requestedAt: '2026-08-29T05:00:00.000Z',
      requestedFromRevision: 4,
      executionRevision: 5,
      staleReason: 'USER_REQUESTED_REGENERATION',
      sourceIdentity: {
        documentVersionId: 'DV-737',
        sourceArtifactId: 'SRC-737',
        sourceFileSha256: 'e'.repeat(64),
        packageId: 'PKG-737',
        packageArtifactSha256: 'b'.repeat(64),
      },
      sourceOverall: {
        revision: 1,
        actionAttemptId: 'ATT-PRIOR-OVERALL',
        artifactSha256: 'd'.repeat(64),
      },
    };
    harness.workItem.source = {
      ...harness.workItem.source,
      sourceArtifactId: 'SRC-737',
      sourceFileSha256: `sha256:${'e'.repeat(64)}`,
    };

    await expect(
      harness.service.begin(WORK_ITEM_ID, []),
    ).resolves.toMatchObject({ attemptRef: ATTEMPT_REF, status: 'RUNNING' });
    const reservation = (
      harness.attempts.reserveAndClaim.mock.calls as unknown[][]
    ).at(-1)?.[0] as Record<string, unknown> | undefined;
    expect(reservation).toMatchObject({
      baseRevision: 5,
      allowedConnectors: [],
      allowExpiredUnclaimedDeadlineRefresh: true,
      idempotencyKey:
        `openclaw-v1:overall:${WORK_ITEM_ID}:5:` +
        'USER_REQUESTED_REGENERATION:REQ-USER-REGEN',
    });
    await expect(
      harness.service.begin(WORK_ITEM_ID, ['BOEING']),
    ).rejects.toThrow('OVERALL_REGENERATION_DISCOVERY_PROVIDERS_FORBIDDEN');
  });

  it('resumes only the same live principal lease without rebuilding input', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-24T10:30:00.000Z'));
    try {
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
    } finally {
      jest.useRealTimers();
    }
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

  it('rejects unreadable model provenance before prepareCommit, artifact persistence, or CAS', async () => {
    const harness = createHarness();
    const valid = overallResult();
    const { contentHash: _contentHash, ...unsealed } = valid;
    const result = sealResultEnvelope({
      ...unsealed,
      modelVersion: 'fallback',
    });

    await expect(
      harness.service.commit(ATTEMPT_REF, LEASE_TOKEN, 1, result),
    ).rejects.toThrow('OPENCLAW_RESULT_RUNTIME_POLICY_MISMATCH');
    expect(harness.attempts.prepareCommit).not.toHaveBeenCalled();
    expect(harness.artifactStore.persistAndReadback).not.toHaveBeenCalled();
    expect(harness.registrar.compareAndSet).not.toHaveBeenCalled();
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

  it('builds P0B Overall from the staged shadow and promotes the whole bundle in one CAS', async () => {
    const harness = createHarness({ p0b: true });

    await harness.service.begin(WORK_ITEM_ID, []);

    const reservation = (
      harness.attempts.reserveAndClaim.mock.calls as unknown[][]
    ).at(-1)?.[0] as
      | { sourceRefs?: Array<{ ref: string; sha256: string }> }
      | undefined;
    expect(reservation?.sourceRefs).toEqual(
      expect.arrayContaining([
        { ref: 'artifact://applicability', sha256: 'f'.repeat(64) },
        { ref: 'artifact://base', sha256: BASE_SHA },
      ]),
    );

    await expect(
      harness.service.commit(ATTEMPT_REF, LEASE_TOKEN, 1, overallResult()),
    ).resolves.toMatchObject({
      workItemId: WORK_ITEM_ID,
      workItemRevision: 6,
      status: 'OVERALL_CANDIDATE_READY',
    });

    const cas = (harness.registrar.compareAndSet.mock.calls as unknown[][]).at(
      -1,
    )?.[0] as
      | { next: Omit<CanonicalWorkItemProjection, 'revision'> }
      | undefined;
    expect(cas?.next).toMatchObject({
      applicabilityInput: {
        applicabilityContextRef: 'APCTX-737',
        aircraftNumber: 'B-1266',
      },
      applicability: {
        actionAttemptId: 'ATT-APP',
        artifact: { ref: 'artifact://applicability' },
      },
      integratedAssessment: {
        status: 'OVERALL_CANDIDATE_READY',
        baseRules: {
          actionAttemptId: 'ATT-BASE',
          artifact: { ref: 'artifact://base' },
        },
        overallSynthesis: { actionAttemptId: ATTEMPT_ID },
      },
      configurationEvidenceReevaluation: {
        status: 'SUCCEEDED',
        promotedWorkItemRevision: 6,
        stages: { overall: { status: 'SUCCEEDED' } },
      },
      aeo: null,
    });
    expect(harness.workItem.applicability?.artifact.ref).toBe(
      'artifact://old-applicability',
    );
    expect(harness.workItem.integratedAssessment?.baseRules.artifact.ref).toBe(
      'artifact://old-base',
    );
    expect(harness.artifactStore.readActualBytes).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'artifact://applicability' }),
    );
    expect(harness.artifactStore.readActualBytes).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'artifact://base' }),
    );
  });

  it('records a P0B terminal outcome without replacing the old serving bundle', async () => {
    const harness = createHarness({ p0b: true });
    harness.prepared.row.status = 'WAITING_INPUT';
    harness.prepared.row.terminalReason = 'HOST_RESOLVED_INPUT_REQUIRED';

    await expect(
      harness.service.commit(ATTEMPT_REF, LEASE_TOKEN, 1, overallResult()),
    ).resolves.toMatchObject({ status: 'WAITING_INPUT' });

    const cas = (harness.registrar.compareAndSet.mock.calls as unknown[][]).at(
      -1,
    )?.[0] as
      | { next: Omit<CanonicalWorkItemProjection, 'revision'> }
      | undefined;
    expect(cas?.next).toMatchObject({
      applicability: {
        actionAttemptId: 'ATT-OLD-APP',
        artifact: { ref: 'artifact://old-applicability' },
      },
      integratedAssessment: {
        baseRules: {
          actionAttemptId: 'ATT-OLD-BASE',
          artifact: { ref: 'artifact://old-base' },
        },
      },
      configurationEvidenceReevaluation: {
        status: 'WAITING_INPUT',
        stages: {
          overall: {
            status: 'WAITING_INPUT',
            attempt: { attemptId: ATTEMPT_ID },
          },
        },
      },
    });
    expect(harness.artifactStore.persistAndReadback).not.toHaveBeenCalled();
  });

  it.each([
    ['CANCELLED', 'FAILED'],
    ['TIMED_OUT', 'FAILED'],
    ['OBSOLETE', 'CONFLICT'],
    ['CONFLICT', 'CONFLICT'],
  ] as const)(
    'records an exact P0B %s prepare race as %s without replacing serving current',
    async (attemptStatus, reevaluationStatus) => {
      const harness = createHarness({ p0b: true });
      const terminalRow: ActionAttemptRow = {
        ...harness.prepared.row,
        status: attemptStatus,
        terminalReason: `PREPARE_RACE_${attemptStatus}`,
        resultEnvelopeJson: null,
        resultContentHash: null,
        completedAt: new Date('2026-08-24T10:00:01.000Z'),
      };
      harness.attempts.readScoped
        .mockResolvedValueOnce({
          ...harness.prepared.row,
          status: 'RUNNING',
        })
        .mockResolvedValueOnce(terminalRow);
      harness.attempts.prepareCommit.mockRejectedValueOnce(
        new Error(`ACTION_ATTEMPT_${attemptStatus}`),
      );

      await expect(
        harness.service.commit(ATTEMPT_REF, LEASE_TOKEN, 1, overallResult()),
      ).rejects.toThrow(`ACTION_ATTEMPT_${attemptStatus}`);

      const cas = (
        harness.registrar.compareAndSet.mock.calls as unknown[][]
      ).at(-1)?.[0] as
        | { next: Omit<CanonicalWorkItemProjection, 'revision'> }
        | undefined;
      expect(cas?.next).toMatchObject({
        applicability: {
          actionAttemptId: 'ATT-OLD-APP',
          artifact: { ref: 'artifact://old-applicability' },
        },
        integratedAssessment: {
          baseRules: {
            actionAttemptId: 'ATT-OLD-BASE',
            artifact: { ref: 'artifact://old-base' },
          },
        },
        configurationEvidenceReevaluation: {
          status: reevaluationStatus,
          stages: {
            overall: {
              status: reevaluationStatus,
              attempt: { attemptId: ATTEMPT_ID },
              terminal: { code: `PREPARE_RACE_${attemptStatus}` },
            },
          },
        },
      });
      expect(harness.artifactStore.persistAndReadback).not.toHaveBeenCalled();
    },
  );

  it('does not let an old prepare race overwrite a newer Overall retry', async () => {
    const harness = createHarness({ p0b: true });
    harness.workItem.revision = 6;
    const marker = harness.workItem.configurationEvidenceReevaluation;
    if (
      marker?.schemaVersion !==
      'wiselink.3_1.configuration_evidence_reevaluation.v2'
    ) {
      throw new Error('TEST_P0B_MARKER_REQUIRED');
    }
    marker.stages.overall.retryNo = 1;
    const terminalRow: ActionAttemptRow = {
      ...harness.prepared.row,
      status: 'CANCELLED',
      terminalReason: 'PREPARE_RACE_CANCELLED',
      resultEnvelopeJson: null,
      resultContentHash: null,
      completedAt: new Date('2026-08-24T10:00:01.000Z'),
    };
    harness.attempts.readScoped
      .mockResolvedValueOnce({
        ...harness.prepared.row,
        status: 'RUNNING',
      })
      .mockResolvedValueOnce(terminalRow);
    harness.attempts.prepareCommit.mockRejectedValueOnce(
      new Error('ACTION_ATTEMPT_CANCELLED'),
    );

    await expect(
      harness.service.commit(ATTEMPT_REF, LEASE_TOKEN, 1, overallResult()),
    ).rejects.toThrow('ACTION_ATTEMPT_CANCELLED');

    expect(harness.registrar.compareAndSet).not.toHaveBeenCalled();
    expect(marker).toMatchObject({
      status: 'RUNNING',
      stages: { overall: { status: 'PENDING', retryNo: 1 } },
    });
  });

  it('records a same-cycle P0B CAS drift as CONFLICT without touching serving current', async () => {
    const harness = createHarness({ p0b: true });
    harness.workItem.revision = 6;

    await expect(
      harness.service.commit(ATTEMPT_REF, LEASE_TOKEN, 1, overallResult()),
    ).rejects.toThrow('WORK_ITEM_CAS_CONFLICT');

    const cas = (harness.registrar.compareAndSet.mock.calls as unknown[][]).at(
      -1,
    )?.[0] as
      | { expectedRevision: number; next: CanonicalWorkItemProjection }
      | undefined;
    expect(cas).toMatchObject({
      expectedRevision: 6,
      next: {
        applicability: {
          actionAttemptId: 'ATT-OLD-APP',
          artifact: { ref: 'artifact://old-applicability' },
        },
        integratedAssessment: {
          baseRules: {
            actionAttemptId: 'ATT-OLD-BASE',
            artifact: { ref: 'artifact://old-base' },
          },
        },
        configurationEvidenceReevaluation: {
          status: 'CONFLICT',
          stages: {
            overall: {
              status: 'CONFLICT',
              attempt: { attemptId: ATTEMPT_ID },
            },
          },
        },
      },
    });
    expect(harness.artifactStore.persistAndReadback).not.toHaveBeenCalled();
  });

  it('terminalizes an old COMMITTING Overall attempt after a newer adoption without touching the new cycle', async () => {
    const harness = createHarness({ p0b: true });
    harness.workItem.revision = 6;
    harness.workItem.configurationEvidenceCurrent = {
      ...harness.workItem.configurationEvidenceCurrent!,
      snapshotId: 'CONFIG-SNAPSHOT-3',
      configurationRevision: 3,
    };
    harness.workItem.configurationEvidenceReevaluation =
      createConfigurationEvidenceReevaluation({
        triggerSnapshotId: 'CONFIG-SNAPSHOT-3',
        triggerConfigurationRevision: 3,
        adoptionWorkItemRevision: 6,
      });
    harness.attempts.finishProjectionConflict.mockResolvedValueOnce({
      attemptRef: ATTEMPT_REF,
      status: 'CONFLICT',
      projectionApplied: false,
      terminalReason: 'WORK_ITEM_CAS_CONFLICT_AFTER_COMMIT_START',
    });

    await expect(
      harness.service.commit(ATTEMPT_REF, LEASE_TOKEN, 1, overallResult()),
    ).resolves.toMatchObject({
      attemptRef: ATTEMPT_REF,
      status: 'CONFLICT',
      projectionApplied: false,
    });

    expect(harness.attempts.finishProjectionConflict).toHaveBeenCalledWith({
      prepared: harness.prepared,
      currentRevision: 6,
    });
    expect(harness.registrar.compareAndSet).not.toHaveBeenCalled();
    expect(harness.workItem.configurationEvidenceReevaluation).toMatchObject({
      triggerSnapshotId: 'CONFIG-SNAPSHOT-3',
      status: 'REQUIRED',
      stages: { overall: { status: 'PENDING', retryNo: 0 } },
    });
    expect(harness.artifactStore.persistAndReadback).not.toHaveBeenCalled();
  });

  it('recovers P0B after the final CAS without repeating artifact writes or CAS', async () => {
    const harness = createHarness({ p0b: true });
    promoteP0BForRecovery(harness.workItem);
    harness.prepared.row.status = 'COMMITTING';

    await expect(
      harness.service.commit(ATTEMPT_REF, LEASE_TOKEN, 1, overallResult()),
    ).resolves.toMatchObject({
      workItemId: WORK_ITEM_ID,
      workItemRevision: 6,
      overallSynthesis: { actionAttemptId: ATTEMPT_ID },
    });
    expect(harness.artifactStore.persistAndReadback).not.toHaveBeenCalled();
    expect(harness.registrar.compareAndSet).not.toHaveBeenCalled();
    expect(harness.attempts.finishProjectionSuccess).toHaveBeenCalledTimes(1);
  });
});

function createHarness(input: { p0b?: boolean } = {}) {
  const workItem = workItemProjection();
  if (input.p0b) activateP0B(workItem);
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
      ...(input.p0b
        ? {
            configurationEvidenceReevaluation: {
              triggerSnapshotId: 'CONFIG-SNAPSHOT-2',
              triggerConfigurationRevision: 2,
              overallRetryNo: 0,
            },
          }
        : {}),
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
    projectTerminal: jest.fn((terminalRow: ActionAttemptRow) => ({
      attemptRef: terminalRow.operationRef,
      status: terminalRow.status,
      projectionApplied: terminalRow.projectionApplied,
      terminalReason: terminalRow.terminalReason,
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
      contentHash: 'package-content-hash',
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

function applicabilityProjection() {
  return {
    schemaVersion:
      'wiselink.3_1.applicability_candidate_projection.v1' as const,
    status: 'CANDIDATE_ONLY' as const,
    currentness: 'CURRENT' as const,
    staleReason: null,
    sourceResultId: 'openclaw-applicability://REQ-APP',
    actionAttemptId: 'ATT-APP',
    inputRevision: 4,
    documentId: 'DOC-737',
    documentVersionId: 'DV-737',
    sourcePackageId: 'PKG-737',
    sourcePackageContentHash: 'package-content-hash',
    translationActionAttemptId: 'ATT-TRANSLATION',
    applicabilityContextRef: 'APCTX-737',
    applicabilityBindingRevision: 'host-applicability:test',
    aircraftNumber: 'B-1266',
    assessmentAsOf: '2026-09-01',
    fleetSourceSnapshotId: 'FLEET-SNAPSHOT-1',
    fleetSourceRevisionKey: 'FLEET-REV-1',
    fleetAuthorityRevision: 'FLEET-AUTH-1',
    fleetSourceAsOf: '2026-09-01',
    sourceExpressionCount: 1,
    sourceRefCount: 11,
    decision: 'APPLICABLE' as const,
    kleeneResult: true as const,
    pass: true,
    blockingUnknownCount: 0,
    artifact: artifact('artifact://applicability', 'f'.repeat(64)),
  };
}

function activateP0B(workItem: CanonicalWorkItemProjection): void {
  const stagedBase = structuredClone(workItem.integratedAssessment!.baseRules);
  workItem.applicability = {
    ...applicabilityProjection(),
    actionAttemptId: 'ATT-OLD-APP',
    artifact: artifact('artifact://old-applicability', 'e'.repeat(64)),
  };
  workItem.integratedAssessment = {
    ...workItem.integratedAssessment!,
    baseRules: {
      ...stagedBase,
      sourceResultId: 'openclaw-dynamic://OLD-DYNAMIC',
      actionAttemptId: 'ATT-OLD-BASE',
      artifact: artifact('artifact://old-base', 'd'.repeat(64)),
    },
  };
  workItem.configurationEvidenceCurrent = {
    schemaVersion: 'wiselink.3_1.configuration_evidence_work_item_current.v1',
    snapshotId: 'CONFIG-SNAPSHOT-2',
    configurationRevision: 2,
    aircraftAssetId: 'AIRCRAFT-B-1266',
    assessmentAsOf: '2026-09-01T00:00:00.000Z',
    sourceCompleteness: 'COMPLETE',
    truthSummary: {
      trueCount: 1,
      falseCount: 0,
      unknownCount: 0,
      conflictCount: 0,
    },
    recordedAt: '2026-09-01T00:00:00.000Z',
    authority: 'WORK_ITEM_CURRENT_EVIDENCE_VIEW',
    globalAircraftCurrentChanged: false,
  };
  workItem.configurationEvidenceReevaluation = {
    schemaVersion: 'wiselink.3_1.configuration_evidence_reevaluation.v2',
    trigger: 'CONFIGURATION_EVIDENCE_ADOPTED',
    triggerSnapshotId: 'CONFIG-SNAPSHOT-2',
    triggerConfigurationRevision: 2,
    adoptionWorkItemRevision: 2,
    mode: 'FULL_APPLICABILITY_JOB_AID_OVERALL',
    status: 'RUNNING',
    stages: {
      applicability: {
        status: 'SUCCEEDED',
        retryNo: 0,
        attempt: {
          attemptId: 'ATT-APP',
          attemptRef: 'AQ-APP',
          inputRevision: 3,
          baseRevision: 3,
        },
        committedWorkItemRevision: 4,
        terminal: null,
      },
      dynamic: {
        status: 'SUCCEEDED',
        retryNo: 0,
        attempt: {
          attemptId: 'ATT-BASE',
          attemptRef: 'AQ-BASE',
          inputRevision: 4,
          baseRevision: 4,
        },
        committedWorkItemRevision: 5,
        terminal: null,
      },
      overall: {
        status: 'PENDING',
        retryNo: 0,
        attempt: null,
        committedWorkItemRevision: null,
        terminal: null,
      },
    },
    stagedBundle: {
      applicabilityInput: {
        schemaVersion: 'wiselink.3_1.applicability_input_projection.v1',
        applicabilityContextRef: 'APCTX-737',
        workItemId: WORK_ITEM_ID,
        documentVersionId: 'DV-737',
        sourcePackageId: 'PKG-737',
        sourcePackageContentHash: 'package-content-hash',
        sourcePackageArtifactSha256: 'b'.repeat(64),
        targetBindingHash: 'target-binding',
        selectionRevision: 'selection-2',
        bindingRevision: 'host-applicability:test',
        currentness: 'CURRENT',
        aircraftNumber: 'B-1266',
        assessmentAsOf: '2026-09-01',
        fleetMasterData: {
          schemaVersion:
            'wiselink.v3_1.applicability_fleet.fleet_master_data.v1',
          sourceSnapshotId: 'CONFIG-SNAPSHOT-2',
          sourceRevisionKey: 'CONFIG-REV-2',
          authorityRevision: 'AUTH-REV-2',
          sourceAsOf: '2026-09-01',
          assets: [],
          facts: [],
        },
      },
      applicability: applicabilityProjection(),
      baseRules: stagedBase,
    },
    promotedWorkItemRevision: null,
    candidateOnly: true,
  };
}

function promoteP0BForRecovery(workItem: CanonicalWorkItemProjection): void {
  const marker = workItem.configurationEvidenceReevaluation;
  if (
    marker?.schemaVersion !==
    'wiselink.3_1.configuration_evidence_reevaluation.v2'
  ) {
    throw new Error('TEST_P0B_MARKER_REQUIRED');
  }
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
  workItem.revision = 6;
  workItem.applicabilityInput = structuredClone(
    marker.stagedBundle.applicabilityInput,
  );
  workItem.applicability = structuredClone(marker.stagedBundle.applicability);
  workItem.integratedAssessment = {
    status: 'OVERALL_CANDIDATE_READY',
    baseRules: structuredClone(marker.stagedBundle.baseRules!),
    engineerReviews: workItem.integratedAssessment?.engineerReviews ?? null,
    overallSynthesis: overall,
    overallForAeoConfirmation: null,
  };
  marker.status = 'SUCCEEDED';
  marker.stages.overall = {
    status: 'SUCCEEDED',
    retryNo: 0,
    attempt: {
      attemptId: ATTEMPT_ID,
      attemptRef: ATTEMPT_REF,
      inputRevision: 5,
      baseRevision: 5,
    },
    committedWorkItemRevision: 6,
    terminal: null,
  };
  marker.promotedWorkItemRevision = 6;
}

function overallModelInput() {
  return {
    operation: 'SYNTHESIZE_OVERALL_CANDIDATE' as const,
    outputCorrelationRef: TRIGGER_REF,
    applicabilityResult: null,
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
      currentDocumentSourceRefIds: ['SRC-001'],
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
    selectiveResynthesis: {
      mode: 'INITIAL' as const,
      criterionSetId: 'JACS-ONE',
      baseRuleRevision: 1,
      baseRuleArtifactSha256: BASE_SHA,
      staleOverallRevision: null,
      targetOverallRevision: 1,
      priorEngineerReviewRevision: null,
      currentEngineerReviewRevision: null,
      affectedCriterionIds: [],
      reusedCriterionIds: [],
      adoptedEvidenceSourceRefIds: [],
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
    modelVersion: 'GLM-5.3',
    promptVersion: 'overall-prompt-v1',
    skillVersion:
      CANONICAL_HOST_OPENCLAW_RUNTIME_POLICY.minimumCompatibleSkillVersion,
    toolVersions: {
      [CANONICAL_HOST_OPENCLAW_RUNTIME_POLICY.mcpServerName]:
        CANONICAL_HOST_OPENCLAW_RUNTIME_POLICY.mcpServerVersion,
    },
    runMetrics: { durationMs: 1, inputUnits: 1, outputUnits: 1 },
    errorCode: null,
    errorDetail: null,
  });
}

function validOutput(): string {
  const overallCandidate =
    '候选工程结论：按当前来源完成技术处置准备，并进入最终工程批准。';
  const statement = (
    text: string,
    basis: 'SOURCE_FACT' | 'CONDITIONAL_INFERENCE' = 'CONDITIONAL_INFERENCE',
  ) => ({ text, basis, sourceRefIds: ['SRC-001'] });
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
    overallCandidate,
    engineeringSummary: {
      schemaVersion: 'wiselink.3_1.overall_engineering_summary.v1',
      conclusion: statement(overallCandidate),
      whyItMatters: [
        statement('来源说明了需要处置的技术问题。', 'SOURCE_FACT'),
      ],
      applicability: {
        sourceScope: statement('来源适用范围以当前文件为准。', 'SOURCE_FACT'),
        fleetMatch: statement('当前机队匹配仍需受控事实确认。'),
        requiredFacts: [statement('核对来源适用范围要求的飞机事实。')],
      },
      implementationImpact: [statement('实施前需按来源准备部件和测试。')],
      dispositionPriority: [statement('按来源时限和建议安排计划。')],
      nextActions: [statement('核对当前飞机事实并准备实施条件。')],
    },
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
    applicabilityStatus: 'UNKNOWN/WAITING_INPUT',
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
