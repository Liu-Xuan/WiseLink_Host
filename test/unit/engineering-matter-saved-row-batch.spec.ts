import { createNoticeWindowReader } from '../../server/modules/canonical-host/engineering-notice-window';
import { EngineeringReadPhaseObservation } from '../../server/modules/canonical-host/engineering-read-phase-observation';
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


describe('batch timeline preserves settlement', () => {
  it('records full skips without issuing phantom queries', () => {
    const h = harness([]);
    const observation = new EngineeringReadPhaseObservation({ timeline: true }).scope({ windowIndex: 2 });
    const batch = h.repository.createSavedRowBatch(2, observation);
    batch.skip();
    batch.skip();
    expect(h.db.select).not.toHaveBeenCalled();
    expect(h.db.execute).not.toHaveBeenCalled();
    const timeline = observation.timelineSnapshot()!;
    const ready = timeline.events.filter(event => timeline.names[event[0]].endsWith('_batch_ready'));
    expect(ready).toHaveLength(3);
    expect(ready.every(event => event[5] === 0 && event[6] === 2)).toBe(true);
    expect(timeline.scopes).toEqual([{ windowIndex: 2 }]);
    expect(Object.keys(observation.snapshot())).toEqual([]);
  });

  it('records one real query and distribution after a partial skip, preserving the original error', async () => {
    const h = harness([]);
    const failure = new Error('original SQL error');
    h.where.mockRejectedValue(failure);
    const observation = new EngineeringReadPhaseObservation({ timeline: true }).scope({ windowIndex: 0 });
    const batch = h.repository.createSavedRowBatch(2, observation);
    const first = batch.read(a);
    expect(h.db.select).not.toHaveBeenCalled();
    batch.skip();
    await expect(first).rejects.toBe(failure);
    expect(h.db.select).toHaveBeenCalledTimes(1);
    const timeline = observation.timelineSnapshot()!;
    const ready = timeline.events.find(event => timeline.names[event[0]] === 'saved_row_batch_ready')!;
    const query = timeline.events.find(event => timeline.names[event[0]] === 'saved_row_batch_query')!;
    expect(ready.slice(5)).toEqual([1, 1]);
    expect(query[2]).toBeGreaterThanOrEqual(ready[3]);
    expect(query[4]).toBe('error');
    expect(observation.snapshot().saved_row_batch_distribution.count).toBe(1);
    expect(JSON.stringify(timeline)).not.toContain(failure.message);
  });
});

function noticeHarness() {
  const command = JSON.stringify({ requestId: 'REQ', expectedWorkingRevision: 0,
    basedOnMatterRevisionId: 'BASIS', updateKind: 'INITIAL_SYNTHESIS', changeSummary: 'saved',
    nextFocus: null, claimDelta: null, openQuestionDelta: null, reviewConditionDelta: null,
    nextSubstantiveResult: null, substantiveInputs: [], coverageUpdates: [] });
  const row = { tenantId: a.tenantId, matterId: a.matterId, matterWorkRevisionId: a.workRef,
    workingRevision: 1, requestId: 'REQ', createdByUserId: 'actor-A', createdAt: new Date(),
    commandJson: command, stateJson: JSON.stringify({ schemaVersion: 'wiselink.3_1.engineering_matter_working_state.v1',
      focus: { question: 'Check', targetRefs: [] }, substantiveResult: null,
      openQuestions: [], reviewConditions: [], substantiveInputs: [], coverage: [] }),
    basedOnMatterRevisionId: 'BASIS', updateKind: 'INITIAL_SYNTHESIS', changeSummary: 'saved',
    substantiveResultRef: null, substantiveResultRevision: null, actionAttemptId: null, reviewTurnId: null };
  const ranked = { attemptId: engineeringMatterWorkRevision.actionAttemptId,
    workRef: engineeringMatterWorkRevision.matterWorkRevisionId, workingRevision: engineeringMatterWorkRevision.workingRevision,
    requestId: engineeringMatterWorkRevision.requestId, saveRank: engineeringMatterWorkRevision.workingRevision };
  const builder = { from: jest.fn(), where: jest.fn(), as: jest.fn().mockReturnValue(ranked),
    orderBy: jest.fn().mockResolvedValue([]) };
  builder.from.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);
  const db = { select: jest.fn().mockReturnValue(builder), execute: jest.fn().mockResolvedValue([]) };
  const batch = { read: jest.fn().mockResolvedValue(row), skip: jest.fn(),
    checkSources: jest.fn().mockResolvedValue(undefined), skipSources: jest.fn(),
    findOverview: jest.fn(), skipOverview: jest.fn() };
  const repository = new EngineeringMatterWorkingRepository(db as never, {} as never, {} as never, {} as never);
  const observation = new EngineeringReadPhaseObservation({ timeline: true }).scope({ windowIndex: 0, rootSlot: 0, readInstance: 0 });
  return { repository, observation, batch, db, builder };
}

