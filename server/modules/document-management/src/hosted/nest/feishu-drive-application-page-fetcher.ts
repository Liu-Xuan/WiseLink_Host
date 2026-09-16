import { Injectable } from '@nestjs/common';

import type { DrivePage } from '../drive-folder-scanner';
import type { AuthorizedDrivePageFetcher } from './drive-source-scan.service';

type FetchLike = typeof globalThis.fetch;

interface CachedTenantToken {
  value: string;
  expiresAt: number;
}

/**
 * Reads registered Drive roots as the WiseLink application itself.
 *
 * The app secret never leaves the server. Folder membership and app scopes
 * still decide what can be read; a missing permission is surfaced to the scan
 * coordinator as a durable authorization blocker.
 */
@Injectable()
// Registered by DocumentManagementHostedModule.register dynamic providers.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class FeishuDriveApplicationPageFetcher
  implements AuthorizedDrivePageFetcher
{
  private cachedToken: CachedTenantToken | null = null;
  private readonly fetchImpl: FetchLike = globalThis.fetch;

  async list(folderToken: string, pageToken?: string): Promise<DrivePage> {
    if (!folderToken) throw new Error('DRIVE_FOLDER_TOKEN_REQUIRED');
    const token = await this.tenantAccessToken();
    const url = new URL('https://open.feishu.cn/open-apis/drive/v1/files');
    url.searchParams.set('folder_token', folderToken);
    url.searchParams.set('page_size', '200');
    if (pageToken) url.searchParams.set('page_token', pageToken);

    const response = await this.request(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await readJson(response);
    const code = readNumber(body, 'code');
    if (!response.ok || code !== 0) {
      throw driveHttpError(response.status, code, readString(body, 'msg'));
    }
    const data = readObject(body, 'data');
    const files = Array.isArray(data.files) ? data.files : [];
    return {
      files: files.map(file => normalizeDriveEntry(file)),
      hasMore: data.has_more === true,
      nextPageToken: readString(data, 'next_page_token'),
    };
  }

  private async tenantAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 60_000)
      return this.cachedToken.value;

    const appId = process.env.FEISHU_OAUTH_CLIENT_ID?.trim();
    const appSecret = process.env.FEISHU_OAUTH_CLIENT_SECRET?.trim();
    if (!appId || !appSecret)
      throw new Error('DRIVE_APPLICATION_IDENTITY_NOT_CONFIGURED');

    const response = await this.request(
      new URL(
        'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      ),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      },
    );
    const body = await readJson(response);
    const code = readNumber(body, 'code');
    const token = readString(body, 'tenant_access_token');
    const expireSeconds = readNumber(body, 'expire');
    if (
      !response.ok ||
      code !== 0 ||
      !token ||
      !expireSeconds ||
      expireSeconds <= 0
    ) {
      throw driveHttpError(response.status, code, readString(body, 'msg'));
    }
    this.cachedToken = {
      value: token,
      expiresAt: Date.now() + expireSeconds * 1000,
    };
    return token;
  }

  private async request(url: URL, init: RequestInit): Promise<Response> {
    return this.fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(15_000),
    });
  }
}

function normalizeDriveEntry(value: unknown): DrivePage['files'][number] {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('DRIVE_PAGE_INVALID');
  const item = value as Record<string, unknown>;
  const token = readString(item, 'token');
  const type = readString(item, 'type');
  const name = readString(item, 'name');
  if (!token || !type || !name) throw new Error('DRIVE_PAGE_INVALID');
  const parentToken = readString(item, 'parent_token');
  const modifiedTime = readString(item, 'modified_time');
  return {
    ...item,
    token,
    type,
    name,
    ...(parentToken ? { parentToken } : {}),
    ...(modifiedTime ? { modifiedTime } : {}),
  };
}

function readObject(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const candidate = value[key];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
    throw new Error('DRIVE_PAGE_INVALID');
  return candidate as Record<string, unknown>;
}

function readString(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const candidate = value[key];
  return typeof candidate === 'string' && candidate.length > 0
    ? candidate
    : null;
}

function readNumber(
  value: Record<string, unknown>,
  key: string,
): number | null {
  const candidate = value[key];
  return typeof candidate === 'number' && Number.isFinite(candidate)
    ? candidate
    : null;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('DRIVE_HTTP_RESPONSE_INVALID');
  return value as Record<string, unknown>;
}

function driveHttpError(
  status: number,
  code: number | null,
  message: string | null,
): Error & { status: number; code: number | null } {
  const error = new Error(message ?? 'FEISHU_DRIVE_REQUEST_FAILED') as Error & {
    status: number;
    code: number | null;
  };
  error.status = status;
  error.code = code;
  return error;
}
