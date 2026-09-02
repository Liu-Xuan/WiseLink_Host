import type { CanonicalEngineerReviewPageItem } from '../../shared/api.interface';
import { buildCanonicalAssessmentGapLedger } from '../../server/modules/canonical-host/canonical-assessment-gap-ledger';
import type { CanonicalJobAidBrowserRule } from '../../server/modules/canonical-host/canonical-job-aid-browser-rules';

describe('canonical assessment gap ledger', () => {
  it('groups the same missing fact across criteria and exposes strongest current impact', () => {
    const ledger = buildCanonicalAssessmentGapLedger({
      workItemRevision: 11,
      baseRuleRevision: 1,
      expectedUnresolvedCriterionCount: 2,
      items: [
        item('RULE-001', ['aircraft.currentPartNumber'], ['SRC-001']),
        item('RULE-002', ['aircraft.currentPartNumber'], ['SRC-002']),
      ],
      rules: new Map([
        ['RULE-001', rule('当前构型匹配', 'HARD_BLOCK', 'HYBRID')],
        ['RULE-002', rule('实施前置条件', 'ACTION_BLOCK', 'HUMAN_REQUIRED')],
      ]),
      effectiveReviews: [],
    });

    expect(ledger).toMatchObject({
      inputRevision: 11,
      currentness: 'CURRENT',
      candidateOnly: true,
      summary: {
        total: 1,
        open: 1,
        decisionCritical: 1,
        reviewQueryable: 1,
      },
    });
    expect(ledger.gaps).toEqual([
      expect.objectContaining({
        gapRef: 'GAP-001',
        missingInputId: 'aircraft.currentPartNumber',
        dataDomain: 'aircraft',
        materiality: 'P0_DECISION_CRITICAL',
        requiredness: 'REQUIRED_FOR_CONFIRMATION',
        queryability: 'REVIEW_QUERYABLE',
        resolutionStatus: 'OPEN',
        originCriterionIds: ['RULE-001', 'RULE-002'],
        affectedCriterionIds: ['RULE-001', 'RULE-002'],
        sourceRefs: ['SRC-001', 'SRC-002'],
        authority: {
          owner: 'CANONICAL_HOST',
          candidateOnly: true,
          modelMayClose: false,
          queryResultIsFact: false,
        },
      }),
    ]);
  });

  it('derives partial and complete resolution only from effective Host reviews', () => {
    const input = {
      workItemRevision: 12,
      baseRuleRevision: 2,
      expectedUnresolvedCriterionCount: 2,
      items: [
        item('RULE-001', ['fleet.lineNumber']),
        item('RULE-002', ['fleet.lineNumber']),
      ],
      rules: new Map([
        ['RULE-001', rule('构型范围', 'HARD_BLOCK', 'HUMAN_REQUIRED')],
        ['RULE-002', rule('实施范围', 'ACTION_BLOCK', 'HUMAN_REQUIRED')],
      ]),
    };

    const partial = buildCanonicalAssessmentGapLedger({
      ...input,
      effectiveReviews: [
        {
          sequence: 1,
          criterionId: 'RULE-001',
          affectedCriterionIds: ['RULE-001'],
          resolvedMissingInputs: ['fleet.lineNumber'],
          uncertaintyDispositions: [],
        },
      ],
    });
    expect(partial.gaps[0]).toMatchObject({
      queryability: 'HUMAN_DECISION_ONLY',
      reasonClass: 'HUMAN_DECISION_REQUIRED',
      resolutionStatus: 'PARTIALLY_RESOLVED',
    });

    const resolved = buildCanonicalAssessmentGapLedger({
      ...input,
      effectiveReviews: [
        {
          sequence: 1,
          criterionId: 'RULE-001',
          affectedCriterionIds: ['RULE-001', 'RULE-002'],
          resolvedMissingInputs: ['fleet.lineNumber'],
          uncertaintyDispositions: [],
        },
      ],
    });
    expect(resolved.gaps[0].resolutionStatus).toBe(
      'RESOLVED_BY_ENGINEER_REVIEW',
    );
    expect(resolved.summary).toMatchObject({
      open: 0,
      partiallyResolved: 0,
      resolved: 1,
    });
  });

  it('reads back the latest confirmed uncertainty disposition without treating it as evidence resolution', () => {
    const disposition = {
      gapRef: 'GAP-001',
      disposition: 'MITIGATE_AND_MONITOR' as const,
      rationale: '当前数据不足，但可用监控边界控制决策风险。',
      assumptions: [],
      controlsAndMitigations: ['每月复核构型变化。'],
      evidenceRefs: [],
      reviewBy: '2026-10-01T00:00:00.000Z',
      reopenTriggers: ['发现受影响 P/N。'],
    };
    const ledger = buildCanonicalAssessmentGapLedger({
      workItemRevision: 12,
      baseRuleRevision: 2,
      expectedUnresolvedCriterionCount: 1,
      items: [item('RULE-001', ['aircraft.currentPartNumber'])],
      rules: new Map([
        ['RULE-001', rule('当前构型匹配', 'HARD_BLOCK', 'HYBRID')],
      ]),
      effectiveReviews: [
        {
          sequence: 2,
          criterionId: 'RULE-001',
          affectedCriterionIds: ['RULE-001'],
          resolvedMissingInputs: [],
          uncertaintyDispositions: [disposition],
        },
      ],
    });

    expect(ledger.gaps[0]).toMatchObject({
      resolutionStatus: 'OPEN',
      disposition: {
        ...disposition,
        source: 'ENGINEER_CONFIRMED_DECISION_SNAPSHOT',
        reviewSequence: 2,
      },
    });
    expect(ledger.summary).toMatchObject({
      open: 1,
      controlledByDisposition: 1,
      monitoringOrDeferred: 1,
      resolveNow: 0,
    });
  });

  it('fails closed when the current base-rule unresolved count drifts', () => {
    expect(() =>
      buildCanonicalAssessmentGapLedger({
        workItemRevision: 11,
        baseRuleRevision: 1,
        expectedUnresolvedCriterionCount: 2,
        items: [item('RULE-001', ['aircraft.currentPartNumber'])],
        rules: new Map([
          ['RULE-001', rule('当前构型匹配', 'HARD_BLOCK', 'HYBRID')],
        ]),
        effectiveReviews: [],
      }),
    ).toThrow('ASSESSMENT_GAP_LEDGER_UNRESOLVED_COUNT_DRIFT');
  });
});

function item(
  criterionId: string,
  missingInputs: string[],
  sourceRefs: string[] = [],
): CanonicalEngineerReviewPageItem {
  return {
    criterionId,
    dynamicResult: 'UNKNOWN',
    candidateConclusion: '等待受控事实',
    humanReviewRequired: true,
    missingInputs,
    sourceRefs,
    latestReview: null,
  };
}

function rule(
  criterionName: string,
  blockerLevel: CanonicalJobAidBrowserRule['gapMetadata']['blockerLevel'],
  automationMode: CanonicalJobAidBrowserRule['gapMetadata']['automationMode'],
): CanonicalJobAidBrowserRule {
  return {
    criterionName,
    evaluationQuestion: `${criterionName}是否满足？`,
    decisionRule: '仅使用受控事实求值。',
    appliesWhen: '当前文件与事项。',
    gapMetadata: {
      blockerLevel,
      automationMode,
      stageCode: '01',
      stageName: '初始评估',
    },
  };
}
