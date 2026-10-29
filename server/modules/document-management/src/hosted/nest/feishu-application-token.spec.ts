import {
  FeishuApplicationToken,
  type FeishuApplicationTokenConfiguration,
  type FeishuApplicationTokenRequest,
} from './feishu-application-token';

const APPLICATION: FeishuApplicationTokenConfiguration = {
  appId: 'test-app',
  appSecret: 'synthetic-app-secret',
};

describe('FeishuApplicationToken', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('uses the existing official HTTP contract with explicit application configuration', async () => {
    const request: jest.MockedFunction<FeishuApplicationTokenRequest> = tokenRequest();
    request.mockResolvedValue(tokenResponse('synthetic-tenant-token'));
    const tokens: FeishuApplicationToken = new FeishuApplicationToken(request);

    await expect(tokens.get(APPLICATION)).resolves.toBe('synthetic-tenant-token');
    expect(String(request.mock.calls[0]?.[0])).toBe(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    );
    expect(request.mock.calls[0]?.[1]).toEqual({
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        app_id: APPLICATION.appId,
        app_secret: APPLICATION.appSecret,
      }),
    });
    expect(JSON.stringify(tokens)).not.toContain(APPLICATION.appSecret);
    expect(JSON.stringify(tokens)).not.toContain('synthetic-tenant-token');
  });

  it('reuses a valid token and refreshes at the remaining 60 second boundary and after expiry', async () => {
    let now: number = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation((): number => now);
    const request: jest.MockedFunction<FeishuApplicationTokenRequest> = tokenRequest();
    request.mockResolvedValueOnce(tokenResponse('first', 120))
      .mockResolvedValueOnce(tokenResponse('second', 120))
      .mockResolvedValueOnce(tokenResponse('third', 120));
    const tokens: FeishuApplicationToken = new FeishuApplicationToken(request);

    await expect(tokens.get(APPLICATION)).resolves.toBe('first');
    now += 59_999;
    await expect(tokens.get({ ...APPLICATION })).resolves.toBe('first');
    expect(request).toHaveBeenCalledTimes(1);
    now += 1;
    await expect(tokens.get(APPLICATION)).resolves.toBe('second');
    now += 120_001;
    await expect(tokens.get(APPLICATION)).resolves.toBe('third');
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('does not reuse a token whose entire lifetime is the refresh window', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const request: jest.MockedFunction<FeishuApplicationTokenRequest> = tokenRequest();
    request.mockResolvedValueOnce(tokenResponse('short', 60))
      .mockResolvedValueOnce(tokenResponse('fresh', 7200));
    const tokens: FeishuApplicationToken = new FeishuApplicationToken(request);

    await expect(tokens.get(APPLICATION)).resolves.toBe('short');
    await expect(tokens.get(APPLICATION)).resolves.toBe('fresh');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('isolates app ids, rotated credentials, and a switch back to the previous configuration', async () => {
    const rotated: FeishuApplicationTokenConfiguration = {
      ...APPLICATION, appSecret: 'rotated-synthetic-secret',
    };
    const other: FeishuApplicationTokenConfiguration = {
      ...rotated, appId: 'other-test-app',
    };
    const request: jest.MockedFunction<FeishuApplicationTokenRequest> = tokenRequest();
    request.mockResolvedValueOnce(tokenResponse('original-token'))
      .mockResolvedValueOnce(tokenResponse('rotated-token'))
      .mockResolvedValueOnce(tokenResponse('other-app-token'))
      .mockResolvedValueOnce(tokenResponse('original-refetched-token'));
    const tokens: FeishuApplicationToken = new FeishuApplicationToken(request);

    await expect(tokens.get(APPLICATION)).resolves.toBe('original-token');
    await expect(tokens.get(rotated)).resolves.toBe('rotated-token');
    await expect(tokens.get(other)).resolves.toBe('other-app-token');
    await expect(tokens.get(APPLICATION)).resolves.toBe('original-refetched-token');
    expect(request.mock.calls.map((call: [URL, RequestInit]): unknown =>
      JSON.parse(String(call[1].body)))).toEqual([
      { app_id: APPLICATION.appId, app_secret: APPLICATION.appSecret },
      { app_id: rotated.appId, app_secret: rotated.appSecret },
      { app_id: other.appId, app_secret: other.appSecret },
      { app_id: APPLICATION.appId, app_secret: APPLICATION.appSecret },
    ]);
  });

  it('keeps caches local to each consumer instance', async () => {
    const request: jest.MockedFunction<FeishuApplicationTokenRequest> = tokenRequest();
    request.mockResolvedValueOnce(tokenResponse('drive-consumer-token'))
      .mockResolvedValueOnce(tokenResponse('separate-consumer-token'));
    const drive: FeishuApplicationToken = new FeishuApplicationToken(request);
    const separate: FeishuApplicationToken = new FeishuApplicationToken(request);

    await expect(drive.get(APPLICATION)).resolves.toBe('drive-consumer-token');
    await expect(separate.get(APPLICATION)).resolves.toBe('separate-consumer-token');
    await expect(drive.get(APPLICATION)).resolves.toBe('drive-consumer-token');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([
    { appId: '', appSecret: APPLICATION.appSecret },
    { appId: APPLICATION.appId, appSecret: '   ' },
  ])('rejects missing configuration before HTTP and clears any previous cache', async (
    invalid: FeishuApplicationTokenConfiguration,
  ) => {
    const request: jest.MockedFunction<FeishuApplicationTokenRequest> = tokenRequest();
    request.mockResolvedValueOnce(tokenResponse('before-disabled'))
      .mockResolvedValueOnce(tokenResponse('after-reconfigured'));
    const tokens: FeishuApplicationToken = new FeishuApplicationToken(request);

    await expect(tokens.get(APPLICATION)).resolves.toBe('before-disabled');
    await expect(tokens.get(invalid)).rejects.toThrow('FEISHU_APPLICATION_IDENTITY_NOT_CONFIGURED');
    expect(request).toHaveBeenCalledTimes(1);
    await expect(tokens.get(APPLICATION)).resolves.toBe('after-reconfigured');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('never falls back to the old token when changed configuration is refused', async () => {
    const request: jest.MockedFunction<FeishuApplicationTokenRequest> = tokenRequest();
    request.mockResolvedValueOnce(tokenResponse('old-token'))
      .mockResolvedValueOnce(Response.json({ code: 99991672, msg: 'permission_denied' }, { status: 403 }))
      .mockResolvedValueOnce(tokenResponse('refetched-old-configuration'));
    const tokens: FeishuApplicationToken = new FeishuApplicationToken(request);

    await expect(tokens.get(APPLICATION)).resolves.toBe('old-token');
    await expect(tokens.get({ ...APPLICATION, appSecret: 'new-secret' })).rejects.toMatchObject({
      status: 403, code: 99991672, message: 'FEISHU_APPLICATION_TOKEN_REQUEST_FAILED',
    });
    await expect(tokens.get(APPLICATION)).resolves.toBe('refetched-old-configuration');
    expect(request).toHaveBeenCalledTimes(3);
  });

  it.each(tokenRejectionCases())('rejects $name without caching or returning the response token', async (
    failure: TokenRejectionCase,
  ) => {
    const request: jest.MockedFunction<FeishuApplicationTokenRequest> = tokenRequest();
    request.mockResolvedValueOnce(Response.json(failure.body, { status: failure.status }))
      .mockResolvedValueOnce(tokenResponse('subsequent-valid-token'));
    const tokens: FeishuApplicationToken = new FeishuApplicationToken(request);

    await expect(tokens.get(APPLICATION)).rejects.toMatchObject({
      status: failure.status,
      code: failure.code,
      message: 'FEISHU_APPLICATION_TOKEN_REQUEST_FAILED',
    });
    await expect(tokens.get(APPLICATION)).resolves.toBe('subsequent-valid-token');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([{ body: null }, { body: [] }, { body: 'unexpected-json-value' }])(
    'rejects a non-object response without exposing its body',
    async ({ body }: { body: unknown }) => {
      const request: jest.MockedFunction<FeishuApplicationTokenRequest> = tokenRequest();
      request.mockResolvedValue(Response.json(body));
      const tokens: FeishuApplicationToken = new FeishuApplicationToken(request);
      await expect(tokens.get(APPLICATION)).rejects.toMatchObject({
        status: 200, code: null, message: 'FEISHU_APPLICATION_TOKEN_RESPONSE_INVALID',
      });
    },
  );

  it.each(tokenErrorLeakCases())('does not retain $name in any error view', async (
    failure: TokenErrorLeakCase,
  ) => {
    const request: jest.MockedFunction<FeishuApplicationTokenRequest> = tokenRequest();
    request.mockResolvedValue(Response.json(failure.body));
    const tokens: FeishuApplicationToken = new FeishuApplicationToken(request);
    const error: unknown = await rejection(tokens.get(APPLICATION));

    expect(error).toMatchObject({
      status: 200, code: 99991672,
      message: 'FEISHU_APPLICATION_TOKEN_REQUEST_FAILED',
    });
    expect(error).not.toHaveProperty('cause');
    if (!(error instanceof Error)) throw new Error('Expected a fixed token error');
    expect(Object.keys(error)).toEqual(['status', 'code']);
    failure.forbidden.forEach((marker: string): void => {
      expect(errorText(error)).not.toContain(marker);
      expect(JSON.stringify(tokens)).not.toContain(marker);
    });
  });

  it('does not propagate transport errors that can contain request secrets', async () => {
    const marker: string = 'synthetic-transport-cause-token';
    const request: jest.MockedFunction<FeishuApplicationTokenRequest> = tokenRequest();
    request.mockRejectedValue(Object.assign(new Error(`transport body: ${APPLICATION.appSecret}`), {
      cause: { token: marker },
    }));
    const tokens: FeishuApplicationToken = new FeishuApplicationToken(request);
    const error: unknown = await rejection(tokens.get(APPLICATION));

    expect(error).toMatchObject({ message: 'FEISHU_APPLICATION_TOKEN_REQUEST_FAILED' });
    expect(error).not.toHaveProperty('cause');
    expect(errorText(error)).not.toContain(APPLICATION.appSecret);
    expect(errorText(error)).not.toContain(marker);
  });

  it('does not propagate a malformed JSON parser error containing response credentials', async () => {
    const request: jest.MockedFunction<FeishuApplicationTokenRequest> = tokenRequest();
    request.mockResolvedValue(new Response(`not-json ${APPLICATION.appSecret} untrusted-token`));
    const tokens: FeishuApplicationToken = new FeishuApplicationToken(request);
    const error: unknown = await rejection(tokens.get(APPLICATION));

    expect(error).toMatchObject({
      status: 200, code: null, message: 'FEISHU_APPLICATION_TOKEN_RESPONSE_INVALID',
    });
    expect(error).not.toHaveProperty('cause');
    expect(errorText(error)).not.toContain(APPLICATION.appSecret);
    expect(errorText(error)).not.toContain('untrusted-token');
  });

  it.each([
    { name: 'non-JSON HTTP 503', status: 503, nonJson: true },
    { name: 'non-object HTTP 403', status: 403, nonJson: false },
  ])('preserves the known status for $name without retaining the body', async (
    failure: { name: string; status: number; nonJson: boolean },
  ) => {
    const marker: string = 'synthetic-response-only-token';
    const response: Response = failure.nonJson
      ? new Response(`not-json ${marker}`, { status: failure.status })
      : Response.json([marker], { status: failure.status });
    const request: jest.MockedFunction<FeishuApplicationTokenRequest> = tokenRequest();
    request.mockResolvedValue(response);
    const tokens: FeishuApplicationToken = new FeishuApplicationToken(request);
    const error: unknown = await rejection(tokens.get(APPLICATION));

    expect(error).toMatchObject({
      status: failure.status, code: null, message: 'FEISHU_APPLICATION_TOKEN_RESPONSE_INVALID',
    });
    expect(error).not.toHaveProperty('cause');
    expect(errorText(error)).not.toContain(marker);
  });
});

interface TokenRejectionCase {
  name: string;
  body: unknown;
  status: number;
  code: number | null;
}

interface TokenErrorLeakCase {
  name: string;
  body: unknown;
  forbidden: string[];
}

function tokenErrorLeakCases(): TokenErrorLeakCase[] {
  const knownToken: string = 'synthetic-known-response-token';
  const messageOnlyToken: string = 'synthetic-message-only-token';
  const nestedToken: string = 'synthetic-wrong-layer-token';
  const escapedToken: string = String.raw`\u0074\u006f\u006b\u0065\u006e`;
  const escapedSecret: string = String.raw`synthetic-app-\u0073ecret`;
  return [
    {
      name: 'a known response token or app secret',
      body: { code: 99991672, msg: `${knownToken} ${APPLICATION.appSecret}`,
        tenant_access_token: knownToken, expire: 7200 },
      forbidden: [knownToken, APPLICATION.appSecret],
    },
    {
      name: 'a token present only in msg',
      body: { code: 99991672, msg: `authorization=${messageOnlyToken}` },
      forbidden: [messageOnlyToken],
    },
    {
      name: 'a token from a different error layer',
      body: { code: 99991672,
        msg: JSON.stringify({ error: { tenant_access_token: nestedToken } }),
        data: { error: { token: nestedToken } }, cause: { token: nestedToken } },
      forbidden: [nestedToken],
    },
    {
      name: 'escaped token and secret text',
      body: { code: 99991672, msg: `${escapedToken} ${escapedSecret}` },
      forbidden: [escapedToken, escapedSecret],
    },
  ];
}

function tokenRejectionCases(): TokenRejectionCase[] {
  return [
    { name: 'an HTTP failure despite code zero', status: 503, code: 0,
      body: { code: 0, tenant_access_token: 'unusable-token', expire: 7200 } },
    { name: 'a platform failure despite HTTP success', status: 200, code: 99991672,
      body: { code: 99991672, msg: 'permission_denied', tenant_access_token: 'unusable-token', expire: 7200 } },
    { name: 'a nonnumeric platform code', status: 200, code: null,
      body: { code: '0', tenant_access_token: 'unusable-token', expire: 7200 } },
    { name: 'a missing token', status: 200, code: 0, body: { code: 0, expire: 7200 } },
    { name: 'a blank token', status: 200, code: 0,
      body: { code: 0, tenant_access_token: '   ', expire: 7200 } },
    { name: 'a missing expiry', status: 200, code: 0,
      body: { code: 0, tenant_access_token: 'unusable-token' } },
    { name: 'a string expiry', status: 200, code: 0,
      body: { code: 0, tenant_access_token: 'unusable-token', expire: '7200' } },
    { name: 'a zero expiry', status: 200, code: 0,
      body: { code: 0, tenant_access_token: 'unusable-token', expire: 0 } },
    { name: 'a negative expiry', status: 200, code: 0,
      body: { code: 0, tenant_access_token: 'unusable-token', expire: -1 } },
    { name: 'an overflowing expiry', status: 200, code: 0,
      body: { code: 0, tenant_access_token: 'unusable-token', expire: Number.MAX_VALUE } },
    { name: 'a token under a different response contract', status: 200, code: 0,
      body: { code: 0, data: { tenant_access_token: 'unusable-token', expire: 7200 } } },
  ];
}

function tokenRequest(): jest.MockedFunction<FeishuApplicationTokenRequest> {
  return jest.fn<Promise<Response>, [URL, RequestInit]>();
}

function tokenResponse(token: string, expire: number = 7200): Response {
  return Response.json({ code: 0, tenant_access_token: token, expire });
}

async function rejection(promise: Promise<string>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('Expected token acquisition to fail');
}

function errorText(error: unknown): string {
  return error instanceof Error
    ? `${error.message}\n${error.stack}\n${JSON.stringify(error)}\n` +
      JSON.stringify(Object.getOwnPropertyDescriptors(error))
    : String(error);
}
