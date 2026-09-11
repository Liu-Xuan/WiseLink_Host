import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recoverNativeMatterResponse } from '../scripts/recover-native-matter-response.mjs';

async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'native-matter-recovery-'));
  const sessionId = '11111111-2222-3333-4444-555555555555';
  const sessionKey = 'agent:wiselink-engineering:openai-user:initial:aq-one:1';
  const args = { step: { action: 'READ_SOURCES', sourceRefs: ['DOCUMENT_VERSION:DV-one:page:1'], purpose: 'read', context: 'PAGE' } };
  const call = { type: 'toolCall', id: 'call-one', name: 'return_wiselink_assessment_step', arguments: args, partialArgs: JSON.stringify(args) };
  const message = { role: 'assistant', model: 'minimax-m3', responseId: 'response-one', stopReason: 'toolUse', content: [call] };
  const index = { [sessionKey]: { sessionId, sessionFile: join(directory, `${sessionId}.jsonl`), abortedLastRun: false,
    model: 'minimax-m3', modelProvider: 'miaoda' } };
  const transcript = [{ type: 'session', id: sessionId }, { type: 'message', id: 'assistant-one', message },
    { type: 'message', parentId: 'assistant-one', message: { role: 'toolResult', isError: false,
      toolName: call.name, toolCallId: call.id } }];
  const base = { sessionKey, sessionId, runId: 'run-one', ts: '2026-09-11T00:51:57.000Z' };
  const trajectory = [{ ...base, type: 'model.completed', data: { messagesSnapshot: [structuredClone(message)],
    aborted: false, externalAbort: false, idleTimedOut: false, timedOut: false, timedOutDuringCompaction: false,
    timedOutDuringToolExecution: false } }, { ...base, type: 'session.ended', data: { status: 'success' } }];
  const options = { storePath: join(directory, 'sessions.json'), attemptRef: 'AQ-one', inputHash: 'host-input',
    executionModel: { modelRef: 'miaoda/minimax-m3' }, startedAt: '2026-09-11T00:51:17.000Z' };
  const save = async () => {
    await writeFile(options.storePath, JSON.stringify(index));
    await writeFile(index[sessionKey].sessionFile, transcript.map(row => JSON.stringify(row)).join('\n'));
    await writeFile(join(directory, `${sessionId}.trajectory.jsonl`), trajectory.map(row => JSON.stringify(row)).join('\n'));
  };
  try { await save(); await run({ options, index, transcript, trajectory, call, save, sessionKey }); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test('legacy recovery adapts the complete message and ignores truncated diagnostic arguments', () => fixture(async f => {
  f.trajectory[0].data.messagesSnapshot[0].content[0].arguments = { truncated: true };
  await f.save();
  const result = await recoverNativeMatterResponse(f.options);
  const body = JSON.parse(result.response.raw);
  assert.deepEqual(JSON.parse(body.choices[0].message.tool_calls[0].function.arguments), f.call.arguments);
  assert.equal(result.sessionDiscriminator, 'AQ-one:1');
  assert.equal(result.inputHash, 'host-input');
  assert.equal(body.usage, undefined, 'unrecorded HTTP token usage is never fabricated');
}));

test('legacy recovery rejects ambiguous, aborted, mismatched or incomplete evidence', async () => {
  for (const change of [
    f => { f.index[`${f.sessionKey.slice(0, -1)}2`] = { ...f.index[f.sessionKey] }; },
    f => { f.trajectory[1].data.status = 'error'; },
    f => { f.trajectory[0].data.timedOut = true; },
    f => { f.options.executionModel.modelRef = 'dli/gpt-5.6-sol'; },
    f => { f.call.partialArgs = '{}'; },
    f => { f.call.arguments.step.action = 'SAVE_WORK'; f.call.partialArgs = JSON.stringify(f.call.arguments); },
    f => { f.transcript[2].message.isError = true; },
    f => { f.trajectory[0].sessionKey = 'foreign'; },
    f => { f.options.startedAt = '2026-09-11T00:52:00.000Z'; },
  ]) await fixture(async f => { change(f); await f.save();
    await assert.rejects(recoverNativeMatterResponse(f.options), /MATTER_NATIVE_RECOVERY_UNVERIFIED/);
  });
});
