jest.mock(
  '../../server/modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js',
  () => ({ MiaodaFileServiceArtifactStore: jest.fn() }),
);
jest.mock(
  '../../server/modules/professional-input/parser/pdfjs-dist-layout-extractor.adapter',
  () => ({
    PdfjsDistLayoutExtractor: class {
      extractLayout(bytes: Uint8Array) {
        const text =
          bytes[0] === 1
            ? '777- FTD-31-21002 Issue Title : Airplane Information Management System update. FLEET TEAM DIGEST BOEING PROPRIETARY.'
            : bytes[0] === 3
              ? 'MAINTENANCE TIP BOEING PROPRIETARY 787 MT 51 - 001 - R 3 SUBJECT TORX PLUS FASTENER REMOVAL'
              : 'Commercial Airplanes 737 Service Bulletin BOEING SERVICE BULLETIN 737-34-3830';
        return {
          kind: 'pdf',
          pdfVersion: '1.7',
          pageCount: 1,
          pageBoxes: [{ page: 1, mediaBox: [0, 0, 612, 792] }],
          metadata: { title: null },
          textRuns: [
            {
              page: 1,
              fontName: 'F1',
              bold: false,
              fontSize: 12,
              x: 10,
              y: 700,
              text,
            },
          ],
          sourceSha256: `sha256:${'e'.repeat(64)}`,
          sourceByteLength: bytes.byteLength,
        };
      }
    },
  }),
);

import { MiaodaFileServiceArtifactStore } from '../../server/modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js';
import { HostNativeDocumentFamilyPdfProducerAdapter } from '../../server/modules/canonical-host/exact-ftd-frozen2-pdf-producer.adapter';
import { hostNativePdfClassificationFor } from '../../server/modules/canonical-host/host-native-pdf-profile.registry';
import { UnavailableScopedProfessionalArtifactCorrelationAdapter } from '../../server/modules/canonical-host/scoped-professional-artifact-correlation.port';
import type { CanonicalPdfVerticalRunRequest } from '../../shared/api.interface';

const HISTORICAL_FTD_SHA256 =
  'b1b5c198df4a3d42925218f48d70ddc361563c65692be35dac4c81e0d8367a3c';
const EXACT_737_SB_SHA256 =
  'add32c7d4192d35c59162f15eb57f08247427135d5912438501ec9267fa4d41a';

const request: CanonicalPdfVerticalRunRequest = {
  schemaVersion: 'wiselink.3_1.canonical_pdf_vertical_request.v0.candidate',
  workItemId: 'WI-NEW-SCOPE',
  requestId: 'REQ-NEW-SCOPE',
  source: {
    documentId: 'document_3943d8eb5b7c7ee8fc742092',
    documentVersionId: 'document_version_fd88dcb9cf64cf3ba21033ef',
    parserRequestId: 'parser-request-new-scope',
    sourceArtifactId: 'source-artifact-new-scope',
    sourceFileSha256: `sha256:${HISTORICAL_FTD_SHA256}`,
    sourceByteLength: 122_102,
    driveFileToken: 'drive-file-new-scope',
    driveSourceVersion: 'drive-version-new-scope',
  },
  classification: {
    status: 'CONFIRMED',
    normalizedFamily: 'FTD',
    classifierReleaseId: 'classifier-release-new-scope',
    classifierReleaseHash: `sha256:${'a'.repeat(64)}`,
    parserProfileId: 'parser-profile:boeing.ftd.v1@1.0.0',
    parserProfileHash:
      'sha256:c47a7388da23d106c2476b579308c458332127153930ced8c684212f1b431731',
    fingerprint: `sha256:${'b'.repeat(64)}`,
  },
  query: 'applicability',
};

const exactSbRequest: CanonicalPdfVerticalRunRequest = {
  ...request,
  workItemId: 'WI-EXACT-737-SB',
  requestId: 'REQ-EXACT-737-SB',
  source: {
    ...request.source,
    documentId: 'document-exact-737-sb',
    documentVersionId: 'document-version-exact-737-sb',
    sourceArtifactId: 'source-artifact-exact-737-sb',
    sourceFileSha256: `sha256:${EXACT_737_SB_SHA256}`,
    sourceByteLength: 1_060_204,
  },
  classification: {
    ...request.classification,
    status: 'CONFIRMED',
    normalizedFamily: 'SB',
    classifierReleaseId: 'intake-classifier-release:q1-native-migration@1.0.0',
    classifierReleaseHash:
      'sha256:d374483eaa1c209912bf8ed0f830b582f8f0578e3149899de24633ad8e10587c',
    parserProfileId: 'parser-profile:boeing.sb@1.0.0',
    parserProfileHash:
      'sha256:f87dbe8607c4958f253f980bc459cea062e7ebc1e7e8c65353549399cb07f3c0',
    fingerprint:
      'sha256:f87850cddc741f2969280db07d775125315d0f1b61ae2beb7bb14584176a2663',
  },
};

