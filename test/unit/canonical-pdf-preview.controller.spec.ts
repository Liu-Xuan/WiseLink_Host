import 'reflect-metadata';

jest.mock('@nestjs/common', () => {
  const actual = jest.requireActual('@nestjs/common');
  const noOpDecorator = () => () => undefined;
  return {
    ...actual,
    Controller: noOpDecorator,
    Get: noOpDecorator,
    Head: noOpDecorator,
    Headers: noOpDecorator,
    Param: noOpDecorator,
    Req: noOpDecorator,
    Res: noOpDecorator,
    UseGuards: noOpDecorator,
  };
});

jest.mock('@lark-apaas/fullstack-nestjs-core', () => {
  const actual = jest.requireActual('@lark-apaas/fullstack-nestjs-core');
  return { ...actual, NeedLogin: () => () => undefined };
});

import { CanonicalPdfPreviewController } from '../../server/modules/canonical-host/canonical-pdf-preview.controller';

const HOST_REQUEST = {
  userContext: {
    userId: 'engineer-1001',
    tenantId: 'tenant-2001',
    appId: 'app_17bzc551rsg',
    roles: ['authenticated'],
    env: 'preview',
  },
};

interface TestResponse {
  headers: Record<string, string>;
  statusCode: number | null;
  body: Buffer | null;
  ended: boolean;
  response: {
    setHeader: jest.Mock;
    status: jest.Mock;
    end: jest.Mock;
    send: jest.Mock;
  };
}

function responseTarget(): TestResponse {
  const target: TestResponse = {
    headers: {},
    statusCode: null,
    body: null,
    ended: false,
    response: {
      setHeader: jest.fn(),
      status: jest.fn(),
      end: jest.fn(),
      send: jest.fn(),
    },
  };
  target.response.setHeader.mockImplementation(
    (name: string, value: string): void => {
      target.headers[name] = value;
    },
  );
  target.response.status.mockImplementation((statusCode: number) => {
    target.statusCode = statusCode;
    return target.response;
  });
  target.response.end.mockImplementation((): void => {
    target.ended = true;
  });
  target.response.send.mockImplementation((body: Buffer): void => {
    target.body = body;
  });
  return target;
}

describe('CanonicalPdfPreviewController', () => {
  const previousSandboxId = process.env.SANDBOX_ID;

  beforeAll(() => {
    process.env.SANDBOX_ID = 'unit-hosted-sandbox';
  });

  afterAll(() => {
    if (previousSandboxId === undefined) delete process.env.SANDBOX_ID;
    else process.env.SANDBOX_ID = previousSandboxId;
  });

  it('returns full PDF bytes with private same-origin headers', async () => {
    const bytes = Buffer.from('%PDF-1.4\n%%EOF');
    const previews = {
      read: jest.fn().mockResolvedValue({
        kind: 'FULL',
        byteLength: bytes.byteLength,
        bytes,
      }),
    };
    const controller = new CanonicalPdfPreviewController(previews as never);
    const target: TestResponse = responseTarget();

    await controller.get(
      'WI-PDF-1001',
      'opaque-locator',
      undefined,
      HOST_REQUEST as never,
      target.response as never,
    );

    expect(target.statusCode).toBe(200);
    expect(target.body).toEqual(bytes);
    expect(target.headers).toMatchObject({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="controlled-source.pdf"',
      'Content-Length': String(bytes.byteLength),
      'Accept-Ranges': 'none',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
    });
    expect(previews.read).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: 'WI-PDF-1001',
        opaqueLocator: 'opaque-locator',
        method: 'GET',
        range: null,
        actor: expect.objectContaining({ userId: 'engineer-1001' }),
      }),
    );
  });

  it('serves HEAD without reading a response body', async () => {
    const previews = {
      read: jest.fn().mockResolvedValue({ kind: 'HEAD', byteLength: 1060204 }),
    };
    const controller = new CanonicalPdfPreviewController(previews as never);
    const target: TestResponse = responseTarget();

    await controller.head(
      'WI-PDF-1001',
      'opaque-locator',
      undefined,
      HOST_REQUEST as never,
      target.response as never,
    );

    expect(target.statusCode).toBe(200);
    expect(target.ended).toBe(true);
    expect(target.body).toBeNull();
    expect(target.headers['Content-Length']).toBe('1060204');
  });

  it('returns 416 and no body when a client asks for unsupported Range', async () => {
    const previews = {
      read: jest.fn().mockResolvedValue({
        kind: 'RANGE_UNSUPPORTED',
        byteLength: 1060204,
      }),
    };
    const controller = new CanonicalPdfPreviewController(previews as never);
    const target: TestResponse = responseTarget();

    await controller.get(
      'WI-PDF-1001',
      'opaque-locator',
      'bytes=0-1023',
      HOST_REQUEST as never,
      target.response as never,
    );

    expect(target.statusCode).toBe(416);
    expect(target.ended).toBe(true);
    expect(target.body).toBeNull();
    expect(target.headers).toMatchObject({
      'Accept-Ranges': 'none',
      'Content-Range': 'bytes */1060204',
      'Content-Length': '0',
    });
  });

  it('keeps private same-origin headers on structured error responses', async () => {
    const previews = {
      read: jest.fn().mockRejectedValue(
        Object.assign(new Error('PDF_PREVIEW_NOT_FOUND'), {
          code: 'PDF_PREVIEW_NOT_FOUND',
          statusCode: 404,
        }),
      ),
    };
    const controller = new CanonicalPdfPreviewController(previews as never);
    const target: TestResponse = responseTarget();

    await expect(
      controller.get(
        'WI-PDF-1001',
        'wrong-scope-locator',
        undefined,
        HOST_REQUEST as never,
        target.response as never,
      ),
    ).rejects.toMatchObject({
      code: 'PDF_PREVIEW_NOT_FOUND',
      statusCode: 404,
    });
    expect(target.headers).toMatchObject({
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
    });
    expect(target.headers).not.toHaveProperty('Content-Disposition');
  });
});
