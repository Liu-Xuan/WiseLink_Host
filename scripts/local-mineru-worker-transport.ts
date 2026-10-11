import { createHash } from 'node:crypto';
import { encodeLocalMineruResult } from '../server/modules/professional-input/mineru/local-mineru-result-transport';
import type { LocalMineruWorkerClaim, LocalMineruWorkerIdentity, LocalMineruWorkerSourceReady } from '../shared/local-mineru-worker.interface';
export type LocalMineruClaim = LocalMineruWorkerClaim;
export type LocalMineruIdentity = LocalMineruWorkerIdentity;
export interface LocalMineruTransport {
  claim(signal: AbortSignal): Promise<unknown>;
  source(identity: LocalMineruIdentity, signal: AbortSignal): Promise<Uint8Array | LocalMineruWorkerSourceReady>;
  renew(identity: LocalMineruIdentity, signal: AbortSignal): Promise<unknown>;
  result(identity: LocalMineruIdentity, candidate: Uint8Array, signal: AbortSignal): Promise<unknown>;
}
const MAX_PDF = 100 * 1024 * 1024;
const MAX_CANDIDATE = 64 * 1024 * 1024;
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,160}$/u.test(value);
export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export function isValidLeaseExpiry(value: unknown, deadlineAt: string, now = Date.now()): value is string {
  if (typeof value !== 'string') return false;
  const expiry = Date.parse(value);
  return Number.isFinite(expiry) && expiry > now && expiry <= Date.parse(deadlineAt) && new Date(expiry).toISOString() === value;
}
type TransportOperation = 'claim' | 'source' | 'renew' | 'result';
export interface LocalMineruTransportFailureDiagnostic {
  operation: 'CLAIM' | 'SOURCE' | 'RENEW' | 'RESULT';
  phase: 'FETCH' | 'RESPONSE_BODY';
  timeoutOrigin: 'TRANSPORT_TIMEOUT' | 'UNKNOWN';
  httpStatus: number | null;
  nativeCodes: string[];
  causeNames: string[];
}
const failureDiagnostics = new WeakMap<Error, LocalMineruTransportFailureDiagnostic>();
const nativeCodes = new Set(['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENOTFOUND',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE']);
const causeNames = new Set(['AbortError', 'TimeoutError']);
/** Only a fixed projection created by this transport may enter worker diagnostics. */
export function localMineruTransportFailureDiagnostic(error: unknown): LocalMineruTransportFailureDiagnostic | undefined {
  const entry = error instanceof Error ? failureDiagnostics.get(error) : undefined;
  return entry ? { ...entry, nativeCodes: [...entry.nativeCodes], causeNames: [...entry.causeNames] } : undefined;
}
function unavailable(cause: unknown, operation: TransportOperation, phase: LocalMineruTransportFailureDiagnostic['phase'],
  timeout: AbortSignal, httpStatus: number | null): Error {
  const codes = new Set<string>(); const names = new Set<string>(); const seen = new Set<object>();
  let node = cause;
  for (let depth = 0; depth < 5 && node !== null && typeof node === 'object' && !seen.has(node); depth++) {
    seen.add(node);
    try {
      const current = node as { code?: unknown; name?: unknown; cause?: unknown };
      const code = current.code; const name = current.name;
      if (typeof code === 'string' && nativeCodes.has(code)) codes.add(code);
      if (typeof name === 'string' && causeNames.has(name)) names.add(name);
      node = current.cause;
    } catch { break; }
  }
  const error = new Error('LOCAL_MINERU_TRANSPORT_UNAVAILABLE', { cause });
  failureDiagnostics.set(error, { operation: ({ claim: 'CLAIM', source: 'SOURCE', renew: 'RENEW', result: 'RESULT' } as const)[operation],
    phase, timeoutOrigin: timeout.aborted ? 'TRANSPORT_TIMEOUT' : 'UNKNOWN', httpStatus,
    nativeCodes: [...codes], causeNames: [...names] });
  return error;
}
async function withinSignal<T>(action: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let listener: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    listener = () => reject(signal.reason); signal.addEventListener('abort', listener, { once: true });
  });
  try { return await Promise.race([Promise.resolve().then(() => { signal.throwIfAborted(); return action(); }), aborted]); }
  finally { signal.removeEventListener('abort', listener!); }
}
export function validateClaim(value: unknown, now = Date.now()): LocalMineruClaim | null {
  if (!value || typeof value !== 'object') throw new Error('LOCAL_MINERU_CLAIM_INVALID');
  const claim = value as Partial<Omit<LocalMineruClaim, 'status'>> & { status?: string };
  if (claim.status === 'IDLE') return null;
  if (claim.status !== 'CLAIMED' || !identifier(claim.parseRunId) || !identifier(claim.documentVersionId) ||
      !claim.lease || !identifier(claim.lease.leaseOwner) || !identifier(claim.lease.leaseToken) ||
      !Number.isSafeInteger(claim.lease.leaseGeneration) || claim.lease.leaseGeneration < 1 ||
      typeof claim.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(claim.sourceSha256) ||
      !Number.isSafeInteger(claim.sourceByteLength) || claim.sourceByteLength! < 5 || claim.sourceByteLength! > MAX_PDF ||
      !claim.settings || !Number.isSafeInteger(claim.settings.revision) || claim.settings.revision < 0 ||
      typeof claim.settings.localMineruFallbackEnabled !== 'boolean' || typeof claim.settings.titleEnhancementEnabled !== 'boolean' ||
      (claim.recoveryPredecessorParseRunId !== undefined &&
        (!/^PRUN-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(claim.recoveryPredecessorParseRunId) ||
          claim.recoveryPredecessorParseRunId === claim.parseRunId)) ||
      typeof claim.deadlineAt !== 'string' || !Number.isFinite(Date.parse(claim.deadlineAt)) || Date.parse(claim.deadlineAt) <= now ||
      (claim.leaseExpiresAt !== undefined && !isValidLeaseExpiry(claim.leaseExpiresAt, claim.deadlineAt, now)))
    throw new Error('LOCAL_MINERU_CLAIM_INVALID');
  return claim as LocalMineruClaim;
}
export function identityOf(claim: LocalMineruClaim): LocalMineruIdentity {
  return { parseRunId: claim.parseRunId, documentVersionId: claim.documentVersionId, lease: { ...claim.lease } };
}
export class LocalMineruHttpTransport implements LocalMineruTransport {
  readonly cacheNamespace: string;
  private readonly base: string;
  constructor(config: { origin: string; basePath?: string; apiKey: string; timeoutMs?: number },
    private readonly request: typeof fetch = fetch) {
    const origin = new URL(config.origin);
    const basePath = config.basePath ?? '';
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash ||
        origin.pathname !== '/' || !config.apiKey || /[\r\n]/u.test(config.apiKey) ||
        (basePath !== '' && (!/^\/[A-Za-z0-9/_-]+$/u.test(basePath) || basePath.includes('//'))) ||
        (config.timeoutMs !== undefined && (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > 120_000)))
      throw new Error('LOCAL_MINERU_TRANSPORT_CONFIG_INVALID');
    this.base = origin.origin + basePath.replace(/\/$/u, '') + '/openapi/wiselink/local-mineru/';
    this.cacheNamespace = sha256(Buffer.from(this.base));
    this.config = { apiKey: config.apiKey, timeoutMs: config.timeoutMs ?? 60_000 };
  }
  private readonly config: { apiKey: string; timeoutMs: number };
  claim(signal: AbortSignal) { return this.json('claim', {}, signal); }
  async source(identity: LocalMineruIdentity, signal: AbortSignal) {
    const result = await this.post('source', JSON.stringify(identity), { 'content-type': 'application/json' }, signal, MAX_PDF, ['application/pdf', 'application/octet-stream', 'application/json']);
    if (result.type === 'application/json') {
      if (result.bytes.length > 64 * 1024) throw new Error('LOCAL_MINERU_RESPONSE_TOO_LARGE');
      const ready = JSON.parse(result.bytes.toString('utf8')) as LocalMineruWorkerSourceReady;
      if (ready.status !== 'CANDIDATE_READY' || ready.parseRunId !== identity.parseRunId) throw new Error('LOCAL_MINERU_SOURCE_REPLY_INVALID');
      return ready;
    }
    return result.bytes;
  }
  renew(identity: LocalMineruIdentity, signal: AbortSignal) { return this.json('renew', identity, signal); }
  async result(identity: LocalMineruIdentity, candidate: Uint8Array, signal: AbortSignal) {
    if (!candidate.length || candidate.length > MAX_CANDIDATE) throw new Error('LOCAL_MINERU_CANDIDATE_TOO_LARGE');
    const encoded = encodeLocalMineruResult(candidate);
    const bytes = await this.post('result', encoded.body, { 'content-type': 'application/octet-stream', ...encoded.headers,
      'x-wiselink-parse-run-id': identity.parseRunId, 'x-wiselink-document-version-id': identity.documentVersionId,
      'x-wiselink-lease-owner': identity.lease.leaseOwner, 'x-wiselink-lease-token': identity.lease.leaseToken,
      'x-wiselink-lease-generation': String(identity.lease.leaseGeneration) }, signal, 64 * 1024, 'application/json');
    return JSON.parse(bytes.bytes.toString('utf8')) as unknown;
  }
  private async json(path: 'claim' | 'renew', body: unknown, signal: AbortSignal): Promise<unknown> {
    const bytes = await this.post(path, JSON.stringify(body), { 'content-type': 'application/json' }, signal, 64 * 1024, 'application/json');
    return JSON.parse(bytes.bytes.toString('utf8')) as unknown;
  }
  private async post(path: TransportOperation, body: string | Buffer, headers: Record<string, string>, signal: AbortSignal, max: number, type: string | string[]) {
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const bounded = AbortSignal.any([signal, timeout]);
    let response: Response;
    try {
      response = await withinSignal(() => this.request(this.base + path, { method: 'POST', redirect: 'error', signal: bounded,
        headers: { ...headers, Authorization: `Bearer ${this.config.apiKey}` },
        body: typeof body === 'string' ? body : new Uint8Array(body).buffer }), bounded);
    } catch (error) {
      if (!signal.aborted && (bounded.aborted || error instanceof TypeError))
        throw unavailable(error, path, 'FETCH', timeout, null);
      throw error;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`LOCAL_MINERU_HTTP_${response.status}`); }
    const actualType = response.headers.get('content-type')?.split(';')[0].trim() ?? '';
    if (!(Array.isArray(type) ? type : [type]).includes(actualType)) {
      await response.body?.cancel(); throw new Error('LOCAL_MINERU_RESPONSE_TYPE_INVALID');
    }
    const bodyLimit = actualType === 'application/json' ? Math.min(max, 64 * 1024) : max;
    const declared = response.headers.get('content-length');
    if (declared && (!/^\d+$/u.test(declared) || Number(declared) > bodyLimit)) {
      await response.body?.cancel(); throw new Error('LOCAL_MINERU_RESPONSE_TOO_LARGE');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('LOCAL_MINERU_RESPONSE_EMPTY');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        bounded.throwIfAborted();
        const part = await withinSignal(() => reader.read(), bounded);
        if (part.done) break;
        size += part.value.length;
        if (size > bodyLimit) { await reader.cancel(); throw new Error('LOCAL_MINERU_RESPONSE_TOO_LARGE'); }
        chunks.push(part.value);
      }
    } catch (error) {
      if (bounded.aborted) void reader.cancel().catch(() => undefined);
      if (!signal.aborted && (bounded.aborted || error instanceof TypeError))
        throw unavailable(error, path, 'RESPONSE_BODY', timeout, response.status);
      throw error;
    } finally { reader.releaseLock(); }
    return { bytes: Buffer.concat(chunks), type: actualType };
  }
}
