import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import type {
  CanonicalOverallRegenerationExecutionStatus,
  CanonicalOverallRegenerationReadModel,
  CanonicalOverallRegenerationRequestProjection,
  CanonicalOverallRegenerationSourceIdentity,
  CanonicalWorkItemProjection,
  RequestCanonicalOverallRegenerationRequest,
  RequestCanonicalOverallRegenerationResponse,
} from '@shared/api.interface';
import { ActionAttemptLifecycleService } from '../action-attempt/action-attempt-lifecycle.service';
import type { ActionAttemptRow } from '../action-attempt/action-attempt.types';
import { SessionResolver } from '../identity/session-resolver.service';
import type { ResolvedSession } from '../identity/session-resolver.service';
import {
  CANONICAL_OBJECT_ACCESS,
  type CanonicalObjectAccessGrant,
  type CanonicalObjectAccessPort,
} from '../work-item/canonical-object-access.port';
import {
  CANONICAL_HOST_CLOCK,
  CANONICAL_WORK_ITEM_REGISTRAR,
} from './canonical-host.constants';
import {
  CanonicalHostOpenClawOverallService,
  overallUserRegenerationIdempotencyKey,
} from './canonical-host-openclaw-overall.service';
import { projectCanonicalHostOpenClawAttemptStatus } from './canonical-host-openclaw-attempt-status.service';
import { canonicalHostBareSha256 } from './canonical-host-sha256';
import type {
  CanonicalHostClockPort,
  CanonicalWorkItemRegistrarPort,
} from './canonical-host.types';

const TERMINAL_STATUSES = new Set<CanonicalOverallRegenerationExecutionStatus>([
  'SUCCEEDED',
  'WAITING_INPUT',
  'FAILED',
  'TIMED_OUT',
  'CANCELLED',
  'CONFLICT',
  'OBSOLETE',
]);

interface AuthorizedRegenerationAccess {
  session: ResolvedSession;
  grant: CanonicalObjectAccessGrant;
  workItem: CanonicalWorkItemProjection;
}

@Injectable()
export class CanonicalHostOverallRegenerationService {
  constructor(
    private readonly sessions: SessionResolver,
    @Inject(CANONICAL_OBJECT_ACCESS)
    private readonly objectAccess: CanonicalObjectAccessPort,
    @Inject(CANONICAL_WORK_ITEM_REGISTRAR)
    private readonly registrar: CanonicalWorkItemRegistrarPort,
    @Inject(CANONICAL_HOST_CLOCK)
    private readonly clock: CanonicalHostClockPort,
    private readonly overall: CanonicalHostOpenClawOverallService,
    private readonly attempts: ActionAttemptLifecycleService,
  ) {}

  async request(
    workItemId: string,
    input: RequestCanonicalOverallRegenerationRequest,
    httpRequest: Request,
  ): Promise<RequestCanonicalOverallRegenerationResponse> {
    const normalizedInput = validateRequest(workItemId, input);
    const authorized = await this.authorizeAndLoad(workItemId, httpRequest);
    const previousRequest = authorized.workItem.overallRegenerationRequest;
    if (previousRequest?.requestId === normalizedInput.requestId) {
      assertReplay(previousRequest, normalizedInput);
      const attempt = await this.ensureAttempt(authorized);
      return {
        regeneration: regenerationReadModel(
          authorized.workItem,
          previousRequest,
          attempt,
        ),
        replayed: true,
      };
    }

    const workItem = requiredCurrentOverallCandidate(authorized.workItem);
    if (workItem.revision !== normalizedInput.expectedRevision) {
      throw regenerationConflict('WORK_ITEM_CAS_CONFLICT');
    }
    assertSourceIdentity(workItem, normalizedInput.sourceIdentity);
    const overall = workItem.integratedAssessment!.overallSynthesis!;
    const sourceOverallSha256 = canonicalHostBareSha256(
      overall.artifact.sha256,
    );
    if (!sourceOverallSha256) {
      throw regenerationConflict('OVERALL_REGENERATION_SOURCE_CHANGED');
    }
    const marker: CanonicalOverallRegenerationRequestProjection = {
      schemaVersion: 'wiselink.3_1.overall_regeneration_request.v1',
      requestId: normalizedInput.requestId,
      requestedByUserId: authorized.session.actor.canonicalSubject.id,
      requestedAt: this.clock.nowIso(),
      requestedFromRevision: workItem.revision,
      executionRevision: workItem.revision + 1,
      staleReason: 'USER_REQUESTED_REGENERATION',
      sourceIdentity: structuredClone(normalizedInput.sourceIdentity),
      sourceOverall: {
        revision: overall.revision,
        actionAttemptId: overall.actionAttemptId,
        artifactSha256: sourceOverallSha256,
      },
    };
    const updated = await this.registrar.compareAndSet({
      workItemId: workItem.workItemId,
      expectedRevision: workItem.revision,
      syncPrimaryAttempt: false,
      next: {
        ...withoutRevision(workItem),
        integratedAssessment: {
          ...workItem.integratedAssessment!,
          status: 'OVERALL_CANDIDATE_STALE',
          overallSynthesis: {
            ...overall,
            status: 'STALE',
            // Only the current Host-owned request marker authorizes this full
            // regeneration. A legacy overall field cannot self-report it.
            staleReason: null,
          },
          overallForAeoConfirmation: null,
        },
        overallRegenerationRequest: marker,
        aeo: null,
      },
    });
    if (updated.revision !== marker.executionRevision) {
      throw regenerationConflict('OVERALL_REGENERATION_CAS_READBACK_INVALID');
    }

    const refreshed = await this.authorizeAndLoad(workItemId, httpRequest);
    assertAuthorizedRevision(refreshed, marker.executionRevision);
    const attempt = await this.ensureAttempt(refreshed);
    return {
      regeneration: regenerationReadModel(refreshed.workItem, marker, attempt),
      replayed: false,
    };
  }

