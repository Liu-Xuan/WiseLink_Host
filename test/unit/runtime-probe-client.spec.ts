import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const request = jest.fn();

jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({
  axiosForBackend: request,
}));

import {
  getHostedRuntimeFingerprint,
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

  it('reads only the hosted fingerprint when Review diagnostics need it', async () => {
    request.mockResolvedValue({
      status: 200,
      data: {
        schemaVersion: 'wiselink.3_1.hosted_runtime_probe.v1',
        status: 'PASS',
        deployedCommit: 'commit-review',
        releaseId: 'release-review',
        apiContractVersion: 'contract-review',
      },
    });

    await expect(getHostedRuntimeFingerprint()).resolves.toMatchObject({
      deployedCommit: 'commit-review',
      releaseId: 'release-review',
      apiContractVersion: 'contract-review',
    });
    expect(request).toHaveBeenCalledWith({
      url: '/api/runtime-probe',
      method: 'GET',
    });
  });

  it('renders source, release and API contract from build plus Host readback', async () => {
    const [page, vite] = await Promise.all([
      readFile(
        resolve(
          __dirname,
          '../../client/src/pages/RuntimeProbePage/RuntimeProbePage.tsx',
        ),
        'utf8',
      ),
      readFile(resolve(__dirname, '../../vite.config.ts'), 'utf8'),
    ]);

    expect(page).toContain('frontendSourceCommit');
    expect(page).toContain('releaseId');
    expect(page).toContain('apiContractVersion');
    expect(page).toContain('复制运行指纹');
    expect(vite).toContain('__WISELINK_SOURCE_COMMIT__');
    expect(vite).toContain("visualVersion: 'R10.0-candidate-review'");
  });
});
