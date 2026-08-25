import { Injectable } from '@nestjs/common';

import type { FeishuOAuthTokenApiVersion } from './oauth-config.port';

export const FEISHU_OAUTH_TOKEN_HTTP = Symbol('FEISHU_OAUTH_TOKEN_HTTP');

/**
 * Response from an official Feishu OAuth token endpoint
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

export type FeishuOAuthTokenFailureClassification =
  | 'UPSTREAM_HTTP_ERROR'
  | 'UPSTREAM_OAUTH_ERROR'
  | 'MALFORMED_RESPONSE'
  | 'NETWORK_ERROR'
  | 'TIMEOUT';

/**
 * Allowlisted diagnostics for a failed token exchange. This deliberately
 * excludes request fields, response descriptions, credentials, protocol
 * material, and tokens.
 */
export interface FeishuOAuthTokenFailureDiagnostic {
  event: 'FEISHU_OAUTH_TOKEN_EXCHANGE_FAILED';
  classification: FeishuOAuthTokenFailureClassification;
  httpStatus?: number;
  upstreamCode?: number;
  upstreamError?: string;
}

export type FeishuOAuthTokenFailureReporter = (
  diagnostic: FeishuOAuthTokenFailureDiagnostic,
) => void;

export interface FeishuOAuthTokenRequest {
  /** Selected by strict server configuration before OAuth start. */
  apiVersion: FeishuOAuthTokenApiVersion;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  /** PKCE code_verifier — required for both selected official contracts. */
  codeVerifier: string;
}

export interface FeishuOAuthTokenHttpPort {
  /**
   * Exchanges an authorization_code for an access_token via exactly one
   * server-selected official Feishu token endpoint. Returns null on any failure
   * (HTTP error, API error, network, timeout, malformed response).
   */
  fetchToken(
    input: FeishuOAuthTokenRequest,
  ): Promise<FeishuOAuthTokenResponse | null>;
}

/**
 * Minimal fetch-like transport signature for the Feishu OAuth token
 * endpoints. Structurally compatible with the global `fetch` so that
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
 * Explicit unavailable adapter for fail-closed development probes and tests.
 * It never performs network I/O.
 */
@Injectable()
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class UnavailableFeishuOAuthTokenHttpAdapter
  implements FeishuOAuthTokenHttpPort
{
  async fetchToken(
    _input: FeishuOAuthTokenRequest,
  ): Promise<FeishuOAuthTokenResponse | null> {
    return null;
  }
}

/**
 * HTTP adapter that calls exactly one server-selected official Feishu OAuth
 * token endpoint with a server-held authorization_code + PKCE verifier.
 * v2 is an explicitly selected, R08-approved temporary DEV/UAT compatibility
 * contract; v3 remains the default and long-term contract. A failure never
 * retries against the other endpoint.
 *
 * Fail-closed: non-2xx, API code non-zero, network error, timeout/abort,
 * or malformed JSON/fields all return null — never throws, never logs
 * client_secret, code, or token.
 */
