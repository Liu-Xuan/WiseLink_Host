import type {
  CanonicalEngineerReviewDecision,
  CanonicalEngineerReviewLedgerProjection,
  CanonicalOpenClawOverallProjection,
  ReviewDecisionSnapshotCandidate,
  ReviewUncertaintyDispositionCandidate,
  UnifiedPackageArtifactDescriptor,
} from '@shared/api.interface';

export type CanonicalReviewActionType =
  | 'REVISE_JUDGMENT'
  | 'SUPPLEMENT_EVIDENCE'
  | 'CORRECT_ANALYSIS_DIRECTION';

export type CanonicalReviewEvidenceKind =
  | 'ENGINEER_TEXT'
  | 'AIRCRAFT_FACT'
  | 'DOCUMENT_FACT'
  | 'ATTACHMENT';

export interface CanonicalReviewEvidenceInput {
  kind: CanonicalReviewEvidenceKind;
  statement: string;
  locator: string;
  artifact?: UnifiedPackageArtifactDescriptor;
}

export interface CanonicalReviewEvidence extends CanonicalReviewEvidenceInput {
  sourceRefId: string;
}

export interface DynamicRuleReviewItem {
  criterionId: string;
  dynamicResult: string;
  candidateConclusion: string;
  humanReviewRequired: boolean;
  factsConsidered: string[];
  ruleApplication: string;
  analysisSummary: string;
  sourceRefs: string[];
  missingInputs: string[];
}

export interface OpenClawEngineerReviewItem {
  sequence: number;
  criterionId: string;
  affectedCriterionIds?: string[];
  baseRuleRevision: number;
  baseRuleArtifactSha256: string;
  actionType: CanonicalReviewActionType;
  decision: CanonicalEngineerReviewDecision;
  status: 'ENGINEER_CONFIRMED' | 'NEEDS_REVIEW';
  comment: string;
  recordedAt: string;
  evidence: CanonicalReviewEvidence[];
  resolvedMissingInputs: string[];
  uncertaintyDispositions: ReviewUncertaintyDispositionCandidate[];
  decisionSnapshot: ReviewDecisionSnapshotCandidate | null;
  correctedAnalysisDirection: string | null;
}

export interface OpenClawEngineerReviewContext {
  revision: number | null;
  artifactSha256: string | null;
  reviewCount: number;
  history: OpenClawEngineerReviewItem[];
  effective: OpenClawEngineerReviewItem[];
}

export interface SelectiveJobAidItemCandidate extends DynamicRuleReviewItem {
  effectiveEngineerReview?: OpenClawEngineerReviewItem;
}

export interface SelectiveOverallResynthesisPlan {
  mode: 'INITIAL' | 'AFFECTED_ONLY' | 'FULL_REGENERATION';
  criterionSetId: string;
  baseRuleRevision: number;
  baseRuleArtifactSha256: string;
  staleOverallRevision: number | null;
  targetOverallRevision: number;
  priorEngineerReviewRevision: number | null;
  currentEngineerReviewRevision: number | null;
  affectedCriterionIds: string[];
  reusedCriterionIds: string[];
  adoptedEvidenceSourceRefIds: string[];
  items: SelectiveJobAidItemCandidate[];
}

export type SelectiveOverallResynthesisSummary = Omit<
  SelectiveOverallResynthesisPlan,
  'items'
>;

