jest.mock(
  '../../server/modules/document-management/src/hosted/documentManagementHostedCore.js',
  () => ({ DocumentManagementHostedCore: jest.fn() }),
);
jest.mock(
  '../../server/modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js',
  () => ({ MiaodaFileServiceArtifactStore: jest.fn() }),
);

import { OrdinaryDocumentManagementAuthorizer } from '../../server/modules/document-management-runtime/ordinary-document-management-authorizer';
import { DocumentManagementHostedService } from '../../server/modules/document-management/src/hosted/nest/document-management-hosted.service';

const creatorContext = {
  actorUserId: 'user-creator',
  tenantId: 'tenant-a',
  roles: [] as string[],
};

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

  it('does not let the development role replace FileService selection scope', async () => {
    const authorizer = new OrdinaryDocumentManagementAuthorizer({} as never);

    await expect(
      authorizer.assertCanIngest({
        ...creatorContext,
        roles: ['wiselink_development'],
        action: 'DOCUMENT_INGEST',
        selection: { bucketId: 'bucket-1', filePath: '/source.pdf' },
      }),
    ).rejects.toMatchObject({
      code: 'DOCUMENT_SELECTION_SCOPE_UNAVAILABLE',
      statusCode: 503,
    });
    await expect(
      authorizer.assertCanIngest({
        ...creatorContext,
        action: 'DOCUMENT_INGEST',
        selection: { bucketId: 'bucket-1', filePath: '/source.pdf' },
      }),
    ).rejects.toMatchObject({ code: 'DOCUMENT_ACTION_FORBIDDEN' });
  });

  it.each(['ingest', 'authorize-ingest', 'read'] as const)(
    'rejects direct hosted-service %s before context, authorizer, Catalog, or FileService I/O',
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

      const forbidden = new Proxy(
        {},
        {
          get(): never {
            throw new Error('DIRECT_DM_SERVICE_READ_CALLER_INPUT');
          },
        },
      );
      const invoke = (): unknown => {
        if (operation === 'ingest') {
          return service.ingestFileServiceSelection(
            forbidden,
            forbidden as typeof creatorContext,
          );
        }
        if (operation === 'authorize-ingest') {
          return service.assertCanIngest(
            forbidden as typeof creatorContext,
            forbidden as { bucketId: string; filePath: string },
          );
        }
        return service.getDocumentVersion(
          'DV-1',
          forbidden as typeof creatorContext,
        );
      };

      await expect(Promise.resolve().then(invoke)).rejects.toMatchObject({
        code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
        statusCode: 503,
        denialSource: 'MIAODA_BROWSER_UNAVAILABLE_ADAPTER',
      });
      expect(authorizer.assertCanIngest).not.toHaveBeenCalled();
      expect(authorizer.assertCanRead).not.toHaveBeenCalled();
      expect(catalog.readDocumentVersion).not.toHaveBeenCalled();
      expect(catalog.readFamily).not.toHaveBeenCalled();
      expect(fileService.from).not.toHaveBeenCalled();
    },
  );
});
