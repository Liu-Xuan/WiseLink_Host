import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalMineruWorker, pollLocalMineruWorker, readLocalMineruCredential, type LocalMineruWorkerDiagnostic } from '../../../scripts/local-mineru-worker';
import { LocalMineruHttpTransport, validateClaim, sha256, localMineruTransportFailureDiagnostic,
  type LocalMineruIdentity } from '../../../scripts/local-mineru-worker-transport';
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
function expiryFixture(cacheDirectory: string, milliseconds = 10_000) {
  const f = fixture(cacheDirectory);
  f.claim.leaseExpiresAt = new Date(Date.now() + milliseconds).toISOString();
  f.transport.renew.mockImplementation(async () => ({ status: 'RENEWED', deadlineAt: f.claim.deadlineAt,
    leaseExpiresAt: f.claim.leaseExpiresAt }));
  return f;
}
function holdParser(f: ReturnType<typeof fixture>) {
  f.runner.parse.mockImplementation((_pdf, input) => new Promise((_resolve, reject) => {
    input!.signal!.addEventListener('abort', () => reject(new Error('MINERU_ABORTED')), { once: true });
  }));
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
  it('reuses only the Host-linked predecessor cache after a normal new recovery admission', async () => {
    const f = fixture(directory);
    const predecessor = 'PRUN-00000000-0000-4000-8000-000000000001';
    f.claim.parseRunId = predecessor;
    await f.worker.once();
    const oldPath = join(directory, 'a'.repeat(64), predecessor, 'candidate.json');
    const oldBytes = await readFile(oldPath); const oldStat = await stat(oldPath);
    const oldBinding = await readFile(join(directory, 'a'.repeat(64), predecessor, 'binding.json'));
    f.claim.parseRunId = 'PRUN-00000000-0000-4000-8000-000000000002';
    f.claim.recoveryPredecessorParseRunId = predecessor;
    f.claim.lease = { ...f.claim.lease, leaseToken: 'new-run-token', leaseGeneration: 1 };
    await f.worker.once();
    expect(f.runner.parse).toHaveBeenCalledTimes(1);
    expect(f.transport.source).toHaveBeenCalledTimes(2);
    expect(f.transport.result.mock.calls[1][0]).toMatchObject({ parseRunId: f.claim.parseRunId,
      lease: { leaseToken: 'new-run-token' } });
    expect(Buffer.from(f.transport.result.mock.calls[1][1])).toEqual(oldBytes);
    expect(await readFile(oldPath)).toEqual(oldBytes);
    expect((await stat(oldPath)).mtimeMs).toBe(oldStat.mtimeMs);
    expect(await readFile(join(directory, 'a'.repeat(64), predecessor, 'binding.json'))).toEqual(oldBinding);
  });
  it.each(['documentVersionId', 'sourceSha256', 'sourceByteLength', 'revision', 'titleEnhancementEnabled', 'localMineruFallbackEnabled'])
    ('refuses predecessor cache binding changes to %s without parser or result replay', async field => {
      const f = fixture(directory); const predecessor = 'PRUN-00000000-0000-4000-8000-000000000001';
      f.claim.parseRunId = predecessor; await f.worker.once();
      const path = join(directory, 'a'.repeat(64), predecessor, 'binding.json');
      const binding = JSON.parse((await readFile(path)).toString());
      if (field === 'revision') binding.settings.revision++;
      else if (field === 'titleEnhancementEnabled' || field === 'localMineruFallbackEnabled') binding.settings[field] = !binding.settings[field];
      else if (field === 'sourceByteLength') binding[field]++;
      else binding[field] = 'changed';
      await writeFile(path, JSON.stringify(binding));
      f.claim.parseRunId = 'PRUN-00000000-0000-4000-8000-000000000002'; f.claim.recoveryPredecessorParseRunId = predecessor;
      await expect(f.worker.once()).rejects.toThrow('LOCAL_MINERU_CACHE_BINDING_CHANGED');
      expect(f.runner.parse).toHaveBeenCalledTimes(1); expect(f.transport.result).toHaveBeenCalledTimes(1);
    });
  it('does not discover a previous candidate without a Host recovery link', async () => {
    const f = fixture(directory); await f.worker.once(); f.claim.parseRunId = 'PRUN-unlinked';
    await f.worker.once();
    expect(f.runner.parse).toHaveBeenCalledTimes(2);
  });
  it('recovers private raw output without repeating MinerU when the linked final candidate is absent', async () => {
    const f = fixture(directory); const predecessor = 'PRUN-00000000-0000-4000-8000-000000000001';
    f.claim.parseRunId = predecessor; await f.worker.once();
    await rm(join(directory, 'a'.repeat(64), predecessor, 'candidate.json'));
    f.claim.parseRunId = 'PRUN-00000000-0000-4000-8000-000000000002'; f.claim.recoveryPredecessorParseRunId = predecessor;
    await f.worker.once();
    expect(f.runner.parse).toHaveBeenCalledTimes(1);
    expect(Buffer.from(f.transport.result.mock.calls[1][1])).toEqual(Buffer.from(f.transport.result.mock.calls[0][1]));
  });
  it('keeps current source and lease checks before submitting a linked old candidate', async () => {
    const f = fixture(directory); const predecessor = 'PRUN-00000000-0000-4000-8000-000000000001';
    f.claim.parseRunId = predecessor; await f.worker.once();
    f.claim.parseRunId = 'PRUN-00000000-0000-4000-8000-000000000002'; f.claim.recoveryPredecessorParseRunId = predecessor;
    f.transport.source.mockResolvedValueOnce(Buffer.from('%PDF-source-changed'));
    await expect(f.worker.once()).rejects.toThrow('LOCAL_MINERU_SOURCE_MISMATCH');
    f.transport.renew.mockRejectedValueOnce(new Error('STALE_FENCE'));
    await expect(f.worker.once()).rejects.toThrow('STALE_FENCE');
    expect(f.runner.parse).toHaveBeenCalledTimes(1); expect(f.transport.result).toHaveBeenCalledTimes(1);
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
  it('recovers one transport failure with the same confirmed fence and no duplicate parse or result', async () => {
    const f = expiryFixture(directory); const parsed = f.runner.parse.getMockImplementation()!;
    let resume!: () => void;
    f.runner.parse.mockImplementation(async (bytes, input) => {
      await new Promise<void>(resolve => { resume = resolve; }); return parsed(bytes, input);
    });
    f.transport.renew.mockRejectedValueOnce(new Error('LOCAL_MINERU_TRANSPORT_UNAVAILABLE'))
      .mockImplementationOnce(async () => { resume(); return { status: 'RENEWED', deadlineAt: f.claim.deadlineAt,
        leaseExpiresAt: new Date(Date.now() + 15_000).toISOString() }; });
    await expect(new LocalMineruWorker({ ...f.options, renewIntervalMs: 10 }).once()).resolves.toMatchObject({ status: 'ACCEPTED' });
    expect(f.transport.renew.mock.calls[0][0]).toEqual(f.transport.renew.mock.calls[1][0]);
    expect(f.transport.renew.mock.calls[0][0]).toEqual({ parseRunId: f.claim.parseRunId,
      documentVersionId: f.claim.documentVersionId, lease: f.claim.lease });
    expect(f.runner.parse).toHaveBeenCalledTimes(1); expect(f.transport.claim).toHaveBeenCalledTimes(1);
    expect(f.transport.source).toHaveBeenCalledTimes(1); expect(f.transport.result).toHaveBeenCalledTimes(1);
  });
  it('also bounds the final fresh renew to two attempts before the single result', async () => {
    const f = expiryFixture(directory);
    f.transport.renew.mockRejectedValueOnce(new Error('LOCAL_MINERU_TRANSPORT_UNAVAILABLE'));
    await expect(f.worker.once()).resolves.toMatchObject({ status: 'ACCEPTED' });
    expect(f.transport.renew).toHaveBeenCalledTimes(2); expect(f.transport.result).toHaveBeenCalledTimes(1);
  });
  it.each([['LOCAL_MINERU_TRANSPORT_UNAVAILABLE', 2], ['LOCAL_MINERU_HTTP_403', 1],
    ['LOCAL_MINERU_HTTP_500', 1], ['DOCUMENT_STEP_LEASE_REJECTED', 1], ['LOCAL_MINERU_RENEW_INVALID', 1]] as const)
    ('never exceeds the permitted renew attempts for %s', async (code, attempts) => {
      const f = expiryFixture(directory); holdParser(f); f.transport.renew.mockRejectedValue(new Error(code));
      await expect(new LocalMineruWorker({ ...f.options, renewIntervalMs: 10 }).once()).rejects.toThrow('MINERU_ABORTED');
      expect(f.transport.renew).toHaveBeenCalledTimes(attempts); expect(f.transport.result).not.toHaveBeenCalled();
      await expect(stat(join(directory, 'a'.repeat(64), f.claim.parseRunId, 'raw-candidate.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    });
  it('keeps the old Host first-error abort without guessing a lease window', async () => {
    const f = fixture(directory); holdParser(f);
    f.transport.renew.mockRejectedValue(new Error('LOCAL_MINERU_TRANSPORT_UNAVAILABLE'));
    await expect(new LocalMineruWorker({ ...f.options, renewIntervalMs: 10 }).once()).rejects.toThrow('MINERU_ABORTED');
    expect(f.transport.renew).toHaveBeenCalledTimes(1); expect(f.transport.result).not.toHaveBeenCalled();
  });
  it.each(['missing', 'invalid', 'expired', 'pastDeadline', 'wrongStatus'])
    ('does not downgrade expiry mode on a %s renewal reply', async kind => {
      const f = expiryFixture(directory); holdParser(f);
      const reply = { status: 'RENEWED', deadlineAt: f.claim.deadlineAt, leaseExpiresAt: f.claim.leaseExpiresAt };
      if (kind === 'missing') delete reply.leaseExpiresAt;
      else if (kind === 'invalid') reply.leaseExpiresAt = 'invalid';
      else if (kind === 'expired') reply.leaseExpiresAt = new Date(Date.now() - 1).toISOString();
      else if (kind === 'pastDeadline') reply.leaseExpiresAt = new Date(Date.parse(f.claim.deadlineAt) + 1).toISOString();
      else reply.status = 'ACCEPTED';
      f.transport.renew.mockResolvedValue(reply);
      await expect(new LocalMineruWorker({ ...f.options, renewIntervalMs: 10 }).once()).rejects.toThrow('MINERU_ABORTED');
      expect(f.transport.renew).toHaveBeenCalledTimes(1); expect(f.transport.result).not.toHaveBeenCalled();
    });
  it.each(['FETCH', 'RESPONSE_BODY'])('aborts a pending %s at confirmed expiry without waiting for transport timeout', async stage => {
    const f = expiryFixture(directory, 1200); holdParser(f);
    let networkSignal: AbortSignal | undefined;
    const request = jest.fn(async (_url: unknown, init?: RequestInit): Promise<Response> => {
      networkSignal = init!.signal as AbortSignal;
      return stage === 'FETCH' ? new Promise(() => undefined) : new Response(new ReadableStream({
        start(stream) { stream.enqueue(Buffer.from('{')); },
      }), { headers: { 'content-type': 'application/json' } });
    });
    const http = new LocalMineruHttpTransport({ origin: 'https://host.test', apiKey: 'private-unit-key' }, request as typeof fetch);
    f.transport.renew.mockImplementation((id, signal) => http.renew(id as LocalMineruIdentity, signal));
    await expect(new LocalMineruWorker({ ...f.options, renewIntervalMs: 10 }).once()).rejects.toThrow('MINERU_ABORTED');
    expect(networkSignal!.aborted).toBe(true); expect(request).toHaveBeenCalledTimes(1);
    expect(f.transport.result).not.toHaveBeenCalled();
  });
  it('does not extend confirmed expiry after an unknown first result and a pending retry', async () => {
    const f = expiryFixture(directory, 1200); holdParser(f);
    const request = jest.fn<Promise<Response>, [unknown, RequestInit?]>()
      .mockRejectedValueOnce(Object.assign(new TypeError('private-network-details'), { cause: { code: 'EAI_AGAIN' } }))
      .mockImplementation(async () => new Promise(() => undefined));
    const http = new LocalMineruHttpTransport({ origin: 'https://host.test', apiKey: 'private-unit-key' }, request as typeof fetch);
    f.transport.renew.mockImplementation((id, signal) => http.renew(id as LocalMineruIdentity, signal));
    const diagnostics: LocalMineruWorkerDiagnostic[] = [];
    await expect(new LocalMineruWorker({ ...f.options, renewIntervalMs: 10,
      reportDiagnostic: entry => diagnostics.push(entry) }).once()).rejects.toThrow('MINERU_ABORTED');
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][1]!.body).toEqual(request.mock.calls[1][1]!.body);
    expect(diagnostics).toContainEqual(expect.objectContaining({ renewAttempt: 1,
      transportFailure: expect.objectContaining({ phase: 'FETCH', nativeCodes: ['EAI_AGAIN'] }) }));
    expect(JSON.stringify(diagnostics)).not.toContain('private-network-details');
    expect(f.transport.result).not.toHaveBeenCalled();
  });
  it('never revives a parser when an ACK arrives after local expiry', async () => {
    const f = expiryFixture(directory, 1200); holdParser(f); let reply!: (value: unknown) => void;
    f.transport.renew.mockImplementation(async () => new Promise(resolve => { reply = resolve; }));
    await expect(new LocalMineruWorker({ ...f.options, renewIntervalMs: 10 }).once()).rejects.toThrow('MINERU_ABORTED');
    reply({ status: 'RENEWED', deadlineAt: f.claim.deadlineAt, leaseExpiresAt: new Date(Date.now() + 10_000).toISOString() });
    await new Promise(resolve => setImmediate(resolve));
    expect(f.transport.renew).toHaveBeenCalledTimes(1); expect(f.transport.result).not.toHaveBeenCalled();
    await expect(stat(join(directory, 'a'.repeat(64), f.claim.parseRunId, 'raw-candidate.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('prioritizes caller cancellation during a pending retry', async () => {
    const f = expiryFixture(directory); holdParser(f); const caller = new AbortController();
    f.transport.renew.mockRejectedValueOnce(new Error('LOCAL_MINERU_TRANSPORT_UNAVAILABLE'))
      .mockImplementationOnce(async () => { caller.abort(new Error('LOCAL_MINERU_STOPPED')); return new Promise(() => undefined); });
    await expect(new LocalMineruWorker({ ...f.options, renewIntervalMs: 10 }).once(caller.signal)).rejects.toThrow('MINERU_ABORTED');
    expect(f.transport.renew).toHaveBeenCalledTimes(2); expect(f.transport.result).not.toHaveBeenCalled();
  });
  it('rejects an ACK outside confirmed expiry even before a delayed timer callback runs', async () => {
    const f = expiryFixture(directory); holdParser(f); let clock: jest.SpyInstance | undefined;
    f.transport.renew.mockImplementationOnce(async () => {
      clock = jest.spyOn(Date, 'now').mockReturnValue(Date.parse(f.claim.leaseExpiresAt!) + 1);
      return { status: 'RENEWED', deadlineAt: f.claim.deadlineAt, leaseExpiresAt: new Date(Date.now() + 10_000).toISOString() };
    });
    try {
      await expect(new LocalMineruWorker({ ...f.options, renewIntervalMs: 10 }).once()).rejects.toThrow('MINERU_ABORTED');
    } finally { clock?.mockRestore(); }
    expect(f.transport.renew).toHaveBeenCalledTimes(1); expect(f.transport.result).not.toHaveBeenCalled();
  });
  it('does not retry claim or result even when confirmed-expiry support is present', async () => {
    const f = expiryFixture(directory);
    f.transport.claim.mockRejectedValueOnce(new Error('LOCAL_MINERU_TRANSPORT_UNAVAILABLE'));
    await expect(f.worker.once()).rejects.toThrow('LOCAL_MINERU_TRANSPORT_UNAVAILABLE');
    expect(f.transport.claim).toHaveBeenCalledTimes(1); expect(f.transport.source).not.toHaveBeenCalled();
    f.transport.result.mockRejectedValueOnce(new Error('LOCAL_MINERU_TRANSPORT_UNAVAILABLE'));
    await expect(f.worker.once()).rejects.toThrow('LOCAL_MINERU_TRANSPORT_UNAVAILABLE');
    expect(f.transport.result).toHaveBeenCalledTimes(1); expect(f.runner.parse).toHaveBeenCalledTimes(1);
  });
  it.each(['LOCAL_MINERU_TRANSPORT_UNAVAILABLE', 'LOCAL_MINERU_HTTP_500', 'LOCAL_MINERU_HTTP_403'])
    ('retains the exact safe renewal cause %s when the parser is aborted', async causeCode => {
      const f = fixture(directory); const diagnostics: LocalMineruWorkerDiagnostic[] = [];
      f.transport.renew.mockRejectedValue(new Error(causeCode));
      f.runner.parse.mockImplementation((_pdf, input) => new Promise((_resolve, reject) => {
        input!.signal!.addEventListener('abort', () => reject(new Error('MINERU_ABORTED')), { once: true });
      }));
      await expect(new LocalMineruWorker({ ...f.options, renewIntervalMs: 10,
        reportDiagnostic: entry => diagnostics.push(entry) }).once()).rejects.toThrow('MINERU_ABORTED');
      expect(diagnostics).toContainEqual(expect.objectContaining({ phase: 'RENEW', status: 'FAILED',
        parseRunId: f.claim.parseRunId, documentVersionId: f.claim.documentVersionId, leaseGeneration: 1,
        causeCode, abortCauseCode: 'LOCAL_MINERU_LEASE_LOST', renewCauseCode: causeCode }));
      expect(diagnostics).toContainEqual(expect.objectContaining({ phase: 'PARSE', status: 'FAILED',
        causeCode: 'MINERU_ABORTED', abortCauseCode: 'LOCAL_MINERU_LEASE_LOST', renewCauseCode: causeCode }));
      expect(f.transport.result).not.toHaveBeenCalled();
      await expect(stat(join(directory, 'a'.repeat(64), f.claim.parseRunId, 'raw-candidate.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    });
  it('distinguishes the earlier Host deadline from an internal parser timeout and never submits', async () => {
    const f = fixture(directory); const diagnostics: LocalMineruWorkerDiagnostic[] = [];
    f.claim.deadlineAt = new Date(Date.now() + 300).toISOString();
    f.runner.parse.mockImplementation((_pdf, input) => new Promise((_resolve, reject) => {
      input!.signal!.addEventListener('abort', () => reject(new Error('MINERU_ABORTED')), { once: true });
    }));
    await expect(new LocalMineruWorker({ ...f.options, renewIntervalMs: 10,
      reportDiagnostic: entry => diagnostics.push(entry) }).once()).rejects.toThrow('MINERU_ABORTED');
    expect(f.transport.renew).toHaveBeenCalled();
    expect(diagnostics).toContainEqual(expect.objectContaining({ phase: 'DEADLINE', status: 'FAILED',
      causeCode: 'LOCAL_MINERU_DEADLINE_REACHED', abortCauseCode: 'LOCAL_MINERU_LEASE_LOST' }));
    expect(diagnostics).not.toContainEqual(expect.objectContaining({ causeCode: 'MINERU_TIMEOUT' }));
    expect(f.transport.result).not.toHaveBeenCalled();
  });
  it('logs exact parser phase and safe timeout without serializing source, credentials or exception bodies', async () => {
    const f = fixture(directory); const diagnostics: LocalMineruWorkerDiagnostic[] = [];
    f.claim.lease = { leaseOwner: 'private-owner', leaseToken: 'private-token', leaseGeneration: 7 };
    const error = Object.assign(new Error('MINERU_TIMEOUT'), { stderr: 'private-source-body',
      headers: { Authorization: 'Bearer private-key' }, body: 'private-response-body' });
    f.runner.parse.mockRejectedValue(error);
    await expect(new LocalMineruWorker({ ...f.options, reportDiagnostic: entry => diagnostics.push(entry) }).once())
      .rejects.toBe(error);
    expect(diagnostics).toContainEqual(expect.objectContaining({ phase: 'PARSE', status: 'FAILED',
      parseRunId: f.claim.parseRunId, documentVersionId: f.claim.documentVersionId, leaseGeneration: 7,
      causeCode: 'MINERU_TIMEOUT' }));
    const serialized = JSON.stringify(diagnostics);
    for (const secret of ['private-owner', 'private-token', 'private-key', 'private-source-body', 'private-response-body',
      'Local exact paragraph.', '%PDF-local-worker-fixture']) expect(serialized).not.toContain(secret);
    expect(f.transport.result).not.toHaveBeenCalled();
  });
  it('masks even an uppercase unknown exception message and preserves the original failure', async () => {
    const f = fixture(directory); const diagnostics: LocalMineruWorkerDiagnostic[] = [];
    const error = new Error('PRIVATE_UPPERCASE_BEARER_TOKEN'); f.runner.parse.mockRejectedValue(error);
    await expect(new LocalMineruWorker({ ...f.options, reportDiagnostic: entry => diagnostics.push(entry) }).once())
      .rejects.toBe(error);
    expect(diagnostics).toContainEqual(expect.objectContaining({ phase: 'PARSE', status: 'FAILED',
      causeCode: 'LOCAL_MINERU_WORKER_FAILED' }));
    expect(JSON.stringify(diagnostics)).not.toContain(error.message);
  });
  it('does not let a failed diagnostic observer suppress lease cancellation or leak its exception', async () => {
    const f = fixture(directory); const stderr = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
    f.transport.renew.mockRejectedValue(new Error('LOCAL_MINERU_HTTP_403'));
    f.runner.parse.mockImplementation((_pdf, input) => new Promise((_resolve, reject) => {
      input!.signal!.addEventListener('abort', () => reject(new Error('MINERU_ABORTED')), { once: true });
    }));
    try {
      await expect(new LocalMineruWorker({ ...f.options, renewIntervalMs: 10,
        reportDiagnostic: () => { throw new Error('private-observer-body'); } }).once()).rejects.toThrow('MINERU_ABORTED');
      expect(stderr).toHaveBeenCalledWith('LOCAL_MINERU_DIAGNOSTIC_WRITE_FAILED\n');
      expect(JSON.stringify(stderr.mock.calls)).not.toContain('private-observer-body');
      expect(f.transport.result).not.toHaveBeenCalled();
    } finally { stderr.mockRestore(); }
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
    expect(() => validateClaim({ ...f.claim, recoveryPredecessorParseRunId: '../old' })).toThrow('LOCAL_MINERU_CLAIM_INVALID');
    expect(() => validateClaim({ ...f.claim, recoveryPredecessorParseRunId: f.claim.parseRunId })).toThrow('LOCAL_MINERU_CLAIM_INVALID');
    expect(validateClaim({ status: 'IDLE' })).toBeNull();
  });
  it('rejects present invalid claim expiry instead of entering legacy compatibility', async () => {
    const f = expiryFixture(directory);
    for (const expiry of [null, 'invalid', new Date(Date.now() - 1).toISOString(),
      new Date(Date.parse(f.claim.deadlineAt) + 1).toISOString()]) {
      expect(() => validateClaim({ ...f.claim, leaseExpiresAt: expiry })).toThrow('LOCAL_MINERU_CLAIM_INVALID');
    }
    f.transport.claim.mockResolvedValue({ ...f.claim, leaseExpiresAt: null });
    await expect(f.worker.once()).rejects.toThrow('LOCAL_MINERU_CLAIM_INVALID');
    expect(f.transport.source).not.toHaveBeenCalled(); expect(f.runner.parse).not.toHaveBeenCalled();
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
    await expect(transport.claim(controller.signal)).rejects.toBe(controller.signal.reason);
    const interruptedBody = jest.fn(async () => new Response(new ReadableStream({
      pull(stream) { stream.error(new TypeError('connection reset')); },
    }), { headers: { 'content-type': 'application/json' } }));
    const streamed = new LocalMineruHttpTransport({ origin: 'https://host.test', apiKey: 'private-test-key' }, interruptedBody as typeof fetch);
    await expect(streamed.claim(new AbortController().signal)).rejects.toThrow('LOCAL_MINERU_TRANSPORT_UNAVAILABLE');
  });
  it('projects only bounded native enums and keeps fetch/body/timeout distinctions', async () => {
    const secret = 'PRIVATE_BODY_URL_TOKEN';
    const native = { code: 'ECONNRESET', name: 'AbortError', message: secret, headers: { Authorization: secret }, cause: {} };
    native.cause = native;
    const raw = Object.assign(new TypeError(secret), { cause: native });
    const request = jest.fn(async () => { throw raw; });
    const http = new LocalMineruHttpTransport({ origin: 'https://host.test', apiKey: secret }, request as typeof fetch);
    const failure = await http.renew({ parseRunId: 'PRUN-test', documentVersionId: 'DV-test',
      lease: { leaseOwner: 'owner', leaseToken: 'token', leaseGeneration: 1 } }, new AbortController().signal).catch(error => error);
    expect((failure as Error & { cause?: unknown }).cause).toBe(raw);
    expect(localMineruTransportFailureDiagnostic(failure)).toEqual({ operation: 'RENEW', phase: 'FETCH',
      timeoutOrigin: 'UNKNOWN', httpStatus: null, nativeCodes: ['ECONNRESET'], causeNames: ['AbortError'] });
    expect(JSON.stringify(localMineruTransportFailureDiagnostic(failure))).not.toContain(secret);
    const body = new LocalMineruHttpTransport({ origin: 'https://host.test', apiKey: secret },
      (async () => new Response(new ReadableStream({ start(stream) { stream.error(raw); } }),
        { headers: { 'content-type': 'application/json' } })) as typeof fetch);
    const interrupted = await body.claim(new AbortController().signal).catch(error => error);
    expect(localMineruTransportFailureDiagnostic(interrupted)).toMatchObject({ phase: 'RESPONSE_BODY', httpStatus: 200 });
    const timeout = new LocalMineruHttpTransport({ origin: 'https://host.test', apiKey: secret, timeoutMs: 10 },
      (async () => new Promise<Response>(() => undefined)) as typeof fetch);
    const timedOut = await timeout.claim(new AbortController().signal).catch(error => error);
    expect(localMineruTransportFailureDiagnostic(timedOut)).toMatchObject({ timeoutOrigin: 'TRANSPORT_TIMEOUT', causeNames: ['TimeoutError'] });
    const hostile = Object.assign(new TypeError(secret), { code: secret });
    Object.defineProperty(hostile, 'cause', { get() { throw new Error(secret); } });
    const unknown = new LocalMineruHttpTransport({ origin: 'https://host.test', apiKey: secret }, (async () => { throw hostile; }) as typeof fetch);
    expect(localMineruTransportFailureDiagnostic(await unknown.claim(new AbortController().signal).catch(error => error)))
      .toMatchObject({ nativeCodes: [], causeNames: [] });
    let reads = 0;
    const changing = new TypeError(secret);
    Object.defineProperty(changing, 'code', { get() { return ++reads <= 2 ? 'ECONNRESET' : secret; } });
    const changingTransport = new LocalMineruHttpTransport({ origin: 'https://host.test', apiKey: secret },
      (async () => { throw changing; }) as typeof fetch);
    const projection = localMineruTransportFailureDiagnostic(await changingTransport.claim(new AbortController().signal).catch(error => error));
    expect(projection).toMatchObject({ nativeCodes: ['ECONNRESET'] });
    expect(reads).toBe(1); expect(JSON.stringify(projection)).not.toContain(secret);
  });

  it('reads the dedicated key from a private file without putting it in launch configuration', async () => {
    const path = join(directory, 'credentials.json');
    await writeFile(path, JSON.stringify({ api_key: 'private-test-key' }), { mode: 0o600 });
    await expect(readLocalMineruCredential({ filePath: path })).resolves.toBe('private-test-key');
    await expect(readLocalMineruCredential({ apiKey: 'other-key', filePath: path }))
      .rejects.toThrow('LOCAL_MINERU_CREDENTIAL_AMBIGUOUS');
    await expect(readLocalMineruCredential({ filePath: 'credentials.json' }))
      .rejects.toThrow('LOCAL_MINERU_CREDENTIAL_PATH_INVALID');
  });
  it('rejects a broadly readable or linked credential file', async () => {
    const path = join(directory, 'credentials.json');
    await writeFile(path, JSON.stringify({ api_key: 'private-test-key' }), { mode: 0o600 });
    await chmod(path, 0o644);
    await expect(readLocalMineruCredential({ filePath: path }))
      .rejects.toThrow('LOCAL_MINERU_CREDENTIAL_PERMISSIONS_INVALID');
    await chmod(path, 0o600);
    const linked = join(directory, 'linked.json');
    await symlink(path, linked);
    await expect(readLocalMineruCredential({ filePath: linked }))
      .rejects.toThrow('LOCAL_MINERU_CREDENTIAL_FILE_UNAVAILABLE');
  });

});
