import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

const TRANSIENT_HTTP_STATUSES = new Set([429, 502, 503, 504]);
const NONDISPATCH_NETWORK_CODES = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH',
]);
const TRANSPORT_FAILURE_PHASES = new Map([
  ['HOSTED_GATEWAY_REQUEST_FAILED', 'REQUEST'],
  ['HOSTED_GATEWAY_RESPONSE_INTERRUPTED', 'RESPONSE'],
]);
const TRANSPORT_CAUSE_CODES = new Set([
  ...NONDISPATCH_NETWORK_CODES,
  'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ABORT_ERR', 'ERR_STREAM_PREMATURE_CLOSE',
  'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_TLS_HANDSHAKE_TIMEOUT',
]);
const TRANSPORT_CAUSE_NAMES = new Set(['AbortError', 'TimeoutError']);
const TRANSPORT_SYSCALLS = new Set(['connect', 'read', 'write', 'getaddrinfo']);
const HTTP_ERROR_TYPES = new Map([
  ['invalid_request_error', 'INVALID_REQUEST'], ['authentication_error', 'AUTHENTICATION'],
  ['permission_error', 'PERMISSION'], ['insufficient_quota', 'QUOTA'],
  ['rate_limit_error', 'RATE_LIMIT'], ['api_error', 'UPSTREAM_API'],
]);
// Exact diagnostic literals only, not a provider contract or retry policy.
const HTTP_ERROR_CODES = new Set(['invalid_api_key', 'model_not_found', 'context_length_exceeded']);

function safeErrorField(value, field) {
  if (value === null || !['object', 'function'].includes(typeof value)) return undefined;
  try { return value[field]; } catch { return undefined; }
}

/** Never read message or return an arbitrary provider field. An explicit HTTP
 * failure still does not prove whether the agent/provider already executed.
 */
export function hostedGatewayHttpFailureDiagnostic(payload, httpStatus) {
  if (!Number.isSafeInteger(httpStatus) || httpStatus < 400 || httpStatus > 599) return null;
  const error = safeErrorField(payload, 'error');
  const type = safeErrorField(error, 'type');
  const code = safeErrorField(error, 'code');
  return {
    schemaVersion: 'wiselink.hosted-gateway-http-failure.v1', httpStatus,
    errorType: HTTP_ERROR_TYPES.has(type) ? type : 'UNKNOWN',
    category: HTTP_ERROR_TYPES.get(type) ?? 'UNKNOWN',
    errorCode: HTTP_ERROR_CODES.has(code) ? code : null,
    upstreamOutcome: 'UNKNOWN', retryAuthorized: false, rawErrorIncluded: false,
  };
}

/** Re-project an error annotation; never copy even a forged diagnostic object. */
export function readHostedGatewayHttpFailureDiagnostic(error) {
  const annotation = safeErrorField(error, 'gatewayHttpFailure');
  if (safeErrorField(annotation, 'schemaVersion') !== 'wiselink.hosted-gateway-http-failure.v1') return null;
  const message = safeErrorField(error, 'message');
  const match = typeof message === 'string' && /^ACTIVITY_GATEWAY_HTTP_([45]\d{2})$/u.exec(message);
  if (!match || Number(match[1]) !== safeErrorField(annotation, 'httpStatus')) return null;
  return hostedGatewayHttpFailureDiagnostic({ error: {
    type: safeErrorField(annotation, 'errorType'), code: safeErrorField(annotation, 'errorCode'),
  } }, Number(match[1]));
}

/** Project only a fixed transport wrapper's bounded cause chain. The phase
 * names its error event, not dispatch or provider outcome. No raw text leaves
 * this diagnostic and it cannot authorize a retry of an unknown response.
 */
export function hostedGatewayTransportFailureDiagnostic(error) {
  const seen = new Set();
  const chain = [];
  for (let value = error; value && chain.length < 5 && !seen.has(value);
    value = safeErrorField(value, 'cause')) {
    seen.add(value);
    chain.push(value);
  }
  const messages = chain.map(value => safeErrorField(value, 'message'));
  const originIndex = messages.findIndex(message => TRANSPORT_FAILURE_PHASES.has(message));
  if (originIndex === -1) return null;
  const errorCode = messages[originIndex];
  const causeCodes = new Set(), causeNames = new Set(), syscalls = new Set();
  for (const cause of chain.slice(originIndex + 1)) {
    const code = safeErrorField(cause, 'code');
    const name = safeErrorField(cause, 'name');
    const syscall = safeErrorField(cause, 'syscall');
    if (TRANSPORT_CAUSE_CODES.has(code)) causeCodes.add(code);
    if (TRANSPORT_CAUSE_NAMES.has(name)) causeNames.add(name);
    if (TRANSPORT_SYSCALLS.has(syscall)) syscalls.add(syscall);
  }
  return {
    schemaVersion: 'wiselink.hosted-gateway-transport-failure.v1',
    errorCode, phase: TRANSPORT_FAILURE_PHASES.get(errorCode),
    causeCodes: [...causeCodes], causeNames: [...causeNames], syscalls: [...syscalls],
    upstreamOutcome: 'UNKNOWN', retryAuthorized: false, rawErrorIncluded: false,
  };
}

