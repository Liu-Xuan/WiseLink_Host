import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { consumeHostedMatter } from '../scripts/consume-hosted-matter.mjs';
import { invokeHostedJobAidProblemModel } from '../scripts/run-jobaid-problem-assessment.mjs';
import { readMatterRecoveryCandidate } from '../scripts/read-matter-recovery-candidate.mjs';

test('a Host-authorized successor saves the exact old candidate and supplies context to its new native session', async () => {
  const checkpointRoot = await mkdtemp(join(tmpdir(), 'matter-successor-'));
  try {
    const executionModel = { modelRef: 'miaoda/minimax-m3', displayName: 'Synthetic', providerKind: 'BUILT_IN', settingsRevision: 0,
      selectedAt: '2026-09-11T00:00:00.000Z' };
    let task = { schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v2', taskType: 'OPENCLAW_MATTER_ASSESSMENT',
      actionAttemptId: 'ATT-original', operationRef: 'AQ-original', subject: { kind: 'ENGINEERING_MATTER', matterId: 'MAT-one' },
      inputHash: 'original-input', baseRevision: 0, sourceRefs: [], executionModel,
      modelInput: { schemaVersion: 'wiselink.matter-jobaid-task.v2', sourceCatalog: [], modelInput: {
        schemaVersion: 'wiselink.matter-jobaid-task.v2', subject: { kind: 'ENGINEERING_MATTER', matterId: 'MAT-one' },
        methodBinding: { packRef: 'test' }, availableSources: [], deliveredEvidence: [], availableDocuments: [],
        expectedWorkRevision: 0, previousWork: null,
      } } };
    const candidate = JSON.stringify({ schemaVersion: 'wiselink.jobaid-problem-work.v2', roundCompletion: 'COMPLETE',
      understanding: 'Preserve the original bounded conclusion.' });
    const calls = []; const saves = [];
    const dependencies = {
      callTool: async (name, input) => {
        if (name === 'next_matter_assessment') return { matterId: 'MAT-one', next: { attemptRef: task.operationRef, status: 'RUNNING' } };
        if (input.operation === 'CLAIM') return { task, attemptRef: task.operationRef, status: 'RUNNING', leaseToken: 'synthetic', leaseGeneration: 1 };
        if (input.operation === 'HEARTBEAT') return {};
        if (input.operation === 'READ_SAVED_WORK') return null;
        if (input.operation === 'SAVE_WORK') {
          saves.push({ attemptRef: task.operationRef, ...input });
          if (task.operationRef === 'AQ-original') throw new Error('HOST_SAVE_TRANSPORT_FAILED');
          return { workRevisionRef: 'MWR-saved', workRevision: 1, roundCompletion: 'COMPLETE' };
        }
        if (input.operation === 'FINISH') return { attemptRef: task.operationRef, status: 'SUCCEEDED', workRevisionRef: 'MWR-saved' };
        assert.fail(input.operation);
      },
      invokeMatterModel: (input, hooks) => invokeHostedJobAidProblemModel(input, {
        gatewayChatCompletionsEnabled: true, gatewayUrl: 'http://127.0.0.1:1', gatewayToken: 'synthetic',
        registeredModelRefs: [executionModel.modelRef], ...hooks,
      }, { requestGateway: async (_url, request) => {
        const body = JSON.parse(request.body); calls.push(body);
        const step = calls.length === 1 ? { action: 'SAVE_WORK', workJson: candidate } : { action: 'FINISH' };
        return new Response(JSON.stringify({ model: executionModel.modelRef, choices: [{ finish_reason: 'tool_calls',
          message: { role: 'assistant', content: null, tool_calls: [{ id: `call-${calls.length}`, type: 'function',
            function: { name: 'return_wiselink_assessment_step', arguments: JSON.stringify({ step }) } }] } }] }));
      } }),
    };
    const options = { checkpointRoot, matterId: 'MAT-one' };
    await assert.rejects(consumeHostedMatter(options, dependencies), /HOST_SAVE_TRANSPORT_FAILED/);
    const recovery = { attemptRef: 'AQ-original', inputHash: 'original-input' };
    await assert.rejects(readMatterRecoveryCandidate({ ...options, recovery: { ...recovery, inputHash: 'different' }, executionModel }),
      /RECOVERY_CHECKPOINT_BINDING_MISMATCH/);
    await assert.rejects(readMatterRecoveryCandidate({ ...options, recovery,
      executionModel: { ...executionModel, modelRef: 'dli/gpt-5.6-sol' } }), /RECOVERY_CHECKPOINT_BINDING_MISMATCH/);
    task = { ...task, actionAttemptId: 'ATT-successor', operationRef: 'AQ-successor', inputHash: 'successor-input',
      modelInput: { ...task.modelInput, recovery } };
    assert.equal((await consumeHostedMatter(options, dependencies)).status, 'MATTER_WORK_SAVED');
    assert.equal(calls.length, 2, 'one original generation plus a finish continuation; candidate was not regenerated');
    assert.equal(calls[1].user, 'initial:AQ-successor:1');
    assert.equal(calls[1].messages[1].role, 'user', 'the new session receives its Host-built full context');
    assert.equal(saves.length, 2);
    assert.equal(saves[0].workJson, saves[1].workJson);
    assert.notEqual(saves[0].requestId, saves[1].requestId, 'each Host-authorized attempt owns its save identity');
  } finally { await rm(checkpointRoot, { recursive: true, force: true }); }
});

