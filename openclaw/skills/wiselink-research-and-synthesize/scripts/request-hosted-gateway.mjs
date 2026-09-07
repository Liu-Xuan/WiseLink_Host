import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

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
