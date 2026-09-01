import type {
  CanonicalAssessmentGapLedgerProjection,
  CanonicalAssessmentGapMateriality,
  CanonicalAssessmentGapProjection,
  CanonicalAssessmentGapQueryability,
  CanonicalAssessmentGapReasonClass,
  CanonicalAssessmentGapRequiredness,
  CanonicalAssessmentGapResolutionStatus,
  CanonicalEngineerReviewPageItem,
} from '@shared/api.interface';

import type { CanonicalJobAidBrowserRule } from './canonical-job-aid-browser-rules';

interface EffectiveGapReview {
  criterionId: string;
  affectedCriterionIds: string[];
  resolvedMissingInputs: string[];
}

interface BuildCanonicalAssessmentGapLedgerInput {
  workItemRevision: number;
  baseRuleRevision: number;
  expectedUnresolvedCriterionCount: number;
  items: CanonicalEngineerReviewPageItem[];
  rules: Map<string, CanonicalJobAidBrowserRule>;
  effectiveReviews: EffectiveGapReview[];
}

interface GapAccumulator {
  missingInputId: string;
  items: CanonicalEngineerReviewPageItem[];
  rules: CanonicalJobAidBrowserRule[];
}

const MATERIALITY_ORDER: CanonicalAssessmentGapMateriality[] = [
  'P0_DECISION_CRITICAL',
  'P1_ACTION_CRITICAL',
  'P2_OPTIMIZATION',
  'P3_LIFECYCLE',
];

export function buildCanonicalAssessmentGapLedger(
  input: BuildCanonicalAssessmentGapLedgerInput,
): CanonicalAssessmentGapLedgerProjection {
  const unresolvedCriterionCount = input.items.filter(
    (item: CanonicalEngineerReviewPageItem): boolean =>
      (item.missingInputs?.length ?? 0) > 0,
  ).length;
  if (unresolvedCriterionCount !== input.expectedUnresolvedCriterionCount) {
    throw new Error('ASSESSMENT_GAP_LEDGER_UNRESOLVED_COUNT_DRIFT');
  }

  const accumulated = new Map<string, GapAccumulator>();
  for (const item of input.items) {
    const rule = input.rules.get(item.criterionId);
    if (!rule) {
      throw new Error(`ENGINEER_REVIEW_CRITERION_UNKNOWN:${item.criterionId}`);
    }
    for (const missingInputId of uniqueTexts(item.missingInputs ?? [])) {
      const current = accumulated.get(missingInputId) ?? {
        missingInputId,
        items: [],
        rules: [],
      };
      current.items.push(item);
      current.rules.push(rule);
      accumulated.set(missingInputId, current);
    }
  }

  const gaps = [...accumulated.values()]
    .sort((left: GapAccumulator, right: GapAccumulator): number =>
      left.missingInputId.localeCompare(right.missingInputId),
    )
    .map(
      (
        value: GapAccumulator,
        index: number,
      ): CanonicalAssessmentGapProjection =>
        gapProjection(value, index, input.effectiveReviews),
    );
  return {
    schemaVersion: 'wiselink.3_1.assessment_gap_ledger_projection.v1',
    inputRevision: input.workItemRevision,
    baseRuleRevision: input.baseRuleRevision,
    currentness: 'CURRENT',
    candidateOnly: true,
    gaps,
    summary: {
      total: gaps.length,
      open: countStatus(gaps, 'OPEN'),
      partiallyResolved: countStatus(gaps, 'PARTIALLY_RESOLVED'),
      resolved: countStatus(gaps, 'RESOLVED_BY_ENGINEER_REVIEW'),
      decisionCritical: gaps.filter(
        (gap: CanonicalAssessmentGapProjection): boolean =>
          gap.materiality === 'P0_DECISION_CRITICAL',
      ).length,
      reviewQueryable: gaps.filter(
        (gap: CanonicalAssessmentGapProjection): boolean =>
          gap.queryability === 'REVIEW_QUERYABLE',
      ).length,
    },
  };
}

function gapProjection(
  value: GapAccumulator,
  index: number,
  reviews: EffectiveGapReview[],
): CanonicalAssessmentGapProjection {
  const originCriterionIds = uniqueTexts(
    value.items.map(
      (item: CanonicalEngineerReviewPageItem) => item.criterionId,
    ),
  ).sort();
  const queryability = gapQueryability(value.rules);
  const materiality = strongestMateriality(value.rules);
  return {
    gapRef: `GAP-${String(index + 1).padStart(3, '0')}`,
    missingInputId: value.missingInputId,
    displayLabel: displayLabel(value.rules),
    reasonClass: reasonClass(queryability),
    dataDomain: dataDomain(value.missingInputId),
    requiredFactType: value.missingInputId,
    whyNeeded: whyNeeded(value.rules),
    materiality,
    requiredness: requiredness(materiality),
    queryability,
    resolutionStatus: resolutionStatus(
      value.missingInputId,
      originCriterionIds,
      reviews,
    ),
    originCriterionIds,
    affectedCriterionIds: [...originCriterionIds],
    sourceRefs: uniqueTexts(
      value.items.flatMap(
        (item: CanonicalEngineerReviewPageItem): string[] =>
          item.sourceRefs ?? [],
      ),
    ).sort(),
    resolutionOptions:
      queryability === 'HUMAN_DECISION_ONLY'
        ? ['由工程师在交互式复核中作出受控判断']
        : ['在交互式复核中补充受控事实或来源证据'],
    authority: {
      owner: 'CANONICAL_HOST',
      candidateOnly: true,
      modelMayClose: false,
      queryResultIsFact: false,
    },
  };
}