describe('notice timings preserve read outcomes', () => {
  it('keeps an empty notice result readable and does not invent a saves query', async () => {
    const h = noticeHarness();
    await expect(h.repository.readByRef({ ...a, batch: h.batch, observation: h.observation }))
      .resolves.toMatchObject({ matterWorkRevisionId: a.workRef });
    expect(h.observation.snapshot().notice_attempts_query.count).toBe(1);
    expect(h.observation.snapshot().notice_projection.count).toBe(1);
    expect(h.observation.snapshot()).not.toHaveProperty('notice_saves_query');
    expect(h.builder.orderBy).not.toHaveBeenCalled();
  });

  it('records a failed notice query without replacing the original infrastructure error', async () => {
    const h = noticeHarness();
    const failure = new Error('notice query failed');
    h.db.execute.mockRejectedValue(failure);
    await expect(h.repository.readByRef({ ...a, batch: h.batch, observation: h.observation })).rejects.toBe(failure);
    const timeline = h.observation.timelineSnapshot()!;
    expect(timeline.events.find(event => timeline.names[event[0]] === 'notice_attempts_query')?.[4]).toBe('error');
    expect(h.observation.snapshot()).not.toHaveProperty('notice_projection');
  });

  it('continues to reject malformed notice data after its saves query', async () => {
    const h = noticeHarness();
    h.db.execute.mockResolvedValue([{ id: 'ATTEMPT', attemptRef: null, status: 'FAILED',
      isCorrection: false, isOverview: true, overviewPurpose: { expectedWorkRef: a.workRef, correctionReason: 'review' } }]);
    await expect(h.repository.readByRef({ ...a, batch: h.batch, observation: h.observation }))
      .rejects.toThrow('ENGINEERING_OVERVIEW_CORRECTION_NOTICE_INVALID');
    expect(h.observation.snapshot().notice_saves_query.count).toBe(1);
    const timeline = h.observation.timelineSnapshot()!;
    expect(timeline.events.find(event => timeline.names[event[0]] === 'notice_projection')?.[4]).toBe('error');
  });
});

describe('notice window exact-reader isolation', () => {
  it('coalesces four authorized exact readers at the actual notice call site', async () => {
    const h = noticeHarness();
    const readNotices = h.repository.createSavedRowBatch(4, h.observation).readNotices;
    const saved = await h.batch.read(a);
    h.batch.read.mockImplementation(async key => ({ ...saved, matterWorkRevisionId: key.workRef }));
    const results = await Promise.all(['W1', 'W2', 'W3', 'W4'].map(workRef =>
      h.repository.readByRef({ ...a, workRef, batch: { ...h.batch, readNotices }, observation: h.observation })));
    expect(results.map(result => result?.matterWorkRevisionId)).toEqual(['W1', 'W2', 'W3', 'W4']);
    expect(h.db.execute).toHaveBeenCalledTimes(1);
    expect(h.observation.snapshot().notice_attempts_query.count).toBe(4);
    expect(h.observation.snapshot().notice_window_batch_query.count).toBe(1);
  });
  it('rejects a corrupt purpose only for its root while retaining the legal sibling', async () => {
    const h = noticeHarness();
    const readNotices = createNoticeWindowReader(h.db as never, h.observation);
    h.db.execute.mockResolvedValue([{ index: 0, id: 'BAD', attemptRef: 'BAD-REF', status: 'FAILED',
      isCorrection: true, isOverview: null, overviewPurpose: null, reviewActivityJson: '[]',
      correctionPurpose: { kind: 'ENGINEERING_ISSUE_CORRECTION', expectedWorkRef: a.workRef, issueKey: 'I' } }]);
    const saved = await h.batch.read(a);
    h.batch.read.mockImplementation(async key => ({ ...saved, matterWorkRevisionId: key.workRef }));
    const batch = { ...h.batch, readNotices };
    const result = await Promise.allSettled([
      h.repository.readByRef({ ...a, batch }), h.repository.readByRef({ ...a, workRef: 'LEGAL', batch }),
    ]);
    expect(result[0]).toMatchObject({ status: 'rejected', reason: new Error('ENGINEERING_CORRECTION_NOTICE_INVALID') });
    expect(result[1]).toMatchObject({ status: 'fulfilled', value: { matterWorkRevisionId: 'LEGAL' } });
    expect(h.db.execute).toHaveBeenCalledTimes(1);
  });

  it('keeps retries outside the queue', async () => {
    const h = noticeHarness();
    const readNotices = jest.fn();
    await h.repository.readByRef({ ...a, batch: { ...h.batch, readNotices },
      observation: h.observation.scope({ attempt: 1 }) });
    expect(readNotices).not.toHaveBeenCalled();
    expect(h.db.execute).toHaveBeenCalledTimes(1);
  });

});
