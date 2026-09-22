import type {
  DocumentExtractedMetadata,
  DocumentMetadataField,
} from '@shared/api.interface';
import { DocumentParsingHostedService } from '../../server/modules/document-management/src/hosted/nest/document-parsing-hosted.service';

const context = {
  actorUserId: 'actor-1',
  tenantId: 'tenant-1',
  roles: ['authenticated'],
};

function field(values: string[]): DocumentMetadataField {
  if (values.length === 0) {
    return { status: 'NOT_FOUND', observations: [] };
  }
  return {
    status: 'PENDING_REVIEW',
    observations: values.map((value: string) => ({
      value,
      status: 'PENDING_REVIEW' as const,
      evidence: [{ page: 1, text: value }],
    })),
  };
}

function metadata(): DocumentExtractedMetadata {
  return {
    schemaVersion: 'wiselink.document_metadata.v1',
    source: 'ACTUAL_PDF_TEXT',
    sourceSha256: 'a'.repeat(64),
    sourceByteLength: 128,
    pageCount: 1,
    inspectedPages: [1],
    extractedAt: '2026-09-21T00:00:00.000Z',
    title: field(['Wiring change', 'Inspection update']),
    documentType: field(['SB']),
    issuer: field(['BOEING']),
    ata: field(['34']),
    mentionedAircraftModels: field(['737']),
    aircraftModelSemantics: 'DOCUMENT_MENTION_ONLY',
    applicabilityAssessment: 'NOT_EVALUATED',
  };
}

function sourceRow(extractedMetadata: unknown | null) {
  return {
    version: {
      documentVersionId: 'DV-1',
      originalFilename: 'source.pdf',
      businessRevision: 'R1',
      revisionDate: '2026-09-21',
      sourceGeneratedDate: '2026-09-20',
    },
    family: {
      familyId: 'FAM-1',
      canonicalDocumentNumber: 'SB-TEST-1',
      documentFamily: 'SB',
      issuerAuthority: 'BOEING',
      currentDocumentVersionId: 'DV-1',
    },
    metadata: extractedMetadata === null ? null : { extractedMetadata },
    source: {
      bucketId: 'bucket-1',
      filePath: 'source.pdf',
      sha256: 'a'.repeat(64),
      byteLength: 128,
      providerObjectId: 'object-1',
      providerVersionId: 'version-1',
    },
  };
}

function serviceWithMetadata(extractedMetadata: unknown | null) {
  const catalog = {
    readMetadataSource: jest
      .fn()
      .mockResolvedValue(sourceRow(extractedMetadata)),
  };
  const repository = {
    current: jest.fn().mockResolvedValue({ latest: null, published: null }),
  };
  return new DocumentParsingHostedService(
    { from: jest.fn() } as never,
    catalog as never,
    repository as never,
    { configured: jest.fn(() => true) } as never,
    {} as never,
    { assertCanRead: jest.fn().mockResolvedValue(undefined) } as never,
  );
}

describe('document parsing status title boundary', () => {
  it('joins only validated title observations', async () => {
    const status = await serviceWithMetadata(metadata()).status(
      'DV-1',
      context,
    );
    expect(status.documentTitle).toBe('Wiring change / Inspection update');
  });

  it('keeps metadata absence as a null title', async () => {
    const status = await serviceWithMetadata(null).status('DV-1', context);
    expect(status.documentTitle).toBeNull();
  });

  it('keeps legal NOT_FOUND with empty observations as a null title', async () => {
    const status = await serviceWithMetadata({
      ...metadata(),
      title: field([]),
    }).status('DV-1', context);
    expect(status.documentTitle).toBeNull();
  });

  it('does not let corruption in an unrelated optional field block status', async () => {
    const corruptAta: unknown = {
      ...metadata(),
      ata: { status: 'NOT_FOUND', observations: 'broken' },
    };
    const status = await serviceWithMetadata(corruptAta).status(
      'DV-1',
      context,
    );
    expect(status.documentTitle).toBe('Wiring change / Inspection update');
  });

  it('still rejects a corrupt title that status directly consumes', async () => {
    const corruptTitle: unknown = {
      ...metadata(),
      title: { status: 'PENDING_REVIEW', observations: 'broken' },
    };
    await expect(
      serviceWithMetadata(corruptTitle).status('DV-1', context),
    ).rejects.toMatchObject({
      code: 'DOCUMENT_METADATA_SHAPE_INVALID',
      statusCode: 500,
    });
  });
});
