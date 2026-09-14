import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type { EngineeringMatterWorkingRevisionReadModel } from '@shared/matter-working.interface';
import { collectIssueEvidenceUses } from '@shared/jobaid-evidence-uses';
import type { EngineeringIssueCorrectionContext } from './engineering-issue-correction-plugin.service';

/** Call only after reauthorizing the work and the exact Reader receipts under the attempt scope. */
export function buildEngineeringIssueCorrectionContext(input: {
  current: EngineeringMatterWorkingRevisionReadModel;
  expectedWorkRef: string;
  expectedWorkRevision: number;
  issueKey: string;
  correctionReason: string;
  deliveredEvidence: AssessmentEvidence[];
  limitations: string[];
}): EngineeringIssueCorrectionContext {
  if (input.current.matterWorkRevisionId !== input.expectedWorkRef ||
      input.current.workingRevision !== input.expectedWorkRevision)
    throw new Error('ENGINEERING_CORRECTION_WORK_BINDING_CHANGED');
  const work = input.current.state.problemWork;
  if (!work || work.historicalSourceSchema)
    throw new Error('ENGINEERING_CORRECTION_CURRENT_BODY_REQUIRED');
  const issue = work.issues.find(item => item.issueKey === input.issueKey);
  if (!issue) throw new Error('ENGINEERING_CORRECTION_ISSUE_NOT_FOUND');
  const registry = new Map(input.deliveredEvidence.map(item => [item.evidenceRef, item]));
  if (registry.size !== input.deliveredEvidence.length)
    throw new Error('ENGINEERING_CORRECTION_DUPLICATE_EVIDENCE');
  // Retained statements must not reach the generator without their actual source context.
  if (collectIssueEvidenceUses(issue).some(use => !registry.has(use.evidenceRef)))
    throw new Error('ENGINEERING_CORRECTION_TARGET_SOURCE_MISSING');
  return {
    question: issue.question,
    body: issue.body,
    correctionReason: input.correctionReason,
    evidence: input.deliveredEvidence.map(item => ({
      evidenceRef: item.evidenceRef, text: item.excerpt, kind: item.kind,
      title: item.title, versionLabel: item.versionLabel,
      locator: 'locator' in item ? item.locator : null,
    })),
    relatedUnderstanding: work.overviewStatus === 'NOT_AVAILABLE' ? null : work.understanding,
    // Requirements and open questions may be replaced by the explicit correction result.
    // Other judgments remain context, not silently re-certified by a body update.
    structuredContext: {
      riskScenarios: structuredClone(issue.riskScenarios), measures: structuredClone(issue.measures),
      otherClassifications: structuredClone(issue.otherClassifications),
      openQuestions: structuredClone(issue.openQuestions), requirementHandling: structuredClone(issue.requirementHandling),
    },
    limitations: [...input.limitations],
  };
}
