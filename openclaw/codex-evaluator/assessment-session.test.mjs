import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssessmentSession } from './assessment-session.mjs';

const work = (roundCompletion = 'COMPLETE') => JSON.stringify({
  schemaVersion: 'wiselink.jobaid-problem-work.v3', headline: '工程主题', listBrief: '有条件的判断。',
  issues: [{ issueKey: 'I1', question: '条件是什么？', body: '需核实条件。[[source:1]]' }],
  roundCompletion, completionReason: '本轮分析完成', changeSummary: '形成判断',
});
const input = extra => ({ purpose: 'INITIAL_PROBLEM_ASSESSMENT', expectedWorkRevision: 0,
  availableSources: [{ ref: 'source:1' }], deliveredEvidence: [], ...extra });
const call = (session, step) => session.callTool('assessment_step', { step });

function fixture({ modelInput = input(), ambiguous = false, binding = 'doc:1' } = {}) {
  const saved = new Map();
  const counts = { save: 0, read: 0, source: 0 };
  let hidden = false;
  const hooks = {
    assessmentBinding: { documentVersionId: binding },
    heartbeat: async () => {},
    readAssessmentSources: async () => {
      counts.source++;
      return { status: 'AVAILABLE', evidence: [{ evidenceRef: 'source:1',
        content: 'Full source text and footnotes', kind: 'DOCUMENT_PASSAGE' }],
        readReceipt: { page: 1, exact: true } };
    },
    saveAssessmentWork: async args => {
      counts.save++;
      const submitted = JSON.parse(args.workJson);
      const revision = { requestId: args.requestId, workRevisionRef: 'revision:1',
        workRevision: args.expectedWorkRevision + 1, documentVersionId: binding,
        overviewStatus: 'CURRENT', content: { ...submitted, overviewStatus: 'CURRENT',
          understanding: 'Host materialized overview',
          issues: submitted.issues.map(issue => ({ ...issue, hostField: 'calculated' })) } };
      saved.set(args.requestId, revision);
      if (ambiguous) { hidden = true; throw new Error('network response lost; secret-token'); }
      return { workRevisionRef: revision.workRevisionRef, workRevision: revision.workRevision,
        roundCompletion: submitted.roundCompletion };
    },
    readAssessmentWork: async ({ requestId } = {}) => {
      counts.read++;
      if (hidden) return { revision: null };
      const revision = requestId ? saved.get(requestId) : [...saved.values()].at(-1);
      return { revision: revision ?? null };
    },
  };
  const session = createAssessmentSession({ operation: 'EVALUATE_JOBAID', modelInput,
    hooks, requestPrefix: 'test' });
  return { session, hooks, counts, saved, reveal: () => { hidden = false; } };
}

test('one tool exposes detailed workJson guidance without Host control fields', () => {
  const { session } = fixture();
  assert.deepEqual(session.tools.map(tool => tool.name), ['assessment_step']);
  const schema = session.tools[0].inputSchema.properties.step.properties;
  assert.match(schema.workJson.description, /complete JobAid work update/);
  assert.equal('requestId' in schema, false);
  assert.equal('attemptRef' in schema, false);
  assert.match(schema.issueKeys.description, /required even when empty/);
  assert.match(schema.includeOverview.description, /required/);
  assert.match(schema.purpose.description, /READ_SOURCES required/);
  assert.match(schema.context.description, /READ_SOURCES required/);
});

test('exact source reads preserve full Host receipt and invalid refs never reach Host', async () => {
  const { session, counts } = fixture();
  assert.equal((await call(session, { action: 'READ_SOURCES', sourceRefs: ['invented'],
    purpose: 'check', context: 'EXACT' })).code, 'SOURCE_STEP_INVALID');
  const omitted = await call(session, { action: 'READ_SOURCES', sourceRefs: ['source:1'] });
  assert.equal(omitted.code, 'SOURCE_STEP_INVALID');
  assert.match(omitted.detail, /purpose.*context/);
  assert.equal(counts.source, 0);
  const receipt = await call(session, { action: 'READ_SOURCES', sourceRefs: ['source:1'],
    purpose: 'check', context: 'PAGE' });
  assert.equal(receipt.evidence[0].content, 'Full source text and footnotes');
  assert.deepEqual(receipt.readReceipt, { page: 1, exact: true });
});

test('save uses Host materialization, independent exact-request read, and blocks premature finish', async () => {
  const { session, counts } = fixture();
  assert.equal((await call(session, { action: 'FINISH' })).code, 'COMPLETED_WORK_REQUIRED');
  const receipt = await call(session, { action: 'SAVE_WORK', workJson: work() });
  assert.equal(receipt.status, 'SAVED');
  assert.equal(receipt.materializedWork.issues[0].hostField, 'calculated');
  assert.equal(counts.save, 1);
  assert.equal(counts.read, 1);
  const finished = await call(session, { action: 'FINISH' });
  assert.deepEqual(session.getResult(), { workRevisionRef: 'revision:1' });
  assert.equal(finished.status, 'FINISHED');
  assert.equal(session.getState().completed, true);
});

test('uncertain save only reads the same key until it is visible; no second save', async () => {
  const { session, counts, reveal } = fixture({ ambiguous: true });
  const first = await call(session, { action: 'SAVE_WORK', workJson: work() });
  assert.equal(first.code, 'SAVE_OUTCOME_UNCERTAIN');
  assert.equal(session.getState().pendingSave, true);
  assert.equal((await call(session, { action: 'FINISH' })).code, 'SAVE_OUTCOME_UNCERTAIN');
  assert.equal(counts.save, 1);
  reveal();
  const recovered = await call(session, { action: 'SAVE_WORK', workJson: work() });
  assert.equal(recovered.status, 'SAVED');
  assert.equal(counts.save, 1);
  assert.equal((await call(session, { action: 'FINISH' })).status, 'FINISHED');
});

