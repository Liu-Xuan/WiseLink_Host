import type postgres from 'postgres';
import {
  lcmTransaction,
  type LcmRepositoryDatabase,
} from './lcm-host-database';
import type { LcmDatabaseScope } from '@shared/lcm-configuration-store.interface';
import type {
  LcmNativeMatrix,
  LcmNativeMatrixStoredSet,
} from '@shared/lcm-native-matrix.interface';
import type {
  LcmSnapshotBrowseRequest,
  LcmSnapshotCatalogueResponse,
  LcmSnapshotSummary,
} from '@shared/lcm-source-reading.interface';
import { setDatabaseActor, validateDatabaseScope } from './lcm-database-scope';
import { lcmBrowserQuery } from './lcm-source-reading.service';
import {
  lcmReadingError,
  type LcmSnapshotReadRepository,
} from './lcm-source-reading.port';
import { lcmOriginalReference } from './lcm-original-reference';

interface SnapshotRow {
  snapshotId: string;
  sourceInstanceId: string;
  collectionId: string;
  scopeKey: string;
  originalFileName: string;
  originalSha256: string;
  originalByteLength: string;
  sourceObservedAt: Date | string | null;
  sourceObservedDate: string | null;
  sourceTimeZone: string | null;
  sourceTimePrecision: 'day' | 'instant' | 'unknown';
  sourceExportedAt: string | null;
  sourceDataCutoffDate: string | null;
  importedAt: Date | string;
  coveredAircraftModels: string[];
  coveredAircraftCount: number;
  recordCount: number;
  artifactRef: string;
}

/** Receives an already approved connection to the existing isolated candidate store.
 * No connection creation, production fallback, shared grant or original-file access. */
export class LcmSnapshotBrowserRepository implements LcmSnapshotReadRepository {
  readonly available: boolean = true;
  constructor(private readonly sql: LcmRepositoryDatabase) {}

  async nativeMatrixReadSet(
    scope: LcmDatabaseScope,
    snapshotIds: string[],
    metadataOnly = false,
  ): Promise<LcmNativeMatrixStoredSet> {
    validateDatabaseScope(scope);
    if (
      !snapshotIds.length ||
      snapshotIds.length > 20 ||
      new Set(snapshotIds).size !== snapshotIds.length ||
      snapshotIds.some((id: string) => !/^[a-f0-9]{64}$/u.test(id))
    )
      throw lcmReadingError('LCM_MATRIX_QUERY_INVALID', 400);
    return lcmTransaction(
      this.sql,
      scope.actorId,
      async (tx: postgres.TransactionSql) => {
        await setDatabaseActor(tx, scope);
        const rows: SnapshotRow[] = await readSnapshotRows(
          tx,
          scope,
          { limit: snapshotIds.length },
          undefined,
          snapshotIds,
        );
        if (rows.length !== snapshotIds.length)
          throw lcmReadingError('LCM_SNAPSHOT_NOT_FOUND', 404);
        if (metadataOnly) return { snapshots: rows.map(summary), matrices: [] };
        const matrices = await tx<
          Array<{ snapshotId: string; matrix: LcmNativeMatrix }>
        >`
        SELECT m.snapshot_id AS "snapshotId",m.matrix_json AS matrix FROM lcm_native_matrix_snapshot m
        JOIN lcm_configuration_snapshot s USING(tenant_id,owner_actor_id,snapshot_id)
        WHERE m.tenant_id=${scope.tenantId} AND m.owner_actor_id=${scope.actorId}
          AND s.source_instance_id=ANY(${tx.array(scope.authorizedSourceInstanceIds, 25)}::text[])
          AND m.snapshot_id=ANY(${tx.array(snapshotIds, 25)}::text[]) ORDER BY m.snapshot_id`;
        return { snapshots: rows.map(summary), matrices };
      },
    );
  }

  async catalogue(
    scope: LcmDatabaseScope,
    value: LcmSnapshotBrowseRequest,
  ): Promise<LcmSnapshotCatalogueResponse> {
    validateDatabaseScope(scope);
    const query: LcmSnapshotBrowseRequest = lcmBrowserQuery(value);
    if (query.after && !/^[a-f0-9]{64}$/u.test(query.after))
      throw lcmReadingError('LCM_CURSOR_INVALID', 400);
    return lcmTransaction(
      this.sql,
      scope.actorId,
      async (
        tx: postgres.TransactionSql,
      ): Promise<LcmSnapshotCatalogueResponse> => {
        await setDatabaseActor(tx, scope);
        if (query.after) {
          const anchors: Array<{ id: string }> = await tx<
            Array<{ id: string }>
          >`
          SELECT snapshot_id AS id FROM lcm_configuration_snapshot
          WHERE tenant_id=${scope.tenantId} AND owner_actor_id=${scope.actorId}
            AND source_instance_id=ANY(${tx.array(scope.authorizedSourceInstanceIds, 25)}::text[])
            AND snapshot_id=${query.after}`;
          if (anchors.length !== 1)
            throw lcmReadingError('LCM_CURSOR_INVALID', 400);
        }
        const rows: SnapshotRow[] = await readSnapshotRows(tx, scope, query);
        const limit: number = query.limit ?? 50;
        const page: SnapshotRow[] = rows.slice(0, limit);
        return {
          snapshots: page.map(summary),
          hasMore: rows.length > limit,
          nextAfter:
            rows.length > limit ? page[page.length - 1].snapshotId : null,
        };
      },
    );
  }
}

