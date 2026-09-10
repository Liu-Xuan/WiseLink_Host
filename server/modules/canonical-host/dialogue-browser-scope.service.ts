import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { SqlExecutionContextMiddleware } from '@lark-apaas/fullstack-nestjs-core';
import type { Request, Response } from 'express';
import { SessionResolver } from '../identity/session-resolver.service';
import { miaodaHostedFinalUserActor } from '../work-item/production-miaoda-browser-ingress';

/** Server-only SQL scope for this controller, after both independent identities agree. */
@Injectable()
export class DialogueBrowserScope {
  constructor(
    private readonly sessions: SessionResolver,
    private readonly sqlContext: SqlExecutionContextMiddleware,
  ) {}

  async run<T>(request: Request, operation: () => Promise<T>): Promise<T> {
    // Neither JSON/header actor fields nor background system callers qualify.
    // This helper checks native Hosted provenance before resolving the opaque cookie.
    const native = miaodaHostedFinalUserActor(request.userContext);
    return this.sessions.withRequestSession(request, async (session) => {
      if (!session)
        throw new UnauthorizedException('OFFICIAL_OAUTH_SESSION_REQUIRED');
      const actorId = session.actor.canonicalSubject.id;
      if (
        !/^[A-Za-z0-9_-]{1,255}$/u.test(actorId) ||
        native.canonicalSubject.id !== actorId ||
        native.tenantId !== session.actor.tenantId ||
        native.applicationScopeId !== session.actor.applicationScopeId
      )
        throw new ForbiddenException('DIALOGUE_BROWSER_IDENTITY_MISMATCH');

      // Only the SQL async context changes; the original request and platform
      // identity remain intact. Existing repositories still enforce service-role
      // provenance and per-actor RLS. No browser/raw-table policy is opened.
      return new Promise<T>((resolve, reject) => {
        this.sqlContext.use(
          {
            userContext: { userId: actorId, isSystemAccount: true, roles: [] },
          } as Request,
          {} as Response,
          () => {
            void Promise.resolve().then(operation).then(resolve, reject);
          },
        );
      });
    });
  }
}
