#!/usr/bin/env node
import { resolve } from 'node:path';
import { createCheckpointStore } from '../skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs';
import { runDocumentSemanticTranslationStep } from '../skills/wiselink-research-and-synthesize/scripts/run-document-semantic-translation.mjs';
import { invokeHostedTranslationBlock } from '../skills/wiselink-research-and-synthesize/scripts/invoke-hosted-translation-block.mjs';

const root = resolve(process.argv[2]), mode = process.argv[3] ?? 'normal';
const host = await createCheckpointStore(resolve(root, 'host'));
const checkpoint = await createCheckpointStore(resolve(root, 'checkpoint'));
const documentVersionId = 'fixture-document-translation', parseRunId = 'fixture-parse', attemptRef = 'fixture-attempt';
const executionModel = { modelRef: 'miaoda/glm-5.3', displayName: 'GLM 5.3', providerKind: 'BUILT_IN',
  settingsRevision: 1, selectedAt: '2026-10-25T00:00:00.000Z' };
const sourceText = 'Disconnect electrical power before opening the guard.';
const block = { blockId: 'fixture-block-1', kind: 'paragraph', order: 0,
  anchorIds: ['fixture-anchor-1'], sourceStructure: [{ sourceUnitId: 'fixture-unit-1',
    kind: 'paragraph', payload: { text: sourceText } }] };
const anchor = { anchorId: 'fixture-anchor-1', sourceUnitId: 'fixture-unit-1',
  payloadPath: '/payload/text', sourceText, sourceRefIds: ['fixture-source-1'] };
const batch = { schemaVersion: 'wiselink.3_1.translation_semantic_batch.v2', purpose: 'GENERATE',
  workspaceId: 'fixture-workspace', generationRequestRef: 'fixture-generation-1',
  sourceLocale: 'en', targetLocale: 'zh-CN', blocks: [block], anchors: [anchor],
  sourcePlanBlockCount: 1, sourcePlanAnchorCount: 1,
  documentContext: { title: 'Synthetic safety note', blocks: [], anchors: [] },
  terminology: [], dependencies: {} };
const bytes = Buffer.from(JSON.stringify(batch));
const deliveryBytes = mode === 'synthetic-reordered-same-fence'
  ? Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(batch).reverse()))) : bytes;
