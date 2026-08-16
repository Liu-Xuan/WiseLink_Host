const request = jest.fn();

jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({
  axiosForBackend: request,
}));

jest.mock('@lark-apaas/client-toolkit/logger', () => ({
  logger: { error: jest.fn() },
}));

import {
  evaluateAssessment,
  runPhase10AeoCandidateLoop,
  resynthesizeAssessment,
} from '../../client/src/api/canonical-host';

describe('canonical host assessment client', () => {
  beforeEach(() => request.mockReset());

  it('uses the authenticated same-origin endpoint once to evaluate', async () => {
    request.mockResolvedValue({ status: 200, data: { revision: 5 } });

    await expect(evaluateAssessment('WI-SB-1001')).resolves.toEqual({
      revision: 5,
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({
      url: '/api/canonical-host/work-items/WI-SB-1001/assessment/evaluate',
      method: 'POST',
      data: {},
    });
  });

  it('carries the fresh WorkItem revision and one engineer change without retry', async () => {
    request.mockResolvedValue({ status: 200, data: { revision: 6 } });
    const input = {
      expectedRevision: 5,
      criterionId: 'JAC-001',
      decision: 'deferred' as const,
      comment: '需要补充受控证据。',
    };

    await expect(
      resynthesizeAssessment('WI-SB-1001', input),
    ).resolves.toEqual({ revision: 6 });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({
      url: '/api/canonical-host/work-items/WI-SB-1001/assessment/resynthesize',
      method: 'POST',
      data: input,
    });
  });

  it('does not retry a server-side CAS conflict', async () => {
    request.mockRejectedValue({
      response: {
        status: 409,
        data: { error: { code: 'WORK_ITEM_CAS_CONFLICT' } },
      },
    });

    await expect(
      resynthesizeAssessment('WI-SB-1001', {
        expectedRevision: 5,
        criterionId: 'JAC-001',
        decision: 'deferred',
        comment: '需要补充受控证据。',
      }),
    ).rejects.toBeDefined();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('calls the fixed Phase10 path once with no client identity or locator', async () => {
    request.mockResolvedValue({
      status: 201,
      data: { status: 'CANDIDATE_WORD_EXPORTED' },
    });

    await expect(runPhase10AeoCandidateLoop()).resolves.toEqual({
      status: 'CANDIDATE_WORD_EXPORTED',
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({
      url: '/api/canonical-host/validation/phase10-aeo-candidate-loop',
      method: 'POST',
      data: {},
      meta: { autoJumpToLogin: false },
    });
  });
});
