import { AsyncLocalStorage } from 'node:async_hooks';
import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { SqlExecutionContextMiddleware } from '@lark-apaas/fullstack-nestjs-core';
import type { Request, Response } from 'express';
import { miaodaHostedFinalUserActor } from '../work-item/production-miaoda-browser-ingress';

import { SessionStore } from './session.store';
import type { VerifiedIdentity } from './identity.types';
import { buildActorContextFromVerifiedIdentity } from './actor-context.builder';
import type { CanonicalMiaodaFinalUserActorContext } from '../work-item/canonical-object-access.port';
import { OAUTH_CONFIG, type OAuthConfigPort } from './oauth-config.port';

/**
 * Resolves a server-side opaque session from the incoming HTTP request.
 *
 * The session token is extracted only from the `wl_session` HttpOnly cookie.
 * It is NEVER read from query params or request body — those are
 * caller-constructible channels (R08 violation).
 *
 * Fail-closed: any missing/malformed/unknown/expired token yields null.
 * The caller MUST treat null as "no authenticated actor" and deny.
 */
export interface ResolvedSession {
  identity: VerifiedIdentity;
  actor: CanonicalMiaodaFinalUserActorContext;
  session: { id: string; revision: number; expiresAt: Date };
}

@Injectable()
export class SessionResolver {
  private readonly requestSession = new AsyncLocalStorage<{
    request: Request;
    session: ResolvedSession | null;
  }>();

  /** Reuse an identity verified before a server-only SQL scope, for this request only. */
  async withRequestSession<T>(
    request: Request,
    operation: (session: ResolvedSession | null) => Promise<T>,
  ): Promise<T> {
    const session = await this.resolve(request);
    return this.requestSession.run({ request, session }, () =>
      operation(session),
    );
  }

  constructor(
    private readonly sessionStore: SessionStore,
    @Inject(OAUTH_CONFIG)
    private readonly oauthConfig: OAuthConfigPort,
    private readonly sqlContext?: SqlExecutionContextMiddleware,
  ) {}

  /** Enter only after the current request's opaque session and native identity agree. */
  withVerifiedServiceSql<T>(
    operation: () => Promise<T>,
    expectedActorId?: string,
  ): Promise<T> {
    const verified = this.verifiedSqlRequest(expectedActorId);
    return this.runSql(
      {
        userContext: {
          userId: verified.session.actor.canonicalSubject.id,
          isSystemAccount: true,
          roles: [],
        },
      } as Request,
      operation,
    );
  }

  /** Restore the same native browser SQL identity for existing browser-only writes. */
  withVerifiedBrowserSql<T>(operation: () => Promise<T>): Promise<T> {
    return this.runSql(this.verifiedSqlRequest().request, operation);
  }

  private verifiedSqlRequest(expectedActorId?: string) {
    const verified = this.requestSession.getStore();
    if (
      !verified?.session ||
      verified.session.session.expiresAt.getTime() <= Date.now()
    )
      throw new UnauthorizedException('OFFICIAL_OAUTH_SESSION_REQUIRED');
    const native = miaodaHostedFinalUserActor(verified.request.userContext);
    const actor = verified.session.actor;
    if (
      !/^[A-Za-z0-9_-]{1,255}$/u.test(actor.canonicalSubject.id) ||
      native.canonicalSubject.id !== actor.canonicalSubject.id ||
      native.tenantId !== actor.tenantId ||
      native.applicationScopeId !== actor.applicationScopeId ||
      (expectedActorId !== undefined &&
        expectedActorId !== actor.canonicalSubject.id)
    )
      throw new ForbiddenException('DIALOGUE_BROWSER_IDENTITY_MISMATCH');
    return { request: verified.request, session: verified.session };
  }

  private runSql<T>(request: Request, operation: () => Promise<T>): Promise<T> {
    if (!this.sqlContext)
      throw new ForbiddenException('VERIFIED_SQL_CONTEXT_UNAVAILABLE');
    return new Promise<T>((resolve, reject) => {
      this.sqlContext!.use(request, {} as Response, () => {
        void Promise.resolve().then(operation).then(resolve, reject);
      });
    });
  }

  /**
   * Resolve the session from the request. Returns null when:
   * - No cookie is present
   * - The token is unknown or expired
   *
   * Returns a ResolvedSession when the token is valid. The actor context
   * is built from the server-stored VerifiedIdentity, NOT from any
   * caller-asserted field.
   */
  async resolve(httpRequest: Request): Promise<ResolvedSession | null> {
    const verified = this.requestSession.getStore();
    if (verified?.request === httpRequest) {
      return verified.session &&
        verified.session.session.expiresAt.getTime() > Date.now()
        ? verified.session
        : null;
    }
    const token = this.extractToken(httpRequest);
    if (!token) return null;

    const session = await this.sessionStore.validate(token);
    if (!session) return null;

    const { identity, revision } = session;

    const applicationScopeId = this.oauthConfig.applicationScopeId;
    const env = this.oauthConfig.sessionEnvironment;

    const actor = buildActorContextFromVerifiedIdentity(
      identity,
      { sessionId: session.sessionId, sessionRevision: revision },
      applicationScopeId,
      env,
    );

    return {
      identity,
      actor,
      session: {
        id: session.sessionId,
        revision,
        expiresAt: session.expiresAt,
      },
    };
  }

  /**
   * Extract the opaque session token from the httpOnly cookie only.
   * Never reads from query params or body.
   */
  private extractToken(httpRequest: Request): string | null {
    const cookieHeader = httpRequest.headers?.cookie;
    if (typeof cookieHeader === 'string') {
      const match = cookieHeader
        .split(';')
        .map((c) => c.trim())
        .find((c) => c.startsWith('wl_session='));
      if (match) {
        const token = match.slice('wl_session='.length).trim();
        if (token.length > 0) return token;
      }
    }

    return null;
  }
}
