import 'reflect-metadata';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DocumentStepLeaseRepository } from '../../server/modules/document-management/src/hosted/nest/document-step-lease.repository';
import { dmDocumentParseRun } from '../../server/database/document-parsing.schema';
import type { DocumentParseScope } from '../../server/modules/document-management/src/hosted/nest/document-parsing.repository';

const scope: DocumentParseScope = { tenantId: 'tenant-test', actorUserId: 'actor-test', documentVersionId: 'DV-test' };
const fence = { parseRunId: 'PRUN-test', leaseOwner: 'owner-test', leaseToken: 'token-test', leaseGeneration: 7 };
const actualExpiry = new Date('2026-10-11T10:00:27.123Z');
function fixture() {
  let rows: Array<Record<string, unknown>> = [{ ...fence, leaseExpiresAt: actualExpiry }];
  const update = { set: jest.fn(), where: jest.fn(), returning: jest.fn(async (_fields?: unknown) => rows) };
  update.set.mockReturnValue(update); update.where.mockReturnValue(update);
  const access = { from: jest.fn(), where: jest.fn(), for: jest.fn().mockResolvedValue([]) };
  access.from.mockReturnValue(access); access.where.mockReturnValue(access);
  const db = { update: jest.fn(() => update), select: jest.fn(() => access), transaction: jest.fn() };
  db.transaction.mockImplementation(async (action: (database: PostgresJsDatabase) => Promise<unknown>) =>
    action(db as unknown as PostgresJsDatabase));
  return { repository: new DocumentStepLeaseRepository(db as unknown as PostgresJsDatabase), db, update, access,
    setRows: (next: typeof rows) => { rows = next; } };
}
const serialize = (query: SQL) => new PgDialect().sqlToQuery(query);
describe('document step lease actual CAS expiry, isolated SQL adapter', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-11T10:00:00Z')); });
  afterEach(() => { jest.useRealTimers(); });
  it('returns the database claim expiry and preserves the deadline-clamped 120-second update', async () => {
    const h = fixture(); const grant = await h.repository.claim(scope, fence.parseRunId, fence.leaseOwner);
    expect(grant).toEqual({ ...fence, leaseExpiresAt: actualExpiry });
    const values = h.update.set.mock.calls[0][0] as { leaseExpiresAt: SQL; leaseGeneration: SQL };
    const expiryUpdate = serialize(values.leaseExpiresAt);
    expect(expiryUpdate.sql).toContain('LEAST('); expect(expiryUpdate.sql).toContain('"deadline_at"');
    expect(expiryUpdate.params).toEqual(['2026-10-11T10:02:00.000Z']);
    expect(serialize(values.leaseGeneration).sql).toContain(' + 1');
    const where = serialize(h.update.where.mock.calls[0][0] as SQL);
    expect(where.params).toEqual(expect.arrayContaining(['tenant-test', 'actor-test', 'DV-test', 'PRUN-test', 'RUNNING', 'STAGING']));
    expect(where.sql).toMatch(/"lease_expires_at" is null/u);
    expect(where.sql).toMatch(/"lease_expires_at" <=/u);
    expect(where.sql).toMatch(/"deadline_at" >/u); expect(where.sql).toMatch(/"cancel_requested_at" is null/u);
  });
  it('returns renewal RETURNING expiry with exact live fence and keeps the old boolean interface', async () => {
    const h = fixture();
    await expect(h.repository.renewWithExpiry(scope, fence)).resolves.toBe(actualExpiry);
    expect(h.update.returning).toHaveBeenCalledWith({ leaseExpiresAt: dmDocumentParseRun.leaseExpiresAt });
    const where = serialize(h.update.where.mock.calls[0][0] as SQL);
    expect(where.params).toEqual(expect.arrayContaining(['tenant-test', 'actor-test', 'DV-test', 'PRUN-test',
      'owner-test', 'token-test', 7, 'RUNNING', 'STAGING']));
    for (const name of ['lease_owner', 'lease_token', 'lease_generation']) expect(where.sql).toContain(`"${name}" =`);
    expect(where.sql).toMatch(/"lease_expires_at" >/u);
    expect(where.sql).toMatch(/"deadline_at" >/u); expect(where.sql).toMatch(/"cancel_requested_at" is null/u);
    await expect(h.repository.renew(scope, fence)).resolves.toBe(true);
    h.setRows([]);
    await expect(h.repository.renewWithExpiry(scope, fence)).resolves.toBeNull();
    await expect(h.repository.renew(scope, fence)).resolves.toBe(false);
    await expect(h.repository.claim(scope, fence.parseRunId, fence.leaseOwner)).resolves.toBeNull();
  });
  it('locks the current automatic source grant in the same transaction and rejects revocation before CAS', async () => {
    const h = fixture(); const automaticScope = { ...scope, automaticWorkItem: {
      principalId: 'principal-test', workItemId: 'WI-test', requestId: 'REQ-test', documentId: 'DOC-test',
      sourceArtifactId: 'ART-test', sourceFileSha256: 'a'.repeat(64), sourceByteLength: 123, leaseGeneration: 4 } };
    await expect(h.repository.renewWithExpiry(automaticScope, fence)).rejects.toThrow('DOCUMENT_AUTOMATIC_LEASE_REJECTED');
    expect(h.db.transaction).toHaveBeenCalledTimes(1); expect(h.access.for).toHaveBeenCalledWith('update');
    expect(h.db.update).not.toHaveBeenCalled();
    const grant = serialize(h.access.where.mock.calls[0][0] as SQL);
    expect(grant.params).toEqual(expect.arrayContaining(['tenant-test', 'actor-test', 'DV-test', 'WI-test',
      'REQ-test', 'principal-test', 'DOC-test', 'ART-test', 'a'.repeat(64), 123, 4, 'LEASED', 'MIAODA_CANONICAL_PARSE_REQUEST']));
    expect(grant.sql).toMatch(/"lease_expires_at" >/u);
    h.access.for.mockResolvedValue([{ workItemId: 'WI-test' }]);
    await expect(h.repository.renewWithExpiry(automaticScope, fence)).resolves.toBe(actualExpiry);
    expect(h.access.for.mock.invocationCallOrder.at(-1)!).toBeLessThan(h.db.update.mock.invocationCallOrder[0]);
    // The same scope gate also remains on claim, without treating its package/source as permission.
    h.access.for.mockResolvedValue([]); h.db.update.mockClear();
    await expect(h.repository.claim(automaticScope, fence.parseRunId, fence.leaseOwner)).rejects.toThrow('DOCUMENT_AUTOMATIC_LEASE_REJECTED');
    expect(h.db.update).not.toHaveBeenCalled();
  });
  it('rejects out-of-range lease arguments without a database write', async () => {
    const h = fixture();
    await expect(h.repository.renewWithExpiry(scope, fence, 300_001)).rejects.toThrow('DOCUMENT_STEP_LEASE_ARGUMENT_INVALID');
    await expect(h.repository.claim(scope, fence.parseRunId, fence.leaseOwner, 999)).rejects.toThrow('DOCUMENT_STEP_LEASE_ARGUMENT_INVALID');
    expect(h.db.update).not.toHaveBeenCalled();
  });
});
