import { createHash } from 'node:crypto';
import { DocumentManagementHostedService } from '../../server/modules/document-management/src/hosted/nest/document-management-hosted.service';
import { MiaodaFileServiceArtifactStore } from '../../server/modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js';
import { PdfjsDistLayoutExtractor } from '../../server/modules/professional-input/parser/pdfjs-dist-layout-extractor.adapter';
import { MiaodaHostedDocumentCatalog } from '../../server/modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog';
import { extractActualPdfMetadata } from '../../server/modules/document-management/src/migrated/ingress/pdfDocumentMetadata.js';
import type { ParsedPdfLayout } from '../../server/modules/professional-input/pure/professional-input-pure.types';
import { dmDocumentVersionMetadata } from '@server/database/schema';

const bytes = Buffer.from('%PDF-1.7 fixture source bytes');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const context = {
  actorUserId: 'actor-1',
  tenantId: 'tenant-1',
  roles: ['authenticated'],
  appId: 'app_17bzc551rsg',
  env: 'preview',
};
const layout: ParsedPdfLayout = {
  kind: 'pdf',
  pdfVersion: '1.7',
  pageCount: 1,
  pageBoxes: [],
  metadata: { title: null },
  pageTextLayerDiagnostics: [],
  sourceSha256: `sha256:${sha256}`,
  sourceByteLength: bytes.length,
  textRuns: [
    {
      page: 1,
      text: 'BOEING SERVICE BULLETIN Subject: Wiring change',
      x: 0,
      y: 20,
      fontName: 'F1',
      fontSize: 12,
      bold: false,
    },
  ],
};
const metadata = extractActualPdfMetadata({
  layout,
  actualSha256: sha256,
  actualByteLength: bytes.length,
  identity: { documentFamily: 'SB', issuer: 'BOEING' },
});
const metadataRow = (
  metadataRevision = 1,
  requestId: string | null = null,
) => ({
  id: `metadata-${metadataRevision}`,
  metadataRevision,
  requestId,
  extractedMetadata: metadata,
});
const sourceRow = () => ({
  version: {
    documentVersionId: 'version-1',
    pdfSha256: sha256,
    byteLength: bytes.length,
    originalFilename: '原件.pdf',
  },
  family: { documentFamily: 'SB', issuerAuthority: 'BOEING' },
  source: {
    bucketId: 'bucket-1',
    filePath: 'immutable/source.pdf',
    sha256,
    byteLength: bytes.length,
    providerObjectId: 'object-1',
    providerVersionId: 'object-v1',
  },
  metadata: null as ReturnType<typeof metadataRow> | null,
});

function fixture() {
  const catalog = {
    readMetadataSource: jest.fn().mockResolvedValue(sourceRow()),
    readExtractedMetadata: jest.fn().mockResolvedValue(null),
    appendExtractedMetadata: jest
      .fn()
      .mockResolvedValue({
        disposition: 'APPENDED',
        metadata: metadataRow(2, 'request-1'),
      }),
    fillMissingExtractedMetadata: jest.fn().mockResolvedValue({
      disposition: 'ENRICHED',
      extractedMetadata: metadata,
    }),
  };
  const authorizer = {
    assertCanRead: jest.fn().mockResolvedValue(undefined),
    assertCanIngest: jest.fn(),
  };
  const read = jest
    .spyOn(MiaodaFileServiceArtifactStore.prototype, 'readSelection')
    .mockResolvedValue({
      ...sourceRow().source,
      bytes,
      readbackVerified: true,
      fileName: 'source.pdf',
      mediaType: 'application/pdf',
      providerUpdatedAt: null,
    });
  const parse = jest
    .spyOn(PdfjsDistLayoutExtractor.prototype, 'extractLayoutWithDiagnostics')
    .mockReturnValue(layout);
  const service = new DocumentManagementHostedService(
    { from: jest.fn() } as never,
    catalog as never,
    authorizer,
  );
  return { service, catalog, authorizer, read, parse };
}

