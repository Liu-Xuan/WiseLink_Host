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
} from '../../client/src/api/canonical-host';

describe('canonical host assessment client', () => {
  beforeEach(() => request.mockReset());

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
