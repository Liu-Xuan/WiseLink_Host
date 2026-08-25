const request = jest.fn();

jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({
  axiosForBackend: request,
}));

jest.mock('@lark-apaas/client-toolkit/logger', () => ({
  logger: { error: jest.fn() },
}));

import {
  confirmIntegratedOverallForAeo,
  generateAeoCandidate,
  getDocumentParsingPage,
  getLibraryIndex,
  isCanonicalObjectNotFound,
  queryParsedUnits,
  recordEngineerReview,
} from '../../client/src/api/canonical-host';

describe('canonical host assessment client', () => {
  beforeEach(() => request.mockReset());

  it('uses the default Reader query for an empty document parsing request', async () => {
    request.mockResolvedValue({ status: 200, data: { workItem: {} } });

    await expect(getDocumentParsingPage('WI-SB-1001', '')).resolves.toEqual({
      workItem: {},
    });
    expect(request).toHaveBeenCalledWith({
      url: '/api/canonical-host/work-items/WI-SB-1001/document-parsing',
      method: 'GET',
      params: { query: 'applicability' },
    });
  });

  it('uses the default Reader query for a whitespace document parsing request', async () => {
    request.mockResolvedValue({ status: 200, data: { workItem: {} } });

    await expect(getDocumentParsingPage('WI-SB-1001', '   ')).resolves.toEqual({
      workItem: {},
    });
    expect(request).toHaveBeenCalledWith({
      url: '/api/canonical-host/work-items/WI-SB-1001/document-parsing',
      method: 'GET',
      params: { query: 'applicability' },
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
});
