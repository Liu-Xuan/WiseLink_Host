import { All, Body, Controller, Get } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { configureApp } from '@lark-apaas/fullstack-nestjs-core';
import { AppLogger } from '@lark-apaas/nestjs-logger';
import type { Request, Response } from 'express';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { GlobalExceptionFilter } from '../../server/common/filters/exception.filter';
import { CanonicalHostOpenClawMcpOpenApiController } from '../../server/modules/canonical-host/canonical-host-openclaw-mcp.openapi.controller';
import { CanonicalHostOpenClawMcpService } from '../../server/modules/canonical-host/canonical-host-openclaw-mcp.service';
import { AutomaticWorkItemDispatchService } from '../../server/modules/canonical-host/automatic-work-item-dispatch.service';
import { CANONICAL_SERVICE_SCOPE_AUTHORIZATION } from '../../server/modules/canonical-host/canonical-service-scope.authorization';
import { ConfiguredDevelopmentCanonicalServiceScopeAuthorization } from '../../server/modules/canonical-host/configured-development-service-scope.authorization';
import { createTdmsDailyHttpParser } from '../../server/modules/tdms-source/tdms-daily-http-parser';
import {
  createCanonicalCodexMcpHttpParser,
} from '../../server/modules/canonical-host/canonical-codex-mcp-http-parser';

// Real configureApp/body-parser/controller/scope checks; no MCP, database or model execution.
@Controller('openapi/wiselink')
class OtherRoutes {
  static calls = 0;

  @All('codex-mcp/neighbor')
  neighbor(@Body() body: unknown) {
    OtherRoutes.calls++;
    return { bytes: Buffer.byteLength(JSON.stringify(body)) };
  }

  @Get('codex-mcp')
  read(@Body() body: unknown) {
    OtherRoutes.calls++;
    return { bytes: Buffer.byteLength(JSON.stringify(body)) };
  }
}

function progressBody(repetitions: number): string {
  const text: string = '中文材料“保持原文”\\路径\n"引用"\t'.repeat(repetitions);
  const modelRequest = {
    version: 1,
    materialCheckpoint: 'program-materials',
    body: JSON.stringify({ messages: [{ role: 'user', content: text }] }),
  };
  return JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: {
      name: 'record_assessment_program_progress',
      arguments: {
        workItemId: 'WI-parser-synthetic', attemptRef: 'AQ-parser-synthetic',
        leaseToken: 'eaf9dfb5-a7a8-4294-afac-3b6c2460eade', leaseGeneration: 1,
        phase: 'MATERIALS_READY', checkpointRef: 'initial:synthetic:program-materials',
        materialSnapshotJson: JSON.stringify({
          materials: { version: 1, originalInput: { text }, modelInput: { text } },
          modelRequest,
        }),
      },
    },
  });
}

function progressBodyAtLeast(minimumBytes: number): string {
  const overhead: number = Buffer.byteLength(progressBody(0));
  const bytesPerUnit: number = Buffer.byteLength(progressBody(1)) - overhead;
  return progressBody(Math.max(0, Math.ceil((minimumBytes - overhead) / bytesPerUnit)));
}

interface HttpResult {
  status: number;
  body: unknown;
}

interface SendOptions {
  method?: string;
  chunked?: boolean;
}

