jest.mock(
  '../../server/modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js',
  () => ({ MiaodaFileServiceArtifactStore: jest.fn() }),
);

import { MiaodaFileServiceArtifactStore } from '../../server/modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js';
import { ExactFtdFrozen2PdfProducerAdapter } from '../../server/modules/canonical-host/exact-ftd-frozen2-pdf-producer.adapter';
import { UnavailableScopedProfessionalArtifactCorrelationAdapter } from '../../server/modules/canonical-host/scoped-professional-artifact-correlation.port';
import type { CanonicalPdfVerticalRunRequest } from '../../shared/api.interface';

const HISTORICAL_FTD_SHA256 =
  'b1b5c198df4a3d42925218f48d70ddc361563c65692be35dac4c81e0d8367a3c';

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

describe('ExactFtdFrozen2PdfProducerAdapter scoped professional correlation', () => {
  it('does not use a historical fixed binding when the new scope has no correlation', async () => {
    const readSelection = jest.fn().mockResolvedValue({
      readbackVerified: true,
      sha256: HISTORICAL_FTD_SHA256,
      byteLength: 122_102,
      providerObjectId: 'provider-source-new-scope',
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
    const adapter = new ExactFtdFrozen2PdfProducerAdapter(
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
});
