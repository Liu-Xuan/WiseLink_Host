import type {
  BatchApplicabilityBlockingUnknown,
  BatchApplicabilityCandidateCluster,
  BatchApplicabilityCandidateSet,
  BatchApplicabilityClusterEligibility,
  BatchApplicabilityHostBinding,
  BatchApplicabilityMatrixItem,
  BatchApplicabilityPredicateTraceNode,
  BatchApplicabilityStatus,
  BatchApplicabilityTruth,
} from '@shared/batch-applicability.interface';
import {
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
import { resolveTargetHostCurrentness } from './batch-applicability-currentness';
import type {
  BatchApplicabilitySourceConditionInput,
  BatchApplicabilityTargetInput,
} from './batch-applicability.types';

export function evaluateBatchTarget(input: {
  target: BatchApplicabilityTargetInput;
  index: number;
  candidateSetId: string;
  sourceCondition: BatchApplicabilitySourceConditionInput;
  hostBinding: BatchApplicabilityHostBinding;
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
  const fleetConflict: boolean = evaluation.blockingUnknowns.some(
    (unknown: BlockingUnknown): boolean =>
      unknown.kind === 'conflicting_fleet_fact',
  );
  const targetCurrentness = resolveTargetHostCurrentness({
    hostBinding: input.hostBinding,
    asOf,
  });
  const truth: BatchApplicabilityTruth = toTruth(evaluation.kleeneResult);
  const status: BatchApplicabilityStatus = resolveMatrixStatus({
    hostStatus: targetCurrentness.status,
    fleetConflict,
    evaluationStatus: evaluation.status,
  });
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
    clusterEligibility: toClusterEligibility(status, truth),
    candidateClusterId: null,
    sourceRefIds: [...input.sourceCondition.sourceRefIds],
    fleetSourceRefs: structuredClone(evaluation.sourceProvenance.sourceRefs),
    trace: {
      evaluator: 'CANONICAL_HOST_KLEENE_EVALUATOR',
      fleetResolver: 'CANONICAL_FLEET_MASTER_DATA_RESOLVER',
      fleetResolution: fleetConflict
        ? 'CONFLICT'
        : resolution.status === 'RESOLVED'
          ? 'RESOLVED'
          : 'WAITING_INPUT',
      sourceCurrentness: structuredClone(
        evaluation.sourceProvenance.sourceCurrentness,
      ),
      hostCurrentness: {
        status: targetCurrentness.status,
        staleReasons: [...targetCurrentness.staleReasons],
      },
      predicateNodes,
      blockingUnknowns: structuredClone(
        evaluation.blockingUnknowns,
      ) as BatchApplicabilityBlockingUnknown[],
    },
  };
}

export function buildBatchClusters(
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

export function countBatchRows(
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

function resolveMatrixStatus(input: {
  hostStatus: BatchApplicabilityHostBinding['status'];
  fleetConflict: boolean;
  evaluationStatus: 'EVALUATED' | 'WAITING_INPUT' | 'NOT_EVALUABLE';
}): BatchApplicabilityStatus {
  if (input.hostStatus === 'STALE') return 'STALE';
  if (input.hostStatus === 'CONFLICT' || input.fleetConflict) {
    return 'CONFLICT';
  }
  if (input.hostStatus === 'UNVERIFIED') return 'WAITING_INPUT';
  return input.evaluationStatus === 'EVALUATED' ? 'EVALUATED' : 'WAITING_INPUT';
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

function count(
  rows: BatchApplicabilityMatrixItem[],
  predicate: (row: BatchApplicabilityMatrixItem) => boolean,
): number {
  return rows.filter(predicate).length;
}

function requiredText(value: string, code: string): string {
  if (typeof value !== 'string' || !value.trim()) throw evaluationError(code);
  return value.trim();
}

function requiredIsoDate(value: string, code: string): string {
  const text: string = requiredText(value, code);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) throw evaluationError(code);
  const timestamp: number = Date.parse(`${text}T00:00:00.000Z`);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== text
  ) {
    throw evaluationError(code);
  }
  return text;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function evaluationError(
  code: string,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 409 });
}
