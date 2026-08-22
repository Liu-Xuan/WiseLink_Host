import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { SessionStore } from './session.store';
import type { VerifiedIdentity } from './identity.types';
import { buildActorContextFromVerifiedIdentity } from './actor-context.builder';
import type { CanonicalMiaodaFinalUserActorContext } from '../work-item/canonical-object-access.port';
import { OAUTH_CONFIG, type OAuthConfigPort } from './oauth-config.port';

/**
 * Resolves a server-side opaque session from the incoming HTTP request.
 *
 * The session token is extracted from the `Authorization: Bearer <token>`
 * header (preferred) or a `wl_session` httpOnly cookie (DEV browser flow).
 * It is NEVER read from query params or request body — those are
 * caller-constructible channels (R08 violation).
 *
 * Fail-closed: any missing/malformed/unknown/expired token yields null.
 * The caller MUST treat null as "no authenticated actor" and deny.
 */
export interface ResolvedSession {
  identity: VerifiedIdentity;
  actor: CanonicalMiaodaFinalUserActorContext;
}

@Injectable()
export class SessionResolver {
  constructor(
    private readonly sessionStore: SessionStore,
    @Inject(OAUTH_CONFIG)
    private readonly oauthConfig: OAuthConfigPort,
  ) {}

  /**
   * Resolve the session from the request. Returns null when:
   * - No Bearer token or cookie is present
   * - The token is unknown or expired
   *
   * Returns a ResolvedSession when the token is valid. The actor context
   * is built from the server-stored VerifiedIdentity, NOT from any
   * caller-asserted field.
   */
  resolve(httpRequest: Request): ResolvedSession | null {
    const token = this.extractToken(httpRequest);
    if (!token) return null;

    const session = this.sessionStore.validate(token);
    if (!session) return null;

    const { identity, revision } = session;

    // `userContext` is injected by the platform gateway middleware. It is
    // NOT a standard Express Request field, so we access it defensively
    // via a structural cast — this compiles under both tsc (with the
    // platform's type augmentation) and ts-node (without it).
    const userContext = (
      httpRequest as { userContext?: { appId?: string; env?: string } }
    ).userContext;
    const applicationScopeId = userContext?.appId ?? 'app_unknown';
    const env =
      userContext?.env ?? process.env.NODE_ENV ?? 'development';

    const actor = buildActorContextFromVerifiedIdentity(
      identity,
      { sessionId: token, sessionRevision: revision },
      applicationScopeId,
      env,
    );

    return { identity, actor };
  }

  /**
   * Extract the opaque session token from the request. Checks
   * Authorization: Bearer first, then the httpOnly cookie.
   * Never reads from query params or body.
   */
  private extractToken(httpRequest: Request): string | null {
    // 1. Authorization: Bearer <token>
    const authHeader = httpRequest.headers?.authorization;
    if (
      typeof authHeader === 'string' &&
      authHeader.startsWith('Bearer ')
    ) {
      const token = authHeader.slice(7).trim();
      if (token.length > 0) return token;
    }

    // 2. httpOnly cookie (DEV browser flow)
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
