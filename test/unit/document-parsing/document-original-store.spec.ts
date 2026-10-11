import { DocumentOriginalStore } from '../../../server/modules/document-management/src/hosted/nest/document-original-store';
import { originalFixture } from './fixtures/document-original.fixture';

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
      download: jest.fn(async (path: string) => ({ metadata: metadata(path), content: new Blob([Buffer.from(content.get(path)!)] ) })),
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
    scoped.download.mockImplementation(async path => {
      if (mismatch === 'download') throw { status: 403 };
      if (mismatch === 'downloadTransport') throw transportFailure();
      const value = await download(path);
      return mismatch === 'provider' ? { ...value, metadata: { ...value.metadata, id: 'other' } } : value;
    });
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
    scoped.download.mockImplementationOnce(async path => {
      const result = await download(path);
      return { ...result, metadata: { ...result.metadata, id: 'different-object' } };
    });
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
