import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';
import { dmDocumentActivityRun } from '../../database/document-activity.schema';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { DocumentActivityDeliveryRange, DocumentActivityRevision, DocumentActivitySelection } from '@shared/document-activity.interface';

export type DocumentActivityScope = { tenantId: string; actorUserId: string; documentVersionId: string };
export type DocumentActivityFence = { runRef: string; leaseOwner: string; leaseToken: string; leaseGeneration: number };
export type DocumentActivityRun = {
  runRef: string;
  requestId: string;
  documentVersionId: string;
  parseRunId: string;
  parseRevision: number;
  semanticRevision: number;
  manifestSha256: string;
  selection: DocumentActivitySelection;
  expectedRevision: number;
  candidateRevision: number | null;
  status: 'QUEUED' | 'RUNNING' | 'SAVED' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
  deadline: string;
  deliveredRanges: DocumentActivityDeliveryRange[];
  result: DocumentActivityRevision | null;
  saveCommand: unknown;
  errorCode: string | null;
};
type Database = Pick<PostgresJsDatabase, 'execute'>;
const columns = sql`run_ref AS "runRef",request_id AS "requestId",document_version_id AS "documentVersionId",
  parse_run_id AS "parseRunId",parse_revision AS "parseRevision",semantic_revision AS "semanticRevision",
  original_manifest_sha256 AS "manifestSha256",selection_json AS selection,expected_revision AS "expectedRevision",
  candidate_revision AS "candidateRevision",status,deadline_at::text AS deadline,delivered_json AS "deliveredRanges",
  result_json AS result,save_command_json AS "saveCommand",error_code AS "errorCode"`;