test('known Host validation rejection permits corrected work without claiming a save', async () => {
  const { session, hooks, counts } = fixture();
  const actualSave = hooks.saveAssessmentWork;
  let rejected = false;
  hooks.saveAssessmentWork = async args => {
    if (!rejected) { rejected = true; return { status: 'REJECTED', errorCode: 'JOBAID_BODY_CITATION_REQUIRED' }; }
    return actualSave(args);
  };
  const first = await call(session, { action: 'SAVE_WORK', workJson: work() });
  assert.equal(first.code, 'JOBAID_BODY_CITATION_REQUIRED');
  assert.equal(session.getState().pendingSave, false);
  assert.equal((await call(session, { action: 'SAVE_WORK', workJson: work() })).status, 'SAVED');
  assert.equal(counts.save, 1);
});

test('an in-progress materialized revision cannot finish', async () => {
  const { session } = fixture();
  assert.equal((await call(session, { action: 'SAVE_WORK', workJson: work('IN_PROGRESS') })).status, 'SAVED');
  assert.equal((await call(session, { action: 'FINISH' })).code, 'COMPLETED_WORK_REQUIRED');
});

test('wrong readback binding cannot complete save', async () => {
  const { session, saved } = fixture();
  const step = call(session, { action: 'SAVE_WORK', workJson: work() });
  // Host readback is independent and must bind the same document version.
  const result = await step;
  assert.equal(result.status, 'SAVED');
  assert.equal(saved.size, 1);
  const { session: bad, hooks } = fixture();
  hooks.readAssessmentWork = async ({ requestId }) => ({ revision: {
    requestId, workRevisionRef: 'revision:1', workRevision: 1,
    documentVersionId: 'other-doc', content: { issues: [], roundCompletion: 'COMPLETE' },
  } });
  const rejected = await call(bad, { action: 'SAVE_WORK', workJson: work() });
  assert.equal(rejected.code, 'SAVE_READBACK_MISMATCH');
  assert.equal(bad.getResult(), null);
});

test('Overall requires exact prior completed revision, CURRENT overview and consistency check', async () => {
  const modelInput = input({ purpose: 'OVERALL_CONSISTENCY', expectedWorkRevision: 2,
    previousWork: { workRevisionRef: 'revision:2', workRevision: 2 } });
  const { session, hooks } = fixture({ modelInput });
  hooks.readAssessmentWork = async () => ({ revision: {
    workRevisionRef: 'revision:2', workRevision: 2, documentVersionId: 'doc:1',
    overviewStatus: 'CURRENT', content: { issues: [], roundCompletion: 'COMPLETE', overviewStatus: 'CURRENT' },
  } });
  assert.equal((await call(session, { action: 'FINISH' })).code, 'CONSISTENCY_CHECK_REQUIRED');
  assert.equal((await call(session, { action: 'FINISH', consistencyCheck: '已核对各问题与综合。' })).status, 'FINISHED');
  assert.deepEqual(session.getResult(), { workRevisionRef: 'revision:2',
    consistencyCheck: '已核对各问题与综合。' });
});

test('conflicting overview fields never satisfy Overall CURRENT', async () => {
  const modelInput = input({ purpose: 'OVERALL_CONSISTENCY', expectedWorkRevision: 2,
    previousWork: { workRevisionRef: 'revision:2', workRevision: 2 } });
  const { session, hooks } = fixture({ modelInput });
  hooks.readAssessmentWork = async () => ({ revision: {
    workRevisionRef: 'revision:2', workRevision: 2, documentVersionId: 'doc:1',
    overviewStatus: 'CURRENT', content: { issues: [], roundCompletion: 'COMPLETE',
      overviewStatus: 'STALE' },
  } });
  assert.equal((await call(session, { action: 'FINISH', consistencyCheck: '核对完成' })).code,
    'WORK_REVISION_CONFLICT');
});

test('READ_WORK is pinned and returns only selected full Host issue', async () => {
  const modelInput = input({ expectedWorkRevision: 2, previousWork: {
    workRevisionRef: 'revision:2', workRevision: 2,
    content: { issues: [{ issueKey: 'I1' }, { issueKey: 'I2' }] },
  } });
  const { session, hooks } = fixture({ modelInput });
  hooks.readAssessmentWork = async () => ({ revision: {
    workRevisionRef: 'revision:2', workRevision: 2, documentVersionId: 'doc:1',
    overviewStatus: 'CURRENT', content: { issues: [{ issueKey: 'I1', body: 'Host full issue 1' },
      { issueKey: 'I2', body: 'Host full issue 2' }], overviewStatus: 'CURRENT',
    understanding: 'Host overview' },
  } });
  assert.equal((await call(session, { action: 'READ_WORK', workRevisionRef: 'fabricated',
    issueKeys: ['I1'], includeOverview: false })).code, 'WORK_TARGET_INVALID');
  const omitted = await call(session, { action: 'READ_WORK', workRevisionRef: 'revision:2' });
  assert.equal(omitted.code, 'WORK_TARGET_INVALID');
  assert.match(omitted.detail, /issueKeys as an array.*includeOverview/);
  const read = await call(session, { action: 'READ_WORK', workRevisionRef: 'revision:2',
    issueKeys: ['I1'], includeOverview: true });
  assert.equal(read.issues.length, 1);
  assert.equal(read.issues[0].body, 'Host full issue 1');
  assert.equal(read.overview, 'Host overview');
});
