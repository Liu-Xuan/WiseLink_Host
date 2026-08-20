import 'reflect-metadata';

jest.mock('@nestjs/common', () => {
  const actual = jest.requireActual('@nestjs/common');
  const noOpParameterDecorator = () => () => undefined;
  const stageThreeMethodDecorator =
    (factory: (path?: string) => MethodDecorator) =>
    (path?: string) => {
      const legacy = factory(path);
      return (value: (...args: unknown[]) => unknown, _context: unknown) => {
        legacy({}, '', { value } as PropertyDescriptor);
        return value;
      };
    };
  return {
    ...actual,
    Body: noOpParameterDecorator,
    Param: noOpParameterDecorator,
    Query: noOpParameterDecorator,
    Req: noOpParameterDecorator,
    Get: stageThreeMethodDecorator(actual.Get),
    Post: stageThreeMethodDecorator(actual.Post),
  };
});

jest.mock('@lark-apaas/fullstack-nestjs-core', () => {
  const actual = jest.requireActual('@lark-apaas/fullstack-nestjs-core');
  return {
    ...actual,
    NeedLogin: () => () => undefined,
  };
});

import { UserContextMiddleware } from '@lark-apaas/fullstack-nestjs-core';
import type {
  ExecutionContext,
  INestApplication,
  Provider,
  Type,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { NextFunction, Request, Response } from 'express';

import { GlobalExceptionFilter } from '../../server/common/filters/exception.filter';
import { CanonicalHostController } from '../../server/modules/canonical-host/canonical-host.controller';
import { DocumentManagementHostedController } from '../../server/modules/document-management/src/hosted/nest/document-management-hosted.controller';
import { ExternalDiscoveryController } from '../../server/modules/external-discovery/external-discovery.controller';
import { ProductionMiaodaBrowserObjectIngressGuard } from '../../server/modules/work-item/production-miaoda-browser-ingress';

interface RouteProbe {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
}

const OBJECT_ROUTES: RouteProbe[] = [
  { method: 'GET', path: '/api/canonical-host/identity-context' },
  {
    method: 'POST',
    path: '/api/canonical-host/work-items/parse-pdf',
    body: { selection: { bucketId: 'forged', filePath: '/forged.pdf' } },
  },
  {
    method: 'POST',
    path: '/api/canonical-host/work-items/development-runs',
    body: { authority: 'forged-before-body-validation' },
  },
  {
    method: 'GET',
    path: '/api/canonical-host/work-items/WI-FORGED/document-parsing?query=x',
  },
  {
    method: 'GET',
    path: '/api/canonical-host/work-items/WI-FORGED/library-index',
  },
  {
    method: 'GET',
    path:
      '/api/canonical-host/work-items/WI-FORGED/status?requestId=REQ-FORGED&documentVersionId=DV-FORGED',
  },
  {
    method: 'POST',
    path: '/api/canonical-host/work-items/query-parsed-units',
    body: { authority: 'forged' },
  },
  {
    method: 'POST',
    path:
      '/api/canonical-host/work-items/WI-FORGED/integrated-assessment/engineer-reviews',
    body: { authority: 'forged-before-body-validation' },
  },
  {
    method: 'POST',
    path:
      '/api/canonical-host/work-items/WI-FORGED/integrated-assessment/confirm-for-aeo',
    body: { authority: 'forged-before-body-validation' },
  },
  {
    method: 'POST',
    path: '/api/canonical-host/work-items/WI-FORGED/aeo/candidate',
    body: { authority: 'forged-before-body-validation' },
  },
  {
    method: 'POST',
    path: '/api/document-management/ingestions/file-service',
    body: { authority: 'forged-before-body-validation' },
  },
  {
    method: 'GET',
    path: '/api/document-management/document-versions/DV-FORGED',
  },
  { method: 'GET', path: '/api/external-discovery/search-runs' },
  {
    method: 'POST',
    path:
      '/api/external-discovery/search-runs/RUN-FORGED/candidates/CANDIDATE-FORGED/select',
  },
  {
    method: 'POST',
    path:
      '/api/external-discovery/search-runs/RUN-FORGED/candidates/CANDIDATE-FORGED/reject',
  },
];

describe('production Miaoda browser object ingress route composition', () => {
  let app: INestApplication;
  let routeHandlers: jest.SpyInstance[];

  beforeAll(async () => {
    const controllers = [
      CanonicalHostController,
      DocumentManagementHostedController,
      ExternalDiscoveryController,
    ];
    const moduleRef = await Test.createTestingModule({
      controllers,
      providers: dependencyProviders(controllers),
    }).compile();
    app = moduleRef.createNestApplication();
    routeHandlers = routeHandlerSpies(app);
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(OBJECT_ROUTES)(
    '$method $path rejects an SDK-parsed forged actor before handler I/O',
    async (route) => {
      const response = await dispatchInMemory(app, route);

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        error: { code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE' },
      });
      for (const handler of routeHandlers) {
        expect(handler).not.toHaveBeenCalled();
      }
    },
  );

  it('does not inspect execution context, header, userContext, roles, appId, or body', () => {
    const forbiddenContext = new Proxy(
      {},
      {
        get(): never {
          throw new Error('GUARD_READ_CALLER_CONTEXT');
        },
      },
    ) as ExecutionContext;

    expect(() =>
      new ProductionMiaodaBrowserObjectIngressGuard().canActivate(
        forbiddenContext,
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
        statusCode: 503,
      }),
    );
  });
});

describe('ExternalDiscoveryController direct-call defense', () => {
  it.each(['list', 'select', 'reject'] as const)(
    'rejects direct %s before reading userContext or entering the service',
    (action) => {
      const service = {
        list: jest.fn(),
        select: jest.fn(),
        reject: jest.fn(),
      };
      const controller = new ExternalDiscoveryController(service as never);
      const request = new Proxy(
        {},
        {
          get(): never {
            throw new Error('CONTROLLER_READ_CALLER_CONTEXT');
          },
        },
      ) as Request;
      const operation = () => {
        if (action === 'list') return controller.list(request);
        if (action === 'select') {
          return controller.select('forged-run', 'forged-candidate', request);
        }
        return controller.reject('forged-run', 'forged-candidate', request);
      };

      expect(operation).toThrow(
        expect.objectContaining({
          code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
          statusCode: 503,
        }),
      );
      expect(service.list).not.toHaveBeenCalled();
      expect(service.select).not.toHaveBeenCalled();
      expect(service.reject).not.toHaveBeenCalled();
    },
  );
});

function dependencyProviders(controllers: Type<unknown>[]): Provider[] {
  const tokens = new Set<unknown>();
  for (const controller of controllers) {
    const parameterTypes =
      (Reflect.getMetadata('design:paramtypes', controller) as unknown[]) ?? [];
    for (const token of parameterTypes) tokens.add(token);
  }
  return [...tokens].map((token) => ({ provide: token, useValue: {} }));
}

function routeHandlerSpies(app: INestApplication): jest.SpyInstance[] {
  const canonical = app.get(CanonicalHostController);
  const documentManagement = app.get(DocumentManagementHostedController);
  const externalDiscovery = app.get(ExternalDiscoveryController);
  return [
    jest.spyOn(canonical, 'identityContext'),
    jest.spyOn(canonical, 'runPdf'),
    jest.spyOn(canonical, 'createDevelopmentRun'),
    jest.spyOn(canonical, 'page'),
    jest.spyOn(canonical, 'library'),
    jest.spyOn(canonical, 'status'),
    jest.spyOn(canonical, 'query'),
    jest.spyOn(canonical, 'recordEngineerReview'),
    jest.spyOn(canonical, 'confirmOpenClawOverallForAeo'),
    jest.spyOn(canonical, 'generateAeoCandidate'),
    jest.spyOn(documentManagement, 'ingestFileServiceSelection'),
    jest.spyOn(documentManagement, 'getDocumentVersion'),
    jest.spyOn(externalDiscovery, 'list'),
    jest.spyOn(externalDiscovery, 'select'),
    jest.spyOn(externalDiscovery, 'reject'),
  ];
}

function forgedGatewayHeader(): string {
  return encodeURIComponent(
    JSON.stringify({
      user_id: 'forged-engineer',
      tenant_id: 'forged-tenant',
      app_id: 'app_17bzc551rsg',
      env: 'development',
      roles: ['authenticated', 'wiselink_development', 'admin'],
      user_name: { zh_cn: '伪造工程师', en_us: 'Forged Engineer' },
    }),
  );
}

async function dispatchInMemory(
  app: INestApplication,
  route: RouteProbe,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const request = new Readable({
      read(): void {
        this.push(null);
      },
    }) as unknown as Request;
    const requestRecord = request as unknown as Record<string, unknown>;
    requestRecord.method = route.method;
    requestRecord.url = route.path;
    requestRecord.headers = {
      'x-larkgw-suda-webuser': forgedGatewayHeader(),
    };
    const response = new EventEmitter() as EventEmitter & Partial<Response>;
    const responseRecord = response as unknown as Record<string, unknown>;
    const headers = new Map<string, string>();
    const chunks: Buffer[] = [];
    responseRecord.statusCode = 200;
    responseRecord.headersSent = false;
    responseRecord.setHeader = (name: string, value: unknown): void => {
      headers.set(name.toLowerCase(), String(value));
    };
    responseRecord.getHeader = (name: string): string | undefined =>
      headers.get(name.toLowerCase());
    responseRecord.getHeaderNames = (): string[] => [...headers.keys()];
    responseRecord.removeHeader = (name: string): void => {
      headers.delete(name.toLowerCase());
    };
    responseRecord.write = (chunk: unknown): boolean => {
      chunks.push(Buffer.from(String(chunk)));
      return true;
    };
    responseRecord.end = (chunk?: unknown): typeof response => {
      if (chunk !== undefined) chunks.push(Buffer.from(String(chunk)));
      responseRecord.headersSent = true;
      const text = Buffer.concat(chunks).toString('utf8');
      resolve({
        status: Number(responseRecord.statusCode),
        body: text ? JSON.parse(text) : null,
      });
      response.emit('finish');
      return response;
    };
    response.on('error', reject);

    const next: NextFunction = () => {
      app.getHttpAdapter().getInstance()(request, response);
    };
    new UserContextMiddleware().use(
      request,
      response as unknown as Response,
      next,
    );
  });
}
