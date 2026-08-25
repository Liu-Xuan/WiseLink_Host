import { MiaodaOrdinaryArtifactStoreAdapter } from '../../server/modules/unified-reader/miaoda-ordinary-artifact-store.adapter';
import { sha256Raw } from '../../server/modules/unified-reader/unified-reader.utils';

interface StoredFile {
  id: string;
  bytes: Uint8Array;
  mimeType: string;
}

class LocalScopedFileService {
  readonly files = new Map<string, StoredFile>();
  uploadCount = 0;
  downloadCount = 0;

  constructor(private readonly bucketId: string) {}

  async getFileMetadata(filePath: string) {
    const stored = this.files.get(filePath);
    if (!stored) return null;
    return {
      id: stored.id,
      bucketID: this.bucketId,
      filePath: `/${filePath}`,
      metadata: {
        contentLength: String(stored.bytes.byteLength),
        mimeType: stored.mimeType,
      },
    };
  }

  async upload(
    bytes: Uint8Array,
    options: { filePath: string; contentType: string; upsert: boolean },
  ) {
    expect(options.upsert).toBe(false);
    this.uploadCount += 1;
    this.files.set(options.filePath, {
      id: `file-${this.uploadCount}`,
      bytes: Uint8Array.from(bytes),
      mimeType: options.contentType,
    });
    return { filePath: options.filePath };
  }

  async download(filePath: string) {
    this.downloadCount += 1;
    const stored = this.files.get(filePath);
    if (!stored) throw new Error('FILE_NOT_FOUND');
    const bytes = Uint8Array.from(stored.bytes);
    return {
      content: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
      metadata: { id: stored.id },
    };
  }
}

