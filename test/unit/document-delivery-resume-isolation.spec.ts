import { fork } from 'node:child_process';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { readWikiInventory } from '@server/modules/canonical-host/hierarchical-wiki-inventory';
import { readDocumentSummaryMember } from '@server/modules/canonical-host/derived-summary-document-reading';
import { documentDeliveryRequestId } from '@server/modules/canonical-host/document-delivery-ref';
import { ACTION_ATTEMPT_MAX_PARALLEL } from '@server/modules/action-attempt/action-attempt.types';
import { DocumentReadingRequestConflict } from '@server/modules/canonical-host/document-reading-request-conflict';
import { GlobalExceptionFilter } from '@server/common/filters/exception.filter';
import { deliveryIds, deliveryIsolationFixture, deliveryOwner } from './document-delivery-resume-isolation.fixture';

type Fixture = ReturnType<typeof deliveryIsolationFixture>;
interface ConsumerReport {
  result?: Record<string, unknown>;
  error?: { message: string; code?: string; statusCode?: number; name?: string; stack?: string };
  writes: Array<{ name: string; value: unknown }>;
  checkpoints: Record<string, unknown>;
  modelInvocations: number;
}
interface ConsumerInput {
  mode?: 'reading';
  target?: { documentVersionId: string; deliveryRef: string; readingRunRef: string };
  checkpoints?: Record<string, unknown>;
}
type ChildMessage = { type: 'ready' } | ({ type: 'done' } & ConsumerReport)
  | { type: 'rpc'; id: number; method: 'next' | 'tool' | 'wiki'; input: unknown };

/** Actual ESM consumers run in a local Node child; IPC is only their tool port.
 * No Native scheduler, Hosted provider, platform or online database is involved. */
function consumeLocally(f: Fixture, input: ConsumerInput = {}): Promise<ConsumerReport> {
  return new Promise((resolve, reject) => {
    const child = fork(join(__dirname, 'document-delivery-resume-isolation.consumer.mjs'), [], { silent: true });
    let done = false;
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('LOCAL_CONSUMER_TIMEOUT')); }, 15_000);
    child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (!done) reject(new Error(`LOCAL_CONSUMER_EXIT_${code}: ${stderr}`));
    });
    child.on('message', (raw: unknown) => {
      const message = raw as ChildMessage;
      if (message.type === 'ready') { child.send(input); return; }
      if (message.type === 'done') { done = true; clearTimeout(timer); resolve(message); return; }
      const reply = async (): Promise<unknown> => {
        if (message.method === 'next')
          return f.dispatch.nextWorkItem(message.input as Parameters<Fixture['dispatch']['nextWorkItem']>[0]);
        if (message.method === 'wiki') return { status: 'REQUIRES_ATTENTION', errorCode: 'SYNTHETIC_PROVIDER_UNKNOWN' };
        const tool = message.input as { name: string; args: unknown };
        if (tool.name === 'document_work')
          return f.documentWork.run(tool.args as Parameters<Fixture['documentWork']['run']>[0]);
        if (tool.name === 'document_reading') return f.readingRuntime.run(tool.args);
        throw new Error(`UNEXPECTED_LOCAL_TOOL: ${tool.name}`);
      };
      void reply().then(
        (value) => child.send({ type: 'reply', id: message.id, value }),
        (error: unknown) => {
          const details = error as Error & { code?: string; statusCode?: number };
          child.send({ type: 'reply', id: message.id, error: {
            message: error instanceof Error ? error.message : String(error),
            name: details.name, code: details.code, statusCode: details.statusCode, stack: details.stack,
          } });
        },
      );
    });
  });
}

/** The C inventory and exact member reader use the same constructed stored
 * readings as A/B. Only SQL results are substituted; no waiting logic is copied. */