export function buildSelectiveOverallResynthesisPlan(input: {
  criterionSetId: string;
  criterionCount: number;
  baseRuleRevision: number;
  baseRuleArtifactSha256: string;
  staleOverall: CanonicalOpenClawOverallProjection | null;
  regenerationReason?: 'USER_REQUESTED_REGENERATION' | null;
  engineerReviewProjection: CanonicalEngineerReviewLedgerProjection | null;
  engineerReviewContext: OpenClawEngineerReviewContext;
  items: DynamicRuleReviewItem[];
}): SelectiveOverallResynthesisPlan {
  assertCriterionSet(input);
  assertReviewContext(
    input.engineerReviewProjection,
    input.engineerReviewContext,
    input.criterionSetId,
    input.baseRuleRevision,
    input.baseRuleArtifactSha256,
    new Set(input.items.map((item) => item.criterionId)),
  );

  const stale = input.staleOverall;
  const currentReviewRevision = input.engineerReviewContext.revision;
  let priorEngineerReviewRevision: number | null = null;
  let reviewSequenceFloor = 0;
  const userRequestedRegeneration =
    input.regenerationReason === 'USER_REQUESTED_REGENERATION';
  if (userRequestedRegeneration && !stale) {
    throw new Error('SELECTIVE_RESYNTHESIS_STALE_OVERALL_REQUIRED');
  }
  if (stale) {
    assertSupportedStaleOverall(stale, input, userRequestedRegeneration);
    priorEngineerReviewRevision = stale.basedOnEngineerReviewRevision;
    if (userRequestedRegeneration) {
      if (currentReviewRevision !== priorEngineerReviewRevision) {
        throw new Error('SELECTIVE_RESYNTHESIS_REVIEW_BINDING_DRIFT');
      }
    } else {
      const current = requiredPositiveRevision(
        currentReviewRevision,
        'SELECTIVE_RESYNTHESIS_REVIEW_REVISION_REQUIRED',
      );
      reviewSequenceFloor = priorEngineerReviewRevision ?? 0;
      if (current <= reviewSequenceFloor) {
        throw new Error('SELECTIVE_RESYNTHESIS_NEW_REVIEW_REQUIRED');
      }
    }
  }

  const affectedSet = new Set(
    input.engineerReviewContext.history
      .filter(
        (review) =>
          review.sequence > reviewSequenceFloor &&
          review.baseRuleRevision === input.baseRuleRevision &&
          review.baseRuleArtifactSha256 === input.baseRuleArtifactSha256,
      )
      .flatMap(reviewAffectedCriterionIds),
  );
  if (stale && !userRequestedRegeneration && affectedSet.size === 0) {
    throw new Error('SELECTIVE_RESYNTHESIS_AFFECTED_SET_EMPTY');
  }

  const effective = new Map(
    input.engineerReviewContext.effective.map((review) => [
      review.criterionId,
      review,
    ]),
  );
  const affectedCriterionIds: string[] = [];
  const reusedCriterionIds: string[] = [];
  const adoptedEvidenceSourceRefIds: string[] = [];
  const items = input.items.map((item): SelectiveJobAidItemCandidate => {
    if (!affectedSet.has(item.criterionId)) {
      reusedCriterionIds.push(item.criterionId);
      return structuredClone(item);
    }
    const review =
      effective.get(item.criterionId) ??
      [...input.engineerReviewContext.history]
        .reverse()
        .find((candidate) =>
          reviewAffectedCriterionIds(candidate).includes(item.criterionId),
        );
    if (!review) {
      throw new Error(
        `SELECTIVE_RESYNTHESIS_EFFECTIVE_REVIEW_MISSING:${item.criterionId}`,
      );
    }
    affectedCriterionIds.push(item.criterionId);
    adoptedEvidenceSourceRefIds.push(
      ...review.evidence.map((value) => value.sourceRefId),
    );
    return review.criterionId === item.criterionId
      ? applyReviewAction(item, review)
      : markRelatedAffectedItem(item, review);
  });

  return {
    mode: userRequestedRegeneration
      ? 'FULL_REGENERATION'
      : stale || affectedCriterionIds.length > 0
        ? 'AFFECTED_ONLY'
        : 'INITIAL',
    criterionSetId: input.criterionSetId,
    baseRuleRevision: input.baseRuleRevision,
    baseRuleArtifactSha256: input.baseRuleArtifactSha256,
    staleOverallRevision: stale?.revision ?? null,
    targetOverallRevision: stale ? stale.revision + 1 : 1,
    priorEngineerReviewRevision,
    currentEngineerReviewRevision: currentReviewRevision,
    affectedCriterionIds,
    reusedCriterionIds,
    adoptedEvidenceSourceRefIds: [...new Set(adoptedEvidenceSourceRefIds)],
    items,
  };
}

