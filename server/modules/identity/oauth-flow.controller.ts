import {
  Controller,
  Get,
  Inject,
  Query,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';

import { OAUTH_CONFIG, type OAuthConfigPort } from './oauth-config.port';
import { OauthStateStore } from './oauth-state.store';
import { generatePkcePair } from './pkce.util';
import {
  FEISHU_OAUTH_TOKEN_HTTP,
  type FeishuOAuthTokenHttpPort,
} from './feishu-oauth-token.http';
import {
  FEISHU_OAUTH_VERIFICATION,
  type FeishuOAuthVerificationPort,
} from './feishu-oauth-verification.adapter';
import { SessionStore } from './session.store';
import type { VerifiedIdentityResult } from './identity.types';

/**
 * Server-side Feishu OAuth flow controller.
 *
 * Two endpoints:
 *
 *  GET /api/identity/oauth/authorize
 *    - Server generates PKCE pair + one-time opaque state
 *    - Redirects browser to Feishu authorize URL with state + code_challenge
 *    - 503 when OAuth is not configured (fail-closed)
 *
 *  GET /api/identity/oauth/callback
 *    - Receives ?code + ?state from Feishu redirect
 *    - Consumes one-time state (replay = deny)
 *    - Server-side token exchange with PKCE code_verifier
 *    - Server-side user_info → mapping → verified identity
 *    - Creates opaque server session, sets httpOnly cookie
 *    - 503 / 400 on any failure (fail-closed)
 *
 * R08: no caller-asserted identity field is trusted. The `code` and
 * `state` are OAuth protocol parameters, not identity claims. Identity
 * is established ONLY by the server-side token exchange → user_info →
 * Host mapping chain.
 */
@Controller('api/identity/oauth')
export class OauthFlowController {
  constructor(
    @Inject(OAUTH_CONFIG)
    private readonly oauthConfig: OAuthConfigPort,
    private readonly stateStore: OauthStateStore,
    @Inject(FEISHU_OAUTH_TOKEN_HTTP)
    private readonly tokenHttp: FeishuOAuthTokenHttpPort,
    @Inject(FEISHU_OAUTH_VERIFICATION)
    private readonly verification: FeishuOAuthVerificationPort,
    private readonly sessionStore: SessionStore,
  ) {}

  /**
   * Step 1: Begin the OAuth flow.
   *
   * Generates a PKCE pair, issues a one-time state binding the code_verifier,
   * and redirects the browser to the Feishu authorize endpoint.
   */
  @Get('authorize')
  @HttpCode(HttpStatus.FOUND)
  async beginAuthorize(
    @Res() response: Response,
  ): Promise<void> {
    // Fail-closed: when OAuth is not configured, return 503.
    if (!this.oauthConfig.configured) {
      response.status(503).json({
        code: 'IDENTITY_OAUTH_NOT_CONFIGURED',
        message:
          'Feishu OAuth is not configured. Set FEISHU_OAUTH_CLIENT_ID, FEISHU_OAUTH_CLIENT_SECRET, and FEISHU_OAUTH_REDIRECT_URI.',
        statusCode: 503,
      });
      return;
    }

    const clientId = this.oauthConfig.clientId!;
    const redirectUri = this.oauthConfig.redirectUri!;

    // 1. Generate PKCE pair — code_verifier stays server-side.
    const pkce = generatePkcePair();

    // 2. Issue one-time state, binding the code_verifier.
    const state = await this.stateStore.issue(pkce.codeVerifier);

    // 3. Build the Feishu authorize URL.
    const authorizeUrl = new URL(
      'https://accounts.feishu.cn/open-apis/authen/v1/authorize',
    );
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set(
      'code_challenge',
      pkce.codeChallenge,
    );
    authorizeUrl.searchParams.set(
      'code_challenge_method',
      pkce.codeChallengeMethod,
    );

    // 4. Redirect browser — code_verifier never leaves the server.
    response.redirect(302, authorizeUrl.toString());
  }

  /**
   * Step 2: OAuth callback.
   *
   * Feishu redirects here with ?code and ?state. The server:
   * 1. Consumes the one-time state (replay → deny)
   * 2. Exchanges code + code_verifier for access_token (server-side)
   * 3. Verifies identity via user_info + Host mapping
   * 4. Creates an opaque server session
   * 5. Sets httpOnly cookie and redirects to a DEV landing page
   *
   * Any failure → 503 or 400 (fail-closed, never forges identity).
   */
  @Get('callback')
  async handleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    // Fail-closed: not configured
    if (!this.oauthConfig.configured) {
      response.status(503).json({
        code: 'IDENTITY_OAUTH_NOT_CONFIGURED',
        message: 'Feishu OAuth is not configured.',
        statusCode: 503,
      });
      return;
    }

    // 1. Validate protocol parameters
    if (!code || code.trim() === '') {
      response.status(400).json({
        code: 'OAUTH_CALLBACK_MISSING_CODE',
        message: 'Missing authorization code.',
        statusCode: 400,
      });
      return;
    }

    if (!state || state.trim() === '') {
      response.status(400).json({
        code: 'OAUTH_CALLBACK_MISSING_STATE',
        message: 'Missing state parameter.',
        statusCode: 400,
      });
      return;
    }

    // 2. Consume one-time state — replay or expired → deny
    const stateEntry = await this.stateStore.consume(state);
    if (!stateEntry) {
      response.status(400).json({
        code: 'OAUTH_STATE_INVALID',
        message:
          'State is missing, already consumed, or expired. Possible CSRF or replay attempt.',
        statusCode: 400,
      });
      return;
    }

    const clientId = this.oauthConfig.clientId!;
    const clientSecret = process.env.FEISHU_OAUTH_CLIENT_SECRET;
    const redirectUri = this.oauthConfig.redirectUri!;

    if (!clientSecret) {
      response.status(503).json({
        code: 'IDENTITY_OAUTH_NOT_CONFIGURED',
        message: 'Feishu OAuth client secret is missing.',
        statusCode: 503,
      });
      return;
    }

    // 3. Server-side token exchange with PKCE
    const tokenResponse = await this.tokenHttp.fetchToken({
      clientId,
      clientSecret,
      code,
      redirectUri,
      codeVerifier: stateEntry.codeVerifier,
    });

    if (!tokenResponse) {
      response.status(503).json({
        code: 'OAUTH_TOKEN_EXCHANGE_FAILED',
        message:
          'Token exchange failed (network, credentials, or PKCE mismatch).',
        statusCode: 503,
      });
      return;
    }

    // 4. Verify identity: user_info → Host mapping
    const verifyResult: VerifiedIdentityResult =
      await this.verification.verify({
        accessToken: tokenResponse.accessToken,
        clientId,
        contextTenantId: '', // The mapping port resolves tenant, not the
        // caller. When a gateway context tenantId is available it will be
        // checked against the mapping in the verification adapter.
      });

    if (verifyResult.kind !== 'VERIFIED') {
      response.status(503).json({
        code: 'IDENTITY_VERIFICATION_UNAVAILABLE',
        message: `Identity verification failed: ${verifyResult.reason}`,
        statusCode: 503,
        details: { reason: verifyResult.reason },
      });
      return;
    }

    // 5. Create opaque server session
    const { token: sessionToken, expiresAt } =
      await this.sessionStore.create(verifyResult.identity);

    // 6. Set httpOnly cookie — token never visible to JS
    response.cookie('wl_session', sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: expiresAt.getTime() - Date.now(),
      path: '/',
    });

    // No session/token or identity is returned to JavaScript. The browser
    // continues with the opaque HttpOnly cookie and can call whoami.
    response.status(204).send();
  }
}
