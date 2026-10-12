import { DocumentOriginalStore } from '../../../server/modules/document-management/src/hosted/nest/document-original-store';
import { originalFixture } from './fixtures/document-original.fixture';
import { createHash } from 'node:crypto';
import { FileDownloadBuilder } from '@lark-apaas/file-service';

describe('document FileService recovery (isolated storage double)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  async function settle<T>(pending: Promise<T>): Promise<T> {
    const outcome = pending.then(value => ({ value }), error => ({ error }));
    await jest.runAllTimersAsync();
    const result = await outcome;
    if ('error' in result) throw result.error;
    return result.value;
  }
  const transportFailure = () => Object.assign(new Error('fetch failed'), { name: 'HttpError', response: undefined });
  function setup() {
    const content = new Map<string, Uint8Array>();
    const metadata = (path: string) => ({ id: `object:${path}`, bucketID: 'bucket', filePath: path,
      metadata: { contentLength: content.get(path)!.length, mimeType: path.endsWith('.md') ? 'text/markdown' : 'application/json' } });
    let loseResponse = false;
    const scoped = {
      getFileMetadata: jest.fn(async (path: string) => content.has(path) ? metadata(path) : null),
      upload: jest.fn(async (bytes: Uint8Array, options: { filePath: string; upsert: boolean }) => {
        expect(options.upsert).toBe(false);
        if (content.has(options.filePath)) throw new Error('ALREADY_EXISTS');
        content.set(options.filePath, new Uint8Array(bytes));
        if (loseResponse) { loseResponse = false; throw new Error('UPLOAD_RESPONSE_LOST'); }
        return metadata(options.filePath);
      }),
      download: jest.fn((path: string) => new FileDownloadBuilder(async () => ({
        metadata: metadata(path) as never, content: new Response(Buffer.from(content.get(path)!)) as never,
      }))),
    };
    return { store: new DocumentOriginalStore({ from: () => scoped } as never), scoped, content,
      loseNextResponse: () => { loseResponse = true; } };
  }
  const scope = { documentVersionId: 'DV-TEST', parseRunId: 'PR-TEST', bucketId: 'bucket' };
  const bytes = Buffer.from('Exact original.');
  it('recovers a no-HTTP upload response lost after commit without a second upload', async () => {
    const { store, scoped } = setup(); const progress = jest.fn(); const assertActive = jest.fn(async () => undefined);
    const upload = scoped.upload.getMockImplementation()!;
    scoped.upload.mockImplementationOnce(async (input, options) => { await upload(input, options); throw transportFailure(); });
    const artifact = await settle(store.save(scope, 'RAW_MARKDOWN', bytes, progress, undefined, assertActive));
    expect(artifact.readback).toBe('VERIFIED');
    expect(scoped.upload).toHaveBeenCalledTimes(1); expect(scoped.getFileMetadata).toHaveBeenCalledTimes(2);
    expect(progress.mock.calls.map(([value]) => value.readback)).toEqual(['UPLOADED', 'VERIFIED']);
  });
  it.each(['null', '404'])('retries only after authoritative %s absence with the same snapshot, path and guard', async absent => {
    const { store, scoped } = setup(); const assertActive = jest.fn(async () => undefined);
    const mutable = Buffer.from(bytes);
    scoped.upload.mockImplementationOnce(async () => { mutable[0] ^= 1; throw transportFailure(); });
    if (absent === '404') scoped.getFileMetadata.mockResolvedValueOnce(null).mockRejectedValueOnce({ status: 404 });
    const artifact = await settle(store.save(scope, 'RAW_MARKDOWN', mutable, async () => undefined, undefined, assertActive));
    expect(artifact.readback).toBe('VERIFIED'); expect(scoped.upload).toHaveBeenCalledTimes(2);
    expect(assertActive).toHaveBeenCalledTimes(2);
    for (const [input, options] of scoped.upload.mock.calls) {
      expect(Buffer.from(input)).toEqual(bytes); expect(options).toMatchObject({ filePath: artifact.filePath, upsert: false });
    }
    for (let index = 0; index < 2; index++)
      expect(assertActive.mock.invocationCallOrder[index]).toBeLessThan(scoped.upload.mock.invocationCallOrder[index]);
  });
  it.each([false, true])('reconciles the third transport failure before bounded exhaustion, committed=%s', async committed => {
    const { store, scoped } = setup(); const assertActive = jest.fn(async () => undefined);
    const upload = scoped.upload.getMockImplementation()!; const last = transportFailure();
    scoped.upload.mockRejectedValueOnce(transportFailure()).mockRejectedValueOnce(transportFailure())
      .mockImplementationOnce(async (input, options) => { if (committed) await upload(input, options); throw last; });
    const saved = settle(store.save(scope, 'RAW_MARKDOWN', bytes, async () => undefined, undefined, assertActive));
    if (committed) await expect(saved).resolves.toMatchObject({ readback: 'VERIFIED' });
    else await expect(saved).rejects.toBe(last);
    expect(scoped.upload).toHaveBeenCalledTimes(3); expect(scoped.getFileMetadata).toHaveBeenCalledTimes(4);
    expect(assertActive).toHaveBeenCalledTimes(3);
  });
  it.each([401, 403, 404, 409, 500])('does not retry an upload with HTTP status %s even with a transport message', async status => {
    const { store, scoped } = setup(); const cause = Object.assign(transportFailure(), { status });
    scoped.upload.mockRejectedValueOnce(cause);
    await expect(settle(store.save(scope, 'RAW_MARKDOWN', bytes, async () => undefined, undefined, async () => undefined))).rejects.toBe(cause);
    expect(scoped.upload).toHaveBeenCalledTimes(1); expect(scoped.getFileMetadata).toHaveBeenCalledTimes(1);
  });
  it('rejects nested HTTP errors, and does not initiate a retry without an active guard', async () => {
    for (const [guard, cause] of [[undefined, transportFailure()], [async () => undefined, { cause: { status: 403 }, message: 'fetch failed' }]] as const) {
      const { store, scoped } = setup(); scoped.upload.mockRejectedValueOnce(cause);
      await expect(settle(store.save(scope, 'RAW_MARKDOWN', bytes, async () => undefined, undefined, guard))).rejects.toBe(cause);
      expect(scoped.upload).toHaveBeenCalledTimes(1); expect(scoped.getFileMetadata).toHaveBeenCalledTimes(1);
    }
  });
  it.each([1, 2])('never catches guard failure at guarded write %s as an upload failure', async write => {
    const { store, scoped } = setup(); const cause = transportFailure();
    const guard = jest.fn(async () => undefined);
    if (write === 2) { guard.mockResolvedValueOnce(undefined); scoped.upload.mockRejectedValueOnce(transportFailure()); }
    guard.mockRejectedValue(cause);
    await expect(settle(store.save(scope, 'RAW_MARKDOWN', bytes, async () => undefined, undefined, guard))).rejects.toBe(cause);
    expect(scoped.upload).toHaveBeenCalledTimes(write - 1);
  });
  it('does not catch progress failure or repeat a successful upload', async () => {
    const { store, scoped } = setup(); const cause = transportFailure();
    await expect(settle(store.save(scope, 'RAW_MARKDOWN', bytes, async () => { throw cause; }, undefined, async () => undefined))).rejects.toBe(cause);
    expect(scoped.upload).toHaveBeenCalledTimes(1); expect(scoped.getFileMetadata).toHaveBeenCalledTimes(1);
    expect(scoped.download).not.toHaveBeenCalled();
  });
  it.each(['HTTP', 'transport'])('does not upload again when fresh metadata lookup fails with %s', async kind => {
    const { store, scoped } = setup(); const cause = kind === 'HTTP' ? { status: 403 } : transportFailure();
    scoped.upload.mockRejectedValueOnce(transportFailure());
    scoped.getFileMetadata.mockResolvedValueOnce(null).mockRejectedValue(cause);
    await expect(settle(store.save(scope, 'RAW_MARKDOWN', bytes, async () => undefined, undefined, async () => undefined))).rejects.toBe(cause);
    expect(scoped.upload).toHaveBeenCalledTimes(1); expect(scoped.getFileMetadata).toHaveBeenCalledTimes(kind === 'HTTP' ? 2 : 4);
  });
  it.each(['bucket', 'path', 'type', 'length', 'provider', 'digest', 'download', 'downloadTransport'])('rejects recovered %s mismatch without another upload', async mismatch => {
    const { store, scoped, content } = setup(); const progress = jest.fn();
    const upload = scoped.upload.getMockImplementation()!; const metadata = scoped.getFileMetadata.getMockImplementation()!;
    const download = scoped.download.getMockImplementation()!;
    scoped.upload.mockImplementationOnce(async (input, options) => {
      await upload(input, options);
      if (mismatch === 'digest') content.get(options.filePath)![0] ^= 1;
      throw transportFailure();
    });
    scoped.getFileMetadata.mockImplementation(async path => {
      const value = await metadata(path); if (!value) return value;
      if (mismatch === 'bucket') return { ...value, bucketID: 'other' };
      if (mismatch === 'path') return { ...value, filePath: 'other' };
      if (mismatch === 'type') return { ...value, metadata: { ...value.metadata, mimeType: 'text/plain' } };
      if (mismatch === 'length') return { ...value, metadata: { ...value.metadata, contentLength: bytes.length + 1 } };
      return value;
    });
    scoped.download.mockImplementation(path => new FileDownloadBuilder(async () => {
      if (mismatch === 'download') throw { status: 403 };
      if (mismatch === 'downloadTransport') throw transportFailure();
      const value = await download(path);
      return { content: new Response(value.content) as never,
        metadata: (mismatch === 'provider' ? { ...value.metadata, id: 'other' } : value.metadata) as never };
    }));
    await expect(settle(store.save(scope, 'RAW_MARKDOWN', bytes, progress, undefined, async () => undefined))).rejects.toBeDefined();
    expect(scoped.upload).toHaveBeenCalledTimes(1);
    if (mismatch === 'downloadTransport') expect(scoped.download).toHaveBeenCalledTimes(3);
    expect(progress.mock.calls.some(([value]) => value.readback === 'VERIFIED')).toBe(false);
  });
  it('fails closed on an invalid upload receipt without another write', async () => {
    const { store, scoped } = setup(); scoped.upload.mockResolvedValueOnce(null as never);
    await expect(settle(store.save(scope, 'RAW_MARKDOWN', bytes, async () => undefined, undefined, async () => undefined)))
      .rejects.toThrow('DOCUMENT_ORIGINAL_METADATA_MISMATCH');
    expect(scoped.upload).toHaveBeenCalledTimes(1);
  });
  it('reconciles a lost upload response without uploading a second time', async () => {
    const { store, scoped, loseNextResponse } = setup();
    loseNextResponse();
    await expect(store.save(scope, 'RAW_MARKDOWN', Buffer.from('Exact original.'), async () => undefined)).rejects.toThrow('UPLOAD_RESPONSE_LOST');
    const recovered = await store.recover(scope, 'RAW_MARKDOWN');
    expect(Buffer.from(recovered!.bytes).toString()).toBe('Exact original.');
    expect(recovered!.artifact.readback).toBe('VERIFIED');
    await store.save(scope, 'RAW_MARKDOWN', Buffer.from('Exact original.'), async () => undefined);
    expect(scoped.upload).toHaveBeenCalledTimes(1);
  });
  it('rejects altered bytes, even if path, length and metadata remain unchanged', async () => {
    const { store, content } = setup();
    const saved = await store.save(scope, 'RAW_MARKDOWN', Buffer.from('A-12'), async () => undefined);
    content.set(saved.filePath, Buffer.from('B-12'));
    await expect(store.read(scope, saved)).rejects.toThrow('DOCUMENT_ORIGINAL_READBACK_DIGEST_MISMATCH');
  });
  it('reads known artifacts with one download and validates the returned object identity', async () => {
    const { store, scoped } = setup();
    const saved = await store.save(scope, 'RAW_MARKDOWN', Buffer.from('Exact original.'), async () => undefined);
    scoped.getFileMetadata.mockClear(); scoped.download.mockClear();
    await expect(store.read(scope, saved)).resolves.toEqual(new Uint8Array(Buffer.from('Exact original.')));
    expect(scoped.getFileMetadata).not.toHaveBeenCalled();
    expect(scoped.download).toHaveBeenCalledTimes(1);
    const download = scoped.download.getMockImplementation()!;
    scoped.download.mockImplementationOnce(path => new FileDownloadBuilder(async () => {
      const result = await download(path);
      return { content: new Response(result.content) as never, metadata: { ...result.metadata, id: 'different-object' } as never };
    }));
    await expect(store.read(scope, saved)).rejects.toThrow('DOCUMENT_ORIGINAL_METADATA_MISMATCH');
  });
  it('retains completed page groups after later persistence fails and refuses arbitrary paths', async () => {
    const { store, loseNextResponse } = setup();
    const first = await store.save(scope, 'MANIFEST', Buffer.from('{"page":0}'), async () => undefined, 'original/pages-0.json');
    loseNextResponse();
    await expect(store.save(scope, 'MANIFEST', Buffer.from('{"page":8}'), async () => undefined, 'original/pages-8.json')).rejects.toThrow();
    expect(Buffer.from(await store.read(scope, first)).toString()).toBe('{"page":0}');
    expect(await store.recover(scope, 'MANIFEST', 'original/pages-8.json')).not.toBeNull();
    await expect(store.recover(scope, 'MANIFEST', '../../other.json')).rejects.toThrow('DOCUMENT_ORIGINAL_ARTIFACT_PATH_INVALID');
  });
  it('loads published reading from the verified manifest while full audit still checks raw artifacts', async () => {
    const { store, scoped, content } = setup();
    const original = originalFixture();
    const readingScope = { ...scope, documentVersionId: original.binding.documentVersionId, parseRunId: original.binding.parseRunId };
    const rawMarkdown = await store.save(readingScope, 'RAW_MARKDOWN', Buffer.from('Original text'), async () => undefined);
    const page = await store.save(readingScope, 'MANIFEST', Buffer.from('{"pages":[]}'), async () => undefined, 'original/pages-0.json');
    const manifest = await store.save(readingScope, 'MANIFEST', Buffer.from(JSON.stringify({
      schemaVersion: 'wiselink.document.bundle.v1', original, rawMarkdown, rawPdfArtifacts: [page],
    })), async () => undefined);
    scoped.download.mockClear();
    const read = await store.loadForReading(readingScope, manifest, original.binding);
    expect(read.original).toEqual(original);
    expect(scoped.download.mock.calls.map(([path]) => path)).toEqual([manifest.filePath]);
    await expect(store.loadForReading(readingScope, manifest, { ...original.binding, parseRevision: original.binding.parseRevision + 1 }))
      .rejects.toThrow('DOCUMENT_ORIGINAL_BINDING_MISMATCH');
    content.set(page.filePath, Buffer.from('{"pages":01}'));
    await expect(store.load(readingScope, manifest, original.binding)).rejects.toThrow('DOCUMENT_ORIGINAL_READBACK_DIGEST_MISMATCH');
  });
  it.each(['MINERU_LOCAL', 'MINERU_LOCAL_PDFJS'] as const)('preserves legacy MinerU while requiring PDF checkpoints for hybrid producer %s', async kind => {
    const { store } = setup();
    const original = originalFixture(); original.producer.kind = kind;
    const localScope = { ...scope, documentVersionId: original.binding.documentVersionId, parseRunId: original.binding.parseRunId };
    const rawMarkdown = await store.save(localScope, 'RAW_MARKDOWN', Buffer.from('Raw OCR'), async () => undefined);
    const rawMineruCandidate = await store.save(localScope, 'MANIFEST', Buffer.from('{"raw":"retained"}'), async () => undefined, 'raw/mineru-candidate.json');
    const manifest = await store.save(localScope, 'MANIFEST', Buffer.from(JSON.stringify({
      schemaVersion: 'wiselink.document.bundle.v1', original, rawMarkdown, rawMineruCandidate, rawPdfArtifacts: [],
    })), async () => undefined);
    if (kind === 'MINERU_LOCAL') await expect(store.load(localScope, manifest, original.binding)).resolves.toMatchObject({ original: { producer: { kind } } });
    else await expect(store.load(localScope, manifest, original.binding)).rejects.toThrow('DOCUMENT_ORIGINAL_RAW_PAGES_REQUIRED');
  });

});

