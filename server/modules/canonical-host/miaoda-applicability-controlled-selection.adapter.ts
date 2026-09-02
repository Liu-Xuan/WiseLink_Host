import { Inject, Injectable } from '@nestjs/common';

import type {
  CanonicalApplicabilityControlledSelectionProjection,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import type { FleetMasterDataSource } from '../assessment-workbench/applicability-fleet/fleetMasterData';
import { canonicalSha256 } from '../action-attempt/action-attempt-envelope';
import { CanonicalFleetMasterDataRepository } from './canonical-fleet-master-data.repository';
import {
  CONFIGURATION_EVIDENCE_STORE,
  type ConfigurationEvidenceStorePort,
  type PersistedConfigurationEvidenceSnapshot,
} from './configuration-evidence/configuration-evidence.persistence.types';
import type { ConfigurationSnapshotFact } from './configuration-evidence/configuration-snapshot.types';
import { CANONICAL_WORK_ITEM_REGISTRAR } from './canonical-host.constants';
import type {
  CanonicalApplicabilityControlledSelection,
  CanonicalApplicabilityControlledSelectionPort,
} from './canonical-host-applicability-input.producer';
import type { CanonicalWorkItemRegistrarPort } from './canonical-host.types';

const HOST_TARGET_AIRCRAFT_ENV = 'WL_OPENCLAW_APPLICABILITY_TARGET_AIRCRAFT_ID';
const HOST_TARGET_AS_OF_ENV = 'WL_OPENCLAW_APPLICABILITY_TARGET_AS_OF';

/** Production DB-backed owner for CANONICAL_APPLICABILITY_CONTROLLED_SELECTION. */
@Injectable()
export class MiaodaApplicabilityControlledSelectionAdapter implements CanonicalApplicabilityControlledSelectionPort {
  constructor(
    @Inject(CANONICAL_WORK_ITEM_REGISTRAR)
    private readonly registrar: CanonicalWorkItemRegistrarPort,
    private readonly fleetRepository: CanonicalFleetMasterDataRepository,
    @Inject(CONFIGURATION_EVIDENCE_STORE)
    private readonly configurationEvidence: ConfigurationEvidenceStorePort,
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
    const selection = optionalSelection(workItem);
    if (!selection) {
      return this.readConfiguredHostTarget(input, workItem);
    }
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
    return this.withConfigurationEvidence(input, {
      schemaVersion: selection.schemaVersion,
      selectionRevision: selection.selectionRevision,
      currentness: 'CURRENT',
      documentVersionId: selection.documentVersionId,
      aircraftNumber: selection.aircraftIdentifier,
      assessmentAsOf: selection.asOf,
      fleetMasterData,
    });
  }

  private async readConfiguredHostTarget(
    input: {
      tenantId: string;
      workItemId: string;
      documentVersionId: string;
      applicabilityContextRef: string;
    },
    workItem: CanonicalWorkItemProjection,
  ): Promise<CanonicalApplicabilityControlledSelection> {
    const aircraftNumber = normalizeAircraftIdentifier(
      process.env[HOST_TARGET_AIRCRAFT_ENV],
    );
    const assessmentAsOf = process.env[HOST_TARGET_AS_OF_ENV]?.trim() ?? '';
    if (!aircraftNumber || !isIsoDate(assessmentAsOf)) {
      throw controlledSelectionUnavailable(
        'APPLICABILITY_HOST_TARGET_NOT_CONFIGURED',
        409,
      );
    }
    const fleetMasterData = await this.fleetRepository.readCurrentForAircraft({
      tenantId: input.tenantId,
      aircraftIdentifier: aircraftNumber,
      asOf: assessmentAsOf,
    });
    const matches = fleetMasterData.assets.filter(
      (asset) =>
        normalizeAircraftIdentifier(asset.aircraftNumber) === aircraftNumber ||
        (asset.aliases ?? []).some(
          (alias) =>
            normalizeAircraftIdentifier(alias.aliasValue) === aircraftNumber,
        ),
    );
    if (matches.length !== 1) {
      throw controlledSelectionUnavailable(
        matches.length === 0
          ? 'APPLICABILITY_HOST_TARGET_NOT_FOUND'
          : 'APPLICABILITY_HOST_TARGET_AMBIGUOUS',
        matches.length === 0 ? 409 : 503,
      );
    }
    if (
      !fleetMasterData.sourceSnapshotId?.trim() ||
      !fleetMasterData.sourceRevisionKey?.trim() ||
      !fleetMasterData.authorityRevision?.trim() ||
      !isIsoDate(fleetMasterData.sourceAsOf ?? '') ||
      fleetMasterData.sourceAsOf! > assessmentAsOf
    ) {
      throw controlledSelectionUnavailable(
        'APPLICABILITY_HOST_TARGET_FLEET_CURRENTNESS_INVALID',
        409,
      );
    }
    return this.withConfigurationEvidence(input, {
      schemaVersion: 'wiselink.3_1.controlled_applicability_selection.v1',
      selectionRevision: [
        'host-target',
        workItem.workItemId,
        workItem.source.documentVersionId,
        aircraftNumber,
        assessmentAsOf,
        fleetMasterData.sourceRevisionKey,
        fleetMasterData.authorityRevision,
      ].join(':'),
      currentness: 'CURRENT',
      documentVersionId: workItem.source.documentVersionId,
      aircraftNumber,
      assessmentAsOf,
      fleetMasterData,
    });
  }

  private async withConfigurationEvidence(
    input: { tenantId: string; workItemId: string },
    selection: CanonicalApplicabilityControlledSelection,
  ): Promise<CanonicalApplicabilityControlledSelection> {
    const current = await this.configurationEvidence.readCurrent({
      tenantId: input.tenantId,
      workItemId: input.workItemId,
    });
    if (!current) return selection;
    const fleetMasterData = overlayConfigurationEvidence(
      selection.fleetMasterData,
      current,
      selection.assessmentAsOf,
    );
    return {
      ...selection,
      selectionRevision: [
        selection.selectionRevision,
        'configuration-evidence',
        current.summary.snapshotId,
        String(current.summary.configurationRevision),
      ].join(':'),
      fleetMasterData,
    };
  }
}

function overlayConfigurationEvidence(
  source: FleetMasterDataSource,
  current: PersistedConfigurationEvidenceSnapshot,
  assessmentAsOf: string,
): FleetMasterDataSource {
  const asset = source.assets.find(
    (candidate) => candidate.assetId === current.snapshot.aircraftAssetId,
  );
  if (!asset || current.snapshot.assessmentAsOf.slice(0, 10) > assessmentAsOf) {
    throw controlledSelectionUnavailable(
      'CONFIGURATION_EVIDENCE_SELECTION_BINDING_INVALID',
      409,
    );
  }
  const facts = current.snapshot.facts
    .map((fact: ConfigurationSnapshotFact) =>
      configurationFleetFact(current, fact),
    )
    .filter(
      (fact): fact is NonNullable<ReturnType<typeof configurationFleetFact>> =>
        fact !== null,
    );
  return {
    ...structuredClone(source),
    facts: [...structuredClone(source.facts), ...facts],
  };
}

function configurationFleetFact(
  current: PersistedConfigurationEvidenceSnapshot,
  fact: ConfigurationSnapshotFact,
): FleetMasterDataSource['facts'][number] | null {
  if (
    fact.authority !== 'CONTROLLED_SOURCE' ||
    fact.status !== 'SUPPORTED' ||
    (fact.truth !== 'TRUE' && fact.truth !== 'FALSE')
  ) {
    return null;
  }
  const mapped = configurationProperty(fact);
  if (!mapped) return null;
  const value: boolean = fact.truth === 'TRUE';
  return {
    factId: `CONFIGURATION:${current.summary.snapshotId}:${fact.factAssertionId}`,
    assetId: fact.aircraftAssetId,
    factType: 'fleet_configuration',
    property: mapped.property,
    qualifier: mapped.qualifier,
    value,
    validAsOf: fact.assessmentAsOf.slice(0, 10),
    sourceRef: {
      sourceTable: 'configuration_evidence_snapshot_version',
      sourceRecordId: current.summary.snapshotId,
      sourceField: fact.factAssertionId,
    },
    recordHash: canonicalSha256({
      snapshotId: current.summary.snapshotId,
      configurationRevision: current.summary.configurationRevision,
      factAssertionId: fact.factAssertionId,
      aircraftAssetId: fact.aircraftAssetId,
      property: mapped.property,
      qualifier: mapped.qualifier,
      value,
      assessmentAsOf: fact.assessmentAsOf,
      supportingEvidenceRecordIds: fact.supportingEvidenceRecordIds,
    }),
  };
}

function configurationProperty(
  fact: ConfigurationSnapshotFact,
): { property: string; qualifier: string } | null {
  if (fact.target.kind === 'COMPONENT') {
    return {
      property: 'equipmentNumberInstalled',
      qualifier: fact.target.componentId,
    };
  }
  if (fact.target.kind === 'EQUIPMENT') {
    return {
      property: 'equipmentModelInstalled',
      qualifier: fact.target.equipmentKey,
    };
  }
  if (fact.target.kind === 'SOFTWARE') {
    return {
      property: 'softwarePartNumberInstalled',
      qualifier: fact.target.softwareKey,
    };
  }
  if (fact.target.kind === 'MODIFICATION') {
    return {
      property: 'modificationEmbodied',
      qualifier: fact.target.modificationId,
    };
  }
  if (fact.target.kind === 'REPAIR') {
    return { property: 'repairPresent', qualifier: fact.target.repairId };
  }
  return null;
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

function optionalSelection(
  workItem: CanonicalWorkItemProjection,
): CanonicalApplicabilityControlledSelectionProjection | null {
  const selection = workItem.applicabilityControlledSelection;
  if (!selection) return null;
  if (
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

function normalizeAircraftIdentifier(value: string | undefined): string {
  return value?.trim().toUpperCase() ?? '';
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
