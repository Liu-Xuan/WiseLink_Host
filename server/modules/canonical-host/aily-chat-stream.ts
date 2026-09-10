export interface AilyStreamProgress {
  chatId: string | null;
  answer: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
}

/** Aily agent-chat SSE, verified against a live user-identity response.
 * Only public content deltas are retained; reasoning/tool payloads are ignored.
 */
export async function consumeAilyChatStream(
  response: Response,
  onProgress: (progress: AilyStreamProgress) => Promise<void>,
): Promise<AilyStreamProgress> {
  if (!response.ok) throw new Error(`AILY_HTTP_${response.status}`);
  if (
    !response.headers.get('content-type')?.startsWith('text/event-stream') ||
    !response.body
  )
    throw new Error('AILY_STREAM_RESPONSE_INVALID');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  let event = '';
  let data: string[] = [];
  let bytes = 0;
  const progress: AilyStreamProgress = {
    chatId: null,
    answer: '',
    status: 'RUNNING',
  };
  const dispatch = async () => {
    if (!data.length) {
      event = '';
      return;
    }
    const name = event;
    const payload = data.join('\n');
    event = '';
    data = [];
    if (!['start', 'message_delta', 'done', 'error'].includes(name)) return;
    let value: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(payload);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error();
      value = parsed as Record<string, unknown>;
    } catch {
      throw new Error('AILY_STREAM_EVENT_INVALID');
    }
    if (name === 'error') throw new Error('AILY_STREAM_REMOTE_ERROR');
    const id = value.agent_chat_id;
    if (
      typeof id !== 'string' ||
      !/^\d{1,30}$/u.test(id) ||
      (progress.chatId !== null && progress.chatId !== id)
    )
      throw new Error('AILY_STREAM_CHAT_MISMATCH');
    if (name === 'start') {
      if (progress.chatId) throw new Error('AILY_STREAM_EVENT_INVALID');
      progress.chatId = id;
      await onProgress({ ...progress });
      return;
    }
    if (!progress.chatId) throw new Error('AILY_STREAM_START_MISSING');
    if (name === 'message_delta') {
      const delta = value.delta;
      if (!delta || typeof delta !== 'object' || Array.isArray(delta))
        throw new Error('AILY_STREAM_EVENT_INVALID');
      const entry = delta as Record<string, unknown>;
      if (entry.type !== 'content') return;
      if (typeof entry.text !== 'string')
        throw new Error('AILY_STREAM_EVENT_INVALID');
      if (progress.answer.length + entry.text.length > 60_000)
        throw new Error('AILY_STREAM_ANSWER_TOO_LARGE');
      progress.answer += entry.text;
      await onProgress({ ...progress });
      return;
    }
    if (value.status === 'Completed') {
      if (!progress.answer.trim()) throw new Error('AILY_EMPTY_RESPONSE');
      progress.status = 'COMPLETED';
    } else if (value.status === 'Failed' || value.status === 'Cancelled') {
      progress.status = 'FAILED';
    } else throw new Error('AILY_STREAM_COMPLETION_INVALID');
    await onProgress({ ...progress });
  };
  try {
    while (progress.status === 'RUNNING') {
      const chunk = await reader.read();
      if (chunk.done) throw new Error('AILY_STREAM_INTERRUPTED');
      bytes += chunk.value.byteLength;
      if (bytes > 2_000_000) throw new Error('AILY_STREAM_TOO_LARGE');
      buffer += decoder.decode(chunk.value, { stream: true });
      if (buffer.length > 256_000)
        throw new Error('AILY_STREAM_EVENT_TOO_LARGE');
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/u, '');
        buffer = buffer.slice(newline + 1);
        if (line === '') await dispatch();
        else if (!line.startsWith(':')) {
          const colon = line.indexOf(':');
          const field = colon === -1 ? line : line.slice(0, colon);
          const value =
            colon === -1 ? '' : line.slice(colon + 1).replace(/^ /u, '');
          if (field === 'event') event = value;
          else if (field === 'data') data.push(value);
          if (data.reduce((size, part) => size + part.length, 0) > 256_000)
            throw new Error('AILY_STREAM_EVENT_TOO_LARGE');
        }
        if (progress.status !== 'RUNNING') break;
      }
    }
    return progress;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
