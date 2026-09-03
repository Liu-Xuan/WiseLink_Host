import type {
  CanonicalApplicabilityCandidateProjection,
  CanonicalApplicabilityInputProjection,
  CanonicalBaseRuleCandidateProjection,
  CanonicalConfigurationEvidenceReevaluationAttemptBinding,
  CanonicalConfigurationEvidenceReevaluationLegacyProjection,
  CanonicalOpenClawOverallProjection,
  CanonicalWorkItemProjection,
  UnifiedPackageArtifactDescriptor,
} from '@shared/api.interface';

import {
  activeConfigurationEvidenceReevaluation,
  configurationEvidenceShadow,
  createConfigurationEvidenceReevaluation,
  normalizeConfigurationEvidenceReevaluation,
  promoteConfigurationEvidenceReevaluation,
  projectConfigurationEvidenceReevaluationStatus,
  retryConfigurationEvidenceReevaluationStage,
  stagedApplicabilityInput,
  withConfigurationEvidenceTerminal,
  withStagedApplicability,
  withStagedApplicabilityInput,
  withStagedBaseRules,
} from '../../../server/modules/canonical-host/configuration-evidence/configuration-evidence-reevaluation.state';

describe('configuration evidence reevaluation state', () => {
  it('upgrades a legacy marker without mutating the persisted value', () => {
    const legacy: CanonicalConfigurationEvidenceReevaluationLegacyProjection = {
      schemaVersion: 'wiselink.3_1.configuration_evidence_reevaluation.v1',
      trigger: 'CONFIGURATION_EVIDENCE_ADOPTED',
      triggerSnapshotId: 'SNAPSHOT-2',
      triggerConfigurationRevision: 2,
      adoptionWorkItemRevision: 10,
      mode: 'FULL_APPLICABILITY_JOB_AID_OVERALL',
      status: 'REQUIRED',
      applicability: 'STALE_OR_NOT_AVAILABLE',
      jobAid: 'FULL_RERUN_REQUIRED',
      overall: 'STALE_OR_NOT_AVAILABLE',
      candidateOnly: true,
    };

    const normalized = normalizeConfigurationEvidenceReevaluation(legacy);

    expect(normalized).toMatchObject({
      schemaVersion: 'wiselink.3_1.configuration_evidence_reevaluation.v2',
      triggerSnapshotId: 'SNAPSHOT-2',
      status: 'REQUIRED',
      stages: {
        applicability: { status: 'PENDING', retryNo: 0 },
        dynamic: { status: 'PENDING', retryNo: 0 },
        overall: { status: 'PENDING', retryNo: 0 },
      },
    });
    expect(legacy.schemaVersion).toBe(
      'wiselink.3_1.configuration_evidence_reevaluation.v1',
    );
  });

  it('reports public stage progress without exposing internal staged data', () => {
    const status = projectConfigurationEvidenceReevaluationStatus(
      withStagedApplicabilityInput(
        initialWorkItem(),
        applicabilityInput('NEW'),
      ),
    );

    expect(status).toEqual({
      schemaVersion:
        'wiselink.3_1.configuration_evidence_reevaluation_status.v1',
      triggerSnapshotId: 'SNAPSHOT-2',
      triggerConfigurationRevision: 2,
      mode: 'FULL_APPLICABILITY_JOB_AID_OVERALL',
      status: 'RUNNING',
      nextStage: 'APPLICABILITY',
      stages: {
        applicability: { status: 'RUNNING', retryNo: 0 },
        jobAid: { status: 'PENDING', retryNo: 0 },
        overall: { status: 'PENDING', retryNo: 0 },
      },
      servingCurrentPreserved: true,
      candidateOnly: true,
    });
    expect(status).not.toHaveProperty('stagedBundle');
  });

  it('does not claim a legacy cycle preserved serving current after stale marking', () => {
    const workItem = initialWorkItem();
    workItem.configurationEvidenceReevaluation = {
      schemaVersion: 'wiselink.3_1.configuration_evidence_reevaluation.v1',
      trigger: 'CONFIGURATION_EVIDENCE_ADOPTED',
      triggerSnapshotId: 'SNAPSHOT-2',
      triggerConfigurationRevision: 2,
      adoptionWorkItemRevision: 10,
      mode: 'FULL_APPLICABILITY_JOB_AID_OVERALL',
      status: 'REQUIRED',
      applicability: 'STALE_OR_NOT_AVAILABLE',
      jobAid: 'FULL_RERUN_REQUIRED',
      overall: 'STALE_OR_NOT_AVAILABLE',
      candidateOnly: true,
    };
    workItem.applicabilityInput = {
      ...workItem.applicabilityInput!,
      currentness: 'STALE',
    };
    workItem.applicability = {
      ...workItem.applicability!,
      status: 'STALE',
      currentness: 'STALE',
      staleReason: 'FLEET_FACTS_CHANGED',
    };
    workItem.integratedAssessment = {
      ...workItem.integratedAssessment!,
      status: 'OVERALL_CANDIDATE_STALE',
      overallSynthesis: {
        ...workItem.integratedAssessment!.overallSynthesis!,
        status: 'STALE',
        staleReason: 'BASE_RULE_RESULT_CHANGED',
      },
    };

    expect(
      projectConfigurationEvidenceReevaluationStatus(workItem),
    ).toMatchObject({
      status: 'REQUIRED',
      servingCurrentPreserved: false,
    });
  });

  it('rejects a marker that no longer matches the WorkItem current evidence pointer', () => {
    const workItem = initialWorkItem();
    workItem.configurationEvidenceCurrent = {
      ...workItem.configurationEvidenceCurrent!,
      snapshotId: 'SUPERSEDING-SNAPSHOT',
    };

    expect(() => activeConfigurationEvidenceReevaluation(workItem)).toThrow(
      'CONFIGURATION_REEVALUATION_TRIGGER_CONFLICT',
    );
  });

  it('stages input, applicability, and Base rules without replacing serving current', () => {
    const original = initialWorkItem();
    const serving = servingFields(original);
    const newInput = applicabilityInput('NEW');
    const withInput = withStagedApplicabilityInput(original, newInput);
    const withApplicability = withStagedApplicability(
      withInput,
      applicability('NEW', 'ATT-APP-NEW'),
      attempt('ATT-APP-NEW', withInput.revision),
    );
    const withBase = withStagedBaseRules(
      withApplicability,
      baseRules('NEW', 'ATT-DYNAMIC-NEW'),
      attempt('ATT-DYNAMIC-NEW', withApplicability.revision),
    );

    expect(servingFields(withInput)).toEqual(serving);
    expect(servingFields(withApplicability)).toEqual(serving);
    expect(servingFields(withBase)).toEqual(serving);
    expect(stagedApplicabilityInput(withBase)).toEqual(newInput);
    expect(activeConfigurationEvidenceReevaluation(withBase)).toMatchObject({
      status: 'RUNNING',
      stages: {
        applicability: { status: 'SUCCEEDED' },
        dynamic: { status: 'SUCCEEDED' },
        overall: { status: 'PENDING' },
      },
      stagedBundle: {
        applicability: { actionAttemptId: 'ATT-APP-NEW' },
        baseRules: { actionAttemptId: 'ATT-DYNAMIC-NEW' },
      },
    });
    expect(original).toEqual(initialWorkItem());
  });

  it('builds a read-only shadow over staged candidates', () => {
    const staged = stagedWorkItem();
    const authoritative = structuredClone(staged);

    const shadow = configurationEvidenceShadow(staged);

    expect(shadow.revision).toBe(staged.revision);
    expect(shadow.applicabilityInput).toEqual(applicabilityInput('NEW'));
    expect(shadow.applicability).toEqual(applicability('NEW', 'ATT-APP-NEW'));
    expect(shadow.integratedAssessment).toMatchObject({
      status: 'OVERALL_CANDIDATE_STALE',
      baseRules: { actionAttemptId: 'ATT-DYNAMIC-NEW' },
      overallSynthesis: {
        status: 'STALE',
        actionAttemptId: 'ATT-OVERALL-OLD',
        staleReason: 'BASE_RULE_RESULT_CHANGED',
      },
      overallForAeoConfirmation: null,
    });
    expect(staged).toEqual(authoritative);
  });

  it('records a terminal outcome without promotion and makes retry a new revision', () => {
    const withInput = withStagedApplicabilityInput(
      initialWorkItem(),
      applicabilityInput('NEW'),
    );
    const serving = servingFields(withInput);
    const failed = withConfigurationEvidenceTerminal(
      withInput,
      'APPLICABILITY',
      'WAITING_INPUT',
      attempt('ATT-APP-WAIT', withInput.revision),
      'CONFIGURATION_FACT_REQUIRED',
    );
    const retried = retryConfigurationEvidenceReevaluationStage({
      workItem: failed,
      stage: 'APPLICABILITY',
    });

    expect(servingFields(failed)).toEqual(serving);
    expect(failed.configurationEvidenceReevaluation).toMatchObject({
      status: 'WAITING_INPUT',
      stages: {
        applicability: {
          status: 'WAITING_INPUT',
          terminal: { code: 'CONFIGURATION_FACT_REQUIRED' },
        },
      },
    });
    expect(retried.revision).toBe(failed.revision + 1);
    expect(retried.configurationEvidenceReevaluation).toMatchObject({
      status: 'REQUIRED',
      stages: { applicability: { status: 'PENDING', retryNo: 1 } },
      stagedBundle: {
        applicabilityInput: null,
        applicability: null,
        baseRules: null,
      },
    });
  });

  it('promotes input, applicability, Base rules, and Overall in one projection', () => {
    const staged = stagedWorkItem();
    const serving = servingFields(staged);
    const overall = overallProjection('NEW', 'ATT-OVERALL-NEW');

    const promoted = promoteConfigurationEvidenceReevaluation(
      staged,
      overall,
      attempt('ATT-OVERALL-NEW', staged.revision),
    );

    expect(servingFields(staged)).toEqual(serving);
    expect(promoted.revision).toBe(staged.revision + 1);
    expect(promoted.applicabilityInput).toEqual(applicabilityInput('NEW'));
    expect(promoted.applicability).toEqual(applicability('NEW', 'ATT-APP-NEW'));
    expect(promoted.integratedAssessment).toMatchObject({
      status: 'OVERALL_CANDIDATE_READY',
      baseRules: { actionAttemptId: 'ATT-DYNAMIC-NEW' },
      overallSynthesis: { actionAttemptId: 'ATT-OVERALL-NEW' },
      overallForAeoConfirmation: null,
    });
    expect(promoted.aeo).toBeNull();
    expect(promoted.configurationEvidenceReevaluation).toMatchObject({
      status: 'SUCCEEDED',
      promotedWorkItemRevision: promoted.revision,
      stages: { overall: { status: 'SUCCEEDED' } },
    });
    expect(activeConfigurationEvidenceReevaluation(promoted)).toBeNull();
  });

  it('rejects final promotion when Overall is not bound to staged Base rules', () => {
    const staged = stagedWorkItem();
    const overall = {
      ...overallProjection('NEW', 'ATT-OVERALL-NEW'),
      basedOnBaseRuleArtifactSha256: 'f'.repeat(64),
    };

    expect(() =>
      promoteConfigurationEvidenceReevaluation(
        staged,
        overall,
        attempt('ATT-OVERALL-NEW', staged.revision),
      ),
    ).toThrow('CONFIGURATION_REEVALUATION_OVERALL_BINDING_INVALID');
  });
});

