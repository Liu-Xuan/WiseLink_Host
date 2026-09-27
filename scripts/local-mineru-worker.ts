/** Outbound local worker. Running this file explicitly performs one bounded claim; --loop opts into polling. */
import { mkdir, lstat, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { MineruRunner } from '../server/modules/professional-input/mineru/mineru-runner';
import { enhanceMineruTitles, type MineruTitleInput } from '../server/modules/professional-input/mineru/mineru-title-enhancer';
import { readMineruArtifacts } from '../server/modules/professional-input/mineru/mineru-artifacts';
import { readLocalMineruCandidate, type LocalMineruTitleReceipt } from '../server/modules/document-management/src/hosted/nest/document-mineru-local-candidate';
import { packageLocalMineruCandidate } from './package-local-mineru-candidate';
import { LocalMineruHttpTransport, validateClaim, identityOf, sha256, type LocalMineruTransport } from './local-mineru-worker-transport';
import type { LocalMineruWorkerClaim, LocalMineruWorkerResult, LocalMineruWorkerRenewResult } from '../shared/local-mineru-worker.interface';

interface WorkerOptions {
  transport: LocalMineruTransport;
  runner: Pick<MineruRunner, 'parse'>;
  cacheDirectory: string;
  /** Derived from configured trusted Host origin + base path, never from a claim. */
  cacheNamespace: string;
  titleProvider?: { call: (titles: readonly MineruTitleInput[], signal: AbortSignal) => Promise<unknown>; model: string; endpointOrigin: string };
  renewIntervalMs?: number;
}
export class LocalMineruWorker {
  private running = false;
  constructor(private readonly options: WorkerOptions) {
    if (!isAbsolute(options.cacheDirectory) || !/^[a-f0-9]{64}$/u.test(options.cacheNamespace) ||
        (options.renewIntervalMs !== undefined && (!Number.isSafeInteger(options.renewIntervalMs) || options.renewIntervalMs < 1 || options.renewIntervalMs > 30_000)))
      throw new Error('LOCAL_MINERU_WORKER_CONFIG_INVALID');
  }
  async once(externalSignal = new AbortController().signal): Promise<{ status: 'IDLE' | 'CANDIDATE_READY' } | LocalMineruWorkerResult> {
    if (this.running) throw new Error('LOCAL_MINERU_WORKER_BUSY');
    this.running = true;
    const controller = new AbortController();
    const signal = AbortSignal.any([externalSignal, controller.signal]);
    let timer: NodeJS.Timeout | undefined;
    let deadlineTimer: NodeJS.Timeout | undefined;
    let pendingRenew: Promise<void> = Promise.resolve();
    let finished = false;
    try {
      const claim = validateClaim(await this.options.transport.claim(signal));
      if (!claim) return { status: 'IDLE' };
      const identity = identityOf(claim);
      const failLease = () => controller.abort(new Error('LOCAL_MINERU_LEASE_LOST'));
      const setDeadline = (deadline: string) => {
        if (deadlineTimer) clearTimeout(deadlineTimer);
        const delay = Date.parse(deadline) - Date.now();
        if (!Number.isFinite(delay) || delay <= 0 || Date.parse(deadline) > Date.parse(claim.deadlineAt)) throw new Error('LOCAL_MINERU_RENEW_INVALID');
        deadlineTimer = setTimeout(failLease, Math.min(delay, 2_147_483_647));
      };
      setDeadline(claim.deadlineAt);
      const renew = async () => {
        const reply = await this.options.transport.renew(identity, signal) as LocalMineruWorkerRenewResult;
        if (reply?.status !== 'RENEWED') throw new Error('LOCAL_MINERU_RENEW_INVALID');
        setDeadline(reply.deadlineAt);
      };
      const schedule = () => {
        timer = setTimeout(() => {
          pendingRenew = renew().catch(failLease).finally(() => { if (!finished && !signal.aborted) schedule(); });
        }, this.options.renewIntervalMs ?? 30_000);
      };
      schedule();
      const source = await this.options.transport.source(identity, signal);
      signal.throwIfAborted();
      if (!(source instanceof Uint8Array)) {
        if (source.status !== 'CANDIDATE_READY' || source.parseRunId !== claim.parseRunId) throw new Error('LOCAL_MINERU_SOURCE_REPLY_INVALID');
        return { status: 'CANDIDATE_READY' };
      }
      if (source.length !== claim.sourceByteLength || sha256(source) !== claim.sourceSha256 || Buffer.from(source.subarray(0, 5)).toString() !== '%PDF-')
        throw new Error('LOCAL_MINERU_SOURCE_MISMATCH');
      const cache = await this.cache(claim);
      let candidate = await privateRead(join(cache, 'candidate.json'));
      if (!candidate) {
        let raw = await privateRead(join(cache, 'raw-candidate.json'));
        if (!raw) {
          const parsed = await this.options.runner.parse(source, { signal });
          signal.throwIfAborted();
          raw = packageLocalMineruCandidate({ pdf: source, parser: { version: parsed.document.version, backend: parsed.document.backend },
            raw: parsed.rawArtifacts, assets: parsed.assets });
          await privateWrite(join(cache, 'raw-candidate.json'), raw);
        }
        const parsed = this.checkCandidate(raw, claim);
        let receipt: LocalMineruTitleReceipt = { status: 'DISABLED' };
        if (claim.settings.titleEnhancementEnabled) {
          const provider = this.options.titleProvider;
          if (!provider) throw new Error('LOCAL_MINERU_TITLE_PROVIDER_NOT_READY');
          const titleSignal = AbortSignal.any([signal, AbortSignal.timeout(80_000)]);
          const document = readMineruArtifacts({ ...parsed.rawArtifacts, assetPaths: parsed.assets.map(asset => asset.path) });
          const enhanced = await enhanceMineruTitles({ document, assets: parsed.assets,
            contentListV2: parsed.rawArtifacts.contentListV2, middle: parsed.rawArtifacts.middle },
          titles => abortable(provider.call(titles, titleSignal), titleSignal));
          titleSignal.throwIfAborted();
          if (enhanced.titleEnhancement.status === 'FAILED' || enhanced.titleEnhancement.status === 'DISABLED') throw new Error('LOCAL_MINERU_TITLE_ENHANCEMENT_FAILED');
          receipt = enhanced.titleEnhancement.status === 'APPLIED' ? { status: 'APPLIED',
            levels: enhanced.document.blocks.filter(block => block.type === 'title').map(block => ({ id: block.id, level: block.headingLevel! })),
            provider: { model: provider.model, endpointOrigin: provider.endpointOrigin } } : { status: 'NOT_APPLICABLE' };
        }
        const document = readMineruArtifacts({ ...parsed.rawArtifacts, assetPaths: parsed.assets.map(asset => asset.path) });
        candidate = packageLocalMineruCandidate({ pdf: source, parser: { version: document.version, backend: document.backend },
          raw: parsed.rawArtifacts, assets: parsed.assets, titleEnhancement: receipt });
        signal.throwIfAborted();
        await privateWrite(join(cache, 'candidate.json'), candidate);
      }
      const parsed = this.checkCandidate(candidate, claim);
      if (claim.settings.titleEnhancementEnabled && !['APPLIED', 'NOT_APPLICABLE'].includes(parsed.titleEnhancement?.status ?? ''))
        throw new Error('LOCAL_MINERU_CACHED_TITLE_INVALID');
      signal.throwIfAborted();
      // Stop periodic renewals before the final fenced submission; Host may release the lease on acceptance.
      finished = true;
      if (timer) clearTimeout(timer);
      await pendingRenew;
      signal.throwIfAborted();
      // A final lease check precedes submission, including candidate replay after a lost response.
      await renew();
      signal.throwIfAborted();
      const receipt = await this.options.transport.result(identity, candidate, signal) as LocalMineruWorkerResult;
      if (!receipt || !['ACCEPTED', 'PUBLISHED'].includes(receipt.status) || receipt.parseRunId !== claim.parseRunId || receipt.candidateSha256 !== sha256(candidate))
        throw new Error('LOCAL_MINERU_RESULT_INVALID');
      return receipt;
    } finally {
      finished = true;
      if (timer) clearTimeout(timer);
      if (deadlineTimer) clearTimeout(deadlineTimer);
      controller.abort();
      await pendingRenew;
      this.running = false;
    }
  }
  private checkCandidate(bytes: Buffer, claim: LocalMineruWorkerClaim) {
    const candidate = readLocalMineruCandidate(bytes);
    if (candidate.sourceSha256 !== claim.sourceSha256 || candidate.sourceByteLength !== claim.sourceByteLength)
      throw new Error('LOCAL_MINERU_CACHE_BINDING_CHANGED');
    return candidate;
  }
  private async cache(claim: LocalMineruWorkerClaim): Promise<string> {
    const directory = join(this.options.cacheDirectory, this.options.cacheNamespace, claim.parseRunId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    for (const path of [this.options.cacheDirectory, join(this.options.cacheDirectory, this.options.cacheNamespace), directory]) {
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) throw new Error('LOCAL_MINERU_CACHE_PERMISSIONS_INVALID');
    }
    const identity = { documentVersionId: claim.documentVersionId, sourceSha256: claim.sourceSha256,
      sourceByteLength: claim.sourceByteLength, settings: claim.settings };
    const path = join(directory, 'binding.json');
    const existing = await privateRead(path);
    if (existing) {
      const prior: typeof identity = JSON.parse(existing.toString('utf8'));
      if (prior?.documentVersionId !== identity.documentVersionId || prior.sourceSha256 !== identity.sourceSha256 ||
          prior.sourceByteLength !== identity.sourceByteLength || prior.settings?.revision !== identity.settings.revision ||
          prior.settings?.localMineruFallbackEnabled !== identity.settings.localMineruFallbackEnabled ||
          prior.settings?.titleEnhancementEnabled !== identity.settings.titleEnhancementEnabled) throw new Error('LOCAL_MINERU_CACHE_BINDING_CHANGED');
    }
    if (!existing) await privateWrite(path, Buffer.from(JSON.stringify(identity)));
    return directory;
  }
}
async function privateRead(path: string): Promise<Buffer | null> {
  let info;
  try { info = await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.size > 64 * 1024 * 1024)
    throw new Error('LOCAL_MINERU_CACHE_INVALID');
  return readFile(path);
}
async function privateWrite(path: string, bytes: Buffer): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 }); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}
async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let listener: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    listener = () => reject(signal.reason); signal.addEventListener('abort', listener, { once: true });
  });
  try { return await Promise.race([promise, aborted]); }
  finally { signal.removeEventListener('abort', listener!); }
}
type WorkerTick = Awaited<ReturnType<LocalMineruWorker['once']>>;
interface PollingOptions {
  loop: boolean;
  signal: AbortSignal;
  pause?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  report?: (result: WorkerTick) => void;
  reportTransient?: (code: string) => void;
}
const transientTransportCodes = new Set([
  'LOCAL_MINERU_TRANSPORT_UNAVAILABLE',
  'LOCAL_MINERU_HTTP_408',
  'LOCAL_MINERU_HTTP_429',
  'LOCAL_MINERU_HTTP_500',
  'LOCAL_MINERU_HTTP_502',
  'LOCAL_MINERU_HTTP_503',
  'LOCAL_MINERU_HTTP_504',
]);
const MAX_CONSECUTIVE_TRANSPORT_FAILURES = 3;
function workerErrorCode(error: unknown): string {
  return error instanceof Error && /^[A-Z][A-Z0-9_]{1,120}$/u.test(error.message)
    ? error.message : 'LOCAL_MINERU_WORKER_FAILED';
}
export async function pollLocalMineruWorker(
  worker: Pick<LocalMineruWorker, 'once'>,
  options: PollingOptions,
): Promise<void> {
  const pause = options.pause ?? ((milliseconds: number, signal: AbortSignal) =>
    sleep(milliseconds, undefined, { signal }));
  let retryDelayMs = 5_000;
  let transientFailures = 0;
  while (!options.signal.aborted) {
    try {
      const result = await worker.once(options.signal);
      options.report?.(result);
      if (!options.loop) return;
      retryDelayMs = 5_000;
      transientFailures = 0;
      await pause(5_000, options.signal);
    } catch (error) {
      if (options.signal.aborted) return;
      const code = workerErrorCode(error);
      if (!options.loop || !transientTransportCodes.has(code)) throw error;
      options.reportTransient?.(code);
      transientFailures += 1;
      if (transientFailures >= MAX_CONSECUTIVE_TRANSPORT_FAILURES) throw error;
      try { await pause(retryDelayMs, options.signal); }
      catch (pauseError) { if (options.signal.aborted) return; throw pauseError; }
      retryDelayMs = Math.min(retryDelayMs * 2, 60_000);
    }
  }
}
async function main() {
  if (process.argv.slice(2).some(argument => argument !== '--loop')) throw new Error('LOCAL_MINERU_ARGUMENT_INVALID');
  const key = process.env.WL_LOCAL_MINERU_API_KEY ?? '';
  delete process.env.WL_LOCAL_MINERU_API_KEY; // Keep Host credential out of the parser child environment.
  const transport = new LocalMineruHttpTransport({ origin: process.env.WL_LOCAL_MINERU_HOST_ORIGIN ?? '',
    basePath: process.env.WL_LOCAL_MINERU_HOST_BASE_PATH, apiKey: key });
  const worker = new LocalMineruWorker({ transport, cacheNamespace: transport.cacheNamespace,
    cacheDirectory: resolve(process.env.WL_LOCAL_MINERU_CACHE_DIRECTORY ?? '.local-mineru-cache'),
    runner: new MineruRunner({ executable: process.env.WL_LOCAL_MINERU_PYTHON_EXECUTABLE ?? '', entryScript: resolve(__dirname, 'mineru-local-entry.py'),
      configPath: process.env.WL_LOCAL_MINERU_CONFIG_PATH ?? '' }) });
  const controller = new AbortController();
  const stop = () => controller.abort(new Error('LOCAL_MINERU_STOPPED'));
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await pollLocalMineruWorker(worker, { loop: process.argv.includes('--loop'), signal: controller.signal,
      report: result => process.stdout.write(JSON.stringify({ status: result.status }) + '\n'),
      reportTransient: code => process.stderr.write(code + '\n') });
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
if (require.main === module) main().catch((error: unknown) => {
  const code = workerErrorCode(error);
  process.stderr.write(code + '\n'); process.exitCode = 1;
});
