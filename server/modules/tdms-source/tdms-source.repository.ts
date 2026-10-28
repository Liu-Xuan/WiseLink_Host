import { Inject, Injectable } from '@nestjs/common';
import { withTdmsReceiverDatabase } from './tdms-receiver-sql-context';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { sql, type SQL } from 'drizzle-orm';
import type {
  TdmsCapture,
  TdmsCataloguePage,
  TdmsDocumentCataloguePage,
  TdmsObservedChildrenPage,
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
import { retainedCaptureIndex } from './tdms-processing-set-source-facts';
/** Existing verified HTTP middleware owns DB actor context; never impersonates a service caller. */
@Injectable()
export class MiaodaTdmsSourceRepository implements TdmsRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}
  transaction<T>(operation: (tx: TdmsTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction((db) =>
      withTdmsReceiverDatabase(db as PostgresJsDatabase, () =>
        operation(new SqlTdmsTransaction(db as PostgresJsDatabase))),
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
  async catalogue(s: TdmsSourceScope, page: TdmsCataloguePage = { limit: 51 }) {
    if (!Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 51)
      throw tdmsError('TDMS_CATALOGUE_LIMIT_INVALID');
    const after: SQL = page.after
      ? sql`AND h.source_revision_ref > ${page.after}`
      : sql``;
    const documentVersion: SQL = page.documentVersionId
      ? sql`AND jsonb_exists(v.data->'record'->'relatedDocumentVersionIds',${page.documentVersionId})`
      : sql``;
    const rows = await this.db.execute<{ data: TdmsStoredRevision }>(
      sql`SELECT v.data FROM tdms_record h JOIN tdms_record_revision v ON v.tenant_id=h.tenant_id AND v.source_revision_ref=h.source_revision_ref WHERE h.tenant_id=${s.tenantId} AND h.source_key=${s.sourceKey} AND h.source_instance_id=${s.sourceInstanceId} AND h.scope_id=${s.scopeId} ${after} ${documentVersion} ${permittedRecords(page)} ORDER BY h.source_revision_ref LIMIT ${page.limit}`,
    );
    return rows.map((r) => r.data);
  }
  async documentVersionCatalogue(s: TdmsSourceScope, page: TdmsDocumentCataloguePage) {
    if (!Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 51)
      throw tdmsError('TDMS_CATALOGUE_LIMIT_INVALID');
    const after: SQL = page.after
      ? sql`WHERE selected.source_revision_ref > ${page.after}`
      : sql``;
    // Select one observation for each stable native record within the exact DV.
    // A current head wins only while it still carries that explicit binding.
    // Otherwise the newest source observation stays readable as history; a
    // late import with older observedAt cannot replace it. The
    // seek is outside DISTINCT ON so another revision cannot reappear on page 2.
    const rows = await this.db.execute<{ data: TdmsStoredRevision }>(sql`
      SELECT jsonb_set(selected.data, '{record,selectedHead}',
        to_jsonb(selected.is_selected_head)) AS data
      FROM (
        SELECT DISTINCT ON (v.record_ref) v.data, v.source_revision_ref,
          coalesce(h.source_revision_ref = v.source_revision_ref, false) AS is_selected_head
        FROM tdms_record_revision v
        LEFT JOIN tdms_record h ON h.tenant_id=v.tenant_id
          AND h.source_key=v.source_key AND h.source_instance_id=v.source_instance_id
          AND h.scope_id=v.scope_id AND h.record_ref=v.record_ref
        WHERE v.tenant_id=${s.tenantId} AND v.source_key=${s.sourceKey}
          AND v.source_instance_id=${s.sourceInstanceId} AND v.scope_id=${s.scopeId}
          AND (jsonb_exists(v.data->'record'->'relatedDocumentVersionIds',${page.documentVersionId})
            OR v.source_revision_ref IN (SELECT jsonb_array_elements_text(${JSON.stringify(page.sourceRevisionRefs ?? [])}::text::jsonb)))
          ${permittedRecords(page)}
        ORDER BY v.record_ref,
          coalesce(h.source_revision_ref = v.source_revision_ref, false) DESC,
          (v.data->'record'->>'observedAt')::timestamptz DESC,
          (v.data->'record'->>'capturedAt')::timestamptz DESC,
          v.source_revision_ref DESC
      ) selected
      ${after}
      ORDER BY selected.source_revision_ref
      LIMIT ${page.limit}
    `);
    return rows.map((row) => row.data);
  }
  async observedCaptureIndex(s: TdmsSourceScope, packageId: string) {
    const rows = await this.db.execute<{ data: unknown }>(sql`
      SELECT ${observedIndexProjection()} AS data FROM tdms_capture c
      WHERE c.tenant_id=${s.tenantId} AND c.source_key=${s.sourceKey}
        AND c.source_instance_id=${s.sourceInstanceId} AND c.scope_id=${s.scopeId}
        AND c.package_id=${packageId} LIMIT 2`);
    if (!rows.length) return null;
    if (rows.length !== 1) throw tdmsError('TDMS_OBSERVED_CAPTURE_INVALID', 409);
    return retainedCaptureIndex(rows[0]!.data);
  }
  async observedChildren(s: TdmsSourceScope, page: TdmsObservedChildrenPage) {
    if (!Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 51)
      throw tdmsError('TDMS_OBSERVED_LIMIT_INVALID');
    const parent = page.parent;
    const after = page.after ? sql`AND c.capture_ref > ${page.after}` : sql``;
    const revision = page.childRevisionRef
      ? sql`AND native->>'sourceRevisionRef'=${page.childRevisionRef}` : sql``;
    if ((parent.originalPackageId === undefined) !== (parent.packageHash === undefined))
      throw tdmsError('TDMS_OBSERVED_PARENT_INVALID');
    const parentPackage = parent.originalPackageId === undefined ? sql`` : sql`
      AND source_record#>>'{rawFields,completeOwnedSource,requestedCriteria,sourceProof,parentPackageId}'=${parent.originalPackageId}
      AND source_record#>>'{rawFields,completeOwnedSource,requestedCriteria,sourceProof,parentPackageSha256}'=${parent.packageHash}`;
    const rows = await this.db.execute<{ data: unknown }>(sql`
      SELECT ${observedIndexProjection()} AS data FROM tdms_capture c
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(c.data#>'{dailyMetadata,envelope,package,records}')='array'
          THEN c.data#>'{dailyMetadata,envelope,package,records}' ELSE '[]'::jsonb END
      ) source_record
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(c.data#>'{dailyMetadata,nativeRetention,records}')='array'
          THEN c.data#>'{dailyMetadata,nativeRetention,records}' ELSE '[]'::jsonb END
      ) native
      WHERE c.tenant_id=${s.tenantId} AND c.source_key=${s.sourceKey}
        AND c.source_instance_id=${s.sourceInstanceId} AND c.scope_id=${s.scopeId}
        AND c.data#>>'{dailyMetadata,applicationScopeId}'=${parent.applicationScopeId}
        AND source_record->>'snapshotId'=native->>'snapshotId'
        AND source_record->>'sourceRecordId'=native->>'sourceRecordId'
        AND source_record->>'kind'=native->>'sourceKind'
        AND source_record#>>'{rawFields,completeOwnedSource,requestedCriteria,sourceProof,kind}'='REQUIRED_RELATION_TARGET'
        ${parentPackage}
        AND source_record#>>'{rawFields,completeOwnedSource,requestedCriteria,sourceProof,parentSnapshotId}'=${parent.snapshotId}
        AND source_record#>>'{rawFields,completeOwnedSource,requestedCriteria,sourceProof,parentSourceRecordId}'=${parent.sourceRecordId}
        AND source_record#>'{rawFields,completeOwnedSource,requestedCriteria,sourceProof,parentSourceVersion}'=${JSON.stringify(parent.sourceVersion)}::text::jsonb
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(${JSON.stringify(page.permittedRecords)}::text::jsonb) member
          WHERE member->>'recordKind'=native->>'nativeKind'
            AND member->>'sourceRecordId'=native->>'sourceRecordId')
        ${after} ${revision}
      ORDER BY c.capture_ref LIMIT ${page.limit}`);
    return rows.map((row) => retainedCaptureIndex(row.data));
  }
  observedAssertion(s: TdmsSourceScope, ref: string) {
    return this.one<TdmsStoredAssertion>(sql`SELECT data FROM tdms_relation_assertion
      WHERE ${scope(s)} AND assertion_ref=${ref}`);
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
function observedIndexProjection(): SQL {
  return sql`jsonb_build_object('scope',c.data->'scope','packageId',c.package_id,
    'packageHash',c.data->'packageHash','captureRef',c.capture_ref,
    'applicationScopeId',c.data#>'{dailyMetadata,applicationScopeId}',
    'records',c.data#>'{dailyMetadata,nativeRetention,records}',
    'relations',c.data#>'{dailyMetadata,nativeRetention,relations}',
    'artifacts',c.data#>'{dailyMetadata,nativeRetention,artifacts}',
    'recordRevisionRefs',c.data#>'{receipt,recordRevisionRefs}',
    'assertionRefs',c.data#>'{receipt,assertionRefs}')`;
}
function scope(s: TdmsSourceScope): SQL {
  return sql`tenant_id=${s.tenantId} AND source_key=${s.sourceKey} AND source_instance_id=${s.sourceInstanceId} AND scope_id=${s.scopeId}`;
}

/** Current Host member scope is applied before DISTINCT/seek/limit and body materialization. */
function permittedRecords(page: TdmsCataloguePage): SQL {
  if (page.permittedRecords === undefined) return sql``;
  return sql`AND EXISTS (SELECT 1 FROM jsonb_array_elements(${JSON.stringify(page.permittedRecords)}::text::jsonb) member
    WHERE member->>'recordKind'=v.data->'record'->>'recordKind'
      AND member->>'sourceRecordId'=v.data->'record'->>'sourceRecordId')`;
}
