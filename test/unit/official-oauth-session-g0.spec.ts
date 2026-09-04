import 'reflect-metadata';

jest.mock('@nestjs/common', () => {
  const actual = jest.requireActual('@nestjs/common');
  const noOp = () => () => undefined;
  return {
    ...actual,
    Controller: noOp,
    Get: noOp,
    Post: noOp,
    Inject: noOp,
    Req: noOp,
    Res: noOp,
    Body: noOp,
    Query: noOp,
    Param: noOp,
    HttpCode: noOp,
  };
});

import { HttpException } from '@nestjs/common';
import { OauthStateStore } from '../../server/modules/identity/oauth-state.store';
import { SessionStore } from '../../server/modules/identity/session.store';
import { SessionResolver } from '../../server/modules/identity/session-resolver.service';
import { WhoamiController } from '../../server/modules/identity/whoami.controller';
import { OauthFlowController } from '../../server/modules/identity/oauth-flow.controller';
import { OauthSessionDevelopmentWorkItemController } from '../../server/modules/canonical-host/oauth-session-development-work-item.controller';
import { ProtectedWorkItemReadController } from '../../server/modules/identity/protected-work-item-read.controller';
import type { VerifiedIdentity } from '../../server/modules/identity/identity.types';

const identity: VerifiedIdentity = {
  subjectMappingId: '11111111-1111-4111-8111-111111111111',
  provenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
  miaodaUserId: 'miaoda-user-1',
  tenantId: 'tenant-1',
  feishuUserId: null,
  feishuOpenId: 'ou_user_1',
  namespacedSubject: {
    namespace: 'FEISHU_OPEN_ID',
    subject: 'ou_user_1',
    tenantKey: 'tenant-key-1',
  },
  verifiedAt: '2026-08-25T00:00:00.000Z',
};

