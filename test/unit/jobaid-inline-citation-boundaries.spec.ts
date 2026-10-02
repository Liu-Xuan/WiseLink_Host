import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import { collectEvidenceUses } from '@shared/jobaid-evidence-uses';
import { JOBAID_PROBLEM_WORK_SCHEMA, jobAidReadingResult } from '@shared/jobaid-problem-assessment.interface';
import { JOBAID_METHOD_BINDING } from '@server/modules/canonical-host/jobaid-method-pack';
import { assertJobAidIssueEditScope, materializeJobAidWork, type JobAidWorkValidationContext } from '@server/modules/canonical-host/jobaid-problem-work';
import { readHistoricalJobAidWork } from '@server/modules/canonical-host/jobaid-historical-reading';

// Synthetic offline sources: identities here do not assert real actor authorization.
function passage(documentVersionId: string, parse: string, sourceRefId: string): AssessmentEvidence {
  return {
    kind: 'DOCUMENT_PASSAGE', evidenceRef: `DOCUMENT_ORIGINAL:${documentVersionId}:${parse}:${sourceRefId}`,
    workItemId: null, documentVersionId, sourceRefId, locator: sourceRefId,
    title: 'Synthetic original passage', versionLabel: parse,
    excerpt: 'This paragraph describes one conditional path; literal [[E99]] is original text.',
  };
}
const a = passage('edition-a', 'parse-current', 'paragraph-a');
const b = passage('edition-b', 'parse-current', 'paragraph-b');
const c = passage('edition-b', 'parse-current', 'paragraph-c');
const oldA = passage('edition-a', 'parse-historical', 'paragraph-a');
const method: AssessmentEvidence = {
  kind: 'METHOD_CLAUSE', evidenceRef: 'METHOD:synthetic:clause', title: 'Synthetic method',
  versionLabel: 'R1', excerpt: 'Check relevant conditions and retain unknowns.',
  packRef: JOBAID_METHOD_BINDING.packRef, methodRef: 'synthetic-method',
  sourceIdentity: 'synthetic-method', locator: 'clause', sourceVersionStatus: 'VERSION_UNCONFIRMED',
};
const engineer: AssessmentEvidence = {
  kind: 'ENGINEER_STATEMENT', origin: 'REVIEW_CONVERSATION', evidenceRef: 'ENGINEER:conversation:turn:input',
  title: 'Synthetic recorded statement', versionLabel: null, excerpt: 'An observation was reported.',
  reviewConversationId: 'conversation', reviewTurnId: 'turn', engineerSuppliedInputId: 'input',
  recordedAt: '2026-10-02T14:00:00Z',
};
const prior: AssessmentEvidence = {
  kind: 'PRIOR_RESULT', evidenceRef: 'PRIOR_RESULT:synthetic:1', title: 'Synthetic previous candidate',
  versionLabel: '1', excerpt: 'A previous interpretation remains a candidate.',
  resultRef: 'synthetic-prior', resultRevision: 1, originalEvidenceRefs: [oldA.evidenceRef],
};
const evidence = [a, b, c, oldA, method, engineer, prior];
const context: JobAidWorkValidationContext = {
  workItemId: 'offline-boundaries', methodBinding: JOBAID_METHOD_BINDING, previous: null,
  evidence, readSourceRefs: evidence.map(item => item.evidenceRef), capabilities: [],
  history: { required: false, priorAssessmentRefs: [], engineeringDocumentRefs: [],
    coverage: 'NOT_REQUIRED', limitation: null },
};
const cite = (ref: string) => `[[${ref}]]`;
const issue = (issueKey = 'condition', body = `Original scope ${cite(a.evidenceRef)}`) => ({
  issueKey, question: 'What remains conditional?', body,
  riskScenarios: [{ scenario: 'Conditional exposure', conditions: ['Condition not yet confirmed'],
    method: 'JA_AC_R01', severity: null, likelihood: null, limitations: ['No frequency data'],
    controlComparison: 'Control effectiveness not verified' }],
  measures: [{ text: 'Proposed measure', addresses: 'Conditional exposure',
    limitations: ['Implementation not established'], status: 'PROPOSED', basisRefs: [a.evidenceRef] }],
  otherClassifications: [{ method: 'SOURCE_DOCUMENT_CLASSIFICATION', value: 'Original category',
    reason: 'Category identity only', basisRefs: [a.evidenceRef] }],
  openQuestions: [{ question: 'Target condition unknown', affects: 'Applicability',
    nextEvidence: 'Acquire target configuration', reason: 'No configuration evidence' }],
  requirementHandling: [{ methodRef: method.evidenceRef, requirement: 'Check relevant conditions',
    conditions: ['Configuration unknown'], treatment: 'CONDITIONS_UNCONFIRMED',
    basisRefs: [a.evidenceRef], explanation: 'No applicability decision yet' }],
});
const update = (issues: unknown[]) => ({
  schemaVersion: JOBAID_PROBLEM_WORK_SCHEMA, headline: 'Conditional interpretation',
  listBrief: 'Configuration and effects remain unconfirmed.', issues, roundCompletion: 'IN_PROGRESS',
  completionReason: 'Further evidence required.', changeSummary: 'Offline boundary validation.',
});

