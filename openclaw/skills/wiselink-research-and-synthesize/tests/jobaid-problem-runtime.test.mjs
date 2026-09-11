import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCheckpointStore } from '../scripts/run-hosted-review-turn.mjs';
import { invokeHostedJobAidProblemModel, projectJobAidModelInput } from '../scripts/run-jobaid-problem-assessment.mjs';

test('source transport removes repeated identifiers without losing distinct sources, provenance or text', () => {
  const input = modelInput();
  input.availableSources = Array.from({ length: 446 }, (_, index) => ({
    ref: `source:document-version-${'a'.repeat(64)}:source-reference-${index}`,
    kind: 'DOCUMENT_PASSAGE', title: 'Same document title',
    versionLabel: `Version ${index}`, locator: { page: index + 1 },
  }));
  input.contextPackage = {
    primaryDocument: { readingStatus: 'AVAILABLE' },
    supplementaryMaterials: { status: 'PARTIAL', reason: 'Restricted reference' },
    sourceOrigins: input.availableSources.map((source, index) => ({
      evidenceRef: source.ref,
      origin: index % 2 ? 'RELATED_DOCUMENT' : 'PRIMARY_DOCUMENT',
      contentNature: 'SOURCE_DOCUMENT_CONTENT',
    })),
  };
  input.contextPackage.sourceOrigins.push({
    evidenceRef: 'unmatched-statement', origin: 'REVIEW_CONVERSATION',
    contentNature: 'UNVERIFIED_ENGINEER_STATEMENT',
  });
  input.deliveredEvidence = [{ evidenceRef: input.availableSources[0].ref, excerpt: 'Full original condition, exception and footnote remain here.' }];
  const original = structuredClone(input);
  const projected = projectJobAidModelInput(input);
  assert.deepEqual(input, original, 'never mutate the Host-bound input');
  assert.deepEqual(projected.availableSources.map(({ sourceOrigins, ...source }) => source), input.availableSources);
  assert.deepEqual(projected.deliveredEvidence, input.deliveredEvidence);
  const restoredOrigins = projected.availableSources.flatMap(({ ref, sourceOrigins = [] }) =>
    sourceOrigins.map((origin) => ({ evidenceRef: ref, ...origin })),
  ).concat(projected.contextPackage.sourceOrigins);
  assert.deepEqual(restoredOrigins, input.contextPackage.sourceOrigins);
  const { sourceOrigins: originalOrigins, ...originalContext } = input.contextPackage;
  const { sourceOrigins: unmatchedOrigins, ...projectedContext } = projected.contextPackage;
  assert.deepEqual(projectedContext, originalContext);
  assert.ok(Buffer.byteLength(JSON.stringify(projected)) < Buffer.byteLength(JSON.stringify(input)));
  const legacy = modelInput();
  assert.deepEqual(projectJobAidModelInput(legacy), legacy);
});

function modelInput() {
  return {
    schemaVersion: 'wiselink.jobaid-problem-task.v2',
    purpose: 'INITIAL_PROBLEM_ASSESSMENT',
    methodBinding: { packRef: 'synthetic-method' },
    availableSources: [{ ref: 'source:dv:sr1' }],
    deliveredEvidence: [],
    expectedWorkRevision: 0,
    previousWork: null,
    capabilities: [
      {
        capability: 'reliability_history',
        status: 'NOT_CONNECTED',
        impact: 'No query results; no zero-event inference.',
      },
    ],
  };
}

test('native gateway failures retain only fixed categories and do not replay ambiguous model execution', async () => {
  for (const [message, category, suffix] of [
    ['dli/gpt-5.6-sol ended with an incomplete terminal response', 'INCOMPLETE_TERMINAL_RESPONSE', ':INCOMPLETE_TERMINAL_RESPONSE'],
    ['tool_choice=required was not satisfied by the agent response', 'TOOL_CHOICE_NOT_SATISFIED', ':TOOL_CHOICE_NOT_SATISFIED'],
    ['private response body with fixture-private-token', 'UNCLASSIFIED', ''],
  ]) {
    const shapes = [];
    const f = fixture([], { observeModelOutput: async (shape) => shapes.push(shape) });
    let calls = 0;
    f.dependencies.requestGateway = async () => {
      calls++;
      return new Response(JSON.stringify({ error: { message, type: 'invalid_request_error',
        code: 'fixture-private-token' } }), { status: 400 });
    };
    await assert.rejects(invokeHostedJobAidProblemModel({ operation: 'EVALUATE_JOBAID', modelInput: modelInput() },
      f.options, f.dependencies), (error) => {
      assert.equal(error.message, `JOBAID_GATEWAY_HTTP_400${suffix}`);
      return true;
    });
    assert.equal(calls, 1);
    assert.equal(f.saves.length, 0);
    assert.equal(shapes.length, 1);
    assert.equal(shapes[0].gatewayFailure, category);
    assert.equal(JSON.stringify(shapes).includes('fixture-private-token'), false);
    assert.equal(JSON.stringify(shapes).includes(message), false);
  }
});
function fixture(steps, overrides = {}) {
  const calls = [];
  const saves = [];
  const reads = [];
  const store = new Map();
  const options = {
    gatewayChatCompletionsEnabled: true,
    gatewayUrl: 'http://127.0.0.1:1',
    gatewayToken: 'synthetic-only',
    sessionDiscriminator: 'synthetic-attempt',
    configuredModelVersion: 'synthetic-model-v1',
    heartbeat: async () => {},
    readAssessmentSources: async (input) => {
      reads.push(input);
      return {
        status: 'AVAILABLE',
        evidence: [
          {
            evidenceRef: 'source:dv:sr1',
            excerpt: 'Do not replace unless the condition persists.',
          },
        ],
      };
    },
    saveAssessmentWork: async (input) => {
      saves.push(input);
      const revision = {
        workRevisionRef: `JAWR-${input.expectedWorkRevision + 1}`,
        workRevision: input.expectedWorkRevision + 1,
        requestId: input.requestId,
        content: JSON.parse(input.workJson),
      };
      store.set(input.requestId, revision);
      return { ...revision, roundCompletion: revision.content.roundCompletion };
    },
    readAssessmentWork: async ({ requestId }) => ({
      revision: store.get(requestId) ?? null,
    }),
    ...overrides,
  };
  const dependencies = {
    requestGateway: async (_url, request) => {
      calls.push(JSON.parse(request.body));
      let step = steps.shift();
      if (step && Object.hasOwn(step, 'work')) {
        const { work, ...rest } = step;
        step = { ...rest, workJson: JSON.stringify(work) };
      }
      if (step instanceof Error) throw step;
      if (typeof step === 'number')
        return new Response(JSON.stringify({ error: 'synthetic timeout' }), {
          status: step,
        });
      return new Response(
        JSON.stringify({
          model: 'synthetic-model-v1',
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: `call-${calls.length}`,
                    type: 'function',
                    function: {
                      name: 'return_wiselink_assessment_step',
                      arguments: JSON.stringify({
                        step,
                      }),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 30, completion_tokens: 50 },
        }),
        { status: 200 },
      );
    },
  };
  return {
    calls,
    saves,
    reads,
    store,
    options,
    dependencies,
    run: (input = modelInput()) =>
      invokeHostedJobAidProblemModel(
        {
          operation:
            input.purpose === 'OVERALL_CONSISTENCY'
              ? 'SYNTHESIZE_OVERALL'
              : 'EVALUATE_JOBAID',
          modelInput: input,
        },
        options,
        dependencies,
      ),
  };
}
const completed = {
  schemaVersion: 'wiselink.jobaid-problem-work.v2',
  roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS',
  understanding: 'The source condition remains; reliability is unqueried.',
};

