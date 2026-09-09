import { ReviewAilyService } from '../../server/modules/canonical-host/review-aily.service';
import { sealAilyUserGrant } from '../../server/modules/identity/aily-user-grant.codec';
import type { EngineeringMatterWorkingRepository } from '../../server/modules/canonical-host/engineering-matter-working.repository';

describe('review Aily queries', () => {
  const env = { ...process.env };
  const originalFetch = globalThis.fetch;
  const actor = {
    actorId: 'actor-1',
    tenantId: 'tenant-1',
    sessionId: '11111111-1111-4111-8111-111111111111',
  };
  beforeEach(() => {
    process.env.FEISHU_OAUTH_CLIENT_ID = 'cli_test';
    process.env.FEISHU_OAUTH_CLIENT_SECRET = 'test-only-secret';
    process.env.WL_AILY_AGENT_ID = 'agent_test';
  });
  afterEach(() => {
    process.env = { ...env };
    globalThis.fetch = originalFetch;
  });

  function harness(grantExists = true) {
    const execute = jest.fn();
    const limit = jest.fn().mockResolvedValue(
      grantExists
        ? [
            {
              sealed: sealAilyUserGrant('test-only-user-token', 'hash:mapping'),
              tokenHash: 'hash',
              mappingId: 'mapping',
            },
          ]
        : [],
    );
    const where = jest.fn().mockReturnValue({ limit });
    const db = {
      execute,
      select: () => ({ from: () => ({ innerJoin: () => ({ where }) }) }),
    };
    const withActorTransaction = jest.fn(async (_actor, operation) =>
      operation({ database: db }),
    );
    const service = new ReviewAilyService({
      withActorTransaction,
    } as unknown as EngineeringMatterWorkingRepository);
    return { service, execute, withActorTransaction };
  }

  it('never makes a Feishu request without this session grant', async () => {
    const { service } = harness(false);
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock;
    expect(await service.availability(actor)).toEqual({
      available: false,
      reason: 'USER_REAUTHORIZATION_REQUIRED',
    });
    await expect(
      service.start(actor, 'ATTEMPT', 'request', 'FMC 资料'),
    ).rejects.toThrow('AILY_USER_REAUTHORIZATION_REQUIRED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stores the query before dispatch and never replays an uncertain POST', async () => {
    const { service, execute, withActorTransaction } = harness();
    execute.mockResolvedValueOnce([
      {
        query_ref: 'query',
        query_text: 'FMC',
        session_id: actor.sessionId,
        status: 'STARTING',
      },
    ]);
    execute.mockResolvedValueOnce([{ query_ref: 'query' }]);
    const fetchMock = jest
      .fn()
      .mockRejectedValue(new Error('transport unavailable'));
    globalThis.fetch = fetchMock;
    const result = await service.start(actor, 'ATTEMPT', 'request', 'FMC');
    expect(result.status).toBe('UNKNOWN');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      execute.mock.invocationCallOrder[0],
    );
    expect(
      withActorTransaction.mock.calls.every(([id]) => id === actor.actorId),
    ).toBe(true);
    execute
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          query_ref: result.queryRef,
          query_text: 'FMC',
          session_id: actor.sessionId,
          status: 'UNKNOWN',
          error_code: 'AILY_UPSTREAM_UNAVAILABLE',
        },
      ]);
    expect(
      (await service.start(actor, 'ATTEMPT', 'request', 'FMC')).status,
    ).toBe('UNKNOWN');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads only the stored agent/chat binding and returns text as unverified retrieval', async () => {
    const { service, execute } = harness();
    const queryRef = '22222222-2222-4222-8222-222222222222';
    execute.mockResolvedValueOnce([
      {
        query_ref: queryRef,
        agent_id: 'agent_test',
        chat_id: '123456',
        status: 'RUNNING',
      },
    ]);
    execute.mockResolvedValueOnce([{ query_ref: queryRef }]);
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            status: 'Completed',
            content: [
              { type: 'text', text: '检索摘录及来源链接' },
              { type: 'artifact', agent_artifact_id: 'unread' },
            ],
          },
        }),
      ),
    );
    globalThis.fetch = fetchMock;
    expect(await service.result(actor, 'ATTEMPT', queryRef)).toMatchObject({
      status: 'COMPLETED',
      answer: '检索摘录及来源链接',
      candidateOnly: true,
      originalDocumentsVerified: false,
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://open.feishu.cn/open-apis/aily/v1/agents/agent_test/chats/123456',
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      redirect: 'error',
    });
  });

  it('rejects a query outside the authorized attempt before contacting Feishu', async () => {
    const { service, execute } = harness();
    execute.mockResolvedValueOnce([]);
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock;
    await expect(
      service.result(actor, 'OTHER', '22222222-2222-4222-8222-222222222222'),
    ).rejects.toThrow('AILY_QUERY_NOT_FOUND');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
