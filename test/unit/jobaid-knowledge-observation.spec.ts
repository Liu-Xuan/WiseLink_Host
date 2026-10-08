import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { JobAidWorkRepository } from '../../server/modules/canonical-host/jobaid-work.repository';

function harness() {
  const row = { attemptId: 'attempt', tenantId: 'tenant', workItemId: 'WI', taskInputHash: 'hash', baseRevision: 2,
    status: 'RUNNING', leaseOwner: 'executor', leaseToken: 'token', leaseGeneration: 2,
    leaseExpiresAt: new Date(Date.now() + 60_000), deadlineAt: new Date(Date.now() + 120_000), cancelRequestedAt: null };
  const locked = jest.fn().mockResolvedValue([row]);
  const where = jest.fn((_condition: SQL) => ({ for: locked }));
  const updateWhere = jest.fn().mockResolvedValue(undefined);
  const set = jest.fn((_values: { reviewActivityJson: SQL }) => ({ where: updateWhere }));
  const update = jest.fn(() => ({ set }));
  const database = { select: () => ({ from: () => ({ where }) }), update };
  const withActorTransaction = jest.fn(async (_actor: string, operation: (context: unknown) => Promise<void>) => operation({ database }));
  const repository = new JobAidWorkRepository({} as never, { withActorTransaction } as never, {} as never);
  const lockSources = jest.fn().mockResolvedValue({ revision: 2 });
  Object.assign(repository, { lockSources });
  const input = { row: row as never, actorUserId: 'owner', sourceBindings: [],
    fence: { principalId: 'executor', leaseToken: 'token', leaseGeneration: 2 } };
  return { repository, row, input, database, withActorTransaction, lockSources, locked, where, update, set };
}

it('persists only observed knowledge status/time in the original fenced attempt activity', async () => {
  const h = harness();
  await h.repository.recordKnowledgeObservation({ ...h.input, status: 'RUNNING' });
  expect(h.withActorTransaction).toHaveBeenCalledWith('owner', expect.any(Function));
  expect(h.lockSources).toHaveBeenCalledWith(h.database, h.row, 'owner', []);
  expect(h.locked).toHaveBeenCalledWith('update');
  const dialect = new PgDialect();
  expect(dialect.sqlToQuery(h.where.mock.calls[0][0]).params).toEqual(['attempt', 'tenant', 'WI']);
  const params = dialect.sqlToQuery(h.set.mock.calls[0][0].reviewActivityJson).params;
  const [event] = JSON.parse(String(params[0]));
  expect(Object.keys(event).sort()).toEqual(['kind', 'observedAt', 'status']);
  expect(event.kind).toBe('ASSESSMENT_KNOWLEDGE_OBSERVED');
  expect(event.status).toBe('RUNNING');
  expect(Number.isFinite(Date.parse(event.observedAt))).toBe(true);
});

it.each(['source', 'binding', 'lease', 'cancel'])('rejects a changed %s before appending an observation', async mode => {
  const h = harness();
  if (mode === 'source') h.lockSources.mockRejectedValue(new Error('SOURCE_CHANGED'));
  else h.locked.mockResolvedValue([{ ...h.row,
    ...(mode === 'binding' ? { taskInputHash: 'other' } : {}),
    ...(mode === 'lease' ? { leaseGeneration: 3 } : {}),
    ...(mode === 'cancel' ? { cancelRequestedAt: new Date() } : {}),
  }]);
  await expect(h.repository.recordKnowledgeObservation({ ...h.input, status: 'COMPLETED' })).rejects.toThrow();
  expect(h.update).not.toHaveBeenCalled();
});

it('keeps existing source-read evidence identity through the shared fence', async () => {
  const h = harness();
  await h.repository.recordSourceRead({ ...h.input, sourceRefs: ['source-one'], purpose: 'authorized-read' });
  const [event] = JSON.parse(String(new PgDialect().sqlToQuery(h.set.mock.calls[0][0].reviewActivityJson).params[0]));
  expect(event).toEqual({ kind: 'ASSESSMENT_SOURCES_READ', sourceRefs: ['source-one'], purpose: 'authorized-read', observedAt: expect.any(String) });
});

import { tdmsNativeEvidenceFixture } from './fixtures/tdms-native-evidence.fixture';
it('native read journal requires a live callback and keeps first body once with every fresh receipt',async()=>{
  const h=harness();Object.assign(h.row,{operationRef:'task-1',reviewActivityJson:'[]'});
  const evidence=tdmsNativeEvidenceFixture();
  const read={...h.input,sourceRefs:[evidence.evidenceRef],purpose:'native',nativeEvidence:[evidence]};
  await expect(h.repository.recordSourceRead(read)).rejects.toThrow('TDMS_NATIVE_EVIDENCE_VERIFIER_UNAVAILABLE');
  expect(h.update).not.toHaveBeenCalled();
  const guard=jest.fn(async()=>undefined);
  await h.repository.recordSourceRead({...read,assertNativeAuthorized:guard});
  const first=JSON.parse(String(new PgDialect().sqlToQuery(h.set.mock.calls[0][0].reviewActivityJson).params[0]))[0];
  expect(first.nativeEvidence).toEqual([evidence]);expect(first.nativeReadReceipts).toEqual([evidence.nativeReadReceipt]);
  Object.assign(h.row,{reviewActivityJson:JSON.stringify([first])});
  const second=structuredClone(evidence);second.nativeReadReceipt.receiptRef='another-fresh-read';
  await h.repository.recordSourceRead({...read,nativeEvidence:[second],assertNativeAuthorized:guard});
  const next=JSON.parse(String(new PgDialect().sqlToQuery(h.set.mock.calls[1][0].reviewActivityJson).params[0]))[0];
  expect(next.nativeEvidence).toEqual([]);expect(next.nativeReadReceipts).toEqual([second.nativeReadReceipt]);expect(guard).toHaveBeenCalledTimes(6);
});
it('revocation while the attempt lock is awaited prevents journal update',async()=>{
  const h=harness();Object.assign(h.row,{operationRef:'task-1',reviewActivityJson:'[]'});
  const evidence=tdmsNativeEvidenceFixture();let calls=0;
  const guard=jest.fn(async()=>{if(++calls>1)throw new Error('NATIVE_REVOKED');});
  await expect(h.repository.recordSourceRead({...h.input,sourceRefs:[evidence.evidenceRef],purpose:'native',nativeEvidence:[evidence],assertNativeAuthorized:guard})).rejects.toThrow('NATIVE_REVOKED');
  expect(h.update).not.toHaveBeenCalled();
});
