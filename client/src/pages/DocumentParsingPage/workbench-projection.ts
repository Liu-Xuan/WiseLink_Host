import type {
  CanonicalEngineerReviewPageContext,
  CanonicalIntegratedAssessmentProjection,
  CanonicalOpenClawOverallProjection,
  CanonicalReaderProjection,
  CanonicalReaderTranslationProjection,
  CanonicalWorkbenchAuditProjection,
} from '@shared/api.interface';

type ReaderViewMode = 'source' | 'structured' | 'bilingual';
type ReaderCapabilityStatus = 'AVAILABLE' | 'LIMITED' | 'UNAVAILABLE';

interface ReaderCapability {
  mode: ReaderViewMode;
  label: string;
  status: ReaderCapabilityStatus;
  note: string;
}

interface ReaderProjectionInput {
  readerProjection: CanonicalReaderProjection | null;
}

interface TranslationViewInfo {
  capability: ReaderCapabilityStatus;
  headline: string;
  detail: string;
  ownerSourceReaderConsumptionAllowed: boolean;
  bilingualTranslationConsumptionAllowed: boolean;
}

/**
 * Consume the Host-derived two-axis translation projection. The browser only
 * renders what the Host derived: it never re-derives an axis, matches
 * translation rows, or treats `translation_pending` as bilingual readiness.
 */
function describeTranslationProjection(
  translation: CanonicalReaderTranslationProjection,
): TranslationViewInfo {
  if (translation.status === 'UNAVAILABLE') {
    return {
      capability: 'UNAVAILABLE',
      headline: '中英文对照暂不可用',
      detail: `${translation.reason}。页面不会推断或补造译文。`,
      ownerSourceReaderConsumptionAllowed: false,
      bilingualTranslationConsumptionAllowed: false,
    };
  }
  const axes = translation.axes;
  if (translation.status === 'BILINGUAL_READING_AID_AVAILABLE') {
    return {
      capability: 'AVAILABLE',
      headline: '双语阅读辅助可用（owner 提供为准）',
      detail: `翻译单元 ${axes.translatedUnitCount}/${axes.translationRequiredUnitCount}，待生成 ${axes.pendingTranslationUnitCount}。`,
      ownerSourceReaderConsumptionAllowed:
        axes.ownerSourceReaderConsumptionAllowed,
      bilingualTranslationConsumptionAllowed:
        axes.bilingualTranslationConsumptionAllowed,
    };
  }
  if (translation.status === 'SOURCE_CURRENT_TRANSLATION_PENDING') {
    return {
      capability: 'LIMITED',
      headline: '原文阅读投影当前；译文待生成',
      detail: `翻译单元 ${axes.translatedUnitCount}/${axes.translationRequiredUnitCount}，待生成 ${axes.pendingTranslationUnitCount}。已有译文计数仅展示，不提升双语轴。`,
      ownerSourceReaderConsumptionAllowed:
        axes.ownerSourceReaderConsumptionAllowed,
      bilingualTranslationConsumptionAllowed:
        axes.bilingualTranslationConsumptionAllowed,
    };
  }
  return {
    capability: 'UNAVAILABLE',
    headline: '翻译投影存在缺口（GAP）',
    detail: `未满足的 owner 守卫：${axes.failureReasons.join('、') || '未提供'}。两条消费轴均关闭。`,
    ownerSourceReaderConsumptionAllowed:
      axes.ownerSourceReaderConsumptionAllowed,
    bilingualTranslationConsumptionAllowed:
      axes.bilingualTranslationConsumptionAllowed,
  };
}

interface AssessmentBusinessContent {
  overall: CanonicalOpenClawOverallProjection | null;
  selectedReviewItem:
    | CanonicalEngineerReviewPageContext['items'][number]
    | null;
}

interface AssessmentProjectionInput {
  integratedAssessment: CanonicalIntegratedAssessmentProjection | null;
  engineerReviewContext: CanonicalEngineerReviewPageContext | null;
  readerAudit: CanonicalWorkbenchAuditProjection['reader'];
}

type AssessmentGapCode =
  | 'READER_SOURCE_BINDING_MISSING'
  | 'DYNAMIC_ITEMS_UNRESOLVED'
  | 'ENGINEER_REVIEW_PENDING'
  | 'OVERALL_CANDIDATE_MISSING'
  | 'OVERALL_CANDIDATE_STALE'
  | 'OVERALL_GAP_REPORTED'
  | 'OVERALL_ITEMS_UNRESOLVED';

