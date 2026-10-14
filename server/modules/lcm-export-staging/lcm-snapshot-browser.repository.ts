import type postgres from 'postgres';
import type { LcmDatabaseScope } from '@shared/lcm-configuration-store.interface';
import type { LcmCandidateRecord } from '@shared/lcm-export-staging.interface';
import type {
  LcmSnapshotBrowseRequest, LcmSnapshotCatalogueResponse, LcmSnapshotRowsResponse, LcmSnapshotSummary,
} from '@shared/lcm-source-reading.interface';
import { setDatabaseActor, validateDatabaseScope } from './lcm-configuration.repository';
import { lcmBrowserQuery } from './lcm-source-reading.service';
import { lcmReadingError, type LcmSnapshotReadRepository } from './lcm-source-reading.port';

interface SnapshotRow {
  snapshotId: string; sourceInstanceId: string; collectionId: string; scopeKey: string;
  originalFileName: string; originalSha256: string; originalByteLength: string;
  sourceObservedAt: Date | null; sourceObservedDate: string | null;
  sourceTimeZone: string | null; sourceTimePrecision: 'day' | 'instant' | 'unknown';
  sourceExportedAt: string | null; sourceDataCutoffDate: string | null; importedAt: Date;
  coveredAircraftModels: string[]; coveredAircraftCount: number; recordCount: number;
}

/** Receives an already approved connection to the existing isolated candidate store.
 * No connection creation, production fallback, shared grant or original-file access. */
export class LcmSnapshotBrowserRepository implements LcmSnapshotReadRepository {
  readonly available: boolean = true;
  constructor(private readonly sql: postgres.Sql) {}

  async catalogue(scope: LcmDatabaseScope, value: LcmSnapshotBrowseRequest): Promise<LcmSnapshotCatalogueResponse> {
    validateDatabaseScope(scope);
    const query: LcmSnapshotBrowseRequest = lcmBrowserQuery(value);
    if (query.after && !/^[a-f0-9]{64}$/u.test(query.after)) throw lcmReadingError('LCM_CURSOR_INVALID', 400);
    return this.sql.begin(async (tx: postgres.TransactionSql): Promise<LcmSnapshotCatalogueResponse> => {
      await setDatabaseActor(tx, scope);
      if (query.after) {
        const anchors: Array<{ id: string }> = await tx<Array<{ id: string }>>`
          SELECT snapshot_id AS id FROM lcm_configuration_snapshot
          WHERE tenant_id=${scope.tenantId} AND owner_actor_id=${scope.actorId}
            AND source_instance_id=ANY(${tx.array(scope.authorizedSourceInstanceIds)}::text[])
            AND snapshot_id=${query.after}`;
        if (anchors.length !== 1) throw lcmReadingError('LCM_CURSOR_INVALID', 400);
      }
      const rows: SnapshotRow[] = await readSnapshotRows(tx, scope, query);
      const limit: number = query.limit ?? 50;
      const page: SnapshotRow[] = rows.slice(0, limit);
      return { snapshots: page.map(summary), hasMore: rows.length > limit,
        nextAfter: rows.length > limit ? page[page.length - 1].snapshotId : null };
    });
  }

  async snapshot(scope: LcmDatabaseScope, snapshotId: string,
    value: LcmSnapshotBrowseRequest): Promise<LcmSnapshotRowsResponse> {
    validateDatabaseScope(scope);
    if (!/^[a-f0-9]{64}$/u.test(snapshotId)) throw lcmReadingError('LCM_SNAPSHOT_ID_INVALID', 400);
    const query: LcmSnapshotBrowseRequest = lcmBrowserQuery(value);
    if (query.after && !/^lcm-record:[a-f0-9]{64}$/u.test(query.after)) throw lcmReadingError('LCM_CURSOR_INVALID', 400);
    return this.sql.begin(async (tx: postgres.TransactionSql): Promise<LcmSnapshotRowsResponse> => {
      await setDatabaseActor(tx, scope);
      // The selected snapshot remains fixed while its row filters/pagination change.
      const snapshots: SnapshotRow[] = await readSnapshotRows(tx, scope, { limit: 1 }, snapshotId);
      if (snapshots.length !== 1) throw lcmReadingError('LCM_SNAPSHOT_NOT_FOUND', 404);
      const limit: number = query.limit ?? 50;
      const rows: Array<{ record: LcmCandidateRecord }> = await tx<Array<{ record: LcmCandidateRecord }>>`
        SELECT o.record_json AS record FROM lcm_configuration_observation o
        JOIN lcm_configuration_snapshot s USING(tenant_id,owner_actor_id,snapshot_id)
        WHERE o.tenant_id=${scope.tenantId} AND o.owner_actor_id=${scope.actorId}
          AND s.source_instance_id=ANY(${tx.array(scope.authorizedSourceInstanceIds)}::text[])
          AND o.snapshot_id=${snapshotId}
          AND (${query.aircraftModel ?? null}::text IS NULL OR o.aircraft_model=${query.aircraftModel ?? null})
          AND (${query.tailNumber ?? null}::text IS NULL OR o.tail_number=${query.tailNumber ?? null})
          AND (${query.partNumber ?? null}::text IS NULL OR o.part_number=${query.partNumber ?? null})
          AND (${query.system ?? null}::text IS NULL OR o.record_json->'fields'->>'系统'=${query.system ?? null})
          AND (${query.ata ?? null}::text IS NULL OR COALESCE(o.record_json->'fields'->>'ATA章',
            o.record_json->'fields'->>'ATA章节')=${query.ata ?? null})
          AND (${query.softwareName ?? null}::text IS NULL OR
            o.record_json->'fields'->>'软件名称'=${query.softwareName ?? null})
          AND (${query.position ?? null}::text IS NULL OR
            o.record_json->'fields'->>'FIN号'=${query.position ?? null})
          AND (${query.after ?? null}::text IS NULL OR o.record_id>${query.after ?? null})
        ORDER BY o.record_id LIMIT ${limit + 1}`;
      const page: LcmCandidateRecord[] = rows.slice(0, limit).map((row: { record: LcmCandidateRecord }) => row.record);
      return { snapshot: summary(snapshots[0]), records: page, hasMore: rows.length > limit,
        nextAfter: rows.length > limit ? page[page.length - 1].recordId : null };
    });
  }
}

