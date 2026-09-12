import { DocumentOriginalStore } from '../../../server/modules/document-management/src/hosted/nest/document-original-store';

describe('document FileService recovery (isolated storage double)', () => {
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
  it('retains completed page groups after later persistence fails and refuses arbitrary paths', async () => {
    const { store, loseNextResponse } = setup();
    const first = await store.save(scope, 'MANIFEST', Buffer.from('{"page":0}'), async () => undefined, 'original/pages-0.json');
    loseNextResponse();
    await expect(store.save(scope, 'MANIFEST', Buffer.from('{"page":8}'), async () => undefined, 'original/pages-8.json')).rejects.toThrow();
    expect(Buffer.from(await store.read(scope, first)).toString()).toBe('{"page":0}');
    expect(await store.recover(scope, 'MANIFEST', 'original/pages-8.json')).not.toBeNull();
    await expect(store.recover(scope, 'MANIFEST', '../../other.json')).rejects.toThrow('DOCUMENT_ORIGINAL_ARTIFACT_PATH_INVALID');
  });
});
