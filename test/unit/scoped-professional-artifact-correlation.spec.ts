jest.mock(
  '../../server/modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js',
  () => ({ MiaodaFileServiceArtifactStore: jest.fn() }),
);

import { MiaodaFileServiceArtifactStore } from '../../server/modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js';
import {
  assertScopedProfessionalArtifactCorrelation,
  MiaodaScopedProfessionalArtifactCorrelationAdapter,
  scopedProfessionalArtifactRef,
  UnavailableScopedProfessionalArtifactCorrelationAdapter,
  type ScopedProfessionalArtifactCorrelation,
  type ScopedProfessionalArtifactCorrelationRequest,
} from '../../server/modules/canonical-host/scoped-professional-artifact-correlation.port';
import { sha256Raw } from '../../server/modules/unified-reader/unified-reader.utils';

const request: ScopedProfessionalArtifactCorrelationRequest = {
  workItemId: 'WI-NEW-DEV',
  documentId: 'document_new_dev',
  documentVersionId: 'document_version_new_dev',
  sourceArtifactId: 'source_artifact_new_dev',
  sourceSha256: 'a'.repeat(64),
  sourceByteLength: 122_102,
  sourceProviderObjectId: 'provider-source-new-dev',
  classification: {
    status: 'CONFIRMED',
    normalizedFamily: 'FTD',
    classifierReleaseId: 'classifier-release-new-dev',
    classifierReleaseHash: `sha256:${'c'.repeat(64)}`,
    parserProfileId: 'parser-profile:boeing.ftd.v1@1.0.0',
    parserProfileHash:
      'sha256:c47a7388da23d106c2476b579308c458332127153930ced8c684212f1b431731',
    fingerprint: `sha256:${'d'.repeat(64)}`,
  },
};

function correlation(): ScopedProfessionalArtifactCorrelation {
  const actualBytes: Uint8Array = new TextEncoder().encode(
    '{"contractRevision":"frozen.2"}',
  );
  const digest: string = sha256Raw(actualBytes);
  return {
    schemaVersion: 'wiselink.3_1.scoped_professional_artifact_correlation.v1',
    status: 'HOST_SCOPE_BOUND_IMMUTABLE',
    scope: {
      workItemId: request.workItemId,
      documentVersionId: request.documentVersionId,
    },
    source: {
      documentId: request.documentId,
      sourceArtifactId: request.sourceArtifactId,
      sha256: request.sourceSha256,
      byteLength: request.sourceByteLength,
      providerObjectId: request.sourceProviderObjectId,
    },
    profile: { ...request.classification },
    professionalArtifact: {
      professionalArtifactId: 'professional_artifact_new_dev',
      ownerWorkItemId: request.workItemId,
      ownerDocumentVersionId: request.documentVersionId,
      packageId: `urn:techpub:package:v1:sha256:${'b'.repeat(64)}`,
      artifact: {
        storeRole: 'UnifiedArtifactStoreCandidate',
        ref: scopedProfessionalArtifactRef(
          request,
          'professional_artifact_new_dev',
        ),
        sha256: digest,
        byteLength: actualBytes.byteLength,
        mediaType: 'application/json',
      },
      fileServiceLocator: {
        bucketId: 'bucket-new-dev',
        filePath: '/professional/new-dev/frozen-2.json',
        providerObjectId: 'provider-professional-new-dev',
      },
    },
    lineage: {
      producerDocumentId: 'document_historical_lineage_only',
      producerDocumentVersionId: 'document_version_historical_lineage_only',
      documentCode: '777-FTD-31-21002',
      businessRevision: null,
      packageRevisionLabel: null,
    },
  };
}

function actualReadback(value: ScopedProfessionalArtifactCorrelation) {
  const bytes: Uint8Array = new TextEncoder().encode(
    '{"contractRevision":"frozen.2"}',
  );
  return {
    verified: true as const,
    bytes,
    providerObjectId:
      value.professionalArtifact.fileServiceLocator.providerObjectId,
    sha256: sha256Raw(bytes),
    byteLength: bytes.byteLength,
  };
}