test('completed channel failure resumes from Host context without replay; unknown response and changed bindings remain blocked', async () => {
  const { createCheckpointStore } = await import('../scripts/run-hosted-review-turn.mjs');
  const { canonicalSha256 } = await import('../scripts/validate-payload.mjs');
  const checkpointRoot = await mkdtemp(join(tmpdir(), 'matter-source-recovery-'));
  try {
    const executionModel = { modelRef: 'miaoda/minimax-m3' };
    const modelInput = { deliveredEvidence: [{ evidenceRef: 'E1', quote: 'Exact retained condition.' }] };
    const binding = { matterId: 'MAT-one', attemptRef: 'AQ-original', inputHash: 'hash' };
    const store = await createCheckpointStore(join(checkpointRoot, 'matter', 'MAT-one', 'AQ-original'));
    const sessionDiscriminator = 'AQ-original:1';
    const state = { round: 3, messages: [{ role: 'user', content: 'read receipt' }] };
    await store.writeOnce('binding', binding);
    await store.writeOnce('assessment-enabled', { version: 1, binding: { operation: 'ASSESS_MATTER', modelInput, executionModel, sessionDiscriminator } });
    await store.writeOnce('assessment-invocation', { modelInput, sessionDiscriminator });
    await store.write('assessment-state', state);
    const argsHash = canonicalSha256({ operation: 'ASSESS_MATTER', messages: state.messages, executionModel, sessionDiscriminator });
    const options = { checkpointRoot, matterId: 'MAT-one', recovery: { attemptRef: binding.attemptRef, inputHash: binding.inputHash }, executionModel };
    await assert.rejects(readMatterRecoveryCandidate(options), /MODEL_RESULT_UNKNOWN/);
    const value = { ok: false, status: 502, raw: JSON.stringify({ error: { message: 'tool_choice required a return_wiselink_assessment_step tool call, but the agent did not produce one' } }) };
    await store.write('assessment-round-3.result', { argsHash, value });
    const recovered = await readMatterRecoveryCandidate(options);
    assert.equal(recovered.mode, 'SOURCE_CONTEXT_ONLY');
    assert.equal(recovered.response, undefined, 'failed output is never replayed as a candidate');
    assert.equal(recovered.messages, undefined, 'old session content is not substituted for Host-authorized evidence');
    await assert.rejects(readMatterRecoveryCandidate({ ...options, executionModel: { modelRef: 'other' } }), /BINDING_MISMATCH/);
    await store.write('assessment-round-3.result', { argsHash: 'wrong', value });
    await assert.rejects(readMatterRecoveryCandidate(options), /RESPONSE_BINDING_MISMATCH/);
    await store.write('assessment-round-3.result', { argsHash, value: { ...value, raw: JSON.stringify({ error: { message: 'unknown upstream error' } }) } });
    await assert.rejects(readMatterRecoveryCandidate(options), /MODEL_RESULT_UNKNOWN/);
    await store.write('assessment-round-3.result', { argsHash, value: { ok: true, status: 200, raw: JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{partial' } }] }) } });
    await assert.rejects(readMatterRecoveryCandidate(options), /SAVE_RESPONSE_REQUIRED/);
  } finally { await rm(checkpointRoot, { recursive: true, force: true }); }
});

test('source-only successor generates with Host evidence, saves, and continues in one new session', async () => {
  const calls = []; const saves = [];
  const modelInput = { schemaVersion: 'wiselink.matter-jobaid-task.v2', subject: { kind: 'ENGINEERING_MATTER', matterId: 'MAT-one' },
    methodBinding: { packRef: 'test' }, availableSources: [{ ref: 'E1' }], deliveredEvidence: [{ evidenceRef: 'E1', quote: 'M covers X only.' }],
    availableDocuments: [], expectedWorkRevision: 9, previousWork: null };
  const result = await invokeHostedJobAidProblemModel({ operation: 'ASSESS_MATTER', modelInput }, {
    gatewayChatCompletionsEnabled: true, gatewayUrl: 'http://127.0.0.1:1', gatewayToken: 'synthetic',
    registeredModelRefs: ['miaoda/minimax-m3'], executionModel: { modelRef: 'miaoda/minimax-m3', displayName: 'Synthetic', providerKind: 'BUILT_IN', settingsRevision: 0, selectedAt: '2026-09-14T00:00:00.000Z' },
    sessionDiscriminator: 'AQ-successor:1', recoveredSourceContext: true,
    readAssessmentSources: async () => assert.fail('already delivered evidence need not be reread'),
    readAssessmentWork: async () => ({ revision: null }),
    saveAssessmentWork: async x => { saves.push(x); return { workRevisionRef: 'MWR-new', workRevision: 10, roundCompletion: 'COMPLETE' }; },
  }, { requestGateway: async (_url, request) => {
    const body = JSON.parse(request.body); calls.push(body);
    const step = calls.length === 1 ? { action: 'SAVE_WORK', workJson: JSON.stringify({ schemaVersion: 'wiselink.jobaid-problem-work.v3',
      issues: [{ issueKey: 'coverage', question: 'Measure scope', body: 'M covers X; Y is not established. [[E1]]' }], roundCompletion: 'COMPLETE' }) } : { action: 'FINISH' };
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null,
      tool_calls: [{ id: `call-${calls.length}`, type: 'function', function: { name: 'return_wiselink_assessment_step', arguments: JSON.stringify({ step }) } }] } }] }));
  } });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].user, calls[1].user);
  assert.match(calls[0].messages[1].content, /M covers X only/);
  assert.equal(calls[1].messages.filter(m => m.content?.includes('M covers X only')).length, 0, 'do not resend initial context');
  assert.equal(saves.length, 1);
  assert.equal(result.output.workRevisionRef, 'MWR-new');
});
