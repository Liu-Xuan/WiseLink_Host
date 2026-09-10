import type {
  CanonicalApplicabilityCandidateProjection,
  CanonicalApplicabilityInputProjection,
  CanonicalBaseRuleCandidateProjection,
  CanonicalIntegratedAssessmentProjection,
  CanonicalTranslationCandidateProjection,
  CanonicalWorkItemProjection,
  UnifiedPackageArtifactDescriptor,
} from '@shared/api.interface';

import {
  projectCanonicalHostInitialAnalysisStatus,
  initialAnalysisTerminalCode,
  canContinueInitialStage,
  CanonicalHostInitialAnalysisStatusService,
  type CanonicalInitialAnalysisAttemptObservation,
} from '../../server/modules/canonical-host/canonical-host-initial-analysis-status.service';
import {
  CANONICAL_TRANSLATION_RULE_SET_V1_ID,
  CANONICAL_TRANSLATION_RULE_SET_V1_VERSION,
} from '../../server/modules/canonical-host/canonical-translation-rule-set-v1.private';
import {
  activeConfigurationEvidenceReevaluation,
  createConfigurationEvidenceReevaluation,
  withConfigurationEvidenceTerminal,
  withStagedApplicability,
  withStagedApplicabilityInput,
  withStagedBaseRules,
} from '../../server/modules/canonical-host/configuration-evidence/configuration-evidence-reevaluation.state';
import * as automaticScope from '../../server/modules/canonical-host/configured-development-service-scope.authorization';

const HASH = `sha256:${'a'.repeat(64)}`;
const OTHER_HASH = `sha256:${'b'.repeat(64)}`;

