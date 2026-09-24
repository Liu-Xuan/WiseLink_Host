import { PgDialect } from 'drizzle-orm/pg-core';

import { workItem } from '../../server/database/schema';
import { MiaodaWorkItemRepository } from '../../server/modules/work-item/miaoda-work-item.repository';

const first = { workItemId: 'WI-A', tenantId: 'tenant-A', actorUserId: 'actor-A' };
const second = { workItemId: 'WI-B', tenantId: 'tenant-A', actorUserId: 'actor-A' };

describe('bounded WorkItem owner-binding read', () => {
  it('uses one tenant and actor constrained query and maps out-of-order facts by exact ID', async () => {
    const binding = (workItemId: string) => ({ workItemId, tenantId: 'tenant-A',
      requestedByUserId: 'actor-A', revision: 1, requestId: `REQ-${workItemId}`,
      documentId: 'DOC', documentVersionId: 'DV', runKey: 'RUN' });
    const where = jest.fn().mockResolvedValue([binding('WI-B'), binding('WI-A')]);
    const from = jest.fn().mockReturnValue({ where });
    const db = { select: jest.fn().mockReturnValue({ from }) };
    const repository = new MiaodaWorkItemRepository(db as never);

    const result = await repository.loadAuthorizationBindings([first, second]);
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith(workItem);
    expect([...result.keys()]).toEqual(['WI-B', 'WI-A']);
    expect(result.get('WI-A')).toMatchObject({ requestId: 'REQ-WI-A' });
    const query = new PgDialect().sqlToQuery(where.mock.calls[0][0]);
    expect(query.sql).toContain('"tenant_id"');
    expect(query.sql).toContain('"requested_by_user_id"');
    expect(query.sql).toContain('"work_item_id" in');
    expect(query.params).toEqual(expect.arrayContaining(['tenant-A', 'actor-A', 'WI-A', 'WI-B']));
  });

  it('rejects mixed actor scope before reading and leaves missing members absent', async () => {
    const where = jest.fn().mockResolvedValue([]);
    const from = jest.fn().mockReturnValue({ where });
    const db = { select: jest.fn().mockReturnValue({ from }) };
    const repository = new MiaodaWorkItemRepository(db as never);

    await expect(repository.loadAuthorizationBindings([first, { ...second, actorUserId: 'actor-B' }]))
      .rejects.toThrow('WORK_ITEM_AUTHORIZATION_BATCH_SCOPE_INVALID');
    expect(db.select).not.toHaveBeenCalled();
    await expect(repository.loadAuthorizationBindings([first, second]))
      .resolves.toEqual(new Map());
  });
});
