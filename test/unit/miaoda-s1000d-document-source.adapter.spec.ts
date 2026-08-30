import { createHash } from 'node:crypto';

import { MiaodaS1000dDocumentSourceAdapter } from '../../server/modules/s1000d-ingress/miaoda-s1000d-document-source.adapter';

describe('Miaoda S1000D DocumentVersion source adapter', () => {
  it('fresh-reads the existing DM resolver and exact FileService XML bytes', async () => {
    const bytes = Buffer.from('<dmodule><content/></dmodule>', 'utf8');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const metadata = {
      bucketID: 'canonical-bucket',
      filePath: '/document-management/source/example.xml',
      id: 'provider-object-1',
      updatedAt: '2026-08-30T00:00:00Z',
      name: 'DMC-EXAMPLE.XML',
      metadata: {
        mimeType: 'application/xml; charset=UTF-8',
        contentLength: bytes.byteLength,
      },
    };
    const scoped = {
      getFileMetadata: jest.fn(async () => metadata),
      download: jest.fn(() => ({
        asStream: async () => ({ metadata, content: Buffer.from(bytes) }),
      })),
    };
    const fileService = {
      from: jest.fn(() => scoped),
    };
    const resolver = {
      resolve: jest.fn(async () => ({
        version: {
          documentId: 'document-1',
          documentVersionId: 'document-version-1',
          originalFilename: 'DMC-EXAMPLE.XML',
          mediaType: 'application/xml',
        },
        artifact: {
          sourceArtifactId: 'source-artifact-1',
          mediaType: 'application/xml',
          sha256,
          byteLength: bytes.byteLength,
          providerObjectId: 'provider-object-1',
          bucketId: 'canonical-bucket',
          filePath: '/document-management/source/example.xml',
        },
      })),
    };
    const adapter = new MiaodaS1000dDocumentSourceAdapter(
      fileService as never,
      resolver as never,
    );

    const source = await adapter.resolveCurrent('document-version-1');
    const readback = await adapter.readActualBytes(source);

    expect(resolver.resolve).toHaveBeenCalledWith('document-version-1', {
      requireCurrent: true,
    });
    expect(source).toMatchObject({
      documentVersionId: 'document-version-1',
      sourceArtifactId: 'source-artifact-1',
      mediaType: 'application/xml',
      sha256,
      byteLength: bytes.byteLength,
    });
    expect(Buffer.from(readback).equals(bytes)).toBe(true);
    expect(fileService.from).toHaveBeenCalledWith('canonical-bucket');
  });

  it('does not reinterpret a PDF DocumentVersion as S1000D', async () => {
    const adapter = new MiaodaS1000dDocumentSourceAdapter(
      { from: jest.fn() } as never,
      {
        resolve: async () => ({
          version: {
            documentId: 'document-1',
            documentVersionId: 'document-version-1',
            originalFilename: 'manual.pdf',
            mediaType: 'application/pdf',
          },
          artifact: { mediaType: 'application/pdf' },
        }),
      } as never,
    );

    await expect(
      adapter.resolveCurrent('document-version-1'),
    ).rejects.toMatchObject({
      code: 'S1000D_DOCUMENT_VERSION_MEDIA_TYPE_UNSUPPORTED',
      statusCode: 409,
    });
  });
});
