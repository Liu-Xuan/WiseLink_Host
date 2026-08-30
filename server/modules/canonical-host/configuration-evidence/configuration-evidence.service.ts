import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import { SessionResolver } from '../../identity/session-resolver.service';
import type { ResolvedSession } from '../../identity/session-resolver.service';
import {
  CANONICAL_OBJECT_ACCESS,
  type CanonicalObjectAccessGrant,
  type CanonicalObjectAccessPort,
} from '../../work-item/canonical-object-access.port';
import { CanonicalFleetMasterDataRepository } from '../canonical-fleet-master-data.repository';
import {
  CANONICAL_HOST_CLOCK,
  CANONICAL_WORK_ITEM_REGISTRAR,
} from '../canonical-host.constants';
import type {
  CanonicalHostClockPort,
  CanonicalWorkItemRegistrarPort,
} from '../canonical-host.types';
import {
  configurationTargetKey,
  mapConfigurationSnapshot,
} from './configuration-snapshot.mapper';
import type { ConfigurationSnapshot } from './configuration-snapshot.types';
import {
  CONFIGURATION_EVIDENCE_READ_AUTHORITY,
  CONFIGURATION_EVIDENCE_STORE,
  type ConfigurationEvidenceCurrentReadModel,
  type ConfigurationEvidenceReplayRead,
  type ConfigurationEvidenceRefreshResponse,
  type ConfigurationEvidenceSnapshotReadResponse,
  type ConfigurationEvidenceStorePort,
  type PersistedConfigurationEvidenceSnapshot,
  type RefreshConfigurationEvidenceRequest,
  type ResolvedConfigurationEvidenceRequest,
} from './configuration-evidence.persistence.types';
import {
  GET_INSTALLATION_EVENTS,
  type ConfigurationEvidenceTarget,
  type GetInstallationEventsPort,
  type GetInstallationEventsQuery,
  type GetInstallationEventsResult,
} from './get-installation-events.port';
import { mapInstallationEventEvidence } from './installation-event-evidence.mapper';
import type { InstallationEventEvidenceProjection } from './installation-event-evidence.types';

const MAX_TARGETS = 16;
const HISTORY_LIMIT = 20;

interface AuthorizedConfigurationAccess {
  session: ResolvedSession;
  grant: CanonicalObjectAccessGrant;
  workItem: CanonicalWorkItemProjection;
}

@Injectable()
export class ConfigurationEvidenceService {
  constructor(
    private readonly sessions: SessionResolver,
    @Inject(CANONICAL_OBJECT_ACCESS)
    private readonly objectAccess: CanonicalObjectAccessPort,
    @Inject(CANONICAL_WORK_ITEM_REGISTRAR)
    private readonly registrar: CanonicalWorkItemRegistrarPort,
    private readonly fleet: CanonicalFleetMasterDataRepository,
    @Inject(GET_INSTALLATION_EVENTS)
    private readonly installationEvents: GetInstallationEventsPort,
    @Inject(CONFIGURATION_EVIDENCE_STORE)
    private readonly store: ConfigurationEvidenceStorePort,
    @Inject(CANONICAL_HOST_CLOCK)
    private readonly clock: CanonicalHostClockPort,
  ) {}

