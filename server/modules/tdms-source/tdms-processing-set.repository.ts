import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';
import type {
  TdmsProcessingRevisionSet,
  TdmsProcessingSetHead,
} from '@shared/tdms-processing-set.interface';
import type {
  TdmsSourceScope,
  TdmsStoredAssertion,
  TdmsStoredRevision,
} from './tdms-source.types';
import { tdmsError } from './tdms-source.types';
import { SqlTdmsTransaction } from './tdms-source.repository';
import type {
  TdmsProcessingSetRepository,
  TdmsProcessingSetTransaction,
  TdmsStoredRevisionMetadata,
  TdmsProcessingCaptureIndex,
  TdmsProcessingCaptureProof,
  TdmsProcessingProducerTransaction,
} from './tdms-processing-set.types';
import {
  retainedCaptureIndex,
  retainedCaptureProof,
} from './tdms-processing-set-source-facts';
import { TDMS_PROCESSING_METADATA_FIELDS } from './tdms-processing-set.types';

/** Existing actor-scoped transaction repository; the producer hands its transaction directly to the SQL adapter. */
export class MiaodaTdmsProcessingSetRepository implements TdmsProcessingSetRepository {
  constructor(private readonly db: PostgresJsDatabase) {}
  transaction<T>(
    operation: (tx: TdmsProcessingSetTransaction) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction((db) =>
      operation(new SqlTdmsProcessingSetTransaction(db)),
    );
  }
}
export class SqlTdmsProcessingSetTransaction
  extends SqlTdmsTransaction
  implements TdmsProcessingProducerTransaction
{
  constructor(private readonly setDb: Pick<PostgresJsDatabase, 'execute'>) {
    super(setDb);
  }
  override async revision(tenantId: string, ref: string) {
    const rows = await this.setDb.execute<{
      data: TdmsStoredRevision;
      data_kind: string;
    }>(
      sql`SELECT data,jsonb_typeof(data) AS data_kind FROM tdms_record_revision WHERE tenant_id=${tenantId} AND source_revision_ref=${ref}`,
    );
    if (!rows[0]) return null;
    if (rows[0].data_kind !== 'object')
      throw tdmsError('TDMS_SET_STORED_DATA_INVALID', 409);
    return storedData(rows[0].data);
  }
  async revisionMetadata(tenantId: string, ref: string) {
    const rows = await this.setDb.execute<{
      data: TdmsStoredRevisionMetadata;
      data_kind: string;
      record_kind: string;
      raw_fields_kind: string;
    }>(sql`SELECT jsonb_build_object('scope',data->'scope','record',
      (SELECT coalesce(jsonb_object_agg(field.key,field.value),'{}'::jsonb)
        FROM jsonb_each(CASE WHEN jsonb_typeof(data->'record')='object'
          THEN data->'record' ELSE '{}'::jsonb END) AS field
        WHERE field.key IN (${sql.join(
          TDMS_PROCESSING_METADATA_FIELDS.map((key) => sql`${key}`),
          sql`, `,
        )}))
      || jsonb_build_object('rawFields',jsonb_build_object(
        'sourceModifiedRaw',data#>'{record,rawFields,sourceModifiedRaw}',
        'opinionCollection',data#>'{record,rawFields,opinionCollection}'))) AS data,
      jsonb_typeof(data) AS data_kind,jsonb_typeof(data->'record') AS record_kind,
      jsonb_typeof(data#>'{record,rawFields}') AS raw_fields_kind
      FROM tdms_record_revision WHERE tenant_id=${tenantId} AND source_revision_ref=${ref}`);
    if (!rows[0]) return null;
    if (
      [rows[0].data_kind, rows[0].record_kind, rows[0].raw_fields_kind].some(
        (kind) => kind !== 'object',
      )
    )
      throw tdmsError('TDMS_SET_STORED_DATA_INVALID', 409);
    return storedData(rows[0].data);
  }
  async processingCaptureIndex(
    s: TdmsSourceScope,
    captureRef: string,
    packageId?: string,
  ): Promise<TdmsProcessingCaptureIndex | null> {
    const rows = await this.setDb.execute<{ data: unknown }>(sql`
      SELECT jsonb_build_object('scope',data->'scope','packageId',package_id,
        'packageHash',data->'packageHash','captureRef',capture_ref,
        'applicationScopeId',data#>'{dailyMetadata,applicationScopeId}',
        'records',data#>'{dailyMetadata,nativeRetention,records}',
        'relations',data#>'{dailyMetadata,nativeRetention,relations}',
        'artifacts',data#>'{dailyMetadata,nativeRetention,artifacts}',
        'recordRevisionRefs',data#>'{receipt,recordRevisionRefs}',
        'assertionRefs',data#>'{receipt,assertionRefs}') AS data
      FROM tdms_capture WHERE ${scope(s)} AND capture_ref=${captureRef}
        ${packageId === undefined ? sql`` : sql`AND package_id=${packageId}`} LIMIT 2`);
    if (!rows.length) return null;
    if (rows.length !== 1)
      throw tdmsError('TDMS_PROCESSING_CAPTURE_INVALID', 409);
    return retainedCaptureIndex(rows[0].data);
  }
  /** Called only after exact current retention/member admission. Bodies stay inside SQL comparisons. */
  async processingCaptureProof(
    s: TdmsSourceScope,
    captureRef: string,
  ): Promise<TdmsProcessingCaptureProof | null> {
    const rows = await this.setDb.execute<{ data: unknown }>(sql`
      SELECT jsonb_build_object('captureRef',c.capture_ref,'consistent',coalesce(
        c.data->'scope'=${JSON.stringify(s)}::text::jsonb
        AND c.data->>'packageId'=c.package_id AND c.data#>>'{receipt,packageId}'=c.package_id
        AND c.data#>>'{receipt,captureRef}'=c.capture_ref
        AND c.data#>>'{dailyMetadata,receipt,payloadDigest}'=c.data->>'packageHash'
        AND c.data#>>'{dailyMetadata,envelope,requestId}'=c.data#>>'{dailyMetadata,receipt,requestId}'
        AND c.data#>>'{dailyMetadata,envelope,requestId}'=c.package_id
        AND c.data#>>'{dailyMetadata,adapter,output,nativePackage,packageId}'=c.package_id
        AND c.data#>'{dailyMetadata,adapter,mappings,records}'=
          (SELECT coalesce(jsonb_agg(m.value-'sourceRevisionRef' ORDER BY m.ordinality),'[]'::jsonb)
           FROM jsonb_array_elements(c.data#>'{dailyMetadata,nativeRetention,records}') WITH ORDINALITY m(value,ordinality))
        AND c.data#>'{dailyMetadata,adapter,mappings,relations}'=
          (SELECT coalesce(jsonb_agg(m.value-'assertionRef' ORDER BY m.ordinality),'[]'::jsonb)
           FROM jsonb_array_elements(c.data#>'{dailyMetadata,nativeRetention,relations}') WITH ORDINALITY m(value,ordinality))
        AND jsonb_array_length(c.data#>'{dailyMetadata,envelope,package,records}')=
          jsonb_array_length(c.data#>'{dailyMetadata,nativeRetention,records}')
        AND jsonb_array_length(c.data#>'{dailyMetadata,adapter,output,nativePackage,relations}')=
          jsonb_array_length(c.data#>'{dailyMetadata,nativeRetention,relations}')
        AND jsonb_array_length(c.data#>'{dailyMetadata,envelope,package,edges}')=
          jsonb_array_length(c.data#>'{dailyMetadata,nativeRetention,relations}')
        AND jsonb_array_length(c.data#>'{dailyMetadata,adapter,output,nativePackage,records}')=
          jsonb_array_length(c.data#>'{dailyMetadata,nativeRetention,records}')
        AND c.data#>'{dailyMetadata,adapter,mappings,artifacts}'=
          (SELECT coalesce(jsonb_agg(m.value-'sourceArtifactId'-'acquisitionId' ORDER BY m.ordinality),'[]'::jsonb)
           FROM jsonb_array_elements(c.data#>'{dailyMetadata,nativeRetention,artifacts}') WITH ORDINALITY m(value,ordinality))
        AND c.data#>'{dailyMetadata,adapter,output,artifactObservations}'=c.data#>'{dailyMetadata,envelope,package,artifactBindings}'
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c.data#>'{dailyMetadata,nativeRetention,artifacts}') a
          WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c.data#>'{receipt,artifactBindings}') b
            WHERE b->>'memberId'=a->>'memberId' AND b->>'sourceArtifactId'=a->>'sourceArtifactId'
              AND b->>'acquisitionId'=a->>'acquisitionId' AND b->'sha256'=a->'sha256'
              AND b->'byteLength'=a->'byteLength' AND b->'immutableReadbackVerified'='true'::jsonb
              AND b->'documentVersionId'='null'::jsonb))
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(c.data#>'{dailyMetadata,nativeRetention,relations}') m
          WHERE NOT EXISTS (SELECT 1 FROM tdms_relation_assertion a,
            jsonb_array_elements(c.data#>'{dailyMetadata,adapter,output,nativePackage,relations}') n,
            jsonb_array_elements(c.data#>'{dailyMetadata,envelope,package,edges}') e
            WHERE a.tenant_id=c.tenant_id AND a.source_key=c.source_key
              AND a.source_instance_id=c.source_instance_id AND a.scope_id=c.scope_id
              AND a.assertion_ref=m->>'assertionRef' AND a.data->'scope'=c.data->'scope'
              AND a.data#>>'{assertion,captureRef}'=c.capture_ref
              AND n->>'sourceRelationId'=m->>'nativeRetentionKey' AND e->>'edgeId'=m->>'edgeId'
              AND a.data#>>'{assertion,sourceRelationId}'=e->>'edgeId'
              AND a.data#>>'{assertion,authority}'='CANDIDATE_ONLY'
              AND a.data#>'{assertion,controlledKind}'='null'::jsonb
              AND a.data#>'{assertion,from}'=n->'from' AND a.data#>'{assertion,to}'=n->'to'
              AND n#>>'{from,kind}'='UNRESOLVED' AND n#>>'{to,kind}'='UNRESOLVED'
              AND a.data#>>'{assertion,rawKind}'=n->>'rawKind'
              AND a.data#>>'{assertion,selector}'=e->>'evidenceLocator'
              AND a.data#>>'{assertion,observedAt}'=e->>'observedAt'
              AND a.data#>'{assertion,rawFields,dailyObservedEdge}'=e
              AND n#>'{rawFields,dailyObservedEdge}'=e))
        ,false),'candidates',(
          SELECT coalesce(jsonb_agg(jsonb_build_object('assertionRef',m.value->'assertionRef',
            'sourceRelationId',e->'edgeId','fromSourceRecordId',e->'fromSourceRecordId',
            'toSourceRecordId',e->'toSourceRecordId') ORDER BY m.ordinality),'[]'::jsonb)
          FROM jsonb_array_elements(c.data#>'{dailyMetadata,nativeRetention,relations}') WITH ORDINALITY m(value,ordinality)
          JOIN LATERAL jsonb_array_elements(c.data#>'{dailyMetadata,envelope,package,edges}') e
            ON e->>'edgeId'=m.value->>'edgeId'), 'own',(
          SELECT coalesce(jsonb_agg(jsonb_build_object('sourceRevisionRef',m->>'sourceRevisionRef',
            'scopeId',r#>'{rawFields,completeOwnedSource,scopeId}',
            'owners',(SELECT coalesce(jsonb_agg(jsonb_build_object(
              'sourceRecordId',own_read.value#>'{owner,sourceRecordId}','number',own_read.value#>'{owner,number}',
              'nativeTypeId',own_read.value#>'{owner,nativeTypeId}','sourceVersion',own_read.value#>'{owner,sourceVersion}',
              'businessVersion',own_read.value#>'{owner,businessVersion}','stateRaw',own_read.value#>'{owner,stateRaw}',
              'sourceModifiedRaw',own_read.value#>'{owner,sourceModifiedRaw}','observedAt',own_read.value#>'{owner,observedAt}') ORDER BY own_read.ordinality),
              '[]'::jsonb) FROM jsonb_array_elements(r#>'{rawFields,completeOwnedSource,reads}') WITH ORDINALITY own_read(value,ordinality)),
            'consistent',coalesce(v.data->'scope'=c.data->'scope'
              AND v.data#>>'{record,captureRef}'=c.capture_ref
              AND v.data#>>'{record,sourceRecordId}'=r->>'sourceRecordId'
              AND v.data#>>'{record,recordKind}'=m->>'nativeKind'
              AND v.data#>'{record,sourceVersion}'=r->'sourceVersion'
              AND v.data#>'{record,businessVersion}'=r->'businessVersion'
              AND v.data#>'{record,state}'=r->'state'
              AND v.data#>>'{record,observedAt}'=r->>'observedAt'
              AND v.data#>'{record,rawFields}'=r->'rawFields'
              AND v.data#>'{record,content}'=r->'content'
              AND n->'rawFields'=r->'rawFields' AND n->'content'=r->'content'
              AND n->'sourceVersion'=r->'sourceVersion' AND n->'businessVersion'=r->'businessVersion'
              AND n->>'sourceRecordId'=r->>'sourceRecordId' AND n->>'recordKind'=m->>'nativeKind'
              AND r->>'snapshotId'=m->>'snapshotId' AND r->>'kind'=m->>'sourceKind'
              AND r#>>'{rawFields,completeOwnedSource,schemaVersion}'='wiselink.tdms-owned-complete-source-observation.v1'
              AND r#>>'{rawFields,completeOwnedSource,mode}'='COMPLETE_OWN_SOURCE@1',false)))
            ,'[]'::jsonb)
          FROM jsonb_array_elements(c.data#>'{dailyMetadata,nativeRetention,records}') m
          LEFT JOIN tdms_record_revision v ON v.tenant_id=c.tenant_id AND v.source_key=c.source_key
            AND v.source_instance_id=c.source_instance_id AND v.scope_id=c.scope_id
            AND v.source_revision_ref=m->>'sourceRevisionRef'
          LEFT JOIN LATERAL (SELECT value AS r FROM jsonb_array_elements(c.data#>'{dailyMetadata,envelope,package,records}')
            WHERE value->>'snapshotId'=m->>'snapshotId') raw ON true
          LEFT JOIN LATERAL (SELECT value AS n FROM jsonb_array_elements(c.data#>'{dailyMetadata,adapter,output,nativePackage,records}')
            WHERE value->>'itemId'=m->>'itemId') native ON true)) AS data
      FROM tdms_capture c WHERE c.tenant_id=${s.tenantId} AND c.source_key=${s.sourceKey}
        AND c.source_instance_id=${s.sourceInstanceId} AND c.scope_id=${s.scopeId}
        AND c.capture_ref=${captureRef} LIMIT 2`);
    if (!rows.length) return null;
    if (rows.length !== 1)
      throw tdmsError('TDMS_PROCESSING_CAPTURE_INVALID', 409);
    return retainedCaptureProof(rows[0].data);
  }
  async processingSet(s: TdmsSourceScope, ref: string) {
    const rows = await this.setDb.execute<{ data: TdmsProcessingRevisionSet }>(
      sql`SELECT data FROM tdms_processing_revision_set WHERE ${scope(s)} AND set_revision_ref=${ref}`,
    );
    return storedData(rows[0]?.data ?? null);
  }
  async processingSetHead(s: TdmsSourceScope, family: string) {
    const rows = await this.setDb.execute<{ data: TdmsProcessingSetHead }>(
      sql`SELECT data FROM tdms_processing_set_head WHERE ${scope(s)} AND processing_family_ref=${family} FOR UPDATE`,
    );
    return storedData(rows[0]?.data ?? null);
  }
  async processingSetHistory(
    s: TdmsSourceScope,
    family: string,
    after: string | null,
  ) {
    const rows = await this.setDb.execute<{ data: TdmsProcessingRevisionSet }>(
      sql`SELECT data FROM tdms_processing_revision_set WHERE ${scope(s)} AND processing_family_ref=${family} AND (${after}::text IS NULL OR set_revision_ref>${after}) ORDER BY set_revision_ref LIMIT 51`,
    );
    return rows.map((r) => storedData(r.data)!);
  }
  async processingAssertion(s: TdmsSourceScope, ref: string) {
    const rows = await this.setDb.execute<{ data: TdmsStoredAssertion }>(
      sql`SELECT data FROM tdms_relation_assertion WHERE ${scope(s)} AND assertion_ref=${ref}`,
    );
    return storedData(rows[0]?.data ?? null);
  }
  async insertProcessingSet(set: TdmsProcessingRevisionSet) {
    const s = set.scope;
    await this.setDb.execute(sql`INSERT INTO tdms_processing_revision_set
      (tenant_id,source_key,source_instance_id,scope_id,set_revision_ref,processing_family_ref,cohort_ref,processing_observation_ref,data)
      VALUES (${s.tenantId},${s.sourceKey},${s.sourceInstanceId},${s.scopeId},${set.setRevisionRef},${set.processingFamilyRef},${set.cohortRef},${set.processingObservationRef},${JSON.stringify(set)}::text::jsonb)`);
  }
  async selectProcessingSet(
    head: TdmsProcessingSetHead,
    expected: number | null,
  ) {
    const s = head.scope;
    const rows =
      expected === null
        ? await this.setDb.execute(sql`INSERT INTO tdms_processing_set_head
        (tenant_id,source_key,source_instance_id,scope_id,processing_family_ref,selected_set_revision_ref,generation,data)
        VALUES (${s.tenantId},${s.sourceKey},${s.sourceInstanceId},${s.scopeId},${head.processingFamilyRef},${head.selectedSetRevisionRef},${head.generation},${JSON.stringify(head)}::text::jsonb)
        ON CONFLICT DO NOTHING RETURNING generation`)
        : await this.setDb
            .execute(sql`UPDATE tdms_processing_set_head SET selected_set_revision_ref=${head.selectedSetRevisionRef},generation=${head.generation},data=${JSON.stringify(head)}::text::jsonb
        WHERE ${scope(s)} AND processing_family_ref=${head.processingFamilyRef} AND generation=${expected} RETURNING generation`);
    if (rows.length !== 1)
      throw tdmsError('TDMS_PROCESSING_SET_CAS_CONFLICT', 409);
  }
}
function scope(s: TdmsSourceScope) {
  return sql`tenant_id=${s.tenantId} AND source_key=${s.sourceKey} AND source_instance_id=${s.sourceInstanceId} AND scope_id=${s.scopeId}`;
}
/** Native Drizzle raw execute returns JSON text; the Host SDK can return objects.
 * Decode only this new seam; do not reinterpret the old repository/client API. */
function storedData<T>(value: T | null): T | null {
  if (value === null) return null;
  let decoded: unknown = value;
  try {
    if (typeof value === 'string') decoded = JSON.parse(value);
  } catch {
    throw tdmsError('TDMS_SET_STORED_DATA_INVALID', 409);
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw tdmsError('TDMS_SET_STORED_DATA_INVALID', 409);
  }
  const stored = decoded as Record<string, unknown>;
  if (
    !stored.scope ||
    typeof stored.scope !== 'object' ||
    Array.isArray(stored.scope)
  ) {
    throw tdmsError('TDMS_SET_STORED_DATA_INVALID', 409);
  }
  return decoded as T;
}
