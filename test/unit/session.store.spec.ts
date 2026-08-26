import 'reflect-metadata';

import {
  HOST_SESSION_ABSOLUTE_TTL_MS,
  SessionStore,
} from '../../server/modules/identity/session.store';
import type { VerifiedIdentity } from '../../server/modules/identity/identity.types';

const identity: VerifiedIdentity = {
  subjectMappingId: '11111111-1111-4111-8111-111111111111',
  provenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
  miaodaUserId: 'miaoda_user_001',
  tenantId: '2001',
  feishuUserId: null,
  feishuOpenId: 'ou_valid_001',
  namespacedSubject: {
    namespace: 'FEISHU_OPEN_ID',
    subject: 'ou_valid_001',
    tenantKey: 'tkey_a',
  },
  verifiedAt: '2026-08-25T00:00:00.000Z',
};

function repository() {
  const rows = new Map<
    string,
    { revoked: boolean; expiresAt: Date; sessionId: string; revision: number }
  >();
  let sequence = 0;
  return {
    rows,
    createSession: jest.fn(
      async (input: { tokenHash: string; absoluteTtlMs: number }) => {
        const revision = ++sequence;
        const sessionId = `session-row-${revision}`;
        const expiresAt = new Date(Date.now() + input.absoluteTtlMs);
        rows.set(input.tokenHash, {
          revoked: false,
          expiresAt,
          sessionId,
          revision,
        });
        return { sessionId, revision, expiresAt };
      },
    ),
    validateSession: jest.fn(async (tokenHash: string, now: Date) => {
      const row = rows.get(tokenHash);
      if (!row || row.revoked || row.expiresAt <= now) return null;
      return {
        sessionId: row.sessionId,
        sessionRevision: row.revision,
        expiresAt: row.expiresAt,
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
      };
    }),
    revokeSession: jest.fn(async (tokenHash: string) => {
      const row = rows.get(tokenHash);
      if (!row || row.revoked) return false;
      row.revoked = true;
      return true;
    }),
  };
}

describe('SessionStore persistent opaque-session contract', () => {
  it('issues one fixed seven-day absolute lifetime', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-26T00:00:00.000Z'));
    try {
      const repo = repository();
      const created = await new SessionStore(repo as never).create(identity);
      expect(created.expiresAt.getTime() - Date.now()).toBe(
        HOST_SESSION_ABSOLUTE_TTL_MS,
      );
      expect(repo.createSession.mock.calls[0][0].absoluteTtlMs).toBe(
        HOST_SESSION_ABSOLUTE_TTL_MS,
      );
      expect(repo.createSession.mock.calls[0][0]).not.toHaveProperty('now');
      expect(repo.createSession.mock.calls[0][0]).not.toHaveProperty(
        'expiresAt',
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns the database-persisted expiry to the cookie layer', async () => {
    const repo = repository();
    const databaseExpiry = new Date('2026-09-02T00:00:00.000Z');
    repo.createSession.mockResolvedValueOnce({
      sessionId: 'session-row-database-clock',
      revision: 1,
      expiresAt: databaseExpiry,
    });

    const created = await new SessionStore(repo as never).create(identity);

    expect(created.expiresAt).toBe(databaseExpiry);
  });

  it('creates and validates a database-backed session', async () => {
    const repo = repository();
    const store = new SessionStore(repo as never);
    const created = await store.create(identity);
    await expect(store.validate(created.token)).resolves.toMatchObject({
      identity: { miaodaUserId: 'miaoda_user_001' },
    });
  });

  it('persists only the SHA-256 token digest', async () => {
    const repo = repository();
    const created = await new SessionStore(repo as never).create(identity);
    const input = repo.createSession.mock.calls[0][0];
    expect(input.tokenHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(input.tokenHash).not.toBe(created.token);
  });

  it('rehydrates optional user_id as null from open_id + tenant_key mapping', async () => {
    const repo = repository();
    const store = new SessionStore(repo as never);
    const created = await store.create(identity);
    expect(
      (await store.validate(created.token))?.identity.feishuUserId,
    ).toBeNull();
  });

  it('allows repeated validation without consuming the session', async () => {
    const repo = repository();
    const store = new SessionStore(repo as never);
    const created = await store.create(identity);
    await expect(store.validate(created.token)).resolves.not.toBeNull();
    await expect(store.validate(created.token)).resolves.not.toBeNull();
  });

  it('does not slide the absolute expiry during validation', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-26T00:00:00.000Z'));
    try {
      const repo = repository();
      const store = new SessionStore(repo as never);
      const created = await store.create(identity);
      jest.advanceTimersByTime(24 * 60 * 60 * 1000);
      const validated = await store.validate(created.token);
      expect(validated?.expiresAt).toEqual(created.expiresAt);
      expect([...repo.rows.values()][0].expiresAt).toEqual(created.expiresAt);
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects a never-issued token', async () => {
    await expect(
      new SessionStore(repository() as never).validate('unknown'),
    ).resolves.toBeNull();
  });

  it('rejects an empty token without database I/O', async () => {
    const repo = repository();
    await expect(
      new SessionStore(repo as never).validate(''),
    ).resolves.toBeNull();
    expect(repo.validateSession).not.toHaveBeenCalled();
  });

  it('issues independent high-entropy opaque tokens', async () => {
    const store = new SessionStore(repository() as never);
    const values = await Promise.all([
      store.create(identity),
      store.create(identity),
      store.create(identity),
    ]);
    expect(new Set(values.map((value) => value.token)).size).toBe(3);
    expect(values[0].token).toMatch(/^[A-Za-z0-9_-]{32,}$/u);
  });

  it('revokes a session immediately', async () => {
    const repo = repository();
    const store = new SessionStore(repo as never);
    const created = await store.create(identity);
    await expect(store.revoke(created.token)).resolves.toBe(true);
    await expect(store.validate(created.token)).resolves.toBeNull();
  });

  it('returns false when revoking an already-revoked session', async () => {
    const repo = repository();
    const store = new SessionStore(repo as never);
    const created = await store.create(identity);
    await store.revoke(created.token);
    await expect(store.revoke(created.token)).resolves.toBe(false);
  });

  it('returns false when revoking an unknown session', async () => {
    await expect(
      new SessionStore(repository() as never).revoke('unknown'),
    ).resolves.toBe(false);
  });

  it('rejects an expired session', async () => {
    const repo = repository();
    const store = new SessionStore(repo as never);
    const created = await store.create(identity);
    for (const row of repo.rows.values()) row.expiresAt = new Date(0);
    await expect(store.validate(created.token)).resolves.toBeNull();
  });

  it('keeps server row id/revision separate from the raw cookie token', async () => {
    const repo = repository();
    const store = new SessionStore(repo as never);
    const created = await store.create(identity);
    const validated = await store.validate(created.token);
    expect(validated?.sessionId).toBe('session-row-1');
    expect(validated?.revision).toBe(1);
    expect(validated?.sessionId).not.toBe(created.token);
  });

  it('does not leak identity fields in the opaque browser token', async () => {
    const created = await new SessionStore(repository() as never).create(
      identity,
    );
    expect(created.token).not.toContain(identity.miaodaUserId);
    expect(created.token).not.toContain(identity.feishuOpenId!);
    expect(created.token).not.toContain(identity.tenantId);
  });
});
