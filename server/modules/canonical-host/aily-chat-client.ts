import { types } from 'node:util';
import { Logger } from '@nestjs/common';
import {
  consumeAilyChatStream,
  isAilyChatId,
  type AilyStreamProgress,
} from './aily-chat-stream';

const createLogger = new Logger('AilyChatClient');
const AILY_CREATE_TEXT_MAX_CODE_UNITS = 10_000;
const AILY_CREATE_MAX_CONTENT_ITEMS = 100;

/** Conservative API character bound, preserving every original code unit and pair. */
function createMessageContent(message: string): Array<{type: 'text'; text: string}> {
  const content: Array<{type: 'text'; text: string}> = [];
  let start = 0;
  while (start < message.length) {
    if (content.length === AILY_CREATE_MAX_CONTENT_ITEMS)
      throw new Error('AILY_MESSAGE_API_CAPACITY_EXCEEDED');
    let end = Math.min(start + AILY_CREATE_TEXT_MAX_CODE_UNITS, message.length);
    if (end < message.length && message.charCodeAt(end - 1) >= 0xd800 && message.charCodeAt(end - 1) <= 0xdbff &&
        message.charCodeAt(end) >= 0xdc00 && message.charCodeAt(end) <= 0xdfff) end--;
    content.push({type: 'text', text: message.slice(start, end)});
    start = end;
  }
  return content;
}

/** Transport only. The caller must authorize and persist the request before dispatch.
 * Tokens and remote session bindings are supplied by the Host, never model tools.
 */
export interface AilyChatRequest {
  agentId: string;
  accessToken: string;
  message: string;
  remoteSessionId?: string;
  agentAttachmentIds?: string[];
}

function chatUrl(agentId: string) {
  if (!/^agent_[A-Za-z0-9_-]{1,59}$/u.test(agentId))
    throw new Error('AILY_AGENT_INVALID');
  return `https://open.feishu.cn/open-apis/aily/v1/agents/${agentId}/chats`;
}

function requestBody(request: Pick<AilyChatRequest, 'message' | 'remoteSessionId' | 'agentAttachmentIds'>, stream: boolean) {
  // Keep the private streamed-chat boundary. A full enterprise task must never
  // be truncated to that UI limit; provider rejection stays explicit.
  if (!request.message.trim() || (stream && request.message.length > 60_000))
    throw new Error('AILY_MESSAGE_INVALID');
  if (
    request.remoteSessionId !== undefined &&
    !/^[A-Za-z0-9_-]{1,96}$/u.test(request.remoteSessionId)
  )
    throw new Error('AILY_SESSION_INVALID');
  const attachmentIds = request.agentAttachmentIds;
  if (attachmentIds !== undefined && (!Array.isArray(attachmentIds) || attachmentIds.length > 8 ||
      attachmentIds.some(id => typeof id !== 'string' || !id.trim() || id !== id.trim()) ||
      new Set(attachmentIds).size !== attachmentIds.length))
    throw new Error('AILY_ATTACHMENT_IDS_INVALID');
  return JSON.stringify({
    user_message: { content: stream ? [{ type: 'text', text: request.message }] : createMessageContent(request.message),
      ...(attachmentIds?.length ? {agent_attachment_ids: attachmentIds} : {}) },
    stream,
    ...(request.remoteSessionId ? { session_id: request.remoteSessionId } : {}),
  });
}

export interface AilyChatReceipt {
  chatId: string;
  remoteSessionId?: string;
}

export function serializeAilyChatRequest(request: Pick<AilyChatRequest, 'message' | 'remoteSessionId' | 'agentAttachmentIds'>): string {
  return requestBody(request, false);
}

