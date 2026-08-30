import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import type {
  BatchApplicabilityFleetHeadBinding,
  BatchApplicabilityHostBinding,
  BatchApplicabilityHostCurrentnessStatus,
} from '@shared/batch-applicability.interface';
import type { FleetMasterDataSource } from '../assessment-workbench/applicability-fleet/fleetMasterData';
import type { BatchApplicabilityTargetInput } from './batch-applicability.types';

interface TargetHostCurrentness {
  status: BatchApplicabilityHostCurrentnessStatus;
  staleReasons: string[];
}

/**
 * Freezes the fresh Host head used by one batch and compares both Host-owned
 * WorkItem applicability bindings against it. A stale WorkItem is observable
 * data, not an input error, so callers can retain truth while excluding rows.
 */
export function freezeBatchHostBinding(input: {
  workItem: CanonicalWorkItemProjection;
  currentFleetHead: BatchApplicabilityFleetHeadBinding;
}): BatchApplicabilityHostBinding {
  const head: BatchApplicabilityFleetHeadBinding = requiredFleetHead(
    input.currentFleetHead,
  );
  const workItem: CanonicalWorkItemProjection = input.workItem;
  const applicabilityInput = workItem.applicabilityInput;
  const selection = workItem.applicabilityControlledSelection;
  if (
    !applicabilityInput ||
    applicabilityInput.schemaVersion !==
      'wiselink.3_1.applicability_input_projection.v1'
  ) {
    throw currentnessError('BATCH_HOST_APPLICABILITY_INPUT_REQUIRED');
  }
  if (
    !selection ||
    selection.schemaVersion !==
      'wiselink.3_1.controlled_applicability_selection.v1'
  ) {
    throw currentnessError('BATCH_HOST_CONTROLLED_SELECTION_REQUIRED');
  }
  if (
    applicabilityInput.workItemId !== workItem.workItemId ||
    applicabilityInput.documentVersionId !==
      workItem.source.documentVersionId ||
    applicabilityInput.sourcePackageId !== workItem.package?.packageId ||
    applicabilityInput.sourcePackageContentHash !==
      workItem.package?.contentHash ||
    applicabilityInput.sourcePackageArtifactSha256 !==
      workItem.package?.artifact.sha256 ||
    selection.documentVersionId !== workItem.source.documentVersionId
  ) {
    throw currentnessError('BATCH_HOST_SOURCE_BINDING_DRIFT');
  }
  requiredText(
    applicabilityInput.bindingRevision,
    'BATCH_HOST_INPUT_BINDING_REVISION_REQUIRED',
  );
  requiredText(
    applicabilityInput.targetBindingHash,
    'BATCH_HOST_TARGET_BINDING_REQUIRED',
  );
  requiredText(
    applicabilityInput.selectionRevision,
    'BATCH_HOST_INPUT_SELECTION_REVISION_REQUIRED',
  );
  requiredText(
    selection.selectionRevision,
    'BATCH_HOST_SELECTION_REVISION_REQUIRED',
  );
  requiredIsoDate(
    applicabilityInput.assessmentAsOf,
    'BATCH_HOST_INPUT_AS_OF_INVALID',
  );
  requiredIsoDate(selection.asOf, 'BATCH_HOST_SELECTION_AS_OF_INVALID');

  const staleReasons: string[] = [];
  if (applicabilityInput.currentness === 'STALE') {
    staleReasons.push('APPLICABILITY_INPUT_CURRENTNESS_STALE');
  }
  if (selection.currentness !== 'CURRENT') {
    staleReasons.push('CONTROLLED_SELECTION_CURRENTNESS_STALE');
  }
  if (applicabilityInput.selectionRevision !== selection.selectionRevision) {
    staleReasons.push('CONTROLLED_SELECTION_REVISION_CHANGED');
  }
  if (!fleetSourceMatchesHead(applicabilityInput.fleetMasterData, head)) {
    staleReasons.push('APPLICABILITY_INPUT_FLEET_HEAD_CHANGED');
  }
  if (!selectionMatchesHead(selection, head)) {
    staleReasons.push('CONTROLLED_SELECTION_FLEET_HEAD_CHANGED');
  }
  if (applicabilityInput.assessmentAsOf < head.sourceAsOf) {
    staleReasons.push('APPLICABILITY_INPUT_AS_OF_BEFORE_FLEET_SOURCE_AS_OF');
  }
  if (selection.asOf < head.sourceAsOf) {
    staleReasons.push('CONTROLLED_SELECTION_AS_OF_BEFORE_FLEET_SOURCE_AS_OF');
  }

  return {
    status: resolveHostStatus(applicabilityInput.currentness, staleReasons),
    applicabilityInput: {
      currentness: applicabilityInput.currentness,
      bindingRevision: applicabilityInput.bindingRevision,
      selectionRevision: applicabilityInput.selectionRevision,
    },
    controlledSelection: {
      currentness:
        selection.currentness === 'CURRENT' &&
        selectionMatchesHead(selection, head)
          ? 'CURRENT'
          : 'STALE',
      selectionRevision: selection.selectionRevision,
    },
    frozenFleetHead: structuredClone(head),
    staleReasons: uniqueStrings(staleReasons),
  };
}

