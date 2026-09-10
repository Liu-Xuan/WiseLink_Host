import { consumeAilyChatStream } from '../../server/modules/canonical-host/aily-chat-stream';

const frame = (event: string, value: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;
const start = frame('start', { agent_chat_id: '123' });
const delta = (text: string, type = 'content') =>
  frame('message_delta', { agent_chat_id: '123', delta: { type, text } });
const done = frame('done', {
  agent_chat_id: '123',
  status: 'Completed',
  finish_reason: '',
});
function response(text: string, split = 7) {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (offset >= bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(offset, (offset += split)));
      },
    }),
    { headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
  );
}

describe('Aily SSE public answer reader', () => {
  it('handles fragmented UTF-8, CRLF, heartbeats and ignores reasoning deltas', async () => {
    const onProgress = jest.fn().mockResolvedValue(undefined);
    const wire = (
      start +
      ':keep-alive\n:keep-alive\n' +
      delta('不得保存', 'reasoning') +
      delta('连接') +
      delta('测试成功。') +
      done
    ).replace(/\n/g, '\r\n');
    expect(await consumeAilyChatStream(response(wire, 1), onProgress)).toEqual({
      chatId: '123',
      answer: '连接测试成功。',
      status: 'COMPLETED',
    });
    expect(JSON.stringify(onProgress.mock.calls)).not.toContain('不得保存');
  });

  it.each([
    [
      'EOF after partial answer',
      start + delta('部分'),
      'AILY_STREAM_INTERRUPTED',
    ],
    [
      'mismatched conversation',
      start + frame('done', { agent_chat_id: '456', status: 'Completed' }),
      'AILY_STREAM_CHAT_MISMATCH',
    ],
    ['no start', delta('text') + done, 'AILY_STREAM_START_MISSING'],
    ['empty completion', start + done, 'AILY_EMPTY_RESPONSE'],
    [
      'unconfirmed completion',
      start +
        delta('text') +
        frame('done', { agent_chat_id: '123', status: 'Running' }),
      'AILY_STREAM_COMPLETION_INVALID',
    ],
    [
      'malformed event',
      start + 'event: done\ndata: not-json\n\n',
      'AILY_STREAM_EVENT_INVALID',
    ],
    [
      'upstream error',
      start + frame('error', { message: 'private diagnostics' }),
      'AILY_STREAM_REMOTE_ERROR',
    ],
    [
      'oversized answer',
      start + delta('x'.repeat(60_001)) + done,
      'AILY_STREAM_ANSWER_TOO_LARGE',
    ],
  ])(
    'rejects %s without marking a partial answer completed',
    async (_name, wire, error) => {
      const onProgress = jest.fn().mockResolvedValue(undefined);
      await expect(
        consumeAilyChatStream(response(wire, 4096), onProgress),
      ).rejects.toThrow(error);
      expect(
        onProgress.mock.calls.some(
          ([progress]) => progress.status === 'COMPLETED',
        ),
      ).toBe(false);
    },
  );

  it('preserves explicit upstream failure and already received content', async () => {
    expect(
      await consumeAilyChatStream(
        response(
          start +
            delta('部分') +
            frame('done', { agent_chat_id: '123', status: 'Failed' }),
        ),
        async () => undefined,
      ),
    ).toEqual({
      chatId: '123',
      answer: '部分',
      status: 'FAILED',
    });
  });
});
