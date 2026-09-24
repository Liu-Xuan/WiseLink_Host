import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { DocumentReadingDelivery, DocumentReadingRevision } from '@shared/document-reading.interface';

import { dmDocumentReadingRun } from '../../database/document-reading.schema';

export type DocumentReadingScope = { tenantId: string; actorUserId: string; documentVersionId: string };
export type DocumentReadingFence = { runRef: string; leaseOwner: string; leaseToken: string; leaseGeneration: number };
export type DocumentReadingRetraction = {
  runRef: string; readingRevision: number; requestId: string; reasonCode: string;
  reviewReference: string; retractedAt: string;
};
export type DocumentReadingRun = {
  runRef: string;
  requestId: string;
  documentVersionId: string;
  parseRunId: string;
  parseRevision: number;
  semanticRevision: number;
  manifestSha256: string;
  expectedRevision: number;
  readingRevision: number | null;
  status: 'QUEUED' | 'RUNNING' | 'SAVED' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
  deadline: string;
  deliveredRanges: DocumentReadingDelivery[];
  result: DocumentReadingRevision | null;
  saveCommand: unknown;
  errorCode: string | null;
};
type Database = Pick<PostgresJsDatabase, 'execute'>;
const columns = sql`run_ref AS "runRef",request_id AS "requestId",document_version_id AS "documentVersionId",
  parse_run_id AS "parseRunId",parse_revision AS "parseRevision",semantic_revision AS "semanticRevision",
  original_manifest_sha256 AS "manifestSha256",expected_revision AS "expectedRevision",
  reading_revision AS "readingRevision",status,deadline_at::text AS deadline,delivered_json AS "deliveredRanges",
  result_json AS result,save_command_json AS "saveCommand",error_code AS "errorCode"`;

