const request = jest.fn();

jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({
  axiosForBackend: request,
}));

import { runFirstFtdVertical } from '../../client/src/api/runtime-probe';

describe('runtime probe first FTD vertical client action', () => {
  beforeEach(() => request.mockReset());

  it('uses axiosForBackend once with the exact authorized FileService selection', async () => {
    request.mockResolvedValue({
      status: 200,
      data: { status: 'CANDIDATE_VERTICAL_VERIFIED' },
      headers: {},
    });

    await expect(runFirstFtdVertical()).resolves.toMatchObject({
      status: 200,
      ok: true,
    });
    expect(request).toHaveBeenCalledWith({
      url: '/api/canonical-host/work-items/parse-pdf',
      method: 'POST',
      data: {
        selection: {
          bucketId: 'bucket_aadkprardjghu',
          filePath: '/1873430479421449.pdf',
        },
        query: 'software',
      },
      meta: { autoJumpToLogin: false },
    });
  });

  it('preserves a server rejection without retrying', async () => {
    request.mockRejectedValue({
      response: {
        status: 403,
        data: {
          error: {
            code: 'CANONICAL_ACTION_NOT_AUTHORIZED',
            message: 'The authenticated actor is not authorized.',
          },
        },
        headers: { 'x-request-id': 'request-403', 'x-log-trace-id': 'trace-403' },
      },
    });

    await expect(runFirstFtdVertical()).resolves.toEqual(
      expect.objectContaining({
        status: 403,
        code: 'CANONICAL_ACTION_NOT_AUTHORIZED',
        requestId: 'request-403',
        traceId: 'trace-403',
        ok: false,
      }),
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('normalizes a resolved 403 response as a failed result', async () => {
    request.mockResolvedValue({
      status: 403,
      data: {
        error: {
          code: 'CANONICAL_ACTION_NOT_AUTHORIZED',
          message: 'The authenticated actor is not authorized.',
        },
      },
      headers: { 'x-request-id': 'resolved-403' },
    });

    await expect(runFirstFtdVertical()).resolves.toEqual(
      expect.objectContaining({
        status: 403,
        code: 'CANONICAL_ACTION_NOT_AUTHORIZED',
        requestId: 'resolved-403',
        ok: false,
      }),
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
});
