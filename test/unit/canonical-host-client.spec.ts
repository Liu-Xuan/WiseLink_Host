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
  configureApplicabilitySelection,
  confirmReviewActionDraft,
  confirmIntegratedOverallForAeo,
  createOrResumeReviewConversation,
  generateAeoCandidate,
  getApplicabilitySelection,
  getCurrentReviewConversation,
  getDocumentParsingPage,
  getStructuredContentPage,
  getLibraryIndex,
  getOverallRegenerationStatus,
  isCanonicalObjectNotFound,
  queryParsedUnits,
  recordEngineerReview,
  reloadReviewConversation,
  requestOverallRegeneration,
  requireOfficialOauthSession,
} from '../../client/src/api/canonical-host';
import { createRequestCorrelationId } from '../../client/src/utils/request-correlation-id';

describe('canonical host assessment client', () => {
  beforeEach(() => {
    request.mockReset();
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
    expect(request).toHaveBeenCalledWith({
      url: '/api/identity/whoami',
      method: 'GET',
    });
  });

  it('fails closed when the Hosted whoami response is not an opaque session', async () => {
    request.mockResolvedValue({
      status: 200,
      data: { authenticated: true, verifiedIdentity: {} },
    });

    await expect(requireOfficialOauthSession()).rejects.toThrow(
      'OFFICIAL_OAUTH_SESSION_REQUIRED',
    );
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

  it('configures only aircraft and as-of, then requires a fresh GET readback', async () => {
    request
      .mockResolvedValueOnce({
        status: 200,
        data: { selectionRevision: 'mutation-response' },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          selectionRevision: 'fresh-readback',
          aircraftIdentifier: 'B-TEST',
          asOf: '2026-01-02',
        },
      });

    await expect(
      configureApplicabilitySelection('WI-SB-1001', {
        aircraftIdentifier: 'B-TEST',
        asOf: '2026-01-02',
      }),
    ).resolves.toMatchObject({ selectionRevision: 'fresh-readback' });
    expect(request).toHaveBeenNthCalledWith(1, {
      url: '/api/work-items/WI-SB-1001/applicability-selection',
      method: 'PUT',
      data: {
        aircraftIdentifier: 'B-TEST',
        asOf: '2026-01-02',
      },
    });
    expect(request).toHaveBeenNthCalledWith(2, {
      url: '/api/work-items/WI-SB-1001/applicability-selection',
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

  it('closes and confirms only by bound path with no client-resubmitted draft', async () => {
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
    await confirmReviewActionDraft('WI-SB-1001', 'RC-001', 'RT-004');

    expect(request).toHaveBeenNthCalledWith(1, {
      url: '/api/work-items/WI-SB-1001/review-conversations/RC-001/close',
      method: 'POST',
      data: {},
    });
    expect(request).toHaveBeenNthCalledWith(2, {
      url: '/api/work-items/WI-SB-1001/review-conversations/RC-001/turns/RT-004/confirm-draft',
      method: 'POST',
      data: {},
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
