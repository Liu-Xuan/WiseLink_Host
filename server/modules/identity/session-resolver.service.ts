import { AsyncLocalStorage } from 'node:async_hooks';
import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  SqlExecutionContextMiddleware,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
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

/** Hosted browser identity. OAuth is present only for a matching external grant. */
export interface NativeBrowserIdentity {
  actor: CanonicalMiaodaFinalUserActorContext;
  oauthSession: ResolvedSession | null;
}

@Injectable()
export class SessionResolver {
  private readonly requestSession = new AsyncLocalStorage<{
    request: Request;
    session: ResolvedSession | null;
  }>();
  private readonly browserIdentity = new AsyncLocalStorage<{
    request: Request;
    identity: NativeBrowserIdentity;
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

  async withNativeBrowserIdentity<T>(
    request: Request,
    operation: (identity: NativeBrowserIdentity) => Promise<T>,
  ): Promise<T> {
    const actor = miaodaHostedFinalUserActor(request.userContext);
    const session = await this.resolve(request);
    if (session && (
      session.actor.canonicalSubject.id !== actor.canonicalSubject.id ||
      session.actor.tenantId !== actor.tenantId ||
      session.actor.applicationScopeId !== actor.applicationScopeId
    )) throw new ForbiddenException('DIALOGUE_BROWSER_IDENTITY_MISMATCH');
    const oauthSession = session;
    const identity: NativeBrowserIdentity = { actor, oauthSession };
    return this.browserIdentity.run({ request, identity }, () =>
      operation(identity),
    );
  }

  nativeBrowserIdentity(request: Request): NativeBrowserIdentity {
    const verified = this.browserIdentity.getStore();
    if (!verified || verified.request !== request)
      throw new UnauthorizedException('NATIVE_BROWSER_IDENTITY_REQUIRED');
    const native = miaodaHostedFinalUserActor(request.userContext);
    if (
      native.canonicalSubject.id !== verified.identity.actor.canonicalSubject.id ||
      native.tenantId !== verified.identity.actor.tenantId ||
      native.applicationScopeId !== verified.identity.actor.applicationScopeId
    ) throw new ForbiddenException('DIALOGUE_BROWSER_IDENTITY_MISMATCH');
    return verified.identity;
  }

  /** Review and dialogue only: retain the real browser actor under service RLS. */
  withVerifiedNativeBrowserServiceSql<T>(operation: () => Promise<T>): Promise<T> {
    const verified = this.browserIdentity.getStore();
    if (!verified) throw new UnauthorizedException('NATIVE_BROWSER_IDENTITY_REQUIRED');
    const actor = this.nativeBrowserIdentity(verified.request).actor;
    return this.runSql({
      userContext: {
        userId: actor.canonicalSubject.id,
        tenantId: actor.tenantId,
        appId: actor.applicationScopeId,
        env: actor.env,
        isSystemAccount: true,
        roles: [...actor.platformRoles],
      },
    } as unknown as Request, operation);
  }

  /** Existing review transaction may run under OAuth or native browser scope. */
  withVerifiedReviewServiceSql<T>(
    operation: () => Promise<T>,
    expectedActorId: string,
  ): Promise<T> {
    const verified = this.browserIdentity.getStore();
    if (!verified) return this.withVerifiedServiceSql(operation, expectedActorId);
    const actor = this.nativeBrowserIdentity(verified.request).actor;
    if (actor.canonicalSubject.id !== expectedActorId)
      throw new ForbiddenException('DIALOGUE_BROWSER_IDENTITY_MISMATCH');
    return this.withVerifiedNativeBrowserServiceSql(operation);
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

  /** Preserve the legacy OAuth-backed browser SQL contract. */
  withVerifiedBrowserSql<T>(operation: () => Promise<T>): Promise<T> {
    return this.runSql(this.verifiedSqlRequest().request, operation);
  }

  /** Native authenticated SQL; never impersonates a service or another owner. */
  withVerifiedNativeBrowserSql<T>(operation: () => Promise<T>): Promise<T> {
    const verified = this.browserIdentity.getStore();
    if (!verified) throw new UnauthorizedException('NATIVE_BROWSER_IDENTITY_REQUIRED');
    this.nativeBrowserIdentity(verified.request);
    return this.runSql(verified.request, operation);
  }

  /** Review's dialogue bridge accepts either existing OAuth or native SSO. */
  withVerifiedReviewBrowserSql<T>(operation: () => Promise<T>): Promise<T> {
    return this.browserIdentity.getStore()
      ? this.withVerifiedNativeBrowserSql(operation)
      : this.withVerifiedBrowserSql(operation);
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
  async resolve(
    httpRequest: Request,
    database?: PostgresJsDatabase,
  ): Promise<ResolvedSession | null> {
    const verified = this.requestSession.getStore();
    // A commit-time read must recheck revocation and expiry in its transaction.
    if (!database && verified?.request === httpRequest) {
      return verified.session &&
        verified.session.session.expiresAt.getTime() > Date.now()
        ? verified.session
        : null;
    }
    const token = this.extractToken(httpRequest);
    if (!token) return null;

    const session = database
      ? await this.sessionStore.validate(token, database)
      : await this.sessionStore.validate(token);
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
