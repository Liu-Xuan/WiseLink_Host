jest.mock('@nestjs/common', () => {
  const actual = jest.requireActual('@nestjs/common');
  const noOpDecorator = () => () => undefined;
  return {
    ...actual,
    Body: noOpDecorator,
    Controller: noOpDecorator,
    Get: noOpDecorator,
    HttpCode: noOpDecorator,
    Post: noOpDecorator,
    Query: noOpDecorator,
  };
});

import { BadRequestException } from '@nestjs/common';

import { CanonicalHostOpenApiController } from '../../server/modules/canonical-host/canonical-host.openapi.controller';

describe('CanonicalHostOpenApiController development acceptance', () => {
  const workItems = {
    createDevelopmentAcceptanceRun: jest.fn().mockResolvedValue({
      schemaVersion: 'wiselink.3_1.ordinary_work_item_run.v1',
      workItemCreated: true,
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates through the server-owned S1 acceptance actor', async () => {
    const controller = new CanonicalHostOpenApiController(
      {} as never,
      workItems as never,
    );

    await expect(
      controller.createDevelopmentWorkItem({
        documentVersionId: 'document_version_f4813607b91ee1a20e754e2d',
        developmentRunToken: '0f8fad5b-d9cb-469f-a165-70867728950e',
        query: 'applicability',
      }),
    ).resolves.toMatchObject({ workItemCreated: true });

    expect(workItems.createDevelopmentAcceptanceRun).toHaveBeenCalledWith(
      {
        documentVersionId: 'document_version_f4813607b91ee1a20e754e2d',
        developmentRunToken: '0f8fad5b-d9cb-469f-a165-70867728950e',
        query: 'applicability',
      },
    );
  });

  it('rejects client-supplied authority before the service', () => {
    const controller = new CanonicalHostOpenApiController(
      {} as never,
      workItems as never,
    );

    expect(() =>
      controller.createDevelopmentWorkItem({
        documentVersionId: 'document_version_f4813607b91ee1a20e754e2d',
        developmentRunToken: '0f8fad5b-d9cb-469f-a165-70867728950e',
        authority: 'forged',
      } as never),
    ).toThrow(BadRequestException);
    expect(workItems.createDevelopmentAcceptanceRun).not.toHaveBeenCalled();
  });
});
