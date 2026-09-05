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
  resolveAssessmentRuleSelection,
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

describe('assessment rule selection', () => {
  const items: CanonicalEngineerReviewPageItem[] = Array.from(
    { length: 8 },
    (_: unknown, index: number): CanonicalEngineerReviewPageItem =>
      reviewItem({
        criterionId: `GOV-00${index + 1}`,
        humanReviewRequired: index === 7,
      }),
  );

  function renderSelection(
    source: CanonicalEngineerReviewPageItem[],
    selectedCriterionId: string | null,
  ): string {
    return renderToStaticMarkup(
      createElement(AssessmentRuleWorkspace, {
        items: source,
        selectedCriterionId: selectedCriterionId ?? '',
        onSelectCriterion: () => undefined,
        onLocateSourceRef: () => undefined,
      }),
    );
  }

  it.each([null, undefined, ''])(
    'uses the visible attention rule as the submission focus without a query (%s)',
    (requested: string | null | undefined) => {
      const selectedEvaluationItemId: string | null =
        resolveAssessmentRuleSelection(items, requested);
      const html: string = renderSelection(items, selectedEvaluationItemId);

      expect(selectedEvaluationItemId).toBe('GOV-008');
      expect(html).toContain('aria-current="true" aria-label="规则 8，');
      expect(html).toContain('<small>规则 8</small>');
      expect(html).not.toContain('<small>规则 1</small>');
    },
  );

  it('honors an exact deep link even when a different category needs attention', () => {
    const selected: string | null = resolveAssessmentRuleSelection(
      items,
      ' GOV-001 ',
    );
    const html: string = renderSelection(items, selected);

    expect(selected).toBe('GOV-001');
    expect(html).toContain('aria-current="true" aria-label="规则 1，');
    expect(html).toContain('<small>规则 1</small>');
    expect(html).not.toContain('<small>规则 8</small>');
  });

  it.each(['GOV-DELETED', '判断规则 1', '规则 1', 'gov-001'])(
    'resolves an unavailable identifier through the same default, never by title (%s)',
    (requested: string) => {
      expect(resolveAssessmentRuleSelection(items, requested)).toBe('GOV-008');
    },
  );

  it('moves filter selection through the parent focus instead of a display-only fallback', () => {
    const current: string | null = resolveAssessmentRuleSelection(items, null);
    const next: string | null = resolveAssessmentRuleSelection(
      items,
      current,
      'concluded',
    );
    const requestedAfterNavigation: string | null =
      resolveAssessmentRuleSelection(items, next);

    expect(next).toBe('GOV-001');
    expect(requestedAfterNavigation).toBe(next);
    expect(renderSelection(items, requestedAfterNavigation)).toContain(
      'aria-current="true" aria-label="规则 1，',
    );
    expect(resolveAssessmentRuleSelection(items, next, 'all')).toBe(next);
    expect(resolveAssessmentRuleSelection(items, next, 'attention')).toBe(
      'GOV-008',
    );
    expect(resolveAssessmentRuleSelection(items, next, 'unavailable')).toBe(
      null,
    );
  });

  it('keeps default category priority when no attention rule is available', () => {
    const source: CanonicalEngineerReviewPageItem[] = [
      reviewItem({
        criterionId: 'UNAVAILABLE',
        dynamicResult: 'WAITING_INPUT',
      }),
      reviewItem({ criterionId: 'CONCLUDED' }),
      reviewItem({ criterionId: 'NOT-APPLICABLE', dynamicResult: 'N/A' }),
    ];

    expect(resolveAssessmentRuleSelection(source, null)).toBe('CONCLUDED');
    expect(resolveAssessmentRuleSelection([source[0], source[2]], null)).toBe(
      'UNAVAILABLE',
    );
    expect(resolveAssessmentRuleSelection([source[2]], null)).toBe(
      'NOT-APPLICABLE',
    );
  });

  it.each([{ source: null }, { source: undefined }, { source: [] }])(
    'keeps absent review context unfocused ($source)',
    ({
      source,
    }: {
      source: CanonicalEngineerReviewPageItem[] | null | undefined;
    }) => {
      expect(resolveAssessmentRuleSelection(source, 'GOV-001')).toBeNull();
      expect(renderSelection(source ?? [], null)).not.toContain(
        'aria-current="true"',
      );
    },
  );

  it('does not display another rule when a controlled focus is missing', () => {
    const html: string = renderSelection(items, 'GOV-DELETED');

    expect(html).not.toContain('assessment-rule-reading');
    expect(html).not.toContain('aria-current="true"');
  });

  it('keeps a selected deep-linked rule visible beyond the first list page', () => {
    const source: CanonicalEngineerReviewPageItem[] = Array.from(
      { length: 45 },
      (_: unknown, index: number): CanonicalEngineerReviewPageItem =>
        reviewItem({ criterionId: `EXACT-${index + 1}` }),
    );
    const selected: string | null = resolveAssessmentRuleSelection(
      source,
      'EXACT-45',
    );

    expect(selected).toBe('EXACT-45');
    expect(renderSelection(source, selected)).toContain(
      'aria-current="true" aria-label="规则 45，',
    );
  });
});
