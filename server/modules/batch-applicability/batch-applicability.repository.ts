import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';

import type {
  CreateBatchApplicabilityConfirmationRecord,
  CreateBatchApplicabilityRunRecord,
  PersistedBatchApplicabilityConfirmation,
  PersistedBatchApplicabilityRun,
} from './batch-applicability-host.types';

interface RunRow extends Record<string, unknown> {
  runId: string;
  tenantId: string;
  actorId: string;
  workItemId: string;
  requestId: string;
  requestPayloadJson: string;
  workItemRevision: number;
  documentVersionId: string;
  sourcePackageId: string;
  sourceExpressionId: string;
  sourceConditionId: string;
  sourceRefIdsJson: string;
  fleetSourceSnapshotId: string;
  fleetSourceRevisionKey: string;
  fleetAuthorityRevision: string;
  fleetSourceAsOf: string;
  hostBindingStatus: PersistedBatchApplicabilityRun['hostBindingStatus'];
  candidateSetJson: string;
  createdAt: Date | string;
}

interface ConfirmationRow extends Record<string, unknown> {
  receiptId: string;
  runId: string;
  tenantId: string;
  actorId: string;
  workItemId: string;
  requestId: string;
  requestPayloadJson: string;
  workItemRevision: number;
  candidateClusterId: string;
  decision: PersistedBatchApplicabilityConfirmation['decision'];
  reason: string;
  confirmedAt: Date | string;
  validUntil: Date | string;
  confirmationCandidateJson: string;
  createdAt: Date | string;
}

@Injectable()
export class BatchApplicabilityRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async findRunByRequest(input: {
    tenantId: string;
    actorId: string;
    workItemId: string;
    requestId: string;
  }): Promise<PersistedBatchApplicabilityRun | null> {
    const rows = await this.db.execute<RunRow>(sql`
      SELECT ${runColumns()}
      FROM batch_applicability_run
      WHERE tenant_id = ${input.tenantId}
        AND actor_id = ${input.actorId}
        AND work_item_id = ${input.workItemId}
        AND request_id = ${input.requestId}
      LIMIT 1
    `);
    return rows[0] ? toRun(rows[0]) : null;
  }

  async findRun(input: {
    tenantId: string;
    actorId: string;
    workItemId: string;
    runId: string;
  }): Promise<PersistedBatchApplicabilityRun | null> {
    const rows = await this.db.execute<RunRow>(sql`
      SELECT ${runColumns()}
      FROM batch_applicability_run
      WHERE tenant_id = ${input.tenantId}
        AND actor_id = ${input.actorId}
        AND work_item_id = ${input.workItemId}
        AND run_id = ${input.runId}
      LIMIT 1
    `);
    return rows[0] ? toRun(rows[0]) : null;
  }

  async createRun(
    input: CreateBatchApplicabilityRunRecord,
  ): Promise<{ run: PersistedBatchApplicabilityRun; created: boolean }> {
    const candidate = input.candidateSet;
    const requestPayloadJson = JSON.stringify(input.request);
    const candidateSetJson = JSON.stringify(candidate);
    const sourceRefIdsJson = JSON.stringify(candidate.source.sourceRefIds);
    const rows = await this.db.execute<RunRow>(sql`
      INSERT INTO batch_applicability_run (
        run_id, tenant_id, actor_id, work_item_id, request_id,
        request_payload_json, work_item_revision, document_version_id,
        source_package_id, source_expression_id, source_condition_id,
        source_ref_ids_json, fleet_source_snapshot_id,
        fleet_source_revision_key, fleet_authority_revision,
        fleet_source_as_of, host_binding_status, candidate_set_json
      ) VALUES (
        ${input.runId}, ${input.tenantId}, ${input.actorId},
        ${input.workItemId}, ${input.request.requestId},
        ${requestPayloadJson}, ${candidate.source.workItemRevision},
        ${candidate.source.documentVersionId}, ${candidate.source.packageId},
        ${candidate.source.sourceExpressionId},
        ${candidate.source.sourceConditionId}, ${sourceRefIdsJson},
        ${candidate.source.hostBinding.frozenFleetHead.sourceSnapshotId},
        ${candidate.source.hostBinding.frozenFleetHead.sourceRevisionKey},
        ${candidate.source.hostBinding.frozenFleetHead.authorityRevision},
        ${candidate.source.hostBinding.frozenFleetHead.sourceAsOf},
        ${candidate.source.hostBinding.status}, ${candidateSetJson}
      )
      ON CONFLICT (tenant_id, work_item_id, request_id) DO NOTHING
      RETURNING ${runColumns()}
    `);
    if (rows[0]) return { run: toRun(rows[0]), created: true };
    const replay = await this.findRunByRequest({
      tenantId: input.tenantId,
      actorId: input.actorId,
      workItemId: input.workItemId,
      requestId: input.request.requestId,
    });
    if (!replay) throw conflict('BATCH_RUN_IDEMPOTENCY_READBACK_FAILED');
    return { run: replay, created: false };
  }

  async listConfirmations(input: {
    tenantId: string;
    actorId: string;
    workItemId: string;
    runId: string;
  }): Promise<PersistedBatchApplicabilityConfirmation[]> {
    const rows = await this.db.execute<ConfirmationRow>(sql`
      SELECT ${confirmationColumns()}
      FROM batch_applicability_confirmation
      WHERE tenant_id = ${input.tenantId}
        AND actor_id = ${input.actorId}
        AND work_item_id = ${input.workItemId}
        AND run_id = ${input.runId}
      ORDER BY created_at, receipt_id
    `);
    return rows.map(toConfirmation);
  }

  async createConfirmation(
    input: CreateBatchApplicabilityConfirmationRecord,
  ): Promise<{
    confirmation: PersistedBatchApplicabilityConfirmation;
    created: boolean;
  }> {
    const requestPayloadJson = JSON.stringify(input.request);
    const confirmationCandidateJson = JSON.stringify(input.candidate);
    const rows = await this.db.execute<ConfirmationRow>(sql`
      INSERT INTO batch_applicability_confirmation (
        receipt_id, run_id, tenant_id, actor_id, work_item_id, request_id,
        request_payload_json, work_item_revision, candidate_cluster_id,
        decision, reason, confirmed_at, valid_until,
        confirmation_candidate_json
      ) VALUES (
        ${input.receiptId}, ${input.run.runId}, ${input.run.tenantId},
        ${input.actorId}, ${input.run.workItemId}, ${input.request.requestId},
        ${requestPayloadJson}, ${input.run.workItemRevision},
        ${input.request.candidateClusterId}, ${input.request.decision},
        ${input.request.reason}, ${input.candidate.audit.confirmedAt}::timestamptz,
        ${input.request.validUntil}::timestamptz, ${confirmationCandidateJson}
      )
      ON CONFLICT DO NOTHING
      RETURNING ${confirmationColumns()}
    `);
    if (rows[0])
      return { confirmation: toConfirmation(rows[0]), created: true };
    const existing = await this.findConfirmationByRequest({
      tenantId: input.run.tenantId,
      actorId: input.actorId,
      workItemId: input.run.workItemId,
      requestId: input.request.requestId,
    });
    if (existing) return { confirmation: existing, created: false };
    throw conflict('BATCH_CLUSTER_ALREADY_CONFIRMED');
  }

  async findConfirmationByRequest(input: {
    tenantId: string;
    actorId: string;
    workItemId: string;
    requestId: string;
  }): Promise<PersistedBatchApplicabilityConfirmation | null> {
    const rows = await this.db.execute<ConfirmationRow>(sql`
      SELECT ${confirmationColumns()}
      FROM batch_applicability_confirmation
      WHERE tenant_id = ${input.tenantId}
        AND actor_id = ${input.actorId}
        AND work_item_id = ${input.workItemId}
        AND request_id = ${input.requestId}
      LIMIT 1
    `);
    return rows[0] ? toConfirmation(rows[0]) : null;
  }
}

