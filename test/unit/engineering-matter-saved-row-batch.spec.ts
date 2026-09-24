import { PgDialect } from 'drizzle-orm/pg-core';
import { engineeringMatterWorkRevision } from '../../server/database/schema';
import { EngineeringMatterWorkingRepository } from '../../server/modules/canonical-host/engineering-matter-working.repository';

function harness(rows: Array<{ tenantId: string; matterId: string; matterWorkRevisionId: string }>) {
  const where = jest.fn().mockResolvedValue(rows);
  const from = jest.fn().mockReturnValue({ where });
  const db = { select: jest.fn().mockReturnValue({ from }) };
  const repository = new EngineeringMatterWorkingRepository(db as never, {} as never, {} as never, {} as never);
  return { repository, db, from, where };
}

const a = { tenantId: 'tenant-A', matterId: 'MAT-A', workRef: 'REV-A' };
const b = { tenantId: 'tenant-A', matterId: 'MAT-B', workRef: 'REV-B' };

describe('catalogue saved row batch', () => {
  it('uses one actor-scoped table read and maps out-of-order rows by exact composite key', async () => {
    const h = harness([
      { ...b, matterWorkRevisionId: b.workRef },
      { ...a, matterWorkRevisionId: a.workRef },
    ]);
    const batch = h.repository.createSavedRowBatch(2);
    const first = batch.read(a);
    expect(h.db.select).not.toHaveBeenCalled();
    const second = batch.read(b);
    await expect(first).resolves.toMatchObject({ matterId: 'MAT-A', matterWorkRevisionId: 'REV-A' });
    await expect(second).resolves.toMatchObject({ matterId: 'MAT-B', matterWorkRevisionId: 'REV-B' });
    expect(h.db.select).toHaveBeenCalledTimes(1);
    expect(h.from).toHaveBeenCalledWith(engineeringMatterWorkRevision);
    const query = new PgDialect().sqlToQuery(h.where.mock.calls[0][0]);
    expect(query.sql).toContain('"tenant_id"');
    expect(query.sql).toContain('"matter_id"');
    expect(query.sql).toContain('"matter_work_revision_id"');
    expect(query.params).toEqual(expect.arrayContaining(['tenant-A', 'MAT-A', 'REV-A', 'MAT-B', 'REV-B']));
  });

  it('does not map an identical matter and revision from another tenant to the requested actor', async () => {
    const h = harness([{ tenantId: 'tenant-A', matterId: 'MAT-A', matterWorkRevisionId: 'REV-A' }]);
    const batch = h.repository.createSavedRowBatch(2);
    const allowed = batch.read(a);
    const otherTenant = batch.read({ ...a, tenantId: 'tenant-B' });
    await expect(allowed).resolves.toMatchObject({ tenantId: 'tenant-A' });
    await expect(otherTenant).resolves.toBeNull();
    const query = new PgDialect().sqlToQuery(h.where.mock.calls[0][0]);
    expect(query.params).toContain('tenant-B');
  });

  it('keeps missing rows missing and settles the window when another entrance was denied', async () => {
    const h = harness([]);
    const batch = h.repository.createSavedRowBatch(2);
    const first = batch.read(a);
    batch.skip();
    await expect(first).resolves.toBeNull();
    expect(h.db.select).toHaveBeenCalledTimes(1);
  });

  it('propagates a batch database failure to each requested identity', async () => {
    const h = harness([]);
    const failure = new Error('DATABASE_UNAVAILABLE');
    h.where.mockRejectedValue(failure);
    const batch = h.repository.createSavedRowBatch(2);
    const first = batch.read(a);
    const second = batch.read(b);
    await expect(first).rejects.toBe(failure);
    await expect(second).rejects.toBe(failure);
  });
});
