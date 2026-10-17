import { Inject, Injectable } from '@nestjs/common';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import type { JobAidWorkCorrectionReceipt, JobAidWorkCorrectionRequest } from '@shared/jobaid-work-correction.interface';
import type { JobAidWorkRevision } from '@shared/jobaid-problem-assessment.interface';
import { SessionResolver } from '../identity/session-resolver.service';
import { CANONICAL_OBJECT_ACCESS, type CanonicalObjectAccessPort } from '../work-item/canonical-object-access.port';
import { CanonicalJobAidProblemService } from './canonical-jobaid-problem.service';
import { JobAidWorkRepository } from './jobaid-work.repository';
import { correctionError, parseJobAidWorkCorrectionRequest } from './jobaid-work-correction';

/** Native OWNER save, independent of OpenClaw/model execution and formal adoption. */
@Injectable()
export class CanonicalJobAidWorkCorrectionService {
  constructor(
    private readonly sessions: SessionResolver,
    @Inject(CANONICAL_OBJECT_ACCESS) private readonly access: CanonicalObjectAccessPort,
    private readonly work: JobAidWorkRepository,
    private readonly jobAid: CanonicalJobAidProblemService,
  ) {}

  private async owner(workItemId: string, request: Request, database?: PostgresJsDatabase) {
    const identity = this.sessions.nativeBrowserIdentity(request);
    const actor = identity.actor;
    const grant = await this.access.freshRead({ actor, action: 'RECORD_ENGINEER_REVIEW',
      accessRoot: { kind: 'WORK_ITEM', id: workItemId } }, database);
    if (grant.allowed === false) throw correctionError(grant.code, grant.statusCode);
    if (grant.action !== 'RECORD_ENGINEER_REVIEW' || grant.actionPolicy.objectRelation !== 'OWNER' ||
      !grant.ownerFact.isOwner || grant.ownerFact.ownerUserId !== actor.canonicalSubject.id ||
      grant.actorUserId !== actor.canonicalSubject.id || grant.tenantId !== actor.tenantId ||
      grant.applicationScopeId !== actor.applicationScopeId || grant.workItemId !== workItemId)
      throw correctionError('JOBAID_CORRECTION_OWNER_REQUIRED', 403);
    return { tenantId: grant.tenantId, actorUserId: grant.actorUserId, workItemId, grant };
  }

  private scope(owner: Awaited<ReturnType<CanonicalJobAidWorkCorrectionService['owner']>>, request: Request) {
    const { tenantId, actorUserId, workItemId } = owner;
    return { tenantId, actorUserId, workItemId,
      assertAuthorized: async (database: PostgresJsDatabase, base: JobAidWorkRevision, workItemRevision: number) => {
        const fresh = await this.owner(workItemId, request, database);
        if (fresh.tenantId !== tenantId || fresh.actorUserId !== actorUserId ||
          fresh.grant.workItemRevision !== workItemRevision || fresh.grant.documentVersionId !== base.documentVersionId)
          throw correctionError('JOBAID_CORRECTION_AUTHORIZATION_CHANGED', 403);
        await this.jobAid.assertManualCorrectionEvidence(base.content.evidence,
          { tenantId, actorUserId }, workItemId, database);
      } };
  }

  async save(workItemId: string, raw: unknown, request: Request): Promise<JobAidWorkCorrectionReceipt> {
    const command: JobAidWorkCorrectionRequest = parseJobAidWorkCorrectionRequest(raw);
    const authorized = await this.owner(workItemId, request);
    const scope = this.scope(authorized, request);
    const saved = await this.work.saveManualCorrection({ ...scope, request: command });
    // Commit/readback is the ordinary receipt recovery path; current authority is checked again.
    const readback = await this.work.readManualCorrection({ ...scope, requestId: command.requestId });
    if (readback.workRevisionRef !== saved.workRevisionRef || readback.executionAttemptId !== saved.executionAttemptId)
      throw correctionError('JOBAID_CORRECTION_READBACK_CONFLICT');
    return { ...readback, replayed: saved.replayed };
  }

  async read(workItemId: string, requestId: string, request: Request): Promise<JobAidWorkCorrectionReceipt> {
    if (!/^[A-Za-z0-9:_-]{1,96}$/u.test(requestId))
      throw correctionError('JOBAID_CORRECTION_REQUEST_INVALID', 400);
    const authorized = await this.owner(workItemId, request);
    return this.work.readManualCorrection({ ...this.scope(authorized, request), requestId });
  }
}
