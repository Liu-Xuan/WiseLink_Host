import { Injectable } from '@nestjs/common';

import type {
  BatchApplicabilityBlockingUnknown,
  BatchApplicabilityCandidateCluster,
  BatchApplicabilityCandidateSet,
  BatchApplicabilityClusterConfirmationCandidate,
  BatchApplicabilityClusterEligibility,
  BatchApplicabilityMatrixItem,
  BatchApplicabilityPredicateTraceNode,
  BatchApplicabilityStatus,
  BatchApplicabilityTruth,
} from '@shared/batch-applicability.interface';
import {
  UNKNOWN,
  evaluateWithTrace,
  type ApplicabilityAstNode,
  type ApplicabilityFleetSnapshot,
  type BlockingUnknown,
  type KleeneResult,
  type KleeneTrace,
} from '../assessment-workbench/applicability-fleet/applicabilityKleeneEngine';
import { evaluateApplicabilityForAircraft } from '../assessment-workbench/applicability-fleet/applicabilityFleetEvaluator';
import {
  resolveFleetSnapshot,
  type FleetSnapshotResolution,
} from '../assessment-workbench/applicability-fleet/fleetMasterData';
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
        evaluateTarget({
          target,
          index,
          candidateSetId,
          sourceCondition,
        }),
    );
    const clusters: BatchApplicabilityCandidateCluster[] = buildClusters(
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
      },
      matrix,
      candidateClusters: clusters,
      counts: countRows(matrix),
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

function evaluateTarget(input: {
  target: BatchApplicabilityTargetInput;
  index: number;
  candidateSetId: string;
  sourceCondition: BatchApplicabilitySourceConditionInput;
}): BatchApplicabilityMatrixItem {
  const aircraftIdentifier: string = requiredText(
    input.target.aircraftIdentifier,
    'BATCH_AIRCRAFT_IDENTIFIER_REQUIRED',
  );
  const asOf: string = requiredIsoDate(
    input.target.asOf,
    'BATCH_AS_OF_INVALID',
  );
  const evaluation = evaluateApplicabilityForAircraft({
    dataSource: input.target.fleetMasterData,
    aircraftNumber: aircraftIdentifier,
    asOf,
    applicabilityAst: input.sourceCondition.applicabilityAst,
  });
  const resolution: FleetSnapshotResolution = resolveFleetSnapshot({
    dataSource: input.target.fleetMasterData,
    aircraftNumber: aircraftIdentifier,
    asOf,
  });
  const conflict: boolean = evaluation.blockingUnknowns.some(
    (unknown: BlockingUnknown): boolean =>
      unknown.kind === 'conflicting_fleet_fact',
  );
  const truth: BatchApplicabilityTruth = toTruth(evaluation.kleeneResult);
  const status: BatchApplicabilityStatus = conflict
    ? 'CONFLICT'
    : evaluation.status === 'EVALUATED'
      ? 'EVALUATED'
      : 'WAITING_INPUT';
  const clusterEligibility: BatchApplicabilityClusterEligibility =
    toClusterEligibility(status, truth);
  const predicateNodes: BatchApplicabilityPredicateTraceNode[] =
    resolution.snapshot
      ? collectPredicateTrace(
          input.sourceCondition.applicabilityAst,
          resolution.snapshot,
        )
      : [];
  return {
    matrixItemId: `${input.candidateSetId}:ITEM:${input.index + 1}`,
    aircraftIdentifier,
    resolvedAircraftNumber:
      typeof resolution.snapshot?.context?.aircraftNumber === 'string'
        ? resolution.snapshot.context.aircraftNumber
        : null,
    assetId: evaluation.sourceProvenance.assetId,
    assetVersionId: evaluation.sourceProvenance.assetVersionId,
    asOf,
    truth,
    status,
    clusterEligibility,
    candidateClusterId: null,
    sourceRefIds: [...input.sourceCondition.sourceRefIds],
    fleetSourceRefs: structuredClone(evaluation.sourceProvenance.sourceRefs),
    trace: {
      evaluator: 'CANONICAL_HOST_KLEENE_EVALUATOR',
      fleetResolver: 'CANONICAL_FLEET_MASTER_DATA_RESOLVER',
      fleetResolution: conflict
        ? 'CONFLICT'
        : resolution.status === 'RESOLVED'
          ? 'RESOLVED'
          : 'WAITING_INPUT',
      sourceCurrentness: structuredClone(
        evaluation.sourceProvenance.sourceCurrentness,
      ),
      predicateNodes,
      blockingUnknowns: structuredClone(
        evaluation.blockingUnknowns,
      ) as BatchApplicabilityBlockingUnknown[],
    },
  };
}

function collectPredicateTrace(
  ast: ApplicabilityAstNode | null,
  snapshot: ApplicabilityFleetSnapshot,
): BatchApplicabilityPredicateTraceNode[] {
  if (ast === null) {
    const trace: KleeneTrace = evaluateWithTrace(null, snapshot, null);
    return [toPredicateTraceNode('root', 'missing_expression', null, trace)];
  }
  const nodes: BatchApplicabilityPredicateTraceNode[] = [];
  collectPredicateTraceNode(ast, snapshot, 'root', nodes);
  return nodes;
}

