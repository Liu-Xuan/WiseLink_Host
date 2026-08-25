import type { WlCardViewModel } from '../models/cardViewModels';
import { toMarkdownList } from '../models/fromWorkItemView';
import { wlCardTemplateById } from '../templates';
import type { WlCardJson } from '../types';

/* ============================================================
 * WiseLink 3.1 · 变量映射器
 * CardViewModel → 模板变量 dict（String 值），并把模板 JSON
 * 的 ${var} 占位替换为实际值。渲染模板时永远以变量清单为校验基准：
 * 模板引用的变量必须全部有值（required 缺失时抛错）。
 * ============================================================ */

function optional(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** CardViewModel → 模板变量 dict */
export function toTemplateVariables(
  vm: WlCardViewModel,
): Record<string, string> {
  const base = {
    workItemId: vm.workItemId,
    expectedRevision: String(vm.expectedRevision),
  };
  switch (vm.templateId) {
    case 'WL-CARD-01':
      return {
        ...base,
        workItemTitle: vm.workItemTitle,
        focusLine: vm.focusLine,
        currentJudgment: vm.currentJudgment,
        impactSummary: vm.impactSummary,
        pendingItems: toMarkdownList(vm.pendingItems, '暂无待确认项'),
      };
    case 'WL-CARD-02':
      return {
        ...base,
        synthesisTitle: vm.synthesisTitle,
        currentJudgment: vm.currentJudgment,
        applicabilitySummary: vm.applicabilitySummary,
        keyEvidenceList: toMarkdownList(vm.keyEvidenceList, '暂无主要依据'),
        unresolvedQuestionsList: toMarkdownList(
          vm.unresolvedQuestionsList,
          '暂无未解决问题',
        ),
        reviewRecommendationsList: toMarkdownList(
          vm.reviewRecommendationsList,
          '暂无建议复核动作',
        ),
      };
    case 'WL-CARD-03':
      return {
        ...base,
        taskTitle: vm.taskTitle,
        stageLabel: vm.stageLabel,
        progressText: optional(vm.progressText) ?? '统计中',
        etaText: optional(vm.etaText) ?? '统计中',
      };
    case 'WL-CARD-04':
      return {
        ...base,
        workItemTitle: vm.workItemTitle,
        waitingReason: vm.waitingReason,
        missingInputsList: toMarkdownList(vm.missingInputsList, '暂无待补资料'),
        impactHint: optional(vm.impactHint) ?? '',
      };
    case 'WL-CARD-05':
      return {
        ...base,
        workItemTitle: vm.workItemTitle,
        reviewSummary: vm.reviewSummary,
        recommendationList: toMarkdownList(
          vm.recommendationList,
          '暂无建议动作',
        ),
        riskHint: optional(vm.riskHint) ?? '',
      };
    case 'WL-CARD-06':
      return {
        ...base,
        workItemTitle: vm.workItemTitle,
        staleReason: vm.staleReason,
        affectedScope: vm.affectedScope,
      };
    case 'WL-CARD-07':
      return {
        ...base,
        failureTitle: vm.failureTitle,
        failureReason: vm.failureReason,
        guidance: vm.guidance,
      };
  }
}

/** 校验变量 dict 是否覆盖模板声明的全部 required 变量 */
export function validateVariables(
  templateId: WlCardViewModel['templateId'],
  variables: Record<string, string>,
): string[] {
  const template = wlCardTemplateById.get(templateId);
  if (!template) return [`未知模板: ${templateId}`];
  return template.variables
    .filter((v) => v.required)
    .filter((v) => {
      const value = variables[v.name];
      return value == null || value.trim().length === 0;
    })
    .map((v) => `缺少必填变量: ${v.name}`);
}

const VARIABLE_PATTERN = /\$\{([a-zA-Z0-9_]+)\}/g;

/** 把 JSON 模板里的 ${var} 占位替换为变量值（深拷贝，不修改原模板） */
export function renderTemplate(
  templateId: WlCardViewModel['templateId'],
  variables: Record<string, string>,
): WlCardJson {
  const template = wlCardTemplateById.get(templateId);
  if (!template) throw new Error(`未知模板: ${templateId}`);
  const cloned: WlCardJson = JSON.parse(JSON.stringify(template.json));
  replacePlaceholders(cloned as unknown as Record<string, unknown>, variables);
  return cloned;
}

function replacePlaceholders(
  node: unknown,
  variables: Record<string, string>,
): void {
  if (typeof node === 'string') return; // 由父层处理
  if (Array.isArray(node)) {
    for (const item of node) replacePlaceholders(item, variables);
    return;
  }
  if (node == null || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'string') {
      (node as Record<string, unknown>)[key] = value.replace(
        VARIABLE_PATTERN,
        (_match, name: string) => variables[name] ?? '',
      );
    } else {
      replacePlaceholders(value, variables);
    }
  }
}
