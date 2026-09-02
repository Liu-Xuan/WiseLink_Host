import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import type {
  CanonicalAssessmentGapMateriality,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import { canonicalSha256 } from '../../action-attempt/action-attempt-envelope';
import { SessionResolver } from '../../identity/session-resolver.service';
import type { ResolvedSession } from '../../identity/session-resolver.service';
import {
  CANONICAL_OBJECT_ACCESS,
  type CanonicalObjectAccessGrant,
  type CanonicalObjectAccessPort,
} from '../../work-item/canonical-object-access.port';
import { CanonicalFleetMasterDataRepository } from '../canonical-fleet-master-data.repository';
import { CanonicalHostEngineerReviewService } from '../canonical-host-engineer-review.service';
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
  CONFIGURATION_EVIDENCE_QUERY_AUTHORITY,
  CONFIGURATION_EVIDENCE_QUERY_STORE,
  CONFIGURATION_EVIDENCE_STORE,
  type ConfigurationEvidenceAdoptionResponse,
  type ConfigurationEvidenceCapabilityGrant,
  type ConfigurationEvidenceCurrentReadModel,
  type ConfigurationEvidenceQueryAttemptReadModel,
  type ConfigurationEvidenceQueryResponse,
  type ConfigurationEvidenceQueryStorePort,
  type ConfigurationEvidenceQueryTerminalStatus,
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
  type GetInstallationEventsFailureCode,
  type GetInstallationEventsQuery,
  type GetInstallationEventsResult,
} from './get-installation-events.port';
import { mapInstallationEventEvidence } from './installation-event-evidence.mapper';
import type { InstallationEventEvidenceProjection } from './installation-event-evidence.types';

