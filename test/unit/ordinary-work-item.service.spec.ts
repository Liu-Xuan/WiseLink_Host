jest.mock(
  '../../server/modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js',
  () => ({ MiaodaFileServiceArtifactStore: jest.fn() }),
);
jest.mock(
  '../../server/modules/document-management/src/hosted/phase5BoeingSbHandoff.js',
  () => ({
    createPhase5BoeingSbIngestRequest: jest.fn(),
    PHASE5_737_34_3830_HANDOFF: {
      source: { sha256: 'a'.repeat(64), byteLength: 1024 },
      canonicalHostClassification: {
        status: 'CANDIDATE',
        normalizedFamily: 'SB',
        classifierReleaseId: 'classifier@test',
        classifierReleaseHash: `sha256:${'b'.repeat(64)}`,
        parserProfileId: 'parser@test',
        parserProfileHash: `sha256:${'c'.repeat(64)}`,
        fingerprint: `sha256:${'d'.repeat(64)}`,
      },
    },
  }),
);

import { OrdinaryWorkItemService } from '../../server/modules/work-item/ordinary-work-item.service';

const ACTOR = {
  userId: 'engineer-1001',
  tenantId: 'tenant-2001',
  appId: 'app_17bzc551rsg',
  roles: ['authenticated'],
  env: 'test',
};

function target() {
  const resolver = {
    resolve: jest.fn().mockResolvedValue({
      version: {
        documentId: 'document-sb',
        documentVersionId: 'document-version-sb',
        sourceArtifactId: 'artifact-sb',
        pdfSha256: 'a'.repeat(64),
        byteLength: 1024,
      },
      family: { documentFamily: 'SB' },
      artifact: {
        providerObjectId: 'drive-token-sb',
        providerVersionId: 'drive-version-sb',
      },
    }),
  };
  const repository = {
    reserve: jest.fn().mockResolvedValue({
      workItemId: 'WI-NEW-SB',
      requestId: 'REQ-NEW-SB',
      attemptId: 'ATT-NEW-SB',
      created: true,
    }),
  };
  const vertical = {
    runPdf: jest.fn().mockResolvedValue({
      schemaVersion: 'wiselink.3_1.canonical_pdf_vertical_response.v0.candidate',
      status: 'CANDIDATE_VERTICAL_VERIFIED',
      workItem: { workItemId: 'WI-NEW-SB' },
      readback: null,
      entry: {},
      authority: {
        canonicalRoleSelected: false,
        onlineWritePerformed: false,
        applicationPublished: false,
        currentSelectionChanged: false,
        engineeringConclusionCreated: false,
      },
    }),
  };
  return {
    repository,
    service: new OrdinaryWorkItemService(
      {} as never,
      resolver as never,
      repository as never,
      vertical as never,
    ),
  };
}

describe('OrdinaryWorkItemService run identity', () => {
  it('keeps ordinary parsing on the canonical idempotency key', async () => {
    const { repository, service } = target();

    await service.parsePdf(
      { documentVersionId: 'document-version-sb' },
      ACTOR,
    );

    expect(repository.reserve).toHaveBeenCalledWith(
      expect.objectContaining({ runKey: 'canonical' }),
    );
  });

  it('binds explicit development runs to the normalized UUID key', async () => {
    const { repository, service } = target();

    await service.createDevelopmentRun(
      {
        documentVersionId: 'document-version-sb',
        developmentRunToken: '0F8FAD5B-D9CB-469F-A165-70867728950E',
      },
      ACTOR,
    );

    expect(repository.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        runKey: 'dev:0f8fad5b-d9cb-469f-a165-70867728950e',
      }),
    );
  });

  it('rejects malformed development tokens before reserving a WorkItem', async () => {
    const { repository, service } = target();

    await expect(
      service.createDevelopmentRun(
        {
          documentVersionId: 'document-version-sb',
          developmentRunToken: 'not-a-uuid',
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({
      code: 'WORK_ITEM_DEVELOPMENT_RUN_TOKEN_INVALID',
      statusCode: 400,
    });
    expect(repository.reserve).not.toHaveBeenCalled();
  });
});