describe('CanonicalHost initial-analysis status projection', () => {
  it('reconciles an orphaned RUNNING deadline before projecting progress without generating a successor', async () => {
    const workItem = parsedWorkItem();
    const row = { ...attempt('OPENCLAW_DYNAMIC_EVALUATION', 'RUNNING'),
      terminalReason: null, errorCode: null, cancelReason: null, executionModelJson: null,
      idempotencyKey: 'synthetic-existing-request', deadlineAt: new Date(Date.now() - 1000) };
    const orderBy = jest.fn().mockResolvedValue([row]);
    const reconcileRunningDeadline = jest.fn().mockResolvedValue({ ...row, status: 'TIMED_OUT', terminalReason: 'ACTION_ATTEMPT_DEADLINE_EXCEEDED' });
    const service = new CanonicalHostInitialAnalysisStatusService({
      selectDistinctOn: () => ({ from: () => ({ where: () => ({ orderBy }) }) }),
    } as never, { reconcileRunningDeadline } as never);
    const value = await service.project({ workItem, tenantId: 'tenant-1' });
    expect(reconcileRunningDeadline).toHaveBeenCalledTimes(1);
    expect(reconcileRunningDeadline).toHaveBeenCalledWith({ attemptRef: row.attemptRef, tenantId: 'tenant-1', workItemId: workItem.workItemId });
    expect(value.stages.jobAid).toMatchObject({ status: 'FAILED', attemptStatus: 'TIMED_OUT', terminalCode: 'ACTION_ATTEMPT_DEADLINE_EXCEEDED' });
  });

  it('recognizes the active staged JobAid success while preserving serving results and schedules this cycle Overall', () => {
    const workItem = stagedReevaluationWorkItem();
    const serving = structuredClone(workItem.integratedAssessment);
    const marker = activeConfigurationEvidenceReevaluation(workItem)!;
    const current = {
      ...attempt('OPENCLAW_DYNAMIC_EVALUATION', 'SUCCEEDED'),
      attemptId: marker.stages.dynamic.attempt!.attemptId,
      baseRevision: marker.stages.dynamic.attempt!.baseRevision,
      requestId: 'p0b-jobaid-successor',
    };

    const result = projectCanonicalHostInitialAnalysisStatus(workItem, [
      current,
    ]);

    expect(result).toMatchObject({
      workItemRevision: workItem.revision,
      applicabilityContextRef: 'applicability-context-staged',
      status: 'REQUIRED',
      nextOperation: 'SYNTHESIZE_OVERALL',
      stages: {
        applicability: { status: 'SUCCEEDED' },
        jobAid: {
          status: 'SUCCEEDED',
          attemptStatus: 'SUCCEEDED',
          attemptRef: current.attemptRef,
        },
        overall: { status: 'PENDING' },
      },
    });
    expect(workItem.integratedAssessment).toEqual(serving);
    expect(serving!.baseRules.actionAttemptId).not.toBe(current.attemptId);
  });

  it('does not carry an old failed request into the pending P0B stage at a new revision', () => {
    const workItem = applicabilityStagedWorkItem();
    const old = {
      ...attempt('OPENCLAW_DYNAMIC_EVALUATION', 'FAILED'),
      baseRevision: workItem.revision - 1,
      requestId: 'older-failed-request',
    };
    expect(
      projectCanonicalHostInitialAnalysisStatus(workItem, [old]),
    ).toMatchObject({
      nextOperation: 'EVALUATE_JOBAID',
      stages: { jobAid: { status: 'PENDING', attemptRef: null } },
    });
    const queued = {
      ...old,
      status: 'QUEUED',
      baseRevision: workItem.revision,
      requestId: 'new-p0b-request',
    };
    expect(
      projectCanonicalHostInitialAnalysisStatus(workItem, [queued]),
    ).toMatchObject({
      nextOperation: 'EVALUATE_JOBAID',
      stages: {
        jobAid: {
          status: 'PENDING',
          attemptStatus: 'QUEUED',
          requestId: queued.requestId,
        },
      },
    });
    expect(old.status).toBe('FAILED');
  });

  it('keeps P0B applicability WAITING_INPUT strictly blocking despite an older successful serving applicability', () => {
    const workItem = withConfigurationEvidenceTerminal(
      reevaluationWithInput(),
      'APPLICABILITY',
      'WAITING_INPUT',
      null,
      'CONTROLLED_FACTS_REQUIRED',
    );
    const result = projectCanonicalHostInitialAnalysisStatus(workItem, [], {
      englishAssessmentEnabled: true,
    });
    expect(workItem.applicability!.status).toBe('CANDIDATE_ONLY');
    expect(result).toMatchObject({
      status: 'WAITING_INPUT',
      nextOperation: null,
      stages: {
        applicability: {
          status: 'WAITING_INPUT',
          terminalCode: 'CONTROLLED_FACTS_REQUIRED',
        },
        jobAid: { status: 'PENDING' },
        overall: { status: 'PENDING' },
      },
    });
    expect(
      canContinueInitialStage(result.stages, 'EVALUATE_JOBAID', true, workItem),
    ).toBe(false);
    expect(
      canContinueInitialStage(
        {
          ...result.stages,
          applicability: {
            ...result.stages.applicability,
            status: 'SUCCEEDED',
          },
        },
        'EVALUATE_JOBAID',
        true,
        workItem,
      ),
    ).toBe(false);
  });

  it.each([
    ['OPENCLAW_DYNAMIC_EVALUATION', 'jobAid'],
    ['OPENCLAW_OVERALL_SYNTHESIS', 'overall'],
  ] as const)(
    'preserves explicit %s WAITING_INPUT beside the retained candidate',
    (actionType, stage) => {
      const workItem = {
        ...translatedWorkItem(parsedWorkItem()),
        integratedAssessment: integratedAssessment(),
      };
      const waiting = {
        ...attempt(actionType, 'WAITING_INPUT'),
        requestId: 'waiting-request',
      };
      const result = projectCanonicalHostInitialAnalysisStatus(workItem, [
        waiting,
      ]);
      expect(result.stages[stage]).toMatchObject({
        status: 'WAITING_INPUT',
        attemptStatus: 'WAITING_INPUT',
        requestId: waiting.requestId,
        terminalCode: 'TERMINAL_WAITING_INPUT',
      });
    },
  );

  it.each([
    ['translation', 'BUSY'],
    ['applicability', 'FAILED'],
    ['applicability', 'CONFLICT'],
  ] as const)(
    'rejects continuation when prerequisite %s is %s',
    (stage, status) => {
      const stages = projectCanonicalHostInitialAnalysisStatus(
        translatedWorkItem(parsedWorkItem()),
        [],
      ).stages;
      stages.jobAid = { ...stages.jobAid, status: 'SUCCEEDED' };
      stages[stage] = { ...stages[stage], status };
      expect(canContinueInitialStage(stages, 'EVALUATE_JOBAID', true)).toBe(
        false,
      );
      expect(canContinueInitialStage(stages, 'SYNTHESIZE_OVERALL', true)).toBe(
        false,
      );
    },
  );

  it('allows ordinary applicability waiting but requires this P0B JobAid success before Overall continuation', () => {
    const ordinary = translatedWorkItem(parsedWorkItem());
    const stages = projectCanonicalHostInitialAnalysisStatus(
      ordinary,
      [],
    ).stages;
    expect(stages.applicability.status).toBe('WAITING_INPUT');
    expect(
      canContinueInitialStage(stages, 'EVALUATE_JOBAID', true, ordinary),
    ).toBe(true);
    const p0b = applicabilityStagedWorkItem();
    const p0bStages = projectCanonicalHostInitialAnalysisStatus(p0b, []).stages;
    expect(
      canContinueInitialStage(p0bStages, 'EVALUATE_JOBAID', true, p0b),
    ).toBe(true);
    expect(
      canContinueInitialStage(
        { ...p0bStages, jobAid: { ...p0bStages.jobAid, status: 'SUCCEEDED' } },
        'SYNTHESIZE_OVERALL',
        true,
        p0b,
      ),
    ).toBe(false);
  });

  it('offers Overall recovery from staged v2 work even when the preserved serving base is legacy', async () => {
    const staged = stagedReevaluationWorkItem();
    const workItem = withConfigurationEvidenceTerminal(
      staged,
      'OVERALL',
      'FAILED',
      configurationAttempt('attempt-overall-staged', staged.revision),
      'OVERALL_MODEL_FAILED',
    );
    const model = await browserStatus(workItem, [
      {
        ...attempt('OPENCLAW_OVERALL_SYNTHESIS', 'FAILED'),
        attemptId: 'attempt-overall-staged',
        requestId: 'p0b-overall-failed',
        baseRevision: staged.revision,
      },
    ]);
    expect(model.continuationOperations).toEqual(['SYNTHESIZE_OVERALL']);
    expect(workItem.integratedAssessment!.baseRules).not.toHaveProperty(
      'schemaVersion',
    );
  });

  it('offers browser JobAid recovery only for a confirmed SB', async () => {
    const workItem = translatedWorkItem(parsedWorkItem());
    const failed = [
      {
        ...attempt('OPENCLAW_DYNAMIC_EVALUATION', 'FAILED'),
        requestId: 'job-failed',
      },
    ];
    expect(
      (await browserStatus(workItem, failed)).continuationOperations,
    ).toEqual(['EVALUATE_JOBAID']);
    const candidate = {
      ...workItem,
      classification: {
        ...workItem.classification,
        status: 'CANDIDATE' as const,
      },
    };
    expect(
      (await browserStatus(candidate, failed)).continuationOperations,
    ).toEqual([]);
    const otherFamily = {
      ...workItem,
      classification: {
        ...workItem.classification,
        normalizedFamily: 'FTD' as const,
      },
    };
    expect(
      (await browserStatus(otherFamily, failed)).continuationOperations,
    ).toEqual([]);
  });

  it('offers an explicitly queued successor without disguising the retained older candidate as its success', () => {
    const workItem = translatedWorkItem(parsedWorkItem());
    const retained = structuredClone(workItem.translation);
    const queued = {
      ...attempt('OPENCLAW_TRANSLATE', 'QUEUED'),
      attemptId: 'attempt-successor',
      requestId: 'normal-successor',
    };
    expect(
      projectCanonicalHostInitialAnalysisStatus(workItem, [queued]),
    ).toMatchObject({
      status: 'REQUIRED',
      nextOperation: 'TRANSLATE',
      stages: {
        translation: {
          status: 'PENDING',
          attemptStatus: 'QUEUED',
          requestId: 'normal-successor',
        },
      },
    });
    expect(
      projectCanonicalHostInitialAnalysisStatus(workItem, [
        { ...queued, status: 'RUNNING' },
      ]),
    ).toMatchObject({
      status: 'BUSY',
      nextOperation: null,
    });
    expect(
      projectCanonicalHostInitialAnalysisStatus(workItem, [
        { ...queued, status: 'CANCELLED' },
      ]),
    ).toMatchObject({
      status: 'FAILED',
      nextOperation: null,
    });
    expect(workItem.translation).toEqual(retained);
  });
  it('keeps verified-English applicability current without a translation and after translation changes', () => {
    const workItem = translatedWorkItem(parsedWorkItem());
    workItem.applicabilityInput = applicabilityInput(workItem);
    workItem.applicability = {
      ...applicabilityCandidate(
        workItem,
        workItem.applicabilityInput,
        'CANDIDATE_ONLY',
      ),
      schemaVersion: 'wiselink.3_1.applicability_candidate_projection.v2',
      sourceReadingMode: 'VERIFIED_ENGLISH',
      translationActionAttemptId: null,
    };
    const priorTranslation = workItem.translation;
    delete workItem.translation;
    expect(
      projectCanonicalHostInitialAnalysisStatus(workItem, []).stages
        .applicability.status,
    ).toBe('SUCCEEDED');
    workItem.translation = {
      ...priorTranslation!,
      actionAttemptId: 'later-translation-attempt',
    };
    expect(
      projectCanonicalHostInitialAnalysisStatus(workItem, []).stages
        .applicability.status,
    ).toBe('SUCCEEDED');
    workItem.applicability.sourcePackageContentHash = OTHER_HASH;
    expect(
      projectCanonicalHostInitialAnalysisStatus(workItem, []).stages
        .applicability.status,
    ).not.toBe('SUCCEEDED');
  });

  it('recognizes a saved semantic translation candidate while keeping its partial scope explicit', () => {
    const workItem = translatedWorkItem(parsedWorkItem());
    workItem.translation = {
      ...workItem.translation!,
      schemaVersion: 'wiselink.3_1.translation_candidate_projection.v2',
      workspaceId: 'TW-test',
      planRevision: 1,
      contextRevision: 1,
      completeness: 'PARTIAL',
      ruleSetId: 'semantic-translation',
      ruleSetVersion: '2.0',
      pendingTranslationUnitCount: 1,
      validationVerdict: 'REVIEW_REQUIRED',
    };
    expect(
      projectCanonicalHostInitialAnalysisStatus(workItem, []),
    ).toMatchObject({
      nextOperation: 'EVALUATE_JOBAID',
      stages: {
        translation: {
          status: 'SUCCEEDED',
          terminalCode: 'TRANSLATION_PARTIAL_CANDIDATE_SAVED',
        },
      },
    });
  });

  it('only the enabled direct English path advances beyond failed translation and retains the failure', () => {
    const workItem = parsedWorkItem();
    const failed = attempt('OPENCLAW_TRANSLATE', 'CANCELLED');
    expect(
      projectCanonicalHostInitialAnalysisStatus(workItem, [failed])
        .nextOperation,
    ).toBeNull();
    expect(
      projectCanonicalHostInitialAnalysisStatus(workItem, [failed], {
        englishAssessmentEnabled: true,
      }),
    ).toMatchObject({
      nextOperation: 'EVALUATE_JOBAID',
      stages: { translation: { status: 'FAILED', attemptStatus: 'CANCELLED' } },
    });
    expect(
      projectCanonicalHostInitialAnalysisStatus(
        workItem,
        [attempt('OPENCLAW_TRANSLATE', 'RUNNING')],
        { englishAssessmentEnabled: true },
      ),
    ).toMatchObject({ status: 'BUSY', nextOperation: null });
  });
  it('starts source-based analysis before an unrequested translation, retaining translation as pending', () => {
    const workItem = parsedWorkItem();
    const status = projectCanonicalHostInitialAnalysisStatus(workItem, [], {
      englishAssessmentEnabled: true,
    });
    expect(status).toMatchObject({
      nextOperation: 'EVALUATE_JOBAID',
      stages: {
        translation: { status: 'PENDING' },
        applicability: { status: 'WAITING_INPUT' },
      },
    });
    expect(canContinueInitialStage(status.stages, 'EVALUATE_JOBAID', true)).toBe(true);
    expect(canContinueInitialStage(status.stages, 'EVALUATE_JOBAID', false)).toBe(false);
    expect(projectCanonicalHostInitialAnalysisStatus(workItem, []).nextOperation).toBe('TRANSLATE');
    workItem.applicabilityInput = applicabilityInput(workItem);
    expect(projectCanonicalHostInitialAnalysisStatus(workItem, [], {
      englishAssessmentEnabled: true,
    }).nextOperation).toBe('EXTRACT_APPLICABILITY');
  });

  it('honors an explicitly queued translation and waits for it before starting source analysis', () => {
    const workItem = parsedWorkItem();
    const queued = {
      ...attempt('OPENCLAW_TRANSLATE', 'QUEUED'),
      requestId: 'explicit-translation',
    };
    expect(projectCanonicalHostInitialAnalysisStatus(workItem, [queued], {
      englishAssessmentEnabled: true,
    }).nextOperation).toBe('TRANSLATE');
    expect(projectCanonicalHostInitialAnalysisStatus(workItem, [{
      ...queued, status: 'RUNNING',
    }], { englishAssessmentEnabled: true })).toMatchObject({
      status: 'BUSY', nextOperation: null,
    });
  });
  it('keeps missing aircraft selection explicit without blocking document-level candidates', () => {
    const workItem = translatedWorkItem(parsedWorkItem());
    const status = projectCanonicalHostInitialAnalysisStatus(workItem, []);
    expect(status).toMatchObject({
      status: 'WAITING_INPUT',
      nextOperation: 'EVALUATE_JOBAID',
      applicabilityContextRef: null,
      stages: {
        applicability: {
          status: 'WAITING_INPUT',
          attemptRef: null,
          terminalCode: 'APPLICABILITY_SELECTION_REQUIRED',
        },
      },
    });
    expect(workItem.applicability).toBeUndefined();
    const failed = projectCanonicalHostInitialAnalysisStatus(workItem, [
      attempt('OPENCLAW_APPLICABILITY_EVALUATION', 'FAILED'),
    ]);
    expect(failed.status).toBe('FAILED');
    expect(failed.nextOperation).toBeNull();
  });

  it('keeps browser progress free of attempt and applicability control references', async () => {
    const limit = jest.fn().mockResolvedValue([{ model: null }]);
    const service = new CanonicalHostInitialAnalysisStatusService({
      select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
    } as never, {} as never);
    const workItem = parsedWorkItem();
    jest
      .spyOn(service, 'project')
      .mockResolvedValue(
        projectCanonicalHostInitialAnalysisStatus(workItem, [
          attempt('OPENCLAW_TRANSLATE', 'RUNNING'),
        ]),
      );
    const value = await service.projectForBrowser({
      workItem,
      tenantId: 'tenant-1',
    });
    expect(value.stages.translation.status).toBe('BUSY');
    expect(value.workItemId).toBe(workItem.workItemId);
    expect(JSON.stringify(value)).not.toMatch(
      /attemptRef|attemptStatus|applicabilityContextRef/u,
    );
  });

  it('preserves the bounded executor cause but never emits arbitrary cancellation text', () => {
    const base = { terminalReason: 'CANCELLED_BY_REQUEST', errorCode: null };
    expect(
      initialAnalysisTerminalCode({
        ...base,
        cancelReason:
          'HOSTED_INITIAL_EXECUTION_FAILED:INITIAL_GATEWAY_HTTP_400',
      }),
    ).toBe('INITIAL_GATEWAY_HTTP_400');
    expect(
      initialAnalysisTerminalCode({
        ...base,
        cancelReason:
          'HOSTED_INITIAL_EXECUTION_FAILED:private details and credentials',
      }),
    ).toBe('CANCELLED_BY_REQUEST');
  });

  it('does not offer an operation before the parsed package is current', () => {
    const workItem = parsedWorkItem();
    workItem.phase = 'PARSING';
    workItem.package = null;

    expect(projectCanonicalHostInitialAnalysisStatus(workItem, [])).toEqual({
      workItemRevision: 3,
      documentVersionId: 'DV-initial-1',
      applicabilityContextRef: null,
      status: 'NOT_READY',
      nextOperation: null,
      stages: {
        translation: pendingStage(),
        applicability: pendingStage(),
        jobAid: pendingStage(),
        overall: pendingStage(),
      },
      candidateOnly: true,
    });
  });

  it('offers the first missing operation and reports an active attempt as busy', () => {
    const workItem = parsedWorkItem();
    expect(
      projectCanonicalHostInitialAnalysisStatus(workItem, []),
    ).toMatchObject({ status: 'REQUIRED', nextOperation: 'TRANSLATE' });

    expect(
      projectCanonicalHostInitialAnalysisStatus(workItem, [
        attempt('OPENCLAW_TRANSLATE', 'RUNNING'),
      ]),
    ).toMatchObject({
      status: 'BUSY',
      nextOperation: null,
      stages: {
        translation: {
          status: 'BUSY',
          attemptRef: 'attempt-ref-OPENCLAW_TRANSLATE',
          attemptStatus: 'RUNNING',
        },
      },
    });
  });

  it('never treats a successful attempt without its current projection as success', () => {
    const status = projectCanonicalHostInitialAnalysisStatus(parsedWorkItem(), [
      attempt('OPENCLAW_TRANSLATE', 'SUCCEEDED'),
    ]);

    expect(status).toMatchObject({
      status: 'CONFLICT',
      nextOperation: null,
      stages: {
        translation: {
          status: 'CONFLICT',
          terminalCode: 'SUCCEEDED_ATTEMPT_WITHOUT_CURRENT_PROJECTION',
        },
      },
    });
  });

  it('surfaces a terminal stage failure without scheduling an implicit retry', () => {
    const failed = attempt('OPENCLAW_TRANSLATE', 'FAILED');
    failed.terminalCode = 'TRANSLATION_EXECUTOR_FAILED';

    expect(
      projectCanonicalHostInitialAnalysisStatus(parsedWorkItem(), [failed]),
    ).toMatchObject({
      status: 'FAILED',
      nextOperation: null,
      stages: {
        translation: {
          status: 'FAILED',
          terminalCode: 'TRANSLATION_EXECUTOR_FAILED',
        },
      },
    });
  });

  it('advances beyond either kind of applicability waiting-input terminal', () => {
    const withTranslation = translatedWorkItem(parsedWorkItem());
    const input = applicabilityInput(withTranslation);
    const projectionWaiting = {
      ...withTranslation,
      revision: 5,
      applicabilityInput: input,
      applicability: applicabilityCandidate(
        withTranslation,
        input,
        'WAITING_INPUT',
      ),
    };
    const projected = projectCanonicalHostInitialAnalysisStatus(
      projectionWaiting,
      [],
    );
    expect(projected).toMatchObject({
      status: 'WAITING_INPUT',
      nextOperation: 'EVALUATE_JOBAID',
      applicabilityContextRef: 'applicability-context-initial-1',
      stages: { applicability: { status: 'WAITING_INPUT' } },
    });

    const taskWaiting = projectCanonicalHostInitialAnalysisStatus(
      { ...withTranslation, applicabilityInput: input },
      [attempt('OPENCLAW_APPLICABILITY_EVALUATION', 'WAITING_INPUT')],
    );
    expect(taskWaiting).toMatchObject({
      status: 'WAITING_INPUT',
      nextOperation: 'EVALUATE_JOBAID',
      stages: {
        applicability: {
          status: 'WAITING_INPUT',
          attemptStatus: 'WAITING_INPUT',
        },
      },
    });
  });

  it('does not automatically replay an explicitly stale completed stage', () => {
    const workItem = translatedWorkItem(parsedWorkItem());
    workItem.translation = {
      ...workItem.translation!,
      status: 'STALE',
      currentness: 'STALE',
      staleReason: 'RULE_SET_CHANGED',
    };

    expect(
      projectCanonicalHostInitialAnalysisStatus(workItem, [
        attempt('OPENCLAW_TRANSLATE', 'SUCCEEDED'),
      ]),
    ).toMatchObject({
      status: 'CONFLICT',
      nextOperation: null,
      stages: {
        translation: {
          status: 'CONFLICT',
          terminalCode: 'TRANSLATION_PROJECTION_NOT_CURRENT',
        },
      },
    });
  });

  it('reports completion only from all four current candidate projections', () => {
    const translated = translatedWorkItem(parsedWorkItem());
    const input = applicabilityInput(translated);
    const applicable: CanonicalWorkItemProjection = {
      ...translated,
      revision: 5,
      applicabilityInput: input,
      applicability: applicabilityCandidate(
        translated,
        input,
        'CANDIDATE_ONLY',
      ),
    };
    const complete: CanonicalWorkItemProjection = {
      ...applicable,
      revision: 7,
      integratedAssessment: integratedAssessment(),
    };

    expect(
      projectCanonicalHostInitialAnalysisStatus(complete, []),
    ).toMatchObject({
      status: 'SUCCEEDED',
      nextOperation: null,
      stages: {
        translation: { status: 'SUCCEEDED' },
        applicability: { status: 'SUCCEEDED' },
        jobAid: { status: 'SUCCEEDED' },
        overall: { status: 'SUCCEEDED' },
      },
    });
  });
});

