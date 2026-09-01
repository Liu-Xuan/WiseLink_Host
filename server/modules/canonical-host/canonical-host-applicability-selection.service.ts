import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import type {
  CanonicalApplicabilityControlledSelectionProjection,
  CanonicalApplicabilitySelectionReadModel,
  CanonicalWorkItemProjection,
  ConfigureCanonicalApplicabilitySelectionRequest,
} from '@shared/api.interface';
import type { FleetMasterDataSource } from '../assessment-workbench/applicability-fleet/fleetMasterData';
import { SessionResolver } from '../identity/session-resolver.service';
import type { ResolvedSession } from '../identity/session-resolver.service';
import {
  CANONICAL_OBJECT_ACCESS,
  type CanonicalObjectAccessGrant,
  type CanonicalObjectAccessPort,
} from '../work-item/canonical-object-access.port';
import { CANONICAL_WORK_ITEM_REGISTRAR } from './canonical-host.constants';
import type { CanonicalWorkItemRegistrarPort } from './canonical-host.types';
import { CanonicalFleetMasterDataRepository } from './canonical-fleet-master-data.repository';
import { selectionMatchesFleet } from './miaoda-applicability-controlled-selection.adapter';

@Injectable()
export class CanonicalHostApplicabilitySelectionService {
  constructor(
    private readonly sessions: SessionResolver,
    @Inject(CANONICAL_OBJECT_ACCESS)
    private readonly objectAccess: CanonicalObjectAccessPort,
    @Inject(CANONICAL_WORK_ITEM_REGISTRAR)
    private readonly registrar: CanonicalWorkItemRegistrarPort,
    private readonly fleetRepository: CanonicalFleetMasterDataRepository,
  ) {}

  async read(
    workItemId: string,
    request: Request,
  ): Promise<CanonicalApplicabilitySelectionReadModel> {
    const session = await this.requireSession(request);
    const grant = await this.authorize(session, workItemId, 'READ_WORK_ITEM');
    const workItem = await this.freshWorkItem(session, grant);
    const selection = requiredSelection(workItem);
    const fleet = await this.fleetRepository.readCurrentForAircraft({
      tenantId: session.actor.tenantId,
      aircraftIdentifier: selection.aircraftIdentifier,
      asOf: selection.asOf,
    });
    return readModel(workItem, selection, fleet);
  }

  async configure(
    workItemId: string,
    input: ConfigureCanonicalApplicabilitySelectionRequest,
    request: Request,
  ): Promise<CanonicalApplicabilitySelectionReadModel> {
    // Deliberately not exposed by the initial-analysis browser controller.
    // This mutation boundary is retained for a future accepted ReviewAction
    // adapter, where conversational engineer input is authenticated, reviewed,
    // and CAS-bound before it can alter the Host-owned evaluation target.
    const session = await this.requireSession(request);
    const grant = await this.authorize(
      session,
      workItemId,
      'CONFIGURE_APPLICABILITY_SELECTION',
    );
    const workItem = await this.freshWorkItem(session, grant);
    assertParsedWorkItem(workItem);
    const aircraftIdentifier = normalizeAircraftIdentifier(
      input.aircraftIdentifier,
    );
    const asOf = requiredIsoDate(input.asOf);
    const fleet = await this.fleetRepository.readCurrentForAircraft({
      tenantId: session.actor.tenantId,
      aircraftIdentifier,
      asOf,
    });
    assertControlledAircraft(fleet, aircraftIdentifier);
    if (!fleet.sourceAsOf || fleet.sourceAsOf > asOf) {
      throw conflict('APPLICABILITY_FLEET_SOURCE_AS_OF_AFTER_SELECTION');
    }

    const current = workItem.applicabilityControlledSelection;
    if (
      current &&
      validSelection(current, workItem) &&
      current.aircraftIdentifier === aircraftIdentifier &&
      current.asOf === asOf &&
      selectionMatchesFleet(current, fleet)
    ) {
      return readModel(workItem, current, fleet);
    }

    const nextRevision = workItem.revision + 1;
    const selection: CanonicalApplicabilityControlledSelectionProjection = {
      schemaVersion: 'wiselink.3_1.controlled_applicability_selection.v1',
      selectionRevision:
        `work-item:${workItem.workItemId}:applicability-selection:` +
        String(nextRevision),
      currentness: 'CURRENT',
      documentVersionId: workItem.source.documentVersionId,
      aircraftIdentifier,
      asOf,
      fleetSourceSnapshotId: fleet.sourceSnapshotId!,
      fleetSourceRevisionKey: fleet.sourceRevisionKey!,
      fleetAuthorityRevision: fleet.authorityRevision!,
      fleetSourceAsOf: fleet.sourceAsOf,
    };
    const updated = await this.registrar.compareAndSet({
      workItemId: workItem.workItemId,
      expectedRevision: workItem.revision,
      syncPrimaryAttempt: false,
      next: {
        ...withoutRevision(workItem),
        applicabilityControlledSelection: selection,
        applicabilityInput: staleInput(workItem),
        applicability: staleCandidate(workItem, selection),
      },
    });
    if (
      updated.revision !== nextRevision ||
      updated.applicabilityControlledSelection?.selectionRevision !==
        selection.selectionRevision
    ) {
      throw new Error('APPLICABILITY_SELECTION_READBACK_INVALID');
    }
    return readModel(updated, selection, fleet);
  }

