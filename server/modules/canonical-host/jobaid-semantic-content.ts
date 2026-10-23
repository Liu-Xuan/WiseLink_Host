import { collectIssueEvidenceUses } from '@shared/jobaid-evidence-uses';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type { JobAidProblemWorkContent } from '@shared/jobaid-problem-assessment.interface';

// Preserve all semantic tokens, including negation; only layout whitespace differs.
const normalized = (text: string) => text.replace(/\s+/gu, '');
const fail = (reason: string): never => { throw new Error(`JOBAID_SEMANTIC_${reason}`); };

/** New task validation only. Historical readers and sealed commit recovery do not call this. */
export function assertJobAidSemanticContent(
  work: Pick<JobAidProblemWorkContent, 'issues' | 'roundCompletion'>,
  evidence: AssessmentEvidence[],
) {
  const registry = new Map(evidence.map(item => [item.evidenceRef, item]));
  for (const issue of work.issues) {
    const usedMethods = new Set(collectIssueEvidenceUses(issue).map(use => use.evidenceRef)
      .filter(ref => registry.get(ref)?.kind === 'METHOD_CLAUSE'));
    let unresolved = false;
    for (const risk of issue.riskScenarios) {
      for (const [dimension, proposal] of [['SEVERITY', risk.severity], ['LIKELIHOOD', risk.likelihood]] as const) {
        if (!proposal) { unresolved = true; continue; }
        const match = proposal.definitionMatch;
        if (!match) fail(`${dimension}_DEFINITION_REQUIRED`);
        const method = registry.get(match.methodRef);
        if (method?.kind !== 'METHOD_CLAUSE' || !method.classificationDefinitions?.some(definition =>
          definition.dimension === dimension && definition.label === proposal.label &&
          normalized(definition.definitionQuote) === normalized(match.definitionQuote) &&
          normalized(method.excerpt).includes(normalized(definition.definitionQuote))))
          fail(`${dimension}_DEFINITION_NOT_DELIVERED`);
        usedMethods.add(match.methodRef);
        if (!proposal.basisRefs.some(ref => registry.has(ref) && registry.get(ref)?.kind !== 'METHOD_CLAUSE'))
          fail(`${dimension}_BUSINESS_BASIS_REQUIRED`);
        // The original risk clause's severity definition is conditional on a six-event scenario.
        if (dimension === 'SEVERITY' && method?.kind === 'METHOD_CLAUSE' &&
            method.methodRef === 'method:risk' && !risk.importantEvent)
          fail('IMPORTANT_EVENT_SCENARIO_REQUIRED');
      }
      // Method text defines the event category; the claimed event needs its own delivered business basis.
      if (risk.importantEvent && !risk.importantEvent.basisRefs.some(ref =>
        registry.has(ref) && registry.get(ref)?.kind !== 'METHOD_CLAUSE'))
        fail('IMPORTANT_EVENT_BUSINESS_BASIS_REQUIRED');
    }
    for (const row of issue.requirementHandling) {
      usedMethods.delete(row.methodRef);
      if (!row.bodyQuote || !normalized(issue.body).includes(normalized(row.bodyQuote)))
        fail('REQUIREMENT_BODY_LOCATION_REQUIRED');
      if (['ADDRESSED', 'NOT_APPLICABLE_WITH_BASIS'].includes(row.treatment) &&
          !row.basisRefs.some(ref => registry.has(ref) && registry.get(ref)?.kind !== 'METHOD_CLAUSE'))
        fail('REQUIREMENT_BUSINESS_BASIS_REQUIRED');
      if (['CONDITIONS_UNCONFIRMED', 'NOT_YET_ADDRESSED', 'CONFLICT'].includes(row.treatment)) unresolved = true;
    }
    if (usedMethods.size) fail('USED_METHOD_DISPOSITION_REQUIRED');
    if (unresolved && (work.roundCompletion === 'COMPLETE' || issue.openQuestions.length === 0))
      fail('UNRESOLVED_QUESTION_REQUIRED');
  }
}
