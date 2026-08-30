export type OpenClawActionTaskType =
  | 'OPENCLAW_APPLICABILITY_EVALUATION'
  | 'OPENCLAW_DYNAMIC_EVALUATION'
  | 'OPENCLAW_INTERACTIVE_REVIEW'
  | 'OPENCLAW_OVERALL_SYNTHESIS'
  | 'OPENCLAW_TRANSLATE';

export type ActionAttemptStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'RETRY_SCHEDULED'
  | 'COMMITTING'
  | 'SUCCEEDED'
  | 'WAITING_INPUT'
  | 'FAILED'
  | 'TIMED_OUT'
  | 'CANCELLED'
  | 'CONFLICT'
  | 'OBSOLETE';

export interface ActionEnvelopeArtifactRef {
  ref: string;
  sha256: string;
}

export interface ActionEnvelopeMissingInput {
  code: string;
  message: string;
}

/**
 * Exact Host-owned RuleSet snapshot used to build one dynamic task. The
 * binding lives inside modelInput, so the existing TaskEnvelope inputHash and
 * durable ActionAttempt row seal it without introducing another envelope or
 * current-pointer mechanism.
 */
export interface OpenClawDynamicRuleSetBinding {
  schemaVersion: 'wiselink.3_1.dynamic_rule_set_binding.v1';
  snapshotId: string;
  criterionSetId: string;
  criterionSetHash: string;
  memberIdentityHash: string;
  criteriaCount: number;
  rulePackVersion: string;
  artifactRef: string;
  artifactDigest: string;
  artifactVersion: string;
  activationRevision: number;
}

/**
 * Immutable Host-created input delivered to OpenClaw after a successful
 * ActionAttempt lease claim.
 */
export interface OpenClawTaskEnvelope {
  schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1';
  actionAttemptId: string;
  operationRef: string;
  taskType: OpenClawActionTaskType;
  priority: number;
  tenantId: string;
  workItemId: string;
  inputRevision: number;
  baseRevision: number;
  documentVersionId: string;
  sourceRefs: ActionEnvelopeArtifactRef[];
  allowedConnectors: string[];
  hostResolvedMissingInputs: ActionEnvelopeMissingInput[];
  modelInput: Record<string, unknown>;
  deadline: string;
  idempotencyKey: string;
  inputHash: string;
}

export interface OpenClawDynamicTaskModelInput extends Record<string, unknown> {
  ruleSetBinding: OpenClawDynamicRuleSetBinding;
}

export interface OpenClawDynamicTaskEnvelope extends OpenClawTaskEnvelope {
  taskType: 'OPENCLAW_DYNAMIC_EVALUATION';
  modelInput: OpenClawDynamicTaskModelInput;
}

export type OpenClawResultBusinessOutcome =
  | 'CANDIDATE_READY'
  | 'UNKNOWN'
  | 'WAITING_INPUT'
  | 'NOT_PRODUCED';

/**
 * Complete executor result. The model output is data inside the envelope; it
 * is never accepted as a free-standing string or silently replaced with {}.
 */
export interface OpenClawResultEnvelope {
  schemaVersion: 'wiselink.3_1.openclaw_result_envelope.v1';
  actionAttemptId: string;
  operationRef: string;
  taskType: OpenClawActionTaskType;
  workItemId: string;
  baseRevision: number;
  status: 'SUCCEEDED' | 'WAITING_INPUT' | 'FAILED';
  businessOutcome: OpenClawResultBusinessOutcome;
  candidateStatus: 'UNKNOWN' | 'WAITING_INPUT' | null;
  modelOutput: string | null;
  outputArtifactRefs: ActionEnvelopeArtifactRef[];
  sourceRefs: ActionEnvelopeArtifactRef[];
  factsConsidered: string[];
  missingInputs: ActionEnvelopeMissingInput[];
  conflicts: string[];
  warnings: string[];
  modelVersion: string;
  promptVersion: string;
  skillVersion: string;
  toolVersions: Record<string, string>;
  runMetrics: {
    durationMs: number;
    inputUnits: number;
    outputUnits: number;
  };
  contentHash: string;
  errorCode: string | null;
  errorDetail: string | null;
}

interface OpenClawClaimBase {
  attemptRef: string;
  leaseToken: string;
  leaseGeneration: number;
  leaseExpiresAt: string;
  task: OpenClawTaskEnvelope;
}

export interface OpenClawRunningLeaseClaim extends OpenClawClaimBase {
  status: 'RUNNING';
}

export interface OpenClawCommittingRecoveryClaim extends OpenClawClaimBase {
  status: 'COMMITTING';
  recoveryResult: OpenClawResultEnvelope;
}

export type OpenClawLeaseClaim =
  | OpenClawRunningLeaseClaim
  | OpenClawCommittingRecoveryClaim;
