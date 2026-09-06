import type {
  CanonicalApplicabilityCandidateProjection,
  CanonicalApplicabilityInputProjection,
  CanonicalIntegratedAssessmentProjection,
  CanonicalTranslationCandidateProjection,
  CanonicalWorkItemProjection,
  UnifiedPackageArtifactDescriptor,
} from '@shared/api.interface';

import {
  projectCanonicalHostInitialAnalysisStatus,
  type CanonicalInitialAnalysisAttemptObservation,
} from '../../server/modules/canonical-host/canonical-host-initial-analysis-status.service';
import {
  CANONICAL_TRANSLATION_RULE_SET_V1_ID,
  CANONICAL_TRANSLATION_RULE_SET_V1_VERSION,
} from '../../server/modules/canonical-host/canonical-translation-rule-set-v1.private';

const HASH = `sha256:${'a'.repeat(64)}`;
const OTHER_HASH = `sha256:${'b'.repeat(64)}`;

describe('CanonicalHost initial-analysis status projection', () => {
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
    const status = projectCanonicalHostInitialAnalysisStatus(
      parsedWorkItem(),
      [attempt('OPENCLAW_TRANSLATE', 'SUCCEEDED')],
    );

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
