import type postgres from 'postgres';
import type {
  LcmConfigurationQuery, LcmNeighborhoodResult, LcmQueryResult, LcmTimelineEntry,
} from '../../../shared/lcm-configuration-store.interface';
import type { LcmCandidateRecord } from '../../../shared/lcm-export-staging.interface';
import { LcmStagingError } from './lcm-export.helpers';
import { requiredDay, requiredText, requiredZonedTime } from './lcm-collection-context';
import { setDatabaseActor, validateDatabaseScope } from './lcm-configuration.repository';

interface TimelineRow {
  snapshotId: string; sourceInstanceId: string; collectionId: string; scopeKey: string;
  sourceObservedAt: Date | null; importedAt: Date; sourceExportedAt: string | null;
  sourceObservedDate: string | null; sourceTimeZone: string | null; sourceTimePrecision: 'day' | 'instant' | 'unknown';
  sameDayOrderingBasis: 'source-observed-at' | 'acquisition-sequence';
  rawSha256: string; artifactRef: string; record: LcmCandidateRecord;
}
type RelationRow = Omit<LcmNeighborhoodResult['relations'][number], 'liveExternalVerified'>;

function validateQuery(query: LcmConfigurationQuery): void {
  validateDatabaseScope(query.scope);
  if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 500) {
    throw new LcmStagingError('QUERY_LIMIT_INVALID', 'Query limit must be 1 to 500.');
  }
  if (!query.tailNumber && !query.partNumber) throw new LcmStagingError('QUERY_ANCHOR_REQUIRED', 'Exact aircraft or PN is required.');
  if (query.tailNumber) requiredText(query.tailNumber);
  if (query.partNumber) requiredText(query.partNumber);
  if (query.asOf) requiredZonedTime(query.asOf);
  if (query.asOfDate) requiredDay(query.asOfDate);
  if (query.asOf && query.asOfDate) throw new LcmStagingError('QUERY_TIME_INVALID', 'Choose day or instant precision.');
  if (query.asOfDate && query.timeZone !== 'Asia/Shanghai') throw new LcmStagingError('QUERY_TIME_INVALID', 'Day queries require source timezone.');
  if (query.from) requiredZonedTime(query.from);
  if (query.to) requiredZonedTime(query.to);
  if (query.from && query.to && Date.parse(query.from) > Date.parse(query.to)) {
    throw new LcmStagingError('QUERY_RANGE_INVALID', 'Time window starts after it ends.');
  }
}

/** Bounded queries. No caller SQL, current-fleet substitution or adoption. */
export class LcmConfigurationQueryService {
  constructor(private readonly sql: postgres.Sql) {}

  async history(query: LcmConfigurationQuery): Promise<LcmQueryResult> {
    return this.readEntries(query, false);
  }

  async asOf(query: LcmConfigurationQuery): Promise<LcmQueryResult> {
    if (!query.asOf && !query.asOfDate) throw new LcmStagingError('QUERY_TIME_REQUIRED', 'Observed as-of requires an explicit day or instant cutoff.');
    return this.readEntries(query, true);
  }