test('a completed text-only correction resumes from its durable response and preserves the rejected work', () => persisted(async checkpoint => {
  const input = modelInput();
  input.availableSources = [{ ref: 'engineer:1', kind: 'ENGINEER_STATEMENT' }];
  const invalid = { ...completed, issues: [{ issueKey: 'maintenance', riskScenarios: [{
    scenario: 'Conditional maintenance disruption', conditions: ['Engineering hypothesis'],
    likelihood: { label: '不大可能', reason: 'Unverified statement', basisRefs: ['engineer:1'] },
    limitations: ['No business likelihood evidence'],
  }] }] };
  const corrected = structuredClone(invalid);
  corrected.issues[0].riskScenarios[0].likelihood = null;
  const f = fixture([{ action: 'SAVE_WORK', work: invalid }, { action: 'SAVE_WORK', work: corrected }, { action: 'FINISH' }],
    { assessmentCheckpoint: checkpoint });
  const save = f.options.saveAssessmentWork;
  let saves = 0;
  f.options.saveAssessmentWork = async args => {
    if (++saves === 1) throw Object.assign(new Error('Rejected'), { hostErrorCode: 'JOBAID_LIKELIHOOD_BUSINESS_EVIDENCE_REQUIRED' });
    return save(args);
  };
  const gateway = f.dependencies.requestGateway;
  let generations = 0;
  f.dependencies.requestGateway = async (url, request) => {
    if (++generations !== 2) return gateway(url, request);
    f.calls.push(JSON.parse(request.body));
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant',
      content: 'A completed explanation without the required function.' } }] }), { status: 200 });
  };
  let interrupted = false;
  f.options.observeCandidateRejection = async event => {
    if (event.code === 'JOBAID_MODEL_OUTPUT_FUNCTION_REQUIRED' && !interrupted) {
      interrupted = true; throw new Error('Simulated process interruption');
    }
  };
  await assert.rejects(f.run(input), /Simulated process interruption/);
  const recorded = await checkpoint.readOptional('assessment-round-2.result');
  await f.run(input);
  assert.deepEqual(await checkpoint.readOptional('assessment-round-2.result'), recorded);
  assert.equal(generations, 4, 'completed text-only response is reused, not generated again');
  assert.equal(saves, 2, 'the original rejected SAVE is not repeated');
  assert.equal(f.reads.length, 0);
  const rejection = JSON.parse(f.calls[1].messages.at(-1).content);
  assert.equal(rejection.fieldErrors[0].path, 'work.issues[0].riskScenarios[0].likelihood');
  assert.deepEqual(rejection.fieldErrors[0].sourceKinds, ['ENGINEER_STATEMENT']);
  assert.match(rejection.instruction, /null.*preserve the scenario/);
  const correctionMessages = f.calls[2].messages;
  assert.equal(JSON.parse(correctionMessages.at(-1).content).errorCode, 'JOBAID_MODEL_OUTPUT_FUNCTION_REQUIRED');
  assert.equal(JSON.parse(correctionMessages.at(-1).content).priorRejection.fieldErrors[0].path,
    'work.issues[0].riskScenarios[0].likelihood');
  assert.ok(correctionMessages.some(message => message.role === 'tool' && message.content.includes('JOBAID_LIKELIHOOD_BUSINESS_EVIDENCE_REQUIRED')));
  assert.equal(JSON.stringify(correctionMessages).includes('A completed explanation without'), false);
  assert.deepEqual(f.saves[0] && JSON.parse(f.saves[0].workJson), corrected);
}));

