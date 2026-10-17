import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { invokeHostedJobAidProblemModel } from '../scripts/run-jobaid-problem-assessment.mjs';
import { createCheckpointStore } from '../scripts/run-hosted-review-turn.mjs';

const functionName = 'return_wiselink_assessment_step';
const source = ref => ({ evidenceRef: ref, kind: 'DOCUMENT_PASSAGE', documentVersionId: 'DV-unit',
  sourceRefId: ref, versionLabel: 'parse-unit', locator: ref, excerpt: `Complete ${ref}; condition and exception retained.`,
  truncated: false });
const read = ref => ({ action: 'READ_SOURCES', sourceRefs: [ref], context: 'EXACT', purpose: 'Check the condition' });
const save = { action: 'SAVE_WORK', workJson: JSON.stringify({ schemaVersion: 'wiselink.jobaid-problem-work.v3',
  headline: 'Conditional issue', listBrief: 'The actual configuration remains unknown.', issues: [],
  roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS', completionReason: 'Named unknowns retained.', changeSummary: 'A useful supported update.' }) };
const response = (step, extra = {}) => Response.json({ choices: [{ finish_reason: 'tool_calls', message: {
  role: 'assistant', content: null, tool_calls: [{ id: 'call-unit', type: 'function',
    function: { name: functionName, arguments: JSON.stringify({ step }) } }],
}, ...extra }] });
const missing = () => Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'A completed response without a step.' } }] });
const wrong = () => Response.json({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null,
  tool_calls: [{ id: 'wrong', type: 'function', function: { name: 'other_function', arguments: '{}' } }] } }] });
function fixture(script, modelRef = 'unit/model') {
  const calls = [], reads = [], saves = [], shapes = [], repairs = [], waits = [];
  const stored = new Map();
  let latest = null;
  const input = { schemaVersion: 'wiselink.jobaid-problem-task.v2', purpose: 'INITIAL_PROBLEM_ASSESSMENT',
    methodBinding: { packRef: 'unit-method' }, documentOverview: { title: 'Unit original', sections: [] },
    expectedWorkRevision: 0, previousWork: null, deliveredEvidence: [],
    availableSources: ['p1', 'p2'].map(ref => ({ ref, kind: 'DOCUMENT_PASSAGE' })), capabilities: [] };
  const options = { gatewayChatCompletionsEnabled: true, gatewayUrl: 'http://127.0.0.1:1', gatewayToken: 'unit-only',
    configuredModelVersion: 'unit-model', sessionDiscriminator: 'unit-attempt',
    executionModel: { modelRef, providerKind: modelRef === 'miaoda/glm-5.3' ? 'BUILT_IN' : 'CUSTOM',
      displayName: 'Unit', settingsRevision: 3, selectedAt: '2026-10-15T00:00:00Z' },
    registeredModelRefs: [modelRef], heartbeat: async () => {},
    observeModelOutput: async shape => shapes.push(structuredClone(shape)),
    observeCandidateRejection: async repair => repairs.push(structuredClone(repair)),
    readAssessmentSources: async args => { reads.push(structuredClone(args)); return {
      status: 'AVAILABLE', scope: args.context, completeRequestedScope: true, sourceRefs: args.sourceRefs,
      evidence: args.sourceRefs.map(source),
    }; },
    saveAssessmentWork: async args => {
      saves.push(structuredClone(args));
      latest = { requestId: args.requestId, workRevisionRef: `JAWR-${args.expectedWorkRevision + 1}`,
        workRevision: args.expectedWorkRevision + 1, content: { ...JSON.parse(args.workJson),
          readSourceRefs: [...new Set(reads.flatMap(item => item.sourceRefs))] } };
      stored.set(args.requestId, latest);
      return { ...latest, roundCompletion: latest.content.roundCompletion };
    },
    readAssessmentWork: async ({ requestId } = {}) => ({ revision: requestId ? stored.get(requestId) ?? null : latest }),
  };
  const dependencies = { sleep: async ms => waits.push(ms), requestGateway: async (_url, request) => {
    calls.push({ body: JSON.parse(request.body), headers: structuredClone(request.headers) });
    const item = script.shift();
    assert.ok(item, 'no unplanned dispatch');
    return typeof item === 'function' ? item() : response(item);
  } };
  return { input, options, dependencies, calls, reads, saves, shapes, repairs, waits,
    run: () => invokeHostedJobAidProblemModel({ operation: 'EVALUATE_JOBAID', modelInput: input }, options, dependencies) };
}

