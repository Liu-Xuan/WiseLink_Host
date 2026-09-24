import { createNoticeWindowReader, type NoticeRoot } from '../../server/modules/canonical-host/engineering-notice-window';
import { PgDialect } from 'drizzle-orm/pg-core';

const root: NoticeRoot = { tenantId: 'T', matterId: 'M', matterWorkRevisionId: 'W1',
  createdByUserId: 'owner', workingRevision: 1 };

describe('notice window scheduling', () => {
  it('dispatches at the next microtask and maps roots by slot without waiting for late roots', async () => {
    const execute = jest.fn().mockResolvedValue([{ index: 1, id: 'second' }, { index: 0, id: 'first' }]);
    const read = createNoticeWindowReader({ execute } as never);
    const savedRow = { ...root, stateJson: 'large saved body must not enter the batch key' };
    const first = read(savedRow);
    const second = read({ ...root, matterWorkRevisionId: 'W2', workingRevision: 2 });
    expect(execute).not.toHaveBeenCalled();
    await expect(Promise.all([first, second])).resolves.toEqual([
      [{ index: 0, id: 'first' }], [{ index: 1, id: 'second' }],
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    expect(JSON.parse(String(query.params[0]))).toEqual([
      { matterWorkRevisionId: 'W1', createdByUserId: 'owner', workingRevision: 1, index: 0 },
      { matterWorkRevisionId: 'W2', createdByUserId: 'owner', workingRevision: 2, index: 1 },
    ]);
    execute.mockResolvedValue([]);
    await Promise.all([read(root), read(root)]);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(new PgDialect().sqlToQuery(execute.mock.calls[1][0]).sql).not.toContain('jsonb_to_recordset');
    expect(() => read(root)).toThrow('MATTER_NOTICE_WINDOW_OVERFLOW');
  });

  it('never combines a different tenant or exact Matter, and singletons use the original query', async () => {
    const execute = jest.fn().mockResolvedValue([]);
    const read = createNoticeWindowReader({ execute } as never);
    await expect(Promise.all([read(root), read({ ...root, tenantId: 'T2' }),
      read({ ...root, matterId: 'M2' })])).resolves.toEqual([[], [], []]);
    expect(execute).toHaveBeenCalledTimes(3);
    for (const [query] of execute.mock.calls) expect(new PgDialect().sqlToQuery(query).sql).not.toContain('jsonb_to_recordset');
  });

  it('preserves the infrastructure error for every affected root and isolates another Matter', async () => {
    const failure = new Error('connection unavailable');
    const execute = jest.fn().mockRejectedValueOnce(failure).mockResolvedValue([]);
    const read = createNoticeWindowReader({ execute } as never);
    const results = await Promise.allSettled([read(root), read(root), read({ ...root, matterId: 'M2' })]);
    expect(results).toEqual([{ status: 'rejected', reason: failure }, { status: 'rejected', reason: failure },
      { status: 'fulfilled', value: [] }]);
  });
});