function send(app: NestExpressApplication, path: string, body: string,
  options: SendOptions = {}): Promise<HttpResult> {
  const port: number = (app.getHttpServer().address() as AddressInfo).port;
  return new Promise<HttpResult>((accept, reject) => {
    const wireBody: Buffer = Buffer.from(body);
    const req = request({
      host: '127.0.0.1', port, path, method: options.method ?? 'POST',
      headers: {
        'content-type': 'application/json',
        ...(options.chunked
          ? { 'transfer-encoding': 'chunked' }
          : { 'content-length': wireBody.byteLength }),
      },
    }, (res) => {
      let text: string = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { text += chunk; });
      res.on('end', () => {
        let parsed: unknown;
        try { parsed = JSON.parse(text); } catch { parsed = null; }
        accept({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    req.on('error', reject);
    if (options.chunked) {
      for (let offset: number = 0; offset < wireBody.byteLength; offset += 64 * 1024)
        req.write(wireBody.subarray(offset, offset + 64 * 1024));
      req.end();
    } else req.end(wireBody);
  });
}

describe('CODEX MCP JSON parser without a fixed application body cap', () => {
  const fixture: string = progressBodyAtLeast(Math.floor(1.4 * 1024 * 1024));
  const largeFixture: string = progressBodyAtLeast(5 * 1024 * 1024);
  const route: string = '/openapi/wiselink/codex-mcp';
  const scopeEnv: Record<string, string> = {
    CLIENT_BASE_PATH: '', SANDBOX_ID: 'synthetic-codex-parser-http',
    WL_MODEL_EXECUTOR: 'CODEX', WL_CODEX_RUNTIME_APP_ID: 'app_syntheticparser',
    WL_CODEX_SERVICE_SCOPE_ENABLED: '1', WL_CODEX_GATEWAY_AUTH_MODE: 'API_KEY',
    WL_CODEX_SERVICE_SCOPE_ENV: 'UAT', WL_CODEX_SERVICE_PRINCIPAL_ID: 'service:codex-parser-test',
    WL_CODEX_SERVICE_TENANT_ID: 'tenant-parser-test',
    WL_CODEX_SERVICE_WORK_ITEM_ID: 'WI-parser-synthetic',
    WL_CODEX_SERVICE_REQUEST_ID: 'REQ-parser-synthetic', WL_CODEX_SERVICE_AUTO_QUEUE_ENABLED: '1',
  };
  const previousEnv: Record<string, string | undefined> = Object.fromEntries(
    [...Object.keys(scopeEnv), 'BODY_SIZE_LIMIT'].map((key: string) => [key, process.env[key]]),
  );
  const openApps: NestExpressApplication[] = [];
  let app: NestExpressApplication;
  const handle = jest.fn(async (_request: Request, response: Response, _body: unknown) => {
    response.status(200).json({ status: 'RECEIVED' });
  });

  async function start(basePath = '', scopedParser = true): Promise<NestExpressApplication> {
    process.env.CLIENT_BASE_PATH = basePath;
    const module = await Test.createTestingModule({
      controllers: [CanonicalHostOpenClawMcpOpenApiController, OtherRoutes],
      providers: [
        { provide: AppLogger, useValue: { log() {}, error() {}, warn() {} } },
        { provide: CanonicalHostOpenClawMcpService, useValue: { handle } },
        { provide: AutomaticWorkItemDispatchService, useValue: {} },
        { provide: CANONICAL_SERVICE_SCOPE_AUTHORIZATION,
          useValue: new ConfiguredDevelopmentCanonicalServiceScopeAuthorization() },
      ],
    }).compile();
    const instance: NestExpressApplication = module.createNestApplication<NestExpressApplication>();
    openApps.push(instance);
    instance.useGlobalFilters(new GlobalExceptionFilter());
    instance.use(createTdmsDailyHttpParser());
    if (scopedParser) instance.use(createCanonicalCodexMcpHttpParser());
    await configureApp(instance, { disableSwagger: true });
    await instance.listen(0, '127.0.0.1');
    return instance;
  }

  beforeAll(async () => {
    Object.assign(process.env, scopeEnv);
    delete process.env.BODY_SIZE_LIMIT;
    app = await start();
  });
  beforeEach(() => {
    Object.assign(process.env, scopeEnv);
    delete process.env.BODY_SIZE_LIMIT;
    handle.mockClear();
    OtherRoutes.calls = 0;
  });
  afterAll(async () => {
    for (const instance of openApps) await instance.close();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('keeps the existing CODEX controller transport scope on a small request', async () => {
    expect((await send(app, route, progressBody(1))).status).toBe(200);
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it(`round-trips ${Buffer.byteLength(fixture)} UTF-8 bytes of Chinese/escaped MATERIALS_READY`, async () => {
    expect(Buffer.byteLength(fixture)).toBeGreaterThan(1024 * 1024);
    expect((await send(app, route, fixture)).status).toBe(200);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle.mock.calls[0][2]).toEqual(JSON.parse(fixture));
  });

  it('reproduces the original SDK PayloadTooLargeError without the endpoint parser', async () => {
    const baseline: NestExpressApplication = await start('', false);
    const result: HttpResult = await send(baseline, route, fixture);
    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ error: { stack: expect.stringContaining('PayloadTooLargeError') } });
    expect(handle).not.toHaveBeenCalled();
  });

  it.each([
    ['', true], ['/app/app_syntheticparser', false], ['app/app_syntheticparser/', true],
  ] as const)('supports base path %s and trailing slash=%s', async (basePath, trailingSlash) => {
    const instance: NestExpressApplication = basePath ? await start(basePath) : app;
    const prefix: string = basePath ? '/' + basePath.replace(/^\/+|\/+$/gu, '') : '';
    expect((await send(instance, prefix + route + (trailingSlash ? '/' : ''), fixture)).status).toBe(200);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle.mock.calls[0][2]).toEqual(JSON.parse(fixture));
  });

  it.each([false, true])('accepts the original materials with chunked=%s', async chunked => {
    expect((await send(app, route, fixture, { chunked })).status).toBe(200);
    expect(handle.mock.calls[0][2]).toEqual(JSON.parse(fixture));
  });

  it.each([false, true])(`round-trips ${Buffer.byteLength(largeFixture)} bytes above the former 4 MiB cap with chunked=%s`, async chunked => {
    expect(Buffer.byteLength(largeFixture)).toBeGreaterThan(4 * 1024 * 1024);
    expect((await send(app, route, largeFixture, { chunked })).status).toBe(200);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle.mock.calls[0][2]).toEqual(JSON.parse(largeFixture));
  });

  it('keeps two concurrent large requests independent', async () => {
    const results: HttpResult[] = await Promise.all([
      send(app, route, largeFixture), send(app, route, largeFixture, { chunked: true }),
    ]);
    expect(results.map((result: HttpResult) => result.status)).toEqual([200, 200]);
    expect(handle).toHaveBeenCalledTimes(2);
    for (const call of handle.mock.calls) expect(call[2]).toEqual(JSON.parse(largeFixture));
  });

  it('retains the installed server request and header timeouts', async () => {
    const baseline: NestExpressApplication = await start('', false);
    const original: Server = baseline.getHttpServer();
    const current: Server = app.getHttpServer();
    expect(current.requestTimeout).toBe(original.requestTimeout);
    expect(current.headersTimeout).toBe(original.headersTimeout);
    expect(current.timeout).toBe(original.timeout);
    expect(current.requestTimeout).toBeGreaterThan(0);
    expect(current.headersTimeout).toBeGreaterThan(0);
  });

  it('does not swallow malformed JSON', async () => {
    expect((await send(app, route, '{')).status).toBe(400);
    expect(handle).not.toHaveBeenCalled();
  });

  it('still rejects malformed JSON above the former 4 MiB cap', async () => {
    expect((await send(app, route, largeFixture.slice(0, -1))).status).toBe(400);
    expect(handle).not.toHaveBeenCalled();
  });

  it.each([
    [route + '/neighbor', 'POST'], ['/openapi/wiselink/openclaw-mcp', 'POST'], [route, 'GET'],
  ])('keeps the SDK 1 MiB rejection for %s %s', async (path, method) => {
    const result: HttpResult = await send(app, path, fixture, { method });
    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ error: { stack: expect.stringContaining('PayloadTooLargeError') } });
    expect(handle).not.toHaveBeenCalled();
    expect(OtherRoutes.calls).toBe(0);
  });

  it.each([
    ['WL_CODEX_SERVICE_SCOPE_ENABLED', '0'], ['WL_CODEX_GATEWAY_AUTH_MODE', 'OAUTH'],
  ])('retains the real controller transport rejection for %s=%s', async (key, value) => {
    process.env[key] = value;
    const result: HttpResult = await send(app, route, largeFixture);
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ error: { code: 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE' } });
    expect(handle).not.toHaveBeenCalled();
  });
});
