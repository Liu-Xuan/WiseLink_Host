import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { VerifiedIdentity } from './identity.types';

/**
 * Server-side opaque session store.
 *
 * After a successful Feishu OAuth callback, a session is created binding
 * an opaque random token to the VerifiedIdentity. The token is returned
 * to the client (via httpOnly cookie or JSON body) and must be presented
 * on subsequent protected requests.
 *
 * The token is opaque — it carries no identity information and cannot be
 * constructed by the caller. The VerifiedIdentity is stored server-side
 * only; the client never sees feishu_open_id, tenant_key, or miaoda_user_id
 * in the token itself.
 *
 * TTL: sessions expire after SESSION_TTL_MS. An expired session returns
 * null on validation — the caller MUST treat null as "no authenticated
 * actor".
 *
 * In-memory — suitable for DEV/UAT single-instance. A future production
 * adapter would use Redis or a database session table.
 */
@Injectable()
export class SessionStore {
  private static readonly TTL_MS = 30 * 60 * 1000; // 30 minutes

  private readonly sessions = new Map<
    string,
    {
      identity: VerifiedIdentity;
      createdAt: number;
      expiresAt: number;
      revision: number;
    }
  >();
  private revisionCounter = 0;

  /**
   * Create a new session for a verified identity. Returns the opaque
   * session token and the expiry timestamp.
   */
  create(identity: VerifiedIdentity): {
    token: string;
    expiresAt: number;
  } {
    const token = this.generateToken();
    const now = Date.now();
    const expiresAt = now + SessionStore.TTL_MS;
    this.sessions.set(token, {
      identity,
      createdAt: now,
      expiresAt,
      revision: ++this.revisionCounter,
    });
    this.cleanup();
    return { token, expiresAt };
  }

  /**
   * Validate a session token. Returns the bound VerifiedIdentity and
   * session revision if the token is valid and unexpired. Returns null
   * if the token is missing, unknown, or expired.
   *
   * The session is NOT consumed — it can be used multiple times until
   * it expires or is revoked. (Unlike OAuth state, sessions are
   * multi-use.)
   */
  validate(token: string): {
    identity: VerifiedIdentity;
    revision: number;
  } | null {
    if (!token || token.length === 0) return null;
    const entry = this.sessions.get(token);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.sessions.delete(token);
      return null;
    }
    return { identity: entry.identity, revision: entry.revision };
  }

  /**
   * Revoke a session immediately. Idempotent — returns true if a session
   * was actually removed, false if the token was unknown or already gone.
   */
  revoke(token: string): boolean {
    return this.sessions.delete(token);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.sessions) {
      if (now >= entry.expiresAt) {
        this.sessions.delete(key);
      }
    }
  }

  private generateToken(): string {
    return randomBytes(32).toString('base64url');
  }
}
