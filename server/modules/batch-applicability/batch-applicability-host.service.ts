import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import type {
  BatchApplicabilityFleetHeadBinding,
  BatchApplicabilityRunReadModel,
  ConfirmBatchApplicabilityClusterRequest,
  CreateBatchApplicabilityRunRequest,
} from '@shared/batch-applicability.interface';
import {
  CANONICAL_OBJECT_ACCESS,
  type CanonicalGrantableObjectAccessAction,
  type CanonicalObjectAccessGrant,
  type CanonicalObjectAccessPort,
} from '../work-item/canonical-object-access.port';
import { SessionResolver } from '../identity/session-resolver.service';
import type { ResolvedSession } from '../identity/session-resolver.service';
import {
  CANONICAL_HOST_CLOCK,
  CANONICAL_WORK_ITEM_REGISTRAR,
} from '../canonical-host/canonical-host.constants';
import {
  CanonicalFleetMasterDataRepository,
  type CurrentCanonicalFleetHead,
} from '../canonical-host/canonical-fleet-master-data.repository';
import type {
  CanonicalHostClockPort,
  CanonicalWorkItemRegistrarPort,
} from '../canonical-host/canonical-host.types';
import { BatchApplicabilityService } from './batch-applicability.service';
import { sameFleetHead } from './batch-applicability-currentness';
import {
  batchRunReadModel,
  parseCandidateSet,
  storageSafeCandidateSet,
} from './batch-applicability-presenter';
import { BatchApplicabilityRepository } from './batch-applicability.repository';
import { BatchApplicabilitySourceReader } from './batch-applicability-source-reader';
import type { PersistedBatchApplicabilityRun } from './batch-applicability-host.types';
import type { BatchApplicabilityTargetInput } from './batch-applicability.types';

@Injectable()
export class BatchApplicabilityHostService {
  constructor(
    private readonly sessions: SessionResolver,
    @Inject(CANONICAL_OBJECT_ACCESS)
    private readonly objectAccess: CanonicalObjectAccessPort,
    @Inject(CANONICAL_WORK_ITEM_REGISTRAR)
    private readonly registrar: CanonicalWorkItemRegistrarPort,
    @Inject(CANONICAL_HOST_CLOCK)
    private readonly clock: CanonicalHostClockPort,
    private readonly fleet: CanonicalFleetMasterDataRepository,
    private readonly sourceReader: BatchApplicabilitySourceReader,
    private readonly domain: BatchApplicabilityService,
    private readonly repository: BatchApplicabilityRepository,
  ) {}

