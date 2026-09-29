import { classifyIncompleteIngestionRecoveryState } from '../../server/modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog';

function fixture() {
  const sha256 = 'a'.repeat(64);
  const descriptor = {
    sha256, sizeBytes: 100, documentCode: '787-FTD-23-19002',
    sourceStorageKey: 'bucket:/immutable.pdf',
    extractedMetadata: {
      sourceSha256: sha256, sourceByteLength: 100,
      title: '787 Fleet Team Digest', extractedAt: '2026-09-29T01:00:00.000Z',
    },
  };
  const input = {
    sourceArtifact: {
      sourceArtifactId: 'ART-1', sha256, byteLength: 100,
      mediaType: 'application/pdf', bucketId: 'bucket', filePath: '/immutable.pdf',
      providerObjectId: 'immutable-object', providerVersionId: 'immutable-v1',
    },
    acquisition: {
      acquisitionId: 'ACQ-1', sourceArtifactId: 'ART-1',
      sourceChannel: 'document_library_upload', sourceRef: 'DOCUMENT_UPLOAD:actor:request',
      selectionBucketId: 'bucket', selectionFilePath: '/selected.pdf',
      providerObjectId: 'selected-object', providerVersionId: 'selected-v1',
      acquiredBy: 'actor', idempotencyKey: 'tenant:t1:request:request',
      sourceDescriptor: {
        ...descriptor,
        extractedMetadata: {
          ...descriptor.extractedMetadata, extractedAt: '2026-09-29T02:00:00.000Z',
        },
      },
    },
    preflight: {
      preflightId: 'PF-1', acquisitionId: 'ACQ-1',
      decision: 'INGEST_NEW_FAMILY', branch: 'INGEST',
      observedCurrentGeneration: 0, observedCurrentDocumentVersionId: null,
      normalizedDescriptor: { sha256, sizeBytes: 100, documentCode: descriptor.documentCode },
      decisionPayload: { decision: 'INGEST_NEW_FAMILY',
        generatedAt: '2026-09-29T02:00:00.000Z' },
    },
    downstream: {
      familyId: 'FAM-1', canonicalIdentityKey: 'tenant:t1:family:ftd',
      documentId: 'DOC-1', documentVersionId: 'DV-1',
    },
  };
  const state = {
    artifacts: [{ ...input.sourceArtifact, readbackVerified: true }],
    acquisitions: [{
      ...input.acquisition, sourceDescriptorJson: JSON.stringify(descriptor),
      status: 'ACQUIRED_READBACK_VERIFIED', documentVersionId: null,
    }],
    preflights: [{
      ...input.preflight, executionAuthorized: false, status: 'READY',
      documentVersionId: null, commitIdempotencyKey: null,
      normalizedDescriptorJson: JSON.stringify(input.preflight.normalizedDescriptor),
      decisionPayloadJson: JSON.stringify({ ...input.preflight.decisionPayload,
        generatedAt: '2026-09-29T01:00:00.000Z' }),
    }],
    families: [], documents: [], versions: [], currentness: [],
    workItems: [], actionAttempts: [],
  };
  return { input, state };
}

describe('incomplete upload recovery', () => {
  it('reuses one verified selection and saved metadata when only extraction time differs', () => {
    const { input, state } = fixture();
    expect(classifyIncompleteIngestionRecoveryState(input as never, state as never))
      .toMatchObject({ disposition: 'INCOMPLETE_INGESTION_RECOVERY_ALLOWED',
        acquisition: { acquisitionId: 'ACQ-1' }, preflight: { preflightId: 'PF-1' } });
  });

  it('rejects changed metadata contents or selected provider identity', () => {
    const { input, state } = fixture();
    state.acquisitions[0].sourceDescriptorJson = JSON.stringify({
      ...JSON.parse(state.acquisitions[0].sourceDescriptorJson),
      extractedMetadata: { ...input.acquisition.sourceDescriptor.extractedMetadata,
        title: 'Different document' },
    });
    expect(() => classifyIncompleteIngestionRecoveryState(input as never, state as never))
      .toThrow('Residual Acquisition differs');
    state.acquisitions[0].sourceDescriptorJson = JSON.stringify({
      ...input.acquisition.sourceDescriptor,
      extractedMetadata: {
        ...input.acquisition.sourceDescriptor.extractedMetadata,
        extractedAt: '2026-09-29T01:00:00.000Z',
      },
    });
    state.acquisitions[0].providerObjectId = 'other-selected-object';
    expect(() => classifyIncompleteIngestionRecoveryState(input as never, state as never))
      .toThrow('Residual Acquisition differs');
  });
});