async function browserStatus(
  workItem: CanonicalWorkItemProjection,
  observations: CanonicalInitialAnalysisAttemptObservation[],
) {
  const savedJobAidFlag = process.env.WL_JOBAID_PROBLEM_V2_ENABLED;
  const savedTranslationFlag = process.env.WL_TRANSLATION_V2_ENABLED;
  const automatic = jest
    .spyOn(automaticScope, 'isOpenClawAutomaticReviewConfigured')
    .mockReturnValue(true);
  process.env.WL_JOBAID_PROBLEM_V2_ENABLED = '1';
  process.env.WL_TRANSLATION_V2_ENABLED = '0';
  try {
    const limit = jest.fn().mockResolvedValue([{ model: null }]);
    const service = new CanonicalHostInitialAnalysisStatusService({
      select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
    } as never, {} as never);
    jest.spyOn(service, 'project').mockResolvedValue(
      projectCanonicalHostInitialAnalysisStatus(workItem, observations, {
        englishAssessmentEnabled: true,
      }),
    );
    return await service.projectForBrowser({ workItem, tenantId: 'tenant-1' });
  } finally {
    automatic.mockRestore();
    if (savedJobAidFlag === undefined)
      delete process.env.WL_JOBAID_PROBLEM_V2_ENABLED;
    else process.env.WL_JOBAID_PROBLEM_V2_ENABLED = savedJobAidFlag;
    if (savedTranslationFlag === undefined)
      delete process.env.WL_TRANSLATION_V2_ENABLED;
    else process.env.WL_TRANSLATION_V2_ENABLED = savedTranslationFlag;
  }
}