interface AssessmentGap {
  code: AssessmentGapCode;
  label: string;
  detail: string;
  authority:
    | 'HOST_READER_AUDIT'
    | 'HOST_DYNAMIC_EVALUATION'
    | 'HOST_ENGINEER_REVIEW_CONTEXT'
    | 'HOST_OVERALL_SYNTHESIS';
}

interface AssessmentSemantics {
  candidateState: string;
  dynamic: {
    status: string;
    criterionSetId: string;
    criterionCount: number;
    evaluationItemCount: number;
    unresolvedCount: number;
    sourceBoundCandidateCount: number;
  } | null;
  review: {
    itemCount: number;
    pendingCount: number;
    recordedCount: number;
  };
  overall: {
    status: string;
    discoveryStatus: string;
    gap: string | null;
    findingCount: number;
    candidateRefCount: number;
    unresolvedCount: number;
    staleReason: string | null;
  } | null;
  gaps: AssessmentGap[];
  boundary: string;
}

function getReaderViewMode(value: string | null): ReaderViewMode {
  if (value === 'source' || value === 'bilingual') return value;
  return 'structured';
}

function findReaderProjectionUnit(
  readerProjection: CanonicalReaderProjection | null,
  unitId: string,
  sourceRefId: string,
): CanonicalReaderProjection['units'][number] | undefined {
  return readerProjection?.units.find(
    (unit) =>
      (unitId === '' || unit.unitId === unitId) &&
      (sourceRefId === '' || unit.sourceRefIds.includes(sourceRefId)),
  );
}

function buildReaderCapabilities(
  input: ReaderProjectionInput,
): ReaderCapability[] {
  const projection = input.readerProjection;
  const locatedUnitCount: number =
    projection?.units.filter((unit) => unit.sourceLocators.length > 0).length ??
    0;
  const translationView: TranslationViewInfo | null = projection
    ? describeTranslationProjection(projection.translation)
    : null;

  return [
    {
      mode: 'source',
      label: 'PDF 原文',
      status: projection ? projection.pdfPreview.status : 'UNAVAILABLE',
      note: projection
        ? `PDF 预览：${projection.pdfPreview.status} · ${projection.pdfPreview.reason}`
        : '当前事项没有 Reader projection，尚无可用的 PDF 预览。',
    },
    {
      mode: 'structured',
      label: '结构化原文',
      status: projection ? 'AVAILABLE' : 'UNAVAILABLE',
      note: projection
        ? `当前查询返回 ${projection.units.length} 个单元（内容单元），${locatedUnitCount} 个带 source locator、可定位到原文。`
        : '当前事项没有 Reader projection，尚无可查询的结构化原文。',
    },
    {
      mode: 'bilingual',
      label: '中英文对照',
      status: translationView ? translationView.capability : 'UNAVAILABLE',
      note: translationView
        ? `${translationView.detail} · 原文轴 ${translationView.ownerSourceReaderConsumptionAllowed ? '开放' : '关闭'} / 双语轴 ${translationView.bilingualTranslationConsumptionAllowed ? '开放' : '关闭'}`
        : '当前事项没有 Reader projection；页面不会推断或补造译文。',
    },
  ];
}

function buildAssessmentBusinessContent(
  integratedAssessment: CanonicalIntegratedAssessmentProjection | null,
  engineerReviewContext: CanonicalEngineerReviewPageContext | null,
  selectedCriterionId: string,
): AssessmentBusinessContent {
  const items = engineerReviewContext?.items ?? [];
  return {
    overall: integratedAssessment?.overallSynthesis ?? null,
    selectedReviewItem:
      items.find((item) => item.criterionId === selectedCriterionId) ??
      items[0] ??
      null,
  };
}