function markRelatedAffectedItem(
  item: DynamicRuleReviewItem,
  review: OpenClawEngineerReviewItem,
): SelectiveJobAidItemCandidate {
  return {
    ...structuredClone(item),
    humanReviewRequired: true,
    analysisSummary:
      `${item.analysisSummary}\nAffected by confirmed review action on ` +
      `${review.criterionId}; selective resynthesis is required.`,
    effectiveEngineerReview: structuredClone(review),
  };
}

export function summarizeSelectiveOverallResynthesis(
  plan: SelectiveOverallResynthesisPlan,
): SelectiveOverallResynthesisSummary {
  const { items: _items, ...summary } = plan;
  return summary;
}

export function assertLatestOverallCandidate(
  plan: SelectiveOverallResynthesisSummary,
  candidate: CanonicalOpenClawOverallProjection,
): void {
  if (
    candidate.status !== 'CANDIDATE_ONLY' ||
    candidate.staleReason !== null ||
    candidate.revision !== plan.targetOverallRevision ||
    candidate.basedOnBaseRuleRevision !== plan.baseRuleRevision ||
    candidate.basedOnBaseRuleArtifactSha256 !== plan.baseRuleArtifactSha256 ||
    candidate.basedOnEngineerReviewRevision !==
      plan.currentEngineerReviewRevision
  ) {
    throw new Error('OPENCLAW_OVERALL_LATEST_CANDIDATE_BINDING_INVALID');
  }
}

function applyReviewAction(
  item: DynamicRuleReviewItem,
  review: OpenClawEngineerReviewItem,
): SelectiveJobAidItemCandidate {
  if (review.actionType === 'SUPPLEMENT_EVIDENCE') {
    return applySupplementalEvidence(item, review);
  }
  if (review.actionType === 'CORRECT_ANALYSIS_DIRECTION') {
    return applyCorrectedDirection(item, review);
  }
  return applyJudgmentRevision(item, review);
}

function applyJudgmentRevision(
  item: DynamicRuleReviewItem,
  review: OpenClawEngineerReviewItem,
): SelectiveJobAidItemCandidate {
  const missingInputs = [...item.missingInputs];
  const reviewNeedsInput =
    review.decision === 'deferred' || review.decision === 'returned_for_rework';
  if (
    item.sourceRefs.length === 0 &&
    !missingInputs.includes('SOURCE_EVIDENCE_REQUIRED')
  ) {
    missingInputs.push('SOURCE_EVIDENCE_REQUIRED');
  }
  if (reviewNeedsInput) missingInputs.push(`ENGINEER_REVIEW:${review.comment}`);
  const canConfirm = item.sourceRefs.length > 0 && missingInputs.length === 0;
  return {
    ...structuredClone(item),
    dynamicResult: canConfirm
      ? review.decision === 'confirmed_pass'
        ? 'PASS'
        : review.decision === 'confirmed_fail'
          ? 'FAIL'
          : 'REVIEW_REQUIRED'
      : 'UNKNOWN/WAITING_INPUT',
    candidateConclusion: canConfirm ? review.comment : 'UNKNOWN/WAITING_INPUT',
    humanReviewRequired: true,
    missingInputs,
    effectiveEngineerReview: structuredClone(review),
  };
}

