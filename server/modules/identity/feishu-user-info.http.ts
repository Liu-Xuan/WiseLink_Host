import { Injectable } from '@nestjs/common';

export const FEISHU_USER_INFO_HTTP = Symbol('FEISHU_USER_INFO_HTTP');

/**
 * Response from the official Feishu authen/v1/user_info endpoint.
 * Only fields needed for identity verification are captured.
 */
export interface FeishuUserInfoResponse {
  /** Feishu open_id (ou_ prefix) — the primary subject identifier. */
  openId: string;
  /** Feishu tenant_key — identifies the Feishu tenant. */
  tenantKey: string;
  /** Feishu user_id (== employee_id) — enterprise-internal identifier. */
  userId: string | null;
  /** Display name — for diagnostics only, never a trust source. */
  name: string | null;
}

export interface FeishuUserInfoHttpPort {
  /**
   * Calls the official Feishu user_info endpoint with the given
   * server-injected access token. Returns null on any failure
   * (HTTP error, invalid token, expired, revoked, network).
   */
  fetchUserInfo(input: {
    accessToken: string;
  }): Promise<FeishuUserInfoResponse | null>;
}

/**
 * Minimal fetch-like transport signature for the Feishu user_info endpoint.
 * Structurally compatible with the global `fetch` so that production wiring
 * can pass `globalThis.fetch`, while tests inject a trivial mock.
 */
export type FeishuUserInfoFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/**
 * Default adapter — always returns null (unavailable) because
 * no Feishu app credentials are configured. A future
 * HttpFeishuUserInfoAdapter will replace this once the Feishu
 * app_id/app_secret and user_access_token flow are provisioned.
 */
@Injectable()
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class UnavailableFeishuUserInfoHttpAdapter
  implements FeishuUserInfoHttpPort
{
  async fetchUserInfo(_input: {
    accessToken: string;
  }): Promise<FeishuUserInfoResponse | null> {
    return null;
  }
}

/**
 * HTTP adapter that calls the official Feishu authen/v1/user_info endpoint
 * using a server-injected user_access_token Bearer header. Designed for
 * DEV/UAT manual injection — NOT registered in IdentityModule. The project
 * default environment never instantiates this class, so it never networks.
 *
 * Fail-closed: non-2xx, network error, timeout/abort, or malformed
 * JSON/fields all return null — never throws, never logs the token.
 */
@Injectable()
// Private seam — not wired in any module; supplied via manual / custom
// provider in DEV/UAT only.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class HttpFeishuUserInfoAdapter implements FeishuUserInfoHttpPort {
  private static readonly USER_INFO_URL =
    'https://open.feishu.cn/open-apis/authen/v1/user_info';
  private static readonly DEFAULT_TIMEOUT_MS = 5000;

  constructor(
    private readonly fetchImpl: FeishuUserInfoFetch,
    private readonly timeoutMs: number = HttpFeishuUserInfoAdapter.DEFAULT_TIMEOUT_MS,
  ) {}

  async fetchUserInfo(input: {
    accessToken: string;
  }): Promise<FeishuUserInfoResponse | null> {
    const { accessToken } = input;

    // Defensive: caller (FeishuOAuthVerificationAdapter) already guards this,
    // but the adapter must be safe in isolation too.
    if (!accessToken || accessToken.trim() === '') {
      return null;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.timeoutMs,
    );

    try {
      const response = await this.fetchImpl(
        HttpFeishuUserInfoAdapter.USER_INFO_URL,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        return null;
      }

      const body: unknown = await response.json();
      return HttpFeishuUserInfoAdapter.parseUserInfo(body);
    } catch {
      // Swallow ALL errors — network failure, abort/timeout, JSON parse
      // error, etc. Never rethrow; never log (token could be in error).
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Parse the Feishu user_info response body. Returns null when:
   * - body is not a JSON object
   * - top-level `code` is non-zero (API-level error: expired/revoked token)
   * - `data` object is missing or null
   * - `open_id` or `tenant_key` is missing, non-string, or empty
   *
   * `user_id` and `name` are optional — null when absent or non-string.
   */
  private static parseUserInfo(body: unknown): FeishuUserInfoResponse | null {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return null;
    }

    const obj = body as Record<string, unknown>;

    // Feishu API returns { code, msg, data }. code !== 0 means API-level
    // failure (e.g. expired token) — fail closed.
    if (obj.code !== 0) {
      return null;
    }

    const data = obj.data;
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return null;
    }

    const d = data as Record<string, unknown>;

    const { open_id: openId, tenant_key: tenantKey } = d;

    if (
      typeof openId !== 'string' ||
      openId === '' ||
      typeof tenantKey !== 'string' ||
      tenantKey === ''
    ) {
      return null;
    }

    return {
      openId,
      tenantKey,
      userId: typeof d.user_id === 'string' ? d.user_id : null,
      name: typeof d.name === 'string' ? d.name : null,
    };
  }
}
