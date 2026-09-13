import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import type { DocumentOriginalBinding } from '@shared/document-original.interface';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';

/** Compare saved source identity; callers that read an original supply that exact
 * binding as well. This does not discover the latest publication or authorize it. */
export function originalApplicabilityInputMatches(
  workItem: CanonicalWorkItemProjection,
  expected?: DocumentOriginalBinding,
): boolean {
  const input = workItem.applicabilityInput;
  const source = input?.originalSource;
  if (!input || !source) return false;
  return (
    input.schemaVersion === 'wiselink.3_1.applicability_input_projection.v2' &&
    input.currentness === 'CURRENT' &&
    input.workItemId === workItem.workItemId &&
    input.documentVersionId === workItem.source.documentVersionId &&
    input.sourcePackageId === null &&
    input.sourcePackageContentHash === null &&
    input.sourcePackageArtifactSha256 === null &&
    source.binding.documentVersionId === workItem.source.documentVersionId &&
    source.binding.sourceArtifactId === workItem.source.sourceArtifactId &&
    source.binding.sourceSha256 === workItem.source.sourceFileSha256 &&
    source.binding.sourceByteLength === workItem.source.sourceByteLength &&
    (!expected || canonicalJson(source.binding) === canonicalJson(expected))
  );
}

export function originalApplicabilityResultMatches(
  workItem: CanonicalWorkItemProjection,
  expected?: DocumentOriginalBinding,
): boolean {
  const result = workItem.applicability;
  const input = workItem.applicabilityInput;
  return (
    !!result &&
    !!input &&
    result.schemaVersion ===
      'wiselink.3_1.applicability_candidate_projection.v3' &&
    originalApplicabilityInputMatches(workItem, expected) &&
    result.currentness === 'CURRENT' &&
    result.staleReason === null &&
    result.documentId === workItem.source.documentId &&
    result.documentVersionId === workItem.source.documentVersionId &&
    result.sourcePackageId === null &&
    result.sourcePackageContentHash === null &&
    result.translationActionAttemptId === null &&
    result.sourceReadingMode === 'VERIFIED_ENGLISH' &&
    canonicalJson(result.originalSource) ===
      canonicalJson(input.originalSource) &&
    result.applicabilityContextRef === input.applicabilityContextRef &&
    result.applicabilityBindingRevision === input.bindingRevision &&
    result.aircraftNumber === input.aircraftNumber &&
    result.assessmentAsOf === input.assessmentAsOf &&
    result.fleetSourceSnapshotId === input.fleetMasterData.sourceSnapshotId &&
    result.fleetSourceRevisionKey === input.fleetMasterData.sourceRevisionKey &&
    result.fleetAuthorityRevision === input.fleetMasterData.authorityRevision &&
    ((result.status === 'CANDIDATE_ONLY' &&
      result.blockingUnknownCount === 0 &&
      ((result.decision === 'APPLICABLE' &&
        result.kleeneResult === true &&
        result.pass === true) ||
        (result.decision === 'NOT_APPLICABLE' &&
          result.kleeneResult === false &&
          result.pass === false))) ||
      (result.status === 'WAITING_INPUT' &&
        result.decision === 'UNKNOWN' &&
        result.kleeneResult === 'unknown' &&
        result.pass === false &&
        result.blockingUnknownCount > 0))
  );
}
