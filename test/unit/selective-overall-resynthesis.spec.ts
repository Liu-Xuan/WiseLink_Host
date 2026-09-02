import type {
  CanonicalEngineerReviewLedgerProjection,
  CanonicalOpenClawOverallProjection,
} from '@shared/api.interface';

import {
  assertLatestOverallCandidate,
  buildSelectiveOverallResynthesisPlan,
  type DynamicRuleReviewItem,
  type OpenClawEngineerReviewContext,
} from '../../server/modules/canonical-host/selective-overall-resynthesis';

const BASE_SHA = 'a'.repeat(64);

describe('selective overall resynthesis', () => {
  it('changes only reviewed criteria and preserves unaffected content and SourceRefs byte-for-byte', () => {
    const items = baseItems();
    const context = supplementalContext();
    const plan = buildSelectiveOverallResynthesisPlan({
      criterionSetId: 'JACS-TWO',
      criterionCount: 2,
      baseRuleRevision: 3,
      baseRuleArtifactSha256: BASE_SHA,
      staleOverall: staleOverall(),
      engineerReviewProjection: reviewProjection(),
      engineerReviewContext: context,
      items,
    });

    expect(plan).toMatchObject({
      mode: 'AFFECTED_ONLY',
      staleOverallRevision: 1,
      targetOverallRevision: 2,
      priorEngineerReviewRevision: null,
      currentEngineerReviewRevision: 1,
      affectedCriterionIds: ['RULE-A'],
      reusedCriterionIds: ['RULE-B'],
      adoptedEvidenceSourceRefIds: ['review-evidence://WI-REVIEW/1/RULE-A/1'],
    });
    expect(plan.items[1]).toEqual(items[1]);
    expect(plan.items[1]).not.toBe(items[1]);
    expect(plan.items[0]).toMatchObject({
      criterionId: 'RULE-A',
      dynamicResult: 'REVIEW_REQUIRED',
      sourceRefs: ['SRC-A', 'review-evidence://WI-REVIEW/1/RULE-A/1'],
      missingInputs: [],
      effectiveEngineerReview: { actionType: 'SUPPLEMENT_EVIDENCE' },
    });
  });

  it('fails closed when a review claims to resolve an input the base candidate never requested', () => {
    const context = supplementalContext();
    context.history[0].resolvedMissingInputs = ['UNRELATED_INPUT'];
    context.effective[0].resolvedMissingInputs = ['UNRELATED_INPUT'];

    expect(() =>
      buildSelectiveOverallResynthesisPlan({
        criterionSetId: 'JACS-TWO',
        criterionCount: 2,
        baseRuleRevision: 3,
        baseRuleArtifactSha256: BASE_SHA,
        staleOverall: staleOverall(),
        engineerReviewProjection: reviewProjection(),
        engineerReviewContext: context,
        items: baseItems(),
      }),
    ).toThrow('SELECTIVE_RESYNTHESIS_RESOLVED_INPUT_UNKNOWN:RULE-A');
  });

  it('resynthesizes exactly the draft-confirmed affected set and does not reuse a related item', () => {
    const context = supplementalContext();
    context.history[0].affectedCriterionIds = ['RULE-A', 'RULE-B'];
    context.effective[0].affectedCriterionIds = ['RULE-A', 'RULE-B'];
    const plan = buildSelectiveOverallResynthesisPlan({
      criterionSetId: 'JACS-TWO',
      criterionCount: 2,
      baseRuleRevision: 3,
      baseRuleArtifactSha256: BASE_SHA,
      staleOverall: staleOverall(),
      engineerReviewProjection: reviewProjection(),
      engineerReviewContext: context,
      items: baseItems(),
    });

    expect(plan.affectedCriterionIds).toEqual(['RULE-A', 'RULE-B']);
    expect(plan.reusedCriterionIds).toEqual([]);
    expect(plan.items[1]).toMatchObject({
      criterionId: 'RULE-B',
      humanReviewRequired: true,
      effectiveEngineerReview: {
        criterionId: 'RULE-A',
        affectedCriterionIds: ['RULE-A', 'RULE-B'],
      },
    });
    expect(plan.items[1].analysisSummary).toContain(
      'Affected by confirmed review action on RULE-A',
    );
  });

  it('does not misclassify a base-rule change as an engineer-review affected-only run', () => {
    expect(() =>
      buildSelectiveOverallResynthesisPlan({
        criterionSetId: 'JACS-TWO',
        criterionCount: 2,
        baseRuleRevision: 3,
        baseRuleArtifactSha256: BASE_SHA,
        staleOverall: {
          ...staleOverall(),
          staleReason: 'BASE_RULE_RESULT_CHANGED',
        },
        engineerReviewProjection: reviewProjection(),
        engineerReviewContext: supplementalContext(),
        items: baseItems(),
      }),
    ).toThrow('SELECTIVE_RESYNTHESIS_STALE_REASON_UNSUPPORTED');
  });

  it('allows a Host-marked user regeneration to rebuild a legacy overall without inventing a review', () => {
    const legacy = {
      ...staleOverall(),
      staleReason: null,
      basedOnEngineerReviewRevision: null,
      basedOnEngineerReviewArtifactSha256: null,
      engineeringSummary: undefined,
    };
    const emptyReviewContext: OpenClawEngineerReviewContext = {
      revision: null,
      artifactSha256: null,
      reviewCount: 0,
      history: [],
      effective: [],
    };

    const plan = buildSelectiveOverallResynthesisPlan({
      criterionSetId: 'JACS-TWO',
      criterionCount: 2,
      baseRuleRevision: 3,
      baseRuleArtifactSha256: BASE_SHA,
      staleOverall: legacy,
      regenerationReason: 'USER_REQUESTED_REGENERATION',
      engineerReviewProjection: null,
      engineerReviewContext: emptyReviewContext,
      items: baseItems(),
    });

    expect(plan).toMatchObject({
      mode: 'FULL_REGENERATION',
      staleOverallRevision: 1,
      targetOverallRevision: 2,
      priorEngineerReviewRevision: null,
      currentEngineerReviewRevision: null,
      affectedCriterionIds: [],
      reusedCriterionIds: ['RULE-A', 'RULE-B'],
    });
  });

  it('rejects review history bound to a different base artifact', () => {
    const context = supplementalContext();
    context.history[0].baseRuleArtifactSha256 = 'b'.repeat(64);
    context.effective[0].baseRuleArtifactSha256 = 'b'.repeat(64);

    expect(() =>
      buildSelectiveOverallResynthesisPlan({
        criterionSetId: 'JACS-TWO',
        criterionCount: 2,
        baseRuleRevision: 3,
        baseRuleArtifactSha256: BASE_SHA,
        staleOverall: staleOverall(),
        engineerReviewProjection: reviewProjection(),
        engineerReviewContext: context,
        items: baseItems(),
      }),
    ).toThrow('SELECTIVE_RESYNTHESIS_REVIEW_HISTORY_INVALID');
  });

  it('accepts an unchanged business conclusion when r2 binds the latest review, and rejects the old revision', () => {
    const prior = staleOverall();
    const plan = buildSelectiveOverallResynthesisPlan({
      criterionSetId: 'JACS-TWO',
      criterionCount: 2,
      baseRuleRevision: 3,
      baseRuleArtifactSha256: BASE_SHA,
      staleOverall: prior,
      engineerReviewProjection: reviewProjection(),
      engineerReviewContext: supplementalContext(),
      items: baseItems(),
    });
    const r2 = {
      ...prior,
      status: 'CANDIDATE_ONLY' as const,
      revision: 2,
      basedOnEngineerReviewRevision: 1,
      basedOnEngineerReviewArtifactSha256: 'c'.repeat(64),
      staleReason: null,
      actionAttemptId: 'ATT-OVERALL-2',
      artifact: artifact('artifact://overall-r2', 'e'.repeat(64)),
      // The engineering conclusion is intentionally unchanged. The new
      // evidence/review binding and revision, not textual novelty, define r2.
      overallCandidate: prior.overallCandidate,
      findings: prior.findings,
      missingInputs: prior.missingInputs,
      applicabilityStatus: prior.applicabilityStatus,
    };

    expect(() => assertLatestOverallCandidate(plan, r2)).not.toThrow();
    expect(() =>
      assertLatestOverallCandidate(plan, { ...r2, revision: 1 }),
    ).toThrow('OPENCLAW_OVERALL_LATEST_CANDIDATE_BINDING_INVALID');
  });
});

