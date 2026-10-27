import type { ReviewValidationViolation } from '@shared/review-turn-validation.interface';

/** Only explicitly identified candidate faults become repair feedback. */
export class ReviewCandidateValidationError extends Error {
  constructor(readonly code: string, readonly fieldPaths: string[], message = code, readonly statusCode = 400) {
    super(message);
    this.name = 'ReviewCandidateValidationError';
  }
  violation(): ReviewValidationViolation {
    return { code: this.code, fieldPaths: this.fieldPaths, message: this.code,
      disposition: 'BLOCK', retryability: 'REPAIRABLE', recoveryScope: 'CANDIDATE' };
  }
}

// Finite contract allowlist: never infer repairability from an error prefix.
const candidateFields: Record<string, string[]> = {
  REVIEW_RESULT_MODEL_OUTPUT_JSON_INVALID: [''],
  REVIEW_RESULT_CONTRACT_INVALID: [''],
  REVIEW_CONTRACT_EXACT_SHAPE_INVALID: [''],
  REVIEW_JOBAID_DELTA_INVALID: ['/jobAidWorkingDelta'],
  REVIEW_UPDATE_WORKING_DELTA_REQUIRED: ['/jobAidWorkingDelta'],
  REVIEW_CHAT_ASSESSMENT_MUTATION_FORBIDDEN: ['/responseType', '/reviewActionDraft', '/jobAidWorkingDelta', '/affectedItemIds'],
  REVIEW_RESULT_ANSWER_REQUIRED: ['/answer'],
  REVIEW_RESULT_SOURCE_REFS_INVALID: ['/sourceRefs'],
  REVIEW_RESULT_SOURCE_LINK_REF_REQUIRED: ['/sourceRefs'],
  REVIEW_RESULT_MISSING_INPUTS_INVALID: ['/missingInputs'],
  REVIEW_RESULT_EVIDENCE_REFS_INVALID: ['/candidateEvidenceRefs'],
  REVIEW_RESULT_AFFECTED_ITEMS_INVALID: ['/affectedItemIds'],
  REVIEW_RESULT_WARNINGS_INVALID: ['/warnings'],
  REVIEW_RESULT_DUPLICATES_INVALID: ['/sourceRefs', '/candidateEvidenceRefs', '/affectedItemIds', '/warnings', '/missingInputs'],
  REVIEW_RESULT_SOURCE_REF_NOT_ALLOWED: ['/sourceRefs', '/candidateEvidenceRefs'],
  REVIEW_RESULT_DRAFT_INVALID: ['/reviewActionDraft'],
  REVIEW_RESULT_DRAFT_DUPLICATE: ['/reviewActionDraft'],
  REVIEW_RESULT_DRAFT_REVISION_INVALID: ['/reviewActionDraft/baseRevision'],
  REVIEW_RESULT_DRAFT_REVISION_MISMATCH: ['/reviewActionDraft/baseRevision'],
  REVIEW_RESULT_DRAFT_ITEM_REQUIRED: ['/reviewActionDraft/evaluationItemId'],
  REVIEW_RESULT_DRAFT_ITEM_NOT_ALLOWED: ['/reviewActionDraft/evaluationItemId', '/reviewActionDraft/affectedItemIds'],
  REVIEW_RESULT_DRAFT_STATUS_REQUIRED: ['/reviewActionDraft/proposedStatus'],
  REVIEW_RESULT_DRAFT_SOURCE_REF_NOT_ALLOWED: ['/reviewActionDraft/sourceRefs'],
  REVIEW_RESULT_DRAFT_ADOPTED_INPUT_NOT_ALLOWED: ['/reviewActionDraft/adoptedInputRefs'],
  REVIEW_RESULT_DRAFT_AFFECTED_ITEMS_MISMATCH: ['/affectedItemIds', '/reviewActionDraft/affectedItemIds'],
  REVIEW_RESULT_AFFECTED_ITEM_NOT_ALLOWED: ['/affectedItemIds'],
  REVIEW_RESULT_DRAFT_RESPONSE_MISMATCH: ['/responseType', '/reviewActionDraft'],
  REVIEW_RESULT_DRAFT_OVERALL_IMPACT_INVALID: ['/reviewActionDraft/overallImpact'],
  REVIEW_RESULT_DRAFT_DISPOSITIONS_INVALID: ['/reviewActionDraft/uncertaintyDispositions'],
  REVIEW_RESULT_DRAFT_DISPOSITIONS_DUPLICATE: ['/reviewActionDraft/uncertaintyDispositions'],
  REVIEW_RESULT_DRAFT_DISPOSITION_INVALID: ['/reviewActionDraft/uncertaintyDispositions'],
  REVIEW_RESULT_DRAFT_DISPOSITION_INCOMPLETE: ['/reviewActionDraft/uncertaintyDispositions'],
  REVIEW_RESULT_DRAFT_DISPOSITION_REVIEW_BY_INVALID: ['/reviewActionDraft/uncertaintyDispositions'],
  REVIEW_RESULT_DECISION_SNAPSHOT_DISPOSITIONS_MISMATCH: ['/reviewActionDraft/decisionSnapshot/uncertaintyDispositions'],
  REVIEW_RESULT_DECISION_SNAPSHOT_INVALID: ['/reviewActionDraft/decisionSnapshot'],
  REVIEW_RESULT_DECISION_SNAPSHOT_AUTHORITY_INVALID: ['/reviewActionDraft/decisionSnapshot/candidateOnly'],
  REVIEW_RESULT_DECISION_SNAPSHOT_AS_OF_INVALID: ['/reviewActionDraft/decisionSnapshot/assessmentAsOf'],
  REVIEW_RESULT_DECISION_SNAPSHOT_VALID_UNTIL_INVALID: ['/reviewActionDraft/decisionSnapshot/validUntil'],
  REVIEW_RESULT_DECISION_SNAPSHOT_REVIEW_BY_INVALID: ['/reviewActionDraft/decisionSnapshot/reviewBy'],
  REVIEW_RESULT_DECISION_SNAPSHOT_NOT_CONFIRMABLE: ['/reviewActionDraft/decisionSnapshot'],
  REVIEW_RESULT_DRAFT_GAP_NOT_ALLOWED: ['/reviewActionDraft/resolvedGapRefs', '/reviewActionDraft/uncertaintyDispositions'],
  REVIEW_RESULT_DRAFT_GAP_NOT_RESOLVABLE: ['/reviewActionDraft/resolvedGapRefs', '/reviewActionDraft/uncertaintyDispositions'],
  REVIEW_RESULT_DRAFT_DISPOSITION_RESOLUTION_MISMATCH: ['/reviewActionDraft/uncertaintyDispositions'],
  REVIEW_RESULT_DRAFT_GAP_AFFECTED_ITEMS_MISMATCH: ['/reviewActionDraft/affectedItemIds'],
  REVIEW_RESULT_DRAFT_GAP_EVIDENCE_REQUIRED: ['/reviewActionDraft/sourceRefs'],
};

/** Call only inside the candidate parser, after a trusted task was parsed. */
export function rethrowReviewCandidateError(error: unknown): never {
  if (error instanceof ReviewCandidateValidationError) throw error;
  const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : '';
  const paths = candidateFields[code];
  if (paths) throw new ReviewCandidateValidationError(code, paths);
  throw error;
}
