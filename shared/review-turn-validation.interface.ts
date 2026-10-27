import type { JobAidWorkRevision } from './jobaid-problem-assessment.interface';
import type { JobAidChecklistFeedback } from './jobaid-checklist.interface';

/** Host seals this version only for newly admitted CODEX Review tasks. */
export interface CodexReviewExecutionPolicyV1 {
  schemaVersion: 'wiselink.3_1.review_execution.v1';
  executor: 'CODEX';
  runtimeAppId: string;
  profileRef: 'wiselink-engineering';
  modelPolicyRef: 'official-hosted-profile-config';
  skillPolicyRef: 'wiselink-research-and-synthesize@r09';
  toolPolicyRef:
    | 'wiselink-openclaw-engineering-assessment@1.2.0#interactive-review-c3'
    | 'wiselink-openclaw-engineering-assessment@1.2.0#interactive-jobaid-review-c5';
}

export interface ValidateReviewTurnCandidateRequest {
  attemptRef: string;
  workItemId: string;
  leaseToken: string;
  leaseGeneration: number;
  /** Exact final candidate UTF-8 JSON, not a patch or ResultEnvelope. */
  candidateJson: string;
}

export interface ReviewValidationViolation {
  code: string;
  fieldPaths: string[];
  message: string;
  ruleId?: string;
  itemId?: string;
  disposition: 'BLOCK';
  retryability: 'REPAIRABLE';
  recoveryScope: 'CANDIDATE';
}

export interface ReviewValidationBinding {
  attemptRef: string;
  actionAttemptId: string;
  workItemId: string;
  documentVersionId: string;
  inputRevision: number;
  baseRevision: number;
  reviewConversationRef: string;
  reviewTurnRef: string;
  requestId: string;
  taskInputHash: string;
}

export interface ValidateReviewTurnCandidateResult {
  schemaVersion: 'wiselink.3_1.review_turn_validation.v1';
  checkPhase: 'PRECHECK';
  status: 'VALID' | 'REPAIR_REQUIRED';
  binding: ReviewValidationBinding & {
    leaseGeneration: number;
    basis: { kind: 'CLASSIC' }
      | { kind: 'JOBAID'; workRevisionRef: string | null; workRevision: number }
      | { kind: 'MATTER'; matterId: string; basedOnMatterRevisionId: string; expectedWorkingRevision: number };
  };
  candidateDigest: string;
  violations: ReviewValidationViolation[];
  omittedViolationCount: number;
  checklistFeedback?: Pick<JobAidChecklistFeedback,
    'contractVersion' | 'ruleset' | 'findings' | 'semanticNotAssessedByHost'>;
}

export interface ReadReviewSavedWorkRequest {
  attemptRef: string;
  workItemId: string;
  workRevisionRef: string;
}

export interface ReadReviewSavedWorkResult {
  schemaVersion: 'wiselink.3_1.review_saved_work_read.v1';
  executionStatus: 'SUCCEEDED';
  binding: ReviewValidationBinding & { resultContentHash: string };
  revision: JobAidWorkRevision;
}
