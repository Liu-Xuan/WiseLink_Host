import type postgres from 'postgres';
import type {
  LcmDatabaseImport, LcmDatabaseImportResult, LcmDatabaseScope, LcmExternalReference,
} from '../../../shared/lcm-configuration-store.interface';
import type { LcmCandidateRecord } from '../../../shared/lcm-export-staging.interface';
import { canonicalJson, LcmStagingError, recordContent, sha256 } from './lcm-export.helpers';
import { collectionScope, parseCollectionContext, requiredText } from './lcm-collection-context';

export function validateDatabaseScope(scope: LcmDatabaseScope): void {
  requiredText(scope.tenantId);
  requiredText(scope.actorId);
  if (!Array.isArray(scope.authorizedSourceInstanceIds) || scope.authorizedSourceInstanceIds.length === 0) {
    throw new LcmStagingError('SOURCE_SCOPE_REQUIRED', 'At least one explicitly authorized source is required.');
  }
  scope.authorizedSourceInstanceIds.forEach((source: string) => requiredText(source));
}

export async function setDatabaseActor(tx: postgres.TransactionSql, scope: LcmDatabaseScope): Promise<void> {
  await tx`SELECT set_config('app.lcm_tenant_id', ${scope.tenantId}, true),
    set_config('app.lcm_actor_id', ${scope.actorId}, true),
    set_config('app.lcm_source_ids', ${JSON.stringify(scope.authorizedSourceInstanceIds)}, true)`;
}

interface ReplayRow { snapshotId: string; requestHash: string; recordCount: number; coordinateCount: number }
interface PreviousRow { snapshotId: string }
interface ArtifactRow { byteLength: string }

/** postgres.js JSON parameters must carry objects, never pre-serialized JSON strings. */
function jsonParameter(tx: postgres.TransactionSql, value: unknown): ReturnType<typeof tx.json> {
  const json: Parameters<typeof tx.json>[0] = JSON.parse(JSON.stringify(value)) as Parameters<typeof tx.json>[0];
  return tx.json(json);
}

