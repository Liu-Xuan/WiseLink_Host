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
    focusLine: overall?.conclusion
      ? '工程摘要已形成，等待处理异常项与最终批准'
      : '正在整理当前事项',
    currentJudgment: overall?.conclusion?.text ?? '暂未形成工程摘要',
    impactSummary: overall?.whyItMatters[0]?.text ?? '影响范围待评估完成后同步',
    pendingItems:
      overall?.applicability.requiredFacts.map((statement) => statement.text) ??
      [],
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
    currentJudgment: overall?.conclusion?.text ?? '暂未形成工程摘要',
    applicabilitySummary:
      overall?.applicability.sourceScope?.text ?? '适用范围待评估完成后同步',
    keyEvidenceList: overall
      ? [
          ...overall.whyItMatters,
          ...overall.implementationImpact,
          ...overall.dispositionPriority,
        ].map(
          (statement) =>
            `${statement.text}（${statement.sourceRefIds.length} 条原文依据）`,
        )
      : [],
    unresolvedQuestionsList:
      overall?.applicability.requiredFacts.map((statement) => statement.text) ??
      [],
    reviewRecommendationsList:
      overall?.nextActions.map((statement) => statement.text) ?? [],
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
    waitingReason: '缺少以下适用性事实，暂不能判定具体飞机',
    missingInputsList:
      overall?.applicability.requiredFacts.map((statement) => statement.text) ??
      [],
    impactHint:
      (overall?.applicability.requiredFacts.length ?? 0) > 0
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
      ? (overall.conclusion?.text ?? '历史候选需要重新生成工程摘要')
      : '本事项尚未形成候选意见',
    recommendationList:
      overall?.nextActions.map((statement) => statement.text) ?? [],
    riskHint:
      overall?.dispositionPriority[0]?.text ??
      '候选结论需完成异常项处置与最终工程批准',
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
