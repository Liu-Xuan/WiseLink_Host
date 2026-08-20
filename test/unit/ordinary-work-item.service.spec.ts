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
  roles: ['authenticated', 'wiselink_development'],
  env: 'test',
};

function target() {
  const fileService = { from: jest.fn() };
  const documentManagement = {
    assertCanIngest: jest.fn().mockResolvedValue(undefined),
    ingestFileServiceSelection: jest.fn(),
  };
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
    loadTenantRunAuthorizationBinding: jest.fn().mockResolvedValue({
      workItemId: 'WI-OWNED-SB',
      tenantId: 'tenant-2001',
      requestId: 'REQ-OWNED-SB',
      documentId: 'document-sb',
      documentVersionId: 'document-version-sb',
      requestedByUserId: ACTOR.userId,
      runKey: 'canonical',
    }),
    loadTenantDocumentAuthorizationBinding: jest.fn().mockResolvedValue({
      workItemId: 'WI-OWNED-SB',
      tenantId: 'tenant-2001',
      requestId: 'REQ-OWNED-SB',
      documentId: 'document-sb',
      documentVersionId: 'document-version-sb',
      requestedByUserId: ACTOR.userId,
      runKey: 'canonical',
    }),
    reserve: jest.fn().mockResolvedValue({
      workItemId: 'WI-NEW-SB',
      requestId: 'REQ-NEW-SB',
      attemptId: 'ATT-NEW-SB',
      created: true,
    }),
  };
  const vertical = {
    authorizeExistingWorkItem: jest.fn().mockResolvedValue({}),
    runPdf: jest.fn().mockResolvedValue({
      schemaVersion:
        'wiselink.3_1.canonical_pdf_vertical_response.v0.candidate',
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
    documentManagement,
    resolver,
    repository,
    vertical,
    fileService,
    service: new OrdinaryWorkItemService(
      documentManagement as never,
      resolver as never,
      repository as never,
      vertical as never,
      fileService as never,
    ),
  };
}

describe('OrdinaryWorkItemService run identity', () => {
  it('keeps ordinary parsing on the canonical idempotency key', async () => {
    const { repository, service } = target();

    await service.parsePdf({ documentVersionId: 'document-version-sb' }, ACTOR);

    expect(repository.reserve).toHaveBeenCalledWith(
      expect.objectContaining({ runKey: 'canonical' }),
    );
  });

  it('binds explicit development runs to the normalized UUID key', async () => {
    const { repository, resolver, service } = target();
    repository.loadTenantRunAuthorizationBinding.mockResolvedValue(null);

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
    expect(resolver.resolve).toHaveBeenCalledWith('document-version-sb', {
      requireCurrent: true,
    });
  });

  it('does not let the development role replace an owned DocumentVersion grant', async () => {
    const { repository, resolver, vertical, service } = target();
    repository.loadTenantRunAuthorizationBinding.mockResolvedValue(null);
    repository.loadTenantDocumentAuthorizationBinding
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        workItemId: 'WI-SAME-TENANT-EXISTING',
        tenantId: ACTOR.tenantId,
        requestId: 'REQ-SAME-TENANT-EXISTING',
        documentVersionId: 'document-version-sb',
        requestedByUserId: 'another-developer',
      });

    await expect(
      service.createDevelopmentRun(
        {
          documentVersionId: 'document-version-sb',
          developmentRunToken: '0f8fad5b-d9cb-469f-a165-70867728950e',
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });

    expect(
      repository.loadTenantDocumentAuthorizationBinding,
    ).toHaveBeenCalledWith({
      tenantId: ACTOR.tenantId,
      documentVersionId: 'document-version-sb',
      actorUserId: ACTOR.userId,
    });
    expect(vertical.authorizeExistingWorkItem).not.toHaveBeenCalled();
    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(repository.reserve).not.toHaveBeenCalled();
  });

  it('rejects an authenticated non-developer before DocumentVersion or WorkItem I/O', async () => {
    const { repository, resolver, service } = target();

    await expect(
      service.createDevelopmentRun(
        {
          documentVersionId: 'document-version-sb',
          developmentRunToken: '0f8fad5b-d9cb-469f-a165-70867728950e',
        },
        { ...ACTOR, roles: ['authenticated'] },
      ),
    ).rejects.toMatchObject({
      code: 'DEVELOPMENT_WORK_ITEM_ROLE_REQUIRED',
      statusCode: 403,
    });
    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(repository.reserve).not.toHaveBeenCalled();
  });

  it('fails closed for S1 acceptance before resolving any tenant or document', async () => {
    const { repository, resolver, vertical, service } = target();

    await expect(
      service.createDevelopmentAcceptanceRun({
        documentVersionId: 'document-version-sb',
        developmentRunToken: '0f8fad5b-d9cb-469f-a165-70867728950e',
      }),
    ).rejects.toMatchObject({
      code: 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE',
      statusCode: 503,
    });

    expect(repository.loadTenantRunAuthorizationBinding).not.toHaveBeenCalled();
    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(repository.reserve).not.toHaveBeenCalled();
    expect(vertical.runPdf).not.toHaveBeenCalled();
  });

  it('rejects a same-tenant outsider before DocumentVersion resolution or reserve', async () => {
    const { repository, resolver, vertical, service } = target();
    repository.loadTenantRunAuthorizationBinding.mockResolvedValue({
      workItemId: 'WI-OTHER-OWNER',
      tenantId: ACTOR.tenantId,
      requestId: 'REQ-OTHER-OWNER',
      documentVersionId: 'document-version-sb',
    });
    vertical.authorizeExistingWorkItem.mockRejectedValue(
      Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {
        code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
        statusCode: 404,
      }),
    );

    await expect(
      service.parsePdf(
        { documentVersionId: 'document-version-sb' },
        { ...ACTOR, userId: 'same-tenant-outsider' },
      ),
    ).rejects.toMatchObject({ code: 'CANONICAL_WORK_ITEM_NOT_FOUND' });

    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(repository.reserve).not.toHaveBeenCalled();
  });

  it('rejects cross-tenant and actor-tenant drift before resolver I/O', async () => {
    const { repository, resolver, service } = target();
    repository.loadTenantRunAuthorizationBinding.mockResolvedValue(null);
    repository.loadTenantDocumentAuthorizationBinding.mockResolvedValue(null);

    await expect(
      service.parsePdf(
        { documentVersionId: 'document-version-sb' },
        { ...ACTOR, tenantId: 'tenant-other', roles: ['authenticated'] },
      ),
    ).rejects.toMatchObject({ code: 'CANONICAL_WORK_ITEM_NOT_FOUND' });

    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(repository.reserve).not.toHaveBeenCalled();
  });

  it('authorizes selection ingest before any outer FileService pre-read', async () => {
    const { documentManagement, repository, resolver, fileService, service } =
      target();
    documentManagement.assertCanIngest.mockRejectedValue(
      Object.assign(new Error('Document action is not available.'), {
        code: 'DOCUMENT_ACTION_FORBIDDEN',
        statusCode: 403,
      }),
    );

    await expect(
      service.parsePdf(
        { selection: { bucketId: 'bucket-1', filePath: '/source.pdf' } },
        { ...ACTOR, roles: ['authenticated'] },
      ),
    ).rejects.toMatchObject({ code: 'DOCUMENT_ACTION_FORBIDDEN' });

    expect(
      documentManagement.ingestFileServiceSelection,
    ).not.toHaveBeenCalled();
    expect(fileService.from).not.toHaveBeenCalled();
    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(repository.reserve).not.toHaveBeenCalled();
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