  async create(
    workItemId: string,
    input: CreateBatchApplicabilityRunRequest,
    httpRequest: Request,
  ): Promise<BatchApplicabilityRunReadModel> {
    const access = await this.authorizeAndLoad(
      workItemId,
      'CREATE_BATCH_APPLICABILITY_RUN',
      httpRequest,
    );
    const replay = await this.repository.findRunByRequest({
      tenantId: access.grant.tenantId,
      actorId: access.grant.actorUserId,
      workItemId,
      requestId: input.requestId,
    });
    if (replay) {
      assertSamePayload(replay.requestPayloadJson, input);
      return this.readAuthorized(replay, access.workItem);
    }

    const source = await this.sourceReader.read(
      access.workItem,
      input.sourceExpressionId,
    );
    const frozenFleetHead = await this.currentFleetHead(access.grant.tenantId);
    const targets: BatchApplicabilityTargetInput[] = [];
    for (const target of input.targets) {
      targets.push({
        aircraftIdentifier: target.aircraftIdentifier,
        asOf: target.asOf,
        fleetMasterData: await this.fleet.readCurrentForAircraft({
          tenantId: access.grant.tenantId,
          aircraftIdentifier: target.aircraftIdentifier,
          asOf: target.asOf,
        }),
      });
    }
    const runId = randomUUID();
    const candidateSet = storageSafeCandidateSet(
      this.domain.evaluateCandidate({
        actionAttemptId: runId,
        workItem: access.workItem,
        currentFleetHead: frozenFleetHead,
        sourceCondition: source.condition,
        targets,
      }),
    );

    const refreshed = await this.authorizeAndLoad(
      workItemId,
      'CREATE_BATCH_APPLICABILITY_RUN',
      httpRequest,
    );
    assertSameWorkItem(access.workItem, refreshed.workItem);
    const refreshedSource = await this.sourceReader.read(
      refreshed.workItem,
      input.sourceExpressionId,
    );
    if (JSON.stringify(refreshedSource) !== JSON.stringify(source)) {
      throw conflict('BATCH_SOURCE_BINDING_CHANGED');
    }
    const currentFleetHead = await this.currentFleetHead(access.grant.tenantId);
    if (!sameFleetHead(frozenFleetHead, currentFleetHead)) {
      throw conflict('BATCH_FLEET_HEAD_CHANGED_DURING_CREATE');
    }

    let persisted;
    try {
      persisted = await this.repository.createRun({
        runId,
        tenantId: access.grant.tenantId,
        actorId: access.grant.actorUserId,
        workItemId,
        request: input,
        candidateSet,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('BATCH_APPLICABILITY_RUN_BINDING_NOT_CURRENT')
      ) {
        throw conflict('BATCH_HOST_BINDING_CHANGED_DURING_CREATE');
      }
      throw error;
    }
    assertSamePayload(persisted.run.requestPayloadJson, input);
    return this.readAuthorized(persisted.run, refreshed.workItem);
  }

  async read(
    workItemId: string,
    runId: string,
    httpRequest: Request,
  ): Promise<BatchApplicabilityRunReadModel> {
    const access = await this.authorizeAndLoad(
      workItemId,
      'READ_BATCH_APPLICABILITY_RUN',
      httpRequest,
    );
    const run = await this.requiredRun(access, runId);
    return this.readAuthorized(run, access.workItem);
  }

  async confirm(
    workItemId: string,
    runId: string,
    input: ConfirmBatchApplicabilityClusterRequest,
    httpRequest: Request,
  ): Promise<BatchApplicabilityRunReadModel> {
    const access = await this.authorizeAndLoad(
      workItemId,
      'CONFIRM_BATCH_APPLICABILITY_CLUSTER',
      httpRequest,
    );
    const run = await this.requiredRun(access, runId);
    const prior = await this.repository.findConfirmationByRequest({
      tenantId: access.grant.tenantId,
      actorId: access.grant.actorUserId,
      workItemId,
      requestId: input.requestId,
    });
    if (prior) {
      assertSamePayload(prior.requestPayloadJson, input);
      if (prior.runId !== runId)
        throw conflict('BATCH_CONFIRMATION_REPLAY_DRIFT');
      return this.readAuthorized(run, access.workItem);
    }
    if (access.workItem.revision !== input.expectedWorkItemRevision) {
      throw conflict('BATCH_CONFIRMATION_WORK_ITEM_REVISION_CONFLICT');
    }
    const currentFleetHead = await this.currentFleetHead(access.grant.tenantId);
    const source = await this.sourceReader.read(
      access.workItem,
      run.sourceExpressionId,
    );
    const candidateSet = parseCandidateSet(run);
    if (
      JSON.stringify(source.condition) !==
      JSON.stringify({
        sourceConditionId: candidateSet.source.sourceConditionId,
        sourceExpressionId: candidateSet.source.sourceExpressionId,
        authority: candidateSet.source.sourceConditionAuthority,
        sourceRefIds: candidateSet.source.sourceRefIds,
        target: candidateSet.source.target,
        applicabilityAst: source.condition.applicabilityAst,
      })
    ) {
      throw conflict('BATCH_CONFIRMATION_SOURCE_BINDING_DRIFT');
    }
    const confirmedAt = this.clock.nowIso();
    const candidate = this.domain.confirmCluster({
      currentWorkItem: access.workItem,
      currentFleetHead,
      candidateSet,
      expectedWorkItemRevision: input.expectedWorkItemRevision,
      candidateClusterId: input.candidateClusterId,
      decision: input.decision,
      confirmedByActorId: access.grant.actorUserId,
      reason: input.reason,
      confirmedAt,
      validUntil: input.validUntil,
    });
    try {
      const persisted = await this.repository.createConfirmation({
        receiptId: randomUUID(),
        run,
        actorId: access.grant.actorUserId,
        request: input,
        candidate,
      });
      assertSamePayload(persisted.confirmation.requestPayloadJson, input);
      if (
        persisted.confirmation.runId !== run.runId ||
        persisted.confirmation.candidateClusterId !== input.candidateClusterId
      ) {
        throw conflict('BATCH_CONFIRMATION_REPLAY_DRIFT');
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes(
          'BATCH_APPLICABILITY_CONFIRMATION_RUN_NOT_CURRENT',
        )
      ) {
        throw conflict('BATCH_CONFIRMATION_RUN_NOT_CURRENT');
      }
      throw error;
    }
    return this.readAuthorized(run, access.workItem);
  }

  private async readAuthorized(
    run: PersistedBatchApplicabilityRun,
    currentWorkItem: CanonicalWorkItemProjection,
  ): Promise<BatchApplicabilityRunReadModel> {
    const [currentFleetHead, confirmations] = await Promise.all([
      this.currentFleetHead(run.tenantId),
      this.repository.listConfirmations({
        tenantId: run.tenantId,
        actorId: run.actorId,
        workItemId: run.workItemId,
        runId: run.runId,
      }),
    ]);
    return batchRunReadModel({
      run,
      confirmations,
      currentWorkItem,
      currentFleetHead,
    });
  }

  private async requiredRun(
    access: AuthorizedAccess,
    runId: string,
  ): Promise<PersistedBatchApplicabilityRun> {
    const run = await this.repository.findRun({
      tenantId: access.grant.tenantId,
      actorId: access.grant.actorUserId,
      workItemId: access.workItem.workItemId,
      runId,
    });
    if (!run) throw notFound('BATCH_APPLICABILITY_RUN_NOT_FOUND');
    return run;
  }

  private async authorizeAndLoad(
    workItemId: string,
    action: BatchAccessAction,
    httpRequest: Request,
  ): Promise<AuthorizedAccess> {
    const session = await this.sessions.resolve(httpRequest);
    if (!session) throw unauthorized('SESSION_REQUIRED');
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
      throw notFound('BATCH_WORK_ITEM_NOT_FOUND');
    }
    const workItem = await this.registrar.getTenantScopedByWorkItemId({
      tenantId: result.tenantId,
      workItemId,
    });
    if (
      workItem.workItemId !== result.workItemId ||
      workItem.revision !== result.workItemRevision ||
      workItem.source.documentVersionId !== result.documentVersionId
    ) {
      throw conflict('CANONICAL_WORK_ITEM_REVISION_MISMATCH');
    }
    return { session, grant: result, workItem };
  }