function initialWorkItem(): CanonicalWorkItemProjection {
  const oldBase = baseRules('OLD', 'ATT-DYNAMIC-OLD');
  return {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: 'WI-REEVALUATION',
    requestId: 'REQ-ORIGINAL',
    revision: 10,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    permissionSnapshotVersion: 'PERMISSION-1',
    parseAuthorization: {
      action: 'PARSE_PDF',
      actorFingerprint: 'ACTOR-1',
      decisionId: 'DECISION-1',
      decisionHash: 'DECISION-HASH-1',
      permissionSnapshotVersion: 'PERMISSION-1',
    },
    source: {
      documentId: 'DOC-1',
      documentVersionId: 'DV-1',
    },
    classification: { parserProfileId: 'issuer.boeing.sb' },
    package: {
      packageId: 'PKG-1',
      contentHash: 'PACKAGE-HASH-1',
      contractRevision: 'frozen.2',
      contentUnitCount: 1,
      artifact: artifact('artifact://package', '1'),
    },
    applicabilityInput: applicabilityInput('OLD'),
    applicability: applicability('OLD', 'ATT-APP-OLD'),
    integratedAssessment: {
      status: 'OVERALL_CANDIDATE_READY',
      baseRules: oldBase,
      overallSynthesis: overallProjection('OLD', 'ATT-OVERALL-OLD'),
      engineerReviews: null,
      overallForAeoConfirmation: {
        status: 'HUMAN_CONFIRMED',
        authority: 'CANONICAL_WORKITEM_SERVER_FRESH_READ',
        workItemRevision: 9,
        overallRevision: 1,
        overallArtifactRef: 'artifact://overall-OLD',
        overallArtifactSha256: artifact('unused', '4').sha256,
        actionAttemptId: 'ATT-OVERALL-OLD',
        confirmingActorUserId: 'USER-1',
        confirmedAt: '2026-09-01T00:00:00.000Z',
      },
    },
    configurationEvidenceCurrent: {
      schemaVersion: 'wiselink.3_1.configuration_evidence_work_item_current.v1',
      snapshotId: 'SNAPSHOT-2',
      configurationRevision: 2,
      aircraftAssetId: 'AIRCRAFT-1',
      assessmentAsOf: '2026-09-01',
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
    },
    configurationEvidenceReevaluation: createConfigurationEvidenceReevaluation({
      triggerSnapshotId: 'SNAPSHOT-2',
      triggerConfigurationRevision: 2,
      adoptionWorkItemRevision: 10,
    }),
    aeo: { status: 'CANDIDATE_AUTHORING_IN_PROGRESS' } as never,
    failure: null,
    recordingFailure: null,
  } as unknown as CanonicalWorkItemProjection;
}

