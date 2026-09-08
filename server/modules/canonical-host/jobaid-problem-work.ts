import type {
  AssessmentEvidence,
  AssessmentReadingClaim,
  AssessmentReadingResult,
} from '@shared/assessment-reading.interface';
import {
  JOBAID_PROBLEM_WORK_SCHEMA,
  type JobAidProblemIssue,
  type JobAidProblemWorkContent,
  type JobAidRiskScenario,
} from '@shared/jobaid-problem-assessment.interface';
import { JOBAID_METHOD_BINDING } from './jobaid-method-pack';

const severityValues = new Map([
  ['轻微', 3],
  ['重要', 5],
  ['严重', 7],
  ['灾难', 10],
]);
const likelihoodValues = new Map([
  ['可能', 10],
  ['不大可能', 7],
  ['不可能（极少）', 5],
  ['极不可能（极端少）', 3],
]);
const importantEvents = new Set([
  '空中停车',
  '重力放起落架',
  '爆胎／脱胎',
  '空中释压',
  '通讯中断',
  '客货舱火警／烟雾',
]);
const gradeMeanings = [
  '一级：原指南无进一步行动要求。',
  '二级：在监控下可接受。',
  '三级：应分析并改善控制。',
  '四级：要求立即临时应急措施及长期控制。',
  '五级：不可接受，原指南要求立即限制或停止运行并落实控制。',
];

export function calculateJaAcRisk(
  severity: string | null,
  likelihood: string | null,
): Pick<JobAidRiskScenario, 'score' | 'riskGrade' | 'gradeMeaning'> {
  const s = severity === null ? null : severityValues.get(severity);
  const l = likelihood === null ? null : likelihoodValues.get(likelihood);
  if (s === undefined || l === undefined)
    throw new Error('JOBAID_RISK_CLASSIFICATION_INVALID');
  if (s === null || l === null)
    return { score: null, riskGrade: null, gradeMeaning: null };
  const score = s * l;
  const riskGrade =
    score < 20 ? 1 : score < 30 ? 2 : score < 40 ? 3 : score < 60 ? 4 : 5;
  return { score, riskGrade, gradeMeaning: gradeMeanings[riskGrade - 1] };
}

export interface JobAidWorkValidationContext {
  workItemId: string;
  previous: JobAidProblemWorkContent | null;
  evidence: AssessmentEvidence[];
  readSourceRefs: string[];
  capabilities: JobAidProblemWorkContent['capabilities'];
  history: JobAidProblemWorkContent['historyReview'];
}

