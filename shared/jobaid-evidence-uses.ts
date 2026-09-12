import type { JobAidProblemIssue, JobAidProblemWorkContent } from './jobaid-problem-assessment.interface';

export interface EvidenceUse {
  evidenceRef: string;
  issueKey: string;
  /** Exact position in this immutable work revision, not a source locator. */
  position: string;
  role: 'STATEMENT' | 'SEVERITY' | 'LIKELIHOOD' | 'IMPORTANT_EVENT' | 'MEASURE' | 'CLASSIFICATION' | 'METHOD' | 'REQUIREMENT' | 'DEPENDENCY' | 'PREMISE';
}

/** Traverse only typed evidence fields. Text and future unknown fields are never references. */
export function collectIssueEvidenceUses(issue: Pick<JobAidProblemIssue,
  'issueKey' | 'statements' | 'riskScenarios' | 'measures' | 'otherClassifications' | 'requirementHandling' | 'sourceDependencies' | 'premiseRefs'
>): EvidenceUse[] {
  const uses: EvidenceUse[] = [];
  const add = (refs: string[], position: string, role: EvidenceUse['role']) => {
    refs.forEach((evidenceRef, index) => uses.push({ evidenceRef, issueKey: issue.issueKey, position: `${position}/${index}`, role }));
  };
  issue.statements.forEach((claim, index) => claim.premises.forEach((premise, premiseIndex) => {
    uses.push({ evidenceRef: premise.evidenceRef, issueKey: issue.issueKey,
      position: `statements/${index}/premises/${premiseIndex}`, role: 'STATEMENT' });
  }));
  issue.riskScenarios.forEach((risk, index) => {
    add(risk.severity?.basisRefs ?? [], `riskScenarios/${index}/severity/basisRefs`, 'SEVERITY');
    add(risk.likelihood?.basisRefs ?? [], `riskScenarios/${index}/likelihood/basisRefs`, 'LIKELIHOOD');
    add(risk.importantEvent?.basisRefs ?? [], `riskScenarios/${index}/importantEvent/basisRefs`, 'IMPORTANT_EVENT');
  });
  issue.measures.forEach((item, index) => add(item.basisRefs, `measures/${index}/basisRefs`, 'MEASURE'));
  issue.otherClassifications.forEach((item, index) => add(item.basisRefs, `otherClassifications/${index}/basisRefs`, 'CLASSIFICATION'));
  issue.requirementHandling.forEach((item, index) => {
    add([item.methodRef], `requirementHandling/${index}/methodRef`, 'METHOD');
    add(item.basisRefs, `requirementHandling/${index}/basisRefs`, 'REQUIREMENT');
  });
  add(issue.sourceDependencies, 'sourceDependencies', 'DEPENDENCY');
  add(issue.premiseRefs, 'premiseRefs', 'PREMISE');
  return uses;
}

export function collectEvidenceUses(work: JobAidProblemWorkContent): EvidenceUse[] {
  return work.issues.flatMap(collectIssueEvidenceUses);
}