function stagedWorkItem(): CanonicalWorkItemProjection {
  const withInput = withStagedApplicabilityInput(
    initialWorkItem(),
    applicabilityInput('NEW'),
  );
  const withApplicability = withStagedApplicability(
    withInput,
    applicability('NEW', 'ATT-APP-NEW'),
    attempt('ATT-APP-NEW', withInput.revision),
  );
  return withStagedBaseRules(
    withApplicability,
    baseRules('NEW', 'ATT-DYNAMIC-NEW'),
    attempt('ATT-DYNAMIC-NEW', withApplicability.revision),
  );
}

function servingFields(workItem: CanonicalWorkItemProjection) {
  return {
    applicabilityInput: workItem.applicabilityInput,
    applicability: workItem.applicability,
    integratedAssessment: workItem.integratedAssessment,
    aeo: workItem.aeo,
  };
}

function applicabilityInput(
  identity: 'OLD' | 'NEW',
): CanonicalApplicabilityInputProjection {
  return {
    schemaVersion: 'wiselink.3_1.applicability_input_projection.v1',
    applicabilityContextRef: `APCTX-${identity}`,
    workItemId: 'WI-REEVALUATION',
    documentVersionId: 'DV-1',
    sourcePackageId: 'PKG-1',
    sourcePackageContentHash: 'PACKAGE-HASH-1',
    sourcePackageArtifactSha256: artifact('unused', '1').sha256,
    targetBindingHash: `TARGET-${identity}`,
    selectionRevision: `SELECTION-${identity}`,
    bindingRevision: `BINDING-${identity}`,
    currentness: 'CURRENT',
    aircraftNumber: 'B-2035',
    assessmentAsOf: '2026-09-01',
    fleetMasterData: {
      schemaVersion: 'wiselink.v3_1.applicability_fleet.fleet_master_data.v1',
      sourceSnapshotId: `FLEET-${identity}`,
      sourceRevisionKey: `FLEET-REV-${identity}`,
      authorityRevision: `AUTH-${identity}`,
      sourceAsOf: '2026-09-01',
      assets: [],
      facts: [],
    },
  };
}

