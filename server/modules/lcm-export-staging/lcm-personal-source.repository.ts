import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { lcmTransaction, type LcmRepositoryDatabase } from './lcm-host-database';
import type { CanonicalMiaodaFinalUserActorContext as Actor } from '../work-item/canonical-object-access.port';
import type { LcmPersonalLibraryResponse } from '@shared/lcm-personal-import.interface';
import type { LcmSourceReadGrant } from './lcm-source-reading.port';
import type { LcmOriginalReference } from './lcm-original-reference';
import { lcmReadingError } from './lcm-source-reading.port';
import { canonicalJson } from './lcm-export.helpers';
import { assertPublicActor } from '../tdms-source/tdms-source.authorization';

interface PersonalSource {
  sourceInstanceId: string; authorityRevision: number; readEnabled: boolean;
}

/** Actual persistent owner/source registration; it never grants access to someone else's import. */
export class LcmPersonalSourceRepository {
  constructor(readonly sql: LcmRepositoryDatabase) {}

  private async ownerTransaction<T>(actor: Actor,
    operation: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    assertPublicActor(actor);
    return lcmTransaction(this.sql, actor.canonicalSubject.id, async (tx: postgres.TransactionSql): Promise<T> => {
      await tx`SELECT set_config('app.lcm_tenant_id',${actor.tenantId},true),
        set_config('app.lcm_actor_id',${actor.canonicalSubject.id},true)`;
      return operation(tx);
    }) as Promise<T>;
  }

  private async find(tx: postgres.TransactionSql, actor: Actor): Promise<PersonalSource | null> {
    const rows = await tx<PersonalSource[]>`SELECT source_instance_id AS "sourceInstanceId",
      authority_revision AS "authorityRevision",read_enabled AS "readEnabled" FROM lcm_personal_source
      WHERE application_scope_id=${actor.applicationScopeId} AND tenant_id=${actor.tenantId}
        AND owner_actor_id=${actor.canonicalSubject.id}`;
    return rows[0] ?? null;
  }

