import 'reflect-metadata';

jest.mock('@nestjs/common', () => {
  const actual = jest.requireActual('@nestjs/common');
  const noOpDecorator = () => () => undefined;
  return {
    ...actual,
    Body: noOpDecorator,
    Controller: noOpDecorator,
    Get: noOpDecorator,
    Param: noOpDecorator,
    Post: noOpDecorator,
    Req: noOpDecorator,
  };
});

jest.mock('@lark-apaas/fullstack-nestjs-core', () => ({
  FileService: class FileService {},
  NeedLogin: () => () => undefined,
}));
jest.mock(
  '../../server/modules/document-management/src/hosted/documentManagementHostedCore.js',
  () => ({ DocumentManagementHostedCore: jest.fn() }),
);
jest.mock(
  '../../server/modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js',
  () => ({ MiaodaFileServiceArtifactStore: jest.fn() }),
);

import type { Request } from 'express';

import { DocumentManagementHostedController } from '../../server/modules/document-management/src/hosted/nest/document-management-hosted.controller';
import { DocumentManagementHostedService } from '../../server/modules/document-management/src/hosted/nest/document-management-hosted.service';

describe('DocumentManagementHostedController direct-call defense', () => {
  it.each(['ingest', 'read'] as const)(
    'rejects direct %s before body, request context, or service access',
    (operation) => {
      const service = {
        ingestFileServiceSelection: jest.fn(),
        getDocumentVersion: jest.fn(),
      };
      const controller = new DocumentManagementHostedController(
        service as never,
      );
      const forbidden = new Proxy(
        {},
        {
          get(): never {
            throw new Error('DIRECT_DM_CONTROLLER_READ_CALLER_INPUT');
          },
        },
      );
      const invoke = (): unknown =>
        operation === 'ingest'
          ? controller.ingestFileServiceSelection(
              forbidden,
              { userContext: undefined } as unknown as Request,
            )
          : controller.getDocumentVersion('DV-FORGED', {
              userContext: undefined,
            } as unknown as Request);

      expect(invoke).toThrow(
        expect.objectContaining({
          code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
          statusCode: 503,
          denialSource: 'MIAODA_BROWSER_UNAVAILABLE_ADAPTER',
        }),
      );
      expect(service.ingestFileServiceSelection).not.toHaveBeenCalled();
      expect(service.getDocumentVersion).not.toHaveBeenCalled();
    },
  );

  it('reuses the hosted native user context for FileService ingestion', async () => {
    const service = {
      ingestFileServiceSelection: jest.fn().mockResolvedValue({
        documentVersionId: 'DV-NATIVE',
      }),
      getDocumentVersion: jest.fn(),
    };
    const controller = new DocumentManagementHostedController(
      service as never,
    );
    const previousSandboxId = process.env.SANDBOX_ID;
    process.env.SANDBOX_ID = 'unit-hosted-sandbox';
    const body = {
      selection: {
        bucketId: 'bucket-default',
        filePath: 'wiselink/dev-intake/source.pdf',
      },
    };
    try {
      await expect(
        controller.ingestFileServiceSelection(body, {
          userContext: {
            userId: '1812345678901234567',
            tenantId: '7283059256756502547',
            appId: 'app_17bzc551rsg',
            env: 'preview',
            roles: ['authenticated', 'wiselink_development'],
          },
        } as unknown as Request),
      ).resolves.toEqual({ documentVersionId: 'DV-NATIVE' });
    } finally {
      if (previousSandboxId === undefined) delete process.env.SANDBOX_ID;
      else process.env.SANDBOX_ID = previousSandboxId;
    }
    expect(service.ingestFileServiceSelection).toHaveBeenCalledWith(body, {
      actorUserId: '1812345678901234567',
      tenantId: '7283059256756502547',
      roles: ['authenticated', 'wiselink_development'],
      appId: 'app_17bzc551rsg',
      env: 'preview',
    });
  });

  it('does not let the public body forge runtime development-run authority', async () => {
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
    const controller = new DocumentManagementHostedController(service);
    const previousSandboxId = process.env.SANDBOX_ID;
    const previousLocal = process.env.MIAODA_LOCAL_DEV;
    process.env.SANDBOX_ID = 'unit-hosted-sandbox';
    delete process.env.MIAODA_LOCAL_DEV;
    const body = {
      selection: {
        bucketId: 'bucket-default',
        filePath:
          'wiselink/dev-intake/0f8fad5b-d9cb-469f-a165-70867728950e/source.pdf',
      },
      runtimeIngestAuthority: {
        mode: 'HOSTED_OAUTH_SESSION_DEVELOPMENT_RUN',
        identityProvenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
        sessionProvenance: 'SERVER_OPAQUE_SESSION',
      },
    };
    try {
      await expect(
        Promise.resolve().then(() =>
          controller.ingestFileServiceSelection(body, {
            userContext: {
              userId: '1812345678901234567',
              tenantId: '7283059256756502547',
              appId: 'app_17bzc551rsg',
              env: 'runtime',
              roles: ['authenticated', 'wiselink_development'],
            },
          } as unknown as Request),
        ),
      ).rejects.toMatchObject({
        code: 'DOCUMENT_INGEST_PREVIEW_REQUIRED',
        statusCode: 403,
      });
    } finally {
      if (previousSandboxId === undefined) delete process.env.SANDBOX_ID;
      else process.env.SANDBOX_ID = previousSandboxId;
      if (previousLocal === undefined) delete process.env.MIAODA_LOCAL_DEV;
      else process.env.MIAODA_LOCAL_DEV = previousLocal;
    }
    expect(authorizer.assertCanIngest).not.toHaveBeenCalled();
    expect(fileService.from).not.toHaveBeenCalled();
  });
});