function applicability(
  identity: 'OLD' | 'NEW',
  actionAttemptId: string,
): CanonicalApplicabilityCandidateProjection {
  const input = applicabilityInput(identity);
  return {
    schemaVersion: 'wiselink.3_1.applicability_candidate_projection.v1',
    status: 'CANDIDATE_ONLY',
    currentness: 'CURRENT',
    staleReason: null,
    sourceResultId: `openclaw-applicability://${identity}`,
    actionAttemptId,
    inputRevision: 10,
    documentId: 'DOC-1',
    documentVersionId: 'DV-1',
    sourcePackageId: 'PKG-1',
    sourcePackageContentHash: 'PACKAGE-HASH-1',
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
    artifact: artifact(`artifact://applicability-${identity}`, '2'),
  };
}

function baseRules(
  identity: 'OLD' | 'NEW',
  actionAttemptId: string,
): CanonicalBaseRuleCandidateProjection {
  return {
    status: 'CANDIDATE_ONLY',
    revision: identity === 'OLD' ? 1 : 2,
    sourceResultId: `openclaw-dynamic://${identity}`,
    criterionSetId: 'JOB-AID-1',
    criterionCount: 1,
    evaluationItemCount: 1,
    unresolvedCount: 0,
    sourceBoundCandidateCount: 1,
    artifact: artifact(
      `artifact://base-${identity}`,
      identity === 'OLD' ? '3' : '5',
    ),
    actionAttemptId,
  };
}

