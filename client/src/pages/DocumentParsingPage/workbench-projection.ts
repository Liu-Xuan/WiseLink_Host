import type {
  CanonicalDocumentVersionSelection,
  CanonicalEngineerReviewPageContext,
  CanonicalIntegratedAssessmentProjection,
  CanonicalWorkbenchAuditProjection,
  CanonicalWorkItemPackageProjection,
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
  source: CanonicalDocumentVersionSelection;
  package: CanonicalWorkItemPackageProjection | null;
  canQueryParsedUnits: boolean;
  readerAudit: CanonicalWorkbenchAuditProjection['reader'];
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

function buildReaderCapabilities(
  input: ReaderProjectionInput,
): ReaderCapability[] {
  const structuredAvailable: boolean =
    input.package !== null && input.canQueryParsedUnits;
  const returnedCount: number = input.readerAudit.queryResultCount;
  const sourceBoundCount: number = input.readerAudit.sourceBoundResultCount;

  return [
    {
      mode: 'source',
      label: 'PDF 原文',
      status: 'LIMITED',
      note:
        `已绑定 DocumentVersion ${input.source.documentVersionId}；` +
        'Host 当前未投影 PDF 预览 URL、页码或 bbox 定位。',
    },
    {
      mode: 'structured',
      label: '结构化原文',
      status: structuredAvailable ? 'AVAILABLE' : 'UNAVAILABLE',
      note: structuredAvailable
        ? `当前查询返回 ${returnedCount} 个单元，${sourceBoundCount} 个完成来源绑定。`
        : '当前 WorkItem 尚无可查询的受控解析包。',
    },
    {
      mode: 'bilingual',
      label: '中英文对照',
      status: 'UNAVAILABLE',
      note: 'Host 当前未投影双语内容单元或翻译来源，页面不会推断或补造译文。',
    },
  ];
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
      label: 'Reader 来源绑定不完整',
      detail: `${unboundReaderCount} 个查询结果没有 sourceRef。`,
      authority: 'HOST_READER_AUDIT',
    });
  }
  if (dynamic && dynamic.unresolvedCount > 0) {
    gaps.push({
      code: 'DYNAMIC_ITEMS_UNRESOLVED',
      label: '动态规则项未闭合',
      detail: `${dynamic.unresolvedCount} 个规则项仍需输入或复核。`,
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
      detail: 'Host 尚未返回基于当前动态结果的整体候选。',
      authority: 'HOST_OVERALL_SYNTHESIS',
    });
  }
  if (overall?.status === 'STALE' || overall?.staleReason) {
    gaps.push({
      code: 'OVERALL_CANDIDATE_STALE',
      label: '整体候选已过期',
      detail: overall.staleReason ?? 'Host 将当前整体候选标记为 STALE。',
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
      '所有状态均为同一 WorkItem 的 Host 候选投影，不构成工程、适航或发布结论。',
  };
}

export {
  buildAssessmentSemantics,
  buildReaderCapabilities,
  getReaderViewMode,
};
export type {
  AssessmentGap,
  AssessmentProjectionInput,
  AssessmentSemantics,
  ReaderCapability,
  ReaderProjectionInput,
  ReaderViewMode,
};
