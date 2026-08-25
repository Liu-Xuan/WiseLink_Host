import 'reflect-metadata';

jest.mock('@nestjs/common', () => {
  const actual = jest.requireActual('@nestjs/common');
  const noOp = () => () => undefined;
  return { ...actual, Body: noOp, Controller: noOp, Inject: noOp, Post: noOp, Res: noOp, HttpCode: noOp };
});

import { OauthFlowController } from '../../server/modules/identity/oauth-flow.controller';
import { HOST_SESSION_ABSOLUTE_TTL_MS } from '../../server/modules/identity/session.store';

const configured = {
  configured: true,
  clientId: 'cli_aadde8b579f95bc9',
  redirectUri: 'https://hv5zjf4j8yb.feishuapp.com/app/app_17bzc551rsg/client/oauth/callback',
  tokenApiVersion: 'v3' as const,
  mappingBootstrap: { kind: 'DISABLED' as const },
  applicationScopeId: 'app_17bzc551rsg' as const,
  sessionEnvironment: 'preview' as const,
};
const identity = {
  subjectMappingId: '11111111-1111-4111-8111-111111111111',
  provenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN' as const,
  miaodaUserId: 'miaoda-user-1', tenantId: 'tenant-1', feishuUserId: null,
  feishuOpenId: 'ou-user-1',
  namespacedSubject: { namespace: 'FEISHU_OPEN_ID' as const, subject: 'ou-user-1', tenantKey: 'tenant-key-1' },
  verifiedAt: '2026-08-25T00:00:00.000Z',
};

