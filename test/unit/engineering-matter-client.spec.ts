const request = jest.fn();
let generation = 3;
const requireAuthentication = jest.fn();
jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({
  axiosForBackend: request,
}));
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => generation,
  requireCanonicalHostClientAuthentication: requireAuthentication,
}));

import {
  createEngineeringMatter,
  getEngineeringMatter,
  getEngineeringMatterDirectory,
  getEngineeringMatterWorkspace,
  linkEngineeringMatterWorkItem,
} from '../../client/src/api/engineering-matter';

function matter() {
  return {
    matterId: 'M/1',
    currentRevision: { matterRevisionId: 'MR-1', revisionNo: 1 },
    catalog: { entries: [{ workItemId: 'WI-1', relationRole: 'PRIMARY' }] },
  };
}

describe('engineering matter browser API bindings', () => {
  beforeEach(() => {
    request.mockReset();
    requireAuthentication.mockReset();
    generation = 3;
  });
  it('reads a real directory without creating matters or reading member sources', async () => {
    const data = { items: [], nextCursor: null, fileReadPerformed: false };
    const params = {
      search: '构型核查',
      workItemId: 'WI-1',
      cursor: 'cursor-1',
      limit: 24,
    };
    const controller = new AbortController();
    request.mockResolvedValue({ status: 200, data });
    expect(await getEngineeringMatterDirectory(params, controller.signal)).toBe(
      data,
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/api/canonical-host/engineering-matters',
        method: 'GET',
        params,
        signal: controller.signal,
      }),
    );
  });
  it('requires matching matter catalog and working result identity', async () => {
    request
      .mockResolvedValueOnce({ status: 200, data: matter() })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          matterId: 'M/1',
          currentMatterRevisionId: 'MR-1',
          current: null,
        },
      });
    expect((await getEngineeringMatterWorkspace('M/1')).matter.matterId).toBe(
      'M/1',
    );
    request
      .mockResolvedValueOnce({ status: 200, data: matter() })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          matterId: 'M/1',
          currentMatterRevisionId: 'MR-2',
          current: null,
        },
      });
    await expect(getEngineeringMatterWorkspace('M/1')).rejects.toMatchObject({
      statusCode: 409,
    });
    request
      .mockResolvedValueOnce({ status: 200, data: matter() })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          matterId: 'M/1',
          currentMatterRevisionId: 'MR-1',
          current: {
            substantiveResultRef: 'saved-result',
            substantiveResultRevision: 2,
            state: {
              substantiveResult: {
                scope: { kind: 'ENGINEERING_MATTER', matterId: 'other' },
                resultRef: 'saved-result',
                resultRevision: 2,
              },
            },
          },
        },
      });
    await expect(getEngineeringMatterWorkspace('M/1')).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it('keeps creation and association request IDs and expected revisions without actor fields', async () => {
    const create = {
      requestId: 'REQ-C',
      primaryWorkItemId: 'WI-1',
      title: '构型核查',
    };
    request.mockResolvedValueOnce({
      status: 200,
      data: { matter: matter(), created: true },
    });
    await createEngineeringMatter(create);
    expect(request.mock.calls[0][0].data).toBe(create);
    const input = {
      requestId: 'REQ-L',
      expectedMatterRevision: 1,
      workItemId: 'WI-2',
    };
    request.mockResolvedValueOnce({
      status: 200,
      data: {
        matter: {
          ...matter(),
          catalog: {
            entries: [
              ...matter().catalog.entries,
              { workItemId: 'WI-2', relationRole: 'RELATED' },
            ],
          },
        },
        linked: true,
        replayed: false,
      },
    });
    await linkEngineeringMatterWorkItem('M/1', input);
    expect(request.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        url: '/api/canonical-host/engineering-matters/M%2F1/work-items',
        data: input,
      }),
    );
    expect(request.mock.calls[1][0].data).not.toHaveProperty('actor');
  });
  it('rejects foreign create/link readbacks instead of navigating to their matter', async () => {
    request.mockResolvedValue({ status: 200, data: { matter: matter() } });
    await expect(
      createEngineeringMatter({
        requestId: 'REQ',
        primaryWorkItemId: 'WI-OTHER',
        title: 'scope',
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      linkEngineeringMatterWorkItem('M-OTHER', {
        requestId: 'REQ',
        workItemId: 'WI-1',
        expectedMatterRevision: 1,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(['resolved', 'rejected'])(
    'uses the existing authentication handler for HTTP 401 (%s)',
    async (mode) => {
      const response = {
        status: 401,
        data: { error: { code: 'LOGIN_REQUIRED' } },
      };
      if (mode === 'resolved') request.mockResolvedValue(response);
      else request.mockRejectedValue({ response });
      await expect(getEngineeringMatter('M/1')).rejects.toMatchObject({
        statusCode: 401,
      });
      expect(requireAuthentication).toHaveBeenCalledWith(3);
    },
  );
  it('rejects a response received after the account session changed', async () => {
    request.mockImplementation(async () => {
      generation = 4;
      return { status: 200, data: matter() };
    });
    await expect(getEngineeringMatter('M/1')).rejects.toThrow('登录状态已变化');
  });
});