test('cross-paragraph and multi-document prose citations persist exact refs into the reading source-use index', () => {
  const item = issue();
  item.body += `\n\nSeparate paragraph ${cite(b.evidenceRef)}${cite(c.evidenceRef)}`;
  item.riskScenarios[0].conditions = [`Separate condition ${cite(c.evidenceRef)}`];
  item.measures[0].addresses = `Only the stated branch ${cite(b.evidenceRef)}`;
  const before = structuredClone(item);
  const work = materializeJobAidWork(update([item]), context);
  expect(item).toEqual(before);
  expect(work.issues[0].body).toBe(before.body);
  expect(work.issues[0].sourceDependencies.filter(ref => ref === b.evidenceRef)).toHaveLength(1);
  expect(work.issues[0].sourceDependencies.filter(ref => ref === c.evidenceRef)).toHaveLength(1);
  for (const ref of [b.evidenceRef, c.evidenceRef]) {
    expect(collectEvidenceUses(work)).toContainEqual(expect.objectContaining({
      evidenceRef: ref, issueKey: 'condition', role: 'DEPENDENCY',
    }));
  }
  const reading = jobAidReadingResult({ workRevisionRef: 'offline-work', workItemId: 'offline-boundaries',
    workRevision: 1, previousWorkRevisionRef: null, requestId: 'offline-request',
    actionAttemptId: 'offline-attempt', basedOnWorkItemRevision: 1, documentVersionId: 'edition-a',
    createdAt: '2026-10-02T14:00:00Z', content: work });
  expect(reading.content.issueArticles?.[0].body).toBe(before.body);
});

test('mixed source kinds stay in their original namespaces and do not become original facts', () => {
  const item = issue();
  item.riskScenarios[0].conditions = [`Reported condition ${cite(engineer.evidenceRef)}`];
  item.measures[0].limitations = [`Previous interpretation ${cite(prior.evidenceRef)}`];
  item.openQuestions[0].reason = `Method condition ${cite(method.evidenceRef)}`;
  const work = materializeJobAidWork(update([item]), context);
  for (const source of [engineer, prior, method]) {
    expect(work.issues[0].sourceDependencies).toContain(source.evidenceRef);
    expect(work.evidence.find(entry => entry.evidenceRef === source.evidenceRef)).toEqual(source);
  }
  expect(work.issues[0].measures[0].status).toBe('PROPOSED');
  expect(work.issues[0].riskScenarios[0].score).toBeNull();
});

test('condition-only citations to separate paragraphs remain separate without an inferred causal link', () => {
  const item = issue();
  const conditions = [`First conditional path ${cite(b.evidenceRef)}`,
    `Second conditional path ${cite(c.evidenceRef)}`];
  item.riskScenarios[0].conditions = conditions;
  const work = materializeJobAidWork(update([item]), context);
  expect(work.issues[0].riskScenarios[0].conditions).toEqual(conditions);
  expect(work.issues[0].sourceDependencies).toEqual(expect.arrayContaining([b.evidenceRef, c.evidenceRef]));
});

test.each(['E99', ' paragraph-b ', 'DOCUMENT_ORIGINAL:edition-b:parse-current:missing']) (
  'an explicit unknown alias %s is rejected rather than inferred from a catalog source', (ref) => {
    const item = issue();
    item.measures[0].addresses = `Conditional path ${cite(ref)}`;
    expect(() => materializeJobAidWork(update([item]), context)).toThrow('SOURCE_NOT_DELIVERED');
  },
);

test('ordinary prose, single brackets and requested bare identifiers remain text; source excerpts are not scanned', () => {
  const item = issue();
  const prose = `E99 and [E99] describe requested evidence; request ${b.evidenceRef}.`;
  item.measures[0].addresses = prose;
  item.openQuestions[0].nextEvidence = prose;
  const work = materializeJobAidWork(update([item]), {
    ...context, readSourceRefs: [a.evidenceRef, method.evidenceRef],
  });
  expect(work.issues[0].measures[0].addresses).toBe(prose);
  expect(work.issues[0].sourceDependencies).not.toContain(b.evidenceRef);
  expect(work.evidence.find(entry => entry.evidenceRef === a.evidenceRef)?.excerpt).toContain('[[E99]]');
});

