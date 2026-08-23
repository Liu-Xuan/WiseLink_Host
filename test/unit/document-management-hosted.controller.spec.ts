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
              forbidden as Request,
            )
          : controller.getDocumentVersion('DV-FORGED', forbidden as Request);

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
});
