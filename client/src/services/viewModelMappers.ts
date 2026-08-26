import type {
  CanonicalDocumentParsingPageResponse,
  CanonicalOpenClawOverallProjection,
  CanonicalTimelineEvent,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';

/* ============================================================
 * WiseLink 3.1 · DTO → 视图模型映射（Spec R01 §8.1 / §2.3）
 * Host DTO 不改动；本层把技术名词翻译成用户语言，
 * 并把 overallSynthesis / audit / timeline 整理为综合评估首页视图。
 * ============================================================ */

export type AuthorityState =
  | 'candidate'
  | 'engineer_confirmed'
  | 'formal_readback'
  | 'unavailable';

export type FreshnessState =
  | 'current'
  | 'needs_update'
  | 'superseded'
  | 'unavailable';

export interface EvidenceSummaryView {
  id: string;
  label: string;
  sourceType:
    | 'original'
    | 'controlled_fact'
    | 'adopted_material'
    | 'historical';
  documentLabel?: string;
  page?: number;
  /** 仅用于精确定位，不在用户界面显示内部引用值。 */
  sourceRefId?: string;
  accessState: 'available' | 'denied' | 'unknown';
  adopted: boolean;
}

export interface UnresolvedQuestionView {
  id: string;
  label: string;
  impact?: string;
}

export interface MissingInputView {
  label: string;
  impact?: string;
}

export interface ReviewRecommendationView {
  label: string;
  detail?: string;
}

export interface OverallAssessmentView {
  /** overall synthesis revision（来自 overallSynthesis.revision） */
  revision: number;
  /** 生成时间：Host 未提供时为 undefined，UI 显示“时间未返回” */
  generatedAt?: string;
  /** 当前判断（候选结论人话） */
  currentJudgment: string;
  /** 适用范围 */
  applicabilitySummary: string;
  /** 关键依据 */
  keyEvidence: EvidenceSummaryView[];
  /** 未决问题 */
  unresolvedQuestions: UnresolvedQuestionView[];
  /** 风险与影响 */
  riskAndImpact: string[];
  /** 复核建议 */
  reviewRecommendations: ReviewRecommendationView[];
  /** 待补资料 */
  missingInputs: MissingInputView[];
  /** 依据数量 */
  sourceCount: number;
}

export interface WorkItemView {
  id: string;
  title: string;
  revision: number;
  authority: AuthorityState;
  freshness: FreshnessState;
  /** 文件版本当前有效性（currentness.selectedVersionIsCurrent） */
  documentCurrent: boolean | null;
  documentLabel: string;
  documentVersion: string;
  aircraftFamily: string;
  overall: OverallAssessmentView | null;
  /** 最近时间线事件（人话） */
  lastEvents: Array<{
    id: string;
    label: string;
    status: string;
    occurredAt: string | null;
  }>;
}

/** overall status → FreshnessState */
function freshnessOf(
  overall: CanonicalOpenClawOverallProjection | null | undefined,
): FreshnessState {
  if (!overall) return 'unavailable';
  if (overall.status === 'STALE') return 'needs_update';
  return 'current';
}

/** 工程师复核状态 → AuthorityState */
function authorityOf(workItem: CanonicalWorkItemProjection): AuthorityState {
  if (!workItem.integratedAssessment?.overallSynthesis) return 'unavailable';
  const confirmed =
    workItem.integratedAssessment?.overallForAeoConfirmation != null;
  if (confirmed) return 'engineer_confirmed';
  return 'candidate';
}

function documentLabelOf(workItem: CanonicalWorkItemProjection): {
  label: string;
  version: string;
} {
  const code = workItem.package?.documentIdentity?.documentCode;
  const title = workItem.package?.title;
  return {
    label: code ?? title ?? '未命名工程资料',
    version:
      workItem.package?.documentIdentity?.businessRevision ??
      workItem.source.documentVersionId,
  };
}

function applicabilityLabel(value: string | null | undefined): string {
  const labels: Record<string, string> = {
    APPLICABLE: '适用',
    APPLICABLE_WITH_GAPS: '有条件适用，仍需补齐信息',
    NOT_APPLICABLE: '不适用',
    NEEDS_REVIEW: '适用范围待工程师复核',
    UNDETERMINED: '适用范围待确认',
  };
  const normalized = value?.trim() ?? '';
  return labels[normalized] ?? '适用范围待确认';
}

function timelineEventLabel(kind: CanonicalTimelineEvent['kind']): string {
  const labels: Record<CanonicalTimelineEvent['kind'], string> = {
    WORKITEM_REVISION: '事项版本更新',
    DOCUMENT_VERSION_BOUND: '当前文件已关联',
    PACKAGE_READBACK: '解析结果已回读',
    READER_QUERY: '原文检索状态更新',
    DYNAMIC_EVALUATION: '逐项评估状态更新',
    ENGINEER_REVIEW: '工程师复核状态更新',
    OVERALL_SYNTHESIS: '整体候选状态更新',
    OVERALL_CONFIRMATION: '人工确认状态更新',
    AEO_CANDIDATE: 'AEO 候选状态更新',
    FAILURE: '处理未完成',
  };
  return labels[kind];
}

export function toWorkItemView(
  page: CanonicalDocumentParsingPageResponse,
): WorkItemView {
  const workItem = page.workItem;
  const overall = workItem.integratedAssessment?.overallSynthesis ?? null;
  const findings = overall?.findings ?? [];
  const missingInputs = overall?.missingInputs ?? [];
  const doc = documentLabelOf(workItem);

  const keyEvidence: EvidenceSummaryView[] = findings
    .slice(0, 5)
    .map((finding, index) => ({
      id: `${overall?.sourceResultId ?? 'overall'}-evidence-${index}`,
      label: finding.finding,
      sourceType: 'original' as const,
      documentLabel: doc.label,
      sourceRefId: finding.sourceRefIds[0],
      accessState: 'available' as const,
      adopted: false,
    }));

  const unresolvedQuestions: UnresolvedQuestionView[] = findings
    .filter((f) => f.uncertainty?.trim())
    .map((f, index) => ({
      id: `unresolved-${index}`,
      label: f.uncertainty,
      impact: f.basis,
    }));

  const reviewRecommendations: ReviewRecommendationView[] = [];
  if (overall?.engineeringReviewRequired) {
    reviewRecommendations.push({
      label: '本综合意见需要工程师复核后再用于后续工作',
      detail: '候选结论当前仅基于受控文件与已记录的评估，未经人工确认。',
    });
  }
  if (missingInputs.length > 0) {
    reviewRecommendations.push({
      label: `优先补充 ${missingInputs.length} 项待补资料`,
      detail: '缺少的资料会影响最终适用性判断。',
    });
  }

  return {
    id: workItem.workItemId,
    title: doc.label,
    revision: workItem.revision,
    authority: authorityOf(workItem),
    freshness: freshnessOf(overall),
    documentCurrent: null,
    documentLabel: doc.label,
    documentVersion: doc.version,
    aircraftFamily: workItem.classification.normalizedFamily,
    overall: overall
      ? {
          revision: overall.revision,
          generatedAt: undefined,
          currentJudgment:
            overall.overallCandidate?.trim() ||
            '综合候选意见尚未返回正文内容；请查看下方关键判断与依据。',
          applicabilitySummary: applicabilityLabel(overall.applicabilityStatus),
          keyEvidence,
          unresolvedQuestions,
          riskAndImpact: findings
            .map((f) => f.finding)
            .filter((text) => /影响|风险|不适|冲突/.test(text))
            .slice(0, 5),
          reviewRecommendations,
          missingInputs: missingInputs.map((label, index) => ({
            label,
            impact: index === 0 ? '决定最终适用性判断' : undefined,
          })),
          sourceCount: overall.candidateRefCount,
        }
      : null,
    lastEvents: page.timeline.events
      .slice(-5)
      .reverse()
      .map((event) => ({
        id: event.id,
        label: timelineEventLabel(event.kind),
        status: event.status,
        occurredAt: event.occurredAt,
      })),
  };
}

/* ── 状态文案（§2.3 / §4.3） ── */

export const AUTHORITY_LABELS: Record<AuthorityState, string> = {
  candidate: '候选意见',
  engineer_confirmed: '工程师已确认',
  formal_readback: '正式系统已回读',
  unavailable: '尚无候选意见',
};

export const FRESHNESS_LABELS: Record<FreshnessState, string> = {
  current: '当前有效',
  needs_update: '结论需更新',
  superseded: '已被新版本替代',
  unavailable: '当前有效性待确认',
};

export function staleReasonLabel(
  reason: 'BASE_RULE_RESULT_CHANGED' | 'ENGINEER_REVIEW_CHANGED' | null,
): string | undefined {
  if (reason === 'BASE_RULE_RESULT_CHANGED') return '评估规则或基础结果已变化';
  if (reason === 'ENGINEER_REVIEW_CHANGED') return '工程师复核已更新';
  return undefined;
}