async function readSnapshotRows(
  tx: postgres.TransactionSql,
  scope: LcmDatabaseScope,
  query: LcmSnapshotBrowseRequest,
  snapshotId?: string,
  snapshotIds?: string[],
): Promise<SnapshotRow[]> {
  const selectedIds =
    snapshotIds === undefined
      ? tx``
      : tx`AND s.snapshot_id=ANY(${tx.array(snapshotIds, 25)}::text[])`;
  const tailFilter =
    query.tailNumber === undefined
      ? tx``
      : tx`AND EXISTS(SELECT 1 FROM jsonb_array_elements(m.matrix_json->'aircraft') a
        WHERE a->>'tailNumber'=${query.tailNumber})`;
  const rowFilters = [
    query.partNumber,
    query.system,
    query.ata,
    query.softwareName,
    query.position,
  ].some((value) => value !== undefined)
    ? tx`AND EXISTS(SELECT 1 FROM jsonb_array_elements(m.matrix_json->'rows') r
      WHERE (${query.partNumber ?? null}::text IS NULL OR NULLIF(btrim(r->'fixed'->>4),'')=${query.partNumber ?? null})
        AND (${query.system ?? null}::text IS NULL OR NULLIF(btrim(r->'fixed'->>1),'')=${query.system ?? null})
        AND (${query.ata ?? null}::text IS NULL OR NULLIF(btrim(r->'fixed'->>0),'')=${query.ata ?? null})
        AND (${query.softwareName ?? null}::text IS NULL OR NULLIF(btrim(r->'fixed'->>3),'')=${query.softwareName ?? null})
        AND (${query.position ?? null}::text IS NULL OR
          (jsonb_array_length(m.matrix_json->'fixedColumns')=6 AND NULLIF(btrim(r->'fixed'->>5),'')=${query.position ?? null})))`
    : tx``;
  return tx<SnapshotRow[]>`
    SELECT s.snapshot_id AS "snapshotId",s.source_instance_id AS "sourceInstanceId",s.collection_id AS "collectionId",
      s.scope_key AS "scopeKey",s.original_file_name AS "originalFileName",s.artifact_sha256 AS "originalSha256",
      a.artifact_ref AS "artifactRef",a.byte_length AS "originalByteLength",c.source_observed_at AS "sourceObservedAt",
      c.source_observed_date::text AS "sourceObservedDate",c.source_time_zone AS "sourceTimeZone",
      c.source_time_precision AS "sourceTimePrecision",s.source_exported_at AS "sourceExportedAt",
      CASE WHEN c.context_json->>'systemStateDateBasis'='user-confirmed-system-state'
        THEN c.context_json->>'systemStateDate' ELSE NULL END AS "sourceDataCutoffDate",
      s.imported_at AS "importedAt",s.record_count AS "recordCount",
      ARRAY[s.scope_key::jsonb->>'aircraftModel'] AS "coveredAircraftModels",
      m.aircraft_column_count AS "coveredAircraftCount"
    FROM lcm_configuration_snapshot s JOIN lcm_source_collection c
      USING(tenant_id,owner_actor_id,source_instance_id,collection_id)
    JOIN lcm_source_artifact a ON a.tenant_id=s.tenant_id AND a.owner_actor_id=s.owner_actor_id AND a.sha256=s.artifact_sha256
    JOIN lcm_native_matrix_snapshot m ON m.tenant_id=s.tenant_id AND m.owner_actor_id=s.owner_actor_id AND m.snapshot_id=s.snapshot_id
    WHERE s.tenant_id=${scope.tenantId} AND s.owner_actor_id=${scope.actorId}
      AND s.source_instance_id=ANY(${tx.array(scope.authorizedSourceInstanceIds, 25)}::text[])
      AND (${snapshotId ?? null}::text IS NULL OR s.snapshot_id=${snapshotId ?? null}) ${selectedIds}
      AND (${query.after ?? null}::text IS NULL OR (s.imported_at,s.snapshot_id)<(
        SELECT p.imported_at,p.snapshot_id FROM lcm_configuration_snapshot p
        WHERE p.tenant_id=${scope.tenantId} AND p.owner_actor_id=${scope.actorId}
          AND p.source_instance_id=ANY(${tx.array(scope.authorizedSourceInstanceIds, 25)}::text[])
          AND p.snapshot_id=${query.after ?? null}))
      AND (${query.aircraftModel ?? null}::text IS NULL OR s.scope_key::jsonb->>'aircraftModel'=${query.aircraftModel ?? null})
      ${tailFilter} ${rowFilters}
    ORDER BY s.imported_at DESC,s.snapshot_id DESC LIMIT ${(query.limit ?? 50) + 1}`;
}

function summary(row: SnapshotRow): LcmSnapshotSummary {
  const byteLength: number = Number(row.originalByteLength);
  if (!Number.isSafeInteger(byteLength) || byteLength < 1)
    throw lcmReadingError('LCM_ORIGINAL_METADATA_INVALID', 409);
  const { artifactRef, ...publicRow } = row;
  return {
    ...publicRow,
    originalByteLength: byteLength,
    originalAvailability: lcmOriginalReference(artifactRef)
      ? 'HOST_FILE_SERVICE'
      : 'LOCAL_REFERENCE_ONLY',
    sourceObservedAt:
      row.sourceObservedAt === null
        ? null
        : new Date(row.sourceObservedAt).toISOString(),
    importedAt: new Date(row.importedAt).toISOString(),
    sourceEffectiveAt: null,
    completeness: 'UNVERIFIED',
    sourceAuthority: 'unverified/local',
    candidateOnly: true,
    liveExternalVerified: false,
  };
}