  private async requireSession(request: Request): Promise<ResolvedSession> {
    const session = await this.sessions.resolve(request);
    if (session) return session;
    throw Object.assign(new Error('SESSION_REQUIRED'), {
      code: 'SESSION_REQUIRED',
      statusCode: 401,
    });
  }

  private async authorize(
    session: ResolvedSession,
    workItemId: string,
    action: 'READ_WORK_ITEM' | 'CONFIGURE_APPLICABILITY_SELECTION',
  ): Promise<CanonicalObjectAccessGrant> {
    const result = await this.objectAccess.freshRead({
      actor: session.actor,
      action,
      accessRoot: { kind: 'WORK_ITEM', id: workItemId },
    });
    if (result.allowed === false) {
      throw Object.assign(new Error(result.code), {
        code: result.code,
        statusCode: result.statusCode,
      });
    }
    if (
      result.action !== action ||
      result.workItemId !== workItemId ||
      result.tenantId !== session.actor.tenantId ||
      result.actorUserId !== session.actor.canonicalSubject.id
    ) {
      throw notFound();
    }
    return result;
  }

  private async freshWorkItem(
    session: ResolvedSession,
    grant: CanonicalObjectAccessGrant,
  ): Promise<CanonicalWorkItemProjection> {
    const workItem = await this.registrar.getTenantScopedByWorkItemId({
      tenantId: session.actor.tenantId,
      workItemId: grant.workItemId,
    });
    if (
      workItem.workItemId !== grant.workItemId ||
      workItem.revision !== grant.workItemRevision ||
      workItem.source.documentVersionId !== grant.documentVersionId
    ) {
      throw conflict('CANONICAL_WORK_ITEM_REVISION_MISMATCH');
    }
    return workItem;
  }
}

function readModel(
  workItem: CanonicalWorkItemProjection,
  selection: CanonicalApplicabilityControlledSelectionProjection,
  fleet: FleetMasterDataSource,
): CanonicalApplicabilitySelectionReadModel {
  const applicability = workItem.package?.usagePolicy?.applicability;
  const sourceExpressionCount = applicability?.sourceExpressionCount ?? 0;
  const assignmentCount = applicability?.assignmentCount ?? 0;
  const sourceReady =
    sourceExpressionCount > 0 && assignmentCount === sourceExpressionCount;
  return {
    schemaVersion: 'wiselink.3_1.applicability_selection_read_model.v1',
    workItemId: workItem.workItemId,
    workItemRevision: workItem.revision,
    documentVersionId: workItem.source.documentVersionId,
    aircraftIdentifier: selection.aircraftIdentifier,
    asOf: selection.asOf,
    selectionRevision: selection.selectionRevision,
    currentness: selectionMatchesFleet(selection, fleet) ? 'CURRENT' : 'STALE',
    fleetSource: {
      sourceRevisionKey: fleet.sourceRevisionKey!,
      authorityRevision: fleet.authorityRevision!,
      sourceAsOf: fleet.sourceAsOf!,
    },
    frozenSourceBinding: {
      status: sourceReady ? 'READY' : 'MISSING',
      sourceExpressionCount,
      assignmentCount,
    },
  };
}