describe('existing-version metadata enrichment', () => {
  const previousSandbox = process.env.SANDBOX_ID;
  const previousLocal = process.env.MIAODA_LOCAL_DEV;
  beforeEach(() => {
    process.env.SANDBOX_ID = 'unit-sandbox';
    delete process.env.MIAODA_LOCAL_DEV;
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (previousSandbox === undefined) delete process.env.SANDBOX_ID;
    else process.env.SANDBOX_ID = previousSandbox;
    if (previousLocal === undefined) delete process.env.MIAODA_LOCAL_DEV;
    else process.env.MIAODA_LOCAL_DEV = previousLocal;
  });

  it('uses only the registered immutable source and rechecks access before one enrichment insert', async () => {
    const f = fixture();
    await expect(
      f.service.enrichDocumentMetadata('version-1', context),
    ).resolves.toMatchObject({ disposition: 'ENRICHED' });
    expect(f.read).toHaveBeenCalledWith({
      bucketId: 'bucket-1',
      filePath: 'immutable/source.pdf',
    });
    expect(f.authorizer.assertCanRead).toHaveBeenCalledTimes(2);
    expect(f.catalog.fillMissingExtractedMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        documentVersionId: 'version-1',
        sourceSha256: sha256,
        sourceByteLength: bytes.length,
      }),
    );
  });
  it('reads the exact original for versions with no WorkItem and performs no parse or metadata write', async () => {
    const f = fixture();
    await expect(
      f.service.readDocumentOriginal('version-1', context),
    ).resolves.toEqual({ bytes, filename: '原件.pdf' });
    expect(f.authorizer.assertCanRead).toHaveBeenCalledTimes(2);
    expect(f.catalog.readMetadataSource).toHaveBeenCalledWith(
      'version-1',
      'tenant-1',
    );
    expect(f.parse).not.toHaveBeenCalled();
    expect(f.catalog.fillMissingExtractedMetadata).not.toHaveBeenCalled();
  });
  it('refuses an unauthorized original without touching storage', async () => {
    const f = fixture();
    f.authorizer.assertCanRead.mockRejectedValue(
      new Error('DOCUMENT_NOT_FOUND'),
    );
    await expect(
      f.service.readDocumentOriginal('version-1', context),
    ).rejects.toThrow('DOCUMENT_NOT_FOUND');
    expect(f.read).not.toHaveBeenCalled();
  });
  it('appends a correction from the same registered source and returns its revision receipt', async () => {
    const f = fixture();
    f.catalog.readMetadataSource.mockResolvedValue({
      ...sourceRow(),
      metadata: metadataRow(),
    });
    await expect(
      f.service.reextractDocumentMetadata(
        'version-1',
        { expectedMetadataRevision: 1, requestId: 'request-1' },
        context,
      ),
    ).resolves.toMatchObject({
      disposition: 'APPENDED',
      metadataRevision: 2,
      requestId: 'request-1',
    });
    expect(f.read).toHaveBeenCalledTimes(1);
    expect(f.authorizer.assertCanRead).toHaveBeenCalledTimes(2);
    expect(f.catalog.appendExtractedMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        documentVersionId: 'version-1',
        sourceSha256: sha256,
        expectedMetadataRevision: 1,
        requestId: 'request-1',
      }),
    );
    expect(f.catalog.fillMissingExtractedMetadata).not.toHaveBeenCalled();
  });
  it('returns a replay without reading unavailable original bytes and rejects reuse for another expected revision', async () => {
    const f = fixture();
    f.catalog.readMetadataSource.mockResolvedValue({
      ...sourceRow(),
      metadata: metadataRow(3, 'later'),
    });
    f.catalog.readExtractedMetadata.mockResolvedValue(
      metadataRow(2, 'request-1'),
    );
    await expect(
      f.service.reextractDocumentMetadata(
        'version-1',
        { expectedMetadataRevision: 1, requestId: 'request-1' },
        context,
      ),
    ).resolves.toMatchObject({
      disposition: 'IDEMPOTENT_REPLAY',
      metadataRevision: 2,
    });
    await expect(
      f.service.reextractDocumentMetadata(
        'version-1',
        { expectedMetadataRevision: 2, requestId: 'request-1' },
        context,
      ),
    ).rejects.toMatchObject({
      code: 'DOCUMENT_METADATA_REQUEST_CONFLICT',
      status: 409,
    });
    expect(f.read).not.toHaveBeenCalled();
    expect(f.catalog.appendExtractedMetadata).not.toHaveBeenCalled();
  });
  it('rejects a stale new request before reading the source', async () => {
    const f = fixture();
    f.catalog.readMetadataSource.mockResolvedValue({
      ...sourceRow(),
      metadata: metadataRow(2, 'earlier'),
    });
    await expect(
      f.service.reextractDocumentMetadata(
        'version-1',
        { expectedMetadataRevision: 1, requestId: 'new-request' },
        context,
      ),
    ).rejects.toMatchObject({
      code: 'DOCUMENT_METADATA_REVISION_CONFLICT',
      status: 409,
    });
    expect(f.read).not.toHaveBeenCalled();
  });
  it('resolves interrupted requests and historical revisions read-only, keeping missing receipts explicit', async () => {
    const f = fixture();
    await expect(
      f.service.readDocumentMetadata(
        'version-1',
        { requestId: 'not-committed' },
        context,
      ),
    ).resolves.toMatchObject({
      metadataRevision: null,
      extractedMetadata: null,
    });
    f.catalog.readExtractedMetadata.mockResolvedValue(metadataRow());
    await expect(
      f.service.readDocumentMetadata('version-1', { revision: '1' }, context),
    ).resolves.toMatchObject({
      metadataRevision: 1,
      extractedMetadata: metadata,
    });
    expect(f.catalog.readExtractedMetadata).toHaveBeenLastCalledWith({
      documentVersionId: 'version-1',
      revision: 1,
    });
    expect(f.read).not.toHaveBeenCalled();
    expect(f.catalog.appendExtractedMetadata).not.toHaveBeenCalled();
  });
  it.each([
    { expectedMetadataRevision: 0, requestId: 'a' },
    { expectedMetadataRevision: 1, requestId: 'a', extractedMetadata: {} },
    { expectedMetadataRevision: 1, requestId: '' },
    { expectedMetadataRevision: '1', requestId: 'a' },
  ])(
    'rejects malformed re-extraction requests without storage access',
    async (request) => {
      const f = fixture();
      await expect(
        f.service.reextractDocumentMetadata('version-1', request, context),
      ).rejects.toMatchObject({
        code: 'DOCUMENT_METADATA_REQUEST_INVALID',
        status: 400,
      });
      expect(f.read).not.toHaveBeenCalled();
    },
  );
  it('does not read storage or write when the immutable derived record already exists', async () => {
    const f = fixture();
    f.catalog.readMetadataSource.mockResolvedValue({
      ...sourceRow(),
      metadata: metadataRow(),
    });
    await expect(
      f.service.enrichDocumentMetadata('version-1', context),
    ).resolves.toMatchObject({
      disposition: 'ALREADY_PRESENT',
      extractedMetadata: metadata,
    });
    expect(f.read).not.toHaveBeenCalled();
    expect(f.catalog.fillMissingExtractedMetadata).not.toHaveBeenCalled();
  });
  it('denies access before catalog/storage reads', async () => {
    const f = fixture();
    f.authorizer.assertCanRead.mockRejectedValue(
      new Error('DOCUMENT_NOT_FOUND'),
    );
    await expect(
      f.service.enrichDocumentMetadata('version-1', context),
    ).rejects.toThrow('DOCUMENT_NOT_FOUND');
    expect(f.catalog.readMetadataSource).not.toHaveBeenCalled();
    expect(f.read).not.toHaveBeenCalled();
  });
  it.each(['providerVersionId', 'sha256'] as const)(
    'refuses drift in %s before parsing or writing',
    async (key) => {
      const f = fixture();
      f.read.mockResolvedValue({
        ...sourceRow().source,
        bytes,
        readbackVerified: true,
        fileName: 'source.pdf',
        mediaType: 'application/pdf',
        providerUpdatedAt: null,
        [key]: 'drift',
      });
      await expect(
        f.service.enrichDocumentMetadata('version-1', context),
      ).rejects.toMatchObject({ code: 'DOCUMENT_METADATA_SOURCE_MISMATCH' });
      expect(f.parse).not.toHaveBeenCalled();
      expect(f.catalog.fillMissingExtractedMetadata).not.toHaveBeenCalled();
    },
  );
});

