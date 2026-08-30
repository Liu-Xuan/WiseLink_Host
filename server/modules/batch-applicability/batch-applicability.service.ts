import { Injectable } from '@nestjs/common';

import type {
  BatchApplicabilityCandidateCluster,
  BatchApplicabilityCandidateSet,
  BatchApplicabilityClusterConfirmationCandidate,
  BatchApplicabilityHostBinding,
  BatchApplicabilityMatrixItem,
} from '@shared/batch-applicability.interface';
import {
  assertSingleBatchFleetHead,
  freezeBatchHostBinding,
  sameFleetHead,
} from './batch-applicability-currentness';
import {
  buildBatchClusters,
  countBatchRows,
  evaluateBatchTarget,
} from './batch-applicability-evaluation';
import type {
  BatchApplicabilitySourceConditionInput,
  BatchApplicabilityTargetInput,
  ConfirmBatchApplicabilityClusterInput,
  EvaluateBatchApplicabilityCandidateInput,
} from './batch-applicability.types';

@Injectable()
export class BatchApplicabilityService {
  evaluateCandidate(
    input: EvaluateBatchApplicabilityCandidateInput,
  ): BatchApplicabilityCandidateSet {
    validateEvaluationInput(input);
    const workItem = input.workItem;
    const sourceCondition = input.sourceCondition;
    const hostBinding: BatchApplicabilityHostBinding = freezeBatchHostBinding({
      workItem,
      currentFleetHead: input.currentFleetHead,
    });
    assertSingleBatchFleetHead(input.targets, hostBinding.frozenFleetHead);
    const candidateSetId: string = [
      'BATCH-APPLICABILITY',
      requiredText(input.actionAttemptId, 'BATCH_ACTION_ATTEMPT_ID_REQUIRED'),
      requiredText(
        sourceCondition.sourceConditionId,
        'BATCH_SOURCE_CONDITION_ID_REQUIRED',
      ),
    ].join(':');
    const unclusteredRows: BatchApplicabilityMatrixItem[] = input.targets.map(
      (
        target: BatchApplicabilityTargetInput,
        index: number,
      ): BatchApplicabilityMatrixItem =>
        evaluateBatchTarget({
          target,
          index,
          candidateSetId,
          sourceCondition,
          hostBinding,
        }),
    );
    const clusters: BatchApplicabilityCandidateCluster[] = buildBatchClusters(
      candidateSetId,
      sourceCondition.sourceConditionId,
      unclusteredRows,
    );
    const clusterIdByMatrixItem: Map<string, string> = new Map();
    for (const cluster of clusters) {
      for (const matrixItemId of cluster.memberMatrixItemIds) {
        clusterIdByMatrixItem.set(matrixItemId, cluster.candidateClusterId);
      }
    }
    const matrix: BatchApplicabilityMatrixItem[] = unclusteredRows.map(
      (row: BatchApplicabilityMatrixItem): BatchApplicabilityMatrixItem => ({
        ...row,
        candidateClusterId: clusterIdByMatrixItem.get(row.matrixItemId) ?? null,
      }),
    );
    return {
      candidateSetId,
      actionAttemptId: input.actionAttemptId,
      source: {
        workItemId: workItem.workItemId,
        workItemRevision: workItem.revision,
        documentVersionId: workItem.source.documentVersionId,
        packageId: workItem.package!.packageId,
        sourceConditionId: sourceCondition.sourceConditionId,
        sourceExpressionId: sourceCondition.sourceExpressionId,
        sourceConditionAuthority: sourceCondition.authority,
        sourceRefIds: [...sourceCondition.sourceRefIds],
        target: structuredClone(sourceCondition.target),
        hostBinding: structuredClone(hostBinding),
      },
      matrix,
      candidateClusters: clusters,
      counts: countBatchRows(matrix),
      authority: {
        outputAuthority: 'CANDIDATE_ONLY',
        modelCanSetFinalApplicability: false,
        humanConfirmationIsEngineeringApproval: false,
        engineeringApprovalChanged: false,
        workItemChanged: false,
        createsEvidenceRef: false,
        createsClosureDecision: false,
        createsActionReadiness: false,
      },
    };
  }

