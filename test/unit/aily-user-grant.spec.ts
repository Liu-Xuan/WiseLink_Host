import {
  openAilyUserGrant,
  sealAilyUserGrant,
} from '../../server/modules/identity/aily-user-grant.codec';
import { SessionStore } from '../../server/modules/identity/session.store';
import type { IdentityRepository } from '../../server/modules/identity/identity.repository';
import type { VerifiedIdentity } from '../../server/modules/identity/identity.types';

describe('Aily user delegation', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.FEISHU_OAUTH_CLIENT_ID = 'cli_test';
    process.env.FEISHU_OAUTH_CLIENT_SECRET = 'test-only-oauth-client-secret';
    process.env.WL_AILY_AGENT_ID = 'agent_test';
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('encrypts tokens with a fresh nonce and rejects another session or a rotated application key', () => {
    const first = sealAilyUserGrant(
      'test-only-user-token',
      'session-one:mapping',
    );
    expect(first).not.toContain('test-only-user-token');
    expect(first).not.toEqual(
      sealAilyUserGrant('test-only-user-token', 'session-one:mapping'),
    );
    expect(openAilyUserGrant(first, 'session-one:mapping')).toBe(
      'test-only-user-token',
    );
    expect(() => openAilyUserGrant(first, 'session-two:mapping')).toThrow(
      'AILY_USER_GRANT_UNAVAILABLE',
    );
    process.env.FEISHU_OAUTH_CLIENT_SECRET = 'rotated-test-secret';
    expect(() => openAilyUserGrant(first, 'session-one:mapping')).toThrow(
      'AILY_USER_GRANT_UNAVAILABLE',
    );
  });

  it('binds the encrypted grant to the persisted Host session and caps its independent expiry', async () => {
    const createSession = jest
      .fn()
      .mockResolvedValue({
        sessionId: 'session-one',
        revision: 1,
        expiresAt: new Date(),
      });
    const service = new SessionStore({
      createSession,
    } as unknown as IdentityRepository);
    const identity = {
      subjectMappingId: 'mapping',
      feishuUserId: 'user',
    } as VerifiedIdentity;
    await service.create(identity, {
      accessToken: 'test-only-user-token',
      expiresIn: 3600,
    });
    const persisted = createSession.mock.calls[0][0];
    expect(
      openAilyUserGrant(
        persisted.ailyAccessTokenSealed,
        `${persisted.tokenHash}:mapping`,
      ),
    ).toBe('test-only-user-token');
    expect(persisted.ailyAccessTokenExpiresAt.getTime()).toBeLessThan(
      Date.now() + 3600_000,
    );
    expect(JSON.stringify(persisted)).not.toContain('test-only-user-token');
  });

  it('does not retain OAuth tokens when Aily is disabled', async () => {
    delete process.env.WL_AILY_AGENT_ID;
    const createSession = jest
      .fn()
      .mockResolvedValue({
        sessionId: 's',
        revision: 1,
        expiresAt: new Date(),
      });
    const service = new SessionStore({
      createSession,
    } as unknown as IdentityRepository);
    await service.create(
      { subjectMappingId: 'm', feishuUserId: 'u' } as VerifiedIdentity,
      { accessToken: 'test-only-user-token', expiresIn: 3600 },
    );
    expect(createSession.mock.calls[0][0]).not.toHaveProperty(
      'ailyAccessTokenSealed',
    );
  });
});