function applySupplementalEvidence(
  item: DynamicRuleReviewItem,
  review: OpenClawEngineerReviewItem,
): SelectiveJobAidItemCandidate {
  const knownMissing = new Set(item.missingInputs);
  if (review.resolvedMissingInputs.some((value) => !knownMissing.has(value))) {
    throw new Error(
      `SELECTIVE_RESYNTHESIS_RESOLVED_INPUT_UNKNOWN:${item.criterionId}`,
    );
  }
  const resolved = new Set(review.resolvedMissingInputs);
  const missingInputs = item.missingInputs.filter(
    (value) => !resolved.has(value),
  );
  const evidenceRefs = review.evidence.map((value) => value.sourceRefId);
  if (evidenceRefs.length === 0) {
    throw new Error(
      `SELECTIVE_RESYNTHESIS_EVIDENCE_REQUIRED:${item.criterionId}`,
    );
  }
  return {
    ...structuredClone(item),
    dynamicResult:
      missingInputs.length === 0 ? 'REVIEW_REQUIRED' : 'UNKNOWN/WAITING_INPUT',
    candidateConclusion: review.comment,
    humanReviewRequired: true,
    factsConsidered: [
      ...item.factsConsidered,
      ...review.evidence.map((value) => value.statement),
    ],
    analysisSummary: `${item.analysisSummary}\nEngineer supplemental evidence: ${review.comment}`,
    sourceRefs: [...new Set([...item.sourceRefs, ...evidenceRefs])],
    missingInputs,
    effectiveEngineerReview: structuredClone(review),
  };
}

function applyCorrectedDirection(
  item: DynamicRuleReviewItem,
  review: OpenClawEngineerReviewItem,
): SelectiveJobAidItemCandidate {
  if (!review.correctedAnalysisDirection) {
    throw new Error(
      `SELECTIVE_RESYNTHESIS_DIRECTION_REQUIRED:${item.criterionId}`,
    );
  }
  return {
    ...structuredClone(item),
    dynamicResult:
      item.missingInputs.length === 0
        ? 'REVIEW_REQUIRED'
        : 'UNKNOWN/WAITING_INPUT',
    candidateConclusion: review.comment,
    humanReviewRequired: true,
    analysisSummary:
      `Corrected analysis direction: ${review.correctedAnalysisDirection}\n` +
      `Prior analysis: ${item.analysisSummary}`,
    effectiveEngineerReview: structuredClone(review),
  };
}

function assertCriterionSet(input: {
  criterionSetId: string;
  criterionCount: number;
  baseRuleRevision: number;
  baseRuleArtifactSha256: string;
  items: DynamicRuleReviewItem[];
}): void {
  if (
    !input.criterionSetId.trim() ||
    !Number.isSafeInteger(input.criterionCount) ||
    input.criterionCount < 1 ||
    input.items.length !== input.criterionCount ||
    !Number.isSafeInteger(input.baseRuleRevision) ||
    input.baseRuleRevision < 1 ||
    !input.baseRuleArtifactSha256.trim()
  ) {
    throw new Error('SELECTIVE_RESYNTHESIS_CRITERION_SET_INVALID');
  }
  const ids = new Set<string>();
  for (const item of input.items) {
    if (!item.criterionId.trim() || ids.has(item.criterionId)) {
      throw new Error('SELECTIVE_RESYNTHESIS_CRITERION_ID_INVALID');
    }
    ids.add(item.criterionId);
  }
}

function assertReviewContext(
  projection: CanonicalEngineerReviewLedgerProjection | null,
  context: OpenClawEngineerReviewContext,
  criterionSetId: string,
  baseRuleRevision: number,
  baseRuleArtifactSha256: string,
  knownCriterionIds: Set<string>,
): void {
  if (!projection) {
    if (
      context.revision !== null ||
      context.artifactSha256 !== null ||
      context.reviewCount !== 0 ||
      context.history.length !== 0 ||
      context.effective.length !== 0
    ) {
      throw new Error('SELECTIVE_RESYNTHESIS_REVIEW_PROJECTION_DRIFT');
    }
    return;
  }
  if (
    projection.criterionSetId !== criterionSetId ||
    projection.revision !== context.revision ||
    projection.reviewCount !== context.reviewCount ||
    projection.artifact.sha256 !== context.artifactSha256 ||
    context.reviewCount !== context.history.length ||
    context.revision !== context.history.length
  ) {
    throw new Error('SELECTIVE_RESYNTHESIS_REVIEW_PROJECTION_DRIFT');
  }
  const latest = new Map<string, OpenClawEngineerReviewItem>();
  context.history.forEach((review, index) => {
    if (
      review.sequence !== index + 1 ||
      !knownCriterionIds.has(review.criterionId) ||
      !validAffectedCriterionIds(review, knownCriterionIds) ||
      review.baseRuleRevision !== baseRuleRevision ||
      review.baseRuleArtifactSha256 !== baseRuleArtifactSha256 ||
      !review.comment.trim() ||
      !Number.isFinite(Date.parse(review.recordedAt)) ||
      expectedStatus(review) !== review.status ||
      !validReviewDetails(review)
    ) {
      throw new Error('SELECTIVE_RESYNTHESIS_REVIEW_HISTORY_INVALID');
    }
    latest.set(review.criterionId, review);
  });
  if (context.effective.length !== latest.size) {
    throw new Error('SELECTIVE_RESYNTHESIS_EFFECTIVE_REVIEW_DRIFT');
  }
  for (const review of context.effective) {
    const expected = latest.get(review.criterionId);
    if (!expected || JSON.stringify(expected) !== JSON.stringify(review)) {
      throw new Error('SELECTIVE_RESYNTHESIS_EFFECTIVE_REVIEW_DRIFT');
    }
  }
}