  confirmCluster(
    input: ConfirmBatchApplicabilityClusterInput,
  ): BatchApplicabilityClusterConfirmationCandidate {
    validateConfirmationInput(input);
    const cluster = input.candidateSet.candidateClusters.find(
      (candidate: BatchApplicabilityCandidateCluster): boolean =>
        candidate.candidateClusterId === input.candidateClusterId,
    );
    if (!cluster) {
      throw domainError('BATCH_CLUSTER_NOT_CONFIRMABLE');
    }
    if (
      cluster.status !== 'EVALUATED' ||
      !['TRUE', 'FALSE'].includes(cluster.truth) ||
      cluster.sourceConditionId !==
        input.candidateSet.source.sourceConditionId ||
      cluster.memberMatrixItemIds.length === 0 ||
      new Set(cluster.memberMatrixItemIds).size !==
        cluster.memberMatrixItemIds.length
    ) {
      throw domainError('BATCH_CLUSTER_NOT_CONFIRMABLE');
    }
    const memberRows: BatchApplicabilityMatrixItem[] =
      cluster.memberMatrixItemIds.map(
        (matrixItemId: string): BatchApplicabilityMatrixItem => {
          const row = input.candidateSet.matrix.find(
            (candidate: BatchApplicabilityMatrixItem): boolean =>
              candidate.matrixItemId === matrixItemId,
          );
          if (
            !row ||
            row.status !== 'EVALUATED' ||
            row.truth !== cluster.truth ||
            row.candidateClusterId !== cluster.candidateClusterId
          ) {
            throw domainError('BATCH_CLUSTER_MEMBERSHIP_DRIFT');
          }
          return row;
        },
      );
    const rowsBoundToCluster: BatchApplicabilityMatrixItem[] =
      input.candidateSet.matrix.filter(
        (row: BatchApplicabilityMatrixItem): boolean =>
          row.candidateClusterId === cluster.candidateClusterId,
      );
    if (
      rowsBoundToCluster.length !== memberRows.length ||
      !sameStrings(
        rowsBoundToCluster.map(
          (row: BatchApplicabilityMatrixItem): string => row.matrixItemId,
        ),
        cluster.memberMatrixItemIds,
      ) ||
      !sameStrings(
        memberRows.map(
          (row: BatchApplicabilityMatrixItem): string => row.aircraftIdentifier,
        ),
        cluster.aircraftIdentifiers,
      ) ||
      !sameStrings(
        uniqueStrings(
          memberRows.map(
            (row: BatchApplicabilityMatrixItem): string => row.asOf,
          ),
        ),
        cluster.asOfValues,
      )
    ) {
      throw domainError('BATCH_CLUSTER_MEMBERSHIP_DRIFT');
    }
    return {
      status: 'HUMAN_CLUSTER_REVIEW_CANDIDATE_READY',
      candidateSetId: input.candidateSet.candidateSetId,
      candidateClusterId: cluster.candidateClusterId,
      decision: input.decision,
      reviewedCluster: {
        truth: cluster.truth,
        memberMatrixItemIds: [...cluster.memberMatrixItemIds],
        aircraftIdentifiers: [...cluster.aircraftIdentifiers],
        asOfValues: [...cluster.asOfValues],
      },
      audit: {
        workItemId: input.currentWorkItem.workItemId,
        workItemRevision: input.currentWorkItem.revision,
        documentVersionId: input.currentWorkItem.source.documentVersionId,
        confirmedByActorId: input.confirmedByActorId,
        reason: input.reason,
        confirmedAt: input.confirmedAt,
        validUntil: input.validUntil,
        sourceRefIds: uniqueStrings([
          ...input.candidateSet.source.sourceRefIds,
          ...memberRows.flatMap(
            (row: BatchApplicabilityMatrixItem): string[] => row.sourceRefIds,
          ),
        ]),
      },
      authority: {
        outputAuthority: 'CANDIDATE_ONLY',
        clusterAuthority:
          input.decision === 'CONFIRM_CLUSTER_CANDIDATE'
            ? 'ENGINEER_CONFIRMED_CANDIDATE_CLUSTER'
            : 'ENGINEER_REJECTED_CANDIDATE_CLUSTER',
        persistedByThisDomain: false,
        finalApplicabilityCreated: false,
        reviewActionCreated: false,
        engineeringApprovalChanged: false,
        workItemChanged: false,
      },
    };
  }
}

