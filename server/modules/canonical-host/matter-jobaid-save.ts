import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type { EngineeringMatterWorkingInputBinding, EngineeringMatterWorkingRevisionCommand, EngineeringMatterWorkingRevisionReadModel } from '@shared/matter-working.interface';
import type { JobAidProblemWorkContent } from '@shared/jobaid-problem-assessment.interface';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';
import { materializeJobAidWork } from './jobaid-problem-work';

/** All context comes from the sealed task, saved prior work and Host read receipts. */
export function materializeMatterJobAidCommand(input: {
  matterId: string; matterRevisionId: string; attemptRef: string; requestId: string;
  expectedWorkRevision: number; previous: EngineeringMatterWorkingRevisionReadModel | null;
  inputs: EngineeringMatterWorkingInputBinding[]; proposal: unknown; evidence: AssessmentEvidence[];
  readSourceRefs: string[]; capabilities: JobAidProblemWorkContent['capabilities'];
  history: JobAidProblemWorkContent['historyReview'];
}): EngineeringMatterWorkingRevisionCommand {
  const previous = input.previous?.state ?? null;
  const work = materializeJobAidWork(input.proposal, { matterId: input.matterId,
    previous: previous?.problemWork ?? null, evidence: input.evidence,
    readSourceRefs: input.readSourceRefs, capabilities: input.capabilities, history: input.history });
  const priorClaims = new Map((previous?.substantiveResult?.content.claims ?? []).map(item => [item.claimId, item]));
  const claims = work.issues.flatMap(issue => issue.statements);
  const claimIds = new Set(claims.map(item => item.claimId));
  const usedRefs = new Set(claims.flatMap(item => item.premises.map(premise => premise.evidenceRef)));
  const evidence = work.evidence.filter(item => usedRefs.has(item.evidenceRef));
  const documents = evidence.filter(item => item.kind === 'DOCUMENT_PASSAGE');
  const substantiveInputs = input.inputs.filter(binding => documents.some(item =>
    item.documentVersionId === binding.documentVersionId && (item.workItemId === null || item.workItemId === binding.workItemId)));
  const readDocuments = work.evidence.filter(item => item.kind === 'DOCUMENT_PASSAGE');
  const coverageUpdates = input.inputs.filter(binding => readDocuments.some(item => item.documentVersionId === binding.documentVersionId &&
    (item.workItemId === null || item.workItemId === binding.workItemId))).map(binding => ({
    binding: structuredClone(binding), contribution: substantiveInputs.includes(binding) ? 'SUBSTANTIVE' as const : 'NO_MATERIAL_CHANGE' as const,
    checkedSourceRefIds: [...new Set(readDocuments.filter(item => item.documentVersionId === binding.documentVersionId &&
      (item.workItemId === null || item.workItemId === binding.workItemId)).map(item => item.sourceRefId))],
    checkedScope: [...new Set(readDocuments.filter(item => item.documentVersionId === binding.documentVersionId).map(item => item.locator))].join('；'),
    reason: substantiveInputs.includes(binding) ? work.changeSummary : '已读列明范围；这些片段未进入本次简报判断，不代表其他范围没有影响。',
  }));
  return {
    requestId: input.requestId, expectedWorkingRevision: input.expectedWorkRevision,
    basedOnMatterRevisionId: input.matterRevisionId,
    updateKind: previous ? 'CORRECTION' : 'INITIAL_SYNTHESIS', changeSummary: work.changeSummary,
    nextFocus: previous ? null : { question: work.understanding, targetRefs: [] },
    claimDelta: {
      changedBecause: work.changeSummary,
      additions: claims.filter(item => !priorClaims.has(item.claimId)),
      replacements: claims.filter(item => priorClaims.has(item.claimId) && canonicalJson(priorClaims.get(item.claimId)) !== canonicalJson(item)),
      retirements: [...priorClaims.keys()].filter(id => !claimIds.has(id)).map(claimId => ({ claimId, reason: work.changeSummary })),
      explicitlyUnchangedClaimIds: claims.filter(item => canonicalJson(priorClaims.get(item.claimId) ?? null) === canonicalJson(item)).map(item => item.claimId),
    },
    // Full issue questions are retained in problemWork; independent engineer conditions remain intact.
    openQuestionDelta: null, reviewConditionDelta: null,
    nextSubstantiveResult: {
      resultRef: `MRESULT-${input.attemptRef}`, resultRevision: (previous?.substantiveResult?.resultRevision ?? 0) + 1,
      scope: { kind: 'ENGINEERING_MATTER', matterId: input.matterId }, candidateOnly: true,
      content: { schemaVersion: 'wiselink.3_1.assessment_reading.v1', headline: work.headline,
        listBrief: work.listBrief, lead: work.understanding, claims,
        decisiveClaimIds: work.issues.filter(issue => work.decisiveIssueKeys.includes(issue.issueKey)).flatMap(issue => issue.statements.map(item => item.claimId)) },
      evidence,
    },
    substantiveInputs, coverageUpdates, nextProblemWork: work,
  };
}
