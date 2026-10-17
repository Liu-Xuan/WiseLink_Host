import { correctionFixture } from '../fixtures/jobaid-work-correction.fixture';
import { materializeManualJobAidCorrection, parseJobAidWorkCorrectionRequest } from '../../server/modules/canonical-host/jobaid-work-correction';

test('the two text corrections preserve all 70 sources, other issues and unknown likelihood', () => {
  const { base, request } = correctionFixture();
  const before = structuredClone(base);
  const result = materializeManualJobAidCorrection(base, parseJobAidWorkCorrectionRequest(request));
  const expected = structuredClone(base.content);
  expected.issues[0].body = request.changes[0].newValue;
  expected.issues[0].riskScenarios[0].severity!.reason = request.changes[1].newValue;
  expected.overviewStatus = 'STALE';
  expect(result.content).toEqual(expected);
  expect(result.content.evidence).toHaveLength(70);
  expect(result.content.issues[0].riskScenarios[0]).toMatchObject({ likelihood: null, score: null, riskGrade: null });
  expect(result.changedFields).toHaveLength(2);
  expect(base).toEqual(before);
});

test('unchanged text produces no revision and preserves CURRENT overview', () => {
  const { base, request } = correctionFixture();
  for (const change of request.changes) change.newValue = change.expectedOldValue;
  const result = materializeManualJobAidCorrection(base, request);
  expect(result.changedFields).toEqual([]);
  expect(result.content).toEqual(base.content);
});

test.each(['actorUserId', 'adopted', 'path', 'work', 'leaseToken'])('caller cannot supply %s', field => {
  const { request } = correctionFixture();
  expect(() => parseJobAidWorkCorrectionRequest({ ...request, [field]: 'untrusted' }))
    .toThrow('JOBAID_CORRECTION_REQUEST_INVALID');
});

test.each([
  ['old text', (r: any) => { r.changes[0].expectedOldValue = 'wrong'; }, 'OLD_VALUE_CONFLICT'],
  ['issueRef', (r: any) => { r.changes[0].issueRef = 'other'; }, 'ISSUE_CONFLICT'],
  ['scenario index', (r: any) => { r.changes[1].scenarioIndex = 1; }, 'SCENARIO_CONFLICT'],
  ['complete old scenario', (r: any) => { r.changes[1].expectedScenario.severity.label = '灾难'; }, 'SCENARIO_CONFLICT'],
  ['duplicate target', (r: any) => { r.changes.push(r.changes[0]); }, 'DUPLICATE_TARGET'],
  ['unknown evidence', (r: any) => { r.changes[0].evidenceRefs = ['unknown']; }, 'EVIDENCE_NOT_DELIVERED'],
  ['undeclared citation', (r: any) => { r.changes[0].newValue += ' [[other]]'; }, 'EVIDENCE_NOT_DELIVERED'],
  ['malformed citation', (r: any) => { r.changes[0].newValue += ' [[broken'; }, 'CITATION_MALFORMED'],
])('rejects %s without touching the base', (_label, mutate, code) => {
  const { base, request } = correctionFixture();
  const before = structuredClone(base);
  mutate(request);
  expect(() => materializeManualJobAidCorrection(base, request)).toThrow(`JOBAID_CORRECTION_${code}`);
  expect(base).toEqual(before);
});

test('the field whitelist and exact scenario contract reject structural edits and lossy text', () => {
  const { request } = correctionFixture();
  for (const change of [{ ...request.changes[0], field: 'LIKELIHOOD' },
    { ...request.changes[0], severity: '灾难' }, { ...request.changes[0], newValue: ' trimmed ' },
    { ...request.changes[1], expectedScenario: { ...request.changes[1], extra: true } }]) {
    expect(() => parseJobAidWorkCorrectionRequest({ ...request, changes: [change] }))
      .toThrow('JOBAID_CORRECTION_REQUEST_INVALID');
  }
});
