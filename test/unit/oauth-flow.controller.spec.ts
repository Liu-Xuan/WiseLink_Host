import 'reflect-metadata';

// Mock NestJS decorators that crash under ts-jest stage-3 ES decorators.
jest.mock('@nestjs/common', () => {
  const actual = jest.requireActual('@nestjs/common');
  const noOpDecorator = () => () => undefined;
  return {
    ...actual,
    Controller: noOpDecorator,
    Get: noOpDecorator,
    Inject: noOpDecorator,
    Req: noOpDecorator,
    Res: noOpDecorator,
    Query: noOpDecorator,
    Param: noOpDecorator,
    HttpCode: noOpDecorator,
    HttpException: actual.HttpException,
    HttpStatus: actual.HttpStatus,
    Logger: actual.Logger,
  };
});

import type { Response } from 'express';

import { OauthFlowController } from '../../server/modules/identity/oauth-flow.controller';
import { OauthStateStore } from '../../server/modules/identity/oauth-state.store';
import { SessionStore } from '../../server/modules/identity/session.store';
import type { OAuthConfigPort } from '../../server/modules/identity/oauth-config.port';
import type { FeishuOAuthTokenHttpPort } from '../../server/modules/identity/feishu-oauth-token.http';
import type { FeishuOAuthVerificationPort } from '../../server/modules/identity/feishu-oauth-verification.adapter';
import type { VerifiedIdentityResult } from '../../server/modules/identity/identity.types';

// ─── Helpers ────────────────────────────────────────────────────────────

function mockResponse(): Response & {
  status: jest.Mock;
  json: jest.Mock;
  redirect: jest.Mock;
  cookie: jest.Mock;
} {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    redirect: jest.fn().mockReturnThis(),
    cookie: jest.fn().mockReturnThis(),
  } as unknown as Response & {
    status: jest.Mock;
    json: jest.Mock;
    redirect: jest.Mock;
    cookie: jest.Mock;
  };
}

function mockOauthConfig(configured: boolean): OAuthConfigPort {
  return {
    get configured() {
      return configured;
    },
    get clientId() {
      return configured ? 'cli_test_app' : null;
    },
    get redirectUri() {
      return configured ? 'https://dev.example.com/api/identity/oauth/callback' : null;
    },
  };
}

const VERIFIED_RESULT: VerifiedIdentityResult = {
  kind: 'VERIFIED',
  identity: {
    provenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
    miaodaUserId: 'miaoda_user_001',
    tenantId: '2001',
    feishuUserId: 'emp_001',
    feishuOpenId: 'ou_valid_001',
    namespacedSubject: {
      namespace: 'FEISHU_OPEN_ID',
      subject: 'ou_valid_001',
      tenantKey: 'tkey_a',
    },
    verifiedAt: '2026-08-23T10:00:00.000Z',
  },
};

