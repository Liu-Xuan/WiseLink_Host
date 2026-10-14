import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql, type SQL } from 'drizzle-orm';
import type { CanonicalLibraryDirectoryResponse } from '@shared/library-directory.interface';
import { tenantFamilyIdentityPrefix } from '../document-management/src/hosted/nest/miaoda-hosted-document-catalog';

export interface OwnedCanonicalLibraryDirectoryQuery {
  tenantId: string;
  actorUserId: string;
  search: string;
  normalizedFamily?: string;
  aircraftModel?: string;
  aircraftModels?: string[];
  layout?: 'ATA';
  ata2?: string;
  fleetMentionValues?: string[];
}

/** Standard separated and compact codes have one deterministic parent. Raw values survive. */
export function libraryAtaClassificationRows(values: SQL): SQL {
  return sql`select raw_value,
    case when code ~ '^([0-9]{2}|[0-9]{4}|[0-9]{6}|[0-9]{2}-[0-9]{2}(-[0-9]{2})?)$'
      then left(replace(code,'-',''),2)
      when code is null or code='' then '__UNKNOWN__' else '__RAW__' end as ata2,
    case when code ~ '^([0-9]{4}|[0-9]{6}|[0-9]{2}-[0-9]{2}(-[0-9]{2})?)$'
      then left(replace(code,'-',''),2)||'-'||substr(replace(code,'-',''),3,2)
      else null end as ata4
    from (select value as raw_value,btrim(value) as code
      from jsonb_array_elements_text(case
        when jsonb_typeof(${values})='array' and jsonb_array_length(${values})>0
        then ${values} else '[null]'::jsonb end) raw(value)) classification`;
}

/** The rich family page and aggregate directory use precisely the same node predicate. */
export function libraryAtaNodeFilter(
  values: SQL,
  ata2?: string,
  ata4?: string,
): SQL | undefined {
  if (!ata2 && !ata4) return undefined;
  return sql`exists(select 1 from (${libraryAtaClassificationRows(values)}) node
    where ${ata2 ? sql`node.ata2=${ata2}` : sql`true`}
      and ${
        ata4 === '__DIRECT__'
          ? sql`node.ata4 is null and node.ata2 not in ('__UNKNOWN__','__RAW__')`
          : ata4 === '__UNKNOWN__' || ata4 === '__RAW__'
            ? sql`node.ata2=${ata4}`
            : ata4
              ? sql`node.ata4=${ata4}`
              : sql`true`
      })`;
}

export function libraryAircraftNodeFilter(
  values: SQL,
  aircraftModel?: string,
  aircraftModels?: string[],
): SQL | undefined {
  if (aircraftModels) {
    const known: string[] = aircraftModels.filter((value: string) => value !== '__UNKNOWN__');
    const exact: SQL = known.length ? sql`exists(select 1 from jsonb_array_elements_text(${values}) mention(value)
      where btrim(mention.value) in (${sql.join(known.map((value: string) => sql`${value}`), sql`, `)}))` : sql`false`;
    return aircraftModels.includes('__UNKNOWN__')
      ? sql`(${exact} or not exists(select 1 from jsonb_array_elements_text(${values}) mention(value)
          where nullif(btrim(value),'') is not null))` : exact;
  }
  if (!aircraftModel) return undefined;
  return aircraftModel === '__UNKNOWN__'
    ? sql`not exists(select 1 from jsonb_array_elements_text(${values}) mention(value)
        where nullif(btrim(value),'') is not null)`
    : sql`exists(select 1 from jsonb_array_elements_text(${values}) mention(value)
        where btrim(mention.value)=${aircraftModel})`;
}

function visibility(input: OwnedCanonicalLibraryDirectoryQuery): SQL {
  return sql`starts_with(f.canonical_identity_key,${tenantFamilyIdentityPrefix(input.tenantId)})
    and (exists(select 1 from dm_document d
      where d.document_id=v.document_id and d.family_id=v.family_id)) is true
    and (exists(select 1 from work_item w where w.tenant_id=${input.tenantId}
      and w.document_id=v.document_id and w.document_version_id=v.document_version_id
      and w.source_artifact_id=v.source_artifact_id
      and w.source_file_sha256=v.pdf_sha256 and w.source_byte_length=v.byte_length)
      or exists(select 1 from dm_acquisition a where a.document_version_id=v.document_version_id
        and a.source_artifact_id=v.source_artifact_id
        and a.status in ('COMMITTED_CANONICAL','LINKED_EXACT_DOCUMENT_VERSION')
        and starts_with(a.idempotency_key,${`tenant:${encodeURIComponent(input.tenantId)}:request:`})))`;
}

/** Classification uses only the explicit readable current version. Counts retain its family's
 * complete visible formal history, matching listDocuments().versions, without reading bodies.
 */
