import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, sql } from 'drizzle-orm';
import {
  dmDocumentVersion,
  dmPublicationFamily,
  dmSourceArtifact,
  dmAcquisition,
  dmIngressPreflight,
} from '../../database/schema';
import { tenantFamilyIdentityPrefix } from '../document-management/src/hosted/nest/miaoda-hosted-document-catalog';
import { verifiedDocumentReadLineage } from './tdms-runtime-document-lineage';
import type { TdmsDocumentUploadBinding } from './tdms-runtime-document-binding';
import type { TdmsRuntimeTaskBinding } from './tdms-runtime-reader.port';
import type { TdmsDailyNativeRetention } from './tdms-daily-source-adapter';
import { canonical, object } from './tdms-source.validation';
import { sameScope } from './tdms-source.authorization';
import { tdmsError } from './tdms-source.types';
import { SqlTdmsProcessingSetTransaction } from './tdms-processing-set.repository';

/** Accurate DVI/acquisition lineage is the opt-in. An ordinary upload stays ordinary. */
export async function tdmsRuntimeDocumentBindings(
  database: PostgresJsDatabase,
  binding: TdmsRuntimeTaskBinding,
) {
  const rows = await database
    .select({
      version: dmDocumentVersion,
      family: dmPublicationFamily,
      artifact: dmSourceArtifact,
      acquisition: dmAcquisition,
      preflight: dmIngressPreflight,
    })
    .from(dmDocumentVersion)
    .innerJoin(
      dmPublicationFamily,
      eq(dmPublicationFamily.familyId, dmDocumentVersion.familyId),
    )
    .innerJoin(
      dmSourceArtifact,
      eq(dmSourceArtifact.sourceArtifactId, dmDocumentVersion.sourceArtifactId),
    )
    .innerJoin(
      dmAcquisition,
      and(
        eq(
          dmAcquisition.documentVersionId,
          dmDocumentVersion.documentVersionId,
        ),
        eq(dmAcquisition.sourceArtifactId, dmDocumentVersion.sourceArtifactId),
      ),
    )
    .leftJoin(
      dmIngressPreflight,
      and(
        eq(dmIngressPreflight.acquisitionId, dmAcquisition.acquisitionId),
        eq(
          dmIngressPreflight.documentVersionId,
          dmDocumentVersion.documentVersionId,
        ),
        eq(dmIngressPreflight.status, 'COMMITTED'),
      ),
    )
    .where(
      and(
        eq(dmDocumentVersion.documentVersionId, binding.documentVersionId),
        sql`starts_with(${dmPublicationFamily.canonicalIdentityKey},${tenantFamilyIdentityPrefix(binding.tenantId)})`,
      ),
    );
  const result: TdmsDocumentUploadBinding[] = [];
  for (const row of rows) {
    const descriptor = object(JSON.parse(row.acquisition.sourceDescriptorJson));
    if (!Object.hasOwn(descriptor, 'tdmsRegistration')) continue;
    if (!verifiedDocumentReadLineage(row, binding.tenantId)) invalid();
    const source = object(
      descriptor.tdmsRegistration,
    ) as unknown as TdmsDocumentUploadBinding;
    if (
      source.schemaVersion !== 'wiselink.tdms-formal-document-binding.v1' ||
      source.scope?.tenantId !== binding.tenantId ||
      source.scope.sourceKey !== 'TDMS' ||
      !source.scope.sourceInstanceId ||
      !source.scope.scopeId ||
      source.applicationScopeId !== 'app_17bzc551rsg' ||
      source.actorSubjectId !== row.acquisition.acquiredBy ||
      source.sha256 !== row.artifact.sha256 ||
      source.byteLength !== Number(row.artifact.byteLength) ||
      source.selection?.bucketId !== row.acquisition.selectionBucketId ||
      source.selection.filePath !== row.acquisition.selectionFilePath ||
      source.selection.expectedProviderObjectId !==
        row.acquisition.providerObjectId ||
      source.sourceAttachmentVersion !== null ||
      !source.sourceAttachmentId ||
      !source.ownerSnapshotId ||
      !source.sourceRecordId ||
      !source.requestId ||
      !source.bindingId ||
      !source.payloadDigest
    )
      invalid();
    result.push(structuredClone(source));
  }
  if (new Set(result.map(canonical)).size !== result.length) invalid();
  return result;
}

