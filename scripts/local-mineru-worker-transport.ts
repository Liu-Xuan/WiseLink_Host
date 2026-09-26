import { createHash } from 'node:crypto';
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
      typeof claim.deadlineAt !== 'string' || !Number.isFinite(Date.parse(claim.deadlineAt)) || Date.parse(claim.deadlineAt) <= now)
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
    const bytes = await this.post('result', Buffer.from(candidate), { 'content-type': 'application/octet-stream',
      'x-wiselink-parse-run-id': identity.parseRunId, 'x-wiselink-document-version-id': identity.documentVersionId,
      'x-wiselink-lease-owner': identity.lease.leaseOwner, 'x-wiselink-lease-token': identity.lease.leaseToken,
      'x-wiselink-lease-generation': String(identity.lease.leaseGeneration) }, signal, 64 * 1024, 'application/json');
    return JSON.parse(bytes.bytes.toString('utf8')) as unknown;
  }
  private async json(path: 'claim' | 'renew', body: unknown, signal: AbortSignal): Promise<unknown> {
    const bytes = await this.post(path, JSON.stringify(body), { 'content-type': 'application/json' }, signal, 64 * 1024, 'application/json');
    return JSON.parse(bytes.bytes.toString('utf8')) as unknown;
  }
  private async post(path: string, body: string | Buffer, headers: Record<string, string>, signal: AbortSignal, max: number, type: string | string[]) {
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs)]);
    const response = await this.request(this.base + path, { method: 'POST', redirect: 'error', signal: bounded,
      headers: { ...headers, Authorization: `Bearer ${this.config.apiKey}` },
      body: typeof body === 'string' ? body : new Uint8Array(body).buffer });
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
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > bodyLimit) { await reader.cancel(); throw new Error('LOCAL_MINERU_RESPONSE_TOO_LARGE'); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    return { bytes: Buffer.concat(chunks), type: actualType };
  }
}
