import type {
  CanonicalEngineerReviewPageContext,
  CanonicalIntegratedAssessmentProjection,
  CanonicalWorkbenchAuditProjection,
  CanonicalReaderProjection,
} from '../../shared/api.interface';
import {
  buildAssessmentBusinessContent,
  buildAssessmentSemantics,
  buildReaderCapabilities,
  describeTranslationProjection,
  getReaderViewMode,
} from '../../client/src/pages/DocumentParsingPage/workbench-projection';
import {
  getWorkbenchNode,
  structuredSourceDeepLink,
  WORKBENCH_TAB_DEFINITIONS,
} from '../../client/src/pages/DocumentParsingPage/document-parsing-navigation';

describe('canonical Host workbench projection', () => {
  it('keeps assessment-first navigation and the four R05.5 mobile tabs', () => {
    expect(getWorkbenchNode(null)).toBe('assessment');
    expect(getWorkbenchNode('unknown')).toBe('assessment');
    expect(
      WORKBENCH_TAB_DEFINITIONS.filter((tab) => tab.mobileLabel)
        .sort(
          (left, right) => (left.mobileOrder ?? 99) - (right.mobileOrder ?? 99),
        )
        .map((tab) => tab.mobileLabel),
    ).toEqual(['总体', '原文', '复核', '动态']);
  });

  it('routes a structured page locator to the source reader intent', () => {
    expect(structuredSourceDeepLink('SOURCE-REF-1', 22)).toEqual({
      node: 'reader',
      tab: 'reader',
      unit: null,
      sourceRef: 'SOURCE-REF-1',
      readerMode: 'source',
      page: '22',
    });
  });

  it('keeps PDF and bilingual modes explicit when Host data is absent', () => {
    const capabilities = buildReaderCapabilities({
      readerProjection: null,
    });

    expect(getReaderViewMode('unknown')).toBe('structured');
    expect(capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mode: 'source', status: 'UNAVAILABLE' }),
        expect.objectContaining({
          mode: 'structured',
          status: 'UNAVAILABLE',
        }),
        expect.objectContaining({ mode: 'bilingual', status: 'UNAVAILABLE' }),
      ]),
    );
    expect(capabilities[0].note).toContain('PDF 页面预览');
    expect(capabilities[2].note).toContain('尚无可核验的译文');
  });

  it('reports structured Reader availability from Host audit only', () => {
    const capabilities = buildReaderCapabilities({
      readerProjection: readerProjection(),
    });

    expect(capabilities[1]).toEqual(
      expect.objectContaining({ mode: 'structured', status: 'AVAILABLE' }),
    );
    expect(capabilities[1].note).toContain('2 个内容单元');
    expect(capabilities[1].note).toContain('2 个可定位到原文页码');
  });

  it('reports a full-download PDF capability without claiming Range', () => {
    const projection = readerProjection();
    projection.pdfPreview = {
      status: 'AVAILABLE',
      opaqueLocator: 'opaque-test-locator',
      expiresAt: '2026-08-28T18:00:00.000Z',
      mediaType: 'application/pdf',
      byteLength: 1_060_204,
      supportsRange: false,
      navigation: 'PAGE_START',
    };

    const capabilities = buildReaderCapabilities({
      readerProjection: projection,
    });

    expect(capabilities[0]).toEqual(
      expect.objectContaining({ mode: 'source', status: 'AVAILABLE' }),
    );
    expect(capabilities[0].note).toContain('完整读取');
    expect(capabilities[0].note).not.toContain('按页加载');
  });

  it('uses Host Reader locators and business assessment content without a second source', () => {
    const projection = readerProjection();
    expect(projection.units[0].sourceLocators[0]).toMatchObject({
      sourceRefId: 'SRC-001',
      pageStart: 4,
      pageEnd: 5,
      charStart: 12,
      charEnd: 42,
      normalizedPath: '/section/applicability',
    });
    const content = buildAssessmentBusinessContent(
      integratedAssessmentWithBusinessContent(),
      reviewContextWithBusinessContent(),
      'RULE-1',
    );
    expect(content.overall?.overallCandidate).toContain('候选综合');
    expect(content.overall?.findings?.[0].sourceRefIds).toEqual(['SRC-001']);
    expect(content.overall?.missingInputs).toEqual(['受控机队事实']);
    expect(content.selectedReviewItem).toMatchObject({
      factsConsidered: ['文档事实 A'],
      ruleApplication: '规则应用 A',
      analysisSummary: '分析摘要 A',
      sourceRefs: ['SRC-001'],
      missingInputs: ['输入 A'],
    });
  });

  describe('describeTranslationProjection (two-axis view model)', () => {
    it('renders unavailable without inventing an axis', () => {
      const view = describeTranslationProjection({
        status: 'UNAVAILABLE',
        reason: 'TRANSLATION_PROJECTION_NOT_AVAILABLE',
      });
      expect(view.capability).toBe('UNAVAILABLE');
      expect(view.ownerSourceReaderConsumptionAllowed).toBe(false);
      expect(view.bilingualTranslationConsumptionAllowed).toBe(false);
      expect(view.detail).toContain('尚未提供可核验的译文');
    });

    it('renders translation_pending as source-current with the bilingual axis closed', () => {
      const view = describeTranslationProjection({
        status: 'SOURCE_CURRENT_TRANSLATION_PENDING',
        axes: {
          ownerProductState: 'translation_pending',
          ownerSourceReaderConsumptionAllowed: true,
          bilingualTranslationConsumptionAllowed: false,
          translatedUnitCount: 4,
          pendingTranslationUnitCount: 6,
          translationRequiredUnitCount: 10,
          failureReasons: [],
        },
      });
      expect(view.capability).toBe('LIMITED');
      expect(view.headline).toBe('原文可读，译文仍在准备');
      expect(view.detail).toContain('仍有 6 个待生成');
      expect(view.ownerSourceReaderConsumptionAllowed).toBe(true);
      expect(view.bilingualTranslationConsumptionAllowed).toBe(false);
    });

    it('renders bilingual readiness only when the owner axes allow it', () => {
      const view = describeTranslationProjection({
        status: 'BILINGUAL_READING_AID_AVAILABLE',
        axes: {
          ownerProductState: 'reading_aid_available',
          ownerSourceReaderConsumptionAllowed: true,
          bilingualTranslationConsumptionAllowed: true,
          translatedUnitCount: 10,
          pendingTranslationUnitCount: 0,
          translationRequiredUnitCount: 10,
          failureReasons: [],
        },
      });
      expect(view.capability).toBe('AVAILABLE');
      expect(view.ownerSourceReaderConsumptionAllowed).toBe(true);
      expect(view.bilingualTranslationConsumptionAllowed).toBe(true);
      expect(view.detail).toContain('10/10');
    });

    it('renders a user-readable gap with both axes closed', () => {
      const view = describeTranslationProjection({
        status: 'TRANSLATION_GAP',
        axes: {
          ownerProductState: 'needs_inputs',
          ownerSourceReaderConsumptionAllowed: false,
          bilingualTranslationConsumptionAllowed: false,
          translatedUnitCount: 0,
          pendingTranslationUnitCount: 10,
          translationRequiredUnitCount: 10,
          failureReasons: ['OWNER_CURRENT_CONSUMPTION_DENIED'],
        },
      });
      expect(view.capability).toBe('UNAVAILABLE');
      expect(view.detail).toContain('尚未通过完整性校验');
      expect(view.detail).not.toContain('OWNER_CURRENT_CONSUMPTION_DENIED');
      expect(view.ownerSourceReaderConsumptionAllowed).toBe(false);
      expect(view.bilingualTranslationConsumptionAllowed).toBe(false);
    });
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

function readerProjection(): CanonicalReaderProjection {
  return {
    sourceKind: 'native_s1000d',
    structuredUnitCount: 2,
    sourceRefCount: 2,
    query: 'applicability',
    units: [
      {
        unitId: 'UNIT-1',
        kind: 'paragraph',
        text: '受控原文',
        sourceRefIds: ['SRC-001'],
        sourceLocators: [
          {
            sourceRefId: 'SRC-001',
            kind: 'pdf',
            artifactId: 'ART-1',
            pageStart: 4,
            pageEnd: 5,
            charStart: 12,
            charEnd: 42,
            charOffsetUnit: 'utf16',
            normalizedPath: '/section/applicability',
            xpath: null,
            elementId: 'app-1',
            quote: '受控原文',
            bbox: [1, 2, 3, 4],
          },
        ],
      },
      {
        unitId: 'UNIT-2',
        kind: 'table',
        text: '受控表格',
        sourceRefIds: ['SRC-002'],
        sourceLocators: [
          {
            sourceRefId: 'SRC-002',
            kind: 'xml',
            artifactId: 'ART-1',
            pageStart: null,
            pageEnd: null,
            charStart: null,
            charEnd: null,
            charOffsetUnit: null,
            normalizedPath: '/table/effectivity',
            xpath: '/root/table[1]',
            elementId: null,
            quote: null,
            bbox: null,
          },
        ],
      },
    ],
    pdfPreview: {
      status: 'UNAVAILABLE',
      reason: 'PDF_PREVIEW_NOT_CONFIGURED',
      retryable: false,
    },
    translation: {
      status: 'UNAVAILABLE',
      reason: 'TRANSLATION_PROJECTION_NOT_AVAILABLE',
    },
  };
}

function integratedAssessmentWithBusinessContent(): CanonicalIntegratedAssessmentProjection {
  return {
    ...integratedAssessment(),
    overallSynthesis: {
      ...integratedAssessment().overallSynthesis!,
      overallCandidate: '候选综合：需要人工复核。',
      applicabilityStatus: '待人工复核',
      findings: [
        {
          finding: '适用性存在条件',
          basis: '依据文档事实 A',
          sourceRefIds: ['SRC-001'],
          assumptions: ['假设 A'],
          uncertainty: '不确定性 A',
        },
      ],
      missingInputs: ['受控机队事实'],
    },
  };
}

function reviewContextWithBusinessContent(): CanonicalEngineerReviewPageContext {
  return {
    ...reviewContext(),
    items: [
      {
        ...reviewContext().items[0],
        factsConsidered: ['文档事实 A'],
        ruleApplication: '规则应用 A',
        analysisSummary: '分析摘要 A',
        sourceRefs: ['SRC-001'],
        missingInputs: ['输入 A'],
      },
    ],
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
