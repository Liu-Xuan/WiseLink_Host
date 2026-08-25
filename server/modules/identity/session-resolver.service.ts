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
  constructor(
    private readonly sessionStore: SessionStore,
    @Inject(OAUTH_CONFIG)
    private readonly oauthConfig: OAuthConfigPort,
  ) {}

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
