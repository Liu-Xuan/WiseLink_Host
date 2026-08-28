import type {
  CanonicalDocumentParsingPageResponse,
  CanonicalEngineeringStatementBasis,
  CanonicalOpenClawOverallProjection,
  CanonicalSourceBoundEngineeringStatement,
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

export interface EngineeringStatementView {
  text: string;
  basis: CanonicalEngineeringStatementBasis;
  sourceRefIds: string[];
}

export interface OverallAssessmentView {
  /** overall synthesis revision（来自 overallSynthesis.revision） */
  revision: number;
  /** 生成时间：Host 未提供时为 undefined，UI 显示“时间未返回” */
  generatedAt?: string;
  conclusion: EngineeringStatementView | null;
  whyItMatters: EngineeringStatementView[];
  applicability: {
    sourceScope: EngineeringStatementView | null;
    fleetMatch: EngineeringStatementView | null;
    requiredFacts: EngineeringStatementView[];
  };
  implementationImpact: EngineeringStatementView[];
  dispositionPriority: EngineeringStatementView[];
  nextActions: EngineeringStatementView[];
  /** 当前结构化工程摘要使用的唯一 SourceRef 数量。 */
  sourceCount: number;
  staleReason: 'BASE_RULE_RESULT_CHANGED' | 'ENGINEER_REVIEW_CHANGED' | null;
  technicalDetails: {
    candidateStatus: string;
    authorityLevel: string;
    workItemRevision: number;
    overallRevision: number;
    documentVersion: string;
    translationProgress: string | null;
    evaluationProgress: string;
    applicabilityStatus: string | null;
    findingCount: number;
    unresolvedCount: number;
    modelVersion: string | null;
    promptVersion: string | null;
    skillVersion: string | null;
  };
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

function engineeringStatementView(
  statement: CanonicalSourceBoundEngineeringStatement,
): EngineeringStatementView {
  return {
    text: statement.text,
    basis: statement.basis,
    sourceRefIds: [...statement.sourceRefIds],
  };
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
  const engineeringSummary = overall?.engineeringSummary ?? null;
  const doc = documentLabelOf(workItem);
  const statementGroups: EngineeringStatementView[][] = engineeringSummary
    ? [
        [engineeringStatementView(engineeringSummary.conclusion)],
        engineeringSummary.whyItMatters.map(engineeringStatementView),
        [
          engineeringStatementView(engineeringSummary.applicability.sourceScope),
          engineeringStatementView(engineeringSummary.applicability.fleetMatch),
          ...engineeringSummary.applicability.requiredFacts.map(
            engineeringStatementView,
          ),
        ],
        engineeringSummary.implementationImpact.map(engineeringStatementView),
        engineeringSummary.dispositionPriority.map(engineeringStatementView),
        engineeringSummary.nextActions.map(engineeringStatementView),
      ]
    : [];
  const sourceCount = new Set(
    statementGroups.flat(2).flatMap((statement) => statement.sourceRefIds),
  ).size;

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
          conclusion: engineeringSummary
            ? engineeringStatementView(engineeringSummary.conclusion)
            : null,
          whyItMatters:
            engineeringSummary?.whyItMatters.map(engineeringStatementView) ?? [],
          applicability: {
            sourceScope: engineeringSummary
              ? engineeringStatementView(
                  engineeringSummary.applicability.sourceScope,
                )
              : null,
            fleetMatch: engineeringSummary
              ? engineeringStatementView(
                  engineeringSummary.applicability.fleetMatch,
                )
              : null,
            requiredFacts:
              engineeringSummary?.applicability.requiredFacts.map(
                engineeringStatementView,
              ) ?? [],
          },
          implementationImpact:
            engineeringSummary?.implementationImpact.map(
              engineeringStatementView,
            ) ?? [],
          dispositionPriority:
            engineeringSummary?.dispositionPriority.map(
              engineeringStatementView,
            ) ?? [],
          nextActions:
            engineeringSummary?.nextActions.map(engineeringStatementView) ?? [],
          sourceCount,
          staleReason: overall.staleReason,
          technicalDetails: {
            candidateStatus: overall.status,
            authorityLevel: overall.authorityLevel,
            workItemRevision: workItem.revision,
            overallRevision: overall.revision,
            documentVersion: workItem.source.documentVersionId,
            translationProgress: workItem.translation
              ? `${workItem.translation.translatedUnitCount}/${workItem.translation.sourceUnitCount}`
              : null,
            evaluationProgress: `${workItem.integratedAssessment!.baseRules.evaluationItemCount}/${workItem.integratedAssessment!.baseRules.criterionCount}`,
            applicabilityStatus: overall.applicabilityStatus ?? null,
            findingCount: overall.findingCount,
            unresolvedCount: overall.unresolvedCount,
            modelVersion: overall.modelVersion ?? null,
            promptVersion: overall.promptVersion ?? null,
            skillVersion: overall.skillVersion ?? null,
          },
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
