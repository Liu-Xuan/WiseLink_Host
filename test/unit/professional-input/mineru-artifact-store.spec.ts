import { createHash } from 'node:crypto';
import type { FileService } from '@lark-apaas/fullstack-nestjs-core';
import type { FileMeta, UploadOptions } from '@lark-apaas/file-service';
import {
  MineruArtifactStore,
  MineruPersistenceError,
  type MineruParseResult,
} from '../../../server/modules/professional-input/mineru/mineru-artifact-store';
import { readMineruArtifacts } from '../../../server/modules/professional-input/mineru/mineru-artifacts';

const scope = {
  documentVersionId: 'documentVersion_test',
  parseRunId: 'parseRun_test',
  bucketId: 'bucket-original',
};
const documentVersion = {
  documentVersionId: scope.documentVersionId,
  documentId: 'document_test',
  familyId: 'family_test',
  sourceArtifactId: 'source_test',
  pdfSha256: 'a'.repeat(64),
  byteLength: 500,
};
function fixture(): MineruParseResult {
  const markdown =
    '# Scope\n\nKeep the exception.\n\n![Diagram](images/one.png)';
  const middle = {
    _version_name: '3.4.5',
    _backend: 'pipeline',
    pdf_info: [{ page_idx: 0, page_size: [1000, 1000] }],
  };
  const contentListV2 = [
    [
      {
        type: 'paragraph',
        bbox: [10, 10, 100, 100],
        content: {
          paragraph_content: [{ type: 'text', content: 'Keep the exception.' }],
        },
      },
    ],
  ];
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return {
    sourceSha256: 'a'.repeat(64),
    sourceByteLength: 500,
    rawArtifacts: { markdown, middle, contentListV2 },
    middle,
    contentListV2,
    document: readMineruArtifacts({
      markdown,
      middle,
      contentListV2,
      assetPaths: ['images/one.png'],
    }),
    assets: [
      {
        path: 'images/one.png',
        mediaType: 'image/png',
        bytes,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    ],
    titleEnhancement: { status: 'DISABLED' },
  };
}
function provider() {
  const objects = new Map<string, { metadata: FileMeta; bytes: Uint8Array }>();
  const failures = { readPath: '', denied: false, uncertainUpload: false };
  const key = (bucket: string, path: string) => `${bucket}/${path}`;
  const upload = jest.fn(
    async (bucket: string, bytes: Uint8Array, options: UploadOptions) => {
      const path = options.filePath!;
      if (options.upsert !== false || objects.has(key(bucket, path)))
        throw new Error('OVERWRITE');
      const metadata = {
        id: `file-${objects.size + 1}`,
        name: options.fileName!,
        filePath: path,
        metadata: {
          contentLength: String(bytes.length),
          mimeType: options.contentType!,
        },
        bucketID: bucket,
      } as FileMeta;
      objects.set(key(bucket, path), {
        metadata,
        bytes: Uint8Array.from(bytes),
      });
      if (failures.uncertainUpload) throw new Error('WRITE_RESPONSE_LOST');
      return { ...metadata };
    },
  );
  const download = jest.fn(async (bucket: string, path: string) => {
    if (path.endsWith(failures.readPath) && failures.readPath)
      throw new Error('READ_FAILED');
    const stored = objects.get(key(bucket, path));
    if (!stored) throw new Error('NOT_FOUND');
    return {
      metadata: stored.metadata,
      content: new Blob([Buffer.from(stored.bytes)]),
    };
  });
  const getFileMetadata = jest.fn(async (bucket: string, path: string) => {
    if (failures.denied)
      throw Object.assign(new Error('FORBIDDEN'), { status: 403 });
    return objects.get(key(bucket, path))?.metadata ?? null;
  });
  const files = {
    from: (bucket: string) => ({
      upload: (bytes: Uint8Array, options: UploadOptions) =>
        upload(bucket, bytes, options),
      download: (path: string) => download(bucket, path),
      getFileMetadata: (path: string) => getFileMetadata(bucket, path),
    }),
  } as unknown as Pick<FileService, 'from'>;
  return {
    objects,
    failures,
    upload,
    download,
    getFileMetadata,
    store: new MineruArtifactStore(files),
  };
}

describe('MinerU FileService persistence (isolated provider)', () => {
  it('persists raw/reading/images and writes the manifest last, with verified descriptors and reusable reads', async () => {
    const p = provider();
    const result = fixture();
    const before = JSON.stringify(result);
    const events: string[] = [];
    const saved = await p.store.persist({
      scope,
      documentVersion,
      result,
      onProgress: async (a) => {
        events.push(`${a.role}:${a.readback}`);
      },
    });
    expect(saved.manifest.artifacts).toHaveLength(7);
    expect(
      saved.manifest.artifacts.every((a) => a.readback === 'VERIFIED'),
    ).toBe(true);
    expect(events.at(-1)).toBe('MANIFEST:VERIFIED');
    expect(saved.manifestArtifact.providerObjectId).toBe('file-8');
    const image = saved.manifest.images['images/one.png'];
    expect(Buffer.from(await p.store.read(scope, image))).toEqual(
      Buffer.from(result.assets[0].bytes),
    );
    expect(
      JSON.parse(
        Buffer.from(
          await p.store.read(scope, saved.manifestArtifact),
        ).toString(),
      ),
    ).toEqual(saved.manifest);
    const reused = await p.store.persist({ scope, documentVersion, result });
    expect(p.upload).toHaveBeenCalledTimes(8);
    expect(reused).toEqual(saved);
    expect(JSON.stringify(result)).toBe(before);
  });
  it('loads reading from stored files with the same DM version and no parser or local directory', async () => {
    const p = provider();
    const result = fixture();
    const saved = await p.store.persist({ scope, documentVersion, result });
    const loaded = await p.store.loadReading({
      scope,
      documentVersion,
      manifestArtifact: saved.manifestArtifact,
    });
    expect(loaded.document.markdown).toBe(result.document.markdown);
    expect(loaded.images['images/one.png']).toEqual(
      saved.manifest.images['images/one.png'],
    );
    await expect(
      p.store.loadReading({
        scope,
        documentVersion: {
          ...documentVersion,
          sourceArtifactId: 'other_source',
        },
        manifestArtifact: saved.manifestArtifact,
      }),
    ).rejects.toThrow('MANIFEST_SOURCE_MISMATCH');
    expect(p.upload).toHaveBeenCalledTimes(8);
  });
  it('retains uploaded identities on readback failure and resumes without reuploading completed objects', async () => {
    const p = provider();
    p.failures.readPath = 'reading/document.md';
    const error = await p.store
      .persist({ scope, documentVersion, result: fixture() })
      .catch((error) => error);
    expect(error).toBeInstanceOf(MineruPersistenceError);
    expect(error.progress).toHaveLength(4);
    expect(error.progress[3].readback).toBe('UPLOADED');
    expect(error.progress[3].providerObjectId).toBe('file-4');
    expect(p.upload).toHaveBeenCalledTimes(4);
    expect(
      [...p.objects.keys()].some((path) => path.endsWith('manifest.json')),
    ).toBe(false);
    p.failures.readPath = '';
    await p.store.persist({ scope, documentVersion, result: fixture() });
    expect(p.upload).toHaveBeenCalledTimes(8);
  });
  it('records the exact unresolved upload path and reconciles it without blindly retrying the write', async () => {
    const p = provider();
    p.failures.uncertainUpload = true;
    const error = await p.store
      .persist({ scope, documentVersion, result: fixture() })
      .catch((error) => error);
    expect(error.progress).toEqual([]);
    expect(error.pendingObject).toEqual({
      bucketId: scope.bucketId,
      filePath: `wiselink/parsed/${scope.documentVersionId}/${scope.parseRunId}/raw/document.md`,
    });
    expect(p.upload).toHaveBeenCalledTimes(1);
    p.failures.uncertainUpload = false;
    await p.store.persist({ scope, documentVersion, result: fixture() });
    expect(p.upload).toHaveBeenCalledTimes(8);
  });
  it('rejects corruption, cross-document/bucket descriptors and authorization failures without replacing objects', async () => {
    const p = provider();
    const saved = await p.store.persist({
      scope,
      documentVersion,
      result: fixture(),
    });
    const descriptor = saved.manifest.images['images/one.png'];
    await expect(
      p.store.read({ ...scope, documentVersionId: 'another' }, descriptor),
    ).rejects.toThrow('DESCRIPTOR_INVALID');
    await expect(
      p.store.read({ ...scope, bucketId: 'another' }, descriptor),
    ).rejects.toThrow('DESCRIPTOR_INVALID');
    const object = p.objects.get(`${scope.bucketId}/${descriptor.filePath}`)!;
    object.bytes[0] ^= 1;
    await expect(p.store.read(scope, descriptor)).rejects.toThrow(
      'DIGEST_MISMATCH',
    );
    await expect(
      p.store.persist({ scope, documentVersion, result: fixture() }),
    ).rejects.toBeInstanceOf(MineruPersistenceError);
    expect(p.upload).toHaveBeenCalledTimes(8);
    const denied = provider();
    denied.failures.denied = true;
    await expect(
      denied.store.persist({ scope, documentVersion, result: fixture() }),
    ).rejects.toBeInstanceOf(MineruPersistenceError);
    expect(denied.upload).not.toHaveBeenCalled();
  });
  it('binds derived files to the existing DM document version and rejects a different original before uploading', async () => {
    const p = provider();
    await expect(
      p.store.persist({
        scope,
        result: fixture(),
        documentVersion: { ...documentVersion, pdfSha256: 'b'.repeat(64) },
      }),
    ).rejects.toThrow('DOCUMENT_VERSION_BINDING_MISMATCH');
    await expect(
      p.store.persist({
        scope,
        result: fixture(),
        documentVersion: {
          ...documentVersion,
          documentVersionId: 'another_version',
        },
      }),
    ).rejects.toThrow('DOCUMENT_VERSION_BINDING_MISMATCH');
    expect(p.upload).not.toHaveBeenCalled();
    const saved = await p.store.persist({
      scope,
      documentVersion,
      result: fixture(),
    });
    expect(saved.manifest).toMatchObject({
      documentId: documentVersion.documentId,
      familyId: documentVersion.familyId,
      sourceArtifactId: documentVersion.sourceArtifactId,
      documentVersionId: scope.documentVersionId,
    });
  });
  it('stops when Host cannot record progress and exposes the uploaded object for recovery', async () => {
    const p = provider();
    const error = await p.store
      .persist({
        scope,
        documentVersion,
        result: fixture(),
        onProgress: async () => {
          throw new Error('DB_UNAVAILABLE');
        },
      })
      .catch((error) => error);
    expect(error.progress).toHaveLength(1);
    expect(error.progress[0].providerObjectId).toBe('file-1');
    expect(p.upload).toHaveBeenCalledTimes(1);
  });
});
