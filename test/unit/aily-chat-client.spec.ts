import {
  readAilyChatResult,
  streamAilyChat,
} from '../../server/modules/canonical-host/aily-chat-client';

describe('Host Aily transport', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
  const request = {
    agentId: 'agent_test',
    accessToken: 'test-secret',
    message: '解释假设',
    remoteSessionId: 'remote-1',
  };

  it('passes the Host remote session and public text directly without an analysis attempt', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response(
          'event: start\ndata: {"agent_chat_id":"123","session_id":"remote-1"}\n\n' +
            'event: message_delta\ndata: {"agent_chat_id":"123","delta":{"type":"content","text":"解释"}}\n\n' +
            'event: done\ndata: {"agent_chat_id":"123","status":"Completed"}\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      );
    const progress = jest.fn().mockResolvedValue(undefined);
    expect(await streamAilyChat(request, progress)).toMatchObject({
      remoteSessionId: 'remote-1',
      answer: '解释',
      status: 'COMPLETED',
    });
    expect(progress.mock.calls[0][0]).toMatchObject({
      chatId: '123',
      remoteSessionId: 'remote-1',
      answer: '',
    });
    const [, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      user_message: { content: [{ type: 'text', text: '解释假设' }] },
      stream: true,
      session_id: 'remote-1',
    });
    expect(init.redirect).toBe('error');
    expect(init.body).not.toContain('test-secret');
  });

  it('reads a snapshot from exactly the saved remote chat and ignores reasoning/artifacts', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      Response.json({
        code: 0,
        data: {
          status: 'SomeUnverifiedPlatformState',
          content: [
            { type: 'text', text: '原片段完整回答' },
            { type: 'reasoning', text: 'private' },
            { type: 'artifact', agent_artifact_id: 'artifact' },
          ],
        },
      }),
    );
    expect(await readAilyChatResult({ ...request, chatId: '123' })).toEqual({
      chatId: '123',
      answer: '原片段完整回答',
      remoteStatus: 'SomeUnverifiedPlatformState',
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://open.feishu.cn/open-apis/aily/v1/agents/agent_test/chats/123',
      expect.objectContaining({ method: 'GET', redirect: 'error' }),
    );
  });

  it.each([401, 403, 429, 500])(
    'does not retry HTTP %s or create a replacement generation',
    async (status) => {
      globalThis.fetch = jest
        .fn()
        .mockResolvedValue(new Response('', { status }));
      await expect(
        readAilyChatResult({ ...request, chatId: '123' }),
      ).rejects.toThrow(`AILY_HTTP_${status}`);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [{ code: 1, msg: 'private upstream details' }, 'AILY_RESULT_REJECTED'],
    [
      { code: 0, data: { status: 'Completed', content: [{ type: 'text' }] } },
      'AILY_RESULT_INVALID',
    ],
    [
      {
        code: 0,
        data: {
          status: 'Completed',
          content: [{ type: 'text', text: 'x'.repeat(60001) }],
        },
      },
      'AILY_RESULT_TOO_LARGE',
    ],
  ])(
    'rejects malformed or denied results without leaking remote diagnostics',
    async (body, error) => {
      globalThis.fetch = jest.fn().mockResolvedValue(Response.json(body));
      await expect(
        readAilyChatResult({ ...request, chatId: '123' }),
      ).rejects.toThrow(error);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects invalid path bindings before sending credentials', async () => {
    globalThis.fetch = jest.fn();
    await expect(
      readAilyChatResult({ ...request, chatId: '../other' }),
    ).rejects.toThrow('AILY_CHAT_INVALID');
    await expect(
      streamAilyChat(
        { ...request, agentId: '../other' },
        async () => undefined,
      ),
    ).rejects.toThrow('AILY_AGENT_INVALID');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects an oversized wire response even when the excess is non-public content', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      Response.json({
        code: 0,
        data: {
          status: 'Completed',
          content: [{ type: 'reasoning', text: 'x'.repeat(2_000_001) }],
        },
      }),
    );
    await expect(
      readAilyChatResult({ ...request, chatId: '123' }),
    ).rejects.toThrow('AILY_RESULT_TOO_LARGE');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not accept a stream returning a different remote session', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response(
          'event: start\ndata: {"agent_chat_id":"123","session_id":"other-session"}\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      );
    const progress = jest.fn();
    await expect(streamAilyChat(request, progress)).rejects.toThrow(
      'AILY_STREAM_SESSION_MISMATCH',
    );
    expect(progress).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves the remote finish reason without turning a cancelled result into success', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      Response.json({
        code: 0,
        data: {
          status: 'Cancelled',
          finish_reason: 'stop',
          content: [{ type: 'text', text: '部分公开文本' }],
        },
      }),
    );
    expect(await readAilyChatResult({ ...request, chatId: '123' })).toEqual({
      chatId: '123',
      answer: '部分公开文本',
      remoteStatus: 'Cancelled',
      remoteFinishReason: 'stop',
    });
  });

  it('distinguishes an HTTP 200 application rejection from an interrupted generation', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(
        Response.json({ code: 2700001, msg: 'private diagnostic' }),
      );
    await expect(
      streamAilyChat(request, async () => undefined),
    ).rejects.toThrow('AILY_API_REJECTED_2700001');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('retains an asynchronous receipt without pretending it was a completed streamed answer', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(
        Response.json({
          code: 0,
          data: { agent_chat_id: '123', session_id: 'remote-1' },
        }),
      );
    const progress = jest.fn().mockResolvedValue(undefined);
    await expect(streamAilyChat(request, progress)).rejects.toThrow(
      'AILY_STREAM_RESULT_UNCONFIRMED',
    );
    expect(progress).toHaveBeenCalledWith({
      chatId: '123',
      remoteSessionId: 'remote-1',
      answer: '',
      status: 'RUNNING',
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