@Injectable()
// Registered by CanonicalHostModule.forRoot.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentReadingRunRepository {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async readRequest(scope: DocumentReadingScope, requestId: string): Promise<DocumentReadingRun | null> {
    const rows = await this.db.execute<DocumentReadingRun>(sql`SELECT ${columns} FROM ${dmDocumentReadingRun}
      WHERE tenant_id=${scope.tenantId} AND actor_user_id=${scope.actorUserId} AND request_id=${requestId}`);
    return rows[0] ?? null;
  }

  async readRun(scope: DocumentReadingScope, runRef: string): Promise<DocumentReadingRun | null> {
    return readRun(this.db, scope, runRef);
  }

  async nextPending(scope: DocumentReadingScope): Promise<string | null> {
    const rows = await this.db.execute<{ runRef: string }>(sql`SELECT run_ref AS "runRef" FROM ${dmDocumentReadingRun}
      WHERE tenant_id=${scope.tenantId} AND actor_user_id=${scope.actorUserId} AND document_version_id=${scope.documentVersionId}
        AND status IN ('QUEUED','RUNNING')
        AND (lease_expires_at IS NULL OR lease_expires_at<=CURRENT_TIMESTAMP)
      ORDER BY _created_at,run_ref LIMIT 1`);
    return rows[0]?.runRef ?? null;
  }

  /** Published candidates are readable independently of their producer or assessment work. */
  async readSaved(scope: DocumentReadingScope, parseRunId: string, semanticRevision: number, revision?: number): Promise<DocumentReadingRevision | null> {
    return (await this.readSavedState(scope, parseRunId, semanticRevision, revision)).reading;
  }

  async readSavedState(scope: DocumentReadingScope, parseRunId: string, semanticRevision: number, revision?: number): Promise<{
    status: 'AVAILABLE' | 'RETRACTED' | 'NOT_GENERATED'; reading: DocumentReadingRevision | null;
  }> {
    const rows = await this.db.execute<{ result: DocumentReadingRevision; retracted: boolean }>(sql`
      SELECT r.result_json AS result,(x.run_ref IS NOT NULL) AS retracted FROM ${dmDocumentReadingRun} r
      LEFT JOIN dm_document_reading_retraction x ON x.run_ref=r.run_ref AND x.tenant_id=r.tenant_id
      WHERE r.tenant_id=${scope.tenantId} AND r.document_version_id=${scope.documentVersionId}
        AND r.parse_run_id=${parseRunId} AND r.semantic_revision=${semanticRevision} AND r.status='SAVED'
        ${revision === undefined ? sql`` : sql`AND r.reading_revision=${revision}`}
      ORDER BY r.reading_revision DESC LIMIT 1`);
    if (!rows[0]) return { status: 'NOT_GENERATED', reading: null };
    return rows[0].retracted ? { status: 'RETRACTED', reading: null } :
      { status: 'AVAILABLE', reading: rows[0].result };
  }

  async readRetraction(scope: DocumentReadingScope, runRef: string): Promise<DocumentReadingRetraction | null> {
    const rows = await this.db.execute<DocumentReadingRetraction>(sql`SELECT x.run_ref AS "runRef",
      x.reading_revision AS "readingRevision",x.request_id AS "requestId",x.reason_code AS "reasonCode",
      x.review_reference AS "reviewReference",x._created_at::text AS "retractedAt"
      FROM dm_document_reading_retraction x WHERE x.tenant_id=${scope.tenantId}
        AND x.actor_user_id=${scope.actorUserId} AND x.document_version_id=${scope.documentVersionId}
        AND x.run_ref=${runRef}`);
    return rows[0] ?? null;
  }

  async retract(scope: DocumentReadingScope, input: { runRef: string; expectedReadingRevision: number;
    requestId: string; reasonCode: string; reviewReference: string }): Promise<DocumentReadingRetraction> {
    return this.db.transaction(async tx => {
      const prior = await tx.execute<DocumentReadingRetraction>(sql`SELECT run_ref AS "runRef",
        reading_revision AS "readingRevision",request_id AS "requestId",reason_code AS "reasonCode",
        review_reference AS "reviewReference",_created_at::text AS "retractedAt"
        FROM dm_document_reading_retraction WHERE tenant_id=${scope.tenantId}
          AND actor_user_id=${scope.actorUserId} AND request_id=${input.requestId}`);
      if (prior[0]) {
        if (prior[0].runRef !== input.runRef || prior[0].readingRevision !== input.expectedReadingRevision ||
          prior[0].reasonCode !== input.reasonCode || prior[0].reviewReference !== input.reviewReference)
          throw new Error('DOCUMENT_READING_RETRACTION_REQUEST_CONFLICT');
        return prior[0];
      }
      const snapshot = await readRun(tx, scope, input.runRef);
      if (!snapshot) throw new Error('DOCUMENT_READING_RUN_NOT_FOUND');
      await lockSource(tx, scope, snapshot);
      const row = await readRun(tx, scope, input.runRef, true);
      if (!row || row.status !== 'SAVED' || row.readingRevision !== input.expectedReadingRevision)
        throw new Error('DOCUMENT_READING_RETRACTION_TARGET_CONFLICT');
      const existing = await tx.execute<DocumentReadingRetraction>(sql`SELECT run_ref AS "runRef",
        reading_revision AS "readingRevision",request_id AS "requestId",reason_code AS "reasonCode",
        review_reference AS "reviewReference",_created_at::text AS "retractedAt"
        FROM dm_document_reading_retraction WHERE run_ref=${input.runRef}`);
      if (existing[0]) {
        if (existing[0].requestId === input.requestId && existing[0].readingRevision === input.expectedReadingRevision &&
          existing[0].reasonCode === input.reasonCode && existing[0].reviewReference === input.reviewReference)
          return existing[0];
        throw new Error('DOCUMENT_READING_ALREADY_RETRACTED');
      }
      if (await currentRevision(tx, scope, row.parseRunId, row.semanticRevision) !== input.expectedReadingRevision)
        throw new Error('DOCUMENT_READING_RETRACTION_REVISION_CONFLICT');
      const inserted = await tx.execute<DocumentReadingRetraction>(sql`INSERT INTO dm_document_reading_retraction
        (run_ref,tenant_id,actor_user_id,document_version_id,reading_revision,request_id,reason_code,review_reference)
        VALUES (${input.runRef},${scope.tenantId},${scope.actorUserId},${scope.documentVersionId},
          ${input.expectedReadingRevision},${input.requestId},${input.reasonCode},${input.reviewReference})
        RETURNING run_ref AS "runRef",reading_revision AS "readingRevision",request_id AS "requestId",
          reason_code AS "reasonCode",review_reference AS "reviewReference",_created_at::text AS "retractedAt"`);
      if (!inserted[0]) throw new Error('DOCUMENT_READING_RETRACTION_SAVE_FAILED');
      return inserted[0];
    });
  }

  async begin(scope: DocumentReadingScope, input: {
    requestId: string; parseRunId: string; parseRevision: number; semanticRevision: number;
    manifestSha256: string; expectedRevision: number;
  }): Promise<DocumentReadingRun> {
    return this.db.transaction(async tx => {
      await lockSource(tx, scope, input);
      const rows = await tx.execute<DocumentReadingRun>(sql`SELECT ${columns} FROM ${dmDocumentReadingRun}
        WHERE tenant_id=${scope.tenantId} AND actor_user_id=${scope.actorUserId} AND request_id=${input.requestId}`);
      const prior = rows[0];
      if (prior) {
        if (prior.documentVersionId !== scope.documentVersionId || prior.parseRunId !== input.parseRunId ||
          prior.semanticRevision !== input.semanticRevision || prior.expectedRevision !== input.expectedRevision ||
          prior.manifestSha256 !== input.manifestSha256)
          throw new Error('DOCUMENT_READING_REQUEST_CONFLICT');
        return prior;
      }
      if (await currentRevision(tx, scope, input.parseRunId, input.semanticRevision) !== input.expectedRevision)
        throw new Error('DOCUMENT_READING_REVISION_CONFLICT');
      const inserted = await tx.execute<DocumentReadingRun>(sql`INSERT INTO ${dmDocumentReadingRun}
        (run_ref,tenant_id,actor_user_id,request_id,document_version_id,parse_run_id,parse_revision,
         semantic_revision,original_manifest_sha256,expected_revision,status,deadline_at)
        VALUES (${`DRR-${randomUUID()}`},${scope.tenantId},${scope.actorUserId},${input.requestId},${scope.documentVersionId},
          ${input.parseRunId},${input.parseRevision},${input.semanticRevision},${input.manifestSha256},
          ${input.expectedRevision},'QUEUED',CURRENT_TIMESTAMP+interval '1 hour')
        RETURNING ${columns}`);
      if (!inserted[0]) throw new Error('DOCUMENT_READING_REQUEST_SAVE_FAILED');
      return inserted[0];
    });
  }

  /**
   * 获取文档的最新完成解读
   *
   * @param scope - 文档范围
   * @returns 最新完成的解读运行记录，如果没有则返回 null
   */
  async getLatestCompleted(scope: DocumentReadingScope): Promise<{
    parseRunId: string;
    semanticRevision: number;
    readingRevision: number;
    savedReading: DocumentReadingRevision | null;
    retracted: boolean;
  } | null> {
    const rows = await this.db.execute<{
      parseRunId: string;
      semanticRevision: number;
      readingRevision: number;
      result: DocumentReadingRevision;
      retracted: boolean;
    }>(sql`SELECT r.parse_run_id AS "parseRunId",r.semantic_revision AS "semanticRevision",
      r.reading_revision AS "readingRevision",r.result_json AS result,
      (x.run_ref IS NOT NULL) AS retracted
    FROM ${dmDocumentReadingRun} r
    LEFT JOIN dm_document_reading_retraction x ON x.run_ref=r.run_ref AND x.tenant_id=r.tenant_id
    WHERE r.tenant_id=${scope.tenantId} AND r.document_version_id=${scope.documentVersionId}
      AND r.status='SAVED' AND r.result_json IS NOT NULL
    ORDER BY r._created_at DESC,r.reading_revision DESC
    LIMIT 1`);

    if (!rows[0]) return null;

    return {
      parseRunId: rows[0].parseRunId,
      semanticRevision: rows[0].semanticRevision,
      readingRevision: rows[0].readingRevision,
      savedReading: rows[0].result,
      retracted: rows[0].retracted,
    };
  }

  async expire(scope: DocumentReadingScope, runRef: string): Promise<void> {
    await this.db.execute(sql`UPDATE ${dmDocumentReadingRun} SET status='EXPIRED',error_code='DOCUMENT_READING_DEADLINE_EXCEEDED',
      lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,_updated_at=CURRENT_TIMESTAMP
      WHERE ${owned(scope, runRef)} AND status IN ('QUEUED','RUNNING') AND deadline_at<=CURRENT_TIMESTAMP`);
  }

  async claim(scope: DocumentReadingScope, runRef: string, owner: string): Promise<DocumentReadingFence | null> {
    await this.expire(scope, runRef);
    const token = randomUUID();
    const rows = await this.db.execute<{ generation: number }>(sql`UPDATE ${dmDocumentReadingRun}
      SET status='RUNNING',lease_owner=${owner},lease_token=${token}::uuid,lease_generation=lease_generation+1,
        lease_expires_at=LEAST(deadline_at,CURRENT_TIMESTAMP+interval '2 minutes'),_updated_at=CURRENT_TIMESTAMP
      WHERE ${owned(scope, runRef)} AND status IN ('QUEUED','RUNNING') AND deadline_at>CURRENT_TIMESTAMP
        AND (lease_expires_at IS NULL OR lease_expires_at<=CURRENT_TIMESTAMP)
      RETURNING lease_generation AS generation`);
    return rows[0] ? { runRef, leaseOwner: owner, leaseToken: token, leaseGeneration: rows[0].generation } : null;
  }

  async renew(scope: DocumentReadingScope, fence: DocumentReadingFence): Promise<boolean> {
    const rows = await this.db.execute(sql`UPDATE ${dmDocumentReadingRun}
      SET lease_expires_at=LEAST(deadline_at,CURRENT_TIMESTAMP+interval '2 minutes'),_updated_at=CURRENT_TIMESTAMP
      WHERE ${owned(scope, fence.runRef)} AND ${validFence(fence)} RETURNING run_ref`);
    return rows.length === 1;
  }

  async recordDelivery(scope: DocumentReadingScope, fence: DocumentReadingFence, range: DocumentReadingDelivery): Promise<void> {
    await this.db.transaction(async tx => {
      const row = await requireFence(tx, scope, fence);
      const prior = row.deliveredRanges.find(item => item.offset === range.offset);
      if (prior && !isDeepStrictEqual(prior, range)) throw new Error('DOCUMENT_READING_DELIVERY_CONFLICT');
      if (!prior) {
        const updated = await tx.execute(sql`UPDATE ${dmDocumentReadingRun} SET delivered_json=${JSON.stringify([...row.deliveredRanges, range])}::jsonb,
          _updated_at=CURRENT_TIMESTAMP WHERE ${owned(scope, fence.runRef)} AND ${validFence(fence)} RETURNING run_ref`);
        if (updated.length !== 1) throw new Error('DOCUMENT_READING_DELIVERY_NOT_SAVED');
      }
    });
  }

  async save(scope: DocumentReadingScope, fence: DocumentReadingFence,
    command: { candidate: unknown; producer: DocumentReadingRevision['producer'] },
    materialize: (run: DocumentReadingRun, revision: number) => DocumentReadingRevision): Promise<DocumentReadingRevision> {
    return this.db.transaction(async tx => {
      const snapshot = await readRun(tx, scope, fence.runRef);
      if (!snapshot) throw new Error('DOCUMENT_READING_RUN_NOT_FOUND');
      await lockSource(tx, scope, snapshot);
      const row = await readRun(tx, scope, fence.runRef, true);
      if (!row) throw new Error('DOCUMENT_READING_RUN_NOT_FOUND');
      if (row.status === 'SAVED') {
        const withdrawn = await tx.execute(sql`SELECT run_ref FROM dm_document_reading_retraction
          WHERE run_ref=${row.runRef}`);
        if (withdrawn.length) throw new Error('DOCUMENT_READING_RETRACTED');
        if (!isDeepStrictEqual(row.saveCommand, command) || !row.result) throw new Error('DOCUMENT_READING_SAVE_REPLAY_CONFLICT');
        return row.result;
      }
      await requireFence(tx, scope, fence);
      if (await currentRevision(tx, scope, row.parseRunId, row.semanticRevision) !== row.expectedRevision)
        throw new Error('DOCUMENT_READING_REVISION_CONFLICT');
      const result = materialize(row, row.expectedRevision + 1);
      if (result.readingRunRef !== row.runRef || result.readingRevision !== row.expectedRevision + 1 ||
        result.sourceBinding.original.documentVersionId !== scope.documentVersionId ||
        result.sourceBinding.original.parseRunId !== row.parseRunId || result.sourceBinding.semanticRevision !== row.semanticRevision)
        throw new Error('DOCUMENT_READING_RESULT_BINDING_MISMATCH');
      const updated = await tx.execute(sql`UPDATE ${dmDocumentReadingRun} SET status='SAVED',
        reading_revision=${result.readingRevision},result_json=${JSON.stringify(result)}::jsonb,
        save_command_json=${JSON.stringify(command)}::jsonb,producer_json=${JSON.stringify(command.producer)}::jsonb,
        lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,_updated_at=CURRENT_TIMESTAMP
        WHERE ${owned(scope, fence.runRef)} AND ${validFence(fence)} RETURNING run_ref`);
      if (updated.length !== 1) throw new Error('DOCUMENT_READING_LEASE_REJECTED');
      return result;
    });
  }

  async cancel(scope: DocumentReadingScope, runRef: string): Promise<void> {
    await this.db.execute(sql`UPDATE ${dmDocumentReadingRun} SET status='CANCELLED',
      lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,_updated_at=CURRENT_TIMESTAMP
      WHERE ${owned(scope, runRef)} AND status IN ('QUEUED','RUNNING')`);
  }

  async fail(scope: DocumentReadingScope, fence: DocumentReadingFence, code: string): Promise<void> {
    if (!/^[A-Z0-9_:-]{1,160}$/u.test(code)) throw new Error('DOCUMENT_READING_ERROR_CODE_INVALID');
    const rows = await this.db.execute(sql`UPDATE ${dmDocumentReadingRun} SET status='FAILED',error_code=${code},
      lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,_updated_at=CURRENT_TIMESTAMP
      WHERE ${owned(scope, fence.runRef)} AND ${validFence(fence)} RETURNING run_ref`);
    if (rows.length !== 1) throw new Error('DOCUMENT_READING_LEASE_REJECTED');
  }
}