  async refresh(
    workItemIdValue: string,
    body: unknown,
    httpRequest: Request,
  ): Promise<ConfigurationEvidenceRefreshResponse> {
    const workItemId: string = requiredIdentifier(
      workItemIdValue,
      'CONFIGURATION_EVIDENCE_WORK_ITEM_ID_INVALID',
    );
    const request: RefreshConfigurationEvidenceRequest = refreshRequest(body);
    const authorized: AuthorizedConfigurationAccess =
      await this.authorizeAndLoad(
        workItemId,
        'REFRESH_CONFIGURATION_EVIDENCE',
        httpRequest,
      );
    const existing: ConfigurationEvidenceReplayRead | null =
      await this.store.findByRequest({
        tenantId: authorized.grant.tenantId,
        workItemId,
        requestId: request.requestId,
      });
    if (existing) {
      assertSameRefreshIntent(existing.persisted.request, request);
      assertReplayReadBinding(authorized, existing);
      return refreshResponse(
        workItemId,
        existing.workItem.revision,
        true,
        existing.persisted,
      );
    }
    if (
      request.expectedRevision !== authorized.workItem.revision ||
      request.expectedRevision !== authorized.grant.workItemRevision
    ) {
      throw configurationConflict('WORK_ITEM_CAS_CONFLICT');
    }
    if (!this.installationEvents.configured) {
      throw configurationUnavailable(
        'GET_INSTALLATION_EVENTS_SOURCE_NOT_CONFIGURED',
      );
    }

    const fleet = await this.fleet.readCurrentForAircraft({
      tenantId: authorized.grant.tenantId,
      aircraftIdentifier: request.aircraftIdentifier,
      asOf: request.assessmentAsOf.slice(0, 10),
    });
    if (fleet.assets.length !== 1) {
      throw configurationConflict(
        fleet.assets.length === 0
          ? 'CONFIGURATION_EVIDENCE_AIRCRAFT_NOT_FOUND'
          : 'CONFIGURATION_EVIDENCE_AIRCRAFT_AMBIGUOUS',
      );
    }
    const asset = fleet.assets[0];
    const resolved: ResolvedConfigurationEvidenceRequest = {
      ...request,
      aircraft: {
        assetId: requiredIdentifier(
          asset.assetId,
          'CONFIGURATION_EVIDENCE_ASSET_ID_INVALID',
        ),
        aircraftNumber: requiredIdentifier(
          asset.aircraftNumber,
          'CONFIGURATION_EVIDENCE_AIRCRAFT_NUMBER_INVALID',
        ),
        msn: nullableIdentifier(asset.msn),
        lineNumber: nullableNonNegativeInteger(asset.lineNumber),
      },
    };
    const queries: GetInstallationEventsQuery[] = resolved.targets.map(
      (target: ConfigurationEvidenceTarget): GetInstallationEventsQuery => ({
        schemaVersion:
          'wiselink.3_1.get_installation_events_query.v0.candidate',
        aircraft: structuredClone(resolved.aircraft),
        target: structuredClone(target),
        windowStart: resolved.windowStart,
        assessmentAsOf: resolved.assessmentAsOf,
      }),
    );
    const results: GetInstallationEventsResult[] = await Promise.all(
      queries.map((query: GetInstallationEventsQuery) =>
        this.installationEvents.getInstallationEvents(query),
      ),
    );
    const projections: InstallationEventEvidenceProjection[] = queries.map(
      (
        query: GetInstallationEventsQuery,
        index: number,
      ): InstallationEventEvidenceProjection =>
        mapInstallationEventEvidence({ query, result: results[index] }),
    );
    const snapshot: ConfigurationSnapshot = mapConfigurationSnapshot({
      aircraftAssetId: resolved.aircraft.assetId,
      assessmentAsOf: resolved.assessmentAsOf,
      projections,
    });
    const committed = await this.store.commit({
      tenantId: authorized.grant.tenantId,
      actorId: authorized.grant.actorUserId,
      workItemId,
      expectedWorkItemRevision: request.expectedRevision,
      request: resolved,
      projections,
      snapshot,
      recordedAt: this.clock.nowIso(),
    });
    assertCommittedCurrent(committed.workItem, committed.persisted);
    return refreshResponse(
      workItemId,
      committed.workItem.revision,
      committed.replayed,
      committed.persisted,
    );
  }

  async current(
    workItemIdValue: string,
    httpRequest: Request,
  ): Promise<ConfigurationEvidenceCurrentReadModel> {
    const workItemId: string = requiredIdentifier(
      workItemIdValue,
      'CONFIGURATION_EVIDENCE_WORK_ITEM_ID_INVALID',
    );
    const authorized: AuthorizedConfigurationAccess =
      await this.authorizeAndLoad(
        workItemId,
        'READ_CONFIGURATION_EVIDENCE',
        httpRequest,
      );
    const [current, history] = await Promise.all([
      this.store.readCurrent({
        tenantId: authorized.grant.tenantId,
        workItemId,
      }),
      this.store.listHistory({
        tenantId: authorized.grant.tenantId,
        workItemId,
        limit: HISTORY_LIMIT,
      }),
    ]);
    assertReadCurrentBinding(authorized.workItem, current);
    return {
      schemaVersion: 'wiselink.3_1.configuration_evidence_history.v1',
      workItemId,
      workItemRevision: authorized.workItem.revision,
      status: current ? 'AVAILABLE' : 'EMPTY',
      current,
      history,
      authority: structuredClone(CONFIGURATION_EVIDENCE_READ_AUTHORITY),
    };
  }