test('G01/G05/G06 distinct consecutive source reads keep the named schema and one body without an empty SAVE', async () => {
  const f = fixture([read('p1'), read('p2'), save, { action: 'FINISH' }]);
  assert.equal((await f.run()).output.workRevisionRef, 'JAWR-1');
  assert.equal(f.reads.length, 2); assert.equal(f.saves.length, 1);
  for (const { body, headers } of f.calls) {
    assert.deepEqual(body.tool_choice, { type: 'function', function: { name: functionName } });
    assert.equal(headers['x-openclaw-model'], 'unit/model');
    assert.ok(body.tools[0].function.parameters.properties.step.properties.action.enum.includes('READ_SOURCES'));
  }
  const text = JSON.stringify(f.calls[2].body.messages);
  for (const ref of ['p1', 'p2']) assert.equal(text.split(source(ref).excerpt).length - 1, 1);
  assert.ok(f.shapes.every(shape => shape.inputTokens === null && shape.outputTokens === null));
  assert.ok(f.shapes.every(shape => shape.upstreamDispatchCount === null));
});

test('G02 a complete legal call without finish_reason works; incomplete arguments are separately repairable once', async () => {
  const withoutReason = async () => {
    const payload = await response(read('p1')).json(); delete payload.choices[0].finish_reason;
    return Response.json(payload);
  };
  const f = fixture([withoutReason, save, { action: 'FINISH' }]);
  await f.run();
  assert.equal(f.shapes[0].finishReason, null); assert.equal(f.shapes[0].protocolCategory, null);
  assert.equal(f.shapes[0].upstreamOutcome, 'UNKNOWN'); assert.equal(f.repairs.length, 0);
  const malformed = () => Response.json({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null,
    tool_calls: [{ id: 'bad', type: 'function', function: { name: functionName, arguments: '{"step":' } }] } }] });
  const bad = fixture([malformed, read('p1'), save, { action: 'FINISH' }]);
  await bad.run();
  assert.equal(bad.shapes[0].protocolCategory, 'TOOL_SCHEMA_INVALID');
  assert.equal(bad.repairs.filter(item => item.repairScope === 'STAGE_PROTOCOL').length, 1);
});

for (const [name, bad] of [['missing', missing], ['wrong', wrong], ['schema', () => response({ action: 'UNDECLARED' })]]) {
  test(`G02/G03 ${name} repair is once for the entire stage, including a successful intervening READ`, async () => {
    const f = fixture([read('p1'), save, bad, read('p2'), bad]);
    await assert.rejects(f.run(), error => error.terminalAssessmentFailure?.errorCode === 'JOBAID_PROTOCOL_REPAIR_EXHAUSTED');
    assert.equal(f.calls.length, 5); assert.equal(f.reads.length, 2); assert.equal(f.saves.length, 1);
    assert.deepEqual(f.waits, [1000]);
    assert.equal(f.repairs.filter(item => item.repairScope === 'STAGE_PROTOCOL').length, 1);
    assert.equal(f.shapes.at(-1).protocolRepairs, 1);
  });
}

