import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

export const LOCAL_MINERU_RESULT_BODY_LIMIT = 8 * 1024 * 1024;
export const LOCAL_MINERU_CANDIDATE_LIMIT = 64 * 1024 * 1024;
export interface LocalMineruResultTransport {
  encoding: 'identity' | 'gzip';
  rawByteLength: number;
  rawSha256: string;
}
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const failure = (code: string, statusCode = 400) => Object.assign(new Error(code), { code, statusCode });

/** The custom header leaves HTTP Content-Encoding unset: gateways and Nest must
 * not inflate the body before the bounded, authenticated result controller. */
export function encodeLocalMineruResult(candidate: Uint8Array) {
  if (!candidate.length || candidate.length > LOCAL_MINERU_CANDIDATE_LIMIT)
    throw failure('LOCAL_MINERU_CANDIDATE_TOO_LARGE', 413);
  const raw = Buffer.from(candidate);
  const encoding = raw.length <= LOCAL_MINERU_RESULT_BODY_LIMIT ? 'identity' : 'gzip';
  const body = encoding === 'identity' ? raw : gzipSync(raw);
  if (body.length > LOCAL_MINERU_RESULT_BODY_LIMIT)
    throw failure('LOCAL_MINERU_RESULT_TRANSPORT_TOO_LARGE', 413);
  return { body, headers: {
    'x-wiselink-candidate-transport': `${encoding}.v1`,
    'x-wiselink-candidate-raw-byte-length': String(raw.length),
    'x-wiselink-candidate-raw-sha256': digest(raw),
  } };
}

export function localMineruResultTransport(transport: string | undefined, length: string | undefined,
  sha256: string | undefined): LocalMineruResultTransport | null {
  if (transport === undefined && length === undefined && sha256 === undefined) return null; // Legacy identity body.
  if (!['identity.v1', 'gzip.v1'].includes(transport ?? '') || !length || !/^[1-9][0-9]*$/u.test(length) ||
      !sha256 || !/^[a-f0-9]{64}$/u.test(sha256)) throw failure('LOCAL_MINERU_RESULT_TRANSPORT_INVALID');
  const rawByteLength = Number(length);
  if (!Number.isSafeInteger(rawByteLength) || rawByteLength > LOCAL_MINERU_CANDIDATE_LIMIT)
    throw failure('LOCAL_MINERU_CANDIDATE_TOO_LARGE', 413);
  return { encoding: transport === 'gzip.v1' ? 'gzip' : 'identity', rawByteLength, rawSha256: sha256 };
}

export function decodeLocalMineruResult(body: Buffer, transport: LocalMineruResultTransport | null): Buffer {
  if (!body.length || body.length > (transport ? LOCAL_MINERU_RESULT_BODY_LIMIT : LOCAL_MINERU_CANDIDATE_LIMIT))
    throw failure(transport ? 'LOCAL_MINERU_RESULT_TRANSPORT_TOO_LARGE' : 'MINERU_CANDIDATE_TOO_LARGE', 413);
  if (!transport) return body;
  let raw = body;
  if (transport.encoding === 'gzip') {
    try { raw = gunzipSync(body, { maxOutputLength: Math.min(transport.rawByteLength, LOCAL_MINERU_CANDIDATE_LIMIT) }); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE')
        throw failure('LOCAL_MINERU_RESULT_DECOMPRESSED_TOO_LARGE', 413);
      throw failure('LOCAL_MINERU_RESULT_GZIP_INVALID');
    }
  }
  if (raw.length !== transport.rawByteLength || digest(raw) !== transport.rawSha256)
    throw failure('LOCAL_MINERU_RESULT_RAW_MISMATCH');
  return raw;
}
