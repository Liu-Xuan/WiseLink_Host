import { createHash } from 'node:crypto';
import { MiaodaFileServiceArtifactStore } from '../../server/modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js';

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const transport = () => Object.assign(new Error('fetch failed'), { name: 'HttpError', response: undefined });

function fixture() {
  const bytes = Uint8Array.from(Buffer.from('%PDF-1.7 synthetic ingress snapshot'));
  const sha256 = digest(bytes);
  const filePath = `document-management/source/sha256/${sha256.slice(0, 2)}/${sha256}.pdf`;
  const metadata = { bucketID: 'bucket', filePath, id: 'object-1', name: `${sha256}.pdf`,
    metadata: { mimeType: 'application/pdf', contentLength: bytes.length } };
  const state = { metadata: null as typeof metadata | null, bytes: Buffer.from(bytes),
    downloadMetadata: null as typeof metadata | null };
  const scoped = {
    getFileMetadata: jest.fn(async () => state.metadata),
    upload: jest.fn(async (snapshot: Uint8Array) => {
      state.bytes = Buffer.from(snapshot); state.metadata = structuredClone(metadata); return state.metadata;
    }),
    download: jest.fn(() => ({ asStream: jest.fn(async () => ({ content: state.bytes,
      metadata: state.downloadMetadata ?? state.metadata })) })),
  };
  const guard = jest.fn(async () => {});
  const store = new MiaodaFileServiceArtifactStore({ getDefaultBucket: async () => 'bucket', from: () => scoped });
  const save = (assertActive: (() => Promise<void>) | undefined = guard) => store.persistImmutableSource({
    bytes, sha256, byteLength: bytes.length, mediaType: 'application/pdf', assertActive,
  });
  return { bytes, sha256, filePath, metadata, state, scoped, guard, store, save,
    commit: () => { state.metadata = structuredClone(metadata); } };
}

async function settle<T>(pending: Promise<T>): Promise<T> {
  const outcome = pending.then(value => ({ value }), error => ({ error }));
  await jest.runAllTimersAsync();
  const result = await outcome;
  if ('error' in result) throw result.error;
  return result.value;
}

