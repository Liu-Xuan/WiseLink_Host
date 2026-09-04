import type {
  CanonicalApplicabilityCandidateProjection,
  CanonicalApplicabilityInputProjection,
  CanonicalWorkItemProjection,
} from '../../shared/api.interface';

import {
  relatedContextAssessmentTarget,
  resolveCanonicalRelatedTargetApplicability,
} from '../../server/modules/canonical-host/canonical-related-context-applicability';

describe('canonical related-context target applicability', () => {
  const primary = workItem('WI-PRIMARY', 'DV-PRIMARY', 'PKG-PRIMARY');
  primary.applicabilityInput = applicabilityInput(primary);
  const assessmentTarget = relatedContextAssessmentTarget(primary);

  it.each([
    ['APPLICABLE', 'APPLICABLE'],
    ['NOT_APPLICABLE', 'NOT_APPLICABLE'],
    ['UNKNOWN', 'UNKNOWN'],
  ] as const)(
    'reuses the related document own CURRENT %s Host result',
    (_name, decision) => {
      const related = workItem('WI-RELATED', 'DV-RELATED', 'PKG-RELATED');
      related.applicability = applicabilityResult(related, decision);

      expect(
        resolveCanonicalRelatedTargetApplicability(assessmentTarget, related),
      ).toEqual({
        targetApplicability: decision,
        applicabilityResultRef: 'openclaw-applicability://RESULT-RELATED',
      });
    },
  );

  it.each([
    [
      'missing result',
      (result: CanonicalApplicabilityCandidateProjection) => null,
    ],
    [
      'stale result',
      (result: CanonicalApplicabilityCandidateProjection) => ({
        ...result,
        status: 'STALE' as const,
        currentness: 'STALE' as const,
      }),
    ],
    [
      'different document version',
      (result: CanonicalApplicabilityCandidateProjection) => ({
        ...result,
        documentVersionId: 'DV-OLD',
      }),
    ],
    [
      'different package',
      (result: CanonicalApplicabilityCandidateProjection) => ({
        ...result,
        sourcePackageId: 'PKG-OLD',
      }),
    ],
    [
      'different aircraft',
      (result: CanonicalApplicabilityCandidateProjection) => ({
        ...result,
        aircraftNumber: 'B-9999',
      }),
    ],
    [
      'different fleet revision',
      (result: CanonicalApplicabilityCandidateProjection) => ({
        ...result,
        fleetSourceRevisionKey: 'fleet-revision-old',
      }),
    ],
  ])('maps %s to NOT_EVALUATED without a result ref', (_name, change) => {
    const related = workItem('WI-RELATED', 'DV-RELATED', 'PKG-RELATED');
    related.applicability = change(applicabilityResult(related, 'APPLICABLE'));

    expect(
      resolveCanonicalRelatedTargetApplicability(assessmentTarget, related),
    ).toEqual({ targetApplicability: 'NOT_EVALUATED' });
  });

  it('does not expose a target without a current primary Host selection', () => {
    const primaryWithoutTarget = workItem(
      'WI-PRIMARY',
      'DV-PRIMARY',
      'PKG-PRIMARY',
    );
    const related = workItem('WI-RELATED', 'DV-RELATED', 'PKG-RELATED');
    related.applicability = applicabilityResult(related, 'APPLICABLE');

    expect(relatedContextAssessmentTarget(primaryWithoutTarget)).toBeNull();
    expect(resolveCanonicalRelatedTargetApplicability(null, related)).toEqual({
      targetApplicability: 'NOT_EVALUATED',
    });
  });
});

