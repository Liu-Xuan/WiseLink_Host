// Describes model-authored update fields only. Host validation remains authoritative.
const text = { type: 'string', minLength: 1 };
const list = (items) => ({ type: 'array', items });
const texts = list(text);
const object = (properties) => ({ type: 'object', properties });
const choice = (...values) => ({ type: 'string', enum: values });
const nullable = (schema) => ({ ...schema, nullable: true });
const classification = nullable(object({ label: text, reason: text, basisRefs: texts }));
export const JOBAID_WORK_UPDATE_SHAPE = object({
  schemaVersion: choice('wiselink.jobaid-problem-work.v2'),
  headline: text, listBrief: text, understanding: text, decisiveIssueKeys: texts,
  roundCompletion: choice('IN_PROGRESS', 'COMPLETE', 'COMPLETE_WITH_OPEN_QUESTIONS'),
  completionReason: text, changeSummary: text, unchangedExplanation: text,
  unchangedIssueKeys: texts,
  retiredIssues: list(object({ issueKey: text, reason: text })),
  issues: list(object({
    issueKey: text, question: text, understanding: text,
    statements: list(object({
      claimKey: text, text, basis: choice('SOURCE_FACT', 'CONDITIONAL_INFERENCE'),
      premises: list(object({ evidenceRef: text,
        role: choice('SUPPORTS', 'LIMITS', 'CONTEXT', 'CONFLICTS'),
        explanation: text, limitation: nullable(text) })),
    })),
    riskScenarios: list(object({ scenario: text, conditions: texts,
      method: choice('JA_AC_R01'), severity: classification, likelihood: classification,
      importantEvent: nullable(object({ event: text, reason: text, basisRefs: texts })),
      limitations: texts, controlComparison: text,
    })),
    measures: list(object({ text, addresses: text, limitations: texts,
      status: choice('PROPOSED', 'REPORTED_IMPLEMENTED', 'VERIFIED_EFFECTIVE'), basisRefs: texts })),
    otherClassifications: list(object({ method: choice('SAE_EVENT_CATEGORY', 'SOURCE_DOCUMENT_CLASSIFICATION', 'EO_ATTRIBUTE'),
      value: text, reason: text, basisRefs: texts })),
    openQuestions: list(object({ question: text, affects: text, nextEvidence: text, reason: text })),
    requirementHandling: list(object({ methodRef: text, requirement: text, conditions: texts,
      treatment: choice('ADDRESSED', 'CONDITIONS_UNCONFIRMED', 'NOT_APPLICABLE_WITH_BASIS', 'LATER_BUSINESS_STAGE', 'NOT_YET_ADDRESSED'),
      basisRefs: texts, explanation: text })),
    sourceDependencies: texts, premiseRefs: texts, legacyCriterionRefs: texts,
  })),
});

// Post-rejection diagnostics only: examine supplied fields without modifying,
// rejecting, or accepting candidate work. Missing fields and evidence semantics
// remain governed by the Host. Never echo candidate values into diagnostics.
export function jobAidWorkTypeErrors(work) {
  const errors = [];
  function visit(value, schema, path) {
    if (value === undefined || (schema.nullable && value === null)) return;
    const received = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    const invalid = received !== schema.type ||
      (schema.type === 'string' && schema.minLength && !value.trim()) ||
      (schema.enum && !schema.enum.includes(value));
    if (invalid) {
      errors.push({ path, expected: schema.enum ? `one of ${schema.enum.join(' | ')}` :
        schema.minLength ? 'non-empty string' : schema.type, received });
      return;
    }
    if (schema.type === 'array') value.forEach((item, i) => visit(item, schema.items, `${path}[${i}]`));
    if (schema.type === 'object') for (const [key, child] of Object.entries(schema.properties)) {
      visit(value[key], child, `${path}.${key}`);
    }
  }
  visit(work, JOBAID_WORK_UPDATE_SHAPE, 'work');
  return errors;
}

// Explain an existing Host dependency rejection; never insert references or
// synthesize an evidence registry. Paths reveal where the model must reconcile
// its own citations with the issue's declared dependencies.
export function jobAidWorkDependencyErrors(work) {
  const errors = [];
  if (!Array.isArray(work?.issues)) return errors;
  work.issues.forEach((issue, issueIndex) => {
    const root = `work.issues[${issueIndex}]`;
    const declared = new Set([
      ...(Array.isArray(issue?.sourceDependencies) ? issue.sourceDependencies : []),
      ...(Array.isArray(issue?.premiseRefs) ? issue.premiseRefs : []),
    ].filter((ref) => typeof ref === 'string').map((ref) => ref.trim()));
    const check = (ref, path) => {
      if (typeof ref === 'string' && !declared.has(ref.trim())) errors.push({
        path, expected: `reference included in ${root}.sourceDependencies or ${root}.premiseRefs`,
        received: 'undeclared reference',
      });
    };
    const each = (items, visit) => { if (Array.isArray(items)) items.forEach(visit); };
    const basis = (value, path) => each(value?.basisRefs, (ref, i) => check(ref, `${path}.basisRefs[${i}]`));
    each(issue?.statements, (statement, i) => each(statement?.premises, (premise, j) =>
      check(premise?.evidenceRef, `${root}.statements[${i}].premises[${j}].evidenceRef`)));
    each(issue?.riskScenarios, (risk, i) => {
      for (const field of ['severity', 'likelihood', 'importantEvent']) basis(risk?.[field], `${root}.riskScenarios[${i}].${field}`);
    });
    for (const field of ['measures', 'otherClassifications', 'requirementHandling']) {
      each(issue?.[field], (item, i) => {
        basis(item, `${root}.${field}[${i}]`);
        if (field === 'requirementHandling') check(item?.methodRef, `${root}.${field}[${i}].methodRef`);
      });
    }
  });
  return errors;
}
