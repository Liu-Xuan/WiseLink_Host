import { FeishuDriveApplicationPageFetcher } from './feishu-drive-application-page-fetcher';

describe('FeishuDriveApplicationPageFetcher', () => {
  const originalId = process.env.FEISHU_OAUTH_CLIENT_ID;
  const originalSecret = process.env.FEISHU_OAUTH_CLIENT_SECRET;

  beforeEach(() => {
    process.env.FEISHU_OAUTH_CLIENT_ID = 'cli_product';
    process.env.FEISHU_OAUTH_CLIENT_SECRET = 'secret';
  });

  afterAll(() => {
    restore('FEISHU_OAUTH_CLIENT_ID', originalId);
    restore('FEISHU_OAUTH_CLIENT_SECRET', originalSecret);
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
    const fetcher = new FeishuDriveApplicationPageFetcher(fetchImpl);

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
    const fetcher = new FeishuDriveApplicationPageFetcher(fetchImpl);

    await expect(fetcher.list('folder')).rejects.toMatchObject({
      status: 403,
      code: 1061004,
      message: 'permission_denied',
    });
  });

  it('fails closed before networking without product credentials', async () => {
    delete process.env.FEISHU_OAUTH_CLIENT_SECRET;
    const fetchImpl = jest.fn();
    const fetcher = new FeishuDriveApplicationPageFetcher(fetchImpl);
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