function overallProjection(
  identity: 'OLD' | 'NEW',
  actionAttemptId: string,
): CanonicalOpenClawOverallProjection {
  const base = baseRules(
    identity,
    identity === 'OLD' ? 'ATT-DYNAMIC-OLD' : 'ATT-DYNAMIC-NEW',
  );
  return {
    status: 'CANDIDATE_ONLY',
    revision: identity === 'OLD' ? 1 : 2,
    sourceResultId: `openclaw-overall://${identity}`,
    basedOnBaseRuleRevision: base.revision,
    basedOnBaseRuleArtifactSha256: base.artifact.sha256,
    basedOnEngineerReviewRevision: null,
    basedOnEngineerReviewArtifactSha256: null,
    discoveryStatus: 'NO_DISCOVERY',
    gap: null,
    candidateRefCount: 1,
    findingCount: 1,
    unresolvedCount: 0,
    authorityLevel: 'candidate_only',
    externalDiscoveryIsEvidence: false,
    artifact: artifact(
      `artifact://overall-${identity}`,
      identity === 'OLD' ? '4' : '6',
    ),
    actionAttemptId,
    staleReason: null,
  };
}

function attempt(
  attemptId: string,
  baseRevision: number,
): CanonicalConfigurationEvidenceReevaluationAttemptBinding {
  return {
    attemptId,
    attemptRef: `REF-${attemptId}`,
    inputRevision: baseRevision,
    baseRevision,
  };
}

function artifact(
  ref: string,
  digit: string,
): UnifiedPackageArtifactDescriptor {
  return {
    storeRole: 'UnifiedArtifactStoreCandidate',
    ref,
    sha256: digit.repeat(64),
    byteLength: 1,
    mediaType: 'application/json',
  };
}
