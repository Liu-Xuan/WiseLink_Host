import type {
  CanonicalRelatedTargetApplicability,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';

export interface CanonicalRelatedContextAssessmentTarget {
  applicabilityContextRef: string;
  aircraftNumber: string;
  assessmentAsOf: string;
  fleetSourceSnapshotId: string;
  fleetSourceRevisionKey: string;
  fleetAuthorityRevision: string;
}

export interface CanonicalRelatedTargetApplicabilityResolution {
  targetApplicability: CanonicalRelatedTargetApplicability;
  applicabilityResultRef?: string;
}

export function relatedContextAssessmentTarget(
  workItem: CanonicalWorkItemProjection,
): CanonicalRelatedContextAssessmentTarget | null {
  const input = workItem.applicabilityInput;
  if (
    !input ||
    !workItem.package ||
    input.currentness !== 'CURRENT' ||
    input.workItemId !== workItem.workItemId ||
    input.documentVersionId !== workItem.source.documentVersionId ||
    input.sourcePackageId !== workItem.package.packageId ||
    input.sourcePackageContentHash !== workItem.package.contentHash ||
    !input.fleetMasterData.sourceSnapshotId ||
    !input.fleetMasterData.sourceRevisionKey ||
    !input.fleetMasterData.authorityRevision
  ) {
    return null;
  }
  return {
    applicabilityContextRef: input.applicabilityContextRef,
    aircraftNumber: input.aircraftNumber,
    assessmentAsOf: input.assessmentAsOf,
    fleetSourceSnapshotId: input.fleetMasterData.sourceSnapshotId,
    fleetSourceRevisionKey: input.fleetMasterData.sourceRevisionKey,
    fleetAuthorityRevision: input.fleetMasterData.authorityRevision,
  };
}

/**
 * Reuses only the related document's own current Host applicability result.
 * The primary document's decision is never copied to a related document.
 */
export function resolveCanonicalRelatedTargetApplicability(
  assessmentTarget: CanonicalRelatedContextAssessmentTarget | null,
  relatedWorkItem: CanonicalWorkItemProjection | null,
): CanonicalRelatedTargetApplicabilityResolution {
  if (!assessmentTarget || !relatedWorkItem?.applicability) {
    return { targetApplicability: 'NOT_EVALUATED' };
  }
  const applicability = relatedWorkItem.applicability;
  if (
    applicability.documentVersionId !==
      relatedWorkItem.source.documentVersionId ||
    !relatedWorkItem.package ||
    applicability.sourcePackageId !== relatedWorkItem.package.packageId ||
    applicability.sourcePackageContentHash !==
      relatedWorkItem.package.contentHash ||
    applicability.currentness !== 'CURRENT' ||
    applicability.status === 'STALE'
  ) {
    return { targetApplicability: 'NOT_EVALUATED' };
  }
  if (
    normalizeAircraft(applicability.aircraftNumber) !==
      normalizeAircraft(assessmentTarget.aircraftNumber) ||
    applicability.assessmentAsOf !== assessmentTarget.assessmentAsOf ||
    applicability.fleetSourceSnapshotId !==
      assessmentTarget.fleetSourceSnapshotId ||
    applicability.fleetSourceRevisionKey !==
      assessmentTarget.fleetSourceRevisionKey ||
    applicability.fleetAuthorityRevision !==
      assessmentTarget.fleetAuthorityRevision
  ) {
    return { targetApplicability: 'NOT_EVALUATED' };
  }
  return {
    targetApplicability: applicability.decision,
    applicabilityResultRef: applicability.sourceResultId,
  };
}

function normalizeAircraft(value: string): string {
  return value.trim().toUpperCase();
}
