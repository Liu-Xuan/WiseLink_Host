import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recoverNativeDocumentActivityResult } from '../scripts/recover-native-document-activity-result.mjs';
import { nativeActivityRecoveryOptions } from '../scripts/invoke-hosted-document-activity-model.mjs';
import { ACTIVITY_MODEL_V2_RECOVERED_USER_PREFIX, activityV2ProductionContract,
  DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2 as V2 } from '../scripts/document-activity-model-contract.mjs';
import { DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA as SELECTION } from '../scripts/resolve-document-activity-quote-selection.mjs';
import { canonicalJson, canonicalSha256 } from '../scripts/validate-payload.mjs';

async function fixture(run) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'native-activity-recovery-')));
  const sessionId = '11111111-2222-3333-4444-555555555555';
  const input = { candidateSchemaVersion: V2, quoteSelectionSchemaVersion: SELECTION,
    productionContract: activityV2ProductionContract(SELECTION),
    documentVersionId: 'DV-synthetic', runRef: 'DAR-synthetic', sectionIds: ['section-one'],
    selection: { sectionIds: ['section-one'] }, sourceBinding: {
      original: { documentVersionId: 'DV-synthetic', parseRunId: 'PR-synthetic', parseRevision: 2,
        sourceArtifactId: 'SRC-synthetic', sourceSha256: 'a'.repeat(64), sourceByteLength: 100 }, semanticRevision: 1 },
    sourceContext: { synthetic: true }, units: [], anchors: [], deliveredRanges: [], sourceCoverage: { complete: false } };
  const modelStarted = { schemaVersion: 'wiselink.document.activity-checkpoint.v2', step: 'model', candidateSchemaVersion: V2,
    sourceContextVersion: input.productionContract.sourceContextVersion, quoteTransportVersion: input.productionContract.quoteTransportVersion,
    documentVersionId: input.documentVersionId, runRef: input.runRef,
    productionContract: input.productionContract, parseRunId: input.sourceBinding.original.parseRunId,
    semanticRevision: 1, inputHash: canonicalSha256(input), startedAt: '2026-10-11T06:00:00.000Z' };
  const sessionKey = `agent:wiselink-engineering:openai-user:activity-driver:${modelStarted.inputHash.slice(0, 24)}`;
  const proposal = { quoteSelectionSchemaVersion: SELECTION, schemaVersion: V2, statements: [] };
  const call = { type: 'toolCall', id: 'call-two', name: 'return_wiselink_activity_proposal',
    arguments: proposal, partialArgs: JSON.stringify(proposal, null, 2) };
  const assistant = { type: 'message', id: 'assistant-two', timestamp: '2026-10-11T06:02:00.000Z',
    message: { role: 'assistant', provider: 'synthetic-provider', model: 'synthetic-model', responseId: 'response-two',
      stopReason: 'toolUse', content: [{ type: 'thinking', thinking: 'private synthetic content, never returned' }, call] } };
  const receipt = { type: 'message', id: 'receipt-two', parentId: assistant.id, timestamp: '2026-10-11T06:02:01.000Z',
    message: { role: 'toolResult', toolName: call.name, toolCallId: call.id, isError: false,
      content: [{ type: 'text', text: JSON.stringify({ status: 'pending', tool: call.name, message: 'Tool execution delegated to client' }) }] } };
  const rejectedAssistant = structuredClone(assistant);
  Object.assign(rejectedAssistant, { id: 'assistant-one', timestamp: '2026-10-11T06:01:00.000Z' });
  rejectedAssistant.message.responseId = 'response-one';
  rejectedAssistant.message.content[1].id = 'call-one';
  const rejectedReceipt = structuredClone(receipt);
  Object.assign(rejectedReceipt, { id: 'receipt-one', parentId: 'assistant-one', timestamp: '2026-10-11T06:01:01.000Z' });
  Object.assign(rejectedReceipt.message, { toolCallId: 'call-one', isError: true,
    content: [{ type: 'text', text: `Validation failed for tool "${call.name}": missing required field` }] });
  const index = { [sessionKey]: { sessionId, sessionFile: join(directory, `${sessionId}.jsonl`),
    modelProvider: assistant.message.provider, model: assistant.message.model, abortedLastRun: false } };
  const transcript = [{ type: 'session', id: sessionId },
    { type: 'model_change', provider: assistant.message.provider, modelId: assistant.message.model },
    { type: 'message', id: 'user-one', timestamp: '2026-10-11T06:00:01.000Z', message: {
      role: 'user', content: [{ type: 'text', text: `${ACTIVITY_MODEL_V2_RECOVERED_USER_PREFIX}INPUT:\n${canonicalJson(input)}` }] } },
    rejectedAssistant, rejectedReceipt, assistant, receipt];
  const base = { sessionKey, sessionId, runId: 'run-synthetic', ts: '2026-10-11T06:02:02.000Z' };
  const trajectory = [{ ...base, type: 'model.completed', data: { messagesSnapshot: [structuredClone(assistant.message)],
    aborted: false, externalAbort: false, idleTimedOut: false, timedOut: false,
    timedOutDuringCompaction: false, timedOutDuringToolExecution: false, promptErrorSource: null, compactionCount: 0 } },
    { ...base, ts: '2026-10-11T06:02:03.000Z', type: 'session.ended', data: { status: 'success' } }];
  const options = { storePath: join(directory, 'sessions.json'), trajectoryPath: join(directory, 'trajectory.jsonl'),
    input, modelStarted, deadline: '2026-10-11T07:00:00.000Z' };
  const save = async () => {
    await writeFile(options.storePath, JSON.stringify(index));
    await writeFile(index[sessionKey].sessionFile, transcript.map(row => JSON.stringify(row)).join('\n'));
    await writeFile(options.trajectoryPath, trajectory.map(row => JSON.stringify(row)).join('\n'));
  };
  try { await save(); await run({ options, directory, index, sessionKey, transcript, trajectory, call, assistant, receipt, save }); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test('explicit adaptation returns only the unique accepted original arguments and native actual model, with zero HTTP fabrication', () => fixture(async f => {
  f.trajectory[0].data.messagesSnapshot[0].content[1].arguments = { truncated: true };
  await f.save();
  const before = await readFile(f.options.storePath);
  const result = await recoverNativeDocumentActivityResult(f.options);
  assert.deepEqual(result.proposal, f.call.arguments);
  assert.equal(result.modelVersion, 'synthetic-provider/synthetic-model');
  assert.deepEqual(result.provenance, { modelVersion: result.modelVersion, ...f.options.input.productionContract,
    inputHash: f.options.modelStarted.inputHash });
  assert.equal(result.nativeRecovery.originalHttpWireRecovered, false);
  assert.equal(result.nativeRecovery.protocolAdaptation, true);
  assert.equal(result.nativeRecovery.modelInvocations, 0);
  assert.equal(result.nativeRecovery.argumentsByteLength, Buffer.byteLength(f.call.partialArgs));
  assert.equal(JSON.stringify(result).includes('private synthetic content'), false);
  assert.equal(result.response, undefined);
  assert.equal(result.usage, undefined);
  assert.deepEqual(await readFile(f.options.storePath), before);
}));

test('native evidence rejects changed full INPUT/source/selection/pins/time, ambiguous sessions, aborts and foreign actual model', async () => {
  const changes = [
    f => f.options.input.sourceBinding.original.sourceSha256 = 'b'.repeat(64),
    f => f.options.input.selection.sectionIds.push('another-section'),
    f => f.options.input.productionContract.toolSchemaSha256 = 'c'.repeat(64),
    f => f.options.modelStarted.startedAt = '2026-10-11T06:03:00.000Z',
    f => f.options.modelStarted.schemaVersion = 'legacy-checkpoint',
    f => delete f.options.modelStarted.sourceContextVersion,
    f => f.options.deadline = '2026-10-11T06:01:00.000Z',
    f => f.index[`${f.sessionKey}:other`] = { ...f.index[f.sessionKey] },
    f => f.index[f.sessionKey].abortedLastRun = true,
    f => f.index[f.sessionKey].model = 'configured-fallback',
    f => f.transcript[1].provider = 'foreign-provider',
    f => f.transcript[2].message.content[0].text += '\nreplacement INPUT',
    f => f.transcript.push(structuredClone(f.transcript[2])),
    f => f.trajectory[0].data.externalAbort = true,
    f => delete f.trajectory[0].data.timedOutDuringToolExecution,
    f => f.trajectory[0].data.compactionCount = 1,
    f => f.trajectory[1].data.status = 'error',
    f => f.trajectory[0].sessionKey = 'another-native-session',
    f => f.trajectory.push(structuredClone(f.trajectory[0])),
  ];
  for (const change of changes) await fixture(async f => {
    change(f); await f.save(); await assert.rejects(recoverNativeDocumentActivityResult(f.options), /^Error: ACTIVITY_NATIVE_RECOVERY_UNVERIFIED$/u);
  });
});

test('native evidence rejects missing/repeated/changed delegated calls, incomplete arguments, nonfinal output and snapshot conflicts', async () => {
  for (const change of [
    f => f.call.name = 'another-tool',
    f => f.call.partialArgs = '{}',
    f => f.assistant.message.content.push(structuredClone(f.call)),
    f => f.receipt.message.isError = true,
    f => f.receipt.parentId = 'another-assistant',
    f => f.receipt.message.content[0].text = '{"status":"success"}',
    f => f.transcript.splice(-1, 1),
    f => f.transcript[4].message.isError = false,
    f => f.transcript[4].message.content[0].text = f.receipt.message.content[0].text,
    f => f.trajectory[0].data.messagesSnapshot[0].responseId = 'another-response',
    f => f.trajectory[0].data.messagesSnapshot[0].content[1].id = 'another-call',
  ]) await fixture(async f => {
    change(f); await f.save(); await assert.rejects(recoverNativeDocumentActivityResult(f.options), /ACTIVITY_NATIVE_RECOVERY_UNVERIFIED/u);
  });
});

test('owned native files reject symlink substitution and foreign session path', async () => {
  await fixture(async f => {
    const original = f.options.trajectoryPath;
    const alias = join(f.directory, 'alias.jsonl'); await symlink(original, alias);
    f.options.trajectoryPath = alias;
    await assert.rejects(recoverNativeDocumentActivityResult(f.options), /ACTIVITY_NATIVE_RECOVERY_UNVERIFIED/u);
  });
  await fixture(async f => {
    f.index[f.sessionKey].sessionFile = join(f.directory, 'foreign.jsonl'); await f.save();
    await assert.rejects(recoverNativeDocumentActivityResult(f.options), /ACTIVITY_NATIVE_RECOVERY_UNVERIFIED/u);
  });
});

test('CLI recovery requires explicit flag, original run, v2 selection and two named native files', () => {
  assert.equal(nativeActivityRecoveryOptions([]), null);
  const args = ['--recover-native-result', '--native-session-store', '/owned/sessions.json', '--native-trajectory-file', '/owned/trajectory.jsonl',
    '--activity-run-ref', 'DAR-one', '--candidate-schema-version', V2, '--exact-quote-selection'];
  assert.deepEqual(nativeActivityRecoveryOptions(args), { storePath: '/owned/sessions.json', trajectoryPath: '/owned/trajectory.jsonl' });
  for (const flag of ['--recover-native-result', '--native-session-store', '--native-trajectory-file', '--activity-run-ref', '--candidate-schema-version', '--exact-quote-selection']) {
    assert.throws(() => nativeActivityRecoveryOptions(args.filter(value => value !== flag)), /ACTIVITY_NATIVE_RECOVERY/u);
  }
  assert.throws(() => nativeActivityRecoveryOptions([...args, '--recover-native-result']), /ACTIVITY_NATIVE_RECOVERY/u);
});
