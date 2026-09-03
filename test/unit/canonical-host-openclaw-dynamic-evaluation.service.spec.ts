import type {
  CanonicalApplicabilityCandidateProjection,
  CanonicalApplicabilityInputProjection,
  CanonicalBaseRuleCandidateProjection,
  CanonicalConfigurationEvidenceReevaluationAttemptBinding,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';

import {
  sealResultEnvelope,
  sealTaskEnvelope,
} from '../../server/modules/action-attempt/action-attempt-envelope';
import type { ActionAttemptRow } from '../../server/modules/action-attempt/action-attempt.types';
import { CanonicalHostOpenClawDynamicEvaluationService } from '../../server/modules/canonical-host/canonical-host-openclaw-dynamic-evaluation.service';
import { CANONICAL_HOST_OPENCLAW_RUNTIME_POLICY } from '../../server/modules/canonical-host/canonical-host-openclaw-runtime-policy';
import {
  createConfigurationEvidenceReevaluation,
  retryConfigurationEvidenceReevaluationStage,
  withConfigurationEvidenceTerminal,
  withStagedApplicability,
  withStagedApplicabilityInput,
  withStagedBaseRules,
} from '../../server/modules/canonical-host/configuration-evidence/configuration-evidence-reevaluation.state';
import { hostNativePdfClassificationFor } from '../../server/modules/canonical-host/host-native-pdf-profile.registry';

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
      modelInput: {
        purpose: 'EVALUATE_DYNAMIC_RULES',
        ruleSetBinding: expect.objectContaining({
          snapshotId: 'JACS-DYNAMIC-2',
          criterionSetId: 'JACS-DYNAMIC-2',
          activationRevision: 1,
        }),
      },
    });
    expect(harness.processor.buildRequest.mock.calls[0][2]).toMatchObject({
      expectedRevision: 5,
    });
    expect(
      harness.ruleSets.readRuntimeSnapshotAtActivation,
    ).toHaveBeenCalledWith('tenant-dynamic', 'JACS-DYNAMIC-2', 1);
  });

  it('promotes only the current DM-bound SB adapter before reserving Dynamic', async () => {
    const harness = createHarness();
    const candidate = hostNativePdfClassificationFor({
      family: 'SB',
      issuerAuthority: 'BOEING',
    });
    expect(candidate).toMatchObject({ status: 'CANDIDATE' });
    harness.workItem.classification = candidate!;

    const begun = await harness.service.begin(WORK_ITEM_ID);

    expect(harness.documentVersions.resolve).toHaveBeenCalledWith(
      'DV-DYNAMIC',
      { requireCurrent: true },
    );
    expect(harness.registrar.compareAndSet).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: WORK_ITEM_ID,
        expectedRevision: 5,
        syncPrimaryAttempt: false,
        next: expect.objectContaining({
          classification: expect.objectContaining({
            status: 'CONFIRMED',
            normalizedFamily: 'SB',
            parserProfileId: 'parser-profile:boeing.sb@1.0.0',
          }),
        }),
      }),
    );
    expect(harness.attempts.reserveAndClaim).toHaveBeenCalledWith(
      expect.objectContaining({ inputRevision: 6, baseRevision: 6 }),
    );
    expect(begun.status).toBe('RUNNING');
  });

  it('does not promote a candidate when the current DM source identity drifts', async () => {
    const harness = createHarness();
    harness.workItem.classification = hostNativePdfClassificationFor({
      family: 'SB',
      issuerAuthority: 'BOEING',
    })!;
    harness.documentVersions.resolve.mockResolvedValueOnce({
      ...dmResolvedSource(),
      artifact: {
        ...dmResolvedSource().artifact,
        sha256: 'f'.repeat(64),
      },
    });

    await expect(harness.service.begin(WORK_ITEM_ID)).rejects.toThrow(
      'DYNAMIC_EVALUATION_SB_SOURCE_BINDING_INVALID',
    );
    expect(harness.registrar.compareAndSet).not.toHaveBeenCalled();
    expect(harness.attempts.reserveAndClaim).not.toHaveBeenCalled();
  });

  it('resolves ACTIVE inside new-attempt construction, so a zero head cannot build an attempt', async () => {
    const harness = createHarness();
    harness.ruleSets.readActiveRuntime.mockRejectedValueOnce(
      Object.assign(new Error('RULE_SET_ACTIVE_SNAPSHOT_REQUIRED'), {
        code: 'RULE_SET_ACTIVE_SNAPSHOT_REQUIRED',
        statusCode: 503,
      }),
    );

    await expect(harness.service.begin(WORK_ITEM_ID)).rejects.toMatchObject({
      code: 'RULE_SET_ACTIVE_SNAPSHOT_REQUIRED',
      statusCode: 503,
    });
    expect(harness.attempts.reserveAndClaim).toHaveBeenCalledTimes(1);
    expect(
      harness.assessment.prepareDynamicRulesCandidateWithRuleSet,
    ).not.toHaveBeenCalled();
    expect(
      harness.ruleSets.readRuntimeSnapshotAtActivation,
    ).not.toHaveBeenCalled();
  });

  it('recovers an existing RUNNING task from its sealed snapshot without reading current', async () => {
    const harness = createHarness();
    const task = taskEnvelope(workItemProjection());
    harness.attempts.reserveAndClaim.mockResolvedValueOnce({
      attemptRef: ATTEMPT_REF,
      status: 'RUNNING',
      leaseToken: LEASE_TOKEN,
      leaseGeneration: 1,
      leaseExpiresAt: '2026-08-24T11:00:00.000Z',
      task,
      created: false,
      triggerRequestId: 'REQ-DYNAMIC-REAL',
    });

    await expect(harness.service.begin(WORK_ITEM_ID)).resolves.toMatchObject({
      status: 'RUNNING',
      modelInput: {
        ruleSetBinding: { snapshotId: 'JACS-DYNAMIC-2' },
      },
    });
    expect(harness.ruleSets.readActiveRuntime).not.toHaveBeenCalled();
    expect(
      harness.ruleSets.readRuntimeSnapshotAtActivation,
    ).toHaveBeenCalledWith('tenant-dynamic', 'JACS-DYNAMIC-2', 1);
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

  it('rejects unreadable model provenance before prepareCommit, artifact persistence, or CAS', async () => {
    const harness = createHarness();
    const valid = dynamicResult();
    const { contentHash: _contentHash, ...unsealed } = valid;
    const result = sealResultEnvelope({
      ...unsealed,
      modelVersion: 'unknown',
    });

    await expect(
      harness.service.commit(ATTEMPT_REF, LEASE_TOKEN, 1, result),
    ).rejects.toThrow('OPENCLAW_RESULT_RUNTIME_POLICY_MISMATCH');
    expect(harness.attempts.prepareCommit).not.toHaveBeenCalled();
    expect(harness.artifactStore.persistAndReadback).not.toHaveBeenCalled();
    expect(harness.registrar.compareAndSet).not.toHaveBeenCalled();
  });

  it('reads the immutable bound snapshot before moving RUNNING to COMMITTING', async () => {
    const harness = createHarness();
    harness.ruleSets.readRuntimeSnapshotAtActivation.mockRejectedValueOnce(
      new Error('RULE_SET_RUNTIME_SNAPSHOT_MISSING'),
    );

    await expect(
      harness.service.commit(ATTEMPT_REF, LEASE_TOKEN, 1, dynamicResult()),
    ).rejects.toThrow('RULE_SET_RUNTIME_SNAPSHOT_MISSING');
    expect(harness.attempts.prepareCommit).not.toHaveBeenCalled();
    expect(harness.artifactStore.persistAndReadback).not.toHaveBeenCalled();
  });

  it.each([
    ['CANCELLED', 'FAILED'],
    ['TIMED_OUT', 'FAILED'],
    ['OBSOLETE', 'CONFLICT'],
    ['CONFLICT', 'CONFLICT'],
  ] as const)(
    'fresh-reads a %s prepareCommit race and terminalizes only the exact P0B base as %s',
    async (attemptStatus, reevaluationStatus) => {
      const workItem = reevaluationWorkItem();
      const servingBefore = servingFields(workItem);
      const harness = createHarness(workItem);
      prepareTerminalRace(harness, attemptStatus);

      await expect(
        harness.service.commit(
          ATTEMPT_REF,
          LEASE_TOKEN,
          1,
          dynamicResult(harness.prepared.task),
        ),
      ).resolves.toMatchObject({ status: attemptStatus });

      expect(harness.attempts.readScoped).toHaveBeenCalledTimes(2);
      expect(servingFields(harness.current())).toEqual(servingBefore);
      expect(harness.current().configurationEvidenceReevaluation).toMatchObject(
        {
          status: reevaluationStatus,
          stages: {
            dynamic: {
              status: reevaluationStatus,
              attempt: { attemptId: ATTEMPT_ID },
              terminal: { code: `PREPARE_RACE_${attemptStatus}` },
            },
          },
        },
      );
    },
  );

  it.each(['CANCELLED', 'TIMED_OUT', 'OBSOLETE', 'CONFLICT'] as const)(
    'does not let an old %s prepareCommit race overwrite a later adoption',
    async (attemptStatus) => {
      const oldCycle = reevaluationWorkItem();
      const harness = createHarness(oldCycle);
      const laterAdoption = laterAdoptionWorkItem(oldCycle);
      harness.setCurrent(laterAdoption);
      prepareTerminalRace(harness, attemptStatus);

      await expect(
        harness.service.commit(
          ATTEMPT_REF,
          LEASE_TOKEN,
          1,
          dynamicResult(harness.prepared.task),
        ),
      ).resolves.toMatchObject({ status: attemptStatus });

      expect(harness.attempts.readScoped).toHaveBeenCalledTimes(2);
      expect(harness.registrar.compareAndSet).not.toHaveBeenCalled();
      expect(harness.current()).toEqual(laterAdoption);
      expect(harness.current().configurationEvidenceReevaluation).toMatchObject(
        {
          triggerSnapshotId: 'CONFIG-SNAPSHOT-P0B-LATER',
          status: 'REQUIRED',
          stages: { dynamic: { status: 'PENDING' } },
        },
      );
    },
  );

  it('keeps the ordinary path projection-free when prepareCommit fresh-reads a terminal race', async () => {
    const harness = createHarness();
    prepareTerminalRace(harness, 'CANCELLED');

    await expect(
      harness.service.commit(ATTEMPT_REF, LEASE_TOKEN, 1, dynamicResult()),
    ).resolves.toMatchObject({ status: 'CANCELLED' });

    expect(harness.attempts.readScoped).toHaveBeenCalledTimes(2);
    expect(harness.registrar.compareAndSet).not.toHaveBeenCalled();
    expect(harness.current()).toEqual(harness.workItem);
  });

  it('rebuilds a COMMITTING recovery from its bound historical snapshot after current changes', async () => {
    const harness = createHarness();
    harness.prepared.row.status = 'COMMITTING';
    harness.ruleSets.readActiveRuntime.mockResolvedValueOnce(
      ruleSetRuntime('JACS-REPLACEMENT', 2),
    );

    await expect(
      harness.service.commit(ATTEMPT_REF, LEASE_TOKEN, 1, dynamicResult()),
    ).resolves.toMatchObject({ status: 'BASE_RULE_CANDIDATE_READY' });
    expect(harness.ruleSets.readActiveRuntime).not.toHaveBeenCalled();
    expect(
      harness.ruleSets.readRuntimeSnapshotAtActivation,
    ).toHaveBeenCalledWith('tenant-dynamic', 'JACS-DYNAMIC-2', 1);
    expect(
      harness.assessment.prepareDynamicRulesCandidateWithRuleSet,
    ).toHaveBeenCalledWith(expect.any(Object), RULE_SET_RUNTIME);
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

  it('builds P0B Dynamic from the staged applicability shadow and stages Base without changing serving current', async () => {
    const workItem = reevaluationWorkItem();
    const servingBefore = servingFields(workItem);
    const harness = createHarness(workItem);

    const committed = await harness.service.commit(
      ATTEMPT_REF,
      LEASE_TOKEN,
      1,
      dynamicResult(harness.prepared.task),
    );

    expect(
      harness.assessment.prepareDynamicRulesCandidateWithRuleSet,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        workItem: expect.objectContaining({
          applicabilityInput: expect.objectContaining({
            applicabilityContextRef: 'APCTX-P0B',
          }),
          applicability: expect.objectContaining({
            actionAttemptId: 'ATT-APP-P0B',
          }),
        }),
      }),
      RULE_SET_RUNTIME,
    );
    expect(servingFields(harness.current())).toEqual(servingBefore);
    expect(harness.current().configurationEvidenceReevaluation).toMatchObject({
      status: 'RUNNING',
      stages: { dynamic: { status: 'SUCCEEDED' } },
      stagedBundle: {
        baseRules: { actionAttemptId: ATTEMPT_ID },
      },
    });
    expect(committed).toMatchObject({
      workItemRevision: workItem.revision + 1,
      baseRules: { actionAttemptId: ATTEMPT_ID },
    });
  });

  it('recovers a staged P0B Base result after projection CAS without rewriting it', async () => {
    const workItem = reevaluationWorkItem();
    const harness = createHarness(workItem);
    const staged = withStagedBaseRules(
      workItem,
      committedP0bBaseRules(),
      reevaluationAttempt(harness.prepared.row, workItem.revision),
    );
    harness.setCurrent(staged);
    harness.prepared.row.status = 'COMMITTING';

    await expect(
      harness.service.commit(
        ATTEMPT_REF,
        LEASE_TOKEN,
        1,
        dynamicResult(harness.prepared.task),
      ),
    ).resolves.toMatchObject({
      workItemRevision: staged.revision,
      baseRules: { actionAttemptId: ATTEMPT_ID },
    });
    expect(harness.artifactStore.persistAndReadback).not.toHaveBeenCalled();
    expect(harness.registrar.compareAndSet).not.toHaveBeenCalled();
    expect(harness.attempts.finishProjectionSuccess).toHaveBeenCalledTimes(1);
  });

  it('records a non-success P0B result in the marker and preserves serving current', async () => {
    const workItem = reevaluationWorkItem();
    const servingBefore = servingFields(workItem);
    const harness = createHarness(workItem);
    harness.prepared.row.status = 'WAITING_INPUT';
    harness.prepared.row.terminalReason = 'HOST_RESOLVED_INPUT_REQUIRED';

    await expect(
      harness.service.commit(
        ATTEMPT_REF,
        LEASE_TOKEN,
        1,
        dynamicResult(harness.prepared.task),
      ),
    ).resolves.toMatchObject({ status: 'WAITING_INPUT' });
    expect(servingFields(harness.current())).toEqual(servingBefore);
    expect(harness.current().configurationEvidenceReevaluation).toMatchObject({
      status: 'WAITING_INPUT',
      stages: {
        dynamic: {
          status: 'WAITING_INPUT',
          attempt: { attemptId: ATTEMPT_ID },
          terminal: { code: 'HOST_RESOLVED_INPUT_REQUIRED' },
        },
      },
    });
  });

  it('records a P0B ResultGate failure without promoting staged or serving fields', async () => {
    const workItem = reevaluationWorkItem();
    const servingBefore = servingFields(workItem);
    const harness = createHarness(workItem);
    harness.prepared.task.modelInput = {
      purpose: 'EVALUATE_DYNAMIC_RULES',
      expectedSelfCheck: { criterionSetId: 'DRIFTED' },
    };

    await expect(
      harness.service.commit(
        ATTEMPT_REF,
        LEASE_TOKEN,
        1,
        dynamicResult(harness.prepared.task),
      ),
    ).resolves.toMatchObject({ status: 'FAILED' });
    expect(servingFields(harness.current())).toEqual(servingBefore);
    expect(harness.current().configurationEvidenceReevaluation).toMatchObject({
      status: 'FAILED',
      stages: {
        dynamic: {
          status: 'FAILED',
          terminal: { code: 'DYNAMIC_EVALUATION_RESULT_GATE_REJECTED' },
        },
      },
      stagedBundle: { baseRules: null },
    });
  });

  it('terminalizes a P0B engineer-review compatibility rejection before artifact persistence', async () => {
    const workItem = reevaluationWorkItem();
    workItem.integratedAssessment!.engineerReviews = {} as never;
    const servingBefore = servingFields(workItem);
    const harness = createHarness(workItem);
    harness.engineerReviews.assertLedgerCompatibleWithDynamicBytes.mockRejectedValueOnce(
      new Error('ENGINEER_REVIEW_DYNAMIC_RESULT_DRIFT'),
    );

    await expect(
      harness.service.commit(
        ATTEMPT_REF,
        LEASE_TOKEN,
        1,
        dynamicResult(harness.prepared.task),
      ),
    ).resolves.toMatchObject({ status: 'FAILED' });
    expect(harness.artifactStore.persistAndReadback).not.toHaveBeenCalled();
    expect(servingFields(harness.current())).toEqual(servingBefore);
    expect(harness.current().configurationEvidenceReevaluation).toMatchObject({
      status: 'FAILED',
      stages: {
        dynamic: {
          status: 'FAILED',
          terminal: {
            code: 'DYNAMIC_EVALUATION_RESULT_GATE_REJECTED',
            message: 'ENGINEER_REVIEW_DYNAMIC_RESULT_DRIFT',
          },
        },
      },
    });
  });

  it('records a P0B CAS conflict on the same cycle without changing serving current', async () => {
    const workItem = reevaluationWorkItem();
    const harness = createHarness(workItem);
    const drifted = { ...workItem, revision: workItem.revision + 1 };
    harness.setCurrent(drifted);
    harness.attempts.finishProjectionConflict.mockResolvedValueOnce({
      attemptRef: ATTEMPT_REF,
      status: 'CONFLICT',
      projectionApplied: false,
      terminalReason: 'WORK_ITEM_CAS_CONFLICT_AFTER_COMMIT_START',
    });

    await expect(
      harness.service.commit(
        ATTEMPT_REF,
        LEASE_TOKEN,
        1,
        dynamicResult(harness.prepared.task),
      ),
    ).resolves.toMatchObject({ status: 'CONFLICT' });
    expect(servingFields(harness.current())).toEqual(servingFields(workItem));
    expect(harness.current().configurationEvidenceReevaluation).toMatchObject({
      status: 'CONFLICT',
      stages: { dynamic: { status: 'CONFLICT' } },
    });
  });

  it('does not let retry 0 terminal output overwrite retry 1 PENDING in the same adoption cycle', async () => {
    const workItem = reevaluationWorkItem();
    const harness = createHarness(workItem);
    const retryZeroTerminal = withConfigurationEvidenceTerminal(
      workItem,
      'DYNAMIC',
      'FAILED',
      reevaluationAttempt(harness.prepared.row, workItem.revision),
      'RETRY_ZERO_FAILED',
    );
    const retryOne = retryConfigurationEvidenceReevaluationStage({
      workItem: retryZeroTerminal,
      stage: 'DYNAMIC',
    });
    harness.setCurrent(retryOne);
    harness.prepared.row.status = 'WAITING_INPUT';
    harness.prepared.row.terminalReason = 'LATE_RETRY_ZERO_TERMINAL';

    await expect(
      harness.service.commit(
        ATTEMPT_REF,
        LEASE_TOKEN,
        1,
        dynamicResult(harness.prepared.task),
      ),
    ).resolves.toMatchObject({ status: 'WAITING_INPUT' });

    expect(harness.registrar.compareAndSet).not.toHaveBeenCalled();
    expect(harness.current()).toEqual(retryOne);
    expect(harness.current().configurationEvidenceReevaluation).toMatchObject({
      status: 'REQUIRED',
      stages: { dynamic: { status: 'PENDING', retryNo: 1 } },
    });
  });

  it('does not let retry 0 CAS-drift recovery overwrite retry 1 PENDING', async () => {
    const workItem = reevaluationWorkItem();
    const harness = createHarness(workItem);
    const retryZeroTerminal = withConfigurationEvidenceTerminal(
      workItem,
      'DYNAMIC',
      'CONFLICT',
      reevaluationAttempt(harness.prepared.row, workItem.revision),
      'RETRY_ZERO_CONFLICT',
    );
    const retryOne = retryConfigurationEvidenceReevaluationStage({
      workItem: retryZeroTerminal,
      stage: 'DYNAMIC',
    });
    harness.setCurrent(retryOne);
    harness.attempts.finishProjectionConflict.mockResolvedValueOnce({
      attemptRef: ATTEMPT_REF,
      status: 'CONFLICT',
      projectionApplied: false,
      terminalReason: 'WORK_ITEM_CAS_CONFLICT_AFTER_COMMIT_START',
    });

    await expect(
      harness.service.commit(
        ATTEMPT_REF,
        LEASE_TOKEN,
        1,
        dynamicResult(harness.prepared.task),
      ),
    ).resolves.toMatchObject({ status: 'CONFLICT' });

    expect(harness.registrar.compareAndSet).not.toHaveBeenCalled();
    expect(harness.current()).toEqual(retryOne);
  });

  it('does not let retry 0 prepareCommit-race recovery overwrite retry 1 PENDING', async () => {
    const workItem = reevaluationWorkItem();
    const harness = createHarness(workItem);
    const retryZeroTerminal = withConfigurationEvidenceTerminal(
      workItem,
      'DYNAMIC',
      'FAILED',
      reevaluationAttempt(harness.prepared.row, workItem.revision),
      'RETRY_ZERO_FAILED',
    );
    const retryOne = retryConfigurationEvidenceReevaluationStage({
      workItem: retryZeroTerminal,
      stage: 'DYNAMIC',
    });
    harness.setCurrent(retryOne);
    prepareTerminalRace(harness, 'CANCELLED');

    await expect(
      harness.service.commit(
        ATTEMPT_REF,
        LEASE_TOKEN,
        1,
        dynamicResult(harness.prepared.task),
      ),
    ).resolves.toMatchObject({ status: 'CANCELLED' });

    expect(harness.registrar.compareAndSet).not.toHaveBeenCalled();
    expect(harness.current()).toEqual(retryOne);
  });

  it('does not overwrite a terminal Dynamic stage already owned by another attempt', async () => {
    const workItem = reevaluationWorkItem();
    const harness = createHarness(workItem);
    const occupied = withConfigurationEvidenceTerminal(
      workItem,
      'DYNAMIC',
      'FAILED',
      {
        attemptId: 'ATT-DYNAMIC-OTHER',
        attemptRef: 'AQ-DYNAMIC-OTHER',
        inputRevision: workItem.revision,
        baseRevision: workItem.revision,
      },
      'OTHER_ATTEMPT_FAILED',
    );
    harness.setCurrent(occupied);
    harness.prepared.row.status = 'WAITING_INPUT';
    harness.prepared.row.terminalReason = 'LATE_ATTEMPT_TERMINAL';

    await expect(
      harness.service.commit(
        ATTEMPT_REF,
        LEASE_TOKEN,
        1,
        dynamicResult(harness.prepared.task),
      ),
    ).resolves.toMatchObject({ status: 'WAITING_INPUT' });

    expect(harness.registrar.compareAndSet).not.toHaveBeenCalled();
    expect(harness.current()).toEqual(occupied);
  });

  it('accepts a legacy P0B task without retry binding only at its exact base revision', async () => {
    const workItem = reevaluationWorkItem();
    const harness = createHarness(workItem, { legacyReevaluationTask: true });
    harness.prepared.row.status = 'WAITING_INPUT';
    harness.prepared.row.terminalReason = 'LEGACY_WAITING_INPUT';

    await expect(
      harness.service.commit(
        ATTEMPT_REF,
        LEASE_TOKEN,
        1,
        dynamicResult(harness.prepared.task),
      ),
    ).resolves.toMatchObject({ status: 'WAITING_INPUT' });

    expect(harness.current().configurationEvidenceReevaluation).toMatchObject({
      status: 'WAITING_INPUT',
      stages: {
        dynamic: {
          status: 'WAITING_INPUT',
          terminal: { code: 'LEGACY_WAITING_INPUT' },
        },
      },
    });
  });

  it('fails closed instead of writing a legacy P0B task after revision drift', async () => {
    const workItem = reevaluationWorkItem();
    const harness = createHarness(workItem, { legacyReevaluationTask: true });
    const drifted = {
      ...structuredClone(workItem),
      revision: workItem.revision + 1,
    };
    harness.setCurrent(drifted);
    harness.prepared.row.status = 'WAITING_INPUT';
    harness.prepared.row.terminalReason = 'LATE_LEGACY_TERMINAL';

    await expect(
      harness.service.commit(
        ATTEMPT_REF,
        LEASE_TOKEN,
        1,
        dynamicResult(harness.prepared.task),
      ),
    ).resolves.toMatchObject({ status: 'WAITING_INPUT' });

    expect(harness.registrar.compareAndSet).not.toHaveBeenCalled();
    expect(harness.current()).toEqual(drifted);
    expect(harness.current().configurationEvidenceReevaluation).toMatchObject({
      status: 'RUNNING',
      stages: { dynamic: { status: 'PENDING', retryNo: 0 } },
    });
  });

  it('advances a terminal P0B marker before reserving a new Dynamic attempt', async () => {
    const workItem = reevaluationWorkItem();
    const terminal = withConfigurationEvidenceTerminal(
      workItem,
      'DYNAMIC',
      'FAILED',
      reevaluationAttempt(actionRow(taskEnvelope(workItem)), workItem.revision),
      'PREVIOUS_DYNAMIC_FAILED',
    );
    const harness = createHarness(terminal);

    const begun = await harness.service.begin(WORK_ITEM_ID);

    expect(harness.registrar.compareAndSet).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: terminal.revision,
        syncPrimaryAttempt: false,
      }),
    );
    expect(harness.attempts.reserveAndClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        inputRevision: terminal.revision + 1,
        baseRevision: terminal.revision + 1,
      }),
    );
    expect(begun.task.modelInput).toMatchObject({
      configurationEvidenceReevaluationBinding: {
        triggerSnapshotId: 'CONFIG-SNAPSHOT-P0B',
        triggerConfigurationRevision: 2,
        retryNo: 1,
      },
    });
    expect(harness.current().configurationEvidenceReevaluation).toMatchObject({
      status: 'REQUIRED',
      stages: { dynamic: { status: 'PENDING', retryNo: 1 } },
    });
  });
});