function workItem(
  workItemId: string,
  documentVersionId: string,
  packageId: string,
): CanonicalWorkItemProjection {
  return {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId,
    requestId: `REQ-${workItemId}`,
    revision: 3,
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
      documentId: `DOC-${workItemId}`,
      documentVersionId,
      parserRequestId: 'PARSER-1',
      sourceArtifactId: 'SOURCE-1',
      sourceFileSha256: 'a'.repeat(64),
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
      packageId,
      contractId: 'techpub.parsed-package.v1',
      contractRevision: 'frozen.2',
      artifact: {
        storeRole: 'UnifiedArtifactStoreCandidate',
        ref: `artifact://${packageId}`,
        sha256: 'b'.repeat(64),
        byteLength: 100,
        mediaType: 'application/json',
      },
      contentHash: `content-${packageId}`,
      semanticHash: 'semantic-hash',
      provenanceHash: 'provenance-hash',
      coverageHash: 'coverage-hash',
      resultStatus: 'complete',
      title: workItemId,
      contentUnitCount: 1,
      sourceRefCount: 1,
      readerReceiptId: 'receipt-1',
      fullValidatorProof: {
        validatorId: 'U0Frozen2SchemaSemanticValidator',
        validatorRevision: 'validator-v1',
        contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
        artifactSha256: 'b'.repeat(64),
      },
    },
    failure: null,
    recordingFailure: null,
  };
}

function applicabilityInput(
  item: CanonicalWorkItemProjection,
): CanonicalApplicabilityInputProjection {
  return {
    schemaVersion: 'wiselink.3_1.applicability_input_projection.v1',
    applicabilityContextRef: 'applicability-context://B-1266/2026-06-05',
    workItemId: item.workItemId,
    documentVersionId: item.source.documentVersionId,
    sourcePackageId: item.package!.packageId,
    sourcePackageContentHash: item.package!.contentHash,
    sourcePackageArtifactSha256: item.package!.artifact.sha256,
    targetBindingHash: 'target-binding-hash',
    selectionRevision: 'selection-v1',
    bindingRevision: 'binding-v1',
    currentness: 'CURRENT',
    aircraftNumber: 'B-1266',
    assessmentAsOf: '2026-06-05',
    fleetMasterData: {
      schemaVersion: 'wiselink.v3_1.applicability_fleet.fleet_master_data.v1',
      sourceSnapshotId: 'fleet-snapshot-1',
      sourceRevisionKey: 'fleet-revision-1',
      authorityRevision: 'fleet-authority-1',
      sourceAsOf: '2026-06-05T00:00:00.000Z',
      assets: [],
      facts: [],
    },
  };
}

function applicabilityResult(
  item: CanonicalWorkItemProjection,
  decision: CanonicalApplicabilityCandidateProjection['decision'],
): CanonicalApplicabilityCandidateProjection {
  return {
    schemaVersion: 'wiselink.3_1.applicability_candidate_projection.v1',
    status: decision === 'UNKNOWN' ? 'WAITING_INPUT' : 'CANDIDATE_ONLY',
    currentness: 'CURRENT',
    staleReason: null,
    sourceResultId: 'openclaw-applicability://RESULT-RELATED',
    actionAttemptId: 'ATT-RELATED',
    inputRevision: 3,
    documentId: item.source.documentId,
    documentVersionId: item.source.documentVersionId,
    sourcePackageId: item.package!.packageId,
    sourcePackageContentHash: item.package!.contentHash,
    translationActionAttemptId: 'ATT-TRANSLATION',
    applicabilityContextRef: 'applicability-context://related',
    applicabilityBindingRevision: 'binding-v1',
    aircraftNumber: 'B-1266',
    assessmentAsOf: '2026-06-05',
    fleetSourceSnapshotId: 'fleet-snapshot-1',
    fleetSourceRevisionKey: 'fleet-revision-1',
    fleetAuthorityRevision: 'fleet-authority-1',
    fleetSourceAsOf: '2026-06-05T00:00:00.000Z',
    sourceExpressionCount: 1,
    sourceRefCount: 1,
    decision,
    kleeneResult:
      decision === 'APPLICABLE'
        ? true
        : decision === 'NOT_APPLICABLE'
          ? false
          : 'unknown',
    pass: decision === 'APPLICABLE',
    blockingUnknownCount: decision === 'UNKNOWN' ? 1 : 0,
    artifact: {
      storeRole: 'UnifiedArtifactStoreCandidate',
      ref: 'artifact://related-applicability',
      sha256: 'c'.repeat(64),
      byteLength: 100,
      mediaType: 'application/json',
    },
  };
}
