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
import { MiaodaFileServiceArtifactStore } from '../../server/modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js';

const ACTOR = {
  userId: 'engineer-1001',
  tenantId: 'tenant-2001',
  appId: 'app_17bzc551rsg',
  roles: ['authenticated', 'wiselink_development'],
  env: 'test',
};
const DEVELOPMENT_SCOPE = {
  principalId: 'service:openclaw-dev-real',
  appId: 'app_17bzc551rsg',
  tenantId: 'tenant-dev',
  environment: 'DEV' as const,
  documentVersionId: 'document-version-sb',
  developmentRunToken: '0f8fad5b-d9cb-469f-a165-70867728950e',
  authorizationFingerprint: `sha256:${'e'.repeat(64)}`,
};
const OAUTH_SESSION_ACTOR = {
  principalKind: 'FINAL_USER',
  transport: 'MIAODA_AUTHENTICATED_HTTP',
  canonicalSubject: {
    namespace: 'MIAODA_USER_ID',
    id: ACTOR.userId,
  },
  subjectDecision: {
    source: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
    applicationScopeId: ACTOR.appId,
    tenantId: ACTOR.tenantId,
    version: 'feishu-oauth-verified.v1',
    decidedAt: '2026-08-26T00:00:00.000Z',
  },
  tenantId: ACTOR.tenantId,
  applicationScopeId: ACTOR.appId,
  applicationScopeProvenance: 'HOST_CONFIGURED_MIAODA_APP_ID',
  workspaceId: null,
  workspaceProvenance: 'UNAVAILABLE',
  env: 'preview',
  platformRoles: [],
  identityProvenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
  feishuUserId: null,
  feishuOpenId: 'official-open-id',
  feishuIdentityProvenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
  sessionId: 'session-id',
  sessionRevision: 1,
  sessionProvenance: 'SERVER_OPAQUE_SESSION',
} as const;
const GATEWAY_ACTOR = {
  ...OAUTH_SESSION_ACTOR,
  subjectDecision: {
    ...OAUTH_SESSION_ACTOR.subjectDecision,
    source: 'MIAODA_GATEWAY_USER_CONTEXT',
    version: 'miaoda-hosted-native-sso.v1',
  },
  applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT',
  env: 'runtime',
  platformRoles: ['authenticated', 'wiselink_development'],
  identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT',
  feishuOpenId: null,
  feishuIdentityProvenance: 'UNAVAILABLE',
  sessionId: null,
  sessionRevision: null,
  sessionProvenance: 'UNAVAILABLE',
} as const;
const EXISTING_PARSE_AUTHORIZATION = {
  actor: ACTOR,
  decision: {
    action: 'PARSE_PDF' as const,
    allowed: true,
    actorFingerprint: `sha256:${'1'.repeat(64)}`,
    decisionId: 'decision-existing-work-item',
    decisionHash: `sha256:${'2'.repeat(64)}`,
    permissionSnapshotVersion: `sha256:${'3'.repeat(64)}`,
  },
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
    loadAuthorizationBinding: jest.fn(),
    loadTenantScopedProjection: jest.fn(),
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
    reopenRetryableParseFailure: jest.fn().mockResolvedValue(null),
    reserveAssessmentAction: jest.fn(),
    reserveDynamicEvaluationAction: jest.fn(),
    reserveOverallSynthesisAction: jest.fn(),
  };
  const vertical = {
    authorizeExistingWorkItem: jest
      .fn()
      .mockResolvedValue(EXISTING_PARSE_AUTHORIZATION),
    runPdf: jest.fn().mockResolvedValue(verticalResult()),
    runPdfWithExistingAuthorization: jest
      .fn()
      .mockResolvedValue(verticalResult()),
    runPdfWithDevelopmentScope: jest.fn().mockResolvedValue(verticalResult()),
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

function verticalResult() {
  return {
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
  };
}

describe('OrdinaryWorkItemService run identity', () => {
  beforeEach(() => {
    jest.mocked(MiaodaFileServiceArtifactStore).mockImplementation(
      () =>
        ({
          readSelection: jest.fn().mockResolvedValue({
            sha256: 'e'.repeat(64),
            byteLength: 2048,
            providerObjectId: 'uploaded-object',
          }),
        }) as never,
    );
  });

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

  it('requires the single development route for a hosted FileService selection', async () => {
    const targetValue = target();
    const previousSandbox = process.env.SANDBOX_ID;
    const previousLocal = process.env.MIAODA_LOCAL_DEV;
    process.env.SANDBOX_ID = 'unit-hosted-sandbox';
    delete process.env.MIAODA_LOCAL_DEV;
    try {
      await expect(
        targetValue.service.parsePdf(
          {
            selection: {
              bucketId: 'bucket-default',
              filePath:
                'wiselink/dev-intake/0f8fad5b-d9cb-469f-a165-70867728950e/source.pdf',
            },
          },
          { ...ACTOR, env: 'preview' },
        ),
      ).rejects.toMatchObject({
        code: 'CANONICAL_DEVELOPMENT_RUN_REQUIRED',
        statusCode: 400,
      });
    } finally {
      restoreProcessEnv('SANDBOX_ID', previousSandbox);
      restoreProcessEnv('MIAODA_LOCAL_DEV', previousLocal);
    }
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

  it('runs one exact service-scoped development WorkItem without final-user impersonation', async () => {
    const { repository, resolver, vertical, service } = target();

    await expect(
      service.createDevelopmentAcceptanceRun(
        {
          documentVersionId: 'document-version-sb',
          developmentRunToken: '0f8fad5b-d9cb-469f-a165-70867728950e',
        },
        DEVELOPMENT_SCOPE,
      ),
    ).resolves.toMatchObject({
      workItemCreated: true,
      actionAttemptId: 'ATT-NEW-SB',
    });

    expect(repository.loadTenantRunAuthorizationBinding).not.toHaveBeenCalled();
    expect(resolver.resolve).toHaveBeenCalledWith('document-version-sb', {
      requireCurrent: true,
    });
    expect(repository.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-dev',
        actorUserId: 'service:openclaw-dev-real',
        runKey: 'dev:0f8fad5b-d9cb-469f-a165-70867728950e',
      }),
    );
    expect(vertical.runPdf).not.toHaveBeenCalled();
    expect(vertical.runPdfWithDevelopmentScope).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: 'WI-NEW-SB',
        source: expect.objectContaining({
          documentVersionId: 'document-version-sb',
        }),
      }),
      expect.objectContaining({
        userId: 'service:openclaw-dev-real',
        tenantId: 'tenant-dev',
        roles: [],
        env: 'dev',
      }),
      DEVELOPMENT_SCOPE,
    );
  });

  it('ingests an owned hosted selection, reserves a DEV WorkItem, and returns the vertical result', async () => {
    const targetValue = target();
    targetValue.documentManagement.ingestFileServiceSelection.mockResolvedValue(
      {
        documentVersionId: 'document-version-sb',
      },
    );
    const previousSandbox = process.env.SANDBOX_ID;
    const previousLocal = process.env.MIAODA_LOCAL_DEV;
    process.env.SANDBOX_ID = 'unit-hosted-sandbox';
    delete process.env.MIAODA_LOCAL_DEV;
    try {
      const result = await targetValue.service.createDevelopmentRun(
        {
          selection: {
            bucketId: 'bucket-default',
            filePath:
              'wiselink/dev-intake/0f8fad5b-d9cb-469f-a165-70867728950e/source.pdf',
          },
          developmentRunToken: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
          query: 'applicability',
        },
        { ...ACTOR, env: 'preview' },
      );

      expect(result).toMatchObject({
        workItemCreated: true,
        workItemReused: false,
        actionAttemptId: 'ATT-NEW-SB',
        result: { workItem: { workItemId: 'WI-NEW-SB' } },
      });
      expect(
        targetValue.documentManagement.assertCanIngest,
      ).toHaveBeenCalledWith(
        {
          actorUserId: ACTOR.userId,
          tenantId: ACTOR.tenantId,
          roles: ACTOR.roles,
          appId: ACTOR.appId,
          env: 'preview',
        },
        {
          bucketId: 'bucket-default',
          filePath:
            'wiselink/dev-intake/0f8fad5b-d9cb-469f-a165-70867728950e/source.pdf',
        },
      );
      expect(
        targetValue.documentManagement.ingestFileServiceSelection,
      ).toHaveBeenCalledTimes(1);
      expect(targetValue.repository.reserve).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: ACTOR.tenantId,
          actorUserId: ACTOR.userId,
          documentVersionId: 'document-version-sb',
          sourceFileSha256: 'a'.repeat(64),
          sourceByteLength: 1024,
          runKey: 'dev:7c9e6679-7425-40de-944b-e07fc1f90ae7',
        }),
      );
      expect(
        targetValue.repository.loadTenantRunAuthorizationBinding,
      ).not.toHaveBeenCalled();
      expect(targetValue.vertical.runPdf).toHaveBeenCalledTimes(1);
    } finally {
      restoreProcessEnv('SANDBOX_ID', previousSandbox);
      restoreProcessEnv('MIAODA_LOCAL_DEV', previousLocal);
    }
  });

  it('uses only the verified OAuth session actor for a same-user FileService selection', async () => {
    const targetValue = target();
    targetValue.documentManagement.ingestFileServiceSelection.mockResolvedValue(
      { documentVersionId: 'document-version-sb' },
    );
    const previousSandbox = process.env.SANDBOX_ID;
    const previousLocal = process.env.MIAODA_LOCAL_DEV;
    process.env.SANDBOX_ID = 'unit-hosted-sandbox';
    delete process.env.MIAODA_LOCAL_DEV;
    try {
      await expect(
        targetValue.service.createOauthSessionDevelopmentRun(
          {
            selection: {
              bucketId: 'bucket-default',
              filePath:
                'wiselink/dev-intake/0f8fad5b-d9cb-469f-a165-70867728950e/source.pdf',
            },
            developmentRunToken: '22222222-2222-4222-8222-222222222222',
            query: 'applicability',
          },
          OAUTH_SESSION_ACTOR,
          GATEWAY_ACTOR,
        ),
      ).resolves.toMatchObject({
        workItemCreated: true,
        result: { workItem: { workItemId: 'WI-NEW-SB' } },
      });

      expect(
        targetValue.documentManagement.assertCanIngest,
      ).toHaveBeenCalledWith(
        {
          actorUserId: ACTOR.userId,
          tenantId: ACTOR.tenantId,
          roles: ['authenticated', 'wiselink_development'],
          appId: ACTOR.appId,
          env: 'runtime',
          runtimeIngestAuthority: {
            mode: 'HOSTED_OAUTH_SESSION_DEVELOPMENT_RUN',
            actorUserId: ACTOR.userId,
            tenantId: ACTOR.tenantId,
            appId: ACTOR.appId,
            identityProvenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
            sessionProvenance: 'SERVER_OPAQUE_SESSION',
          },
        },
        {
          bucketId: 'bucket-default',
          filePath:
            'wiselink/dev-intake/0f8fad5b-d9cb-469f-a165-70867728950e/source.pdf',
        },
      );
      expect(targetValue.resolver.resolve).toHaveBeenCalledWith(
        'document-version-sb',
        {
          requireCurrent: true,
          expectedCreatorUserId: ACTOR.userId,
        },
      );
      expect(targetValue.repository.reserve).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: ACTOR.tenantId,
          actorUserId: ACTOR.userId,
          documentVersionId: 'document-version-sb',
          runKey: 'dev:22222222-2222-4222-8222-222222222222',
        }),
      );
    } finally {
      restoreProcessEnv('SANDBOX_ID', previousSandbox);
      restoreProcessEnv('MIAODA_LOCAL_DEV', previousLocal);
    }
  });

  it('reopens only a previously classified retryable parse failure on the same WorkItem', async () => {
    const targetValue = target();
    targetValue.documentManagement.ingestFileServiceSelection.mockResolvedValue(
      { documentVersionId: 'document-version-sb' },
    );
    targetValue.repository.reserve.mockResolvedValue({
      workItemId: 'WI-NEW-SB',
      requestId: 'REQ-NEW-SB',
      attemptId: 'ATT-FIRST-FAILED',
      created: false,
    });
    targetValue.repository.loadTenantScopedProjection.mockResolvedValue({
      row: { workItemId: 'WI-NEW-SB' },
      projection: {
        phase: 'FAILED',
        failure: { failureCode: 'SOURCE_BINDING_FAILED' },
      },
    });
    targetValue.repository.reopenRetryableParseFailure.mockResolvedValue({
      attemptId: 'ATT-RETRY-2',
      attemptNo: 2,
    });

    await expect(
      targetValue.service.createOauthSessionDevelopmentRun(
        {
          selection: {
            bucketId: 'bucket-default',
            filePath:
              'wiselink/dev-intake/22222222-2222-4222-8222-222222222222/source.pdf',
          },
          developmentRunToken: '22222222-2222-4222-8222-222222222222',
          query: 'applicability',
        },
        OAUTH_SESSION_ACTOR,
        GATEWAY_ACTOR,
      ),
    ).resolves.toMatchObject({
      workItemCreated: false,
      workItemReused: true,
      actionAttemptId: 'ATT-RETRY-2',
    });

    expect(
      targetValue.repository.reopenRetryableParseFailure,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: 'WI-NEW-SB',
        requestId: 'REQ-NEW-SB',
        documentVersionId: 'document-version-sb',
        runKey: 'dev:22222222-2222-4222-8222-222222222222',
      }),
    );
    expect(
      targetValue.vertical.runPdfWithExistingAuthorization,
    ).toHaveBeenCalledWith(expect.any(Object), EXISTING_PARSE_AUTHORIZATION);
  });

  it('does not rebind authorization for an already completed reservation replay', async () => {
    const targetValue = target();
    targetValue.documentManagement.ingestFileServiceSelection.mockResolvedValue(
      { documentVersionId: 'document-version-sb' },
    );
    targetValue.repository.reserve.mockResolvedValue({
      workItemId: 'WI-NEW-SB',
      requestId: 'REQ-NEW-SB',
      attemptId: 'ATT-SUCCEEDED',
      created: false,
    });
    targetValue.repository.loadTenantScopedProjection.mockResolvedValue({
      row: { workItemId: 'WI-NEW-SB' },
      projection: { phase: 'CANDIDATE_READBACK_VERIFIED', failure: null },
    });

    await targetValue.service.createOauthSessionDevelopmentRun(
      {
        selection: {
          bucketId: 'bucket-default',
          filePath:
            'wiselink/dev-intake/22222222-2222-4222-8222-222222222222/source.pdf',
        },
        developmentRunToken: '22222222-2222-4222-8222-222222222222',
      },
      OAUTH_SESSION_ACTOR,
      GATEWAY_ACTOR,
    );

    expect(
      targetValue.vertical.runPdfWithExistingAuthorization,
    ).not.toHaveBeenCalled();
    expect(targetValue.vertical.runPdf).toHaveBeenCalledTimes(1);
  });

  it('retries the exact failed WorkItem from server-owned binding without a new upload token', async () => {
    const targetValue = target();
    targetValue.repository.loadAuthorizationBinding.mockResolvedValue({
      workItemId: 'WI-NEW-SB',
      requestId: 'REQ-NEW-SB',
      documentVersionId: 'document-version-sb',
      runKey: 'dev:22222222-2222-4222-8222-222222222222',
    });
    targetValue.repository.loadTenantScopedProjection.mockResolvedValue({
      row: { workItemId: 'WI-NEW-SB' },
      projection: {
        phase: 'FAILED',
        failure: { failureCode: 'SOURCE_BINDING_FAILED' },
      },
    });
    targetValue.repository.reserve.mockResolvedValue({
      workItemId: 'WI-NEW-SB',
      requestId: 'REQ-NEW-SB',
      attemptId: 'ATT-FIRST-FAILED',
      created: false,
    });
    targetValue.repository.reopenRetryableParseFailure.mockResolvedValue({
      attemptId: 'ATT-RETRY-2',
      attemptNo: 2,
    });

    await expect(
      targetValue.service.retryOauthSessionDevelopmentRun(
        'WI-NEW-SB',
        OAUTH_SESSION_ACTOR,
        GATEWAY_ACTOR,
      ),
    ).resolves.toMatchObject({
      workItemCreated: false,
      workItemReused: true,
      actionAttemptId: 'ATT-RETRY-2',
    });

    expect(
      targetValue.repository.loadAuthorizationBinding,
    ).toHaveBeenCalledWith({
      workItemId: 'WI-NEW-SB',
      tenantId: ACTOR.tenantId,
      actorUserId: ACTOR.userId,
    });
    expect(targetValue.vertical.authorizeExistingWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: 'WI-NEW-SB',
        requestId: 'REQ-NEW-SB',
        documentVersionId: 'document-version-sb',
      }),
    );
    expect(
      targetValue.documentManagement.assertCanIngest,
    ).not.toHaveBeenCalled();
    expect(
      targetValue.documentManagement.ingestFileServiceSelection,
    ).not.toHaveBeenCalled();
    expect(targetValue.repository.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        documentVersionId: 'document-version-sb',
        runKey: 'dev:22222222-2222-4222-8222-222222222222',
      }),
    );
    expect(
      targetValue.vertical.runPdfWithExistingAuthorization,
    ).toHaveBeenCalledWith(expect.any(Object), EXISTING_PARSE_AUTHORIZATION);
  });

  it('resumes the exact pending retry attempt after a pre-parse authorization collision', async () => {
    const targetValue = target();
    targetValue.repository.loadAuthorizationBinding.mockResolvedValue({
      workItemId: 'WI-NEW-SB',
      requestId: 'REQ-NEW-SB',
      documentVersionId: 'document-version-sb',
      runKey: 'dev:22222222-2222-4222-8222-222222222222',
    });
    targetValue.repository.loadTenantScopedProjection.mockResolvedValue({
      row: { workItemId: 'WI-NEW-SB' },
      projection: { phase: 'PARSE_REQUESTED', failure: null },
    });
    targetValue.repository.reserve.mockResolvedValue({
      workItemId: 'WI-NEW-SB',
      requestId: 'REQ-NEW-SB',
      attemptId: 'ATT-FIRST-FAILED',
      created: false,
    });
    targetValue.repository.reopenRetryableParseFailure.mockResolvedValue({
      attemptId: 'ATT-RETRY-2',
      attemptNo: 2,
    });

    await expect(
      targetValue.service.retryOauthSessionDevelopmentRun(
        'WI-NEW-SB',
        OAUTH_SESSION_ACTOR,
        GATEWAY_ACTOR,
      ),
    ).resolves.toMatchObject({
      workItemCreated: false,
      workItemReused: true,
      actionAttemptId: 'ATT-RETRY-2',
    });

    expect(
      targetValue.repository.reopenRetryableParseFailure,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: 'WI-NEW-SB',
        requestId: 'REQ-NEW-SB',
        authorization: expect.objectContaining({
          actorFingerprint:
            EXISTING_PARSE_AUTHORIZATION.decision.actorFingerprint,
          decisionHash: EXISTING_PARSE_AUTHORIZATION.decision.decisionHash,
          permissionSnapshotVersion:
            EXISTING_PARSE_AUTHORIZATION.decision.permissionSnapshotVersion,
        }),
      }),
    );
    expect(
      targetValue.vertical.runPdfWithExistingAuthorization,
    ).toHaveBeenCalledWith(expect.any(Object), EXISTING_PARSE_AUTHORIZATION);
    expect(
      targetValue.documentManagement.ingestFileServiceSelection,
    ).not.toHaveBeenCalled();
  });

  it('hides a retry target that is not owned by the current session actor', async () => {
    const targetValue = target();
    targetValue.repository.loadAuthorizationBinding.mockResolvedValue(null);

    await expect(
      targetValue.service.retryOauthSessionDevelopmentRun(
        'WI-OTHER',
        OAUTH_SESSION_ACTOR,
        GATEWAY_ACTOR,
      ),
    ).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });

    expect(
      targetValue.vertical.authorizeExistingWorkItem,
    ).not.toHaveBeenCalled();
    expect(
      targetValue.repository.loadTenantScopedProjection,
    ).not.toHaveBeenCalled();
    expect(targetValue.resolver.resolve).not.toHaveBeenCalled();
    expect(targetValue.repository.reserve).not.toHaveBeenCalled();
    expect(targetValue.vertical.runPdf).not.toHaveBeenCalled();
    expect(
      targetValue.vertical.runPdfWithExistingAuthorization,
    ).not.toHaveBeenCalled();
  });

  it('performs no retry mutation when fresh authorization is denied', async () => {
    const targetValue = target();
    targetValue.repository.loadAuthorizationBinding.mockResolvedValue({
      workItemId: 'WI-NEW-SB',
      requestId: 'REQ-NEW-SB',
      documentVersionId: 'document-version-sb',
      runKey: 'dev:22222222-2222-4222-8222-222222222222',
    });
    targetValue.vertical.authorizeExistingWorkItem.mockRejectedValue(
      Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {
        code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
        statusCode: 404,
      }),
    );

    await expect(
      targetValue.service.retryOauthSessionDevelopmentRun(
        'WI-NEW-SB',
        OAUTH_SESSION_ACTOR,
        GATEWAY_ACTOR,
      ),
    ).rejects.toMatchObject({ code: 'CANONICAL_WORK_ITEM_NOT_FOUND' });

    expect(
      targetValue.repository.loadTenantScopedProjection,
    ).not.toHaveBeenCalled();
    expect(targetValue.repository.reserve).not.toHaveBeenCalled();
    expect(
      targetValue.repository.reopenRetryableParseFailure,
    ).not.toHaveBeenCalled();
    expect(
      targetValue.vertical.runPdfWithExistingAuthorization,
    ).not.toHaveBeenCalled();
  });

  it('rejects a non-retryable projection before resolver, reserve, or parse I/O', async () => {
    const targetValue = target();
    targetValue.repository.loadAuthorizationBinding.mockResolvedValue({
      workItemId: 'WI-NEW-SB',
      requestId: 'REQ-NEW-SB',
      documentVersionId: 'document-version-sb',
      runKey: 'dev:22222222-2222-4222-8222-222222222222',
    });
    targetValue.repository.loadTenantScopedProjection.mockResolvedValue({
      row: { workItemId: 'WI-NEW-SB' },
      projection: {
        phase: 'FAILED',
        failure: { failureCode: 'PRODUCER_EXECUTION_FAILED' },
      },
    });

    await expect(
      targetValue.service.retryOauthSessionDevelopmentRun(
        'WI-NEW-SB',
        OAUTH_SESSION_ACTOR,
        GATEWAY_ACTOR,
      ),
    ).rejects.toMatchObject({
      code: 'WORK_ITEM_RETRY_NOT_AVAILABLE',
      statusCode: 409,
    });

    expect(targetValue.resolver.resolve).not.toHaveBeenCalled();
    expect(targetValue.repository.reserve).not.toHaveBeenCalled();
    expect(
      targetValue.repository.reopenRetryableParseFailure,
    ).not.toHaveBeenCalled();
    expect(targetValue.vertical.runPdf).not.toHaveBeenCalled();
    expect(
      targetValue.vertical.runPdfWithExistingAuthorization,
    ).not.toHaveBeenCalled();
  });

  it('does not parse when the retry CAS is no longer available', async () => {
    const targetValue = target();
    targetValue.repository.loadAuthorizationBinding.mockResolvedValue({
      workItemId: 'WI-NEW-SB',
      requestId: 'REQ-NEW-SB',
      documentVersionId: 'document-version-sb',
      runKey: 'dev:22222222-2222-4222-8222-222222222222',
    });
    targetValue.repository.loadTenantScopedProjection.mockResolvedValue({
      row: { workItemId: 'WI-NEW-SB' },
      projection: {
        phase: 'FAILED',
        failure: { failureCode: 'SOURCE_BINDING_FAILED' },
      },
    });
    targetValue.repository.reserve.mockResolvedValue({
      workItemId: 'WI-NEW-SB',
      requestId: 'REQ-NEW-SB',
      attemptId: 'ATT-FIRST-FAILED',
      created: false,
    });
    targetValue.repository.reopenRetryableParseFailure.mockResolvedValue(null);

    await expect(
      targetValue.service.retryOauthSessionDevelopmentRun(
        'WI-NEW-SB',
        OAUTH_SESSION_ACTOR,
        GATEWAY_ACTOR,
      ),
    ).rejects.toMatchObject({
      code: 'WORK_ITEM_RETRY_NOT_AVAILABLE',
      statusCode: 409,
    });

    expect(targetValue.vertical.runPdf).not.toHaveBeenCalled();
    expect(
      targetValue.vertical.runPdfWithExistingAuthorization,
    ).not.toHaveBeenCalled();
  });

  it('rejects OAuth development create without the native development role', async () => {
    const targetValue = target();
    await expect(
      targetValue.service.createOauthSessionDevelopmentRun(
        {
          documentVersionId: 'document-version-sb',
          developmentRunToken: '22222222-2222-4222-8222-222222222222',
        },
        OAUTH_SESSION_ACTOR,
        { ...GATEWAY_ACTOR, platformRoles: ['authenticated'] },
      ),
    ).rejects.toMatchObject({
      code: 'DEVELOPMENT_WORK_ITEM_ROLE_REQUIRED',
      statusCode: 403,
    });
    expectNoOrdinaryRunIo(targetValue);
  });

  it('rejects a gateway user that does not match the OAuth session mapping', async () => {
    const targetValue = target();
    await expect(
      targetValue.service.createOauthSessionDevelopmentRun(
        {
          documentVersionId: 'document-version-sb',
          developmentRunToken: '22222222-2222-4222-8222-222222222222',
        },
        OAUTH_SESSION_ACTOR,
        {
          ...GATEWAY_ACTOR,
          canonicalSubject: {
            ...GATEWAY_ACTOR.canonicalSubject,
            id: 'different-miaoda-user',
          },
        },
      ),
    ).rejects.toMatchObject({
      code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
      statusCode: 503,
    });
    expectNoOrdinaryRunIo(targetValue);
  });

  it('rejects a runtime development create before every downstream I/O', async () => {
    const targetValue = target();
    const previousSandbox = process.env.SANDBOX_ID;
    const previousLocal = process.env.MIAODA_LOCAL_DEV;
    process.env.SANDBOX_ID = 'unit-hosted-sandbox';
    delete process.env.MIAODA_LOCAL_DEV;
    try {
      await expect(
        targetValue.service.createDevelopmentRun(
          {
            selection: {
              bucketId: 'bucket-default',
              filePath:
                'wiselink/dev-intake/0f8fad5b-d9cb-469f-a165-70867728950e/source.pdf',
            },
            developmentRunToken: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
          },
          { ...ACTOR, env: 'runtime' },
        ),
      ).rejects.toMatchObject({
        code: 'DEVELOPMENT_WORK_ITEM_PREVIEW_REQUIRED',
        statusCode: 403,
      });
    } finally {
      restoreProcessEnv('SANDBOX_ID', previousSandbox);
      restoreProcessEnv('MIAODA_LOCAL_DEV', previousLocal);
    }
    expectNoOrdinaryRunIo(targetValue);
  });

  it('rejects a mismatched development scope before every resolver or write', async () => {
    const targetValue = target();
    await expect(
      targetValue.service.createDevelopmentAcceptanceRun(
        {
          documentVersionId: 'document-version-sb',
          developmentRunToken: '0f8fad5b-d9cb-469f-a165-70867728950e',
        },
        {
          ...DEVELOPMENT_SCOPE,
          documentVersionId: 'document-version-other',
        },
      ),
    ).rejects.toMatchObject({
      code: 'CANONICAL_DEVELOPMENT_SCOPE_NOT_FOUND',
      statusCode: 404,
    });
    expectNoOrdinaryRunIo(targetValue);
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
    targetValue.repository.loadAuthorizationBinding,
  ).not.toHaveBeenCalled();
  expect(
    targetValue.repository.loadTenantScopedProjection,
  ).not.toHaveBeenCalled();
  expect(
    targetValue.repository.loadTenantRunAuthorizationBinding,
  ).not.toHaveBeenCalled();
  expect(
    targetValue.repository.loadTenantDocumentAuthorizationBinding,
  ).not.toHaveBeenCalled();
  expect(targetValue.repository.reserve).not.toHaveBeenCalled();
  expect(
    targetValue.repository.reopenRetryableParseFailure,
  ).not.toHaveBeenCalled();
  expect(targetValue.repository.reserveAssessmentAction).not.toHaveBeenCalled();
  expect(
    targetValue.repository.reserveDynamicEvaluationAction,
  ).not.toHaveBeenCalled();
  expect(
    targetValue.repository.reserveOverallSynthesisAction,
  ).not.toHaveBeenCalled();
  expect(targetValue.vertical.authorizeExistingWorkItem).not.toHaveBeenCalled();
  expect(targetValue.vertical.runPdf).not.toHaveBeenCalled();
  expect(
    targetValue.vertical.runPdfWithExistingAuthorization,
  ).not.toHaveBeenCalled();
  expect(
    targetValue.vertical.runPdfWithDevelopmentScope,
  ).not.toHaveBeenCalled();
}

function restoreProcessEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
