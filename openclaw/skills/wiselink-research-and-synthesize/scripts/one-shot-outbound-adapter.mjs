import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const LOOPBACK_HOST = '127.0.0.1';
const COMPLETIONS_PATH = '/v1/chat/completions';
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const MAX_TERMINAL_EVIDENCE_BYTES = 4 * 1024 * 1024;
const MAX_SSE_EVENT_CHARS = 1024 * 1024;
const FIXED_FINISH_REASONS = new Set(['stop', 'tool_calls', 'length', 'content_filter']);
const FORBIDDEN_UPSTREAM_HEADERS = new Set([
  'host', 'content-length', 'connection', 'transfer-encoding', 'cookie',
  'x-wiselink-attempt-nonce', 'proxy-authorization', 'proxy-connection',
  'keep-alive', 'te', 'trailer', 'upgrade', 'content-encoding',
  'forwarded', 'x-forwarded-host', 'x-forwarded-proto', 'x-original-host',
]);

/**
 * One adapter belongs to one sealed Review attempt. The trusted launcher owns
 * the official upstream URL and the private nonce returned by start().
 * upstreamHeaders must come from that same resolved official provider profile.
 * No process-wide state, credential file, or OpenClaw profile is changed here.
 */
export function createOneShotOutboundAdapter({
  attemptRef,
  modelId,
  upstreamBaseUrl,
  upstreamHeaders = {},
  maxCompletionTokens,
  maxModelRequests,
  expectedReasoningEffort,
  absoluteDeadline,
  fetchUpstream = globalThis.fetch,
}) {
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(attemptRef ?? '')) {
    throw new Error('ADAPTER_ATTEMPT_REF_INVALID');
  }
  if (modelId !== 'glm-5.3' ||
    !Number.isSafeInteger(maxCompletionTokens) || maxCompletionTokens <= 0 ||
    !Number.isSafeInteger(maxModelRequests) || maxModelRequests <= 0 ||
    (expectedReasoningEffort !== undefined &&
      !['low', 'high', 'max'].includes(expectedReasoningEffort))) {
    throw new Error('ADAPTER_MODEL_BINDING_INVALID');
  }
  if (typeof fetchUpstream !== 'function') {
    throw new Error('ADAPTER_FETCH_INVALID');
  }
  const upstreamUrl = resolveOfficialCompletionsUrl(upstreamBaseUrl);
  const trustedHeaders = copyTrustedUpstreamHeaders(upstreamHeaders);
  const deadlineMs = new Date(absoluteDeadline).getTime();
  if (!Number.isSafeInteger(deadlineMs)) {
    throw new Error('ADAPTER_DEADLINE_INVALID');
  }

  const nonce = randomBytes(32).toString('hex');
  const receipt = {
    attemptRef,
    modelId,
    maxCompletionTokens,
    maxModelRequests,
    expectedReasoningEffort: expectedReasoningEffort ?? null,
    observedReasoningEffort: null,
    observedThinkingMode: null,
    absoluteDeadline: new Date(deadlineMs).toISOString(),
    upstreamDispatchCount: 0,
    dispatches: [],
    activeOrdinal: null,
    unknownTerminal: false,
    upstreamHttpStatus: null,
    transportCompleted: false,
    providerStopConfirmed: false,
    outcome: 'CREATED',
    finishedAt: null,
  };
  let server = null;
  let serverClosed = null;
  let timer = null;
  let started = false;
  let closed = false;
  let expired = false;
  let activeResponse = null;
  let activeAbort = null;
  let permanentlyClosed = false;
  let pendingRequest = false;
  const activeHandlers = new Set();

  function finish(outcome) {
    receipt.outcome = outcome;
    receipt.finishedAt = new Date().toISOString();
  }

  function stopListening() {
    if (serverClosed) return serverClosed;
    if (!server?.listening) return Promise.resolve();
    serverClosed = new Promise((resolve) => server.close(resolve));
    // A peer can leave a request body open indefinitely. Once the deadline
    // response has had a chance to flush, retire those sockets as well.
    const forceClose = setTimeout(() => server.closeAllConnections(), 50);
    forceClose.unref();
    return serverClosed;
  }

  function expire() {
    if (expired) return;
    expired = true;
    if (receipt.activeOrdinal !== null || pendingRequest) {
      const active = receipt.activeOrdinal === null ? null
        : receipt.dispatches[receipt.activeOrdinal - 1];
      if (active?.outcome === 'IN_FLIGHT') active.outcome = 'DEADLINE_UNKNOWN';
      receipt.unknownTerminal = true;
      permanentlyClosed = true;
    }
    finish('DEADLINE_EXPIRED');
    activeAbort?.abort();
    if (activeResponse && !activeResponse.writableEnded) {
      if (!activeResponse.headersSent) {
        sendFailure(activeResponse, 504, 'ADAPTER_DEADLINE_EXPIRED');
      } else {
        activeResponse.destroy();
      }
    }
    stopListening();
  }

  async function handle(req, res) {
    if (req.method !== 'POST' || req.url !== COMPLETIONS_PATH) {
      sendFailure(res, 404, 'ADAPTER_ROUTE_INVALID');
      return;
    }
    if (singleHeader(req, 'x-wiselink-attempt-nonce') !== nonce) {
      sendFailure(res, 403, 'ADAPTER_NONCE_INVALID');
      return;
    }
    if (expired || Date.now() >= deadlineMs) {
      expire();
      sendFailure(res, 504, 'ADAPTER_DEADLINE_EXPIRED');
      return;
    }
    if (receipt.activeOrdinal !== null || pendingRequest) {
      permanentlyClosed = true;
      receipt.unknownTerminal = true;
      sendFailure(res, 409, 'ADAPTER_CONCURRENT_DISPATCH_FORBIDDEN');
      return;
    }
    if (closed || permanentlyClosed ||
      receipt.upstreamDispatchCount >= maxModelRequests) {
      sendFailure(res, 409, 'ADAPTER_ALREADY_DISPATCHED');
      return;
    }
    if (req.headers.cookie !== undefined) {
      sendFailure(res, 400, 'ADAPTER_COOKIE_FORBIDDEN');
      return;
    }
    const callerAuthorization = singleHeader(req, 'authorization');
    if (req.headers.authorization !== undefined && !callerAuthorization) {
      sendFailure(res, 401, 'ADAPTER_AUTHORIZATION_INVALID');
      return;
    }
    // The trusted official profile wins when it has an Authorization header.
    // Otherwise use the original Bearer header emitted by this Gateway run.
    const authorization = trustedHeaders.authorization ?? callerAuthorization;
    if (
      !authorization ||
      (!trustedHeaders.authorization && !/^Bearer [^\s]+$/u.test(authorization))
    ) {
      sendFailure(res, 401, 'ADAPTER_AUTHORIZATION_INVALID');
      return;
    }
    if (!/^application\/json(?:\s*;|$)/iu.test(req.headers['content-type'] ?? '')) {
      sendFailure(res, 415, 'ADAPTER_CONTENT_TYPE_INVALID');
      return;
    }
    if (req.headers['content-encoding'] !== undefined) {
      sendFailure(res, 415, 'ADAPTER_CONTENT_ENCODING_INVALID');
      return;
    }

    // Reserve the sole in-progress slot before reading the body or awaiting
    // anything. Concurrent native requests permanently close this attempt.
    pendingRequest = true;

    let body;
    let actualCompletionTokens;
    let observedReasoningEffort;
    let observedThinkingMode;
    try {
      ({ body, actualCompletionTokens, observedReasoningEffort,
        observedThinkingMode } =
        await readAndValidateBody(req, modelId, maxCompletionTokens,
          expectedReasoningEffort));
    } catch (error) {
      if (error.observedReasoningEffort)
        receipt.observedReasoningEffort = error.observedReasoningEffort;
      if (error.observedThinkingMode)
        receipt.observedThinkingMode = error.observedThinkingMode;
      pendingRequest = false;
      permanentlyClosed = true;
      finish('INVALID_REQUEST_CLOSED');
      if (!res.destroyed) {
        sendFailure(res, error.statusCode ?? 400, error.code ?? 'ADAPTER_BODY_INVALID');
      }
      return;
    }
    receipt.observedReasoningEffort = observedReasoningEffort;
    receipt.observedThinkingMode = observedThinkingMode;
    if (req.aborted || res.destroyed) {
      pendingRequest = false;
      permanentlyClosed = true;
      finish('CLIENT_DISCONNECTED_BEFORE_DISPATCH');
      return;
    }
    if (expired || Date.now() >= deadlineMs) {
      pendingRequest = false;
      expire();
      sendFailure(res, 504, 'ADAPTER_DEADLINE_EXPIRED');
      return;
    }
    if (receipt.activeOrdinal !== null || receipt.unknownTerminal) {
      pendingRequest = false;
      permanentlyClosed = true;
      receipt.unknownTerminal = true;
      sendFailure(res, 409, 'ADAPTER_CONCURRENT_DISPATCH_FORBIDDEN');
      return;
    }
    if (closed || permanentlyClosed ||
      receipt.upstreamDispatchCount >= maxModelRequests) {
      pendingRequest = false;
      sendFailure(res, 409, 'ADAPTER_ALREADY_DISPATCHED');
      return;
    }

    // Consume the actual provider slot before any await. A Gateway-internal
    // retry consumes another ordinal even when the driver sent one request.
    const ordinal = ++receipt.upstreamDispatchCount;
    const dispatchStartedAt = Date.now();
    const dispatch = { ordinal, actualCompletionTokens, upstreamHttpStatus: null,
      transportCompleted: false, providerKnownTerminal: false, finishReason: null,
      terminalObservation: null, outcome: 'IN_FLIGHT' };
    receipt.dispatches.push(dispatch);
    receipt.activeOrdinal = ordinal;
    pendingRequest = false;
    receipt.transportCompleted = false;
    receipt.providerStopConfirmed = false;
    receipt.upstreamHttpStatus = null;
    receipt.outcome = 'UPSTREAM_DISPATCHED';
    activeResponse = res;
    activeAbort = new AbortController();
    let upstreamStreamFailed = false;
    let terminalObserver = null;
    const markUnknown = (outcome) => {
      if (dispatch.outcome !== 'IN_FLIGHT') return;
      dispatch.terminalObservation = terminalObserver?.interrupted() ?? null;
      dispatch.outcome = outcome;
      receipt.unknownTerminal = true;
      permanentlyClosed = true;
      finish(outcome);
    };
    const onDisconnect = () => {
      if (res.writableFinished) return;
      markUnknown(upstreamStreamFailed
        ? 'UPSTREAM_TRANSPORT_UNKNOWN'
        : 'CLIENT_DISCONNECTED');
      activeAbort?.abort();
    };
    res.on('close', onDisconnect);
    try {
      const upstream = await fetchUpstream(upstreamUrl, {
        method: 'POST',
        headers: {
          ...trustedHeaders,
          authorization,
          'content-type': trustedHeaders['content-type'] ?? 'application/json',
          accept: trustedHeaders.accept ?? 'text/event-stream, application/json',
        },
        body,
        redirect: 'error',
        signal: activeAbort.signal,
      });
      if (expired || res.destroyed) return;
      receipt.upstreamHttpStatus = upstream.status;
      dispatch.upstreamHttpStatus = upstream.status;
      res.statusCode = upstream.status;
      const contentType = upstream.headers.get('content-type');
      if (contentType) res.setHeader('content-type', contentType);
      res.setHeader('cache-control', 'no-store');
      terminalObserver = createTerminalObserver(upstream.status, contentType,
        dispatchStartedAt);
      if (upstream.body) {
        const upstreamStream = Readable.fromWeb(upstream.body);
        upstreamStream.once('error', () => { upstreamStreamFailed = true; });
        const inspect = new Transform({ transform(chunk, _encoding, callback) {
          terminalObserver.consume(chunk);
          callback(null, chunk);
        } });
        await pipeline(upstreamStream, inspect, res, {
          signal: activeAbort.signal,
        });
      } else {
        const finished = new Promise((resolve) => res.once('finish', resolve));
        res.end();
        await finished;
      }
      if (!expired && !activeAbort.signal.aborted &&
        dispatch.outcome === 'IN_FLIGHT') {
        receipt.transportCompleted = true;
        dispatch.transportCompleted = true;
        const { terminal, observation } = terminalObserver.finish();
        dispatch.terminalObservation = observation;
        dispatch.providerKnownTerminal = Boolean(terminal);
        dispatch.finishReason = terminal?.finishReason ?? null;
        receipt.providerStopConfirmed = Boolean(terminal);
        dispatch.outcome = terminal ? 'PROVIDER_TERMINAL' : 'TERMINAL_UNPROVEN';
        if (dispatch.finishReason === 'length') permanentlyClosed = true;
        if (!terminal) {
          receipt.unknownTerminal = true;
          permanentlyClosed = true;
        }
        finish(dispatch.outcome);
      }
    } catch {
      markUnknown('UPSTREAM_TRANSPORT_UNKNOWN');
      if (!res.destroyed && !res.headersSent) {
        sendFailure(res, 502, 'ADAPTER_UPSTREAM_TRANSPORT_UNKNOWN');
      } else if (!res.destroyed && !res.writableEnded) {
        res.destroy();
      }
    } finally {
      res.off('close', onDisconnect);
      if (receipt.activeOrdinal === ordinal) {
        if (dispatch.outcome === 'IN_FLIGHT') markUnknown('UPSTREAM_TRANSPORT_UNKNOWN');
        receipt.activeOrdinal = null;
        activeAbort = null;
        activeResponse = null;
      }
    }
  }

  async function start() {
    if (started || closed) throw new Error('ADAPTER_CANNOT_REARM');
    started = true;
    if (Date.now() >= deadlineMs) {
      expire();
      throw new Error('ADAPTER_DEADLINE_EXPIRED');
    }
    server = createServer((req, res) => {
      const pending = handle(req, res);
      activeHandlers.add(pending);
      pending.finally(() => activeHandlers.delete(pending)).catch(() => {
        permanentlyClosed = true;
        receipt.unknownTerminal = true;
      });
    });
    server.maxRequestsPerSocket = 0;
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, LOOPBACK_HOST, resolve);
      });
    } catch {
      finish('LISTENER_FAILED');
      throw new Error('ADAPTER_LISTENER_FAILED');
    }
    timer = setTimeout(expire, Math.max(0, deadlineMs - Date.now()));
    timer.unref();
    const address = server.address();
    return {
      baseUrl: `http://${LOOPBACK_HOST}:${address.port}`,
      path: COMPLETIONS_PATH,
      nonce,
    };
  }

  async function close() {
    closed = true;
    if (timer) clearTimeout(timer);
    if (receipt.activeOrdinal !== null || pendingRequest) {
      permanentlyClosed = true;
      receipt.unknownTerminal = true;
      finish('CLOSED_WITH_INFLIGHT_UNKNOWN');
    } else if (receipt.finishedAt === null) finish('CLOSED_BY_LAUNCHER');
    activeAbort?.abort();
    if (activeResponse && !activeResponse.destroyed) activeResponse.destroy();
    const stopped = stopListening();
    server?.closeAllConnections();
    let cutoff;
    const settled = await Promise.race([
      Promise.allSettled([...activeHandlers]).then(() => true),
      new Promise((resolve) => {
        cutoff = setTimeout(() => resolve(false), 5_000);
      }),
    ]);
    clearTimeout(cutoff);
    await stopped;
    if (!settled || receipt.activeOrdinal !== null || pendingRequest)
      throw new Error('ADAPTER_CLEANUP_UNKNOWN');
  }

  function getSanitizedReceipt() {
    return structuredClone(receipt);
  }

  return { start, close, getSanitizedReceipt };
}

