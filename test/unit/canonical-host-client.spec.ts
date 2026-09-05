const request = jest.fn();
const resolveAppUrl = jest.fn();
const originalClientBasePath = process.env.CLIENT_BASE_PATH;
const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'crypto',
);

jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({
  axiosForBackend: request,
}));

jest.mock('@lark-apaas/client-toolkit/utils/resolveAppUrl', () => ({
  resolveAppUrl,
}));

jest.mock('@lark-apaas/client-toolkit/logger', () => ({
  logger: { error: jest.fn() },
}));

import {
  appendReviewTextTurn,
  canonicalPdfPreviewUrl,
  closeReviewConversation,
  confirmReviewActionDraft,
  confirmIntegratedOverallForAeo,
  createOrResumeReviewConversation,
  generateAeoCandidate,
  getApplicabilitySelection,
  getCanonicalHostIdentityContext,
  getCanonicalHostClientSessionGeneration,
  getCurrentReviewConversation,
  getDocumentParsingPage,
  getStructuredContentPage,
  getLibraryIndex,
  getOverallRegenerationStatus,
  isCanonicalObjectNotFound,
  isCanonicalHostClientSessionAuthenticationRequired,
  invalidateCanonicalHostClientSession,
  queryParsedUnits,
  recordEngineerReview,
  reloadReviewConversation,
  requestOverallRegeneration,
  requireOfficialOauthSession,
  subscribeCanonicalHostClientSession,
} from '../../client/src/api/canonical-host';
import { createRequestCorrelationId } from '../../client/src/utils/request-correlation-id';
import { logger } from '@lark-apaas/client-toolkit/logger';

