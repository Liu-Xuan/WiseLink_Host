import { PgDialect } from 'drizzle-orm/pg-core';
import { engineeringMatterWorkRevision } from '../../server/database/schema';
import { EngineeringMatterWorkingRepository } from '../../server/modules/canonical-host/engineering-matter-working.repository';

function harness(rows: Array<{ tenantId: string; matterId: string; matterWorkRevisionId: string }>) {
  const where = jest.fn().mockResolvedValue(rows);
  const from = jest.fn().mockReturnValue({ where });
  const db = { select: jest.fn().mockReturnValue({ from }), execute: jest.fn() };
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

  it('checks each root source set independently in one actor-bound query', async () => {
    const h = harness([]);
    h.db.execute.mockResolvedValue([{ index: 1, allowed: false }, { index: 0, allowed: true }]);
    const batch = h.repository.createSavedRowBatch(3);
    const allowed = batch.checkSources('tenant-A', new Set(['WI-A']), new Set(['DV-A']));
    const denied = batch.checkSources('tenant-A', new Set(['WI-B']), new Set(['DV-B']));
    expect(h.db.execute).not.toHaveBeenCalled();
    batch.skipSources();
    await expect(allowed).resolves.toBeUndefined();
    await expect(denied).rejects.toMatchObject({ statusCode: 404 });
    expect(h.db.execute).toHaveBeenCalledTimes(1);
    const query = new PgDialect().sqlToQuery(h.db.execute.mock.calls[0][0]);
    expect(query.sql).toContain('engineering_matter_work_item_owned_by_actor');
    expect(query.sql).toContain('engineering_matter_document_owned_by_actor');
    expect(query.sql).toContain('IS NOT TRUE');
    expect(query.params[0]).toContain('WI-A');
    expect(query.params[0]).toContain('DV-B');
  });

  it('keeps a source query failure an error for each waiting root', async () => {
    const h = harness([]);
    const failure = new Error('DATABASE_UNAVAILABLE');
    h.db.execute.mockRejectedValue(failure);
    const batch = h.repository.createSavedRowBatch(2);
    const first = batch.checkSources('tenant-A', new Set(), new Set());
    const second = batch.checkSources('tenant-A', new Set(['WI-B']), new Set());
    await expect(first).rejects.toBe(failure);
    await expect(second).rejects.toBe(failure);
  });

  it('treats a missing source decision as unavailable, as the single-root reader does', async () => {
    const h = harness([]);
    h.db.execute.mockResolvedValue([{ index: 0, allowed: true }]);
    const batch = h.repository.createSavedRowBatch(2);
    const first = batch.checkSources('tenant-A', new Set(), new Set());
    const missing = batch.checkSources('tenant-A', new Set(['WI-B']), new Set());
    await expect(first).resolves.toBeUndefined();
    await expect(missing).rejects.toMatchObject({
      code: 'ENGINEERING_MATTER_RUNTIME_AUTHORIZATION_UNAVAILABLE', statusCode: 404,
    });
  });

  it('resolves exact overview origins for each root in one query and releases skipped slots', async () => {
    const h = harness([]);
    h.db.execute.mockResolvedValue([
      { index: 1, workRef: 'REV-B', workingRevision: 2, submittedOverview: 'beta' },
      { index: 0, workRef: null, workingRevision: null, submittedOverview: null },
    ]);
    const batch = h.repository.createSavedRowBatch(3);
    const first = batch.findOverview({ tenantId: 'tenant-A', matterId: 'MAT-A',
      createdByUserId: 'actor-A', workingRevision: 3, overview: 'alpha' });
    const second = batch.findOverview({ tenantId: 'tenant-A', matterId: 'MAT-B',
      createdByUserId: 'actor-A', workingRevision: 2, overview: 'beta' });
    expect(h.db.execute).not.toHaveBeenCalled();
    batch.skip();
    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toMatchObject({ workRef: 'REV-B', workingRevision: 2 });
    expect(h.db.execute).toHaveBeenCalledTimes(1);
    const query = new PgDialect().sqlToQuery(h.db.execute.mock.calls[0][0]);
    expect(query.sql).toContain('LEFT JOIN LATERAL');
    expect(query.sql).toContain('MATTER_JOBAID_WORK_SAVED');
    expect(query.sql).toContain('later.working_revision');
    expect(query.params[0]).toContain('MAT-A');
    expect(query.params[0]).toContain('beta');
  });

  it('does not turn a missing or failed overview batch result into an inherited origin', async () => {
    const h = harness([]);
    h.db.execute.mockResolvedValueOnce([{ index: 0, workRef: null }]);
    const batch = h.repository.createSavedRowBatch(2);
    const first = batch.findOverview({ tenantId: 'tenant-A', matterId: 'MAT-A',
      createdByUserId: 'actor-A', workingRevision: 1, overview: 'alpha' });
    const missing = batch.findOverview({ tenantId: 'tenant-A', matterId: 'MAT-B',
      createdByUserId: 'actor-A', workingRevision: 1, overview: 'beta' });
    await expect(first).resolves.toBeNull();
    await expect(missing).rejects.toMatchObject({ code: 'ENGINEERING_MATTER_WORKING_PERSISTENCE_INVALID' });
    const failure = new Error('DATABASE_UNAVAILABLE');
    h.db.execute.mockRejectedValueOnce(failure);
    const next = h.repository.createSavedRowBatch(2);
    const denied = next.findOverview({ tenantId: 'tenant-A', matterId: 'MAT-A',
      createdByUserId: 'actor-A', workingRevision: 1, overview: 'alpha' });
    next.skipOverview();
    await expect(denied).rejects.toBe(failure);
  });

  it('releases a source slot after a malformed saved state without hiding the data error', async () => {
    const command = JSON.stringify({ requestId: 'REQ', expectedWorkingRevision: 0,
      basedOnMatterRevisionId: 'BASIS', updateKind: 'INITIAL_SYNTHESIS', changeSummary: 'saved',
      nextFocus: null, claimDelta: null, openQuestionDelta: null, reviewConditionDelta: null,
      nextSubstantiveResult: null, substantiveInputs: [], coverageUpdates: [] });
    const state = JSON.stringify({ schemaVersion: 'wiselink.3_1.engineering_matter_working_state.v1',
      focus: { question: 'Check', targetRefs: [] }, substantiveResult: null,
      openQuestions: [], reviewConditions: [], substantiveInputs: [], coverage: [] });
    const row = (key: typeof a, commandJson: string) => ({ tenantId: key.tenantId,
      matterId: key.matterId, matterWorkRevisionId: key.workRef,
      workingRevision: 1, requestId: 'REQ', createdByUserId: 'actor-A',
      createdAt: new Date('2026-09-24T00:00:00.000Z'),
      commandJson, stateJson: state, basedOnMatterRevisionId: 'BASIS',
      updateKind: 'INITIAL_SYNTHESIS', changeSummary: 'saved',
      substantiveResultRef: null, substantiveResultRevision: null,
      actionAttemptId: null, reviewTurnId: null });
    const h = harness([row(a, command), row(b, '{invalid')]);
    h.db.execute.mockResolvedValueOnce([{ index: 0, allowed: true }]).mockResolvedValue([]);
    const batch = h.repository.createSavedRowBatch(2);
    const results = await Promise.allSettled([
      h.repository.readByRef({ ...a, batch }),
      h.repository.readByRef({ ...b, batch }),
    ]);
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'ENGINEERING_MATTER_WORKING_COMMAND_JSON_INVALID' } });
    expect(new PgDialect().sqlToQuery(h.db.execute.mock.calls[0][0]).sql)
      .toContain('engineering_matter_work_item_owned_by_actor');
  });
});