describe('official OAuth -> persistent session G0', () => {
  it('persists only state hash and atomically consumes it', async () => {
    const repository = {
      issueOauthState: jest.fn().mockResolvedValue(undefined),
      consumeOauthState: jest
        .fn()
        .mockResolvedValue({ codeVerifier: 'v'.repeat(43) }),
    };
    const store = new OauthStateStore(repository as never);
    const state = await store.issue('v'.repeat(43));
    expect(state).not.toHaveLength(64);
    expect(repository.issueOauthState).toHaveBeenCalledWith(
      expect.objectContaining({
        stateHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
        codeVerifier: 'v'.repeat(43),
      }),
    );
    await store.consume(state);
    expect(repository.consumeOauthState).toHaveBeenCalledWith(
      expect.stringMatching(/^[0-9a-f]{64}$/u),
      expect.any(Date),
    );
  });

  it('stores only a session token digest and rehydrates optional user_id', async () => {
    const repository = {
      createSession: jest.fn().mockResolvedValue({
        sessionId: 'session-row-1',
        revision: 1,
        expiresAt: new Date('2026-08-25T01:00:00.000Z'),
      }),
      validateSession: jest.fn().mockResolvedValue({
        sessionId: 'session-row-1',
        sessionRevision: 1,
        expiresAt: new Date('2026-08-25T01:00:00.000Z'),
        feishuUserId: null,
        mapping: {
          id: identity.subjectMappingId,
          feishuOpenId: identity.feishuOpenId,
          feishuTenantKey: identity.namespacedSubject.tenantKey,
          feishuUserId: null,
          miaodaUserId: identity.miaodaUserId,
          miaodaTenantId: identity.tenantId,
          expectedClientId: 'cli_aadde8b579f95bc9',
          revision: 1,
        },
      }),
    };
    const store = new SessionStore(repository as never);
    const created = await store.create(identity);
    expect(created.token).toBeTruthy();
    const persisted = repository.createSession.mock.calls[0][0];
    expect(persisted.tokenHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(persisted.tokenHash).not.toBe(created.token);
    const validated = await store.validate(created.token);
    expect(validated?.identity.feishuUserId).toBeNull();
    expect(validated?.identity.miaodaUserId).toBe('miaoda-user-1');
  });

  it('resolves only the HttpOnly cookie and ignores Authorization/body identity', async () => {
    const sessionStore = {
      validate: jest.fn().mockResolvedValue({
        sessionId: 'session-row-1',
        revision: 1,
        expiresAt: new Date('2026-08-25T01:00:00.000Z'),
        identity,
      }),
    };
    const resolver = new SessionResolver(sessionStore as never, {
      configured: true,
      clientId: 'cli_aadde8b579f95bc9',
      redirectUri: 'https://host/client/oauth/callback',
      tokenApiVersion: 'v3',
      mappingBootstrap: { kind: 'DISABLED' },
      applicationScopeId: 'app_17bzc551rsg',
      sessionEnvironment: 'preview',
    });
    expect(
      await resolver.resolve({
        headers: { authorization: 'Bearer forged' },
        body: { userId: 'forged' },
      } as never),
    ).toBeNull();
    const resolved = await resolver.resolve({
      headers: {
        cookie: 'other=1; wl_session=opaque-cookie; x-user-id=forged',
      },
      body: { tenantId: 'forged' },
    } as never);
    expect(sessionStore.validate).toHaveBeenCalledWith('opaque-cookie');
    expect(resolved?.actor.canonicalSubject.id).toBe('miaoda-user-1');
    expect(resolved?.actor.sessionId).toBe('session-row-1');
  });

  it('whoami is session-only', async () => {
    const resolver = {
      resolve: jest.fn().mockResolvedValue({
        identity,
        session: {
          id: 'session-row-1',
          revision: 1,
          expiresAt: new Date('2026-08-25T01:00:00.000Z'),
        },
      }),
    };
    const result = await new WhoamiController(resolver as never).whoami({
      body: { userId: 'forged' },
    } as never);
    expect(result.authenticated).toBe(true);
    expect(result.verifiedIdentity.miaodaUserId).toBe('miaoda-user-1');
    expect(result.session.id).toBe('session-row-1');
    expect(JSON.stringify(result)).not.toContain('opaque-cookie');
  });

  it('uses official authorize URL and callback never returns the session token in JSON', async () => {
    const state = { issue: jest.fn().mockResolvedValue('oauth-state') };
    const controller = new OauthFlowController(
      {
        configured: true,
        clientId: 'cli_aadde8b579f95bc9',
        redirectUri:
          'https://hv5zjf4j8yb.feishuapp.com/app/app_17bzc551rsg/client/oauth/callback',
        tokenApiVersion: 'v3',
        mappingBootstrap: { kind: 'DISABLED' },
        applicationScopeId: 'app_17bzc551rsg',
        sessionEnvironment: 'preview',
      },
      state as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const response = fakeResponse();
    await controller.beginAuthorize(response as never);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      authorizeUrl: expect.stringContaining(
        'accounts.feishu.cn/open-apis/authen/v1/authorize',
      ),
    });

    const callback = new OauthFlowController(
      {
        configured: true,
        clientId: 'cli_aadde8b579f95bc9',
        redirectUri:
          'https://hv5zjf4j8yb.feishuapp.com/app/app_17bzc551rsg/client/oauth/callback',
        tokenApiVersion: 'v3',
        mappingBootstrap: { kind: 'DISABLED' },
        applicationScopeId: 'app_17bzc551rsg',
        sessionEnvironment: 'preview',
      },
      {
        consume: jest.fn().mockResolvedValue({ codeVerifier: 'verifier' }),
      } as never,
      {
        fetchToken: jest
          .fn()
          .mockResolvedValue({ accessToken: 'user-access-token' }),
      } as never,
      {
        verify: jest.fn().mockResolvedValue({ kind: 'VERIFIED', identity }),
      } as never,
      {
        create: jest.fn().mockResolvedValue({
          token: 'raw-secret-token',
          expiresAt: new Date(Date.now() + 60000),
        }),
      } as never,
    );
    const callbackResponse = fakeResponse();
    process.env.FEISHU_OAUTH_CLIENT_SECRET = 'controlled-dev-secret';
    await callback.handleCallback(
      { code: 'code', state: 'state' },
      callbackResponse as never,
    );
    delete process.env.FEISHU_OAUTH_CLIENT_SECRET;
    expect(callbackResponse.cookie).toHaveBeenCalledWith(
      'wl_session',
      'raw-secret-token',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
      }),
    );
    expect(callbackResponse.status).toHaveBeenCalledWith(204);
    expect(callbackResponse.json).not.toHaveBeenCalled();
  });

  it('development create binds the resolved session to the native gateway actor', async () => {
    const actor = { canonicalSubject: { id: 'miaoda-user-1' } };
    const workItems = {
      createOauthSessionDevelopmentRun: jest
        .fn()
        .mockResolvedValue({ ok: true }),
      retryOauthSessionDevelopmentRun: jest
        .fn()
        .mockResolvedValue({ ok: true }),
    };
    const controller = new OauthSessionDevelopmentWorkItemController(
      { resolve: jest.fn().mockResolvedValue({ actor }) } as never,
      workItems as never,
    );
    const previousSandbox = process.env.SANDBOX_ID;
    process.env.SANDBOX_ID = 'unit-hosted-sandbox';
    const request = {
      headers: { cookie: 'wl_session=opaque' },
      userContext: {
        userId: 'miaoda-user-1',
        tenantId: 'tenant-1',
        appId: 'app_17bzc551rsg',
        roles: ['authenticated', 'wiselink_development'],
        env: 'runtime',
      },
    };
    try {
      await controller.create(
        {
          documentVersionId: 'DV-1',
          developmentRunToken: '11111111-1111-4111-8111-111111111111',
        },
        request as never,
      );
    } finally {
      if (previousSandbox === undefined) delete process.env.SANDBOX_ID;
      else process.env.SANDBOX_ID = previousSandbox;
    }
    expect(workItems.createOauthSessionDevelopmentRun).toHaveBeenCalledWith(
      expect.objectContaining({ documentVersionId: 'DV-1' }),
      actor,
      expect.objectContaining({
        canonicalSubject: { namespace: 'MIAODA_USER_ID', id: 'miaoda-user-1' },
        identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT',
        platformRoles: ['authenticated', 'wiselink_development'],
        env: 'runtime',
      }),
    );
    process.env.SANDBOX_ID = 'unit-hosted-sandbox';
    try {
      await controller.create(
        {
          selection: {
            bucketId: 'bucket-default',
            filePath:
              'wiselink/dev-intake/0f8fad5b-d9cb-469f-a165-70867728950e/source.pdf',
          },
          developmentRunToken: '22222222-2222-4222-8222-222222222222',
        },
        request as never,
      );
    } finally {
      if (previousSandbox === undefined) delete process.env.SANDBOX_ID;
      else process.env.SANDBOX_ID = previousSandbox;
    }
    expect(workItems.createOauthSessionDevelopmentRun).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selection: {
          bucketId: 'bucket-default',
          filePath:
            'wiselink/dev-intake/0f8fad5b-d9cb-469f-a165-70867728950e/source.pdf',
        },
      }),
      actor,
      expect.objectContaining({
        canonicalSubject: { namespace: 'MIAODA_USER_ID', id: 'miaoda-user-1' },
        identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT',
      }),
    );
    process.env.SANDBOX_ID = 'unit-hosted-sandbox';
    try {
      await controller.retry('WI-1', request as never);
    } finally {
      if (previousSandbox === undefined) delete process.env.SANDBOX_ID;
      else process.env.SANDBOX_ID = previousSandbox;
    }
    expect(workItems.retryOauthSessionDevelopmentRun).toHaveBeenCalledWith(
      'WI-1',
      actor,
      expect.objectContaining({
        canonicalSubject: { namespace: 'MIAODA_USER_ID', id: 'miaoda-user-1' },
        identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT',
      }),
    );
    await expect(
      controller.create(
        {
          documentVersionId: 'DV-1',
          developmentRunToken: '11111111-1111-4111-8111-111111111111',
          userId: 'forged',
        },
        {} as never,
      ),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('list and read fresh-filter by the same session actor', async () => {
    const actor = {
      principalKind: 'FINAL_USER',
      canonicalSubject: { id: 'miaoda-user-1' },
      tenantId: 'tenant-1',
      identityProvenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
      sessionProvenance: 'SERVER_OPAQUE_SESSION',
    };
    const sessions = { resolve: jest.fn().mockResolvedValue({ actor }) };
    const objectAccess = {
      freshRead: jest.fn().mockResolvedValue({
        allowed: true,
        workItemId: 'WI-1',
      }),
    };
    const workItems = {
      listOwnedWorkItems: jest.fn().mockResolvedValue([
        {
          workItemId: 'WI-1',
          revision: 2,
          status: 'READY',
          actionType: 'PARSE_PDF',
          documentId: 'DOC-1',
          documentVersionId: 'DV-1',
          requestId: 'REQ-1',
          runKey: 'dev:1',
          createdAt: new Date('2026-08-25T00:00:00.000Z'),
          updatedAt: new Date('2026-08-25T00:01:00.000Z'),
        },
      ]),
      loadTenantScopedProjection: jest.fn().mockResolvedValue({
        row: { revision: 2, status: 'READY', documentVersionId: 'DV-1' },
        projection: { revision: 2 },
      }),
    };
    const controller = new ProtectedWorkItemReadController(
      sessions as never,
      objectAccess as never,
      workItems as never,
    );
    const request = {
      headers: { cookie: 'wl_session=opaque', 'x-user-id': 'forged' },
      body: { userId: 'forged', tenantId: 'forged' },
    } as never;
    await controller.listMyWorkItems(request);
    expect(workItems.listOwnedWorkItems).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      actorUserId: 'miaoda-user-1',
    });
    await controller.readWorkItem('WI-1', request);
    expect(objectAccess.freshRead).toHaveBeenCalledWith({
      actor,
      action: 'READ_WORK_ITEM',
      accessRoot: { kind: 'WORK_ITEM', id: 'WI-1' },
    });
  });
});

function fakeResponse() {
  const response = {
    status: jest.fn(),
    json: jest.fn(),
    send: jest.fn(),
    cookie: jest.fn(),
    redirect: jest.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  response.send.mockReturnValue(response);
  response.cookie.mockReturnValue(response);
  response.redirect.mockReturnValue(response);
  return response;
}
