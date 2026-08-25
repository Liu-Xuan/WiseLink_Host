import type { WlCardStage, WlCardTemplateId } from '../types';

/* ============================================================
 * WiseLink 3.1 · Aily 卡片视图模型（CardViewModel）
 * 每个 VM 与一个模板一一对应；由 WorkItemView（services/viewModelMappers）
 * 或 mock fixture 构建，再经 variableMapper 填入模板变量。
 * ============================================================ */

/** 所有卡片 VM 的公共字段 */
export interface WlCardViewModelBase {
  templateId: WlCardTemplateId;
  /** 事项 ID（业务 command 与 AppLink 用） */
  workItemId: string;
  /** 渲染时的 revision；官方事件适配后由 Host 执行 current/CAS 校验。 */
  expectedRevision: number;
}

/** WL-CARD-01 · 当前焦点 */
export interface CurrentFocusCardViewModel extends WlCardViewModelBase {
  templateId: 'WL-CARD-01';
  workItemTitle: string;
  focusLine: string;
  currentJudgment: string;
  impactSummary: string;
  /** 待确认清单（已翻译为人话） */
  pendingItems: string[];
}

/** WL-CARD-02 · 综合评估意见 */
export interface OverallAssessmentCardViewModel extends WlCardViewModelBase {
  templateId: 'WL-CARD-02';
  synthesisTitle: string;
  currentJudgment: string;
  applicabilitySummary: string;
  keyEvidenceList: string[];
  unresolvedQuestionsList: string[];
  reviewRecommendationsList: string[];
}

/** WL-CARD-03 · 任务运行 */
export interface TaskRunningCardViewModel extends WlCardViewModelBase {
  templateId: 'WL-CARD-03';
  taskTitle: string;
  /** 状态演进链当前阶段 */
  stage: WlCardStage;
  stageLabel: string;
  progressText?: string;
  etaText?: string;
}

/** WL-CARD-04 · 等待输入 */
export interface WaitingInputCardViewModel extends WlCardViewModelBase {
  templateId: 'WL-CARD-04';
  workItemTitle: string;
  waitingReason: string;
  missingInputsList: string[];
  impactHint?: string;
}

/** WL-CARD-05 · 复核建议 */
export interface ReviewSuggestionCardViewModel extends WlCardViewModelBase {
  templateId: 'WL-CARD-05';
  workItemTitle: string;
  reviewSummary: string;
  recommendationList: string[];
  riskHint?: string;
}

/** WL-CARD-06 · STALE / 冲突 */
export interface StaleConflictCardViewModel extends WlCardViewModelBase {
  templateId: 'WL-CARD-06';
  workItemTitle: string;
  staleReason: string;
  affectedScope: string;
}

/** WL-CARD-07 · 失败 / 权限 */
export interface FailurePermissionCardViewModel extends WlCardViewModelBase {
  templateId: 'WL-CARD-07';
  failureTitle: string;
  failureReason: string;
  guidance: string;
}

export type WlCardViewModel =
  | CurrentFocusCardViewModel
  | OverallAssessmentCardViewModel
  | TaskRunningCardViewModel
  | WaitingInputCardViewModel
  | ReviewSuggestionCardViewModel
  | StaleConflictCardViewModel
  | FailurePermissionCardViewModel;

/** 状态演进链（文档指定顺序；卡片据此选择阶段文案） */
export const WL_STAGE_CHAIN: readonly { stage: WlCardStage; label: string }[] =
  [
    { stage: 'received', label: '已受理' },
    { stage: 'queued', label: '排队中' },
    { stage: 'parsing', label: '正在解析' },
    { stage: 'assessing', label: '正在评估' },
    { stage: 'waiting_materials', label: '等待资料' },
    { stage: 'candidate_ready', label: '候选已形成' },
    { stage: 'awaiting_review', label: '等待复核' },
  ];

export function stageLabelOf(stage: WlCardStage): string {
  return WL_STAGE_CHAIN.find((entry) => entry.stage === stage)?.label ?? stage;
}
