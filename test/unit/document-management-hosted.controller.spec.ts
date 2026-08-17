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

describe('DocumentManagementHostedController', () => {
  const request = {
    userContext: {
      userId: 'user-1',
      tenantId: 'tenant-1',
      roles: ['engineer'],
    },
  } as unknown as Request;

  it.each([
    {
      sourceChannel: 'openclaw_external_discovery_review',
      descriptor: {},
    },
    {
      sourceChannel: 'openclaw_external_monitor_review',
      descriptor: {},
    },
    {
      sourceChannel: 'canonical_miaoda_document_selection',
      descriptor: { externalDiscovery: { candidateRef: 'forged' } },
    },
  ])(
    'rejects external-discovery provenance on the generic ingestion route before DM I/O',
    async (body) => {
      const service = {
        ingestFileServiceSelection: jest.fn(),
      };
      const controller = new DocumentManagementHostedController(service as never);

      expect(() => controller.ingestFileServiceSelection(body, request)).toThrow(
        expect.objectContaining({
          code: 'EXTERNAL_DISCOVERY_REVIEWED_INGEST_REQUIRED',
          statusCode: 400,
        }),
      );
      expect(service.ingestFileServiceSelection).not.toHaveBeenCalled();
    },
  );

  it('keeps ordinary authenticated FileService ingestion unchanged', async () => {
    const result = { documentVersionId: 'document-version-1' };
    const service = {
      ingestFileServiceSelection: jest.fn().mockResolvedValue(result),
    };
    const controller = new DocumentManagementHostedController(service as never);
    const body = {
      sourceChannel: 'canonical_miaoda_document_selection',
      sourceRef: 'miaoda-file-service:bucket:path',
      selection: { bucketId: 'bucket', filePath: '/path.pdf' },
      descriptor: { originalFilename: 'file.pdf' },
      idempotencyKey: 'ordinary-ingest-1',
    };

    await expect(
      controller.ingestFileServiceSelection(body, request),
    ).resolves.toEqual(result);
    expect(service.ingestFileServiceSelection).toHaveBeenCalledWith(body, {
      actorUserId: 'user-1',
      tenantId: 'tenant-1',
      roles: ['engineer'],
    });
  });
});
