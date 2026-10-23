import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, sql, type SQL } from 'drizzle-orm';
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

/** Finite opt-in check independent of the joins that subsequently prove lineage.
 * A retained marker with missing family/preflight proof cannot become ordinary.
 */
export async function tdmsRuntimeDocumentHasMarker(
  database: PostgresJsDatabase,
  binding: Pick<TdmsRuntimeTaskBinding, 'tenantId' | 'documentVersionId'>,
): Promise<boolean> {
  const [row] = await database.execute<{ marker: boolean }>(sql`SELECT EXISTS (
    SELECT 1 FROM ${dmDocumentVersion} JOIN ${dmAcquisition}
      ON (${dmAcquisition.documentVersionId}=${dmDocumentVersion.documentVersionId}
        OR ${dmAcquisition.acquisitionId}=${dmDocumentVersion.acquisitionId})
    WHERE ${dmDocumentVersion.documentVersionId}=${binding.documentVersionId}
      AND ${dmAcquisition.sourceDescriptorJson}::jsonb ? 'tdmsRegistration') AS marker`);
  return row?.marker === true;
}

/** Accurate DVI/acquisition lineage is the opt-in. An ordinary upload stays ordinary. */
export async function tdmsRuntimeDocumentBindings(
  database: PostgresJsDatabase,
  binding: Pick<TdmsRuntimeTaskBinding,'tenantId'|'documentVersionId'>,
) {
  const rows = await database
    .select({
      version: {documentVersionId:dmDocumentVersion.documentVersionId,familyId:dmDocumentVersion.familyId,
        sourceArtifactId:dmDocumentVersion.sourceArtifactId,pdfSha256:dmDocumentVersion.pdfSha256,
        byteLength:dmDocumentVersion.byteLength,acquisitionId:dmDocumentVersion.acquisitionId,
        businessRevision:dmDocumentVersion.businessRevision,revisionDate:dmDocumentVersion.revisionDate,
        sourceGeneratedDate:dmDocumentVersion.sourceGeneratedDate},
      family:{familyId:dmPublicationFamily.familyId,canonicalIdentityKey:dmPublicationFamily.canonicalIdentityKey,
        canonicalDocumentNumber:dmPublicationFamily.canonicalDocumentNumber,documentFamily:dmPublicationFamily.documentFamily,
        issuerAuthority:dmPublicationFamily.issuerAuthority},
      artifact:{sourceArtifactId:dmSourceArtifact.sourceArtifactId,readbackVerified:dmSourceArtifact.readbackVerified,
        mediaType:dmSourceArtifact.mediaType,sha256:dmSourceArtifact.sha256,byteLength:dmSourceArtifact.byteLength,
        bucketId:dmSourceArtifact.bucketId,filePath:dmSourceArtifact.filePath},
      acquisition:{acquisitionId:dmAcquisition.acquisitionId,status:dmAcquisition.status,
        sourceArtifactId:dmAcquisition.sourceArtifactId,documentVersionId:dmAcquisition.documentVersionId,
        acquiredBy:dmAcquisition.acquiredBy,selectionBucketId:dmAcquisition.selectionBucketId,selectionFilePath:dmAcquisition.selectionFilePath,
        providerObjectId:dmAcquisition.providerObjectId,providerVersionId:dmAcquisition.providerVersionId,
        sourceDescriptorJson:descriptorMetadata(sql`${dmAcquisition.sourceDescriptorJson}`,true)},
      preflight:{status:dmIngressPreflight.status,committedAt:dmIngressPreflight.committedAt,documentVersionId:dmIngressPreflight.documentVersionId,
        acquisitionId:dmIngressPreflight.acquisitionId,commitIdempotencyKey:dmIngressPreflight.commitIdempotencyKey,
        decision:dmIngressPreflight.decision,normalizedDescriptorJson:descriptorMetadata(sql`${dmIngressPreflight.normalizedDescriptorJson}`,false)},
      publicationIdentityEvidenceConsistent:sql<boolean>`(${dmAcquisition.sourceDescriptorJson}::jsonb->'publicationIdentityEvidence') IS NOT DISTINCT FROM
        (${dmIngressPreflight.normalizedDescriptorJson}::jsonb->'publicationIdentityEvidence')`,
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
  if (!result.length && await tdmsRuntimeDocumentHasMarker(database, binding)) invalid();
  return result;
}

/** Only fields consumed by verifiedDocumentReadLineage and formal attachment
 * registration leave SQL. No full descriptor, document body or native opinion. */
function descriptorMetadata(column:SQL,registration:boolean):SQL<string> {
  const fields=['identityAuthority','pageCount','sha256','sizeBytes','sourceStorageKey','documentCode',
    'canonicalDocumentFamily','documentFamily','documentFamilyAdapterId','issuer','businessRevision','revisionDate','sourceGeneratedDate'];
  const registrationFields=['schemaVersion','requestId','bindingId','payloadDigest','scope','receiverId','receiverRevision','grantRevision',
    'permissionRevision','applicationScopeId','actorSubjectId','ownerSnapshotId','sourceRecordId','number','sourceVersion','businessVersion',
    'sourceAttachmentId','sourceAttachmentVersion','filename','mediaType','sha256','byteLength','selection'];
  // Only hard-coded internal field names form these JSON paths. Values remain bound parameters.
  const pick=(path:readonly string[],keys:readonly string[])=>sql`jsonb_build_object(${sql.join(keys.flatMap(
    key=>[sql`${key}::text`,sql`${column}::jsonb#>${sql.raw("'{"+[...path,key].join(',')+"}'")}`]),sql`, `)})`;
  const registrationValue=(key:string):SQL=> key==='scope' ? pick(['tdmsRegistration','scope'],
    ['tenantId','sourceKey','sourceInstanceId','scopeId']) : key==='selection' ? pick(['tdmsRegistration','selection'],
    ['bucketId','filePath','expectedProviderObjectId']) : ['sourceVersion','businessVersion'].includes(key)
    ? sql`CASE WHEN ${column}::jsonb#>${sql.raw("'{tdmsRegistration,"+key+"}'")} IS NULL OR
        ${column}::jsonb#>${sql.raw("'{tdmsRegistration,"+key+"}'")}='null'::jsonb THEN 'null'::jsonb
      ELSE ${pick(['tdmsRegistration',key],['rawRevision','rawIteration','confirmation'])} END`
    : sql`${column}::jsonb#>'{tdmsRegistration}'->${key}::text`;
  const evidence=sql`jsonb_build_object(
    'schemaVersion',${column}::jsonb#>'{publicationIdentityEvidence,schemaVersion}',
    'adapterId',${column}::jsonb#>'{publicationIdentityEvidence,adapterId}',
    'sourceSha256',${column}::jsonb#>'{publicationIdentityEvidence,sourceSha256}',
    'sourceByteLength',${column}::jsonb#>'{publicationIdentityEvidence,sourceByteLength}',
    'documentCode',${column}::jsonb#>'{publicationIdentityEvidence,documentCode}',
    'issueDate',${column}::jsonb#>'{publicationIdentityEvidence,issueDate}',
    'primaryHeaderLocator',${pick(['publicationIdentityEvidence','primaryHeaderLocator'],['kind','pageIndex'])},
    'publisher',jsonb_build_object('page',${column}::jsonb#>'{publicationIdentityEvidence,publisher,page}',
      'source',${column}::jsonb#>'{publicationIdentityEvidence,publisher,source}',
      'sourceLocator',${pick(['publicationIdentityEvidence','publisher','sourceLocator'],['kind','pageIndex'])},
      'text',${column}::jsonb#>'{publicationIdentityEvidence,publisher,text}'))`;
  return sql`(jsonb_build_object(${sql.join(fields.flatMap(key=>[sql`${key}::text`,sql`${column}::jsonb->${key}::text`]),sql`, `)},
    'adapterRelease',jsonb_build_object('adapterId',${column}::jsonb#>'{adapterRelease,adapterId}'),
    'publicationIdentityEvidence',${evidence}) ${registration ? sql`|| CASE WHEN ${column}::jsonb ? 'tdmsRegistration'
      THEN jsonb_build_object('tdmsRegistration',jsonb_build_object(${sql.join(registrationFields.flatMap(
        key=>[sql`${key}::text`,registrationValue(key)]),sql`, `)})) ELSE '{}'::jsonb END` : sql``})::text`;
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
