import type { WorkItemView } from '@client/src/services/viewModelMappers';

import type {
  CurrentFocusCardViewModel,
  OverallAssessmentCardViewModel,
  ReviewSuggestionCardViewModel,
  StaleConflictCardViewModel,
  WaitingInputCardViewModel,
} from './cardViewModels';

/* ============================================================
 * WiseLink 3.1 · WorkItemView → CardViewModel 构建函数
 * Host DTO → 视图模型的既有翻译规则（viewModelMappers）之上，
 * 再降一层到 Aily 卡片 VM；卡片文案只讲用户语言。
 * ============================================================ */

function toMarkdownList(items: string[], fallback: string): string {
  const trimmed = items.filter((item) => item.trim().length > 0);
  if (trimmed.length === 0) return fallback;
  return trimmed.map((item) => `• ${item}`).join('\n');
}

export function toCurrentFocusCard(
  view: WorkItemView,
): CurrentFocusCardViewModel {
  const overall = view.overall;
  return {
    templateId: 'WL-CARD-01',
    workItemId: view.id,
    expectedRevision: view.revision,
    workItemTitle: view.title,
    focusLine: overall ? '候选评估已形成，等待复核' : '正在整理当前事项',
    currentJudgment: overall?.currentJudgment ?? '暂未形成候选结论',
    impactSummary: overall
      ? `依据 ${overall.sourceCount} 项 · ${view.aircraftFamily} 适用性待确认`
      : '影响范围待评估完成后同步',
    pendingItems: (overall?.unresolvedQuestions ?? []).map((q) => q.label),
  };
}

export function toOverallAssessmentCard(
  view: WorkItemView,
): OverallAssessmentCardViewModel {
  const overall = view.overall;
  return {
    templateId: 'WL-CARD-02',
    workItemId: view.id,
    expectedRevision: view.revision,
    synthesisTitle: `${view.title} · 综合评估意见`,
    currentJudgment: overall?.currentJudgment ?? '暂未形成候选结论',
    applicabilitySummary:
      overall?.applicabilitySummary ?? '适用范围待评估完成后同步',
    keyEvidenceList: (overall?.keyEvidence ?? []).map((e) =>
      e.documentLabel ? `${e.label}（${e.documentLabel}）` : e.label,
    ),
    unresolvedQuestionsList: (overall?.unresolvedQuestions ?? []).map(
      (q) => q.label,
    ),
    reviewRecommendationsList: (overall?.reviewRecommendations ?? []).map(
      (r) => r.label,
    ),
  };
}

export function toWaitingInputCard(
  view: WorkItemView,
): WaitingInputCardViewModel {
  const overall = view.overall;
  return {
    templateId: 'WL-CARD-04',
    workItemId: view.id,
    expectedRevision: view.revision,
    workItemTitle: view.title,
    waitingReason: '缺少以下资料，评估暂时无法继续',
    missingInputsList: (overall?.missingInputs ?? []).map((m) => m.label),
    impactHint:
      (overall?.missingInputs ?? []).length > 0
        ? '缺少的资料会影响最终适用性判断'
        : undefined,
  };
}

export function toReviewSuggestionCard(
  view: WorkItemView,
): ReviewSuggestionCardViewModel {
  const overall = view.overall;
  return {
    templateId: 'WL-CARD-05',
    workItemId: view.id,
    expectedRevision: view.revision,
    workItemTitle: view.title,
    reviewSummary: overall
      ? '候选综合意见需要工程师复核后再用于后续工作'
      : '本事项尚未形成候选意见',
    recommendationList: (overall?.reviewRecommendations ?? []).map(
      (r) => r.label,
    ),
    riskHint: '候选结论当前仅基于受控文件与已记录的评估，未经人工确认',
  };
}

export function toStaleConflictCard(
  view: WorkItemView,
): StaleConflictCardViewModel {
  return {
    templateId: 'WL-CARD-06',
    workItemId: view.id,
    expectedRevision: view.revision,
    workItemTitle: view.title,
    staleReason:
      view.freshness === 'needs_update'
        ? '底层文件或判断依据已更新，此前的评估结果已失效'
        : '评估依据发生变化，此前的评估结果已失效',
    affectedScope: `影响 ${view.aircraftFamily} 相关的候选判断与复核状态`,
  };
}

export { toMarkdownList };
