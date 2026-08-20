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
    reserveAssessmentAction: jest.fn(),
    reserveDynamicEvaluationAction: jest.fn(),
    reserveOverallSynthesisAction: jest.fn(),
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
  it('rejects a forged selection before every DM, FileService, binding, resolver, reserve, attempt, and vertical I/O', async () => {
    const targetValue = target();

    await expect(
      targetValue.service.parsePdf(
        { selection: { bucketId: 'bucket-1', filePath: '/source.pdf' } },
        ACTOR,
      ),
    ).rejects.toMatchObject({
      code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
      statusCode: 503,
      denialSource: 'MIAODA_BROWSER_UNAVAILABLE_ADAPTER',
    });

    expectNoOrdinaryRunIo(targetValue);
  });

  it('rejects an explicit development DocumentVersion before the role gate and every downstream I/O', async () => {
    const targetValue = target();

    await expect(
      targetValue.service.createDevelopmentRun(
        {
          documentVersionId: 'document-version-sb',
          developmentRunToken: '0f8fad5b-d9cb-469f-a165-70867728950e',
        },
        { ...ACTOR, roles: ['authenticated', 'wiselink_development'] },
      ),
    ).rejects.toMatchObject({
      code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
      statusCode: 503,
      denialSource: 'MIAODA_BROWSER_UNAVAILABLE_ADAPTER',
    });

    expectNoOrdinaryRunIo(targetValue);
  });

  it('does not let role presence or absence change the unavailable identity result', async () => {
    const targetValue = target();

    await expect(
      targetValue.service.createDevelopmentRun(
        {
          documentVersionId: 'document-version-sb',
          developmentRunToken: 'not-even-normalized',
        },
        { ...ACTOR, roles: [] },
      ),
    ).rejects.toMatchObject({
      code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
      statusCode: 503,
    });

    expectNoOrdinaryRunIo(targetValue);
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

});

function expectNoOrdinaryRunIo(targetValue: ReturnType<typeof target>): void {
  expect(targetValue.documentManagement.assertCanIngest).not.toHaveBeenCalled();
  expect(
    targetValue.documentManagement.ingestFileServiceSelection,
  ).not.toHaveBeenCalled();
  expect(targetValue.fileService.from).not.toHaveBeenCalled();
  expect(targetValue.resolver.resolve).not.toHaveBeenCalled();
  expect(
    targetValue.repository.loadTenantRunAuthorizationBinding,
  ).not.toHaveBeenCalled();
  expect(
    targetValue.repository.loadTenantDocumentAuthorizationBinding,
  ).not.toHaveBeenCalled();
  expect(targetValue.repository.reserve).not.toHaveBeenCalled();
  expect(
    targetValue.repository.reserveAssessmentAction,
  ).not.toHaveBeenCalled();
  expect(
    targetValue.repository.reserveDynamicEvaluationAction,
  ).not.toHaveBeenCalled();
  expect(
    targetValue.repository.reserveOverallSynthesisAction,
  ).not.toHaveBeenCalled();
  expect(
    targetValue.vertical.authorizeExistingWorkItem,
  ).not.toHaveBeenCalled();
  expect(targetValue.vertical.runPdf).not.toHaveBeenCalled();
}
