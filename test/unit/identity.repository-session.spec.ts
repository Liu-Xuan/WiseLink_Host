import { SQL } from 'drizzle-orm';

import { IdentityRepository } from '../../server/modules/identity/identity.repository';
import { HOST_SESSION_ABSOLUTE_TTL_MS } from '../../server/modules/identity/session.store';

const DATABASE_EXPIRY = new Date('2026-09-02T00:00:00.000Z');

describe('IdentityRepository session issuance clock', () => {
  it('uses database clock expressions and returns the persisted expiry', async () => {
    const returning = jest.fn().mockResolvedValue([
      {
        sessionId: '11111111-1111-4111-8111-111111111111',
        revision: 1,
        expiresAt: DATABASE_EXPIRY,
      },
    ]);
    const values = jest.fn().mockReturnValue({ returning });
    const insert = jest.fn().mockReturnValue({ values });
    const repository = new IdentityRepository({ insert } as never);

    await expect(
      repository.createSession({
        tokenHash: 'a'.repeat(64),
        subjectMappingId: '22222222-2222-4222-8222-222222222222',
        feishuUserId: null,
        absoluteTtlMs: HOST_SESSION_ABSOLUTE_TTL_MS,
      }),
    ).resolves.toEqual({
      sessionId: '11111111-1111-4111-8111-111111111111',
      revision: 1,
      expiresAt: DATABASE_EXPIRY,
    });

    const written = values.mock.calls[0][0];
    expect(written.expiresAt).toBeInstanceOf(SQL);
    expect(written.lastSeenAt).toBeInstanceOf(SQL);
    expect(written.updatedAt).toBe(written.lastSeenAt);
    expect(written.expiresAt).not.toBeInstanceOf(Date);
  });
});
