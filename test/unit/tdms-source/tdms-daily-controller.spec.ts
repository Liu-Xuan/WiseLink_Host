import { Test } from '@nestjs/testing';
import { request } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { TdmsSourceModule } from '../../../server/modules/tdms-source/tdms-source.module';
import { TdmsDailyMetadataController } from '../../../server/modules/tdms-source/tdms-daily-metadata.controller';
import { MiaodaTdmsSourceRepository } from '../../../server/modules/tdms-source/tdms-source.repository';
import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import { GlobalExceptionFilter } from '../../../server/common/filters/exception.filter';
import { CANONICAL_MIAODA_APP_ID } from '../../../server/modules/canonical-host/canonical-host.constants';
import { syntheticDailyEnvelope } from './tdms-daily-metadata.fixture';

describe('registered frozen daily HTTP routes remain closed without actual authority', () => {
  let app: INestApplication, port: number;
  const repository = { transaction: jest.fn() };
  const previous = process.env.SANDBOX_ID;
  beforeAll(async () => {
    process.env.SANDBOX_ID = 'synthetic-daily-http';
    const module = await Test.createTestingModule({
      imports: [TdmsSourceModule],
    })
      .overrideProvider(MiaodaTdmsSourceRepository)
      .useValue(repository)
      .compile();
    app = module.createNestApplication();
    app.useGlobalFilters(new GlobalExceptionFilter());
    // Test-only native gateway fixture; no actual cookie/token or production permission provider.
    app.use((req, _res, next) => {
      req.userContext = {
        userId: '123',
        tenantId: 'tenant-a',
        appId: CANONICAL_MIAODA_APP_ID,
        env: 'preview',
        isSystemAccount: false,
      };
      next();
    });
    await app.listen(0, '127.0.0.1');
    port = app.getHttpServer().address().port;
  });
  afterAll(async () => {
    await app?.close();
    if (previous === undefined) delete process.env.SANDBOX_ID;
    else process.env.SANDBOX_ID = previous;
  });
  function send(path: string, method = 'GET', body?: unknown) {
    return new Promise<{
      status: number;
      body: any;
      headers: Record<string, unknown>;
    }>((resolve, reject) => {
      const bytes = body === undefined ? undefined : JSON.stringify(body);
      const r = request(
        {
          host: '127.0.0.1',
          port,
          path,
          method,
          headers:
            bytes === undefined
              ? {}
              : {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(bytes),
                },
        },
        (res) => {
          let text = '';
          res.on('data', (v) => {
            text += v;
          });
          res.on('end', () =>
            resolve({
              status: res.statusCode!,
              body: JSON.parse(text),
              headers: res.headers,
            }),
          );
        },
      );
      r.on('error', reject);
      r.end(bytes);
    });
  }
  it('POST and both GET routes are real registered handlers that explicitly503 with zero repository calls', async () => {
    const envelope = syntheticDailyEnvelope();
    const results = [
      await send('/api/tdms-source-imports', 'POST', envelope),
      await send('/api/tdms-source-imports/' + envelope.requestId),
      await send(
        '/api/tdms-source-refs?sourceRef=' +
          encodeURIComponent(
            `TDMS:SNAPSHOT:${envelope.package.records[0]!.snapshotId}`,
          ),
      ),
    ];
    for (const result of results) {
      expect(result.status).toBe(503);
      expect(result.body.error.code).toBe(
        'TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED',
      );
    }
    expect(results[0]!.headers['cache-control']).toBe('private, no-store');
    for (const result of results.slice(1)) {
      expect(result.headers['cache-control']).toBe(
        'private, no-cache, must-revalidate',
      );
      expect(result.headers.vary).toBe('Cookie, Authorization');
    }
    expect(repository.transaction).not.toHaveBeenCalled();
  });
  it('rejects client scope/actor/context query parameters, repeated SourceRefs and non-exact IDs', async () => {
    const envelope = syntheticDailyEnvelope();
    for (const path of [
      '/api/tdms-source-refs?sourceRef=AEO-SYNTHETIC',
      '/api/tdms-source-refs?sourceRef=x&sourceRef=y',
      `/api/tdms-source-imports/${envelope.requestId}?tenantId=tenant-a`,
      '/api/tdms-source-imports/not-a-request',
    ])
      expect((await send(path)).status).toBe(400);
    expect(
      (await send('/api/tdms-source-imports?scopeId=narrow', 'POST', envelope))
        .status,
    ).toBe(400);
    expect(repository.transaction).not.toHaveBeenCalled();
  });
  it('controller ignores no actor fields and derives only the actual native ingress actor', () => {
    const service = { importDailyMetadata: jest.fn() };
    const controller = new TdmsDailyMetadataController(
      service as unknown as TdmsSourceService,
    );
    const req = {
      userContext: {
        userId: '123',
        tenantId: 'tenant-a',
        appId: CANONICAL_MIAODA_APP_ID,
        env: 'preview',
        isSystemAccount: false,
      },
    } as any;
    const envelope = syntheticDailyEnvelope();
    controller.submit(req, envelope, {});
    expect(service.importDailyMetadata.mock.calls[0]![0]).toMatchObject({
      canonicalSubject: { id: '123' },
      tenantId: 'tenant-a',
      applicationScopeId: CANONICAL_MIAODA_APP_ID,
    });
    expect(service.importDailyMetadata.mock.calls[0]![1]).toBe(envelope);
    expect(() =>
      controller.submit(
        { userContext: { ...req.userContext, isSystemAccount: true } } as any,
        envelope,
        {},
      ),
    ).toThrow();
    expect(service.importDailyMetadata).toHaveBeenCalledTimes(1);
  });
});