  async register(actor: Actor, originalSha256: string): Promise<LcmSourceReadGrant> {
    await this.ownerTransaction(actor, async (tx: postgres.TransactionSql): Promise<void> => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${canonicalJson([
        'lcm-personal-source',actor.applicationScopeId,actor.tenantId,actor.canonicalSubject.id])},0))::text`;
      const existing: PersonalSource | null = await this.find(tx, actor);
      if (existing && !existing.readEnabled) throw lcmReadingError('LCM_SOURCE_ACCESS_DENIED', 403);
      if (!existing) await tx`INSERT INTO lcm_personal_source
        (application_scope_id,tenant_id,owner_actor_id,source_instance_id,created_from_sha256)
        VALUES (${actor.applicationScopeId},${actor.tenantId},${actor.canonicalSubject.id},
          ${randomUUID()},${originalSha256})`;
    });
    return this.authorize(actor);
  }

  async assertCanImport(actor: Actor): Promise<void> {
    const source: PersonalSource | null = await this.ownerTransaction(actor,
      (tx: postgres.TransactionSql) => this.find(tx, actor));
    if (source && !source.readEnabled) throw lcmReadingError('LCM_SOURCE_ACCESS_DENIED', 403);
  }

  async authorize(actor: Actor): Promise<LcmSourceReadGrant> {
    const source: PersonalSource | null = await this.ownerTransaction(actor,
      (tx: postgres.TransactionSql) => this.find(tx, actor));
    if (!source) throw lcmReadingError('LCM_PERSONAL_SOURCE_EMPTY', 404);
    if (!source.readEnabled) throw lcmReadingError('LCM_SOURCE_ACCESS_DENIED', 403);
    const authorityRef: string = `lcm-personal-source:${source.sourceInstanceId}`;
    return { applicationScopeId: actor.applicationScopeId,
      scope: { tenantId: actor.tenantId, actorId: actor.canonicalSubject.id,
        authorizedSourceInstanceIds: [source.sourceInstanceId] },
      authorityRef, permissionRevision: `${authorityRef}:${source.authorityRevision}`,
      managementDomains: { [source.sourceInstanceId]: { managementDomainRef: authorityRef,
        evidenceRef: `${authorityRef}:${source.authorityRevision}` } } };
  }

  async library(actor: Actor): Promise<LcmPersonalLibraryResponse> {
    return this.ownerTransaction(actor, async (tx: postgres.TransactionSql): Promise<LcmPersonalLibraryResponse> => {
      const source: PersonalSource | null = await this.find(tx, actor);
      if (!source) return { hasSource: false, latestSnapshotIds: [], snapshotCount: 0 };
      if (!source.readEnabled) throw lcmReadingError('LCM_SOURCE_ACCESS_DENIED', 403);
      await tx`SELECT set_config('app.lcm_source_ids',${JSON.stringify([source.sourceInstanceId])},true)`;
      // Same source-day / instant / acquisition ordering used by the existing as-of query.
      // A late historical import cannot replace a newer known source day; wholly unknown dates
      // use actual acquisition order without inventing a source timestamp.
      const rows = await tx<Array<{ snapshotId: string }>>`WITH authorized AS (
        SELECT s.snapshot_id,s.scope_key,c.source_observed_at,c.source_observed_date,
          c.source_time_precision,c.acquisition_sequence
        FROM lcm_configuration_snapshot s JOIN lcm_source_collection c
          USING(tenant_id,owner_actor_id,source_instance_id,collection_id)
        WHERE s.tenant_id=${actor.tenantId} AND s.owner_actor_id=${actor.canonicalSubject.id}
          AND s.source_instance_id=${source.sourceInstanceId}
      ), granularity AS (
        SELECT *,bool_or(source_time_precision='day') OVER (PARTITION BY scope_key,
          COALESCE(source_observed_date,(source_observed_at AT TIME ZONE 'Asia/Shanghai')::date))
          AS has_day_on_source_day FROM authorized
      ), ranked AS (
        SELECT *,row_number() OVER (PARTITION BY scope_key ORDER BY
          COALESCE(source_observed_date,(source_observed_at AT TIME ZONE 'Asia/Shanghai')::date) DESC NULLS LAST,
          CASE WHEN has_day_on_source_day THEN NULL ELSE source_observed_at END DESC NULLS LAST,
          acquisition_sequence DESC,snapshot_id DESC) AS ordinal FROM granularity
      ) SELECT snapshot_id AS "snapshotId" FROM ranked WHERE ordinal=1 ORDER BY scope_key`;
      const total = await tx<Array<{ count: number }>>`SELECT count(*)::int AS count
        FROM lcm_configuration_snapshot WHERE tenant_id=${actor.tenantId}
          AND owner_actor_id=${actor.canonicalSubject.id} AND source_instance_id=${source.sourceInstanceId}`;
      return { hasSource: true, latestSnapshotIds: rows.map((row: { snapshotId: string }) => row.snapshotId),
        snapshotCount: total[0].count };
    });
  }

  async admitRequest(actor: Actor, sourceId: string, requestId: string, payloadKey: string,
    original: { reference: LcmOriginalReference; sha256: string; byteLength: number }): Promise<void> {
    await this.ownerTransaction(actor, async (tx: postgres.TransactionSql): Promise<void> => {
      await tx`INSERT INTO lcm_personal_import_request
        (tenant_id,owner_actor_id,source_instance_id,request_id,payload_key,
          selection_bucket_id,selection_file_path,selection_provider_object_id,original_sha256,original_byte_length)
        VALUES (${actor.tenantId},${actor.canonicalSubject.id},${sourceId},${requestId},${payloadKey},
          ${original.reference.bucketId},${original.reference.filePath},${original.reference.providerObjectId},
          ${original.sha256},${original.byteLength})
        ON CONFLICT DO NOTHING`;
      const rows = await tx<Array<{ payloadKey: string; bucketId: string; filePath: string;
        providerObjectId: string; sha256: string; byteLength: string }>>`SELECT payload_key AS "payloadKey",
          selection_bucket_id AS "bucketId",selection_file_path AS "filePath",
          selection_provider_object_id AS "providerObjectId",original_sha256 AS sha256,
          original_byte_length AS "byteLength"
        FROM lcm_personal_import_request WHERE tenant_id=${actor.tenantId}
          AND owner_actor_id=${actor.canonicalSubject.id} AND source_instance_id=${sourceId}
          AND request_id=${requestId}`;
      if (rows.length !== 1 || rows[0].payloadKey !== payloadKey ||
          rows[0].bucketId !== original.reference.bucketId || rows[0].filePath !== original.reference.filePath ||
          rows[0].providerObjectId !== original.reference.providerObjectId || rows[0].sha256 !== original.sha256 ||
          Number(rows[0].byteLength) !== original.byteLength)
        throw lcmReadingError('LCM_IMPORT_REQUEST_CONFLICT', 409);
    });
  }

  async completeRequest(actor: Actor, sourceId: string, requestId: string,
    payloadKey: string, snapshotId: string): Promise<void> {
    await this.ownerTransaction(actor, async (tx: postgres.TransactionSql): Promise<void> => {
      const rows = await tx<Array<{ snapshotId: string }>>`UPDATE lcm_personal_import_request
        SET snapshot_id=${snapshotId} WHERE tenant_id=${actor.tenantId}
          AND owner_actor_id=${actor.canonicalSubject.id} AND source_instance_id=${sourceId}
          AND request_id=${requestId} AND payload_key=${payloadKey}
          AND (snapshot_id IS NULL OR snapshot_id=${snapshotId}) RETURNING snapshot_id AS "snapshotId"`;
      if (rows.length !== 1) throw lcmReadingError('LCM_IMPORT_REQUEST_CONFLICT', 409);
    });
  }

  async original(actor: Actor, snapshotId: string): Promise<{ artifactRef: string; sha256: string; byteLength: number }> {
    const grant: LcmSourceReadGrant = await this.authorize(actor);
    return this.ownerTransaction(actor, async (tx: postgres.TransactionSql) => {
      await tx`SELECT set_config('app.lcm_source_ids',${JSON.stringify(grant.scope.authorizedSourceInstanceIds)},true)`;
      const rows = await tx<Array<{ artifactRef: string; sha256: string; byteLength: number }>>`
        SELECT a.artifact_ref AS "artifactRef",a.sha256,a.byte_length::int AS "byteLength"
        FROM lcm_configuration_snapshot s JOIN lcm_source_artifact a
          ON a.tenant_id=s.tenant_id AND a.owner_actor_id=s.owner_actor_id AND a.sha256=s.artifact_sha256
        WHERE s.tenant_id=${actor.tenantId} AND s.owner_actor_id=${actor.canonicalSubject.id}
          AND s.source_instance_id=${grant.scope.authorizedSourceInstanceIds[0]} AND s.snapshot_id=${snapshotId}`;
      if (rows.length !== 1) throw lcmReadingError('LCM_SNAPSHOT_NOT_FOUND', 404);
      return rows[0];
    });
  }
}
