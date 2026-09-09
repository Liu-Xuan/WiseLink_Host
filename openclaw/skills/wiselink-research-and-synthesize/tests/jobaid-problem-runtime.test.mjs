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
                        stepJson: JSON.stringify(step),
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
