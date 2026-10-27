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
  explicitMethodUsage = false,
  submittedIssueKeys?: readonly string[],
): SemanticInspection {
  const violations: JobAidSemanticViolation[] = [];
  let omittedViolationCount = 0;
  const record = (code: JobAidSemanticViolationCode, fieldPaths: string[], message: string): void => {
    if (violations.length < MAX_SEMANTIC_DIAGNOSTICS) violations.push({ code, fieldPaths, message,
      ...(explicitMethodUsage ? {
        ruleId: code === 'JOBAID_SEMANTIC_REQUIREMENT_BODY_LOCATION_REQUIRED'
          ? 'WLCHK.SOURCE.EXACT_BINDING' as const : 'WLCHK.METHOD.KNOWN_RULE' as const,
        itemId: 'ENG-METHOD-01' as const,
        // These paths are constructed above, never inferred from exception text.
        fieldPath: fieldPaths[0].replace(/^work/u, '').replace(/\[(\d+)\]/gu, '/$1').replace(/\./gu, '/'),
      } : {}),
    });
    else omittedViolationCount++;
  };
  const registry = new Map(evidence.map((item: AssessmentEvidence) => [item.evidenceRef, item]));
  for (const [issueIndex, issue] of work.issues.entries()) {
    const issuePath = 'work.issues[' + issueIndex + ']';
    const submittedIndex = submittedIssueKeys?.indexOf(issue.issueKey);
    const report = (code: JobAidSemanticViolationCode, paths: string[], message: string): void => {
      record(code, paths.map(path => submittedIndex === undefined || !path.startsWith(issuePath)
        ? path : submittedIndex < 0 ? 'work.issues'
          : path.replace(issuePath, 'work.issues[' + submittedIndex + ']')),
      submittedIndex === -1
        ? `合并结果中的问题 ${JSON.stringify(issue.issueKey)} 须在 issues 中显式重提交完整内容：${message}`
        : message);
    };
    const usedMethods = new Set(collectIssueEvidenceUses(issue).map(use => use.evidenceRef)
      .filter(ref => registry.get(ref)?.kind === 'METHOD_CLAUSE'));
    const usages = new Map(issue.methodUsage?.map(item => [item.methodRef, item]) ?? []);
    let unresolved = false;
    if (explicitMethodUsage) {
      if (!Array.isArray(issue.methodUsage)) report('JOBAID_METHOD_USAGE_INVALID',
        [issuePath + '.methodUsage'], 'RC1 合并结果须声明真实方法用途；不可默填或保留未经本轮升级的问题。');
      for (const ref of usedMethods) if (!usages.has(ref)) report('JOBAID_METHOD_USAGE_INVALID',
        [issuePath + '.methodUsage'], '每个引用的方法条款须声明用途；仅参考不产生业务处置义务。');
      for (const [usageIndex, usage] of (issue.methodUsage ?? []).entries()) {
        if (usage.usage === 'APPLIED' && !usage.basisRefs.some(ref => registry.has(ref) && registry.get(ref)?.kind !== 'METHOD_CLAUSE'))
          report('JOBAID_METHOD_USAGE_INVALID', [issuePath + '.methodUsage[' + usageIndex + '].basisRefs'],
            '实际采用须关联应用对象依据；方法原文不证明业务输入。');
        if (usage.usage === 'UNDETERMINED') unresolved = true;
      }
    }
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
        if (explicitMethodUsage && usages.get(match.methodRef)?.usage !== 'APPLIED')
          report('JOBAID_METHOD_USAGE_APPLIED_REQUIRED', [proposalPath + '.definitionMatch', issuePath + '.methodUsage'],
            'definitionMatch 已表示采用该准确条款；对应 methodUsage 必须为 APPLIED，不由 Host 静默改值。');
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
    if (!explicitMethodUsage && usedMethods.size)
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
  explicitMethodUsage = false,
  submittedIssueKeys?: readonly string[],
): void {
  const inspection = inspectJobAidSemanticContent(work, evidence, explicitMethodUsage, submittedIssueKeys);
  if (inspection.violations.length) throw new JobAidSemanticValidationError(inspection);
}
