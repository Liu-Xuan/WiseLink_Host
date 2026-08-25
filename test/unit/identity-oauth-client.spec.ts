const request = jest.fn();

jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({
  axiosForBackend: request,
}));

import {
  exchangeOfficialOauthCallback,
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
});