/** Read only finite retained mappings and record metadata, after current source
 * audience and exact attachment/owner rights have been checked by the caller. */
export async function tdmsRuntimeDocumentRoots(
  database: PostgresJsDatabase,
  source: TdmsDocumentUploadBinding,
) {
  const s = source.scope;
  const rows = await database.execute<{
    records: TdmsDailyNativeRetention['records'];
    artifacts: TdmsDailyNativeRetention['artifacts'];
    scope: unknown;
    packageHash: string;
    applicationScopeId: string;
    captureRef: string;
  }>(sql`
    SELECT data#>'{dailyMetadata,nativeRetention,records}' AS records,
      data#>'{dailyMetadata,nativeRetention,artifacts}' AS artifacts,
      data->'scope' AS scope,data->>'packageHash' AS "packageHash",
      data#>>'{dailyMetadata,applicationScopeId}' AS "applicationScopeId",capture_ref AS "captureRef"
    FROM tdms_capture WHERE tenant_id=${s.tenantId} AND source_key=${s.sourceKey}
      AND source_instance_id=${s.sourceInstanceId} AND scope_id=${s.scopeId} AND package_id=${source.requestId}`);
  if (rows.length !== 1) invalid();
  const row = rows[0]!;
  const records = decode<TdmsDailyNativeRetention['records']>(row.records);
  const artifacts = decode<TdmsDailyNativeRetention['artifacts']>(
    row.artifacts,
  );
  const scope = decode<typeof s>(row.scope);
  if (
    !sameScope(scope, s) ||
    row.packageHash !== source.payloadDigest ||
    row.applicationScopeId !== source.applicationScopeId ||
    !Array.isArray(records) ||
    !Array.isArray(artifacts)
  )
    invalid();
  const matches = records.filter(
    (record) =>
      record.snapshotId === source.ownerSnapshotId &&
      record.sourceRecordId === source.sourceRecordId &&
      record.nativeKind === 'MANUFACTURER_FILE',
  );
  const attachments = artifacts.filter(
    (artifact) =>
      artifact.bindingId === source.bindingId &&
      artifact.ownerSnapshotId === source.ownerSnapshotId &&
      artifact.sourceAttachmentId === source.sourceAttachmentId &&
      artifact.sourceAttachmentVersion === null &&
      artifact.sha256 === source.sha256 &&
      artifact.byteLength === source.byteLength &&
      canonical(artifact.ownerSourceVersion) ===
        canonical(source.sourceVersion),
  );
  if (matches.length !== 1 || attachments.length !== 1) invalid();
  const ref = matches[0]!.sourceRevisionRef;
  const retained = await new SqlTdmsProcessingSetTransaction(
    database,
  ).revisionMetadata(s.tenantId, ref);
  if (
    !retained ||
    !sameScope(retained.scope, s) ||
    retained.record.sourceRevisionRef !== ref ||
    retained.record.captureRef !== row.captureRef ||
    retained.record.sourceRecordId !== source.sourceRecordId ||
    retained.record.recordKind !== 'MANUFACTURER_FILE' ||
    canonical(retained.record.sourceVersion) !==
      canonical(source.sourceVersion) ||
    canonical(retained.record.businessVersion ?? null) !==
      canonical(source.businessVersion)
  )
    invalid();
  return ref;
}
function decode<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}
function invalid(): never {
  throw tdmsError('TDMS_RUNTIME_DOCUMENT_SOURCE_BINDING_INVALID', 409);
}
