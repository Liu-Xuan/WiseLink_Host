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
    createDevelopmentRun: jest.fn().mockResolvedValue({
      schemaVersion: 'wiselink.3_1.ordinary_work_item_run.v1',
      workItemCreated: true,
    }),
  };

  const requestContext = {
    getContext: jest.fn().mockReturnValue({ tenantId: 'tenant-2001' }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates through the server-owned S1 acceptance actor', async () => {
    const controller = new CanonicalHostOpenApiController(
      {} as never,
      workItems as never,
      requestContext as never,
    );

    await expect(
      controller.createDevelopmentWorkItem({
        documentVersionId: 'document_version_f4813607b91ee1a20e754e2d',
        developmentRunToken: '0f8fad5b-d9cb-469f-a165-70867728950e',
        query: 'applicability',
      }),
    ).resolves.toMatchObject({ workItemCreated: true });

    expect(workItems.createDevelopmentRun).toHaveBeenCalledWith(
      {
        documentVersionId: 'document_version_f4813607b91ee1a20e754e2d',
        developmentRunToken: '0f8fad5b-d9cb-469f-a165-70867728950e',
        query: 'applicability',
      },
      {
        userId: 'service:wiselink-s1-acceptance',
        tenantId: 'tenant-2001',
        appId: 'app_17bzc551rsg',
        roles: ['wiselink_development'],
        env: 'hosted',
      },
    );
  });

  it('rejects client-supplied authority before the service', () => {
    const controller = new CanonicalHostOpenApiController(
      {} as never,
      workItems as never,
      requestContext as never,
    );

    expect(() =>
      controller.createDevelopmentWorkItem({
        documentVersionId: 'document_version_f4813607b91ee1a20e754e2d',
        developmentRunToken: '0f8fad5b-d9cb-469f-a165-70867728950e',
        authority: 'forged',
      } as never),
    ).toThrow(BadRequestException);
    expect(workItems.createDevelopmentRun).not.toHaveBeenCalled();
  });

  it('fails explicitly when the trusted tenant context is absent', () => {
    const controller = new CanonicalHostOpenApiController(
      {} as never,
      workItems as never,
      { getContext: () => ({}) } as never,
    );

    expect(() =>
      controller.createDevelopmentWorkItem({
        documentVersionId: 'document_version_f4813607b91ee1a20e754e2d',
        developmentRunToken: '0f8fad5b-d9cb-469f-a165-70867728950e',
      }),
    ).toThrow('S1_ACCEPTANCE_TENANT_CONTEXT_REQUIRED');
    expect(workItems.createDevelopmentRun).not.toHaveBeenCalled();
  });
});
