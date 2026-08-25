import type { WlCardStage } from '../types';

import type {
  FailurePermissionCardViewModel,
  OverallAssessmentCardViewModel,
  ReviewSuggestionCardViewModel,
  StaleConflictCardViewModel,
  TaskRunningCardViewModel,
  WaitingInputCardViewModel,
} from './cardViewModels';
import type {
  CurrentFocusCardViewModel,
  WlCardViewModel,
} from './cardViewModels';
import { stageLabelOf } from './cardViewModels';

/* ============================================================
 * WiseLink 3.1 · Aily 卡片 mock fixtures（预览页与验收用）
 * 数据取自 Spec 的 747-31A2560 示例，覆盖状态演进链各阶段。
 * ============================================================ */

const WORK_ITEM_ID = 'WI-747-31A2560';
const WORK_ITEM_TITLE = '747-31A2560';
const REVISION = 14;

export const mockCurrentFocusCard: CurrentFocusCardViewModel = {
  templateId: 'WL-CARD-01',
  workItemId: WORK_ITEM_ID,
  expectedRevision: REVISION,
  workItemTitle: WORK_ITEM_TITLE,
  focusLine: '候选评估已形成，等待复核',
  currentJudgment: '适用于部分747飞机，建议完成软件构型核实后安排执行。',
  impactSummary: '候选12架 · 已确认7架 · 待核实5架',
  pendingItems: ['5架飞机的软件版本', '并行改装计划', '生产窗口'],
};

export const mockOverallAssessmentCard: OverallAssessmentCardViewModel = {
  templateId: 'WL-CARD-02',
  workItemId: WORK_ITEM_ID,
  expectedRevision: REVISION,
  synthesisTitle: `${WORK_ITEM_TITLE} · 综合评估意见`,
  currentJudgment: '适用于部分747飞机，建议完成软件构型核实后安排执行。',
  applicabilitySummary:
    '候选12架 · 已确认7架 · 待核实5架（含MSN 4482、4490-4494等）',
  keyEvidenceList: [
    'S747-31-2560 §3.2 适用性限制条款（ATA 31-26）',
    '747构型清单 Rev.B 软件构型差异记录',
    '此前747-31A2498 评估中的已确认结论（7架）',
  ],
  unresolvedQuestionsList: [
    '5架飞机的软件版本尚未核实',
    '并行改装计划与生产窗口未确认',
  ],
  reviewRecommendationsList: [
    '优先核实5架飞机的软件构型',
    '确认并行改装计划后再更新适用范围',
  ],
};

/** 任务运行卡：按状态演进链逐阶段生成 fixture */
export function mockTaskRunningCard(
  stage: WlCardStage,
): TaskRunningCardViewModel {
  const progressByStage: Partial<Record<WlCardStage, string>> = {
    parsing: '43 / 150 项',
    assessing: '86 / 150 项',
  };
  const etaByStage: Partial<Record<WlCardStage, string>> = {
    parsing: '约8分钟',
    assessing: '约4分钟',
  };
  return {
    templateId: 'WL-CARD-03',
    workItemId: WORK_ITEM_ID,
    expectedRevision: REVISION,
    taskTitle: '正在重新分析受影响判断项',
    stage,
    stageLabel: stageLabelOf(stage),
    progressText: progressByStage[stage],
    etaText: etaByStage[stage],
  };
}

export const mockWaitingInputCard: WaitingInputCardViewModel = {
  templateId: 'WL-CARD-04',
  workItemId: WORK_ITEM_ID,
  expectedRevision: REVISION,
  workItemTitle: WORK_ITEM_TITLE,
  waitingReason: '缺少以下资料，评估暂时无法继续',
  missingInputsList: [
    '5架飞机的软件版本清单',
    '并行改装计划（如适用）',
    '生产窗口时间表',
  ],
  impactHint: '缺少的资料会影响最终适用性判断',
};

export const mockReviewSuggestionCard: ReviewSuggestionCardViewModel = {
  templateId: 'WL-CARD-05',
  workItemId: WORK_ITEM_ID,
  expectedRevision: REVISION,
  workItemTitle: WORK_ITEM_TITLE,
  reviewSummary: '候选综合意见需要工程师复核后再用于后续工作',
  recommendationList: [
    '优先核实5架飞机的软件构型',
    '确认并行改装计划后再更新适用范围',
    '复核通过前候选结论不得用于正式工作',
  ],
  riskHint: '候选结论当前仅基于受控文件与已记录的评估，未经人工确认',
};

export const mockStaleConflictCard: StaleConflictCardViewModel = {
  templateId: 'WL-CARD-06',
  workItemId: WORK_ITEM_ID,
  expectedRevision: REVISION,
  workItemTitle: WORK_ITEM_TITLE,
  staleReason: '底层文件已更新至 Rev.C，此前基于 Rev.B 的评估结果已失效',
  affectedScope: '影响候选12架的适用性判断与已完成的部分复核记录',
};

export const mockFailureCard: FailurePermissionCardViewModel = {
  templateId: 'WL-CARD-07',
  workItemId: WORK_ITEM_ID,
  expectedRevision: REVISION,
  failureTitle: '文档解析任务失败',
  failureReason: '源文件无法读取（可能已损坏或权限变更）',
  guidance: '请确认文件状态后重试；若持续失败请联系管理员检查文档源配置',
};

export const mockPermissionDeniedCard: FailurePermissionCardViewModel = {
  templateId: 'WL-CARD-07',
  workItemId: WORK_ITEM_ID,
  expectedRevision: REVISION,
  failureTitle: '暂无访问权限',
  failureReason: '当前账号无该受控文件的阅读权限',
  guidance: '请联系文件管理员申请权限后重试',
};

/** 预览页默认 fixture 集：7 类卡片 × 关键状态 */
export const mockCardViewModels: readonly WlCardViewModel[] = [
  mockCurrentFocusCard,
  mockOverallAssessmentCard,
  mockTaskRunningCard('parsing'),
  mockTaskRunningCard('assessing'),
  mockWaitingInputCard,
  mockReviewSuggestionCard,
  mockStaleConflictCard,
  mockFailureCard,
  mockPermissionDeniedCard,
];