const summary = { documentVersionId, parseRunId, attemptRef, status: 'RUNNING' };
const binding = { documentVersionId, parseRunId, attemptRef };
async function update(callback) {
  const state = await host.readOptional('state') ?? { reads: 0, saves: 0, saved: false, checks: 0,
    claimCalls: 0, registered: false, nextRequestId: null, registrationLeaseGeneration: null };
  const result = await callback(state);
  await host.write('state', state);
  return result;
}
const callTool = async (name, args) => {
  const result = await update(state => {
    if (name !== 'document_translation' || args.documentVersionId !== documentVersionId ||
        args.parseRunId !== parseRunId || args.attemptRef !== attemptRef)
      throw new Error('FIXTURE_DOCUMENT_SCOPE_MISMATCH');
    if (args.action === 'CLAIM') {
      state.claimCalls++;
      const syntheticSameFence = ['synthetic-authorized-same-fence', 'synthetic-reordered-same-fence'].includes(mode);
      if (!syntheticSameFence && mode !== 'synthetic-force-new-lease' &&
          state.claimCalls > 1 && state.registered && !state.saved)
        return { ...summary, status: 'REQUIRES_ATTENTION',
          errorCode: 'DOCUMENT_TRANSLATION_GENERATION_OUTCOME_UNKNOWN' };
      return { ...summary, fence: { attemptRef, leaseToken: 'fixture-token',
      leaseGeneration: !syntheticSameFence && state.claimCalls > 1 ? 2 : 1 }, executionModel, task: { documentVersionId, parseRunId,
      workspaceId: 'fixture-workspace', modelInput: { documentProducer: 'HOSTED_M3', workspaceId: 'fixture-workspace' },
      deadline: '2099-01-01T00:00:00.000Z' } };
    }
    if (args.action === 'HEARTBEAT') return { renewed: true, attemptRef };
    if (args.action === 'RELEASE') return { released: true, attemptRef };
    if (args.action === 'FINISH') return { ...summary, status: 'SUCCEEDED' };
    if (args.action !== 'WORKSPACE') throw new Error('FIXTURE_DOCUMENT_ACTION_INVALID');
    const command = args.workspaceCommand;
    if (command.attemptRef !== attemptRef || command.leaseToken !== 'fixture-token' ||
        command.leaseGeneration !== (['synthetic-authorized-same-fence', 'synthetic-reordered-same-fence'].includes(mode) ? 1 : state.claimCalls > 1 ? 2 : 1))
      throw new Error('FIXTURE_DOCUMENT_FENCE_MISMATCH');
    if (command.phase === 'READ') { state.reads++; return { generationRequestCount: state.registered ? 1 : 0,
      retryableFailureCount: 0, terminalFailureCode: null }; }
    if (command.phase === 'NEXT') {
      if (state.nextRequestId && command.requestId === state.nextRequestId &&
          state.registrationLeaseGeneration !== command.leaseGeneration)
        throw new Error('TRANSLATION_GENERATION_IDEMPOTENCY_CONFLICT');
      if (state.nextRequestId && command.requestId === state.nextRequestId && state.saved)
        return { action: 'REQUEST_RECONCILED', generationRequestRef: batch.generationRequestRef,
          requestStatus: 'SAVED' };
      if (state.registered && command.requestId !== state.nextRequestId && !state.saved)
        return { action: 'UNRESOLVED_GENERATION', generationRequestRef: batch.generationRequestRef };
      if (state.saved) return { action: 'DONE' };
      state.registered = true; state.nextRequestId = command.requestId;
      state.registrationLeaseGeneration = command.leaseGeneration;
      return {
      schemaVersion: 'wiselink.3_1.translation_batch_delivery.v2', action: 'GENERATE',
      workspaceId: batch.workspaceId, generationRequestRef: batch.generationRequestRef,
      blockIds: [block.blockId], delivery: { partIndex: 0, partCount: 1,
        byteLength: deliveryBytes.length, payloadBase64: deliveryBytes.toString('base64') } };
    }
    if (command.phase === 'SAVE') {
      if (state.saved) throw new Error('FIXTURE_DUPLICATE_SAVE');
      if (command.generationRequestRef !== batch.generationRequestRef ||
          command.candidates?.[0]?.blockId !== block.blockId) throw new Error('FIXTURE_SAVE_BINDING_MISMATCH');
      state.saves++; state.saved = true;
      return { generationRequestRef: batch.generationRequestRef, blocks: [{ blockId: block.blockId }] };
    }
    if (command.phase === 'RECORD_FAILURE') { state.failure = command.error; return { recorded: true }; }
    throw new Error('FIXTURE_DOCUMENT_PHASE_INVALID');
  });
  if (mode === 'after-host-save' && args.action === 'WORKSPACE' && args.workspaceCommand.phase === 'SAVE')
    process.kill(process.pid, 'SIGKILL');
  return result;
};
try {
  const result = await runDocumentSemanticTranslationStep(summary, { callTool, modelExecutor: 'CODEX',
    checkpoint: { ...checkpoint, writeOnce: async (step, value) => {
      await checkpoint.writeOnce(step, value);
      if (mode === 'after-model-started' && step.endsWith('.started')) process.kill(process.pid, 'SIGKILL');
      if (mode === 'after-model-result' && step.endsWith('.result')) process.kill(process.pid, 'SIGKILL');
      if (mode === 'before-host-save' && step.endsWith('.host-write-started')) process.kill(process.pid, 'SIGKILL');
    } },
    translate: async (input, hooks) => invokeHostedTranslationBlock(input, {
      ...hooks, modelExecutor: 'CODEX', agentId: 'wiselink-engineering', executionModel,
      codexOptions: { codexBinary: '/fixture/no-real-codex', configPath: '/fixture/no-credentials',
        runRoot: resolve(root, 'codex-runs'), pythonBinary: resolve(root, 'python-wrapper'), timeoutSeconds: 20,
        onRunCompleted: async () => { if (mode === 'after-gateway-receipt') process.kill(process.pid, 'SIGKILL'); } },
    }).catch(async error => { await host.write('model-error', { message: error.message,
      cause: error.cause?.message, nested: error.cause?.cause?.message }); throw error; }) });
  await host.write('fixture-outcome', result);
} catch (error) {
  await host.write('fixture-outcome', { errorCode: error.message, cause: error.cause?.message, stack: error.stack });
  process.exitCode = 1;
}