describe('OauthFlowController', () => {
  let stateStore: OauthStateStore;
  let sessionStore: SessionStore;
  let tokenHttp: jest.Mocked<FeishuOAuthTokenHttpPort>;
  let verification: jest.Mocked<FeishuOAuthVerificationPort>;

  beforeEach(() => {
    stateStore = new OauthStateStore();
    sessionStore = new SessionStore();
    tokenHttp = { fetchToken: jest.fn() };
    verification = { verify: jest.fn() };
  });

  // ── authorize ──
  describe('beginAuthorize', () => {
    it('returns 503 when OAuth is not configured (fail-closed)', () => {
      const config = mockOauthConfig(false);
      const controller = new OauthFlowController(
        config, stateStore, tokenHttp, verification, sessionStore,
      );
      const res = mockResponse();

      controller.beginAuthorize(res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'IDENTITY_OAUTH_NOT_CONFIGURED' }),
      );
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it('redirects to Feishu authorize URL with state + code_challenge', () => {
      const config = mockOauthConfig(true);
      const controller = new OauthFlowController(
        config, stateStore, tokenHttp, verification, sessionStore,
      );
      const res = mockResponse();

      controller.beginAuthorize(res);

      expect(res.redirect).toHaveBeenCalledTimes(1);
      const url = res.redirect.mock.calls[0][1] as string;
      const parsed = new URL(url);
      expect(parsed.origin).toBe('https://accounts.feishu.cn');
      expect(parsed.pathname).toBe('/oauth/auth');
      expect(parsed.searchParams.get('client_id')).toBe('cli_test_app');
      expect(parsed.searchParams.get('response_type')).toBe('code');
      expect(parsed.searchParams.get('state')).toBeTruthy();
      expect(parsed.searchParams.get('code_challenge')).toBeTruthy();
      expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    });

    it('issues a different state on each call', () => {
      const config = mockOauthConfig(true);
      const controller = new OauthFlowController(
        config, stateStore, tokenHttp, verification, sessionStore,
      );
      const res1 = mockResponse();
      const res2 = mockResponse();

      controller.beginAuthorize(res1);
      controller.beginAuthorize(res2);

      const url1 = new URL(res1.redirect.mock.calls[0][1] as string);
      const url2 = new URL(res2.redirect.mock.calls[0][1] as string);
      expect(url1.searchParams.get('state')).not.toBe(
        url2.searchParams.get('state'),
      );
    });
  });

  // ── callback ──
  describe('handleCallback', () => {
    it('returns 503 when OAuth is not configured', async () => {
      const config = mockOauthConfig(false);
      const controller = new OauthFlowController(
        config, stateStore, tokenHttp, verification, sessionStore,
      );
      const res = mockResponse();

      await controller.handleCallback('code', 'state', res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'IDENTITY_OAUTH_NOT_CONFIGURED' }),
      );
    });

    it('returns 400 when code is missing', async () => {
      const config = mockOauthConfig(true);
      const controller = new OauthFlowController(
        config, stateStore, tokenHttp, verification, sessionStore,
      );
      const res = mockResponse();

      await controller.handleCallback(undefined, 'state', res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'OAUTH_CALLBACK_MISSING_CODE' }),
      );
    });

    it('returns 400 when state is missing', async () => {
      const config = mockOauthConfig(true);
      const controller = new OauthFlowController(
        config, stateStore, tokenHttp, verification, sessionStore,
      );
      const res = mockResponse();

      await controller.handleCallback('code', undefined, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'OAUTH_CALLBACK_MISSING_STATE' }),
      );
    });

    it('returns 400 when state is invalid (never issued)', async () => {
      const config = mockOauthConfig(true);
      const controller = new OauthFlowController(
        config, stateStore, tokenHttp, verification, sessionStore,
      );
      const res = mockResponse();

      await controller.handleCallback('code', 'bogus-state', res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'OAUTH_STATE_INVALID' }),
      );
    });

    it('returns 400 on state replay (one-time consumption)', async () => {
      const config = mockOauthConfig(true);
      const controller = new OauthFlowController(
        config, stateStore, tokenHttp, verification, sessionStore,
      );
      // Issue a real state
      const state = stateStore.issue('verifier-123');
      const res1 = mockResponse();
      const res2 = mockResponse();

      await controller.handleCallback('code', state, res1);
      await controller.handleCallback('code', state, res2);

      // First call should not be a 400 STATE_INVALID
      expect(res2.status).toHaveBeenCalledWith(400);
      expect(res2.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'OAUTH_STATE_INVALID' }),
      );
    });

    it('returns 503 when token exchange fails', async () => {
      const config = mockOauthConfig(true);
      process.env.FEISHU_OAUTH_CLIENT_SECRET = 'secret123';
      const controller = new OauthFlowController(
        config, stateStore, tokenHttp, verification, sessionStore,
      );
      tokenHttp.fetchToken.mockResolvedValue(null);
      const state = stateStore.issue('verifier-123');
      const res = mockResponse();

      await controller.handleCallback('code', state, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'OAUTH_TOKEN_EXCHANGE_FAILED' }),
      );
      delete process.env.FEISHU_OAUTH_CLIENT_SECRET;
    });

    it('returns 503 when identity verification fails', async () => {
      const config = mockOauthConfig(true);
      process.env.FEISHU_OAUTH_CLIENT_SECRET = 'secret123';
      tokenHttp.fetchToken.mockResolvedValue({
        accessToken: 'access-tok',
        tokenType: 'Bearer',
        expiresIn: 7200,
        refreshToken: null,
      });
      verification.verify.mockResolvedValue({
        kind: 'UNAVAILABLE',
        reason: 'FEISHU_SUBJECT_MAPPING_MISSING',
      });
      const controller = new OauthFlowController(
        config, stateStore, tokenHttp, verification, sessionStore,
      );
      const state = stateStore.issue('verifier-123');
      const res = mockResponse();

      await controller.handleCallback('code', state, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'IDENTITY_VERIFICATION_UNAVAILABLE',
          details: { reason: 'FEISHU_SUBJECT_MAPPING_MISSING' },
        }),
      );
      delete process.env.FEISHU_OAUTH_CLIENT_SECRET;
    });

    it('creates a session and sets httpOnly cookie on success', async () => {
      const config = mockOauthConfig(true);
      process.env.FEISHU_OAUTH_CLIENT_SECRET = 'secret123';
      tokenHttp.fetchToken.mockResolvedValue({
        accessToken: 'access-tok',
        tokenType: 'Bearer',
        expiresIn: 7200,
        refreshToken: null,
      });
      verification.verify.mockResolvedValue(VERIFIED_RESULT);
      const controller = new OauthFlowController(
        config, stateStore, tokenHttp, verification, sessionStore,
      );
      const state = stateStore.issue('verifier-123');
      const res = mockResponse();

      await controller.handleCallback('code', state, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.cookie).toHaveBeenCalledWith(
        'wl_session',
        expect.any(String),
        expect.objectContaining({ httpOnly: true }),
      );
      const body = res.json.mock.calls[0][0];
      expect(body.status).toBe('VERIFIED');
      expect(body.session.token).toBeTruthy();
      expect(body.identity.miaodaUserId).toBe('miaoda_user_001');
      expect(body.identity.provenance).toBe('FEISHU_OAUTH_USER_ACCESS_TOKEN');
      delete process.env.FEISHU_OAUTH_CLIENT_SECRET;
    });

    it('passes the PKCE code_verifier from the state store to the token exchange', async () => {
      const config = mockOauthConfig(true);
      process.env.FEISHU_OAUTH_CLIENT_SECRET = 'secret123';
      tokenHttp.fetchToken.mockResolvedValue({
        accessToken: 'tok',
        tokenType: 'Bearer',
        expiresIn: 7200,
        refreshToken: null,
      });
      verification.verify.mockResolvedValue(VERIFIED_RESULT);
      const controller = new OauthFlowController(
        config, stateStore, tokenHttp, verification, sessionStore,
      );
      const state = stateStore.issue('my-specific-verifier-1234567890');
      const res = mockResponse();

      await controller.handleCallback('code', state, res);

      expect(tokenHttp.fetchToken).toHaveBeenCalledWith(
        expect.objectContaining({
          codeVerifier: 'my-specific-verifier-1234567890',
          code: 'code',
        }),
      );
      delete process.env.FEISHU_OAUTH_CLIENT_SECRET;
    });
  });
});
