import assert from 'node:assert/strict';
import test from 'node:test';
import { callJsonTool } from '../scripts/run-hosted-review-turn.mjs';
import { consumeHostedMatter } from '../scripts/consume-hosted-matter.mjs';

function fixture() {
  const task = { schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v2', taskType: 'OPENCLAW_MATTER_ASSESSMENT',
    actionAttemptId: 'ATT-c', operationRef: 'AQ-c', subject: { kind: 'ENGINEERING_MATTER', matterId: 'MAT-c' },
    deadline: '2099-01-01T00:00:00.000Z', baseRevision: 11, inputHash: 'bound-input', modelInput: { schemaVersion: 'wiselink.matter-jobaid-task.v2',
      correction: { kind: 'ENGINEERING_ISSUE_CORRECTION' } } };
  const calls = []; const checkpoints = new Map();
  let mode = 'RUNNING'; let failSave = false; let failGeneration = false; let badFinish = false;
  const dependencies = {
    createCheckpoint: async () => ({ readOptional: async key => checkpoints.get(key),
      writeOnce: async (key, value) => { assert.equal(checkpoints.has(key), false); checkpoints.set(key, value); } }),
    invokeMatterModel: async () => assert.fail('Correction must not invoke the Hosted investigation model'),
    callTool: async (name, input, requestOptions) => {
      if (input.operation === 'GENERATE_ISSUE_CORRECTION') {
        assert.ok(requestOptions.timeout > 0 && requestOptions.timeout <= 30 * 60_000);
      } else assert.equal(requestOptions, undefined);
      if (name === 'next_matter_assessment') return { matterId: 'MAT-c', next: { attemptRef: 'AQ-c', status: mode } };
      calls.push(input);
      if (input.operation === 'CLAIM') return { attemptRef: 'AQ-c', status: mode, task, leaseToken: 'lease', leaseGeneration: 1,
        recoveryResult: mode === 'COMMITTING' ? { modelOutput: JSON.stringify({ workRevisionRef: 'MWR-12' }) } : null };
      if (input.operation === 'GENERATE_ISSUE_CORRECTION') {
        if (failGeneration) throw new Error('ENGINEERING_CORRECTION_RESULT_UNCONFIRMED');
        return { requestId: input.requestId, persisted: true,
          producer: { kind: 'OFFICIAL_PLUGIN', instanceId: 'wl-engineering-issue-correction' } };
      }
      if (input.operation === 'SAVE_ISSUE_CORRECTION') {
        if (failSave) { failSave = false; throw new Error('save reply lost'); }
        return { workRevisionRef: 'MWR-12', workRevision: 12 };
      }
      if (input.operation === 'FINISH_ISSUE_CORRECTION') return { attemptRef: 'AQ-c', status: 'SUCCEEDED',
        workRevisionRef: badFinish ? 'MWR-other' : 'MWR-12' };
      assert.fail(`Unexpected operation ${input.operation}`);
    },
  };
  return { task, calls, run: () => consumeHostedMatter({ matterId: 'MAT-c', checkpointRoot: '/unused' }, dependencies),
    setMode: value => { mode = value; }, loseSave: () => { failSave = true; },
    blockGeneration: () => { failGeneration = true; }, wrongFinish: () => { badFinish = true; } };
}

test('explicit correction uses persisted Host generation and save, not Hosted model execution', async () => {
  const h = fixture(); const result = await h.run();
  assert.deepEqual(h.calls.map(call => call.operation), ['CLAIM', 'GENERATE_ISSUE_CORRECTION', 'SAVE_ISSUE_CORRECTION', 'FINISH_ISSUE_CORRECTION']);
  assert.equal(result.workRevisionRef, 'MWR-12'); assert.equal(result.overallReviewPending, true);
  assert.equal(result.candidateOnly, true);
});

test('a lost SAVE reply resumes through the same Host generation and save request identities', async () => {
  const h = fixture(); h.loseSave(); await assert.rejects(h.run(), /save reply lost/); await h.run();
  const generations = h.calls.filter(call => call.operation === 'GENERATE_ISSUE_CORRECTION');
  const saves = h.calls.filter(call => call.operation === 'SAVE_ISSUE_CORRECTION');
  assert.equal(generations.length, 2); assert.equal(saves.length, 2);
  assert.equal(generations[0].requestId, generations[1].requestId);
  assert.equal(saves[0].requestId, saves[1].requestId);
  assert.equal(saves[1].generationRequestId, generations[0].requestId);
});

test('unconfirmed generation never reaches SAVE or FINISH', async () => {
  const h = fixture(); h.blockGeneration(); await assert.rejects(h.run(), /RESULT_UNCONFIRMED/);
  assert.deepEqual(h.calls.map(call => call.operation), ['CLAIM', 'GENERATE_ISSUE_CORRECTION']);
});

test('COMMITTING resumes only the exact sealed work finish', async () => {
  const h = fixture(); h.setMode('COMMITTING'); assert.equal((await h.run()).workRevisionRef, 'MWR-12');
  assert.deepEqual(h.calls.map(call => call.operation), ['CLAIM', 'FINISH_ISSUE_CORRECTION']);
});

test('wrong execution route and a different finished work are rejected', async () => {
  const route = fixture(); route.task.executionModel = { modelRef: 'M3' };
  await assert.rejects(route.run(), /EXECUTION_PURPOSE_MISMATCH/);
  assert.deepEqual(route.calls.map(call => call.operation), ['CLAIM']);
  const finish = fixture(); finish.wrongFinish(); await assert.rejects(finish.run(), /FINISH_READBACK_MISMATCH/);
});

 test('expired or missing correction deadline prevents generation', async () => {
  for (const deadline of [undefined, 'invalid', '2000-01-01T00:00:00Z']) {
    const h = fixture(); h.task.deadline = deadline;
    await assert.rejects(h.run(), /DEADLINE_UNAVAILABLE/);
    assert.deepEqual(h.calls.map(call => call.operation), ['CLAIM']);
  }
});

test('SDK receives correction timeout in third argument; other operations keep defaults', async () => {
  const seen = [];
  const client = { callTool: async (...args) => { seen.push(args); return { content: [{ type: 'text', text: '{"ok":true}' }] }; } };
  await callJsonTool(client, 'matter_action_attempt', { operation: 'GENERATE_ISSUE_CORRECTION' }, { timeout: 120000 });
  assert.deepEqual(seen[0].slice(1), [undefined, { timeout: 120000 }]);
  await callJsonTool(client, 'matter_action_attempt', { operation: 'HEARTBEAT' });
  assert.equal(seen[1].length, 1);
  await assert.rejects(callJsonTool(client, 'matter_action_attempt', { operation: 'HEARTBEAT' }, { timeout: 120000 }), /OPTIONS_INVALID/);
  const lost = { callTool: async () => { throw new Error('MCP request timed out'); } };
  await assert.rejects(callJsonTool(lost, 'matter_action_attempt', { operation: 'GENERATE_ISSUE_CORRECTION' }, { timeout: 120000 }), /timed out/);
});