/** One asynchronous acceptance request, with no retry or long-running stream. */
export async function createAilyChat(request: AilyChatRequest & {expectedRequestBody?: string}): Promise<AilyChatReceipt> {
  const body = serializeAilyChatRequest(request);
  if (request.expectedRequestBody !== undefined && request.expectedRequestBody !== body)
    throw new Error('AILY_DISPATCH_BODY_CHANGED');
  const response = await fetch(chatUrl(request.agentId), {
    method: 'POST',
    headers: {authorization: `Bearer ${request.accessToken}`, 'content-type': 'application/json', accept: 'application/json'},
    body,
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
  });
  let code: number | null = null;
  const failure = (message: string, category: 'HTTP_REJECTED' | 'HTTP_BODY_UNREADABLE' = 'HTTP_REJECTED') => {
    if (!response.ok) createLogger.warn(JSON.stringify({event: 'AILY_CHAT_CREATE_REJECTED',
      httpStatus: response.status, platformCode: code, category}));
    return Object.assign(new Error(message), {status: response.status, code});
  };
  let responseBody: unknown;
  try { responseBody = await readResultBody(response); }
  catch (cause) {
    if (!response.ok) throw failure(`AILY_HTTP_${response.status}`, 'HTTP_BODY_UNREADABLE');
    if (types.isNativeError(cause)) throw Object.assign(cause, {status: response.status, code});
    throw failure('AILY_RESULT_INVALID');
  }
  const envelope = responseBody && typeof responseBody === 'object' && !Array.isArray(responseBody)
    ? responseBody as Record<string, unknown> : null;
  if (envelope && typeof envelope.code === 'number' && Number.isSafeInteger(envelope.code) && envelope.code >= 0)
    code = envelope.code;
  if (!response.ok) throw failure(`AILY_HTTP_${response.status}`);
  if (!envelope) throw failure('AILY_CHAT_RECEIPT_INVALID');
  if (typeof envelope.code === 'number' && Number.isSafeInteger(envelope.code) && envelope.code > 0)
    throw failure(`AILY_API_REJECTED_${envelope.code}`);
  if (envelope.code !== 0 || !envelope.data || typeof envelope.data !== 'object' || Array.isArray(envelope.data))
    throw failure('AILY_CHAT_RECEIPT_INVALID');
  const receipt = envelope.data as Record<string, unknown>;
  if (!isAilyChatId(receipt.agent_chat_id)) throw failure('AILY_CHAT_RECEIPT_INVALID');
  if (receipt.session_id !== undefined &&
      (typeof receipt.session_id !== 'string' || !/^[A-Za-z0-9_-]{1,96}$/u.test(receipt.session_id)))
    throw failure('AILY_CHAT_RECEIPT_INVALID');
  if (request.remoteSessionId && receipt.session_id !== undefined && receipt.session_id !== request.remoteSessionId)
    throw failure('AILY_RESULT_SESSION_MISMATCH');
  return {chatId: receipt.agent_chat_id,
    ...(typeof receipt.session_id === 'string' ? {remoteSessionId: receipt.session_id} : {})};
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
  const saveProgress = async (progress: AilyStreamProgress) => {
    if (
      request.remoteSessionId &&
      progress.remoteSessionId &&
      request.remoteSessionId !== progress.remoteSessionId
    )
      throw new Error('AILY_STREAM_SESSION_MISMATCH');
    await onProgress(progress);
  };
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
  // Feishu's application error code is independent of the HTTP status. A JSON
  // rejection must not be mistaken for a lost stream or retried generation.
  if (
    response.ok &&
    response.headers.get('content-type')?.startsWith('application/json')
  ) {
    const body = await readResultBody(response);
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const envelope = body as Record<string, unknown>;
      if (
        typeof envelope.code === 'number' &&
        Number.isSafeInteger(envelope.code) &&
        envelope.code > 0
      )
        throw new Error(`AILY_API_REJECTED_${envelope.code}`);
      const data = envelope.data;
      if (
        envelope.code === 0 &&
        data &&
        typeof data === 'object' &&
        !Array.isArray(data)
      ) {
        const receipt = data as Record<string, unknown>;
        if (
          isAilyChatId(receipt.agent_chat_id) &&
          (receipt.session_id === undefined ||
            (typeof receipt.session_id === 'string' &&
              /^[A-Za-z0-9_-]{1,96}$/u.test(receipt.session_id)))
        ) {
          // Preserve a returned asynchronous receipt, but never invent completion
          // or submit a replacement POST because a stream was not returned.
          await saveProgress({
            chatId: receipt.agent_chat_id,
            answer: '',
            status: 'RUNNING',
            ...(typeof receipt.session_id === 'string'
              ? { remoteSessionId: receipt.session_id }
              : {}),
          });
          throw new Error('AILY_STREAM_RESULT_UNCONFIRMED');
        }
      }
    }
    throw new Error('AILY_STREAM_RESPONSE_INVALID');
  }
  return consumeAilyChatStream(response, saveProgress);
}

