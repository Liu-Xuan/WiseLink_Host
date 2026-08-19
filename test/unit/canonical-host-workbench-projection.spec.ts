import type {
  CanonicalEngineerReviewPageContext,
  CanonicalIntegratedAssessmentProjection,
  CanonicalWorkbenchAuditProjection,
} from '../../shared/api.interface';
import {
  buildAssessmentSemantics,
  buildReaderCapabilities,
  getReaderViewMode,
} from '../../client/src/pages/DocumentParsingPage/workbench-projection';

describe('canonical Host workbench projection', () => {
  it('keeps PDF and bilingual modes explicit when Host data is absent', () => {
    const capabilities = buildReaderCapabilities({
      source: {
        documentId: 'DOC-1',
        documentVersionId: 'DV-1',
        parserRequestId: 'REQ-1',
        sourceArtifactId: 'ART-1',
        sourceFileSha256: 'abc',
        sourceByteLength: 1024,
        driveFileToken: 'FILE-1',
        driveSourceVersion: 'V1',
      },
      package: null,
      canQueryParsedUnits: false,
      readerAudit: readerAudit(0, 0),
    });

    expect(getReaderViewMode('unknown')).toBe('structured');
    expect(capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mode: 'source', status: 'LIMITED' }),
        expect.objectContaining({
          mode: 'structured',
          status: 'UNAVAILABLE',
        }),
        expect.objectContaining({ mode: 'bilingual', status: 'UNAVAILABLE' }),
      ]),
    );
    expect(capabilities[0].note).toContain('未投影 PDF 预览 URL');
    expect(capabilities[2].note).toContain('不会推断或补造译文');
  });

  it('reports structured Reader availability from Host audit only', () => {
    const capabilities = buildReaderCapabilities({
      source: {
        documentId: 'DOC-1',
        documentVersionId: 'DV-1',
        parserRequestId: 'REQ-1',
        sourceArtifactId: 'ART-1',
        sourceFileSha256: 'abc',
        sourceByteLength: 1024,
        driveFileToken: 'FILE-1',
        driveSourceVersion: 'V1',
      },
      package: {
        packageId: 'PKG-1',
        contractId: 'techpub.parsed-package.v1',
        contractRevision: 'frozen.2',
        artifact: artifact('PKG-ART'),
        contentHash: 'content',
        semanticHash: 'semantic',
        provenanceHash: 'provenance',
        coverageHash: 'coverage',
        resultStatus: 'complete',
        title: 'SB test',
        contentUnitCount: 4,
        sourceRefCount: 3,
        readerReceiptId: 'RECEIPT-1',
        fullValidatorProof: {
          validatorId: 'U0Frozen2SchemaSemanticValidator',
          validatorRevision: 'V1',
          contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
          artifactSha256: 'PKG-ART',
        },
      },
      canQueryParsedUnits: true,
      readerAudit: readerAudit(4, 3),
    });

    expect(capabilities[1]).toEqual(
      expect.objectContaining({ mode: 'structured', status: 'AVAILABLE' }),
    );
    expect(capabilities[1].note).toContain('4 个单元');
    expect(capabilities[1].note).toContain('3 个完成来源绑定');
  });

  it('surfaces stale, source, review, and missing-input gaps', () => {
    const semantics = buildAssessmentSemantics({
      integratedAssessment: integratedAssessment(),
      engineerReviewContext: reviewContext(),
      readerAudit: readerAudit(3, 2),
    });

    expect(semantics.candidateState).toBe('STALE');
    expect(semantics.dynamic).toEqual(
      expect.objectContaining({ criterionCount: 3, unresolvedCount: 1 }),
    );
    expect(semantics.review.pendingCount).toBe(1);
    expect(semantics.gaps.map((gap) => gap.code)).toEqual(
      expect.arrayContaining([
        'READER_SOURCE_BINDING_MISSING',
        'DYNAMIC_ITEMS_UNRESOLVED',
        'ENGINEER_REVIEW_PENDING',
        'OVERALL_CANDIDATE_STALE',
        'OVERALL_GAP_REPORTED',
        'OVERALL_ITEMS_UNRESOLVED',
      ]),
    );
    expect(semantics.boundary).toContain('不构成工程、适航或发布结论');
  });
});

function artifact(sha256: string) {
  return {
    storeRole: 'UnifiedArtifactStoreCandidate' as const,
    ref: `artifact://${sha256}`,
    sha256,
    byteLength: 100,
    mediaType: 'application/json' as const,
  };
}

function readerAudit(
  queryResultCount: number,
  sourceBoundResultCount: number,
): CanonicalWorkbenchAuditProjection['reader'] {
  return {
    queryResultCount,
    sourceBoundResultCount,
    uniqueSourceRefCount: sourceBoundResultCount,
    allReturnedResultsSourceBound: queryResultCount === sourceBoundResultCount,
    applicabilityConclusionAllowed: false,
    note: 'Host Reader audit',
  };
}

function integratedAssessment(): CanonicalIntegratedAssessmentProjection {
  return {
    status: 'OVERALL_CANDIDATE_STALE',
    baseRules: {
      status: 'CANDIDATE_ONLY',
      revision: 2,
      sourceResultId: 'BASE-1',
      criterionSetId: 'RULESET-1',
      criterionCount: 3,
      evaluationItemCount: 3,
      unresolvedCount: 1,
      sourceBoundCandidateCount: 2,
      artifact: artifact('BASE-ART'),
      actionAttemptId: 'ATT-BASE',
    },
    overallSynthesis: {
      status: 'STALE',
      revision: 2,
      sourceResultId: 'OVERALL-1',
      basedOnBaseRuleRevision: 2,
      basedOnBaseRuleArtifactSha256: 'BASE-ART',
      basedOnEngineerReviewRevision: 1,
      basedOnEngineerReviewArtifactSha256: 'REVIEW-ART',
      discoveryStatus: 'PARTIAL_RESULTS',
      gap: '缺少受控机队构型输入',
      candidateRefCount: 2,
      findingCount: 1,
      unresolvedCount: 1,
      authorityLevel: 'candidate_only',
      externalDiscoveryIsEvidence: false,
      artifact: artifact('OVERALL-ART'),
      actionAttemptId: 'ATT-OVERALL',
      staleReason: 'ENGINEER_REVIEW_CHANGED',
    },
  };
}

function reviewContext(): CanonicalEngineerReviewPageContext {
  return {
    criterionSetId: 'RULESET-1',
    baseRuleRevision: 2,
    ledger: null,
    items: [
      {
        criterionId: 'RULE-1',
        dynamicResult: 'WAITING_INPUT',
        candidateConclusion: 'conditional',
        humanReviewRequired: true,
        latestReview: null,
      },
    ],
  };
}