function configurationAttempt(attemptId: string, revision: number) {
  return {
    attemptId,
    attemptRef: `AQ-${attemptId}`,
    inputRevision: revision,
    baseRevision: revision,
  };
}

function reevaluationWithInput(): CanonicalWorkItemProjection {
  const translated = translatedWorkItem(parsedWorkItem());
  const input = applicabilityInput(translated);
  const current = {
    ...translated,
    revision: 7,
    applicabilityInput: input,
    applicability: applicabilityCandidate(translated, input, 'CANDIDATE_ONLY'),
    integratedAssessment: integratedAssessment(),
    configurationEvidenceCurrent: {
      snapshotId: 'CONFIG-STAGED',
      configurationRevision: 2,
    } as never,
    configurationEvidenceReevaluation: createConfigurationEvidenceReevaluation({
      triggerSnapshotId: 'CONFIG-STAGED',
      triggerConfigurationRevision: 2,
      adoptionWorkItemRevision: 7,
    }),
  };
  return withStagedApplicabilityInput(current, {
    ...input,
    applicabilityContextRef: 'applicability-context-staged',
    bindingRevision: 'binding-staged',
  });
}

function applicabilityStagedWorkItem(): CanonicalWorkItemProjection {
  const workItem = reevaluationWithInput();
  const input =
    activeConfigurationEvidenceReevaluation(workItem)!.stagedBundle
      .applicabilityInput!;
  return withStagedApplicability(
    workItem,
    {
      ...applicabilityCandidate(workItem, input, 'CANDIDATE_ONLY'),
      actionAttemptId: 'attempt-applicability-staged',
    },
    configurationAttempt('attempt-applicability-staged', workItem.revision),
  );
}