function validAffectedCriterionIds(
  review: OpenClawEngineerReviewItem,
  knownCriterionIds: Set<string>,
): boolean {
  return (
    reviewAffectedCriterionIds(review).length > 0 &&
    reviewAffectedCriterionIds(review).includes(review.criterionId) &&
    new Set(reviewAffectedCriterionIds(review)).size ===
      reviewAffectedCriterionIds(review).length &&
    reviewAffectedCriterionIds(review).every((criterionId) =>
      knownCriterionIds.has(criterionId),
    )
  );
}

function reviewAffectedCriterionIds(
  review: OpenClawEngineerReviewItem,
): string[] {
  return review.affectedCriterionIds ?? [review.criterionId];
}

function validReviewDetails(review: OpenClawEngineerReviewItem): boolean {
  if (review.actionType === 'REVISE_JUDGMENT') {
    return (
      review.evidence.length === 0 &&
      review.resolvedMissingInputs.length === 0 &&
      review.correctedAnalysisDirection === null
    );
  }
  if (review.actionType === 'SUPPLEMENT_EVIDENCE') {
    return (
      review.evidence.length > 0 &&
      review.correctedAnalysisDirection === null &&
      new Set(review.evidence.map((value) => value.sourceRefId)).size ===
        review.evidence.length
    );
  }
  return (
    review.actionType === 'CORRECT_ANALYSIS_DIRECTION' &&
    review.evidence.length === 0 &&
    review.resolvedMissingInputs.length === 0 &&
    Boolean(review.correctedAnalysisDirection?.trim())
  );
}

function assertSupportedStaleOverall(
  stale: CanonicalOpenClawOverallProjection,
  input: { baseRuleRevision: number; baseRuleArtifactSha256: string },
  userRequestedRegeneration: boolean,
): void {
  if (
    stale.status !== 'STALE' ||
    (userRequestedRegeneration
      ? stale.staleReason !== null
      : stale.staleReason !== 'ENGINEER_REVIEW_CHANGED')
  ) {
    throw new Error('SELECTIVE_RESYNTHESIS_STALE_REASON_UNSUPPORTED');
  }
  if (
    stale.basedOnBaseRuleRevision !== input.baseRuleRevision ||
    stale.basedOnBaseRuleArtifactSha256 !== input.baseRuleArtifactSha256
  ) {
    throw new Error('SELECTIVE_RESYNTHESIS_BASE_RULE_DRIFT');
  }
}

function expectedStatus(
  review: OpenClawEngineerReviewItem,
): OpenClawEngineerReviewItem['status'] {
  return review.actionType === 'REVISE_JUDGMENT' &&
    (review.decision === 'confirmed_pass' ||
      review.decision === 'confirmed_fail')
    ? 'ENGINEER_CONFIRMED'
    : 'NEEDS_REVIEW';
}

function requiredPositiveRevision(value: number | null, code: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(code);
  return Number(value);
}