function buildAssessmentSemantics(
  input: AssessmentProjectionInput,
): AssessmentSemantics {
  const integrated = input.integratedAssessment;
  const dynamic = integrated?.baseRules ?? null;
  const overall = integrated?.overallSynthesis ?? null;
  const reviewItems = input.engineerReviewContext?.items ?? [];
  const pendingReviewCount: number = reviewItems.filter(
    (item) =>
      item.humanReviewRequired &&
      item.latestReview?.status !== 'ENGINEER_CONFIRMED',
  ).length;
  const unboundReaderCount: number = Math.max(
    0,
    input.readerAudit.queryResultCount -
      input.readerAudit.sourceBoundResultCount,
  );
  const gaps: AssessmentGap[] = [];

  if (unboundReaderCount > 0) {
    gaps.push({
      code: 'READER_SOURCE_BINDING_MISSING',
      label: '部分结果尚未关联原文',
      detail: `${unboundReaderCount} 个查询结果还不能定位到原文。`,
      authority: 'HOST_READER_AUDIT',
    });
  }
  if (dynamic && dynamic.unresolvedCount > 0) {
    gaps.push({
      code: 'DYNAMIC_ITEMS_UNRESOLVED',
      label: '逐项评估尚未闭合',
      detail: `${dynamic.unresolvedCount} 个评估项仍需补充信息或复核。`,
      authority: 'HOST_DYNAMIC_EVALUATION',
    });
  }
  if (pendingReviewCount > 0) {
    gaps.push({
      code: 'ENGINEER_REVIEW_PENDING',
      label: '人工复核待完成',
      detail: `${pendingReviewCount} 个标记项尚未形成有效工程师复核记录。`,
      authority: 'HOST_ENGINEER_REVIEW_CONTEXT',
    });
  }
  if (dynamic && overall === null) {
    gaps.push({
      code: 'OVERALL_CANDIDATE_MISSING',
      label: '整体候选尚未形成',
      detail: '基于当前逐项结果的综合意见尚未形成。',
      authority: 'HOST_OVERALL_SYNTHESIS',
    });
  }
  if (overall?.status === 'STALE' || overall?.staleReason) {
    gaps.push({
      code: 'OVERALL_CANDIDATE_STALE',
      label: '整体候选已过期',
      detail: overall.staleReason ?? '当前综合意见需要根据新信息更新。',
      authority: 'HOST_OVERALL_SYNTHESIS',
    });
  }
  if (overall?.gap) {
    gaps.push({
      code: 'OVERALL_GAP_REPORTED',
      label: '综合调查仍有缺口',
      detail: overall.gap,
      authority: 'HOST_OVERALL_SYNTHESIS',
    });
  }
  if (overall && overall.unresolvedCount > 0) {
    gaps.push({
      code: 'OVERALL_ITEMS_UNRESOLVED',
      label: '整体候选包含未闭合项',
      detail: `${overall.unresolvedCount} 个综合项仍未闭合。`,
      authority: 'HOST_OVERALL_SYNTHESIS',
    });
  }

  return {
    candidateState:
      overall?.status ?? integrated?.status ?? 'WAITING_DYNAMIC_EVALUATION',
    dynamic: dynamic
      ? {
          status: dynamic.status,
          criterionSetId: dynamic.criterionSetId,
          criterionCount: dynamic.criterionCount,
          evaluationItemCount: dynamic.evaluationItemCount,
          unresolvedCount: dynamic.unresolvedCount,
          sourceBoundCandidateCount: dynamic.sourceBoundCandidateCount,
        }
      : null,
    review: {
      itemCount: reviewItems.length,
      pendingCount: pendingReviewCount,
      recordedCount: input.engineerReviewContext?.ledger?.reviewCount ?? 0,
    },
    overall: overall
      ? {
          status: overall.status,
          discoveryStatus: overall.discoveryStatus,
          gap: overall.gap,
          findingCount: overall.findingCount,
          candidateRefCount: overall.candidateRefCount,
          unresolvedCount: overall.unresolvedCount,
          staleReason: overall.staleReason,
        }
      : null,
    gaps,
    boundary:
      '页面展示的是同一工程事项的候选意见；在工程师确认前，不构成工程、适航或发布结论。',
  };
}

export {
  buildAssessmentBusinessContent,
  buildAssessmentSemantics,
  buildReaderCapabilities,
  describeTranslationProjection,
  findReaderProjectionUnit,
  getReaderViewMode,
};
export type {
  AssessmentBusinessContent,
  AssessmentGap,
  AssessmentProjectionInput,
  AssessmentSemantics,
  ReaderCapability,
  ReaderProjectionInput,
  ReaderViewMode,
  TranslationViewInfo,
};