function runColumns() {
  return sql.raw(`
    run_id AS "runId", tenant_id AS "tenantId", actor_id AS "actorId",
    work_item_id AS "workItemId", request_id AS "requestId",
    request_payload_json AS "requestPayloadJson",
    work_item_revision AS "workItemRevision",
    document_version_id AS "documentVersionId",
    source_package_id AS "sourcePackageId",
    source_expression_id AS "sourceExpressionId",
    source_condition_id AS "sourceConditionId",
    source_ref_ids_json AS "sourceRefIdsJson",
    fleet_source_snapshot_id AS "fleetSourceSnapshotId",
    fleet_source_revision_key AS "fleetSourceRevisionKey",
    fleet_authority_revision AS "fleetAuthorityRevision",
    fleet_source_as_of AS "fleetSourceAsOf",
    host_binding_status AS "hostBindingStatus",
    candidate_set_json AS "candidateSetJson", created_at AS "createdAt"
  `);
}

function confirmationColumns() {
  return sql.raw(`
    receipt_id AS "receiptId", run_id AS "runId",
    tenant_id AS "tenantId", actor_id AS "actorId",
    work_item_id AS "workItemId", request_id AS "requestId",
    request_payload_json AS "requestPayloadJson",
    work_item_revision AS "workItemRevision",
    candidate_cluster_id AS "candidateClusterId", decision, reason,
    confirmed_at AS "confirmedAt", valid_until AS "validUntil",
    confirmation_candidate_json AS "confirmationCandidateJson",
    created_at AS "createdAt"
  `);
}

function toRun(row: RunRow): PersistedBatchApplicabilityRun {
  return {
    ...row,
    createdAt: date(row.createdAt),
    fleetHead: {
      sourceSnapshotId: row.fleetSourceSnapshotId,
      sourceRevisionKey: row.fleetSourceRevisionKey,
      authorityRevision: row.fleetAuthorityRevision,
      sourceAsOf: row.fleetSourceAsOf,
    },
  };
}

function toConfirmation(
  row: ConfirmationRow,
): PersistedBatchApplicabilityConfirmation {
  return {
    ...row,
    confirmedAt: date(row.confirmedAt),
    validUntil: date(row.validUntil),
    createdAt: date(row.createdAt),
  };
}

function date(value: Date | string): Date {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.valueOf())) {
    throw new Error('BATCH_PERSISTED_TIMESTAMP_INVALID');
  }
  return parsed;
}

function conflict(code: string): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 409 });
}
