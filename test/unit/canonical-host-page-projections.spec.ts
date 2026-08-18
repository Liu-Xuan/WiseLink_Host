import type {
  CanonicalEngineerReviewLedgerProjection,
  CanonicalEngineerReviewPageContext,
  CanonicalWorkItemProjection,
  UnifiedPackageArtifactDescriptor,
  UnifiedReaderQueryResult,
} from '../../shared/api.interface';
import { buildCanonicalPageProjections } from '../../server/modules/canonical-host/canonical-host-page-projections';

function artifact(
  suffix: string,
  byteLength: number,
): UnifiedPackageArtifactDescriptor {
  return {
    storeRole: 'UnifiedArtifactStoreCandidate',
    ref: `artifact://UnifiedArtifactStoreCandidate/test/${suffix}.json`,
    sha256: `sha256-${suffix}`,
    byteLength,
    mediaType: 'application/json',
  };
}

const reviewLedgerArtifact: UnifiedPackageArtifactDescriptor = artifact(
  'review-ledger',
  1024,
);

const engineerReviewLedger: CanonicalEngineerReviewLedgerProjection = {
  status: 'HUMAN_REVIEW_RECORDED',
  revision: 1,
  reviewCount: 1,
  criterionSetId: 'job-aid-current',
  artifact: reviewLedgerArtifact,
  actionAttemptId: 'ATT-REVIEW-001',
};

const workItem: CanonicalWorkItemProjection = {
  schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
  workItemId: 'WI-PROJECTION-001',
  requestId: 'REQ-PROJECTION-001',
  revision: 14,
  phase: 'CANDIDATE_READBACK_VERIFIED',
  permissionSnapshotVersion: 'perm-v1',
  parseAuthorization: {
    action: 'PARSE_PDF',
    actorFingerprint: 'actor-fingerprint',
    decisionId: 'decision-parse',
    decisionHash: 'decision-hash',
    permissionSnapshotVersion: 'perm-v1',
  },
  source: {
    documentId: 'DOC-737-SB',
    documentVersionId: 'document_version_projection_001',
    parserRequestId: 'parser-request-001',
    sourceArtifactId: 'drive://source/SB.pdf',
    sourceFileSha256: 'source-sha256',
    sourceByteLength: 1060204,
    driveFileToken: 'drive-token',
    driveSourceVersion: 'v1',
  },
  classification: {
    status: 'CONFIRMED',
    normalizedFamily: 'SB',
    classifierReleaseId: 'classifier-release',
    classifierReleaseHash: 'classifier-hash',
    parserProfileId: 'parser-profile',
    parserProfileHash: 'parser-profile-hash',
    fingerprint: 'classification-fingerprint',
  },
  package: {
    packageId: 'urn:techpub:package:v1:sha256:package',
    contractId: 'techpub.parsed-package.v1',
    contractRevision: 'frozen.2',
    artifact: artifact('package', 273349),
    contentHash: 'content-hash',
    semanticHash: 'semantic-hash',
    provenanceHash: 'provenance-hash',
    coverageHash: 'coverage-hash',
    resultStatus: 'partial',
    title: '737 Service Bulletin',
    documentIdentity: {
      documentCode: 'SB-737-001',
      businessRevision: 'R1',
    },
    contentUnitCount: 75,
    sourceRefCount: 76,
    readerReceiptId: 'reader-receipt-001',
    usagePolicy: {
      presentationMode: 'ENGINEERING_DOCUMENT',
      qualityStatus: 'PASS',
      applicability: {
        sourceExpressionCount: 0,
        normalizedCandidateCount: 0,
        assignmentCount: 0,
      },
      assessmentAutoAdoptionAllowed: false,
      aeoAutoAdoptionAllowed: false,
      projectionSource: 'IMMUTABLE_PACKAGE_ACTUAL_BYTES',
    },
    fullValidatorProof: {
      validatorId: 'U0Frozen2SchemaSemanticValidator',
      validatorRevision: 'validator-revision',
      contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
      artifactSha256: 'sha256-package',
    },
  },
  assessment: null,
  integratedAssessment: {
    status: 'OVERALL_CANDIDATE_READY',
    baseRules: {
      status: 'CANDIDATE_ONLY',
      revision: 1,
      sourceResultId: 'openclaw-dynamic-result-001',
      criterionSetId: 'job-aid-current',
      criterionCount: 150,
      evaluationItemCount: 150,
      unresolvedCount: 2,
      sourceBoundCandidateCount: 148,
      artifact: artifact('dynamic', 50000),
      actionAttemptId: 'ATT-DYNAMIC-001',
    },
    engineerReviews: engineerReviewLedger,
    overallSynthesis: {
      status: 'CANDIDATE_ONLY',
      revision: 2,
      sourceResultId: 'openclaw-overall-result-002',
      basedOnBaseRuleRevision: 1,
      basedOnBaseRuleArtifactSha256: 'sha256-dynamic',
      basedOnEngineerReviewRevision: 1,
      basedOnEngineerReviewArtifactSha256: 'sha256-review-ledger',
      discoveryStatus: 'NO_DISCOVERY',
      gap: null,
      candidateRefCount: 12,
      findingCount: 9,
      unresolvedCount: 1,
      authorityLevel: 'candidate_only',
      externalDiscoveryIsEvidence: false,
      artifact: artifact('overall', 64000),
      actionAttemptId: 'ATT-OVERALL-002',
      staleReason: null,
    },
    overallForAeoConfirmation: null,
  },
  aeo: null,
  failure: null,
  recordingFailure: null,
};