  async snapshot(
    workItemIdValue: string,
    snapshotIdValue: string,
    httpRequest: Request,
  ): Promise<ConfigurationEvidenceSnapshotReadResponse> {
    const workItemId: string = requiredIdentifier(
      workItemIdValue,
      'CONFIGURATION_EVIDENCE_WORK_ITEM_ID_INVALID',
    );
    const snapshotId: string = requiredIdentifier(
      snapshotIdValue,
      'CONFIGURATION_EVIDENCE_SNAPSHOT_ID_INVALID',
      160,
    );
    const authorized: AuthorizedConfigurationAccess =
      await this.authorizeAndLoad(
        workItemId,
        'READ_CONFIGURATION_EVIDENCE',
        httpRequest,
      );
    const persisted = await this.store.readSnapshot({
      tenantId: authorized.grant.tenantId,
      workItemId,
      snapshotId,
    });
    if (!persisted) throw configurationNotFound();
    return {
      schemaVersion: 'wiselink.3_1.configuration_evidence_snapshot_read.v1',
      workItemId,
      workItemRevision: authorized.workItem.revision,
      persisted,
      authority: structuredClone(CONFIGURATION_EVIDENCE_READ_AUTHORITY),
    };
  }

  private async authorizeAndLoad(
    workItemId: string,
    action: 'READ_CONFIGURATION_EVIDENCE' | 'REFRESH_CONFIGURATION_EVIDENCE',
    httpRequest: Request,
  ): Promise<AuthorizedConfigurationAccess> {
    const session: ResolvedSession | null =
      await this.sessions.resolve(httpRequest);
    if (!session) throw sessionRequired();
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
    const workItem = await this.registrar.getTenantScopedByWorkItemId({
      workItemId,
      tenantId: result.tenantId,
    });
    if (
      result.action !== action ||
      result.workItemId !== workItemId ||
      result.tenantId !== session.actor.tenantId ||
      result.actorUserId !== session.actor.canonicalSubject.id ||
      result.workItemRevision !== workItem.revision ||
      result.requestId !== workItem.requestId ||
      result.documentVersionId !== workItem.source.documentVersionId
    ) {
      throw configurationNotFound();
    }
    return { session, grant: result, workItem };
  }
}

function refreshRequest(body: unknown): RefreshConfigurationEvidenceRequest {
  const value: Record<string, unknown> = objectBody(body);
  strictKeys(value, [
    'schemaVersion',
    'requestId',
    'expectedRevision',
    'aircraftIdentifier',
    'assessmentAsOf',
    'windowStart',
    'targets',
  ]);
  if (
    value.schemaVersion !== 'wiselink.3_1.refresh_configuration_evidence.v1'
  ) {
    throw configurationBadRequest(
      'CONFIGURATION_EVIDENCE_SCHEMA_VERSION_INVALID',
    );
  }
  if (!Number.isSafeInteger(value.expectedRevision)) {
    throw configurationBadRequest(
      'CONFIGURATION_EVIDENCE_EXPECTED_REVISION_INVALID',
    );
  }
  const expectedRevision: number = Number(value.expectedRevision);
  if (expectedRevision < 1) {
    throw configurationBadRequest(
      'CONFIGURATION_EVIDENCE_EXPECTED_REVISION_INVALID',
    );
  }
  const assessmentAsOf: string = requiredIsoDateTime(
    value.assessmentAsOf,
    'CONFIGURATION_EVIDENCE_AS_OF_INVALID',
  );
  const windowStart: string | null =
    value.windowStart === null
      ? null
      : requiredIsoDateTime(
          value.windowStart,
          'CONFIGURATION_EVIDENCE_WINDOW_START_INVALID',
        );
  if (windowStart !== null && windowStart > assessmentAsOf) {
    throw configurationBadRequest(
      'CONFIGURATION_EVIDENCE_WINDOW_START_INVALID',
    );
  }
  if (
    !Array.isArray(value.targets) ||
    value.targets.length < 1 ||
    value.targets.length > MAX_TARGETS
  ) {
    throw configurationBadRequest('CONFIGURATION_EVIDENCE_TARGETS_INVALID');
  }
  const targets: ConfigurationEvidenceTarget[] = value.targets
    .map(configurationTarget)
    .sort(
      (left: ConfigurationEvidenceTarget, right: ConfigurationEvidenceTarget) =>
        configurationTargetKey(left).localeCompare(
          configurationTargetKey(right),
        ),
    );
  const targetKeys: string[] = targets.map(configurationTargetKey);
  if (new Set<string>(targetKeys).size !== targetKeys.length) {
    throw configurationBadRequest('CONFIGURATION_EVIDENCE_DUPLICATE_TARGET');
  }
  return {
    schemaVersion: 'wiselink.3_1.refresh_configuration_evidence.v1',
    requestId: requiredIdentifier(
      value.requestId,
      'CONFIGURATION_EVIDENCE_REQUEST_ID_INVALID',
    ),
    expectedRevision,
    aircraftIdentifier: requiredIdentifier(
      value.aircraftIdentifier,
      'CONFIGURATION_EVIDENCE_AIRCRAFT_IDENTIFIER_INVALID',
      128,
    ),
    assessmentAsOf,
    windowStart,
    targets,
  };
}