@Injectable()
// Supplied through IdentityModule; the static lint rule cannot follow the
// Symbol token provider.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class HttpFeishuOAuthTokenAdapter implements FeishuOAuthTokenHttpPort {
  private static readonly V2_TOKEN_URL =
    'https://open.feishu.cn/open-apis/authen/v2/oauth/token';
  private static readonly V3_TOKEN_URL =
    'https://accounts.feishu.cn/oauth/v3/token';
  private static readonly DEFAULT_TIMEOUT_MS = 5000;

  constructor(
    private readonly fetchImpl: FeishuOAuthTokenFetch,
    private readonly timeoutMs: number = HttpFeishuOAuthTokenAdapter.DEFAULT_TIMEOUT_MS,
    private readonly reportFailure: FeishuOAuthTokenFailureReporter = () =>
      undefined,
  ) {}

  async fetchToken(
    input: FeishuOAuthTokenRequest,
  ): Promise<FeishuOAuthTokenResponse | null> {
    const {
      apiVersion,
      clientId,
      clientSecret,
      code,
      redirectUri,
      codeVerifier,
    } = input;

    // Defensive: all params must be non-empty, including codeVerifier.
    // The caller should guard these, but the adapter must be safe in
    // isolation too. PKCE is always required — a missing or blank
    // code_verifier means no fetch occurs.
    if (
      (apiVersion !== 'v2' && apiVersion !== 'v3') ||
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

    const request = HttpFeishuOAuthTokenAdapter.buildRequest(input);
    if (!request) {
      return null;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.timeoutMs,
    );

    try {
      const response = await this.fetchImpl(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      });

      let jsonBody: unknown;
      try {
        jsonBody = await response.json();
      } catch {
        this.reportFailure({
          event: 'FEISHU_OAUTH_TOKEN_EXCHANGE_FAILED',
          classification: response.ok
            ? 'MALFORMED_RESPONSE'
            : 'UPSTREAM_HTTP_ERROR',
          httpStatus: response.status,
        });
        return null;
      }

      if (!response.ok) {
        this.reportFailure(
          HttpFeishuOAuthTokenAdapter.classifyFailure(
            jsonBody,
            response.status,
            'UPSTREAM_HTTP_ERROR',
          ),
        );
        return null;
      }

      const token = HttpFeishuOAuthTokenAdapter.parseToken(jsonBody);
      if (!token) {
        this.reportFailure(
          HttpFeishuOAuthTokenAdapter.classifyFailure(
            jsonBody,
            response.status,
            'MALFORMED_RESPONSE',
          ),
        );
      }
      return token;
    } catch {
      this.reportFailure({
        event: 'FEISHU_OAUTH_TOKEN_EXCHANGE_FAILED',
        classification: controller.signal.aborted
          ? 'TIMEOUT'
          : 'NETWORK_ERROR',
      });
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private static buildRequest(
    input: FeishuOAuthTokenRequest,
  ): { url: string; headers: Record<string, string>; body: string } | null {
    const fields = {
      grant_type: 'authorization_code',
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    };

    if (input.apiVersion === 'v2') {
      return {
        url: HttpFeishuOAuthTokenAdapter.V2_TOKEN_URL,
        headers: {
          'Content-Type': 'application/json;charset=utf-8',
        },
        body: JSON.stringify(fields),
      };
    }

    if (input.apiVersion === 'v3') {
      return {
        url: HttpFeishuOAuthTokenAdapter.V3_TOKEN_URL,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(fields).toString(),
      };
    }

    return null;
  }

  /**
   * Parse the official Feishu OAuth v2/v3 token response body. Returns null when:
   * - body is not a JSON object
   * - top-level `code` is a non-zero number (API-level error)
   * - `access_token` is missing, non-string, or empty
   * - `token_type` is missing, non-string, or empty
   * - `expires_in` is missing, non-number, or not finite
   *
   * `refresh_token` is optional — null when absent or non-string.
   *
   * v2 success includes `code: 0`; v3 success may omit `code`. Both official
   * error forms include a non-zero numeric `code` and/or allowlisted `error`.
   */
  private static parseToken(body: unknown): FeishuOAuthTokenResponse | null {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return null;
    }

    const obj = body as Record<string, unknown>;

    // v3 success may omit `code`; v2 success includes `code: 0`.
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

  private static classifyFailure(
    body: unknown,
    httpStatus: number,
    fallback: FeishuOAuthTokenFailureClassification,
  ): FeishuOAuthTokenFailureDiagnostic {
    const base: FeishuOAuthTokenFailureDiagnostic = {
      event: 'FEISHU_OAUTH_TOKEN_EXCHANGE_FAILED',
      classification: fallback,
      httpStatus,
    };

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return base;
    }

    const obj = body as Record<string, unknown>;
    const upstreamCode =
      typeof obj.code === 'number' &&
      Number.isFinite(obj.code) &&
      obj.code !== 0
        ? obj.code
        : undefined;
    const upstreamError =
      typeof obj.error === 'string' &&
      /^[A-Za-z0-9._-]{1,64}$/u.test(obj.error)
        ? obj.error
        : undefined;

    return {
      ...base,
      classification:
        upstreamCode !== undefined || upstreamError !== undefined
          ? 'UPSTREAM_OAUTH_ERROR'
          : fallback,
      ...(upstreamCode !== undefined ? { upstreamCode } : {}),
      ...(upstreamError !== undefined ? { upstreamError } : {}),
    };
  }
}