/** Materialize a complete revision from a bounded local update, never an empty legacy table. */
export function materializeJobAidWork(
  raw: unknown,
  context: JobAidWorkValidationContext,
): JobAidProblemWorkContent {
  const value = object(raw, 'WORK');
  if (value.schemaVersion !== JOBAID_PROBLEM_WORK_SCHEMA) fail('SCHEMA');
  const read = new Set(context.readSourceRefs);
  const registry = new Map(
    context.evidence.map((item) => [item.evidenceRef, item]),
  );
  if (registry.size !== context.evidence.length) fail('DUPLICATE_EVIDENCE');
  const refs = (input: unknown, name: string, allowEmpty = false): string[] => {
    const values = strings(input, name);
    if (!allowEmpty && values.length === 0) fail(`${name}_EMPTY`);
    for (const ref of values)
      if (!registry.has(ref) || !read.has(ref))
        fail(`SOURCE_NOT_DELIVERED:${ref}`);
    return values;
  };
  const prior = new Map(
    context.previous?.issues.map((issue) => [
      issue.issueKey,
      structuredClone(issue),
    ]) ?? [],
  );
  const unchanged = strings(value.unchangedIssueKeys ?? [], 'UNCHANGED_ISSUES');
  const retirements = array(value.retiredIssues ?? [], 'RETIRED_ISSUES').map(
    (item) => {
      const retired = object(item, 'RETIRED_ISSUE');
      return {
        issueKey: key(retired.issueKey),
        reason: text(retired.reason, 'RETIRE_REASON'),
      };
    },
  );
  const updates = array(value.issues, 'ISSUES').map(
    (item): JobAidProblemIssue => {
      const issue = object(item, 'ISSUE');
      const issueKey = key(issue.issueKey);
      const issueRef =
        prior.get(issueKey)?.issueRef ??
        `${context.workItemId}:issue:${issueKey}`;
      const statements: AssessmentReadingClaim[] = array(
        issue.statements,
        'STATEMENTS',
      ).map((rawStatement) => {
        const statement = object(rawStatement, 'STATEMENT');
        const claimKey = key(statement.claimKey);
        const basis = choice(
          statement.basis,
          ['SOURCE_FACT', 'CONDITIONAL_INFERENCE'] as const,
          'STATEMENT_BASIS',
        );
        const premises = array(statement.premises, 'PREMISES').map(
          (rawPremise) => {
            const premise = object(rawPremise, 'PREMISE');
            const evidenceRef = refs([premise.evidenceRef], 'PREMISE_REF')[0];
            return {
              evidenceRef,
              role: choice(
                premise.role,
                ['SUPPORTS', 'LIMITS', 'CONTEXT', 'CONFLICTS'] as const,
                'PREMISE_ROLE',
              ),
              explanation: text(premise.explanation, 'PREMISE_EXPLANATION'),
              limitation:
                premise.limitation == null
                  ? null
                  : text(premise.limitation, 'PREMISE_LIMITATION'),
            };
          },
        );
        if (premises.length === 0) fail('STATEMENT_PREMISES_EMPTY');
        if (
          basis === 'SOURCE_FACT' &&
          !premises.some(
            (p) =>
              p.role === 'SUPPORTS' &&
              ['DOCUMENT_PASSAGE', 'HOST_FACT'].includes(
                registry.get(p.evidenceRef)!.kind,
              ),
          )
        )
          fail('SOURCE_FACT_REQUIRES_DIRECT_SOURCE');
        return {
          claimId: `${issueRef}:claim:${claimKey}`,
          text: text(statement.text, 'STATEMENT_TEXT'),
          basis,
          premises,
        };
      });
      if (statements.length === 0) fail('ISSUE_STATEMENTS_EMPTY');
      distinct(
        statements.map((item) => item.claimId),
        'CLAIM_ID',
      );
      const riskScenarios = array(
        issue.riskScenarios ?? [],
        'RISK_SCENARIOS',
      ).map((rawRisk): JobAidRiskScenario => {
        const risk = object(rawRisk, 'RISK');
        if (risk.method !== 'JA_AC_R01') fail('RISK_METHOD');
        const classification = (rawProposal: unknown, label: string) => {
          if (rawProposal == null) return null;
          const proposal = object(rawProposal, label);
          const basisRefs = refs(proposal.basisRefs, `${label}_BASIS`);
          if (
            !basisRefs.some((ref) =>
              ['DOCUMENT_PASSAGE', 'HOST_FACT'].includes(
                registry.get(ref)!.kind,
              ),
            )
          )
            fail(`${label}_BUSINESS_EVIDENCE_REQUIRED`);
          return {
            label: text(proposal.label, `${label}_LABEL`),
            reason: text(proposal.reason, `${label}_REASON`),
            basisRefs,
          };
        };
        const severity = classification(risk.severity, 'SEVERITY');
        const likelihood = classification(risk.likelihood, 'LIKELIHOOD');
        const calculation = calculateJaAcRisk(
          severity?.label ?? null,
          likelihood?.label ?? null,
        );
        let importantEvent: JobAidRiskScenario['importantEvent'] = null;
        if (risk.importantEvent != null) {
          const event = object(risk.importantEvent, 'IMPORTANT_EVENT');
          const eventName = text(event.event, 'IMPORTANT_EVENT_NAME');
          if (!importantEvents.has(eventName)) fail('IMPORTANT_EVENT_CATEGORY');
          if (severity?.label !== '严重' && severity?.label !== '灾难')
            fail('IMPORTANT_EVENT_SEVERITY');
          const basisRefs = refs(event.basisRefs, 'IMPORTANT_EVENT_BASIS');
          if (
            !basisRefs.some(
              (ref) => registry.get(ref)!.kind === 'DOCUMENT_PASSAGE',
            )
          )
            fail('IMPORTANT_EVENT_SOURCE_REQUIRED');
          importantEvent = {
            event: eventName,
            basisRefs,
            reason: text(event.reason, 'IMPORTANT_EVENT_REASON'),
          };
        }
        const limitations = strings(risk.limitations, 'RISK_LIMITATIONS');
        if (calculation.score === null && limitations.length === 0)
          fail('UNCLASSIFIED_RISK_REASON_REQUIRED');
        // Any supplied mechanical numbers must match; never silently accept a fabricated zero.
        for (const field of ['score', 'riskGrade'] as const)
          if (field in risk && risk[field] !== calculation[field])
            fail(`RISK_${field.toUpperCase()}_MISMATCH`);
        return {
          scenario: text(risk.scenario, 'RISK_SCENARIO'),
          conditions: strings(risk.conditions, 'RISK_CONDITIONS'),
          method: 'JA_AC_R01',
          severity,
          likelihood,
          ...calculation,
          importantEvent,
          limitations,
          controlComparison: text(risk.controlComparison, 'CONTROL_COMPARISON'),
        };
      });
      const measures = array(issue.measures ?? [], 'MEASURES').map(
        (rawMeasure) => {
          const measure = object(rawMeasure, 'MEASURE');
          const basisRefs = refs(measure.basisRefs, 'MEASURE_BASIS');
          const status = choice(
            measure.status,
            ['PROPOSED', 'REPORTED_IMPLEMENTED', 'VERIFIED_EFFECTIVE'] as const,
            'MEASURE_STATUS',
          );
          if (
            status !== 'PROPOSED' &&
            !basisRefs.some((ref) =>
              ['DOCUMENT_PASSAGE', 'HOST_FACT'].includes(
                registry.get(ref)!.kind,
              ),
            )
          )
            fail('MEASURE_STATUS_EVIDENCE_REQUIRED');
          return {
            text: text(measure.text, 'MEASURE_TEXT'),
            addresses: text(measure.addresses, 'MEASURE_ADDRESSES'),
            limitations: strings(measure.limitations, 'MEASURE_LIMITATIONS'),
            status,
            basisRefs,
          };
        },
      );
      const otherClassifications = array(
        issue.otherClassifications ?? [],
        'OTHER_CLASSIFICATIONS',
      ).map((rawOther) => {
        const other = object(rawOther, 'OTHER_CLASSIFICATION');
        return {
          method: choice(
            other.method,
            [
              'SAE_EVENT_CATEGORY',
              'SOURCE_DOCUMENT_CLASSIFICATION',
              'EO_ATTRIBUTE',
            ] as const,
            'OTHER_METHOD',
          ),
          value: text(other.value, 'OTHER_VALUE'),
          reason: text(other.reason, 'OTHER_REASON'),
          basisRefs: refs(other.basisRefs, 'OTHER_BASIS'),
        };
      });
      const openQuestions = array(
        issue.openQuestions ?? [],
        'OPEN_QUESTIONS',
      ).map((rawQuestion) => {
        const question = object(rawQuestion, 'OPEN_QUESTION');
        return {
          question: text(question.question, 'QUESTION'),
          affects: text(question.affects, 'AFFECTS'),
          nextEvidence: text(question.nextEvidence, 'NEXT_EVIDENCE'),
          reason: text(question.reason, 'QUESTION_REASON'),
        };
      });
      const requirementHandling = array(
        issue.requirementHandling ?? [],
        'REQUIREMENTS',
      ).map((rawRequirement) => {
        const requirement = object(rawRequirement, 'REQUIREMENT');
        const methodRef = refs(
          [requirement.methodRef],
          'REQUIREMENT_METHOD',
        )[0];
        if (registry.get(methodRef)?.kind !== 'METHOD_CLAUSE')
          fail('REQUIREMENT_METHOD_IDENTITY');
        return {
          methodRef,
          requirement: text(requirement.requirement, 'REQUIREMENT_TEXT'),
          conditions: strings(requirement.conditions, 'REQUIREMENT_CONDITIONS'),
          treatment: choice(
            requirement.treatment,
            [
              'ADDRESSED',
              'CONDITIONS_UNCONFIRMED',
              'NOT_APPLICABLE_WITH_BASIS',
              'LATER_BUSINESS_STAGE',
              'NOT_YET_ADDRESSED',
            ] as const,
            'REQUIREMENT_TREATMENT',
          ),
          basisRefs: refs(requirement.basisRefs, 'REQUIREMENT_BASIS', true),
          explanation: text(requirement.explanation, 'REQUIREMENT_EXPLANATION'),
        };
      });
      const sourceDependencies = refs(
        issue.sourceDependencies,
        'ISSUE_DEPENDENCIES',
      );
      const premiseRefs = refs(issue.premiseRefs ?? [], 'ISSUE_PREMISES', true);
      const usedRefs = new Set([
        ...statements.flatMap((item) =>
          item.premises.map((p) => p.evidenceRef),
        ),
        ...riskScenarios.flatMap((item) => [
          ...(item.severity?.basisRefs ?? []),
          ...(item.likelihood?.basisRefs ?? []),
          ...(item.importantEvent?.basisRefs ?? []),
        ]),
        ...measures.flatMap((item) => item.basisRefs),
        ...otherClassifications.flatMap((item) => item.basisRefs),
        ...requirementHandling.flatMap((item) => [
          item.methodRef,
          ...item.basisRefs,
        ]),
      ]);
      for (const ref of usedRefs)
        if (!sourceDependencies.includes(ref) && !premiseRefs.includes(ref))
          fail(`ISSUE_DEPENDENCY_MISSING:${ref}`);
      return {
        issueKey,
        issueRef,
        question: text(issue.question, 'ISSUE_QUESTION'),
        understanding: text(issue.understanding, 'ISSUE_UNDERSTANDING'),
        statements,
        riskScenarios,
        measures,
        otherClassifications,
        openQuestions,
        requirementHandling,
        sourceDependencies,
        premiseRefs,
        ...(issue.legacyCriterionRefs === undefined
          ? {}
          : {
              legacyCriterionRefs: strings(
                issue.legacyCriterionRefs,
                'LEGACY_REFS',
              ),
            }),
      };
    },
  );
  const changedKeys = updates.map((issue) => issue.issueKey);
  distinct(
    [...changedKeys, ...unchanged, ...retirements.map((item) => item.issueKey)],
    'ISSUE_PARTITION',
  );
  for (const issueKey of [
    ...unchanged,
    ...retirements.map((item) => item.issueKey),
  ])
    if (!prior.has(issueKey)) fail('UNKNOWN_PRIOR_ISSUE');
  for (const issueKey of prior.keys())
    if (
      ![
        ...changedKeys,
        ...unchanged,
        ...retirements.map((item) => item.issueKey),
      ].includes(issueKey)
    )
      fail(`PRIOR_ISSUE_OMITTED:${issueKey}`);
  for (const item of retirements) prior.delete(item.issueKey);
  for (const item of updates) prior.set(item.issueKey, item);
  const issues = [...prior.values()];
  if (issues.length === 0) fail('SUBSTANTIVE_WORK_REQUIRED');
  for (const issue of issues)
    for (const ref of [...issue.sourceDependencies, ...issue.premiseRefs])
      if (!registry.has(ref))
        fail(`RETAINED_SOURCE_NO_LONGER_AUTHORIZED:${ref}`);
  const decisiveIssueKeys = strings(value.decisiveIssueKeys, 'DECISIVE_ISSUES');
  if (
    decisiveIssueKeys.length === 0 ||
    decisiveIssueKeys.some((issueKey) => !prior.has(issueKey))
  )
    fail('DECISIVE_ISSUES_INVALID');
  const roundCompletion = choice(
    value.roundCompletion,
    ['IN_PROGRESS', 'COMPLETE', 'COMPLETE_WITH_OPEN_QUESTIONS'] as const,
    'ROUND_COMPLETION',
  );
  if (
    roundCompletion === 'COMPLETE' &&
    issues.some(
      (issue) =>
        issue.openQuestions.length > 0 ||
        issue.requirementHandling.some((item) =>
          ['CONDITIONS_UNCONFIRMED', 'NOT_YET_ADDRESSED'].includes(
            item.treatment,
          ),
        ),
    )
  )
    fail('OPEN_QUESTIONS_REQUIRE_QUALIFIED_COMPLETION');
  if (
    roundCompletion !== 'IN_PROGRESS' &&
    !context.evidence.some(
      (item) => item.kind === 'DOCUMENT_PASSAGE' && read.has(item.evidenceRef),
    )
  )
    fail('BUSINESS_SOURCE_NOT_READ');
  const unchangedExplanation = text(
    value.unchangedExplanation,
    'UNCHANGED_EXPLANATION',
  );
  return {
    schemaVersion: JOBAID_PROBLEM_WORK_SCHEMA,
    headline: text(value.headline, 'HEADLINE'),
    listBrief: text(value.listBrief, 'LIST_BRIEF'),
    understanding: text(value.understanding, 'UNDERSTANDING'),
    decisiveIssueKeys,
    issues,
    roundCompletion,
    completionReason: text(value.completionReason, 'COMPLETION_REASON'),
    changeSummary: text(value.changeSummary, 'CHANGE_SUMMARY'),
    unchangedExplanation,
    methodBinding: structuredClone(JOBAID_METHOD_BINDING),
    evidence: structuredClone(
      context.evidence.filter((item) => read.has(item.evidenceRef)),
    ),
    readSourceRefs: [...context.readSourceRefs],
    capabilities: structuredClone(context.capabilities),
    historyReview: structuredClone(context.history),
  };
}

function fail(code: string): never {
  throw new Error(`JOBAID_${code}`);
}
function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail(`${name}_INVALID`);
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) fail(`${name}_INVALID`);
  return value.trim();
}
function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) fail(`${name}_INVALID`);
  return value;
}
function strings(value: unknown, name: string): string[] {
  const result = array(value, name).map((item) => text(item, name));
  distinct(result, name);
  return result;
}
function distinct(values: string[], name: string): void {
  if (new Set(values).size !== values.length) fail(`${name}_DUPLICATE`);
}
function key(value: unknown): string {
  const result = text(value, 'KEY');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(result)) fail('KEY_INVALID');
  return result;
}
function choice<T extends string>(
  value: unknown,
  choices: readonly T[],
  name: string,
): T {
  if (typeof value !== 'string' || !choices.includes(value as T))
    fail(`${name}_INVALID`);
  return value as T;
}

export { jobAidReadingResult } from '@shared/jobaid-problem-assessment.interface';
