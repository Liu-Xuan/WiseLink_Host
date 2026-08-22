import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

/**
 * Server-side, opaque, one-time, TTL-bound OAuth state store.
 *
 * The state token is an opaque random string — it carries no identity
 * information and cannot be constructed by the caller. Each state is
 * issued for exactly one authorize→callback round-trip:
 *
 * 1. `issue(codeVerifier)` — called when the server begins an OAuth flow.
 *    Stores the PKCE code_verifier alongside the state.
 * 2. `consume(state)` — called when the callback arrives. The state is
 *    single-use: it is deleted immediately upon consumption, and a
 *    replayed state returns null. Expired states are also null.
 *
 * Fail-closed: any error (missing, already-consumed, expired, malformed)
 * returns null — the caller MUST treat null as "deny the callback".
 *
 * In-memory — suitable for DEV/UAT single-instance. A future production
 * adapter would use a TTL-scoped Redis or database table.
 */
@Injectable()
export class OauthStateStore {
  private static readonly TTL_MS = 5 * 60 * 1000; // 5 minutes

  private readonly states = new Map<
    string,
    { codeVerifier: string; createdAt: number; consumed: boolean }
  >();

  /**
   * Issue a new one-time state, binding it to the given PKCE code_verifier.
   * Returns an opaque state token that the browser receives in the
   * authorize redirect URL.
   */
  issue(codeVerifier: string): string {
    const state = this.generateToken();
    this.states.set(state, {
      codeVerifier,
      createdAt: Date.now(),
      consumed: false,
    });
    this.cleanup();
    return state;
  }

  /**
   * Consume a state token. Returns the bound code_verifier if the state
   * is valid, unconsumed, and unexpired. Returns null otherwise.
   *
   * One-time semantics: the state is deleted immediately upon successful
   * consumption. A second call with the same token returns null.
   */
  consume(state: string): { codeVerifier: string } | null {
    if (!state || state.length === 0) return null;
    const entry = this.states.get(state);
    if (!entry) return null;
    if (entry.consumed) return null;
    if (Date.now() - entry.createdAt > OauthStateStore.TTL_MS) {
      this.states.delete(state);
      return null;
    }
    // One-time: delete immediately so a replay cannot succeed.
    this.states.delete(state);
    return { codeVerifier: entry.codeVerifier };
  }

  /**
   * Remove expired states to prevent unbounded growth. Called on each
   * issue. Also callable from a periodic cleanup timer in the future.
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.states) {
      if (now - entry.createdAt > OauthStateStore.TTL_MS) {
        this.states.delete(key);
      }
    }
  }

  private generateToken(): string {
    return randomBytes(32).toString('base64url');
  }
}
