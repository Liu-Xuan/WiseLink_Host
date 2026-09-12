import { z } from 'zod/v4';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type { EngineeringMatterWorkingInputBinding, EngineeringMatterWorkingRevisionCommand, EngineeringMatterWorkingRevisionReadModel, EngineeringMatterWorkingTextItemDelta } from '@shared/matter-working.interface';
import type { JobAidProblemWorkContent } from '@shared/jobaid-problem-assessment.interface';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';
import { materializeJobAidWork } from './jobaid-problem-work';
import { collectEvidenceUses, collectIssueEvidenceUses } from '@shared/jobaid-evidence-uses';
import { matterReviewConditionDelta } from './matter-revisit';

/** All context comes from the sealed task, saved prior work and Host read receipts. */
export function materializeMatterJobAidCommand(input: {
  matterId: string; matterRevisionId: string; attemptRef: string; requestId: string;
  expectedWorkRevision: number; previous: EngineeringMatterWorkingRevisionReadModel | null;
  inputs: EngineeringMatterWorkingInputBinding[]; proposal: unknown; evidence: AssessmentEvidence[];
  readSourceRefs: string[]; currentReadSourceRefs?: string[]; capabilities: JobAidProblemWorkContent['capabilities'];
  history: JobAidProblemWorkContent['historyReview'];
  methodBinding: JobAidProblemWorkContent['methodBinding'];
}): EngineeringMatterWorkingRevisionCommand {
  const previous = input.previous?.state ?? null;
  const conditionDelta = z.object({ reviewConditionDelta: matterReviewConditionDelta.nullable().default(null) }).parse(input.proposal).reviewConditionDelta as EngineeringMatterWorkingTextItemDelta | null;
  for (const condition of conditionDelta?.upserts ?? []) {
    if (condition.when?.kind !== 'ORIGINAL_CHANGED') continue;
    const when = condition.when;
    const prior = previous?.reviewConditions.find(item => item.itemId === condition.itemId);
    if (canonicalJson(prior?.when ?? null) === canonicalJson(when)) continue;
    const binding = input.inputs.find(item => item.inputId === when.inputId);
    if (!binding || (binding.original?.parseRunId ?? null) !== when.afterParseRunId)
      throw new Error('MATTER_REVISIT_SOURCE_BINDING_INVALID');
  }
  if (conditionDelta) {
    const changed = new Set([...conditionDelta.upserts, ...conditionDelta.retirements].map(item => item.itemId));
    conditionDelta.explicitlyUnchangedItemIds = [...new Set([...conditionDelta.explicitlyUnchangedItemIds,
      ...(previous?.reviewConditions ?? []).filter(item => !changed.has(item.itemId)).map(item => item.itemId)])];
  }
  const work = materializeJobAidWork(input.proposal, { matterId: input.matterId,
    previous: previous?.problemWork ?? null, evidence: input.evidence, methodBinding: input.methodBinding,
    readSourceRefs: input.readSourceRefs, capabilities: input.capabilities, history: input.history });
  const priorClaims = new Map((previous?.substantiveResult?.content.claims ?? []).map(item => [item.claimId, item]));
  const claims = work.issues.flatMap(issue => issue.statements);
  const claimIds = new Set(claims.map(item => item.claimId));
  const usedRefs = new Set(collectEvidenceUses(work).map(item => item.evidenceRef));
  const evidence = work.evidence.filter(item => usedRefs.has(item.evidenceRef));
  const documents = evidence.filter(item => item.kind === 'DOCUMENT_PASSAGE');
  const currentRead = new Set(input.currentReadSourceRefs ?? input.readSourceRefs);
  const readDocuments = work.evidence.filter(item => item.kind === 'DOCUMENT_PASSAGE').filter(item => currentRead.has(item.evidenceRef));
  const matchesReadBinding = (item: Extract<AssessmentEvidence, { kind: 'DOCUMENT_PASSAGE' }>, binding: EngineeringMatterWorkingInputBinding) =>
    item.documentVersionId === binding.documentVersionId && (item.workItemId === null || item.workItemId === binding.workItemId) &&
    (!binding.original || item.evidenceRef.startsWith(`DOCUMENT_ORIGINAL:${binding.documentVersionId}:${binding.original.parseRunId}:`));
  // Runtime receipts retain all delivery. The saved work retains prior evidence,
  // actual claims and reading of its bound inputs, without certifying older delivery as new coverage.
  work.evidence = work.evidence.filter(item => item.kind !== 'DOCUMENT_PASSAGE' || usedRefs.has(item.evidenceRef) ||
    input.inputs.some(binding => matchesReadBinding(item, binding)) ||
    previous?.problemWork?.evidence.some(prior => canonicalJson(prior) === canonicalJson(item)));
  const retainedRefs = new Set(work.evidence.map(item => item.evidenceRef));
  work.readSourceRefs = work.readSourceRefs.filter(ref => retainedRefs.has(ref));
  const dispositions = z.object({ inputDispositions: z.array(z.strictObject({
    inputId: z.string().min(1), contribution: z.enum(['NO_MATERIAL_CHANGE', 'READ_ONLY']),
    checkedEvidenceRefs: z.array(z.string().min(1)).min(1), checkedScope: z.string().trim().min(1), reason: z.string().trim().min(1),
  })).default([]) }).parse(input.proposal).inputDispositions;
  const byInput = new Map(dispositions.map(item => [item.inputId, item]));
  if (byInput.size !== dispositions.length) throw new Error('MATTER_INPUT_DISPOSITION_DUPLICATE');
  for (const disposition of dispositions) {
    const binding = input.inputs.find(item => item.inputId === disposition.inputId);
    if (!binding || disposition.checkedEvidenceRefs.some(ref => !readDocuments.some(item => item.evidenceRef === ref &&
      matchesReadBinding(item,binding)))) {
      throw new Error('MATTER_INPUT_DISPOSITION_SOURCE_NOT_READ');
    }
  }
  const previousIssues = new Map((previous?.problemWork?.issues ?? []).map(issue => [issue.issueKey, issue]));
  const usesByIssue = new Map(work.issues.map(issue => [issue.issueKey, collectIssueEvidenceUses(issue)]));
  const substantiveIssueKeys = new Set(work.issues.filter(issue => {
    const priorIssue = previousIssues.get(issue.issueKey);
    return !priorIssue || canonicalJson(priorIssue) !== canonicalJson(issue);
  }).map(issue => issue.issueKey));
  // Compare the complete reading state, including removals and top-level
  // understanding. Run receipts and change-summary wording are not new work.
  const readingContent = (content: JobAidProblemWorkContent | undefined) => content ? {
    headline: content.headline, listBrief: content.listBrief,
    understanding: content.understanding, decisiveIssueKeys: content.decisiveIssueKeys,
    issues: content.issues, roundCompletion: content.roundCompletion,
    completionReason: content.completionReason, methodBinding: content.methodBinding,
  } : null;
  const hasSubstantiveChange = canonicalJson(readingContent(previous?.problemWork)) !==
    canonicalJson(readingContent(work));
  const contributionFor = (binding: EngineeringMatterWorkingInputBinding) => {
    const refs = new Set(documents.filter(item => item.documentVersionId === binding.documentVersionId &&
      (item.workItemId === null || item.workItemId === binding.workItemId)).map(item => item.evidenceRef));
    const usedByChangedIssue = work.issues.some(issue => substantiveIssueKeys.has(issue.issueKey) &&
      usesByIssue.get(issue.issueKey)?.some(use => refs.has(use.evidenceRef)));
    if (usedByChangedIssue) {
      if (byInput.get(binding.inputId)?.contribution === 'NO_MATERIAL_CHANGE') throw new Error('MATTER_INPUT_DISPOSITION_CONFLICT');
      return 'SUBSTANTIVE' as const;
    }
    if (byInput.get(binding.inputId)?.contribution === 'NO_MATERIAL_CHANGE') return 'NO_MATERIAL_CHANGE' as const;
    return 'READ_ONLY' as const;
  };
  const coverageUpdates = input.inputs.filter(binding => readDocuments.some(item => matchesReadBinding(item,binding))).map(binding => ({
    binding: structuredClone(binding), contribution: contributionFor(binding),
    checkedSourceRefIds: [...new Set(readDocuments.filter(item => matchesReadBinding(item,binding) &&
      (!byInput.has(binding.inputId) || byInput.get(binding.inputId)!.checkedEvidenceRefs.includes(item.evidenceRef))).map(item => item.sourceRefId))],
    checkedScope: byInput.get(binding.inputId)?.checkedScope ?? [...new Set(readDocuments.filter(item => matchesReadBinding(item,binding)).map(item => item.locator))].join('；'),
    reason: contributionFor(binding) === 'SUBSTANTIVE' ? work.changeSummary : contributionFor(binding) === 'NO_MATERIAL_CHANGE' ? byInput.get(binding.inputId)!.reason : '已读取列明片段，但本轮未保存这些输入的分析或比较处置；其余范围仍待核查。',
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
    openQuestionDelta: null, reviewConditionDelta: conditionDelta,
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