const unseenLocations = ['question', 'risk-reason', 'classification', 'open-question', 'requirement'] as const;
test.each(unseenLocations)('a catalog but unread explicit citation in %s cannot bypass delivery', location => {
  const item = issue();
  const prose = `Unconfirmed statement ${cite(b.evidenceRef)}`;
  if (location === 'question') item.question = prose;
  if (location === 'risk-reason') item.riskScenarios[0].controlComparison = prose;
  if (location === 'classification') item.otherClassifications[0].reason = prose;
  if (location === 'open-question') item.openQuestions[0].reason = prose;
  if (location === 'requirement') item.requirementHandling[0].explanation = prose;
  expect(() => materializeJobAidWork(update([item]), {
    ...context, readSourceRefs: [a.evidenceRef, method.evidenceRef],
  })).toThrow('SOURCE_NOT_DELIVERED');
});

test('a citation cannot join paragraphs or hide an unmatched closing delimiter', () => {
  for (const prose of ['Citation [[paragraph\nother]]', 'Claim with dangling closing brackets ]]']) {
    const item = issue(); item.measures[0].addresses = prose;
    expect(() => materializeJobAidWork(update([item]), context)).toThrow('CITATION_MALFORMED');
  }
});

test('a historical work keeps its old parse citation and cannot silently resolve it through a newer parse', () => {
  const item = issue('historical', `Historical original ${cite(oldA.evidenceRef)}`);
  item.measures[0].basisRefs = [oldA.evidenceRef];
  item.otherClassifications[0].basisRefs = [oldA.evidenceRef];
  item.requirementHandling[0].basisRefs = [oldA.evidenceRef];
  item.riskScenarios[0].conditions = [`Historical condition ${cite(oldA.evidenceRef)}`];
  const oldWork = materializeJobAidWork(update([item]), context);
  const before = structuredClone(oldWork);
  const read = readHistoricalJobAidWork(oldWork, { workItemId: 'offline-boundaries' });
  expect(read.issues[0].body).toContain(oldA.evidenceRef);
  expect(read.issues[0].sourceDependencies).not.toContain(a.evidenceRef);
  expect(oldWork).toEqual(before);
  expect(() => materializeJobAidWork(update([]), {
    ...context, previous: oldWork, evidence: evidence.filter(source => source !== oldA),
    readSourceRefs: context.readSourceRefs.filter(ref => ref !== oldA.evidenceRef),
  })).toThrow(`RETAINED_SOURCE_NO_LONGER_AUTHORIZED:${oldA.evidenceRef}`);
});

test('same document and locator with another parse does not satisfy an exact delivered historical ref', () => {
  const item = issue();
  item.measures[0].limitations = [`Historical qualification ${cite(oldA.evidenceRef)}`];
  expect(() => materializeJobAidWork(update([item]), {
    ...context, readSourceRefs: context.readSourceRefs.filter(ref => ref !== oldA.evidenceRef),
  })).toThrow(`SOURCE_NOT_DELIVERED:${oldA.evidenceRef}`);
});

test('a local correction preserves untouched issues, prose citations and limitations exactly', () => {
  const untouched = issue('untouched');
  untouched.riskScenarios[0].conditions = [`Separate unconfirmed branch ${cite(c.evidenceRef)}`];
  const previous = materializeJobAidWork(update([issue('changed'), untouched]), context);
  const replacement = issue('changed', `Corrected local scope ${cite(b.evidenceRef)}`);
  replacement.measures[0].basisRefs = [b.evidenceRef];
  const work = materializeJobAidWork(update([replacement]), { ...context, previous });
  expect(work.issues[1]).toEqual(previous.issues[1]);
  expect(work.issues[1].sourceDependencies).toContain(c.evidenceRef);
  expect(previous.issues[0].body).toBe(issue('changed').body);
});

test('retained legacy prose citations remain visible without rewriting old issue indexes or expanding edit scope', () => {
  const legacyIssue = issue('untouched');
  legacyIssue.riskScenarios[0].conditions = [`Condition-only original ${cite(c.evidenceRef)}`];
  const previous = materializeJobAidWork(update([issue('changed'), legacyIssue]), context);
  // Reproduce the legacy omission; the original delivered evidence remains authorized.
  previous.issues[1].sourceDependencies = [a.evidenceRef, method.evidenceRef];
  const before = structuredClone(previous.issues[1]);
  const changed = issue('changed', `Corrected scope ${cite(b.evidenceRef)}`);
  const work = materializeJobAidWork(update([changed]), { ...context, previous });
  expect(work.issues[1]).toEqual(before);
  expect(() => assertJobAidIssueEditScope(previous, work, ['changed'])).not.toThrow();
  expect(collectEvidenceUses(work)).toContainEqual(expect.objectContaining({
    issueKey: 'untouched', evidenceRef: c.evidenceRef, role: 'DEPENDENCY',
  }));
});
