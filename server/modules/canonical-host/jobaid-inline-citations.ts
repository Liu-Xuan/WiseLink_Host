import type { JobAidProblemIssue } from '@shared/jobaid-problem-assessment.interface';

type IssueProse = Pick<JobAidProblemIssue,
  'question' | 'body' | 'riskScenarios' | 'measures' | 'otherClassifications' |
  'openQuestions' | 'requirementHandling'>;

/** Explicit citations in known saved prose; bare identifiers are not citations. */
export function collectJobAidIssueInlineCitations(issue: IssueProse): string[] {
  const texts = [
    issue.question, issue.body,
    ...issue.riskScenarios.flatMap((risk) => [
      risk.scenario, ...risk.conditions, risk.controlComparison, ...risk.limitations,
      ...(risk.severity ? [risk.severity.reason] : []),
      ...(risk.likelihood ? [risk.likelihood.reason] : []),
      ...(risk.importantEvent ? [risk.importantEvent.reason] : []),
    ]),
    ...issue.measures.flatMap((measure) => [measure.text, measure.addresses, ...measure.limitations]),
    ...issue.otherClassifications.flatMap((item) => [item.value, item.reason]),
    ...issue.openQuestions.flatMap((item) => [item.question, item.affects, item.nextEvidence, item.reason]),
    ...issue.requirementHandling.flatMap((item) => [item.requirement, ...item.conditions, item.explanation]),
  ];
  const refs: string[] = [];
  for (const text of texts) {
    refs.push(...[...text.matchAll(/\[\[([^\[\]\r\n]+)\]\]/gu)].map((match) => match[1]));
    const uncited = text.replace(/\[\[([^\[\]\r\n]+)\]\]/gu, '');
    if (uncited.includes('[[') || uncited.includes(']]'))
      throw new Error('JOBAID_INLINE_CITATION_MALFORMED');
  }
  return [...new Set(refs)];
}