const MAX_TARGETS = 5;
const HISTORY_LIMIT = 20;
const QUERY_DEADLINE_MS = 60_000;

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
    private readonly engineerReview: CanonicalHostEngineerReviewService,
    @Inject(GET_INSTALLATION_EVENTS)
    private readonly installationEvents: GetInstallationEventsPort,
    @Inject(CONFIGURATION_EVIDENCE_STORE)
    private readonly store: ConfigurationEvidenceStorePort,
    @Inject(CONFIGURATION_EVIDENCE_QUERY_STORE)
    private readonly queryStore: ConfigurationEvidenceQueryStorePort,
    @Inject(CANONICAL_HOST_CLOCK)
    private readonly clock: CanonicalHostClockPort,
  ) {}

  async query(
    workItemIdValue: string,
    body: unknown,
    httpRequest: Request,
  ): Promise<ConfigurationEvidenceQueryResponse> {
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
    const replay = await this.queryStore.findByRequest({
      tenantId: authorized.grant.tenantId,
      workItemId,
      requestId: request.requestId,
    });
    if (replay) {
      assertSameRefreshIntent(replay.request, request);
      return queryResponse(
        workItemId,
        authorized.workItem.revision,
        true,
        replay,
      );
    }
    assertExpectedRevision(authorized, request.expectedRevision);

    const resolved: ResolvedConfigurationEvidenceRequest =
      await this.resolveRequest(authorized, request);
    const queryFingerprint: string = canonicalSha256({
      workItemId,
      inputRevision: resolved.expectedRevision,
      aircraftAssetId: resolved.aircraft.assetId,
      assessmentAsOf: resolved.assessmentAsOf,
      windowStart: resolved.windowStart,
      gapRefs: resolved.gapRefs,
      capabilityGrantRef: resolved.capabilityGrant.grantRef,
      targets: resolved.targets,
    });
    const startedAt: string = this.clock.nowIso();
    const reserved = await this.queryStore.reserve({
      tenantId: authorized.grant.tenantId,
      actorId: authorized.grant.actorUserId,
      workItemId,
      request: resolved,
      queryAttemptRef: `EQ-${request.requestId}`,
      candidateEvidenceRef: `CE-${request.requestId}`,
      queryFingerprint,
      startedAt,
      deadlineAt: new Date(
        Date.parse(startedAt) + QUERY_DEADLINE_MS,
      ).toISOString(),
    });
    if (reserved.replayed || reserved.attempt.terminalStatus !== 'RUNNING') {
      return queryResponse(
        workItemId,
        authorized.workItem.revision,
        true,
        reserved.attempt,
      );
    }

    const queries: GetInstallationEventsQuery[] = installationQueries(resolved);
    const results: GetInstallationEventsResult[] = [];
    for (const sourceQuery of queries) {
      results.push(await this.executeQuery(sourceQuery));
    }
    const projections: InstallationEventEvidenceProjection[] = queries.map(
      (sourceQuery: GetInstallationEventsQuery, index: number) =>
        mapInstallationEventEvidence({
          query: sourceQuery,
          result: results[index],
        }),
    );
    const candidateSnapshot: ConfigurationSnapshot = mapConfigurationSnapshot({
      aircraftAssetId: resolved.aircraft.assetId,
      assessmentAsOf: resolved.assessmentAsOf,
      projections,
    });
    const completed = await this.queryStore.complete({
      tenantId: authorized.grant.tenantId,
      actorId: authorized.grant.actorUserId,
      workItemId,
      queryAttemptRef: reserved.attempt.queryAttemptRef,
      terminalStatus: terminalQueryStatus(results, candidateSnapshot),
      projections,
      candidateSnapshot,
      sourceRecordCount: results.reduce(
        (total: number, result: GetInstallationEventsResult) =>
          total + result.records.length,
        0,
      ),
      completedAt: this.clock.nowIso(),
    });
    return queryResponse(
      workItemId,
      authorized.workItem.revision,
      false,
      completed,
    );
  }

  async queryStatus(
    workItemIdValue: string,
    queryAttemptRefValue: string,
    httpRequest: Request,
  ): Promise<ConfigurationEvidenceQueryResponse> {
    const workItemId: string = requiredIdentifier(
      workItemIdValue,
      'CONFIGURATION_EVIDENCE_WORK_ITEM_ID_INVALID',
    );
    const queryAttemptRef: string = requiredIdentifier(
      queryAttemptRefValue,
      'CONFIGURATION_EVIDENCE_QUERY_ATTEMPT_REF_INVALID',
      160,
    );
    const authorized = await this.authorizeAndLoad(
      workItemId,
      'READ_CONFIGURATION_EVIDENCE',
      httpRequest,
    );
    const candidate = await this.queryStore.findByQueryAttemptRef({
      tenantId: authorized.grant.tenantId,
      workItemId,
      queryAttemptRef,
    });
    if (!candidate) throw configurationNotFound();
    return queryResponse(
      workItemId,
      authorized.workItem.revision,
      true,
      candidate,
    );
  }

  async adopt(
    workItemIdValue: string,
    candidateEvidenceRefValue: string,
    body: unknown,
    httpRequest: Request,
  ): Promise<ConfigurationEvidenceAdoptionResponse> {
    const workItemId: string = requiredIdentifier(
      workItemIdValue,
      'CONFIGURATION_EVIDENCE_WORK_ITEM_ID_INVALID',
    );
    const candidateEvidenceRef: string = requiredIdentifier(
      candidateEvidenceRefValue,
      'CONFIGURATION_EVIDENCE_CANDIDATE_REF_INVALID',
      160,
    );
    const expectedRevision: number = adoptionRequest(body);
    const authorized = await this.authorizeAndLoad(
      workItemId,
      'REFRESH_CONFIGURATION_EVIDENCE',
      httpRequest,
    );
    const candidate = await this.queryStore.findByCandidateEvidenceRef({
      tenantId: authorized.grant.tenantId,
      workItemId,
      candidateEvidenceRef,
    });
    if (!candidate) throw configurationNotFound();
    if (candidate.adoption.status === 'ADOPTED') {
      const replay = await this.store.findByRequest({
        tenantId: authorized.grant.tenantId,
        workItemId,
        requestId: candidate.request.requestId,
      });
      if (!replay) {
        throw configurationUnavailable(
          'CONFIGURATION_EVIDENCE_ADOPTION_READBACK_INVALID',
        );
      }
      return adoptionResponse(
        workItemId,
        replay.workItem.revision,
        true,
        candidateEvidenceRef,
        replay.persisted,
      );
    }
    if (
      candidate.terminalStatus !== 'SUCCEEDED_EVIDENCE' &&
      candidate.terminalStatus !== 'SUCCEEDED_NO_RECORD'
    ) {
      throw configurationConflict(
        'CONFIGURATION_EVIDENCE_CANDIDATE_NOT_ADOPTABLE',
      );
    }
    if (!candidate.projections || !candidate.candidateSnapshot) {
      throw configurationUnavailable(
        'CONFIGURATION_EVIDENCE_CANDIDATE_READBACK_INVALID',
      );
    }
    if (
      expectedRevision !== candidate.inputRevision ||
      expectedRevision !== authorized.workItem.revision ||
      expectedRevision !== authorized.grant.workItemRevision
    ) {
      throw configurationConflict('WORK_ITEM_CAS_CONFLICT');
    }
    const recordedAt: string = this.clock.nowIso();
    const committed = await this.store.commit({
      tenantId: authorized.grant.tenantId,
      actorId: authorized.grant.actorUserId,
      workItemId,
      expectedWorkItemRevision: expectedRevision,
      request: candidate.request,
      projections: candidate.projections,
      snapshot: candidate.candidateSnapshot,
      recordedAt,
    });
    assertCommittedCurrent(committed.workItem, committed.persisted);
    await this.queryStore.markAdopted({
      tenantId: authorized.grant.tenantId,
      actorId: authorized.grant.actorUserId,
      workItemId,
      candidateEvidenceRef,
      snapshotId: committed.persisted.summary.snapshotId,
      workItemRevision: committed.workItem.revision,
      adoptedAt: recordedAt,
    });
    return adoptionResponse(
      workItemId,
      committed.workItem.revision,
      committed.replayed,
      candidateEvidenceRef,
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

  private async resolveRequest(
    authorized: AuthorizedConfigurationAccess,
    request: RefreshConfigurationEvidenceRequest,
  ): Promise<ResolvedConfigurationEvidenceRequest> {
    const capabilityGrant = await this.issueCapabilityGrant(
      authorized.workItem,
      request,
    );
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
    return {
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
      capabilityGrant,
    };
  }

  private async issueCapabilityGrant(
    workItem: CanonicalWorkItemProjection,
    request: RefreshConfigurationEvidenceRequest,
  ): Promise<ConfigurationEvidenceCapabilityGrant> {
    const context = await this.engineerReview.pageContext(workItem);
    if (!context || context.gapLedger.inputRevision !== workItem.revision) {
      throw configurationConflict(
        'CONFIGURATION_EVIDENCE_GAP_LEDGER_NOT_READY',
      );
    }
    const gapsByRef = new Map(
      context.gapLedger.gaps.map((gap) => [gap.gapRef, gap]),
    );
    const selected = request.gapRefs.map((gapRef: string) => {
      const gap = gapsByRef.get(gapRef);
      if (!gap) {
        throw configurationConflict(
          `CONFIGURATION_EVIDENCE_GAP_UNKNOWN:${gapRef}`,
        );
      }
      const material =
        gap.materiality === 'P0_DECISION_CRITICAL' ||
        gap.materiality === 'P1_ACTION_CRITICAL';
      const dispositionAllowsQuery =
        gap.disposition === null ||
        gap.disposition.disposition === 'RESOLVE_NOW';
      if (
        gap.queryability !== 'REVIEW_QUERYABLE' ||
        gap.resolutionStatus === 'RESOLVED_BY_ENGINEER_REVIEW' ||
        !gap.evidenceCapabilities.includes('GET_INSTALLATION_EVENTS') ||
        !material ||
        !dispositionAllowsQuery
      ) {
        throw configurationConflict(
          `CONFIGURATION_EVIDENCE_GAP_NOT_QUERYABLE:${gapRef}`,
        );
      }
      return gap;
    });
    return {
      schemaVersion: 'wiselink.3_1.configuration_evidence_capability_grant.v1',
      grantRef: `CG-${request.requestId}`,
      capability: 'GET_INSTALLATION_EVENTS',
      inputRevision: workItem.revision,
      gapRefs: [...request.gapRefs],
      affectedCriterionIds: uniqueSortedTexts(
        selected.flatMap((gap) => gap.affectedCriterionIds),
      ),
      materialities: uniqueMaterialities(
        selected.map((gap) => gap.materiality),
      ),
      sourceConfigured: this.installationEvents.configured,
      issuedAt: this.clock.nowIso(),
    };
  }

  private async executeQuery(
    query: GetInstallationEventsQuery,
  ): Promise<GetInstallationEventsResult> {
    if (!this.installationEvents.configured) {
      return unavailableQueryResult(
        query,
        'SOURCE_NOT_CONFIGURED',
        this.clock.nowIso(),
      );
    }
    try {
      const result = await this.installationEvents.getInstallationEvents(query);
      mapInstallationEventEvidence({ query, result });
      return result;
    } catch (error) {
      const code: GetInstallationEventsFailureCode = isErrorCode(
        error,
        'ACCESS_DENIED',
      )
        ? 'ACCESS_DENIED'
        : isErrorCode(error, 'TIMEOUT')
          ? 'TIMEOUT'
          : 'SOURCE_UNAVAILABLE';
      return unavailableQueryResult(query, code, this.clock.nowIso());
    }
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
    'gapRefs',
    'targets',
  ]);
  if (
    value.schemaVersion !== 'wiselink.3_1.refresh_configuration_evidence.v1'
  ) {
    throw configurationBadRequest(
      'CONFIGURATION_EVIDENCE_SCHEMA_VERSION_INVALID',
    );
  }
  if (!validDistinctTexts(value.gapRefs, 1, MAX_TARGETS)) {
    throw configurationBadRequest('CONFIGURATION_EVIDENCE_GAP_REFS_INVALID');
  }
  const gapRefs = [...(value.gapRefs as string[])].sort();
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
    gapRefs,
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
    gapRefs: [...stored.gapRefs],
    targets: structuredClone(stored.targets),
  };
  if (JSON.stringify(storedIntent) !== JSON.stringify(incoming)) {
    throw configurationConflict(
      'CONFIGURATION_EVIDENCE_IDEMPOTENCY_PAYLOAD_MISMATCH',
    );
  }
}

