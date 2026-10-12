import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';
import { dmDocumentActivityRun } from '../../database/document-activity.schema';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA, DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2, type AnyDocumentActivityRevision, type DocumentActivityCandidateSchemaVersion, type DocumentActivityProductionContract, type DocumentActivityDeliveryRange, type DocumentActivitySelection, type DocumentActivitySourceBinding } from '@shared/document-activity.interface';

import type { DocumentOriginalBinding } from '@shared/document-original.interface';
import type { CanonicalExecutionModelSelection } from '@shared/api.interface';
import { parseExecutionModel } from '../model-settings/canonical-execution-model';

export type DocumentActivityScope = { tenantId: string; actorUserId: string; documentVersionId: string };
export type DocumentActivityFence = { runRef: string; leaseOwner: string; leaseToken: string; leaseGeneration: number };
export type DocumentActivitySavedReference = Pick<AnyDocumentActivityRevision, 'runRef' | 'candidateRevision'>;
export type DocumentActivityRun = {
  runRef: string;
  requestId: string;
  documentVersionId: string;
  parseRunId: string;
  parseRevision: number;
  semanticRevision: number;
  manifestSha256: string;
  candidateSchemaVersion?: DocumentActivityCandidateSchemaVersion;
  productionContract?: DocumentActivityProductionContract | null;
  /** Host control snapshot, distinct from the actual producer modelVersion. */
  executionModel?: CanonicalExecutionModelSelection | null;
  selection: DocumentActivitySelection;
  expectedRevision: number;
  candidateRevision: number | null;
  status: 'QUEUED' | 'RUNNING' | 'SAVED' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
  deadline: string;
  deliveredRanges: DocumentActivityDeliveryRange[];
  result: AnyDocumentActivityRevision | null;
  saveCommand: unknown;
  errorCode: string | null;
};
type Database = Pick<PostgresJsDatabase, 'execute'>;
const columns = sql`run_ref AS "runRef",request_id AS "requestId",document_version_id AS "documentVersionId",
  parse_run_id AS "parseRunId",parse_revision AS "parseRevision",semantic_revision AS "semanticRevision",
  original_manifest_sha256 AS "manifestSha256",selection_json AS selection,expected_revision AS "expectedRevision",
  candidate_revision AS "candidateRevision",status,deadline_at::text AS deadline,delivered_json AS "deliveredRanges",
  candidate_schema_version AS "candidateSchemaVersion",production_contract_json AS "productionContract",
  producer_json->'executionModel' AS "executionModel",
  result_json AS result,save_command_json AS "saveCommand",error_code AS "errorCode"`;

type SavedDocumentActivityRow = Pick<DocumentActivityRun,
  'runRef' | 'documentVersionId' | 'parseRunId' | 'parseRevision' | 'semanticRevision' | 'candidateRevision' | 'status' | 'result' | 'candidateSchemaVersion'>;