  async status(
    workItemId: string,
    requestId: string,
    httpRequest: Request,
  ): Promise<CanonicalOverallRegenerationReadModel> {
    requiredIdentifier(workItemId, 'OVERALL_REGENERATION_WORK_ITEM_ID_INVALID');
    requiredIdentifier(requestId, 'OVERALL_REGENERATION_REQUEST_ID_INVALID');
    const authorized = await this.authorizeAndLoad(workItemId, httpRequest);
    const marker = authorized.workItem.overallRegenerationRequest;
    if (!marker || marker.requestId !== requestId) {
      throw regenerationNotFound();
    }
    assertRequestActor(marker, authorized);
    assertSourceIdentity(authorized.workItem, marker.sourceIdentity);
    const attempt = await this.readAttempt(authorized, marker);
    if (!attempt && authorized.workItem.revision !== marker.executionRevision) {
      throw regenerationConflict('OVERALL_REGENERATION_ATTEMPT_NOT_FOUND');
    }
    return regenerationReadModel(authorized.workItem, marker, attempt);
  }

  private async ensureAttempt(
    authorized: AuthorizedRegenerationAccess,
  ): Promise<ActionAttemptRow> {
    const marker = authorized.workItem.overallRegenerationRequest;
    if (!marker) throw regenerationNotFound();
    assertRequestActor(marker, authorized);
    const existing = await this.readAttempt(authorized, marker);
    if (existing) return existing;
    if (authorized.workItem.revision !== marker.executionRevision) {
      throw regenerationConflict('OVERALL_REGENERATION_ATTEMPT_NOT_FOUND');
    }
    await this.overall.enqueueUserRequestedRegeneration({
      workItemId: authorized.workItem.workItemId,
      tenantId: authorized.grant.tenantId,
      permissionSnapshotVersion: authorized.grant.authorizationFingerprint,
    });
    const queued = await this.readAttempt(authorized, marker);
    if (!queued) {
      throw regenerationConflict('OVERALL_REGENERATION_QUEUE_READBACK_FAILED');
    }
    return queued;
  }

  private readAttempt(
    authorized: AuthorizedRegenerationAccess,
    marker: CanonicalOverallRegenerationRequestProjection,
  ): Promise<ActionAttemptRow | null> {
    return this.attempts.readExactIdempotency({
      tenantId: authorized.grant.tenantId,
      workItemId: authorized.workItem.workItemId,
      taskType: 'OPENCLAW_OVERALL_SYNTHESIS',
      baseRevision: marker.executionRevision,
      documentVersionId: marker.sourceIdentity.documentVersionId,
      idempotencyKey: overallUserRegenerationIdempotencyKey(
        authorized.workItem.workItemId,
        marker.executionRevision,
        marker.requestId,
      ),
    });
  }