function baseItems(): DynamicRuleReviewItem[] {
  return [
    {
      criterionId: 'RULE-A',
      dynamicResult: 'UNKNOWN/WAITING_INPUT',
      candidateConclusion: '等待飞机事实。',
      humanReviewRequired: true,
      factsConsidered: ['厂家文件事实'],
      ruleApplication: '需要飞机事实后判断。',
      analysisSummary: '初始分析 A',
      sourceRefs: ['SRC-A'],
      missingInputs: ['AIRCRAFT_FACT_REQUIRED'],
    },
    {
      criterionId: 'RULE-B',
      dynamicResult: 'PASS',
      candidateConclusion: '候选通过。',
      humanReviewRequired: true,
      factsConsidered: ['受控事实 B'],
      ruleApplication: '规则 B',
      analysisSummary: '初始分析 B',
      sourceRefs: ['SRC-B-1', 'SRC-B-2'],
      missingInputs: [],
    },
  ];
}

function supplementalContext(): OpenClawEngineerReviewContext {
  const review = {
    sequence: 1,
    criterionId: 'RULE-A',
    baseRuleRevision: 3,
    baseRuleArtifactSha256: BASE_SHA,
    actionType: 'SUPPLEMENT_EVIDENCE' as const,
    decision: 'deferred' as const,
    status: 'NEEDS_REVIEW' as const,
    comment: '补充了该机当前构型事实，要求重新判断 RULE-A。',
    recordedAt: '2026-08-26T01:00:00.000Z',
    evidence: [
      {
        kind: 'AIRCRAFT_FACT' as const,
        statement: '该机已安装目标构型。',
        locator: 'FleetMasterData/AC-001@2026-08-26',
        sourceRefId: 'review-evidence://WI-REVIEW/1/RULE-A/1',
      },
    ],
    resolvedMissingInputs: ['AIRCRAFT_FACT_REQUIRED'],
    uncertaintyDispositions: [],
    decisionSnapshot: null,
    correctedAnalysisDirection: null,
  };
  return {
    revision: 1,
    artifactSha256: 'c'.repeat(64),
    reviewCount: 1,
    history: [structuredClone(review)],
    effective: [structuredClone(review)],
  };
}