function stagedReevaluationWorkItem(): CanonicalWorkItemProjection {
  const workItem = applicabilityStagedWorkItem();
  const base = {
    ...integratedAssessment().baseRules,
    schemaVersion: 'wiselink.jobaid-problem-result.v2',
    actionAttemptId: 'attempt-job-aid-staged',
    sourceResultId: 'openclaw-dynamic://staged',
    workRevisionRef: 'JAWR-STAGED',
    workRevision: 1,
    roundCompletion: 'COMPLETE',
  } as CanonicalBaseRuleCandidateProjection;
  return withStagedBaseRules(
    workItem,
    base,
    configurationAttempt('attempt-job-aid-staged', workItem.revision),
  );
}

function parsedWorkItem(): CanonicalWorkItemProjection {
  return {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: 'WI-initial-1',
    requestId: 'request-initial-1',
    revision: 3,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    permissionSnapshotVersion: 'permission-snapshot-1',
    parseAuthorization: {
      action: 'PARSE_PDF',
      actorFingerprint: HASH,
      decisionId: 'decision-1',
      decisionHash: HASH,
      permissionSnapshotVersion: 'permission-snapshot-1',
    },
    source: {
      documentId: 'DOC-initial-1',
      documentVersionId: 'DV-initial-1',
      parserRequestId: 'parser-request-1',
      sourceArtifactId: 'source-artifact-1',
      sourceFileSha256: HASH,
      sourceByteLength: 1024,
      driveFileToken: 'drive-token-1',
      driveSourceVersion: 'drive-version-1',
    },
    classification: {
      status: 'CONFIRMED',
      normalizedFamily: 'SB',
      classifierReleaseId: 'classifier-1',
      classifierReleaseHash: HASH,
      parserProfileId: 'profile-1',
      parserProfileHash: HASH,
      fingerprint: HASH,
    },
    package: {
      packageId: 'package-initial-1',
      contractId: 'techpub.parsed-package.v1',
      contractRevision: 'frozen.2',
      artifact: artifact('package'),
      contentHash: HASH,
      semanticHash: HASH,
      provenanceHash: HASH,
      coverageHash: HASH,
      resultStatus: 'complete',
      title: 'Initial analysis test package',
      contentUnitCount: 1,
      sourceRefCount: 1,
      readerReceiptId: 'reader-receipt-1',
      fullValidatorProof: {
        validatorId: 'U0Frozen2SchemaSemanticValidator',
        validatorRevision: 'validator-1',
        contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
        artifactSha256: HASH,
      },
    },
    integratedAssessment: null,
    failure: null,
    recordingFailure: null,
  };
}

