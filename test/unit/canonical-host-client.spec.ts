const request = jest.fn();

jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({
  axiosForBackend: request,
}));

jest.mock('@lark-apaas/client-toolkit/logger', () => ({
  logger: { error: jest.fn() },
}));

import {
  confirmIntegratedOverallForAeo,
  createWorkItemFromDocumentVersion,
  generateAeoCandidate,
  getDocumentParsingPage,
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

  it('creates a new development WorkItem from an exact DocumentVersion', async () => {
    request.mockResolvedValue({
      status: 200,
      data: {
        schemaVersion: 'wiselink.3_1.ordinary_work_item_run.v1',
        workItemCreated: true,
        workItemReused: false,
        actionAttemptId: 'ATT-NEW-SB',
        result: { workItem: { workItemId: 'WI-NEW-SB' } },
      },
    });

    await expect(
      createWorkItemFromDocumentVersion(
        '  document_version_sb  ',
        '0f8fad5b-d9cb-469f-a165-70867728950e',
      ),
    ).resolves.toEqual({
      schemaVersion: 'wiselink.3_1.ordinary_work_item_run.v1',
      workItemCreated: true,
      workItemReused: false,
      actionAttemptId: 'ATT-NEW-SB',
      result: { workItem: { workItemId: 'WI-NEW-SB' } },
    });
    expect(request).toHaveBeenCalledWith({
      url: '/api/canonical-host/work-items/development-runs',
      method: 'POST',
      data: {
        documentVersionId: 'document_version_sb',
        developmentRunToken: '0f8fad5b-d9cb-469f-a165-70867728950e',
        query: 'applicability',
      },
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
