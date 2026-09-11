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
});