function assertCommittedCurrent(
  workItem: CanonicalWorkItemProjection,
  persisted: PersistedConfigurationEvidenceSnapshot,
): void {
  const pointer = workItem.configurationEvidenceCurrent;
  const reevaluation = workItem.configurationEvidenceReevaluation;
  if (
    !persisted.summary.isCurrent ||
    !pointer ||
    pointer.snapshotId !== persisted.summary.snapshotId ||
    pointer.configurationRevision !== persisted.summary.configurationRevision ||
    pointer.globalAircraftCurrentChanged !== false ||
    !reevaluation ||
    reevaluation.triggerSnapshotId !== persisted.summary.snapshotId ||
    reevaluation.triggerConfigurationRevision !==
      persisted.summary.configurationRevision ||
    reevaluation.adoptionWorkItemRevision !== workItem.revision ||
    reevaluation.status !== 'REQUIRED'
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

function queryResponse(
  workItemId: string,
  workItemRevision: number,
  replayed: boolean,
  candidate: ConfigurationEvidenceQueryAttemptReadModel,
): ConfigurationEvidenceQueryResponse {
  return {
    schemaVersion: 'wiselink.3_1.configuration_evidence_query_response.v1',
    workItemId,
    workItemRevision,
    replayed,
    candidate,
    authority: structuredClone(CONFIGURATION_EVIDENCE_QUERY_AUTHORITY),
  };
}

function adoptionResponse(
  workItemId: string,
  workItemRevision: number,
  replayed: boolean,
  candidateEvidenceRef: string,
  persisted: PersistedConfigurationEvidenceSnapshot,
): ConfigurationEvidenceAdoptionResponse {
  return {
    schemaVersion: 'wiselink.3_1.configuration_evidence_adoption_response.v1',
    workItemId,
    workItemRevision,
    replayed,
    candidateEvidenceRef,
    persisted,
    reevaluation: {
      mode: 'FULL_APPLICABILITY_JOB_AID_OVERALL',
      status: 'REQUIRED',
      trigger: 'CONFIGURATION_EVIDENCE_ADOPTED',
    },
    authority: structuredClone(CONFIGURATION_EVIDENCE_QUERY_AUTHORITY),
  };
}

function adoptionRequest(body: unknown): number {
  const value: Record<string, unknown> = objectBody(body);
  strictKeys(value, ['expectedRevision']);
  if (
    !Number.isSafeInteger(value.expectedRevision) ||
    Number(value.expectedRevision) < 1
  ) {
    throw configurationBadRequest(
      'CONFIGURATION_EVIDENCE_EXPECTED_REVISION_INVALID',
    );
  }
  return Number(value.expectedRevision);
}

function assertExpectedRevision(
  authorized: AuthorizedConfigurationAccess,
  expectedRevision: number,
): void {
  if (
    expectedRevision !== authorized.workItem.revision ||
    expectedRevision !== authorized.grant.workItemRevision
  ) {
    throw configurationConflict('WORK_ITEM_CAS_CONFLICT');
  }
}

function installationQueries(
  request: ResolvedConfigurationEvidenceRequest,
): GetInstallationEventsQuery[] {
  return request.targets.map(
    (target: ConfigurationEvidenceTarget): GetInstallationEventsQuery => ({
      schemaVersion: 'wiselink.3_1.get_installation_events_query.v0.candidate',
      aircraft: structuredClone(request.aircraft),
      target: structuredClone(target),
      windowStart: request.windowStart,
      assessmentAsOf: request.assessmentAsOf,
    }),
  );
}

function unavailableQueryResult(
  query: GetInstallationEventsQuery,
  code: Extract<
    GetInstallationEventsFailureCode,
    'SOURCE_NOT_CONFIGURED' | 'ACCESS_DENIED' | 'TIMEOUT' | 'SOURCE_UNAVAILABLE'
  >,
  observedAt: string,
): GetInstallationEventsResult {
  return {
    status: 'UNAVAILABLE',
    records: [],
    error: {
      code,
      message: code,
      retryable: code === 'TIMEOUT' || code === 'SOURCE_UNAVAILABLE',
    },
    source: {
      owner: 'canonical-host:configuration-evidence',
      sourceSystem:
        code === 'SOURCE_NOT_CONFIGURED'
          ? 'UNCONFIGURED_INSTALLATION_EVENT_SOR'
          : 'CONFIGURED_INSTALLATION_EVENT_SOR',
      sourceRevision: 'UNAVAILABLE',
      observedAt,
      freshness: 'UNKNOWN',
    },
    queryScope: structuredClone(query),
    coverage: {
      included: 'No controlled source records were accepted for this query.',
      limitation: code,
      completeness: 'UNKNOWN',
      allRecordsRead: false,
      exactAircraftMatch: true,
      exactTargetMatch: true,
    },
  };
}

function terminalQueryStatus(
  results: readonly GetInstallationEventsResult[],
  candidateSnapshot: ConfigurationSnapshot,
): Exclude<ConfigurationEvidenceQueryTerminalStatus, 'RUNNING'> {
  const errorCodes = results
    .map((result: GetInstallationEventsResult) => result.error?.code ?? null)
    .filter((code): code is GetInstallationEventsFailureCode => code !== null);
  if (
    candidateSnapshot.coverage.sourceCompleteness === 'CONFLICT' ||
    candidateSnapshot.facts.some((fact) => fact.truth === 'CONFLICT') ||
    results.some(
      (result: GetInstallationEventsResult) => result.status === 'CONFLICT',
    ) ||
    errorCodes.includes('SOURCE_CONFLICT')
  ) {
    return 'CONFLICT';
  }
  if (errorCodes.includes('ACCESS_DENIED')) return 'ACCESS_DENIED';
  if (errorCodes.includes('TIMEOUT')) return 'TIMEOUT';
  if (errorCodes.includes('SOURCE_NOT_CONFIGURED')) return 'NOT_CONNECTED';
  if (results.some((result) => result.status !== 'COMPLETE')) {
    return 'FAILED_VALIDATION';
  }
  return results.every((result) => result.records.length === 0)
    ? 'SUCCEEDED_NO_RECORD'
    : 'SUCCEEDED_EVIDENCE';
}

function isErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.includes(code)
  );
}

function validDistinctTexts(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= minimum &&
    value.length <= maximum &&
    value.every(
      (item: unknown): item is string =>
        typeof item === 'string' &&
        item.trim() === item &&
        item.length > 0 &&
        item.length <= 160 &&
        !item.includes('\u0000'),
    ) &&
    new Set(value).size === value.length
  );
}

function uniqueSortedTexts(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function uniqueMaterialities(
  values: CanonicalAssessmentGapMateriality[],
): CanonicalAssessmentGapMateriality[] {
  const order: CanonicalAssessmentGapMateriality[] = [
    'P0_DECISION_CRITICAL',
    'P1_ACTION_CRITICAL',
    'P2_OPTIMIZATION',
    'P3_LIFECYCLE',
  ];
  return order.filter((value) => values.includes(value));
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
