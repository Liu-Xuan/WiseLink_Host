import { MiaodaOrdinaryArtifactStoreAdapter } from '../../server/modules/unified-reader/miaoda-ordinary-artifact-store.adapter';
import { sha256Raw } from '../../server/modules/unified-reader/unified-reader.utils';
import { InMemoryArtifactLocator } from '../support/in-memory-artifact-locator';

function createAdapter(
  fileService: ConstructorParameters<
    typeof MiaodaOrdinaryArtifactStoreAdapter
  >[0],
  locators = new InMemoryArtifactLocator(),
) {
  return new MiaodaOrdinaryArtifactStoreAdapter(fileService, locators);
}

interface StoredFile {
  id: string;
  bytes: Uint8Array;
  mimeType: string;
}

class LocalScopedFileService {
  readonly files = new Map<string, StoredFile>();
  uploadCount = 0;
  downloadCount = 0;
  removeCount = 0;

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
    return this.getFileMetadata(options.filePath);
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

  async remove(filePaths: string[]) {
    this.removeCount += 1;
    for (const filePath of filePaths) this.files.delete(filePath);
  }
}

describe('MiaodaOrdinaryArtifactStoreAdapter', () => {
  it('retries a pre-upload metadata transport read once without repeating the upload', async () => {
    const scoped = new LocalScopedFileService('bucket-preflight');
    jest
      .spyOn(scoped, 'getFileMetadata')
      .mockRejectedValueOnce(new TypeError('fetch failed'));
    const adapter = createAdapter({
      getDefaultBucket: async () => 'bucket-preflight',
      from: () => scoped,
    } as never);
    const bytes = new TextEncoder().encode('{"new":true}');
    await expect(adapter.persistAndReadback(bytes)).resolves.toMatchObject({
      bytes,
      reused: false,
    });
    expect(scoped.uploadCount).toBe(1);
  });

  it('registers SDK positions and reads the original object after a default-bucket change and process restart', async () => {
    const original = new LocalScopedFileService('bucket-original');
    const other = new LocalScopedFileService('bucket-other');
    const registry = new InMemoryArtifactLocator();
    const bytes = new TextEncoder().encode('{"registered":true}');
    const first = createAdapter(
      {
        getDefaultBucket: async () => 'bucket-original',
        from: () => original,
      } as never,
      registry,
    );
    const saved = await first.persistAndReadback(bytes);
    expect(registry.rows.get(saved.artifact.ref)).toEqual({
      artifactRef: saved.artifact.ref,
      sha256: saved.artifact.sha256,
      byteLength: bytes.byteLength,
      mediaType: 'application/json',
      bucketId: 'bucket-original',
      filePath: `unified-parsed-packages/sha256/${saved.artifact.sha256}.json`,
      providerObjectId: 'file-1',
    });
    const defaultLookup = jest.fn(async () => 'bucket-other');
    const from = jest.fn((bucket: string) =>
      bucket === 'bucket-original' ? original : other,
    );
    const restarted = createAdapter(
      { getDefaultBucket: defaultLookup, from } as never,
      registry,
    );
    await expect(restarted.readActualBytes(saved.artifact)).resolves.toEqual(
      bytes,
    );
    expect(defaultLookup).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledWith('bucket-original');
    expect(other.downloadCount).toBe(0);
  });

  it('never replaces a missing registered object or accepts an object-id change at the same path', async () => {
    const scoped = new LocalScopedFileService('bucket-registered');
    const registry = new InMemoryArtifactLocator();
    const adapter = createAdapter(
      {
        getDefaultBucket: async () => 'bucket-registered',
        from: () => scoped,
      } as never,
      registry,
    );
    const bytes = new TextEncoder().encode('{"immutable":true}');
    const saved = await adapter.persistAndReadback(bytes);
    const path = registry.rows.get(saved.artifact.ref)!.filePath;
    scoped.files.get(path)!.id = 'replacement-object';
    await expect(adapter.readActualBytes(saved.artifact)).rejects.toThrow(
      'ARTIFACT_READBACK_MISMATCH:METADATA:OBJECT_ID',
    );
    scoped.files.delete(path);
    await expect(adapter.persistAndReadback(bytes)).rejects.toThrow(
      'ARTIFACT_READBACK_MISMATCH:METADATA:NOT_FOUND_OR_INACCESSIBLE',
    );
    expect(scoped.uploadCount).toBe(1);
  });

  it('does not backfill historical refs on read and does not fall back when the registry query fails', async () => {
    const bytes = new TextEncoder().encode('{"historical":true}');
    const digest = sha256Raw(bytes);
    const path = `unified-parsed-packages/sha256/${digest}.json`;
    const scoped = new LocalScopedFileService('bucket-legacy');
    scoped.files.set(path, {
      id: 'legacy-object',
      bytes,
      mimeType: 'application/json',
    });
    const registry = new InMemoryArtifactLocator();
    const defaults = jest.fn(async () => 'bucket-legacy');
    const adapter = createAdapter(
      { getDefaultBucket: defaults, from: () => scoped } as never,
      registry,
    );
    const artifact = {
      storeRole: 'UnifiedArtifactStoreCandidate' as const,
      ref: `artifact://UnifiedArtifactStoreCandidate/unified-parsed-packages/sha256/${digest}`,
      sha256: digest,
      byteLength: bytes.byteLength,
      mediaType: 'application/json' as const,
    };
    await expect(adapter.readActualBytes(artifact)).resolves.toEqual(bytes);
    expect(registry.rows.size).toBe(0);
    defaults.mockClear();
    jest
      .spyOn(registry, 'find')
      .mockRejectedValueOnce(new Error('DATABASE_UNAVAILABLE'));
    await expect(adapter.readActualBytes(artifact)).rejects.toThrow(
      'DATABASE_UNAVAILABLE',
    );
    expect(defaults).not.toHaveBeenCalled();
    expect(scoped.downloadCount).toBe(1);
  });

  it('persists once, reads stream bytes, and reuses exact content', async () => {
    const scoped = new LocalScopedFileService('bucket-local');
    const fileService = {
      getDefaultBucket: async () => 'bucket-local',
      from: () => scoped,
    };
    const adapter = createAdapter(fileService as never);
    const bytes = new TextEncoder().encode('{"package":true}\n');

    const first = await adapter.persistAndReadback(bytes);
    const second = await adapter.persistAndReadback(bytes);

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.artifact.sha256).toBe(sha256Raw(bytes));
    expect(second.bytes).toEqual(bytes);
    expect(scoped.uploadCount).toBe(1);
  });

  it('replays an identical attempt-owned result part without uploading twice and rejects conflicting bytes', async () => {
    const scoped = new LocalScopedFileService('bucket-result-parts');
    const adapter = createAdapter({
      getDefaultBucket: async () => 'bucket-result-parts',
      from: () => scoped,
    } as never);
    const ownerRef = 'openclaw-translation-result-v1:ATT-1:TRN-1:1:hash:12';
    const bytes = new TextEncoder().encode('{"part":0}');

    const first = await adapter.stageResultEnvelopePartAndReadback({
      ownerRef,
      partIndex: 0,
      bytes,
    });
    const replay = await adapter.stageResultEnvelopePartAndReadback({
      ownerRef,
      partIndex: 0,
      bytes,
    });

    expect(first.reused).toBe(false);
    expect(replay).toEqual({ ...first, reused: true });
    expect(scoped.uploadCount).toBe(1);
    await expect(
      adapter.stageResultEnvelopePartAndReadback({
        ownerRef,
        partIndex: 0,
        bytes: new TextEncoder().encode('{"part":"conflict"}'),
      }),
    ).rejects.toThrow('ARTIFACT_LOCATOR_BINDING_MISMATCH');
    expect(scoped.uploadCount).toBe(1);
  });

  it('finalizes an attempt-owned stable descriptor before publication and discards with verified absence', async () => {
    const scoped = new LocalScopedFileService('bucket-stage-local');
    const adapter = createAdapter({
      getDefaultBucket: async () => 'bucket-stage-local',
      from: () => scoped,
    } as never);
    const bytes = new TextEncoder().encode('{"candidate":true}\n');

    const staged = await adapter.stageCandidateAndReadback({
      bytes,
      ownerRef: 'ATT-APP-STAGE-1',
    });
    expect(staged.artifact.ref).toMatch(
      /\/applicability-candidate\/[0-9a-f]{64}\/[0-9a-f]{64}$/u,
    );
    expect(scoped.files.size).toBe(1);
    const finalized = await adapter.finalizeStagedCandidate(staged);
    expect(finalized).toMatchObject({
      schemaVersion: 'wiselink.3_1.finalized_candidate_artifact.v1',
      artifact: staged.artifact,
      bytes,
    });

    await adapter.discardCandidateArtifact(finalized);
    expect(scoped.removeCount).toBe(1);
    expect(scoped.files.size).toBe(0);
    await expect(adapter.readActualBytes(staged.artifact)).rejects.toThrow(
      'ARTIFACT_READBACK_MISMATCH:METADATA:NOT_FOUND_OR_INACCESSIBLE',
    );
  });

  it.each([
    'NOT_FOUND_OR_INACCESSIBLE',
    'BUCKET',
    'PATH',
    'LENGTH',
    'MEDIA_TYPE',
  ])(
    'reports metadata %s without starting a download',
    async (reason: string) => {
      const bytes: Uint8Array = new TextEncoder().encode('{"package":true}\n');
      const digest: string = sha256Raw(bytes);
      const path: string = `unified-parsed-packages/sha256/${digest}.json`;
      const bucketId: string = 'bucket-metadata-reasons';
      const metadata: Awaited<
        ReturnType<LocalScopedFileService['getFileMetadata']>
      > =
        reason === 'NOT_FOUND_OR_INACCESSIBLE'
          ? null
          : {
              id: 'metadata-reasons-file',
              bucketID: reason === 'BUCKET' ? 'another-bucket' : bucketId,
              filePath: reason === 'PATH' ? `/${path}.other` : `/${path}`,
              metadata: {
                contentLength: String(
                  bytes.byteLength + (reason === 'LENGTH' ? 1 : 0),
                ),
                mimeType:
                  reason === 'MEDIA_TYPE' ? 'text/plain' : 'application/json',
              },
            };
      const scoped: { getFileMetadata: jest.Mock; download: jest.Mock } = {
        getFileMetadata: jest.fn().mockResolvedValue(metadata),
        download: jest.fn(),
      };
      const adapter: MiaodaOrdinaryArtifactStoreAdapter = createAdapter({
        getDefaultBucket: async () => bucketId,
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
      ).rejects.toThrow(`ARTIFACT_READBACK_MISMATCH:METADATA:${reason}`);
      expect(scoped.getFileMetadata).toHaveBeenCalledTimes(1);
      expect(scoped.download).not.toHaveBeenCalled();
    },
  );

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
      upload: jest.fn(
        async (_bytes: Uint8Array, options: { filePath: string }) => ({
          id: 'hosted-file-1',
          bucketID: 'bucket-hosted-test',
          filePath: options.filePath,
          metadata: {
            contentLength: String(bytes.byteLength),
            mimeType: 'application/json',
          },
        }),
      ),
      download: jest.fn(async () => ({
        content: bytes,
        metadata: { id: 'hosted-file-1' },
      })),
    };
    const fileService = {
      getDefaultBucket: async () => 'bucket-hosted-test',
      from: () => scoped,
    };
    const adapter = createAdapter(fileService as never);

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
    const adapter = createAdapter({
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
    const adapter = createAdapter({
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
    const adapter = createAdapter({
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
    const adapter = createAdapter({
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
    const adapter = createAdapter({
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

  it('fails closed after bounded transport retries without a fourth request', async () => {
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
        .mockRejectedValue(second),
    };
    const adapter = createAdapter({
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
    expect(scoped.download).toHaveBeenCalledTimes(3);
  });

  it('rejects a digest path containing different actual bytes', async () => {
    const scoped = new LocalScopedFileService('bucket-local');
    const fileService = {
      getDefaultBucket: async () => 'bucket-local',
      from: () => scoped,
    };
    const adapter = createAdapter(fileService as never);
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
    const adapter = createAdapter(fileService as never);
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
    const adapter = createAdapter(fileService as never);
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
    await Promise.resolve();
    expect(getDefaultBucket).toHaveBeenCalledTimes(1);
    releaseBucket('bucket-concurrent-test');

    await expect(Promise.all([first, second])).resolves.toEqual([bytes, bytes]);
    expect(getDefaultBucket).toHaveBeenCalledTimes(1);
  });
});
