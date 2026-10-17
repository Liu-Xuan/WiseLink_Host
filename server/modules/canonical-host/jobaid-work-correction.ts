import { z } from 'zod/v4';
import type { JobAidProblemIssue, JobAidProblemWorkContent,
  JobAidWorkRevision } from '@shared/jobaid-problem-assessment.interface';
import { JOBAID_PROBLEM_WORK_SCHEMA } from '@shared/jobaid-problem-assessment.interface';
import { JOBAID_WORK_CORRECTION_SCHEMA, type JobAidWorkCorrectionChangedField,
  type JobAidWorkCorrectionRequest } from '@shared/jobaid-work-correction.interface';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';
import { assertJobAidIssueEditScope, materializeJobAidWork } from './jobaid-problem-work';

export const JOBAID_MANUAL_CORRECTION_ACTION = 'HOST_JOBAID_MANUAL_CORRECTION';
export const JOBAID_MANUAL_CORRECTION_ORIGIN = 'HOST_BROWSER_CORRECTION';
export const JOBAID_MANUAL_CORRECTION_AUDIT = 'wiselink.jobaid-manual-correction-execution.v1';

const nonblank = z.string().min(1).refine((value: string) => !!value.trim());
const classification = z.strictObject({ label: nonblank, reason: nonblank,
  basisRefs: z.array(nonblank) });
const scenario = z.strictObject({
  scenario: nonblank, conditions: z.array(nonblank), method: z.literal('JA_AC_R01'),
  severity: classification.nullable(), likelihood: classification.nullable(),
  score: z.number().nullable(), riskGrade: z.union([
    z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5),
  ]).nullable(), gradeMeaning: nonblank.nullable(),
  importantEvent: z.strictObject({ event: nonblank, reason: nonblank,
    basisRefs: z.array(nonblank) }).nullable(),
  limitations: z.array(nonblank), controlComparison: nonblank,
});
const textChange = {
  issueKey: nonblank.max(200), issueRef: nonblank.max(512),
  expectedOldValue: z.string().max(1_000_000),
  // The ordinary materializer trims strings: reject a lossy request explicitly.
  newValue: nonblank.max(1_000_000).refine((value: string) => value === value.trim()),
  reason: nonblank.max(4000), evidenceRefs: z.array(nonblank.max(2000)).min(1).max(200),
};
const requestSchema = z.strictObject({
  schemaVersion: z.literal(JOBAID_WORK_CORRECTION_SCHEMA),
  requestId: z.string().regex(/^[A-Za-z0-9:_-]{1,96}$/u),
  baseWorkRef: z.string().regex(/^JAWR-[A-Za-z0-9-]{1,91}$/u),
  baseWorkRevision: z.number().int().positive(),
  expectedWorkItemRevision: z.number().int().positive(),
  changes: z.array(z.discriminatedUnion('field', [
    z.strictObject({ ...textChange, field: z.literal('ISSUE_BODY') }),
    z.strictObject({ ...textChange, field: z.literal('RISK_SEVERITY_REASON'),
      scenarioIndex: z.number().int().nonnegative(), expectedScenario: scenario }),
  ])).min(1).max(20),
});

export function correctionError(code: string, statusCode = 409): Error & {
  code: string; statusCode: number;
} {
  return Object.assign(new Error(code), { code, statusCode });
}

export function parseJobAidWorkCorrectionRequest(raw: unknown): JobAidWorkCorrectionRequest {
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) throw correctionError('JOBAID_CORRECTION_REQUEST_INVALID', 400);
  return parsed.data as JobAidWorkCorrectionRequest;
}

function citations(value: string): string[] {
  const stripped = value.replace(/\[\[([^\[\]\r\n]+)\]\]/gu, '');
  if (stripped.includes('[[') || stripped.includes(']]'))
    throw correctionError('JOBAID_CORRECTION_CITATION_MALFORMED', 400);
  return [...value.matchAll(/\[\[([^\[\]\r\n]+)\]\]/gu)].map((match: RegExpMatchArray) => match[1]);
}

/** Projects the complete existing issue into the normal SAVE command, not a body-only replacement. */
function issueCommand(issue: JobAidProblemIssue) {
  return { issueKey: issue.issueKey, question: issue.question, body: issue.body,
    riskScenarios: issue.riskScenarios.map(({ gradeMeaning: _derived, ...risk }) => structuredClone(risk)),
    measures: structuredClone(issue.measures),
    otherClassifications: structuredClone(issue.otherClassifications),
    openQuestions: structuredClone(issue.openQuestions), requirementHandling: structuredClone(issue.requirementHandling) };
}

