import { createHash } from 'node:crypto';
import { MiaodaTdmsArtifactStore } from '../../../server/modules/tdms-source/miaoda-tdms-artifact-store';
import { nativeScope } from './tdms-memory-double';
import { actor } from './tdms-fixtures';
import { deterministicId } from '../../../server/modules/document-management/src/runtime/valueTools.js';

function setup(options: { corrupt?: boolean; linked?: boolean } = {}) {
  const objects = new Map<string, { metadata: any; bytes: Buffer }>();
  const uploads: any[] = [];
  const catalog = {
    readSourceArtifactByContent: jest.fn(async () => null),
    recordAcquisition: jest.fn(async (input) => ({
      ...input.acquisition,
      documentVersionId: options.linked ? 'DV-illegal' : null,
      status: options.linked
        ? 'LINKED_EXACT_DOCUMENT_VERSION'
        : 'ACQUIRED_READBACK_VERIFIED',
    })),
  };
  const bucket = 'bucket';
  const fileService = {
    getDefaultBucket: jest.fn(async () => bucket),
    from: jest.fn(() => ({
      getFileMetadata: jest.fn(
        async (path) => objects.get(path.replace(/^\//u, ''))?.metadata ?? null,
      ),
      upload: jest.fn(async (bytes, opts) => {
        uploads.push(opts);
        const metadata = {
          bucketID: bucket,
          filePath: opts.filePath,
          id: 'immutable-object',
          name: opts.fileName,
          metadata: { mimeType: opts.contentType, contentLength: bytes.length },
        };
        objects.set(opts.filePath, { metadata, bytes: Buffer.from(bytes) });
        return metadata;
      }),
      download: jest.fn((path) => ({
        asStream: async () => {
          const o = objects.get(path.replace(/^\//u, ''))!;
          return {
            metadata: o.metadata,
            content: options.corrupt ? Buffer.from('corrupt') : o.bytes,
          };
        },
      })),
    })),
  };
  const bytes = Buffer.from('EB raw attachment, NOT a PDF');
  const artifact = {
    memberId: 'member',
    sourceAttachmentId: 'attachment',
    sourceAttachmentVersion: 'declared-rev',
    fileName: 'original.eb',
    mediaType: 'application/octet-stream',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.length,
    bytesBase64: bytes.toString('base64'),
  };
  return {
    store: new MiaodaTdmsArtifactStore(fileService as any, catalog as any),
    fileService,
    catalog,
    artifact,
    uploads,
    objects,
  };
}
describe('actual candidate adapter against FileService and catalog doubles', () => {
  it('shares the ordinary canonical PDF identity without conferring a formal document version', async () => {
    const s = setup();
    const bytes = Buffer.from('%PDF-1.7\nsynthetic retained byte identity\n%%EOF');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    Object.assign(s.artifact, { fileName: 'publication.pdf', mediaType: 'application/pdf',
      sha256, byteLength: bytes.length, bytesBase64: bytes.toString('base64') });
    const result = await s.store.acquire({ scope: nativeScope, actor: actor(), packageId: 'p', artifact: s.artifact });
    expect(s.uploads).toHaveLength(1);
    expect(s.uploads[0].filePath).toBe(`document-management/source/sha256/${sha256.slice(0, 2)}/${sha256}.pdf`);
    expect(result.sourceArtifactId).toBe(deterministicId('source_artifact', sha256, bytes.length));
    expect(result.documentVersionId).toBeNull();
    expect(s.catalog.recordAcquisition.mock.calls[0][0].acquisition.sourceDescriptor.candidateOnly).toBe(true);
  });

  it('does not label non-PDF bytes as canonical PDF merely because the declared MIME says PDF', async () => {
    const s = setup();
    s.artifact.mediaType = 'application/pdf';
    s.artifact.fileName = 'claimed.pdf';
    await expect(s.store.acquire({ scope: nativeScope, actor: actor(), packageId: 'p', artifact: s.artifact }))
      .rejects.toMatchObject({ code: 'TDMS_PDF_ARTIFACT_FORMAT_INVALID', statusCode: 422 });
    expect(s.uploads).toHaveLength(0);
    expect(s.catalog.recordAcquisition).not.toHaveBeenCalled();
  });

  it('stores arbitrary bytes once with a controlled non-PDF immutable path and readback', async () => {
    const s = setup();
    const result = await s.store.acquire({
      scope: nativeScope,
      actor: actor(),
      packageId: 'p',
      artifact: s.artifact,
    });
    expect(s.uploads).toHaveLength(1);
    expect(s.uploads[0]).toMatchObject({
      upsert: false,
      contentType: 'application/octet-stream',
    });
    expect(s.uploads[0].filePath).toMatch(
      /^tdms-source\/candidate\/sha256\/.+\.bin$/u,
    );
    expect(s.uploads[0].filePath).not.toMatch(/\.pdf$/u);
    expect(result).toMatchObject({
      documentVersionId: null,
      immutableReadbackVerified: true,
      registrationGap:
        'FORMAL_REGISTRATION_REQUIRES_INDEPENDENT_RETENTION_AUTHORITY',
    });
    expect(s.catalog.recordAcquisition).toHaveBeenCalledWith(
      expect.objectContaining({
        acquisition: expect.objectContaining({
          sourceChannel: 'wiselink_tdms_candidate',
          acquiredBy: '123',
          sourceDescriptor: expect.objectContaining({
            ...nativeScope,
            candidateOnly: true,
          }),
        }),
      }),
    );
  });
  it('reuses existing exact bytes but preserves per-package acquisition lineage', async () => {
    const s = setup();
    const a = await s.store.acquire({
      scope: nativeScope,
      actor: actor(),
      packageId: 'p',
      artifact: s.artifact,
    });
    const b = await s.store.acquire({
      scope: nativeScope,
      actor: actor(),
      packageId: 'q',
      artifact: s.artifact,
    });
    expect(s.uploads).toHaveLength(1);
    expect(a.sourceArtifactId).toBe(b.sourceArtifactId);
    expect(a.acquisitionId).not.toBe(b.acquisitionId);
    expect(s.catalog.recordAcquisition).toHaveBeenCalledTimes(2);
  });
  it('rejects actual readback drift before catalog acquisition', async () => {
    const s = setup({ corrupt: true });
    await expect(
      s.store.acquire({
        scope: nativeScope,
        actor: actor(),
        packageId: 'p',
        artifact: s.artifact,
      }),
    ).rejects.toBeDefined();
    expect(s.catalog.recordAcquisition).not.toHaveBeenCalled();
  });
  it('rejects catalog return already promoted to ordinary DV', async () => {
    const s = setup({ linked: true });
    await expect(
      s.store.acquire({
        scope: nativeScope,
        actor: actor(),
        packageId: 'p',
        artifact: s.artifact,
      }),
    ).rejects.toMatchObject({ code: 'TDMS_CANDIDATE_PROMOTION_FORBIDDEN' });
  });
});
