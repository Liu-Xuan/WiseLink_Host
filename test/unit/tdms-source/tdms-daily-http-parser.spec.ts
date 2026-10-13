import { All, Body, Controller, Get } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  configureApp,
  CsrfMiddleware,
} from '@lark-apaas/fullstack-nestjs-core';
import { AppLogger } from '@lark-apaas/nestjs-logger';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { GlobalExceptionFilter } from '../../../server/common/filters/exception.filter';
import { CANONICAL_MIAODA_APP_ID } from '../../../server/modules/canonical-host/canonical-host.constants';
import { createTdmsDailyHttpParser } from '../../../server/modules/tdms-source/tdms-daily-http-parser';
import {
  COMPLETE_OWN_PACKAGE_MAX_BYTES,
  COMPLETE_OWN_REQUEST_MAX_BYTES,
} from '../../../server/modules/tdms-source/tdms-complete-owned-source.validation';
import { TdmsSourceModule } from '../../../server/modules/tdms-source/tdms-source.module';
import { MiaodaTdmsSourceRepository } from '../../../server/modules/tdms-source/tdms-source.repository';
import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import { HostDecisionTdmsSourceAuthorization } from '../../../server/modules/tdms-source/tdms-source.authorization';
import { TDMS_SOURCE_AUTHORIZATION } from '../../../server/modules/tdms-source/tdms-source.types';
import { adaptTdmsDailySource } from '../../../server/modules/tdms-source/tdms-daily-source-adapter';
import { hash } from '../../../server/modules/tdms-source/tdms-source.validation';
import { MemoryTdmsRepository, nativeScope } from './tdms-memory-double';
import {
  copyComplete,
  sealComplete,
  syntheticCompleteEnvelope,
} from './tdms-complete-owned.fixture';
import { syntheticDailyEnvelope } from './tdms-daily-metadata.fixture';

// Real loopback HTTP and the installed configureApp parsers. Identity/authority and storage are synthetic.
@Controller('api')
class OtherRoutes {
  static calls = 0;
  @All(['other-import', 'tdms-source-imports/neighbor'])
  other(@Body() body: unknown) {
    OtherRoutes.calls++;
    return { bytes: Buffer.byteLength(JSON.stringify(body)) };
  }
  @Get('tdms-source-imports')
  read(@Body() body: unknown) {
    OtherRoutes.calls++;
    return { bytes: Buffer.byteLength(JSON.stringify(body)) };
  }
}

function largeCompleteEnvelope() {
  const env = syntheticCompleteEnvelope();
  const proof = env.package.records[0].rawFields.completeOwnedSource as any;
  for (const read of proof.reads) {
    Object.assign(read.fields[0].value, {
      rawValue: '界'.repeat(100000),
      observedTotalCodepoints: 100000,
    });
    Object.assign(read.fields[1].value, {
      state: 'VALUE',
      rawValue: '界'.repeat(35000),
      observedTotalCodepoints: 35000,
    });
  }
  env.package.records[0].content.completeOwnedFields = copyComplete(
    proof.reads[1].fields,
  );
  return sealComplete(env);
}

