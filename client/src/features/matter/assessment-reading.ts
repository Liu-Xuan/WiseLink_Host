import type {
  AssessmentClaimEvidenceReadModel,
  AssessmentEvidence,
  AssessmentReadingClaim,
  AssessmentReadingResult,
} from '@shared/assessment-reading.interface';

export interface AssessmentClaimSelection {
  resultRef: string;
  resultRevision: number;
  claimId: string;
}

export type ReadAssessmentClaim = (
  selection: AssessmentClaimSelection,
) => Promise<AssessmentClaimEvidenceReadModel>;

export type DocumentAssessmentEvidence = Extract<
  AssessmentEvidence,
  { kind: 'DOCUMENT_PASSAGE' }
>;

export interface AssessmentClaimGroups {
  decisive: AssessmentReadingClaim[];
  supporting: AssessmentReadingClaim[];
}

export function assessmentClaimGroups(
  result: AssessmentReadingResult,
): AssessmentClaimGroups {
  const decisiveIds: Set<string> = new Set(result.content.decisiveClaimIds);
  return {
    decisive: result.content.claims.filter((claim: AssessmentReadingClaim) =>
      decisiveIds.has(claim.claimId),
    ),
    supporting: result.content.claims.filter(
      (claim: AssessmentReadingClaim) => !decisiveIds.has(claim.claimId),
    ),
  };
}

/** An open drawer must not silently switch to a newer result or another claim. */
export function validateAssessmentClaimReadback(
  selection: AssessmentClaimSelection,
  readback: AssessmentClaimEvidenceReadModel,
): void {
  if (
    readback.resultRef !== selection.resultRef ||
    readback.resultRevision !== selection.resultRevision ||
    readback.claim.claimId !== selection.claimId
  ) {
    throw new Error('依据读回与所选判断版本不一致，请关闭后重新选择。');
  }
  const available: Set<string> = new Set(
    readback.evidence.map(
      (evidence: AssessmentEvidence) => evidence.evidenceRef,
    ),
  );
  if (
    readback.claim.premises.some(
      (premise: AssessmentReadingClaim['premises'][number]) =>
        !available.has(premise.evidenceRef),
    )
  ) {
    throw new Error('该判断的部分前提未能读回，暂不能展示完整依据。');
  }
}

/** Select only from the saved result already authorized by the Host read. */
export function readSavedAssessmentClaim(
  result: AssessmentReadingResult,
  selection: AssessmentClaimSelection,
): AssessmentClaimEvidenceReadModel {
  const claim: AssessmentReadingClaim | undefined = result.content.claims.find(
    (item: AssessmentReadingClaim) => item.claimId === selection.claimId,
  );
  if (!claim) throw new Error('所选判断已不在当前读回中，请返回简报重新选择。');
  const required: Set<string> = new Set(
    claim.premises.map(
      (premise: AssessmentReadingClaim['premises'][number]) =>
        premise.evidenceRef,
    ),
  );
  const readback: AssessmentClaimEvidenceReadModel = {
    resultRef: result.resultRef,
    resultRevision: result.resultRevision,
    claim,
    evidence: result.evidence.filter((evidence: AssessmentEvidence) =>
      required.has(evidence.evidenceRef),
    ),
  };
  validateAssessmentClaimReadback(selection, readback);
  return readback;
}