describe('scoped professional artifact correlation', () => {
  it('persists Host-native output at the exact scope and verifies actual bytes', async () => {
    const packageId = `urn:techpub:package:v1:sha256:${'e'.repeat(64)}`;
    const bytes = new TextEncoder().encode(JSON.stringify({ packageId }));
    const digest = sha256Raw(bytes);
    const getFileMetadata = jest.fn().mockResolvedValue(null);
    const upload = jest.fn().mockResolvedValue({});
    const from = jest.fn(() => ({ getFileMetadata, upload }));
    jest.mocked(MiaodaFileServiceArtifactStore).mockImplementation(
      () =>
        ({
          readSelection: jest.fn().mockResolvedValue({
            readbackVerified: true,
            bytes,
            sha256: digest,
            byteLength: bytes.byteLength,
            providerObjectId: 'provider-professional-new-dev',
          }),
        }) as never,
    );
    const adapter = new MiaodaScopedProfessionalArtifactCorrelationAdapter({
      getDefaultBucket: jest.fn().mockResolvedValue('bucket-new-dev'),
      from,
    } as never);

    const value = await adapter.persistAndCorrelate(request, {
      packageId,
      artifact: {
        storeRole: 'UnifiedArtifactStoreCandidate',
        ref:
          'artifact://UnifiedArtifactStoreCandidate/' +
          `unified-parsed-packages/sha256/${digest}`,
        sha256: digest,
        byteLength: bytes.byteLength,
        mediaType: 'application/json',
      },
      bytes,
      lineage: {
        producerDocumentId: request.documentId,
        producerDocumentVersionId: request.documentVersionId,
        documentCode: '777-FTD-31-21002',
        businessRevision: null,
        packageRevisionLabel: null,
      },
    });

    expect(adapter.available).toBe(true);
    expect(from).toHaveBeenCalledWith('bucket-new-dev');
    expect(upload).toHaveBeenCalledWith(
      bytes,
      expect.objectContaining({
        filePath:
          'canonical-host/professional-artifacts/' +
          `${request.workItemId}/${request.documentVersionId}/${digest}.json`,
        contentType: 'application/json',
        upsert: false,
      }),
    );
    expect(value).toMatchObject({
      scope: {
        workItemId: request.workItemId,
        documentVersionId: request.documentVersionId,
      },
      professionalArtifact: {
        ownerWorkItemId: request.workItemId,
        ownerDocumentVersionId: request.documentVersionId,
        packageId,
        artifact: { sha256: digest, byteLength: bytes.byteLength },
        fileServiceLocator: {
          providerObjectId: 'provider-professional-new-dev',
        },
      },
    });
  });

  it('accepts exact new WorkItem and DocumentVersion scope with actual bytes', () => {
    const value: ScopedProfessionalArtifactCorrelation = correlation();
    expect(
      assertScopedProfessionalArtifactCorrelation(
        request,
        value,
        actualReadback(value),
      ),
    ).toMatchObject({
      scope: {
        workItemId: request.workItemId,
        documentVersionId: request.documentVersionId,
      },
      professionalArtifact: {
        ownerWorkItemId: request.workItemId,
        ownerDocumentVersionId: request.documentVersionId,
      },
    });
  });

  it('rejects a professional artifact owned by another WorkItem', () => {
    const value: ScopedProfessionalArtifactCorrelation = correlation();
    value.professionalArtifact.ownerWorkItemId = 'WI-HISTORICAL';
    expect(() =>
      assertScopedProfessionalArtifactCorrelation(
        request,
        value,
        actualReadback(value),
      ),
    ).toThrow('PDF_PRODUCER_CORRELATION_SCOPE_OR_READBACK_INVALID');
  });

  it('rejects using historical producer lineage as the artifact owner', () => {
    const value: ScopedProfessionalArtifactCorrelation = correlation();
    value.professionalArtifact.ownerDocumentVersionId =
      value.lineage.producerDocumentVersionId;
    expect(() =>
      assertScopedProfessionalArtifactCorrelation(
        request,
        value,
        actualReadback(value),
      ),
    ).toThrow('PDF_PRODUCER_CORRELATION_SCOPE_OR_READBACK_INVALID');
  });

  it('rejects a FileService byte hash mismatch', () => {
    const value: ScopedProfessionalArtifactCorrelation = correlation();
    const readback = actualReadback(value);
    readback.bytes = Uint8Array.from([1, 2, 3]);
    expect(() =>
      assertScopedProfessionalArtifactCorrelation(request, value, readback),
    ).toThrow('PDF_PRODUCER_CORRELATION_SCOPE_OR_READBACK_INVALID');
  });

  it('rejects a non-scoped artifact reference even when hash and bytes match', () => {
    const value: ScopedProfessionalArtifactCorrelation = correlation();
    value.professionalArtifact.artifact.ref =
      'artifact://HistoricalProducer/shared-frozen-2.json';
    expect(() =>
      assertScopedProfessionalArtifactCorrelation(
        request,
        value,
        actualReadback(value),
      ),
    ).toThrow('PDF_PRODUCER_CORRELATION_SCOPE_OR_READBACK_INVALID');
  });

  it('fails closed until the professional lane supplies the scoped port', async () => {
    const adapter =
      new UnavailableScopedProfessionalArtifactCorrelationAdapter();
    expect(adapter.available).toBe(false);
    await expect(
      adapter.persistAndCorrelate(request, {} as never),
    ).resolves.toBeNull();
  });
});