describe('canonical host assessment client', () => {
  beforeEach(() => {
    invalidateCanonicalHostClientSession();
    request.mockReset();
    jest.mocked(logger.error).mockClear();
    resolveAppUrl.mockReset();
    resolveAppUrl.mockImplementation((path: string) => path);
  });

  afterEach(() => {
    restoreGlobalCrypto();
    if (originalClientBasePath === undefined) {
      delete process.env.CLIENT_BASE_PATH;
    } else {
      process.env.CLIENT_BASE_PATH = originalClientBasePath;
    }
  });

  it('preserves document HTTP 500 for independent saved-review readback', async () => {
    request.mockResolvedValue({
      status: 500,
      data: {
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'Source unavailable' },
      },
    });
    await expect(getDocumentParsingPage('WI-SAVED', '')).rejects.toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
    });
  });

  it.each(['resolved', 'rejected'])(
    'preserves an exact source failure and logs only safe fields (%s response)',
    async (mode) => {
      const response = {
        status: 500,
        headers: {
          'x-tt-logid': '0123456789abcdef0123456789abcdef',
          'set-cookie': 'SYNTHETIC_SECRET_COOKIE',
        },
        data: {
          error: {
            code: 'INTERNAL_ERROR',
            message: '服务器内部错误',
            stack:
              'Error: ARTIFACT_READBACK_MISMATCH:METADATA\n at SYNTHETIC_PRIVATE_PATH',
            unrelated: 'SYNTHETIC_PRIVATE_BODY',
          },
        },
      };
      const axiosError = {
        message: 'Request failed with status code 500',
        code: 'ERR_BAD_RESPONSE',
        config: {
          headers: {
            Authorization: 'SYNTHETIC_SECRET_AUTH',
            Cookie: 'SYNTHETIC_SECRET_COOKIE',
          },
          url: '/private-query',
        },
        response,
      };
      if (mode === 'resolved') request.mockResolvedValue(response);
      else request.mockRejectedValue(axiosError);

      if (mode === 'resolved') {
        await expect(
          getDocumentParsingPage('WI-SOURCE-UNAVAILABLE', ''),
        ).rejects.toMatchObject({
          statusCode: 500,
          code: 'ARTIFACT_READBACK_MISMATCH:METADATA',
        });
      } else {
        await expect(
          getDocumentParsingPage('WI-SOURCE-UNAVAILABLE', ''),
        ).rejects.toBe(axiosError);
      }
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        '读取文档与解析投影失败，未确认当前资料状态',
        {
          statusCode: 500,
          code: 'ARTIFACT_READBACK_MISMATCH:METADATA',
          traceId: '0123456789abcdef0123456789abcdef',
        },
      );
      expect(JSON.stringify(jest.mocked(logger.error).mock.calls)).not.toMatch(
        /SYNTHETIC_|Authorization|Cookie|private-query|stack/u,
      );
    },
  );

  it('preflights the official opaque session through the Hosted axios bridge', async () => {
    request.mockResolvedValue({
      status: 200,
      data: {
        authenticated: true,
        verifiedIdentity: { provenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN' },
        session: { provenance: 'SERVER_OPAQUE_SESSION' },
      },
    });

    await expect(requireOfficialOauthSession()).resolves.toBeUndefined();
    await expect(requireOfficialOauthSession()).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith({
      url: '/api/identity/whoami',
      method: 'GET',
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the Hosted whoami response is not an opaque session', async () => {
    request
      .mockResolvedValueOnce({
        status: 200,
        data: { authenticated: true, verifiedIdentity: {} },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          authenticated: true,
          verifiedIdentity: { provenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN' },
          session: { provenance: 'SERVER_OPAQUE_SESSION' },
        },
      });

    await expect(requireOfficialOauthSession()).rejects.toThrow(
      'OFFICIAL_OAUTH_SESSION_REQUIRED',
    );
    await expect(requireOfficialOauthSession()).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('clears the reusable identity preflight after a protected 401', async () => {
    const authenticatedResponse = {
      status: 200,
      data: {
        authenticated: true,
        verifiedIdentity: { provenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN' },
        session: { provenance: 'SERVER_OPAQUE_SESSION' },
      },
    };
    request
      .mockResolvedValueOnce(authenticatedResponse)
      .mockResolvedValueOnce({ status: 401, data: {} })
      .mockResolvedValueOnce(authenticatedResponse);

    await expect(requireOfficialOauthSession()).resolves.toBeUndefined();
    await expect(getDocumentParsingPage('WI-SB-1001', '')).rejects.toThrow(
      'CANONICAL_PAGE_LOGIN_REQUIRED',
    );
    expect(isCanonicalHostClientSessionAuthenticationRequired()).toBe(true);
    await expect(requireOfficialOauthSession()).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('does not repeat the identity preflight after an object-level 403', async () => {
    request
      .mockResolvedValueOnce({
        status: 200,
        data: {
          authenticated: true,
          verifiedIdentity: { provenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN' },
          session: { provenance: 'SERVER_OPAQUE_SESSION' },
        },
      })
      .mockResolvedValueOnce({ status: 403, data: {} });

    await expect(requireOfficialOauthSession()).resolves.toBeUndefined();
    await expect(
      getDocumentParsingPage('WI-FORBIDDEN', ''),
    ).rejects.toMatchObject({ code: 'CANONICAL_WORK_ITEM_NOT_FOUND' });
    expect(isCanonicalHostClientSessionAuthenticationRequired()).toBe(false);
    await expect(requireOfficialOauthSession()).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('publishes one blocked generation for concurrent protected 401 responses', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeCanonicalHostClientSession(listener);
    const startedGeneration = getCanonicalHostClientSessionGeneration();
    request.mockResolvedValue({ status: 401, data: {} });

    const results = await Promise.allSettled([
      getDocumentParsingPage('WI-EXPIRED-1', ''),
      getDocumentParsingPage('WI-EXPIRED-2', ''),
    ]);
    unsubscribe();

    expect(results.map((result) => result.status)).toEqual([
      'rejected',
      'rejected',
    ]);
    expect(getCanonicalHostClientSessionGeneration()).toBe(
      startedGeneration + 1,
    );
    expect(isCanonicalHostClientSessionAuthenticationRequired()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('shares one canonical identity read across concurrent and later consumers', async () => {
    let resolveIdentity!: (value: unknown) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveIdentity = resolve;
        }),
    );

    const first = getCanonicalHostIdentityContext();
    const second = getCanonicalHostIdentityContext();
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);

    resolveIdentity({
      status: 200,
      data: {
        userId: ' user-1 ',
        tenantId: ' tenant-1 ',
        developmentIntakeAvailable: true,
      },
    });
    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        userId: 'user-1',
        tenantId: 'tenant-1',
        developmentIntakeAvailable: true,
      },
      {
        userId: 'user-1',
        tenantId: 'tenant-1',
        developmentIntakeAvailable: true,
      },
    ]);
    await expect(getCanonicalHostIdentityContext()).resolves.toMatchObject({
      userId: 'user-1',
      tenantId: 'tenant-1',
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not cache failed or incomplete canonical identity reads', async () => {
    request
      .mockResolvedValueOnce({
        status: 503,
        data: {},
      })
      .mockResolvedValueOnce({
        status: 200,
        data: { userId: '', tenantId: 'tenant-1' },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: { userId: 'user-1', tenantId: 'tenant-1' },
      });

    await expect(getCanonicalHostIdentityContext()).rejects.toThrow(
      'CANONICAL_HOST_IDENTITY_UNAVAILABLE',
    );
    await expect(getCanonicalHostIdentityContext()).rejects.toThrow(
      'CANONICAL_HOST_IDENTITY_UNAVAILABLE',
    );
    await expect(getCanonicalHostIdentityContext()).resolves.toMatchObject({
      userId: 'user-1',
      tenantId: 'tenant-1',
    });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('cannot let a stale identity response refill a new session generation', async () => {
    let resolveOldIdentity!: (value: unknown) => void;
    request
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOldIdentity = resolve;
          }),
      )
      .mockResolvedValueOnce({
        status: 200,
        data: { userId: 'user-b', tenantId: 'tenant-b' },
      });

    const oldRead = getCanonicalHostIdentityContext();
    await Promise.resolve();
    invalidateCanonicalHostClientSession();
    await expect(getCanonicalHostIdentityContext()).resolves.toMatchObject({
      userId: 'user-b',
      tenantId: 'tenant-b',
    });
    resolveOldIdentity({
      status: 200,
      data: { userId: 'user-a', tenantId: 'tenant-a' },
    });
    await expect(oldRead).rejects.toThrow('CANONICAL_HOST_IDENTITY_STALE');
    await expect(getCanonicalHostIdentityContext()).resolves.toMatchObject({
      userId: 'user-b',
      tenantId: 'tenant-b',
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not let a stale protected 401 block a newer session generation', async () => {
    let resolveOldPage!: (value: unknown) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOldPage = resolve;
        }),
    );

    const oldPage = getDocumentParsingPage('WI-OLD-SESSION', '');
    await Promise.resolve();
    invalidateCanonicalHostClientSession();
    resolveOldPage({ status: 401, data: {} });

    await expect(oldPage).rejects.toThrow('CANONICAL_PAGE_LOGIN_REQUIRED');
    expect(isCanonicalHostClientSessionAuthenticationRequired()).toBe(false);
  });

  it('does not let a stale whoami 401 clear a newer identity cache', async () => {
    let resolveOldWhoami!: (value: unknown) => void;
    request
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOldWhoami = resolve;
          }),
      )
      .mockResolvedValueOnce({
        status: 200,
        data: { userId: 'user-b', tenantId: 'tenant-b' },
      });

    const oldWhoami = requireOfficialOauthSession();
    await Promise.resolve();
    invalidateCanonicalHostClientSession();
    await expect(getCanonicalHostIdentityContext()).resolves.toMatchObject({
      userId: 'user-b',
      tenantId: 'tenant-b',
    });
    resolveOldWhoami({ status: 401, data: {} });

    await expect(oldWhoami).rejects.toThrow('OFFICIAL_OAUTH_SESSION_REQUIRED');
    await expect(getCanonicalHostIdentityContext()).resolves.toMatchObject({
      userId: 'user-b',
      tenantId: 'tenant-b',
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('keeps empty document parsing reads separate from Reader search', async () => {
    request.mockResolvedValue({ status: 200, data: { workItem: {} } });

    await expect(getDocumentParsingPage('WI-SB-1001', '')).resolves.toEqual({
      workItem: {},
    });
    expect(request).toHaveBeenCalledWith({
      url: '/api/canonical-host/work-items/WI-SB-1001/document-parsing',
      method: 'GET',
    });
  });

  it('keeps whitespace document parsing reads separate from Reader search', async () => {
    request.mockResolvedValue({ status: 200, data: { workItem: {} } });

    await expect(getDocumentParsingPage('WI-SB-1001', '   ')).resolves.toEqual({
      workItem: {},
    });
    expect(request).toHaveBeenCalledWith({
      url: '/api/canonical-host/work-items/WI-SB-1001/document-parsing',
      method: 'GET',
    });
  });

  it('bypasses browser and platform caches only for mutation preflights', async () => {
    setGlobalCrypto(undefined);
    request
      .mockResolvedValueOnce({
        status: 200,
        data: { workItem: { revision: 12 } },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: { workItem: { revision: 13 } },
      })
      .mockResolvedValueOnce({
        status: 202,
        data: { regeneration: { status: 'REQUESTED' }, replayed: false },
      });

    await expect(
      getDocumentParsingPage('WI-SB-1001', '', {
        freshness: 'mutation',
      }),
    ).resolves.toMatchObject({ workItem: { revision: 12 } });
    await expect(
      getDocumentParsingPage('WI-SB-1001', '', {
        freshness: 'mutation',
      }),
    ).resolves.toMatchObject({ workItem: { revision: 13 } });

    const firstConfig = request.mock.calls[0][0];
    const secondConfig = request.mock.calls[1][0];
    expect(firstConfig).toMatchObject({
      url: '/api/canonical-host/work-items/WI-SB-1001/document-parsing',
      method: 'GET',
      params: { _fresh: expect.any(String) },
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    });
    expect(secondConfig.params._fresh).not.toBe(firstConfig.params._fresh);

    const requestId = createRequestCorrelationId();
    await expect(
      requestOverallRegeneration('WI-SB-1001', {
        requestId,
        expectedRevision: 13,
        sourceIdentity: {
          documentVersionId: 'DV-13',
          sourceArtifactId: 'SOURCE-13',
          sourceFileSha256: 'source-sha-13',
          packageId: 'PACKAGE-13',
          packageArtifactSha256: 'package-sha-13',
        },
      }),
    ).resolves.toMatchObject({ replayed: false });
    expect(request.mock.calls[2][0].data.requestId).toBe(requestId);
    expect(requestId).toMatch(/^wl_[A-Za-z0-9_-]+$/u);
  });

  it('forwards only controlled browse pagination inputs', async () => {
    request.mockResolvedValue({
      status: 200,
      data: { status: 'FRESH_READ', units: [] },
    });

    await expect(
      getStructuredContentPage('WI-SB/1001', {
        cursor: '24',
        limit: 24,
        expectedRevision: 7,
      }),
    ).resolves.toMatchObject({ status: 'FRESH_READ' });
    expect(request).toHaveBeenCalledWith({
      url: '/api/canonical-host/work-items/WI-SB%2F1001/structured-content',
      method: 'GET',
      params: { cursor: '24', limit: 24, expectedRevision: 7 },
    });
  });

  it('trims and forwards a non-empty document parsing query', async () => {
    request.mockResolvedValue({ status: 200, data: { workItem: {} } });

    await expect(
      getDocumentParsingPage('WI-SB-1001', '  sourceRef APP-001  '),
    ).resolves.toEqual({ workItem: {} });
    expect(request).toHaveBeenCalledWith({
      url: '/api/canonical-host/work-items/WI-SB-1001/document-parsing',
      method: 'GET',
      params: { query: 'sourceRef APP-001' },
    });
  });

  it('forwards a trimmed SourceRef as an exact read-only locator', async () => {
    setGlobalCrypto(undefined);
    request.mockResolvedValue({ status: 200, data: { workItem: {} } });

    await expect(
      getDocumentParsingPage('WI-SB-1001', '', {
        sourceRef: '  urn:techpub:source-ref:v1:sha256:abc123  ',
        freshness: 'source-link',
      }),
    ).resolves.toEqual({ workItem: {} });
    expect(request).toHaveBeenCalledWith({
      url: '/api/canonical-host/work-items/WI-SB-1001/document-parsing',
      method: 'GET',
      params: {
        sourceRef: 'urn:techpub:source-ref:v1:sha256:abc123',
        _fresh: expect.any(String),
      },
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    });
  });

  it('posts only the Host-owned overall regeneration request contract', async () => {
    const input = {
      requestId: 'ce59df8f-6984-40a8-98b9-05dde4ef233f',
      expectedRevision: 12,
      sourceIdentity: {
        documentVersionId: 'DV-12',
        sourceArtifactId: 'SA-12',
        sourceFileSha256: 'source-sha',
        packageId: 'package-12',
        packageArtifactSha256: 'package-sha',
      },
    };
    request.mockResolvedValue({
      status: 202,
      data: { regeneration: { status: 'REQUESTED' }, replayed: false },
    });

    await expect(
      requestOverallRegeneration('WI-SB/1001', input),
    ).resolves.toMatchObject({ replayed: false });
    expect(request).toHaveBeenCalledWith({
      url: '/api/canonical-host/work-items/WI-SB%2F1001/integrated-assessment/overall-regeneration-requests',
      method: 'POST',
      data: input,
    });
    expect(request.mock.calls[0][0].data).not.toHaveProperty('staleReason');
    expect(request.mock.calls[0][0].data).not.toHaveProperty('actor');
    expect(request.mock.calls[0][0].data).not.toHaveProperty('tenant');
  });

  it('polls the encoded regeneration request without exposing it in the UI contract', async () => {
    request.mockResolvedValue({
      status: 200,
      data: { status: 'RUNNING', attemptRef: 'internal-attempt' },
    });

    await expect(
      getOverallRegenerationStatus('WI-SB/1001', 'request/one'),
    ).resolves.toMatchObject({ status: 'RUNNING' });
    expect(request).toHaveBeenCalledWith({
      url: '/api/canonical-host/work-items/WI-SB%2F1001/integrated-assessment/overall-regeneration-requests/request%2Fone',
      method: 'GET',
    });
  });

  it('normalizes an overall regeneration conflict for business-language handling', async () => {
    request.mockRejectedValue({
      response: { status: 409, data: { message: 'internal CAS detail' } },
    });

    await expect(
      getOverallRegenerationStatus('WI-SB-1001', 'request-one'),
    ).rejects.toMatchObject({
      code: 'OVERALL_REGENERATION_CONFLICT',
      statusCode: 409,
    });
  });

  it('resolves the encoded PDF endpoint under Hosted and local app base paths', () => {
    const endpoint =
      '/api/canonical-host/work-items/WI-SB%2F1001/pdf-preview/opaque%2F%2Blocator';
    resolveAppUrl.mockImplementation((path: string) => {
      const configuredBasePath = process.env.CLIENT_BASE_PATH ?? '/';
      const basePath =
        configuredBasePath === '/'
          ? ''
          : configuredBasePath.replace(/\/+$/u, '');
      return `https://wiselink.example${basePath}${path}`;
    });

    process.env.CLIENT_BASE_PATH = '/app/app_hosted';
    expect(canonicalPdfPreviewUrl('WI-SB/1001', 'opaque/+locator')).toBe(
      `https://wiselink.example/app/app_hosted${endpoint}`,
    );
    process.env.CLIENT_BASE_PATH = '/';
    expect(canonicalPdfPreviewUrl('WI-SB/1001', 'opaque/+locator')).toBe(
      `https://wiselink.example${endpoint}`,
    );
    expect(resolveAppUrl).toHaveBeenNthCalledWith(1, endpoint);
    expect(resolveAppUrl).toHaveBeenNthCalledWith(2, endpoint);
    expect(() => canonicalPdfPreviewUrl('WI-SB-1001', '  ')).toThrow(
      'CANONICAL_PDF_PREVIEW_LOCATOR_INVALID',
    );
  });

  it('fresh-reads the authenticated Host applicability selection', async () => {
    request.mockResolvedValue({
      status: 200,
      data: {
        workItemId: 'WI-SB/1001',
        aircraftIdentifier: 'B-TEST',
        currentness: 'CURRENT',
      },
    });

    await expect(
      getApplicabilitySelection('WI-SB/1001'),
    ).resolves.toMatchObject({
      currentness: 'CURRENT',
    });
    expect(request).toHaveBeenCalledWith({
      url: '/api/work-items/WI-SB%2F1001/applicability-selection',
      method: 'GET',
    });
  });

  it('preserves the Host unconfigured code from a rejected 409 response', async () => {
    request.mockRejectedValue({
      response: {
        status: 409,
        data: {
          message: 'APPLICABILITY_CONTROLLED_SELECTION_NOT_CONFIGURED',
        },
      },
    });

    await expect(getApplicabilitySelection('WI-SB-1001')).rejects.toThrow(
      'APPLICABILITY_CONTROLLED_SELECTION_NOT_CONFIGURED',
    );
  });

  it('normalizes a fulfilled 403 without exposing object existence', async () => {
    request.mockResolvedValue({ status: 403, data: { message: 'forbidden' } });

    const promise = getDocumentParsingPage('WI-DIRECT-ID', '');

    await expect(promise).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
    await promise.catch((error) => {
      expect(isCanonicalObjectNotFound(error)).toBe(true);
    });
  });

  it('normalizes a rejected Axios-style 404 to the same boundary', async () => {
    request.mockRejectedValue({
      isAxiosError: true,
      response: { status: 404, data: { message: 'not found' } },
    });

    await expect(
      getDocumentParsingPage('WI-MISSING', ''),
    ).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('normalizes a fulfilled LibraryIndex 403 without exposing object existence', async () => {
    request.mockResolvedValue({ status: 403, data: { message: 'forbidden' } });

    await expect(getLibraryIndex('WI-DIRECT-ID')).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('normalizes a rejected LibraryIndex 404 to the same boundary', async () => {
    request.mockRejectedValue({
      isAxiosError: true,
      response: { status: 404, data: { message: 'not found' } },
    });

    await expect(getLibraryIndex('WI-MISSING')).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('normalizes fulfilled 403 for a direct-ID mutation before exposing a distinct error', async () => {
    request.mockResolvedValue({ status: 403, data: { message: 'forbidden' } });

    await expect(
      recordEngineerReview('WI-DIRECT-ID', {
        expectedRevision: 4,
        criterionId: 'JAC-001',
        decision: 'deferred',
        comment: 'review',
      }),
    ).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('normalizes rejected 404 for a body-carried direct WorkItem ID', async () => {
    request.mockRejectedValue({
      isAxiosError: true,
      response: { status: 404, data: { message: 'not found' } },
    });

    await expect(
      queryParsedUnits({
        workItemId: 'WI-DIRECT-ID',
        query: 'applicability',
      } as never),
    ).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('exposes only the explicit human confirmation action to the browser', async () => {
    request.mockResolvedValue({ status: 200, data: { revision: 10 } });

    await expect(confirmIntegratedOverallForAeo('WI-SB-1001')).resolves.toEqual(
      {
        revision: 10,
      },
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({
      url: '/api/canonical-host/work-items/WI-SB-1001/integrated-assessment/confirm-for-aeo',
      method: 'POST',
      data: {},
    });
  });

  it('sends no client target or authority when generating the AEO candidate', async () => {
    request.mockResolvedValue({
      status: 200,
      data: { status: 'CANDIDATE_WORD_EXPORTED' },
    });

    await expect(generateAeoCandidate('WI-SB-1001')).resolves.toEqual({
      status: 'CANDIDATE_WORD_EXPORTED',
    });
    expect(request).toHaveBeenCalledWith({
      url: '/api/canonical-host/work-items/WI-SB-1001/aeo/candidate',
      method: 'POST',
      data: {},
    });
  });

  it('creates or resumes the single current review conversation with an empty body', async () => {
    request.mockResolvedValue({
      status: 200,
      data: { conversation: { status: 'ACTIVE' }, resumed: true },
    });

    await expect(
      createOrResumeReviewConversation('WI-SB-1001'),
    ).resolves.toMatchObject({ resumed: true });
    expect(request).toHaveBeenCalledWith({
      url: '/api/work-items/WI-SB-1001/review-conversations/current',
      method: 'POST',
      data: {},
    });
  });

  it('fresh-reads the current review conversation without creating browser state', async () => {
    request.mockResolvedValue({
      status: 200,
      data: { conversation: null, currentWorkItemRevision: 12 },
    });

    await expect(
      getCurrentReviewConversation('WI-SB-1001'),
    ).resolves.toMatchObject({ currentWorkItemRevision: 12 });
    await expect(reloadReviewConversation('WI-SB-1001')).resolves.toMatchObject(
      { currentWorkItemRevision: 12 },
    );
    expect(request).toHaveBeenNthCalledWith(1, {
      url: '/api/work-items/WI-SB-1001/review-conversations/current',
      method: 'GET',
    });
    expect(request).toHaveBeenNthCalledWith(2, {
      url: '/api/work-items/WI-SB-1001/review-conversations/current',
      method: 'GET',
    });
  });

  it('preserves the caller requestId and exact official attachment selection for append replay', async () => {
    request.mockResolvedValue({
      status: 200,
      data: { conversation: {}, turn: {}, replayed: false },
    });
    const input = {
      requestId: 'req-review-001',
      userMessage: '请核对新增并行要求。',
      attachmentSelection: {
        bucketId: 'official-bucket',
        filePath: 'wiselink/review-input/req-review-001/input.pdf',
      },
    };

    await expect(
      appendReviewTextTurn('WI-SB-1001', 'RC-001', input),
    ).resolves.toMatchObject({ replayed: false });
    expect(request).toHaveBeenCalledWith({
      url: '/api/work-items/WI-SB-1001/review-conversations/RC-001/turns',
      method: 'POST',
      data: input,
    });
  });

  it('preserves nested Review error metadata for safe operator readback', async () => {
    request.mockRejectedValue({
      response: {
        status: 503,
        data: {
          error: {
            code: 'REVIEW_HOSTED_RUNTIME_UNAVAILABLE',
            message: 'Review generation is temporarily unavailable.',
            retryable: true,
            operatorAction: 'RELEASE_SUCCESSOR_ATTEMPT',
            timestamp: 1_788_000_000_000,
          },
        },
      },
    });

    await expect(
      appendReviewTextTurn('WI-SB-1001', 'RC-001', {
        requestId: 'req-review-observable-001',
        userMessage: '请继续核对当前适用性。',
      }),
    ).rejects.toMatchObject({
      code: 'REVIEW_HOSTED_RUNTIME_UNAVAILABLE',
      statusCode: 503,
      retryable: true,
      operatorAction: 'RELEASE_SUCCESSOR_ATTEMPT',
      timestamp: 1_788_000_000_000,
    });
  });

  it('closes and confirms only by bound path plus the Host-issued draft handle', async () => {
    request
      .mockResolvedValueOnce({
        status: 200,
        data: { conversation: { status: 'CLOSED' }, alreadyClosed: false },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          conversation: {},
          turn: {},
          reviewAction: { workItemRevision: 13, overallStatus: 'STALE' },
        },
      });

    await closeReviewConversation('WI-SB-1001', 'RC-001');
    await confirmReviewActionDraft('WI-SB-1001', 'RC-001', 'RT-004', {
      reviewActionDraftRef: 'RAD-DRAFT-004',
      expectedRevision: 12,
    });

    expect(request).toHaveBeenNthCalledWith(1, {
      url: '/api/work-items/WI-SB-1001/review-conversations/RC-001/close',
      method: 'POST',
      data: {},
    });
    expect(request).toHaveBeenNthCalledWith(2, {
      url: '/api/work-items/WI-SB-1001/review-conversations/RC-001/turns/RT-004/confirm-draft',
      method: 'POST',
      data: {
        reviewActionDraftRef: 'RAD-DRAFT-004',
        expectedRevision: 12,
      },
    });
  });
});

function setGlobalCrypto(value: unknown): void {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value,
  });
}

function restoreGlobalCrypto(): void {
  if (originalCryptoDescriptor) {
    Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor);
    return;
  }
  Reflect.deleteProperty(globalThis, 'crypto');
}