  private async authorizeAndLoad(
    workItemId: string,
    httpRequest: Request,
  ): Promise<AuthorizedRegenerationAccess> {
    const session = await this.sessions.resolve(httpRequest);
    if (!session) throw sessionRequired();
    const result = await this.objectAccess.freshRead({
      actor: session.actor,
      action: 'REQUEST_OVERALL_REGENERATION',
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
      result.action !== 'REQUEST_OVERALL_REGENERATION' ||
      result.workItemId !== workItemId ||
      result.tenantId !== session.actor.tenantId ||
      result.actorUserId !== session.actor.canonicalSubject.id ||
      result.workItemRevision !== workItem.revision ||
      result.requestId !== workItem.requestId ||
      result.documentVersionId !== workItem.source.documentVersionId
    ) {
      throw regenerationNotFound();
    }
    return { session, grant: result, workItem };
  }
}

function assertRequestActor(
  marker: CanonicalOverallRegenerationRequestProjection,
  authorized: AuthorizedRegenerationAccess,
): void {
  if (
    marker.requestedByUserId !== authorized.session.actor.canonicalSubject.id ||
    marker.requestedByUserId !== authorized.grant.actorUserId
  ) {
    throw regenerationNotFound();
  }
}

function requiredCurrentOverallCandidate(
  workItem: CanonicalWorkItemProjection,
): CanonicalWorkItemProjection {
  const integrated = workItem.integratedAssessment;
  const overall = integrated?.overallSynthesis;
  if (
    workItem.phase !== 'CANDIDATE_READBACK_VERIFIED' ||
    !workItem.package ||
    !integrated?.baseRules ||
    integrated.status !== 'OVERALL_CANDIDATE_READY' ||
    !overall ||
    overall.status !== 'CANDIDATE_ONLY' ||
    overall.staleReason !== null
  ) {
    throw regenerationConflict(
      'OVERALL_REGENERATION_CURRENT_CANDIDATE_REQUIRED',
    );
  }
  return workItem;
}

function validateRequest(
  workItemId: string,
  input: RequestCanonicalOverallRegenerationRequest,
): RequestCanonicalOverallRegenerationRequest {
  requiredIdentifier(workItemId, 'OVERALL_REGENERATION_WORK_ITEM_ID_INVALID');
  if (!input || typeof input !== 'object') {
    throw regenerationBadRequest('OVERALL_REGENERATION_BODY_INVALID');
  }
  requiredIdentifier(
    input.requestId,
    'OVERALL_REGENERATION_REQUEST_ID_INVALID',
  );
  if (
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 1
  ) {
    throw regenerationBadRequest('OVERALL_REGENERATION_REVISION_INVALID');
  }
  if (
    !input.sourceIdentity ||
    typeof input.sourceIdentity !== 'object' ||
    Array.isArray(input.sourceIdentity)
  ) {
    throw regenerationBadRequest('OVERALL_REGENERATION_SOURCE_INVALID');
  }
  for (const value of Object.values(input.sourceIdentity)) {
    if (typeof value !== 'string' || !value.trim()) {
      throw regenerationBadRequest('OVERALL_REGENERATION_SOURCE_INVALID');
    }
  }
  const sourceFileSha256 = canonicalHostBareSha256(
    input.sourceIdentity.sourceFileSha256,
  );
  const packageArtifactSha256 = canonicalHostBareSha256(
    input.sourceIdentity.packageArtifactSha256,
  );
  if (!sourceFileSha256 || !packageArtifactSha256) {
    throw regenerationBadRequest('OVERALL_REGENERATION_SOURCE_INVALID');
  }
  return {
    requestId: input.requestId,
    expectedRevision: input.expectedRevision,
    sourceIdentity: {
      ...input.sourceIdentity,
      sourceFileSha256,
      packageArtifactSha256,
    },
  };
}

function assertReplay(
  marker: CanonicalOverallRegenerationRequestProjection,
  input: RequestCanonicalOverallRegenerationRequest,
): void {
  if (
    marker.requestedFromRevision !== input.expectedRevision ||
    !sameSourceIdentity(marker.sourceIdentity, input.sourceIdentity)
  ) {
    throw regenerationConflict(
      'OVERALL_REGENERATION_IDEMPOTENCY_PAYLOAD_MISMATCH',
    );
  }
}

function assertAuthorizedRevision(
  authorized: AuthorizedRegenerationAccess,
  revision: number,
): void {
  if (
    authorized.grant.workItemRevision !== revision ||
    authorized.workItem.revision !== revision
  ) {
    throw regenerationConflict('WORK_ITEM_CAS_CONFLICT');
  }
}

function assertSourceIdentity(
  workItem: CanonicalWorkItemProjection,
  source: CanonicalOverallRegenerationSourceIdentity,
): void {
  const currentSourceSha256 = canonicalHostBareSha256(
    workItem.source.sourceFileSha256,
  );
  const currentPackageSha256 = canonicalHostBareSha256(
    workItem.package?.artifact.sha256,
  );
  if (
    source.documentVersionId !== workItem.source.documentVersionId ||
    source.sourceArtifactId !== workItem.source.sourceArtifactId ||
    canonicalHostBareSha256(source.sourceFileSha256) !== currentSourceSha256 ||
    currentSourceSha256 === null ||
    source.packageId !== workItem.package?.packageId ||
    canonicalHostBareSha256(source.packageArtifactSha256) !==
      currentPackageSha256 ||
    currentPackageSha256 === null
  ) {
    throw regenerationConflict('OVERALL_REGENERATION_SOURCE_CHANGED');
  }
}

function sameSourceIdentity(
  left: CanonicalOverallRegenerationSourceIdentity,
  right: CanonicalOverallRegenerationSourceIdentity,
): boolean {
  const leftSourceSha256 = canonicalHostBareSha256(left.sourceFileSha256);
  const leftPackageSha256 = canonicalHostBareSha256(left.packageArtifactSha256);
  return (
    left.documentVersionId === right.documentVersionId &&
    left.sourceArtifactId === right.sourceArtifactId &&
    leftSourceSha256 !== null &&
    leftSourceSha256 === canonicalHostBareSha256(right.sourceFileSha256) &&
    left.packageId === right.packageId &&
    leftPackageSha256 !== null &&
    leftPackageSha256 === canonicalHostBareSha256(right.packageArtifactSha256)
  );
}

function regenerationReadModel(
  workItem: CanonicalWorkItemProjection,
  marker: CanonicalOverallRegenerationRequestProjection,
  row: ActionAttemptRow | null,
): CanonicalOverallRegenerationReadModel {
  const attempt = row ? projectCanonicalHostOpenClawAttemptStatus(row) : null;
  if (attempt && attempt.taskType !== 'OPENCLAW_OVERALL_SYNTHESIS') {
    throw regenerationConflict('OVERALL_REGENERATION_ATTEMPT_INVALID');
  }
  const status = regenerationStatus(attempt?.status ?? 'REQUESTED');
  const terminal = TERMINAL_STATUSES.has(status);
  return {
    schemaVersion: 'wiselink.3_1.overall_regeneration_read.v1',
    workItemId: workItem.workItemId,
    requestId: marker.requestId,
    requestedAt: marker.requestedAt,
    requestedFromRevision: marker.requestedFromRevision,
    executionRevision: marker.executionRevision,
    currentWorkItemRevision: workItem.revision,
    staleReason: 'USER_REQUESTED_REGENERATION',
    status,
    attemptRef: attempt?.attemptRef ?? null,
    projectionApplied: attempt?.projectionApplied ?? false,
    terminalReason: attempt?.terminalReason ?? null,
    terminalErrorCode: terminal
      ? (row?.errorCode ?? attempt?.terminalReason ?? null)
      : null,
    authority: {
      candidateOnly: true,
      reviewActionCreated: false,
      engineeringApprovalChanged: false,
      documentCurrentnessChanged: false,
    },
  };
}

function regenerationStatus(
  value: string,
): CanonicalOverallRegenerationExecutionStatus {
  const allowed = new Set<CanonicalOverallRegenerationExecutionStatus>([
    'REQUESTED',
    'QUEUED',
    'RUNNING',
    'RETRY_SCHEDULED',
    'COMMITTING',
    ...TERMINAL_STATUSES,
  ]);
  if (!allowed.has(value as CanonicalOverallRegenerationExecutionStatus)) {
    throw regenerationConflict('OVERALL_REGENERATION_ATTEMPT_INVALID');
  }
  return value as CanonicalOverallRegenerationExecutionStatus;
}

function withoutRevision(
  workItem: CanonicalWorkItemProjection,
): Omit<CanonicalWorkItemProjection, 'revision'> {
  const { revision: _revision, ...rest } = workItem;
  return rest;
}

function requiredIdentifier(value: string, code: string): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim() !== value ||
    value.length > 96
  ) {
    throw regenerationBadRequest(code);
  }
  return value;
}

function sessionRequired(): Error & { code: string; statusCode: number } {
  return Object.assign(new Error('OFFICIAL_OAUTH_SESSION_REQUIRED'), {
    code: 'OFFICIAL_OAUTH_SESSION_REQUIRED',
    statusCode: 401,
  });
}

function regenerationBadRequest(
  code: string,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 400 });
}

function regenerationNotFound(): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {
    code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
    statusCode: 404,
  });
}

function regenerationConflict(
  code: string,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 409 });
}
