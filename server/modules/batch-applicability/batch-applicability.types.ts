import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import type {
  BatchApplicabilityCandidateSet,
  BatchApplicabilityClusterConfirmationDecision,
  BatchApplicabilitySourceConditionAuthority,
} from '@shared/batch-applicability.interface';
import type { ApplicabilityAstNode } from '../assessment-workbench/applicability-fleet/applicabilityKleeneEngine';
import type { FleetMasterDataSource } from '../assessment-workbench/applicability-fleet/fleetMasterData';

export interface BatchApplicabilitySourceConditionInput {
  sourceConditionId: string;
  sourceExpressionId: string;
  authority: BatchApplicabilitySourceConditionAuthority;
  sourceRefIds: string[];
  target: {
    kind: 'document' | 'content_unit' | 'source_element';
    targetId: string | null;
  };
  applicabilityAst: ApplicabilityAstNode | null;
}

export interface BatchApplicabilityTargetInput {
  aircraftIdentifier: string;
  asOf: string;
  /**
   * Read-only output from the existing canonical Fleet repository/port.
   * This domain never opens an import asset or writes a configuration fact.
   */
  fleetMasterData: FleetMasterDataSource;
}

export interface EvaluateBatchApplicabilityCandidateInput {
  actionAttemptId: string;
  workItem: CanonicalWorkItemProjection;
  sourceCondition: BatchApplicabilitySourceConditionInput;
  targets: BatchApplicabilityTargetInput[];
}

export interface ConfirmBatchApplicabilityClusterInput {
  currentWorkItem: CanonicalWorkItemProjection;
  candidateSet: BatchApplicabilityCandidateSet;
  expectedWorkItemRevision: number;
  candidateClusterId: string;
  decision: BatchApplicabilityClusterConfirmationDecision;
  confirmedByActorId: string;
  reason: string;
  confirmedAt: string;
  validUntil: string;
}