/** Injected connection for an isolated candidate store; no production URL fallback. */
export class LcmConfigurationRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async importSnapshot(input: LcmDatabaseImport): Promise<LcmDatabaseImportResult> {
    validateDatabaseScope(input.scope);
    requiredText(input.sourceInstanceId);
    requiredText(input.requestId);
    if (!input.scope.authorizedSourceInstanceIds.includes(input.sourceInstanceId)) {
      throw new LcmStagingError('SOURCE_ACCESS_DENIED', 'Import source is outside the authorized source scope.');
    }
    const context: LcmDatabaseImport['context'] = parseCollectionContext(Buffer.from(JSON.stringify(input.context)));
    const scopeKey: string = collectionScope(input.parsed, context);
    const contentDigest: string = sha256(canonicalJson({ kind: input.parsed.kind,
      aircraftModel: input.parsed.metadata.aircraftModel, exportDate: input.parsed.metadata.exportDate.localDateTime,
      records: input.parsed.records.map((record: LcmCandidateRecord) => recordContent(record)) }));
    if (!/^[a-f0-9]{64}$/u.test(input.rawSha256) || !Number.isSafeInteger(input.rawByteLength) || input.rawByteLength <= 0 ||
        input.parsed.records.length === 0 || contentDigest !== input.parsed.contentDigest) {
      throw new LcmStagingError('IMPORT_INPUT_INVALID', 'Candidate content or raw artifact metadata is invalid.');
    }
    const recordIds: Set<string> = new Set(input.parsed.records.map((record: LcmCandidateRecord) => record.recordId));
    if (recordIds.size !== input.parsed.records.length) throw new LcmStagingError('IMPORT_INPUT_INVALID', 'Duplicate record IDs.');
    if (input.parsed.records.some((record: LcmCandidateRecord) => record.effectiveAt !== null || record.executedAt !== null ||
        record.recordId !== `lcm-record:${sha256(canonicalJson(recordContent(record)))}` || record.sourceRows.length === 0)) {
      throw new LcmStagingError('IMPORT_INPUT_INVALID', 'Record identity, provenance or event dates are invalid.');
    }
    input.externalReferences.forEach((reference: LcmExternalReference) => {
      if (reference.targetTenantId !== input.scope.tenantId ||
          !input.scope.authorizedSourceInstanceIds.includes(reference.targetSourceInstanceId) ||
          !recordIds.has(reference.sourceRecordId) || reference.relation !== 'EXPLICIT_REFERENCE_CANDIDATE' ||
          !['TDMS_RECORD', 'WISELINK_DOCUMENT_VERSION', 'FLEET_ASSET_VERSION'].includes(reference.targetKind)) {
        throw new LcmStagingError('REFERENCE_ACCESS_DENIED', 'Both relation ends require authorized exact references.');
      }
      [reference.targetId, reference.targetVersionId, reference.evidence].forEach((value: string) => requiredText(value));
    });
    // Current grants are checked above and applied to every transaction, independently of replay identity.
    const requestHash: string = sha256(canonicalJson({ ...input,
      scope: { tenantId: input.scope.tenantId, actorId: input.scope.actorId } }));
    const snapshotId: string = sha256(canonicalJson({ tenant: input.scope.tenantId, actor: input.scope.actorId,
      source: input.sourceInstanceId, collectionId: context.collectionId, requestHash }));
    const importedAt: string = new Date().toISOString();
    const coordinateCount: number = input.parsed.records.reduce((total: number, record: LcmCandidateRecord) =>
      total + record.sourceRows.length, 0);
    return this.sql.begin(async (tx: postgres.TransactionSql): Promise<LcmDatabaseImportResult> => {
      await setDatabaseActor(tx, input.scope);
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${canonicalJson([
        input.scope.tenantId, input.scope.actorId, input.sourceInstanceId])}, 0))`;
      const replay: ReplayRow[] = await tx<ReplayRow[]>`
        SELECT s.snapshot_id AS "snapshotId", c.request_hash AS "requestHash",
          s.record_count AS "recordCount", s.coordinate_count AS "coordinateCount"
        FROM lcm_source_collection c JOIN lcm_configuration_snapshot s
          USING (tenant_id, owner_actor_id, source_instance_id, collection_id)
        WHERE c.tenant_id=${input.scope.tenantId} AND c.owner_actor_id=${input.scope.actorId}
          AND c.source_instance_id=${input.sourceInstanceId}
          AND (c.collection_id=${context.collectionId} OR c.request_id=${input.requestId})`;
      if (replay.length > 0) {
        if (replay.length !== 1 || replay[0].requestHash !== requestHash) {
          throw new LcmStagingError('IMPORT_REPLAY_CONFLICT', 'Collection/request ID already has different parameters.');
        }
        return { snapshotId: replay[0].snapshotId, replayed: true,
          recordCount: replay[0].recordCount, coordinateCount: replay[0].coordinateCount };
      }
      await tx`INSERT INTO lcm_source_artifact (tenant_id,owner_actor_id,sha256,byte_length,artifact_ref)
        VALUES (${input.scope.tenantId},${input.scope.actorId},${input.rawSha256},${input.rawByteLength},${input.artifactRef})
        ON CONFLICT DO NOTHING`;
      await tx`INSERT INTO lcm_source_collection
        (tenant_id,owner_actor_id,source_instance_id,collection_id,request_id,request_hash,scope_key,
         context_json,source_observed_at,source_observed_date,source_time_zone,source_time_precision,imported_at)
        VALUES (${input.scope.tenantId},${input.scope.actorId},${input.sourceInstanceId},${context.collectionId},
          ${input.requestId},${requestHash},${scopeKey},${jsonParameter(tx,context)}::jsonb,${context.observedAt},
          ${context.systemStateDate ?? null},${context.systemStateTimeZone ?? null},
          ${context.observedAt ? 'instant' : context.systemStateDate ? 'day' : 'unknown'},${importedAt})`;
      const previous: PreviousRow[] = await tx<PreviousRow[]>`SELECT snapshot_id AS "snapshotId"
        FROM lcm_configuration_snapshot WHERE tenant_id=${input.scope.tenantId} AND owner_actor_id=${input.scope.actorId}
          AND source_instance_id=${input.sourceInstanceId} AND scope_key=${scopeKey}
        ORDER BY imported_at DESC,snapshot_id DESC LIMIT 1`;
      await tx`INSERT INTO lcm_configuration_snapshot
        (tenant_id,owner_actor_id,snapshot_id,source_instance_id,collection_id,scope_key,previous_snapshot_id,
         artifact_sha256,original_file_name,local_source_path,source_exported_at,imported_at,
         content_digest,record_count,coordinate_count,diagnostics_json)
        VALUES (${input.scope.tenantId},${input.scope.actorId},${snapshotId},${input.sourceInstanceId},${context.collectionId},
          ${scopeKey},${previous[0]?.snapshotId ?? null},${input.rawSha256},${input.originalFileName},${input.localSourcePath},
          ${input.parsed.metadata.exportDate.localDateTime},${importedAt},${input.parsed.contentDigest},
          ${input.parsed.records.length},${coordinateCount},${jsonParameter(tx,input.parsed.diagnostics)}::jsonb)`;
      const artifacts: ArtifactRow[] = await tx<ArtifactRow[]>`SELECT byte_length AS "byteLength"
        FROM lcm_source_artifact WHERE tenant_id=${input.scope.tenantId} AND owner_actor_id=${input.scope.actorId}
          AND sha256=${input.rawSha256}`;
      if (Number(artifacts[0]?.byteLength) !== input.rawByteLength) {
        throw new LcmStagingError('ARTIFACT_IDENTITY_CONFLICT', 'Artifact byte length disagrees with stored identity.');
      }
      for (let offset: number = 0; offset < input.parsed.records.length; offset += 300) {
        const rows: Array<Record<string, string | boolean | null | ReturnType<typeof tx.json>>> = input.parsed.records.slice(offset, offset + 300)
          .map((record: LcmCandidateRecord) => ({
            tenant_id: input.scope.tenantId, owner_actor_id: input.scope.actorId, snapshot_id: snapshotId,
            record_id: record.recordId, identity_key: record.identityKey, aircraft_model: record.aircraftModel,
            tail_number: record.tailNumber, part_number: record.partNumber, original_eo: record.originalEo,
            observed_allowed: record.allowed, observed_installed: record.installed,
            semantic_basis: record.semanticBasis, observation: record.observation, record_json: jsonParameter(tx,record),
          }));
        await tx`INSERT INTO lcm_configuration_observation ${tx(rows)}`;
      }
      for (const reference of input.externalReferences) {
        const relationId: string = sha256(canonicalJson({ snapshotId, reference }));
        await tx`INSERT INTO lcm_evidence_relation
          (tenant_id,owner_actor_id,snapshot_id,source_record_id,relation_id,target_source_instance_id,
           target_kind,target_id,target_version_id,relation,evidence)
          VALUES (${input.scope.tenantId},${input.scope.actorId},${snapshotId},${reference.sourceRecordId},${relationId},
            ${reference.targetSourceInstanceId},${reference.targetKind},${reference.targetId},${reference.targetVersionId},
            ${reference.relation},${reference.evidence}) ON CONFLICT DO NOTHING`;
      }
      return { snapshotId, replayed: false, recordCount: input.parsed.records.length, coordinateCount };
    });
  }
}
