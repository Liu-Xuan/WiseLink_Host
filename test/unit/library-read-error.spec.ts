jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({
  axiosForBackend: jest.fn(),
}));
jest.mock('@lark-apaas/client-toolkit/utils/resolveAppUrl', () => ({
  resolveAppUrl: jest.fn(),
}));
jest.mock('@lark-apaas/client-toolkit/logger', () => ({
  logger: { error: jest.fn() },
}));

import { summarizeCanonicalDocumentReadFailure } from '../../client/src/api/canonical-host';
import { libraryReadErrorPresentation } from '../../client/src/pages/WorkspaceHomePage/library-read-error';

describe('library document-read presentation', () => {
  it.each([
    'NOT_FOUND_OR_INACCESSIBLE',
    'BUCKET',
    'PATH',
    'LENGTH',
    'MEDIA_TYPE',
  ])(
    'recognizes metadata detail %s without asserting deletion or logging raw detail',
    (detail) => {
      const reason = {
        response: {
          status: 500,
          data: {
            error: {
              stack: `Error: ARTIFACT_READBACK_MISMATCH:METADATA:${detail}\n at private-location`,
            },
          },
        },
      };
      expect(summarizeCanonicalDocumentReadFailure(reason).code).toBe(
        'ARTIFACT_READBACK_MISMATCH:METADATA',
      );
      expect(libraryReadErrorPresentation(reason)).toMatchObject({
        title: '原文暂时无法读取',
        sourceUnavailable: true,
      });
      expect(libraryReadErrorPresentation(reason).message).not.toContain(
        '已删除',
      );
    },
  );

  it.each([
    new Error('ARTIFACT_READBACK_MISMATCH:METADATA'),
    { statusCode: 500, code: 'ARTIFACT_READBACK_MISMATCH:BYTES' },
    {
      response: {
        status: 500,
        data: { error: { message: 'ARTIFACT_STORE_DOWNLOAD_FAILED' } },
      },
    },
    {
      response: {
        status: 500,
        data: {
          error: {
            code: 'INTERNAL_ERROR',
            message: '服务器内部错误',
            stack:
              'Error: ARTIFACT_READBACK_MISMATCH:METADATA\n at private-location',
          },
        },
      },
    },
  ])(
    'does not confuse a known source failure with connectivity or restored material',
    (reason) => {
      const view = libraryReadErrorPresentation(reason);
      expect(view.title).toBe('原文暂时无法读取');
      expect(view.sourceUnavailable).toBe(true);
      expect(view.message).toContain('已有工程评估记录不等于原件已恢复');
      expect(view.message).toContain('不展示资料内容或最新候选状态');
      expect(view.message).not.toMatch(/连接|private-location|ARTIFACT/u);
    },
  );

  it.each([401, 403, 404])(
    'preserves authentication/authorization semantics for HTTP %s',
    (status) => {
      const view = libraryReadErrorPresentation({
        response: {
          status,
          data: { error: { code: 'ARTIFACT_READBACK_MISMATCH:METADATA' } },
        },
      });
      expect(view.sourceUnavailable).toBe(false);
      expect(view.title).toBe(
        status === 401 ? '请先登录' : '当前工程评估无法读取',
      );
    },
  );

  it('preserves canonical object-level denial', () => {
    expect(
      libraryReadErrorPresentation({ code: 'CANONICAL_WORK_ITEM_NOT_FOUND' })
        .message,
    ).toContain('无法找到该工程评估，或当前账户没有查看权限');
  });

  it.each([
    new Error('unrelated server failure'),
    new Error('AEO_ARTIFACT_READBACK_MISMATCH:METADATA'),
    {
      response: {
        status: 500,
        data: { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      },
    },
    {
      response: {
        status: 500,
        data: {
          error: {
            stack: 'Error: other failure\n ARTIFACT_READBACK_MISMATCH:METADATA',
          },
        },
      },
    },
  ])(
    'does not infer source loss or a connection issue from unrelated failures',
    (reason) => {
      expect(libraryReadErrorPresentation(reason)).toMatchObject({
        sourceUnavailable: false,
        message: '当前资料暂时无法读取，请稍后重试。',
      });
    },
  );

  it('uses the connection message only for a known network error', () => {
    expect(libraryReadErrorPresentation({ code: 'ERR_NETWORK' }).message).toBe(
      '当前连接无法读取资料，请稍后重试。',
    );
  });

  it('does not include arbitrary error payloads or unsafe trace strings in diagnostics', () => {
    expect(
      summarizeCanonicalDocumentReadFailure({
        code: 'unexpected secret message',
        message: 'SECRET',
        config: { headers: { Authorization: 'SECRET' } },
        response: {
          status: 500,
          headers: { 'x-tt-logid': 'SECRET\nHEADER' },
          data: { secret: 'SECRET' },
        },
      }),
    ).toEqual({
      statusCode: 500,
      code: null,
      traceId: null,
      sourceUnavailable: false,
    });
  });
});
