import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { WISELINK_PROFILE_REF } from './validate-payload.mjs';

const fail = () => { throw new Error('MATTER_NATIVE_RECOVERY_UNVERIFIED'); };
async function readBounded(path) {
  if ((await stat(path)).size > 16 * 1024 * 1024) fail();
  return readFile(path, 'utf8');
}
function rows(text) { return text.split('\n').filter(line => line.trim()).map(line => JSON.parse(line)); }

/** Migration for a legacy whole-model checkpoint only. Read the actual native
 * message, independently verify its successful terminal event, and adapt its
 * READ_SOURCES call to the same response protocol. Never infer a missing result
 * from diagnostics, replay generation, or accept a save/finish from a summary. */
export async function recoverNativeMatterResponse({ storePath, attemptRef, inputHash, executionModel, startedAt }) {
  if (!/^AQ-[A-Za-z0-9-]+$/.test(attemptRef) || !inputHash || !Number.isFinite(Date.parse(startedAt))) fail();
  const directory = dirname(resolve(storePath));
  const index = JSON.parse(await readBounded(storePath));
  const prefix = `agent:${WISELINK_PROFILE_REF}:openai-user:initial:${attemptRef.toLowerCase()}:`;
  const matches = Object.entries(index).filter(([key]) => key.startsWith(prefix) && /^[1-9]\d*$/.test(key.slice(prefix.length)));
  if (matches.length !== 1) fail();
  const [sessionKey, entry] = matches[0];
  if (!/^[a-f0-9-]{36}$/.test(entry.sessionId ?? '') || entry.abortedLastRun !== false ||
      `${entry.modelProvider}/${entry.model}` !== executionModel.modelRef) fail();
  const sessionFile = join(directory, `${entry.sessionId}.jsonl`);
  if (resolve(entry.sessionFile ?? '') !== sessionFile) fail();
  const transcript = rows(await readBounded(sessionFile));
  if (transcript[0]?.type !== 'session' || transcript[0].id !== entry.sessionId) fail();
  const trajectory = rows(await readBounded(join(directory, `${entry.sessionId}.trajectory.jsonl`)));
  const completed = trajectory.filter(row => row.type === 'model.completed');
  const ended = trajectory.filter(row => row.type === 'session.ended');
  if (completed.length !== 1 || ended.length !== 1) fail();
  const completion = completed[0]; const terminal = ended[0];
  for (const event of [completion, terminal]) {
    if (event.sessionKey !== sessionKey || event.sessionId !== entry.sessionId ||
        !Number.isFinite(Date.parse(event.ts)) || Date.parse(event.ts) < Date.parse(startedAt)) fail();
  }
  if (terminal.data?.status !== 'success' || terminal.runId !== completion.runId ||
      Date.parse(terminal.ts) < Date.parse(completion.ts) ||
      ['aborted', 'externalAbort', 'idleTimedOut', 'timedOut', 'timedOutDuringCompaction', 'timedOutDuringToolExecution']
        .some(key => completion.data?.[key] !== false)) fail();
  const assistant = transcript.filter(row => row.type === 'message' && row.message?.role === 'assistant').at(-1);
  const message = assistant?.message;
  if (message?.stopReason !== 'toolUse' || message.model !== entry.model || !message.responseId ||
      !Array.isArray(message.content)) fail();
  const calls = message.content.filter(part => part.type === 'toolCall');
  const call = calls[0];
  if (calls.length !== 1 || call.name !== 'return_wiselink_assessment_step' || typeof call.id !== 'string' ||
      !call.arguments || typeof call.arguments !== 'object' || Array.isArray(call.arguments) ||
      typeof call.partialArgs !== 'string' || !isDeepStrictEqual(JSON.parse(call.partialArgs), call.arguments)) fail();
  if (Object.keys(call.arguments).length !== 1 || call.arguments.step?.action !== 'READ_SOURCES') fail();
  const snapshot = completion.data.messagesSnapshot?.filter(item => item.role === 'assistant').at(-1);
  const snapshotCalls = snapshot?.content?.filter(item => item.type === 'toolCall');
  if (snapshot?.responseId !== message.responseId || snapshotCalls?.length !== 1 ||
      snapshotCalls[0].id !== call.id || snapshotCalls[0].name !== call.name) fail();
  const receipt = transcript.find(row => row.type === 'message' && row.message?.role === 'toolResult' &&
    row.message.toolCallId === call.id);
  if (receipt?.message.isError !== false || receipt.message.toolName !== call.name || receipt.parentId !== assistant.id) fail();
  return {
    attemptRef, inputHash, sessionId: entry.sessionId, sessionKey, runId: completion.runId,
    responseId: message.responseId, completedAt: completion.ts,
    sessionDiscriminator: `${attemptRef}:${sessionKey.slice(prefix.length)}`,
    // This is a protocol adaptation of the verified message, not a claim that
    // the original HTTP body or unrecorded token usage has been recovered.
    response: { status: 200, ok: true, raw: JSON.stringify({ id: message.responseId, model: executionModel.modelRef,
      choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{
        id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      }] } }],
    }) },
  };
}
