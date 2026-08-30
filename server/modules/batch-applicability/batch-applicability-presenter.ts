import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import type {
  BatchApplicabilityBlockingUnknown,
  BatchApplicabilityCandidateSet,
  BatchApplicabilityClusterConfirmationCandidate,
  BatchApplicabilityConfirmationReceiptReadModel,
  BatchApplicabilityFleetHeadBinding,
  BatchApplicabilityRunReadModel,
} from '@shared/batch-applicability.interface';
import {
  freezeBatchHostBinding,
  sameFleetHead,
} from './batch-applicability-currentness';
import type {
  PersistedBatchApplicabilityConfirmation,
  PersistedBatchApplicabilityRun,
} from './batch-applicability-host.types';

export function parseCandidateSet(
  run: PersistedBatchApplicabilityRun,
): BatchApplicabilityCandidateSet {
  try {
    const value = JSON.parse(
      run.candidateSetJson,
    ) as BatchApplicabilityCandidateSet;
    if (
      value.candidateSetId !==
        `BATCH-APPLICABILITY:${run.runId}:${run.sourceConditionId}` ||
      value.source.workItemId !== run.workItemId ||
      value.source.workItemRevision !== run.workItemRevision ||
      value.source.documentVersionId !== run.documentVersionId ||
      value.source.packageId !== run.sourcePackageId ||
      value.source.sourceExpressionId !== run.sourceExpressionId ||
      !sameFleetHead(value.source.hostBinding.frozenFleetHead, run.fleetHead)
    ) {
      throw new Error('BATCH_RUN_CANDIDATE_BINDING_INVALID');
    }
    return value;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('BATCH_')) {
      throw error;
    }
    throw new Error('BATCH_RUN_CANDIDATE_JSON_INVALID');
  }
}

export function storageSafeCandidateSet(
  candidateSet: BatchApplicabilityCandidateSet,
): BatchApplicabilityCandidateSet {
  const copy = structuredClone(candidateSet);
  copy.matrix = copy.matrix.map((row) => ({
    ...row,
    assetId: null,
    assetVersionId: null,
    fleetSourceRefs: [],
    trace: {
      ...row.trace,
      predicateNodes: row.trace.predicateNodes.map((node) => ({
        ...node,
        blockingUnknowns: node.blockingUnknowns.map(storageSafeUnknown),
      })),
      blockingUnknowns: row.trace.blockingUnknowns.map(storageSafeUnknown),
    },
  }));
  return copy;
}

export function batchRunReadModel(input: {
  run: PersistedBatchApplicabilityRun;
  confirmations: PersistedBatchApplicabilityConfirmation[];
  currentWorkItem: CanonicalWorkItemProjection;
  currentFleetHead: BatchApplicabilityFleetHeadBinding;
}): BatchApplicabilityRunReadModel {
  const candidateSet = parseCandidateSet(input.run);
  const currentness = runCurrentness(input);
  return {
    schemaVersion: 'wiselink.3_1.batch_applicability_run.v1',
    runId: input.run.runId,
    requestId: input.run.requestId,
    workItemId: input.run.workItemId,
    workItemRevision: input.run.workItemRevision,
    documentVersionId: input.run.documentVersionId,
    createdAt: input.run.createdAt.toISOString(),
    currentness,
    source: {
      sourceConditionId: candidateSet.source.sourceConditionId,
      sourceExpressionId: candidateSet.source.sourceExpressionId,
      sourceConditionAuthority: candidateSet.source.sourceConditionAuthority,
      sourceRefIds: [...candidateSet.source.sourceRefIds],
      target: structuredClone(candidateSet.source.target),
      fleetHead: {
        sourceRevisionKey: input.run.fleetHead.sourceRevisionKey,
        authorityRevision: input.run.fleetHead.authorityRevision,
        sourceAsOf: input.run.fleetHead.sourceAsOf,
      },
      hostBinding: {
        status: candidateSet.source.hostBinding.status,
        staleReasons: [...candidateSet.source.hostBinding.staleReasons],
      },
    },
    matrix: candidateSet.matrix.map((row) => ({
      matrixItemId: row.matrixItemId,
      aircraftIdentifier: row.aircraftIdentifier,
      resolvedAircraftNumber: row.resolvedAircraftNumber,
      asOf: row.asOf,
      truth: row.truth,
      status: row.status,
      clusterEligibility: row.clusterEligibility,
      candidateClusterId: row.candidateClusterId,
      sourceRefIds: [...row.sourceRefIds],
      trace: {
        evaluator: row.trace.evaluator,
        fleetResolver: row.trace.fleetResolver,
        fleetResolution: row.trace.fleetResolution,
        sourceCurrentness: {
          sourceRevisionKey: row.trace.sourceCurrentness.sourceRevisionKey,
          authorityRevision: row.trace.sourceCurrentness.authorityRevision,
          status: row.trace.sourceCurrentness.status,
          sourceAsOf: row.trace.sourceCurrentness.sourceAsOf,
          reason: row.trace.sourceCurrentness.reason,
        },
        hostCurrentness: structuredClone(row.trace.hostCurrentness),
        predicateNodes: row.trace.predicateNodes.map((node) => ({
          ...structuredClone(node),
          blockingUnknowns: node.blockingUnknowns.map(browserSafeUnknown),
        })),
        blockingUnknowns: row.trace.blockingUnknowns.map(browserSafeUnknown),
      },
    })),
    candidateClusters: structuredClone(candidateSet.candidateClusters),
    confirmations: input.confirmations.map(confirmationReadModel),
    counts: structuredClone(candidateSet.counts),
    authority: {
      ...structuredClone(candidateSet.authority),
      publicationPerformed: false,
    },
  };
}

