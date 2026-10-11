// Explicit protocol adaptation of one already completed native activity call.
// The original HTTP wire/usage is unavailable and is never reconstructed here.
import { readFile, lstat, realpath } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { WISELINK_PROFILE_REF, canonicalJson, canonicalSha256 } from './validate-payload.mjs';
import {
  ACTIVITY_MODEL_V2_RECOVERED_USER_PREFIX, DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2,
  activityV2ProductionContract,
} from './document-activity-model-contract.mjs';
import { DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA } from './resolve-document-activity-quote-selection.mjs';

const TOOL = 'return_wiselink_activity_proposal';
const ABORT_FLAGS = ['aborted', 'externalAbort', 'idleTimedOut', 'timedOut',
  'timedOutDuringCompaction', 'timedOutDuringToolExecution'];
const fail = () => { throw new Error('ACTIVITY_NATIVE_RECOVERY_UNVERIFIED'); };
const object = value => value != null && typeof value === 'object' && !Array.isArray(value);
const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const token = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u.test(value);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const rows = text => text.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
const textContent = message => Array.isArray(message?.content) && message.content.every(part =>
  part?.type === 'text' && typeof part.text === 'string') ? message.content.map(part => part.text).join('') : null;

async function ownedFile(path) {
  if (typeof path !== 'string' || !path) fail();
  const full = resolve(path);
  const info = await lstat(full);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024 ||
      info.uid !== process.getuid?.() || await realpath(full) !== full) fail();
  const bytes = await readFile(full);
  if (bytes.length !== info.size) fail();
  return { path: full, bytes, sha256: sha(bytes) };
}

/** No lookup by "last response", no configured model fallback, no mutation of
 * arguments, no model dispatch, and no checkpoint write. The caller must first
 * reauthorize the original run and its exact source through Host READ, then
 * run the ordinary strict proposal validator before persisting this result. */
