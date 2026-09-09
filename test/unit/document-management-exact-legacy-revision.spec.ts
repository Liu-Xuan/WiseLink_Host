import { createHash } from 'node:crypto';
import { DocumentManagementHostedCore } from '../../server/modules/document-management/src/hosted/documentManagementHostedCore.js';
import { deterministicId } from '../../server/modules/document-management/src/runtime/valueTools.js';

const bytes = Buffer.from('%PDF-1.7 legacy Boeing publication fixture');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const code = 'B787-81205-SB310019-00';
const sourceArtifactId = deterministicId(
  'source_artifact',
  sha256,
  bytes.length,
);
const context = { actorUserId: 'owner', tenantId: '63849986', roles: [] };
const request = {
  idempotencyKey: '01cd97f4-0c29-410a-9669-00a4ba810fa4',
  sourceChannel: 'document_library_upload',
  sourceRef: 'selected-file',
  selection: { bucketId: 'bucket', filePath: '/selected.pdf' },
};
function fixture() {
  const family = {
    familyId: 'legacy-family',
    canonicalIdentityKey: `tenant:63849986:family:${encodeURIComponent(`BOEING|SB|${code}`)}`,
    issuerAuthority: 'BOEING',
    documentFamily: 'SB',
    canonicalDocumentNumber: code,
    currentGeneration: 4,
    currentDocumentVersionId: 'legacy-version',
  };
  const version = {
    familyId: family.familyId,
    documentId: 'legacy-document',
    documentVersionId: 'legacy-version',
    canonicalRevisionIdentity: 'DATE:2020-09-24',
    businessRevision: 'ISSUE 001',
    revisionDate: '2020-09-24',
    sourceGeneratedDate: '',
    sourceArtifactId,
    pdfSha256: sha256,
    byteLength: bytes.length,
    originalFilename: 'legacy.pdf',
  };
  let acquisition: Record<string, unknown> | null = null;
  let preflight: Record<string, unknown> | null = null;
  let linked = false;
  let persisted = false;
  const catalog = {
    findIngestionByIdempotency: jest.fn(async () =>
      acquisition
        ? {
            status: linked ? 'COMMITTED' : 'INCOMPLETE',
            acquisitionId: acquisition.acquisitionId,
            exactPreflightId: preflight?.preflightId,
            exactSourceDescriptor: structuredClone(
              acquisition.sourceDescriptor,
            ),
          }
        : null,
    ),
    assertImmutableSourceReuseSafe: jest.fn(async () => ({
      disposition: 'CATALOGED_SOURCE_REUSE_ALLOWED',
    })),
    recordAcquisition: jest.fn(async (input) => {
      if (acquisition) {
        for (const field of [
          'acquisitionId',
          'sourceArtifactId',
          'sourceRef',
          'sourceChannel',
          'selectionBucketId',
          'selectionFilePath',
          'providerObjectId',
          'providerVersionId',
          'acquiredBy',
          'idempotencyKey',
          'sourceDescriptor',
        ]) {
          expect(input.acquisition[field]).toEqual(acquisition[field]);
        }
      } else acquisition = structuredClone(input.acquisition);
      return structuredClone(acquisition);
    }),
    listIngressDocuments: jest.fn(async () => [
      {
        documentVersionId: 'legacy-version',
        detail: {
          documentCode: code,
          documentFamily: 'SB',
          canonicalDocumentFamily: 'SB',
          issuerAuthority: 'BOEING',
          businessRevision: 'ISSUE 001',
          revisionDate: '2020-09-24',
          sourceGeneratedDate: '',
          originalFilename: 'legacy.pdf',
          sha256,
          sizeBytes: bytes.length,
        },
        upload: { descriptorSummary: { sha256, sizeBytes: bytes.length } },
      },
    ]),
    observeFamily: jest.fn(async () => structuredClone(family)),
    recordPreflight: jest.fn(async (input) => {
      preflight ??= structuredClone(input);
      return structuredClone(preflight);
    }),
    findExactDocumentVersion: jest.fn(async () => structuredClone(version)),
    readFamily: jest.fn(async () => structuredClone(family)),
    readDocumentVersion: jest.fn(async () => structuredClone(version)),
    linkAcquisitionToVersion: jest.fn(async () => {
      linked = true;
    }),
    commitNewVersion: jest.fn(),
  };
  const authorizer = { assertCanIngest: jest.fn(async () => {}) };
  const artifactStore = {
    readSelection: jest.fn(async () => ({
      bytes,
      sha256,
      byteLength: bytes.length,
      mediaType: 'application/pdf',
      bucketId: 'bucket',
      filePath: '/selected.pdf',
      providerObjectId: 'selected-object',
      providerVersionId: 'selected-version',
      fileName: 'publication.pdf',
    })),
    persistImmutableSource: jest.fn(async () => {
      const reusedExisting = persisted;
      persisted = true;
      return {
        bucketId: 'bucket',
        filePath: '/immutable.pdf',
        providerObjectId: 'immutable-object',
        providerVersionId: 'immutable-version',
        readbackVerified: true,
        reusedExisting,
      };
    }),
  };
  const core = new DocumentManagementHostedCore({
    catalog: catalog as never,
    artifactStore,
    authorizer,
    pdfLayoutExtractor: {
      extractLayout: () => ({
        pageCount: 1,
        sourceSha256: `sha256:${sha256}`,
        sourceByteLength: bytes.length,
        textRuns: [
          {
            page: 1,
            x: 10,
            y: 10,
            text: `BOEING PROPRIETARY SERVICE BULLETIN Publication: ${code} Issue 001, 24 Sep 2020`,
          },
        ],
      }),
    },
  });
  return {
    core,
    catalog,
    family,
    version,
    authorizer,
    artifactStore,
    state: () => ({ acquisition, preflight, linked }),
  };
}

