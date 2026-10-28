import { All, Body, Controller, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { configureApp } from '@lark-apaas/fullstack-nestjs-core';
import { request } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { GlobalExceptionFilter } from '../../../server/common/filters/exception.filter';
import { createTdmsDailyHttpParser } from '../../../server/modules/tdms-source/tdms-daily-http-parser';
import { COMPLETE_OWN_REQUEST_MAX_BYTES } from '../../../server/modules/tdms-source/tdms-complete-owned-source.validation';

// configureApp consumes the logger resolved from its installed SDK entry.
// Bind this fixture to that exact token: Jest can resolve a transitive dependency
// through a different physical dependency path from a test-file import.
const sdkRequire = createRequire(
  require.resolve('@lark-apaas/fullstack-nestjs-core'),
);
const { AppLogger } = sdkRequire(
  '@lark-apaas/nestjs-logger',
) as typeof import('@lark-apaas/nestjs-logger');

// A parser-only loopback probe, not a Source fixture or an import acceptance.
@Controller('api/tdms-source-imports')
class ReceiverParserProbe {
  static calls = 0;
  @Post([
    ':requestId/artifacts/:bindingId/selection',
    ':requestId/artifacts/:bindingId/selection/preflight',
    ':requestId/artifacts/:bindingId/registration',
  ])
  accept(@Body() body: unknown) {
    ReceiverParserProbe.calls++;
    return { bytes: Buffer.byteLength(JSON.stringify(body)) };
  }
  @All([
    'receiver/binding',
    ':requestId/artifacts/:bindingId/selection/neighbor',
  ])
  other(@Body() body: unknown) {
    ReceiverParserProbe.calls++;
    return { body };
  }
}

describe('new selection routes use the same bounded installed HTTP parser', () => {
  const saved = {
    CLIENT_BASE_PATH: process.env.CLIENT_BASE_PATH,
    BODY_SIZE_LIMIT: process.env.BODY_SIZE_LIMIT,
  };
  let app: NestExpressApplication;
  // Deliberately not a valid package. This suite tests transport sizing only.
  const body = JSON.stringify({ package: { synthetic: 'x'.repeat(1100000) } });
  function send(path: string, value = body, method = 'POST') {
    return new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: (app.getHttpServer().address() as AddressInfo).port,
          path,
          method,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(value),
          },
        },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (part) => (text += part));
          res.on('end', () =>
            resolve({ status: res.statusCode!, body: JSON.parse(text) }),
          );
        },
      );
      req.on('error', reject);
      req.end(value);
    });
  }
  beforeAll(async () => {
    process.env.CLIENT_BASE_PATH = 'host/';
    delete process.env.BODY_SIZE_LIMIT;
    const module = await Test.createTestingModule({
      controllers: [ReceiverParserProbe],
      providers: [
        { provide: AppLogger, useValue: { log() {}, warn() {}, error() {} } },
      ],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.use(createTdmsDailyHttpParser());
    await configureApp(app, { disableSwagger: true });
    await app.listen(0, '127.0.0.1');
  });
  beforeEach(() => {
    ReceiverParserProbe.calls = 0;
  });
  afterAll(async () => {
    await app.close();
    for (const [key, value] of Object.entries(saved))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
  it.each(['selection', 'selection/preflight', 'registration'])(
    'accepts bounded >1MB %s transport on the exact prefixed route',
    async (suffix) => {
      const response = await send(
        '/host/api/tdms-source-imports/request/artifacts/binding/' + suffix,
      );
      expect(response.status).toBe(201);
      expect(response.body.bytes).toBe(Buffer.byteLength(body));
      expect(ReceiverParserProbe.calls).toBe(1);
    },
  );
  it.each(['selection', 'selection/preflight', 'registration'])(
    'rejects oversized %s before the handler',
    async (suffix) => {
      const response = await send(
        '/host/api/tdms-source-imports/request/artifacts/binding/' + suffix,
        body +
          ' '.repeat(
            COMPLETE_OWN_REQUEST_MAX_BYTES + 1 - Buffer.byteLength(body),
          ),
      );
      expect(response.status).toBe(413);
      expect(response.body.error.code).toBe(
        'TDMS_SOURCE_IMPORT_BODY_TOO_LARGE',
      );
      expect(ReceiverParserProbe.calls).toBe(0);
    },
  );
  it.each([
    [
      '/host/api/tdms-source-imports/request/artifacts/binding/selection/neighbor',
      'POST',
    ],
    ['/host/api/tdms-source-imports/request/artifacts/binding/registration/neighbor', 'POST'],
    ['/host/api/tdms-source-imports/receiver/binding', 'POST'],
    [
      '/host/api/tdms-source-imports/request/artifacts/binding/selection',
      'GET',
    ],
    ['/api/tdms-source-imports/request/artifacts/binding/selection', 'POST'],
  ])('keeps default SDK bounds on neighbor %s %s', async (path, method) => {
    const response = await send(path, body, method);
    expect(response.status).toBe(500);
    expect(response.body.error.stack).toContain('PayloadTooLargeError');
    expect(ReceiverParserProbe.calls).toBe(0);
  });
});
