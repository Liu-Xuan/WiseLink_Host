import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

import type {
  CanonicalApplicabilityControlledSelectionProjection,
  CanonicalApplicabilitySelectionReadModel,
  CanonicalApplicabilitySelectionReviewAvailability,
  CanonicalApplicabilitySelectionReviewDraft,
  CanonicalWorkItemProjection,
  ConfirmCanonicalApplicabilitySelectionRequest,
  ConfigureCanonicalApplicabilitySelectionRequest,
  PreviewCanonicalApplicabilitySelectionRequest,
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

  async reviewAvailability(
    workItemId: string,
    request: Request,
  ): Promise<CanonicalApplicabilitySelectionReviewAvailability> {
    const session = await this.requireSession(request);
    const grant = await this.authorize(session, workItemId,
      'CONFIGURE_APPLICABILITY_SELECTION');
    await this.freshWorkItem(session, grant);
    return { enabled: reviewActionEnabledFor(workItemId) };
  }

  async previewReviewAction(
    workItemId: string,
    input: PreviewCanonicalApplicabilitySelectionRequest,
    request: Request,
  ): Promise<CanonicalApplicabilitySelectionReviewDraft> {
    const session = await this.requireSession(request);
    const grant = await this.authorize(
      session, workItemId, 'CONFIGURE_APPLICABILITY_SELECTION',
    );
    const workItem = await this.freshWorkItem(session, grant);
    requireReviewActionEnabled(workItemId);
    assertParsedWorkItem(workItem);
    if (input.expectedWorkItemRevision !== workItem.revision)
      throw conflict('CANONICAL_WORK_ITEM_REVISION_MISMATCH');
    const aircraftIdentifier = normalizeAircraftIdentifier(input.aircraftIdentifier);
    const asOf = requiredIsoDate(input.asOf);
    const fleet = await this.checkedFleet(session.actor.tenantId, aircraftIdentifier, asOf);
    const current = workItem.applicabilityControlledSelection;
    if (current && validSelection(current, workItem) &&
      current.aircraftIdentifier === aircraftIdentifier && current.asOf === asOf &&
      selectionMatchesFleet(current, fleet))
      throw conflict('APPLICABILITY_SELECTION_ALREADY_CURRENT');
    return reviewDraft(workItem, aircraftIdentifier, asOf, fleet,
      session.actor.tenantId, session.actor.canonicalSubject.id);
  }

  async confirmReviewAction(
    workItemId: string,
    input: ConfirmCanonicalApplicabilitySelectionRequest,
    request: Request,
  ): Promise<CanonicalApplicabilitySelectionReadModel> {
    const session = await this.requireSession(request);
    const grant = await this.authorize(
      session, workItemId, 'CONFIGURE_APPLICABILITY_SELECTION',
    );
    const workItem = await this.freshWorkItem(session, grant);
    requireReviewActionEnabled(workItemId);
    if (input.confirmed !== true) throw badRequest('APPLICABILITY_SELECTION_CONFIRMATION_REQUIRED');
    assertParsedWorkItem(workItem);
    const draft = input.draft;
    if (draft.schemaVersion !== 'wiselink.3_1.applicability_selection_review_draft.v1' ||
      draft.workItemId !== workItemId ||
      draft.documentVersionId !== workItem.source.documentVersionId ||
      draft.expectedWorkItemRevision !== workItem.revision)
      throw conflict('APPLICABILITY_SELECTION_REVIEW_DRAFT_STALE');
    assertReviewDraftSignature(draft, session.actor.tenantId,
      session.actor.canonicalSubject.id);
    const aircraftIdentifier = normalizeAircraftIdentifier(draft.aircraftIdentifier);
    const asOf = requiredIsoDate(draft.asOf);
    const fleet = await this.checkedFleet(session.actor.tenantId, aircraftIdentifier, asOf);
    if (!sameFleetSource(draft.fleetSource, fleet))
      throw conflict('APPLICABILITY_SELECTION_REVIEW_DRAFT_STALE');
    await this.persistSelection(workItem, fleet, aircraftIdentifier, asOf,
      session.actor.canonicalSubject.id);
    const readback = await this.read(workItemId, request);
    if (readback.workItemRevision !== draft.expectedWorkItemRevision + 1 ||
      readback.documentVersionId !== draft.documentVersionId ||
      readback.aircraftIdentifier !== aircraftIdentifier || readback.asOf !== asOf ||
      readback.fleetSource.snapshotId !== draft.fleetSource.snapshotId ||
      readback.fleetSource.sourceRevisionKey !== draft.fleetSource.sourceRevisionKey ||
      readback.fleetSource.authorityRevision !== draft.fleetSource.authorityRevision ||
      readback.fleetSource.sourceAsOf !== draft.fleetSource.sourceAsOf ||
      readback.currentness !== 'CURRENT')
      throw conflict('APPLICABILITY_SELECTION_CONFIRM_READBACK_INVALID');
    return readback;
  }

  async configure(
    workItemId: string,
    input: ConfigureCanonicalApplicabilitySelectionRequest,
    request: Request,
  ): Promise<CanonicalApplicabilitySelectionReadModel> {
    // Internal legacy call path; no controller exposes this as a bare write.
    // Browser confirmation uses the signed preview path above.
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
    const fleet = await this.checkedFleet(session.actor.tenantId, aircraftIdentifier, asOf);
    return this.persistSelection(workItem, fleet, aircraftIdentifier, asOf);
  }

  private async checkedFleet(
    tenantId: string,
    aircraftIdentifier: string,
    asOf: string,
  ): Promise<FleetMasterDataSource> {
    const fleet = await this.fleetRepository.readCurrentForAircraft({
      tenantId, aircraftIdentifier, asOf,
    });
    assertControlledAircraft(fleet, aircraftIdentifier);
    if (!fleet.sourceSnapshotId?.trim() || !fleet.sourceRevisionKey?.trim() ||
      !fleet.authorityRevision?.trim() || !isIsoDate(fleet.sourceAsOf ?? '') ||
      fleet.sourceAsOf! > asOf)
      throw conflict('APPLICABILITY_FLEET_SOURCE_AS_OF_AFTER_SELECTION');
    return fleet;
  }

  private async persistSelection(
    workItem: CanonicalWorkItemProjection,
    fleet: FleetMasterDataSource,
    aircraftIdentifier: string,
    asOf: string,
    confirmedByActorUserId?: string,
  ): Promise<CanonicalApplicabilitySelectionReadModel> {
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
      ...(confirmedByActorUserId ? { reviewAction: {
        action: 'CONFIRM_APPLICABILITY_SELECTION' as const,
        actorUserId: confirmedByActorUserId,
        confirmedAt: new Date().toISOString(),
        expectedWorkItemRevision: workItem.revision,
      } } : {}),
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

function reviewActionEnabledFor(workItemId: string): boolean {
  if (process.env.WL_APPLICABILITY_SELECTION_REVIEW_ACTION_ENABLED !== '1')
    return false;
  const raw = process.env.WL_OPENCLAW_SERVICE_ADDITIONAL_WORK_ITEM_IDS;
  if (!raw) throw conflict('APPLICABILITY_SELECTION_REVIEW_SCOPE_UNAVAILABLE');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw conflict('APPLICABILITY_SELECTION_REVIEW_SCOPE_UNAVAILABLE'); }
  if (!Array.isArray(parsed) || parsed.length !== 1 ||
    typeof parsed[0] !== 'string' ||
    !/^WI-[A-Za-z0-9_-]{1,93}$/u.test(parsed[0]) ||
    !process.env.WL_OPENCLAW_SERVICE_WORK_ITEM_ID?.startsWith('WI-') ||
    parsed[0] === process.env.WL_OPENCLAW_SERVICE_WORK_ITEM_ID)
    throw conflict('APPLICABILITY_SELECTION_REVIEW_SCOPE_UNAVAILABLE');
  if (parsed[0] !== workItemId) return false;
  reviewSigningKey();
  return true;
}

function reviewSigningKey(): string {
  const key = process.env.WL_APPLICABILITY_SELECTION_REVIEW_SIGNING_KEY;
  if (!key || key.length < 32)
    throw conflict('APPLICABILITY_SELECTION_REVIEW_SIGNING_KEY_UNAVAILABLE');
  return key;
}

function requireReviewActionEnabled(workItemId: string): void {
  if (!reviewActionEnabledFor(workItemId)) throw notFound();
}

function reviewDraft(
  workItem: CanonicalWorkItemProjection,
  aircraftIdentifier: string,
  asOf: string,
  fleet: FleetMasterDataSource,
  tenantId: string,
  actorUserId: string,
): CanonicalApplicabilitySelectionReviewDraft {
  const unsigned: Omit<CanonicalApplicabilitySelectionReviewDraft,
    'confirmationToken'> = {
    schemaVersion: 'wiselink.3_1.applicability_selection_review_draft.v1',
    workItemId: workItem.workItemId,
    documentVersionId: workItem.source.documentVersionId,
    expectedWorkItemRevision: workItem.revision,
    aircraftIdentifier,
    asOf,
    fleetSource: {
      snapshotId: fleet.sourceSnapshotId!,
      sourceRevisionKey: fleet.sourceRevisionKey!,
      authorityRevision: fleet.authorityRevision!,
      sourceAsOf: fleet.sourceAsOf!,
    },
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
  return { ...unsigned,
    confirmationToken: signReviewDraft(unsigned, tenantId, actorUserId),
  };
}

function signReviewDraft(
  draft: Omit<CanonicalApplicabilitySelectionReviewDraft, 'confirmationToken'>,
  tenantId: string,
  actorUserId: string,
): string {
  return createHmac('sha256', reviewSigningKey()).update(JSON.stringify([
    'applicability-selection-review.v1', tenantId, actorUserId,
    draft.schemaVersion, draft.workItemId, draft.documentVersionId,
    draft.expectedWorkItemRevision, draft.aircraftIdentifier, draft.asOf,
    draft.fleetSource.snapshotId, draft.fleetSource.sourceRevisionKey,
    draft.fleetSource.authorityRevision, draft.fleetSource.sourceAsOf,
    draft.expiresAt,
  ])).digest('hex');
}

function assertReviewDraftSignature(
  draft: CanonicalApplicabilitySelectionReviewDraft,
  tenantId: string,
  actorUserId: string,
): void {
  if (!Number.isFinite(Date.parse(draft.expiresAt)) ||
    Date.parse(draft.expiresAt) <= Date.now() ||
    !/^[a-f0-9]{64}$/u.test(draft.confirmationToken))
    throw conflict('APPLICABILITY_SELECTION_REVIEW_DRAFT_STALE');
  const expected = Buffer.from(signReviewDraft(draft, tenantId, actorUserId), 'hex');
  const supplied = Buffer.from(draft.confirmationToken, 'hex');
  if (!timingSafeEqual(expected, supplied))
    throw conflict('APPLICABILITY_SELECTION_REVIEW_DRAFT_STALE');
}

function sameFleetSource(
  source: CanonicalApplicabilitySelectionReviewDraft['fleetSource'],
  fleet: FleetMasterDataSource,
): boolean {
  return Boolean(source && source.snapshotId === fleet.sourceSnapshotId &&
    source.sourceRevisionKey === fleet.sourceRevisionKey &&
    source.authorityRevision === fleet.authorityRevision &&
    source.sourceAsOf === fleet.sourceAsOf);
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
      snapshotId: fleet.sourceSnapshotId!,
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