/** Read one existing result; never creates/retries a generation. Caller must have
 * verified read delegation. Raw status is intentionally not a guessed terminal enum.
 * content is a result snapshot, not an SSE delta to append to the saved answer.
 */
export interface AilyChatResultRequest {
  agentId: string;
  accessToken: string;
  chatId: string;
  remoteSessionId?: string;
}
export async function readAilyChatResult(input: AilyChatResultRequest) {
  return readAilyChatSnapshot(input, true);
}

/** Enterprise observation consumes metadata, not the private-chat display text. */
export async function observeAilyChat(input: AilyChatResultRequest) {
  const {answer: _answer, ...observation} = await readAilyChatSnapshot(input, false);
  return observation;
}

async function readAilyChatSnapshot(input: AilyChatResultRequest, includeAnswer: boolean) {
  if (!isAilyChatId(input.chatId)) throw new Error('AILY_CHAT_INVALID');
  if (
    input.remoteSessionId !== undefined &&
    !/^[A-Za-z0-9_-]{1,96}$/u.test(input.remoteSessionId)
  )
    throw new Error('AILY_SESSION_INVALID');
  const response = await fetch(`${chatUrl(input.agentId)}/${input.chatId}`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
  });
  // These own numeric fields are the existing technical receipt consumer's
  // status/code contract. Never retain the platform's free-form diagnostics.
  let code: number | null = null;
  const failure = (message: string) => Object.assign(new Error(message), {status: response.status, code});
  let body: unknown;
  try { body = await readResultBody(response); }
  catch (cause) {
    if (!response.ok) throw failure(`AILY_HTTP_${response.status}`);
    // Preserve the original bounded-reader/decoder error and its message.
    if (types.isNativeError(cause)) throw Object.assign(cause, {status: response.status, code});
    throw failure('AILY_RESULT_INVALID');
  }
  const envelope = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  if (envelope && typeof envelope.code === 'number' && Number.isSafeInteger(envelope.code) && envelope.code >= 0)
    code = envelope.code;
  if (!response.ok) throw failure(`AILY_HTTP_${response.status}`);
  if (!envelope) throw failure('AILY_RESULT_INVALID');
  if (envelope.code !== 0) throw failure('AILY_RESULT_REJECTED');
  const data = envelope.data;
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw failure('AILY_RESULT_INVALID');
  const result = data as Record<string, unknown>;
  if (
    result.agent_chat_id !== undefined &&
    (!isAilyChatId(result.agent_chat_id) || result.agent_chat_id !== input.chatId)
  )
    throw failure('AILY_RESULT_CHAT_MISMATCH');
  if (
    result.session_id !== undefined &&
    (typeof result.session_id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,96}$/u.test(result.session_id) ||
      (input.remoteSessionId !== undefined && result.session_id !== input.remoteSessionId))
  )
    throw failure('AILY_RESULT_SESSION_MISMATCH');
  if (
    result.finish_reason !== undefined &&
    (typeof result.finish_reason !== 'string' ||
      result.finish_reason.length > 200)
  )
    throw failure('AILY_RESULT_INVALID');
  if (
    typeof result.status !== 'string' ||
    !result.status ||
    result.status.length > 96 ||
    (includeAnswer && !Array.isArray(result.content))
  )
    throw failure('AILY_RESULT_INVALID');
  const text: string[] = [];
  for (const content of includeAnswer && Array.isArray(result.content) ? result.content : []) {
    if (!content || typeof content !== 'object' || Array.isArray(content))
      throw failure('AILY_RESULT_INVALID');
    const entry = content as Record<string, unknown>;
    if (entry.type !== 'text') continue;
    if (typeof entry.text !== 'string') throw failure('AILY_RESULT_INVALID');
    text.push(entry.text);
  }
  const answer = text.join('\n');
  if (includeAnswer && answer.length > 60_000) throw failure('AILY_RESULT_TOO_LARGE');
  return {
    chatId: input.chatId,
    answer,
    remoteStatus: result.status,
    ...(typeof result.finish_reason === 'string'
      ? { remoteFinishReason: result.finish_reason }
      : {}),
  };
}