function reviewProjection(): CanonicalEngineerReviewLedgerProjection {
  return {
    status: 'HUMAN_REVIEW_RECORDED',
    revision: 1,
    reviewCount: 1,
    criterionSetId: 'JACS-TWO',
    artifact: artifact('artifact://review', 'c'.repeat(64)),
    actionAttemptId: 'ATT-REVIEW-1',
  };
}

function staleOverall(): CanonicalOpenClawOverallProjection {
  return {
    status: 'STALE',
    revision: 1,
    sourceResultId: 'openclaw-overall://OVR-1',
    basedOnBaseRuleRevision: 3,
    basedOnBaseRuleArtifactSha256: BASE_SHA,
    basedOnEngineerReviewRevision: null,
    basedOnEngineerReviewArtifactSha256: null,
    discoveryStatus: 'NO_DISCOVERY',
    gap: null,
    candidateRefCount: 0,
    findingCount: 2,
    unresolvedCount: 1,
    authorityLevel: 'candidate_only',
    externalDiscoveryIsEvidence: false,
    artifact: artifact('artifact://overall', 'd'.repeat(64)),
    actionAttemptId: 'ATT-OVERALL-1',
    staleReason: 'ENGINEER_REVIEW_CHANGED',
    overallCandidate: '候选结论保持不变，但已基于新证据重新综合。',
    findings: [
      {
        finding: '候选发现保持不变。',
        basis: '来源仍支持原判断。',
        sourceRefIds: ['SRC-A'],
        assumptions: [],
        uncertainty: '仍需工程师确认。',
      },
    ],
    missingInputs: [],
    applicabilityStatus: 'CANDIDATE_REVIEW_REQUIRED',
    engineeringReviewRequired: true,
    providers: {},
  };
}

function artifact(ref: string, sha256: string) {
  return {
    storeRole: 'UnifiedArtifactStoreCandidate' as const,
    ref,
    sha256,
    byteLength: 100,
    mediaType: 'application/json' as const,
  };
}