function configurationTarget(value: unknown): ConfigurationEvidenceTarget {
  const target: Record<string, unknown> = objectBody(value);
  const kind: string = requiredIdentifier(
    target.kind,
    'CONFIGURATION_EVIDENCE_TARGET_KIND_INVALID',
    32,
  );
  if (kind === 'COMPONENT') {
    strictKeys(target, ['kind', 'componentId', 'positionId']);
    return {
      kind,
      componentId: requiredIdentifier(
        target.componentId,
        'CONFIGURATION_EVIDENCE_COMPONENT_ID_INVALID',
        160,
      ),
      positionId: optionalIdentifier(target.positionId, 160),
    };
  }
  if (kind === 'EQUIPMENT') {
    strictKeys(target, ['kind', 'equipmentKey', 'positionId']);
    return {
      kind,
      equipmentKey: requiredIdentifier(
        target.equipmentKey,
        'CONFIGURATION_EVIDENCE_EQUIPMENT_KEY_INVALID',
        160,
      ),
      positionId: optionalIdentifier(target.positionId, 160),
    };
  }
  if (kind === 'SOFTWARE') {
    strictKeys(target, [
      'kind',
      'softwareKey',
      'targetComponentId',
      'positionId',
    ]);
    return {
      kind,
      softwareKey: requiredIdentifier(
        target.softwareKey,
        'CONFIGURATION_EVIDENCE_SOFTWARE_KEY_INVALID',
        160,
      ),
      targetComponentId: optionalIdentifier(target.targetComponentId, 160),
      positionId: optionalIdentifier(target.positionId, 160),
    };
  }
  if (kind === 'MODIFICATION') {
    strictKeys(target, ['kind', 'modificationId']);
    return {
      kind,
      modificationId: requiredIdentifier(
        target.modificationId,
        'CONFIGURATION_EVIDENCE_MODIFICATION_ID_INVALID',
        160,
      ),
    };
  }
  if (kind === 'REPAIR') {
    strictKeys(target, ['kind', 'repairId']);
    return {
      kind,
      repairId: requiredIdentifier(
        target.repairId,
        'CONFIGURATION_EVIDENCE_REPAIR_ID_INVALID',
        160,
      ),
    };
  }
  throw configurationBadRequest('CONFIGURATION_EVIDENCE_TARGET_KIND_INVALID');
}

function assertSameRefreshIntent(
  stored: ResolvedConfigurationEvidenceRequest,
  incoming: RefreshConfigurationEvidenceRequest,
): void {
  const storedIntent: RefreshConfigurationEvidenceRequest = {
    schemaVersion: stored.schemaVersion,
    requestId: stored.requestId,
    expectedRevision: stored.expectedRevision,
    aircraftIdentifier: stored.aircraftIdentifier,
    assessmentAsOf: stored.assessmentAsOf,
    windowStart: stored.windowStart,
    targets: structuredClone(stored.targets),
  };
  if (JSON.stringify(storedIntent) !== JSON.stringify(incoming)) {
    throw configurationConflict(
      'CONFIGURATION_EVIDENCE_IDEMPOTENCY_PAYLOAD_MISMATCH',
    );
  }
}

function assertReplayReadBinding(
  authorized: AuthorizedConfigurationAccess,
  replay: ConfigurationEvidenceReplayRead,
): void {
  const pointer = replay.workItem.configurationEvidenceCurrent ?? null;
  const replayedIsCurrent = replay.persisted.summary.isCurrent;
  if (
    replay.workItem.workItemId !== authorized.grant.workItemId ||
    replay.workItem.requestId !== authorized.grant.requestId ||
    replay.workItem.source.documentVersionId !==
      authorized.grant.documentVersionId ||
    (replayedIsCurrent &&
      (!pointer ||
        pointer.snapshotId !== replay.persisted.summary.snapshotId ||
        pointer.configurationRevision !==
          replay.persisted.summary.configurationRevision)) ||
    (!replayedIsCurrent &&
      pointer?.snapshotId === replay.persisted.summary.snapshotId)
  ) {
    throw configurationUnavailable(
      'CONFIGURATION_EVIDENCE_REPLAY_READBACK_INVALID',
    );
  }
}