describe('scoped TDMS JSON parser before the installed SDK parser', () => {
  const savedEnv = {
    CLIENT_BASE_PATH: process.env.CLIENT_BASE_PATH,
    BODY_SIZE_LIMIT: process.env.BODY_SIZE_LIMIT,
    SANDBOX_ID: process.env.SANDBOX_ID,
  };
  const env = largeCompleteEnvelope();
  const bytes = JSON.stringify(env);
  const claims = adaptTdmsDailySource(env).memberClaims;
  const authority = new HostDecisionTdmsSourceAuthorization(
    async () => [{ scope: nativeScope, permissionRevision: 'synthetic-http' }],
    async ({ grant }) => ({
      ...grant,
      authorityRef: 'synthetic-http-import',
      captureRetentionAllowed: true,
      nativeProjectionAllowed: true,
      permittedMembers: claims,
    }),
    async ({ grant }) => ({
      ...grant,
      authorityRef: 'synthetic-http-read',
      retainedCaptureReadAllowed: true,
      permittedMembers: claims,
    }),
  );
  const openApps: NestExpressApplication[] = [];
  let app: NestExpressApplication;
  let repository: MemoryTdmsRepository;
  let service: TdmsSourceService;
  let hasIdentity = true;
  let submit: jest.SpyInstance;

  async function start(basePath = '', syntheticAuthority = true) {
    process.env.CLIENT_BASE_PATH = basePath;
    delete process.env.BODY_SIZE_LIMIT;
    process.env.SANDBOX_ID = 'synthetic-tdms-parser-http';
    const repository = new MemoryTdmsRepository();
    const module = Test.createTestingModule({
      imports: [TdmsSourceModule],
      controllers: [OtherRoutes],
      providers: [
        { provide: AppLogger, useValue: { log() {}, error() {}, warn() {} } },
      ],
    })
      .overrideProvider(MiaodaTdmsSourceRepository)
      .useValue(repository);
    if (syntheticAuthority)
      module.overrideProvider(TDMS_SOURCE_AUTHORIZATION).useValue(authority);
    const testing = await module.compile();
    const app = testing.createNestApplication<NestExpressApplication>();
    openApps.push(app);
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.use(createTdmsDailyHttpParser());
    await configureApp(app, { disableSwagger: true });
    // No platform token/header transport is asserted here. The real guard still executes.
    app.use((req, _res, next) => {
      if (hasIdentity)
        req.userContext = {
          userId: '123',
          tenantId: 'tenant-a',
          appId: CANONICAL_MIAODA_APP_ID,
          env: 'preview',
          isSystemAccount: false,
        };
      next();
    });
    const csrf = new CsrfMiddleware();
    app.use((req, res, next) => csrf.use(req, res, next));
    await app.listen(0, '127.0.0.1');
    return { app, repository, service: app.get(TdmsSourceService) };
  }
  function send(
    app: NestExpressApplication,
    path: string,
    body: string,
    options: {
      method?: string;
      csrf?: boolean;
      chunked?: boolean;
    } = {},
  ) {
    const port = (app.getHttpServer().address() as AddressInfo).port;
    return new Promise<{ status: number; body: any; text: string }>(
      (resolve, reject) => {
        const req = request(
          {
            host: '127.0.0.1',
            port,
            path,
            method: options.method ?? 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(options.chunked
                ? { 'Transfer-Encoding': 'chunked' }
                : { 'Content-Length': Buffer.byteLength(body) }),
              ...(options.csrf === false
                ? {}
                : {
                    cookie: 'suda-csrf-token=synthetic-parser-test',
                    'x-suda-csrf-token': 'synthetic-parser-test',
                  }),
            },
          },
          (res) => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', (value) => {
              text += value;
            });
            res.on('end', () => {
              let body: unknown;
              try {
                body = JSON.parse(text);
              } catch {
                body = null;
              }
              resolve({ status: res.statusCode!, body, text });
            });
          },
        );
        req.on('error', reject);
        if (options.chunked) {
          req.write(body.slice(0, 100));
          req.end(body.slice(100));
        } else req.end(body);
      },
    );
  }
  beforeAll(async () => {
    ({ app, repository, service } = await start());
    submit = jest.spyOn(service, 'importDailyMetadata');
  });
  beforeEach(() => {
    hasIdentity = true;
    submit.mockClear();
    OtherRoutes.calls = 0;
  });
  afterAll(async () => {
    for (const app of openApps) await app.close();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('imports a valid v3 DTO above 1 MiB through SDK/Nest and reads the exact envelope back', async () => {
    expect(Buffer.byteLength(bytes)).toBeGreaterThan(1024 * 1024);
    expect(Buffer.byteLength(bytes)).toBeLessThan(
      COMPLETE_OWN_PACKAGE_MAX_BYTES,
    );
    const result = await send(app, '/api/tdms-source-imports', bytes);
    expect(result.status).toBe(201);
    expect(Object.keys(result.body)).toHaveLength(10);
    expect(result.body).toMatchObject({
      status: 'IMPORTED',
      payloadDigest: hash(env.package),
      artifactCount: 0,
    });
    const read = await send(
      app,
      '/api/tdms-source-imports/' + env.requestId,
      '',
      { method: 'GET' },
    );
    expect(read.status).toBe(200);
    expect(read.body.package).toEqual(env.package);
    expect(repository.state.revisions[0].record.coverage.status).toBe(
      'PARTIAL',
    );
    expect(submit.mock.calls[0][0].canonicalSubject.id).toBe('123');
  });
  it('parses the 2 MiB package budget plus its bounded request wrapper on the exact POST path', async () => {
    const padded =
      bytes +
      ' '.repeat(COMPLETE_OWN_REQUEST_MAX_BYTES - Buffer.byteLength(bytes));
    expect(Buffer.byteLength(padded)).toBe(COMPLETE_OWN_REQUEST_MAX_BYTES);
    const result = await send(app, '/api/tdms-source-imports/', padded);
    expect(result.status).toBe(201);
    expect(result.body.payloadDigest).toBe(hash(env.package));
    expect(submit.mock.calls[0][1]).toEqual(env);
  });
  it.each([false, true])(
    'rejects raw HTTP bytes above the package and wrapper budget before the controller (chunked=%s)',
    async (chunked) => {
      const body =
        bytes +
        ' '.repeat(
          COMPLETE_OWN_REQUEST_MAX_BYTES + 1 - Buffer.byteLength(bytes),
        );
      const before = JSON.stringify(repository.state);
      const result = await send(app, '/api/tdms-source-imports', body, {
        chunked,
      });
      expect(result.status).toBe(413);
      expect(result.body.error.code).toBe('TDMS_SOURCE_IMPORT_BODY_TOO_LARGE');
      expect(submit).not.toHaveBeenCalled();
      expect(JSON.stringify(repository.state)).toBe(before);
    },
  );
  it('still rejects a non-Complete1 legacy envelope above 512 KiB after HTTP parsing', async () => {
    const legacy = syntheticDailyEnvelope();
    legacy.package.readFailures = Array.from({ length: 7 }, () => ({
      sourceRecordId: null,
      code: 'FAILED',
      detail: 'x'.repeat(90000),
    }));
    const body = JSON.stringify(legacy),
      before = JSON.stringify(repository.state);
    expect(Buffer.byteLength(body)).toBeGreaterThan(512 * 1024);
    expect(Buffer.byteLength(body)).toBeLessThan(1024 * 1024);
    const result = await send(app, '/api/tdms-source-imports', body);
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('TDMS_DAILY_LIMIT');
    expect(submit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(repository.state)).toBe(before);
  });
  it.each([
    ['/api/other-import', 'POST'],
    ['/api/tdms-source-imports/neighbor', 'POST'],
    ['/api/tdms-source-imports', 'GET'],
  ])('keeps the SDK 1mb rejection for %s %s', async (path, method) => {
    const result = await send(app, path, bytes, { method });
    // The current global filter leaves the SDK's ordinary body-parser error as 500.
    expect(result.status).toBe(500);
    expect(result.body.error.stack).toContain('PayloadTooLargeError');
    expect(OtherRoutes.calls).toBe(0);
    expect(submit).not.toHaveBeenCalled();
  });
  it('preserves malformed JSON, CSRF and native actor rejections with zero imports', async () => {
    expect((await send(app, '/api/tdms-source-imports', '{')).status).toBe(400);
    expect(
      (await send(app, '/api/tdms-source-imports', bytes, { csrf: false }))
        .status,
    ).toBe(403);
    hasIdentity = false;
    const result = await send(app, '/api/tdms-source-imports', bytes);
    expect(result.status).toBe(503);
    expect(result.body.error.code).toBe(
      'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
    );
    expect(submit).not.toHaveBeenCalled();
  });
  it('honors the configured CLIENT_BASE_PATH and keeps the unprefixed path bounded', async () => {
    const prefixed = await start('mounted/');
    const result = await send(
      prefixed.app,
      '/mounted/api/tdms-source-imports',
      bytes,
    );
    expect(result.status).toBe(201);
    expect(prefixed.repository.state.captures).toHaveLength(1);
    expect(
      (await send(prefixed.app, '/api/tdms-source-imports', bytes)).status,
    ).toBe(500);
  });
  it('keeps the real default-closed Source provider after the larger body is parsed', async () => {
    const closed = await start('', false);
    const result = await send(closed.app, '/api/tdms-source-imports', bytes);
    expect(result.status).toBe(503);
    expect(result.body.error.code).toBe(
      'TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED',
    );
    expect(closed.repository.state.captures).toHaveLength(0);
    expect(closed.repository.state.revisions).toHaveLength(0);
  });
});
