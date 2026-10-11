import { createHash } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { getTableConfig } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { actionAttempt, workItem } from '../../server/database/schema';
import { autoWorkItemAuthorization } from '../../server/database/auto-work-item-authorization.schema';
import { MiaodaWorkItemRepository } from '../../server/modules/work-item/miaoda-work-item.repository';
import type { CancelledAutoProcessingLeaseInput } from '../../server/modules/work-item/cancelled-auto-processing-lease';
import { canonicalJson, sealTaskEnvelope } from '../../server/modules/action-attempt/action-attempt-envelope';

const NOW = new Date('2026-10-12T00:00:00.000Z');
const TOKEN = 'b1686364-7ee9-4ca1-a3aa-0b62794cb436';
const MODEL = { modelRef: 'miaoda/glm-5.3', displayName: 'GLM 5.3', providerKind: 'BUILT_IN' as const,
  settingsRevision: 1, selectedAt: NOW.toISOString() };

function fixture() {
  const task = sealTaskEnvelope({ schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
    actionAttemptId: 'ATT-old', operationRef: 'AQ-old', taskType: 'OPENCLAW_DYNAMIC_EVALUATION',
    priority: 100, tenantId: 'tenant-fixture', workItemId: 'WI-fixture', inputRevision: 3, baseRevision: 3,
    documentVersionId: 'DV-fixture', sourceRefs: [], allowedConnectors: [], hostResolvedMissingInputs: [],
    modelInput: { fixture: 'synthetic-control-only' }, executionModel: MODEL,
    deadline: '2026-10-12T00:30:00.000Z', idempotencyKey: 'openclaw-v2:cancelled-fixture' });
  const source = { documentId: 'DOC-fixture', documentVersionId: 'DV-fixture',
    sourceArtifactId: 'ART-fixture', sourceFileSha256: 'a'.repeat(64), sourceByteLength: 1024 };
  const owner = { ...source, tenantId: 'tenant-fixture', workItemId: 'WI-fixture', requestId: 'REQ-parse',
    revision: 3, requestedByUserId: 'actor-fixture', actionType: 'PARSE_PDF',
    status: 'CANDIDATE_READBACK_VERIFIED', packageId: 'PKG-fixture', analysisModelJson: canonicalJson(MODEL),
    projectionJson: canonicalJson({ workItemId: 'WI-fixture', requestId: 'REQ-parse', revision: 3,
      phase: 'CANDIDATE_READBACK_VERIFIED', source, package: { packageId: 'PKG-fixture' } }) };
  const target = { tenantId: owner.tenantId, actorUserId: owner.requestedByUserId,
    workItemId: owner.workItemId, documentVersionId: owner.documentVersionId, subjectKind: 'WORK_ITEM',
    requestOrigin: 'OPENCLAW_MCP_V1', status: 'CANCELLED', attemptId: task.actionAttemptId,
    operationRef: task.operationRef, actionType: task.taskType, attemptNo: 6, triggerRequestId: 'REQ-job',
    inputRevision: 3, baseRevision: 3, taskInputHash: task.inputHash, taskEnvelopeJson: canonicalJson(task),
    idempotencyKey: task.idempotencyKey, executionModelJson: canonicalJson(MODEL),
    completedAt: NOW, createdAt: new Date(NOW.getTime() - 60000),
    projectionApplied: false, commitStartedAt: null, resultEnvelopeJson: null, resultContentHash: null,
    leaseOwner: null, leaseToken: null, leaseExpiresAt: null };
  const attempts = [target];
  const grant = { ...source, tenantId: owner.tenantId, actorUserId: owner.requestedByUserId,
    workItemId: owner.workItemId, requestId: owner.requestId, grantKind: 'MIAODA_CANONICAL_PARSE_REQUEST',
    status: 'LEASED', leaseOwner: 'service:openclaw-main', leaseToken: TOKEN, leaseGeneration: 10,
    leaseExpiresAt: new Date('2100-01-01'), blockedAt: null as Date | null,
    blockedCode: null as string | null, blockedLeaseTokenHash: null as string | null,
    blockedLeaseGeneration: null as number | null };
  const input: CancelledAutoProcessingLeaseInput = { tenantId: owner.tenantId, workItemId: owner.workItemId,
    actorUserId: owner.requestedByUserId, leaseOwner: 'service:openclaw-main', leaseToken: TOKEN,
    leaseGeneration: 10, replayOnly: false, expectedCancellation: {
      ...source, requestId: owner.requestId, workItemRevision: 3, attemptId: target.attemptId,
      attemptRef: target.operationRef, attemptNo: target.attemptNo, attemptRequestId: target.triggerRequestId,
      actionType: 'OPENCLAW_DYNAMIC_EVALUATION', inputRevision: 3, baseRevision: 3,
      inputHash: task.inputHash, executionModel: MODEL,
    } };
  const sql: { sql: string; params: unknown[] }[] = [];
  const events: string[] = [];
  let beforeLock: (table: unknown) => Promise<void> = async () => {};
  const returning = jest.fn(async () => {
    if (grant.leaseExpiresAt <= NOW) return [];
    grant.status = 'BLOCKED'; grant.leaseOwner = null as unknown as string;
    grant.leaseToken = null as unknown as string;
    grant.blockedAt = NOW; grant.blockedCode = 'AUTO_WORK_ITEM_STAGE_JOBAID_CANCELLED';
    grant.blockedLeaseTokenHash = createHash('sha256').update(TOKEN).digest('hex'); grant.blockedLeaseGeneration = 10;
    events.push('BLOCK');
    return [{ blockedAt: grant.blockedAt, blockedCode: grant.blockedCode }];
  });
  const db = {
    select: () => ({ from: (table: unknown) => ({ where: (condition: SQL) => {
      const builder = drizzle.mock().select().from(table as typeof workItem).where(condition);
      const query = {
        limit: (count: number) => { builder.limit(count); return query; },
        for: async (mode: 'update') => {
          builder.for(mode); sql.push(builder.toSQL()); events.push(table === workItem ? 'WI_LOCK' : table === actionAttempt ? 'ATT_LOCK' : 'GRANT_LOCK');
          await beforeLock(table);
          return structuredClone(table === workItem ? [owner] : table === actionAttempt ? attempts : [grant]);
        },
      };
      return query;
    } }) }),
    update: jest.fn((table: unknown) => {
      expect(table).toBe(autoWorkItemAuthorization);
      return { set: (values: Record<string, unknown>) => {
        expect(Object.keys(values).sort()).toEqual(['status', 'leaseOwner', 'leaseToken', 'leaseExpiresAt',
          'blockedCode', 'blockedLeaseTokenHash', 'blockedLeaseGeneration', 'blockedAt', 'updatedAt'].sort());
        return { where: (condition: SQL) => {
          sql.push(drizzle.mock().update(autoWorkItemAuthorization).set(values).where(condition).toSQL());
          return { returning };
        } };
      } };
    }),
    transaction: jest.fn(async (perform: (tx: unknown) => Promise<unknown>) => perform(db)),
  };
  const repository = new MiaodaWorkItemRepository(db as never);
  return { owner, target, attempts, grant, input, repository, db, returning, sql, events,
    setBeforeLock: (perform: typeof beforeLock) => { beforeLock = perform; } };
}

