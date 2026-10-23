import {
  dmDocumentVersion,
  dmPublicationFamily,
  dmSourceArtifact,
  dmAcquisition,
  dmIngressPreflight,
} from '../../database/schema';
import { tenantFamilyIdentityPrefix } from '../document-management/src/hosted/nest/miaoda-hosted-document-catalog';
import { isAirbusTfuFooterDescriptor } from '../document-management/src/migrated/ingress/pdfPublicationEvidence.js';
import { canonical as stableJson, object } from './tdms-source.validation';
const COMPLETE_ACQUISITION_STATUSES = new Set([
  'COMMITTED_CANONICAL',
  'LINKED_EXACT_DOCUMENT_VERSION',
]);
const VERIFIED_DM_IDENTITY_AUTHORITIES = new Set([
  'DM_ACTUAL_PDF_FIRST_THREE_PAGES',
  'DM_ACTUAL_PDF_LAYOUT_AND_SERVER_REVIEW_SCOPE',
]);
function recordJson(value: string) {
  return object(JSON.parse(value));
}

type DocumentReadLineage = {
  version: Pick<typeof dmDocumentVersion.$inferSelect,'documentVersionId'|'familyId'|'sourceArtifactId'|
    'pdfSha256'|'byteLength'|'acquisitionId'|'businessRevision'|'revisionDate'|'sourceGeneratedDate'>;
  family: Pick<typeof dmPublicationFamily.$inferSelect,'familyId'|'canonicalIdentityKey'|'canonicalDocumentNumber'|'documentFamily'|'issuerAuthority'>;
  artifact: Pick<typeof dmSourceArtifact.$inferSelect,'sourceArtifactId'|'readbackVerified'|'mediaType'|'sha256'|'byteLength'|'bucketId'|'filePath'>;
  acquisition: Pick<typeof dmAcquisition.$inferSelect,'acquisitionId'|'status'|'sourceArtifactId'|'documentVersionId'|
    'acquiredBy'|'selectionBucketId'|'selectionFilePath'|'providerObjectId'|'providerVersionId'|'sourceDescriptorJson'>;
  preflight: Pick<typeof dmIngressPreflight.$inferSelect,'status'|'committedAt'|'documentVersionId'|'acquisitionId'|
    'commitIdempotencyKey'|'decision'|'normalizedDescriptorJson'> | null;
  /** Finite SQL projection retains the original full equality without returning
   * unrelated descriptor/evidence fields to the caller. */
  publicationIdentityEvidenceConsistent?: boolean | null;
};

export function verifiedDocumentReadLineage(
  row: DocumentReadLineage,
  tenantId: string,
): boolean {
  const { version, family, artifact, acquisition, preflight } = row;
  if (
    !preflight ||
    preflight.status !== 'COMMITTED' ||
    !preflight.committedAt ||
    !COMPLETE_ACQUISITION_STATUSES.has(acquisition.status) ||
    version.familyId !== family.familyId ||
    !family.canonicalIdentityKey.startsWith(
      tenantFamilyIdentityPrefix(tenantId),
    ) ||
    version.sourceArtifactId !== artifact.sourceArtifactId ||
    acquisition.sourceArtifactId !== artifact.sourceArtifactId ||
    acquisition.documentVersionId !== version.documentVersionId ||
    preflight.documentVersionId !== version.documentVersionId ||
    preflight.acquisitionId !== acquisition.acquisitionId ||
    preflight.commitIdempotencyKey !== `catalog:${acquisition.acquisitionId}` ||
    artifact.readbackVerified !== true ||
    artifact.mediaType !== 'application/pdf' ||
    version.pdfSha256 !== artifact.sha256 ||
    Number(version.byteLength) !== Number(artifact.byteLength) ||
    !acquisition.acquiredBy ||
    !acquisition.selectionBucketId ||
    !acquisition.selectionFilePath ||
    !acquisition.providerObjectId ||
    !acquisition.providerVersionId
  )
    return false;
  if (
    acquisition.status === 'COMMITTED_CANONICAL' &&
    version.acquisitionId !== acquisition.acquisitionId
  )
    return false;
  if (
    acquisition.status === 'LINKED_EXACT_DOCUMENT_VERSION' &&
    !['REUSE_EXACT', 'RESUME_EXISTING_PROCESS'].includes(preflight.decision)
  )
    return false;
  const normalized = recordJson(preflight.normalizedDescriptorJson);
  const descriptor = recordJson(acquisition.sourceDescriptorJson);
  const authority = String(normalized.identityAuthority ?? '');
  const footer =
    isAirbusTfuFooterDescriptor(normalized) &&
    isAirbusTfuFooterDescriptor(descriptor) &&
    (row.publicationIdentityEvidenceConsistent !== undefined
      ? row.publicationIdentityEvidenceConsistent === true
      : stableJson(normalized.publicationIdentityEvidence) === stableJson(descriptor.publicationIdentityEvidence));
  return (
    (VERIFIED_DM_IDENTITY_AUTHORITIES.has(authority) || footer) &&
    descriptor.identityAuthority === normalized.identityAuthority &&
    Number.isSafeInteger(normalized.pageCount) &&
    Number(normalized.pageCount) > 0 &&
    normalized.sha256 === artifact.sha256 &&
    Number(normalized.sizeBytes) === Number(artifact.byteLength) &&
    descriptor.sha256 === artifact.sha256 &&
    Number(descriptor.sizeBytes) === Number(artifact.byteLength) &&
    descriptor.sourceStorageKey ===
      `${artifact.bucketId}:${artifact.filePath}` &&
    normalized.documentCode === family.canonicalDocumentNumber &&
    normalized.canonicalDocumentFamily === family.documentFamily &&
    normalized.issuer === family.issuerAuthority &&
    String(normalized.businessRevision ?? '') ===
      String(version.businessRevision ?? '') &&
    String(normalized.revisionDate ?? '') ===
      String(version.revisionDate ?? '') &&
    String(normalized.sourceGeneratedDate ?? '') ===
      String(version.sourceGeneratedDate ?? '')
  );
}
