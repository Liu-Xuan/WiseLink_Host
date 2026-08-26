jest.mock(
  '../../server/modules/document-management/src/hosted/documentManagementHostedCore.js',
  () => ({ DocumentManagementHostedCore: jest.fn() }),
);
jest.mock(
  '../../server/modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js',
  () => ({ MiaodaFileServiceArtifactStore: jest.fn() }),
);

import { OrdinaryDocumentManagementAuthorizer } from '../../server/modules/document-management-runtime/ordinary-document-management-authorizer';
import { DocumentManagementHostedCore } from '../../server/modules/document-management/src/hosted/documentManagementHostedCore.js';
import {
  DocumentManagementHostedService,
  type HostedRequestContext,
} from '../../server/modules/document-management/src/hosted/nest/document-management-hosted.service';

const creatorContext = {
  actorUserId: 'user-creator',
  tenantId: 'tenant-a',
  roles: [] as string[],
  appId: 'app_17bzc551rsg',
  env: 'preview',
};

const OWNED_PATH =
  'wiselink/dev-intake/0f8fad5b-d9cb-469f-a165-70867728950e/source.pdf';

function runtimeContext(
  overrides: Partial<HostedRequestContext> = {},
): HostedRequestContext {
  return {
    ...creatorContext,
    env: 'runtime',
    roles: ['authenticated', 'wiselink_development'],
    runtimeIngestAuthority: {
      mode: 'HOSTED_OAUTH_SESSION_DEVELOPMENT_RUN',
      actorUserId: creatorContext.actorUserId,
      tenantId: creatorContext.tenantId,
      appId: creatorContext.appId,
      identityProvenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
      sessionProvenance: 'SERVER_OPAQUE_SESSION',
    },
    ...overrides,
  };
}

function binding() {
  return {
    workItemId: 'WI-1',
    tenantId: creatorContext.tenantId,
    requestId: 'REQ-1',
    documentId: 'DOC-1',
    documentVersionId: 'DV-1',
    requestedByUserId: creatorContext.actorUserId,
    runKey: 'canonical',
  };
}

