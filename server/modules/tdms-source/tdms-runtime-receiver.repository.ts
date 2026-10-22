import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';
import type { TdmsSourceScope } from './tdms-source.types';
import { tdmsError } from './tdms-source.types';
import {
  assertTdmsSourceActor,
  type TdmsSourceActor,
} from './tdms-runtime-delegation';
import type { TdmsReceiverRow } from './tdms-receiver.types';
import { CANONICAL_MIAODA_APP_ID } from '../canonical-host/canonical-host.constants';
import {
  TDMS_BOUND_SCHEMA,
  TDMS_BOUND_SQL_ROLES,
  type TdmsReceiverIdentityProfile,
} from './tdms-receiver-identity-profile';

/** Read-only reuse of the controlled receiver authority. Always handed a transaction;
 * no upload, registration, public controller, grant mutation or root pool. */
export class TdmsRuntimeReceiverRepository {
  constructor(
    private readonly database: PostgresJsDatabase,
    private readonly identityProfile: Pick<
      TdmsReceiverIdentityProfile,
      'current'
    >,
  ) {}
  async authorities(
    actor: TdmsSourceActor,
    scope?: TdmsSourceScope,
  ): Promise<TdmsReceiverRow[]> {
    assertTdmsSourceActor(actor);
    const database = this.database;
    await this.assertActor(database, actor);
    try {
      let lockedReceiverIds: Set<string> | undefined;
      // Shared transaction locks coordinate with the controlled Source change trigger.
      // No UPDATE policy is granted merely to make SELECT FOR SHARE visible under RLS.
      if (scope) {
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

  private async assertActor(
    database: PostgresJsDatabase,
    actor: TdmsSourceActor,
  ): Promise<void> {
    assertTdmsSourceActor(actor);
    const profile = this.identityProfile.current();
    // The SDK does not forward Gateway tenant/app into SQL. Reject the supplied
    // verified actor against the controlled deployment profile before any SQL.
    if (
      actor.tenantId !== profile.tenantId ||
      actor.applicationScopeId !== CANONICAL_MIAODA_APP_ID
    )
      throw tdmsError('TDMS_RECEIVER_IDENTITY_PROFILE_MISMATCH', 403);
    const [observed] = await database.execute<{
      actorId: string | null;
      schemaName: string | null;
      roleName: string;
    }>(sql`SELECT current_setting('app.user_id',true) AS "actorId",
      current_schema() AS "schemaName", current_user AS "roleName"`);
    if (observed?.actorId !== actor.canonicalSubject.id)
      throw tdmsError('TDMS_RECEIVER_SQL_ACTOR_MISMATCH', 401);
    if (
      observed.schemaName !== TDMS_BOUND_SCHEMA ||
      !TDMS_BOUND_SQL_ROLES.some((role) => role === observed.roleName)
    )
      throw tdmsError('TDMS_RECEIVER_SQL_CONTEXT_MISMATCH', 503);
    try {
      // The same invoker predicate used by RLS compares these parameters with
      // its compiled profile and freshly visible ACTIVE mapping. No grant or
      // session is inferred from a mapping, and no identity GUC is introduced.
      const [bound] = await database.execute<{ bound: boolean }>(
        sql`SELECT workspace_aadkpkjef3slu.tdms_act_bound_identity(
          ${profile.tenantId}::text, ${profile.clientId}::text) AS bound`,
      );
      if (bound?.bound !== true)
        throw tdmsError('TDMS_RECEIVER_BOUND_IDENTITY_MISMATCH', 403);
    } catch (error) {
      const code = databaseErrorCode(error);
      if (code === '42883' || code === '42P01')
        throw tdmsError(
          'TDMS_RECEIVER_BOUND_IDENTITY_STORAGE_UNCONFIGURED',
          503,
        );
      throw error;
    }
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
