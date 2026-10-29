export interface FeishuApplicationTokenConfiguration {
  appId: string;
  appSecret: string;
}

export type FeishuApplicationTokenRequest = (
  url: URL,
  init: RequestInit,
) => Promise<Response>;

interface TokenFailureMessages {
  notConfigured: string;
  invalidResponse: string;
  requestFailed: string;
}

interface CachedApplicationToken extends FeishuApplicationTokenConfiguration {
  value: string;
  expiresAt: number;
}

const APPLICATION_TOKEN_FAILURES: TokenFailureMessages = {
  notConfigured: 'FEISHU_APPLICATION_IDENTITY_NOT_CONFIGURED',
  invalidResponse: 'FEISHU_APPLICATION_TOKEN_RESPONSE_INVALID',
  requestFailed: 'FEISHU_APPLICATION_TOKEN_REQUEST_FAILED',
};

/** Uses explicit server configuration and the caller's protected HTTP transport. */
export class FeishuApplicationToken {
  #cachedToken: CachedApplicationToken | null = null;

  constructor(
    private readonly request: FeishuApplicationTokenRequest,
    private readonly failures: TokenFailureMessages = APPLICATION_TOKEN_FAILURES,
  ) {}

  async get(configuration: FeishuApplicationTokenConfiguration): Promise<string> {
    const { appId, appSecret }: FeishuApplicationTokenConfiguration = configuration;
    if (!appId.trim() || !appSecret.trim()) {
      this.#cachedToken = null;
      throw new Error(this.failures.notConfigured);
    }
    if (this.#cachedToken?.appId === appId &&
      this.#cachedToken.appSecret === appSecret &&
      this.#cachedToken.expiresAt > Date.now() + 60_000) {
      return this.#cachedToken.value;
    }
    this.#cachedToken = null;

    let response: Response;
    try {
      response = await this.request(new URL(
        'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      ), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      });
    } catch {
      // A transport exception can include the request body with the app secret.
      throw new Error(this.failures.requestFailed);
    }

    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw Object.assign(new Error(this.failures.invalidResponse), {
        status: response.status,
        code: null,
      });
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw Object.assign(new Error(this.failures.invalidResponse), {
        status: response.status,
        code: null,
      });
    }
    const body: Record<string, unknown> = value as Record<string, unknown>;
    const code: number | null = readNumber(body, 'code');
    const token: string | null = readString(body, 'tenant_access_token');
    const expireSeconds: number | null = readNumber(body, 'expire');
    const expiresAt: number = Date.now() + (expireSeconds ?? 0) * 1000;
    if (!response.ok || code !== 0 || !token || !token.trim() ||
      expireSeconds === null || expireSeconds <= 0 || !Number.isFinite(expiresAt)) {
      // Platform error text can contain credentials even outside token fields.
      throw Object.assign(new Error(this.failures.requestFailed), {
        status: response.status,
        code,
      });
    }

    this.#cachedToken = { appId, appSecret, value: token, expiresAt };
    return token;
  }
}

function readString(value: Record<string, unknown>, key: string): string | null {
  const candidate: unknown = value[key];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

function readNumber(value: Record<string, unknown>, key: string): number | null {
  const candidate: unknown = value[key];
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
}
