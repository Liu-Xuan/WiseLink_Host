import { mintDocumentUploadAuthority } from '../../server/modules/document-management/src/hosted/nest/document-upload-authority';
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
const EXISTING_OWNED_PATH = '1875002688986330.pdf';

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

function reviewAttachmentContext(
  overrides: Partial<HostedRequestContext> = {},
): HostedRequestContext {
  return {
    ...creatorContext,
    roles: [],
    runtimeIngestAuthority: {
      mode: 'HOSTED_OAUTH_SESSION_REVIEW_ATTACHMENT',
      actorUserId: creatorContext.actorUserId,
      tenantId: creatorContext.tenantId,
      appId: creatorContext.appId,
      identityProvenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
      sessionProvenance: 'SERVER_OPAQUE_SESSION',
      workItemId: 'WI-REVIEW-1',
      expectedRevision: 7,
      authorizationFingerprint: `sha256:${'a'.repeat(64)}`,
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
  it.each([undefined, 403])(
    'preserves a storage read failure without assuming authorization or retrying (%s)',
    async (status) => {
      const cause = Object.assign(new Error('fetch failed'), {
        response: status ? { status } : undefined,
      });
      const fileService = {
        getDefaultBucket: jest.fn().mockRejectedValue(cause),
        from: jest.fn(),
      };
      const authorizer = new OrdinaryDocumentManagementAuthorizer(
        {} as never,
        fileService as never,
      );
      await expect(
        authorizer.assertCanIngest({
          ...runtimeContext(),
          action: 'DOCUMENT_INGEST',
          selection: { bucketId: 'bucket-default', filePath: OWNED_PATH },
        }),
      ).rejects.toMatchObject({
        code:
          status === 403
            ? 'DOCUMENT_ACTION_FORBIDDEN'
            : 'DOCUMENT_STORAGE_BUCKET_READ_FAILED',
        statusCode: status ?? 503,
        cause,
      });
      expect(fileService.getDefaultBucket).toHaveBeenCalledTimes(1);
      expect(fileService.from).not.toHaveBeenCalled();
    },
  );

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

  it.each([true, false])(
    'checks committed acquisition access without a WorkItem: %s',
    async (allowed) => {
      const repository = {
        loadTenantDocumentAuthorizationBinding: jest
          .fn()
          .mockResolvedValue(null),
      };
      const catalog = {
        readOwnedAcquisitionVersionBinding: jest
          .fn()
          .mockResolvedValue(allowed),
      };
      const authorizer = new OrdinaryDocumentManagementAuthorizer(
        repository as never,
        {} as never,
        catalog as never,
      );
      const result = authorizer.assertCanRead({
        ...creatorContext,
        action: 'DOCUMENT_READ',
        documentVersionId: 'DV-1',
      });
      if (allowed) await expect(result).resolves.toBeUndefined();
      else
        await expect(result).rejects.toMatchObject({
          code: 'DOCUMENT_VERSION_NOT_FOUND',
        });
      expect(catalog.readOwnedAcquisitionVersionBinding).toHaveBeenCalledWith({
        actorUserId: creatorContext.actorUserId,
        tenantId: creatorContext.tenantId,
        documentVersionId: 'DV-1',
      });
    },
  );

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

  it('allows a verified OAuth development run to reuse an owned existing PDF', async () => {
    const metadata = {
      bucketID: 'bucket-default',
      filePath: EXISTING_OWNED_PATH,
      createdBy: { userID: creatorContext.actorUserId },
    };
    const fileService = fileServiceTarget(metadata);
    const authorizer = new OrdinaryDocumentManagementAuthorizer(
      {} as never,
      fileService as never,
    );

    await expect(
      authorizer.assertCanIngest({
        ...runtimeContext(),
        action: 'DOCUMENT_INGEST',
        selection: {
          bucketId: 'bucket-default',
          filePath: `/${EXISTING_OWNED_PATH}`,
        },
      }),
    ).resolves.toBeUndefined();
    expect(fileService.getFileMetadata).toHaveBeenCalledWith(
      EXISTING_OWNED_PATH,
    );
  });

  it.each([
    ['missing authority', undefined],
    [
      'wrong OAuth actor',
      {
        ...runtimeContext().runtimeIngestAuthority!,
        actorUserId: 'another-user',
      },
    ],
    [
      'wrong application',
      {
        ...runtimeContext().runtimeIngestAuthority!,
        appId: 'app_other',
      },
    ],
  ])(
    'rejects an existing PDF selection with %s',
    async (_label, runtimeIngestAuthority) => {
      const fileService = fileServiceTarget({
        bucketID: 'bucket-default',
        filePath: EXISTING_OWNED_PATH,
        createdBy: { userID: creatorContext.actorUserId },
      });
      const authorizer = new OrdinaryDocumentManagementAuthorizer(
        {} as never,
        fileService as never,
      );

      await expect(
        authorizer.assertCanIngest({
          ...runtimeContext({ runtimeIngestAuthority }),
          action: 'DOCUMENT_INGEST',
          selection: {
            bucketId: 'bucket-default',
            filePath: EXISTING_OWNED_PATH,
          },
        }),
      ).rejects.toMatchObject({ code: 'DOCUMENT_ACTION_FORBIDDEN' });
      expect(fileService.from).not.toHaveBeenCalled();
    },
  );

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

  it('allows only the same OAuth user to ingest a default-bucket review selection', async () => {
    const path = 'official-selection/engineering-note.pdf';
    const metadata = {
      bucketID: 'bucket-default',
      filePath: path,
      createdBy: { userID: creatorContext.actorUserId },
    };
    const fileService = fileServiceTarget(metadata);
    const authorizer = new OrdinaryDocumentManagementAuthorizer(
      {} as never,
      fileService as never,
    );
    const context = reviewAttachmentContext();

    await expect(
      authorizer.assertCanIngest({
        actorUserId: context.actorUserId,
        tenantId: context.tenantId,
        roles: context.roles,
        action: 'DOCUMENT_INGEST',
        selection: { bucketId: 'bucket-default', filePath: path },
        runtimeIngestAuthority: context.runtimeIngestAuthority,
      }),
    ).resolves.toBeUndefined();
    await expect(
      authorizer.assertCanIngest({
        actorUserId: 'another-user',
        tenantId: context.tenantId,
        roles: context.roles,
        action: 'DOCUMENT_INGEST',
        selection: { bucketId: 'bucket-default', filePath: path },
        runtimeIngestAuthority: context.runtimeIngestAuthority,
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
      runtimeIngestAuthority: context.runtimeIngestAuthority,
    });
    expect(core.ingestFileServiceSelection).toHaveBeenCalledWith(
      { selection: { bucketId: 'bucket-default', filePath: OWNED_PATH } },
      context,
    );
  });

  it('keeps review attachment ingestion internal and forwards the exact verified authority to the existing core', async () => {
    const core = {
      ingestFileServiceSelection: jest.fn().mockResolvedValue({
        documentVersionId: 'DV-REVIEW-1',
      }),
    };
    jest
      .mocked(DocumentManagementHostedCore)
      .mockImplementationOnce(() => core as never);
    const service = new DocumentManagementHostedService(
      {} as never,
      {} as never,
      { assertCanIngest: jest.fn(), assertCanRead: jest.fn() },
    );
    const context = reviewAttachmentContext();
    const request = {
      selection: {
        bucketId: 'bucket-default',
        filePath: 'official-selection/engineering-note.pdf',
      },
    };
    const previousSandbox = process.env.SANDBOX_ID;
    const previousLocal = process.env.MIAODA_LOCAL_DEV;
    process.env.SANDBOX_ID = 'unit-review-attachment';
    delete process.env.MIAODA_LOCAL_DEV;
    try {
      await expect(
        service.ingestReviewAttachmentSelection(request, context),
      ).resolves.toEqual({ documentVersionId: 'DV-REVIEW-1' });
      expect(core.ingestFileServiceSelection).toHaveBeenCalledWith(
        request,
        context,
      );

      await expect(
        Promise.resolve().then(() =>
          service.ingestReviewAttachmentSelection(request, {
            ...context,
            actorUserId: 'another-user',
          }),
        ),
      ).rejects.toMatchObject({
        code: 'REVIEW_ATTACHMENT_INGEST_AUTHORITY_REQUIRED',
        statusCode: 403,
      });
    } finally {
      restoreProcessEnv('SANDBOX_ID', previousSandbox);
      restoreProcessEnv('MIAODA_LOCAL_DEV', previousLocal);
    }
    expect(core.ingestFileServiceSelection).toHaveBeenCalledTimes(1);
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

describe('local MinerU candidate authorization with real native upload authority', () => {
  let oldSandbox: string | undefined;
  let oldLocal: string | undefined;
  beforeEach(() => {
    oldSandbox = process.env.SANDBOX_ID; oldLocal = process.env.MIAODA_LOCAL_DEV;
    process.env.SANDBOX_ID = 'unit-candidate-authorization'; delete process.env.MIAODA_LOCAL_DEV;
  });
  afterEach(() => {
    restoreProcessEnv('SANDBOX_ID', oldSandbox); restoreProcessEnv('MIAODA_LOCAL_DEV', oldLocal);
  });
  function candidateFixture() {
    const selection = { bucketId: 'bucket-default', filePath: '/1876604059672731.json' };
    const metadata = { id: 'candidate-object', bucketID: selection.bucketId, filePath: selection.filePath,
      createdBy: { userID: creatorContext.actorUserId }, metadata: { contentLength: 20 } };
    const files = fileServiceTarget(metadata);
    const workItems = { loadTenantDocumentAuthorizationBinding: jest.fn().mockResolvedValue(binding()) };
    const run = { parseRunId: 'PRUN-owned', actorUserId: creatorContext.actorUserId, tenantId: creatorContext.tenantId,
      documentVersionId: 'DV-1', sourceBinding: { documentVersionId: 'DV-1', parserInput: {
        mode: 'LOCAL_MINERU_IMPORT', ...selection, providerObjectId: metadata.id, sha256: 'a'.repeat(64), byteLength: 20,
        settings: { revision: 1, localMineruFallbackEnabled: true, titleEnhancementEnabled: false } } } };
    const parsing = { read: jest.fn().mockResolvedValue(run) };
    const authorizer = new OrdinaryDocumentManagementAuthorizer(workItems as never, files as never, undefined, parsing as never);
    const scope = { actorUserId: creatorContext.actorUserId, tenantId: creatorContext.tenantId, roles: [], documentVersionId: 'DV-1' };
    return { selection, metadata, files, workItems, run, parsing, authorizer, scope };
  }
  it('admits numeric provider JSON paths using actual minted authority and preserves PDF-only ingestion', async () => {
    const f = candidateFixture();
    const runtimeIngestAuthority = mintDocumentUploadAuthority(creatorContext);
    await expect(f.authorizer.assertCanImportLocalCandidate({ ...f.scope, selection: f.selection, runtimeIngestAuthority }))
      .resolves.toBeUndefined();
    expect(f.files.getFileMetadata).toHaveBeenCalledWith('1876604059672731.json');
    await expect(f.authorizer.assertCanIngest({ ...f.scope, action: 'DOCUMENT_INGEST', selection: f.selection, runtimeIngestAuthority }))
      .rejects.toMatchObject({ code: 'DOCUMENT_ACTION_FORBIDDEN' });
  });
  it('rejects a copied authority object even with development role', async () => {
    const f = candidateFixture();
    const runtimeIngestAuthority = { ...mintDocumentUploadAuthority(creatorContext) };
    await expect(f.authorizer.assertCanImportLocalCandidate({ ...f.scope, roles: ['wiselink_development'], selection: f.selection, runtimeIngestAuthority }))
      .rejects.toMatchObject({ code: 'DOCUMENT_ACTION_FORBIDDEN' });
    expect(f.files.getFileMetadata).not.toHaveBeenCalled();
  });
  it.each(['../candidate.json', 'folder/../candidate.json', 'folder//candidate.json', 'folder\\candidate.json', 'candidate.pdf'])
    ('rejects unsafe or non-JSON path %s', async filePath => {
      const f = candidateFixture();
      await expect(f.authorizer.assertCanImportLocalCandidate({ ...f.scope, selection: { ...f.selection, filePath },
        runtimeIngestAuthority: mintDocumentUploadAuthority(creatorContext) })).rejects.toMatchObject({ code: 'DOCUMENT_ACTION_FORBIDDEN' });
      expect(f.files.getFileMetadata).not.toHaveBeenCalled();
    });
  it('reads only the owned persisted candidate without browser context', async () => {
    const f = candidateFixture();
    await expect(f.authorizer.assertCanReadLocalCandidate({ ...f.scope, parseRunId: f.run.parseRunId })).resolves.toBeUndefined();
    expect(f.parsing.read).toHaveBeenCalledWith({ ...f.scope, parseRunId: f.run.parseRunId }, f.run.parseRunId);
    expect(f.files.getFileMetadata).toHaveBeenCalledWith('1876604059672731.json');
  });
  it.each(['actor', 'tenant', 'document', 'mode', 'snapshot', 'disabled', 'revision', 'owner', 'object', 'length', 'bucket', 'source'])
    ('rejects changed persisted candidate boundary %s', async boundary => {
      const f = candidateFixture(); const pinned = f.run.sourceBinding.parserInput;
      if (boundary === 'actor') f.run.actorUserId = 'other';
      if (boundary === 'tenant') f.run.tenantId = 'other';
      if (boundary === 'document') f.run.documentVersionId = 'other';
      if (boundary === 'mode') pinned.mode = 'OFFICIAL_PLUGIN';
      if (boundary === 'snapshot') Reflect.deleteProperty(pinned, 'settings');
      if (boundary === 'disabled') pinned.settings.localMineruFallbackEnabled = false;
      if (boundary === 'revision') pinned.settings.revision = -1;
      if (boundary === 'owner') f.metadata.createdBy.userID = 'other';
      if (boundary === 'object') f.metadata.id = 'other';
      if (boundary === 'length') f.metadata.metadata.contentLength++;
      if (boundary === 'bucket') pinned.bucketId = 'other';
      if (boundary === 'source') f.workItems.loadTenantDocumentAuthorizationBinding.mockResolvedValue(null);
      await expect(f.authorizer.assertCanReadLocalCandidate({ ...f.scope, parseRunId: f.run.parseRunId }))
        .rejects.toMatchObject({ code: boundary === 'source' ? 'DOCUMENT_VERSION_NOT_FOUND' : 'DOCUMENT_ACTION_FORBIDDEN' });
    });
  it('denies unavailable persistence and preserves current FileService permission failures', async () => {
    const f = candidateFixture();
    const unavailable = new OrdinaryDocumentManagementAuthorizer(f.workItems as never, f.files as never);
    await expect(unavailable.assertCanReadLocalCandidate({ ...f.scope, parseRunId: f.run.parseRunId }))
      .rejects.toMatchObject({ code: 'DOCUMENT_LOCAL_MINERU_AUTHORIZATION_UNAVAILABLE', statusCode: 503 });
    f.files.getFileMetadata.mockRejectedValue({ status: 403 });
    await expect(f.authorizer.assertCanReadLocalCandidate({ ...f.scope, parseRunId: f.run.parseRunId }))
      .rejects.toMatchObject({ code: 'DOCUMENT_ACTION_FORBIDDEN', statusCode: 403 });
  });
});