function collectPredicateTraceNode(
  ast: ApplicabilityAstNode,
  snapshot: ApplicabilityFleetSnapshot,
  path: string,
  nodes: BatchApplicabilityPredicateTraceNode[],
): void {
  const trace: KleeneTrace = evaluateWithTrace(ast, snapshot, null);
  nodes.push(toPredicateTraceNode(path, ast.type, ast, trace));
  if (ast.type === 'and' || ast.type === 'or') {
    ast.children.forEach((child: ApplicabilityAstNode, index: number): void =>
      collectPredicateTraceNode(
        child,
        snapshot,
        `${path}.children[${index}]`,
        nodes,
      ),
    );
  } else if (ast.type === 'not') {
    collectPredicateTraceNode(ast.child, snapshot, `${path}.child`, nodes);
  }
}

function toPredicateTraceNode(
  path: string,
  nodeType: BatchApplicabilityPredicateTraceNode['nodeType'],
  ast: ApplicabilityAstNode | null,
  trace: KleeneTrace,
): BatchApplicabilityPredicateTraceNode {
  const predicate =
    ast?.type === 'assert'
      ? {
          property: ast.property,
          operator: ast.operator,
          value: structuredClone(ast.value),
          qualifier: ast.qualifier ?? null,
        }
      : null;
  return {
    path,
    nodeType,
    truth: toTruth(trace.result),
    predicate,
    blockingUnknowns: structuredClone(
      trace.blockingUnknowns,
    ) as BatchApplicabilityBlockingUnknown[],
    shortCircuitReason: trace.shortCircuitReason ?? null,
  };
}

function buildClusters(
  candidateSetId: string,
  sourceConditionId: string,
  rows: BatchApplicabilityMatrixItem[],
): BatchApplicabilityCandidateCluster[] {
  const clusters: BatchApplicabilityCandidateCluster[] = [];
  for (const truth of ['TRUE', 'FALSE'] as const) {
    const members: BatchApplicabilityMatrixItem[] = rows.filter(
      (row: BatchApplicabilityMatrixItem): boolean =>
        row.status === 'EVALUATED' && row.truth === truth,
    );
    if (members.length === 0) continue;
    clusters.push({
      candidateClusterId: `${candidateSetId}:CLUSTER:${truth}`,
      sourceConditionId,
      truth,
      status: 'EVALUATED',
      memberMatrixItemIds: members.map(
        (row: BatchApplicabilityMatrixItem): string => row.matrixItemId,
      ),
      aircraftIdentifiers: members.map(
        (row: BatchApplicabilityMatrixItem): string => row.aircraftIdentifier,
      ),
      asOfValues: uniqueStrings(
        members.map((row: BatchApplicabilityMatrixItem): string => row.asOf),
      ),
      humanConfirmation: 'PENDING',
    });
  }
  return clusters;
}

function countRows(
  rows: BatchApplicabilityMatrixItem[],
): BatchApplicabilityCandidateSet['counts'] {
  const clustered: number = rows.filter(
    (row: BatchApplicabilityMatrixItem): boolean =>
      row.clusterEligibility === 'ELIGIBLE_EVALUATED_TRUE' ||
      row.clusterEligibility === 'ELIGIBLE_EVALUATED_FALSE',
  ).length;
  return {
    total: rows.length,
    true: count(
      rows,
      (row: BatchApplicabilityMatrixItem): boolean => row.truth === 'TRUE',
    ),
    false: count(
      rows,
      (row: BatchApplicabilityMatrixItem): boolean => row.truth === 'FALSE',
    ),
    unknown: count(
      rows,
      (row: BatchApplicabilityMatrixItem): boolean => row.truth === 'UNKNOWN',
    ),
    evaluated: count(
      rows,
      (row: BatchApplicabilityMatrixItem): boolean =>
        row.status === 'EVALUATED',
    ),
    waitingInput: count(
      rows,
      (row: BatchApplicabilityMatrixItem): boolean =>
        row.status === 'WAITING_INPUT',
    ),
    conflict: count(
      rows,
      (row: BatchApplicabilityMatrixItem): boolean => row.status === 'CONFLICT',
    ),
    stale: count(
      rows,
      (row: BatchApplicabilityMatrixItem): boolean => row.status === 'STALE',
    ),
    clustered,
    excludedFromClustering: rows.length - clustered,
  };
}

function count(
  rows: BatchApplicabilityMatrixItem[],
  predicate: (row: BatchApplicabilityMatrixItem) => boolean,
): number {
  return rows.filter(predicate).length;
}

function toTruth(result: KleeneResult | null): BatchApplicabilityTruth {
  if (result === true) return 'TRUE';
  if (result === false) return 'FALSE';
  return 'UNKNOWN';
}

function toClusterEligibility(
  status: BatchApplicabilityStatus,
  truth: BatchApplicabilityTruth,
): BatchApplicabilityClusterEligibility {
  if (status === 'CONFLICT') return 'EXCLUDED_CONFLICT';
  if (status === 'STALE') return 'EXCLUDED_STALE';
  if (truth === 'UNKNOWN') return 'EXCLUDED_UNKNOWN';
  if (status !== 'EVALUATED') return 'EXCLUDED_NOT_EVALUATED';
  return truth === 'TRUE'
    ? 'ELIGIBLE_EVALUATED_TRUE'
    : 'ELIGIBLE_EVALUATED_FALSE';
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
}

function requiredText(value: string, code: string): string {
  if (typeof value !== 'string' || !value.trim()) throw domainError(code);
  return value.trim();
}

function requiredIsoDate(value: string, code: string): string {
  const text: string = requiredText(value, code);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) throw domainError(code);
  const timestamp: number = Date.parse(`${text}T00:00:00.000Z`);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== text
  ) {
    throw domainError(code);
  }
  return text;
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