function createHarness(
  workItem = workItemProjection(),
  options: { legacyReevaluationTask?: boolean } = {},
) {
  let currentWorkItem = workItem;
  const task = taskEnvelope(workItem, !options.legacyReevaluationTask);
  const row = actionRow(task);
  const prepared = { row, task, result: dynamicResult(task), recovery: false };
  const registrar = {
    getTenantScopedByWorkItemId: jest.fn(async () => currentWorkItem),
    compareAndSet: jest.fn(
      async (input: {
        expectedRevision: number;
        next: Omit<CanonicalWorkItemProjection, 'revision'>;
      }) => {
        const updated = {
          ...input.next,
          revision: input.expectedRevision + 1,
        } satisfies CanonicalWorkItemProjection;
        currentWorkItem = updated;
        return updated;
      },
    ),
  };
  const documentVersions = {
    resolve: jest.fn(async () => dmResolvedSource()),
  };
  const artifactStore = {
    persistAndReadback: jest.fn(async (bytes: Uint8Array) => ({
      artifact: artifact('artifact://dynamic-output', bytes.byteLength),
      actualBytes: bytes,
      reused: false,
    })),
  };
  const assessment = {
    prepareDynamicRulesCandidateWithRuleSet: jest.fn(async () => ({
      dynamicRulesInput: {},
      overall: { transport: {} },
    })),
  };
  const processor = {
    buildRequest: jest.fn(
      (
        _dynamicInput: unknown,
        _transport: unknown,
        _privateEnvelope: unknown,
        _triggerRequestId: unknown,
      ) => ({
        privateEnvelope: {
          callerCorrelationRef: 'REQ-DYNAMIC-REAL',
          correlation: {},
        },
        modelInput: {
          purpose: 'EVALUATE_DYNAMIC_RULES',
          expectedSelfCheck: { criterionSetId: 'JACS-DYNAMIC-2' },
        },
      }),
    ),
    consumeOutput: jest.fn(() => ({
      ruleResults: [{ sourceRefs: ['SRC-1'] }, { sourceRefs: ['SRC-2'] }],
      overallSelfCheck: { rulesWithMissingInputs: 1 },
      criterionCount: 2,
    })),
  };
  const attempts = {
    reserveAndClaim: jest.fn(
      async (input: {
        inputRevision: number;
        baseRevision: number;
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
          task: {
            ...task,
            inputRevision: input.inputRevision,
            baseRevision: input.baseRevision,
            modelInput,
          },
          created: true,
          triggerRequestId: 'REQ-DYNAMIC-REAL',
        };
      },
    ),
    readScoped: jest.fn(async () => row),
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
    projectTerminal: jest.fn((attemptRow: ActionAttemptRow) => ({
      attemptRef: attemptRow.operationRef,
      status: attemptRow.status,
      projectionApplied: attemptRow.projectionApplied,
      terminalReason: attemptRow.terminalReason,
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
  const ruleSets = {
    readActiveRuntime: jest.fn(async () => RULE_SET_RUNTIME),
    readRuntimeSnapshotAtActivation: jest.fn(async () => RULE_SET_RUNTIME),
  };
  const engineerReviews = {
    assertLedgerCompatibleWithDynamicBytes: jest.fn(),
  };
  const service = new CanonicalHostOpenClawDynamicEvaluationService(
    registrar as never,
    artifactStore as never,
    assessment as never,
    processor as never,
    engineerReviews as never,
    attempts as never,
    ruleSets as never,
    scope as never,
    documentVersions as never,
  );
  return {
    service,
    workItem,
    prepared,
    registrar,
    artifactStore,
    assessment,
    processor,
    attempts,
    ruleSets,
    scope,
    documentVersions,
    engineerReviews,
    current: () => currentWorkItem,
    setCurrent: (next: CanonicalWorkItemProjection) => {
      currentWorkItem = next;
    },
  };
}

type PrepareCommitRaceStatus =
  | 'CANCELLED'
  | 'TIMED_OUT'
  | 'OBSOLETE'
  | 'CONFLICT';

function prepareTerminalRace(
  harness: ReturnType<typeof createHarness>,
  status: PrepareCommitRaceStatus,
): void {
  const preflightRow: ActionAttemptRow = {
    ...harness.prepared.row,
    status: 'RUNNING',
  };
  const terminalRow: ActionAttemptRow = {
    ...harness.prepared.row,
    status,
    terminalReason: `PREPARE_RACE_${status}`,
    resultEnvelopeJson: null,
    resultContentHash: null,
    completedAt: new Date('2026-08-24T10:00:01.000Z'),
  };
  harness.attempts.readScoped.mockReset();
  harness.attempts.readScoped
    .mockResolvedValueOnce(preflightRow)
    .mockResolvedValueOnce(terminalRow);
  harness.attempts.prepareCommit.mockRejectedValueOnce(
    new Error(`ACTION_ATTEMPT_${status}`),
  );
}

function laterAdoptionWorkItem(
  oldCycle: CanonicalWorkItemProjection,
): CanonicalWorkItemProjection {
  const revision = oldCycle.revision + 1;
  return {
    ...structuredClone(oldCycle),
    revision,
    configurationEvidenceCurrent: {
      ...structuredClone(oldCycle.configurationEvidenceCurrent!),
      snapshotId: 'CONFIG-SNAPSHOT-P0B-LATER',
      configurationRevision: 3,
    },
    configurationEvidenceReevaluation: createConfigurationEvidenceReevaluation({
      triggerSnapshotId: 'CONFIG-SNAPSHOT-P0B-LATER',
      triggerConfigurationRevision: 3,
      adoptionWorkItemRevision: revision,
    }),
  };
}

function dmResolvedSource() {
  return {
    version: {
      documentId: 'DOC-DYNAMIC',
      documentVersionId: 'DV-DYNAMIC',
      sourceArtifactId: 'SOURCE-ARTIFACT',
      pdfSha256: 'b'.repeat(64),
      byteLength: 100,
    },
    artifact: {
      sourceArtifactId: 'SOURCE-ARTIFACT',
      sha256: 'b'.repeat(64),
      byteLength: 100,
    },
    family: {
      documentFamily: 'SB',
      issuerAuthority: 'BOEING',
    },
    preflight: {
      normalizedDescriptorJson: JSON.stringify({
        adapterRelease: {
          adapterId: 'issuer.boeing.service_bulletin.v1',
          adapterVersion: 'v8.4-document-family-adapter.v1',
        },
      }),
    },
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

function reevaluationWorkItem(): CanonicalWorkItemProjection {
  const oldBaseRules: CanonicalBaseRuleCandidateProjection = {
    status: 'CANDIDATE_ONLY',
    revision: 1,
    sourceResultId: 'openclaw-dynamic://OLD',
    criterionSetId: 'JACS-DYNAMIC-2',
    criterionCount: 1,
    evaluationItemCount: 1,
    unresolvedCount: 0,
    sourceBoundCandidateCount: 1,
    artifact: artifact('artifact://old-dynamic'),
    actionAttemptId: 'ATT-DYNAMIC-OLD',
  };
  const initial: CanonicalWorkItemProjection = {
    ...workItemProjection(),
    applicabilityInput: p0bApplicabilityInput('SERVING'),
    applicability: p0bApplicability('SERVING', 'ATT-APP-SERVING'),
    integratedAssessment: {
      status: 'OVERALL_CANDIDATE_READY',
      baseRules: oldBaseRules,
      overallSynthesis: {
        status: 'CANDIDATE_ONLY',
        revision: 1,
        sourceResultId: 'openclaw-overall://OLD',
        basedOnBaseRuleRevision: oldBaseRules.revision,
        basedOnBaseRuleArtifactSha256: oldBaseRules.artifact.sha256,
        basedOnEngineerReviewRevision: null,
        basedOnEngineerReviewArtifactSha256: null,
        discoveryStatus: 'NO_DISCOVERY',
        gap: null,
        candidateRefCount: 1,
        findingCount: 1,
        unresolvedCount: 0,
        authorityLevel: 'candidate_only',
        externalDiscoveryIsEvidence: false,
        artifact: artifact('artifact://old-overall'),
        actionAttemptId: 'ATT-OVERALL-OLD',
        staleReason: null,
      },
      engineerReviews: null,
      overallForAeoConfirmation: null,
    },
    configurationEvidenceCurrent: {
      schemaVersion: 'wiselink.3_1.configuration_evidence_work_item_current.v1',
      snapshotId: 'CONFIG-SNAPSHOT-P0B',
      configurationRevision: 2,
      aircraftAssetId: 'AIRCRAFT-P0B',
      assessmentAsOf: '2026-09-04',
      sourceCompleteness: 'COMPLETE',
      truthSummary: {
        trueCount: 1,
        falseCount: 0,
        unknownCount: 0,
        conflictCount: 0,
      },
      recordedAt: '2026-09-04T00:00:00.000Z',
      authority: 'WORK_ITEM_CURRENT_EVIDENCE_VIEW',
      globalAircraftCurrentChanged: false,
    },
    configurationEvidenceReevaluation: createConfigurationEvidenceReevaluation({
      triggerSnapshotId: 'CONFIG-SNAPSHOT-P0B',
      triggerConfigurationRevision: 2,
      adoptionWorkItemRevision: 5,
    }),
    aeo: { status: 'CANDIDATE_AUTHORING_IN_PROGRESS' } as never,
  };
  const withInput = withStagedApplicabilityInput(
    initial,
    p0bApplicabilityInput('P0B'),
  );
  return withStagedApplicability(
    withInput,
    p0bApplicability('P0B', 'ATT-APP-P0B'),
    {
      attemptId: 'ATT-APP-P0B',
      attemptRef: 'AQ-APP-P0B',
      inputRevision: withInput.revision,
      baseRevision: withInput.revision,
    },
  );
}

function p0bApplicabilityInput(
  identity: 'SERVING' | 'P0B',
): CanonicalApplicabilityInputProjection {
  return {
    schemaVersion: 'wiselink.3_1.applicability_input_projection.v1',
    applicabilityContextRef: `APCTX-${identity}`,
    workItemId: WORK_ITEM_ID,
    documentVersionId: 'DV-DYNAMIC',
    sourcePackageId: 'PKG-DYNAMIC',
    sourcePackageContentHash: 'c'.repeat(64),
    sourcePackageArtifactSha256: 'a'.repeat(64),
    targetBindingHash: `TARGET-${identity}`,
    selectionRevision: `SELECTION-${identity}`,
    bindingRevision: `BINDING-${identity}`,
    currentness: 'CURRENT',
    aircraftNumber: 'B-2035',
    assessmentAsOf: '2026-09-04',
    fleetMasterData: {
      schemaVersion: 'wiselink.v3_1.applicability_fleet.fleet_master_data.v1',
      sourceSnapshotId: `FLEET-${identity}`,
      sourceRevisionKey: `FLEET-REV-${identity}`,
      authorityRevision: `AUTH-${identity}`,
      sourceAsOf: '2026-09-04',
      assets: [],
      facts: [],
    },
  };
}

function p0bApplicability(
  identity: 'SERVING' | 'P0B',
  actionAttemptId: string,
): CanonicalApplicabilityCandidateProjection {
  const input = p0bApplicabilityInput(identity);
  return {
    schemaVersion: 'wiselink.3_1.applicability_candidate_projection.v1',
    status: 'CANDIDATE_ONLY',
    currentness: 'CURRENT',
    staleReason: null,
    sourceResultId: `openclaw-applicability://${identity}`,
    actionAttemptId,
    inputRevision: 5,
    documentId: 'DOC-DYNAMIC',
    documentVersionId: 'DV-DYNAMIC',
    sourcePackageId: 'PKG-DYNAMIC',
    sourcePackageContentHash: 'c'.repeat(64),
    translationActionAttemptId: 'ATT-TRANSLATION',
    applicabilityContextRef: input.applicabilityContextRef,
    applicabilityBindingRevision: input.bindingRevision,
    aircraftNumber: input.aircraftNumber,
    assessmentAsOf: input.assessmentAsOf,
    fleetSourceSnapshotId: input.fleetMasterData.sourceSnapshotId!,
    fleetSourceRevisionKey: input.fleetMasterData.sourceRevisionKey!,
    fleetAuthorityRevision: input.fleetMasterData.authorityRevision!,
    fleetSourceAsOf: input.fleetMasterData.sourceAsOf!,
    sourceExpressionCount: 1,
    sourceRefCount: 1,
    decision: 'APPLICABLE',
    kleeneResult: true,
    pass: true,
    blockingUnknownCount: 0,
    artifact: artifact(`artifact://applicability-${identity}`),
  };
}

function committedP0bBaseRules(): CanonicalBaseRuleCandidateProjection {
  return {
    status: 'CANDIDATE_ONLY',
    revision: 2,
    sourceResultId: 'openclaw-dynamic://REQ-DYNAMIC-REAL',
    criterionSetId: 'JACS-DYNAMIC-2',
    criterionCount: 2,
    evaluationItemCount: 2,
    unresolvedCount: 1,
    sourceBoundCandidateCount: 2,
    artifact: artifact('artifact://dynamic-output'),
    actionAttemptId: ATTEMPT_ID,
  };
}

function servingFields(workItem: CanonicalWorkItemProjection) {
  return {
    applicabilityInput: workItem.applicabilityInput,
    applicability: workItem.applicability,
    integratedAssessment: workItem.integratedAssessment,
    aeo: workItem.aeo,
  };
}

function reevaluationAttempt(
  row: ActionAttemptRow,
  baseRevision: number,
): CanonicalConfigurationEvidenceReevaluationAttemptBinding {
  return {
    attemptId: row.attemptId,
    attemptRef: row.operationRef!,
    inputRevision: baseRevision,
    baseRevision,
  };
}

function taskEnvelope(
  workItem: CanonicalWorkItemProjection,
  includeReevaluationBinding = true,
) {
  const reevaluation = workItem.configurationEvidenceReevaluation;
  const reevaluationBinding =
    includeReevaluationBinding &&
    reevaluation?.schemaVersion ===
      'wiselink.3_1.configuration_evidence_reevaluation.v2'
      ? {
          configurationEvidenceReevaluationBinding: {
            triggerSnapshotId: reevaluation.triggerSnapshotId,
            triggerConfigurationRevision:
              reevaluation.triggerConfigurationRevision,
            retryNo: reevaluation.stages.dynamic.retryNo,
          },
        }
      : {};
  return sealTaskEnvelope({
    schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
    actionAttemptId: ATTEMPT_ID,
    operationRef: ATTEMPT_REF,
    taskType: 'OPENCLAW_DYNAMIC_EVALUATION',
    priority: 100,
    tenantId: 'tenant-dynamic',
    workItemId: WORK_ITEM_ID,
    inputRevision: workItem.revision,
    baseRevision: workItem.revision,
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
      ruleSetBinding: ruleSetBinding(RULE_SET_RUNTIME),
      ...reevaluationBinding,
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
    modelVersion: 'official-provider/model-release-2',
    promptVersion: 'dynamic-prompt-v1',
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
    inputRevision: task.inputRevision,
    baseRevision: task.baseRevision,
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

const RULE_SET_RUNTIME = ruleSetRuntime('JACS-DYNAMIC-2', 1);

function ruleSetRuntime(snapshotId: string, headRevision: number) {
  return {
    snapshotId,
    headRevision,
    rulePack: { criteria: [] },
    rulePackHash: '1'.repeat(64),
    rulePackVersion: '0.2',
    artifactRef: `artifact://rule-set/${snapshotId}`,
    artifactDigest: `sha256:${'1'.repeat(64)}`,
    artifactVersion: `version:${snapshotId}`,
    criterionSet: {
      criterionSetId: snapshotId,
      criterionSetHash: `sha256:${'2'.repeat(64)}`,
      memberIdentityHash: `sha256:${'3'.repeat(64)}`,
      criteriaCount: 150,
      lifecycleStatus: 'ACTIVE' as const,
    },
  };
}

function ruleSetBinding(runtime: ReturnType<typeof ruleSetRuntime>) {
  return {
    schemaVersion: 'wiselink.3_1.dynamic_rule_set_binding.v1' as const,
    snapshotId: runtime.snapshotId,
    criterionSetId: runtime.criterionSet.criterionSetId,
    criterionSetHash: runtime.criterionSet.criterionSetHash,
    memberIdentityHash: runtime.criterionSet.memberIdentityHash,
    criteriaCount: runtime.criterionSet.criteriaCount,
    rulePackVersion: runtime.rulePackVersion,
    artifactRef: runtime.artifactRef,
    artifactDigest: runtime.artifactDigest,
    artifactVersion: runtime.artifactVersion,
    activationRevision: runtime.headRevision,
  };
}
