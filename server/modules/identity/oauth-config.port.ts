import { Injectable } from '@nestjs/common';

export const OAUTH_CONFIG = Symbol('OAUTH_CONFIG');

/**
 * Server-side OAuth configuration port.
 *
 * Reads Feishu OAuth app credentials from the runtime environment.
 * When any required value is missing, `configured` is false and every
 * OAuth-flow endpoint returns 503 (fail-closed).
 *
 * R08 / security:
 * - client_secret is NEVER exposed through this interface. It is read
 *   directly from process.env inside the token-exchange service, only
 *   at the moment of exchange, and never stored in a field.
 * - No credential is ever logged or returned in a response body.
 */
export interface OAuthConfigPort {
  /** Feishu OAuth app client_id (e.g. "cli_xxx"). Null when unconfigured. */
  readonly clientId: string | null;
  /** The server's own callback URL. Null when unconfigured. */
  readonly redirectUri: string | null;
  /** True only when clientId + clientSecret + redirectUri are all present. */
  readonly configured: boolean;
}

/**
 * Default adapter — reads from process.env at construction time.
 *
 * In the project default environment (no .env, no provisioned Feishu
 * app), every field is null and `configured` is false → all OAuth-flow
 * endpoints return 503.
 */
@Injectable()
// Supplied through IdentityModule; the static lint rule cannot follow the
// Symbol token provider.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class EnvOauthConfigAdapter implements OAuthConfigPort {
  private readonly _clientId: string | null;
  private readonly _redirectUri: string | null;
  private readonly _configured: boolean;

  constructor() {
    const clientId = process.env.FEISHU_OAUTH_CLIENT_ID;
    const clientSecret = process.env.FEISHU_OAUTH_CLIENT_SECRET;
    const redirectUri = process.env.FEISHU_OAUTH_REDIRECT_URI;

    this._clientId = clientId || null;
    this._redirectUri = redirectUri || null;
    this._configured = Boolean(clientId && clientSecret && redirectUri);
  }

  get clientId(): string | null {
    return this._clientId;
  }

  get redirectUri(): string | null {
    return this._redirectUri;
  }

  get configured(): boolean {
    return this._configured;
  }
}
