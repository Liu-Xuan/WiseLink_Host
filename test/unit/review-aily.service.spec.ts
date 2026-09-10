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
    expect(result.status).toBe('RUNNING');
    await new Promise(setImmediate);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      execute.mock.invocationCallOrder[0],
    );
    expect(
      withActorTransaction.mock.calls.every(([id]) => id === actor.actorId),
    ).toBe(true);
    execute.mockResolvedValueOnce([]).mockResolvedValueOnce([
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

  it('returns locally saved retrieval without any read-scope request', async () => {
    const { service, execute } = harness();
    const queryRef = '22222222-2222-4222-8222-222222222222';
    execute.mockResolvedValueOnce([
      {
        query_ref: queryRef,
        agent_id: 'agent_test',
        chat_id: '123456',
        status: 'COMPLETED',
        answer_text: '检索摘录及来源链接',
      },
    ]);
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock;
    expect(await service.result(actor, 'ATTEMPT', queryRef)).toMatchObject({
      status: 'COMPLETED',
      answer: '检索摘录及来源链接',
      candidateOnly: true,
      incomplete: false,
      originalDocumentsVerified: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([400, 401, 403, 404, 422])(
    'records explicit HTTP %s rejection as FAILED without retry',
    async (status) => {
      const { service, execute } = harness();
      execute.mockResolvedValue([{ query_ref: 'query', status: 'RUNNING' }]);
      globalThis.fetch = jest
        .fn()
        .mockResolvedValue(new Response('', { status }));
      const update = jest.spyOn(
        service as never as { update: (...args: unknown[]) => Promise<void> },
        'update',
      );
      const result = await service.start(actor, 'ATTEMPT', 'request', 'FMC');
      await new Promise(setImmediate);
      expect(update).toHaveBeenLastCalledWith(
        actor,
        'ATTEMPT',
        result.queryRef,
        'FAILED',
        null,
        null,
        `AILY_HTTP_${status}`,
        undefined,
      );
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('saves partial text as UNKNOWN on EOF and never starts a GET', async () => {
    const { service, execute } = harness();
    execute.mockResolvedValue([{ query_ref: 'query', status: 'RUNNING' }]);
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response(
          'event: start\ndata: {"agent_chat_id":"123"}\n\n' +
            'event: message_delta\ndata: {"agent_chat_id":"123","delta":{"type":"content","text":"已收片段"}}\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      );
    const update = jest.spyOn(
      service as never as { update: (...args: unknown[]) => Promise<void> },
      'update',
    );
    const result = await service.start(actor, 'ATTEMPT', 'request', 'FMC');
    await new Promise(setImmediate);
    expect(update).toHaveBeenLastCalledWith(
      actor,
      'ATTEMPT',
      result.queryRef,
      'UNKNOWN',
      '123',
      '已收片段',
      'AILY_STREAM_INTERRUPTED',
      undefined,
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).stream).toBe(true);
  });

  it('marks an abandoned stream UNKNOWN while preserving saved text', async () => {
    const { service, execute } = harness();
    const queryRef = '22222222-2222-4222-8222-222222222222';
    execute
      .mockResolvedValueOnce([
        {
          query_ref: queryRef,
          status: 'RUNNING',
          answer_text: '部分答复',
          chat_id: '123',
          _created_at: new Date(Date.now() - 361_000),
        },
      ])
      .mockResolvedValueOnce([{ query_ref: queryRef }]);
    globalThis.fetch = jest.fn();
    expect(await service.result(actor, 'ATTEMPT', queryRef)).toMatchObject({
      status: 'UNKNOWN',
      answer: '部分答复',
      incomplete: true,
      error: 'AILY_STREAM_RESULT_UNCONFIRMED',
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('keeps live streams RUNNING and requires a valid grant even for saved answers', async () => {
    const queryRef = '22222222-2222-4222-8222-222222222222';
    const active = harness();
    active.execute.mockResolvedValueOnce([
      {
        query_ref: queryRef,
        status: 'RUNNING',
        _created_at: new Date(),
      },
    ]);
    globalThis.fetch = jest.fn();
    expect(
      await active.service.result(actor, 'ATTEMPT', queryRef),
    ).toMatchObject({ status: 'RUNNING' });
    const revoked = harness(false);
    revoked.execute.mockResolvedValueOnce([
      { query_ref: queryRef, status: 'COMPLETED', answer_text: 'private' },
    ]);
    await expect(
      revoked.service.result(actor, 'ATTEMPT', queryRef),
    ).rejects.toThrow('AILY_USER_REAUTHORIZATION_REQUIRED');
    expect(globalThis.fetch).not.toHaveBeenCalled();
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

  const messageRef = '33333333-3333-4333-8333-333333333333';
  const queryRef = '22222222-2222-4222-8222-222222222222';
  const input = {
    messageRef,
    requestKey: 'message-request',
    query: 'W3 尚未重评；解释 Win7 纠正的影响',
  };

  it('dispatches a persisted AILY message directly, without a retrieval wrapper or attempt', async () => {
    const { service, execute } = harness();
    execute
      .mockResolvedValueOnce([{ thread_ref: messageRef }])
      .mockResolvedValueOnce([{ query_ref: queryRef, status: 'RUNNING' }])
      .mockResolvedValue([{ query_ref: queryRef }]);
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response(
          'event: start\ndata: {"agent_chat_id":"123","session_id":"remote-1"}\n\n' +
            'event: message_delta\ndata: {"agent_chat_id":"123","delta":{"type":"content","text":"只解释，不重评"}}\n\n' +
            'event: done\ndata: {"agent_chat_id":"123","status":"Completed"}\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      );
    const update = jest.spyOn(
      service as never as { update: (...args: unknown[]) => Promise<void> },
      'update',
    );
    const result = await service.startMessage(actor, input);
    await new Promise(setImmediate);
    expect(update).toHaveBeenLastCalledWith(
      actor,
      null,
      result.queryRef,
      'COMPLETED',
      '123',
      '只解释，不重评',
      null,
      'remote-1',
    );
    const [, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(init.body).user_message.content[0].text).toBe(
      input.query,
    );
    expect(JSON.parse(init.body).session_id).toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(
      (globalThis.fetch as jest.Mock).mock.invocationCallOrder[0],
    ).toBeGreaterThan(execute.mock.invocationCallOrder[1]);
  });

  it('returns the same UNKNOWN message query without posting again', async () => {
    const { service, execute } = harness();
    execute
      .mockResolvedValueOnce([{ thread_ref: messageRef }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          query_ref: queryRef,
          request_key: input.requestKey,
          query_text: input.query,
          status: 'UNKNOWN',
          answer_text: '部分',
        },
      ]);
    globalThis.fetch = jest.fn();
    expect(await service.startMessage(actor, input)).toMatchObject({
      queryRef,
      status: 'UNKNOWN',
      answer: '部分',
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not dispatch an unowned message or unbound remote session', async () => {
    const { service, execute } = harness();
    globalThis.fetch = jest.fn();
    execute.mockResolvedValueOnce([]);
    await expect(service.startMessage(actor, input)).rejects.toThrow(
      'AILY_MESSAGE_NOT_FOUND',
    );
    execute
      .mockResolvedValueOnce([{ thread_ref: messageRef }])
      .mockResolvedValueOnce([]);
    await expect(
      service.startMessage(actor, {
        ...input,
        remoteSessionId: 'other-user-session',
      }),
    ).rejects.toThrow('AILY_SESSION_BINDING_INVALID');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not dispatch when another message owns the remote session', async () => {
    const { service, execute } = harness();
    globalThis.fetch = jest.fn();
    execute
      .mockResolvedValueOnce([{ thread_ref: messageRef }])
      .mockResolvedValueOnce([{ query_ref: 'previous-completed' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    await expect(
      service.startMessage(actor, { ...input, remoteSessionId: 'remote-1' }),
    ).rejects.toThrow('AILY_SESSION_BUSY');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects a changed input on a persisted message instead of generating again', async () => {
    const { service, execute } = harness();
    globalThis.fetch = jest.fn();
    execute
      .mockResolvedValueOnce([{ thread_ref: messageRef }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          query_ref: queryRef,
          request_key: input.requestKey,
          query_text: 'original',
          status: 'COMPLETED',
        },
      ]);
    await expect(service.startMessage(actor, input)).rejects.toThrow(
      'AILY_QUERY_REPLAY_CONFLICT',
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('keeps saved private answers readable after OAuth expiry without using old delegation', async () => {
    const { service, execute } = harness(false);
    execute.mockResolvedValueOnce([
      {
        query_ref: queryRef,
        status: 'COMPLETED',
        answer_text: '本人保存的解释',
      },
    ]);
    globalThis.fetch = jest.fn();
    expect(
      await service.resultMessage(
        { ...actor, sessionId: 'new-login' },
        messageRef,
        queryRef,
      ),
    ).toMatchObject({ answer: '本人保存的解释', status: 'COMPLETED' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    execute.mockResolvedValueOnce([]);
    await expect(
      service.resultMessage(actor, messageRef, queryRef),
    ).rejects.toThrow('AILY_QUERY_NOT_FOUND');
    await expect(service.startMessage(actor, input)).rejects.toThrow(
      'AILY_USER_REAUTHORIZATION_REQUIRED',
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('settles an abandoned message locally without regenerating from a new login', async () => {
    const { service, execute } = harness(false);
    execute
      .mockResolvedValueOnce([
        {
          query_ref: queryRef,
          session_id: actor.sessionId,
          status: 'RUNNING',
          answer_text: '部分',
          chat_id: '123',
          remote_session_id: 'remote-1',
          _created_at: new Date(Date.now() - 361000),
        },
      ])
      .mockResolvedValueOnce([{ query_ref: queryRef }]);
    globalThis.fetch = jest.fn();
    expect(
      await service.resultMessage(
        { ...actor, sessionId: 'new-login' },
        messageRef,
        queryRef,
      ),
    ).toMatchObject({
      status: 'UNKNOWN',
      answer: '部分',
      error: 'AILY_STREAM_RESULT_UNCONFIRMED',
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
