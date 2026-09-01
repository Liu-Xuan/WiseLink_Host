const request = jest.fn();

jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({
  axiosForBackend: request,
}));

import {
  getReadOnlyRuntimeProbe,
  runtimeFingerprintFrom,
} from '../../client/src/api/runtime-probe';

describe('runtime probe read-only client', () => {
  beforeEach(() => request.mockReset());

  it('only reads hosted runtime and Unified readiness', async () => {
    request
      .mockResolvedValueOnce({ status: 200, data: { status: 'PASS' } })
      .mockResolvedValueOnce({ status: 200, data: { status: 'READY' } });

    await expect(getReadOnlyRuntimeProbe()).resolves.toEqual([
      { path: '/api/runtime-probe', status: 200, body: { status: 'PASS' } },
      {
        path: '/api/unified-reader/readiness',
        status: 200,
        body: { status: 'READY' },
      },
    ]);
    expect(request.mock.calls).toEqual([
      [{ url: '/api/runtime-probe', method: 'GET' }],
      [{ url: '/api/unified-reader/readiness', method: 'GET' }],
    ]);
  });

  it('extracts only an explicit runtime fingerprint contract', () => {
    expect(
      runtimeFingerprintFrom([
        {
          path: '/api/runtime-probe',
          status: 200,
          body: {
            schemaVersion: 'wiselink.3_1.hosted_runtime_probe.v1',
            status: 'PASS',
            deployedCommit: 'commit-1',
            releaseId: 'release-1',
            apiContractVersion: 'contract-1',
          },
        },
      ]),
    ).toMatchObject({
      deployedCommit: 'commit-1',
      releaseId: 'release-1',
      apiContractVersion: 'contract-1',
    });
    expect(
      runtimeFingerprintFrom([
        { path: '/api/runtime-probe', status: 200, body: { status: 'PASS' } },
      ]),
    ).toBeNull();
  });
});