function gapQueryability(
  rules: CanonicalJobAidBrowserRule[],
): CanonicalAssessmentGapQueryability {
  return rules.every(
    (rule: CanonicalJobAidBrowserRule): boolean =>
      rule.gapMetadata.automationMode === 'HUMAN_REQUIRED',
  )
    ? 'HUMAN_DECISION_ONLY'
    : 'REVIEW_QUERYABLE';
}

function reasonClass(
  queryability: CanonicalAssessmentGapQueryability,
): CanonicalAssessmentGapReasonClass {
  return queryability === 'HUMAN_DECISION_ONLY'
    ? 'HUMAN_DECISION_REQUIRED'
    : 'CONTROLLED_FACT_MISSING';
}

function strongestMateriality(
  rules: CanonicalJobAidBrowserRule[],
): CanonicalAssessmentGapMateriality {
  const values = rules.map(
    (rule: CanonicalJobAidBrowserRule): CanonicalAssessmentGapMateriality => {
      if (rule.gapMetadata.blockerLevel === 'HARD_BLOCK') {
        return 'P0_DECISION_CRITICAL';
      }
      if (rule.gapMetadata.blockerLevel === 'ACTION_BLOCK') {
        return 'P1_ACTION_CRITICAL';
      }
      if (rule.gapMetadata.blockerLevel === 'WARNING') {
        return 'P2_OPTIMIZATION';
      }
      return 'P3_LIFECYCLE';
    },
  );
  return MATERIALITY_ORDER.find(
    (materiality: CanonicalAssessmentGapMateriality): boolean =>
      values.includes(materiality),
  )!;
}

function requiredness(
  materiality: CanonicalAssessmentGapMateriality,
): CanonicalAssessmentGapRequiredness {
  if (materiality === 'P0_DECISION_CRITICAL') {
    return 'REQUIRED_FOR_CONFIRMATION';
  }
  if (materiality === 'P1_ACTION_CRITICAL') {
    return 'REQUIRED_FOR_IMPLEMENTATION';
  }
  if (materiality === 'P2_OPTIMIZATION') return 'OPTIONAL_OPTIMIZATION';
  return 'FUTURE_LIFECYCLE';
}

function resolutionStatus(
  missingInputId: string,
  originCriterionIds: string[],
  reviews: EffectiveGapReview[],
): CanonicalAssessmentGapResolutionStatus {
  const resolvedCriterionIds = new Set<string>();
  for (const review of reviews) {
    if (!review.resolvedMissingInputs.includes(missingInputId)) continue;
    for (const criterionId of review.affectedCriterionIds) {
      if (originCriterionIds.includes(criterionId)) {
        resolvedCriterionIds.add(criterionId);
      }
    }
  }
  if (resolvedCriterionIds.size === 0) return 'OPEN';
  if (resolvedCriterionIds.size === originCriterionIds.length) {
    return 'RESOLVED_BY_ENGINEER_REVIEW';
  }
  return 'PARTIALLY_RESOLVED';
}

function displayLabel(rules: CanonicalJobAidBrowserRule[]): string {
  const names = uniqueTexts(
    rules.map((rule: CanonicalJobAidBrowserRule) => rule.criterionName),
  );
  if (names.length === 1) return `${names[0]}所需输入`;
  return `${names[0]}等 ${names.length} 项规则所需输入`;
}

function whyNeeded(rules: CanonicalJobAidBrowserRule[]): string {
  const questions = uniqueTexts(
    rules.map((rule: CanonicalJobAidBrowserRule) => rule.evaluationQuestion),
  );
  if (questions.length === 1) return questions[0];
  return `该输入影响 ${questions.length} 个当前规则判断。`;
}

function dataDomain(missingInputId: string): string {
  const separator = missingInputId.indexOf('.');
  return separator > 0 ? missingInputId.slice(0, separator) : missingInputId;
}

function uniqueTexts(values: string[]): string[] {
  return [...new Set(values.filter((value: string): boolean => value !== ''))];
}

function countStatus(
  gaps: CanonicalAssessmentGapProjection[],
  status: CanonicalAssessmentGapResolutionStatus,
): number {
  return gaps.filter(
    (gap: CanonicalAssessmentGapProjection): boolean =>
      gap.resolutionStatus === status,
  ).length;
}

export type { BuildCanonicalAssessmentGapLedgerInput, EffectiveGapReview };