function createTerminalObserver(status, contentType, startedAt) {
  const type = String(contentType ?? '').toLowerCase();
  const contentTypeClass = contentType === null ? 'MISSING'
    : type.includes('text/event-stream') ? 'SSE'
      : type.includes('application/json') ? 'JSON' : 'OTHER';
  const sse = contentTypeClass === 'SSE' ? createSseObserver() : null;
  const jsonParts = [];
  let bodyBytes = 0;
  let chunkCount = 0;
  let firstChunkMs = null;
  let lastChunkMs = null;
  let totalExceededLegacyLimit = false;

  function consume(chunk) {
    const elapsed = Math.max(0, Date.now() - startedAt);
    if (firstChunkMs === null) firstChunkMs = elapsed;
    lastChunkMs = elapsed;
    bodyBytes += chunk.length;
    chunkCount++;
    if (bodyBytes > MAX_TERMINAL_EVIDENCE_BYTES) {
      totalExceededLegacyLimit = true;
      jsonParts.length = 0;
    }
    if (sse) sse.consume(chunk);
    else if (contentTypeClass === 'JSON' && !totalExceededLegacyLimit)
      jsonParts.push(chunk);
  }

  function observation(fields) {
    return {
      contentTypeClass, parseCode: fields.parseCode,
      bodyBytes, chunkCount, totalExceededLegacyLimit,
      eventOverflow: fields.eventOverflow ?? false,
      eventCount: fields.eventCount ?? 0,
      dataEventCount: fields.dataEventCount ?? 0,
      reasoningDeltaEvents: fields.reasoningDeltaEvents ?? 0,
      reasoningDeltaChars: fields.reasoningDeltaChars ?? 0,
      contentDeltaEvents: fields.contentDeltaEvents ?? 0,
      contentDeltaChars: fields.contentDeltaChars ?? 0,
      toolArgDeltaEvents: fields.toolArgDeltaEvents ?? 0,
      toolArgDeltaChars: fields.toolArgDeltaChars ?? 0,
      doneObserved: fields.doneObserved ?? false,
      doneFinal: fields.doneFinal ?? false,
      finishReason: fields.finishReason ?? null,
      lineEndingKind: fields.lineEndingKind ?? 'NONE',
      firstChunkMs, lastChunkMs,
      endMs: Math.max(0, Date.now() - startedAt),
    };
  }

  function interrupted() {
    return observation({ ...sse?.state(), parseCode: 'TRANSPORT_UNKNOWN' });
  }

  function finish() {
    if (sse) {
      const state = sse.finish();
      const known = status >= 200 && status < 300 &&
        state.parseCode === 'KNOWN_TERMINAL';
      return { terminal: known ? { finishReason: state.finishReason } : null,
        observation: observation({ ...state,
          parseCode: known || status >= 200 && status < 300
            ? state.parseCode : 'SSE_HTTP_STATUS_UNPROVEN' }) };
    }
    if (contentTypeClass !== 'JSON') return { terminal: null,
      observation: observation({ parseCode: 'CONTENT_TYPE_UNSUPPORTED' }) };
    if (totalExceededLegacyLimit) return { terminal: null,
      observation: observation({ parseCode: 'JSON_TOTAL_OVERFLOW' }) };
    let parsed;
    try { parsed = JSON.parse(Buffer.concat(jsonParts, bodyBytes).toString('utf8')); }
    catch { return { terminal: null,
      observation: observation({ parseCode: 'JSON_INVALID' }) }; }
    if (status >= 200 && status < 300) {
      if (!Array.isArray(parsed?.choices) || parsed.choices.length === 0)
        return { terminal: null,
          observation: observation({ parseCode: 'JSON_CHOICES_MISSING' }) };
      const reasons = parsed.choices.map((choice) => choice?.finish_reason);
      if (reasons.some((reason) => reason === null || reason === undefined))
        return { terminal: null,
          observation: observation({ parseCode: 'JSON_FINISH_MISSING' }) };
      if (reasons.some((reason) => !FIXED_FINISH_REASONS.has(reason)))
        return { terminal: null,
          observation: observation({ parseCode: 'JSON_FINISH_UNSUPPORTED',
            finishReason: 'OTHER' }) };
      const finishReason = reasons.at(-1);
      return { terminal: { finishReason }, observation: observation({
        parseCode: 'KNOWN_TERMINAL', finishReason }) };
    }
    const knownError = (status === 429 || status === 503) && parsed?.error &&
      typeof parsed.error === 'object' && !Array.isArray(parsed.error) &&
      ['message', 'code', 'type'].some((key) =>
        typeof parsed.error[key] === 'string' && parsed.error[key].length > 0);
    return { terminal: knownError ? { finishReason: null } : null,
      observation: observation({ parseCode: knownError
        ? 'KNOWN_TERMINAL' : 'JSON_HTTP_ERROR_UNPROVEN' }) };
  }
  return { consume, finish, interrupted };
}

