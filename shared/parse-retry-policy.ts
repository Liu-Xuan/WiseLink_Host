import type { CanonicalWorkItemProjection } from './api.interface';

export const RETRYABLE_PARSE_FAILURE_CODES = [
  'SOURCE_BINDING_FAILED',
  'PDF_OCR_REQUIRED_UNSUPPORTED',
  'PACKAGE_SEMANTIC_VALIDATION_FAILED',
  'FAILURE_REPORT_RECORDING_FAILED',
] as const;

export type RetryableParseFailureCode =
  (typeof RETRYABLE_PARSE_FAILURE_CODES)[number];

export function isRetryableParseFailureCode(
  value: unknown,
): value is RetryableParseFailureCode {
  return (
    typeof value === 'string' &&
    RETRYABLE_PARSE_FAILURE_CODES.some((code) => code === value)
  );
}
/** A saved optional preview miss, not general permission to retry reader failures. */
export function isRetryableReaderPreviewFailure(
  projection: CanonicalWorkItemProjection | null | undefined,
): boolean {
  const failure = projection?.failure;
  if (projection?.phase !== 'FAILED' || failure?.failureCode !== 'READER_REJECTED') {
    return false;
  }
  const source = projection.source;
  if (!source || !projection.classification ||
    [projection.workItemId, projection.requestId, projection.permissionSnapshotVersion,
      source.documentId, source.documentVersionId, source.sourceArtifactId,
      projection.classification.fingerprint].some(value => typeof value !== 'string' || !value.trim()) ||
    !/^sha256:[0-9a-f]{64}$/u.test(source.sourceFileSha256) ||
    !Number.isSafeInteger(source.sourceByteLength) || source.sourceByteLength <= 0) {
    return false;
  }
  const receipt = failure.adapterReceipt;
  const artifact = failure.artifact;
  const write = failure.validationWriteReceipt;
  if (!receipt || !artifact || !write) return false;
  return (
    receipt.schemaVersion === 'wiselink.3_1.u0_frozen2_failure_adapter_receipt.v0.candidate.1' &&
    receipt.taxonomy?.stableErrorCode === 'READER_REJECTED' &&
    receipt.taxonomy.causeCode === 'READER_QUERY_NO_RESULTS' &&
    receipt.taxonomy.projectStage === 'READBACK_ARTIFACT' &&
    receipt.taxonomy.reportStage === 'projection' &&
    receipt.actualByteReadbackVerified === true &&
    receipt.strictValidation?.status === 'FULL_STRICT_FAILURE_REPORT_VALIDATOR_PASSED' &&
    receipt.strictValidation.validatorId === 'U0Frozen2ParseFailureReportValidator' &&
    receipt.strictValidation.contractId === 'techpub.parse-failure-report.v1' &&
    receipt.strictValidation.contractRevision === 'frozen.2' &&
    receipt.strictValidation.contractCommit === 'fa69ada08265934951df53c7a61a3ccdb8cb2900' &&
    receipt.strictValidation.failureId === receipt.failureId &&
    receipt.strictValidation.artifactSha256 === artifact.sha256 &&
    /^[0-9a-f]{64}$/u.test(artifact.sha256) &&
    artifact.storeRole === 'UnifiedArtifactStoreCandidate' &&
    artifact.mediaType === 'application/json' &&
    artifact.ref === `artifact://UnifiedArtifactStoreCandidate/unified-parsed-packages/sha256/${artifact.sha256}` &&
    Number.isSafeInteger(artifact.byteLength) && artifact.byteLength > 0 &&
    receipt.failureArtifact?.ref === artifact.ref &&
    receipt.failureArtifact.sha256 === artifact.sha256 &&
    receipt.failureArtifact.byteLength === artifact.byteLength &&
    receipt.failureArtifact.mediaType === artifact.mediaType &&
    receipt.failureArtifact.storeRole === artifact.storeRole &&
    receipt.correlation?.workItemId === projection.workItemId &&
    receipt.correlation.requestId === projection.requestId &&
    receipt.correlation.documentId === projection.source?.documentId &&
    receipt.correlation.documentVersionId === projection.source?.documentVersionId &&
    receipt.correlation.permissionSnapshotVersion === projection.permissionSnapshotVersion &&
    receipt.correlation.classificationFingerprint === projection.classification?.fingerprint &&
    receipt.input?.sourceKind === 'pdf' &&
    receipt.input.sourceArtifactId === projection.source?.sourceArtifactId &&
    receipt.input.inputRef === projection.source?.sourceArtifactId &&
    receipt.input.inputHash === projection.source?.sourceFileSha256 &&
    receipt.packageAttempt?.contractId === 'techpub.parsed-package.v1' &&
    receipt.packageAttempt.contractRevision === 'frozen.2' &&
    /^urn:techpub:package:v1:sha256:[0-9a-f]{64}$/u.test(receipt.packageAttempt.packageId) &&
    write.status === 'AUTHORIZED' &&
    write.scope === 'PERSIST_U0_FROZEN2_FAILURE_AND_CAS_WORKITEM' &&
    write.workItemId === projection.workItemId &&
    write.requestId === projection.requestId &&
    write.documentVersionId === projection.source?.documentVersionId &&
    write.failureId === receipt.failureId &&
    write.reportBytesSha256 === artifact.sha256 &&
    write.reportByteLength === artifact.byteLength &&
    write.authority?.failureArtifactPersistAuthorized === true &&
    write.authority.failureWorkItemCasAuthorized === true &&
    write.authority.packageArtifactPersistAuthorized === false &&
    write.authority.publicationAuthorized === false &&
    write.authority.currentSwitchAuthorized === false
  );
}