test('uses the shared WI FOR UPDATE then all-attempt locks, and preserves all JA/attempt/source data', async () => {
  const f = fixture(); const before = canonicalJson({ owner: f.owner, attempts: f.attempts });
  await expect(f.repository.parkCancelledAutoProcessingLease(f.input)).resolves.toEqual({
    blockedAt: NOW, blockedCode: 'AUTO_WORK_ITEM_STAGE_JOBAID_CANCELLED', replayed: false,
  });
  expect(f.events).toEqual(['WI_LOCK', 'GRANT_LOCK', 'ATT_LOCK', 'BLOCK']);
  expect(f.sql.slice(0, 3).every(query => /for update$/u.test(query.sql))).toBe(true);
  expect(f.sql[2].sql).not.toContain('limit');
  expect(f.sql[2].params).toEqual(['tenant-fixture', 'WI-fixture']);
  expect(f.sql[3].sql).toContain('"lease_expires_at" > clock_timestamp()');
  expect(f.sql[3].params).toContain(TOKEN); expect(f.sql[3].params).toContain(10);
  expect(canonicalJson({ owner: f.owner, attempts: f.attempts })).toBe(before);
  // Structural dependency, not a live PostgreSQL FK/lock execution claim.
  const fk = getTableConfig(actionAttempt).foreignKeys.find(key => key.getName() === 'fk_action_attempt_work_item');
  expect(fk?.reference().foreignTable).toBe(workItem);
  expect(fk?.reference().columns.map(column => column.name)).toEqual(['work_item_id']);
  expect(fk?.reference().foreignColumns.map(column => column.name)).toEqual(['work_item_id']);
});

test.each([
  { operationRef: 'AQ-new' }, { attemptNo: 7 }, { triggerRequestId: 'REQ-new' },
  { taskInputHash: 'b'.repeat(64) }, { documentVersionId: 'DV-new' },
  { actorUserId: 'other-actor' }, { status: 'RUNNING' }, { status: 'COMMITTING' },
  { commitStartedAt: NOW }, { projectionApplied: true },
])('rejects changed exact cancellation row %j', async change => {
  const f = fixture(); Object.assign(f.target, change);
  await expect(f.repository.parkCancelledAutoProcessingLease(f.input)).resolves.toBeNull();
  expect(f.db.update).not.toHaveBeenCalled();
});

