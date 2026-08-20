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
  const vertical = {
    openApiStatus: jest.fn().mockResolvedValue({ kind: 'status' }),
    openApiQuery: jest.fn().mockResolvedValue({ kind: 'query' }),
    openApiDeepLink: jest.fn().mockResolvedValue({ kind: 'deep-link' }),
  };
  const workItems = {
    createDevelopmentAcceptanceRun: jest.fn().mockResolvedValue({
      schemaVersion: 'wiselink.3_1.ordinary_work_item_run.v1',
      workItemCreated: true,
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const allowedScope = {
    assertDevelopmentCreate: jest.fn().mockResolvedValue(undefined),
    authorizeWorkItemRead: jest.fn(),
    assertTransport: jest.fn(),
  };

  it('enters development creation only after a trusted scope grant', async () => {
    const controller = new CanonicalHostOpenApiController(
      vertical as never,
      workItems as never,
      allowedScope as never,
    );

    await expect(
      controller.createDevelopmentWorkItem({
        documentVersionId: 'document_version_f4813607b91ee1a20e754e2d',
        developmentRunToken: '0f8fad5b-d9cb-469f-a165-70867728950e',
        query: 'applicability',
      }),
    ).resolves.toMatchObject({ workItemCreated: true });

    expect(workItems.createDevelopmentAcceptanceRun).toHaveBeenCalledWith({
      documentVersionId: 'document_version_f4813607b91ee1a20e754e2d',
      developmentRunToken: '0f8fad5b-d9cb-469f-a165-70867728950e',
      query: 'applicability',
    });
    expect(allowedScope.assertDevelopmentCreate).toHaveBeenCalledTimes(1);
  });

  it('fails closed before any development WorkItem I/O without service scope', async () => {
    const serviceScope = {
      assertDevelopmentCreate: jest.fn().mockRejectedValue(
        Object.assign(new Error('scope unavailable'), {
          code: 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE',
          statusCode: 503,
        }),
      ),
    };
    const controller = new CanonicalHostOpenApiController(
      vertical as never,
      workItems as never,
      serviceScope as never,
    );

    await expect(
      controller.createDevelopmentWorkItem({
        documentVersionId: 'document-version-1',
        developmentRunToken: '0f8fad5b-d9cb-469f-a165-70867728950e',
      }),
    ).rejects.toMatchObject({
      code: 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE',
      statusCode: 503,
    });
    expect(workItems.createDevelopmentAcceptanceRun).not.toHaveBeenCalled();
  });

  it('rejects client-supplied authority after the server scope grant', async () => {
    const controller = new CanonicalHostOpenApiController(
      vertical as never,
      workItems as never,
      allowedScope as never,
    );

    await expect(
      controller.createDevelopmentWorkItem({
        documentVersionId: 'document_version_f4813607b91ee1a20e754e2d',
        developmentRunToken: '0f8fad5b-d9cb-469f-a165-70867728950e',
        authority: 'forged',
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(workItems.createDevelopmentAcceptanceRun).not.toHaveBeenCalled();
  });

  it('binds every REST read to a verified exact WorkItem scope', async () => {
    const scope = {
      principalId: 'service:api-key-1',
      appId: 'app_17bzc551rsg',
      tenantId: 'tenant-a',
      workItemId: 'WI-1',
      authorizationFingerprint: 'scope-fingerprint-1',
    };
    allowedScope.authorizeWorkItemRead.mockResolvedValue(scope);
    const controller = new CanonicalHostOpenApiController(
      vertical as never,
      workItems as never,
      allowedScope as never,
    );

    await controller.getWorkItemStatus('WI-1');
    await controller.querySourceBoundUnits('WI-1', 'applicability');
    await controller.getWorkItemDeepLink('WI-1');

    expect(allowedScope.authorizeWorkItemRead.mock.calls).toEqual([
      [
        {
          transport: 'OPENAPI_REST',
          operation: 'READ_STATUS',
          workItemId: 'WI-1',
        },
      ],
      [
        {
          transport: 'OPENAPI_REST',
          operation: 'QUERY_PARSED_PACKAGE',
          workItemId: 'WI-1',
        },
      ],
      [
        {
          transport: 'OPENAPI_REST',
          operation: 'READ_DEEP_LINK',
          workItemId: 'WI-1',
        },
      ],
    ]);
    expect(vertical.openApiStatus).toHaveBeenCalledWith('WI-1', scope);
    expect(vertical.openApiQuery).toHaveBeenCalledWith(
      { workItemId: 'WI-1', query: 'applicability' },
      scope,
    );
    expect(vertical.openApiDeepLink).toHaveBeenCalledWith('WI-1', scope);
  });

  it('performs no WorkItem or reader I/O when REST service scope is unavailable', async () => {
    allowedScope.authorizeWorkItemRead.mockRejectedValue(
      Object.assign(new Error('scope unavailable'), {
        code: 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE',
        statusCode: 503,
      }),
    );
    const controller = new CanonicalHostOpenApiController(
      vertical as never,
      workItems as never,
      allowedScope as never,
    );

    await expect(
      controller.getWorkItemStatus('WI-caller-supplied'),
    ).rejects.toMatchObject({
      code: 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE',
      statusCode: 503,
    });
    expect(vertical.openApiStatus).not.toHaveBeenCalled();
    expect(vertical.openApiQuery).not.toHaveBeenCalled();
    expect(vertical.openApiDeepLink).not.toHaveBeenCalled();
  });
});
