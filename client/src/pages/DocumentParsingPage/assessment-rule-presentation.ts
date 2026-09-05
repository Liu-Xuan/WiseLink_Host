import type { CanonicalEngineerReviewPageItem } from '@shared/api.interface';

export type AssessmentRuleCategory =
  | 'attention'
  | 'concluded'
  | 'unavailable'
  | 'not-applicable';

export interface AssessmentRulePresentation {
  item: CanonicalEngineerReviewPageItem;
  sequence: number;
  category: AssessmentRuleCategory;
  criterionName: string;
  evaluationQuestion: string | null;
  decisionRule: string | null;
  appliesWhen: string | null;
  conclusion: string;
}

const UNAVAILABLE_STATES = new Set([
  'WAITING_INPUT',
  'UNKNOWN',
  'UNKNOWN/WAITING_INPUT',
  'BLOCKED_MISSING_INPUT',
  'UNAVAILABLE',
]);
const NOT_APPLICABLE_STATES = new Set(['NOT_APPLICABLE', 'N/A']);
const ATTENTION_STATES = new Set(['NEEDS_REVIEW', 'REVIEW_REQUIRED']);
const TOKEN_LABELS: Readonly<Record<string, string>> = {
  PASS: '通过候选',
  FAIL: '未通过候选',
  TRUE: '条件满足候选',
  FALSE: '条件不满足候选',
  APPLICABLE: '适用候选',
  NOT_APPLICABLE: '不适用',
  WAITING_INPUT: '暂无法判断',
  UNKNOWN: '暂无法判断',
  BLOCKED_MISSING_INPUT: '暂无法判断',
  UNAVAILABLE: '暂无法判断',
  CONDITIONAL: '条件性候选',
  DEFERRED: '暂缓判断',
  NEEDS_REVIEW: '需要关注',
  REVIEW_REQUIRED: '需要关注',
};

function optionalProjectionText(
  item: CanonicalEngineerReviewPageItem,
  field:
    | 'criterionName'
    | 'evaluationQuestion'
    | 'decisionRule'
    | 'appliesWhen',
): string | null {
  if (!(field in item)) return null;
  const value: unknown = Reflect.get(item, field);
  if (typeof value !== 'string') return null;
  const text: string = value.trim();
  return text.length > 0 ? text : null;
}

export function assessmentRuleName(
  item: CanonicalEngineerReviewPageItem,
  index: number,
): string {
  return (
    optionalProjectionText(item, 'criterionName') ?? `判断规则 ${index + 1}`
  );
}

function stateToken(value: string): string {
  return value.trim().toUpperCase().replace(/[- ]/gu, '_');
}

function isStatusToken(value: string): boolean {
  return /^[A-Z][A-Z0-9_/-]*$/u.test(value.trim().toUpperCase());
}

export function assessmentRuleCategory(
  item: CanonicalEngineerReviewPageItem,
): AssessmentRuleCategory {
  const state: string = stateToken(item.dynamicResult);
  if (NOT_APPLICABLE_STATES.has(state)) return 'not-applicable';
  if ((item.missingInputs?.length ?? 0) > 0 || UNAVAILABLE_STATES.has(state)) {
    return 'unavailable';
  }
  if (ATTENTION_STATES.has(state)) return 'attention';
  return item.humanReviewRequired ? 'attention' : 'concluded';
}

export function resolveAssessmentRuleSelection(
  items: readonly CanonicalEngineerReviewPageItem[] | null | undefined,
  requestedCriterionId: string | null | undefined,
  category?: AssessmentRuleCategory | 'all',
): string | null {
  const available: readonly CanonicalEngineerReviewPageItem[] = items ?? [];
  const selectable: readonly CanonicalEngineerReviewPageItem[] =
    category && category !== 'all'
      ? available.filter(
          (item: CanonicalEngineerReviewPageItem) =>
            assessmentRuleCategory(item) === category,
        )
      : available;
  const requested: CanonicalEngineerReviewPageItem | undefined =
    selectable.find(
      (item: CanonicalEngineerReviewPageItem) =>
        item.criterionId === requestedCriterionId?.trim(),
    );
  if (requested) return requested.criterionId;
  if (category) return selectable[0]?.criterionId ?? null;

  const priority: readonly AssessmentRuleCategory[] = [
    'attention',
    'concluded',
    'unavailable',
    'not-applicable',
  ];
  for (const preferredCategory of priority) {
    const first: CanonicalEngineerReviewPageItem | undefined = selectable.find(
      (item: CanonicalEngineerReviewPageItem) =>
        assessmentRuleCategory(item) === preferredCategory,
    );
    if (first) return first.criterionId;
  }
  return null;
}

export function assessmentRuleConclusion(
  item: CanonicalEngineerReviewPageItem,
): string {
  const conclusion: string = item.candidateConclusion.trim();
  if (conclusion && !isStatusToken(conclusion)) return conclusion;
  const conclusionLabel: string | undefined =
    TOKEN_LABELS[stateToken(conclusion)];
  if (conclusionLabel) return conclusionLabel;
  const resultLabel: string | undefined =
    TOKEN_LABELS[stateToken(item.dynamicResult)];
  return resultLabel ?? '当前 Host 尚未提供可读结论';
}

export function buildAssessmentRulePresentations(
  items: CanonicalEngineerReviewPageItem[],
): AssessmentRulePresentation[] {
  return items.map(
    (
      item: CanonicalEngineerReviewPageItem,
      index: number,
    ): AssessmentRulePresentation => ({
      item,
      sequence: index + 1,
      category: assessmentRuleCategory(item),
      criterionName: assessmentRuleName(item, index),
      evaluationQuestion: optionalProjectionText(item, 'evaluationQuestion'),
      decisionRule: optionalProjectionText(item, 'decisionRule'),
      appliesWhen: optionalProjectionText(item, 'appliesWhen'),
      conclusion: assessmentRuleConclusion(item),
    }),
  );
}
