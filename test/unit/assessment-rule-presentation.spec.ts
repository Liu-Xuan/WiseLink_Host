import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { CanonicalEngineerReviewPageItem } from '../../shared/api.interface';

jest.mock(
  '../../client/src/pages/DocumentParsingPage/assessment-rule-workspace.css',
  () => ({}),
  { virtual: true },
);

import {
  assessmentRuleCategory,
  assessmentRuleConclusion,
  buildAssessmentRulePresentations,
} from '../../client/src/pages/DocumentParsingPage/assessment-rule-presentation';
import AssessmentRuleWorkspace from '../../client/src/pages/DocumentParsingPage/AssessmentRuleWorkspace';

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

  it('keeps long mixed-language rule labels available to pointer and assistive users', () => {
    const criterionName =
      'Concurrent Requirements 并行改装要求与超长 ATA-reference-without-breaks-1234567890';
    const conclusion =
      '当前结论保留全部工程语义，并要求核对 Effectivity 与当前机队构型。';
    const item = Object.assign(
      reviewItem({ candidateConclusion: conclusion }),
      { criterionName },
    );

    const html = renderToStaticMarkup(
      createElement(AssessmentRuleWorkspace, {
        items: [item],
        selectedCriterionId: item.criterionId,
        preferSelectedOnLoad: true,
        onSelectCriterion: () => undefined,
        onLocateSourceRef: () => undefined,
      }),
    );

    expect(html).toContain(`title="${criterionName}"`);
    expect(html).toContain(`title="${conclusion}"`);
    expect(html).toContain(
      `aria-label="规则 1，${criterionName}，${conclusion}"`,
    );
  });
});
