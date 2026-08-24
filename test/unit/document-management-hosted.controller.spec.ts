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
  NeedLogin: () => () => undefined,
}));

import type { Request } from 'express';

import { DocumentManagementHostedController } from '../../server/modules/document-management/src/hosted/nest/document-management-hosted.controller';

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
              { userContext: undefined } as Request,
            )
          : controller.getDocumentVersion('DV-FORGED', {
              userContext: undefined,
            } as Request);

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
        } as Request),
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
});
