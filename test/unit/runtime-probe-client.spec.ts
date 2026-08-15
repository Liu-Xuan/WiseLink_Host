const request = jest.fn();

jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({
  axiosForBackend: request,
}));

import {
  runFileServiceP0Probe,
  runFirstFtdVertical,
  runPhase9BoeingSbVertical,
} from '../../client/src/api/runtime-probe';

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

describe('runtime probe Phase 9 Boeing SB client action', () => {
  beforeEach(() => request.mockReset());

  it('uses axiosForBackend once with the exact verified 737 selection', async () => {
    request.mockResolvedValue({
      status: 201,
      data: { status: 'CANDIDATE_VERTICAL_VERIFIED' },
      headers: { 'x-log-trace-id': 'phase9-trace' },
    });

    await expect(runPhase9BoeingSbVertical()).resolves.toMatchObject({
      status: 201,
      traceId: 'phase9-trace',
      ok: true,
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({
      url: '/api/canonical-host/work-items/parse-pdf',
      method: 'POST',
      data: {
        selection: {
          bucketId: 'bucket_aadkprardjghu',
          filePath: '/1873513486767111.pdf',
        },
        query: 'applicability',
      },
      meta: { autoJumpToLogin: false },
    });
  });
});

describe('runtime probe FileService P0 client action', () => {
  beforeEach(() => request.mockReset());

  it('uses axiosForBackend once without client-supplied path or bytes', async () => {
    request.mockResolvedValue({
      status: 200,
      data: { status: 'PASS' },
      headers: { 'x-log-trace-id': 'trace-p0' },
    });

    await expect(runFileServiceP0Probe()).resolves.toMatchObject({
      status: 200,
      traceId: 'trace-p0',
      ok: true,
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({
      url: '/api/runtime-probe/file-service-upload',
      method: 'POST',
      meta: { autoJumpToLogin: false },
    });
  });
});
