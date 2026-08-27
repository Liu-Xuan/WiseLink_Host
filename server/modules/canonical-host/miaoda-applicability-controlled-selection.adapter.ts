import { Inject, Injectable } from '@nestjs/common';

import type {
  CanonicalApplicabilityControlledSelectionProjection,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import type { FleetMasterDataSource } from '../assessment-workbench/applicability-fleet/fleetMasterData';
import { CanonicalFleetMasterDataRepository } from './canonical-fleet-master-data.repository';
import { CANONICAL_WORK_ITEM_REGISTRAR } from './canonical-host.constants';
import type {
  CanonicalApplicabilityControlledSelection,
  CanonicalApplicabilityControlledSelectionPort,
} from './canonical-host-applicability-input.producer';
import type { CanonicalWorkItemRegistrarPort } from './canonical-host.types';

/** Production DB-backed owner for CANONICAL_APPLICABILITY_CONTROLLED_SELECTION. */
@Injectable()
export class MiaodaApplicabilityControlledSelectionAdapter implements CanonicalApplicabilityControlledSelectionPort {
  constructor(
    @Inject(CANONICAL_WORK_ITEM_REGISTRAR)
    private readonly registrar: CanonicalWorkItemRegistrarPort,
    private readonly fleetRepository: CanonicalFleetMasterDataRepository,
  ) {}

  async readCurrent(input: {
    tenantId: string;
    workItemId: string;
    documentVersionId: string;
    applicabilityContextRef: string;
  }): Promise<CanonicalApplicabilityControlledSelection> {
    if (!input.applicabilityContextRef.trim()) {
      throw controlledSelectionUnavailable(
        'APPLICABILITY_CONTEXT_REF_REQUIRED',
        404,
      );
    }
    const workItem: CanonicalWorkItemProjection =
      await this.registrar.getTenantScopedByWorkItemId({
        tenantId: input.tenantId,
        workItemId: input.workItemId,
      });
    if (
      workItem.workItemId !== input.workItemId ||
      workItem.source.documentVersionId !== input.documentVersionId
    ) {
      throw controlledSelectionUnavailable(
        'CANONICAL_WORK_ITEM_NOT_FOUND',
        404,
      );
    }
    assertFrozenApplicabilitySourceReady(workItem);
    const selection: CanonicalApplicabilityControlledSelectionProjection =
      requiredSelection(workItem);
    const fleetMasterData: FleetMasterDataSource =
      await this.fleetRepository.readCurrentForAircraft({
        tenantId: input.tenantId,
        aircraftIdentifier: selection.aircraftIdentifier,
        asOf: selection.asOf,
      });
    if (!selectionMatchesFleet(selection, fleetMasterData)) {
      throw controlledSelectionUnavailable(
        'APPLICABILITY_CONTROLLED_SELECTION_STALE',
        409,
      );
    }
    return {
      schemaVersion: selection.schemaVersion,
      selectionRevision: selection.selectionRevision,
      currentness: 'CURRENT',
      documentVersionId: selection.documentVersionId,
      aircraftNumber: selection.aircraftIdentifier,
      assessmentAsOf: selection.asOf,
      fleetMasterData,
    };
  }
}

export function assertFrozenApplicabilitySourceReady(
  workItem: CanonicalWorkItemProjection,
): void {
  const applicability = workItem.package?.usagePolicy?.applicability;
  if (
    workItem.phase !== 'CANDIDATE_READBACK_VERIFIED' ||
    workItem.package?.contractId !== 'techpub.parsed-package.v1' ||
    workItem.package.contractRevision !== 'frozen.2' ||
    !applicability ||
    !Number.isSafeInteger(applicability.sourceExpressionCount) ||
    !Number.isSafeInteger(applicability.assignmentCount) ||
    applicability.sourceExpressionCount <= 0 ||
    applicability.assignmentCount !== applicability.sourceExpressionCount
  ) {
    throw controlledSelectionUnavailable(
      'APPLICABILITY_FROZEN_SOURCE_BINDING_UNAVAILABLE',
      409,
    );
  }
}

export function selectionMatchesFleet(
  selection: CanonicalApplicabilityControlledSelectionProjection,
  fleet: FleetMasterDataSource,
): boolean {
  return (
    selection.fleetSourceSnapshotId === fleet.sourceSnapshotId &&
    selection.fleetSourceRevisionKey === fleet.sourceRevisionKey &&
    selection.fleetAuthorityRevision === fleet.authorityRevision &&
    selection.fleetSourceAsOf === fleet.sourceAsOf
  );
}

function requiredSelection(
  workItem: CanonicalWorkItemProjection,
): CanonicalApplicabilityControlledSelectionProjection {
  const selection = workItem.applicabilityControlledSelection;
  if (
    !selection ||
    selection.schemaVersion !==
      'wiselink.3_1.controlled_applicability_selection.v1' ||
    selection.currentness !== 'CURRENT' ||
    selection.documentVersionId !== workItem.source.documentVersionId ||
    !selection.selectionRevision.trim() ||
    !selection.aircraftIdentifier.trim() ||
    !isIsoDate(selection.asOf) ||
    !selection.fleetSourceSnapshotId.trim() ||
    !selection.fleetSourceRevisionKey.trim() ||
    !selection.fleetAuthorityRevision.trim() ||
    !isIsoDate(selection.fleetSourceAsOf)
  ) {
    throw controlledSelectionUnavailable(
      'APPLICABILITY_CONTROLLED_SELECTION_NOT_CONFIGURED',
      409,
    );
  }
  return selection;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const timestamp: number = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
  );
}

function controlledSelectionUnavailable(
  code: string,
  statusCode: number,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode });
}