function dependentInventory(f: Fixture) {
  const dialect = new PgDialect();
  const queries: string[] = [];
  const database = { execute: jest.fn(async (statement: SQL) => {
    const query = dialect.sqlToQuery(statement);
    queries.push(query.sql);
    if (query.sql.includes('SELECT DISTINCT m.source_id AS "familyId"')) return [{
      familyId: 'F-A', documentVersionId: 'DV-A', ata: '31-00', status: 'CONFIRMED',
    }];
    if (query.sql.includes('SELECT d.family_id AS "familyId"')) {
      const original = f.originals.get('PR-A-2')!;
      const row = f.rows.find((item) => item.documentVersionId === 'DV-A'
        && item.parseRunId === original.binding.parseRunId && item.semanticRevision === 1 && item.status === 'SAVED');
      return [{ familyId: 'F-A', documentVersionId: 'DV-A', metadata: null,
        sourceSha256: original.binding.sourceSha256, sourceByteLength: original.binding.sourceByteLength,
        member: row ? { kind: 'DOCUMENT_READING', documentVersionId: row.documentVersionId,
          parseRunId: row.parseRunId, semanticRevision: row.semanticRevision,
          readingRunRef: row.runRef, readingRevision: row.readingRevision } : null }];
    }
    if (query.sql.includes('SELECT r.result_json AS result,p.manifest_artifact')) {
      const p = query.params;
      const row = f.rows.find((item) => item.tenantId === p[0] && item.documentVersionId === p[1]
        && item.runRef === p[2] && item.readingRevision === p[3] && item.parseRunId === p[4]
        && item.semanticRevision === p[5] && item.status === 'SAVED');
      return row ? [{ result: row.result, current: true, manifestSha256: row.manifestSha256 }] : [];
    }
    if (query.sql.includes('SELECT wi.work_item_id AS "workItemId"')
      || query.sql.includes('w.state_json AS state FROM engineering_matter')
      || query.sql.includes('SELECT DISTINCT m.source_kind AS kind')) return [];
    throw new Error(`UNEXPECTED_C_STORAGE_QUERY: ${query.sql.slice(0, 120)}`);
  }) };
  return { database, queries, read: () => readWikiInventory(database as never, deliveryOwner,
    { fleetFamilyId: 'B747', fleetModelId: '747-8' }, null, null, {} as never) };
}

function expectNoNewReadingWork(f: Fixture): void {
  expect(f.begin).not.toHaveBeenCalled();
  expect(f.claim).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
  expect(f.parsing.start).not.toHaveBeenCalled();
  expect(f.parsing.executeStep).not.toHaveBeenCalled();
  expect(f.reader.readDocumentOriginal).not.toHaveBeenCalled();
  expect(f.semantics.ensure).not.toHaveBeenCalled();
  expect(f.modelSettings.captureForNewTask).not.toHaveBeenCalled();
}

