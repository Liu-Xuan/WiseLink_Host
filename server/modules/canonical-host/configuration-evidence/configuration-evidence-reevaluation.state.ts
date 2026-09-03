import type {
  AilyConfigurationEvidenceReevaluationStatus,
  CanonicalApplicabilityCandidateProjection,
  CanonicalApplicabilityInputProjection,
  CanonicalBaseRuleCandidateProjection,
  CanonicalConfigurationEvidenceReevaluationAttemptBinding,
  CanonicalConfigurationEvidenceReevaluationLegacyProjection,
  CanonicalConfigurationEvidenceReevaluationProjection,
  CanonicalConfigurationEvidenceReevaluationStageName,
  CanonicalConfigurationEvidenceReevaluationStageProjection,
  CanonicalConfigurationEvidenceReevaluationStatus,
  CanonicalConfigurationEvidenceReevaluationV2Projection,
  CanonicalOpenClawOverallProjection,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';

type TerminalStatus = Extract<
  CanonicalConfigurationEvidenceReevaluationStatus,
  'WAITING_INPUT' | 'FAILED' | 'CONFLICT'
>;

const TERMINAL_STATUSES: readonly TerminalStatus[] = [
  'WAITING_INPUT',
  'FAILED',
  'CONFLICT',
];

export function createConfigurationEvidenceReevaluation(input: {
  triggerSnapshotId: string;
  triggerConfigurationRevision: number;
  adoptionWorkItemRevision: number;
}): CanonicalConfigurationEvidenceReevaluationV2Projection {
  requireNonEmpty(
    input.triggerSnapshotId,
    'CONFIGURATION_REEVALUATION_SNAPSHOT_REQUIRED',
  );
  requirePositiveInteger(
    input.triggerConfigurationRevision,
    'CONFIGURATION_REEVALUATION_CONFIGURATION_REVISION_INVALID',
  );
  requirePositiveInteger(
    input.adoptionWorkItemRevision,
    'CONFIGURATION_REEVALUATION_ADOPTION_REVISION_INVALID',
  );
  return {
    schemaVersion: 'wiselink.3_1.configuration_evidence_reevaluation.v2',
    trigger: 'CONFIGURATION_EVIDENCE_ADOPTED',
    triggerSnapshotId: input.triggerSnapshotId,
    triggerConfigurationRevision: input.triggerConfigurationRevision,
    adoptionWorkItemRevision: input.adoptionWorkItemRevision,
    mode: 'FULL_APPLICABILITY_JOB_AID_OVERALL',
    status: 'REQUIRED',
    stages: {
      applicability: pendingStage(),
      dynamic: pendingStage(),
      overall: pendingStage(),
    },
    stagedBundle: {
      applicabilityInput: null,
      applicability: null,
      baseRules: null,
    },
    promotedWorkItemRevision: null,
    candidateOnly: true,
  };
}

/** Upgrade a persisted v1 marker without mutating the stored value. */
export function upgradeConfigurationEvidenceReevaluation(
  marker: CanonicalConfigurationEvidenceReevaluationProjection,
): CanonicalConfigurationEvidenceReevaluationV2Projection {
  return normalizeConfigurationEvidenceReevaluation(marker);
}

/** Normalize persisted marker JSON and reject malformed Host state. */
export function normalizeConfigurationEvidenceReevaluation(
  value: unknown,
): CanonicalConfigurationEvidenceReevaluationV2Projection {
  if (!isRecord(value)) {
    throw new Error('CONFIGURATION_REEVALUATION_MARKER_INVALID');
  }
  if (
    value.schemaVersion ===
    'wiselink.3_1.configuration_evidence_reevaluation.v1'
  ) {
    assertLegacyMarker(value);
    return createConfigurationEvidenceReevaluation({
      triggerSnapshotId: value.triggerSnapshotId,
      triggerConfigurationRevision: value.triggerConfigurationRevision,
      adoptionWorkItemRevision: value.adoptionWorkItemRevision,
    });
  }
  if (
    value.schemaVersion !==
    'wiselink.3_1.configuration_evidence_reevaluation.v2'
  ) {
    throw new Error('CONFIGURATION_REEVALUATION_VERSION_UNSUPPORTED');
  }
  assertV2MarkerShape(value);
  const marker = structuredClone(
    value,
  ) as CanonicalConfigurationEvidenceReevaluationV2Projection;
  assertMarkerInvariants(marker);
  return marker;
}

/**
 * Return the exact active cycle after checking it still points at the adopted
 * configuration evidence currently owned by this WorkItem.
 */
export function assertActiveConfigurationEvidenceReevaluation(input: {
  workItem: CanonicalWorkItemProjection;
  triggerSnapshotId?: string;
  triggerConfigurationRevision?: number;
}): CanonicalConfigurationEvidenceReevaluationV2Projection {
  const pointer = input.workItem.configurationEvidenceCurrent;
  const persisted = input.workItem.configurationEvidenceReevaluation;
  if (!pointer || !persisted) {
    throw new Error('CONFIGURATION_REEVALUATION_REQUIRED');
  }
  const marker = normalizeConfigurationEvidenceReevaluation(persisted);
  if (
    pointer.snapshotId !== marker.triggerSnapshotId ||
    pointer.configurationRevision !== marker.triggerConfigurationRevision ||
    (input.triggerSnapshotId !== undefined &&
      input.triggerSnapshotId !== marker.triggerSnapshotId) ||
    (input.triggerConfigurationRevision !== undefined &&
      input.triggerConfigurationRevision !==
        marker.triggerConfigurationRevision)
  ) {
    throw new Error('CONFIGURATION_REEVALUATION_TRIGGER_CONFLICT');
  }
  if (marker.status === 'SUCCEEDED') {
    throw new Error('CONFIGURATION_REEVALUATION_ALREADY_SUCCEEDED');
  }
  return marker;
}

/** Integration-facing nullable read helper. */
export function activeConfigurationEvidenceReevaluation(
  workItem: CanonicalWorkItemProjection,
): CanonicalConfigurationEvidenceReevaluationV2Projection | null {
  if (
    !workItem.configurationEvidenceCurrent ||
    !workItem.configurationEvidenceReevaluation
  ) {
    return null;
  }
  const marker = normalizeConfigurationEvidenceReevaluation(
    workItem.configurationEvidenceReevaluation,
  );
  if (
    marker.triggerSnapshotId !==
      workItem.configurationEvidenceCurrent.snapshotId ||
    marker.triggerConfigurationRevision !==
      workItem.configurationEvidenceCurrent.configurationRevision
  ) {
    throw new Error('CONFIGURATION_REEVALUATION_TRIGGER_CONFLICT');
  }
  return marker.status === 'SUCCEEDED' ? null : marker;
}

/** Public progress projection. Internal staged bytes and ActionAttempts stay private. */
export function projectConfigurationEvidenceReevaluationStatus(
  workItem: CanonicalWorkItemProjection,
): AilyConfigurationEvidenceReevaluationStatus | null {
  const persisted = workItem.configurationEvidenceReevaluation;
  if (!persisted) return null;
  const marker = normalizeConfigurationEvidenceReevaluation(persisted);
  const nextStage =
    marker.stages.applicability.status !== 'SUCCEEDED'
      ? 'APPLICABILITY'
      : marker.stages.dynamic.status !== 'SUCCEEDED'
        ? 'JOB_AID'
        : marker.stages.overall.status !== 'SUCCEEDED'
          ? 'OVERALL'
          : null;
  return {
    schemaVersion: 'wiselink.3_1.configuration_evidence_reevaluation_status.v1',
    triggerSnapshotId: marker.triggerSnapshotId,
    triggerConfigurationRevision: marker.triggerConfigurationRevision,
    mode: marker.mode,
    status: marker.status,
    nextStage,
    stages: {
      applicability: {
        status: marker.stages.applicability.status,
        retryNo: marker.stages.applicability.retryNo,
      },
      jobAid: {
        status: marker.stages.dynamic.status,
        retryNo: marker.stages.dynamic.retryNo,
      },
      overall: {
        status: marker.stages.overall.status,
        retryNo: marker.stages.overall.retryNo,
      },
    },
    servingCurrentPreserved:
      persisted.schemaVersion ===
      'wiselink.3_1.configuration_evidence_reevaluation.v2'
        ? marker.status !== 'SUCCEEDED'
        : legacyServingCurrentWasPreserved(workItem),
    candidateOnly: true,
  };
}

function legacyServingCurrentWasPreserved(
  workItem: CanonicalWorkItemProjection,
): boolean {
  return (
    workItem.applicabilityInput?.currentness !== 'STALE' &&
    workItem.applicability?.currentness !== 'STALE' &&
    workItem.applicability?.status !== 'STALE' &&
    workItem.assessment?.previousOverallStale !== true &&
    workItem.integratedAssessment?.status !== 'OVERALL_CANDIDATE_STALE' &&
    workItem.integratedAssessment?.overallSynthesis?.status !== 'STALE'
  );
}

export function stageConfigurationEvidenceApplicabilityInput(input: {
  workItem: CanonicalWorkItemProjection;
  applicabilityInput: CanonicalApplicabilityInputProjection;
}): CanonicalWorkItemProjection {
  const marker = assertActiveConfigurationEvidenceReevaluation({
    workItem: input.workItem,
  });
  assertStageStatus(marker.stages.applicability, ['PENDING']);
  if (
    input.applicabilityInput.currentness !== 'CURRENT' ||
    input.applicabilityInput.workItemId !== input.workItem.workItemId ||
    input.applicabilityInput.documentVersionId !==
      input.workItem.source.documentVersionId ||
    input.applicabilityInput.sourcePackageId !==
      input.workItem.package?.packageId ||
    input.applicabilityInput.sourcePackageContentHash !==
      input.workItem.package?.contentHash
  ) {
    throw new Error(
      'CONFIGURATION_REEVALUATION_APPLICABILITY_INPUT_BINDING_INVALID',
    );
  }
  const nextMarker = structuredClone(marker);
  nextMarker.status = 'RUNNING';
  nextMarker.stages.applicability = {
    ...pendingStage(),
    status: 'RUNNING',
    retryNo: marker.stages.applicability.retryNo,
  };
  nextMarker.stagedBundle.applicabilityInput = structuredClone(
    input.applicabilityInput,
  );
  return withMarkerRevision(input.workItem, nextMarker);
}

export function withStagedApplicabilityInput(
  workItem: CanonicalWorkItemProjection,
  applicabilityInput: CanonicalApplicabilityInputProjection,
): CanonicalWorkItemProjection {
  return stageConfigurationEvidenceApplicabilityInput({
    workItem,
    applicabilityInput,
  });
}

export function stagedApplicabilityInput(
  workItem: CanonicalWorkItemProjection,
): CanonicalApplicabilityInputProjection | null {
  return (
    activeConfigurationEvidenceReevaluation(workItem)?.stagedBundle
      .applicabilityInput ?? null
  );
}

export function stageConfigurationEvidenceApplicability(input: {
  workItem: CanonicalWorkItemProjection;
  applicability: CanonicalApplicabilityCandidateProjection;
  attempt: CanonicalConfigurationEvidenceReevaluationAttemptBinding;
}): CanonicalWorkItemProjection {
  const marker = assertActiveConfigurationEvidenceReevaluation({
    workItem: input.workItem,
  });
  assertStageStatus(marker.stages.applicability, ['RUNNING']);
  assertSuccessAttempt(input.workItem, input.attempt);
  const stagedInput = marker.stagedBundle.applicabilityInput;
  if (
    !stagedInput ||
    input.applicability.status !== 'CANDIDATE_ONLY' ||
    input.applicability.currentness !== 'CURRENT' ||
    input.applicability.actionAttemptId !== input.attempt.attemptId ||
    input.applicability.documentVersionId !== stagedInput.documentVersionId ||
    input.applicability.sourcePackageId !== stagedInput.sourcePackageId ||
    input.applicability.sourcePackageContentHash !==
      stagedInput.sourcePackageContentHash ||
    input.applicability.applicabilityContextRef !==
      stagedInput.applicabilityContextRef ||
    input.applicability.applicabilityBindingRevision !==
      stagedInput.bindingRevision
  ) {
    throw new Error('CONFIGURATION_REEVALUATION_APPLICABILITY_BINDING_INVALID');
  }
  const nextRevision = input.workItem.revision + 1;
  const nextMarker = structuredClone(marker);
  nextMarker.status = 'RUNNING';
  nextMarker.stages.applicability = succeededStage(
    marker.stages.applicability.retryNo,
    input.attempt,
    nextRevision,
  );
  nextMarker.stagedBundle.applicability = structuredClone(input.applicability);
  return withMarkerRevision(input.workItem, nextMarker);
}

export function withStagedApplicability(
  workItem: CanonicalWorkItemProjection,
  applicability: CanonicalApplicabilityCandidateProjection,
  attempt: CanonicalConfigurationEvidenceReevaluationAttemptBinding,
): CanonicalWorkItemProjection {
  return stageConfigurationEvidenceApplicability({
    workItem,
    applicability,
    attempt,
  });
}

export function stageConfigurationEvidenceBaseRules(input: {
  workItem: CanonicalWorkItemProjection;
  baseRules: CanonicalBaseRuleCandidateProjection;
  attempt: CanonicalConfigurationEvidenceReevaluationAttemptBinding;
}): CanonicalWorkItemProjection {
  const marker = assertActiveConfigurationEvidenceReevaluation({
    workItem: input.workItem,
  });
  assertStageStatus(marker.stages.applicability, ['SUCCEEDED']);
  assertStageStatus(marker.stages.dynamic, ['PENDING', 'RUNNING']);
  assertStageStatus(marker.stages.overall, ['PENDING']);
  assertSuccessAttempt(input.workItem, input.attempt);
  if (
    input.baseRules.status !== 'CANDIDATE_ONLY' ||
    input.baseRules.actionAttemptId !== input.attempt.attemptId
  ) {
    throw new Error('CONFIGURATION_REEVALUATION_BASE_RULE_BINDING_INVALID');
  }
  const nextRevision = input.workItem.revision + 1;
  const nextMarker = structuredClone(marker);
  nextMarker.status = 'RUNNING';
  nextMarker.stages.dynamic = succeededStage(
    marker.stages.dynamic.retryNo,
    input.attempt,
    nextRevision,
  );
  nextMarker.stagedBundle.baseRules = structuredClone(input.baseRules);
  return withMarkerRevision(input.workItem, nextMarker);
}

export function withStagedBaseRules(
  workItem: CanonicalWorkItemProjection,
  baseRules: CanonicalBaseRuleCandidateProjection,
  attempt: CanonicalConfigurationEvidenceReevaluationAttemptBinding,
): CanonicalWorkItemProjection {
  return stageConfigurationEvidenceBaseRules({ workItem, baseRules, attempt });
}

/** Build a read-only overlay for downstream Host task construction. */
export function buildConfigurationEvidenceShadowWorkItem(
  workItem: CanonicalWorkItemProjection,
): CanonicalWorkItemProjection {
  const marker = assertActiveConfigurationEvidenceReevaluation({ workItem });
  const shadow = structuredClone(workItem);
  const staged = marker.stagedBundle;
  if (staged.applicabilityInput) {
    shadow.applicabilityInput = structuredClone(staged.applicabilityInput);
  }
  if (staged.applicability) {
    shadow.applicability = structuredClone(staged.applicability);
  }
  if (staged.baseRules) {
    const previous = workItem.integratedAssessment;
    const priorOverall = previous?.overallSynthesis;
    shadow.integratedAssessment = {
      status: priorOverall
        ? 'OVERALL_CANDIDATE_STALE'
        : 'BASE_RULE_CANDIDATE_READY',
      baseRules: structuredClone(staged.baseRules),
      engineerReviews: structuredClone(previous?.engineerReviews ?? null),
      overallSynthesis: priorOverall
        ? {
            ...structuredClone(priorOverall),
            status: 'STALE',
            staleReason: 'BASE_RULE_RESULT_CHANGED',
          }
        : null,
      overallForAeoConfirmation: null,
    };
  }
  shadow.configurationEvidenceReevaluation = marker;
  return shadow;
}

export function configurationEvidenceShadow(
  workItem: CanonicalWorkItemProjection,
): CanonicalWorkItemProjection {
  return buildConfigurationEvidenceShadowWorkItem(workItem);
}

export function recordConfigurationEvidenceReevaluationTerminal(input: {
  workItem: CanonicalWorkItemProjection;
  stage: CanonicalConfigurationEvidenceReevaluationStageName;
  status: TerminalStatus;
  attempt: CanonicalConfigurationEvidenceReevaluationAttemptBinding | null;
  code: string;
  message?: string | null;
}): CanonicalWorkItemProjection {
  const marker = assertActiveConfigurationEvidenceReevaluation({
    workItem: input.workItem,
  });
  requireNonEmpty(
    input.code,
    'CONFIGURATION_REEVALUATION_TERMINAL_CODE_REQUIRED',
  );
  const key = stageKey(input.stage);
  const currentStage = marker.stages[key];
  if (currentStage.status === 'SUCCEEDED') {
    throw new Error('CONFIGURATION_REEVALUATION_STAGE_ALREADY_SUCCEEDED');
  }
  assertPriorStagesSucceeded(marker, input.stage);
  if (input.attempt) assertAttemptShape(input.attempt);
  const nextRevision = input.workItem.revision + 1;
  const nextMarker = structuredClone(marker);
  nextMarker.status = input.status;
  nextMarker.stages[key] = {
    status: input.status,
    retryNo: currentStage.retryNo,
    attempt: input.attempt ? structuredClone(input.attempt) : null,
    committedWorkItemRevision: nextRevision,
    terminal: {
      status: input.status,
      code: input.code,
      message: input.message ?? null,
    },
  };
  return withMarkerRevision(input.workItem, nextMarker);
}

export function withConfigurationEvidenceTerminal(
  workItem: CanonicalWorkItemProjection,
  stage: CanonicalConfigurationEvidenceReevaluationStageName,
  status: TerminalStatus,
  attempt: CanonicalConfigurationEvidenceReevaluationAttemptBinding | null,
  code: string,
  message?: string | null,
): CanonicalWorkItemProjection {
  return recordConfigurationEvidenceReevaluationTerminal({
    workItem,
    stage,
    status,
    attempt,
    code,
    message,
  });
}

/** Prepare the same cycle for a new ActionAttempt after a terminal outcome. */
export function retryConfigurationEvidenceReevaluationStage(input: {
  workItem: CanonicalWorkItemProjection;
  stage: CanonicalConfigurationEvidenceReevaluationStageName;
}): CanonicalWorkItemProjection {
  const marker = assertActiveConfigurationEvidenceReevaluation({
    workItem: input.workItem,
  });
  const key = stageKey(input.stage);
  const currentStage = marker.stages[key];
  if (!TERMINAL_STATUSES.includes(currentStage.status as TerminalStatus)) {
    throw new Error('CONFIGURATION_REEVALUATION_STAGE_NOT_RETRYABLE');
  }
  const nextMarker = structuredClone(marker);
  nextMarker.status = 'REQUIRED';
  nextMarker.stages[key] = {
    ...pendingStage(),
    retryNo: currentStage.retryNo + 1,
  };
  resetAfterStage(nextMarker, input.stage);
  return withMarkerRevision(input.workItem, nextMarker);
}

/**
 * Construct the only projection allowed to promote the staged P0B bundle.
 * The caller persists this projection with one compare-and-set operation.
 */
export function buildConfigurationEvidenceFinalPromotion(input: {
  workItem: CanonicalWorkItemProjection;
  overall: CanonicalOpenClawOverallProjection;
  attempt: CanonicalConfigurationEvidenceReevaluationAttemptBinding;
}): CanonicalWorkItemProjection {
  const marker = assertActiveConfigurationEvidenceReevaluation({
    workItem: input.workItem,
  });
  assertStageStatus(marker.stages.applicability, ['SUCCEEDED']);
  assertStageStatus(marker.stages.dynamic, ['SUCCEEDED']);
  assertStageStatus(marker.stages.overall, ['PENDING', 'RUNNING']);
  assertSuccessAttempt(input.workItem, input.attempt);
  const staged = marker.stagedBundle;
  if (
    !staged.applicabilityInput ||
    !staged.applicability ||
    !staged.baseRules
  ) {
    throw new Error('CONFIGURATION_REEVALUATION_STAGED_BUNDLE_INCOMPLETE');
  }
  if (
    input.overall.status !== 'CANDIDATE_ONLY' ||
    input.overall.actionAttemptId !== input.attempt.attemptId ||
    input.overall.basedOnBaseRuleRevision !== staged.baseRules.revision ||
    input.overall.basedOnBaseRuleArtifactSha256 !==
      staged.baseRules.artifact.sha256
  ) {
    throw new Error('CONFIGURATION_REEVALUATION_OVERALL_BINDING_INVALID');
  }
  const nextRevision = input.workItem.revision + 1;
  const nextMarker = structuredClone(marker);
  nextMarker.status = 'SUCCEEDED';
  nextMarker.stages.overall = succeededStage(
    marker.stages.overall.retryNo,
    input.attempt,
    nextRevision,
  );
  nextMarker.promotedWorkItemRevision = nextRevision;
  return {
    ...structuredClone(input.workItem),
    revision: nextRevision,
    applicabilityInput: structuredClone(staged.applicabilityInput),
    applicability: structuredClone(staged.applicability),
    integratedAssessment: {
      status: 'OVERALL_CANDIDATE_READY',
      baseRules: structuredClone(staged.baseRules),
      engineerReviews: structuredClone(
        input.workItem.integratedAssessment?.engineerReviews ?? null,
      ),
      overallSynthesis: structuredClone(input.overall),
      overallForAeoConfirmation: null,
    },
    configurationEvidenceReevaluation: nextMarker,
    // The existing AEO is bound to the replaced Dynamic/Overall artifact pair.
    aeo: null,
  };
}

export function promoteConfigurationEvidenceReevaluation(
  workItem: CanonicalWorkItemProjection,
  overall: CanonicalOpenClawOverallProjection,
  attempt: CanonicalConfigurationEvidenceReevaluationAttemptBinding,
): CanonicalWorkItemProjection {
  return buildConfigurationEvidenceFinalPromotion({
    workItem,
    overall,
    attempt,
  });
}

function pendingStage(): CanonicalConfigurationEvidenceReevaluationStageProjection {
  return {
    status: 'PENDING',
    retryNo: 0,
    attempt: null,
    committedWorkItemRevision: null,
    terminal: null,
  };
}

function succeededStage(
  retryNo: number,
  attempt: CanonicalConfigurationEvidenceReevaluationAttemptBinding,
  committedWorkItemRevision: number,
): CanonicalConfigurationEvidenceReevaluationStageProjection {
  return {
    status: 'SUCCEEDED',
    retryNo,
    attempt: structuredClone(attempt),
    committedWorkItemRevision,
    terminal: null,
  };
}

function withMarkerRevision(
  workItem: CanonicalWorkItemProjection,
  marker: CanonicalConfigurationEvidenceReevaluationV2Projection,
): CanonicalWorkItemProjection {
  return {
    ...structuredClone(workItem),
    revision: workItem.revision + 1,
    configurationEvidenceReevaluation: marker,
  };
}

function resetAfterStage(
  marker: CanonicalConfigurationEvidenceReevaluationV2Projection,
  stage: CanonicalConfigurationEvidenceReevaluationStageName,
): void {
  if (stage === 'APPLICABILITY') {
    marker.stages.dynamic = pendingStage();
    marker.stages.overall = pendingStage();
    marker.stagedBundle.applicabilityInput = null;
    marker.stagedBundle.applicability = null;
    marker.stagedBundle.baseRules = null;
    return;
  }
  if (stage === 'DYNAMIC') {
    marker.stages.overall = pendingStage();
    marker.stagedBundle.baseRules = null;
  }
}

function assertPriorStagesSucceeded(
  marker: CanonicalConfigurationEvidenceReevaluationV2Projection,
  stage: CanonicalConfigurationEvidenceReevaluationStageName,
): void {
  if (
    stage !== 'APPLICABILITY' &&
    marker.stages.applicability.status !== 'SUCCEEDED'
  ) {
    throw new Error('CONFIGURATION_REEVALUATION_APPLICABILITY_STAGE_REQUIRED');
  }
  if (stage === 'OVERALL' && marker.stages.dynamic.status !== 'SUCCEEDED') {
    throw new Error('CONFIGURATION_REEVALUATION_DYNAMIC_STAGE_REQUIRED');
  }
}

function assertSuccessAttempt(
  workItem: CanonicalWorkItemProjection,
  attempt: CanonicalConfigurationEvidenceReevaluationAttemptBinding,
): void {
  assertAttemptShape(attempt);
  if (attempt.baseRevision !== workItem.revision) {
    throw new Error('CONFIGURATION_REEVALUATION_ATTEMPT_REVISION_CONFLICT');
  }
}

function assertAttemptShape(
  attempt: CanonicalConfigurationEvidenceReevaluationAttemptBinding,
): void {
  requireNonEmpty(
    attempt.attemptId,
    'CONFIGURATION_REEVALUATION_ATTEMPT_ID_REQUIRED',
  );
  requireNonEmpty(
    attempt.attemptRef,
    'CONFIGURATION_REEVALUATION_ATTEMPT_REF_REQUIRED',
  );
  requireNonNegativeInteger(
    attempt.inputRevision,
    'CONFIGURATION_REEVALUATION_ATTEMPT_INPUT_REVISION_INVALID',
  );
  requireNonNegativeInteger(
    attempt.baseRevision,
    'CONFIGURATION_REEVALUATION_ATTEMPT_BASE_REVISION_INVALID',
  );
}

function assertStageStatus(
  stage: CanonicalConfigurationEvidenceReevaluationStageProjection,
  expected: CanonicalConfigurationEvidenceReevaluationStageProjection['status'][],
): void {
  if (!expected.includes(stage.status)) {
    throw new Error('CONFIGURATION_REEVALUATION_STAGE_ORDER_INVALID');
  }
}

function stageKey(
  stage: CanonicalConfigurationEvidenceReevaluationStageName,
): keyof CanonicalConfigurationEvidenceReevaluationV2Projection['stages'] {
  if (stage === 'APPLICABILITY') return 'applicability';
  if (stage === 'DYNAMIC') return 'dynamic';
  return 'overall';
}

function assertLegacyMarker(
  value: Record<string, unknown>,
): asserts value is Record<string, unknown> &
  CanonicalConfigurationEvidenceReevaluationLegacyProjection {
  if (
    value.trigger !== 'CONFIGURATION_EVIDENCE_ADOPTED' ||
    value.mode !== 'FULL_APPLICABILITY_JOB_AID_OVERALL' ||
    value.status !== 'REQUIRED' ||
    value.applicability !== 'STALE_OR_NOT_AVAILABLE' ||
    value.jobAid !== 'FULL_RERUN_REQUIRED' ||
    value.overall !== 'STALE_OR_NOT_AVAILABLE' ||
    value.candidateOnly !== true ||
    typeof value.triggerSnapshotId !== 'string' ||
    value.triggerSnapshotId.trim() === '' ||
    !isPositiveInteger(value.triggerConfigurationRevision) ||
    !isPositiveInteger(value.adoptionWorkItemRevision)
  ) {
    throw new Error('CONFIGURATION_REEVALUATION_LEGACY_MARKER_INVALID');
  }
}

function assertV2MarkerShape(
  value: Record<string, unknown>,
): asserts value is Record<string, unknown> &
  CanonicalConfigurationEvidenceReevaluationV2Projection {
  if (
    value.trigger !== 'CONFIGURATION_EVIDENCE_ADOPTED' ||
    value.mode !== 'FULL_APPLICABILITY_JOB_AID_OVERALL' ||
    value.candidateOnly !== true ||
    typeof value.triggerSnapshotId !== 'string' ||
    value.triggerSnapshotId.trim() === '' ||
    !isPositiveInteger(value.triggerConfigurationRevision) ||
    !isPositiveInteger(value.adoptionWorkItemRevision) ||
    !isRecord(value.stages) ||
    !isRecord(value.stagedBundle) ||
    !isReevaluationStatus(value.status) ||
    (value.promotedWorkItemRevision !== null &&
      !isPositiveInteger(value.promotedWorkItemRevision))
  ) {
    throw new Error('CONFIGURATION_REEVALUATION_MARKER_INVALID');
  }
  assertStageShape(value.stages.applicability);
  assertStageShape(value.stages.dynamic);
  assertStageShape(value.stages.overall);
}

function assertStageShape(
  value: unknown,
): asserts value is CanonicalConfigurationEvidenceReevaluationStageProjection {
  if (
    !isRecord(value) ||
    !isStageStatus(value.status) ||
    !isNonNegativeInteger(value.retryNo) ||
    (value.committedWorkItemRevision !== null &&
      !isPositiveInteger(value.committedWorkItemRevision)) ||
    (value.attempt !== null && !isRecord(value.attempt)) ||
    (value.terminal !== null && !isRecord(value.terminal))
  ) {
    throw new Error('CONFIGURATION_REEVALUATION_STAGE_INVALID');
  }
  if (value.attempt) {
    assertAttemptShape(
      value.attempt as unknown as CanonicalConfigurationEvidenceReevaluationAttemptBinding,
    );
  }
  const terminal = value.terminal;
  if (terminal) {
    if (
      !isRecord(terminal) ||
      !TERMINAL_STATUSES.includes(terminal.status as TerminalStatus) ||
      typeof terminal.code !== 'string' ||
      terminal.code.trim() === '' ||
      (terminal.message !== null && typeof terminal.message !== 'string')
    ) {
      throw new Error('CONFIGURATION_REEVALUATION_TERMINAL_INVALID');
    }
  }
}

function assertMarkerInvariants(
  marker: CanonicalConfigurationEvidenceReevaluationV2Projection,
): void {
  const { applicability, dynamic, overall } = marker.stages;
  if (dynamic.status !== 'PENDING' && applicability.status !== 'SUCCEEDED') {
    throw new Error('CONFIGURATION_REEVALUATION_STAGE_ORDER_INVALID');
  }
  if (overall.status !== 'PENDING' && dynamic.status !== 'SUCCEEDED') {
    throw new Error('CONFIGURATION_REEVALUATION_STAGE_ORDER_INVALID');
  }
  assertStagePayloadInvariant(applicability);
  assertStagePayloadInvariant(dynamic);
  assertStagePayloadInvariant(overall);
  if (
    applicability.status === 'SUCCEEDED' &&
    (!marker.stagedBundle.applicabilityInput ||
      !marker.stagedBundle.applicability)
  ) {
    throw new Error('CONFIGURATION_REEVALUATION_STAGED_BUNDLE_INCOMPLETE');
  }
  if (dynamic.status === 'SUCCEEDED' && !marker.stagedBundle.baseRules) {
    throw new Error('CONFIGURATION_REEVALUATION_STAGED_BUNDLE_INCOMPLETE');
  }
  if (
    (marker.status === 'SUCCEEDED') !== (overall.status === 'SUCCEEDED') ||
    (marker.status === 'SUCCEEDED') !==
      (marker.promotedWorkItemRevision !== null)
  ) {
    throw new Error('CONFIGURATION_REEVALUATION_PROMOTION_STATE_INVALID');
  }
}

function assertStagePayloadInvariant(
  stage: CanonicalConfigurationEvidenceReevaluationStageProjection,
): void {
  if (
    stage.status === 'SUCCEEDED' &&
    (!stage.attempt ||
      stage.committedWorkItemRevision === null ||
      stage.terminal)
  ) {
    throw new Error('CONFIGURATION_REEVALUATION_STAGE_INVALID');
  }
  if (
    TERMINAL_STATUSES.includes(stage.status as TerminalStatus) &&
    (!stage.terminal || stage.terminal.status !== stage.status)
  ) {
    throw new Error('CONFIGURATION_REEVALUATION_STAGE_INVALID');
  }
  if (
    !TERMINAL_STATUSES.includes(stage.status as TerminalStatus) &&
    stage.terminal
  ) {
    throw new Error('CONFIGURATION_REEVALUATION_STAGE_INVALID');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function requirePositiveInteger(
  value: unknown,
  code: string,
): asserts value is number {
  if (!isPositiveInteger(value)) throw new Error(code);
}

function requireNonNegativeInteger(
  value: unknown,
  code: string,
): asserts value is number {
  if (!isNonNegativeInteger(value)) throw new Error(code);
}

function requireNonEmpty(
  value: unknown,
  code: string,
): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(code);
}

function isReevaluationStatus(
  value: unknown,
): value is CanonicalConfigurationEvidenceReevaluationStatus {
  return (
    value === 'REQUIRED' ||
    value === 'RUNNING' ||
    value === 'WAITING_INPUT' ||
    value === 'FAILED' ||
    value === 'CONFLICT' ||
    value === 'SUCCEEDED'
  );
}

function isStageStatus(
  value: unknown,
): value is CanonicalConfigurationEvidenceReevaluationStageProjection['status'] {
  return (
    value === 'PENDING' ||
    value === 'RUNNING' ||
    value === 'SUCCEEDED' ||
    value === 'WAITING_INPUT' ||
    value === 'FAILED' ||
    value === 'CONFLICT'
  );
}