function runCurrentness(input: {
  run: PersistedBatchApplicabilityRun;
  currentWorkItem: CanonicalWorkItemProjection;
  currentFleetHead: BatchApplicabilityFleetHeadBinding;
}): BatchApplicabilityRunReadModel['currentness'] {
  const reasons: string[] = [];
  if (
    input.currentWorkItem.workItemId !== input.run.workItemId ||
    input.currentWorkItem.revision !== input.run.workItemRevision ||
    input.currentWorkItem.source.documentVersionId !==
      input.run.documentVersionId ||
    input.currentWorkItem.package?.packageId !== input.run.sourcePackageId
  ) {
    reasons.push('WORK_ITEM_SOURCE_REVISION_CHANGED');
  }
  if (!sameFleetHead(input.run.fleetHead, input.currentFleetHead)) {
    reasons.push('FLEET_HEAD_CHANGED');
  }
  try {
    const binding = freezeBatchHostBinding({
      workItem: input.currentWorkItem,
      currentFleetHead: input.currentFleetHead,
    });
    reasons.push(...binding.staleReasons);
    if (binding.status !== 'CURRENT') reasons.push(`HOST_${binding.status}`);
  } catch {
    reasons.push('HOST_BINDING_INVALID');
  }
  if (input.run.hostBindingStatus !== 'CURRENT') {
    reasons.push(`RUN_${input.run.hostBindingStatus}`);
  }
  return {
    status: reasons.length === 0 ? 'CURRENT' : 'STALE',
    reasonCodes: [...new Set(reasons)],
  };
}

function confirmationReadModel(
  row: PersistedBatchApplicabilityConfirmation,
): BatchApplicabilityConfirmationReceiptReadModel {
  const candidate = JSON.parse(
    row.confirmationCandidateJson,
  ) as BatchApplicabilityClusterConfirmationCandidate;
  return {
    schemaVersion: 'wiselink.3_1.batch_applicability_confirmation_receipt.v1',
    receiptId: row.receiptId,
    runId: row.runId,
    candidateClusterId: row.candidateClusterId,
    decision: row.decision,
    reviewedCluster: structuredClone(candidate.reviewedCluster),
    reason: row.reason,
    confirmedAt: row.confirmedAt.toISOString(),
    validUntil: row.validUntil.toISOString(),
    authority: {
      outputAuthority: 'CANDIDATE_ONLY',
      receiptPersisted: true,
      finalApplicabilityCreated: false,
      reviewActionCreated: false,
      engineeringApprovalChanged: false,
      workItemChanged: false,
      publicationPerformed: false,
    },
  };
}

function storageSafeUnknown(
  value: BatchApplicabilityBlockingUnknown,
): BatchApplicabilityBlockingUnknown {
  const copy = structuredClone(value);
  delete copy.assetId;
  return copy;
}

function browserSafeUnknown(value: BatchApplicabilityBlockingUnknown) {
  return {
    kind: value.kind,
    reason: typeof value.reason === 'string' ? value.reason : null,
    strategy: typeof value.strategy === 'string' ? value.strategy : null,
    property: typeof value.property === 'string' ? value.property : null,
    qualifier: typeof value.qualifier === 'string' ? value.qualifier : null,
    assessmentAsOf:
      typeof value.assessmentAsOf === 'string' ? value.assessmentAsOf : null,
  };
}