function createSseObserver() {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const lineParts = [];
  const dataLines = [];
  const lineEndings = new Set();
  let eventChars = 0;
  let eventCount = 0;
  let dataEventCount = 0;
  let pendingCR = false;
  let failedCode = null;
  let eventOverflow = false;
  let eventIsError = false;
  let doneObserved = false;
  let finishReason = null;
  let reasoningDeltaEvents = 0;
  let reasoningDeltaChars = 0;
  let contentDeltaEvents = 0;
  let contentDeltaChars = 0;
  let toolArgDeltaEvents = 0;
  let toolArgDeltaChars = 0;

  function fail(code) {
    failedCode ??= code;
    lineParts.length = 0;
    dataLines.length = 0;
  }

  function appendText(value) {
    if (!value || failedCode) return;
    eventChars += value.length;
    if (eventChars > MAX_SSE_EVENT_CHARS) {
      eventOverflow = true;
      fail('SSE_EVENT_OVERFLOW');
      return;
    }
    lineParts.push(value);
  }

  function dispatchEvent() {
    eventCount++;
    if (eventIsError) { fail('SSE_ERROR_EVENT'); return; }
    if (dataLines.length === 0) { eventChars = 0; return; }
    dataEventCount++;
    const data = dataLines.join('\n');
    dataLines.length = 0;
    eventChars = 0;
    if (data === '[DONE]') {
      doneObserved = true;
      return;
    }
    let parsed;
    try { parsed = JSON.parse(data); }
    catch { fail('SSE_DATA_JSON_INVALID'); return; }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
      Object.hasOwn(parsed, 'error')) { fail('SSE_PROVIDER_ERROR'); return; }
    if (!Array.isArray(parsed?.choices)) return;
    for (const choice of parsed.choices) {
      const delta = choice?.delta;
      if (typeof delta?.reasoning_content === 'string' &&
        delta.reasoning_content.length > 0) {
        reasoningDeltaEvents++;
        reasoningDeltaChars += delta.reasoning_content.length;
      }
      if (typeof delta?.content === 'string' && delta.content.length > 0) {
        contentDeltaEvents++;
        contentDeltaChars += delta.content.length;
      }
      if (Array.isArray(delta?.tool_calls)) for (const call of delta.tool_calls) {
        const args = call?.function?.arguments;
        if (typeof args !== 'string' || args.length === 0) continue;
        toolArgDeltaEvents++;
        toolArgDeltaChars += args.length;
      }
      const reason = choice?.finish_reason;
      if (reason === null || reason === undefined) continue;
      if (!FIXED_FINISH_REASONS.has(reason)) {
        finishReason = 'OTHER';
        fail('SSE_FINISH_UNSUPPORTED');
        return;
      }
      finishReason = reason;
    }
  }

  function endLine() {
    if (failedCode) return;
    eventChars++;
    if (eventChars > MAX_SSE_EVENT_CHARS) {
      eventOverflow = true;
      fail('SSE_EVENT_OVERFLOW');
      return;
    }
    const line = lineParts.join('');
    lineParts.length = 0;
    if (doneObserved && line) { fail('SSE_AFTER_DONE'); return; }
    if (line === '') { dispatchEvent(); eventIsError = false; return; }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') dataLines.push(value);
    if (field === 'event' && value === 'error') eventIsError = true;
  }

  function processText(text) {
    let start = 0;
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      if (pendingCR) {
        pendingCR = false;
        if (char === '\n') {
          lineEndings.add('CRLF');
          start = index + 1;
          continue;
        }
        lineEndings.add('CR');
      }
      if (char === '\r' || char === '\n') {
        appendText(text.slice(start, index));
        endLine();
        if (char === '\r') pendingCR = true;
        else lineEndings.add('LF');
        start = index + 1;
      }
    }
    appendText(text.slice(start));
  }

  function consume(chunk) {
    if (failedCode) return;
    try { processText(decoder.decode(chunk, { stream: true })); }
    catch { fail('SSE_UTF8_INVALID'); }
  }

  function lineEndingKind() {
    if (lineEndings.size > 1) return 'MIXED';
    return lineEndings.values().next().value ?? 'NONE';
  }

  function state() {
    return { eventOverflow, eventCount, dataEventCount, doneObserved,
      reasoningDeltaEvents, reasoningDeltaChars, contentDeltaEvents,
      contentDeltaChars, toolArgDeltaEvents, toolArgDeltaChars,
      doneFinal: doneObserved && !failedCode && lineParts.length === 0 &&
        dataLines.length === 0,
      finishReason, lineEndingKind: lineEndingKind() };
  }

  function finish() {
    if (!failedCode) {
      try { processText(decoder.decode()); }
      catch { fail('SSE_UTF8_INVALID'); }
    }
    if (pendingCR) { lineEndings.add('CR'); pendingCR = false; }
    const pendingEventAtEof = lineParts.length > 0 || dataLines.length > 0;
    const parseCode = failedCode ?? (pendingEventAtEof
      ? 'SSE_PENDING_EVENT_AT_EOF' : !doneObserved
        ? 'SSE_DONE_MISSING' : !finishReason
          ? 'SSE_FINISH_MISSING' : 'KNOWN_TERMINAL');
    return { ...state(), doneFinal: doneObserved && !failedCode &&
      !pendingEventAtEof, parseCode };
  }
  return { consume, state, finish };
}

function resolveOfficialCompletionsUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('ADAPTER_UPSTREAM_BASE_INVALID');
  }
  const hostname = url.hostname.replace(/^\[|\]$/gu, '').replace(/\.$/u, '');
  if (
    url.protocol !== 'https:' ||
    !hostname.includes('.') ||
    isIP(hostname) ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('ADAPTER_UPSTREAM_BASE_INVALID');
  }
  url.pathname = `${url.pathname.replace(/\/$/u, '')}/chat/completions`;
  return url.toString();
}

function copyTrustedUpstreamHeaders(value) {
  if (
    !value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new Error('ADAPTER_UPSTREAM_HEADERS_INVALID');
  }
  const copy = Object.create(null);
  for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    const lower = name.toLowerCase();
    if (
      !/^[!#$%&'*+.^_`|~0-9a-z-]+$/iu.test(name) ||
      FORBIDDEN_UPSTREAM_HEADERS.has(lower) ||
      Object.hasOwn(copy, lower) ||
      !Object.hasOwn(descriptor, 'value') ||
      typeof descriptor.value !== 'string' ||
      descriptor.value.trim().length === 0 ||
      Buffer.byteLength(descriptor.value, 'utf8') > 8192 ||
      /[\u0000-\u001f\u007f]/u.test(descriptor.value)
    ) {
      throw new Error('ADAPTER_UPSTREAM_HEADERS_INVALID');
    }
    copy[lower] = descriptor.value;
  }
  if (
    copy['content-type'] &&
    !/^application\/json(?:\s*;|$)/iu.test(copy['content-type'])
  ) {
    throw new Error('ADAPTER_UPSTREAM_HEADERS_INVALID');
  }
  return Object.freeze(copy);
}