describe('MiaodaOrdinaryArtifactStoreAdapter', () => {
  it('persists once, reads stream bytes, and reuses exact content', async () => {
    const scoped = new LocalScopedFileService('bucket-local');
    const fileService = {
      getDefaultBucket: async () => 'bucket-local',
      from: () => scoped,
    };
    const adapter = new MiaodaOrdinaryArtifactStoreAdapter(
      fileService as never,
    );
    const bytes = new TextEncoder().encode('{"package":true}\n');

    const first = await adapter.persistAndReadback(bytes);
    const second = await adapter.persistAndReadback(bytes);

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.artifact.sha256).toBe(sha256Raw(bytes));
    expect(second.bytes).toEqual(bytes);
    expect(scoped.uploadCount).toBe(1);
  });

  it('treats a hosted metadata 404 as an absent object before upload', async () => {
    const bytes = new TextEncoder().encode('{"package":true}\n');
    const digest = sha256Raw(bytes);
    const path = `unified-parsed-packages/sha256/${digest}.json`;
    const scoped = {
      getFileMetadata: jest
        .fn()
        .mockRejectedValueOnce(
          Object.assign(new Error('FileService: 404 Not Found'), {
            statusCode: 404,
          }),
        )
        .mockResolvedValueOnce({
          id: 'hosted-file-1',
          bucketID: 'bucket-hosted-test',
          filePath: `/${path}`,
          metadata: {
            contentLength: String(bytes.byteLength),
            mimeType: 'application/json',
          },
        }),
      upload: jest.fn(async (_bytes: Uint8Array, options: { filePath: string }) => ({
        filePath: options.filePath,
      })),
      download: jest.fn(async () => ({
        content: bytes,
        metadata: { id: 'hosted-file-1' },
      })),
    };
    const fileService = {
      getDefaultBucket: async () => 'bucket-hosted-test',
      from: () => scoped,
    };
    const adapter = new MiaodaOrdinaryArtifactStoreAdapter(
      fileService as never,
    );

    await expect(adapter.persistAndReadback(bytes)).resolves.toMatchObject({
      reused: false,
      bytes,
    });
    expect(scoped.upload).toHaveBeenCalledTimes(1);
    expect(scoped.getFileMetadata).toHaveBeenCalledTimes(2);
  });

  it('retries one transport failure for the readback metadata request', async () => {
    const bytes = new TextEncoder().encode('{"package":true}\n');
    const digest = sha256Raw(bytes);
    const path = `unified-parsed-packages/sha256/${digest}.json`;
    const metadata = {
      id: 'metadata-retry-file',
      bucketID: 'bucket-retry-test',
      filePath: `/${path}`,
      metadata: {
        contentLength: String(bytes.byteLength),
        mimeType: 'application/json',
      },
    };
    const scoped = {
      getFileMetadata: jest
        .fn()
        .mockRejectedValueOnce(
          Object.assign(new TypeError('fetch failed'), {
            cause: Object.assign(new Error('other side closed'), {
              code: 'UND_ERR_SOCKET',
            }),
          }),
        )
        .mockResolvedValue(metadata),
      download: jest.fn(async () => ({
        content: bytes,
        metadata: { id: metadata.id },
      })),
    };
    const adapter = new MiaodaOrdinaryArtifactStoreAdapter({
      getDefaultBucket: async () => 'bucket-retry-test',
      from: () => scoped,
    } as never);

    await expect(
      adapter.readActualBytes({
        storeRole: 'UnifiedArtifactStoreCandidate',
        ref: `artifact://UnifiedArtifactStoreCandidate/unified-parsed-packages/sha256/${digest}`,
        sha256: digest,
        byteLength: bytes.byteLength,
        mediaType: 'application/json',
      }),
    ).resolves.toEqual(bytes);
    expect(scoped.getFileMetadata).toHaveBeenCalledTimes(2);
    expect(scoped.download).toHaveBeenCalledTimes(1);
  });

  it('retries one transport failure for the download request and then succeeds', async () => {
    const bytes = new TextEncoder().encode('{"package":true}\n');
    const digest = sha256Raw(bytes);
    const path = `unified-parsed-packages/sha256/${digest}.json`;
    const metadata = {
      id: 'download-retry-file',
      bucketID: 'bucket-download-retry-test',
      filePath: `/${path}`,
      metadata: {
        contentLength: String(bytes.byteLength),
        mimeType: 'application/json',
      },
    };
    const scoped = {
      getFileMetadata: jest.fn().mockResolvedValue(metadata),
      download: jest
        .fn()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValue({
          content: bytes,
          metadata: { id: metadata.id },
        }),
    };
    const adapter = new MiaodaOrdinaryArtifactStoreAdapter({
      getDefaultBucket: async () => 'bucket-download-retry-test',
      from: () => scoped,
    } as never);

    await expect(
      adapter.readActualBytes({
        storeRole: 'UnifiedArtifactStoreCandidate',
        ref: `artifact://UnifiedArtifactStoreCandidate/unified-parsed-packages/sha256/${digest}`,
        sha256: digest,
        byteLength: bytes.byteLength,
        mediaType: 'application/json',
      }),
    ).resolves.toEqual(bytes);
    expect(scoped.download).toHaveBeenCalledTimes(2);
  });

  it('does not retry a status-bearing provider failure', async () => {
    const bytes = new TextEncoder().encode('{"package":true}\n');
    const digest = sha256Raw(bytes);
    const path = `unified-parsed-packages/sha256/${digest}.json`;
    const notFound = Object.assign(new Error('Not Found'), { status: 404 });
    const scoped = {
      getFileMetadata: jest.fn().mockRejectedValue(notFound),
      download: jest.fn(),
    };
    const adapter = new MiaodaOrdinaryArtifactStoreAdapter({
      getDefaultBucket: async () => 'bucket-no-retry-test',
      from: () => scoped,
    } as never);

    await expect(
      adapter.readActualBytes({
        storeRole: 'UnifiedArtifactStoreCandidate',
        ref: `artifact://UnifiedArtifactStoreCandidate/unified-parsed-packages/sha256/${digest}`,
        sha256: digest,
        byteLength: bytes.byteLength,
        mediaType: 'application/json',
      }),
    ).rejects.toThrow('ARTIFACT_STORE_METADATA_READ_FAILED:Not Found');
    expect(scoped.getFileMetadata).toHaveBeenCalledTimes(1);
    expect(scoped.download).not.toHaveBeenCalled();
  });

  it('does not retry a fetch wrapper whose cause is an HTTP 404', async () => {
    const bytes = new TextEncoder().encode('{"package":true}\n');
    const digest = sha256Raw(bytes);
    const path = `unified-parsed-packages/sha256/${digest}.json`;
    const notFound = Object.assign(new Error('Not Found'), { status: 404 });
    const transportWrapper = Object.assign(new TypeError('fetch failed'), {
      cause: notFound,
    });
    const scoped = {
      getFileMetadata: jest.fn().mockRejectedValue(transportWrapper),
      download: jest.fn(),
    };
    const adapter = new MiaodaOrdinaryArtifactStoreAdapter({
      getDefaultBucket: async () => 'bucket-nested-no-retry-test',
      from: () => scoped,
    } as never);

    await expect(
      adapter.readActualBytes({
        storeRole: 'UnifiedArtifactStoreCandidate',
        ref: `artifact://UnifiedArtifactStoreCandidate/unified-parsed-packages/sha256/${digest}`,
        sha256: digest,
        byteLength: bytes.byteLength,
        mediaType: 'application/json',
      }),
    ).rejects.toThrow('ARTIFACT_STORE_METADATA_READ_FAILED:fetch failed');
    expect(scoped.getFileMetadata).toHaveBeenCalledTimes(1);
  });

  it('does not retry a downloaded metadata identity mismatch', async () => {
    const bytes = new TextEncoder().encode('{"package":true}\n');
    const digest = sha256Raw(bytes);
    const path = `unified-parsed-packages/sha256/${digest}.json`;
    const scoped = {
      getFileMetadata: jest.fn().mockResolvedValue({
        id: 'semantic-mismatch-file',
        bucketID: 'bucket-semantic-mismatch-test',
        filePath: `/${path}`,
        metadata: {
          contentLength: String(bytes.byteLength),
          mimeType: 'application/json',
        },
      }),
      download: jest.fn().mockResolvedValue({
        content: bytes,
        metadata: { id: 'different-file' },
      }),
    };
    const adapter = new MiaodaOrdinaryArtifactStoreAdapter({
      getDefaultBucket: async () => 'bucket-semantic-mismatch-test',
      from: () => scoped,
    } as never);

    await expect(
      adapter.readActualBytes({
        storeRole: 'UnifiedArtifactStoreCandidate',
        ref: `artifact://UnifiedArtifactStoreCandidate/unified-parsed-packages/sha256/${digest}`,
        sha256: digest,
        byteLength: bytes.byteLength,
        mediaType: 'application/json',
      }),
    ).rejects.toThrow('ARTIFACT_READBACK_MISMATCH:BYTES');
    expect(scoped.getFileMetadata).toHaveBeenCalledTimes(1);
    expect(scoped.download).toHaveBeenCalledTimes(1);
  });

  it('fails closed after one transport retry without a third request', async () => {
    const bytes = new TextEncoder().encode('{"package":true}\n');
    const digest = sha256Raw(bytes);
    const path = `unified-parsed-packages/sha256/${digest}.json`;
    const first = new TypeError('fetch failed');
    const second = new TypeError('fetch failed');
    const scoped = {
      getFileMetadata: jest.fn().mockResolvedValue({
        id: 'download-fail-file',
        bucketID: 'bucket-download-fail-test',
        filePath: `/${path}`,
        metadata: {
          contentLength: String(bytes.byteLength),
          mimeType: 'application/json',
        },
      }),
      download: jest
        .fn()
        .mockRejectedValueOnce(first)
        .mockRejectedValueOnce(second),
    };
    const adapter = new MiaodaOrdinaryArtifactStoreAdapter({
      getDefaultBucket: async () => 'bucket-download-fail-test',
      from: () => scoped,
    } as never);

    await expect(
      adapter.readActualBytes({
        storeRole: 'UnifiedArtifactStoreCandidate',
        ref: `artifact://UnifiedArtifactStoreCandidate/unified-parsed-packages/sha256/${digest}`,
        sha256: digest,
        byteLength: bytes.byteLength,
        mediaType: 'application/json',
      }),
    ).rejects.toThrow('ARTIFACT_STORE_DOWNLOAD_FAILED:fetch failed');
    expect(scoped.download).toHaveBeenCalledTimes(2);
  });

  it('rejects a digest path containing different actual bytes', async () => {
    const scoped = new LocalScopedFileService('bucket-local');
    const fileService = {
      getDefaultBucket: async () => 'bucket-local',
      from: () => scoped,
    };
    const adapter = new MiaodaOrdinaryArtifactStoreAdapter(
      fileService as never,
    );
    const expected = new TextEncoder().encode('{"package":true}\n');
    const digest = sha256Raw(expected);
    const path = `unified-parsed-packages/sha256/${digest}.json`;
    scoped.files.set(path, {
      id: 'wrong-existing-file',
      bytes: new Uint8Array(expected.byteLength),
      mimeType: 'application/json',
    });

    await expect(adapter.persistAndReadback(expected)).rejects.toThrow(
      'ARTIFACT_READBACK_MISMATCH:BYTES',
    );
    expect(scoped.uploadCount).toBe(0);
    expect(scoped.downloadCount).toBe(1);
  });

  it('preserves the default-bucket provider failure stage and cause', async () => {
    const providerCause = new TypeError('fetch failed');
    const fileService = {
      getDefaultBucket: async () => {
        throw providerCause;
      },
      from: jest.fn(),
    };
    const adapter = new MiaodaOrdinaryArtifactStoreAdapter(
      fileService as never,
    );
    const bytes = new TextEncoder().encode('{"package":true}\n');
    const artifact = {
      storeRole: 'UnifiedArtifactStoreCandidate' as const,
      ref:
        'artifact://UnifiedArtifactStoreCandidate/' +
        `unified-parsed-packages/sha256/${sha256Raw(bytes)}`,
      sha256: sha256Raw(bytes),
      byteLength: bytes.byteLength,
      mediaType: 'application/json' as const,
    };

    let caught: unknown;
    try {
      await adapter.readActualBytes(artifact);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      'ARTIFACT_STORE_DEFAULT_BUCKET_READ_FAILED:fetch failed',
    );
    expect((caught as Error & { cause?: unknown }).cause).toBe(providerCause);
    expect(fileService.from).not.toHaveBeenCalled();
  });

  it('shares one concurrent default-bucket read without retrying it', async () => {
    const bytes = new TextEncoder().encode('{"package":true}\n');
    const digest = sha256Raw(bytes);
    const path = `unified-parsed-packages/sha256/${digest}.json`;
    const scoped = new LocalScopedFileService('bucket-concurrent-test');
    scoped.files.set(path, {
      id: 'concurrent-file-1',
      bytes,
      mimeType: 'application/json',
    });
    let releaseBucket!: (bucketId: string) => void;
    const bucketReady = new Promise<string>((resolve) => {
      releaseBucket = resolve;
    });
    const getDefaultBucket = jest.fn(() => bucketReady);
    const fileService = {
      getDefaultBucket,
      from: () => scoped,
    };
    const adapter = new MiaodaOrdinaryArtifactStoreAdapter(
      fileService as never,
    );
    const artifact = {
      storeRole: 'UnifiedArtifactStoreCandidate' as const,
      ref:
        'artifact://UnifiedArtifactStoreCandidate/' +
        `unified-parsed-packages/sha256/${digest}`,
      sha256: digest,
      byteLength: bytes.byteLength,
      mediaType: 'application/json' as const,
    };

    const first = adapter.readActualBytes(artifact);
    const second = adapter.readActualBytes(artifact);
    expect(getDefaultBucket).toHaveBeenCalledTimes(1);
    releaseBucket('bucket-concurrent-test');

    await expect(Promise.all([first, second])).resolves.toEqual([bytes, bytes]);
    expect(getDefaultBucket).toHaveBeenCalledTimes(1);
  });
});