function owned(scope: DocumentReadingScope, runRef: string) {
  return sql`tenant_id=${scope.tenantId} AND actor_user_id=${scope.actorUserId}
    AND document_version_id=${scope.documentVersionId} AND run_ref=${runRef}`;
}
function validFence(fence: DocumentReadingFence) {
  return sql`status='RUNNING' AND deadline_at>CURRENT_TIMESTAMP AND lease_expires_at>CURRENT_TIMESTAMP
    AND lease_owner=${fence.leaseOwner} AND lease_token=${fence.leaseToken}::uuid AND lease_generation=${fence.leaseGeneration}`;
}
async function readRun(db: Database, scope: DocumentReadingScope, runRef: string, lock = false): Promise<DocumentReadingRun | null> {
  const rows = await db.execute<DocumentReadingRun>(sql`SELECT ${columns} FROM ${dmDocumentReadingRun}
    WHERE ${owned(scope, runRef)} ${lock ? sql`FOR UPDATE` : sql``}`);
  return rows[0] ?? null;
}
async function requireFence(db: Database, scope: DocumentReadingScope, fence: DocumentReadingFence): Promise<DocumentReadingRun> {
  const rows = await db.execute<DocumentReadingRun>(sql`SELECT ${columns} FROM ${dmDocumentReadingRun}
    WHERE ${owned(scope, fence.runRef)} AND ${validFence(fence)} FOR UPDATE`);
  if (!rows[0]) throw new Error('DOCUMENT_READING_LEASE_REJECTED');
  return rows[0];
}
async function currentRevision(db: Database, scope: DocumentReadingScope, parseRunId: string, semanticRevision: number): Promise<number> {
  const rows = await db.execute<{ revision: number }>(sql`SELECT COALESCE(MAX(reading_revision),0)::integer AS revision
    FROM ${dmDocumentReadingRun} WHERE tenant_id=${scope.tenantId} AND document_version_id=${scope.documentVersionId}
      AND parse_run_id=${parseRunId} AND semantic_revision=${semanticRevision} AND status='SAVED'`);
  return rows[0]?.revision ?? 0;
}
async function lockSource(db: Database, scope: DocumentReadingScope,
  source: { parseRunId: string; parseRevision: number; semanticRevision: number; manifestSha256: string }): Promise<void> {
  const versions = await db.execute(sql`SELECT document_version_id FROM dm_document_version
    WHERE document_version_id=${scope.documentVersionId} FOR UPDATE`);
  if (!versions.length) throw new Error('DOCUMENT_VERSION_NOT_FOUND');
  const rows = await db.execute(sql`SELECT p.parse_run_id FROM dm_document_parse_run p
    JOIN dm_document_semantic_revision s ON s.tenant_id=p.tenant_id AND s.document_version_id=p.document_version_id AND s.parse_run_id=p.parse_run_id
    WHERE p.tenant_id=${scope.tenantId} AND p.document_version_id=${scope.documentVersionId} AND p.parse_run_id=${source.parseRunId}
      AND p.parse_revision=${source.parseRevision} AND p.status='PUBLISHED' AND p.manifest_artifact->>'sha256'=${source.manifestSha256}
      AND s.semantic_revision=${source.semanticRevision} AND s.original_manifest_sha256=${source.manifestSha256} FOR SHARE OF p`);
  if (!rows.length) throw new Error('DOCUMENT_READING_ORIGINAL_CHANGED');
}