export function canonicalLibraryDirectoryStatement(
  input: OwnedCanonicalLibraryDirectoryQuery,
): SQL {
  const level: CanonicalLibraryDirectoryResponse['level'] = input.ata2
    ? 'ATA4'
    : input.layout === 'ATA' || input.aircraftModel || input.aircraftModels
      ? 'ATA2'
      : 'AIRCRAFT_MODEL';
  const pattern: string = `%${input.search.replace(/[\\%_]/gu, '\\$&')}%`;
  const search: SQL = input.search
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
  const ataFilter: SQL | undefined = libraryAtaNodeFilter(
    sql`ata_values`,
    input.ata2,
  );
  const aircraftFilter: SQL | undefined = libraryAircraftNodeFilter(
    sql`aircraft_values`,
    input.aircraftModel,
    input.aircraftModels,
  );
  const fleetFilter: SQL = input.fleetMentionValues
    ? sql`exists(select 1 from jsonb_array_elements_text(aircraft_values) mention(value)
      where upper(btrim(mention.value)) in (${sql.join(
        input.fleetMentionValues.map((value: string) => sql`${value}`),
        sql`, `,
      )}))`
    : sql`true`;
  const members: SQL =
    level === 'AIRCRAFT_MODEL'
      ? sql`select f.family_id,f.version_count,a.value,a.raw_value,
        true as has_children,exists(select 1 from ata_members direct
          where direct.family_id=f.family_id and direct.ata4 is null
            and direct.ata2 not in ('__UNKNOWN__','__RAW__')) as is_direct
      from filtered f cross join lateral (
        select coalesce(nullif(btrim(value),''),'__UNKNOWN__') as value,value as raw_value
        from jsonb_array_elements_text(case when jsonb_array_length(f.aircraft_values)=0
          then '[null]'::jsonb else f.aircraft_values end) raw(value)) a`
      : level === 'ATA2'
        ? sql`select family_id,version_count,ata2 as value,raw_value,
          ata4 is not null as has_children,
          ata4 is null and ata2 not in ('__UNKNOWN__','__RAW__') as is_direct from ata_members`
        : sql`select family_id,version_count,ata4 as value,raw_value,
          false as has_children,false as is_direct from ata_members
          where ata2=${input.ata2} and ata4 is not null`;
  return sql`with visible as materialized (
    select f.family_id,v.document_id,f.document_family as normalized_family,v.document_version_id,
      coalesce(v.document_version_id=f.current_document_version_id,false) as is_current,
      ${search} as search_match,
      coalesce(jsonb_path_query_array(m.extracted_metadata,'$.ata.observations[*].value'),'[]'::jsonb) as ata_values,
      coalesce(jsonb_path_query_array(m.extracted_metadata,'$.mentionedAircraftModels.observations[*].value'),'[]'::jsonb) as aircraft_values
    from dm_publication_family f join dm_document_version v on v.family_id=f.family_id
    left join lateral(select extracted_metadata from dm_document_version_metadata metadata
      where metadata.document_version_id=v.document_version_id order by metadata_revision desc limit 1) m
      on m.extracted_metadata->>'sourceSha256'=v.pdf_sha256
        and m.extracted_metadata->>'sourceByteLength'=v.byte_length::text
    where ${visibility(input)}
  ), families as materialized (
    select family_id,count(distinct document_version_id)::integer as version_count,
      normalized_family,bool_or(search_match) as search_match,
      coalesce(jsonb_path_query_array(jsonb_agg(ata_values) filter(where is_current),'$[*][*]'),'[]'::jsonb) as ata_values,
      coalesce(jsonb_path_query_array(jsonb_agg(aircraft_values) filter(where is_current),'$[*][*]'),'[]'::jsonb) as aircraft_values
    from visible group by family_id,normalized_family
  ), filtered as materialized (
    select * from families where search_match
      and ${
        input.normalizedFamily
          ? sql`normalized_family=${input.normalizedFamily === '__UNKNOWN__' ? '' : input.normalizedFamily}`
          : sql`true`
      }
      and ${aircraftFilter ?? sql`true`} and ${fleetFilter} and ${ataFilter ?? sql`true`}
  ), ata_members as materialized (
    select f.family_id,f.version_count,classification.*
    from filtered f cross join lateral (${libraryAtaClassificationRows(sql`f.ata_values`)}) classification
  ), direct_families as (
    select distinct family_id,version_count from ata_members
    where ata4 is null and ata2 not in ('__UNKNOWN__','__RAW__')
      ${input.ata2 ? sql`and ata2=${input.ata2}` : sql``}
  ), members as (${members}), node_families as (
    select value,family_id,max(version_count)::integer as version_count,
      bool_or(has_children) as has_children,bool_or(is_direct) as is_direct
    from members group by value,family_id
  ), nodes as (
    select value,count(*)::integer as document_count,sum(version_count)::integer as version_count,
      count(*) filter(where is_direct)::integer as direct_document_count,
      coalesce(sum(version_count) filter(where is_direct),0)::integer as direct_version_count,
      bool_or(has_children) as has_children,
      array(select distinct raw_value from members raw where raw.value=node_families.value
        and raw_value is not null order by raw_value) as raw_values
    from node_families group by value
  ) select 'TENANT_DOCUMENT_CATALOG' as scope,${level}::text as level,
    (select count(*)::integer from filtered) as "documentCount",
    (select coalesce(sum(version_count),0)::integer from filtered) as "versionCount",
    (select count(*)::integer from direct_families) as "directDocumentCount",
    (select coalesce(sum(version_count),0)::integer from direct_families) as "directVersionCount",
    coalesce((select jsonb_agg(jsonb_build_object('level',${level}::text,'value',value,
      'documentCount',document_count,'versionCount',version_count,
      'directDocumentCount',direct_document_count,'directVersionCount',direct_version_count,
      'rawValues',raw_values,'hasChildren',has_children) order by value collate "C") from nodes),'[]'::jsonb) as nodes`;
}

export async function readCanonicalLibraryDirectory(
  db: PostgresJsDatabase,
  input: OwnedCanonicalLibraryDirectoryQuery,
): Promise<CanonicalLibraryDirectoryResponse> {
  const [result] = await db.execute<
    CanonicalLibraryDirectoryResponse & Record<string, unknown>
  >(canonicalLibraryDirectoryStatement(input));
  if (!result) throw new Error('LIBRARY_DIRECTORY_READBACK_MISSING');
  return result;
}
