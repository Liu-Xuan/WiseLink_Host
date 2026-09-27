import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalMineruWorker, pollLocalMineruWorker } from '../../../scripts/local-mineru-worker';
import { LocalMineruHttpTransport, validateClaim, sha256 } from '../../../scripts/local-mineru-worker-transport';
import { readMineruArtifacts } from '../../../server/modules/professional-input/mineru/mineru-artifacts';
import type { LocalMineruWorkerClaim } from '../../../shared/local-mineru-worker.interface';

const pdf = Buffer.from('%PDF-local-worker-fixture');
function fixture(cacheDirectory: string) {
  const claim: LocalMineruWorkerClaim = { status: 'CLAIMED', parseRunId: 'PRUN-local', documentVersionId: 'DV-local',
    sourceSha256: sha256(pdf), sourceByteLength: pdf.length, deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    settings: { revision: 1, localMineruFallbackEnabled: true, titleEnhancementEnabled: false },
    lease: { leaseOwner: 'local', leaseToken: 'token-1', leaseGeneration: 1 } };
  const raw = { markdown: 'Local exact paragraph.', middle: { _version_name: '3.4.5', _backend: 'pipeline', pdf_info: [{ page_idx: 0, page_size: [600, 800] }] },
    contentListV2: [[{ type: 'paragraph', bbox: [0, 0, 100, 100], content: { paragraph_content: [{ type: 'text', content: 'Local exact paragraph.' }] } }]] };
  const document = readMineruArtifacts({ ...raw, assetPaths: [] });
  const runner = { parse: jest.fn(async (_pdf: Uint8Array, _input?: { signal?: AbortSignal }) => ({ document, rawArtifacts: raw, assets: [],
    contentListV2: raw.contentListV2, middle: raw.middle, sourceSha256: claim.sourceSha256, sourceByteLength: pdf.length, titleEnhancement: { status: 'DISABLED' as const } })) };
  const transport = { claim: jest.fn(async (_signal: AbortSignal): Promise<unknown> => structuredClone(claim)),
    source: jest.fn(async (_identity: unknown, _signal: AbortSignal): Promise<Uint8Array | { status: 'CANDIDATE_READY'; parseRunId: string }> => pdf),
    renew: jest.fn(async (_identity: unknown, _signal: AbortSignal): Promise<unknown> => ({ status: 'RENEWED', deadlineAt: claim.deadlineAt })),
    result: jest.fn(async (_identity: unknown, bytes: Uint8Array, _signal: AbortSignal): Promise<unknown> => ({ status: 'ACCEPTED', parseRunId: claim.parseRunId, candidateSha256: sha256(bytes) })) };
  const options = { cacheDirectory, cacheNamespace: 'a'.repeat(64), runner, transport };
  return { claim, runner, transport, options, worker: new LocalMineruWorker(options) };
}
describe('outbound local worker, isolated transports only', () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'local-mineru-worker-test-')); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
  it('verifies exact source, packages and persists candidate privately before submission', async () => {
    const f = fixture(directory);
    expect(await f.worker.once()).toMatchObject({ status: 'ACCEPTED' });
    expect(f.runner.parse).toHaveBeenCalledTimes(1);
    const path = join(directory, 'a'.repeat(64), f.claim.parseRunId, 'candidate.json');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path)).toEqual(Buffer.from(f.transport.result.mock.calls[0][1]));
    expect(JSON.parse((await readFile(join(directory, 'a'.repeat(64), f.claim.parseRunId, 'binding.json'))).toString())).not.toHaveProperty('lease');
  });
  it('reuses identical cached bytes with a fresh Host lease after submit response loss', async () => {
    const f = fixture(directory); f.transport.result.mockRejectedValueOnce(new Error('RESPONSE_LOST'));
    await expect(f.worker.once()).rejects.toThrow('RESPONSE_LOST');
    const first = Buffer.from(f.transport.result.mock.calls[0][1]);
    f.claim.lease = { ...f.claim.lease, leaseToken: 'token-2', leaseGeneration: 2 };
    await f.worker.once();
    expect(f.runner.parse).toHaveBeenCalledTimes(1);
    expect(Buffer.from(f.transport.result.mock.calls[1][1])).toEqual(first);
    expect(f.transport.result.mock.calls[1][0]).toMatchObject({ lease: { leaseToken: 'token-2', leaseGeneration: 2 } });
    expect(f.transport.source).toHaveBeenCalledTimes(2);
  });
  it('stops when Host has already recovered the candidate', async () => {
    const f = fixture(directory); f.transport.source.mockResolvedValue({ status: 'CANDIDATE_READY', parseRunId: f.claim.parseRunId });
    await expect(f.worker.once()).resolves.toEqual({ status: 'CANDIDATE_READY' });
    expect(f.runner.parse).not.toHaveBeenCalled(); expect(f.transport.result).not.toHaveBeenCalled();
  });
  it('rejects changed source before calling the parser', async () => {
    const f = fixture(directory); f.transport.source.mockResolvedValue(Buffer.from('%PDF-wrong-source'));
    await expect(f.worker.once()).rejects.toThrow('LOCAL_MINERU_SOURCE_MISMATCH'); expect(f.runner.parse).not.toHaveBeenCalled();
  });
  it('cancels an in-flight parser when renewal fails and never submits', async () => {
    const f = fixture(directory); f.transport.renew.mockRejectedValue(new Error('LEASE_REJECTED'));
    f.runner.parse.mockImplementation((_pdf, input) => new Promise((_resolve, reject) => {
      input!.signal!.addEventListener('abort', () => reject(new Error('MINERU_ABORTED')), { once: true });
    }));
    await expect(new LocalMineruWorker({ ...f.options, renewIntervalMs: 10 }).once()).rejects.toThrow('MINERU_ABORTED');
    expect(f.transport.result).not.toHaveBeenCalled();
  });
  it('preserves raw parsing when enabled title provider is unavailable, then resumes without OCR', async () => {
    const f = fixture(directory); f.claim.settings.titleEnhancementEnabled = true;
    await expect(f.worker.once()).rejects.toThrow('LOCAL_MINERU_TITLE_PROVIDER_NOT_READY');
    expect(f.transport.result).not.toHaveBeenCalled();
    expect((await stat(join(directory, 'a'.repeat(64), f.claim.parseRunId, 'raw-candidate.json'))).mode & 0o777).toBe(0o600);
    const call = jest.fn(async () => ({ levels: [] }));
    await new LocalMineruWorker({ ...f.options, titleProvider: { call, model: 'injected-offline-test', endpointOrigin: 'https://approved.test' } }).once();
    expect(f.runner.parse).toHaveBeenCalledTimes(1);
    expect(JSON.parse(Buffer.from(f.transport.result.mock.calls[0][1]).toString()).titleEnhancement.status).toBe('NOT_APPLICABLE');
  });
  it('never calls an injected title provider when trusted Host settings disable it', async () => {
    const f = fixture(directory); const call = jest.fn();
    await new LocalMineruWorker({ ...f.options, titleProvider: { call, model: 'unused', endpointOrigin: 'https://approved.test' } }).once();
    expect(call).not.toHaveBeenCalled();
  });
  it('does not accept a changed settings snapshot for the same cached run', async () => {
    const f = fixture(directory); await f.worker.once(); f.claim.settings.revision++;
    await expect(f.worker.once()).rejects.toThrow('LOCAL_MINERU_CACHE_BINDING_CHANGED');
  });
  it('fails on a mismatched result receipt without discarding the candidate', async () => {
    const f = fixture(directory); f.transport.result.mockResolvedValue({ status: 'ACCEPTED', parseRunId: 'another', candidateSha256: 'b'.repeat(64) });
    await expect(f.worker.once()).rejects.toThrow('LOCAL_MINERU_RESULT_INVALID');
    expect(await stat(join(directory, 'a'.repeat(64), f.claim.parseRunId, 'candidate.json'))).toBeDefined();
  });
  it('rejects malformed claims and expired deadlines', () => {
    const f = fixture(directory);
    expect(() => validateClaim({ ...f.claim, parseRunId: '../escape' })).toThrow('LOCAL_MINERU_CLAIM_INVALID');
    expect(() => validateClaim({ ...f.claim, deadlineAt: 'invalid' })).toThrow('LOCAL_MINERU_CLAIM_INVALID');
    expect(() => validateClaim({ ...f.claim, lease: { ...f.claim.lease, leaseGeneration: 0 } })).toThrow('LOCAL_MINERU_CLAIM_INVALID');
    expect(validateClaim({ status: 'IDLE' })).toBeNull();
  });
  it('uses fixed HTTPS routes, bearer authority and rejects oversized response metadata', async () => {
    const request = jest.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ status: 'IDLE' }), { headers: { 'content-type': 'application/json' } }));
    const transport = new LocalMineruHttpTransport({ origin: 'https://host.test', basePath: '/app/exact', apiKey: 'private-test-key' }, request as typeof fetch);
    await transport.claim(new AbortController().signal);
    expect(request.mock.calls[0][0]).toBe('https://host.test/app/exact/openapi/wiselink/local-mineru/claim');
    expect(request.mock.calls[0][1]).toMatchObject({ redirect: 'error', method: 'POST', headers: { Authorization: 'Bearer private-test-key' }, body: '{}' });
    request.mockResolvedValue(new Response('', { headers: { 'content-type': 'application/pdf', 'content-length': String(101 * 1024 * 1024) } }));
    const f = fixture(directory);
    await expect(transport.source(f.claim, new AbortController().signal)).rejects.toThrow('LOCAL_MINERU_RESPONSE_TOO_LARGE');
    expect(() => new LocalMineruHttpTransport({ origin: 'http://host.test', apiKey: 'key' })).toThrow('LOCAL_MINERU_TRANSPORT_CONFIG_INVALID');
  });
  it('handles exact source-ready JSON and binds result headers to the current lease', async () => {
    const f = fixture(directory);
    const request = jest.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(
      JSON.stringify({ status: 'CANDIDATE_READY', parseRunId: f.claim.parseRunId }), { headers: { 'content-type': 'application/json' } }));
    const transport = new LocalMineruHttpTransport({ origin: 'https://host.test', apiKey: 'private-test-key' }, request as typeof fetch);
    expect(await transport.source(f.claim, new AbortController().signal)).toEqual({ status: 'CANDIDATE_READY', parseRunId: f.claim.parseRunId });
    await transport.result(f.claim, Buffer.from('{}'), new AbortController().signal);
    expect(request.mock.calls[1][1]).toMatchObject({ headers: { 'content-type': 'application/octet-stream',
      'x-wiselink-parse-run-id': f.claim.parseRunId, 'x-wiselink-document-version-id': f.claim.documentVersionId,
      'x-wiselink-lease-token': 'token-1', 'x-wiselink-lease-generation': '1' } });
  });
  it('bounds streamed bodies without trusting content-length and rejects cross-run source receipts', async () => {
    const request = jest.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(65 * 1024)); controller.close();
    } }), { headers: { 'content-type': 'application/json' } }));
    const transport = new LocalMineruHttpTransport({ origin: 'https://host.test', apiKey: 'private-test-key' }, request as typeof fetch);
    await expect(transport.claim(new AbortController().signal)).rejects.toThrow('LOCAL_MINERU_RESPONSE_TOO_LARGE');
    request.mockResolvedValue(new Response(JSON.stringify({ status: 'CANDIDATE_READY', parseRunId: 'foreign' }), { headers: { 'content-type': 'application/json' } }));
    await expect(transport.source(fixture(directory).claim, new AbortController().signal)).rejects.toThrow('LOCAL_MINERU_SOURCE_REPLY_INVALID');
  });

  it('continues the opt-in loop after transient Host errors with bounded backoff', async () => {
    const controller = new AbortController();
    const worker = { once: jest.fn()
      .mockRejectedValueOnce(new Error('LOCAL_MINERU_HTTP_503'))
      .mockRejectedValueOnce(new Error('LOCAL_MINERU_TRANSPORT_UNAVAILABLE'))
      .mockResolvedValueOnce({ status: 'IDLE' as const }) };
    const delays: number[] = [];
    const transient: string[] = [];
    await pollLocalMineruWorker(worker, { loop: true, signal: controller.signal,
      pause: async milliseconds => { delays.push(milliseconds); if (delays.length === 3) controller.abort(); },
      reportTransient: code => transient.push(code) });
    expect(worker.once).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([5_000, 10_000, 5_000]);
    expect(transient).toEqual(['LOCAL_MINERU_HTTP_503', 'LOCAL_MINERU_TRANSPORT_UNAVAILABLE']);
  });
  it('stops on denied authority and preserves one-shot failure behavior', async () => {
    const denied = { once: jest.fn(async () => { throw new Error('LOCAL_MINERU_HTTP_403'); }) };
    const pause = jest.fn(async () => undefined);
    await expect(pollLocalMineruWorker(denied, { loop: true, signal: new AbortController().signal, pause }))
      .rejects.toThrow('LOCAL_MINERU_HTTP_403');
    expect(denied.once).toHaveBeenCalledTimes(1);
    expect(pause).not.toHaveBeenCalled();
    const temporary = { once: jest.fn(async () => { throw new Error('LOCAL_MINERU_HTTP_503'); }) };
    await expect(pollLocalMineruWorker(temporary, { loop: false, signal: new AbortController().signal, pause }))
      .rejects.toThrow('LOCAL_MINERU_HTTP_503');
    expect(temporary.once).toHaveBeenCalledTimes(1);
  });
  it('reports a persistent Host transport outage after three consecutive attempts', async () => {
    const worker = { once: jest.fn(async () => { throw new Error('LOCAL_MINERU_HTTP_503'); }) };
    const delays: number[] = [];
    await expect(pollLocalMineruWorker(worker, { loop: true, signal: new AbortController().signal,
      pause: async milliseconds => { delays.push(milliseconds); } }))
      .rejects.toThrow('LOCAL_MINERU_HTTP_503');
    expect(worker.once).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([5_000, 10_000]);
  });
  it('ends cleanly when the loop is stopped during transient backoff', async () => {
    const controller = new AbortController();
    const worker = { once: jest.fn(async () => { throw new Error('LOCAL_MINERU_HTTP_503'); }) };
    await expect(pollLocalMineruWorker(worker, { loop: true, signal: controller.signal,
      pause: async (_milliseconds, signal) => { controller.abort(); throw signal.reason; } }))
      .resolves.toBeUndefined();
    expect(worker.once).toHaveBeenCalledTimes(1);
  });
  it('classifies a network failure without replacing a caller cancellation', async () => {
    const failed = jest.fn(async () => { throw new TypeError('fetch failed'); });
    const transport = new LocalMineruHttpTransport({ origin: 'https://host.test', apiKey: 'private-test-key' }, failed as typeof fetch);
    await expect(transport.claim(new AbortController().signal)).rejects.toThrow('LOCAL_MINERU_TRANSPORT_UNAVAILABLE');
    const controller = new AbortController();
    controller.abort();
    await expect(transport.claim(controller.signal)).rejects.toThrow('fetch failed');
    const interruptedBody = jest.fn(async () => new Response(new ReadableStream({
      pull(stream) { stream.error(new TypeError('connection reset')); },
    }), { headers: { 'content-type': 'application/json' } }));
    const streamed = new LocalMineruHttpTransport({ origin: 'https://host.test', apiKey: 'private-test-key' }, interruptedBody as typeof fetch);
    await expect(streamed.claim(new AbortController().signal)).rejects.toThrow('LOCAL_MINERU_TRANSPORT_UNAVAILABLE');
  });

});