/** No producer or source rights are inferred here: the transaction owner reauthorizes the exact base. */
export function materializeManualJobAidCorrection(base: JobAidWorkRevision,
  request: JobAidWorkCorrectionRequest): {
    content: JobAidProblemWorkContent; changedFields: JobAidWorkCorrectionChangedField[];
  } {
  if (base.workRevisionRef !== request.baseWorkRef || base.workRevision !== request.baseWorkRevision)
    throw correctionError('JOBAID_CORRECTION_BASE_CONFLICT');
  if (base.content.historicalSourceSchema) throw correctionError('JOBAID_CORRECTION_CURRENT_V3_REQUIRED');
  const expected: JobAidProblemWorkContent = structuredClone(base.content);
  const read: Set<string> = new Set(base.content.readSourceRefs);
  const registry: Set<string> = new Set(base.content.evidence.map((item) => item.evidenceRef));
  const targets: Set<string> = new Set();
  const changed: JobAidWorkCorrectionChangedField[] = [];
  for (const change of request.changes) {
    const key = canonicalJson([change.issueKey, change.field,
      change.field === 'RISK_SEVERITY_REASON' ? change.scenarioIndex : null]);
    if (targets.has(key)) throw correctionError('JOBAID_CORRECTION_DUPLICATE_TARGET', 400);
    targets.add(key);
    const original = base.content.issues.find((item) => item.issueKey === change.issueKey);
    const next = expected.issues.find((item) => item.issueKey === change.issueKey);
    if (!original || !next || original.issueRef !== change.issueRef)
      throw correctionError('JOBAID_CORRECTION_ISSUE_CONFLICT');
    const refs = new Set(change.evidenceRefs);
    if (refs.size !== change.evidenceRefs.length ||
      change.evidenceRefs.some((ref) => !registry.has(ref) || !read.has(ref)) ||
      [...citations(change.newValue), ...citations(change.reason)].some((ref) => !refs.has(ref)))
      throw correctionError('JOBAID_CORRECTION_EVIDENCE_NOT_DELIVERED', 400);
    if (change.field === 'ISSUE_BODY') {
      if (original.body !== change.expectedOldValue) throw correctionError('JOBAID_CORRECTION_OLD_VALUE_CONFLICT');
      next.body = change.newValue;
      if (original.body !== next.body) changed.push({ field: change.field,
        issueKey: change.issueKey, issueRef: change.issueRef });
    } else {
      const before = original.riskScenarios[change.scenarioIndex];
      const after = next.riskScenarios[change.scenarioIndex];
      if (!before?.severity || !after?.severity || canonicalJson(before) !== canonicalJson(change.expectedScenario))
        throw correctionError('JOBAID_CORRECTION_SCENARIO_CONFLICT');
      if (before.severity.reason !== change.expectedOldValue)
        throw correctionError('JOBAID_CORRECTION_OLD_VALUE_CONFLICT');
      after.severity.reason = change.newValue;
      if (before.severity.reason !== after.severity.reason) changed.push({ field: change.field,
        issueKey: change.issueKey, issueRef: change.issueRef, scenarioIndex: change.scenarioIndex });
    }
  }
  const changedKeys = new Set(changed.map((item) => item.issueKey));
  const content = materializeJobAidWork({ schemaVersion: JOBAID_PROBLEM_WORK_SCHEMA,
    issues: expected.issues.filter((item) => changedKeys.has(item.issueKey)).map(issueCommand),
    roundCompletion: base.content.roundCompletion, completionReason: base.content.completionReason,
    changeSummary: base.content.changeSummary, unchangedExplanation: base.content.unchangedExplanation,
  }, { workItemId: base.workItemId, methodBinding: base.content.methodBinding,
    previous: base.content, evidence: base.content.evidence, readSourceRefs: base.content.readSourceRefs,
    // Existing receipt identities are preserved; this records no new source read or semantic reanalysis.
    currentDeliveredSourceRefs: base.content.readSourceRefs,
    capabilities: base.content.capabilities, history: base.content.historyReview });
  if (changed.length) assertJobAidIssueEditScope(base.content, content, [...changedKeys]);
  expected.overviewStatus = changed.length && base.content.overviewStatus !== 'NOT_AVAILABLE'
    ? 'STALE' : base.content.overviewStatus;
  for (const issue of expected.issues) {
    const actual = content.issues.find((item) => item.issueKey === issue.issueKey)!;
    // Only the normal validator derives these citation indexes; they are not client-writable fields.
    issue.sourceDependencies = actual.sourceDependencies;
    issue.premiseRefs = actual.premiseRefs;
  }
  if (canonicalJson(content) !== canonicalJson(expected))
    throw correctionError('JOBAID_CORRECTION_PROTECTED_FIELD_CHANGED');
  return { content, changedFields: changed };
}