describe('ordinary document-management authorization', () => {
  it('allows a verified WorkItem creator to read a DocumentVersion', async () => {
    const repository = {
      loadTenantDocumentAuthorizationBinding: jest
        .fn()
        .mockResolvedValue(binding()),
    };
    const authorizer = new OrdinaryDocumentManagementAuthorizer(
      repository as never,
      {} as never,
    );

    await expect(
      authorizer.assertCanRead({
        ...creatorContext,
        action: 'DOCUMENT_READ',
        documentVersionId: 'DV-1',
      }),
    ).resolves.toBeUndefined();
    expect(
      repository.loadTenantDocumentAuthorizationBinding,
    ).toHaveBeenCalledWith({
      tenantId: creatorContext.tenantId,
      documentVersionId: 'DV-1',
      actorUserId: creatorContext.actorUserId,
    });
  });

  it.each([
    ['same-tenant outsider', { ...creatorContext, actorUserId: 'outsider' }],
    ['cross-tenant actor', { ...creatorContext, tenantId: 'tenant-b' }],
    [
      'development-role outsider',
      {
        ...creatorContext,
        actorUserId: 'outsider',
        roles: ['wiselink_development'],
      },
    ],
  ])(
    'denies %s without treating a role as object ownership',
    async (_label, context) => {
      const repository = {
        loadTenantDocumentAuthorizationBinding: jest
          .fn()
          .mockResolvedValue(null),
      };
      const authorizer = new OrdinaryDocumentManagementAuthorizer(
        repository as never,
        {} as never,
      );

      await expect(
        authorizer.assertCanRead({
          ...context,
          action: 'DOCUMENT_READ',
          documentVersionId: 'DV-1',
        }),
      ).rejects.toMatchObject({
        code: 'DOCUMENT_VERSION_NOT_FOUND',
        statusCode: 404,
      });
    },
  );

  it('grants only a development-role selection owned by the same FileService user', async () => {
    const metadata = {
      bucketID: 'bucket-default',
      filePath: OWNED_PATH,
      createdBy: { userID: creatorContext.actorUserId },
    };
    const fileService = fileServiceTarget(metadata);
    const authorizer = new OrdinaryDocumentManagementAuthorizer(
      {} as never,
      fileService as never,
    );

    await expect(
      authorizer.assertCanIngest({
        ...creatorContext,
        roles: ['wiselink_development'],
        action: 'DOCUMENT_INGEST',
        selection: { bucketId: 'bucket-default', filePath: OWNED_PATH },
      }),
    ).resolves.toBeUndefined();
    expect(fileService.from).toHaveBeenCalledWith('bucket-default');
    expect(fileService.getFileMetadata).toHaveBeenCalledWith(OWNED_PATH);
  });

  it.each([
    [
      'wrong bucket',
      'bucket-other',
      {
        bucketID: 'bucket-default',
        filePath: OWNED_PATH,
        createdBy: { userID: creatorContext.actorUserId },
      },
    ],
    [
      'wrong owner',
      'bucket-default',
      {
        bucketID: 'bucket-default',
        filePath: OWNED_PATH,
        createdBy: { userID: 'another-user' },
      },
    ],
    [
      'unsafe numeric owner identity',
      'bucket-default',
      {
        bucketID: 'bucket-default',
        filePath: OWNED_PATH,
        createdBy: { userID: Number.MAX_SAFE_INTEGER + 1 },
      },
    ],
  ])(
    'rejects %s without entering document ingest',
    async (_label, bucketId, metadata) => {
      const fileService = fileServiceTarget(metadata);
      const authorizer = new OrdinaryDocumentManagementAuthorizer(
        {} as never,
        fileService as never,
      );
      await expect(
        authorizer.assertCanIngest({
          ...creatorContext,
          roles: ['wiselink_development'],
          action: 'DOCUMENT_INGEST',
          selection: { bucketId, filePath: OWNED_PATH },
        }),
      ).rejects.toMatchObject({ code: 'DOCUMENT_ACTION_FORBIDDEN' });
    },
  );

  it('does not let the development role bypass the isolated DEV path', async () => {
    const fileService = fileServiceTarget(null);
    const authorizer = new OrdinaryDocumentManagementAuthorizer(
      {} as never,
      fileService as never,
    );

    await expect(
      authorizer.assertCanIngest({
        ...creatorContext,
        roles: ['wiselink_development'],
        action: 'DOCUMENT_INGEST',
        selection: { bucketId: 'bucket-default', filePath: 'source.pdf' },
      }),
    ).rejects.toMatchObject({ code: 'DOCUMENT_ACTION_FORBIDDEN' });
    await expect(
      authorizer.assertCanIngest({
        ...creatorContext,
        action: 'DOCUMENT_INGEST',
        selection: { bucketId: 'bucket-default', filePath: OWNED_PATH },
      }),
    ).rejects.toMatchObject({ code: 'DOCUMENT_ACTION_FORBIDDEN' });
  });

  it.each(['ingest', 'authorize-ingest', 'read'] as const)(
    'rejects local hosted-service %s before authorizer, Catalog, or FileService I/O',
    async (operation) => {
      const fileService = { from: jest.fn() };
      const catalog = {
        readDocumentVersion: jest.fn(),
        readFamily: jest.fn(),
      };
      const authorizer = {
        assertCanIngest: jest.fn(),
        assertCanRead: jest.fn(),
      };
      const service = new DocumentManagementHostedService(
        fileService as never,
        catalog as never,
        authorizer,
      );

      const previousLocal = process.env.MIAODA_LOCAL_DEV;
      const previousSandbox = process.env.SANDBOX_ID;
      process.env.MIAODA_LOCAL_DEV = '1';
      process.env.SANDBOX_ID = 'unit-hosted-sandbox';
      const context = { ...creatorContext };
      const invoke = (): unknown => {
        if (operation === 'ingest') {
          return service.ingestFileServiceSelection({}, context);
        }
        if (operation === 'authorize-ingest') {
          return service.assertCanIngest(context, {
            bucketId: 'bucket-default',
            filePath: OWNED_PATH,
          });
        }
        return service.getDocumentVersion('DV-1', context);
      };

      try {
        await expect(Promise.resolve().then(invoke)).rejects.toMatchObject({
          code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
          statusCode: 503,
          denialSource: 'MIAODA_BROWSER_UNAVAILABLE_ADAPTER',
        });
      } finally {
        restoreProcessEnv('MIAODA_LOCAL_DEV', previousLocal);
        restoreProcessEnv('SANDBOX_ID', previousSandbox);
      }
      expect(authorizer.assertCanIngest).not.toHaveBeenCalled();
      expect(authorizer.assertCanRead).not.toHaveBeenCalled();
      expect(catalog.readDocumentVersion).not.toHaveBeenCalled();
      expect(catalog.readFamily).not.toHaveBeenCalled();
      expect(fileService.from).not.toHaveBeenCalled();
    },
  );

  it('allows hosted runtime ingestion only with the internal OAuth-session development-run authority', async () => {
    const core = {
      ingestFileServiceSelection: jest.fn().mockResolvedValue({
        documentVersionId: 'DV-RUNTIME-DEV',
      }),
    };
    jest
      .mocked(DocumentManagementHostedCore)
      .mockImplementationOnce(() => core as never);
    const authorizer = {
      assertCanIngest: jest.fn().mockResolvedValue(undefined),
      assertCanRead: jest.fn(),
    };
    const service = new DocumentManagementHostedService(
      {} as never,
      {} as never,
      authorizer,
    );
    const previousSandbox = process.env.SANDBOX_ID;
    const previousLocal = process.env.MIAODA_LOCAL_DEV;
    process.env.SANDBOX_ID = 'unit-hosted-sandbox';
    delete process.env.MIAODA_LOCAL_DEV;
    const context = runtimeContext();
    try {
      await expect(
        service.assertCanIngest(context, {
          bucketId: 'bucket-default',
          filePath: OWNED_PATH,
        }),
      ).resolves.toBeUndefined();
      await expect(
        service.ingestFileServiceSelection(
          { selection: { bucketId: 'bucket-default', filePath: OWNED_PATH } },
          context,
        ),
      ).resolves.toEqual({ documentVersionId: 'DV-RUNTIME-DEV' });
    } finally {
      restoreProcessEnv('SANDBOX_ID', previousSandbox);
      restoreProcessEnv('MIAODA_LOCAL_DEV', previousLocal);
    }
    expect(authorizer.assertCanIngest).toHaveBeenCalledWith({
      actorUserId: context.actorUserId,
      tenantId: context.tenantId,
      roles: context.roles,
      action: 'DOCUMENT_INGEST',
      selection: { bucketId: 'bucket-default', filePath: OWNED_PATH },
    });
    expect(core.ingestFileServiceSelection).toHaveBeenCalledWith(
      { selection: { bucketId: 'bucket-default', filePath: OWNED_PATH } },
      context,
    );
  });

  it.each([
    [
      'no internal authority',
      runtimeContext({ runtimeIngestAuthority: undefined }),
      {
        code: 'DOCUMENT_INGEST_PREVIEW_REQUIRED',
        statusCode: 403,
      },
    ],
    [
      'missing role',
      runtimeContext({ roles: [] }),
      {
        code: 'DOCUMENT_INGEST_PREVIEW_REQUIRED',
        statusCode: 403,
      },
    ],
    [
      'wrong role',
      runtimeContext({ roles: ['authenticated', 'document_reader'] }),
      {
        code: 'DOCUMENT_INGEST_PREVIEW_REQUIRED',
        statusCode: 403,
      },
    ],
    [
      'wrong app',
      runtimeContext({ appId: 'another-app' }),
      {
        code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
        statusCode: 503,
      },
    ],
    [
      'unknown env',
      runtimeContext({ env: 'production' }),
      {
        code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
        statusCode: 503,
      },
    ],
    [
      'authority bound to another user',
      runtimeContext({
        runtimeIngestAuthority: {
          ...runtimeContext().runtimeIngestAuthority!,
          actorUserId: 'another-user',
        },
      }),
      {
        code: 'DOCUMENT_INGEST_PREVIEW_REQUIRED',
        statusCode: 403,
      },
    ],
  ])(
    'rejects hosted runtime ingestion with %s',
    async (_label, context, expectedError) => {
      const fileService = { from: jest.fn() };
      const authorizer = {
        assertCanIngest: jest.fn(),
        assertCanRead: jest.fn(),
      };
      const service = new DocumentManagementHostedService(
        fileService as never,
        {} as never,
        authorizer,
      );
      const previousSandbox = process.env.SANDBOX_ID;
      const previousLocal = process.env.MIAODA_LOCAL_DEV;
      process.env.SANDBOX_ID = 'unit-hosted-sandbox';
      delete process.env.MIAODA_LOCAL_DEV;

      try {
        await expect(
          Promise.resolve().then(() =>
            service.assertCanIngest(context, {
              bucketId: 'bucket-default',
              filePath: OWNED_PATH,
            }),
          ),
        ).rejects.toMatchObject(expectedError);
        await expect(
          Promise.resolve().then(() =>
            service.ingestFileServiceSelection({}, context),
          ),
        ).rejects.toMatchObject(expectedError);
      } finally {
        restoreProcessEnv('SANDBOX_ID', previousSandbox);
        restoreProcessEnv('MIAODA_LOCAL_DEV', previousLocal);
      }
      expect(authorizer.assertCanIngest).not.toHaveBeenCalled();
      expect(fileService.from).not.toHaveBeenCalled();
    },
  );
});

function fileServiceTarget(metadata: unknown) {
  const getFileMetadata = jest.fn().mockResolvedValue(metadata);
  return {
    getDefaultBucket: jest.fn().mockResolvedValue('bucket-default'),
    from: jest.fn().mockReturnValue({ getFileMetadata }),
    getFileMetadata,
  };
}

function restoreProcessEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