/** Only fixed native failure categories leave this boundary, never upstream
 * error text, model-generated content, provider identities or credentials.
 * Classification is diagnostic only and does not make a request retryable.
 */
export function classifyHostedGatewayFailure(payload) {
  const message = payload?.error?.message;
  if (typeof message !== 'string') return 'UNCLASSIFIED';
  if (/^[^\r\n]{1,200} ended with an incomplete terminal response\.?$/u.test(message))
    return 'INCOMPLETE_TERMINAL_RESPONSE';
  if (message === 'tool_choice=required was not satisfied by the agent response' ||
      message === 'tool_choice required a return_wiselink_assessment_step tool call, but the agent did not produce one')
    return 'TOOL_CHOICE_NOT_SATISFIED';
  return 'UNCLASSIFIED';
}

/** Assessment-only wire classification. It neither retries nor infers a
 * provider outcome from an HTTP error or a gateway conversion failure.
 */
export function classifyHostedAssessmentProtocol(payload, { status, ok }) {
  const failure = classifyHostedGatewayFailure(payload);
  if (!ok || payload?.error) return {
    category: failure === 'TOOL_CHOICE_NOT_SATISFIED' ? 'GATEWAY_TOOL_CONVERSION_FAILED'
      : failure === 'INCOMPLETE_TERMINAL_RESPONSE' ? 'TERMINAL_RESPONSE_MISSING'
        : HTTP_ERROR_TYPES.has(payload?.error?.type) ? 'UPSTREAM_ERROR_REPORTED' : 'GATEWAY_HTTP_ERROR',
    knownTerminal: false, repairEligible: false, upstreamOutcome: 'UNKNOWN',
    httpFailure: hostedGatewayHttpFailureDiagnostic(payload, status),
  };
  const choices = Array.isArray(payload?.choices) ? payload.choices : [];
  const choice = choices[0];
  const message = choice?.message;
  if (choices.length !== 1)
    return { category: 'TOOL_SCHEMA_INVALID', knownTerminal: false,
      repairEligible: false, upstreamOutcome: 'UNKNOWN' };
  if (choice.finish_reason === 'length') return { category: 'OUTPUT_LENGTH',
    knownTerminal: true, repairEligible: false, upstreamOutcome: 'TERMINAL_RESPONSE_OBSERVED' };
  const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  const category = calls.length === 0 ? 'NAMED_TOOL_MISSING'
    : calls.length !== 1 || message?.role !== 'assistant' || calls[0]?.type !== 'function'
      ? 'TOOL_SCHEMA_INVALID'
      : calls[0]?.function?.name !== 'return_wiselink_assessment_step' ? 'NAMED_TOOL_MISMATCH'
        : typeof calls[0]?.id !== 'string' || !calls[0].id ||
          typeof calls[0]?.function?.arguments !== 'string' ? 'TOOL_SCHEMA_INVALID' : null;
  // A complete legal tool call does not require a finish_reason field. An
  // absent reason stays unknown; it is neither inferred truncation nor proof
  // that an incomplete/no-tool response is safe to replay.
  const knownTerminal = ['stop', 'tool_calls'].includes(choice?.finish_reason);
  return { category, knownTerminal, repairEligible: category !== null && knownTerminal,
    upstreamOutcome: knownTerminal ? 'TERMINAL_RESPONSE_OBSERVED' : 'UNKNOWN' };
}

/** Two short retries across this turn, within its original operation deadline.
 * Only explicit transient HTTP responses or failures before connecting qualify.
 * Lost responses/timeouts are ambiguous and are never replayed here.
 */
