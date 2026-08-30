import type { CanonicalApplicabilityFleetSourceRef } from './api.interface';

export type BatchApplicabilityTruth = 'TRUE' | 'FALSE' | 'UNKNOWN';

export type BatchApplicabilityStatus =
  | 'EVALUATED'
  | 'WAITING_INPUT'
  | 'CONFLICT'
  | 'STALE';

export type BatchApplicabilitySourceConditionAuthority =
  | 'SOURCE_ASSERTED'
  | 'NORMALIZED_CANDIDATE';

export interface BatchApplicabilityFleetHeadBinding {
  sourceSnapshotId: string;
  sourceRevisionKey: string;
  authorityRevision: string;
  sourceAsOf: string;
}

export type BatchApplicabilityHostCurrentnessStatus =
  | 'CURRENT'
  | 'STALE'
  | 'CONFLICT'
  | 'UNVERIFIED';

export interface BatchApplicabilityHostBinding {
  status: BatchApplicabilityHostCurrentnessStatus;
  applicabilityInput: {
    currentness: BatchApplicabilityHostCurrentnessStatus;
    bindingRevision: string;
    selectionRevision: string;
  };
  controlledSelection: {
    currentness: 'CURRENT' | 'STALE';
    selectionRevision: string;
  };
  frozenFleetHead: BatchApplicabilityFleetHeadBinding;
  staleReasons: string[];
}

export interface BatchApplicabilityBlockingUnknown {
  kind: string;
  reason?: string;
  strategy?: string;
  property?: string | null;
  qualifier?: string | null;
  assetId?: string | null;
  assessmentAsOf?: string | null;
  [key: string]: unknown;
}

export interface BatchApplicabilityPredicateTraceNode {
  path: string;
  nodeType:
    | 'missing_expression'
    | 'literal'
    | 'assert'
    | 'and'
    | 'or'
    | 'not'
    | 'legacy_clause';
  truth: BatchApplicabilityTruth;
  predicate: {
    property: string;
    operator: string;
    value: unknown;
    qualifier: string | null;
  } | null;
  blockingUnknowns: BatchApplicabilityBlockingUnknown[];
  shortCircuitReason: string | null;
}

export interface BatchApplicabilityMatrixItemTrace {
  evaluator: 'CANONICAL_HOST_KLEENE_EVALUATOR';
  fleetResolver: 'CANONICAL_FLEET_MASTER_DATA_RESOLVER';
  fleetResolution: 'RESOLVED' | 'WAITING_INPUT' | 'CONFLICT';
  sourceCurrentness: {
    sourceSnapshotId: string | null;
    sourceRevisionKey: string | null;
    authorityRevision: string | null;
    status: 'CURRENT' | 'STALE' | 'CONFLICT' | 'UNVERIFIED';
    sourceAsOf: string | null;
    reason: string | null;
  };
  hostCurrentness: {
    status: BatchApplicabilityHostCurrentnessStatus;
    staleReasons: string[];
  };
  predicateNodes: BatchApplicabilityPredicateTraceNode[];
  blockingUnknowns: BatchApplicabilityBlockingUnknown[];
}

export type BatchApplicabilityClusterEligibility =
  | 'ELIGIBLE_EVALUATED_TRUE'
  | 'ELIGIBLE_EVALUATED_FALSE'
  | 'EXCLUDED_UNKNOWN'
  | 'EXCLUDED_CONFLICT'
  | 'EXCLUDED_NOT_EVALUATED'
  | 'EXCLUDED_STALE';

export interface BatchApplicabilityMatrixItem {
  matrixItemId: string;
  aircraftIdentifier: string;
  resolvedAircraftNumber: string | null;
  assetId: string | null;
  assetVersionId: string | null;
  asOf: string;
  truth: BatchApplicabilityTruth;
  status: BatchApplicabilityStatus;
  clusterEligibility: BatchApplicabilityClusterEligibility;
  candidateClusterId: string | null;
  sourceRefIds: string[];
  fleetSourceRefs: CanonicalApplicabilityFleetSourceRef[];
  trace: BatchApplicabilityMatrixItemTrace;
}

