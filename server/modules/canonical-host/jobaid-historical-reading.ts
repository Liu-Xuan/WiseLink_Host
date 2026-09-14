import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type { JobAidProblemWorkContent } from '@shared/jobaid-problem-assessment.interface';
import { JOBAID_PROBLEM_WORK_SCHEMA } from '@shared/jobaid-problem-assessment.interface';
import { materializeJobAidWork } from './jobaid-problem-work';

/** Read projection only. It never writes immutable history or accepts v2 model output. */
export function readHistoricalJobAidWork(raw: unknown, subject: { matterId: string } | { workItemId: string }): JobAidProblemWorkContent {
  const work = object(raw);
  if (work.schemaVersion === JOBAID_PROBLEM_WORK_SCHEMA) return raw as JobAidProblemWorkContent;
  if (work.schemaVersion !== 'wiselink.jobaid-problem-work.v2') throw new Error('JOBAID_STORED_WORK_INVALID');
  const issues = list(work.issues).map(rawIssue => {
    const issue = object(rawIssue);
    const paragraphs = [text(issue.understanding)];
    for (const rawClaim of list(issue.statements)) {
      const claim = object(rawClaim);
      paragraphs.push(text(claim.text));
      for (const rawPremise of list(claim.premises)) {
        const premise = object(rawPremise);
        paragraphs.push(`${text(premise.role)}：${text(premise.explanation)} [[${text(premise.evidenceRef)}]]`);
        if (premise.limitation != null) paragraphs.push(text(premise.limitation));
      }
    }
    // Explicit old dependencies remain visible as use, without inventing support.
    for (const ref of [...list(issue.sourceDependencies ?? []), ...list(issue.premiseRefs ?? [])])
      paragraphs.push(`原工作登记使用：[[${text(ref)}]]`);
    return { issueKey: issue.issueKey, question: issue.question, body: paragraphs.join('\n\n'),
      riskScenarios: list(issue.riskScenarios ?? []).map(value => { const { gradeMeaning: _calculated, ...risk } = object(value); return risk; }),
      measures: issue.measures, otherClassifications: issue.otherClassifications,
      openQuestions: issue.openQuestions, requirementHandling: issue.requirementHandling };
  });
  const saved = materializeJobAidWork({ schemaVersion: JOBAID_PROBLEM_WORK_SCHEMA, issues,
    overview: work.understanding, roundCompletion: work.roundCompletion,
    completionReason: work.completionReason, changeSummary: work.changeSummary,
    unchangedExplanation: work.unchangedExplanation }, {
    ...subject, previous: null,
    methodBinding: work.methodBinding as JobAidProblemWorkContent['methodBinding'],
    evidence: list(work.evidence) as AssessmentEvidence[], readSourceRefs: list(work.readSourceRefs).map(text),
    capabilities: work.capabilities as JobAidProblemWorkContent['capabilities'],
    history: work.historyReview as JobAidProblemWorkContent['historyReview'],
  });
  return { ...saved, historicalSourceSchema: 'wiselink.jobaid-problem-work.v2' };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JOBAID_STORED_WORK_INVALID');
  return value as Record<string, unknown>;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('JOBAID_STORED_WORK_INVALID');
  return value;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('JOBAID_STORED_WORK_INVALID');
  return value;
}
