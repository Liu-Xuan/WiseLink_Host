import type {
  BatchApplicabilityCandidateSet,
  BatchApplicabilityClusterConfirmationCandidate,
  BatchApplicabilityClusterConfirmationDecision,
  BatchApplicabilityFleetHeadBinding,
  CreateBatchApplicabilityRunRequest,
} from '@shared/batch-applicability.interface';

export interface PersistedBatchApplicabilityRun {
  runId: string;
  tenantId: string;
  actorId: string;
  workItemId: string;
  requestId: string;
  requestPayloadJson: string;
  workItemRevision: number;
  documentVersionId: string;
  sourcePackageId: string;
  sourceExpressionId: string;
  sourceConditionId: string;
  sourceRefIdsJson: string;
  fleetHead: BatchApplicabilityFleetHeadBinding;
  hostBindingStatus: 'CURRENT' | 'STALE' | 'CONFLICT' | 'UNVERIFIED';
  candidateSetJson: string;
  createdAt: Date;
}

export interface PersistedBatchApplicabilityConfirmation {
  receiptId: string;
  runId: string;
  tenantId: string;
  actorId: string;
  workItemId: string;
  requestId: string;
  requestPayloadJson: string;
  workItemRevision: number;
  candidateClusterId: string;
  decision: BatchApplicabilityClusterConfirmationDecision;
  reason: string;
  confirmedAt: Date;
  validUntil: Date;
  confirmationCandidateJson: string;
  createdAt: Date;
}

export interface CreateBatchApplicabilityRunRecord {
  runId: string;
  tenantId: string;
  actorId: string;
  workItemId: string;
  request: CreateBatchApplicabilityRunRequest;
  candidateSet: BatchApplicabilityCandidateSet;
}

export interface CreateBatchApplicabilityConfirmationRecord {
  receiptId: string;
  run: PersistedBatchApplicabilityRun;
  actorId: string;
  request: {
    requestId: string;
    expectedWorkItemRevision: number;
    candidateClusterId: string;
    decision: BatchApplicabilityClusterConfirmationDecision;
    reason: string;
    validUntil: string;
  };
  candidate: BatchApplicabilityClusterConfirmationCandidate;
}
