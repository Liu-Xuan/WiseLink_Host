import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { identitySubjectMapping } from '../../server/database/schema';
import { IdentityRepository } from '../../server/modules/identity/identity.repository';

const NOW = new Date('2026-08-27T12:00:00.000Z');
const EXPIRES_AT = new Date('2026-09-02T00:00:00.000Z');
const TOKEN_HASH = 'a'.repeat(64);
const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const MAPPING_ID = '22222222-2222-4222-8222-222222222222';

const selectedRow = {
  sessionId: SESSION_ID,
  sessionRevision: 7,
  expiresAt: EXPIRES_AT,
  feishuUserId: null,
  mappingId: MAPPING_ID,
  feishuOpenId: 'ou_open',
  feishuTenantKey: 'tenant_key',
  mappingFeishuUserId: null,
  miaodaUserId: 'canonical_user',
  miaodaTenantId: 'canonical_tenant',
  expectedClientId: 'client_id',
  mappingRevision: 3,
};

function databaseForTouch(
  returnedRows: { id: string }[],
  selectedRows: (typeof selectedRow)[] = [selectedRow],
) {
  const readWhere = jest.fn().mockReturnValue({
    limit: jest.fn().mockResolvedValue(selectedRows),
  });
  const mappingWhere = jest.fn(
    (predicate: SQL) =>
      sql`SELECT 1 FROM ${identitySubjectMapping} WHERE ${predicate}`,
  );
  const select = jest
    .fn()
    .mockReturnValueOnce({
      from: jest.fn().mockReturnValue({
        innerJoin: jest.fn().mockReturnValue({ where: readWhere }),
      }),
    })
    .mockReturnValueOnce({
      from: jest.fn().mockReturnValue({ where: mappingWhere }),
    });
  const returning = jest.fn().mockResolvedValue(returnedRows);
  const touchWhere = jest.fn().mockReturnValue({ returning });
  const set = jest.fn().mockReturnValue({ where: touchWhere });
  const update = jest.fn().mockReturnValue({ set });
  const database = { select, update } as never;
  return { database, readWhere, mappingWhere, touchWhere, set, returning };
}

describe('IdentityRepository validation touch', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(NOW); });
  afterEach(() => { jest.useRealTimers(); });
  it('does not touch an absent or initially invalid session', async () => {
    const mock = databaseForTouch([], []);

    await expect(
      new IdentityRepository(mock.database).validateSession(
        TOKEN_HASH,
        NOW,
        mock.database,
      ),
    ).resolves.toBeNull();
    expect(mock.touchWhere).not.toHaveBeenCalled();
  });

  it('returns the selected identity only after a conditional touch succeeds', async () => {
    const mock = databaseForTouch([{ id: SESSION_ID }]);

    await expect(
      new IdentityRepository(mock.database).validateSession(
        TOKEN_HASH,
        NOW,
        mock.database,
      ),
    ).resolves.toEqual({
      sessionId: SESSION_ID,
      sessionRevision: 7,
      expiresAt: EXPIRES_AT,
      feishuUserId: null,
      mapping: {
        id: MAPPING_ID,
        feishuOpenId: 'ou_open',
        feishuTenantKey: 'tenant_key',
        feishuUserId: null,
        miaodaUserId: 'canonical_user',
        miaodaTenantId: 'canonical_tenant',
        expectedClientId: 'client_id',
        revision: 3,
      },
    });
    expect(mock.set).toHaveBeenCalledWith({ lastSeenAt: NOW, updatedAt: NOW });
    expect(mock.returning).toHaveBeenCalledTimes(1);
  });

  it('conditions the touch on the original live session and active mapped identity', async () => {
    const mock = databaseForTouch([{ id: SESSION_ID }]);
    await new IdentityRepository(mock.database).validateSession(
      TOKEN_HASH,
      NOW,
      mock.database,
    );

    const query = new PgDialect().sqlToQuery(mock.touchWhere.mock.calls[0][0]);
    const predicate = query.sql;
    for (const column of [
      'id',
      'session_token_hash',
      'revision',
      'subject_mapping_id',
      'expires_at',
      'feishu_user_id',
      'revoked_at',
      'status',
      'feishu_open_id',
      'feishu_tenant_key',
      'miaoda_user_id',
      'miaoda_tenant_id',
      'expected_client_id',
    ]) {
      expect(predicate).toContain(`"${column}"`);
    }
    expect(predicate).toContain('IS NOT DISTINCT FROM');
    expect(predicate).toContain('exists');
    expect(query.params).toEqual(
      expect.arrayContaining([
        SESSION_ID,
        TOKEN_HASH,
        7,
        MAPPING_ID,
        EXPIRES_AT.toISOString(),
        NOW.toISOString(),
        'ACTIVE',
        3,
        'ou_open',
        'tenant_key',
        'canonical_user',
        'canonical_tenant',
        'client_id',
      ]),
    );
    expect(mock.mappingWhere).toHaveBeenCalledTimes(1);
  });

  it('rejects expiry while waiting for touch even when UPDATE returns a row', async () => {
    const mock = databaseForTouch([{ id: SESSION_ID }]);
    mock.returning.mockImplementation(async () => {
      jest.setSystemTime(new Date(EXPIRES_AT.getTime() + 1));
      return [{ id: SESSION_ID }];
    });
    await expect(new IdentityRepository(mock.database).validateSession(TOKEN_HASH, NOW, mock.database))
      .resolves.toBeNull();
    expect(mock.returning).toHaveBeenCalledTimes(1);
  });

  it.each([
    'a revoke between the read and touch',
    'a changed session revision, hash, mapping, or expiry',
    'a deactivated or changed mapped identity',
  ])('returns null when the database rejects the touch after %s', async () => {
    const mock = databaseForTouch([]);

    await expect(
      new IdentityRepository(mock.database).validateSession(
        TOKEN_HASH,
        NOW,
        mock.database,
      ),
    ).resolves.toBeNull();
    expect(mock.returning).toHaveBeenCalledTimes(1);
  });
});