function validateEvaluationInput(
  input: EvaluateBatchApplicabilityCandidateInput,
): void {
  requiredText(input.actionAttemptId, 'BATCH_ACTION_ATTEMPT_ID_REQUIRED');
  requiredText(input.workItem.workItemId, 'BATCH_WORK_ITEM_ID_REQUIRED');
  if (
    !Number.isSafeInteger(input.workItem.revision) ||
    input.workItem.revision < 0
  ) {
    throw domainError('BATCH_WORK_ITEM_REVISION_INVALID');
  }
  if (!input.workItem.package) {
    throw domainError('BATCH_SOURCE_PACKAGE_REQUIRED');
  }
  requiredText(
    input.sourceCondition.sourceConditionId,
    'BATCH_SOURCE_CONDITION_ID_REQUIRED',
  );
  requiredText(
    input.sourceCondition.sourceExpressionId,
    'BATCH_SOURCE_EXPRESSION_ID_REQUIRED',
  );
  if (
    (input.sourceCondition.target.kind === 'document' &&
      input.sourceCondition.target.targetId !== null) ||
    (input.sourceCondition.target.kind !== 'document' &&
      !input.sourceCondition.target.targetId?.trim())
  ) {
    throw domainError('BATCH_SOURCE_TARGET_INVALID');
  }
  if (
    !['SOURCE_ASSERTED', 'NORMALIZED_CANDIDATE'].includes(
      input.sourceCondition.authority,
    )
  ) {
    throw domainError('BATCH_SOURCE_CONDITION_AUTHORITY_INVALID');
  }
  if (
    input.sourceCondition.sourceRefIds.length === 0 ||
    input.sourceCondition.sourceRefIds.some(
      (sourceRefId: string): boolean => !sourceRefId.trim(),
    ) ||
    new Set(input.sourceCondition.sourceRefIds).size !==
      input.sourceCondition.sourceRefIds.length
  ) {
    throw domainError('BATCH_SOURCE_REFS_REQUIRED');
  }
  if (input.targets.length === 0) {
    throw domainError('BATCH_TARGETS_REQUIRED');
  }
  const targetKeys: string[] = input.targets.map(
    (target: BatchApplicabilityTargetInput): string =>
      `${target.aircraftIdentifier.trim().toUpperCase()}\u0000${target.asOf}`,
  );
  if (new Set(targetKeys).size !== targetKeys.length) {
    throw domainError('BATCH_TARGET_DUPLICATE');
  }
}

function validateConfirmationInput(
  input: ConfirmBatchApplicabilityClusterInput,
): void {
  requiredText(input.confirmedByActorId, 'BATCH_CONFIRMING_ACTOR_REQUIRED');
  requiredText(input.reason, 'BATCH_CONFIRMATION_REASON_REQUIRED');
  requiredText(input.candidateClusterId, 'BATCH_CLUSTER_ID_REQUIRED');
  if (
    !['CONFIRM_CLUSTER_CANDIDATE', 'REJECT_CLUSTER_CANDIDATE'].includes(
      input.decision,
    )
  ) {
    throw domainError('BATCH_CONFIRMATION_DECISION_INVALID');
  }
  const confirmedAt: string = requiredIsoTimestamp(
    input.confirmedAt,
    'BATCH_CONFIRMED_AT_INVALID',
  );
  const validUntil: string = requiredIsoTimestamp(
    input.validUntil,
    'BATCH_VALID_UNTIL_INVALID',
  );
  if (validUntil <= confirmedAt) {
    throw domainError('BATCH_VALIDITY_WINDOW_INVALID');
  }
  const source = input.candidateSet.source;
  const workItem = input.currentWorkItem;
  if (
    workItem.workItemId !== source.workItemId ||
    workItem.source.documentVersionId !== source.documentVersionId ||
    workItem.package?.packageId !== source.packageId
  ) {
    throw domainError('BATCH_CONFIRMATION_SOURCE_BINDING_DRIFT');
  }
  if (
    workItem.revision !== input.expectedWorkItemRevision ||
    workItem.revision !== source.workItemRevision
  ) {
    throw domainError('BATCH_CONFIRMATION_WORK_ITEM_REVISION_CONFLICT');
  }
  if (
    !sameFleetHead(source.hostBinding.frozenFleetHead, input.currentFleetHead)
  ) {
    throw domainError('BATCH_CONFIRMATION_FLEET_HEAD_CHANGED');
  }
  const currentHostBinding: BatchApplicabilityHostBinding =
    freezeBatchHostBinding({
      workItem,
      currentFleetHead: input.currentFleetHead,
    });
  if (
    source.hostBinding.status !== 'CURRENT' ||
    currentHostBinding.status !== 'CURRENT' ||
    source.hostBinding.applicabilityInput.bindingRevision !==
      currentHostBinding.applicabilityInput.bindingRevision ||
    source.hostBinding.controlledSelection.selectionRevision !==
      currentHostBinding.controlledSelection.selectionRevision
  ) {
    throw domainError('BATCH_CONFIRMATION_HOST_CURRENTNESS_STALE');
  }
}

function requiredText(value: string, code: string): string {
  if (typeof value !== 'string' || !value.trim()) throw domainError(code);
  return value.trim();
}

function requiredIsoTimestamp(value: string, code: string): string {
  const text: string = requiredText(value, code);
  const timestamp: number = Date.parse(text);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== text
  ) {
    throw domainError(code);
  }
  return text;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function sameStrings(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every(
    (value: string, index: number): boolean => value === right[index],
  );
}

function domainError(
  code: string,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 409 });
}