describe('HostNativeDocumentFamilyPdfProducerAdapter scoped professional correlation', () => {
  it('does not use a historical fixed binding when the new scope has no correlation', async () => {
    const readSelection = jest.fn().mockResolvedValue({
      readbackVerified: true,
      sha256: HISTORICAL_FTD_SHA256,
      byteLength: 122_102,
      providerObjectId: 'provider-source-new-scope',
      bytes: Uint8Array.of(1),
    });
    jest
      .mocked(MiaodaFileServiceArtifactStore)
      .mockImplementation(() => ({ readSelection }) as never);
    const resolver = {
      resolve: jest.fn().mockResolvedValue({
        version: {
          documentId: request.source.documentId,
          documentVersionId: request.source.documentVersionId,
          sourceArtifactId: request.source.sourceArtifactId,
          pdfSha256: HISTORICAL_FTD_SHA256,
          byteLength: request.source.sourceByteLength,
        },
        family: {
          documentFamily: 'FTD',
          issuerAuthority: 'BOEING',
          canonicalDocumentNumber: '777-FTD-31-21002',
        },
        artifact: {
          sourceArtifactId: request.source.sourceArtifactId,
          bucketId: 'bucket-source-new-scope',
          filePath: '/source/new-scope.pdf',
          providerObjectId: 'provider-source-new-scope',
          mediaType: 'application/pdf',
          sha256: HISTORICAL_FTD_SHA256,
          byteLength: request.source.sourceByteLength,
        },
      }),
    };
    const validator = { validate: jest.fn() };
    const adapter = new HostNativeDocumentFamilyPdfProducerAdapter(
      {} as never,
      resolver as never,
      validator as never,
      new UnavailableScopedProfessionalArtifactCorrelationAdapter(),
    );

    await expect(adapter.producePdf(request)).resolves.toEqual({
      kind: 'FAILURE_SIGNAL',
      failureCode: 'PDF_PRODUCER_CORRELATION_UNAVAILABLE',
      message:
        'No Host-owned WorkItem and DocumentVersion scoped professional artifact correlation is available.',
      executionRoute:
        'dm_document_version->scoped_professional_artifact_correlation',
    });
    expect(readSelection).toHaveBeenCalledWith({
      bucketId: 'bucket-source-new-scope',
      filePath: '/source/new-scope.pdf',
    });
    expect(resolver.resolve).toHaveBeenCalledWith(
      request.source.documentVersionId,
      { requireCurrent: true },
    );
    expect(validator.validate).not.toHaveBeenCalled();
  });

  it('recognizes Boeing SB content without using the legacy exact-source profile', async () => {
    const readSelection = jest.fn().mockResolvedValue({
      readbackVerified: true,
      sha256: EXACT_737_SB_SHA256,
      byteLength: exactSbRequest.source.sourceByteLength,
      providerObjectId: 'provider-source-exact-737-sb',
      bytes: Uint8Array.of(2),
    });
    jest
      .mocked(MiaodaFileServiceArtifactStore)
      .mockImplementation(() => ({ readSelection }) as never);
    const resolver = {
      resolve: jest.fn().mockResolvedValue({
        version: {
          documentId: exactSbRequest.source.documentId,
          documentVersionId: exactSbRequest.source.documentVersionId,
          sourceArtifactId: exactSbRequest.source.sourceArtifactId,
          pdfSha256: EXACT_737_SB_SHA256,
          byteLength: exactSbRequest.source.sourceByteLength,
          businessRevision: '  ORIGINAL   ISSUE  ',
        },
        family: {
          documentFamily: 'SB',
          issuerAuthority: 'BOEING',
          canonicalDocumentNumber: '737-34-3830',
        },
        artifact: {
          sourceArtifactId: exactSbRequest.source.sourceArtifactId,
          bucketId: 'bucket-source-exact-737-sb',
          filePath: '/source/exact-737-sb.pdf',
          providerObjectId: 'provider-source-exact-737-sb',
          mediaType: 'application/pdf',
          sha256: EXACT_737_SB_SHA256,
          byteLength: exactSbRequest.source.sourceByteLength,
        },
      }),
    };
    const validator = { validate: jest.fn() };
    const adapter = new HostNativeDocumentFamilyPdfProducerAdapter(
      {} as never,
      resolver as never,
      validator as never,
      new UnavailableScopedProfessionalArtifactCorrelationAdapter(),
    );

    await expect(adapter.producePdf(exactSbRequest)).resolves.toMatchObject({
      kind: 'FAILURE_SIGNAL',
      failureCode: 'PDF_PRODUCER_CORRELATION_UNAVAILABLE',
    });
    expect(resolver.resolve).toHaveBeenCalledWith(
      exactSbRequest.source.documentVersionId,
      { requireCurrent: true },
    );
    expect(readSelection).toHaveBeenCalledWith({
      bucketId: 'bucket-source-exact-737-sb',
      filePath: '/source/exact-737-sb.pdf',
    });
    expect(validator.validate).not.toHaveBeenCalled();
  });

  it('does not bind the Boeing SB profile to one business revision', async () => {
    const readSelection = jest.fn().mockResolvedValue({
      readbackVerified: true,
      sha256: EXACT_737_SB_SHA256,
      byteLength: exactSbRequest.source.sourceByteLength,
      providerObjectId: 'provider-source-exact-737-sb',
      bytes: Uint8Array.of(2),
    });
    jest
      .mocked(MiaodaFileServiceArtifactStore)
      .mockImplementation(() => ({ readSelection }) as never);
    const resolver = {
      resolve: jest.fn().mockResolvedValue({
        version: {
          documentId: exactSbRequest.source.documentId,
          documentVersionId: exactSbRequest.source.documentVersionId,
          sourceArtifactId: exactSbRequest.source.sourceArtifactId,
          pdfSha256: EXACT_737_SB_SHA256,
          byteLength: exactSbRequest.source.sourceByteLength,
          businessRevision: 'Revision 1',
        },
        family: {
          documentFamily: 'SB',
          issuerAuthority: 'BOEING',
          canonicalDocumentNumber: '737-34-3830',
        },
        artifact: {
          sourceArtifactId: exactSbRequest.source.sourceArtifactId,
          bucketId: 'bucket-source-exact-737-sb',
          filePath: '/source/exact-737-sb.pdf',
          providerObjectId: 'provider-source-exact-737-sb',
          mediaType: 'application/pdf',
          sha256: EXACT_737_SB_SHA256,
          byteLength: exactSbRequest.source.sourceByteLength,
        },
      }),
    };
    const adapter = new HostNativeDocumentFamilyPdfProducerAdapter(
      {} as never,
      resolver as never,
      { validate: jest.fn() } as never,
      new UnavailableScopedProfessionalArtifactCorrelationAdapter(),
    );

    await expect(adapter.producePdf(exactSbRequest)).resolves.toMatchObject({
      kind: 'FAILURE_SIGNAL',
      failureCode: 'PDF_PRODUCER_CORRELATION_UNAVAILABLE',
    });
    expect(readSelection).toHaveBeenCalledWith({
      bucketId: 'bucket-source-exact-737-sb',
      filePath: '/source/exact-737-sb.pdf',
    });
  });

  it('fails closed after recognition when the requested profile differs or DM issuer is missing', async () => {
    const readSelection = jest.fn().mockResolvedValue({
      readbackVerified: true,
      sha256: EXACT_737_SB_SHA256,
      byteLength: exactSbRequest.source.sourceByteLength,
      providerObjectId: 'provider-source-exact-737-sb',
      bytes: Uint8Array.of(2),
    });
    jest
      .mocked(MiaodaFileServiceArtifactStore)
      .mockImplementation(() => ({ readSelection }) as never);
    const resolved = {
      version: {
        documentId: exactSbRequest.source.documentId,
        documentVersionId: exactSbRequest.source.documentVersionId,
        sourceArtifactId: exactSbRequest.source.sourceArtifactId,
        pdfSha256: EXACT_737_SB_SHA256,
        byteLength: exactSbRequest.source.sourceByteLength,
        businessRevision: 'Original Issue',
      },
      family: {
        documentFamily: 'SB',
        issuerAuthority: 'BOEING',
        canonicalDocumentNumber: '737-34-3830',
      },
      artifact: {
        sourceArtifactId: exactSbRequest.source.sourceArtifactId,
        bucketId: 'bucket-source-exact-737-sb',
        filePath: '/source/exact-737-sb.pdf',
        providerObjectId: 'provider-source-exact-737-sb',
        mediaType: 'application/pdf',
        sha256: EXACT_737_SB_SHA256,
        byteLength: exactSbRequest.source.sourceByteLength,
      },
    };
    const resolver = {
      resolve: jest.fn().mockResolvedValue(resolved),
    };
    const adapter = new HostNativeDocumentFamilyPdfProducerAdapter(
      {} as never,
      resolver as never,
      { validate: jest.fn() } as never,
      new UnavailableScopedProfessionalArtifactCorrelationAdapter(),
    );

    await expect(
      adapter.producePdf({
        ...exactSbRequest,
        classification: {
          ...exactSbRequest.classification,
          parserProfileId: 'parser-profile:airbus.sb@1.0.0',
          parserProfileHash: `sha256:${'d'.repeat(64)}`,
        },
      }),
    ).resolves.toMatchObject({
      kind: 'FAILURE_SIGNAL',
      failureCode: 'PDF_PRODUCER_PROFILE_NOT_AVAILABLE',
      executionRoute: 'dm_document_version->host_native_pdf_pipeline',
    });
    resolver.resolve.mockResolvedValueOnce({
      ...resolved,
      family: {
        ...resolved.family,
        issuerAuthority: undefined,
      },
    });
    await expect(adapter.producePdf(exactSbRequest)).resolves.toMatchObject({
      kind: 'FAILURE_SIGNAL',
      failureCode: 'PDF_PRODUCER_PROFILE_NOT_AVAILABLE',
      executionRoute: 'dm_document_version->host_native_pdf_pipeline',
    });
    expect(resolver.resolve).toHaveBeenCalledTimes(2);
    expect(readSelection).toHaveBeenCalledTimes(2);
  });

  it('requires the committed DM adapter release for a subtype profile', async () => {
    const sourceSha256 = 'f'.repeat(64);
    const classification = hostNativePdfClassificationFor({
      family: 'MT',
      issuerAuthority: 'BOEING',
      adapterId: 'issuer.boeing.maintenance_tip.v1',
    });
    if (!classification) throw new Error('TEST_MT_PROFILE_NOT_ACTIVATED');
    const mtRequest: CanonicalPdfVerticalRunRequest = {
      ...exactSbRequest,
      source: {
        ...exactSbRequest.source,
        documentId: 'document-boeing-mt',
        documentVersionId: 'document-version-boeing-mt',
        sourceArtifactId: 'source-artifact-boeing-mt',
        sourceFileSha256: `sha256:${sourceSha256}`,
        sourceByteLength: 3,
      },
      classification,
    };
    const readSelection = jest.fn().mockResolvedValue({
      readbackVerified: true,
      sha256: sourceSha256,
      byteLength: 3,
      providerObjectId: 'provider-source-boeing-mt',
      bytes: Uint8Array.of(3, 0, 0),
    });
    jest
      .mocked(MiaodaFileServiceArtifactStore)
      .mockImplementation(() => ({ readSelection }) as never);
    const resolved = {
      version: {
        documentId: mtRequest.source.documentId,
        documentVersionId: mtRequest.source.documentVersionId,
        sourceArtifactId: mtRequest.source.sourceArtifactId,
        pdfSha256: sourceSha256,
        byteLength: mtRequest.source.sourceByteLength,
      },
      family: {
        documentFamily: 'MT',
        issuerAuthority: 'BOEING',
        canonicalDocumentNumber: '787 MT 51-001',
      },
      artifact: {
        sourceArtifactId: mtRequest.source.sourceArtifactId,
        bucketId: 'bucket-source-boeing-mt',
        filePath: '/source/boeing-mt.pdf',
        providerObjectId: 'provider-source-boeing-mt',
        mediaType: 'application/pdf',
        sha256: sourceSha256,
        byteLength: mtRequest.source.sourceByteLength,
      },
    };
    const resolver = { resolve: jest.fn().mockResolvedValue(resolved) };
    const adapter = new HostNativeDocumentFamilyPdfProducerAdapter(
      {} as never,
      resolver as never,
      { validate: jest.fn() } as never,
      new UnavailableScopedProfessionalArtifactCorrelationAdapter(),
    );

    await expect(adapter.producePdf(mtRequest)).resolves.toMatchObject({
      kind: 'FAILURE_SIGNAL',
      failureCode: 'PDF_PRODUCER_PROFILE_NOT_AVAILABLE',
    });
    resolver.resolve.mockResolvedValueOnce({
      ...resolved,
      preflight: {
        normalizedDescriptorJson: JSON.stringify({
          adapterRelease: {
            adapterId: 'issuer.boeing.maintenance_tip.v1',
            adapterVersion: 'v8.4-document-family-adapter.v1',
          },
        }),
      },
    });
    await expect(adapter.producePdf(mtRequest)).resolves.toMatchObject({
      kind: 'FAILURE_SIGNAL',
      failureCode: 'PDF_PRODUCER_CORRELATION_UNAVAILABLE',
    });
  });
});
