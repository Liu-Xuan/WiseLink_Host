import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { sql, type SQL } from 'drizzle-orm';
import type {
  TdmsCapture,
  TdmsRecordHead,
  TdmsRelationHead,
  TdmsRepository,
  TdmsSourceScope,
  TdmsStoredAssertion,
  TdmsStoredReceipt,
  TdmsStoredRevision,
  TdmsTransaction,
} from './tdms-source.types';
import { tdmsError } from './tdms-source.types';
/** Existing verified HTTP middleware owns DB actor context; never impersonates a service caller. */
@Injectable()
export class MiaodaTdmsSourceRepository implements TdmsRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}
  transaction<T>(operation: (tx: TdmsTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction((db) =>
      operation(new SqlTdmsTransaction(db as PostgresJsDatabase)),
    );
  }
}
export class SqlTdmsTransaction implements TdmsTransaction {
  constructor(private readonly db: Pick<PostgresJsDatabase, 'execute'>) {}
  private async one<T>(query: SQL): Promise<T | null> {
    const rows = await this.db.execute<{ data: T }>(query);
    return rows[0]?.data ?? null;
  }
  capture(s: TdmsSourceScope, id: string) {
    return this.one<TdmsCapture>(
      sql`SELECT data FROM tdms_capture WHERE ${scope(s)} AND package_id=${id}`,
    );
  }
  async capturesBySourceRef(s: TdmsSourceScope, sourceRef: string) {
    // Exact JSON array membership; never substring search or a native relation inference.
    const rows = await this.db.execute<{ data: TdmsCapture }>(
      sql`SELECT data FROM tdms_capture WHERE ${scope(s)} AND jsonb_exists(data->'dailyMetadata'->'receipt'->'sourceRefs',${sourceRef}) ORDER BY package_id LIMIT 2`,
    );
    return rows.map((row) => row.data);
  }
  recordHead(s: TdmsSourceScope, kind: string, id: string) {
    return this.one<TdmsRecordHead>(
      sql`SELECT data FROM tdms_record WHERE ${scope(s)} AND record_kind=${kind} AND source_record_id=${id}`,
    );
  }
  revision(tenantId: string, ref: string) {
    return this.one<TdmsStoredRevision>(
      sql`SELECT data FROM tdms_record_revision WHERE tenant_id=${tenantId} AND source_revision_ref=${ref}`,
    );
  }
  async catalogue(s: TdmsSourceScope) {
    const rows = await this.db.execute<{ data: TdmsStoredRevision }>(
      sql`SELECT v.data FROM tdms_record h JOIN tdms_record_revision v ON v.tenant_id=h.tenant_id AND v.source_revision_ref=h.source_revision_ref WHERE h.tenant_id=${s.tenantId} AND h.source_key=${s.sourceKey} AND h.source_instance_id=${s.sourceInstanceId} AND h.scope_id=${s.scopeId} ORDER BY h.source_revision_ref`,
    );
    return rows.map((r) => r.data);
  }
  async history(s: TdmsSourceScope, recordRef: string) {
    const rows = await this.db.execute<{ data: TdmsStoredRevision }>(
      sql`SELECT data FROM tdms_record_revision WHERE ${scope(s)} AND record_ref=${recordRef} ORDER BY source_revision_ref`,
    );
    return rows.map((r) => r.data);
  }
  relationHead(s: TdmsSourceScope, id: string) {
    return this.one<TdmsRelationHead>(
      sql`SELECT data FROM tdms_relation WHERE ${scope(s)} AND source_relation_id=${id}`,
    );
  }
  async relations(tenantId: string, ref: string) {
    const rows = await this.db.execute<{ data: TdmsStoredAssertion }>(
      sql`SELECT data FROM tdms_relation_assertion WHERE tenant_id=${tenantId} AND (from_revision_ref=${ref} OR to_revision_ref=${ref}) ORDER BY assertion_ref`,
    );
    return rows.map((r) => r.data);
  }
  async saveRevision(
    head: TdmsRecordHead,
    expected: string | null,
    revision: TdmsStoredRevision,
  ) {
    const s = head.scope;
    await this.db.execute(
      sql`INSERT INTO tdms_record_revision (tenant_id,source_key,source_instance_id,scope_id,source_revision_ref,record_ref,data) VALUES (${s.tenantId},${s.sourceKey},${s.sourceInstanceId},${s.scopeId},${revision.record.sourceRevisionRef},${head.recordRef},${JSON.stringify(revision)}::jsonb)`,
    );
    let rows;
    if (expected === null)
      rows = await this.db.execute(
        sql`INSERT INTO tdms_record (tenant_id,source_key,source_instance_id,scope_id,record_kind,source_record_id,record_ref,source_revision_ref,data) VALUES (${s.tenantId},${s.sourceKey},${s.sourceInstanceId},${s.scopeId},${head.recordKind},${head.sourceRecordId},${head.recordRef},${head.sourceRevisionRef},${JSON.stringify(head)}::jsonb) ON CONFLICT DO NOTHING RETURNING record_ref`,
      );
    else if (revision.record.selectedHead)
      rows = await this.db.execute(
        sql`UPDATE tdms_record SET source_revision_ref=${head.sourceRevisionRef},data=${JSON.stringify(head)}::jsonb WHERE ${scope(s)} AND record_kind=${head.recordKind} AND source_record_id=${head.sourceRecordId} AND source_revision_ref=${expected} RETURNING record_ref`,
      );
    else
      rows = await this.db.execute(
        sql`SELECT record_ref FROM tdms_record WHERE ${scope(s)} AND record_kind=${head.recordKind} AND source_record_id=${head.sourceRecordId} AND source_revision_ref=${expected} FOR UPDATE`,
      );
    if (rows.length !== 1)
      throw tdmsError('TDMS_RECORD_HEAD_CAS_CONFLICT', 409);
  }
  async saveAssertion(
    head: TdmsRelationHead,
    expected: string | null,
    row: TdmsStoredAssertion,
  ) {
    const s = head.scope,
      a = row.assertion;
    const from =
        a.from.kind === 'NATIVE_RECORD_REVISION'
          ? a.from.sourceRevisionRef
          : null,
      to =
        a.to.kind === 'NATIVE_RECORD_REVISION' ? a.to.sourceRevisionRef : null;
    await this.db.execute(
      sql`INSERT INTO tdms_relation_assertion (tenant_id,source_key,source_instance_id,scope_id,assertion_ref,relation_ref,from_revision_ref,to_revision_ref,data) VALUES (${s.tenantId},${s.sourceKey},${s.sourceInstanceId},${s.scopeId},${a.assertionRef},${a.relationRef},${from},${to},${JSON.stringify(row)}::jsonb)`,
    );
    let rows;
    if (expected === null)
      rows = await this.db.execute(
        sql`INSERT INTO tdms_relation (tenant_id,source_key,source_instance_id,scope_id,source_relation_id,relation_ref,assertion_ref,data) VALUES (${s.tenantId},${s.sourceKey},${s.sourceInstanceId},${s.scopeId},${head.sourceRelationId},${head.relationRef},${head.assertionRef},${JSON.stringify(head)}::jsonb) ON CONFLICT DO NOTHING RETURNING relation_ref`,
      );
    else if (a.selectedHead)
      rows = await this.db.execute(
        sql`UPDATE tdms_relation SET assertion_ref=${head.assertionRef},data=${JSON.stringify(head)}::jsonb WHERE ${scope(s)} AND source_relation_id=${head.sourceRelationId} AND assertion_ref=${expected} RETURNING relation_ref`,
      );
    else
      rows = await this.db.execute(
        sql`SELECT relation_ref FROM tdms_relation WHERE ${scope(s)} AND source_relation_id=${head.sourceRelationId} AND assertion_ref=${expected} FOR UPDATE`,
      );
    if (rows.length !== 1)
      throw tdmsError('TDMS_RELATION_HEAD_CAS_CONFLICT', 409);
  }
  async saveCapture(c: TdmsCapture) {
    const s = c.scope;
    const rows = await this.db.execute(
      sql`INSERT INTO tdms_capture (tenant_id,source_key,source_instance_id,scope_id,package_id,capture_ref,data) VALUES (${s.tenantId},${s.sourceKey},${s.sourceInstanceId},${s.scopeId},${c.packageId},${c.receipt.captureRef},${JSON.stringify(c)}::jsonb) ON CONFLICT DO NOTHING RETURNING capture_ref`,
    );
    if (rows.length !== 1)
      throw tdmsError('TDMS_PACKAGE_IDEMPOTENCY_CONFLICT', 409);
  }
  async saveReceipt(r: TdmsStoredReceipt) {
    const s = r.scope;
    await this.db.execute(
      sql`INSERT INTO tdms_read_receipt (tenant_id,source_key,source_instance_id,scope_id,receipt_ref,source_revision_ref,actor_id,data) VALUES (${s.tenantId},${s.sourceKey},${s.sourceInstanceId},${s.scopeId},${r.receipt.receiptRef},${r.receipt.sourceRevisionRef},${r.actorId},${JSON.stringify(r)}::jsonb)`,
    );
  }
}
function scope(s: TdmsSourceScope): SQL {
  return sql`tenant_id=${s.tenantId} AND source_key=${s.sourceKey} AND source_instance_id=${s.sourceInstanceId} AND scope_id=${s.scopeId}`;
}
