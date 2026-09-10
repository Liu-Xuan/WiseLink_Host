import {
  consumeAilyChatStream,
  type AilyStreamProgress,
} from './aily-chat-stream';

/** Transport only. The caller must authorize and persist the request before dispatch.
 * Tokens and remote session bindings are supplied by the Host, never model tools.
 */
export interface AilyChatRequest {
  agentId: string;
  accessToken: string;
  message: string;
  remoteSessionId?: string;
}

function chatUrl(agentId: string) {
  if (!/^agent_[A-Za-z0-9_-]{1,59}$/u.test(agentId))
    throw new Error('AILY_AGENT_INVALID');
  return `https://open.feishu.cn/open-apis/aily/v1/agents/${agentId}/chats`;
}

function requestBody(request: AilyChatRequest, stream: boolean) {
  if (!request.message.trim() || request.message.length > 60_000)
    throw new Error('AILY_MESSAGE_INVALID');
  if (
    request.remoteSessionId !== undefined &&
    !/^[A-Za-z0-9_-]{1,96}$/u.test(request.remoteSessionId)
  )
    throw new Error('AILY_SESSION_INVALID');
  return JSON.stringify({
    user_message: { content: [{ type: 'text', text: request.message }] },
    stream,
    ...(request.remoteSessionId ? { session_id: request.remoteSessionId } : {}),
  });
}

async function readResultBody(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('AILY_RESULT_INVALID');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 2_000_000) throw new Error('AILY_RESULT_TOO_LARGE');
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error('AILY_RESULT_INVALID');
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function streamAilyChat(
  request: AilyChatRequest,
  onProgress: (progress: AilyStreamProgress) => Promise<void>,
) {
  const response = await fetch(chatUrl(request.agentId), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${request.accessToken}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
    },
    body: requestBody(request, true),
    signal: AbortSignal.timeout(300_000),
    redirect: 'error',
  });
  return consumeAilyChatStream(response, async (progress) => {
    if (
      request.remoteSessionId &&
      progress.remoteSessionId &&
      request.remoteSessionId !== progress.remoteSessionId
    )
      throw new Error('AILY_STREAM_SESSION_MISMATCH');
    await onProgress(progress);
  });
}

/** Read one existing result; never creates/retries a generation. Caller must have
 * verified read delegation. Raw status is intentionally not a guessed terminal enum.
 * content is a result snapshot, not an SSE delta to append to the saved answer.
 */
export async function readAilyChatResult(input: {
  agentId: string;
  accessToken: string;
  chatId: string;
}) {
  if (!/^\d{1,64}$/u.test(input.chatId)) throw new Error('AILY_CHAT_INVALID');
  const response = await fetch(`${chatUrl(input.agentId)}/${input.chatId}`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`AILY_HTTP_${response.status}`);
  const body = await readResultBody(response);
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new Error('AILY_RESULT_INVALID');
  const envelope = body as Record<string, unknown>;
  if (envelope.code !== 0) throw new Error('AILY_RESULT_REJECTED');
  const data = envelope.data;
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('AILY_RESULT_INVALID');
  const result = data as Record<string, unknown>;
  if (
    result.finish_reason !== undefined &&
    (typeof result.finish_reason !== 'string' ||
      result.finish_reason.length > 200)
  )
    throw new Error('AILY_RESULT_INVALID');
  if (
    typeof result.status !== 'string' ||
    !result.status ||
    result.status.length > 96 ||
    !Array.isArray(result.content)
  )
    throw new Error('AILY_RESULT_INVALID');
  const text: string[] = [];
  for (const content of result.content) {
    if (!content || typeof content !== 'object' || Array.isArray(content))
      throw new Error('AILY_RESULT_INVALID');
    const entry = content as Record<string, unknown>;
    if (entry.type !== 'text') continue;
    if (typeof entry.text !== 'string') throw new Error('AILY_RESULT_INVALID');
    text.push(entry.text);
  }
  const answer = text.join('\n');
  if (answer.length > 60_000) throw new Error('AILY_RESULT_TOO_LARGE');
  return {
    chatId: input.chatId,
    answer,
    remoteStatus: result.status,
    ...(typeof result.finish_reason === 'string'
      ? { remoteFinishReason: result.finish_reason }
      : {}),
  };
}
