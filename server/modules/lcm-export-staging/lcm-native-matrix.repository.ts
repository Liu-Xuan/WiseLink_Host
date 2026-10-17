import type postgres from 'postgres';
import type {
  LcmNativeDatabaseImport,
  LcmDatabaseImportResult,
  LcmDatabaseScope,
} from '@shared/lcm-configuration-store.interface';
import type { LcmNativeMatrix } from '@shared/lcm-native-matrix.interface';
import { canonicalJson, LcmStagingError, sha256 } from './lcm-export.helpers';
import {
  collectionScope,
  parseCollectionContext,
  requiredText,
} from './lcm-collection-context';
import {
  lcmTransaction,
  type LcmRepositoryDatabase,
} from './lcm-host-database';
import { setDatabaseActor, validateDatabaseScope } from './lcm-database-scope';
import { assertLcmNativeMatrix } from '@shared/lcm-native-matrix-validation';

async function saveLcmNativeMatrix(
  tx: postgres.TransactionSql,
  scope: LcmDatabaseScope,
  snapshotId: string,
  matrix: LcmNativeMatrix,
): Promise<void> {
  await tx`INSERT INTO lcm_native_matrix_snapshot
    (tenant_id,owner_actor_id,snapshot_id,format_version,source_row_count,aircraft_column_count,matrix_json)
    VALUES(${scope.tenantId},${scope.actorId},${snapshotId},${matrix.schemaVersion},${matrix.rows.length},
      ${matrix.aircraft.length},${JSON.stringify(matrix)}::text::jsonb) ON CONFLICT DO NOTHING`;
  const readback = await tx<
    Array<{ matrix: LcmNativeMatrix }>
  >`SELECT matrix_json AS matrix
    FROM lcm_native_matrix_snapshot WHERE tenant_id=${scope.tenantId} AND owner_actor_id=${scope.actorId}
      AND snapshot_id=${snapshotId}`;
  if (
    readback.length !== 1 ||
    canonicalJson(readback[0].matrix) !== canonicalJson(matrix)
  )
    throw new LcmStagingError(
      'MATRIX_IDENTITY_CONFLICT',
      'The immutable matrix body does not match this snapshot.',
    );
}

export class LcmNativeMatrixRepository {
  constructor(private readonly sql: LcmRepositoryDatabase) {}