function translatedWorkItem(
  workItem: CanonicalWorkItemProjection,
): CanonicalWorkItemProjection {
  const translation: CanonicalTranslationCandidateProjection = {
    schemaVersion: 'wiselink.3_1.translation_candidate_projection.v1',
    status: 'CANDIDATE_ONLY',
    currentness: 'CURRENT',
    staleReason: null,
    sourceResultId: 'openclaw-translation://request-initial-1',
    actionAttemptId: 'attempt-translate',
    inputRevision: workItem.revision,
    documentId: workItem.source.documentId,
    documentVersionId: workItem.source.documentVersionId,
    sourcePackageId: workItem.package!.packageId,
    sourcePackageContentHash: workItem.package!.contentHash,
    ruleSetId: CANONICAL_TRANSLATION_RULE_SET_V1_ID,
    ruleSetVersion: CANONICAL_TRANSLATION_RULE_SET_V1_VERSION,
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    sourceUnitCount: 1,
    translatedUnitCount: 1,
    pendingTranslationUnitCount: 0,
    sourceRefCount: 1,
    engineerRevisionCount: 0,
    validationVerdict: 'ACCEPTED',
    validationFindingCount: 0,
    artifact: artifact('translation'),
  };
  return { ...workItem, revision: workItem.revision + 1, translation };
}