@Injectable()
// Registered by CanonicalHostModule.forRoot.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentActivityRunRepository {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async readRequest(scope: DocumentActivityScope, requestId: string): Promise<DocumentActivityRun | null> {
    const rows = await this.db.execute<DocumentActivityRun>(sql`SELECT ${columns} FROM ${dmDocumentActivityRun}
      WHERE tenant_id=${scope.tenantId} AND actor_user_id=${scope.actorUserId} AND request_id=${requestId}`);
    return rows[0] ?? null;
  }

  async readRun(scope: DocumentActivityScope, runRef: string): Promise<DocumentActivityRun | null> {
    return readRun(this.db, scope, runRef);
  }

  async nextPending(scope: DocumentActivityScope): Promise<string | null> {
    const rows = await this.db.execute<{ runRef: string }>(sql`SELECT run_ref AS "runRef" FROM ${dmDocumentActivityRun}
      WHERE tenant_id=${scope.tenantId} AND actor_user_id=${scope.actorUserId} AND document_version_id=${scope.documentVersionId}
        AND status IN ('QUEUED','RUNNING')
        AND (lease_expires_at IS NULL OR lease_expires_at<=CURRENT_TIMESTAMP)
      ORDER BY _created_at,run_ref LIMIT 1`);
    return rows[0]?.runRef ?? null;
  }

  /** Published candidates are readable independently of their producer or assessment work. */
  async readSaved(scope: DocumentActivityScope, parseRunId: string, revision?: number): Promise<DocumentActivityRevision | null> {
    const rows = await this.db.execute<{ result: DocumentActivityRevision }>(sql`SELECT result_json AS result FROM ${dmDocumentActivityRun}
      WHERE tenant_id=${scope.tenantId} AND document_version_id=${scope.documentVersionId} AND parse_run_id=${parseRunId}
        AND status='SAVED' ${revision === undefined ? sql`` : sql`AND candidate_revision=${revision}`}
      ORDER BY candidate_revision DESC LIMIT 1`);
    return rows[0]?.result ?? null;
  }

  async begin(scope: DocumentActivityScope, input: {
    requestId: string; parseRunId: string; parseRevision: number; semanticRevision: number;
    manifestSha256: string; selection: DocumentActivitySelection; expectedRevision: number;
  }): Promise<DocumentActivityRun> {
    return this.db.transaction(async tx => {
      await lockSource(tx, scope, input);
      const rows = await tx.execute<DocumentActivityRun>(sql`SELECT ${columns} FROM ${dmDocumentActivityRun}
        WHERE tenant_id=${scope.tenantId} AND actor_user_id=${scope.actorUserId} AND request_id=${input.requestId}`);
      const prior = rows[0];
      if (prior) {
        if (prior.documentVersionId !== scope.documentVersionId || prior.parseRunId !== input.parseRunId ||
          prior.semanticRevision !== input.semanticRevision || prior.expectedRevision !== input.expectedRevision ||
          prior.manifestSha256 !== input.manifestSha256 || !isDeepStrictEqual(prior.selection, input.selection))
          throw new Error('DOCUMENT_ACTIVITY_REQUEST_CONFLICT');
        return prior;
      }
      if (await currentRevision(tx, scope, input.parseRunId) !== input.expectedRevision)
        throw new Error('DOCUMENT_ACTIVITY_REVISION_CONFLICT');
      const inserted = await tx.execute<DocumentActivityRun>(sql`INSERT INTO ${dmDocumentActivityRun}
        (run_ref,tenant_id,actor_user_id,request_id,document_version_id,parse_run_id,parse_revision,
         semantic_revision,original_manifest_sha256,selection_json,expected_revision,status,deadline_at)
        VALUES (${`DAR-${randomUUID()}`},${scope.tenantId},${scope.actorUserId},${input.requestId},${scope.documentVersionId},
          ${input.parseRunId},${input.parseRevision},${input.semanticRevision},${input.manifestSha256},
          ${JSON.stringify(input.selection)}::jsonb,${input.expectedRevision},'QUEUED',CURRENT_TIMESTAMP+interval '1 hour')
        RETURNING ${columns}`);
      if (!inserted[0]) throw new Error('DOCUMENT_ACTIVITY_REQUEST_SAVE_FAILED');
      return inserted[0];
    });
  }

  async expire(scope: DocumentActivityScope, runRef: string): Promise<void> {
    await this.db.execute(sql`UPDATE ${dmDocumentActivityRun} SET status='EXPIRED',error_code='DOCUMENT_ACTIVITY_DEADLINE_EXCEEDED',
      lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,_updated_at=CURRENT_TIMESTAMP
      WHERE ${owned(scope, runRef)} AND status IN ('QUEUED','RUNNING') AND deadline_at<=CURRENT_TIMESTAMP`);
  }

  async claim(scope: DocumentActivityScope, runRef: string, owner: string): Promise<DocumentActivityFence | null> {
    await this.expire(scope, runRef);
    const token = randomUUID();
    const rows = await this.db.execute<{ generation: number }>(sql`UPDATE ${dmDocumentActivityRun}
      SET status='RUNNING',lease_owner=${owner},lease_token=${token}::uuid,lease_generation=lease_generation+1,
        lease_expires_at=LEAST(deadline_at,CURRENT_TIMESTAMP+interval '2 minutes'),_updated_at=CURRENT_TIMESTAMP
      WHERE ${owned(scope, runRef)} AND status IN ('QUEUED','RUNNING') AND deadline_at>CURRENT_TIMESTAMP
        AND (lease_expires_at IS NULL OR lease_expires_at<=CURRENT_TIMESTAMP)
      RETURNING lease_generation AS generation`);
    return rows[0] ? { runRef, leaseOwner: owner, leaseToken: token, leaseGeneration: rows[0].generation } : null;
  }

  async renew(scope: DocumentActivityScope, fence: DocumentActivityFence): Promise<boolean> {
    const rows = await this.db.execute(sql`UPDATE ${dmDocumentActivityRun}
      SET lease_expires_at=LEAST(deadline_at,CURRENT_TIMESTAMP+interval '2 minutes'),_updated_at=CURRENT_TIMESTAMP
      WHERE ${owned(scope, fence.runRef)} AND ${validFence(fence)} RETURNING run_ref`);
    return rows.length === 1;
  }

  async recordDelivery(scope: DocumentActivityScope, fence: DocumentActivityFence, range: DocumentActivityDeliveryRange): Promise<void> {
    await this.db.transaction(async tx => {
      const row = await requireFence(tx, scope, fence);
      const prior = row.deliveredRanges.find(item => item.sectionId === range.sectionId && item.offset === range.offset);
      if (prior && !isDeepStrictEqual(prior, range)) throw new Error('DOCUMENT_ACTIVITY_DELIVERY_CONFLICT');
      if (!prior) {
        const updated = await tx.execute(sql`UPDATE ${dmDocumentActivityRun} SET delivered_json=${JSON.stringify([...row.deliveredRanges, range])}::jsonb,
          _updated_at=CURRENT_TIMESTAMP WHERE ${owned(scope, fence.runRef)} AND ${validFence(fence)} RETURNING run_ref`);
        if (updated.length !== 1) throw new Error('DOCUMENT_ACTIVITY_DELIVERY_NOT_SAVED');
      }
    });
  }

  async save(scope: DocumentActivityScope, fence: DocumentActivityFence,
    command: { candidate: unknown; producer: DocumentActivityRevision['producer'] },
    materialize: (run: DocumentActivityRun, revision: number) => DocumentActivityRevision): Promise<DocumentActivityRevision> {
    return this.db.transaction(async tx => {
      const snapshot = await readRun(tx, scope, fence.runRef);
      if (!snapshot) throw new Error('DOCUMENT_ACTIVITY_RUN_NOT_FOUND');
      await lockSource(tx, scope, snapshot);
      const row = await readRun(tx, scope, fence.runRef, true);
      if (!row) throw new Error('DOCUMENT_ACTIVITY_RUN_NOT_FOUND');
      if (row.status === 'SAVED') {
        if (!isDeepStrictEqual(row.saveCommand, command) || !row.result) throw new Error('DOCUMENT_ACTIVITY_SAVE_REPLAY_CONFLICT');
        return row.result;
      }
      await requireFence(tx, scope, fence);
      if (await currentRevision(tx, scope, row.parseRunId) !== row.expectedRevision)
        throw new Error('DOCUMENT_ACTIVITY_REVISION_CONFLICT');
      const result = materialize(row, row.expectedRevision + 1);
      if (result.runRef !== row.runRef || result.candidateRevision !== row.expectedRevision + 1 ||
        result.sourceBinding.original.documentVersionId !== scope.documentVersionId ||
        result.sourceBinding.original.parseRunId !== row.parseRunId || result.sourceBinding.semanticRevision !== row.semanticRevision)
        throw new Error('DOCUMENT_ACTIVITY_RESULT_BINDING_MISMATCH');
      const updated = await tx.execute(sql`UPDATE ${dmDocumentActivityRun} SET status='SAVED',
        candidate_revision=${result.candidateRevision},result_json=${JSON.stringify(result)}::jsonb,
        save_command_json=${JSON.stringify(command)}::jsonb,producer_json=${JSON.stringify(command.producer)}::jsonb,
        lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,_updated_at=CURRENT_TIMESTAMP
        WHERE ${owned(scope, fence.runRef)} AND ${validFence(fence)} RETURNING run_ref`);
      if (updated.length !== 1) throw new Error('DOCUMENT_ACTIVITY_LEASE_REJECTED');
      return result;
    });
  }

  async cancel(scope: DocumentActivityScope, runRef: string): Promise<void> {
    await this.db.execute(sql`UPDATE ${dmDocumentActivityRun} SET status='CANCELLED',
      lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,_updated_at=CURRENT_TIMESTAMP
      WHERE ${owned(scope, runRef)} AND status IN ('QUEUED','RUNNING')`);
  }

  async fail(scope: DocumentActivityScope, fence: DocumentActivityFence, code: string): Promise<void> {
    if (!/^[A-Z0-9_:-]{1,160}$/u.test(code)) throw new Error('DOCUMENT_ACTIVITY_ERROR_CODE_INVALID');
    const rows = await this.db.execute(sql`UPDATE ${dmDocumentActivityRun} SET status='FAILED',error_code=${code},
      lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,_updated_at=CURRENT_TIMESTAMP
      WHERE ${owned(scope, fence.runRef)} AND ${validFence(fence)} RETURNING run_ref`);
    if (rows.length !== 1) throw new Error('DOCUMENT_ACTIVITY_LEASE_REJECTED');
  }
}

