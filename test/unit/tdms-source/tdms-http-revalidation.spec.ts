import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { request } from 'node:http';
import { TdmsSourceController } from '../../../server/modules/tdms-source/tdms-source.controller';
import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import { CANONICAL_MIAODA_APP_ID } from '../../../server/modules/canonical-host/canonical-host.constants';

// Synthetic local HTTP lifecycle evidence, not proof of production gateway or proxy behavior.
describe('private TDMS HTTP conditional revalidation', () => {
  let app: INestApplication;
  let port: number;
  let admitted = true;
  let calls = 0;
  const previous = process.env.SANDBOX_ID;
  beforeAll(async () => {
    process.env.SANDBOX_ID = 'synthetic-http-test';
    const module = await Test.createTestingModule({
      controllers: [TdmsSourceController],
      providers: [
        {
          provide: TdmsSourceService,
          useValue: {
            catalogue: jest.fn(async (actor) => {
              calls++;
              if (!admitted || actor.canonicalSubject.id !== '456')
                return {
                  records: [],
                  sourceStatus: 'DISABLED',
                  readPerformed: false,
                };
              return {
                records: [
                  { sourceRevisionRef: 'exact-1', title: 'authorized-title' },
                ],
                sourceStatus: 'AVAILABLE',
                readPerformed: false,
              };
            }),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use((req, _res, next) => {
      req.userContext = {
        userId: req.headers['x-test-subject'],
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
  const get = (subjectId: string, etag?: string) =>
    new Promise<{
      status: number;
      body: string;
      headers: Record<string, unknown>;
    }>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path: '/api/tdms-source/records',
          headers: {
            'x-test-subject': subjectId,
            cookie: `synthetic-user=${subjectId}`,
            ...(etag ? { 'If-None-Match': etag } : {}),
          },
        },
        (res) => {
          let body = '';
          res.on('data', (data) => {
            body += data;
          });
          res.on('end', () =>
            resolve({ status: res.statusCode!, body, headers: res.headers }),
          );
        },
      );
      req.on('error', reject);
      req.end();
    });
  it('allows private 304 reuse only after executing the current authorized service read', async () => {
    const first = await get('456');
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toBe(
      'private, no-cache, must-revalidate',
    );
    expect(first.headers.vary).toBe('Cookie, Authorization');
    const etag = String(first.headers.etag);
    expect(etag).not.toBe('undefined');
    const before = calls;
    const repeat = await get('456', etag);
    expect(repeat.status).toBe(304);
    expect(calls).toBe(before + 1);
    const outsider = await get('789', etag);
    expect(outsider.status).not.toBe(304);
    expect(outsider.body).not.toContain('authorized-title');
    admitted = false;
    const revoked = await get('456', etag);
    expect(revoked.status).not.toBe(304);
    expect(revoked.body).not.toContain('authorized-title');
    expect(calls).toBe(before + 3);
  });
});