describe('OauthFlowController official OAuth contract', () => {
  beforeEach(() => { process.env.FEISHU_OAUTH_CLIENT_SECRET = 'controlled-dev-secret'; });
  afterEach(() => { delete process.env.FEISHU_OAUTH_CLIENT_SECRET; });

  it('fails closed when authorize configuration is absent', async () => {
    const response = fakeResponse();
    await controller({ ...configured, configured: false }, {}, {}, {}, {}).beginAuthorize(response as never);
    expect(response.status).toHaveBeenCalledWith(503);
  });

  it('fails closed before state issuance when token endpoint selection is invalid', async () => {
    const response = fakeResponse();
    const state = { issue: jest.fn() };

    await controller(
      { ...configured, tokenApiVersion: null },
      state,
      {},
      {},
      {},
    ).beginAuthorize(response as never);

    expect(response.status).toHaveBeenCalledWith(503);
    expect(state.issue).not.toHaveBeenCalled();
  });

  it('returns only the official Feishu authorize endpoint', async () => {
    const response = fakeResponse();
    await controller(configured, { issue: jest.fn().mockResolvedValue('state-1') }, {}, {}, {}).beginAuthorize(response as never);
    const url = new URL(response.json.mock.calls[0][0].authorizeUrl);
    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.feishu.cn/open-apis/authen/v1/authorize');
  });

  it('sends state + PKCE S256 + exact callback URL', async () => {
    const state = { issue: jest.fn().mockResolvedValue('state-1') }; const response = fakeResponse();
    await controller(configured, state, {}, {}, {}).beginAuthorize(response as never);
    const url = new URL(response.json.mock.calls[0][0].authorizeUrl);
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('redirect_uri')).toBe(configured.redirectUri);
    expect(state.issue).toHaveBeenCalledWith(expect.any(String));
  });

  it('fails closed when callback configuration is absent', async () => {
    const response = fakeResponse();
    await controller({ ...configured, configured: false }, {}, {}, {}, {}).handleCallback({ code: 'code', state: 'state' }, response as never);
    expect(response.status).toHaveBeenCalledWith(503);
  });

  it('rejects a callback without code', async () => {
    const response = fakeResponse();
    await controller(configured, {}, {}, {}, {}).handleCallback({ code: '', state: 'state' }, response as never);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'OAUTH_CALLBACK_MISSING_CODE' }));
  });

  it('rejects a callback without state', async () => {
    const response = fakeResponse();
    await controller(configured, {}, {}, {}, {}).handleCallback({ code: 'code', state: '' }, response as never);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'OAUTH_CALLBACK_MISSING_STATE' }));
  });

  it('rejects expired or replayed state before token exchange', async () => {
    const token = { fetchToken: jest.fn() }; const response = fakeResponse();
    await controller(configured, { consume: jest.fn().mockResolvedValue(null) }, token, {}, {}).handleCallback({ code: 'code', state: 'state' }, response as never);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'OAUTH_STATE_INVALID' }));
    expect(token.fetchToken).not.toHaveBeenCalled();
  });

  it('never reflects callback code or state in an error response', async () => {
    const response = fakeResponse();
    await controller(
      configured,
      { consume: jest.fn().mockResolvedValue(null) },
      {},
      {},
      {},
    ).handleCallback(
      { code: 'sensitive-code', state: 'sensitive-state' },
      response as never,
    );
    const reflected = JSON.stringify(response.json.mock.calls);
    expect(reflected).not.toContain('sensitive-code');
    expect(reflected).not.toContain('sensitive-state');
  });

  it('fails closed when the controlled server secret is unavailable', async () => {
    delete process.env.FEISHU_OAUTH_CLIENT_SECRET; const response = fakeResponse();
    await controller(configured, { consume: jest.fn().mockResolvedValue({ codeVerifier: 'v' }) }, {}, {}, {}).handleCallback({ code: 'code', state: 'state' }, response as never);
    expect(response.status).toHaveBeenCalledWith(503);
  });

  it('fails closed when official token exchange fails', async () => {
    const response = fakeResponse();
    await controller(configured, { consume: jest.fn().mockResolvedValue({ codeVerifier: 'v' }) }, { fetchToken: jest.fn().mockResolvedValue(null) }, {}, {}).handleCallback({ code: 'code', state: 'state' }, response as never);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'OAUTH_TOKEN_EXCHANGE_FAILED' }));
  });

  it('passes the stored PKCE verifier and server configuration to token exchange', async () => {
    const token = { fetchToken: jest.fn().mockResolvedValue(null) };
    const response = fakeResponse();
    await controller(
      configured,
      { consume: jest.fn().mockResolvedValue({ codeVerifier: 'stored-pkce-verifier' }) },
      token,
      {},
      {},
    ).handleCallback({ code: 'authorization-code', state: 'state' }, response as never);
    expect(token.fetchToken).toHaveBeenCalledWith({
      apiVersion: 'v3',
      clientId: configured.clientId,
      clientSecret: 'controlled-dev-secret',
      code: 'authorization-code',
      redirectUri: configured.redirectUri,
      codeVerifier: 'stored-pkce-verifier',
    });
  });

  it('passes the selected v2 compatibility contract without retrying in the controller', async () => {
    const token = { fetchToken: jest.fn().mockResolvedValue(null) };
    const response = fakeResponse();

    await controller(
      { ...configured, tokenApiVersion: 'v2' },
      { consume: jest.fn().mockResolvedValue({ codeVerifier: 'stored-pkce-verifier' }) },
      token,
      {},
      {},
    ).handleCallback(
      { code: 'authorization-code', state: 'state' },
      response as never,
    );

    expect(token.fetchToken).toHaveBeenCalledTimes(1);
    expect(token.fetchToken).toHaveBeenCalledWith(
      expect.objectContaining({
        apiVersion: 'v2',
        codeVerifier: 'stored-pkce-verifier',
      }),
    );
  });

  it('passes only the server-returned access token and client id to identity verification', async () => {
    const verification = { verify: jest.fn().mockResolvedValue({ kind: 'UNAVAILABLE', reason: 'FEISHU_SUBJECT_MAPPING_MISSING' }) };
    await controller(
      configured,
      { consume: jest.fn().mockResolvedValue({ codeVerifier: 'v' }) },
      { fetchToken: jest.fn().mockResolvedValue({ accessToken: 'official-user-access-token' }) },
      verification,
      {},
    ).handleCallback({ code: 'code', state: 'state' }, fakeResponse() as never);
    expect(verification.verify).toHaveBeenCalledWith({
      accessToken: 'official-user-access-token',
      clientId: configured.clientId,
      contextTenantId: '',
    });
  });

  it('fails closed when user_info or Host mapping verification fails', async () => {
    const response = fakeResponse();
    await controller(configured, { consume: jest.fn().mockResolvedValue({ codeVerifier: 'v' }) }, { fetchToken: jest.fn().mockResolvedValue({ accessToken: 'token' }) }, { verify: jest.fn().mockResolvedValue({ kind: 'UNAVAILABLE', reason: 'FEISHU_SUBJECT_MAPPING_MISSING' }) }, {}).handleCallback({ code: 'code', state: 'state' }, response as never);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'IDENTITY_VERIFICATION_UNAVAILABLE' }));
  });

  it('sets an exact secure HttpOnly cookie and returns no JSON token', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-26T00:00:00.000Z'));
    try {
      const response = fakeResponse();
      await successController(identity).handleCallback({ code: 'code', state: 'state' }, response as never);
      expect(response.cookie).toHaveBeenCalledWith('wl_session', 'raw-session-token', {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: HOST_SESSION_ABSOLUTE_TTL_MS,
        path: '/',
      });
      expect(response.status).toHaveBeenCalledWith(204);
      expect(response.send).toHaveBeenCalledWith();
      expect(response.json).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not fail when official user_info omits user_id', async () => {
    const response = fakeResponse();
    await successController({ ...identity, feishuUserId: null }).handleCallback({ code: 'code', state: 'state' }, response as never);
    expect(response.status).toHaveBeenCalledWith(204);
    expect(response.json).not.toHaveBeenCalled();
  });
});

function controller(config: unknown, state: unknown, token: unknown, verification: unknown, session: unknown) {
  return new OauthFlowController(config as never, state as never, token as never, verification as never, session as never);
}

function successController(verifiedIdentity: typeof identity) {
  return controller(
    configured,
    { consume: jest.fn().mockResolvedValue({ codeVerifier: 'verifier' }) },
    { fetchToken: jest.fn().mockResolvedValue({ accessToken: 'user-access-token' }) },
    { verify: jest.fn().mockResolvedValue({ kind: 'VERIFIED', identity: verifiedIdentity }) },
    { create: jest.fn().mockImplementation(() => Promise.resolve({ token: 'raw-session-token', expiresAt: new Date(Date.now() + HOST_SESSION_ABSOLUTE_TTL_MS) })) },
  );
}

function fakeResponse() {
  const response = { status: jest.fn(), json: jest.fn(), send: jest.fn(), cookie: jest.fn(), redirect: jest.fn() };
  response.status.mockReturnValue(response); response.json.mockReturnValue(response);
  response.send.mockReturnValue(response); response.cookie.mockReturnValue(response); response.redirect.mockReturnValue(response);
  return response;
}