function assertParsedWorkItem(workItem: CanonicalWorkItemProjection): void {
  if (
    workItem.phase !== 'CANDIDATE_READBACK_VERIFIED' ||
    !workItem.package ||
    workItem.package.contractId !== 'techpub.parsed-package.v1' ||
    workItem.package.contractRevision !== 'frozen.2'
  ) {
    throw conflict('APPLICABILITY_FROZEN2_PACKAGE_REQUIRED');
  }
}

function assertControlledAircraft(
  fleet: FleetMasterDataSource,
  aircraftIdentifier: string,
): void {
  const matches = fleet.assets.filter(
    (asset) =>
      normalizeAircraftIdentifier(asset.aircraftNumber) ===
        aircraftIdentifier ||
      (asset.aliases ?? []).some(
        (alias) =>
          normalizeAircraftIdentifier(alias.aliasValue) === aircraftIdentifier,
      ),
  );
  if (matches.length === 0) {
    throw badRequest('APPLICABILITY_AIRCRAFT_IDENTIFIER_NOT_CONTROLLED');
  }
  if (matches.length > 1) {
    throw conflict('APPLICABILITY_FLEET_AIRCRAFT_AMBIGUOUS');
  }
}

function requiredSelection(
  workItem: CanonicalWorkItemProjection,
): CanonicalApplicabilityControlledSelectionProjection {
  const selection = workItem.applicabilityControlledSelection;
  if (!selection || !validSelection(selection, workItem)) {
    throw conflict('APPLICABILITY_CONTROLLED_SELECTION_NOT_CONFIGURED');
  }
  return selection;
}

function validSelection(
  selection: CanonicalApplicabilityControlledSelectionProjection,
  workItem: CanonicalWorkItemProjection,
): boolean {
  return (
    selection.schemaVersion ===
      'wiselink.3_1.controlled_applicability_selection.v1' &&
    selection.currentness === 'CURRENT' &&
    selection.documentVersionId === workItem.source.documentVersionId &&
    Boolean(selection.selectionRevision.trim()) &&
    Boolean(selection.aircraftIdentifier.trim()) &&
    isIsoDate(selection.asOf) &&
    Boolean(selection.fleetSourceSnapshotId.trim()) &&
    Boolean(selection.fleetSourceRevisionKey.trim()) &&
    Boolean(selection.fleetAuthorityRevision.trim()) &&
    isIsoDate(selection.fleetSourceAsOf)
  );
}

function staleInput(
  workItem: CanonicalWorkItemProjection,
): CanonicalWorkItemProjection['applicabilityInput'] {
  if (!workItem.applicabilityInput) return null;
  return { ...workItem.applicabilityInput, currentness: 'STALE' };
}

function staleCandidate(
  workItem: CanonicalWorkItemProjection,
  next: CanonicalApplicabilityControlledSelectionProjection,
): CanonicalWorkItemProjection['applicability'] {
  const current = workItem.applicability;
  if (!current || current.currentness !== 'CURRENT') return current ?? null;
  const previous = workItem.applicabilityControlledSelection;
  const staleReason =
    !previous ||
    previous.aircraftIdentifier !== next.aircraftIdentifier ||
    previous.asOf !== next.asOf
      ? 'AIRCRAFT_SELECTION_CHANGED'
      : 'FLEET_FACTS_CHANGED';
  return {
    ...current,
    status: 'STALE',
    currentness: 'STALE',
    staleReason,
  };
}

function normalizeAircraftIdentifier(value: string): string {
  if (typeof value !== 'string') {
    throw badRequest('APPLICABILITY_AIRCRAFT_IDENTIFIER_INVALID');
  }
  const normalized = value.trim().toUpperCase();
  if (!normalized || normalized.length > 64) {
    throw badRequest('APPLICABILITY_AIRCRAFT_IDENTIFIER_INVALID');
  }
  return normalized;
}

function requiredIsoDate(value: string): string {
  if (typeof value !== 'string' || !isIsoDate(value)) {
    throw badRequest('APPLICABILITY_AS_OF_INVALID');
  }
  return value;
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

function notFound(): Error & { code: string; statusCode: number } {
  return Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {
    code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
    statusCode: 404,
  });
}

function conflict(code: string): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 409 });
}

function badRequest(
  code: string,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 400 });
}