const queryResults: UnifiedReaderQueryResult[] = [
  {
    unitId: 'CU-001',
    kind: 'paragraph',
    text: 'Applicability paragraph.',
    sourceRefIds: ['SRC-001'],
  },
  {
    unitId: 'CU-002',
    kind: 'table',
    text: 'Effectivity table.',
    sourceRefIds: ['SRC-001', 'SRC-002'],
  },
];

const engineerReviewContext: CanonicalEngineerReviewPageContext = {
  criterionSetId: 'job-aid-current',
  baseRuleRevision: 1,
  ledger: engineerReviewLedger,
  items: [
    {
      criterionId: 'APP-001',
      dynamicResult: 'NEEDS_REVIEW',
      candidateConclusion: 'deferred',
      humanReviewRequired: true,
      latestReview: {
        decision: 'deferred',
        status: 'NEEDS_REVIEW',
        comment: '等待受控机队事实。',
        recordedAt: '2026-08-18T09:27:54.269Z',
      },
    },
  ],
};

describe('canonical Host page projections', () => {
  it('builds current-WorkItem library, relation, audit, and timeline views', () => {
    const projections = buildCanonicalPageProjections({
      workItem,
      queryResults,
      engineerReviewContext,
    });

    expect(projections.libraryIndex.scope).toBe('CURRENT_WORKITEM_ONLY');
    expect(projections.libraryIndex.nodes.map((node) => node.id)).toContain(
      'overall-synthesis',
    );
    expect(
      projections.libraryIndex.completeness.crossWorkItemLibraryAvailable,
    ).toBe(false);
    expect(
      projections.relatedDocuments.boundary.externalRelatedDocumentsInferred,
    ).toBe(false);
    expect(
      projections.relatedDocuments.relations.map(
        (relation) => relation.relationRole,
      ),
    ).toContain('HAS_OVERALL_SYNTHESIS');
    expect(projections.workbenchAudit.reader.uniqueSourceRefCount).toBe(2);
    expect(
      projections.workbenchAudit.reader.applicabilityConclusionAllowed,
    ).toBe(false);
    expect(
      projections.workbenchAudit.applicabilityAuthority
        .inferredFromDocumentPresence,
    ).toBe(false);
    expect(projections.workbenchAudit.engineerReview?.reviewCount).toBe(1);
    expect(projections.timeline.events.map((event) => event.kind)).toEqual([
      'WORKITEM_REVISION',
      'DOCUMENT_VERSION_BOUND',
      'PACKAGE_READBACK',
      'READER_QUERY',
      'DYNAMIC_EVALUATION',
      'ENGINEER_REVIEW',
      'OVERALL_SYNTHESIS',
    ]);
    expect(
      projections.timeline.events.find(
        (event) => event.kind === 'ENGINEER_REVIEW',
      )?.occurredAt,
    ).toBe('2026-08-18T09:27:54.269Z');
  });
});
