import assert from 'node:assert/strict';
import test from 'node:test';
import { invokeHostedJobAidProblemModel } from '../scripts/run-jobaid-problem-assessment.mjs';

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
      const step = steps.shift();
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
  assert.equal(parameters.properties.step.properties.work.properties.issues.anyOf[0].type, 'array');
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