function applicabilityInput(
  workItem: CanonicalWorkItemProjection,
): CanonicalApplicabilityInputProjection {
  return {
    schemaVersion: 'wiselink.3_1.applicability_input_projection.v1',
    applicabilityContextRef: 'applicability-context-initial-1',
    workItemId: workItem.workItemId,
    documentVersionId: workItem.source.documentVersionId,
    sourcePackageId: workItem.package!.packageId,
    sourcePackageContentHash: workItem.package!.contentHash,
    sourcePackageArtifactSha256: workItem.package!.artifact.sha256,
    targetBindingHash: HASH,
    selectionRevision: 'selection-1',
    bindingRevision: 'host-applicability:binding-1',
    currentness: 'CURRENT',
    aircraftNumber: 'B-TEST',
    assessmentAsOf: '2026-09-06',
    fleetMasterData: {
      schemaVersion: 'wiselink.v3_1.applicability_fleet.fleet_master_data.v1',
      sourceSnapshotId: 'fleet-snapshot-1',
      sourceRevisionKey: 'fleet-revision-1',
      authorityRevision: 'fleet-authority-1',
      sourceAsOf: '2026-09-06',
      assets: [],
      facts: [],
    },
  };
}

function applicabilityCandidate(
  workItem: CanonicalWorkItemProjection,
  input: CanonicalApplicabilityInputProjection,
  status: CanonicalApplicabilityCandidateProjection['status'],
): CanonicalApplicabilityCandidateProjection {
  return {
    schemaVersion: 'wiselink.3_1.applicability_candidate_projection.v1',
    status,
    currentness: 'CURRENT',
    staleReason: null,
    sourceResultId: 'openclaw-applicability://request-initial-1',
    actionAttemptId: 'attempt-applicability',
    inputRevision: workItem.revision,
    documentId: workItem.source.documentId,
    documentVersionId: workItem.source.documentVersionId,
    sourcePackageId: workItem.package!.packageId,
    sourcePackageContentHash: workItem.package!.contentHash,
    translationActionAttemptId: workItem.translation!.actionAttemptId,
    applicabilityContextRef: input.applicabilityContextRef,
    applicabilityBindingRevision: input.bindingRevision,
    aircraftNumber: input.aircraftNumber,
    assessmentAsOf: input.assessmentAsOf,
    fleetSourceSnapshotId: 'fleet-snapshot-1',
    fleetSourceRevisionKey: 'fleet-revision-1',
    fleetAuthorityRevision: 'fleet-authority-1',
    fleetSourceAsOf: '2026-09-06',
    sourceExpressionCount: 1,
    sourceRefCount: 1,
    decision: status === 'WAITING_INPUT' ? 'UNKNOWN' : 'APPLICABLE',
    kleeneResult: status === 'WAITING_INPUT' ? 'unknown' : true,
    pass: status !== 'WAITING_INPUT',
    blockingUnknownCount: status === 'WAITING_INPUT' ? 1 : 0,
    artifact: artifact('applicability'),
  };
}