for (const [name, gatewayResponse, category] of [
  ['reported upstream', () => Response.json({ error: { type: 'api_error', message: 'PRIVATE_ERROR' } }, { status: 503 }), 'UPSTREAM_ERROR_REPORTED'],
  ...[200, 503].map(status => [`reported upstream with length HTTP ${status}`, () => Response.json({
    error: { type: 'api_error', message: 'PRIVATE_ERROR' },
    choices: [{ finish_reason: 'length', message: { role: 'assistant', content: 'Untrusted partial response' } }],
  }, { status }), 'UPSTREAM_ERROR_REPORTED']),
  ['conversion', () => Response.json({ error: { message: 'tool_choice=required was not satisfied by the agent response' } }, { status: 502 }), 'GATEWAY_TOOL_CONVERSION_FAILED'],
  ['missing terminal', () => Response.json({ error: { message: 'Agent run ended with an incomplete terminal response.' } }, { status: 400 }), 'TERMINAL_RESPONSE_MISSING'],
  ['invalid HTTP body', () => new Response('{"choices":', { status: 200 }), 'GATEWAY_JSON_INVALID'],
]) {
  test(`G02/G03 ${name} keeps UNKNOWN and saved work with no protocol or transport replay`, async () => {
    const f = fixture([read('p1'), save, gatewayResponse]);
    await assert.rejects(f.run(), error => error.terminalAssessmentFailure === undefined);
    assert.equal(f.calls.length, 3); assert.equal(f.saves.length, 1); assert.equal(f.repairs.length, 0);
    assert.equal(f.shapes.at(-1).protocolCategory, category);
    assert.equal(f.shapes.at(-1).upstreamOutcome, 'UNKNOWN');
    assert.equal(f.shapes.at(-1).requestBudget.maxRounds, 64);
    assert.equal(f.shapes.at(-1).requestBudget.transportRetries, 0);
    assert.equal(f.shapes.at(-1).metricUnits.tokens, 'REPORTED_USAGE_OR_NULL');
    assert.equal(JSON.stringify(f.shapes).includes('PRIVATE_ERROR'), false);
  });
}

test('G02/G03 a transport interruption retains the same bounded budget and units without replay', async () => {
  const error = new Error('HOSTED_GATEWAY_RESPONSE_INTERRUPTED', { cause:
    Object.assign(new Error('PRIVATE_TRANSPORT_BODY'), { code: 'ECONNRESET' }) });
  const f = fixture([read('p1'), save, () => { throw error; }]);
  await assert.rejects(f.run(), value => value === error);
  const shape = f.shapes.at(-1);
  assert.equal(shape.protocolCategory, 'TRANSPORT_OUTCOME_UNKNOWN');
  assert.equal(shape.requestBudget.maxRounds, 64); assert.equal(shape.requestBudget.round, 3);
  assert.equal(shape.requestBudget.transportRetries, 0); assert.equal(shape.maxProtocolRepairs, 1);
  assert.equal(shape.metricUnits.response, 'UTF8_BYTES'); assert.equal(shape.metricUnits.tokens, 'REPORTED_USAGE_OR_NULL');
  assert.equal(shape.inputTokens, null); assert.equal(shape.outputTokens, null);
  assert.equal(shape.responseShape, null); assert.equal(shape.upstreamDispatchCount, null);
  assert.equal(JSON.stringify(shape).includes('PRIVATE_TRANSPORT_BODY'), false);
  assert.equal(f.calls.length, 3); assert.equal(f.saves.length, 1); assert.equal(f.repairs.length, 0);
});

test('G03 revoked qualification stops before a protocol repair dispatch', async () => {
  const f = fixture([missing]);
  let checks = 0;
  f.options.heartbeat = async () => { if (++checks > 1) throw new Error('AUTO_WORK_ITEM_ATTEMPT_LEASE_REJECTED'); };
  await assert.rejects(f.run(), /AUTO_WORK_ITEM_ATTEMPT_LEASE_REJECTED/u);
  assert.equal(f.calls.length, 1); assert.equal(f.saves.length, 0); assert.equal(f.waits.length, 0);
});

test('G03 a damaged persisted stage budget never grants another repair or model dispatch', async t => {
  for (const key of ['protocolRepairs', 'noProgressRepairs']) for (const value of [undefined, null, 2, '1']) {
    await t.test(`${key}=${String(value)}`, async () => {
      const directory = await mkdtemp(join(tmpdir(), 'wiselink-p2-stage-budget-'));
      try {
        const f = fixture([missing]);
        const checkpoint = await createCheckpointStore(directory);
        f.options.assessmentCheckpoint = checkpoint;
        f.dependencies.sleep = async () => { throw new Error('STOP_AFTER_PERSISTED_REPAIR'); };
        await assert.rejects(f.run(), /STOP_AFTER_PERSISTED_REPAIR/u);
        const state = await checkpoint.readOptional('assessment-state');
        assert.equal(state.protocolRepairs, 1); assert.equal(state.noProgressRepairs, 0);
        if (value === undefined) delete state[key]; else state[key] = value;
        await checkpoint.write('assessment-state', state);
        await assert.rejects(f.run(), /JOBAID_CHECKPOINT_POLICY_CHANGED/u);
        assert.deepEqual(await checkpoint.readOptional('assessment-state'), state);
        assert.equal(f.calls.length, 1); assert.equal(f.repairs.length, 1);
        assert.equal(f.reads.length, 0); assert.equal(f.saves.length, 0);
      } finally { await rm(directory, { recursive: true, force: true }); }
    });
  }
});

