import { DriveSourceScanAutomation } from './drive-source-scan.automation';

describe('DriveSourceScanAutomation', () => {
  const originalTenant = process.env.WL_DRIVE_SCAN_TENANT_ID;

  afterAll(() => {
    if (originalTenant === undefined)
      delete process.env.WL_DRIVE_SCAN_TENANT_ID;
    else process.env.WL_DRIVE_SCAN_TENANT_ID = originalTenant;
  });

  it('scans only the approved initial sources under the configured tenant', async () => {
    process.env.WL_DRIVE_SCAN_TENANT_ID = 'tenant-1';
    const scanCandidates = jest.fn(async ({ sourceKey }) => ({
      complete: true,
      candidates: [{ providerObjectId: sourceKey }],
      pendingCandidates: [],
      changes: [],
      scan: { blockers: [] },
    }));
    const fetcher = { list: jest.fn() };
    const automation = new DriveSourceScanAutomation(
      { scanCandidates } as never,
      fetcher as never,
    );

    const result = await automation.scanRegisteredSources();

    expect(scanCandidates.mock.calls.map(([input]) => input.sourceKey)).toEqual(
      ['technical-library', 'operations'],
    );
    expect(scanCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', fetcher }),
    );
    expect(result.sources).toEqual([
      expect.objectContaining({ sourceKey: 'technical-library', complete: true }),
      expect.objectContaining({ sourceKey: 'operations', complete: true }),
    ]);
  });

  it('fails before scanning when the durable tenant scope is absent', async () => {
    delete process.env.WL_DRIVE_SCAN_TENANT_ID;
    const scanCandidates = jest.fn();
    const automation = new DriveSourceScanAutomation(
      { scanCandidates } as never,
      {} as never,
    );
    await expect(automation.scanRegisteredSources()).rejects.toThrow(
      'DRIVE_SCAN_TENANT_NOT_CONFIGURED',
    );
    expect(scanCandidates).not.toHaveBeenCalled();
  });
});