describe('document FileService SDK streaming readback (synthetic bytes)', () => {
  const scope = { documentVersionId: 'DV-STREAM', parseRunId: 'PR-STREAM', bucketId: 'bucket' };
  const path = 'wiselink/parsed/DV-STREAM/PR-STREAM/raw/mineru-candidate.json';
  const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  function setup(bytes: Uint8Array, options: {
    length?: number;
    body?: () => ReadableStream<Uint8Array>;
  } = {}) {
    const metadata = { id: 'stream-object', bucketID: scope.bucketId, filePath: path,
      metadata: { contentLength: options.length ?? bytes.length, mimeType: 'application/json' } };
    const scoped = {
      getFileMetadata: jest.fn(async () => metadata),
      upload: jest.fn(),
      download: jest.fn(() => new FileDownloadBuilder(async () => ({
        metadata: metadata as never,
        content: new Response(options.body ? options.body() : new ReadableStream<Uint8Array>({
          start(controller) {
            for (let offset = 0; offset < bytes.length; offset += 65536)
              controller.enqueue(bytes.subarray(offset, Math.min(offset + 65536, bytes.length)));
            controller.close();
          },
        })) as never,
      }))),
    };
    const artifact = { role: 'MANIFEST' as const, relativePath: 'raw/mineru-candidate.json',
      mediaType: 'application/json', bucketId: scope.bucketId, filePath: path,
      providerObjectId: metadata.id, byteLength: metadata.metadata.contentLength,
      sha256: sha256(bytes), readback: 'VERIFIED' as const };
    const store = new DocumentOriginalStore({ from: () => scoped } as never);
    return { store, scoped, artifact };
  }
  async function read(kind: 'read' | 'recover', fixture: ReturnType<typeof setup>) {
    return kind === 'read' ? fixture.store.read(scope, fixture.artifact)
      : (await fixture.store.recover(scope, 'MANIFEST', 'raw/mineru-candidate.json'))!.bytes;
  }
  it.each(['read', 'recover'] as const)('fully verifies actual >50MiB bytes via the installed SDK stream: %s', async kind => {
    const bytes = Buffer.alloc(50 * 1024 * 1024 + 1, 0x61);
    bytes[bytes.length - 1] = 0x62;
    const f = setup(bytes);
    // The real SDK's ordinary Blob builder reproduces the production boundary.
    await expect(Promise.resolve(f.scoped.download())).rejects.toThrow(
      "Can't download file blob larger than 50MB, use asStream() instead.");
    const actual = await read(kind, f);
    expect(actual.length).toBe(bytes.length);
    expect(Buffer.from(actual).equals(bytes)).toBe(true);
    expect(sha256(actual)).toBe(f.artifact.sha256);
    expect(f.scoped.upload).not.toHaveBeenCalled();
  });
  it('verifies an existing >50MiB immutable object without a new upload before completing progress', async () => {
    const bytes = Buffer.alloc(50 * 1024 * 1024 + 1, 0x63);
    const f = setup(bytes); const progress = jest.fn();
    const saved = await f.store.save(scope, 'MANIFEST', bytes, progress, 'raw/mineru-candidate.json', async () => undefined);
    expect(saved).toMatchObject({ sha256: f.artifact.sha256, byteLength: bytes.length, readback: 'VERIFIED' });
    expect(progress.mock.calls.map(([value]) => value.readback)).toEqual(['UPLOADED', 'VERIFIED']);
    expect(f.scoped.upload).not.toHaveBeenCalled();
  });
  it.each(['read', 'recover'] as const)('rejects a truncated stream: %s', async kind => {
    const f = setup(Buffer.from('truncated'), { length: 10 });
    await expect(read(kind, f)).rejects.toThrow('DOCUMENT_ORIGINAL_READBACK_SIZE_MISMATCH');
  });
  it.each(['read', 'recover'] as const)('cancels excess bytes before copying beyond the declared bound: %s', async kind => {
    const cancel = jest.fn(); const bytes = Buffer.from('too long');
    const f = setup(bytes, { length: bytes.length - 1, body: () => new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(bytes); }, cancel,
    }) });
    await expect(read(kind, f)).rejects.toThrow('DOCUMENT_ORIGINAL_READBACK_SIZE_MISMATCH');
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it.each(['read', 'recover'] as const)('propagates a mid-stream failure without Blob fallback: %s', async kind => {
    const cause = new Error('CONSTRUCTED_STREAM_FAILURE');
    const f = setup(Buffer.from('complete'), { body: () => {
      let first = true;
      return new ReadableStream<Uint8Array>({ pull(controller) {
        if (first) { first = false; controller.enqueue(new Uint8Array([99])); }
        else controller.error(cause);
      } });
    } });
    await expect(read(kind, f)).rejects.toBe(cause);
    expect(f.scoped.download).toHaveBeenCalledTimes(1);
    expect(f.scoped.upload).not.toHaveBeenCalled();
  });
  it.each(['read', 'recover'] as const)('cancels the acquired stream when download metadata is rejected: %s', async kind => {
    const bytes = Buffer.from('bound'); const f = setup(bytes); const cancel = jest.fn();
    const metadata = await f.scoped.getFileMetadata();
    f.scoped.download.mockImplementationOnce(() => new FileDownloadBuilder(async () => ({
      metadata: { ...metadata, id: 'different-object' } as never,
      content: new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(bytes); }, cancel,
      })) as never,
    })));
    await expect(read(kind, f)).rejects.toThrow('DOCUMENT_ORIGINAL_METADATA_MISMATCH');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(f.scoped.download).toHaveBeenCalledTimes(1);
  });
  it('rejects recovery head identity before requesting a stream', async () => {
    const f = setup(Buffer.from('bound')); const metadata = await f.scoped.getFileMetadata();
    f.scoped.getFileMetadata.mockResolvedValueOnce({ ...metadata, bucketID: 'other-bucket' });
    await expect(read('recover', f)).rejects.toThrow('DOCUMENT_ORIGINAL_METADATA_MISMATCH');
    expect(f.scoped.download).not.toHaveBeenCalled();
  });
  it('still rejects an exact-length stream with a different digest', async () => {
    const f = setup(Buffer.from('before'));
    f.artifact.sha256 = sha256(Buffer.from('after!'));
    await expect(read('read', f)).rejects.toThrow('DOCUMENT_ORIGINAL_READBACK_DIGEST_MISMATCH');
  });
  it.each(['read', 'recover'] as const)('retains the64MiB cap before download or allocation: %s', async kind => {
    const f = setup(Buffer.from('small'), { length: 64 * 1024 * 1024 + 1 });
    await expect(read(kind, f)).rejects.toThrow('DOCUMENT_ORIGINAL_DESCRIPTOR_INVALID');
    expect(f.scoped.download).not.toHaveBeenCalled();
  });
  it('retains bounded read-only transport retries when a stream fails before completion', async () => {
    let attempt = 0;
    const f = setup(Buffer.from('x'), { body: () => {
      attempt += 1;
      return new ReadableStream<Uint8Array>({ start(controller) {
        if (attempt < 3) controller.error(new Error('fetch failed'));
        else { controller.enqueue(new Uint8Array([120])); controller.close(); }
      } });
    } });
    await expect(read('read', f)).resolves.toEqual(new Uint8Array([120]));
    expect(f.scoped.download).toHaveBeenCalledTimes(3);
    expect(f.scoped.upload).not.toHaveBeenCalled();
  });
});
