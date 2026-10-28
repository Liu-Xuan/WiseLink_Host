import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { z } from 'zod/v4';
import type { CanonicalInitialAttemptRead, CanonicalInitialAttemptReconcileReceipt } from '@shared/api.interface';
import { SessionResolver } from '../identity/session-resolver.service';
import { InitialExpiredAttemptRepository, initialAttemptConflict, initialAttemptNotFound,
  type InitialAttemptAuthorize } from '../action-attempt/initial-expired-attempt.repository';
import { EngineeringMatterWorkingRepository } from './engineering-matter-working.repository';
import { CANONICAL_AUTHORIZATION, CANONICAL_PERMISSION_SNAPSHOT, CANONICAL_WORK_ITEM_REGISTRAR } from './canonical-host.constants';
import type { CanonicalAuthorizationPort, CanonicalPermissionSnapshotPort, CanonicalWorkItemRegistrarPort,
  CanonicalHostActor } from './canonical-host.types';
import { AUTOMATIC_WORK_ITEM_SOURCE_AUTHORIZATION, type AutomaticWorkItemSourceAuthorizationPort } from './automatic-work-item-source-authorization.port';
import { authorizeAndLoadCanonicalWorkItem } from './canonical-authorized-work-item-reader';

const target = {attemptId:z.string().regex(/^ATT-[A-Za-z0-9-]{1,91}$/u),
  attemptRef:z.string().regex(/^AQ-[A-Za-z0-9-]{1,124}$/u)};
export const initialAttemptReadSchema = z.strictObject({view:z.literal('attempt-control'),...target});
export const initialAttemptReconcileSchema = z.strictObject({operation:z.literal('RECONCILE_EXPIRED'),...target,
  stageRequestId:z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u),expectedRevision:z.number().int().positive(),
  expectedLeaseGeneration:z.number().int().positive()});

@Injectable()
export class CanonicalInitialAttemptControlService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    @Inject(CANONICAL_AUTHORIZATION) private readonly authorization: CanonicalAuthorizationPort,
    @Inject(CANONICAL_PERMISSION_SNAPSHOT) private readonly permissions: CanonicalPermissionSnapshotPort,
    @Inject(CANONICAL_WORK_ITEM_REGISTRAR) private readonly registrar: CanonicalWorkItemRegistrarPort,
    @Inject(AUTOMATIC_WORK_ITEM_SOURCE_AUTHORIZATION) private readonly sources: AutomaticWorkItemSourceAuthorizationPort,
    private readonly sessions: SessionResolver, private readonly actors: EngineeringMatterWorkingRepository) {}

  async read(workItemId: string, raw: unknown, actor: CanonicalHostActor): Promise<CanonicalInitialAttemptRead> {
    const input = initialAttemptReadSchema.parse(raw);
    const guard = await this.authorized(workItemId, actor);
    // Existing browser identity is retained, never replaced by a machine principal.
    return this.sessions.withVerifiedReviewServiceSql(() => this.actors.withActorScope(actor.userId,
      () => new InitialExpiredAttemptRepository(this.db).read(guard.scope,input,guard.authorize)), actor.userId);
  }

  async reconcile(workItemId: string, raw: unknown, actor: CanonicalHostActor): Promise<CanonicalInitialAttemptReconcileReceipt> {
    const input = initialAttemptReconcileSchema.parse(raw);
    const guard = await this.authorized(workItemId, actor);
    return this.sessions.withVerifiedReviewServiceSql(() => this.actors.withActorScope(actor.userId,
      () => new InitialExpiredAttemptRepository(this.db).reconcile(guard.scope,input,guard.authorize)), actor.userId);
  }

  private async authorized(workItemId: string, actor: CanonicalHostActor) {
    const {workItem,permissionSnapshotVersion} = await authorizeAndLoadCanonicalWorkItem({authorization:this.authorization,
      permissionSnapshots:this.permissions,registrar:this.registrar,actor,action:'EVALUATE_JOB_AID',workItemId});
    const authorize: InitialAttemptAuthorize = async (database,owners) => {
      const decision = await this.authorization.authorize({actor,action:'EVALUATE_JOB_AID',workItemId},database);
      const fresh = await this.permissions.freshRead({actor,decision,workItemId},database);
      if (!decision.allowed || decision.action !== 'EVALUATE_JOB_AID' ||
          decision.permissionSnapshotVersion !== permissionSnapshotVersion ||
          fresh.permissionSnapshotVersion !== permissionSnapshotVersion) throw initialAttemptNotFound();
      const primary = owners.find(owner => owner.workItemId === workItemId);
      if (!primary || primary.requestedByUserId !== actor.userId || primary.tenantId !== actor.tenantId ||
          primary.requestId !== workItem.requestId || primary.documentVersionId !== workItem.source.documentVersionId ||
          primary.documentId !== workItem.source.documentId || primary.sourceArtifactId !== workItem.source.sourceArtifactId ||
          primary.sourceFileSha256 !== workItem.source.sourceFileSha256.replace(/^sha256:/u,'') ||
          Number(primary.sourceByteLength) !== workItem.source.sourceByteLength) throw initialAttemptNotFound();
      for (const owner of owners) {
        const permission = await this.sources.authorizeSourceRead({tenantId:actor.tenantId,actorUserId:actor.userId,
          workItemId:owner.workItemId,requestId:owner.requestId,documentId:owner.documentId,
          documentVersionId:owner.documentVersionId,sourceArtifactId:owner.sourceArtifactId,
          sourceFileSha256:owner.sourceFileSha256,sourceByteLength:Number(owner.sourceByteLength)},database);
        if (!permission.allowed || permission.action !== 'DOCUMENT_READ' ||
            permission.authorizationPolicy !== 'MIAODA_HOST_DOCUMENT_READ' || permission.tenantId !== actor.tenantId ||
            permission.actorUserId !== actor.userId || permission.documentId !== owner.documentId ||
            permission.documentVersionId !== owner.documentVersionId || permission.sourceArtifactId !== owner.sourceArtifactId ||
            permission.sourceFileSha256 !== owner.sourceFileSha256 || permission.sourceByteLength !== Number(owner.sourceByteLength))
          throw initialAttemptConflict('SOURCE_AUTHORIZATION_CHANGED');
      }
    };
    return {scope:{workItemId,tenantId:actor.tenantId,actorUserId:actor.userId},authorize};
  }
}
