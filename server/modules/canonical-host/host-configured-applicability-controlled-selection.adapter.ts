import { Inject, Injectable } from '@nestjs/common';

import type {
  CanonicalApplicabilityControlledSelectionProjection,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import {
  FLEET_MASTER_DATA_SCHEMA_VERSION,
  type FleetMasterDataAssetRecord,
  type FleetMasterDataFactRecord,
  type FleetMasterDataSource,
  type FleetSourceRef,
} from '../assessment-workbench/applicability-fleet/fleetMasterData';
import { CANONICAL_WORK_ITEM_REGISTRAR } from './canonical-host.constants';
import type {
  CanonicalApplicabilityControlledSelection,
  CanonicalApplicabilityControlledSelectionPort,
} from './canonical-host-applicability-input.producer';
import type { CanonicalWorkItemRegistrarPort } from './canonical-host.types';

export const CANONICAL_FLEET_MASTER_DATA_ENV =
  'WL_CANONICAL_FLEET_MASTER_DATA_JSON';

/**
 * Reads the one Host-controlled FleetMasterData source from deployment
 * configuration. It is a configuration adapter, not another evaluator or
 * persistence layer. Request bodies, MCP arguments and model output never
 * reach this source.
 */
@Injectable()
export class CanonicalHostFleetMasterDataConfiguration {
  readCurrent(): FleetMasterDataSource {
    return parseFleetMasterDataConfiguration(
      process.env[CANONICAL_FLEET_MASTER_DATA_ENV],
    );
  }
}

/** Production owner for CANONICAL_APPLICABILITY_CONTROLLED_SELECTION. */
@Injectable()
export class HostConfiguredApplicabilityControlledSelectionAdapter implements CanonicalApplicabilityControlledSelectionPort {
  constructor(
    @Inject(CANONICAL_WORK_ITEM_REGISTRAR)
    private readonly registrar: CanonicalWorkItemRegistrarPort,
    private readonly fleetConfiguration: CanonicalHostFleetMasterDataConfiguration,
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
    const workItem = await this.registrar.getTenantScopedByWorkItemId({
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
    const selection = requiredSelection(workItem);
    const fleetMasterData = this.fleetConfiguration.readCurrent();
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

export function parseFleetMasterDataConfiguration(
  raw: string | undefined,
): FleetMasterDataSource {
  if (!raw?.trim()) {
    throw fleetConfigurationError('APPLICABILITY_FLEET_CONFIGURATION_MISSING');
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw fleetConfigurationError('APPLICABILITY_FLEET_CONFIGURATION_INVALID');
  }
  try {
    const source = record(value);
    if (source.schemaVersion !== FLEET_MASTER_DATA_SCHEMA_VERSION) {
      throw new Error('schemaVersion');
    }
    const sourceAsOf = requiredIsoDate(source.sourceAsOf);
    return {
      schemaVersion: FLEET_MASTER_DATA_SCHEMA_VERSION,
      sourceSnapshotId: requiredText(source.sourceSnapshotId),
      sourceRevisionKey: requiredText(source.sourceRevisionKey),
      authorityRevision: requiredText(source.authorityRevision),
      sourceAsOf,
      assets: array(source.assets).map(
        (item: unknown): FleetMasterDataAssetRecord => parseAsset(item),
      ),
      facts: array(source.facts).map(
        (item: unknown): FleetMasterDataFactRecord => parseFact(item),
      ),
    };
  } catch {
    throw fleetConfigurationError('APPLICABILITY_FLEET_CONFIGURATION_INVALID');
  }
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

function parseAsset(value: unknown): FleetMasterDataAssetRecord {
  const asset = record(value);
  return {
    assetId: requiredText(asset.assetId),
    assetVersionId: requiredText(asset.assetVersionId),
    aircraftNumber: requiredText(asset.aircraftNumber),
    aliases: optionalArray(asset.aliases).map((item: unknown) => ({
      aliasValue: requiredText(record(item).aliasValue),
    })),
    fleetFamily: optionalText(asset.fleetFamily),
    aircraftModel: optionalText(asset.aircraftModel),
    series: optionalText(asset.series),
    msn: optionalText(asset.msn),
    lineNumber: optionalInteger(asset.lineNumber),
    deliveryDate: optionalIsoDate(asset.deliveryDate),
    sourceRef: parseSourceRef(asset.sourceRef),
    recordHash: requiredText(asset.recordHash),
  };
}

function parseFact(value: unknown): FleetMasterDataFactRecord {
  const fact = record(value);
  const factType = requiredText(fact.factType);
  if (
    !['fleet_configuration', 'sb_incorporation', 'data_quality_issue'].includes(
      factType,
    )
  ) {
    throw new Error('factType');
  }
  return {
    factId: requiredText(fact.factId),
    assetId: requiredText(fact.assetId),
    factType: factType as FleetMasterDataFactRecord['factType'],
    property: requiredText(fact.property),
    qualifier: optionalText(fact.qualifier),
    value: structuredClone(fact.value),
    validAsOf: optionalIsoDate(fact.validAsOf),
    sourceRef: parseSourceRef(fact.sourceRef),
    recordHash: requiredText(fact.recordHash),
  };
}

function parseSourceRef(value: unknown): FleetSourceRef {
  const sourceRef = record(value);
  return {
    sourceTable: requiredText(sourceRef.sourceTable),
    sourceRecordId: requiredText(sourceRef.sourceRecordId),
    sourceField: optionalText(sourceRef.sourceField),
  };
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('record');
  }
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('array');
  return value;
}

function optionalArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return array(value);
}

function requiredText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('text');
  return value.trim();
}

function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return requiredText(value);
}

function optionalInteger(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value)) throw new Error('integer');
  return Number(value);
}

function requiredIsoDate(value: unknown): string {
  const date = requiredText(value);
  if (!isIsoDate(date)) throw new Error('date');
  return date;
}

function optionalIsoDate(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return requiredIsoDate(value);
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
  );
}

function fleetConfigurationError(
  code: string,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 503 });
}

function controlledSelectionUnavailable(
  code: string,
  statusCode: number,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode });
}