  async importSnapshot(
    input: LcmNativeDatabaseImport,
  ): Promise<LcmDatabaseImportResult> {
    validateDatabaseScope(input.scope);
    requiredText(input.sourceInstanceId);
    requiredText(input.requestId);
    if (
      !input.scope.authorizedSourceInstanceIds.includes(input.sourceInstanceId)
    )
      throw new LcmStagingError(
        'SOURCE_ACCESS_DENIED',
        'Import source is outside the authorized scope.',
      );
    const matrix: LcmNativeMatrix = input.matrix;
    assertLcmNativeMatrix(matrix);
    if (
      matrix.rawSha256 !== input.rawSha256 ||
      !/^[a-f0-9]{64}$/u.test(input.rawSha256) ||
      !Number.isSafeInteger(input.rawByteLength) ||
      input.rawByteLength < 1 ||
      !matrix.rows.length ||
      !matrix.aircraft.length
    )
      throw new LcmStagingError(
        'IMPORT_INPUT_INVALID',
        'Native matrix/artifact identity is invalid.',
      );
    const context = parseCollectionContext(
      Buffer.from(JSON.stringify(input.context)),
    );
    const scopeKey: string = collectionScope(matrix, context);
    const { personalSourceAdmission, ...identityInput } = input;
    const requestHash: string = sha256(
      canonicalJson({
        ...identityInput,
        scope: { tenantId: input.scope.tenantId, actorId: input.scope.actorId },
      }),
    );
    const contentDigest: string = sha256(canonicalJson(matrix));
    const snapshotId: string = sha256(
      canonicalJson({
        tenant: input.scope.tenantId,
        actor: input.scope.actorId,
        source: input.sourceInstanceId,
        collectionId: context.collectionId,
        requestHash,
      }),
    );
    const coordinateCount: number = matrix.rows.length * matrix.aircraft.length;
    const importedAt: string = new Date().toISOString();
    return lcmTransaction(
      this.sql,
      input.scope.actorId,
      async (tx: postgres.TransactionSql) => {
        await setDatabaseActor(tx, input.scope);
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${canonicalJson([
          input.scope.tenantId,
          input.scope.actorId,
          input.sourceInstanceId,
        ])},0))::text`;
        if (personalSourceAdmission) {
          const sources = await tx<Array<{ revision: string }>>`SELECT
          ('lcm-personal-source:'||source_instance_id||':'||authority_revision) AS revision
          FROM lcm_personal_source WHERE application_scope_id=${personalSourceAdmission.applicationScopeId}
            AND tenant_id=${input.scope.tenantId} AND owner_actor_id=${input.scope.actorId}
            AND source_instance_id=${input.sourceInstanceId} AND read_enabled FOR SHARE`;
          if (
            sources.length !== 1 ||
            sources[0].revision !== personalSourceAdmission.permissionRevision
          )
            throw new LcmStagingError(
              'SOURCE_ACCESS_DENIED',
              'Current personal import authority changed.',
            );
        }
        const replay = await tx<
          Array<{
            snapshotId: string;
            requestHash: string;
            recordCount: number;
            coordinateCount: number;
          }>
        >`SELECT s.snapshot_id AS "snapshotId",
        c.request_hash AS "requestHash",s.record_count AS "recordCount",
        s.coordinate_count AS "coordinateCount" FROM lcm_source_collection c JOIN lcm_configuration_snapshot s
          USING(tenant_id,owner_actor_id,source_instance_id,collection_id)
        WHERE c.tenant_id=${input.scope.tenantId} AND c.owner_actor_id=${input.scope.actorId}
          AND c.source_instance_id=${input.sourceInstanceId}
          AND (c.collection_id=${context.collectionId} OR c.request_id=${input.requestId})`;
        if (replay.length) {
          if (replay.length !== 1 || replay[0].requestHash !== requestHash)
            throw new LcmStagingError(
              'IMPORT_REPLAY_CONFLICT',
              'Existing collection/request has different exact content.',
            );
          await saveLcmNativeMatrix(
            tx,
            input.scope,
            replay[0].snapshotId,
            matrix,
          );
          return {
            snapshotId: replay[0].snapshotId,
            replayed: true,
            recordCount: replay[0].recordCount,
            coordinateCount: replay[0].coordinateCount,
          };
        }
        await tx`INSERT INTO lcm_source_artifact(tenant_id,owner_actor_id,sha256,byte_length,artifact_ref)
        VALUES(${input.scope.tenantId},${input.scope.actorId},${input.rawSha256},${input.rawByteLength},${input.artifactRef})
        ON CONFLICT DO NOTHING`;
        await tx`INSERT INTO lcm_source_collection
        (tenant_id,owner_actor_id,source_instance_id,collection_id,request_id,request_hash,scope_key,context_json,
          source_observed_at,source_observed_date,source_time_zone,source_time_precision,imported_at)
        VALUES(${input.scope.tenantId},${input.scope.actorId},${input.sourceInstanceId},${context.collectionId},
          ${input.requestId},${requestHash},${scopeKey},${JSON.stringify(context)}::text::jsonb,${context.observedAt},
          ${context.systemStateDate ?? null},${context.systemStateTimeZone ?? null},
          ${context.observedAt ? 'instant' : context.systemStateDate ? 'day' : 'unknown'},${importedAt})`;
        const previous = await tx<
          Array<{ snapshotId: string }>
        >`SELECT snapshot_id AS "snapshotId"
        FROM lcm_configuration_snapshot WHERE tenant_id=${input.scope.tenantId} AND owner_actor_id=${input.scope.actorId}
          AND source_instance_id=${input.sourceInstanceId} AND scope_key=${scopeKey}
        ORDER BY imported_at DESC,snapshot_id DESC LIMIT 1`;
        await tx`INSERT INTO lcm_configuration_snapshot
        (tenant_id,owner_actor_id,snapshot_id,source_instance_id,collection_id,scope_key,previous_snapshot_id,
          artifact_sha256,original_file_name,local_source_path,source_exported_at,imported_at,content_digest,
          record_count,coordinate_count,diagnostics_json,parser_version)
        VALUES(${input.scope.tenantId},${input.scope.actorId},${snapshotId},${input.sourceInstanceId},${context.collectionId},
          ${scopeKey},${previous[0]?.snapshotId ?? null},${input.rawSha256},${input.originalFileName},${input.localSourcePath},
          NULL,${importedAt},${contentDigest},${matrix.rows.length},${coordinateCount},'[]'::jsonb,${matrix.schemaVersion})`;
        const artifacts = await tx<
          Array<{ byteLength: string }>
        >`SELECT byte_length AS "byteLength"
        FROM lcm_source_artifact WHERE tenant_id=${input.scope.tenantId} AND owner_actor_id=${input.scope.actorId}
          AND sha256=${input.rawSha256}`;
        if (Number(artifacts[0]?.byteLength) !== input.rawByteLength)
          throw new LcmStagingError(
            'ARTIFACT_IDENTITY_CONFLICT',
            'Stored artifact length differs.',
          );
        await saveLcmNativeMatrix(tx, input.scope, snapshotId, matrix);
        return {
          snapshotId,
          replayed: false,
          recordCount: matrix.rows.length,
          coordinateCount,
        };
      },
    );
  }
}