function singleHeader(req, name) {
  const matching = req.rawHeaders.filter((_, index) =>
    index % 2 === 0 && req.rawHeaders[index].toLowerCase() === name,
  );
  if (matching.length !== 1) return null;
  const value = req.headers[name];
  return typeof value === 'string' ? value : null;
}

async function readAndValidateBody(req, modelId, maxCompletionTokens,
  expectedReasoningEffort) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      throw bodyError('ADAPTER_BODY_TOO_LARGE', 413);
    }
    chunks.push(chunk);
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw bodyError('ADAPTER_BODY_INVALID', 400);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw bodyError('ADAPTER_BODY_INVALID', 400);
  }
  if (parsed.model !== modelId) {
    throw bodyError('ADAPTER_MODEL_MISMATCH', 400);
  }
  const observedReasoningEffort = ['low', 'high', 'max']
    .includes(parsed.reasoning_effort)
    ? parsed.reasoning_effort.toUpperCase()
    : parsed.reasoning_effort === undefined ? 'ABSENT' : 'OTHER';
  const disabledThinking = parsed.thinking === false ||
    parsed.thinking?.type === 'disabled' ||
    parsed.enable_thinking === false ||
    parsed.chat_template_kwargs?.enable_thinking === false ||
    parsed.reasoning?.enabled === false;
  const enabledThinking = parsed.thinking?.type === 'enabled' ||
    parsed.enable_thinking === true ||
    parsed.chat_template_kwargs?.enable_thinking === true ||
    parsed.reasoning?.enabled === true;
  const observedThinkingMode = disabledThinking ? 'DISABLED'
    : enabledThinking ? 'ENABLED' : 'ABSENT';
  if (disabledThinking) {
    throw Object.assign(bodyError('ADAPTER_THINKING_DISABLED_UNSUPPORTED', 400),
      { observedReasoningEffort, observedThinkingMode });
  }
  if (expectedReasoningEffort !== undefined &&
    parsed.reasoning_effort !== expectedReasoningEffort) {
    throw Object.assign(bodyError('ADAPTER_REASONING_EFFORT_MISMATCH', 400),
      { observedReasoningEffort, observedThinkingMode });
  }
  const caps = [parsed.max_completion_tokens, parsed.max_tokens].filter(
    (cap) => cap !== undefined,
  );
  if (
    caps.length === 0 ||
    caps.some((cap) =>
      !Number.isSafeInteger(cap) || cap <= 0 || cap > maxCompletionTokens,
    ) ||
    (caps.length === 2 && caps[0] !== caps[1])
  ) {
    throw bodyError('ADAPTER_COMPLETION_CAP_INVALID', 400);
  }
  if (
    (parsed.n !== undefined && parsed.n !== 1) ||
    (parsed.best_of !== undefined && parsed.best_of !== 1)
  ) {
    throw bodyError('ADAPTER_MULTIPLE_CANDIDATES_FORBIDDEN', 400);
  }
  // Serialize once so duplicate JSON keys cannot make another parser see a
  // different model or output cap. The complete messages/tools stay in memory.
  return { body: JSON.stringify(parsed), actualCompletionTokens: caps[0],
    observedReasoningEffort, observedThinkingMode };
}

function bodyError(code, statusCode) {
  return Object.assign(new Error(code), { code, statusCode });
}

function sendFailure(res, statusCode, code) {
  if (res.destroyed || res.headersSent) return;
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify({ error: { code } }));
}
