const request = jest.fn();

jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({
  axiosForBackend: request,
}));

import {
  rejectCandidate,
  selectCandidate,
} from '../../client/src/api/external-discovery';

describe('external discovery authenticated client actions', () => {
  beforeEach(() => {
    request.mockReset();
    request.mockResolvedValue({ data: { status: 'HUMAN_REVIEW_RECORDED' } });
  });

  it.each(['select', 'reject'] as const)(
    'sends %s without self-reported actor or business authority',
    async (action) => {
      const call = action === 'select' ? selectCandidate : rejectCandidate;
      await call('run / 1', 'candidate / 1');
      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith({
        method: 'POST',
        url: `/api/external-discovery/search-runs/run%20%2F%201/candidates/candidate%20%2F%201/${action}`,
        data: {},
      });
      const config = request.mock.calls[0]?.[0];
      expect(JSON.stringify(config)).not.toMatch(
        /actor|authority|documentVersion|currentness/i,
      );
    },
  );
});
