import type { CanonicalEngineerReviewPageItem } from '../../shared/api.interface';

import {
  assessmentRuleCategory,
  assessmentRuleConclusion,
  buildAssessmentRulePresentations,
} from '../../client/src/pages/DocumentParsingPage/assessment-rule-presentation';

function reviewItem(
  overrides: Partial<CanonicalEngineerReviewPageItem> = {},
): CanonicalEngineerReviewPageItem {
  return {
    criterionId: 'RULE-001',
    dynamicResult: 'PASS',
    candidateConclusion: '当前资料支持继续执行该项工程分析。',
    humanReviewRequired: false,
    latestReview: null,
    ...overrides,
  };
}

describe('assessment rule presentation', () => {
  it('keeps an exact Host-authored conclusion without client inference', () => {
    const item = reviewItem({
      candidateConclusion: '现有依据支持该判断，但仍需结合执行窗口安排。',
    });

    expect(assessmentRuleConclusion(item)).toBe(
      '现有依据支持该判断，但仍需结合执行窗口安排。',
    );
  });

  it('groups explicit waiting states and missing inputs as unavailable', () => {
    expect(
      assessmentRuleCategory(
        reviewItem({
          dynamicResult: 'UNKNOWN/WAITING_INPUT',
          candidateConclusion: 'WAITING_INPUT',
          humanReviewRequired: true,
        }),
      ),
    ).toBe('unavailable');
    expect(
      assessmentRuleCategory(
        reviewItem({ missingInputs: ['缺少当前飞机受控构型'] }),
      ),
    ).toBe('unavailable');
  });

  it('keeps explicit attention and not-applicable states distinct', () => {
    expect(
      assessmentRuleCategory(
        reviewItem({
          dynamicResult: 'REVIEW_REQUIRED',
          humanReviewRequired: false,
        }),
      ),
    ).toBe('attention');
    expect(
      assessmentRuleCategory(reviewItem({ dynamicResult: 'NOT_APPLICABLE' })),
    ).toBe('not-applicable');
  });

  it('consumes optional browser-safe rule fields when the Host provides them', () => {
    const item = Object.assign(reviewItem(), {
      criterionName: '并行要求核对',
      evaluationQuestion: '原文是否要求同步完成关联改装？',
      decisionRule: '存在并行要求时，应在执行计划中同时纳入。',
      appliesWhen: '当前文件包含 Concurrent Requirements 章节。',
    });

    expect(buildAssessmentRulePresentations([item])[0]).toMatchObject({
      criterionName: '并行要求核对',
      evaluationQuestion: '原文是否要求同步完成关联改装？',
      decisionRule: '存在并行要求时，应在执行计划中同时纳入。',
      appliesWhen: '当前文件包含 Concurrent Requirements 章节。',
      conclusion: '当前资料支持继续执行该项工程分析。',
    });
  });
});