test('G07 only unchanged operation, parameters and result get one correction and then a known safe failure', async () => {
  const f = fixture([read('p1'), read('p1'), read('p1')]);
  await assert.rejects(f.run(), error => error.terminalAssessmentFailure?.errorCode === 'JOBAID_NO_PROGRESS');
  assert.equal(f.calls.length, 3); assert.equal(f.saves.length, 0);
  assert.equal(f.repairs.filter(item => item.code === 'JOBAID_NO_PROGRESS').length, 1);
  const useful = fixture([read('p1'), read('p2'), save, { action: 'FINISH' }]);
  await useful.run(); assert.equal(useful.repairs.length, 0);
});

test('G08 the invocation keeps its Host model/settings snapshot and rejects a replaced checkpoint binding', async t => {
  const f = fixture([read('p1'), save, { action: 'FINISH' }]);
  const gateway = f.dependencies.requestGateway;
  f.dependencies.requestGateway = async (...args) => {
    const result = await gateway(...args);
    f.options.executionModel.modelRef = 'unit/replacement'; f.options.executionModel.settingsRevision++;
    return result;
  };
  await f.run(); assert.ok(f.calls.every(call => call.headers['x-openclaw-model'] === 'unit/model'));
  const directory = await mkdtemp(join(tmpdir(), 'wiselink-p2-model-binding-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bound = fixture([read('p1')]);
  bound.options.assessmentCheckpoint = await createCheckpointStore(directory);
  bound.options.readAssessmentSources = async () => { throw new Error('READ_FAILED'); };
  await assert.rejects(bound.run(), /READ_FAILED/u);
  bound.options.executionModel.settingsRevision++;
  await assert.rejects(bound.run(), /JOBAID_CHECKPOINT_BINDING_MISMATCH/u);
  assert.equal(bound.calls.length, 1);
});

test('G04/G05 prepared Overall reads only an exact needed work target and preserves its completed revision without a SAVE', async () => {
  const f = fixture([{ action: 'READ_WORK', workRevisionRef: 'JAWR-prior', issueKeys: ['needed'], includeOverview: true },
    { action: 'FINISH', consistencyCheck: 'The exact target, original conditions and current overview remain consistent.' }]);
  f.input.purpose = 'OVERALL_CONSISTENCY'; f.input.expectedWorkRevision = 1;
  f.input.previousWork = { workRevisionRef: 'JAWR-prior', workRevision: 1, content: {
    schemaVersion: 'wiselink.jobaid-problem-work.v3', roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS',
    overviewStatus: 'CURRENT', understanding: 'The decisive configuration remains unknown.', issues: [
      { issueKey: 'needed', question: 'Which condition matters?', body: 'COMPLETE_NEEDED_TARGET '.repeat(500) },
      { issueKey: 'unrelated', question: 'Other issue', body: 'UNRELATED_BODY '.repeat(500) },
    ], readSourceRefs: [],
  } };
  f.input.preparation = { schemaVersion: 'wiselink.jobaid-preparation.v1', taskPurpose: f.input.purpose,
    goal: 'Check the selected condition for consistency.', targetIssueKeys: ['needed'],
    taskInputRevision: 1, currentInputRevision: 1, currentInputChanged: false, documentVersionId: 'DV-unit',
    originalBinding: null, lastSaved: { workRevisionRef: 'JAWR-prior', workRevision: 1, basedOnInputRevision: 1 },
    currentIssues: [{ issueKey: 'needed', question: 'Which condition matters?' }], unfinishedItems: [],
    pendingEngineerInputs: [], savedUpdates: [], humanConfirmedDecisions: [], humanConfirmationStatus: 'NOT_RECORDED', limitations: [] };
  f.options.assessmentBinding = { inputRevision: 1, documentVersionId: 'DV-unit' };
  f.options.readAssessmentWork = async () => ({ revision: structuredClone(f.input.previousWork),
    preparation: structuredClone(f.input.preparation) });
  const result = await invokeHostedJobAidProblemModel({ operation: 'SYNTHESIZE_OVERALL', modelInput: f.input }, f.options, f.dependencies);
  assert.equal(result.output.workRevisionRef, 'JAWR-prior'); assert.equal(f.saves.length, 0);
  assert.equal(f.calls.length, 2);
  for (const { body } of f.calls) assert.equal(JSON.stringify(body.messages).includes('UNRELATED_BODY'), false);
  assert.equal(JSON.parse(f.calls[1].body.messages[1].content).targetWork.issues[0].issueKey, 'needed');
});

function overallFixture(script, overviewStatus, modelRef) {
  const f = fixture(script, modelRef);
  f.input.purpose = 'OVERALL_CONSISTENCY';
  f.input.expectedWorkRevision = 1;
  f.input.previousWork = { workRevisionRef: 'JAWR-prior', workRevision: 1,
    ...(overviewStatus ? { overviewStatus } : {}), content: {
      schemaVersion: 'wiselink.jobaid-problem-work.v3', roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS',
      overview: 'An earlier overview retained for comparison.', readSourceRefs: [],
      issues: [{ issueKey: 'retained', question: 'Which source condition is decisive?', body: 'Keep the exact condition.' }],
    } };
  f.input.preparation = { schemaVersion: 'wiselink.jobaid-preparation.v1', taskPurpose: f.input.purpose,
    goal: 'Check the saved overview against the retained issue and source condition.', targetIssueKeys: [],
    taskInputRevision: 1, currentInputRevision: 1, currentInputChanged: false, documentVersionId: 'DV-unit',
    originalBinding: null, lastSaved: { workRevisionRef: 'JAWR-prior', workRevision: 1, basedOnInputRevision: 1 },
    currentIssues: [{ issueKey: 'retained', question: 'Which source condition is decisive?' }], unfinishedItems: [],
    pendingEngineerInputs: [], savedUpdates: [], humanConfirmedDecisions: [], humanConfirmationStatus: 'NOT_RECORDED', limitations: [] };
  f.options.assessmentBinding = { inputRevision: 1, documentVersionId: 'DV-unit' };
  const prior = { ...structuredClone(f.input.previousWork), content: {
    ...structuredClone(f.input.previousWork.content), overviewStatus: overviewStatus ?? 'CURRENT',
  } };
  const reads = [];
  let saved = null;
  f.options.readAssessmentWork = async (args = {}) => {
    reads.push(structuredClone(args));
    return { revision: args.requestId ? (saved?.requestId === args.requestId ? saved : null) : prior };
  };
  f.options.saveAssessmentWork = async args => {
    f.saves.push(structuredClone(args));
    const work = JSON.parse(args.workJson);
    assert.notEqual(work.overview, prior.content.overview);
    assert.ok(work.overview.trim());
    saved = { requestId: args.requestId, workRevisionRef: 'JAWR-2', workRevision: 2,
      content: { ...prior.content, ...work, issues: prior.content.issues, overviewStatus: 'CURRENT' } };
    if (overviewStatus === 'NOT_AVAILABLE') throw new Error('SAVE_RESPONSE_LOST');
    return { workRevisionRef: saved.workRevisionRef, workRevision: saved.workRevision,
      roundCompletion: saved.content.roundCompletion };
  };
  return { ...f, workReads: reads, runOverall: () => invokeHostedJobAidProblemModel({
    operation: 'SYNTHESIZE_OVERALL', modelInput: f.input,
  }, f.options, f.dependencies) };
}

for (const modelRef of ['unit/model', 'miaoda/glm-5.3'])
for (const status of ['NOT_AVAILABLE', 'STALE'])
test(`${modelRef} Overall ${status} cannot become CURRENT by reading old work; meaningful overview SAVE permits FINISH`, async () => {
  const f = overallFixture([
    { action: 'FINISH', consistencyCheck: 'The prior work was read.' },
    { action: 'READ_WORK', workRevisionRef: 'JAWR-prior', issueKeys: [], includeOverview: true },
    { action: 'FINISH', consistencyCheck: 'The exact old overview was read.' },
    { action: 'SAVE_WORK', workJson: JSON.stringify({ ...JSON.parse(save.workJson),
      overview: 'The preserved source condition limits the candidate conclusion; implementation remains unverified.' }) },
    { action: 'FINISH', consistencyCheck: 'The new saved overview agrees with the preserved issue and its source limitation.' },
  ], status, modelRef);
  const result = await f.runOverall();
  assert.equal(result.output.workRevisionRef, 'JAWR-2');
  assert.equal(f.calls.length, 5);
  assert.equal(f.saves.length, 1);
  assert.equal(f.workReads.length, 2);
  assert.equal(f.workReads[1].requestId, f.saves[0].requestId, 'A lost SAVE reply reads only the original save key');
  assert.equal(JSON.parse(f.saves[0].workJson).issues.length, 0, 'An overview-only delta keeps issues with Host');
  for (const index of [1, 3]) {
    const receipt = JSON.parse(f.calls[index].body.messages.at(-1).content);
    assert.equal(receipt.errorCode, `JOBAID_OVERALL_EXACT_WORK_REQUIRED:JAWR-prior:OVERVIEW_${status}`);
    assert.equal(receipt.workRevisionRef, 'JAWR-prior');
    assert.equal(receipt.overviewStatus, status);
  }
});

for (const modelRef of ['unit/model', 'miaoda/glm-5.3'])
test(`${modelRef} Overall exact CURRENT work can FINISH without a mandatory READ or empty SAVE`, async () => {
  const f = overallFixture([{ action: 'FINISH', consistencyCheck: 'The current saved overview remains consistent.' }], 'CURRENT', modelRef);
  const result = await f.runOverall();
  assert.equal(result.output.workRevisionRef, 'JAWR-prior');
  assert.equal(f.calls.length, 1);
  assert.equal(f.workReads.length, 0);
  assert.equal(f.saves.length, 0);
});

test('Overall missing historical status uses exact READ_WORK before FINISH without inventing CURRENT or re-saving', async () => {
  const f = overallFixture([
    { action: 'FINISH', consistencyCheck: 'The status has not been read.' },
    { action: 'READ_WORK', workRevisionRef: 'JAWR-prior', issueKeys: [], includeOverview: true },
    { action: 'FINISH', consistencyCheck: 'The exact Host work is CURRENT and its original condition is retained.' },
  ]);
  const result = await f.runOverall();
  assert.equal(result.output.workRevisionRef, 'JAWR-prior');
  assert.equal(f.calls.length, 3);
  assert.equal(f.workReads.length, 1);
  assert.equal(f.saves.length, 0);
  const receipt = JSON.parse(f.calls[1].body.messages.at(-1).content);
  assert.equal(receipt.overviewStatus, null);
  assert.equal(receipt.workRevisionRef, 'JAWR-prior');
});

test('Overall sealed without preparation can use the same exact READ_WORK to establish CURRENT', async () => {
  const f = overallFixture([
    { action: 'READ_WORK', workRevisionRef: 'JAWR-prior', issueKeys: [], includeOverview: true },
    { action: 'FINISH', consistencyCheck: 'The exact Host work is CURRENT; the issue remains unchanged.' },
  ]);
  delete f.input.preparation;
  const result = await f.runOverall();
  assert.equal(result.output.workRevisionRef, 'JAWR-prior');
  assert.equal(f.calls.length, 2);
  assert.equal(f.workReads.length, 1);
  assert.equal(f.saves.length, 0);
});

for (const modelRef of ['unit/model', 'miaoda/glm-5.3'])
for (const [field, change] of [
  ['workRevisionRef', revision => { revision.workRevisionRef = 'JAWR-other'; }],
  ['workRevision', revision => { revision.workRevision = 2; }],
])
test(`${modelRef} Overall cannot promote CURRENT from a read with the wrong exact ${field}`, async () => {
  const f = overallFixture([{ action: 'READ_WORK', workRevisionRef: 'JAWR-prior', issueKeys: [], includeOverview: true }], undefined, modelRef);
  const read = f.options.readAssessmentWork;
  f.options.readAssessmentWork = async args => {
    const result = await read(args);
    change(result.revision);
    return result;
  };
  await assert.rejects(f.runOverall(), /JOBAID_WORK_REVISION_CONFLICT/u);
  assert.equal(f.calls.length, 1);
  assert.equal(f.saves.length, 0);
});

for (const operation of ['EVALUATE_JOBAID', 'ASSESS_MATTER'])
test(`GLM 5.3 ${operation} keeps real source, SAVE and FINISH intents with auto tool choice`, async () => {
  const f = fixture([read('p1'), save, { action: 'FINISH' }], 'miaoda/glm-5.3');
  if (operation === 'ASSESS_MATTER') Object.assign(f.input, {
    schemaVersion: 'wiselink.matter-jobaid-task.v2',
    subject: { kind: 'ENGINEERING_MATTER', matterId: 'MAT-unit' },
    availableDocuments: [{ documentVersionId: 'DV-unit' }],
  });
  const result = await invokeHostedJobAidProblemModel({ operation, modelInput: f.input }, f.options, f.dependencies);
  assert.equal(result.output.workRevisionRef, 'JAWR-1');
  assert.equal(f.reads.length, 1); assert.equal(f.saves.length, 1); assert.equal(f.calls.length, 3);
  for (const { body, headers } of f.calls) {
    assert.equal(body.tool_choice, 'auto');
    assert.deepEqual(body.tools.map(tool => tool.function.name), [functionName]);
    assert.equal(body.parallel_tool_calls, false);
    assert.equal(body.max_completion_tokens, undefined);
    assert.equal(headers['x-openclaw-model'], 'miaoda/glm-5.3');
  }
});

const overviewSave = { action: 'SAVE_WORK', workJson: JSON.stringify({ ...JSON.parse(save.workJson),
  overview: 'The retained source condition still limits this candidate; execution remains unverified.' }) };
const overviewRead = { action: 'READ_WORK', workRevisionRef: 'JAWR-prior', issueKeys: [], includeOverview: true };
const overallFinish = { action: 'FINISH', consistencyCheck: 'The exact saved overview agrees with the retained issue and its source condition.' };

test('GLM 5.3 Overall SAVE continues from the exact Host receipt and FINISH does not save again', async () => {
  const f = overallFixture([overviewRead, overviewSave, overallFinish], 'STALE', 'miaoda/glm-5.3');
  assert.equal((await f.runOverall()).output.workRevisionRef, 'JAWR-2');
  assert.equal(f.calls.length, 3); assert.equal(f.saves.length, 1);
  assert.ok(f.calls.every(({ body }) => body.tool_choice === 'auto'));
  const receipt = JSON.parse(f.calls[2].body.messages.at(-1).content);
  assert.equal(receipt.status, 'HOST_SAVE_CONFIRMED');
  assert.equal(receipt.workRevisionRef, 'JAWR-2'); assert.equal(receipt.workRevision, 2);
  assert.equal(f.workReads[1].requestId, f.saves[0].requestId);
  assert.equal(JSON.parse(f.calls[2].body.messages[1].content).previousWork.workRevisionRef, 'JAWR-2');
});

test('GLM 5.3 complete text gets one correction that retains the confirmed SAVE, then legal FINISH', async () => {
  const f = overallFixture([overviewRead, overviewSave, missing, overallFinish], 'STALE', 'miaoda/glm-5.3');
  assert.equal((await f.runOverall()).output.workRevisionRef, 'JAWR-2');
  assert.equal(f.calls.length, 4); assert.equal(f.saves.length, 1);
  assert.deepEqual(f.waits, [1000]); assert.equal(f.repairs.length, 1);
  assert.equal(f.repairs[0].repairScope, 'STAGE_PROTOCOL');
  assert.equal(f.repairs[0].code, 'JOBAID_PROTOCOL_NAMED_TOOL_MISSING');
  assert.ok(JSON.stringify(f.calls[3].body.messages).includes('HOST_SAVE_CONFIRMED'));
  assert.equal(JSON.parse(f.calls[3].body.messages[1].content).previousWork.workRevisionRef, 'JAWR-2');
  assert.ok(f.calls.every(({ body }) => body.tool_choice === 'auto'));
});

test('GLM 5.3 a second invalid completed response ends without another request or invented FINISH', async () => {
  const f = overallFixture([overviewRead, overviewSave, missing, wrong], 'STALE', 'miaoda/glm-5.3');
  await assert.rejects(f.runOverall(), error => error.terminalAssessmentFailure?.errorCode === 'JOBAID_PROTOCOL_REPAIR_EXHAUSTED');
  assert.equal(f.calls.length, 4); assert.equal(f.saves.length, 1);
  assert.equal(f.repairs.length, 1); assert.deepEqual(f.waits, [1000]);
});

for (const [name, failure, category] of [
  ['gateway conversion 502', () => Response.json({ error: { type: 'api_error',
    message: 'tool_choice required a return_wiselink_assessment_step tool call, but the agent did not produce one' } }, { status: 502 }),
  'GATEWAY_TOOL_CONVERSION_FAILED'],
  ['lost response', () => { throw new Error('HOSTED_GATEWAY_RESPONSE_INTERRUPTED'); }, 'TRANSPORT_OUTCOME_UNKNOWN'],
])
test(`GLM 5.3 ${name} after SAVE stays UNKNOWN across reentry without another dispatch`, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wiselink-glm53-overall-'));
  try {
    const f = overallFixture([overviewRead, overviewSave, failure], 'STALE', 'miaoda/glm-5.3');
    f.options.assessmentCheckpoint = await createCheckpointStore(directory);
    await assert.rejects(f.runOverall(), error => error.terminalAssessmentFailure === undefined);
    assert.equal(f.calls.length, 3); assert.equal(f.saves.length, 1); assert.equal(f.repairs.length, 0);
    assert.equal(f.shapes.at(-1).protocolCategory, category);
    assert.equal(f.shapes.at(-1).upstreamOutcome, 'UNKNOWN');
    const state = await f.options.assessmentCheckpoint.readOptional('assessment-state');
    assert.equal(state.saved.workRevisionRef, 'JAWR-2'); assert.equal(state.expectedWorkRevision, 2);
    await assert.rejects(f.runOverall(), error => error.terminalAssessmentFailure === undefined);
    assert.equal(f.calls.length, 3); assert.equal(f.saves.length, 1); assert.equal(f.repairs.length, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('GLM 5.3 rejects the old forced-function checkpoint policy before reading, saving or dispatching', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wiselink-glm53-old-policy-'));
  try {
    const f = overallFixture([() => { throw new Error('LOST_UNIT_RESPONSE'); }], 'CURRENT', 'miaoda/glm-5.3');
    const checkpoint = await createCheckpointStore(directory);
    f.options.assessmentCheckpoint = checkpoint;
    await assert.rejects(f.runOverall(), /LOST_UNIT_RESPONSE/u);
    const enabled = await checkpoint.readOptional('assessment-enabled');
    assert.equal(enabled.generationPolicy.loopPolicyVersion, 'stage-protocol-progress-glm53-auto-v2');
    enabled.generationPolicy.loopPolicyVersion = 'stage-protocol-progress-v1';
    await checkpoint.write('assessment-enabled', enabled);
    const before = await checkpoint.readOptional('assessment-state');
    await assert.rejects(f.runOverall(), /JOBAID_CHECKPOINT_POLICY_CHANGED/u);
    assert.equal(f.calls.length, 1); assert.equal(f.workReads.length, 0); assert.equal(f.saves.length, 0);
    assert.deepEqual(await checkpoint.readOptional('assessment-state'), before);
    assert.deepEqual(await checkpoint.readOptional('assessment-enabled'), enabled);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