const savedColumns = sql`a.run_ref AS "runRef",a.document_version_id AS "documentVersionId",
  a.parse_run_id AS "parseRunId",a.parse_revision AS "parseRevision",a.semantic_revision AS "semanticRevision",
  a.candidate_revision AS "candidateRevision",a.status,a.candidate_schema_version AS "candidateSchemaVersion",a.result_json AS result`;

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
  async readSaved(scope: DocumentActivityScope, parseRunId: string, revision?: number): Promise<AnyDocumentActivityRevision | null> {
    const rows = await this.db.execute<{ result: AnyDocumentActivityRevision }>(sql`SELECT result_json AS result FROM ${dmDocumentActivityRun}
      WHERE tenant_id=${scope.tenantId} AND document_version_id=${scope.documentVersionId} AND parse_run_id=${parseRunId}
        AND status='SAVED' ${revision === undefined ? sql`` : sql`AND candidate_revision=${revision}`}
      ORDER BY candidate_revision DESC LIMIT 1`);
    return rows[0]?.result ?? null;
  }

  /** Fresh source authorization and the real reader's SQL actor context are supplied by the caller.
   * Saved candidates do not require producer ownership. No production, hydration or writes occur here. */
  async readSavedByReference(scope: DocumentActivityScope, reference: DocumentActivitySavedReference,
    expectedBinding: DocumentActivitySourceBinding, database: Database = this.db): Promise<AnyDocumentActivityRevision | null> {
    if (!reference || typeof reference.runRef !== 'string' || !reference.runRef ||
      !Number.isSafeInteger(reference.candidateRevision) || reference.candidateRevision < 1 ||
      !validSavedBinding(scope, expectedBinding.original, expectedBinding.semanticRevision)) return null;
    const rows = await database.execute<SavedDocumentActivityRow>(sql`SELECT ${savedColumns}
      ${savedSource(scope, expectedBinding.original, expectedBinding.semanticRevision)}
      AND a.run_ref=${reference.runRef} AND a.candidate_revision=${reference.candidateRevision}
      LIMIT 1`);
    return checkedSavedResult(rows[0], scope, expectedBinding, reference);
  }

  /** Catalogue selection only. Pin the returned runRef/candidateRevision for all later reads.
   * Revisions are ordered only within this exact original binding and semantic revision. */
  async readLatestSavedForBinding(scope: DocumentActivityScope, originalBinding: DocumentOriginalBinding,
    semanticRevision: number): Promise<AnyDocumentActivityRevision | null> {
    if (!validSavedBinding(scope, originalBinding, semanticRevision)) return null;
    const rows = await this.db.execute<SavedDocumentActivityRow>(sql`SELECT ${savedColumns}
      ${savedSource(scope, originalBinding, semanticRevision)}
      ORDER BY a.candidate_revision DESC LIMIT 1`);
    return checkedSavedResult(rows[0], scope, { original: originalBinding, semanticRevision });
  }

  async begin(scope: DocumentActivityScope, input: {
    requestId: string; parseRunId: string; parseRevision: number; semanticRevision: number;
    manifestSha256: string; selection: DocumentActivitySelection; expectedRevision: number;
    candidateSchemaVersion?: DocumentActivityCandidateSchemaVersion; productionContract?: DocumentActivityProductionContract | null;
    executionModel?: CanonicalExecutionModelSelection;
  }): Promise<DocumentActivityRun> {
    const candidateSchemaVersion = input.candidateSchemaVersion ?? DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA;
    const productionContract = input.productionContract ?? null;
    if (![DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA,DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2].includes(candidateSchemaVersion) ||
      (candidateSchemaVersion === DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2 && !productionContract))
      throw new Error('DOCUMENT_ACTIVITY_PRODUCTION_CONTRACT_REQUIRED');
    return this.db.transaction(async tx => {
      await lockSource(tx, scope, input);
      const rows = await tx.execute<DocumentActivityRun>(sql`SELECT ${columns} FROM ${dmDocumentActivityRun}
        WHERE tenant_id=${scope.tenantId} AND actor_user_id=${scope.actorUserId} AND request_id=${input.requestId}`);
      const prior = rows[0];
      if (prior) {
        if (prior.documentVersionId !== scope.documentVersionId || prior.parseRunId !== input.parseRunId ||
          prior.semanticRevision !== input.semanticRevision || prior.expectedRevision !== input.expectedRevision ||
          prior.manifestSha256 !== input.manifestSha256 || prior.parseRevision !== input.parseRevision ||
          (prior.candidateSchemaVersion ?? DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA) !== candidateSchemaVersion ||
          !isDeepStrictEqual(prior.productionContract ?? null, productionContract) || !isDeepStrictEqual(prior.selection, input.selection))
          throw new Error('DOCUMENT_ACTIVITY_REQUEST_CONFLICT');
        return prior;
      }
      if (await currentRevision(tx, scope, input.parseRunId) !== input.expectedRevision)
        throw new Error('DOCUMENT_ACTIVITY_REVISION_CONFLICT');
      if (!input.executionModel) throw new Error('DOCUMENT_ACTIVITY_EXECUTION_MODEL_REQUIRED');
      const executionModel = parseExecutionModel(input.executionModel);
      const inserted = await tx.execute<DocumentActivityRun>(sql`INSERT INTO ${dmDocumentActivityRun}
        (run_ref,tenant_id,actor_user_id,request_id,document_version_id,parse_run_id,parse_revision,
         semantic_revision,original_manifest_sha256,selection_json,expected_revision,candidate_schema_version,production_contract_json,status,deadline_at,producer_json)
        VALUES (${`DAR-${randomUUID()}`},${scope.tenantId},${scope.actorUserId},${input.requestId},${scope.documentVersionId},
          ${input.parseRunId},${input.parseRevision},${input.semanticRevision},${input.manifestSha256},
          ${JSON.stringify(input.selection)}::jsonb,${input.expectedRevision},${candidateSchemaVersion},${productionContract === null ? null : JSON.stringify(productionContract)}::jsonb,'QUEUED',CURRENT_TIMESTAMP+interval '1 hour',
          ${JSON.stringify({ executionModel })}::jsonb)
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
    command: { candidate: unknown; producer: Pick<AnyDocumentActivityRevision['producer'], 'skillVersion' | 'modelVersion'> },
    materialize: (run: DocumentActivityRun, revision: number) => AnyDocumentActivityRevision): Promise<AnyDocumentActivityRevision> {
    return this.db.transaction(async tx => {
      const snapshot = await readRun(tx, scope, fence.runRef);
      if (!snapshot) throw new Error('DOCUMENT_ACTIVITY_RUN_NOT_FOUND');
      await lockSource(tx, scope, snapshot);
      const row = await readRun(tx, scope, fence.runRef, true);
      if (!row) throw new Error('DOCUMENT_ACTIVITY_RUN_NOT_FOUND');
      if (!isDeepStrictEqual(snapshot.executionModel, row.executionModel))
        throw new Error('DOCUMENT_ACTIVITY_EXECUTION_MODEL_BINDING_MISMATCH');
      if (row.status === 'SAVED') {
        if (!isDeepStrictEqual(row.saveCommand, command) || !row.result) throw new Error('DOCUMENT_ACTIVITY_SAVE_REPLAY_CONFLICT');
        if (row.result.schemaVersion !== (row.candidateSchemaVersion ?? DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA))
          throw new Error('DOCUMENT_ACTIVITY_RUN_SCHEMA_MISMATCH');
        return row.result;
      }
      if ((command.candidate as { schemaVersion?: unknown })?.schemaVersion !== (row.candidateSchemaVersion ?? DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA))
        throw new Error('DOCUMENT_ACTIVITY_RUN_SCHEMA_MISMATCH');
      await requireFence(tx, scope, fence);
      if (await currentRevision(tx, scope, row.parseRunId) !== row.expectedRevision)
        throw new Error('DOCUMENT_ACTIVITY_REVISION_CONFLICT');
      const result = materialize(row, row.expectedRevision + 1);
      const actualProducer = { skillVersion: command.producer.skillVersion, modelVersion: command.producer.modelVersion };
      const expectedProducer = { ...actualProducer,
        ...(row.executionModel != null ? { executionModel: parseExecutionModel(row.executionModel) } : {}) };
      if (!isDeepStrictEqual(command.producer, actualProducer) || !isDeepStrictEqual(result.producer, expectedProducer))
        throw new Error('DOCUMENT_ACTIVITY_RESULT_PRODUCER_MISMATCH');
      if (result.schemaVersion !== (row.candidateSchemaVersion ?? DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA) || result.runRef !== row.runRef || result.candidateRevision !== row.expectedRevision + 1 ||
        result.sourceBinding.original.documentVersionId !== scope.documentVersionId ||
        result.sourceBinding.original.parseRunId !== row.parseRunId || result.sourceBinding.semanticRevision !== row.semanticRevision)
        throw new Error('DOCUMENT_ACTIVITY_RESULT_BINDING_MISMATCH');
      const updated = await tx.execute(sql`UPDATE ${dmDocumentActivityRun} SET status='SAVED',
        candidate_revision=${result.candidateRevision},result_json=${JSON.stringify(result)}::jsonb,
        save_command_json=${JSON.stringify(command)}::jsonb,producer_json=COALESCE(producer_json,'{}'::jsonb)||${JSON.stringify(command.producer)}::jsonb,
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

function validSavedBinding(scope: DocumentActivityScope, original: DocumentOriginalBinding, semanticRevision: number): boolean {
  return !!original && original.documentVersionId === scope.documentVersionId &&
    typeof original.parseRunId === 'string' && original.parseRunId.length > 0 &&
    Number.isSafeInteger(original.parseRevision) && original.parseRevision > 0 &&
    typeof original.sourceArtifactId === 'string' && original.sourceArtifactId.length > 0 &&
    typeof original.sourceSha256 === 'string' && original.sourceSha256.length > 0 &&
    Number.isSafeInteger(original.sourceByteLength) && original.sourceByteLength >= 0 &&
    Number.isSafeInteger(semanticRevision) && semanticRevision > 0;
}

/** All joins retain ordinary source RLS. Explicit identities also prevent a caller scope
 * from being used under another SQL actor. This never changes the SQL identity or role. */
function savedSource(scope: DocumentActivityScope, original: DocumentOriginalBinding, semanticRevision: number) {
  return sql`FROM ${dmDocumentActivityRun} a
    JOIN dm_document_parse_run p ON p.tenant_id=a.tenant_id AND p.document_version_id=a.document_version_id
      AND p.parse_run_id=a.parse_run_id AND p.parse_revision=a.parse_revision
      AND p.manifest_artifact->>'sha256'=a.original_manifest_sha256
    JOIN dm_document_semantic_revision s ON s.tenant_id=a.tenant_id AND s.document_version_id=a.document_version_id
      AND s.parse_run_id=a.parse_run_id AND s.parse_revision=a.parse_revision
      AND s.semantic_revision=a.semantic_revision AND s.original_manifest_sha256=a.original_manifest_sha256
    WHERE a.tenant_id=${scope.tenantId} AND a.document_version_id=${scope.documentVersionId}
      AND current_setting('app.user_id',true)=${scope.actorUserId}
      AND a.parse_run_id=${original.parseRunId} AND a.parse_revision=${original.parseRevision}
      AND a.semantic_revision=${semanticRevision} AND a.status='SAVED'
      AND p.status='PUBLISHED' AND p.manifest_artifact->>'relativePath'='original/manifest.json'
      AND p.manifest_artifact->>'role'='MANIFEST' AND p.manifest_artifact->>'readback'='VERIFIED'
      AND p.source_binding->>'documentVersionId'=${original.documentVersionId}
      AND p.source_binding->>'sourceArtifactId'=${original.sourceArtifactId}
      AND p.source_binding->>'pdfSha256'=${original.sourceSha256}
      AND p.source_binding->'byteLength'=${JSON.stringify(original.sourceByteLength)}::jsonb`;
}

function checkedSavedResult(row: SavedDocumentActivityRow | undefined, scope: DocumentActivityScope,
  expectedBinding: DocumentActivitySourceBinding, reference?: DocumentActivitySavedReference): AnyDocumentActivityRevision | null {
  if (!row) return null;
  const result = row.result;
  if (result?.schemaVersion !== (row.candidateSchemaVersion ?? DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA) || row.status !== 'SAVED' || row.documentVersionId !== scope.documentVersionId ||
    row.parseRunId !== expectedBinding.original.parseRunId || row.parseRevision !== expectedBinding.original.parseRevision ||
    row.semanticRevision !== expectedBinding.semanticRevision || row.candidateRevision === null ||
    !Number.isSafeInteger(row.candidateRevision) || row.candidateRevision < 1 || !result ||
    result.runRef !== row.runRef || result.candidateRevision !== row.candidateRevision ||
    result.sourceBinding?.semanticRevision !== expectedBinding.semanticRevision ||
    !isDeepStrictEqual(result.sourceBinding?.original, expectedBinding.original) ||
    (reference && (row.runRef !== reference.runRef || row.candidateRevision !== reference.candidateRevision)))
    throw new Error('DOCUMENT_ACTIVITY_RESULT_BINDING_MISMATCH');
  return result;
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
