import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';
import type { TdmsPublicActor, TdmsSourceScope } from './tdms-source.types';
import { tdmsError } from './tdms-source.types';
import { assertPublicActor } from './tdms-source.authorization';
import { canonical } from './tdms-source.validation';
import {
  assertTdmsReceiverScope,
  tdmsReceiverDatabase,
  withTdmsReceiverDatabase,
} from './tdms-receiver-sql-context';
import type {
  TdmsReceiverAuthority,
  TdmsReceiverRow,
  TdmsStoredSelection,
} from './tdms-receiver.types';
import { checkedReceiverSelection } from './tdms-receiver-selection.validation';

@Injectable()
export class TdmsReceiverRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly database: PostgresJsDatabase,
  ) {}

  transaction<T>(
    operation: (database: PostgresJsDatabase) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction((database) =>
      withTdmsReceiverDatabase(database as PostgresJsDatabase, () =>
        operation(database as PostgresJsDatabase),
      ),
    );
  }

  async authorities(
    actor: TdmsPublicActor,
    scope?: TdmsSourceScope,
  ): Promise<TdmsReceiverRow[]> {
    assertPublicActor(actor);
    const database = tdmsReceiverDatabase() ?? this.database;
    await this.assertActor(database, actor);
    try {
      let lockedReceiverIds: Set<string> | undefined;
      // Shared transaction locks coordinate with the controlled Source change trigger.
      // No UPDATE policy is granted merely to make SELECT FOR SHARE visible under RLS.
      if (tdmsReceiverDatabase() && scope) {
        const keys = await database.execute<{
          receiverId: string;
        }>(sql`SELECT r.receiver_id AS "receiverId"
          FROM tdms_source_receiver r JOIN tdms_source_receiver_grant g USING(receiver_id)
          WHERE r.tenant_id=${actor.tenantId} AND r.application_scope_id=${actor.applicationScopeId}
            AND g.actor_subject_id=${actor.canonicalSubject.id}
            ${
              scope
                ? sql`AND r.source_key=${scope.sourceKey} AND r.source_instance_id=${scope.sourceInstanceId}
              AND r.scope_id=${scope.scopeId} AND r.tenant_id=${scope.tenantId}`
                : sql``
            }
          ORDER BY r.receiver_id LIMIT 201`);
        if (keys.length > 200)
          throw tdmsError('TDMS_RECEIVER_SCOPE_LIMIT', 503);
        lockedReceiverIds = new Set(keys.map((key) => key.receiverId));
        for (const key of keys)
          await database.execute(sql`SELECT pg_advisory_xact_lock_shared(
          hashtextextended('wiselink:tdms-receiver:' || ${key.receiverId},0))`);
      }
      const rows = await database.execute<TdmsReceiverRow>(sql`SELECT
        r.receiver_id AS "receiverId",r.tenant_id AS "tenantId",r.application_scope_id AS "applicationScopeId",
        r.source_key AS "sourceKey",r.source_instance_id AS "sourceInstanceId",r.scope_id AS "scopeId",
        r.source_subject_namespace AS "sourceSubjectNamespace",r.source_subject_id AS "sourceSubjectId",
        r.authority_ref AS "authorityRef",r.authority_revision AS "authorityRevision",
        r.authority_evidence_ref AS "authorityEvidenceRef",r.approved_by_subject AS "approvedBySubject",
        r.approved_at::text AS "approvedAt",r.valid_from::text AS "validFrom",r.valid_until::text AS "validUntil",
        r.status,r.revoked_at::text AS "revokedAt",r.revision,g.actor_subject_id AS "actorSubjectId",
        g.source_subject_namespace AS "grantSourceSubjectNamespace",g.source_subject_id AS "grantSourceSubjectId",
        g.permission_revision AS "permissionRevision",g.authority_evidence_ref AS "grantAuthorityEvidenceRef",
        g.approved_by_subject AS "grantApprovedBySubject",g.approved_at::text AS "grantApprovedAt",
        g.valid_from::text AS "grantValidFrom",g.valid_until::text AS "grantValidUntil",
        g.status AS "grantStatus",g.revoked_at::text AS "grantRevokedAt",g.revision AS "grantRevision",
        g.actions_json AS actions FROM tdms_source_receiver r JOIN tdms_source_receiver_grant g USING(receiver_id)
        WHERE r.tenant_id=${actor.tenantId} AND r.application_scope_id=${actor.applicationScopeId}
          AND g.actor_subject_id=${actor.canonicalSubject.id}
          ${
            scope
              ? sql`AND r.source_key=${scope.sourceKey} AND r.source_instance_id=${scope.sourceInstanceId}
            AND r.scope_id=${scope.scopeId} AND r.tenant_id=${scope.tenantId}`
              : sql``
          }
        ORDER BY r.receiver_id LIMIT 201`);
      if (rows.length > 200) throw tdmsError('TDMS_RECEIVER_SCOPE_LIMIT', 503);
      // A controlled re-registration can replace a scope while this request waits
      // for its old receiver lock. Never admit a newly discovered, unlocked row.
      if (
        lockedReceiverIds &&
        rows.some((row) => !lockedReceiverIds.has(row.receiverId))
      )
        throw tdmsError('TDMS_SOURCE_PERMISSION_CHANGED', 409);
      return [...rows];
    } catch (error) {
      if (databaseErrorCode(error) === '42P01')
        throw tdmsError('TDMS_RECEIVER_AUTHORITY_STORAGE_UNCONFIGURED', 503);
      throw error;
    }
  }

  async selection(
    actor: TdmsPublicActor,
    scope: TdmsSourceScope,
    requestId: string,
    bindingId: string,
  ): Promise<TdmsStoredSelection | null> {
    await assertTdmsReceiverScope(scope);
    const database = tdmsReceiverDatabase() ?? this.database;
    await this.assertActor(database, actor);
    const rows = await database.execute<{
      data: TdmsStoredSelection;
      consistent: boolean;
    }>(sql`SELECT data_json AS data,
        (data_json->>'receiverId'=receiver_id AND (data_json->>'receiverRevision')::integer=receiver_revision
          AND (data_json->>'grantRevision')::integer=grant_revision AND data_json->>'permissionRevision'=permission_revision
          AND data_json->>'payloadDigest'=payload_digest AND data_json->>'packageId'=package_id
          AND data_json->'memberClaims'=member_claims_json AND data_json->'scope'=jsonb_build_object(
            'tenantId',tenant_id,'sourceKey',source_key,'sourceInstanceId',source_instance_id,'scopeId',scope_id)
          AND data_json->>'applicationScopeId'=application_scope_id AND data_json->>'actorSubjectId'=actor_subject_id
          AND data_json#>>'{receipt,requestId}'=request_id AND data_json#>>'{receipt,bindingId}'=binding_id) AS consistent
      FROM tdms_upload_selection_association WHERE tenant_id=${actor.tenantId}
        AND application_scope_id=${actor.applicationScopeId} AND actor_subject_id=${actor.canonicalSubject.id}
        AND source_key=${scope.sourceKey} AND source_instance_id=${scope.sourceInstanceId} AND scope_id=${scope.scopeId}
        AND request_id=${requestId} AND binding_id=${bindingId}`);
    if (!rows.length) return null;
    if (rows[0]!.consistent !== true)
      throw tdmsError('TDMS_UPLOAD_ASSOCIATION_INTEGRITY_CONFLICT', 409);
    const stored = checkedReceiverSelection(
      rows[0]!.data,
      actor,
      scope,
      requestId,
      bindingId,
    );
    await assertTdmsReceiverScope(scope);
    return stored;
  }

  async insertSelection(
    actor: TdmsPublicActor,
    authority: TdmsReceiverAuthority,
    stored: TdmsStoredSelection,
  ): Promise<TdmsStoredSelection> {
    const database = tdmsReceiverDatabase();
    if (!database) throw tdmsError('TDMS_RECEIVER_TRANSACTION_REQUIRED', 503);
    await this.assertActor(database, actor);
    const { scope, row } = authority;
    await assertTdmsReceiverScope(scope);
    checkedReceiverSelection(
      stored,
      actor,
      scope,
      stored.receipt.requestId,
      stored.receipt.bindingId,
    );
    await database.execute(sql`INSERT INTO tdms_upload_selection_association
      (tenant_id,application_scope_id,actor_subject_id,source_key,source_instance_id,scope_id,request_id,binding_id,
       receiver_id,receiver_revision,grant_revision,permission_revision,package_id,payload_digest,member_claims_json,data_json)
      VALUES (${actor.tenantId},${actor.applicationScopeId},${actor.canonicalSubject.id},${scope.sourceKey},
        ${scope.sourceInstanceId},${scope.scopeId},${stored.receipt.requestId},${stored.receipt.bindingId},
        ${row.receiverId},${row.revision},${row.grantRevision},${authority.permissionRevision},${stored.packageId},
        ${stored.payloadDigest},${canonical(stored.memberClaims)}::jsonb,${canonical(stored)}::jsonb)
      ON CONFLICT (tenant_id,application_scope_id,actor_subject_id,source_key,source_instance_id,scope_id,request_id,binding_id)
      DO NOTHING`);
    const saved = await this.selection(
      actor,
      scope,
      stored.receipt.requestId,
      stored.receipt.bindingId,
    );
    if (!saved)
      throw tdmsError('TDMS_UPLOAD_ASSOCIATION_READBACK_MISSING', 409);
    if (canonical(saved) !== canonical(stored))
      throw tdmsError('TDMS_UPLOAD_ASSOCIATION_CONFLICT', 409);
    return saved;
  }

  private async assertActor(
    database: PostgresJsDatabase,
    actor: TdmsPublicActor,
  ): Promise<void> {
    assertPublicActor(actor);
    const [observed] = await database.execute<{ actorId: string | null }>(
      sql`SELECT current_setting('app.user_id',true) AS "actorId"`,
    );
    if (observed?.actorId !== actor.canonicalSubject.id)
      throw tdmsError('TDMS_RECEIVER_SQL_ACTOR_MISMATCH', 401);
  }
}

function databaseErrorCode(error: unknown): string | undefined {
  let value = error;
  for (
    let depth = 0;
    depth < 4 && value && typeof value === 'object';
    depth++
  ) {
    if ('code' in value && typeof value.code === 'string') return value.code;
    value = 'cause' in value ? value.cause : null;
  }
  return undefined;
}