describe('document delivery admission and actual consumer isolation', () => {
  const principal = process.env.WL_OPENCLAW_SERVICE_PRINCIPAL_ID;
  const successor = process.env.WL_OPENCLAW_SERVICE_SUCCESSOR_REVIEW_ENABLED;
  beforeEach(() => {
    process.env.WL_OPENCLAW_SERVICE_PRINCIPAL_ID = deliveryOwner.principalId;
    delete process.env.WL_OPENCLAW_SERVICE_SUCCESSOR_REVIEW_ENABLED;
  });
  afterAll(() => {
    if (principal === undefined) delete process.env.WL_OPENCLAW_SERVICE_PRINCIPAL_ID;
    else process.env.WL_OPENCLAW_SERVICE_PRINCIPAL_ID = principal;
    if (successor === undefined) delete process.env.WL_OPENCLAW_SERVICE_SUCCESSOR_REVIEW_ENABLED;
    else process.env.WL_OPENCLAW_SERVICE_SUCCESSOR_REVIEW_ENABLED = successor;
  });

  it('reconciles A WAITING to ADMITTED through original parse1 STATUS and returns the real saved reading with zero work', async () => {
    const f = deliveryIsolationFixture();
    const stored = JSON.stringify(f.a);
    await expect(f.dispatch.nextWorkItem()).resolves.toEqual({ status: 'DOCUMENT_PENDING',
      documentVersionId: 'DV-A', deliveryRef: 'acquisition:ACQ-A', documentAfterRef: 'acquisition:ACQ-A' });
    expect(f.prepare).toHaveBeenCalledWith(expect.objectContaining(deliveryIds.a));
    expect(f.reading).toHaveBeenCalledWith({ action: 'READING_STATUS', documentVersionId: 'DV-A',
      runRef: 'DRR-A-1', deliveryRef: 'acquisition:ACQ-A' });
    expect(await f.reading.mock.results[0].value).toMatchObject({ status: 'SAVED', parseRunId: 'PR-A-1',
      result: { sourceBinding: { original: { parseRunId: 'PR-A-1', parseRevision: 1 } } } });
    const receipt = await consumeLocally(f, { mode: 'reading', target: { documentVersionId: 'DV-A',
      deliveryRef: 'acquisition:ACQ-A', readingRunRef: 'DRR-A-1' } });
    expect(receipt.error).toBeUndefined();
    expect(receipt.result).toMatchObject({ status: 'READING_SAVED', modelInvocations: 0,
      saved: { readingRunRef: 'DRR-A-1', sourceBinding: { original: { parseRunId: 'PR-A-1' } } } });
    expect(receipt.modelInvocations).toBe(0);
    expect(receipt.writes).toEqual([]);
    expect(f.uploads[0].status).toBe('ADMITTED');
    expect(JSON.stringify(f.a)).toBe(stored);
    expect(f.rows).toHaveLength(1);
    expectNoNewReadingWork(f);
  });

  it('runs the actual automatic queue/document consumer, persists the A cursor, and admits independent B at the next cursor', async () => {
    const f = deliveryIsolationFixture();
    const tick = await consumeLocally(f);
    expect(tick.error).toBeUndefined();
    expect(tick.result).toMatchObject({ status: 'DOCUMENT_DISPATCHED', documentVersionId: 'DV-A',
      document: { status: 'DOCUMENT_READY', translation: { status: 'NOT_REQUESTED' } } });
    expect(tick.checkpoints['document-cursor']).toBe('acquisition:ACQ-A');
    expect(tick.modelInvocations).toBe(0);
    expectNoNewReadingWork(f);
    await expect(f.dispatch.nextWorkItem({ documentAfterRef: 'acquisition:ACQ-A' })).resolves.toEqual({
      status: 'DOCUMENT_PENDING', documentVersionId: 'DV-B', deliveryRef: 'acquisition:ACQ-B',
      documentAfterRef: 'acquisition:ACQ-B' });
    expect(f.begin).toHaveBeenCalledTimes(1);
    expect(f.begin).toHaveBeenCalledWith(expect.objectContaining({ documentVersionId: 'DV-B' }),
      expect.objectContaining({ parseRunId: 'PR-B-1', parseRevision: 1, expectedRevision: 0 }));
    expect(f.rows[1]).toMatchObject({ status: 'QUEUED', documentVersionId: 'DV-B', parseRunId: 'PR-B-1' });
    expect(f.rows[1].requestId).not.toBe(f.a.requestId);
    expect(f.uploads[1].status).toBe('ADMITTED');
    await expect(f.dispatch.nextWorkItem({ documentAfterRef: 'acquisition:ACQ-A' }))
      .resolves.toMatchObject({ status: 'DOCUMENT_PENDING', documentVersionId: 'DV-B' });
    expect(f.begin).toHaveBeenCalledTimes(1);
    expect(f.rows).toHaveLength(2);
    expect(f.save).not.toHaveBeenCalled();
  });

  it('preserves direct BEGIN rejection and its exact typed409 identity without changing the reading', async () => {
    const f = deliveryIsolationFixture();
    const before = JSON.stringify(f.a);
    const conflict: unknown = await f.readingRuntime.run({ action: 'READING_BEGIN', documentVersionId: 'DV-A',
      deliveryRef: 'acquisition:ACQ-A', parseRunId: 'PR-A-2', semanticRevision: 1,
      requestId: f.a.requestId, expectedRevision: 0 }).catch((error: unknown) => error);
    expect(conflict).toBeInstanceOf(DocumentReadingRequestConflict);
    expect(conflict).toMatchObject({ message: 'DOCUMENT_READING_REQUEST_CONFLICT',
      code: 'DOCUMENT_READING_REQUEST_CONFLICT', statusCode: 409, tenantId: deliveryOwner.tenantId,
      actorUserId: deliveryOwner.actorUserId, documentVersionId: 'DV-A', requestId: f.a.requestId });
    expect(f.begin).toHaveBeenCalledTimes(1);
    expect(f.begin).toHaveBeenCalledWith(expect.objectContaining({ documentVersionId: 'DV-A' }),
      expect.objectContaining({ parseRunId: 'PR-A-2', manifestSha256: '2'.repeat(64), expectedRevision: 0 }));
    expect(f.catalog.markDocumentUploadDeliveryAdmitted).not.toHaveBeenCalled();
    expect(f.uploads.map((item) => item.status)).toEqual(['WAITING', 'WAITING']);
    expect(f.rows).toHaveLength(1);
    expect(JSON.stringify(f.a)).toBe(before);
    expect(f.save).not.toHaveBeenCalled();
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const host = { switchToHttp: () => ({ getResponse: () => ({ headersSent: false, status, json }) }) };
    new GlobalExceptionFilter().catch(conflict, host as unknown as ArgumentsHost);
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({ error: expect.objectContaining({ code: 'DOCUMENT_READING_REQUEST_CONFLICT' }) });
  });

  // This exact normal-consumer case failed on 220 before the narrow production
  // catch. Its original active failure is retained in baseline-red-composition.
  it('advances independent B in the same normal queue consumption after exact local A request conflict', async () => {
    const f = deliveryIsolationFixture();
    // B is already SAVED: its normal consumer needs no provider/claim/SAVE.
    // This keeps the desired failure attributable to A's scan boundary alone.
    f.rows.push({ ...f.a, runRef: 'DRR-B-1', documentVersionId: 'DV-B', parseRunId: 'PR-B-1',
      requestId: documentDeliveryRequestId('reading', 'acquisition:ACQ-B'),
      result: { ...f.a.result!, readingRunRef: 'DRR-B-1', sourceBinding: {
        original: f.originals.get('PR-B-1')!.binding, semanticRevision: 1 } } });
    f.faults.hideRequestReads = 1;
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    let tick: ConsumerReport;
    let warnings: string[] = [];
    try {
      tick = await consumeLocally(f);
      warnings = warn.mock.calls.map(([message]) => String(message));
    }
    finally { warn.mockRestore(); }
    expect(tick.error).toBeUndefined();
    expect(tick.result).toMatchObject({ status: 'DOCUMENT_DISPATCHED', documentVersionId: 'DV-B' });
    expect(await f.prepare.mock.results[0].value).toEqual({ status: 'REQUIRES_ATTENTION',
      documentVersionId: 'DV-A', parseRunId: 'PR-A-2', errorCode: 'DOCUMENT_READING_REQUEST_CONFLICT' });
    expect(warnings).toContainEqual(expect.stringContaining('acquisition:ACQ-A'));
    expect(warnings).toContainEqual(expect.stringContaining(f.a.requestId));
    expect(warnings).toContainEqual(expect.stringContaining('DOCUMENT_READING_REQUEST_CONFLICT'));
    expect(tick.checkpoints['document-cursor']).toBe('acquisition:ACQ-B');
    expect(f.prepare.mock.calls.map(([item]) => item.acquisitionId)).toEqual(['ACQ-A', 'ACQ-B']);
    expect(f.uploads[0].status).toBe('WAITING');
    expect(f.uploads[1].status).toBe('ADMITTED');
    expect(f.a).toMatchObject({ status: 'SAVED', parseRunId: 'PR-A-1', readingRevision: 1 });
    expect(f.save).not.toHaveBeenCalled();
    expect(tick.modelInvocations).toBe(0);
    const c = await dependentInventory(f).read();
    expect(c.waiting).toContainEqual(expect.objectContaining({ documentVersionId: 'DV-A', status: 'READING_NOT_READY' }));
    expect(f.claim).not.toHaveBeenCalled();
    expect(f.rows).toHaveLength(2);
    // A later ordinary scan sees the winning parse1 request and only reads STATUS.
    const beginCount = f.begin.mock.calls.length;
    await expect(f.dispatch.nextWorkItem()).resolves.toMatchObject({ status: 'DOCUMENT_PENDING', documentVersionId: 'DV-A' });
    expect(f.begin).toHaveBeenCalledTimes(beginCount);
    expect(f.reading).toHaveBeenLastCalledWith({ action: 'READING_STATUS', documentVersionId: 'DV-A',
      runRef: 'DRR-A-1', deliveryRef: 'acquisition:ACQ-A' });
  });

  it.each(['tenantId', 'actorUserId', 'documentVersionId', 'requestId'] as const)(
    'does not absorb a typed conflict with a different %s', async (field) => {
      const f = deliveryIsolationFixture();
      f.faults.hideRequestReads = 1;
      const identity = { tenantId: deliveryOwner.tenantId, actorUserId: deliveryOwner.actorUserId,
        documentVersionId: 'DV-A', requestId: f.a.requestId, [field]: 'different-binding' };
      const conflict = new DocumentReadingRequestConflict(identity);
      f.faults.transaction = conflict;
      await expect(f.dispatch.nextWorkItem()).rejects.toBe(conflict);
      expect(f.begin).toHaveBeenCalledTimes(1);
      expect(f.uploads.map((item) => item.status)).toEqual(['WAITING', 'WAITING']);
      expect(f.catalog.markDocumentUploadDeliveryAdmitted).not.toHaveBeenCalled();
      expect(f.save).not.toHaveBeenCalled();
    });

  it('does not absorb a same-message/code/status object without the exact conflict type', async () => {
    const f = deliveryIsolationFixture();
    f.faults.hideRequestReads = 1;
    const error = Object.assign(new Error('DOCUMENT_READING_REQUEST_CONFLICT'), {
      code: 'DOCUMENT_READING_REQUEST_CONFLICT', statusCode: 409, ...deliveryOwner,
      documentVersionId: 'DV-A', requestId: f.a.requestId,
    });
    f.faults.transaction = error;
    await expect(f.dispatch.nextWorkItem()).rejects.toBe(error);
    expect(f.begin).toHaveBeenCalledTimes(1);
    expect(f.catalog.markDocumentUploadDeliveryAdmitted).not.toHaveBeenCalled();
  });

  it.each(['database', 'identity'] as const)('propagates shared %s failure inside READING_BEGIN', async (port) => {
    const f = deliveryIsolationFixture();
    f.faults.hideRequestReads = 1;
    const error = new Error(`SYNTHETIC_BEGIN_${port.toUpperCase()}_UNAVAILABLE`);
    if (port === 'database') f.faults.transaction = error;
    else f.authorization.authorizeDocumentWork.mockImplementation(async (input) => {
      if (input.purpose === 'READING') throw error;
      return { ...deliveryOwner, documentVersionId: input.documentVersionId };
    });
    await expect(f.dispatch.nextWorkItem()).rejects.toBe(error);
    expect(f.uploads.map((item) => item.status)).toEqual(['WAITING', 'WAITING']);
    expect(f.catalog.markDocumentUploadDeliveryAdmitted).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
  });

  it('propagates a real A binding mismatch and creates no consumer cursor or B work', async () => {
    const f = deliveryIsolationFixture();
    f.a.documentVersionId = 'DV-wrong';
    const tick = await consumeLocally(f);
    expect(tick.error?.message).toBe('DOCUMENT_UPLOAD_DELIVERY_READING_SCOPE_MISMATCH');
    expect(tick.writes).toEqual([]);
    expect(tick.modelInvocations).toBe(0);
    expect(f.uploads.map((item) => item.status)).toEqual(['WAITING', 'WAITING']);
    expectNoNewReadingWork(f);
  });

  it('skips explicit terminal A in the same scan and admits B without fabricating a saved A or C dependency', async () => {
    const f = deliveryIsolationFixture();
    Object.assign(f.a, { status: 'FAILED', result: null, readingRevision: null, errorCode: 'SYNTHETIC_READING_FAILED' });
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      await expect(f.dispatch.nextWorkItem()).resolves.toMatchObject({ status: 'DOCUMENT_PENDING', documentVersionId: 'DV-B' });
    } finally { warn.mockRestore(); }
    expect(f.uploads.map((item) => item.status)).toEqual(['WAITING', 'ADMITTED']);
    expect(f.prepare.mock.calls.map(([item]) => item.acquisitionId)).toEqual(['ACQ-A', 'ACQ-B']);
    expect(f.begin).toHaveBeenCalledTimes(1);
    expect(f.begin.mock.calls[0][0].documentVersionId).toBe('DV-B');
    const c = await dependentInventory(f).read();
    expect(c.waiting).toContainEqual(expect.objectContaining({ documentVersionId: 'DV-A', status: 'READING_NOT_READY' }));
    expect(f.a.status).toBe('FAILED');
    expect(f.save).not.toHaveBeenCalled();
  });

  it('keeps C waiting for current parse2 despite A historical parse1 SAVE and independent B admission', async () => {
    const f = deliveryIsolationFixture();
    const c = dependentInventory(f);
    const before = await c.read();
    await f.dispatch.nextWorkItem();
    await f.dispatch.nextWorkItem({ documentAfterRef: 'acquisition:ACQ-A' });
    const after = await c.read();
    expect(after.waiting).toEqual(before.waiting);
    expect(after.waiting).toContainEqual({ kind: 'DOCUMENT', subjectId: 'F-A', requestId: null,
      ata: '31-00', documentVersionId: 'DV-A', status: 'READING_NOT_READY' });
    expect(after.items[0].member).toBeNull();
    const query = c.queries.find((item) => item.includes('SELECT d.family_id AS "familyId"'))!;
    expect(query).toContain("a.status='SAVED'");
    expect(query).toContain('ORDER BY parse_revision DESC LIMIT 1');
    expect(query).toContain('SELECT max(semantic_revision)');
    await expect(readDocumentSummaryMember({ kind: 'DOCUMENT_READING', documentVersionId: 'DV-A',
      parseRunId: 'PR-A-2', semanticRevision: 1, readingRunRef: 'DRR-A-current-not-saved', readingRevision: 1 },
    deliveryOwner, c.database as never)).rejects.toThrow('DERIVED_SUMMARY_DOCUMENT_READING_UNAVAILABLE');
    expect(f.a).toMatchObject({ status: 'SAVED', parseRunId: 'PR-A-1', readingRevision: 1 });
    expect(f.rows[1]).toMatchObject({ documentVersionId: 'DV-B', status: 'QUEUED' });
    expect(f.save).not.toHaveBeenCalled();
  });

  it.each(['database', 'identity'] as const)('propagates a shared %s outage without marking A or advancing to B', async (port) => {
    const f = deliveryIsolationFixture();
    const error = new Error(port === 'database' ? 'SYNTHETIC_SHARED_DB_UNAVAILABLE' : 'SYNTHETIC_SHARED_IDENTITY_UNAVAILABLE');
    f.faults[port] = error;
    await expect(f.dispatch.nextWorkItem()).rejects.toBe(error);
    expect(f.uploads.map((item) => item.status)).toEqual(['WAITING', 'WAITING']);
    expect(f.catalog.markDocumentUploadDeliveryAdmitted).not.toHaveBeenCalled();
    expect(f.prepare.mock.calls.every(([item]) => item.acquisitionId === 'ACQ-A')).toBe(true);
    expectNoNewReadingWork(f);
  });

  it('retains the UNKNOWN endpoint pointer and all four constructed AA slot records without guessing provider use or claiming B', async () => {
    const f = deliveryIsolationFixture();
    const next = jest.spyOn(f.dispatch, 'nextWorkItem');
    // Four Host slot records are a storage assumption, not measured provider use.
    const slots = Array.from({ length: ACTION_ATTEMPT_MAX_PARALLEL }, (_unused, leaseSlot) => ({
      attemptRef: `AQ-held-${leaseSlot}`, status: 'RUNNING', leaseSlot, providerOutcome: 'UNKNOWN',
    }));
    const activeWiki = { summaryId: 'DS-held', attemptRef: 'AQ-held-0', providerOutcome: 'UNKNOWN', slotRecords: slots };
    const tick = await consumeLocally(f, { checkpoints: { 'active-wiki': activeWiki } });
    expect(slots).toHaveLength(4);
    expect(tick.result).toEqual({ status: 'REQUIRES_ATTENTION', errorCode: 'SYNTHETIC_PROVIDER_UNKNOWN' });
    expect(tick.checkpoints['active-wiki']).toEqual(activeWiki);
    expect(tick.writes).toEqual([]);
    expect(tick.modelInvocations).toBe(0);
    expect(next).not.toHaveBeenCalled();
    expect(f.uploads.map((item) => item.status)).toEqual(['WAITING', 'WAITING']);
    expectNoNewReadingWork(f);
  });
});
