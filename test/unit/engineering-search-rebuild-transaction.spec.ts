import { PgDialect } from 'drizzle-orm/pg-core';
import { EngineeringSearchProjectionWriter } from '../../server/modules/canonical-host/engineering-search-projection';
import { engineeringSearchProjection as projection, engineeringSearchProjectionPending as pending } from '../../server/database/engineering-search.schema';

const dialect = new PgDialect();
const marker = (ref = 'wr-1', ownerId = 'actor', tenantId = 'tenant', ownerKind = 'USER') => ({
  id: ref, tenantId, exactRevisionRef: ref, ownerKind, ownerId, subjectId: `${ref}-subject`, attempts: 0, lastError: '',
});
const content = { issues: [{ issueKey: 'i1', question: 'condition', body: 'saved authoritative body' }] };

// A deterministic transaction store, not a PostgreSQL/RLS substitute. Predicates
// are compiled by real Drizzle and their exact bound tuple is evaluated below.
function fixture(initial = [marker()]) {
  let state = { pending: structuredClone(initial), projection: [] as Record<string, unknown>[] };
  let transactions = 0;
  const traces: { table: unknown; operation: string; params: unknown[]; sql: string }[] = [];
  const hooks = { failInsert: false, beforeTransaction: (_count: number) => {}, afterRollback: () => {} };
  const executor = (get: () => typeof state) => ({
    select: (selection?: Record<string, unknown>) => {
      let table: unknown; let params: unknown[] = []; let text = ''; let limit = Infinity;
      const chain = {
        from(value: unknown) { table = value; return chain; },
        where(condition: never) { const query = dialect.sqlToQuery(condition); params = query.params; text = query.sql; return chain; },
        limit(value: number) { limit = value; return chain; },
        orderBy() { return chain; },
        for() { return chain; },
        then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
          traces.push({ table, operation: 'select', params, sql: text });
          let rows: Record<string, unknown>[];
          if (table === pending) {
            rows = params.length === 4
              ? get().pending.filter(row => row.tenantId === params[0] && row.ownerId === params[1] && ['USER', 'MATTER'].includes(row.ownerKind))
                .sort((a, b) => a.exactRevisionRef.localeCompare(b.exactRevisionRef))
              : get().pending.filter(row => matches(row, params));
          } else {
            rows = get().projection.filter(row => row.tenantId === params[0] && row.exactRevisionRef === params[1]);
          }
          rows = rows.slice(0, limit).map(row => selection && table === projection
            ? { ownerKind: row.ownerKind, ownerId: row.ownerId, subjectId: row.parentContextRef, entryKind: row.entryKind } : row);
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
      return chain;
    },
    delete: (table: unknown) => ({ where: async (condition: never) => {
      const query = dialect.sqlToQuery(condition); const p = query.params;
      traces.push({ table, operation: 'delete', params: p, sql: query.sql });
      if (table === pending) get().pending = get().pending.filter(row => !matches(row, p));
      else get().projection = get().projection.filter(row => !(row.tenantId === p[0] && row.ownerKind === p[1] &&
        row.ownerId === p[2] && row.parentContextRef === p[3] && row.exactRevisionRef === p[4]));
    } }),
    insert: (table: unknown) => ({ values: async (values: Record<string, unknown>[]) => {
      if (hooks.failInsert) throw Object.assign(new Error('unsafe body must never be stored'), { code: 'XX001' });
      expect(table).toBe(projection); get().projection.push(...values);
    } }),
    update: (table: unknown) => ({ set: (values: { lastError: string }) => ({ where: async (condition: never) => {
      const query = dialect.sqlToQuery(condition);
      traces.push({ table, operation: 'update', params: query.params, sql: query.sql });
      for (const row of get().pending.filter(row => matches(row, query.params))) {
        row.attempts += 1; row.lastError = values.lastError;
      }
    } }) }),
  });
  const db = { ...executor(() => state), transaction: async (operation: (tx: unknown) => unknown) => {
    hooks.beforeTransaction(++transactions);
    const local = structuredClone(state);
    try { const result = await operation(executor(() => local)); state = local; return result; }
    catch (error) { hooks.afterRollback(); throw error; }
  } };
  const writer = new EngineeringSearchProjectionWriter(db as never);
  const verifySession = jest.fn(async (_database: unknown) => undefined);
  const load = jest.fn(async (_pending: unknown, _database: unknown) => content as never);
  const run = (limit = 100) => writer.rebuildPending({ tenantId: 'tenant', actorUserId: 'actor', limit, verifySession, load });
  return { writer, run, verifySession, load, hooks, traces, state: () => state };
}
function matches(row: ReturnType<typeof marker>, p: unknown[]) {
  return row.tenantId === p[0] && row.exactRevisionRef === p[1] && row.ownerKind === p[2] &&
    row.ownerId === p[3] && row.subjectId === p[4];
}

it('filters actor and tenant before LIMIT; USER and MATTER both use creator ownerId', async () => {
  const h = fixture([marker('a-other', 'other'), marker('b-other-tenant', 'actor', 'other'),
    marker('c-own'), marker('d-own', 'actor', 'tenant', 'MATTER')]);
  expect(await h.run(1)).toEqual({ attempted: 1, rebuilt: 1, failed: 0 });
  expect(h.state().pending.map(row => row.exactRevisionRef)).toEqual(['a-other', 'b-other-tenant', 'd-own']);
  expect(h.traces[0].params).toEqual(['tenant', 'actor', 'USER', 'MATTER']);
  expect(await h.run(1)).toEqual({ attempted: 1, rebuilt: 1, failed: 0 });
  expect(h.state().projection.map(row => row.ownerKind)).toEqual(['USER', 'MATTER']);
});

it('reauthorizes and writes each complete tuple in the same transaction; replay is empty', async () => {
  const h = fixture();
  expect(await h.run()).toEqual({ attempted: 1, rebuilt: 1, failed: 0 });
  expect(h.verifySession.mock.calls[0][0]).toBe(h.load.mock.calls[0][1]);
  expect(h.traces.filter(t => t.table === pending && t.operation === 'delete')[0].params)
    .toEqual(['tenant', 'wr-1', 'USER', 'actor', 'wr-1-subject']);
  expect(await h.run()).toEqual({ attempted: 0, rebuilt: 0, failed: 0 });
});

it('does not mutate attempts for unauthorized source, owner, object or exact-ref mismatch', async () => {
  const h = fixture();
  h.load.mockRejectedValue(new Error('AUTHORITATIVE_IDENTITY_MISMATCH'));
  expect(await h.run()).toEqual({ attempted: 1, rebuilt: 0, failed: 1 });
  expect(h.state().pending[0]).toEqual(marker());
  expect(h.state().projection).toEqual([]);
  expect(h.traces.some(t => ['update', 'delete'].includes(t.operation))).toBe(false);
});

it('rolls back projection failure and updates only an existing freshly authorized marker with an error code', async () => {
  const h = fixture();
  h.hooks.failInsert = true;
  expect(await h.run()).toEqual({ attempted: 1, rebuilt: 0, failed: 1 });
  expect(h.state().projection).toEqual([]);
  expect(h.state().pending[0]).toMatchObject({ attempts: 1, lastError: 'XX001' });
  expect(h.load).toHaveBeenCalledTimes(2);
  expect(h.verifySession).toHaveBeenCalledTimes(2);
  h.hooks.failInsert = false;
  expect(await h.run()).toEqual({ attempted: 1, rebuilt: 1, failed: 0 });
  expect(h.state().pending).toEqual([]);
});

it('does not resurrect a pending marker completed after rollback', async () => {
  const h = fixture(); h.hooks.failInsert = true;
  h.hooks.afterRollback = () => { h.state().pending = []; };
  expect(await h.run()).toEqual({ attempted: 1, rebuilt: 0, failed: 1 });
  expect(h.state().pending).toEqual([]);
  expect(h.traces.some(t => t.operation === 'update')).toBe(false);
});

it('does not overwrite a full tuple that changed between list and lock', async () => {
  const h = fixture(); h.hooks.beforeTransaction = () => { h.state().pending[0].subjectId = 'different'; };
  expect(await h.run()).toEqual({ attempted: 1, rebuilt: 0, failed: 0 });
  expect(h.load).not.toHaveBeenCalled();
  expect(h.state().pending[0].attempts).toBe(0);
});

it('rejects revoked request sessions, including between items, without touching the next marker', async () => {
  const h = fixture([marker('a'), marker('b')]);
  h.verifySession.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('OFFICIAL_OAUTH_SESSION_REQUIRED'));
  await expect(h.run()).rejects.toThrow('OFFICIAL_OAUTH_SESSION_REQUIRED');
  expect(h.state().pending).toEqual([marker('b')]);
  expect(h.state().projection).toHaveLength(1);
});

it('rechecks authorization before failure bookkeeping and preserves attempts when access was lost', async () => {
  const h = fixture(); h.hooks.failInsert = true;
  h.load.mockResolvedValueOnce(content as never).mockRejectedValueOnce(new Error('ACCESS_REVOKED'));
  expect(await h.run()).toEqual({ attempted: 1, rebuilt: 0, failed: 1 });
  expect(h.state().pending[0].attempts).toBe(0);
});

it('refuses conflicting existing projection identity even when the authoritative work has no issues', async () => {
  const h = fixture(); h.state().projection.push({ tenantId: 'tenant', exactRevisionRef: 'wr-1',
    ownerKind: 'USER', ownerId: 'other', parentContextRef: 'wrong', entryKind: 'WORK' });
  h.load.mockResolvedValue({ issues: [] } as never);
  expect(await h.run()).toEqual({ attempted: 1, rebuilt: 0, failed: 1 });
  expect(h.state().projection[0].ownerId).toBe('other');
  expect(h.state().pending[0].attempts).toBe(0);
  expect(h.state().pending).toHaveLength(1);
});