export function createHostedReviewRequester({ requestGateway = requestHostedGateway,
  observeProgress, maxModelRequests,
  wait = (ms, signal) => delay(ms, undefined, { signal }),
}) {
  if (maxModelRequests !== undefined &&
    (!Number.isSafeInteger(maxModelRequests) || maxModelRequests <= 0)) {
    throw new Error('REVIEW_MAX_MODEL_REQUESTS_INVALID');
  }
  let retryNo = 0;
  let requestNo = 0;
  return async (endpoint, init) => {
    for (;;) {
      init.signal.throwIfAborted();
      if (maxModelRequests !== undefined && requestNo >= maxModelRequests)
        throw new Error('REVIEW_MODEL_REQUEST_BUDGET_EXHAUSTED');
      const nextRequestNo = requestNo + 1;
      await observeProgress?.({ kind: 'MODEL_REQUEST', requestNo: nextRequestNo,
        retryNo, delayMs: 0, errorCode: null });
      init.signal.throwIfAborted();
      requestNo = nextRequestNo;
      let response;
      let error;
      let retryCode;
      try {
        response = await requestGateway(endpoint, init);
        if (!TRANSIENT_HTTP_STATUSES.has(response.status)) return response;
        if (response.status === 502) {
          // Preserve the body for the caller, including transports with one-shot text().
          const body = await response.text();
          response = { status: response.status, ok: response.ok, text: async () => body };
          let payload;
          try { payload = JSON.parse(body); } catch { /* Existing HTTP handling owns malformed bodies. */ }
          const failure = classifyHostedGatewayFailure(payload);
          if (failure === 'TOOL_CHOICE_NOT_SATISFIED') return response;
          if (failure !== 'UNCLASSIFIED') return response;
        }
        retryCode = `REVIEW_GATEWAY_HTTP_${response.status}`;
      } catch (cause) {
        error = cause;
        // ECONNRESET, interrupted bodies and aborted requests may already have
        // reached the native session. They do not establish non-dispatch.
        const networkCode = cause?.cause?.code ?? cause?.code;
        if (!NONDISPATCH_NETWORK_CODES.has(networkCode) || init.signal.aborted) throw cause;
        retryCode = `REVIEW_GATEWAY_${networkCode}`;
      }
      init.signal.throwIfAborted();
      if (maxModelRequests !== undefined && requestNo >= maxModelRequests)
        throw new Error('REVIEW_MODEL_REQUEST_BUDGET_EXHAUSTED');
      if (retryNo >= 2) {
        if (error) throw error;
        return response;
      }
      // The callback renews the exact Host lease and reauthorizes this worker.
      // An unbound direct invocation cannot silently retry a native session.
      if (typeof observeProgress !== 'function') {
        if (error) throw error;
        return response;
      }
      retryNo += 1;
      const delayMs = retryNo === 1 ? 1000 : 3000;
      await observeProgress({ kind: 'MODEL_RETRY', requestNo, retryNo, delayMs, errorCode: retryCode });
      await wait(delayMs, init.signal);
    }
  };
}

/**
 * One non-streaming request to the already configured Gateway. Node fetch has
 * a separate 300s headers timeout even when its AbortSignal allows more time.
 * Use a dedicated core HTTP connection so the caller's existing operation
 * deadline owns the entire request, including headers and body. No retries,
 * redirects, shared/global dispatcher changes, or additional dependencies.
 */
export async function requestHostedGateway(endpoint, init) {
  const url = new URL(endpoint);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('HOSTED_GATEWAY_HTTP_URL_INVALID');
  }
  if (init.method !== 'POST' || typeof init.body !== 'string' ||
    !(init.signal instanceof AbortSignal)) {
    throw new Error('HOSTED_GATEWAY_HTTP_REQUEST_INVALID');
  }
  init.signal.throwIfAborted();
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: 'POST',
      headers: {
        ...init.headers,
        'accept-encoding': 'identity',
        'content-length': Buffer.byteLength(init.body),
      },
      // A fresh socket avoids an inherited global Agent/socket timeout. TLS
      // verification remains the Node default for HTTPS.
      agent: false,
      signal: init.signal,
    }, (res) => {
      const chunks = [];
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) {
          reject(new Error('HOSTED_GATEWAY_RESPONSE_TOO_LARGE'));
          res.destroy();
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.once('error', (cause) => reject(
        new Error('HOSTED_GATEWAY_RESPONSE_INTERRUPTED', { cause }),
      ));
      res.once('end', () => {
        const text = Buffer.concat(chunks, bytes).toString('utf8');
        const status = res.statusCode;
        resolve({ status, ok: status >= 200 && status < 300, text: async () => text });
      });
    });
    req.once('error', (cause) => reject(
      new Error('HOSTED_GATEWAY_REQUEST_FAILED', { cause }),
    ));
    req.setTimeout(0);
    req.end(init.body);
  });
}
