import 'reflect-metadata';

jest.mock('@nestjs/common', () => {
  const actual = jest.requireActual('@nestjs/common');
  const noOp = () => () => undefined;
  return { ...actual, Controller: noOp, Get: noOp, Req: noOp };
});

import { HttpException } from '@nestjs/common';
import { WhoamiController } from '../../server/modules/identity/whoami.controller';
import { SessionResolver } from '../../server/modules/identity/session-resolver.service';

const identity = {
  subjectMappingId: '11111111-1111-4111-8111-111111111111',
  provenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN' as const,
  miaodaUserId: 'miaoda-user-1',
  tenantId: 'tenant-1',
  feishuUserId: null,
  feishuOpenId: 'ou-user-1',
  namespacedSubject: {
    namespace: 'FEISHU_OPEN_ID' as const,
    subject: 'ou-user-1',
    tenantKey: 'tenant-key-1',
  },
  verifiedAt: '2026-08-25T00:00:00.000Z',
};

describe('WhoamiController persistent session contract', () => {
  it('rejects missing/expired/revoked sessions and ignores forged gateway/body identity', async () => {
    const sessions = { resolve: jest.fn().mockResolvedValue(null) };
    const controller = new WhoamiController(sessions as never);
    await expect(
      controller.whoami({
        headers: { authorization: 'Bearer forged', 'x-user-id': 'forged' },
        userContext: { userId: 'forged', tenantId: 'forged' },
        body: { userId: 'forged', tenantId: 'forged', agentId: 'forged' },
      } as never),
    ).rejects.toBeInstanceOf(HttpException);
    expect(sessions.resolve).toHaveBeenCalledTimes(1);
  });

  it('returns only identity rehydrated from the persistent session', async () => {
    const sessions = {
      resolve: jest.fn().mockResolvedValue({
        identity,
        session: {
          id: 'session-row-1',
          revision: 2,
          expiresAt: new Date('2026-08-25T01:00:00.000Z'),
        },
      }),
    };
    const response = await new WhoamiController(sessions as never).whoami({
      body: { userId: 'forged', tenantId: 'forged' },
    } as never);
    expect(response).toEqual({
      authenticated: true,
      verifiedIdentity: {
        provenance: identity.provenance,
        miaodaUserId: identity.miaodaUserId,
        tenantId: identity.tenantId,
        feishuUserId: identity.feishuUserId,
        feishuOpenId: identity.feishuOpenId,
        namespacedSubject: identity.namespacedSubject,
        verifiedAt: identity.verifiedAt,
      },
      session: {
        id: 'session-row-1',
        revision: 2,
        expiresAt: '2026-08-25T01:00:00.000Z',
        provenance: 'SERVER_OPAQUE_SESSION',
      },
    });
    expect(JSON.stringify(response)).not.toContain('forged');
  });

  it.each([
    ['gateway user', { userContext: { userId: 'forged-user', tenantId: 'forged-tenant' } }],
    ['body actor', { body: { actor: { userId: 'forged-user' } } }],
    ['body subject', { body: { namespacedSubject: { namespace: 'FEISHU_OPEN_ID', subject: 'ou-forged' } } }],
    ['system account', { userContext: { userId: 'system-1', isSystemAccount: true, roles: ['admin'] } }],
    ['bot open_id', { userContext: { userId: 'cli-bot', openId: 'ou-bot' } }],
    ['agent id', { body: { agentId: 'agent_4km47c77ujwqphg', userId: 'forged-user' } }],
    ['numeric sender', { body: { sender: { sender_id: 123456 } } }],
    ['authorization bearer', { headers: { authorization: 'Bearer caller-token' } }],
  ])('does not elevate forged %s without a server session', async (_label, request) => {
    const sessions = { resolve: jest.fn().mockResolvedValue(null) };
    await expect(
      new WhoamiController(sessions as never).whoami(request as never),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('allows user_id to remain absent when open_id + tenant_key were mapped', async () => {
    const sessions = {
      resolve: jest.fn().mockResolvedValue({
        identity,
        session: { id: 'session-row-1', revision: 1, expiresAt: new Date('2026-08-25T01:00:00.000Z') },
      }),
    };
    const response = await new WhoamiController(sessions as never).whoami({} as never);
    expect(response.verifiedIdentity.feishuUserId).toBeNull();
    expect(response.verifiedIdentity.feishuOpenId).toBe('ou-user-1');
  });

  it('is deterministic for the same persistent session snapshot', async () => {
    const resolved = {
      identity,
      session: { id: 'session-row-1', revision: 1, expiresAt: new Date('2026-08-25T01:00:00.000Z') },
    };
    const controller = new WhoamiController({ resolve: jest.fn().mockResolvedValue(resolved) } as never);
    const first = await controller.whoami({} as never);
    const second = await controller.whoami({} as never);
    expect(first).toEqual(second);
  });

  it('ignores Authorization Bearer as a session source', async () => {
    const store = { validate: jest.fn() };
    expect(await realResolver(store).resolve({ headers: { authorization: 'Bearer forged' } } as never)).toBeNull();
    expect(store.validate).not.toHaveBeenCalled();
  });

  it('ignores x-user-id as an identity source', async () => {
    const store = { validate: jest.fn() };
    expect(await realResolver(store).resolve({ headers: { 'x-user-id': 'forged' } } as never)).toBeNull();
    expect(store.validate).not.toHaveBeenCalled();
  });

  it('ignores request body actor fields', async () => {
    const store = { validate: jest.fn() };
    expect(await realResolver(store).resolve({ headers: {}, body: { actor: identity } } as never)).toBeNull();
    expect(store.validate).not.toHaveBeenCalled();
  });

  it('ignores Miaoda gateway userContext as final-user proof', async () => {
    const store = { validate: jest.fn() };
    expect(await realResolver(store).resolve({ headers: {}, userContext: { userId: 'forged' } } as never)).toBeNull();
    expect(store.validate).not.toHaveBeenCalled();
  });

  it('ignores system-account context without a session', async () => {
    const store = { validate: jest.fn() };
    expect(await realResolver(store).resolve({ headers: {}, userContext: { userId: 'system', isSystemAccount: true } } as never)).toBeNull();
    expect(store.validate).not.toHaveBeenCalled();
  });

  it('ignores agentId provenance as ACL input', async () => {
    const store = { validate: jest.fn() };
    expect(await realResolver(store).resolve({ headers: {}, body: { agentId: 'agent_4km47c77ujwqphg' } } as never)).toBeNull();
    expect(store.validate).not.toHaveBeenCalled();
  });

  it('ignores numeric sender as ACL input', async () => {
    const store = { validate: jest.fn() };
    expect(await realResolver(store).resolve({ headers: {}, body: { sender: 123456 } } as never)).toBeNull();
    expect(store.validate).not.toHaveBeenCalled();
  });

  it('rejects an empty session cookie', async () => {
    const store = { validate: jest.fn() };
    expect(await realResolver(store).resolve({ headers: { cookie: 'wl_session=' } } as never)).toBeNull();
    expect(store.validate).not.toHaveBeenCalled();
  });

  it('rejects an unknown session cookie', async () => {
    const store = { validate: jest.fn().mockResolvedValue(null) };
    expect(await realResolver(store).resolve({ headers: { cookie: 'wl_session=unknown' } } as never)).toBeNull();
    expect(store.validate).toHaveBeenCalledWith('unknown');
  });

  it('rejects an expired persistent session', async () => {
    const store = { validate: jest.fn().mockResolvedValue(null) };
    expect(await realResolver(store).resolve({ headers: { cookie: 'wl_session=expired' } } as never)).toBeNull();
    expect(store.validate).toHaveBeenCalledWith('expired');
  });

  it('rejects a revoked persistent session', async () => {
    const store = { validate: jest.fn().mockResolvedValue(null) };
    expect(await realResolver(store).resolve({ headers: { cookie: 'wl_session=revoked' } } as never)).toBeNull();
    expect(store.validate).toHaveBeenCalledWith('revoked');
  });

  it('uses the database session row id, never the raw cookie, in ActorContext', async () => {
    const store = { validate: jest.fn().mockResolvedValue({
      sessionId: 'session-row-1', revision: 1,
      expiresAt: new Date('2026-08-25T01:00:00.000Z'), identity,
    }) };
    const resolved = await realResolver(store).resolve({ headers: { cookie: 'wl_session=raw-cookie-secret' } } as never);
    expect(resolved?.actor.sessionId).toBe('session-row-1');
    expect(JSON.stringify(resolved?.actor)).not.toContain('raw-cookie-secret');
  });

  it('never imports platform roles from caller context into the OAuth actor', async () => {
    const store = { validate: jest.fn().mockResolvedValue({
      sessionId: 'session-row-1', revision: 1,
      expiresAt: new Date('2026-08-25T01:00:00.000Z'), identity,
    }) };
    const resolved = await realResolver(store).resolve({
      headers: { cookie: 'wl_session=valid' },
      userContext: { roles: ['admin'] },
    } as never);
    expect(resolved?.actor.platformRoles).toEqual([]);
  });
});

function realResolver(store: { validate: jest.Mock }) {
  return new SessionResolver(store as never, {
    configured: true,
    clientId: 'cli_aadde8b579f95bc9',
    redirectUri: 'https://host/client/oauth/callback',
    applicationScopeId: 'app_17bzc551rsg',
    sessionEnvironment: 'preview',
  });
}
