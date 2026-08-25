import { Injectable } from '@nestjs/common';

export const FEISHU_OAUTH_TOKEN_HTTP = Symbol('FEISHU_OAUTH_TOKEN_HTTP');

/**
 * Response from the official Feishu OAuth v3 token endpoint
 * (authorization_code grant). Only fields needed for identity
 * verification are captured.
 */
export interface FeishuOAuthTokenResponse {
  /** User access token — used to call Feishu open-apis. */
  accessToken: string;
  /** Token type — always "Bearer" in practice. */
  tokenType: string;
  /** Token lifetime in seconds. */
  expiresIn: number;
  /** Refresh token — present when the offline_access scope is granted. */
  refreshToken: string | null;
}

export interface FeishuOAuthTokenHttpPort {
  /**
   * Exchanges an authorization_code for an access_token via the official
   * Feishu OAuth v3 token endpoint. Returns null on any failure
   * (HTTP error, API error, network, timeout, malformed response).
   */
  fetchToken(input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
    /** PKCE code_verifier — required (PKCE is always used). */
    codeVerifier: string;
  }): Promise<FeishuOAuthTokenResponse | null>;
}

/**
 * Minimal fetch-like transport signature for the Feishu OAuth v3 token
 * endpoint. Structurally compatible with the global `fetch` so that
 * production wiring can pass `globalThis.fetch`, while tests inject
 * a trivial mock.
 */
export type FeishuOAuthTokenFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/**
 * Default adapter — always returns null (unavailable) because
 * no Feishu OAuth app credentials are configured. A future
 * HttpFeishuOAuthTokenAdapter will replace this once the Feishu
 * client_id/client_secret and redirect_uri are provisioned.
 */
@Injectable()
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class UnavailableFeishuOAuthTokenHttpAdapter
  implements FeishuOAuthTokenHttpPort
{
  async fetchToken(_input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<FeishuOAuthTokenResponse | null> {
    return null;
  }
}

/**
 * HTTP adapter that calls the official Feishu OAuth v3 token endpoint
 * (accounts.feishu.cn/oauth/v3/token) with a server-injected
 * authorization_code. Designed for DEV/UAT manual injection — NOT
 * registered in IdentityModule. The project default environment never
 * instantiates this class, so it never networks.
 *
 * Fail-closed: non-2xx, API code non-zero, network error, timeout/abort,
 * or malformed JSON/fields all return null — never throws, never logs
 * client_secret, code, or token.
 */
@Injectable()
// Private seam — not wired in any module; supplied via manual / custom
// provider in DEV/UAT only.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class HttpFeishuOAuthTokenAdapter implements FeishuOAuthTokenHttpPort {
  private static readonly TOKEN_URL =
    'https://accounts.feishu.cn/oauth/v3/token';
  private static readonly DEFAULT_TIMEOUT_MS = 5000;

  constructor(
    private readonly fetchImpl: FeishuOAuthTokenFetch,
    private readonly timeoutMs: number = HttpFeishuOAuthTokenAdapter.DEFAULT_TIMEOUT_MS,
  ) {}

  async fetchToken(input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<FeishuOAuthTokenResponse | null> {
    const { clientId, clientSecret, code, redirectUri, codeVerifier } = input;

    // Defensive: all params must be non-empty, including codeVerifier.
    // The caller should guard these, but the adapter must be safe in
    // isolation too. PKCE is always required — a missing or blank
    // code_verifier means no fetch occurs.
    if (
      !clientId ||
      clientId.trim() === '' ||
      !clientSecret ||
      clientSecret.trim() === '' ||
      !code ||
      code.trim() === '' ||
      !redirectUri ||
      redirectUri.trim() === '' ||
      !codeVerifier ||
      codeVerifier.trim() === ''
    ) {
      return null;
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }).toString();

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.timeoutMs,
    );

    try {
      const response = await this.fetchImpl(
        HttpFeishuOAuthTokenAdapter.TOKEN_URL,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body,
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        return null;
      }

      const jsonBody: unknown = await response.json();
      return HttpFeishuOAuthTokenAdapter.parseToken(jsonBody);
    } catch {
      // Swallow ALL errors — network failure, abort/timeout, JSON parse
      // error, etc. Never rethrow; never log (secret/code/token could
      // be in error).
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Parse the Feishu OAuth v3 token response body. Returns null when:
   * - body is not a JSON object
   * - top-level `code` is a non-zero number (API-level error)
   * - `access_token` is missing, non-string, or empty
   * - `token_type` is missing, non-string, or empty
   * - `expires_in` is missing, non-number, or not finite
   *
   * `refresh_token` is optional — null when absent or non-string.
   *
   * Note: the token endpoint's success response has no `code` field;
   * error responses include a non-zero numeric `code`.
   */
  private static parseToken(body: unknown): FeishuOAuthTokenResponse | null {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return null;
    }

    const obj = body as Record<string, unknown>;

    // Token endpoint success responses have no `code` field.
    // Error responses include a non-zero numeric `code` — fail closed.
    if (typeof obj.code === 'number' && obj.code !== 0) {
      return null;
    }

    const {
      access_token: accessToken,
      token_type: tokenType,
      expires_in: expiresIn,
      refresh_token: refreshToken,
    } = obj;

    if (typeof accessToken !== 'string' || accessToken === '') {
      return null;
    }
    if (typeof tokenType !== 'string' || tokenType === '') {
      return null;
    }
    if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn)) {
      return null;
    }

    return {
      accessToken,
      tokenType,
      expiresIn,
      refreshToken: typeof refreshToken === 'string' ? refreshToken : null,
    };
  }
}
