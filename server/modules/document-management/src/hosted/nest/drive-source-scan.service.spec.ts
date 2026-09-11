import { DriveSourceScanService } from './drive-source-scan.service';

describe('DriveSourceScanService', () => {
  it('rejects unknown sources before invoking an authorized fetcher', async () => {
    const service = new DriveSourceScanService({ forTenant: () => { throw new Error('must not load'); } } as never);
    const fetcher = { list: jest.fn() };
    await expect(service.scan({ tenantId: 'tenant', sourceKey: 'unknown', fetcher })).rejects.toThrow('DRIVE_SOURCE_NOT_REGISTERED');
    expect(fetcher.list).not.toHaveBeenCalled();
  });

  it('runs a registered source through the tenant checkpoint store', async () => {
    const checkpoints = new Map<string, string>();
    const forTenant = jest.fn(() => ({
      load: async (key: string) => checkpoints.get(key) ?? null,
      save: async (key: string, value: string) => { checkpoints.set(key, value); },
    }));
    const service = new DriveSourceScanService({ forTenant } as never);
    const fetcher = { list: jest.fn(async () => ({ files: [{ token: 'file-1', type: 'file', name: '日报.pdf' }], hasMore: false })) };
    const result = await service.scan({ tenantId: 'tenant-1', sourceKey: 'operations', fetcher, maxPages: 1 });
    expect(fetcher.list).toHaveBeenCalledWith('Oy1vfy8nslGZeUdBBkoczv0Fnxh', undefined);
    expect(forTenant).toHaveBeenCalledWith('tenant-1');
    expect(result.entries.map(entry => entry.name)).toEqual(['日报.pdf']);
    expect(checkpoints.has('operations')).toBe(true);
  });

  it('resumes the same source from its saved continuation', async () => {
    let checkpoint: string | null = null;
    const calls: Array<[string, string | undefined]> = [];
    const service = new DriveSourceScanService({
      forTenant: () => ({
        load: async () => checkpoint,
        save: async (_key: string, value: string) => { checkpoint = value; },
      }),
    } as never);
    const fetcher = { list: jest.fn(async (folder: string, token?: string) => {
      calls.push([folder, token]);
      return token ? { files: [{ token: 'file-2', type: 'file', name: '第二页.pdf' }], hasMore: false } :
        { files: [{ token: 'file-1', type: 'file', name: '第一页.pdf' }], hasMore: true, nextPageToken: 'p2' };
    }) };
    await service.scan({ tenantId: 'tenant-2', sourceKey: 'operations', fetcher, maxPages: 1 });
    await service.scan({ tenantId: 'tenant-2', sourceKey: 'operations', fetcher, maxPages: 1 });
    expect(calls).toEqual([
      ['Oy1vfy8nslGZeUdBBkoczv0Fnxh', undefined],
      ['Oy1vfy8nslGZeUdBBkoczv0Fnxh', 'p2'],
    ]);
  });

  it('returns identity candidates without converting them into accepted documents', async () => {
    const checkpoints = { forTenant: () => ({ load: async () => null, save: async () => undefined }) };
    const service = new DriveSourceScanService(checkpoints as never);
    const result = await service.scanCandidates({
      tenantId: 'tenant-3', sourceKey: 'operations',
      fetcher: { list: async () => ({ files: [{ token: 'file-3', type: 'file', name: '日报.pdf', version_id: 'v1' }], hasMore: false }) },
    });
    expect(result.candidates[0]?.identity).toBe('operations:file:file-3:v1');
    expect(result.candidates[0]?.providerVersionId).toBe('v1');
  });
});
