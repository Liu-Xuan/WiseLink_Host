const request = jest.fn();

jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({
  axiosForBackend: request,
}));

import {
  exchangeOfficialOauthCallback,
  OfficialOauthRequestError,
  startOfficialOauth,
} from '../../client/src/api/identity-oauth';

describe('Hosted official OAuth client transport', () => {
  beforeEach(() => {
    request.mockReset();
  });

  it('starts through the official same-origin backend client', async () => {
    const authorizeUrl =
      'https://accounts.feishu.cn/open-apis/authen/v1/authorize' +
      '?response_type=code&code_challenge_method=S256' +
      '&code_challenge=challenge&state=state';
    request.mockResolvedValue({ status: 200, data: { authorizeUrl } });

    await expect(startOfficialOauth()).resolves.toBe(authorizeUrl);
    expect(request).toHaveBeenCalledWith({
      url: '/api/identity/oauth/start',
      method: 'POST',
      data: {},
    });
  });

  it('rejects a non-official authorize redirect', async () => {
    request.mockResolvedValue({
      status: 200,
      data: { authorizeUrl: 'https://attacker.example/callback' },
    });
    await expect(startOfficialOauth()).rejects.toThrow(
      'OAUTH_AUTHORIZE_URL_INVALID',
    );
  });

  it('posts callback JSON as an opaque Blob that platform logs cannot expand', async () => {
    request.mockResolvedValue({ status: 204, data: undefined });
    const input = {
      code: 'sensitive-authorization-code',
      state: 'sensitive-oauth-state',
    };

    await exchangeOfficialOauthCallback(input);

    const config = request.mock.calls[0]?.[0] as {
      url: string;
      method: string;
      data: Blob;
      headers: Record<string, string>;
    };
    expect(config.url).toBe('/api/identity/oauth/callback');
    expect(config.method).toBe('POST');
    expect(config.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(config.data).toBeInstanceOf(Blob);
    expect(JSON.stringify(config)).not.toContain(input.code);
    expect(JSON.stringify(config)).not.toContain(input.state);
    await expect(config.data.text()).resolves.toBe(JSON.stringify(input));
  });

  it.each([
    'IDENTITY_OAUTH_NOT_CONFIGURED',
    'OAUTH_CALLBACK_MISSING_CODE',
    'OAUTH_CALLBACK_MISSING_STATE',
    'OAUTH_STATE_INVALID',
    'OAUTH_TOKEN_EXCHANGE_FAILED',
    'IDENTITY_VERIFICATION_UNAVAILABLE',
  ])(
    'normalizes an Axios callback rejection to the controlled code %s',
    async (code) => {
      const sensitive = 'private-transport-detail';
      request.mockRejectedValue({
        isAxiosError: true,
        message: sensitive,
        config: { data: sensitive },
        request: { private: sensitive },
        response: {
          status: 503,
          data: { code, message: sensitive, details: { reason: sensitive } },
          headers: { private: sensitive },
        },
      });
      const failure = await exchangeOfficialOauthCallback({
        code: 'code',
        state: 'state',
      }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(OfficialOauthRequestError);
      expect(failure).toMatchObject({ code, message: code, status: 503 });
      for (const key of ['cause', 'details', 'config', 'request', 'response']) {
        expect(failure).not.toHaveProperty(key);
      }
      expect(JSON.stringify(failure)).not.toContain(sensitive);
      expect(String(failure)).not.toContain(sensitive);
      expect(Object.getOwnPropertyNames(failure).sort()).toEqual([
        'code',
        'message',
        'name',
        'stack',
        'status',
      ]);
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    {
      response: {
        status: 502,
        data: { code: 'private-code', message: 'private-message' },
      },
    },
    { response: { status: 502, data: 'private-non-JSON-body' } },
    { response: { status: 502, data: { code: { private: 'detail' } } } },
    { message: 'private-network-detail', config: { data: 'private-code' } },
  ])(
    'collapses unknown callback transport failures without retaining their body',
    async (error) => {
      request.mockRejectedValue(error);
      const failure = await exchangeOfficialOauthCallback({
        code: 'code',
        state: 'state',
      }).catch((caught: unknown) => caught);
      expect(failure).toBeInstanceOf(OfficialOauthRequestError);
      expect(failure).toMatchObject({
        code: 'CALLBACK_REQUEST_FAILED',
        message: 'CALLBACK_REQUEST_FAILED',
      });
      expect(JSON.stringify(failure)).not.toContain('private');
      expect(String(failure)).not.toContain('private');
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it('normalizes a rejected start response and preserves only its code and HTTP status', async () => {
    request.mockRejectedValue({
      response: {
        status: 503,
        data: {
          code: 'IDENTITY_OAUTH_NOT_CONFIGURED',
          message: 'private-configuration',
        },
      },
    });
    await expect(startOfficialOauth()).rejects.toMatchObject({
      code: 'IDENTITY_OAUTH_NOT_CONFIGURED',
      status: 503,
      message: 'IDENTITY_OAUTH_NOT_CONFIGURED',
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('uses a fixed start fallback for a network rejection', async () => {
    request.mockRejectedValue(new Error('private-network-error'));
    await expect(startOfficialOauth()).rejects.toMatchObject({
      code: 'START_REQUEST_FAILED',
      message: 'START_REQUEST_FAILED',
    });
  });

  it.each(['start', 'callback'] as const)(
    'also normalizes non-success resolved %s responses',
    async (kind) => {
      request.mockResolvedValue({
        status: 400,
        data: {
          code: 'OAUTH_STATE_INVALID',
          message: 'private-state',
          details: { state: 'private-state' },
        },
      });
      const operation =
        kind === 'start'
          ? startOfficialOauth()
          : exchangeOfficialOauthCallback({ code: 'code', state: 'state' });
      const failure = await operation.catch((error: unknown) => error);
      expect(failure).toMatchObject({
        code: 'OAUTH_STATE_INVALID',
        message: 'OAUTH_STATE_INVALID',
        status: 400,
      });
      expect(JSON.stringify(failure)).not.toContain('private');
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it('does not retain an untrusted non-HTTP status value', async () => {
    request.mockRejectedValue({
      response: { status: 'private-status', data: { code: 'private-code' } },
    });
    const failure = await exchangeOfficialOauthCallback({
      code: 'code',
      state: 'state',
    }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'CALLBACK_REQUEST_FAILED' });
    expect(failure).not.toHaveProperty('status');
    expect(JSON.stringify(failure)).not.toContain('private');
  });

  it.each([
    {
      isAxiosError: true,
      code: 'ECONNABORTED',
      message: 'Request aborted',
      response: { status: 0 },
    },
    {
      isAxiosError: true,
      code: 'ERR_CANCELED',
      config: { data: 'private-code' },
    },
    { name: 'AbortError', message: 'private-abort-detail' },
  ])(
    'marks an interrupted callback as an unknown outcome without retrying',
    async (error) => {
      request.mockRejectedValue(error);
      const failure = await exchangeOfficialOauthCallback({
        code: 'code',
        state: 'state',
      }).catch((caught: unknown) => caught);
      expect(failure).toMatchObject({
        code: 'CALLBACK_OUTCOME_UNKNOWN',
        message: 'CALLBACK_OUTCOME_UNKNOWN',
      });
      expect(failure).not.toHaveProperty('status');
      expect(failure).not.toHaveProperty('response');
      expect(JSON.stringify(failure)).not.toContain('private');
      expect(request).toHaveBeenCalledTimes(1);
    },
  );
});
