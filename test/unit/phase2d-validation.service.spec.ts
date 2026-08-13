import { Phase2dValidationService } from '../../server/modules/document-management-validation/phase2d-validation.service';

describe('Phase2dValidationService', () => {
  const previousRunId = process.env.WL_DM_PHASE2D_VALIDATION_RUN_ID;

  afterEach(() => {
    if (previousRunId === undefined) {
      delete process.env.WL_DM_PHASE2D_VALIDATION_RUN_ID;
    } else {
      process.env.WL_DM_PHASE2D_VALIDATION_RUN_ID = previousRunId;
    }
  });

  it('runs the exact four-step two-version loop and uses server login identity', async () => {
    process.env.WL_DM_PHASE2D_VALIDATION_RUN_ID = 'phase2d-test';
    const fileService = { getDefaultBucket: jest.fn().mockResolvedValue('bucket-1') };
    const first = {
      decision: 'INGEST_NEW_FAMILY',
      disposition: 'CREATED',
      familyId: 'family-1',
      documentId: 'document-1',
      documentVersionId: 'version-1',
      currentGeneration: 1,
      immutableReadbackVerified: true,
      catalogFreshReadVerified: true,
    };
    const exact = {
      decision: 'RESUME_EXISTING_PROCESS',
      disposition: 'RESUME_EXISTING_PROCESS',
      familyId: 'family-1',
      documentVersionId: 'version-1',
      immutableReadbackVerified: true,
    };
    const newer = {
      decision: 'INGEST_NEW_REVISION',
      disposition: 'CREATED',
      familyId: 'family-1',
      documentId: 'document-1',
      documentVersionId: 'version-2',
      currentGeneration: 2,
      immutableReadbackVerified: true,
      catalogFreshReadVerified: true,
    };
    const replay = {
      decision: 'INGEST_NEW_REVISION',
      disposition: 'IDEMPOTENT_REPLAY',
      familyId: 'family-1',
      documentVersionId: 'version-2',
      immutableReadbackVerified: true,
      catalogFreshReadVerified: true,
    };
    const documentManagement = {
      ingestFileServiceSelection: jest
        .fn()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(exact)
        .mockResolvedValueOnce(newer)
        .mockResolvedValueOnce(replay),
      getDocumentVersion: jest
        .fn()
        .mockResolvedValueOnce({
          version: {
            documentVersionId: 'version-1',
            revisionId: 'revision-1',
            businessRevision: '07042025',
            pdfSha256: 'd93100d54ea7e5f7eff9f18ac157e31580d31da45a2dcd4b7248969de823f36c',
            byteLength: 119_387,
            originalFilename: '777-FTD-31-21002_Doc_07042025.pdf',
          },
          family: { familyId: 'family-1', currentDocumentVersionId: 'version-2', currentGeneration: 2 },
        })
        .mockResolvedValueOnce({
          version: {
            documentVersionId: 'version-2',
            revisionId: 'revision-2',
            businessRevision: '09262025',
            pdfSha256: 'b1b5c198df4a3d42925218f48d70ddc361563c65692be35dac4c81e0d8367a3c',
            byteLength: 122_102,
            originalFilename: '777-FTD-31-21002_Doc_09262025.pdf',
          },
          family: { familyId: 'family-1', currentDocumentVersionId: 'version-2', currentGeneration: 2 },
        }),
    };
    const service = new Phase2dValidationService(
      fileService as never,
      documentManagement as never,
    );

    const result = await service.run(
      {
        firstFilePath: '/uploads/777-FTD-31-21002_Doc_07042025.pdf',
        newerFilePath: '/uploads/777-FTD-31-21002_Doc_09262025.pdf',
      },
      { actorUserId: 'login-user', tenantId: 'tenant-1', roles: ['role-1'] },
    );

    expect(result.status).toBe('PASS');
    expect(result.current).toEqual({
      familyId: 'family-1',
      documentVersionId: 'version-2',
      generation: 2,
    });
    expect(documentManagement.ingestFileServiceSelection).toHaveBeenCalledTimes(4);
    for (const call of documentManagement.ingestFileServiceSelection.mock.calls) {
      expect(call[0]).not.toHaveProperty('actorUserId');
      expect(call[1]).toMatchObject({ actorUserId: 'login-user', tenantId: 'tenant-1' });
      expect(call[1].roles).toContain('__wiselink_phase2d_validation__');
    }
  });

  it('rejects any source other than the two fixed FTD validation documents', async () => {
    process.env.WL_DM_PHASE2D_VALIDATION_RUN_ID = 'phase2d-test';
    const service = new Phase2dValidationService(
      { getDefaultBucket: jest.fn() } as never,
      {} as never,
    );

    await expect(
      service.run(
        { firstFilePath: '/uploads/not-the-ftd.pdf', newerFilePath: '/uploads/777-FTD-31-21002_Doc_09262025.pdf' },
        { actorUserId: 'login-user', tenantId: 'tenant-1', roles: [] },
      ),
    ).rejects.toMatchObject({ code: 'DOCUMENT_MANAGEMENT_VALIDATION_INPUT_INVALID' });
  });
});