export async function recoverNativeDocumentActivityResult({ storePath, trajectoryPath, input, modelStarted, deadline }) {
  try {
    if (!object(input) || input.candidateSchemaVersion !== DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2 ||
        input.quoteSelectionSchemaVersion !== DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA ||
        !isDeepStrictEqual(input.productionContract, activityV2ProductionContract(DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA)) ||
        !/^DAR-[A-Za-z0-9-]+$/u.test(input.runRef ?? '') || !object(modelStarted) ||
        modelStarted.schemaVersion !== 'wiselink.document.activity-checkpoint.v2' || modelStarted.step !== 'model' ||
        modelStarted.candidateSchemaVersion !== DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2 ||
        modelStarted.sourceContextVersion !== input.productionContract.sourceContextVersion ||
        modelStarted.quoteTransportVersion !== input.productionContract.quoteTransportVersion ||
        modelStarted.documentVersionId !== input.documentVersionId || modelStarted.runRef !== input.runRef ||
        !instant(modelStarted.startedAt) || !instant(deadline)) fail();
    const inputHash = canonicalSha256(input);
    if (modelStarted.inputHash !== inputHash ||
        !isDeepStrictEqual(modelStarted.productionContract, input.productionContract) ||
        modelStarted.parseRunId !== input.sourceBinding?.original?.parseRunId ||
        modelStarted.semanticRevision !== input.sourceBinding?.semanticRevision) fail();
    const began = Date.parse(modelStarted.startedAt), expires = Date.parse(deadline);
    if (began >= expires) fail();
    const indexFile = await ownedFile(storePath);
    const index = JSON.parse(indexFile.bytes.toString('utf8'));
    if (!object(index)) fail();
    const sessionKey = `agent:${WISELINK_PROFILE_REF}:openai-user:activity-driver:${inputHash.slice(0, 24)}`;
    const matches = Object.entries(index).filter(([key]) => key === sessionKey || key.startsWith(`${sessionKey}:`));
    if (matches.length !== 1 || matches[0][0] !== sessionKey) fail();
    const entry = matches[0][1];
    if (!object(entry) || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(entry.sessionId ?? '') ||
        entry.status !== 'done' || entry.abortedLastRun !== false || !token(entry.modelProvider) || !token(entry.model)) fail();
    const sessionPath = join(dirname(indexFile.path), `${entry.sessionId}.jsonl`);
    if (resolve(entry.sessionFile ?? '') !== sessionPath) fail();
    const sessionFile = await ownedFile(sessionPath);
    const trajectoryFile = await ownedFile(trajectoryPath);
    if ([indexFile.path, sessionFile.path].includes(trajectoryFile.path)) fail();
    const transcript = rows(sessionFile.bytes.toString('utf8'));
    const trajectory = rows(trajectoryFile.bytes.toString('utf8'));
    if (transcript[0]?.type !== 'session' || transcript[0].id !== entry.sessionId) fail();
    const users = transcript.filter(row => row.type === 'message' && row.message?.role === 'user');
    const expectedUser = `${ACTIVITY_MODEL_V2_RECOVERED_USER_PREFIX}INPUT:\n${canonicalJson(input)}`;
    // Match the complete original INPUT, not a hash prefix or diagnostics.
    if (users.length !== 1 || textContent(users[0].message) !== expectedUser ||
        !instant(users[0].timestamp) || Date.parse(users[0].timestamp) < began) fail();
    const modelChanges = transcript.filter(row => row.type === 'model_change');
    if (modelChanges.length !== 1 || modelChanges[0].provider !== entry.modelProvider || modelChanges[0].modelId !== entry.model) fail();
    const completed = trajectory.filter(row => row.type === 'model.completed');
    const ended = trajectory.filter(row => row.type === 'session.ended');
    if (completed.length !== 1 || ended.length !== 1) fail();
    const completion = completed[0], terminal = ended[0];
    if (!token(completion.runId) || terminal.runId !== completion.runId || terminal.data?.status !== 'success' ||
        ABORT_FLAGS.some(key => completion.data?.[key] !== false || terminal.data?.[key] !== false) ||
        completion.data?.promptErrorSource !== null || completion.data?.compactionCount !== 0) fail();
    for (const event of [completion, terminal]) {
      if (event.sessionKey !== sessionKey || event.sessionId !== entry.sessionId || !instant(event.ts) ||
          Date.parse(event.ts) < began || Date.parse(event.ts) > expires) fail();
    }
    if (Date.parse(terminal.ts) < Date.parse(completion.ts)) fail();
    const assistants = transcript.filter(row => row.type === 'message' && row.message?.role === 'assistant');
    const receipts = transcript.filter(row => row.type === 'message' && row.message?.role === 'toolResult');
    if (!assistants.length || receipts.length !== assistants.length) fail();
    const accepted = [];
    for (const assistant of assistants) {
      const message = assistant.message;
      if (!token(assistant.id) || !instant(assistant.timestamp) || Date.parse(assistant.timestamp) < began ||
          Date.parse(assistant.timestamp) > Date.parse(completion.ts) || message.stopReason !== 'toolUse' ||
          message.provider !== entry.modelProvider || message.model !== entry.model || !token(message.responseId) ||
          !Array.isArray(message.content) || message.content.some(part => !['thinking', 'toolCall'].includes(part?.type))) fail();
      const calls = message.content.filter(part => part?.type === 'toolCall');
      const call = calls[0];
      if (calls.length !== 1 || call.name !== TOOL || !token(call.id) || !object(call.arguments) ||
          typeof call.partialArgs !== 'string' || !isDeepStrictEqual(JSON.parse(call.partialArgs), call.arguments)) fail();
      const matches = receipts.filter(row => row.message.toolCallId === call.id);
      if (matches.length !== 1) fail();
      const receipt = matches[0];
      if (receipt.parentId !== assistant.id || receipt.message.toolName !== TOOL ||
          transcript.indexOf(receipt) !== transcript.indexOf(assistant) + 1 ||
          !instant(receipt.timestamp) || Date.parse(receipt.timestamp) < Date.parse(assistant.timestamp) ||
          Date.parse(receipt.timestamp) > Date.parse(completion.ts)) fail();
      if (receipt.message.isError === false) {
        const delegated = JSON.parse(textContent(receipt.message) ?? 'null');
        if (!isDeepStrictEqual(delegated, { status: 'pending', tool: TOOL, message: 'Tool execution delegated to client' })) fail();
        accepted.push({ assistant, call, receipt });
      } else if (receipt.message.isError !== true ||
          !textContent(receipt.message)?.startsWith(`Validation failed for tool "${TOOL}"`)) fail();
    }
    if (accepted.length !== 1 || accepted[0].assistant !== assistants.at(-1)) fail();
    const { assistant, call } = accepted[0];
    const snapshot = completion.data.messagesSnapshot?.filter(message => message.role === 'assistant').at(-1);
    const snapshotCalls = snapshot?.content?.filter(part => part.type === 'toolCall');
    if (snapshot?.responseId !== assistant.message.responseId || snapshotCalls?.length !== 1 ||
        snapshotCalls[0].id !== call.id || snapshotCalls[0].name !== TOOL) fail();
    // If any file is still being written, do not recover a moving session.
    for (const file of [indexFile, sessionFile, trajectoryFile]) {
      if ((await ownedFile(file.path)).sha256 !== file.sha256) fail();
    }
    const modelVersion = `${entry.modelProvider}/${entry.model}`;
    return {
      proposal: call.arguments, modelVersion,
      provenance: { modelVersion, ...input.productionContract, inputHash },
      nativeRecovery: {
        schemaVersion: 'wiselink.document.activity-native-recovery.v1',
        protocolAdaptation: true, originalHttpWireRecovered: false, modelInvocations: 0,
        documentVersionId: input.documentVersionId, runRef: input.runRef, inputHash,
        startedAt: modelStarted.startedAt, deadline, sessionId: entry.sessionId, sessionKey,
        nativeRunId: completion.runId, responseId: assistant.message.responseId,
        toolCallId: call.id, completedAt: completion.ts, proposalSha256: canonicalSha256(call.arguments),
        argumentsSha256: sha(call.partialArgs), argumentsByteLength: Buffer.byteLength(call.partialArgs),
        files: [indexFile, sessionFile, trajectoryFile].map(file => ({ sha256: file.sha256, byteLength: file.bytes.length })),
      },
    };
  } catch { fail(); }
}