export interface BatchApplicabilityCandidateCluster {
  candidateClusterId: string;
  sourceConditionId: string;
  truth: 'TRUE' | 'FALSE';
  status: 'EVALUATED';
  memberMatrixItemIds: string[];
  aircraftIdentifiers: string[];
  asOfValues: string[];
  humanConfirmation: 'PENDING';
}

export interface BatchApplicabilityCandidateSet {
  candidateSetId: string;
  actionAttemptId: string;
  source: {
    workItemId: string;
    workItemRevision: number;
    documentVersionId: string;
    packageId: string;
    sourceConditionId: string;
    sourceExpressionId: string;
    sourceConditionAuthority: BatchApplicabilitySourceConditionAuthority;
    sourceRefIds: string[];
    target: {
      kind: 'document' | 'content_unit' | 'source_element';
      targetId: string | null;
    };
    hostBinding: BatchApplicabilityHostBinding;
  };
  matrix: BatchApplicabilityMatrixItem[];
  candidateClusters: BatchApplicabilityCandidateCluster[];
  counts: {
    total: number;
    true: number;
    false: number;
    unknown: number;
    evaluated: number;
    waitingInput: number;
    conflict: number;
    stale: number;
    clustered: number;
    excludedFromClustering: number;
  };
  authority: {
    outputAuthority: 'CANDIDATE_ONLY';
    modelCanSetFinalApplicability: false;
    humanConfirmationIsEngineeringApproval: false;
    engineeringApprovalChanged: false;
    workItemChanged: false;
    createsEvidenceRef: false;
    createsClosureDecision: false;
    createsActionReadiness: false;
  };
}

export type BatchApplicabilityClusterConfirmationDecision =
  | 'CONFIRM_CLUSTER_CANDIDATE'
  | 'REJECT_CLUSTER_CANDIDATE';

export interface BatchApplicabilityClusterConfirmationCandidate {
  status: 'HUMAN_CLUSTER_REVIEW_CANDIDATE_READY';
  candidateSetId: string;
  candidateClusterId: string;
  decision: BatchApplicabilityClusterConfirmationDecision;
  reviewedCluster: {
    truth: 'TRUE' | 'FALSE';
    memberMatrixItemIds: string[];
    aircraftIdentifiers: string[];
    asOfValues: string[];
  };
  audit: {
    workItemId: string;
    workItemRevision: number;
    documentVersionId: string;
    confirmedByActorId: string;
    reason: string;
    confirmedAt: string;
    validUntil: string;
    sourceRefIds: string[];
  };
  authority: {
    outputAuthority: 'CANDIDATE_ONLY';
    clusterAuthority:
      | 'ENGINEER_CONFIRMED_CANDIDATE_CLUSTER'
      | 'ENGINEER_REJECTED_CANDIDATE_CLUSTER';
    persistedByThisDomain: false;
    finalApplicabilityCreated: false;
    reviewActionCreated: false;
    engineeringApprovalChanged: false;
    workItemChanged: false;
  };
}

export interface CreateBatchApplicabilityRunRequest {
  requestId: string;
  sourceExpressionId: string;
  targets: Array<{
    aircraftIdentifier: string;
    asOf: string;
  }>;
}

export interface ConfirmBatchApplicabilityClusterRequest {
  requestId: string;
  expectedWorkItemRevision: number;
  candidateClusterId: string;
  decision: BatchApplicabilityClusterConfirmationDecision;
  reason: string;
  validUntil: string;
}

export interface BatchApplicabilityBrowserSafeUnknown {
  kind: string;
  reason: string | null;
  strategy: string | null;
  property: string | null;
  qualifier: string | null;
  assessmentAsOf: string | null;
}

