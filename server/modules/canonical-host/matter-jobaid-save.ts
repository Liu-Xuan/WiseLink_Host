import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type { EngineeringMatterWorkingInputBinding, EngineeringMatterWorkingRevisionCommand, EngineeringMatterWorkingRevisionReadModel } from '@shared/matter-working.interface';
import type { JobAidProblemWorkContent } from '@shared/jobaid-problem-assessment.interface';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';
import { materializeJobAidWork } from './jobaid-problem-work';
import { collectEvidenceUses, collectIssueEvidenceUses } from '@shared/jobaid-evidence-uses';

/** All context comes from the sealed task, saved prior work and Host read receipts. */
export function materializeMatterJobAidCommand(input: {
  matterId: string; matterRevisionId: string; attemptRef: string; requestId: string;
  expectedWorkRevision: number; previous: EngineeringMatterWorkingRevisionReadModel | null;
  inputs: EngineeringMatterWorkingInputBinding[]; proposal: unknown; evidence: AssessmentEvidence[];
  readSourceRefs: string[]; capabilities: JobAidProblemWorkContent['capabilities'];
  history: JobAidProblemWorkContent['historyReview'];
  methodBinding: JobAidProblemWorkContent['methodBinding'];
}): EngineeringMatterWorkingRevisionCommand {
  const previous = input.previous?.state ?? null;
  const work = materializeJobAidWork(input.proposal, { matterId: input.matterId,
    previous: previous?.problemWork ?? null, evidence: input.evidence, methodBinding: input.methodBinding,
    readSourceRefs: input.readSourceRefs, capabilities: input.capabilities, history: input.history });
  const priorClaims = new Map((previous?.substantiveResult?.content.claims ?? []).map(item => [item.claimId, item]));
  const claims = work.issues.flatMap(issue => issue.statements);
  const claimIds = new Set(claims.map(item => item.claimId));
  const usedRefs = new Set(collectEvidenceUses(work).map(item => item.evidenceRef));
  const evidence = work.evidence.filter(item => usedRefs.has(item.evidenceRef));
  const documents = evidence.filter(item => item.kind === 'DOCUMENT_PASSAGE');
  const readDocuments = work.evidence.filter(item => item.kind === 'DOCUMENT_PASSAGE');
  const previousIssues = new Map((previous?.problemWork?.issues ?? []).map(issue => [issue.issueKey, issue]));
  const usesByIssue = new Map(work.issues.map(issue => [issue.issueKey, collectIssueEvidenceUses(issue)]));
  const substantiveIssueKeys = new Set(work.issues.filter(issue => {
    const priorIssue = previousIssues.get(issue.issueKey);
    return !priorIssue || canonicalJson(priorIssue) !== canonicalJson(issue);
  }).map(issue => issue.issueKey));
  const hasSubstantiveChange = !previous || substantiveIssueKeys.size > 0;
  const contributionFor = (binding: EngineeringMatterWorkingInputBinding) => {
    const refs = new Set(documents.filter(item => item.documentVersionId === binding.documentVersionId &&
      (item.workItemId === null || item.workItemId === binding.workItemId)).map(item => item.evidenceRef));
    const usedByChangedIssue = work.issues.some(issue => substantiveIssueKeys.has(issue.issueKey) &&
      usesByIssue.get(issue.issueKey)?.some(use => refs.has(use.evidenceRef)));
    const usedByUnchangedIssue = work.issues.some(issue => !substantiveIssueKeys.has(issue.issueKey) &&
      usesByIssue.get(issue.issueKey)?.some(use => refs.has(use.evidenceRef)));
    if (usedByChangedIssue) return 'SUBSTANTIVE' as const;
    if (usedByUnchangedIssue) return 'NO_MATERIAL_CHANGE' as const;
    return 'READ_ONLY' as const;
  };
  const coverageUpdates = input.inputs.filter(binding => readDocuments.some(item => item.documentVersionId === binding.documentVersionId &&
    (item.workItemId === null || item.workItemId === binding.workItemId))).map(binding => ({
    binding: structuredClone(binding), contribution: contributionFor(binding),
    checkedSourceRefIds: [...new Set(readDocuments.filter(item => item.documentVersionId === binding.documentVersionId &&
      (item.workItemId === null || item.workItemId === binding.workItemId)).map(item => item.sourceRefId))],
    checkedScope: [...new Set(readDocuments.filter(item => item.documentVersionId === binding.documentVersionId).map(item => item.locator))].join('；'),
    reason: contributionFor(binding) === 'SUBSTANTIVE' ? work.changeSummary : contributionFor(binding) === 'NO_MATERIAL_CHANGE' ? '已读取并比较本轮范围，相关问题与前次工作相比没有实质变化；其余范围仍待核查。' : '已读取列明片段，但本轮未保存这些输入的分析或比较处置；其余范围仍待核查。',
  }));
  const substantiveInputs = input.inputs.filter(binding => coverageUpdates.some(item => item.binding.inputId === binding.inputId && item.contribution === 'SUBSTANTIVE'));
  return {
    requestId: input.requestId, expectedWorkingRevision: input.expectedWorkRevision,
    basedOnMatterRevisionId: input.matterRevisionId,
    updateKind: previous ? 'CORRECTION' : 'INITIAL_SYNTHESIS', changeSummary: work.changeSummary,
    nextFocus: previous ? null : { question: work.understanding, targetRefs: [] },
    claimDelta: hasSubstantiveChange ? {
      changedBecause: work.changeSummary,
      additions: claims.filter(item => !priorClaims.has(item.claimId)),
      replacements: claims.filter(item => priorClaims.has(item.claimId) && canonicalJson(priorClaims.get(item.claimId)) !== canonicalJson(item)),
      retirements: [...priorClaims.keys()].filter(id => !claimIds.has(id)).map(claimId => ({ claimId, reason: work.changeSummary })),
      explicitlyUnchangedClaimIds: claims.filter(item => canonicalJson(priorClaims.get(item.claimId) ?? null) === canonicalJson(item)).map(item => item.claimId),
    } : null,
    // Full issue questions are retained in problemWork; independent engineer conditions remain intact.
    openQuestionDelta: null, reviewConditionDelta: null,
    nextSubstantiveResult: hasSubstantiveChange ? {
      resultRef: `MRESULT-${input.attemptRef}`, resultRevision: (previous?.substantiveResult?.resultRevision ?? 0) + 1,
      scope: { kind: 'ENGINEERING_MATTER', matterId: input.matterId }, candidateOnly: true,
      content: { schemaVersion: 'wiselink.3_1.assessment_reading.v1', headline: work.headline,
        listBrief: work.listBrief, lead: work.understanding, claims,
        decisiveClaimIds: work.issues.filter(issue => work.decisiveIssueKeys.includes(issue.issueKey)).flatMap(issue => issue.statements.map(item => item.claimId)) },
      evidence,
    } : null,
    substantiveInputs: hasSubstantiveChange ? substantiveInputs : [],
    coverageUpdates,
    ...(hasSubstantiveChange ? { nextProblemWork: work } : {}),
  };
}
