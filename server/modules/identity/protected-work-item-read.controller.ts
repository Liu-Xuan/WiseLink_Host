import {
  Controller,
  Get,
  Inject,
  Param,
  Req,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';

import { SessionResolver } from './session-resolver.service';
import {
  CANONICAL_OBJECT_ACCESS,
  type CanonicalObjectAccessInput,
  type CanonicalObjectAccessPort,
} from '../work-item/canonical-object-access.port';
import { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';

/**
 * Protected WorkItem read endpoint — the primary "protected read path"
 * for the Feishu identity vertical.
 *
 * GET /api/identity/work-items/:workItemId
 *
 * Access control (all must pass, in order):
 * 1. A valid server-side opaque session must exist (Bearer token or
 *    httpOnly cookie). No session → 401.
 * 2. The session's VerifiedIdentity is converted to a FINAL_USER
 *    CanonicalActorContext (Feishu OAuth provenance + server session).
 * 3. The actor is submitted to the real CanonicalObjectAccessPort with
 *    action READ_WORK_ITEM and the requested workItemId as accessRoot.
 * 4. Only if the port returns allowed: true does the endpoint proceed.
 *    Any denial (503, 404, 409) is returned to the caller.
 *
 * R08 invariants:
 * - The workItemId in the URL path is NOT a trust source — it is only
 *   the object being accessed. The actor identity comes exclusively from
 *   the server session.
 * - No caller header, body, or query field can influence the actor.
 * - Object ID is not permission: even with a valid session, a non-owner
 *   or cross-tenant request is denied by the ACL port (404 to avoid
 *   leaking existence).
 */
@Controller('api/identity/work-items')
export class ProtectedWorkItemReadController {
  private readonly logger = new Logger(ProtectedWorkItemReadController.name);

  constructor(
    private readonly sessionResolver: SessionResolver,
    @Inject(CANONICAL_OBJECT_ACCESS)
    private readonly objectAccess: CanonicalObjectAccessPort,
    private readonly workItems: MiaodaWorkItemRepository,
  ) {}

  @Get()
  async listMyWorkItems(@Req() httpRequest: Request) {
    const session = await this.requireSession(httpRequest);
    const items = await this.workItems.listOwnedWorkItems({
      tenantId: session.actor.tenantId,
      actorUserId: session.actor.canonicalSubject.id,
    });
    return {
      items: items.map((item) => ({
        workItemId: item.workItemId,
        revision: item.revision,
        status: item.status,
        actionType: item.actionType,
        documentId: item.documentId,
        documentVersionId: item.documentVersionId,
        requestId: item.requestId,
        runKey: item.runKey,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
    };
  }

  @Get(':workItemId')
  async readWorkItem(
    @Param('workItemId') workItemId: string,
    @Req() httpRequest: Request,
  ) {
    // 1. Resolve server-side session — no session → 401
    const session = await this.requireSession(httpRequest);

    // 2. Validate the workItemId is a non-empty string
    if (!workItemId || workItemId.trim() === '') {
      throw new HttpException(
        {
          code: 'WORK_ITEM_ID_REQUIRED',
          message: 'A work item id is required.',
          statusCode: 400,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // 3. ACL preflight: submit the verified actor to the real
    //    CanonicalObjectAccessPort with READ_WORK_ITEM.
    const input: CanonicalObjectAccessInput = {
      actor: session.actor,
      action: 'READ_WORK_ITEM',
      accessRoot: { kind: 'WORK_ITEM', id: workItemId },
    };

    const accessResult = await this.objectAccess.freshRead(input);

    // 4. Fail-closed: any denial is returned to the caller.
    if (accessResult.allowed === false) {
      this.logger.warn(
        `WorkItem read denied: workItemId=${workItemId} ` +
          `code=${accessResult.code} statusCode=${accessResult.statusCode} ` +
          `denialSource=${accessResult.denialSource}`,
      );
      throw new HttpException(
        {
          code: accessResult.code,
          message: 'Access denied to the requested work item.',
          statusCode: accessResult.statusCode,
          denialSource: accessResult.denialSource,
        },
        accessResult.statusCode,
      );
    }

    // 5. Grant — return minimal confirmation. The actual WorkItem
    //    projection is NOT exposed here (this is the identity vertical's
    //    protected seam, not a full data API). A future endpoint may
    //    load the projection via the registrar after the ACL grant.
    const fresh = await this.workItems.loadTenantScopedProjection(
      accessResult.workItemId,
      session.actor.tenantId,
    );
    if (!fresh) {
      throw new HttpException(
        { code: 'CANONICAL_WORK_ITEM_NOT_FOUND', statusCode: 404 },
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      workItemId: accessResult.workItemId,
      revision: fresh.row.revision,
      status: fresh.row.status,
      documentVersionId: fresh.row.documentVersionId,
      projection: fresh.projection,
      access: { allowed: true as const },
      actor: {
        identityProvenance: session.actor.identityProvenance,
        miaodaUserId: session.actor.canonicalSubject.id,
        tenantId: session.actor.tenantId,
        sessionProvenance: session.actor.sessionProvenance,
      },
    };
  }

  private async requireSession(httpRequest: Request) {
    const session = await this.sessionResolver.resolve(httpRequest);
    if (session) return session;
    throw new HttpException(
      {
        code: 'SESSION_REQUIRED',
        message:
          'A valid server-side session is required. Complete Feishu OAuth first.',
        statusCode: 401,
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}