export interface BatchApplicabilityBrowserSafePredicateTraceNode {
  path: string;
  nodeType: BatchApplicabilityPredicateTraceNode['nodeType'];
  truth: BatchApplicabilityTruth;
  predicate: BatchApplicabilityPredicateTraceNode['predicate'];
  blockingUnknowns: BatchApplicabilityBrowserSafeUnknown[];
  shortCircuitReason: string | null;
}

export interface BatchApplicabilityRunRowReadModel {
  matrixItemId: string;
  aircraftIdentifier: string;
  resolvedAircraftNumber: string | null;
  asOf: string;
  truth: BatchApplicabilityTruth;
  status: BatchApplicabilityStatus;
  clusterEligibility: BatchApplicabilityClusterEligibility;
  candidateClusterId: string | null;
  sourceRefIds: string[];
  trace: {
    evaluator: 'CANONICAL_HOST_KLEENE_EVALUATOR';
    fleetResolver: 'CANONICAL_FLEET_MASTER_DATA_RESOLVER';
    fleetResolution: 'RESOLVED' | 'WAITING_INPUT' | 'CONFLICT';
    sourceCurrentness: {
      sourceRevisionKey: string | null;
      authorityRevision: string | null;
      status: 'CURRENT' | 'STALE' | 'CONFLICT' | 'UNVERIFIED';
      sourceAsOf: string | null;
      reason: string | null;
    };
    hostCurrentness: {
      status: BatchApplicabilityHostCurrentnessStatus;
      staleReasons: string[];
    };
    predicateNodes: BatchApplicabilityBrowserSafePredicateTraceNode[];
    blockingUnknowns: BatchApplicabilityBrowserSafeUnknown[];
  };
}

export interface BatchApplicabilityConfirmationReceiptReadModel {
  schemaVersion: 'wiselink.3_1.batch_applicability_confirmation_receipt.v1';
  receiptId: string;
  runId: string;
  candidateClusterId: string;
  decision: BatchApplicabilityClusterConfirmationDecision;
  reviewedCluster: {
    truth: 'TRUE' | 'FALSE';
    memberMatrixItemIds: string[];
    aircraftIdentifiers: string[];
    asOfValues: string[];
  };
  reason: string;
  confirmedAt: string;
  validUntil: string;
  authority: {
    outputAuthority: 'CANDIDATE_ONLY';
    receiptPersisted: true;
    finalApplicabilityCreated: false;
    reviewActionCreated: false;
    engineeringApprovalChanged: false;
    workItemChanged: false;
    publicationPerformed: false;
  };
}

export interface BatchApplicabilityRunReadModel {
  schemaVersion: 'wiselink.3_1.batch_applicability_run.v1';
  runId: string;
  requestId: string;
  workItemId: string;
  workItemRevision: number;
  documentVersionId: string;
  createdAt: string;
  currentness: {
    status: BatchApplicabilityHostCurrentnessStatus;
    reasonCodes: string[];
  };
  source: {
    sourceConditionId: string;
    sourceExpressionId: string;
    sourceConditionAuthority: BatchApplicabilitySourceConditionAuthority;
    sourceRefIds: string[];
    target: {
      kind: 'document' | 'content_unit' | 'source_element';
      targetId: string | null;
    };
    fleetHead: {
      sourceRevisionKey: string;
      authorityRevision: string;
      sourceAsOf: string;
    };
    hostBinding: {
      status: BatchApplicabilityHostCurrentnessStatus;
      staleReasons: string[];
    };
  };
  matrix: BatchApplicabilityRunRowReadModel[];
  candidateClusters: BatchApplicabilityCandidateCluster[];
  confirmations: BatchApplicabilityConfirmationReceiptReadModel[];
  counts: BatchApplicabilityCandidateSet['counts'];
  authority: {
    outputAuthority: 'CANDIDATE_ONLY';
    modelCanSetFinalApplicability: false;
    humanConfirmationIsEngineeringApproval: false;
    engineeringApprovalChanged: false;
    workItemChanged: false;
    createsEvidenceRef: false;
    createsClosureDecision: false;
    createsActionReadiness: false;
    publicationPerformed: false;
  };
}
