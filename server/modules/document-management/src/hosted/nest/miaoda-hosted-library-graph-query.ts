import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql, type SQL } from 'drizzle-orm';
import type {
  CanonicalLibraryGraphRequest,
  LibraryGraphCluster,
  LibraryGraphFamily,
  LibraryGraphVersion,
} from '@shared/library-graph.interface';
import { tenantFamilyIdentityPrefix } from './miaoda-hosted-document-catalog';

export interface OwnedLibraryGraphQuery {
  tenantId: string;
  actorUserId: string;
  request: CanonicalLibraryGraphRequest;
  fleetMentionValues?: string[];
  after: { value: string | null } | null;
  limit: number;
}
export interface OwnedLibraryGraphResult {
  uniqueFamilyCount: number;
  readableVersionCountInMatchingFamilies: number;
  invalidData: boolean;
  items: Array<LibraryGraphCluster | LibraryGraphFamily | LibraryGraphVersion>;
}

/** The same actor-owned-task OR exact-acquisition predicate as the rich catalog.
 * No RLS/session settings, grants, content reads, or permission caching here.
 */
function visibility(input: OwnedLibraryGraphQuery): SQL {
  return sql`starts_with(f.canonical_identity_key, ${tenantFamilyIdentityPrefix(input.tenantId)})
    and (exists (select 1 from dm_document d
      where d.document_id=v.document_id and d.family_id=v.family_id)) is true
    and (exists (select 1 from work_item w
      where w.tenant_id=${input.tenantId} and w.requested_by_user_id=${input.actorUserId}
        and w.document_id=v.document_id and w.document_version_id=v.document_version_id)
      or exists (select 1 from dm_acquisition a
        where a.document_version_id=v.document_version_id and a.source_artifact_id=v.source_artifact_id
          and a.acquired_by=${input.actorUserId}
          and a.status in ('COMMITTED_CANONICAL','LINKED_EXACT_DOCUMENT_VERSION')
          and starts_with(a.idempotency_key, ${`tenant:${encodeURIComponent(input.tenantId)}:request:`})))`;
}
// Document/family consistency is an existence check, not a second selective
// join on two correlated identities. That join badly underestimates large
// families and can produce a full family-by-version nested-loop comparison.
// IS TRUE keeps this Boolean identity check out of the join selectivity chain;
// EXISTS itself is non-null, so this changes no authorization semantics.
const joins = sql`dm_publication_family f
  join dm_document_version v on v.family_id=f.family_id`;

/** One statement gives counts and page one snapshot. Pages remain live reads.
 * At most limit+1 rows enter outgoing JSON. Aggregate DB work is scope-sized.
 */