function owned(scope: DocumentActivityScope, runRef: string) {
  return sql`tenant_id=${scope.tenantId} AND actor_user_id=${scope.actorUserId}
    AND document_version_id=${scope.documentVersionId} AND run_ref=${runRef}`;
}
function validFence(fence: DocumentActivityFence) {
  return sql`status='RUNNING' AND deadline_at>CURRENT_TIMESTAMP AND lease_expires_at>CURRENT_TIMESTAMP
    AND lease_owner=${fence.leaseOwner} AND lease_token=${fence.leaseToken}::uuid AND lease_generation=${fence.leaseGeneration}`;
}
async function readRun(db: Database, scope: DocumentActivityScope, runRef: string, lock = false): Promise<DocumentActivityRun | null> {
  const rows = await db.execute<DocumentActivityRun>(sql`SELECT ${columns} FROM ${dmDocumentActivityRun}
    WHERE ${owned(scope, runRef)} ${lock ? sql`FOR UPDATE` : sql``}`);
  return rows[0] ?? null;
}
async function requireFence(db: Database, scope: DocumentActivityScope, fence: DocumentActivityFence): Promise<DocumentActivityRun> {
  const rows = await db.execute<DocumentActivityRun>(sql`SELECT ${columns} FROM ${dmDocumentActivityRun}
    WHERE ${owned(scope, fence.runRef)} AND ${validFence(fence)} FOR UPDATE`);
  if (!rows[0]) throw new Error('DOCUMENT_ACTIVITY_LEASE_REJECTED');
  return rows[0];
}
async function currentRevision(db: Database, scope: DocumentActivityScope, parseRunId: string): Promise<number> {
  const rows = await db.execute<{ revision: number }>(sql`SELECT COALESCE(MAX(candidate_revision),0)::integer AS revision
    FROM ${dmDocumentActivityRun} WHERE tenant_id=${scope.tenantId} AND document_version_id=${scope.documentVersionId}
      AND parse_run_id=${parseRunId} AND status='SAVED'`);
  return rows[0]?.revision ?? 0;
}
async function lockSource(db: Database, scope: DocumentActivityScope,
  source: { parseRunId: string; parseRevision: number; semanticRevision: number; manifestSha256: string }): Promise<void> {
  const versions = await db.execute(sql`SELECT document_version_id FROM dm_document_version
    WHERE document_version_id=${scope.documentVersionId} FOR UPDATE`);
  if (!versions.length) throw new Error('DOCUMENT_VERSION_NOT_FOUND');
  const rows = await db.execute(sql`SELECT p.parse_run_id FROM dm_document_parse_run p
    JOIN dm_document_semantic_revision s ON s.tenant_id=p.tenant_id AND s.document_version_id=p.document_version_id AND s.parse_run_id=p.parse_run_id
    WHERE p.tenant_id=${scope.tenantId} AND p.document_version_id=${scope.documentVersionId} AND p.parse_run_id=${source.parseRunId}
      AND p.parse_revision=${source.parseRevision} AND p.status='PUBLISHED' AND p.manifest_artifact->>'sha256'=${source.manifestSha256}
      AND s.semantic_revision=${source.semanticRevision} AND s.original_manifest_sha256=${source.manifestSha256} FOR SHARE OF p`);
  if (!rows.length) throw new Error('DOCUMENT_ACTIVITY_ORIGINAL_CHANGED');
}
