import { PgDialect } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { SqlTdmsTransaction } from '../../../server/modules/tdms-source/tdms-source.repository';
import { nativeScope } from './tdms-memory-double';
import type { TdmsStoredRevision } from '../../../server/modules/tdms-source/tdms-source.types';

function setup(rows: any[][] = []) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const dialect = new PgDialect();
  const db = {
    execute: jest.fn(async (q) => {
      statements.push(dialect.sqlToQuery(q));
      return rows.shift() ?? [];
    }),
  };
  return {
    tx: new SqlTdmsTransaction(
      db as unknown as Pick<PostgresJsDatabase, 'execute'>,
    ),
    db,
    statements,
  };
}
const head = {
  scope: nativeScope,
  recordRef: 'record',
  sourceRecordId: "x' OR TRUE --",
  recordKind: 'COMMENT' as const,
  sourceRevisionRef: 'revision',
  observedAt: '2026-10-05T10:00:00Z',
};
const stored = {
  scope: nativeScope,
  record: { sourceRevisionRef: 'revision', selectedHead: true },
} as TdmsStoredRevision;
describe('actual SQL repository statement boundaries, no physical PG claim', () => {
  it('all native identity queries bind tenant, instance and scope as parameters', async () => {
    const s = setup();
    await s.tx.capture(nativeScope, "pkg' OR TRUE --");
    await s.tx.recordHead(nativeScope, 'COMMENT', head.sourceRecordId);
    expect(s.statements).toHaveLength(2);
    for (const q of s.statements) {
      expect(q.sql).toContain('tenant_id=');
      expect(q.sql).toContain('source_instance_id=');
      expect(q.sql).toContain('scope_id=');
      expect(q.sql).not.toContain('OR TRUE');
      expect(q.params).toEqual(
        expect.arrayContaining(['tenant-a', 'instance', 'narrow']),
      );
    }
  });
  it('exact revision lookup never falls back to head or newest record', async () => {
    const s = setup();
    await s.tx.revision('tenant-b', 'old-exact');
    expect(s.statements[0]!.sql).toContain('source_revision_ref=');
    expect(s.statements[0]!.sql).not.toContain('ORDER BY');
    expect(s.statements[0]!.params).toEqual(['tenant-b', 'old-exact']);
  });
  it('head update CAS binds expected revision and rejects zero rows', async () => {
    const s = setup([[], []]);
    await expect(
      s.tx.saveRevision(head, 'expected-exact', stored),
    ).rejects.toMatchObject({ code: 'TDMS_RECORD_HEAD_CAS_CONFLICT' });
    const q = s.statements[1]!;
    expect(q.sql).toContain('UPDATE tdms_record');
    expect(q.sql).toContain('source_revision_ref=');
    expect(q.params).toContain('expected-exact');
    expect(q.sql).not.toContain(head.sourceRecordId);
  });
  it('new head conflict is not silently overwritten after revision insert', async () => {
    const s = setup([[], []]);
    await expect(s.tx.saveRevision(head, null, stored)).rejects.toMatchObject({
      code: 'TDMS_RECORD_HEAD_CAS_CONFLICT',
    });
    expect(s.statements[1]!.sql).toContain('ON CONFLICT DO NOTHING');
    expect(s.statements[1]!.sql).not.toContain('DO UPDATE');
  });
  it('late-old observation retains revision and locks exact head without changing it', async () => {
    const s = setup([[], [{}]]);
    await s.tx.saveRevision(head, 'expected-exact', {
      ...stored,
      record: { ...stored.record, selectedHead: false },
    });
    expect(s.statements[0]!.sql).toContain('INSERT INTO tdms_record_revision');
    expect(s.statements[1]!.sql).toContain('FOR UPDATE');
    expect(s.statements[1]!.sql).not.toContain('UPDATE tdms_record SET');
  });
  it('capture insert conflict returns domain error for transaction rollback/retry', async () => {
    const s = setup([[]]);
    await expect(
      s.tx.saveCapture({
        scope: nativeScope,
        packageId: 'p',
        packageHash: 'h',
        actorId: '123',
        receipt: { captureRef: 'capture' } as any,
        query: {} as any,
        capturedAt: '2026-10-05T10:00:00Z',
        permissionRevision: 'policy',
      }),
    ).rejects.toMatchObject({ code: 'TDMS_PACKAGE_IDEMPOTENCY_CONFLICT' });
    expect(s.statements[0]!.sql).toContain('ON CONFLICT DO NOTHING');
  });
});