/** Rejects before evaluation so no two Fleet versions can share one batch. */
export function assertSingleBatchFleetHead(
  targets: BatchApplicabilityTargetInput[],
  frozenHead: BatchApplicabilityFleetHeadBinding,
): void {
  for (const target of targets) {
    if (!fleetSourceMatchesHead(target.fleetMasterData, frozenHead)) {
      throw currentnessError('BATCH_FLEET_SOURCE_MIXED');
    }
  }
}

export function resolveTargetHostCurrentness(input: {
  hostBinding: BatchApplicabilityHostBinding;
  asOf: string;
}): TargetHostCurrentness {
  const staleReasons: string[] = [...input.hostBinding.staleReasons];
  if (input.asOf < input.hostBinding.frozenFleetHead.sourceAsOf) {
    staleReasons.push('ASSESSMENT_AS_OF_BEFORE_FLEET_SOURCE_AS_OF');
  }
  if (staleReasons.length > 0) {
    return { status: 'STALE', staleReasons: uniqueStrings(staleReasons) };
  }
  return {
    status: input.hostBinding.status,
    staleReasons: [],
  };
}

export function sameFleetHead(
  left: BatchApplicabilityFleetHeadBinding,
  right: BatchApplicabilityFleetHeadBinding,
): boolean {
  return (
    left.sourceSnapshotId === right.sourceSnapshotId &&
    left.sourceRevisionKey === right.sourceRevisionKey &&
    left.authorityRevision === right.authorityRevision &&
    left.sourceAsOf === right.sourceAsOf
  );
}

function requiredFleetHead(
  value: BatchApplicabilityFleetHeadBinding,
): BatchApplicabilityFleetHeadBinding {
  return {
    sourceSnapshotId: requiredText(
      value.sourceSnapshotId,
      'BATCH_FLEET_HEAD_SNAPSHOT_REQUIRED',
    ),
    sourceRevisionKey: requiredText(
      value.sourceRevisionKey,
      'BATCH_FLEET_HEAD_REVISION_REQUIRED',
    ),
    authorityRevision: requiredText(
      value.authorityRevision,
      'BATCH_FLEET_HEAD_AUTHORITY_REQUIRED',
    ),
    sourceAsOf: requiredIsoDate(
      value.sourceAsOf,
      'BATCH_FLEET_HEAD_AS_OF_INVALID',
    ),
  };
}

function fleetSourceMatchesHead(
  source: FleetMasterDataSource,
  head: BatchApplicabilityFleetHeadBinding,
): boolean {
  return (
    source.schemaVersion ===
      'wiselink.v3_1.applicability_fleet.fleet_master_data.v1' &&
    source.sourceSnapshotId === head.sourceSnapshotId &&
    source.sourceRevisionKey === head.sourceRevisionKey &&
    source.authorityRevision === head.authorityRevision &&
    source.sourceAsOf === head.sourceAsOf
  );
}

function selectionMatchesHead(
  selection: NonNullable<
    CanonicalWorkItemProjection['applicabilityControlledSelection']
  >,
  head: BatchApplicabilityFleetHeadBinding,
): boolean {
  return (
    selection.fleetSourceSnapshotId === head.sourceSnapshotId &&
    selection.fleetSourceRevisionKey === head.sourceRevisionKey &&
    selection.fleetAuthorityRevision === head.authorityRevision &&
    selection.fleetSourceAsOf === head.sourceAsOf
  );
}

function resolveHostStatus(
  inputCurrentness: BatchApplicabilityHostCurrentnessStatus,
  staleReasons: string[],
): BatchApplicabilityHostCurrentnessStatus {
  if (staleReasons.length > 0) return 'STALE';
  return inputCurrentness;
}

function requiredText(value: string, code: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw currentnessError(code);
  }
  return value.trim();
}

function requiredIsoDate(value: string, code: string): string {
  const text: string = requiredText(value, code);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) {
    throw currentnessError(code);
  }
  const timestamp: number = Date.parse(`${text}T00:00:00.000Z`);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== text
  ) {
    throw currentnessError(code);
  }
  return text;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function currentnessError(
  code: string,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 409 });
}
