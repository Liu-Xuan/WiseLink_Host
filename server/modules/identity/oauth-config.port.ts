import { Injectable } from '@nestjs/common';

export const OAUTH_CONFIG = Symbol('OAUTH_CONFIG');

export type FeishuOAuthTokenApiVersion = 'v2' | 'v3';

/**
 * R08-approved, temporary official compatibility mode for DEV/UAT only.
 * The long-term/default token contract remains v3.
 */
export const FEISHU_OAUTH_V2_COMPATIBILITY_MODE =
  'OFFICIAL_TEMPORARY_COMPATIBILITY' as const;

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
  /** The Hosted SPA callback URL registered with Feishu. */
  readonly redirectUri: string | null;
  /**
   * Official token endpoint selected before OAuth start. Unknown runtime
   * values are represented as null so the flow fails closed before state
   * issuance. An absent setting defaults to the long-term v3 contract.
   */
  readonly tokenApiVersion: FeishuOAuthTokenApiVersion | null;
  /** True only when credentials, redirect URI, and token version are valid. */
  readonly configured: boolean;
  readonly applicationScopeId: 'app_17bzc551rsg';
  readonly sessionEnvironment: 'preview' | 'runtime';
}

/**
 * Default adapter — reads from process.env at construction time.
 *
 * In the project default environment (no .env, no provisioned Feishu
 * app), credentials/redirect are null and `configured` is false → all
 * OAuth-flow endpoints return 503. The absent version setting resolves to v3.
 */
@Injectable()
// Supplied through IdentityModule; the static lint rule cannot follow the
// Symbol token provider.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class EnvOauthConfigAdapter implements OAuthConfigPort {
  readonly applicationScopeId = 'app_17bzc551rsg' as const;
  readonly sessionEnvironment = 'preview' as const;
  private readonly _clientId: string | null;
  private readonly _redirectUri: string | null;
  private readonly _tokenApiVersion: FeishuOAuthTokenApiVersion | null;
  private readonly _configured: boolean;

  constructor() {
    const clientId = process.env.FEISHU_OAUTH_CLIENT_ID;
    const clientSecret = process.env.FEISHU_OAUTH_CLIENT_SECRET;
    const redirectUri = process.env.FEISHU_OAUTH_REDIRECT_URI;
    const tokenApiVersion = resolveTokenApiVersion(
      process.env.FEISHU_OAUTH_TOKEN_API_VERSION,
    );

    this._clientId = clientId || null;
    this._redirectUri = redirectUri || null;
    this._tokenApiVersion = tokenApiVersion;
    this._configured = Boolean(
      clientId && clientSecret && redirectUri && tokenApiVersion,
    );
  }

  get clientId(): string | null {
    return this._clientId;
  }

  get redirectUri(): string | null {
    return this._redirectUri;
  }

  get tokenApiVersion(): FeishuOAuthTokenApiVersion | null {
    return this._tokenApiVersion;
  }

  get configured(): boolean {
    return this._configured;
  }
}

function resolveTokenApiVersion(
  configuredValue: string | undefined,
): FeishuOAuthTokenApiVersion | null {
  if (configuredValue === undefined) {
    return 'v3';
  }
  if (configuredValue === 'v2' || configuredValue === 'v3') {
    return configuredValue;
  }
  return null;
}
