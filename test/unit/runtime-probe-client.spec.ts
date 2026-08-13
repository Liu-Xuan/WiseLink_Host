const post = jest.fn();

jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({
  axiosForBackend: { post, get: jest.fn() },
}));

import { runPhase2fValidation } from '../../client/src/api/runtime-probe';

describe('runtime probe Phase 2F client action', () => {
  beforeEach(() => post.mockReset());

  it('uses axiosForBackend with the app-relative route and fixed authorized FileService paths', async () => {
    post.mockResolvedValue({ status: 200, data: { status: 'PASS' }, headers: {} });

    await expect(runPhase2fValidation()).resolves.toMatchObject({ status: 200, ok: true });
    expect(post).toHaveBeenCalledWith(
      '/api/document-management/validation/phase2d-ftd-two-version',
      {
        firstFilePath: '/1873430484255770.pdf',
        newerFilePath: '/1873430479421449.pdf',
      },
      { meta: { autoJumpToLogin: false } },
    );
  });

  it('preserves the closed-window HTTP 403 and stable server code without retrying', async () => {
    post.mockRejectedValue({
      response: {
        status: 403,
        data: {
          error: {
            code: 'DOCUMENT_MANAGEMENT_VALIDATION_FORBIDDEN',
            message: 'Phase 2D validation run ID is not configured.',
          },
        },
        headers: { 'x-request-id': 'request-403', 'x-log-trace-id': 'trace-403' },
      },
    });

    await expect(runPhase2fValidation()).resolves.toEqual(
      expect.objectContaining({
        status: 403,
        code: 'DOCUMENT_MANAGEMENT_VALIDATION_FORBIDDEN',
        requestId: 'request-403',
        traceId: 'trace-403',
        ok: false,
      }),
    );
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('normalizes a Miaoda-resolved 403 response as a failed stable-code result', async () => {
    post.mockResolvedValue({
      status: 403,
      data: {
        error: {
          code: 'DOCUMENT_MANAGEMENT_VALIDATION_FORBIDDEN',
          message: 'Phase 2D validation run ID is not configured.',
        },
      },
      headers: { 'x-request-id': 'resolved-403' },
    });

    await expect(runPhase2fValidation()).resolves.toEqual(
      expect.objectContaining({
        status: 403,
        code: 'DOCUMENT_MANAGEMENT_VALIDATION_FORBIDDEN',
        requestId: 'resolved-403',
        ok: false,
      }),
    );
    expect(post).toHaveBeenCalledTimes(1);
  });
});
