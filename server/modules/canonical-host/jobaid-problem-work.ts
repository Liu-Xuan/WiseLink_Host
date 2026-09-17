import type {
  AssessmentEvidence,
  AssessmentReadingResult,
} from '@shared/assessment-reading.interface';
import {
  JOBAID_PROBLEM_WORK_SCHEMA,
  type JobAidProblemIssue,
  type JobAidProblemWorkContent,
  type JobAidRiskScenario,
} from '@shared/jobaid-problem-assessment.interface';
import { isJobAidMethodBinding } from './jobaid-method-pack';
import { collectIssueEvidenceUses } from '@shared/jobaid-evidence-uses';

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

export type JobAidWorkValidationContext = (
  | { workItemId: string; matterId?: never }
  | { matterId: string; workItemId?: never }
) & {
  methodBinding: JobAidProblemWorkContent['methodBinding'];
  previous: JobAidProblemWorkContent | null;
  /** Used only when validating an already persisted revision. */
  persistedOverviewStatus?: JobAidProblemWorkContent['overviewStatus'];
  evidence: AssessmentEvidence[];
  readSourceRefs: string[];
  capabilities: JobAidProblemWorkContent['capabilities'];
  history: JobAidProblemWorkContent['historyReview'];
};

/** Materialize a complete revision from a bounded local update, never an empty legacy table. */
export function materializeJobAidWork(
  raw: unknown,
  context: JobAidWorkValidationContext,
): JobAidProblemWorkContent {
  const value = object(raw, 'WORK');
  exact(value, ['schemaVersion', 'issues', 'headline', 'listBrief', 'overview', 'roundCompletion', 'completionReason', 'changeSummary', 'unchangedExplanation', 'unchangedIssueKeys', 'retiredIssues', 'inputDispositions', 'reviewConditionDelta']);
  if (!isJobAidMethodBinding(context.methodBinding)) fail('METHOD_BINDING_INVALID');
  const subjectId = text(context.matterId ?? context.workItemId, 'SUBJECT');
  if (context.matterId !== undefined && context.workItemId !== undefined)
    fail('SUBJECT_AMBIGUOUS');
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
        prior.get(issueKey)?.issueRef ?? `${subjectId}:issue:${issueKey}`;
      exact(issue, ['issueKey', 'question', 'body', 'riskScenarios', 'measures', 'otherClassifications', 'openQuestions', 'requirementHandling']);
      const body = text(issue.body, 'ISSUE_BODY');
      const citations = [...body.matchAll(/\[\[([^\[\]\r\n]+)\]\]/gu)].map(match => match[1]);
      if (!citations.length) fail('BODY_CITATIONS_REQUIRED');
      refs([...new Set(citations)], 'BODY_CITATIONS');
      if (body.replace(/\[\[([^\[\]\r\n]+)\]\]/gu, '').includes('[[') || body.replace(/\[\[([^\[\]\r\n]+)\]\]/gu, '').includes(']]')) fail('BODY_CITATION_MALFORMED');
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
      const sourceDependencies: string[] = [];
      const premiseRefs: string[] = [];
      const usedRefs = new Set(collectIssueEvidenceUses({ issueKey, body, riskScenarios,
        measures, otherClassifications, requirementHandling, sourceDependencies, premiseRefs,
      }).map(use => use.evidenceRef));
      sourceDependencies.push(...usedRefs);
      return {
        issueKey,
        issueRef,
        question: text(issue.question, 'ISSUE_QUESTION'),
        body,
        riskScenarios,
        measures,
        otherClassifications,
        openQuestions,
        requirementHandling,
        sourceDependencies,
        premiseRefs,

      };
    },
  );
  const changedKeys = updates.map((issue) => issue.issueKey);
  const updated = new Set(changedKeys);
  // Full supplied issue content is authoritative for this local update.
  // An optional unchanged index may redundantly name that same issue, even
  // during migration from legacy work with no problemWork collection yet.
  const retainedKeys = unchanged.filter((key) => !updated.has(key));
  distinct(
    [...changedKeys, ...retainedKeys, ...retirements.map((item) => item.issueKey)],
    'ISSUE_PARTITION',
  );
  for (const issueKey of [
    ...retainedKeys,
    ...retirements.map((item) => item.issueKey),
  ])
    if (!prior.has(issueKey)) fail('UNKNOWN_PRIOR_ISSUE');
  // This is a local update: the cloned prior work retains every untouched
  // issue. Only an explicit retirement removes one; omission is not deletion.
  for (const item of retirements) prior.delete(item.issueKey);
  for (const item of updates) prior.set(item.issueKey, item);
  const issues = [...prior.values()];
  if (issues.length === 0) fail('SUBSTANTIVE_WORK_REQUIRED');
  for (const issue of issues)
    for (const { evidenceRef: ref } of collectIssueEvidenceUses(issue))
      if (!registry.has(ref))
        fail(`RETAINED_SOURCE_NO_LONGER_AUTHORIZED:${ref}`);
  // Omission retains the exact saved summary, never an inferred new conclusion.
  // Explicit null/empty values still pass through the normal validators.
  const overview = value.overview === undefined ? context.previous?.understanding : text(value.overview, 'OVERVIEW');
  // Reading copy belongs to the same saved revision as the substantive work.
  // Never replace a supplied summary with the first issue's question or shorten
  // a qualification here. Omitting both fields retains the prior saved copy.
  if ((value.headline === undefined) !== (value.listBrief === undefined))
    fail('READING_SUMMARY_PAIR_REQUIRED');
  if (!context.previous && value.headline === undefined)
    fail('READING_SUMMARY_REQUIRED');
  const headline = value.headline === undefined
    ? context.previous!.headline
    : text(value.headline, 'HEADLINE');
  const listBrief = value.listBrief === undefined
    ? context.previous!.listBrief
    : text(value.listBrief, 'LIST_BRIEF');
  const decisiveIssueKeys = issues.map(issue => issue.issueKey);
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
  const unchangedExplanation = text(
    value.unchangedExplanation === undefined
      ? '未提交的问题和总体字段按既有工作保留；保留不代表本批重新验证。'
      : value.unchangedExplanation,
    'UNCHANGED_EXPLANATION',
  );
  return {
    schemaVersion: JOBAID_PROBLEM_WORK_SCHEMA,
    headline,
    listBrief,
    understanding: overview ?? '问题正文已保存；综合认识尚未形成。',
    decisiveIssueKeys,
    overviewStatus: context.persistedOverviewStatus ?? (value.overview !== undefined ? 'CURRENT' :
      context.previous?.overviewStatus && context.previous.overviewStatus !== 'NOT_AVAILABLE' ?
        (changedKeys.length || retirements.length ? 'STALE' : context.previous.overviewStatus) : 'NOT_AVAILABLE'),
    issues,
    roundCompletion,
    completionReason: text(value.completionReason, 'COMPLETION_REASON'),
    changeSummary: text(value.changeSummary, 'CHANGE_SUMMARY'),
    unchangedExplanation,
    methodBinding: structuredClone(context.methodBinding),
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
  const result = value as Record<string, unknown>;
  const fields: Record<string, string[]> = {
    RETIRED_ISSUE: ['issueKey', 'reason'],
    RISK: ['scenario', 'conditions', 'method', 'severity', 'likelihood', 'importantEvent', 'limitations', 'controlComparison', 'score', 'riskGrade'],
    SEVERITY: ['label', 'reason', 'basisRefs'], LIKELIHOOD: ['label', 'reason', 'basisRefs'],
    IMPORTANT_EVENT: ['event', 'basisRefs', 'reason'],
    MEASURE: ['text', 'addresses', 'limitations', 'status', 'basisRefs'],
    OTHER_CLASSIFICATION: ['method', 'value', 'reason', 'basisRefs'],
    OPEN_QUESTION: ['question', 'affects', 'nextEvidence', 'reason'],
    REQUIREMENT: ['methodRef', 'requirement', 'conditions', 'treatment', 'basisRefs', 'explanation'],
  };
  if (fields[name]) exact(result, fields[name]);
  return result;
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

function exact(value: Record<string, unknown>, allowed: string[]): void {
  for (const name of Object.keys(value)) if (!allowed.includes(name)) fail(`UNDECLARED_FIELD:${name}`);
}