function integratedAssessment(): CanonicalIntegratedAssessmentProjection {
  const baseRules = {
    status: 'CANDIDATE_ONLY' as const,
    revision: 1,
    sourceResultId: 'openclaw-dynamic://request-initial-1',
    criterionSetId: 'criterion-set-1',
    criterionCount: 1,
    evaluationItemCount: 1,
    unresolvedCount: 0,
    sourceBoundCandidateCount: 1,
    artifact: artifact('job-aid'),
    actionAttemptId: 'attempt-job-aid',
  };
  return {
    status: 'OVERALL_CANDIDATE_READY',
    baseRules,
    overallSynthesis: {
      status: 'CANDIDATE_ONLY',
      revision: 1,
      sourceResultId: 'openclaw-overall://request-initial-1',
      basedOnBaseRuleRevision: baseRules.revision,
      basedOnBaseRuleArtifactSha256: baseRules.artifact.sha256,
      basedOnEngineerReviewRevision: null,
      basedOnEngineerReviewArtifactSha256: null,
      discoveryStatus: 'NOT_REQUESTED',
      gap: null,
      candidateRefCount: 1,
      findingCount: 1,
      unresolvedCount: 0,
      authorityLevel: 'candidate_only',
      externalDiscoveryIsEvidence: false,
      artifact: artifact('overall'),
      actionAttemptId: 'attempt-overall',
      staleReason: null,
    },
  };
}

function attempt(
  actionType: CanonicalInitialAnalysisAttemptObservation['actionType'],
  status: string,
): CanonicalInitialAnalysisAttemptObservation {
  return {
    attemptId:
      actionType === 'OPENCLAW_TRANSLATE'
        ? 'attempt-translate'
        : `attempt-${actionType}`,
    actionType,
    attemptRef: `attempt-ref-${actionType}`,
    status,
    terminalCode: status === 'RUNNING' ? null : `TERMINAL_${status}`,
  };
}

function pendingStage() {
  return {
    status: 'PENDING',
    attemptRef: null,
    attemptStatus: null,
    terminalCode: null,
  };
}

function artifact(name: string): UnifiedPackageArtifactDescriptor {
  return {
    storeRole: 'UnifiedArtifactStoreCandidate',
    ref: `artifact://UnifiedArtifactStoreCandidate/${name}`,
    sha256: name === 'other' ? OTHER_HASH : HASH,
    byteLength: 100,
    mediaType: 'application/json',
  };
}
