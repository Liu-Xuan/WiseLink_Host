import { Injectable } from '@nestjs/common';

import type { DrivePage } from '../drive-folder-scanner';
import type { AuthorizedDrivePageFetcher } from './drive-source-scan.service';

type FetchLike = typeof globalThis.fetch;

interface CachedTenantToken {
  appId: string;
  value: string;
  expiresAt: number;
}

export interface DriveFileMetadata {
  token: string;
  type: 'file';
  title: string;
  latestModifyTime: string | null;
}

const MAX_SOURCE_BYTES = 100 * 1024 * 1024;

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

  /** Official metadata has no parent token or revision; list traversal proves membership. */
  async metadata(fileToken: string): Promise<DriveFileMetadata> {
    if (!fileToken) throw new Error('DRIVE_FILE_TOKEN_REQUIRED');
    const token = await this.tenantAccessToken();
    const response = await this.request(new URL(
      'https://open.feishu.cn/open-apis/drive/v1/metas/batch_query'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_docs: [{ doc_token: fileToken, doc_type: 'file' }] }),
    });
    const body = await readJson(response);
    const code = readNumber(body, 'code');
    if (!response.ok || code !== 0)
      throw driveHttpError(response.status, code, readString(body, 'msg'));
    const data = readObject(body, 'data');
    if (Array.isArray(data.failed_list) && data.failed_list.length > 0) {
      const failed = data.failed_list[0];
      const detail = failed && typeof failed === 'object' && !Array.isArray(failed)
        ? failed as Record<string, unknown> : {};
      throw driveHttpError(response.status, readNumber(detail, 'code'),
        readString(detail, 'msg'));
    }
    if (!Array.isArray(data.metas) || data.metas.length !== 1)
      throw new Error('DRIVE_FILE_METADATA_INCOMPLETE');
    const meta = data.metas[0];
    if (!meta || typeof meta !== 'object' || Array.isArray(meta) ||
      meta.doc_token !== fileToken || meta.doc_type !== 'file' ||
      typeof meta.title !== 'string' || !meta.title)
      throw new Error('DRIVE_FILE_METADATA_MISMATCH');
    const rawModified = meta.latest_modify_time;
    const latestModifyTime = typeof rawModified === 'string' || typeof rawModified === 'number'
      ? String(rawModified) : null;
    return { token: fileToken, type: 'file', title: meta.title, latestModifyTime };
  }

  /** Ordinary Drive file bytes only; stream with an explicit size bound. */
  async downloadFile(fileToken: string): Promise<Buffer> {
    if (!fileToken || !/^[A-Za-z0-9_-]+$/u.test(fileToken))
      throw new Error('DRIVE_FILE_TOKEN_INVALID');
    const token = await this.tenantAccessToken();
    const response = await this.request(new URL(
      `https://open.feishu.cn/open-apis/drive/v1/files/${fileToken}/download`), {
      method: 'GET', headers: { Authorization: `Bearer ${token}` },
      redirect: 'manual',
    });
    if (response.status >= 300 && response.status < 400)
      throw new Error('DRIVE_DOWNLOAD_REDIRECT_UNVERIFIED');
    if (!response.ok) {
      const body = await readJson(response);
      throw driveHttpError(response.status, readNumber(body, 'code'), readString(body, 'msg'));
    }
    const advertised = Number(response.headers.get('content-length') ?? 0);
    if (advertised > MAX_SOURCE_BYTES) throw new Error('SOURCE_BYTES_TOO_LARGE');
    if (!response.body) throw new Error('DRIVE_FILE_BODY_MISSING');
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk);
      length += bytes.length;
      if (length > MAX_SOURCE_BYTES) throw new Error('SOURCE_BYTES_TOO_LARGE');
      chunks.push(bytes);
    }
    return Buffer.concat(chunks);
  }

  private async tenantAccessToken(): Promise<string> {
    const appId = process.env.FEISHU_OAUTH_CLIENT_ID?.trim();
    const appSecret = process.env.FEISHU_OAUTH_CLIENT_SECRET?.trim();
    if (!appId || !appSecret)
      throw new Error('DRIVE_APPLICATION_IDENTITY_NOT_CONFIGURED');
    if (this.cachedToken?.appId === appId &&
      this.cachedToken.expiresAt > Date.now() + 60_000)
      return this.cachedToken.value;

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
      appId,
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
