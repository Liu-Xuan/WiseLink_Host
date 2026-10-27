import { collectIssueEvidenceUses } from '@shared/jobaid-evidence-uses';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type {
  JobAidProblemWorkContent,
  JobAidSemanticViolation,
  JobAidSemanticViolationCode,
} from '@shared/jobaid-problem-assessment.interface';

// Preserve all semantic tokens, including negation; only layout whitespace differs.
const normalized = (text: string): string => text.replace(/\s+/gu, '');
const MAX_SEMANTIC_DIAGNOSTICS = 32;

interface SemanticInspection {
  violations: JobAidSemanticViolation[];
  omittedViolationCount: number;
}

/** The existing SAVE error message stays exact; only explicit candidate errors carry feedback. */
export class JobAidSemanticValidationError extends Error {
  readonly violations: JobAidSemanticViolation[];
  readonly omittedViolationCount: number;

  constructor(inspection: SemanticInspection) {
    super(inspection.violations[0].code);
    this.name = 'JobAidSemanticValidationError';
    this.violations = inspection.violations;
    this.omittedViolationCount = inspection.omittedViolationCount;
  }
}

/** Inspect the existing semantic v1 rules, without selecting evidence or changing any content. */
export function inspectJobAidSemanticContent(
  work: Pick<JobAidProblemWorkContent, 'issues' | 'roundCompletion'>,
  evidence: AssessmentEvidence[],
): SemanticInspection {
  const violations: JobAidSemanticViolation[] = [];
  let omittedViolationCount = 0;
  const report = (code: JobAidSemanticViolationCode, fieldPaths: string[], message: string): void => {
    if (violations.length < MAX_SEMANTIC_DIAGNOSTICS) violations.push({ code, fieldPaths, message });
    else omittedViolationCount++;
  };
  const registry = new Map(evidence.map((item: AssessmentEvidence) => [item.evidenceRef, item]));
  for (const [issueIndex, issue] of work.issues.entries()) {
    const issuePath = 'work.issues[' + issueIndex + ']';
    const usedMethods = new Set(collectIssueEvidenceUses(issue).map(use => use.evidenceRef)
      .filter(ref => registry.get(ref)?.kind === 'METHOD_CLAUSE'));
    let unresolved = false;
    for (const [riskIndex, risk] of issue.riskScenarios.entries()) {
      const riskPath = issuePath + '.riskScenarios[' + riskIndex + ']';
      for (const [dimension, proposal] of [['SEVERITY', risk.severity], ['LIKELIHOOD', risk.likelihood]] as const) {
        if (!proposal) { unresolved = true; continue; }
        const proposalPath = riskPath + (dimension === 'SEVERITY' ? '.severity' : '.likelihood');
        const match = proposal.definitionMatch;
        if (!match) {
          report(dimension === 'SEVERITY' ? 'JOBAID_SEMANTIC_SEVERITY_DEFINITION_REQUIRED'
            : 'JOBAID_SEMANTIC_LIKELIHOOD_DEFINITION_REQUIRED', [proposalPath + '.definitionMatch'],
          '分类须对应已交付方法中的准确等级定义；资料不足时保留未知及具体待核。');
          continue;
        }
        const method = registry.get(match.methodRef);
        if (method?.kind !== 'METHOD_CLAUSE' || !method.classificationDefinitions?.some(definition =>
          definition.dimension === dimension && definition.label === proposal.label &&
          normalized(definition.definitionQuote) === normalized(match.definitionQuote) &&
          normalized(method.excerpt).includes(normalized(definition.definitionQuote))))
          report(dimension === 'SEVERITY' ? 'JOBAID_SEMANTIC_SEVERITY_DEFINITION_NOT_DELIVERED'
            : 'JOBAID_SEMANTIC_LIKELIHOOD_DEFINITION_NOT_DELIVERED',
          [proposalPath + '.definitionMatch', proposalPath + '.label'],
          '等级和 definitionQuote 须匹配本任务已交付方法的同一维度定义，不自行补造方法定义。');
        usedMethods.add(match.methodRef);
        if (!proposal.basisRefs.some(ref => registry.has(ref) && registry.get(ref)?.kind !== 'METHOD_CLAUSE'))
          report(dimension === 'SEVERITY' ? 'JOBAID_SEMANTIC_SEVERITY_BUSINESS_BASIS_REQUIRED'
            : 'JOBAID_SEMANTIC_LIKELIHOOD_BUSINESS_BASIS_REQUIRED', [proposalPath + '.basisRefs'],
          '分类判断需要已交付的业务依据；方法条款本身不证明该事件或频率。');
        // The original risk clause's severity definition is conditional on a six-event scenario.
        if (dimension === 'SEVERITY' && method?.kind === 'METHOD_CLAUSE' &&
            method.methodRef === 'method:risk' && !risk.importantEvent)
          report('JOBAID_SEMANTIC_IMPORTANT_EVENT_SCENARIO_REQUIRED', [riskPath + '.importantEvent'],
            '所选严重性定义要求明确对应的重要事件场景；不得凭方法类别推定事件发生。');
      }
      // Method text defines the event category; the event needs its own delivered business basis.
      if (risk.importantEvent && !risk.importantEvent.basisRefs.some(ref =>
        registry.has(ref) && registry.get(ref)?.kind !== 'METHOD_CLAUSE'))
        report('JOBAID_SEMANTIC_IMPORTANT_EVENT_BUSINESS_BASIS_REQUIRED',
          [riskPath + '.importantEvent.basisRefs'], '重要事件须有已交付的业务依据，不能只引用方法条款。');
    }
    for (const [rowIndex, row] of issue.requirementHandling.entries()) {
      const rowPath = issuePath + '.requirementHandling[' + rowIndex + ']';
      usedMethods.delete(row.methodRef);
      if (!row.bodyQuote || !normalized(issue.body).includes(normalized(row.bodyQuote)))
        report('JOBAID_SEMANTIC_REQUIREMENT_BODY_LOCATION_REQUIRED',
          [rowPath + '.bodyQuote', issuePath + '.body'],
          'bodyQuote 必须定位到同一 issue.body 中的实际原句；仅忽略布局空白，不改写否定、条件或工程判断。');
      if (['ADDRESSED', 'NOT_APPLICABLE_WITH_BASIS'].includes(row.treatment) &&
          !row.basisRefs.some(ref => registry.has(ref) && registry.get(ref)?.kind !== 'METHOD_CLAUSE'))
        report('JOBAID_SEMANTIC_REQUIREMENT_BUSINESS_BASIS_REQUIRED', [rowPath + '.basisRefs'],
          '已承接或有依据的不适用判断须有已交付的业务依据，不能只引用方法条款。');
      if (['CONDITIONS_UNCONFIRMED', 'NOT_YET_ADDRESSED', 'CONFLICT'].includes(row.treatment)) unresolved = true;
    }
    if (usedMethods.size)
      report('JOBAID_SEMANTIC_USED_METHOD_DISPOSITION_REQUIRED', [issuePath + '.requirementHandling'],
        '本问题实际使用的方法须在 requirementHandling 说明对应要求、适用条件及处置。');
    if (unresolved && (work.roundCompletion === 'COMPLETE' || issue.openQuestions.length === 0))
      report('JOBAID_SEMANTIC_UNRESOLVED_QUESTION_REQUIRED',
        [issuePath + '.openQuestions', 'work.roundCompletion'],
        '未解决的分类或方法条件须有具体开放问题，并使用保留未决事项的完成状态。');
  }
  return { violations, omittedViolationCount };
}

/** New task validation only. Historical readers and sealed commit recovery do not call this. */
export function assertJobAidSemanticContent(
  work: Pick<JobAidProblemWorkContent, 'issues' | 'roundCompletion'>,
  evidence: AssessmentEvidence[],
): void {
  const inspection = inspectJobAidSemanticContent(work, evidence);
  if (inspection.violations.length) throw new JobAidSemanticValidationError(inspection);
}
