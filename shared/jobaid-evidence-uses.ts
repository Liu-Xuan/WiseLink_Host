import type { JobAidProblemIssue, JobAidProblemWorkContent } from './jobaid-problem-assessment.interface';

export interface EvidenceUse {
  evidenceRef: string;
  issueKey: string;
  /** Exact position in this immutable work revision, not a source locator. */
  position: string;
  role: 'BODY' | 'STATEMENT' | 'SEVERITY' | 'LIKELIHOOD' | 'IMPORTANT_EVENT' | 'MEASURE' | 'CLASSIFICATION' | 'METHOD' | 'REQUIREMENT' | 'DEPENDENCY' | 'PREMISE';
}

/** Typed uses and explicit citations in known prose; bare text and unknown fields are not refs. */
export function collectIssueEvidenceUses(issue: Pick<JobAidProblemIssue,
  'issueKey' | 'question' | 'body' | 'riskScenarios' | 'measures' | 'otherClassifications' | 'openQuestions' | 'requirementHandling' | 'sourceDependencies' | 'premiseRefs'
>): EvidenceUse[] {
  const uses: EvidenceUse[] = [];
  const add = (refs: string[], position: string, role: EvidenceUse['role']) => {
    refs.forEach((evidenceRef, index) => uses.push({ evidenceRef, issueKey: issue.issueKey, position: `${position}/${index}`, role }));
  };
  for (const match of issue.body.matchAll(/\[\[([^\[\]\r\n]+)\]\]/gu)) {
    uses.push({ evidenceRef: match[1], issueKey: issue.issueKey, position: `body/${match.index}`, role: 'BODY' });
  }
  issue.riskScenarios.forEach((risk, index) => {
    for (const field of ['severity', 'likelihood'] as const) {
      const definition = risk[field]?.definitionMatch;
      if (definition) add([definition.methodRef], `riskScenarios/${index}/${field}/definitionMatch/methodRef`, 'METHOD');
    }
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
  // Older work can contain a prose citation omitted from its saved dependency
  // index. Project that actual use without rewriting the immutable issue.
  const inline = (text: string, position: string) => {
    for (const match of text.matchAll(/\[\[([^\[\]\r\n]+)\]\]/gu))
      uses.push({ evidenceRef: match[1], issueKey: issue.issueKey,
        position: `${position}/${match.index}`, role: 'DEPENDENCY' });
  };
  const proseFields = (item: object, fields: readonly string[], position: string) => {
    for (const [field, value] of Object.entries(item)) {
      if (!fields.includes(field)) continue;
      if (typeof value === 'string') inline(value, `${position}/${field}`);
      if (Array.isArray(value)) value.forEach((text: unknown, index: number) => {
        if (typeof text === 'string') inline(text, `${position}/${field}/${index}`);
      });
    }
  };
  inline(issue.question, 'question');
  issue.riskScenarios.forEach((risk, index) => {
    const position = `riskScenarios/${index}`;
    proseFields(risk, ['scenario', 'conditions', 'controlComparison', 'limitations'], position);
    for (const field of ['severity', 'likelihood', 'importantEvent'] as const)
      if (risk[field]) inline(risk[field].reason, `${position}/${field}/reason`);
  });
  issue.measures.forEach((item, index) =>
    proseFields(item, ['text', 'addresses', 'limitations'], `measures/${index}`));
  issue.otherClassifications.forEach((item, index) =>
    proseFields(item, ['value', 'reason'], `otherClassifications/${index}`));
  issue.openQuestions.forEach((item, index) =>
    proseFields(item, ['question', 'affects', 'nextEvidence', 'reason'], `openQuestions/${index}`));
  issue.requirementHandling.forEach((item, index) =>
    proseFields(item, ['requirement', 'conditions', 'explanation'], `requirementHandling/${index}`));
  return uses;
}

export function collectEvidenceUses(work: JobAidProblemWorkContent): EvidenceUse[] {
  return work.issues.flatMap(collectIssueEvidenceUses);
}
