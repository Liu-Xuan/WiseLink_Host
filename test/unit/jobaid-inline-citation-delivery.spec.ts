import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import { JOBAID_PROBLEM_WORK_SCHEMA } from '@shared/jobaid-problem-assessment.interface';
import { materializeJobAidWork } from '../../server/modules/canonical-host/jobaid-problem-work';
import { JOBAID_METHOD_BINDING } from '../../server/modules/canonical-host/jobaid-method-pack';

// Offline synthetic subject only: no actor, DB, model, formal save or adoption.
const source = (id: string): AssessmentEvidence => ({
  evidenceRef: `DOCUMENT_ORIGINAL:edition:parse:${id}`,
  kind: 'DOCUMENT_PASSAGE', workItemId: null, documentVersionId: 'edition',
  sourceRefId: id, locator: id, title: 'Synthetic source', versionLabel: 'parse',
  excerpt: id === 'a' ? 'A describes the scope.' : 'B describes a separate condition.',
});
const a = source('a');
const b = source('b');
const unknownRef = 'DOCUMENT_ORIGINAL:other-edition:other-parse:unissued';
const context = {
  workItemId: 'offline-subject', methodBinding: JOBAID_METHOD_BINDING,
  previous: null, evidence: [a, b], readSourceRefs: [a.evidenceRef],
  capabilities: [], history: { required: false, priorAssessmentRefs: [],
    engineeringDocumentRefs: [], coverage: 'NOT_REQUIRED' as const, limitation: null },
};
const issue = () => ({
  issueKey: 'scope', question: 'What conditions apply?', body: `Source scope [[${a.evidenceRef}]]`,
  riskScenarios: [{ scenario: 'Conditional exposure', conditions: ['Condition unknown'],
    method: 'JA_AC_R01', severity: null, likelihood: null, limitations: ['Exposure unverified'],
    controlComparison: 'No verified effect' }],
  measures: [{ text: 'Proposed measure', addresses: 'Conditional exposure',
    limitations: ['Not implemented'], status: 'PROPOSED', basisRefs: [a.evidenceRef] }],
});
const update = (item: ReturnType<typeof issue>) => ({
  schemaVersion: JOBAID_PROBLEM_WORK_SCHEMA, headline: 'Conditional scope',
  listBrief: 'Target conditions remain unknown.', issues: [item],
  roundCompletion: 'IN_PROGRESS', completionReason: 'Check remaining conditions.',
  changeSummary: 'Offline citation delivery acceptance.',
});
const fields = ['condition', 'addresses', 'measure-limitation'] as const;
function withCitation(field: typeof fields[number], ref: string) {
  const item = issue();
  const prose = `Conditional statement [[${ref}]]`;
  if (field === 'condition') item.riskScenarios[0].conditions = [prose];
  if (field === 'addresses') item.measures[0].addresses = prose;
  if (field === 'measure-limitation') item.measures[0].limitations = [prose];
  return item;
}

describe.each(fields)('explicit %s citation', (field) => {
  test('rejects a ref outside the exact authorized catalog', () => {
    expect(() => materializeJobAidWork(update(withCitation(field, unknownRef)), context))
      .toThrow('SOURCE_NOT_DELIVERED');
  });
  test('rejects a catalog lead that was not delivered', () => {
    expect(() => materializeJobAidWork(update(withCitation(field, b.evidenceRef)), context))
      .toThrow('SOURCE_NOT_DELIVERED');
  });
});

test('a ref used only in condition prose remains available for existing source drilldown', () => {
  const work = materializeJobAidWork(update(withCitation('condition', b.evidenceRef)), {
    ...context, readSourceRefs: [a.evidenceRef, b.evidenceRef],
  });
  expect(work.issues[0].sourceDependencies).toContain(b.evidenceRef);
  expect(work.issues[0].riskScenarios[0].conditions[0]).toBe(`Conditional statement [[${b.evidenceRef}]]`);
});

test('retaining an issue cannot retain a prose citation whose source authorization was removed', () => {
  const previous = materializeJobAidWork(update(withCitation('condition', b.evidenceRef)), {
    ...context, readSourceRefs: [a.evidenceRef, b.evidenceRef],
  });
  const retained = { ...update(issue()), issues: [] };
  expect(() => materializeJobAidWork(retained, {
    ...context, previous, evidence: [a], readSourceRefs: [a.evidenceRef],
  })).toThrow('RETAINED_SOURCE_NO_LONGER_AUTHORIZED');
});

test('the retained check also covers legacy work saved before prose citations were registered', () => {
  const previous = materializeJobAidWork(update(withCitation('condition', b.evidenceRef)), {
    ...context, readSourceRefs: [a.evidenceRef, b.evidenceRef],
  });
  // Old persistence omitted condition-only citations from this derived index.
  previous.issues[0].sourceDependencies = [a.evidenceRef];
  expect(() => materializeJobAidWork({ ...update(issue()), issues: [] }, {
    ...context, previous, evidence: [a], readSourceRefs: [a.evidenceRef],
  })).toThrow('RETAINED_SOURCE_NO_LONGER_AUTHORIZED');
});

test('plain requested catalog identifiers remain leads rather than cited source facts', () => {
  const item = { ...issue(), openQuestions: [{
    question: 'Target facts not acquired', affects: 'Applicability remains conditional',
    nextEvidence: `Request the authorized catalog lead ${b.evidenceRef}`,
    reason: 'A catalog identifier does not mean its text was delivered',
  }] };
  const work = materializeJobAidWork(update(item), context);
  expect(work.issues[0].openQuestions[0].nextEvidence).toContain(b.evidenceRef);
  expect(work.issues[0].sourceDependencies).not.toContain(b.evidenceRef);
});

test('rejects a malformed explicit citation in a measure explanation', () => {
  const item = issue(); item.measures[0].addresses = 'Unclosed citation [[not-a-receipt';
  expect(() => materializeJobAidWork(update(item), context)).toThrow('CITATION_MALFORMED');
});

test('an issued citation preserves its claim and unknowns; it does not prove semantic support', () => {
  const item = withCitation('condition', a.evidenceRef);
  const before = structuredClone(item);
  const work = materializeJobAidWork(update(item), context);
  expect(item).toEqual(before);
  expect(work.issues[0].riskScenarios[0].conditions).toEqual(before.riskScenarios[0].conditions);
  expect(work.issues[0].riskScenarios[0].limitations).toEqual(before.riskScenarios[0].limitations);
  expect(work.issues[0].riskScenarios[0].score).toBeNull();
  expect(work.issues[0].measures[0].status).toBe('PROPOSED');
});