export function libraryGraphStatement(input: OwnedLibraryGraphQuery): SQL {
  const { request, after, limit } = input;
  if (request.level === 'versions') {
    // Anchor before authorization; deliberately no metadata or prior-filter join.
    return sql`with visible as materialized (
      select v.document_version_id, v.business_revision, v.committed_at,
        coalesce(v.document_version_id=f.current_document_version_id,false) as is_current
      from ${joins} where f.family_id=${request.familyId} and ${visibility(input)}
    ), page as (
      select * from visible ${after ? sql`where document_version_id collate "C" > ${after.value} collate "C"` : sql``}
      order by document_version_id collate "C" limit ${limit + 1}
    ) select
      (case when exists(select 1 from visible) then 1 else 0 end)::integer as "uniqueFamilyCount",
      (select count(*)::integer from visible) as "readableVersionCountInMatchingFamilies",
      coalesce((select bool_or(document_version_id is null or octet_length(document_version_id)>384 or length(document_version_id)>96
        or business_revision is null or octet_length(business_revision)>2048 or length(business_revision)>512 or committed_at is null) from page),false) as "invalidData",
      coalesce((select jsonb_agg(jsonb_build_object('kind','VERSION',
        'documentVersionId',case when octet_length(document_version_id)<=384 then document_version_id end,
        'businessRevision',case when octet_length(business_revision)<=2048 then business_revision end,
        'committedAt',committed_at,'isCurrent',is_current) order by document_version_id collate "C") from page),'[]'::jsonb) as items`;
  }
  const pattern = `%${(request.search ?? '').replace(/[\\%_]/gu, '\\$&')}%`;
  const search = request.search
    ? sql`(f.canonical_document_number ilike ${pattern}
    or f.document_family ilike ${pattern} or f.issuer_authority ilike ${pattern}
    or v.original_filename ilike ${pattern} or v.business_revision ilike ${pattern}
    or exists(select 1 from jsonb_each(case when jsonb_typeof(m.extracted_metadata)='object'
      then m.extracted_metadata else '{}'::jsonb end) field,
      jsonb_array_elements(case when jsonb_typeof(field.value->'observations')='array'
        then field.value->'observations' else '[]'::jsonb end) observation
      where field.key in ('title','documentType','issuer','ata','mentionedAircraftModels')
        and observation->>'value' ilike ${pattern}))`
    : sql`true`;
  const classFilter = request.normalizedFamily
    ? sql`normalized_family=${request.normalizedFamily === '__UNKNOWN__' ? '' : request.normalizedFamily}`
    : sql`true`;
  const ataFilter = request.ata
    ? request.ata === '__UNKNOWN__'
      ? sql`cardinality(ata_values)=0`
      : sql`${request.ata}=any(ata_values)`
    : sql`true`;
  const aircraftFilter = request.aircraftModel
    ? request.aircraftModel === '__UNKNOWN__'
      ? sql`cardinality(aircraft_values)=0`
      : sql`${request.aircraftModel}=any(aircraft_values)`
    : sql`true`;
  const fleetFilter = input.fleetMentionValues
    ? sql`exists(select 1 from unnest(aircraft_values) mention(value)
      where upper(btrim(mention.value)) in (${sql.join(
        input.fleetMentionValues.map((value) => sql`${value}`),
        sql`, `,
      )}))`
    : sql`true`;
  const classMembers =
    request.groupBy === 'normalizedFamily'
      ? sql`select nullif(normalized_family,'') as value`
      : sql`select value from unnest(
        case when cardinality(ata_values)=0 then array[null::text] else ata_values end) a(value)`;
  const anchor =
    request.level === 'families'
      ? sql`where value is not distinct from ${request.clusterValue}::text`
      : sql``;
  const cursor = after
    ? request.level === 'clusters'
      ? after.value === null
        ? sql`where value is not null`
        : sql`where value collate "C" > ${after.value} collate "C"`
      : sql`where family_id collate "C" > ${after.value} collate "C"`
    : sql``;
  const page =
    request.level === 'clusters'
      ? sql`select value,count(*)::integer as family_count,sum(version_count)::integer as version_count
      from members group by value`
      : sql`select * from members ${anchor}`;
  const order =
    request.level === 'clusters'
      ? sql`value collate "C" asc nulls first`
      : sql`family_id collate "C"`;
  const items =
    request.level === 'clusters'
      ? sql`jsonb_build_object('kind','CLASSIFICATION','value',case when octet_length(value)<=384 then value end,
        'uniqueFamilyCount',family_count,'readableVersionCountInMatchingFamilies',version_count)`
      : sql`jsonb_build_object('kind','FAMILY',
        'familyId',case when octet_length(family_id)<=384 then family_id end,
        'documentId',case when octet_length(document_id)<=384 then document_id end,
        'documentCode',case when octet_length(document_code)<=2048 then document_code end,
        'normalizedFamily',case when octet_length(normalized_family)<=384 then normalized_family end,
        'readableVersionCount',version_count)`;
  return sql`with visible as materialized (
    select f.family_id,v.document_id,f.canonical_document_number as document_code,
      f.document_family as normalized_family,v.document_version_id,${search} as search_match,
      coalesce(jsonb_path_query_array(m.extracted_metadata,'$.ata.observations[*].value'),'[]'::jsonb) as ata_values,
      coalesce(jsonb_path_query_array(m.extracted_metadata,'$.mentionedAircraftModels.observations[*].value'),'[]'::jsonb) as aircraft_values
    from ${joins}
    left join lateral (select extracted_metadata from dm_document_version_metadata metadata
      where metadata.document_version_id=v.document_version_id order by metadata_revision desc limit 1) m on true
    where ${visibility(input)}
  ), family_values as (
    select family_id,document_id,document_code,normalized_family,count(*)::integer as version_count,
      bool_or(search_match) as search_match,
      jsonb_path_query_array(jsonb_agg(ata_values),'$[*][*]') as ata_json,
      jsonb_path_query_array(jsonb_agg(aircraft_values),'$[*][*]') as aircraft_json
    from visible group by family_id,document_id,document_code,normalized_family
  ), families as materialized (
    select family_id,document_id,document_code,normalized_family,version_count,search_match,
      exists(select 1 from jsonb_array_elements(ata_json) value
        where jsonb_typeof(value)<>'string' or octet_length(value#>>'{}')>384 or length(value#>>'{}')>96) as invalid_ata,
      exists(select 1 from jsonb_array_elements(aircraft_json) value
        where jsonb_typeof(value)<>'string' or octet_length(value#>>'{}')>384 or length(value#>>'{}')>96) as invalid_aircraft,
      array(select distinct value#>>'{}' from jsonb_array_elements(ata_json) value
        where jsonb_typeof(value)='string') as ata_values,
      array(select distinct value#>>'{}' from jsonb_array_elements(aircraft_json) value
        where jsonb_typeof(value)='string') as aircraft_values
    from family_values
  ), filtered as materialized (
    select * from families where search_match and ${classFilter} and ${ataFilter} and ${aircraftFilter} and ${fleetFilter}
  ), members as materialized (
    select filtered.*,classification.value from filtered cross join lateral (${classMembers}) classification
  ), selected as materialized (${page}), page as (
    select * from selected ${cursor} order by ${order} limit ${limit + 1}
  ) select
    (select count(*)::integer from ${request.level === 'clusters' ? sql`filtered` : sql`selected`}) as "uniqueFamilyCount",
    (select coalesce(sum(version_count),0)::integer from ${request.level === 'clusters' ? sql`filtered` : sql`selected`}) as "readableVersionCountInMatchingFamilies",
    (exists(select 1 from families where search_match and ${classFilter} and (invalid_ata or invalid_aircraft))
      or exists(select 1 from filtered where family_id is null or octet_length(family_id)>384 or length(family_id)>96
      or document_id is null or octet_length(document_id)>384 or length(document_id)>96
      or document_code is null or octet_length(document_code)>2048 or length(document_code)>512
      or normalized_family is null or octet_length(normalized_family)>384 or length(normalized_family)>96)) as "invalidData",
    coalesce((select jsonb_agg(${items} order by ${order}) from page),'[]'::jsonb) as items`;
}

export async function listOwnedLibraryGraph(
  db: PostgresJsDatabase,
  input: OwnedLibraryGraphQuery,
): Promise<OwnedLibraryGraphResult[]> {
  return db.execute<OwnedLibraryGraphResult & Record<string, unknown>>(
    libraryGraphStatement(input),
  );
}