test.each([
  { revision: 4 }, { sourceFileSha256: 'b'.repeat(64) }, { sourceByteLength: 1025 },
  { requestedByUserId: 'other-actor' }, { documentVersionId: 'DV-new' },
  { analysisModelJson: canonicalJson({ ...MODEL, settingsRevision: 2 }) },
])('rejects fresh WI version/source/model drift %j', async change => {
  const f = fixture(); Object.assign(f.owner, change);
  await expect(f.repository.parkCancelledAutoProcessingLease(f.input)).resolves.toBeNull();
  expect(f.db.update).not.toHaveBeenCalled();
});

test('rejects modified task bytes even when the expected row inputHash remains identical', async () => {
  const f = fixture(); const task = JSON.parse(f.target.taskEnvelopeJson);
  task.modelInput = { fixture: 'different' }; f.target.taskEnvelopeJson = JSON.stringify(task);
  await expect(f.repository.parkCancelledAutoProcessingLease(f.input)).resolves.toBeNull();
  expect(f.db.update).not.toHaveBeenCalled();
});

test.each(['CANCELLED', 'SUCCEEDED', 'FAILED'])('a later arbitrary %s attempt forbids PARK', async status => {
  const f = fixture(); f.attempts.push({ ...f.target, attemptId: 'ATT-later', operationRef: 'AQ-later',
    actionType: 'OPENCLAW_INTERACTIVE_REVIEW', attemptNo: 1, status, createdAt: NOW });
  await expect(f.repository.parkCancelledAutoProcessingLease(f.input)).resolves.toBeNull();
  expect(f.db.update).not.toHaveBeenCalled();
});

test.each(['QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'])('an earlier %s attempt also forbids PARK', async status => {
  const f = fixture(); f.attempts.push({ ...f.target, attemptId: 'ATT-active', operationRef: 'AQ-active',
    actionType: 'OPENCLAW_OVERALL_SYNTHESIS', attemptNo: 1, status, createdAt: new Date(NOW.getTime() - 120000) });
  await expect(f.repository.parkCancelledAutoProcessingLease(f.input)).resolves.toBeNull();
  expect(f.db.update).not.toHaveBeenCalled();
});

test('rereads after the WI lock wait and rejects a newer terminal attempt committed before acquisition', async () => {
  const f = fixture(); let unlock: () => void = () => {};
  const waiting = new Promise<void>(resolve => { unlock = resolve; });
  f.setBeforeLock(async table => { if (table === workItem) await waiting; });
  const pending = f.repository.parkCancelledAutoProcessingLease(f.input);
  expect(f.events).toEqual(['WI_LOCK']); expect(f.db.update).not.toHaveBeenCalled();
  f.attempts.push({ ...f.target, attemptId: 'ATT-during-wait', operationRef: 'AQ-during-wait',
    attemptNo: 7, status: 'CANCELLED', createdAt: NOW }); unlock();
  await expect(pending).resolves.toBeNull(); expect(f.db.update).not.toHaveBeenCalled();
});

test.each([{ leaseToken: 'new-token' }, { leaseGeneration: 11 }, { leaseOwner: 'service:other' }])(
  'rejects an authorization reclaimed after service preflight %j', async change => {
    const f = fixture(); Object.assign(f.grant, change);
    await expect(f.repository.parkCancelledAutoProcessingLease(f.input)).resolves.toBeNull();
    expect(f.db.update).not.toHaveBeenCalled();
  });

test('the final wall-clock CAS may refuse expiry after all preflight checks', async () => {
  const f = fixture(); f.grant.leaseExpiresAt = new Date(NOW.getTime() - 1);
  await expect(f.repository.parkCancelledAutoProcessingLease(f.input)).resolves.toBeNull();
  expect(f.grant.status).toBe('LEASED'); expect(f.sql[3].sql).toContain('clock_timestamp()');
});

test('replayOnly never creates a fresh BLOCK, and only the same exact existing cancellation returns a receipt', async () => {
  const f = fixture(); f.input.replayOnly = true;
  await expect(f.repository.parkCancelledAutoProcessingLease(f.input)).resolves.toBeNull();
  expect(f.db.update).not.toHaveBeenCalled(); f.input.replayOnly = false;
  await f.repository.parkCancelledAutoProcessingLease(f.input); f.input.replayOnly = true;
  const before = canonicalJson(f.grant); f.db.update.mockClear();
  await expect(f.repository.parkCancelledAutoProcessingLease(f.input)).resolves.toMatchObject({ replayed: true });
  expect(f.db.update).not.toHaveBeenCalled(); expect(canonicalJson(f.grant)).toBe(before);
  f.input.expectedCancellation.attemptNo += 1;
  await expect(f.repository.parkCancelledAutoProcessingLease(f.input)).resolves.toBeNull();
});

test('a competing ACK or completed authorization cannot be rewritten as cancelled BLOCK', async () => {
  const f = fixture(); f.grant.status = 'COMPLETED';
  await expect(f.repository.parkCancelledAutoProcessingLease(f.input)).resolves.toBeNull();
  expect(f.db.update).not.toHaveBeenCalled();
});