describe('exact-byte reuse across the date-to-business-revision transition', () => {
  it('reuses the actual legacy ISSUE 001 publication without changing its DATE key or immutable IDs', async () => {
    const f = fixture();
    const before = structuredClone(f.version);
    await expect(
      f.core.ingestFileServiceSelection(request, context),
    ).resolves.toMatchObject({
      documentVersionId: 'legacy-version',
      newDocumentVersionCreated: false,
      currentnessChanged: false,
    });
    expect(f.version).toEqual(before);
    expect(f.catalog.linkAcquisitionToVersion).toHaveBeenCalledWith(
      expect.objectContaining({ documentVersionId: 'legacy-version' }),
    );
    expect(f.catalog.commitNewVersion).not.toHaveBeenCalled();
  });
  it.each([
    ['canonicalRevisionIdentity', 'DATE:2020-09-23'],
    ['canonicalRevisionIdentity', 'ISSUE:00000002'],
    ['businessRevision', 'ISSUE 002'],
    ['revisionDate', '2020-09-23'],
    ['sourceGeneratedDate', '2020-09-24'],
    ['pdfSha256', 'f'.repeat(64)],
    ['byteLength', bytes.length + 1],
  ])(
    'refuses a real stored %s conflict before linking',
    async (field, value) => {
      const f = fixture();
      Object.assign(f.version, { [field]: value });
      await expect(
        f.core.ingestFileServiceSelection(request, context),
      ).rejects.toMatchObject({
        code: 'CATALOG_EXACT_DOCUMENT_IDENTITY_CONFLICT',
      });
      expect(f.catalog.linkAcquisitionToVersion).not.toHaveBeenCalled();
      expect(f.catalog.commitNewVersion).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['issuerAuthority', 'AIRBUS'],
    ['documentFamily', 'SL'],
    ['canonicalDocumentNumber', 'B787-81205-SB310020-00'],
    ['canonicalIdentityKey', 'tenant:other:family:wrong'],
  ])('refuses a real family %s conflict', async (field, value) => {
    const f = fixture();
    Object.assign(f.family, { [field]: value });
    await expect(
      f.core.ingestFileServiceSelection(request, context),
    ).rejects.toMatchObject({
      code: 'CATALOG_EXACT_DOCUMENT_IDENTITY_CONFLICT',
    });
    expect(f.catalog.linkAcquisitionToVersion).not.toHaveBeenCalled();
  });
  it('finishes the original failed request and READY preflight after fresh bytes and authorization checks', async () => {
    const f = fixture();
    const before = structuredClone(f.version);
    f.catalog.findExactDocumentVersion.mockRejectedValueOnce(
      new Error('previous strict derived-key failure'),
    );
    await expect(
      f.core.ingestFileServiceSelection(request, context),
    ).rejects.toThrow('previous strict derived-key failure');
    const pending = structuredClone(f.state());
    expect(pending.linked).toBe(false);
    // Exact links retain the original observation even if currentness later moved.
    f.family.currentGeneration = 5;
    f.family.currentDocumentVersionId = 'another-current-version';
    await expect(
      f.core.ingestFileServiceSelection(request, context),
    ).resolves.toMatchObject({
      documentVersionId: 'legacy-version',
      currentnessChanged: false,
      newDocumentVersionCreated: false,
    });
    expect(f.state().preflight?.preflightId).toBe(
      pending.preflight?.preflightId,
    );
    expect(f.state().acquisition?.acquisitionId).toBe(
      pending.acquisition?.acquisitionId,
    );
    expect(f.authorizer.assertCanIngest).toHaveBeenCalledTimes(2);
    expect(f.artifactStore.readSelection).toHaveBeenCalledTimes(2);
    expect(f.version).toEqual(before);
    expect(f.family.currentGeneration).toBe(5);
    expect(f.catalog.commitNewVersion).not.toHaveBeenCalled();
  });
  it('does not apply exact recovery when no original READY exact preflight was proven', async () => {
    const f = fixture();
    f.catalog.findExactDocumentVersion.mockRejectedValueOnce(
      new Error('previous failure'),
    );
    await expect(
      f.core.ingestFileServiceSelection(request, context),
    ).rejects.toThrow('previous failure');
    f.catalog.findIngestionByIdempotency.mockResolvedValue({
      status: 'INCOMPLETE',
      acquisitionId: f.state().acquisition!.acquisitionId,
      exactPreflightId: undefined,
      exactSourceDescriptor: undefined,
    });
    await expect(
      f.core.ingestFileServiceSelection(request, context),
    ).rejects.toMatchObject({
      code: 'INCOMPLETE_INGESTION_RECOVERY_DECISION_UNSUPPORTED',
    });
    expect(f.catalog.linkAcquisitionToVersion).not.toHaveBeenCalled();
  });
});