describe('immutable ingress source bounded unknown-success recovery', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('recovers a committed object after a lost response without another upload', async () => {
    const f = fixture();
    f.scoped.upload.mockImplementationOnce(async () => { f.commit(); throw transport(); });
    await expect(settle(f.save())).resolves.toMatchObject({ sha256: f.sha256,
      byteLength: f.bytes.length, readbackVerified: true, reusedExisting: true, providerObjectId: 'object-1' });
    expect(f.scoped.upload).toHaveBeenCalledTimes(1);
    expect(f.guard).toHaveBeenCalledTimes(1);
    expect(f.scoped.getFileMetadata).toHaveBeenCalledTimes(2);
  });

  it.each(['null', '404'])('rewrites only after fresh authoritative absence (%s)', async absent => {
    const f = fixture(); const snapshot = Buffer.from(f.bytes);
    f.scoped.upload.mockImplementationOnce(async () => { f.bytes.fill(0); throw transport(); });
    if (absent === '404') f.scoped.getFileMetadata.mockResolvedValueOnce(null).mockRejectedValueOnce({ response: { status: 404 } });
    await expect(settle(f.save())).resolves.toMatchObject({ readbackVerified: true, reusedExisting: false });
    expect(f.scoped.upload).toHaveBeenCalledTimes(2);
    expect(f.guard).toHaveBeenCalledTimes(2);
    for (const [bytes, options] of f.scoped.upload.mock.calls as unknown as [Uint8Array, unknown][]) {
      expect(Buffer.from(bytes)).toEqual(snapshot);
      expect(options).toEqual({ filePath: f.filePath, fileName: `${f.sha256}.pdf`,
        contentType: 'application/pdf', upsert: false });
    }
  });

  it.each([false, true])('bounds all attempts at three and reads back the last lost response (committed=%s)', async committed => {
    const f = fixture();
    f.scoped.upload.mockImplementation(async () => {
      if (committed && f.scoped.upload.mock.calls.length === 3) f.commit();
      throw transport();
    });
    if (committed) await expect(settle(f.save())).resolves.toMatchObject({ readbackVerified: true, reusedExisting: true });
    else await expect(settle(f.save())).rejects.toThrow('fetch failed');
    expect(f.scoped.upload).toHaveBeenCalledTimes(3);
    expect(f.guard).toHaveBeenCalledTimes(3);
    expect(f.scoped.getFileMetadata).toHaveBeenCalledTimes(4);
  });

  it.each([401, 403, 404, 409, 500])('does not recover an upload with an HTTP %s response', async status => {
    const f = fixture(); const error = Object.assign(transport(), { response: { status } });
    f.scoped.upload.mockRejectedValue(error);
    await expect(settle(f.save())).rejects.toBe(error);
    expect(f.scoped.upload).toHaveBeenCalledTimes(1);
    expect(f.scoped.getFileMetadata).toHaveBeenCalledTimes(1);
  });

  it('rejects nested HTTP failures and unguarded retries', async () => {
    for (const guarded of [true, false]) {
      const f = fixture(); const error = guarded ? Object.assign(transport(), { cause: { statusCode: 403 } }) : transport();
      f.scoped.upload.mockRejectedValue(error);
      await expect(settle(f.store.persistImmutableSource({ bytes: f.bytes, sha256: f.sha256,
        byteLength: f.bytes.length, ...(guarded ? { assertActive: f.guard } : {}) }))).rejects.toBe(error);
      expect(f.scoped.upload).toHaveBeenCalledTimes(1);
      expect(f.scoped.getFileMetadata).toHaveBeenCalledTimes(1);
    }
  });

  it.each([1, 2])('never catches guard failure as upload transport (write %s)', async write => {
    const f = fixture(); const error = transport();
    if (write === 2) {
      f.guard.mockResolvedValueOnce(undefined);
      f.scoped.upload.mockRejectedValueOnce(transport());
    }
    f.guard.mockRejectedValue(error);
    await expect(settle(f.save())).rejects.toBe(error);
    expect(f.scoped.upload).toHaveBeenCalledTimes(write - 1);
    expect(f.scoped.getFileMetadata).toHaveBeenCalledTimes(write);
  });

  it.each(['bucket', 'path', 'length', 'type', 'bytes', 'provider'])('refuses unknown-success %s drift without overwriting it', async field => {
    const f = fixture();
    f.scoped.upload.mockImplementationOnce(async () => {
      f.commit();
      if (field === 'bucket') f.state.metadata!.bucketID = 'other';
      if (field === 'path') f.state.metadata!.filePath = 'other.pdf';
      if (field === 'length') f.state.metadata!.metadata.contentLength += 1;
      if (field === 'type') f.state.metadata!.metadata.mimeType = 'text/plain';
      if (field === 'bytes') f.state.bytes = Buffer.alloc(f.bytes.length);
      if (field === 'provider') f.state.downloadMetadata = { ...f.metadata, id: 'other-object' };
      throw transport();
    });
    await expect(settle(f.save())).rejects.toThrow();
    expect(f.scoped.upload).toHaveBeenCalledTimes(1);
    expect(f.guard).toHaveBeenCalledTimes(1);
  });

  it.each(['metadata-http', 'metadata-transport', 'download-http', 'download-transport'])('does not turn %s read failure into another upload', async location => {
    const f = fixture();
    f.scoped.upload.mockImplementationOnce(async () => { f.commit(); throw transport(); });
    const error = location.endsWith('http') ? { response: { status: 503 } } : transport();
    if (location.startsWith('metadata')) f.scoped.getFileMetadata.mockResolvedValueOnce(null).mockRejectedValue(error);
    else f.scoped.download.mockImplementation(() => ({ asStream: jest.fn().mockRejectedValue(error) }));
    await expect(settle(f.save())).rejects.toBe(error);
    expect(f.scoped.upload).toHaveBeenCalledTimes(1);
  });

  it('fails invalid upload receipts and identity before repeating any write', async () => {
    const f = fixture(); f.scoped.upload.mockResolvedValueOnce(null as never);
    await expect(settle(f.save())).rejects.toThrow('Upload returned no object metadata');
    expect(f.scoped.upload).toHaveBeenCalledTimes(1);
    await expect(f.store.persistImmutableSource({ bytes: f.bytes, sha256: 'a'.repeat(64),
      byteLength: f.bytes.length, assertActive: f.guard })).rejects.toMatchObject({ code: 'SOURCE_IDENTITY_MISMATCH' });
    expect(f.scoped.upload).toHaveBeenCalledTimes(1);
  });

  it('retains existing-object exact readback and performs no write', async () => {
    const f = fixture(); f.commit();
    await expect(settle(f.save())).resolves.toMatchObject({ reusedExisting: true, readbackVerified: true });
    expect(f.scoped.upload).not.toHaveBeenCalled(); expect(f.guard).not.toHaveBeenCalled();
  });
});
