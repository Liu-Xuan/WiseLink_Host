const request = jest.fn();

jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({
  axiosForBackend: request,
}));

import { getReadOnlyRuntimeProbe } from '../../client/src/api/runtime-probe';

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
});