describe('metadata insert-only catalog boundary', () => {
  it.each([true, false])(
    'keeps DocumentVersion immutable and handles inserted=%s without overwrite',
    async (inserted) => {
      const saved = {
        documentVersionId: 'version-1',
        extractedMetadata: metadata,
      };
      const query = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest
          .fn()
          .mockResolvedValueOnce([
            { pdfSha256: sha256, byteLength: bytes.length },
          ])
          .mockResolvedValueOnce([saved]),
      };
      const insert = {
        values: jest.fn().mockReturnThis(),
        onConflictDoNothing: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue(inserted ? [saved] : []),
      };
      const transaction = {
        select: jest.fn().mockReturnValue(query),
        insert: jest.fn().mockReturnValue(insert),
      };
      const db = {
        transaction: async (operation: (tx: typeof transaction) => unknown) =>
          operation(transaction),
      };
      const catalog = new MiaodaHostedDocumentCatalog(db as never);
      await expect(
        catalog.fillMissingExtractedMetadata({
          documentVersionId: 'version-1',
          sourceSha256: sha256,
          sourceByteLength: bytes.length,
          extractedMetadata: metadata,
        }),
      ).resolves.toMatchObject({
        disposition: inserted ? 'ENRICHED' : 'ALREADY_PRESENT',
        extractedMetadata: metadata,
      });
      expect(transaction.insert).toHaveBeenCalledTimes(1);
      expect(transaction.insert).toHaveBeenCalledWith(
        dmDocumentVersionMetadata,
      );
      expect(insert.onConflictDoNothing).toHaveBeenCalledWith({
        target: [
          dmDocumentVersionMetadata.documentVersionId,
          dmDocumentVersionMetadata.metadataRevision,
        ],
      });
    },
  );
});
