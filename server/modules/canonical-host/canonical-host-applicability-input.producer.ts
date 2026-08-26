import { Inject, Injectable } from '@nestjs/common';

import type {
  CanonicalApplicabilityInputProjection,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import { canonicalSha256 } from '../action-attempt/action-attempt-envelope';
import {
  FLEET_MASTER_DATA_SCHEMA_VERSION,
  type FleetMasterDataSource,
} from '../assessment-workbench/applicability-fleet/fleetMasterData';
import { getRegistry } from '../assessment-workbench/applicability-fleet/applicabilityPropertyRegistry';
import { UNIFIED_ARTIFACT_STORE } from '../unified-reader/unified-reader.constants';
import { UnifiedReaderService } from '../unified-reader/unified-reader.service';
import type { UnifiedArtifactStorePort } from '../unified-reader/unified-reader.types';
import { readFrozenApplicabilitySourceBinding } from './canonical-host-applicability-source';
import {
  CANONICAL_APPLICABILITY_CONTROLLED_SELECTION,
  CANONICAL_WORK_ITEM_REGISTRAR,
} from './canonical-host.constants';
import type { CanonicalWorkItemRegistrarPort } from './canonical-host.types';
import {
  CANONICAL_SERVICE_SCOPE_AUTHORIZATION,
  type CanonicalServiceScopeAuthorizationPort,
  type CanonicalVerifiedApplicabilityContextScope,
} from './canonical-service-scope.authorization';

const CANONICAL_APP_ID = 'app_17bzc551rsg';

export interface CanonicalApplicabilityControlledSelection {
  schemaVersion: 'wiselink.3_1.controlled_applicability_selection.v1';
  selectionRevision: string;
  currentness: 'CURRENT' | 'STALE' | 'CONFLICT' | 'UNVERIFIED';
  documentVersionId: string;
  aircraftNumber: string;
  assessmentAsOf: string;
  fleetMasterData: CanonicalApplicabilityInputProjection['fleetMasterData'];
}

/** Server-private owner port; no MCP/REST/client business payload reaches it. */
export interface CanonicalApplicabilityControlledSelectionPort {
  readCurrent(input: {
    tenantId: string;
    workItemId: string;
    documentVersionId: string;
    applicabilityContextRef: string;
  }): Promise<CanonicalApplicabilityControlledSelection>;
}

@Injectable()
export class UnavailableCanonicalApplicabilityControlledSelection implements CanonicalApplicabilityControlledSelectionPort {
  readCurrent(): Promise<CanonicalApplicabilityControlledSelection> {
    return Promise.reject(
      Object.assign(
        new Error('APPLICABILITY_CONTROLLED_SELECTION_UNAVAILABLE'),
        {
          code: 'APPLICABILITY_CONTROLLED_SELECTION_UNAVAILABLE',
          statusCode: 503,
        },
      ),
    );
  }
}

/**
 * Host-owned producer/resolver for the existing WorkItem projection_json.
 * The external call supplies only an opaque authorized context + idempotent
 * request. Aircraft/asOf/Fleet are read from the server-private owner port.
 */
@Injectable()
export class CanonicalHostApplicabilityInputProducer {
  constructor(
    @Inject(CANONICAL_WORK_ITEM_REGISTRAR)
    private readonly registrar: CanonicalWorkItemRegistrarPort,
    @Inject(UNIFIED_ARTIFACT_STORE)
    private readonly artifactStore: UnifiedArtifactStorePort,
    private readonly reader: UnifiedReaderService,
    @Inject(CANONICAL_SERVICE_SCOPE_AUTHORIZATION)
    private readonly serviceScope: CanonicalServiceScopeAuthorizationPort,
    @Inject(CANONICAL_APPLICABILITY_CONTROLLED_SELECTION)
    private readonly controlledSelection: CanonicalApplicabilityControlledSelectionPort,
  ) {}

  async produce(
    applicabilityContextRef: string,
    requestId: string,
  ): Promise<CanonicalWorkItemProjection> {
    const scope = await this.serviceScope.authorizeOpenClawApplicabilityContext(
      {
        operation: 'BEGIN_APPLICABILITY',
        applicabilityContextRef,
        requestId,
      },
    );
    assertScope(scope, applicabilityContextRef, requestId);
    return this.produceAuthorized(scope);
  }

  /** Host-internal entry after the caller's opaque context was authorized. */
  async produceAuthorized(
    scope: CanonicalVerifiedApplicabilityContextScope,
  ): Promise<CanonicalWorkItemProjection> {
    const workItem = await this.requiredParsedWorkItem(scope);
    const selection = await this.controlledSelection.readCurrent({
      tenantId: scope.tenantId,
      workItemId: workItem.workItemId,
      documentVersionId: workItem.source.documentVersionId,
      applicabilityContextRef: scope.applicabilityContextRef,
    });
    const sourceBinding = await this.readSourceBinding(workItem);
    const projection = deriveProjection({
      workItem,
      applicabilityContextRef: scope.applicabilityContextRef,
      selection,
      targetBindingHash: sourceBinding.targetBindingHash,
    });
    if (
      workItem.applicabilityInput &&
      canonicalSha256(workItem.applicabilityInput) ===
        canonicalSha256(projection)
    ) {
      return workItem;
    }
    return this.registrar.compareAndSet({
      workItemId: workItem.workItemId,
      expectedRevision: workItem.revision,
      syncPrimaryAttempt: false,
      next: {
        ...withoutRevision(workItem),
        applicabilityInput: projection,
        applicability: staleApplicability(workItem, projection),
      },
    });
  }

  async resolveCurrent(
    scope: Pick<
      CanonicalVerifiedApplicabilityContextScope,
      'tenantId' | 'workItemId' | 'applicabilityContextRef'
    >,
  ): Promise<{
    workItem: CanonicalWorkItemProjection;
    applicabilityInput: CanonicalApplicabilityInputProjection;
  }> {
    const workItem = await this.requiredParsedWorkItem(scope);
    const sourceBinding = await this.readSourceBinding(workItem);
    const applicabilityInput = requiredApplicabilityInput({
      workItem,
      applicabilityContextRef: scope.applicabilityContextRef,
      targetBindingHash: sourceBinding.targetBindingHash,
    });
    return { workItem, applicabilityInput };
  }

  private async readSourceBinding(workItem: CanonicalWorkItemProjection) {
    const sourceUnits = await this.reader.readAllSourceUnits({
      artifact: workItem.package!.artifact,
      packageId: workItem.package!.packageId,
    });
    if (
      sourceUnits.length === 0 ||
      sourceUnits.length !== workItem.package!.contentUnitCount
    ) {
      throw new Error('APPLICABILITY_SOURCE_UNIT_COUNT_MISMATCH');
    }
    const bytes = await this.artifactStore.readActualBytes(
      workItem.package!.artifact,
    );
    return readFrozenApplicabilitySourceBinding({
      bytes,
      workItem,
      sourceUnits,
    });
  }

  private async requiredParsedWorkItem(
    scope: Pick<
      CanonicalVerifiedApplicabilityContextScope,
      'tenantId' | 'workItemId'
    >,
  ): Promise<CanonicalWorkItemProjection> {
    const workItem = await this.registrar.getTenantScopedByWorkItemId({
      workItemId: scope.workItemId,
      tenantId: scope.tenantId,
    });
    if (
      workItem.phase !== 'CANDIDATE_READBACK_VERIFIED' ||
      !workItem.package ||
      workItem.package.contractId !== 'techpub.parsed-package.v1' ||
      workItem.package.contractRevision !== 'frozen.2'
    ) {
      throw new Error('APPLICABILITY_FROZEN2_PACKAGE_REQUIRED');
    }
    return workItem;
  }
}

function deriveProjection(input: {
  workItem: CanonicalWorkItemProjection;
  applicabilityContextRef: string;
  selection: CanonicalApplicabilityControlledSelection;
  targetBindingHash: string;
}): CanonicalApplicabilityInputProjection {
  const selection = input.selection;
  if (
    selection.schemaVersion !==
      'wiselink.3_1.controlled_applicability_selection.v1' ||
    selection.currentness !== 'CURRENT' ||
    !selection.selectionRevision.trim() ||
    selection.documentVersionId !== input.workItem.source.documentVersionId ||
    !selection.aircraftNumber.trim() ||
    !isIsoDate(selection.assessmentAsOf) ||
    selection.fleetMasterData.schemaVersion !== FLEET_MASTER_DATA_SCHEMA_VERSION
  ) {
    throw new Error('APPLICABILITY_CONTROLLED_SELECTION_INVALID');
  }
  const fleet = selectControlledFleet(
    selection.fleetMasterData as FleetMasterDataSource,
    selection.aircraftNumber,
    selection.assessmentAsOf,
  );
  const base = {
    schemaVersion: 'wiselink.3_1.applicability_input_projection.v1' as const,
    applicabilityContextRef: input.applicabilityContextRef,
    workItemId: input.workItem.workItemId,
    documentVersionId: input.workItem.source.documentVersionId,
    sourcePackageId: input.workItem.package!.packageId,
    sourcePackageContentHash: input.workItem.package!.contentHash,
    sourcePackageArtifactSha256: input.workItem.package!.artifact.sha256,
    targetBindingHash: input.targetBindingHash,
    selectionRevision: selection.selectionRevision,
    currentness: 'CURRENT' as const,
    aircraftNumber: selection.aircraftNumber,
    assessmentAsOf: selection.assessmentAsOf,
    fleetMasterData: fleet,
  };
  return {
    ...base,
    bindingRevision: `host-applicability:${canonicalSha256(base)}`,
  };
}

function requiredApplicabilityInput(input: {
  workItem: CanonicalWorkItemProjection;
  applicabilityContextRef: string;
  targetBindingHash: string;
}): CanonicalApplicabilityInputProjection {
  const value = input.workItem.applicabilityInput;
  if (
    !value ||
    value.schemaVersion !== 'wiselink.3_1.applicability_input_projection.v1' ||
    value.applicabilityContextRef !== input.applicabilityContextRef ||
    value.workItemId !== input.workItem.workItemId ||
    value.documentVersionId !== input.workItem.source.documentVersionId ||
    value.sourcePackageId !== input.workItem.package!.packageId ||
    value.sourcePackageContentHash !== input.workItem.package!.contentHash ||
    value.sourcePackageArtifactSha256 !==
      input.workItem.package!.artifact.sha256 ||
    value.targetBindingHash !== input.targetBindingHash ||
    !value.selectionRevision.trim() ||
    !value.bindingRevision.trim() ||
    value.currentness !== 'CURRENT' ||
    !value.aircraftNumber.trim() ||
    !isIsoDate(value.assessmentAsOf) ||
    value.fleetMasterData.schemaVersion !== FLEET_MASTER_DATA_SCHEMA_VERSION
  ) {
    throw scopeNotFound();
  }
  const { bindingRevision: _bindingRevision, ...base } = value;
  if (value.bindingRevision !== `host-applicability:${canonicalSha256(base)}`) {
    throw new Error('APPLICABILITY_INPUT_BINDING_REVISION_INVALID');
  }
  selectControlledFleet(
    value.fleetMasterData as FleetMasterDataSource,
    value.aircraftNumber,
    value.assessmentAsOf,
  );
  return structuredClone(value);
}

function selectControlledFleet(
  source: FleetMasterDataSource,
  aircraftNumber: string,
  assessmentAsOf: string,
): CanonicalApplicabilityInputProjection['fleetMasterData'] {
  if (
    source.schemaVersion !== FLEET_MASTER_DATA_SCHEMA_VERSION ||
    !source.sourceSnapshotId?.trim() ||
    !source.sourceRevisionKey?.trim() ||
    !source.authorityRevision?.trim() ||
    !source.sourceAsOf ||
    !isIsoDate(source.sourceAsOf) ||
    source.sourceAsOf > assessmentAsOf ||
    !Array.isArray(source.assets) ||
    !Array.isArray(source.facts)
  ) {
    throw new Error('APPLICABILITY_FLEET_SOURCE_CURRENTNESS_INVALID');
  }
  const target = normalizeAircraftNumber(aircraftNumber);
  const assets = source.assets.filter(
    (asset) =>
      normalizeAircraftNumber(asset.aircraftNumber) === target ||
      (asset.aliases ?? []).some(
        (alias) => normalizeAircraftNumber(alias.aliasValue) === target,
      ),
  );
  if (assets.length > 1) {
    throw new Error('APPLICABILITY_FLEET_AIRCRAFT_AMBIGUOUS');
  }
  for (const asset of assets) assertAsset(asset);
  const assetId = assets[0]?.assetId ?? null;
  const supportedProperties = new Set(
    getRegistry().properties.map((definition) => definition.property),
  );
  const facts = assetId
    ? source.facts.filter(
        (fact) =>
          fact.assetId === assetId &&
          supportedProperties.has(fact.property) &&
          (!fact.validAsOf || fact.validAsOf <= assessmentAsOf),
      )
    : [];
  for (const fact of facts) assertFact(fact);
  return {
    schemaVersion: FLEET_MASTER_DATA_SCHEMA_VERSION,
    sourceSnapshotId: source.sourceSnapshotId,
    sourceRevisionKey: source.sourceRevisionKey,
    authorityRevision: source.authorityRevision,
    sourceAsOf: source.sourceAsOf,
    assets: structuredClone(assets),
    facts: structuredClone(facts),
  };
}

function assertAsset(asset: FleetMasterDataSource['assets'][number]): void {
  if (
    !asset.assetId?.trim() ||
    !asset.assetVersionId?.trim() ||
    !asset.aircraftNumber?.trim() ||
    !asset.recordHash?.trim() ||
    !asset.sourceRef?.sourceTable?.trim() ||
    !asset.sourceRef.sourceRecordId?.trim()
  ) {
    throw new Error('APPLICABILITY_FLEET_ASSET_INVALID');
  }
}

function assertFact(fact: FleetMasterDataSource['facts'][number]): void {
  if (
    !fact.factId?.trim() ||
    !fact.assetId?.trim() ||
    !fact.property?.trim() ||
    !fact.recordHash?.trim() ||
    (fact.validAsOf != null && !isIsoDate(fact.validAsOf)) ||
    !fact.sourceRef?.sourceTable?.trim() ||
    !fact.sourceRef.sourceRecordId?.trim()
  ) {
    throw new Error('APPLICABILITY_FLEET_FACT_INVALID');
  }
}

function staleApplicability(
  workItem: CanonicalWorkItemProjection,
  next: CanonicalApplicabilityInputProjection,
): CanonicalWorkItemProjection['applicability'] {
  const current = workItem.applicability;
  if (!current || current.currentness !== 'CURRENT') return current ?? null;
  const previous = workItem.applicabilityInput;
  const staleReason =
    !previous ||
    previous.sourcePackageArtifactSha256 !== next.sourcePackageArtifactSha256 ||
    previous.targetBindingHash !== next.targetBindingHash
      ? 'SOURCE_CHANGED'
      : previous.aircraftNumber !== next.aircraftNumber ||
          previous.assessmentAsOf !== next.assessmentAsOf
        ? 'AIRCRAFT_SELECTION_CHANGED'
        : 'FLEET_FACTS_CHANGED';
  return {
    ...current,
    status: 'STALE',
    currentness: 'STALE',
    staleReason,
  };
}

function assertScope(
  scope: CanonicalVerifiedApplicabilityContextScope,
  applicabilityContextRef: string,
  requestId: string,
): void {
  if (
    scope.appId !== CANONICAL_APP_ID ||
    scope.applicabilityContextRef !== applicabilityContextRef ||
    scope.requestId !== requestId ||
    !scope.workItemId.trim() ||
    !scope.tenantId.trim() ||
    !scope.principalId.trim() ||
    !scope.authorizationFingerprint.trim()
  ) {
    throw scopeNotFound();
  }
}

function normalizeAircraftNumber(value: string): string {
  return value.trim().toUpperCase();
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
  );
}

function withoutRevision(
  workItem: CanonicalWorkItemProjection,
): Omit<CanonicalWorkItemProjection, 'revision'> {
  const { revision: _revision, ...rest } = workItem;
  return rest;
}

function scopeNotFound(): Error & { code: string; statusCode: number } {
  return Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {
    code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
    statusCode: 404,
  });
}
