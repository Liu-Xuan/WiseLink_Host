import { FeishuDriveApplicationPageFetcher } from './feishu-drive-application-page-fetcher';
import { Test } from '@nestjs/testing';

describe('FeishuDriveApplicationPageFetcher', () => {
  const originalId = process.env.FEISHU_OAUTH_CLIENT_ID;
  const originalSecret = process.env.FEISHU_OAUTH_CLIENT_SECRET;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.FEISHU_OAUTH_CLIENT_ID = 'cli_product';
    process.env.FEISHU_OAUTH_CLIENT_SECRET = 'secret';
  });

  afterAll(() => {
    restore('FEISHU_OAUTH_CLIENT_ID', originalId);
    restore('FEISHU_OAUTH_CLIENT_SECRET', originalSecret);
    globalThis.fetch = originalFetch;
  });

  it('can be constructed by Nest without treating fetch as a dependency', async () => {
    const module = await Test.createTestingModule({
      providers: [FeishuDriveApplicationPageFetcher],
    }).compile();
    expect(module.get(FeishuDriveApplicationPageFetcher)).toBeInstanceOf(
      FeishuDriveApplicationPageFetcher,
    );
    await module.close();
  });

  it('uses one cached application token and normalizes Drive pages', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ code: 0, tenant_access_token: 'tenant-token', expire: 7200 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            files: [
              {
                token: 'file-1',
                type: 'file',
                name: '日报.pdf',
                parent_token: 'folder',
                modified_time: '1780000000',
              },
            ],
            has_more: true,
            next_page_token: 'p2',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ code: 0, data: { files: [], has_more: false } }),
      );
    globalThis.fetch = fetchImpl;
    const fetcher = new FeishuDriveApplicationPageFetcher();

    await expect(fetcher.list('folder')).resolves.toEqual({
      files: [
        expect.objectContaining({
          token: 'file-1',
          parentToken: 'folder',
          modifiedTime: '1780000000',
        }),
      ],
      hasMore: true,
      nextPageToken: 'p2',
    });
    await fetcher.list('folder', 'p2');

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[1]?.[0].toString()).toContain(
      'folder_token=folder',
    );
    expect(fetchImpl.mock.calls[2]?.[0].toString()).toContain('page_token=p2');
    expect(fetchImpl.mock.calls[1]?.[1]?.headers).toEqual({
      Authorization: 'Bearer tenant-token',
    });
  });

  it('preserves authorization failures for durable scan blockers', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ code: 0, tenant_access_token: 'tenant-token', expire: 7200 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ code: 1061004, msg: 'permission_denied' }, 403),
      );
    globalThis.fetch = fetchImpl;
    const fetcher = new FeishuDriveApplicationPageFetcher();

    await expect(fetcher.list('folder')).rejects.toMatchObject({
      status: 403,
      code: 1061004,
      message: 'permission_denied',
    });
  });

  it('fails closed before networking without product credentials', async () => {
    delete process.env.FEISHU_OAUTH_CLIENT_SECRET;
    const fetchImpl = jest.fn();
    globalThis.fetch = fetchImpl;
    const fetcher = new FeishuDriveApplicationPageFetcher();
    await expect(fetcher.list('folder')).rejects.toThrow(
      'DRIVE_APPLICATION_IDENTITY_NOT_CONFIGURED',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

const originalApp = process.env.FEISHU_OAUTH_CLIENT_ID;
const originalSecret = process.env.FEISHU_OAUTH_CLIENT_SECRET;

describe('FeishuDriveApplicationPageFetcher source bytes', () => {
  afterEach(() => { jest.restoreAllMocks(); });
  afterAll(() => {
    if (originalApp === undefined) delete process.env.FEISHU_OAUTH_CLIENT_ID;
    else process.env.FEISHU_OAUTH_CLIENT_ID = originalApp;
    if (originalSecret === undefined) delete process.env.FEISHU_OAUTH_CLIENT_SECRET;
    else process.env.FEISHU_OAUTH_CLIENT_SECRET = originalSecret;
  });

  it('uses exact official metadata request and bounded direct binary download', async () => {
    process.env.FEISHU_OAUTH_CLIENT_ID = 'app1';
    process.env.FEISHU_OAUTH_CLIENT_SECRET = 'secret';
    const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const pathname = new URL(String(url)).pathname;
      if (pathname.endsWith('/tenant_access_token/internal'))
        return Response.json({ code: 0, tenant_access_token: 'token', expire: 3600 });
      if (pathname.endsWith('/metas/batch_query')) {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({ request_docs: [{ doc_token: 'file1', doc_type: 'file' }] });
        return Response.json({ code: 0, data: { metas: [{ doc_token: 'file1',
          doc_type: 'file', title: 'Manual.pdf', latest_modify_time: '100' }], failed_list: [] } });
      }
      expect(pathname).toBe('/open-apis/drive/v1/files/file1/download');
      expect(init?.redirect).toBe('manual');
      return new Response(Buffer.from('%PDF-1.7\nbody'), { status: 200 });
    });
    const adapter = new FeishuDriveApplicationPageFetcher();
    expect(await adapter.metadata('file1')).toEqual({ token: 'file1', type: 'file',
      title: 'Manual.pdf', latestModifyTime: '100' });
    expect(await adapter.downloadFile('file1')).toEqual(Buffer.from('%PDF-1.7\nbody'));
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('exposes per-document missing scope and refuses unverified redirects', async () => {
    process.env.FEISHU_OAUTH_CLIENT_ID = 'app1';
    process.env.FEISHU_OAUTH_CLIENT_SECRET = 'secret';
    jest.spyOn(globalThis, 'fetch').mockImplementation(async url => {
      const pathname = new URL(String(url)).pathname;
      if (pathname.endsWith('/tenant_access_token/internal'))
        return Response.json({ code: 0, tenant_access_token: 'token', expire: 3600 });
      if (pathname.endsWith('/metas/batch_query'))
        return Response.json({ code: 0, data: { metas: [],
          failed_list: [{ doc_token: 'file1', code: 99991672, msg: 'missing scope' }] } });
      return new Response(null, { status: 302, headers: { location: 'https://other.invalid/file' } });
    });
    const adapter = new FeishuDriveApplicationPageFetcher();
    await expect(adapter.metadata('file1')).rejects.toMatchObject({ code: 99991672 });
    await expect(adapter.downloadFile('file1')).rejects.toThrow('DRIVE_DOWNLOAD_REDIRECT_UNVERIFIED');
  });
});