  private async readEntries(query: LcmConfigurationQuery, latest: boolean): Promise<LcmQueryResult> {
    validateQuery(query);
    return this.sql.begin(async (tx: postgres.TransactionSql): Promise<LcmQueryResult> => {
      await setDatabaseActor(tx, query.scope);
      if (latest && query.asOf) {
        const blockers: Array<{count:number}> = await tx<Array<{count:number}>>`
          SELECT count(*)::int AS count FROM lcm_source_collection
          WHERE tenant_id=${query.scope.tenantId} AND owner_actor_id=${query.scope.actorId}
            AND source_instance_id=ANY(${tx.array(query.scope.authorizedSourceInstanceIds)}::text[])
            AND source_time_precision='day'
            AND source_observed_date<=(${query.asOf}::timestamptz AT TIME ZONE 'Asia/Shanghai')::date`;
        if (blockers[0].count>0) throw new LcmStagingError('SOURCE_TIME_PRECISION_INSUFFICIENT',
          'Authorized day-level snapshots cannot establish an instant as-of; use asOfDate.');
      }
      const rows: TimelineRow[] = await tx<TimelineRow[]>`
        WITH authorized AS (
          SELECT s.*,c.source_observed_at,c.source_observed_date,c.source_time_zone,c.source_time_precision,
            c.imported_at AS collection_imported_at,c.acquisition_sequence
          FROM lcm_configuration_snapshot s JOIN lcm_source_collection c
            USING(tenant_id,owner_actor_id,source_instance_id,collection_id)
          WHERE s.tenant_id=${query.scope.tenantId} AND s.owner_actor_id=${query.scope.actorId}
            AND s.source_instance_id=ANY(${tx.array(query.scope.authorizedSourceInstanceIds)}::text[])
            AND (${query.asOf ?? null}::timestamptz IS NULL OR c.source_observed_at<=${query.asOf ?? null}::timestamptz)
            AND (${query.asOfDate ?? null}::date IS NULL OR
              (COALESCE(c.source_observed_date,(c.source_observed_at AT TIME ZONE 'Asia/Shanghai')::date)
                <=${query.asOfDate ?? null}::date AND (c.source_time_zone=${query.timeZone ?? null} OR c.source_time_precision='instant')))
            AND (${query.from ?? null}::timestamptz IS NULL OR c.source_observed_at>=${query.from ?? null}::timestamptz)
            AND (${query.to ?? null}::timestamptz IS NULL OR c.source_observed_at<=${query.to ?? null}::timestamptz)
        ), granularity AS (
          SELECT *,bool_or(source_time_precision='day') OVER (
            PARTITION BY source_instance_id,scope_key,
              COALESCE(source_observed_date,(source_observed_at AT TIME ZONE 'Asia/Shanghai')::date)
          ) AS has_day_on_source_day FROM authorized
        ), ranked AS (
          SELECT *,row_number() OVER (PARTITION BY source_instance_id,scope_key
            ORDER BY ${query.asOf ? tx`source_observed_at DESC NULLS LAST`
              : tx`COALESCE(source_observed_date,(source_observed_at AT TIME ZONE 'Asia/Shanghai')::date) DESC NULLS LAST`},
              CASE WHEN has_day_on_source_day THEN NULL ELSE source_observed_at END DESC NULLS LAST,
              acquisition_sequence DESC,snapshot_id DESC) AS ordinal
          FROM granularity
        )
        SELECT s.snapshot_id AS "snapshotId",s.source_instance_id AS "sourceInstanceId",s.collection_id AS "collectionId",
          s.scope_key AS "scopeKey",s.source_observed_at AS "sourceObservedAt",s.imported_at AS "importedAt",
          s.source_exported_at AS "sourceExportedAt",s.artifact_sha256 AS "rawSha256",a.artifact_ref AS "artifactRef",
          s.source_observed_date::text AS "sourceObservedDate",s.source_time_zone AS "sourceTimeZone",
          s.source_time_precision AS "sourceTimePrecision",
          CASE WHEN s.has_day_on_source_day OR s.source_time_precision='unknown' THEN 'acquisition-sequence'
            ELSE 'source-observed-at' END AS "sameDayOrderingBasis",
          o.record_json AS record
        FROM ranked s JOIN lcm_configuration_observation o USING(tenant_id,owner_actor_id,snapshot_id)
          JOIN lcm_source_artifact a ON a.tenant_id=s.tenant_id AND a.owner_actor_id=s.owner_actor_id
            AND a.sha256=s.artifact_sha256
        WHERE (${!latest} OR s.ordinal=1)
          AND (${query.tailNumber ?? null}::text IS NULL OR o.tail_number=${query.tailNumber ?? null})
          AND (${query.partNumber ?? null}::text IS NULL OR o.part_number=${query.partNumber ?? null})
        ORDER BY COALESCE(s.source_observed_date,(s.source_observed_at AT TIME ZONE 'Asia/Shanghai')::date)
          DESC NULLS LAST,CASE WHEN s.has_day_on_source_day THEN NULL ELSE s.source_observed_at END DESC NULLS LAST,
          s.acquisition_sequence DESC,s.snapshot_id,o.record_id
        LIMIT ${query.limit + 1}`;
      return {
        schemaVersion: 'wiselink.lcm.configuration_query.v1', mode: 'READ_ONLY_LOCAL_CANDIDATE',
        entries: rows.slice(0, query.limit).map((row: TimelineRow): LcmTimelineEntry => ({
          ...row, sourceObservedAt: row.sourceObservedAt?.toISOString() ?? null,
          importedAt: row.importedAt.toISOString(), candidateOnly: true, liveExternalVerified: false,
        })), limit: query.limit, truncated: rows.length > query.limit,
        unknownObservedTimesExcluded: Boolean(query.asOf || query.asOfDate || query.from || query.to),
        queryTimeBasis: query.asOfDate ? 'source-day' : query.asOf ? 'source-instant' : 'history',
        dayPrecisionExcluded: Boolean(query.asOf || query.from || query.to),
      };
    });
  }

  async neighborhood(query: LcmConfigurationQuery): Promise<LcmNeighborhoodResult> {
    const history: LcmQueryResult = await this.history(query);
    if (history.entries.length === 0) return { ...history, relations: [], relationLimit: query.limit, relationsTruncated: false };
    const pairs: string[][] = history.entries.map((entry: LcmTimelineEntry) => [entry.snapshotId, entry.record.recordId]);
    const relations: RelationRow[] = await this.sql.begin(async (tx: postgres.TransactionSql): Promise<RelationRow[]> => {
      await setDatabaseActor(tx, query.scope);
      return tx<RelationRow[]>`SELECT r.snapshot_id AS "snapshotId",r.source_record_id AS "sourceRecordId",
        r.target_source_instance_id AS "targetSourceInstanceId",r.target_kind AS "targetKind",r.target_id AS "targetId",
        r.target_version_id AS "targetVersionId",r.relation,r.evidence
        FROM lcm_evidence_relation r JOIN lcm_configuration_snapshot s USING(tenant_id,owner_actor_id,snapshot_id)
        WHERE r.tenant_id=${query.scope.tenantId} AND r.owner_actor_id=${query.scope.actorId}
          AND s.source_instance_id=ANY(${tx.array(query.scope.authorizedSourceInstanceIds)}::text[])
          AND r.target_source_instance_id=ANY(${tx.array(query.scope.authorizedSourceInstanceIds)}::text[])
          AND jsonb_build_array(r.snapshot_id,r.source_record_id) IN
            (SELECT jsonb_array_elements(${tx.json(pairs)}::jsonb))
        ORDER BY r.snapshot_id,r.relation_id LIMIT ${query.limit + 1}`;
    });
    return { ...history, relations: relations.slice(0, query.limit).map((row: RelationRow) => ({ ...row, liveExternalVerified: false })),
      relationLimit: query.limit, relationsTruncated: relations.length > query.limit };
  }
}
