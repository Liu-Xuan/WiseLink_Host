import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

const TRANSIENT_HTTP_STATUSES = new Set([429, 502, 503, 504]);
const NONDISPATCH_NETWORK_CODES = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH',
]);

/** Two short retries across this turn, within its original operation deadline.
 * Only explicit transient HTTP responses or failures before connecting qualify.
 * Lost responses/timeouts are ambiguous and are never replayed here.
 */
export function createHostedReviewRequester({ requestGateway = requestHostedGateway,
  observeProgress, wait = (ms, signal) => delay(ms, undefined, { signal }),
}) {
  let retryNo = 0;
  let requestNo = 0;
  return async (endpoint, init) => {
    for (;;) {
      init.signal.throwIfAborted();
      requestNo += 1;
      await observeProgress?.({ kind: 'MODEL_REQUEST', requestNo, retryNo, delayMs: 0, errorCode: null });
      let response;
      let error;
      let retryCode;
      try {
        response = await requestGateway(endpoint, init);
        if (!TRANSIENT_HTTP_STATUSES.has(response.status)) return response;
        retryCode = `REVIEW_GATEWAY_HTTP_${response.status}`;
      } catch (cause) {
        error = cause;
        // ECONNRESET, interrupted bodies and aborted requests may already have
        // reached the native session. They do not establish non-dispatch.
        const networkCode = cause?.cause?.code ?? cause?.code;
        if (!NONDISPATCH_NETWORK_CODES.has(networkCode) || init.signal.aborted) throw cause;
        retryCode = `REVIEW_GATEWAY_${networkCode}`;
      }
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