test('text-only protocol corrections are bounded and truncated or foreign calls are not repaired', async () => {
  for (const mode of ['text', 'truncated', 'foreign-call']) {
    const f = fixture([]); let calls = 0;
    f.dependencies.requestGateway = async () => {
      calls++;
      return new Response(JSON.stringify({ choices: [{ finish_reason: mode === 'truncated' ? 'length' : 'stop',
        message: { role: 'assistant', content: 'Unusable output', ...(mode === 'foreign-call' ? {
          tool_calls: [{ id: 'unapproved', type: 'function', function: { name: 'other_tool', arguments: '{}' } }],
        } : {}) } }] }), { status: 200 });
    };
    await assert.rejects(f.run(), /JOBAID_MODEL_OUTPUT_FUNCTION_INVALID/);
    assert.equal(calls, mode === 'text' ? 3 : 1);
    assert.equal(f.saves.length, 0);
  }
});

async function persisted(run) {
  const directory = await mkdtemp(join(tmpdir(), 'jobaid-round-recovery-'));
  try { await run(await createCheckpointStore(directory)); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test('Matter counts durable model execution while keeping the Host deadline across maintenance downtime', () => persisted(async checkpoint => {
  const input = { ...modelInput(), schemaVersion: 'wiselink.matter-jobaid-task.v2',
    subject: { kind: 'ENGINEERING_MATTER', matterId: 'MAT-budget' }, availableDocuments: [{ documentVersionId: 'DV-budget' }] };
  const f = fixture([{ action: 'READ_SOURCES', sourceRefs: ['source:dv:sr1'], purpose: 'read', context: 'PAGE' },
    { action: 'FINISH', work: completed }], { assessmentCheckpoint: checkpoint,
    taskDeadline: new Date(Date.now() + 10 * 60_000).toISOString() });
  const read = f.options.readAssessmentSources;
  let first = true;
  f.options.readAssessmentSources = async args => {
    if (first) { first = false; throw new Error('HOST_SOURCE_TIMEOUT'); }
    return read(args);
  };
  const run = () => invokeHostedJobAidProblemModel({ operation: 'ASSESS_MATTER', modelInput: input }, f.options, f.dependencies);
  await assert.rejects(run(), /HOST_SOURCE_TIMEOUT/);
  const enabled = await checkpoint.readOptional('assessment-enabled');
  enabled.startedAt = Date.now() - 40 * 60_000;
  await checkpoint.write('assessment-enabled', enabled);
  const start = await checkpoint.readOptional('assessment-round-1.started');
  const result = await checkpoint.readOptional('assessment-round-1.result');
  start.startedAt = new Date(enabled.startedAt).toISOString();
  result.finishedAt = new Date(enabled.startedAt + 5_000).toISOString();
  await checkpoint.write('assessment-round-1.started', start);
  await checkpoint.write('assessment-round-1.result', result);
  await run();
  assert.equal(f.calls.length, 2, 'the already-completed first model call is not repeated');
  assert.equal(f.saves.length, 1);
  assert.deepEqual(await checkpoint.readOptional('assessment-enabled'), enabled, 'the original start time is never rewritten');
  assert.deepEqual(await checkpoint.readOptional('assessment-round-1.result'), result);
}));

test('Matter still stops at consumed model budget or the absolute Host deadline', async () => {
  for (const mode of ['model-time', 'host-deadline', 'invalid-time']) await persisted(async checkpoint => {
    const input = { ...modelInput(), schemaVersion: 'wiselink.matter-jobaid-task.v2',
      subject: { kind: 'ENGINEERING_MATTER', matterId: 'MAT-budget' }, availableDocuments: [{ documentVersionId: 'DV-budget' }] };
    const f = fixture([{ action: 'READ_SOURCES', sourceRefs: ['source:dv:sr1'], purpose: 'read', context: 'PAGE' }],
      { assessmentCheckpoint: checkpoint, taskDeadline: new Date(Date.now() + 10 * 60_000).toISOString() });
    let first = true;
    const read = f.options.readAssessmentSources;
    f.options.readAssessmentSources = async args => {
      if (first) { first = false; throw new Error('HOST_SOURCE_TIMEOUT'); }
      return read(args);
    };
    const run = () => invokeHostedJobAidProblemModel({ operation: 'ASSESS_MATTER', modelInput: input }, f.options, f.dependencies);
    await assert.rejects(run(), /HOST_SOURCE_TIMEOUT/);
    const start = await checkpoint.readOptional('assessment-round-1.started');
    const result = await checkpoint.readOptional('assessment-round-1.result');
    start.startedAt = new Date(Date.now() - 40 * 60_000).toISOString();
    result.finishedAt = mode === 'invalid-time' ? 'invalid' : new Date(Date.now() - 9 * 60_000).toISOString();
    await checkpoint.write('assessment-round-1.started', start);
    await checkpoint.write('assessment-round-1.result', result);
    if (mode === 'host-deadline') f.options.taskDeadline = new Date(Date.now() - 1).toISOString();
    await assert.rejects(run(), mode === 'invalid-time' ? /JOBAID_CHECKPOINT_EXECUTION_TIME_INVALID/ : /JOBAID_MODEL_BUDGET_EXHAUSTED/);
    assert.equal(f.calls.length, 1);
    assert.equal(f.saves.length, 0);
  });
});

test('a failed source read resumes the exact model response without another generation', () => persisted(async checkpoint => {
  const f = fixture([
    { action: 'READ_SOURCES', sourceRefs: ['source:dv:sr1'], purpose: 'read', context: 'PAGE' },
    { action: 'SAVE_WORK', work: completed }, { action: 'FINISH' },
  ], { assessmentCheckpoint: checkpoint });
  const read = f.options.readAssessmentSources;
  let attempts = 0;
  f.options.readAssessmentSources = async input => {
    if (++attempts === 1) throw new Error('HOST_SOURCE_TIMEOUT');
    return read(input);
  };
  await assert.rejects(f.run(), /HOST_SOURCE_TIMEOUT/);
  assert.equal(f.calls.length, 1);
  assert.equal((await f.run()).output.workRevisionRef, 'JAWR-1');
  assert.equal(f.calls.length, 3);
  assert.equal(attempts, 2);
  assert.equal(f.saves.length, 1);
}));

test('unknown model response stays fenced across process reentry', () => persisted(async checkpoint => {
  const f = fixture([new Error('response lost')], { assessmentCheckpoint: checkpoint });
  await assert.rejects(f.run(), /response lost/);
  await assert.rejects(f.run(), /OUTCOME_UNKNOWN/);
  assert.equal(f.calls.length, 1);
}));

test('saved work with a lost response and failed readback is recovered by the same request', () => persisted(async checkpoint => {
  const f = fixture([{ action: 'SAVE_WORK', work: completed }, { action: 'FINISH' }], { assessmentCheckpoint: checkpoint });
  const save = f.options.saveAssessmentWork;
  const read = f.options.readAssessmentWork;
  let loseRead = false;
  f.options.saveAssessmentWork = async input => {
    await save(input); loseRead = true; throw new Error('save response lost');
  };
  f.options.readAssessmentWork = async input => {
    if (loseRead) { loseRead = false; throw new Error('readback unavailable'); }
    return read(input);
  };
  await assert.rejects(f.run(), /readback unavailable/);
  assert.equal((await f.run()).output.workRevisionRef, 'JAWR-1');
  assert.equal(f.saves.length, 1);
  assert.equal(f.calls.length, 2);
}));

test('checkpoint cannot resume another model input or session', () => persisted(async checkpoint => {
  const f = fixture([new Error('response lost')], { assessmentCheckpoint: checkpoint });
  await assert.rejects(f.run(), /response lost/);
  f.options.sessionDiscriminator = 'different-attempt';
  await assert.rejects(f.run(), /CHECKPOINT_BINDING_MISMATCH/);
  assert.equal(f.calls.length, 1);
}));

test('reads a real source, saves completed reasoning and finishes with only its saved identity', async () => {
  const f = fixture([
    {
      action: 'READ_SOURCES',
      sourceRefs: ['source:dv:sr1'],
      purpose: 'Inspect the original condition',
      context: 'PAGE',
    },
    {
      action: 'SAVE_WORK',
      work: completed,
      continueReason: 'Check the saved work',
    },
    { action: 'FINISH' },
  ]);
  const result = await f.run();
  assert.equal(f.reads.length, 1);
  assert.equal(f.saves.length, 1);
  assert.equal(result.output.workRevisionRef, 'JAWR-1');
  assert.equal(result.provenance.toolVersions['jobaid-problem-protocol'], '2');
  assert.equal(
    JSON.parse(f.saves[0].workJson).understanding,
    completed.understanding,
  );
  assert.equal(
    f.calls[1].messages.some((message) => message.role === 'user'),
    false,
    'native history receives only the next exchange',
  );
  assert.equal(f.calls[2].messages.length, 3);
});

test('a 408 after a substantive save leaves work intact and causes no fresh model attempt', async () => {
  const f = fixture([
    {
      action: 'SAVE_WORK',
      work: { ...completed, roundCompletion: 'IN_PROGRESS' },
    },
    408,
    { action: 'FINISH' },
  ]);
  await assert.rejects(f.run(), /JOBAID_GATEWAY_HTTP_408/u);
  assert.equal(f.calls.length, 2);
  assert.equal(f.store.size, 1);
  assert.equal([...f.store.values()][0].content.roundCompletion, 'IN_PROGRESS');
});

test('a lost save response reads the exact request identity without a duplicate mutation or regeneration', async () => {
  const f = fixture([
    { action: 'SAVE_WORK', work: completed },
    { action: 'FINISH' },
  ]);
  const save = f.options.saveAssessmentWork;
  let mutations = 0;
  f.options.saveAssessmentWork = async (input) => {
    mutations++;
    await save(input);
    throw new Error('socket closed after save');
  };
  const result = await f.run();
  assert.equal(result.output.workRevisionRef, 'JAWR-1');
  assert.equal(mutations, 1);
  assert.equal(f.calls.length, 2);
  assert.equal(f.store.size, 1);
});

test('lease loss before the next model round stops all subsequent model/read/save calls', async () => {
  let beats = 0;
  const f = fixture(
    [{ action: 'SAVE_WORK', work: completed }, { action: 'FINISH' }],
    {
      heartbeat: async () => {
        if (++beats === 2) throw new Error('JOBAID_WORK_LEASE_FENCE_REJECTED');
      },
    },
  );
  await assert.rejects(f.run(), /LEASE_FENCE_REJECTED/u);
  assert.equal(f.calls.length, 1);
  assert.equal(f.saves.length, 1);
  assert.equal(f.store.size, 1);
});

test('Overall consistency reuses the exact completed work and does not re-save unchanged issues', async () => {
  const f = fixture([
    {
      action: 'FINISH',
      consistencyCheck:
        'Conditions and missing reliability scope remain consistent.',
    },
  ]);
  const result = await f.run({
    ...modelInput(),
    purpose: 'OVERALL_CONSISTENCY',
    expectedWorkRevision: 3,
    previousWork: {
      workRevisionRef: 'JAWR-3',
      workRevision: 3,
      content: completed,
    },
  });
  assert.equal(result.output.workRevisionRef, 'JAWR-3');
  assert.equal(f.saves.length, 0);
  assert.equal(f.reads.length, 0);
});

test('a Host addresses rejection identifies the wrong field and preserves the work for model correction', async () => {
  const invalid = { ...completed, issues: [{ measures: [
    { addresses: ['synthetic problem'], status: 'PROPOSED' },
    { addresses: '   ', status: 'PROPOSED' },
  ] }] };
  const corrected = { ...completed, issues: [{ measures: [
    { addresses: '针对已有证据中的兼容性问题。', status: 'PROPOSED' },
    { addresses: '核对尚未确认的构型条件。', status: 'PROPOSED' },
  ] }] };
  const f = fixture([
    { action: 'SAVE_WORK', work: invalid },
    { action: 'SAVE_WORK', work: corrected },
    { action: 'FINISH' },
  ]);
  const save = f.options.saveAssessmentWork;
  let attempts = 0;
  f.options.saveAssessmentWork = async (input) => {
    if (++attempts === 1) {
      assert.deepEqual(JSON.parse(input.workJson), invalid, 'no silent coercion before Host validation');
      throw Object.assign(new Error('REVIEW_HOST_MCP_TOOL_FAILED:save_assessment_work'), {
        hostErrorCode: 'JOBAID_MEASURE_ADDRESSES_INVALID',
      });
    }
    return save(input);
  };
  const result = await f.run();
  const receipt = JSON.parse(f.calls[1].messages.at(-1).content);
  assert.equal(receipt.errorCode, 'JOBAID_MEASURE_ADDRESSES_INVALID');
  assert.deepEqual(receipt.fieldErrors, [
    { path: 'work.issues[0].measures[0].addresses', expected: 'non-empty string', received: 'array' },
    { path: 'work.issues[0].measures[1].addresses', expected: 'non-empty string', received: 'string' },
  ]);
  assert.match(receipt.instruction, /changing status does not repair it/u);
  assert.equal(JSON.stringify(receipt).includes('synthetic problem'), false);
  assert.equal(result.output.workRevisionRef, 'JAWR-1');
  assert.equal(f.store.size, 1);
  assert.deepEqual([...f.store.values()][0].content, corrected);
});

test('Host risk rejection reports all supplied shape errors and saves corrected candidate unchanged', async () => {
  const invalid = { ...completed, issues: [{
    riskScenarios: [{ conditions: 'synthetic sensitive condition', severity: null, likelihood: null }],
    requirementHandling: [{ conditions: 'synthetic requirement' }],
    openQuestions: [{ affects: ['synthetic implication'] }],
  }] };
  const corrected = { ...completed, issues: [{
    riskScenarios: [{ conditions: ['待确认条件'], severity: null, likelihood: null }],
    requirementHandling: [{ conditions: ['待确认适用范围'] }],
    openQuestions: [{ affects: '条件未确认，结论仍有保留。' }],
  }] };
  const f = fixture([
    { action: 'SAVE_WORK', work: invalid },
    { action: 'SAVE_WORK', work: corrected },
    { action: 'FINISH' },
  ]);
  const save = f.options.saveAssessmentWork;
  let attempts = 0;
  f.options.saveAssessmentWork = async (input) => {
    if (++attempts === 1) {
      assert.deepEqual(JSON.parse(input.workJson), invalid);
      throw Object.assign(new Error('REVIEW_HOST_MCP_TOOL_FAILED'), {
        hostErrorCode: 'JOBAID_RISK_CONDITIONS_INVALID',
      });
    }
    return save(input);
  };
  await f.run();
  const receipt = JSON.parse(f.calls[1].messages.at(-1).content);
  assert.equal(receipt.errorCode, 'JOBAID_RISK_CONDITIONS_INVALID');
  assert.deepEqual(receipt.fieldErrors, [
    { path: 'work.issues[0].riskScenarios[0].conditions', expected: 'array', received: 'string' },
    { path: 'work.issues[0].openQuestions[0].affects', expected: 'non-empty string', received: 'array' },
    { path: 'work.issues[0].requirementHandling[0].conditions', expected: 'array', received: 'string' },
  ]);
  assert.equal(JSON.stringify(receipt).includes('synthetic'), false);
  assert.equal(f.store.size, 1);
  assert.deepEqual([...f.store.values()][0].content, corrected);
});

test('work shape diagnostics leave nullable unknowns intact and identify nested item and enum types', async () => {
  const { jobAidWorkTypeErrors } = await import('../scripts/jobaid-work-shape.mjs');
  const work = { issues: [{ riskScenarios: [{ severity: null, likelihood: null, importantEvent: null,
    conditions: ['valid', 1] }], measures: [{ status: 'NOT_A_STATUS' }] }] };
  const original = structuredClone(work);
  const errors = jobAidWorkTypeErrors(work);
  assert.equal(errors.length, 2);
  assert.equal(errors[0].path, 'work.issues[0].riskScenarios[0].conditions[1]');
  assert.equal(errors[1].path, 'work.issues[0].measures[0].status');
  assert.deepEqual(work, original);
});

test('an invalid important-event placeholder reaches Host unchanged and correction preserves unknown risk', async () => {
  const invalid = { ...completed, issues: [{ riskScenarios: [{
    severity: null, likelihood: null,
    importantEvent: { event: 'synthetic not established', reason: '未核查', basisRefs: [] },
  }] }] };
  const corrected = structuredClone(invalid);
  corrected.issues[0].riskScenarios[0].importantEvent = null;
  const f = fixture([
    { action: 'SAVE_WORK', work: invalid },
    { action: 'SAVE_WORK', work: corrected }, { action: 'FINISH' },
  ]);
  const save = f.options.saveAssessmentWork;
  let attempts = 0;
  f.options.saveAssessmentWork = async (input) => {
    if (++attempts === 1) {
      assert.deepEqual(JSON.parse(input.workJson), invalid);
      throw Object.assign(new Error('REVIEW_HOST_MCP_TOOL_FAILED'), {
        hostErrorCode: 'JOBAID_IMPORTANT_EVENT_CATEGORY',
      });
    }
    return save(input);
  };
  await f.run();
  const receipt = JSON.parse(f.calls[1].messages.at(-1).content);
  assert.equal(receipt.errorCode, 'JOBAID_IMPORTANT_EVENT_CATEGORY');
  assert.equal(receipt.fieldErrors[0].path, 'work.issues[0].riskScenarios[0].importantEvent.event');
  assert.match(receipt.fieldErrors[0].expected, /空中停车.*客货舱火警／烟雾/u);
  assert.equal(JSON.stringify(receipt).includes('synthetic not established'), false);
  assert.deepEqual([...f.store.values()][0].content, corrected);
});

test('Host dependency rejection identifies omitted method reference and preserves corrected work', async () => {
  const invalid = { ...completed, issues: [{ sourceDependencies: ['source:1'], premiseRefs: [],
    requirementHandling: [{ methodRef: 'method:synthetic-sensitive', basisRefs: [] }] }] };
  const corrected = structuredClone(invalid);
  corrected.issues[0].sourceDependencies.push('method:synthetic-sensitive');
  const f = fixture([{ action: 'SAVE_WORK', work: invalid }, { action: 'SAVE_WORK', work: corrected }, { action: 'FINISH' }]);
  const observations = [];
  f.options.observeCandidateRejection = async (value) => observations.push(value);
  const save = f.options.saveAssessmentWork;
  let attempts = 0;
  f.options.saveAssessmentWork = async (input) => {
    if (++attempts === 1) {
      assert.deepEqual(JSON.parse(input.workJson), invalid);
      throw Object.assign(new Error('REVIEW_HOST_MCP_TOOL_FAILED'), { hostErrorCode: 'JOBAID_ISSUE_DEPENDENCY_MISSING' });
    }
    return save(input);
  };
  await f.run();
  const receipt = JSON.parse(f.calls[1].messages.at(-1).content);
  assert.deepEqual(receipt.fieldErrors, [{ path: 'work.issues[0].requirementHandling[0].methodRef',
    expected: 'reference included in work.issues[0].sourceDependencies or work.issues[0].premiseRefs', received: 'undeclared reference' }]);
  assert.equal(JSON.stringify(receipt).includes('synthetic-sensitive'), false);
  assert.deepEqual(observations[0].fieldErrors, receipt.fieldErrors);
  assert.equal(JSON.stringify(observations).includes('synthetic-sensitive'), false);
  assert.deepEqual([...f.store.values()][0].content, corrected);
  assert.equal(f.store.size, 1);
});

test('dependency diagnostics cover every Host citation location and stay within each issue', async () => {
  const { jobAidWorkDependencyErrors } = await import('../scripts/jobaid-work-shape.mjs');
  const issue = { sourceDependencies: [], premiseRefs: [],
    statements: [{ premises: [{ evidenceRef: 'ref' }] }],
    riskScenarios: [{ severity: { basisRefs: ['ref'] }, likelihood: { basisRefs: ['ref'] }, importantEvent: { basisRefs: ['ref'] } }],
    measures: [{ basisRefs: ['ref'] }], otherClassifications: [{ basisRefs: ['ref'] }],
    requirementHandling: [{ methodRef: 'ref', basisRefs: ['ref'] }],
  };
  const work = { issues: [issue, { sourceDependencies: ['ref'] }] };
  assert.equal(jobAidWorkDependencyErrors(work).length, 8);
  issue.premiseRefs = [' ref '];
  assert.deepEqual(jobAidWorkDependencyErrors(work), []);
  assert.deepEqual(issue.sourceDependencies, []);
});

test('typed Overall finish preserves quotes and line breaks with one JSON encoding and no resave', async () => {
  const consistencyCheck = '保留原文 "Do not install"。\n路径示例 C:\\maintenance；条件仍待确认。';
  const f = fixture([{ action: 'FINISH', consistencyCheck }]);
  const result = await f.run({ ...modelInput(), purpose: 'OVERALL_CONSISTENCY', expectedWorkRevision: 1,
    previousWork: { workRevisionRef: 'JAWR-1', workRevision: 1, content: completed } });
  assert.equal(result.output.workRevisionRef, 'JAWR-1');
  assert.equal(result.output.consistencyCheck, consistencyCheck);
  assert.equal(f.saves.length, 0);
  const parameters = f.calls[0].tools[0].function.parameters;
  assert.deepEqual(parameters.required, ['step']);
  assert.equal(parameters.properties.step.type, 'object');
  assert.equal(parameters.properties.step.properties.work, undefined);
  assert.equal(parameters.properties.step.properties.workJson.type, 'string');
});

test('typed step unwraps only exact declared native arrays without editing content or extra fields', async () => {
  const { decodeJobAidStep } = await import('../scripts/jobaid-work-shape.mjs');
  const step = { action: 'SAVE_WORK', work: { issues: { item: [{ measures: { item: [
    { addresses: '原文 "quote"\n下一行', basisRefs: { item: ['ref'] }, extra: { item: ['keep'] } },
  ] } }] } } };
  const result = decodeJobAidStep(step);
  assert.equal(result.work.issues[0].measures[0].addresses, '原文 "quote"\n下一行');
  assert.deepEqual(result.work.issues[0].measures[0].basisRefs, ['ref']);
  assert.deepEqual(result.work.issues[0].measures[0].extra, { item: ['keep'] });
  assert.deepEqual(decodeJobAidStep({ action: 'READ_SOURCES', sourceRefs: { item: ['ref'], extra: true } }).sourceRefs,
    { item: ['ref'], extra: true });
  assert.deepEqual(step.work.issues.item[0].measures.item[0].basisRefs, { item: ['ref'] });
});


test('native array schema preserves cardinality and item constraints in the exact lossless envelope', async () => {
  const { jobAidFunctionSchema, decodeJobAidValue } = await import('../scripts/jobaid-work-shape.mjs');
  const shape = { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string', enum: ['ref:1', 'ref:2'] } };
  const schema = jobAidFunctionSchema(shape);
  assert.deepEqual(schema.anyOf[0], shape);
  assert.deepEqual(schema.anyOf[1], { type: 'object', additionalProperties: false,
    required: ['item'], properties: { item: shape } });
  assert.deepEqual(decodeJobAidValue({ item: ['ref:1'] }, shape), ['ref:1']);
  for (const invalid of [{ item: 'ref:1' }, { item: ['ref:1'], extra: true }, { other: ['ref:1'] }]) {
    assert.deepEqual(decodeJobAidValue(invalid, shape), invalid);
  }
  assert.deepEqual(jobAidFunctionSchema(shape), schema);
});

test('Turn 26 premise envelopes decode losslessly without filling absent fields or dropping unknown content', async () => {
  const { JOBAID_WORK_UPDATE_SHAPE, jobAidFunctionSchema, decodeJobAidValue } = await import('../scripts/jobaid-work-shape.mjs');
  const shape = JOBAID_WORK_UPDATE_SHAPE.properties.issues.items.properties.statements.items.properties.premises;
  const item = { evidenceRef: 'source:exact:ref', role: 'SUPPORTS', explanation: '原文 "quote"\n条件', limitation: null };
  const schema = jobAidFunctionSchema(shape);
  assert.deepEqual(schema.anyOf[2].properties.item.required, ['evidenceRef', 'role', 'explanation', 'limitation']);
  assert.deepEqual(schema.anyOf[3].properties.item.properties.item, schema.anyOf[0]);
  for (const wrapped of [{ item }, { item: { item: [item, { ...item, role: 'LIMITS' }] } }]) {
    const before = structuredClone(wrapped);
    const work = { issues: [{ statements: [{ premises: wrapped }] }], sourceRefs: { item: ['unknown:keep'] } };
    const decoded = decodeJobAidValue(work, JOBAID_WORK_UPDATE_SHAPE);
    assert.deepEqual(decoded.issues[0].statements[0].premises,
      Array.isArray(wrapped.item.item) ? wrapped.item.item : [item]);
    assert.deepEqual(decoded.sourceRefs, { item: ['unknown:keep'] });
    assert.deepEqual(wrapped, before);
  }
  const { limitation, ...incomplete } = item;
  for (const invalid of [{}, { item: {} }, { item: incomplete }, { item, extra: true },
    { item: { item: [item], extra: true } }, { item: { item: { item: [item] } } }]) {
    assert.deepEqual(decodeJobAidValue(invalid, shape), invalid);
  }
  const unknown = { ...item, unexpected: 'preserve for Host rejection' };
  assert.deepEqual(decodeJobAidValue({ item: unknown }, shape), [unknown]);
  assert.deepEqual(decodeJobAidValue({ item }, JOBAID_WORK_UPDATE_SHAPE.properties.retiredIssues), { item });
});

test('knowledge dispatch is one-shot; unknown response reads the same request and preserves provenance', async () => {
  const queries = [];
  const evidence = { evidenceRef: 'query:aily:receipt', kind: 'QUERY_RECEIPT', excerpt: 'Partial source lead', queryProvenance: { origin: 'AILY_RETRIEVAL', queryText: 'Find applicable directive', status: 'UNKNOWN', originalDocumentsVerified: false } };
  const f = fixture([{ action: 'QUERY_KNOWLEDGE', query: 'Find applicable directive' }, { action: 'FINISH', work: completed }], {
    queryAssessmentKnowledge: async input => {
      queries.push(input);
      if (queries.length === 1) throw new Error('transport lost');
      return { queryRef: 'receipt', status: 'UNKNOWN', evidence: [evidence], candidateOnly: true, originalDocumentsVerified: false };
    },
  });
  await f.run({ ...modelInput(), knowledgeAccess: { available: true } });
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[1], { requestKey: queries[0].requestKey });
  const body = f.calls[1];
  assert.deepEqual(JSON.parse(body.messages.at(-1).content).evidence, [evidence]);
  assert.doesNotMatch(JSON.stringify(f.calls), /knowledgeBinding|sessionId|actorUserId|tenantId|leaseToken/);
});

test('unavailable knowledge stays explicit and permits conditional saved work without dispatch', async () => {
  let dispatches = 0;
  const f = fixture([{ action: 'QUERY_KNOWLEDGE', query: 'Find directive' }, { action: 'FINISH', work: completed }], {
    queryAssessmentKnowledge: async () => { dispatches++; throw new Error('must not dispatch'); },
  });
  await f.run({ ...modelInput(), knowledgeAccess: { available: false, reason: 'USER_REAUTHORIZATION_REQUIRED' } });
  assert.equal(dispatches, 0);
  const receipt = JSON.parse(f.calls[1].messages.at(-1).content);
  assert.equal(receipt.status, 'UNAVAILABLE');
  assert.equal(receipt.error, 'USER_REAUTHORIZATION_REQUIRED');
  assert.equal(f.saves.length, 1);
});


test('workJson preserves complete content and rejects ambiguous or non-object JSON', async () => {
  const { parseJobAidWorkJson } = await import('../scripts/run-jobaid-problem-assessment.mjs');
  const work = { ...completed, sample: { empty: [], unknown: null, text: '引号 "quoted"\n换行 \\ 路径' } };
  assert.deepEqual(parseJobAidWorkJson(JSON.stringify(work)), work);
  for (const value of ['[]', 'null', '"text"', '{bad}', '{"a":1,"a":2}', '{"nested":[{"a":1,"\\u0061":2}]}']) {
    assert.throws(() => parseJobAidWorkJson(value), /JOBAID_WORK_JSON_/);
  }
  const f = fixture([{ action: 'SAVE_WORK', workJson: JSON.stringify(work) }, { action: 'FINISH' }]);
  await f.run();
  assert.deepEqual(JSON.parse(f.saves[0].workJson), work);
});



test('120 source requests use 96+24 Host batches and preserve all PAGE evidence', async () => {
  const refs = Array.from({ length: 120 }, (_, index) => `source:synthetic:${index}`);
  const readCalls = [];
  const footnote = { evidenceRef: 'source:page-footnote', excerpt: '仅在条件成立时适用。', kind: 'DOCUMENT_PASSAGE' };
  const f = fixture([{ action: 'READ_SOURCES', sourceRefs: refs, purpose: '读取全部已选原文及页脚条件', context: 'PAGE' },
    { action: 'FINISH', work: completed }], {
    readAssessmentSources: async input => {
      readCalls.push(input);
      assert.ok(input.sourceRefs.length <= 96);
      return { schemaVersion: 'wiselink.jobaid-source-read.v2', status: 'AVAILABLE', scope: 'PAGE', completeRequestedScope: true,
        sourceRefs: [...input.sourceRefs, footnote.evidenceRef],
        evidence: [...input.sourceRefs.map(evidenceRef => ({ evidenceRef, excerpt: `原文 ${evidenceRef}` })), footnote] };
    },
  });
  await f.run();
  assert.deepEqual(readCalls.map(call => call.sourceRefs.length), [96, 24]);
  assert.deepEqual(readCalls.flatMap(call => call.sourceRefs), refs);
  assert.ok(readCalls.every(call => call.context === 'PAGE' && call.purpose === '读取全部已选原文及页脚条件'));
  const receipt = JSON.parse(f.calls[1].messages.at(-1).content);
  assert.equal(receipt.completeRequestedScope, true);
  assert.equal(receipt.evidence.length, 121);
  assert.deepEqual(new Set(receipt.sourceRefs), new Set([...refs, footnote.evidenceRef]));
  assert.deepEqual(receipt.evidence.find(item => item.evidenceRef === footnote.evidenceRef), footnote);
});

test('a later source batch failure stops reading and never reports complete scope or saves work', async () => {
  const refs = Array.from({ length: 210 }, (_, index) => `source:synthetic:${index}`);
  let reads = 0;
  const f = fixture([{ action: 'READ_SOURCES', sourceRefs: refs, purpose: '读取原文', context: 'EXACT' }], {
    readAssessmentSources: async input => {
      reads++;
      if (reads === 2) throw new Error('JOBAID_SOURCE_READ_FAILED');
      return { status: 'AVAILABLE', scope: 'EXACT', completeRequestedScope: true,
        sourceRefs: input.sourceRefs, evidence: input.sourceRefs.map(evidenceRef => ({ evidenceRef, excerpt: '原文' })) };
    },
  });
  await assert.rejects(f.run(), /JOBAID_SOURCE_READ_FAILED/);
  assert.equal(reads, 2);
  assert.equal(f.calls.length, 1);
  assert.equal(f.saves.length, 0);
});

test('overlapping source batches cannot silently replace different source content', async () => {
  const { readJobAidSourceBatches } = await import('../scripts/run-jobaid-problem-assessment.mjs');
  const sourceRefs = Array.from({ length: 97 }, (_, index) => `ref:${index}`);
  let calls = 0;
  await assert.rejects(readJobAidSourceBatches({ sourceRefs, context: 'PAGE', purpose: '原文' }, async input => ({
    status: 'AVAILABLE', scope: 'PAGE', completeRequestedScope: true, sourceRefs: input.sourceRefs,
    evidence: [{ evidenceRef: 'same-page', excerpt: `changed ${++calls}` }],
  })), /JOBAID_SOURCE_READ_FAILED:INCONSISTENT_EVIDENCE/);
});

test('Matter uses the same model loop and must save this attempt before finishing prior completed work', async () => {
  const input = { ...modelInput(), schemaVersion: 'wiselink.matter-jobaid-task.v2',
    subject: { kind: 'ENGINEERING_MATTER', matterId: 'MAT-one' }, availableDocuments: [{ documentVersionId: 'DV-one' }],
    expectedWorkRevision: 1, previousWork: { workRevisionRef: 'MWR-prior', workRevision: 1, content: completed } };
  const f = fixture([{ action: 'FINISH' }, { action: 'SAVE_WORK', work: completed }, { action: 'FINISH' }]);
  const result = await invokeHostedJobAidProblemModel({ operation: 'ASSESS_MATTER', modelInput: input }, f.options, f.dependencies);
  assert.equal(f.saves.length, 1);
  assert.equal(f.calls.length, 3);
  assert.equal(result.output.workRevisionRef, 'JAWR-2');
  assert.match(f.calls[0].messages[0].content, /DOCUMENT_VERSION/);
});
