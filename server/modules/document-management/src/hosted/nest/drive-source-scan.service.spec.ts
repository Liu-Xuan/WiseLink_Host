import { DriveSourceScanService } from './drive-source-scan.service';

describe('DriveSourceScanService', () => {
  it('rejects unknown sources before invoking an authorized fetcher', async () => {
    const service = new DriveSourceScanService({ forTenant: () => { throw new Error('must not load'); } } as never);
    const fetcher = { list: jest.fn() };
    await expect(service.scan({ tenantId: 'tenant', sourceKey: 'unknown', fetcher })).rejects.toThrow('DRIVE_SOURCE_NOT_REGISTERED');
    expect(fetcher.list).not.toHaveBeenCalled();
  });
});