async function readSnapshotRows(tx: postgres.TransactionSql, scope: LcmDatabaseScope,
  query: LcmSnapshotBrowseRequest, snapshotId?: string): Promise<SnapshotRow[]> {
  return tx<SnapshotRow[]>`
    SELECT s.snapshot_id AS "snapshotId",s.source_instance_id AS "sourceInstanceId",s.collection_id AS "collectionId",
      s.scope_key AS "scopeKey",s.original_file_name AS "originalFileName",s.artifact_sha256 AS "originalSha256",
      a.byte_length AS "originalByteLength",c.source_observed_at AS "sourceObservedAt",
      c.source_observed_date::text AS "sourceObservedDate",c.source_time_zone AS "sourceTimeZone",
      c.source_time_precision AS "sourceTimePrecision",s.source_exported_at AS "sourceExportedAt",
      CASE WHEN c.context_json->>'systemStateDateBasis'='user-confirmed-system-state'
        THEN c.context_json->>'systemStateDate' ELSE NULL END AS "sourceDataCutoffDate",
      s.imported_at AS "importedAt",s.record_count AS "recordCount",
      ARRAY(SELECT DISTINCT o.aircraft_model FROM lcm_configuration_observation o
        WHERE o.tenant_id=s.tenant_id AND o.owner_actor_id=s.owner_actor_id AND o.snapshot_id=s.snapshot_id
        ORDER BY o.aircraft_model) AS "coveredAircraftModels",
      (SELECT count(DISTINCT NULLIF(o.tail_number,''))::int FROM lcm_configuration_observation o
        WHERE o.tenant_id=s.tenant_id AND o.owner_actor_id=s.owner_actor_id AND o.snapshot_id=s.snapshot_id)
        AS "coveredAircraftCount"
    FROM lcm_configuration_snapshot s JOIN lcm_source_collection c
      USING(tenant_id,owner_actor_id,source_instance_id,collection_id)
      JOIN lcm_source_artifact a ON a.tenant_id=s.tenant_id AND a.owner_actor_id=s.owner_actor_id
        AND a.sha256=s.artifact_sha256
    WHERE s.tenant_id=${scope.tenantId} AND s.owner_actor_id=${scope.actorId}
      AND s.source_instance_id=ANY(${tx.array(scope.authorizedSourceInstanceIds)}::text[])
      AND (${snapshotId ?? null}::text IS NULL OR s.snapshot_id=${snapshotId ?? null})
      AND (${query.after ?? null}::text IS NULL OR (s.imported_at,s.snapshot_id)<(
        SELECT p.imported_at,p.snapshot_id FROM lcm_configuration_snapshot p
        WHERE p.tenant_id=${scope.tenantId} AND p.owner_actor_id=${scope.actorId}
          AND p.source_instance_id=ANY(${tx.array(scope.authorizedSourceInstanceIds)}::text[])
          AND p.snapshot_id=${query.after ?? null}))
      AND EXISTS (SELECT 1 FROM lcm_configuration_observation o
        WHERE o.tenant_id=s.tenant_id AND o.owner_actor_id=s.owner_actor_id AND o.snapshot_id=s.snapshot_id
          AND (${query.aircraftModel ?? null}::text IS NULL OR o.aircraft_model=${query.aircraftModel ?? null})
          AND (${query.tailNumber ?? null}::text IS NULL OR o.tail_number=${query.tailNumber ?? null})
          AND (${query.partNumber ?? null}::text IS NULL OR o.part_number=${query.partNumber ?? null})
          AND (${query.system ?? null}::text IS NULL OR o.record_json->'fields'->>'系统'=${query.system ?? null})
          AND (${query.ata ?? null}::text IS NULL OR COALESCE(o.record_json->'fields'->>'ATA章',
            o.record_json->'fields'->>'ATA章节')=${query.ata ?? null})
          AND (${query.softwareName ?? null}::text IS NULL OR
            o.record_json->'fields'->>'软件名称'=${query.softwareName ?? null})
          AND (${query.position ?? null}::text IS NULL OR o.record_json->'fields'->>'FIN号'=${query.position ?? null}))
    ORDER BY s.imported_at DESC,s.snapshot_id DESC LIMIT ${(query.limit ?? 50) + 1}`;
}

function summary(row: SnapshotRow): LcmSnapshotSummary {
  const byteLength: number = Number(row.originalByteLength);
  if (!Number.isSafeInteger(byteLength) || byteLength < 1)
    throw lcmReadingError('LCM_ORIGINAL_METADATA_INVALID', 409);
  return { ...row, originalByteLength: byteLength, originalAvailability: 'LOCAL_REFERENCE_ONLY',
    sourceObservedAt: row.sourceObservedAt?.toISOString() ?? null, importedAt: row.importedAt.toISOString(),
    sourceEffectiveAt: null, completeness: 'UNVERIFIED', sourceAuthority: 'unverified/local',
    candidateOnly: true, liveExternalVerified: false };
}