function assertCommittedCurrent(
  workItem: CanonicalWorkItemProjection,
  persisted: PersistedConfigurationEvidenceSnapshot,
): void {
  const pointer = workItem.configurationEvidenceCurrent;
  if (
    !persisted.summary.isCurrent ||
    !pointer ||
    pointer.snapshotId !== persisted.summary.snapshotId ||
    pointer.configurationRevision !== persisted.summary.configurationRevision ||
    pointer.globalAircraftCurrentChanged !== false
  ) {
    throw configurationUnavailable(
      'CONFIGURATION_EVIDENCE_CURRENT_READBACK_INVALID',
    );
  }
}

function assertReadCurrentBinding(
  workItem: CanonicalWorkItemProjection,
  current: PersistedConfigurationEvidenceSnapshot | null,
): void {
  const pointer = workItem.configurationEvidenceCurrent ?? null;
  if (!pointer && !current) return;
  if (
    !pointer ||
    !current ||
    pointer.snapshotId !== current.summary.snapshotId ||
    pointer.configurationRevision !== current.summary.configurationRevision ||
    current.summary.isCurrent !== true
  ) {
    throw configurationUnavailable(
      'CONFIGURATION_EVIDENCE_CURRENT_READBACK_INVALID',
    );
  }
}

function refreshResponse(
  workItemId: string,
  workItemRevision: number,
  replayed: boolean,
  persisted: PersistedConfigurationEvidenceSnapshot,
): ConfigurationEvidenceRefreshResponse {
  return {
    schemaVersion: 'wiselink.3_1.configuration_evidence_refresh_response.v1',
    workItemId,
    workItemRevision,
    replayed,
    persisted,
    authority: structuredClone(CONFIGURATION_EVIDENCE_READ_AUTHORITY),
  };
}

function objectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw configurationBadRequest('CONFIGURATION_EVIDENCE_BODY_INVALID');
  }
  return body as Record<string, unknown>;
}

function strictKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw configurationBadRequest(
        `CONFIGURATION_EVIDENCE_UNKNOWN_FIELD:${key}`,
      );
    }
  }
}

function optionalIdentifier(value: unknown, maxLength: number): string | null {
  return value === null
    ? null
    : requiredIdentifier(
        value,
        'CONFIGURATION_EVIDENCE_TARGET_IDENTIFIER_INVALID',
        maxLength,
      );
}

function nullableIdentifier(value: string | null): string | null {
  return value === null
    ? null
    : requiredIdentifier(
        value,
        'CONFIGURATION_EVIDENCE_FLEET_IDENTITY_INVALID',
        160,
      );
}

function nullableNonNegativeInteger(value: number | null): number | null {
  if (value !== null && (!Number.isSafeInteger(value) || Number(value) < 0)) {
    throw configurationUnavailable(
      'CONFIGURATION_EVIDENCE_FLEET_IDENTITY_INVALID',
    );
  }
  return value;
}

function requiredIdentifier(
  value: unknown,
  code: string,
  maxLength: number = 96,
): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim() !== value ||
    value.length > maxLength ||
    value.includes('\u0000')
  ) {
    throw configurationBadRequest(code);
  }
  return value;
}

function requiredIsoDateTime(value: unknown, code: string): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.]\d{3}Z$/u.test(value)
  ) {
    throw configurationBadRequest(code);
  }
  const parsed: number = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw configurationBadRequest(code);
  }
  return value;
}

function sessionRequired(): Error & { code: string; statusCode: number } {
  return Object.assign(new Error('A valid OAuth session is required.'), {
    code: 'SESSION_REQUIRED',
    statusCode: 401,
  });
}

function configurationBadRequest(
  code: string,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 400 });
}

function configurationConflict(
  code: string,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 409 });
}

function configurationNotFound(): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error('CONFIGURATION_EVIDENCE_NOT_FOUND'), {
    code: 'CONFIGURATION_EVIDENCE_NOT_FOUND',
    statusCode: 404,
  });
}

function configurationUnavailable(
  code: string,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 503 });
}