  private async currentFleetHead(
    tenantId: string,
  ): Promise<BatchApplicabilityFleetHeadBinding> {
    const head: CurrentCanonicalFleetHead = await this.fleet.readCurrentHead({
      tenantId,
    });
    return head;
  }
}

type BatchAccessAction = Extract<
  CanonicalGrantableObjectAccessAction,
  | 'CREATE_BATCH_APPLICABILITY_RUN'
  | 'READ_BATCH_APPLICABILITY_RUN'
  | 'CONFIRM_BATCH_APPLICABILITY_CLUSTER'
>;

interface AuthorizedAccess {
  session: ResolvedSession;
  grant: CanonicalObjectAccessGrant;
  workItem: CanonicalWorkItemProjection;
}

function assertSameWorkItem(
  left: CanonicalWorkItemProjection,
  right: CanonicalWorkItemProjection,
): void {
  if (
    left.workItemId !== right.workItemId ||
    left.revision !== right.revision ||
    left.source.documentVersionId !== right.source.documentVersionId ||
    left.package?.packageId !== right.package?.packageId ||
    JSON.stringify(left.applicabilityInput) !==
      JSON.stringify(right.applicabilityInput) ||
    JSON.stringify(left.applicabilityControlledSelection) !==
      JSON.stringify(right.applicabilityControlledSelection)
  ) {
    throw conflict('BATCH_WORK_ITEM_BINDING_CHANGED_DURING_CREATE');
  }
}

function assertSamePayload(stored: string, requested: unknown): void {
  if (stored !== JSON.stringify(requested)) {
    throw conflict('BATCH_REQUEST_ID_REUSED_WITH_DIFFERENT_PAYLOAD');
  }
}

function conflict(code: string): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 409 });
}

function notFound(code: string): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 404 });
}

function unauthorized(
  code: string,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 401 });
}
