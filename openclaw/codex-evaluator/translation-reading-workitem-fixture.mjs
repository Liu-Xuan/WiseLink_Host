#!/usr/bin/env node
/** The exported WorkItem consumer and its real semantic translation driver. */
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createCheckpointStore } from '../skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs';
import { consumeHostedWorkItem } from '../skills/wiselink-research-and-synthesize/scripts/consume-hosted-work-item.mjs';
import { invokeHostedInitialModel } from '../skills/wiselink-research-and-synthesize/scripts/invoke-hosted-initial-model.mjs';
import { canonicalSha256 } from '../skills/wiselink-research-and-synthesize/scripts/validate-payload.mjs';

const root = resolve(process.argv[2]), mode = process.argv[3] ?? 'normal';
const host = await createCheckpointStore(resolve(root, 'host'));
const workItemId = 'WI-fixture-translation', documentVersionId = 'fixture-document-translation';
const requestId = 'fixture_translation_request', attemptRef = 'fixture-action-attempt';
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
const secondBatch = { ...batch, generationRequestRef: 'fixture-generation-2',
  blocks: [{ ...block, blockId: 'fixture-block-2' }] };
const secondBytes = Buffer.from(JSON.stringify(secondBatch));
const taskBody = { schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
  actionAttemptId: attemptRef, operationRef: attemptRef, taskType: 'OPENCLAW_TRANSLATE',
  priority: 1, tenantId: 'fixture-tenant', workItemId, inputRevision: 0, baseRevision: 0,
  documentVersionId, sourceRefs: [], allowedConnectors: [], hostResolvedMissingInputs: [],
  modelInput: { schemaVersion: 'wiselink.3_1.translation_task.v2', workspaceId: batch.workspaceId },
  deadline: '2099-01-01T00:00:00.000Z', idempotencyKey: 'fixture-idempotency-key', executionModel };
const task = { ...taskBody, inputHash: canonicalSha256(taskBody) };
const begin = (generation = 1) => ({ status: 'RUNNING', attemptRef, task,
  leaseToken: generation === 1 ? 'fixture-lease-one' : 'fixture-lease-two', leaseGeneration: generation,
  leaseExpiresAt: '2099-01-01T00:00:00.000Z' });
const status = state => ({ entry: { workItemId }, initialAnalysis: { candidateOnly: true,
  documentVersionId, workItemRevision: state.committed ? 1 : 0,
  status: state.committed ? 'REQUIRED' : state.started ? 'BUSY' : 'REQUIRED',
  nextOperation: state.committed ? 'EXTRACT_APPLICABILITY' : state.started ? null : 'TRANSLATE', stages: {
    translation: { status: state.committed ? 'SUCCEEDED' : state.started ? 'BUSY' : 'PENDING',
      requestId, ...(state.started ? { attemptRef, attemptStatus: 'RUNNING' } : {}) },
    applicability: { status: 'PENDING' }, jobAid: { status: 'PENDING' }, overall: { status: 'PENDING' },
  } } });
async function update(callback) {
  const state = await host.readOptional('state') ?? { started: false, beginCalls: 0, reads: 0, saves: 0,
    modelCalls: 0, registered: false, saved: false, savedSecond: false, phases: [] };
  const result = await callback(state);
  await host.write('state', state);
  return result;
}
const callTool = async (name, args) => {
  if (mode === 'before-host-save' && name === 'translation_workspace' && args.phase === 'SAVE')
    process.kill(process.pid, 'SIGKILL');
  if (mode === 'before-host-commit' && name === 'commit_translation_candidate')
    process.kill(process.pid, 'SIGKILL');
  const result = await update(state => {
    if (name === 'get_parse_status') return status(state);
    if (name === 'get_action_attempt_status') {
      state.attemptReads = (state.attemptReads ?? 0) + 1;
      const observation = { attemptRef, taskType: 'OPENCLAW_TRANSLATE',
        status: state.committed ? 'SUCCEEDED' : 'RUNNING', recoveryAvailable: false,
        projectionApplied: Boolean(state.committed),
        commitStartedAt: state.committed ? '2026-10-25T00:00:00.000Z' : null,
        terminalReason: null, resultContentHash: state.committed ? state.committedHash : null };
      if (mode === 'unsafe-commit-started') observation.commitStartedAt = '2026-10-25T00:00:00.000Z';
      if (mode === 'unsafe-commit-projected') observation.projectionApplied = true;
      if (mode === 'unsafe-commit-recoverable') observation.recoveryAvailable = true;
      if (mode === 'unsafe-commit-missing') delete observation.commitStartedAt;
      return observation;
    }
    if (name === 'begin_translation') {
      if (args.workItemId !== workItemId || args.requestId !== requestId) throw new Error('FIXTURE_BEGIN_IDENTITY_CHANGED');
      state.started = true; state.beginCalls++;
      return begin(mode === 'new-lease' && state.beginCalls > 1 ? 2 : 1);
    }
    if (name === 'heartbeat_action_attempt') return { leaseExpiresAt: '2099-01-01T00:00:00.000Z' };
    if (name === 'commit_translation_candidate') {
      if (!state.saved || (state.secondRegistered && !state.savedSecond) || state.committed)
        throw new Error('FIXTURE_COMMIT_NOT_READY');
      if (args.attemptRef !== attemptRef || args.result?.actionAttemptId !== attemptRef)
        throw new Error('FIXTURE_COMMIT_IDENTITY_CHANGED');
      state.committed = true; state.commits = (state.commits ?? 0) + 1;
      state.committedHash = args.result.contentHash;
      state.committedProvenance = { modelVersion: args.result.modelVersion,
        promptVersion: args.result.promptVersion, runMetrics: args.result.runMetrics };
      return { workItemId, workItemRevision: 1, translation: { status: 'CANDIDATE_ONLY' } };
    }
    if (name === 'get_deep_link') return { workItemId, url: 'https://fixture.invalid/work-item' };
    if (name === 'translation_workspace') {
      state.phases.push(args.phase);
      if (args.attemptRef !== attemptRef || args.leaseToken !== 'fixture-lease-one' || args.leaseGeneration !== 1)
        throw new Error('FIXTURE_WORKSPACE_FENCE_CHANGED');
      if (args.phase === 'READ') { state.reads++; return { generationRequestCount: state.registered ? 1 : 0 }; }
      if (args.phase === 'NEXT') {
        if (state.reconciledStatus && args.requestId === `${requestId}:batch-1`)
          return { action: 'REQUEST_RECONCILED', generationRequestRef: batch.generationRequestRef,
            requestStatus: state.reconciledStatus };
        if (mode === 'second-receipt' || state.secondRegistered) {
          if (args.requestId === `${requestId}:batch-2` && state.saved && !state.savedSecond) {
            state.secondRegistered = true;
            return { schemaVersion: 'wiselink.3_1.translation_batch_delivery.v2', action: 'GENERATE',
              workspaceId: secondBatch.workspaceId, generationRequestRef: secondBatch.generationRequestRef,
              blockIds: ['fixture-block-2'], delivery: { partIndex: 0, partCount: 1,
                byteLength: secondBytes.length, payloadBase64: secondBytes.toString('base64') } };
          }
          if (state.savedSecond) return { action: 'DONE' };
        }
        if (state.saved && args.requestId === `${requestId}:batch-1`)
          return { action: 'REQUEST_RECONCILED', generationRequestRef: batch.generationRequestRef,
          requestStatus: 'SAVED' };
        if (state.saved) return { action: 'DONE' };
        state.registered = true;
        return { schemaVersion: 'wiselink.3_1.translation_batch_delivery.v2', action: 'GENERATE',
          workspaceId: batch.workspaceId, generationRequestRef: batch.generationRequestRef,
          blockIds: [block.blockId], delivery: { partIndex: 0, partCount: 1,
            byteLength: bytes.length, payloadBase64: bytes.toString('base64') } };
      }
      if (args.phase === 'SAVE') {
        if (mode === 'lose-save-ack-failed' || mode === 'lose-save-ack-superseded') {
          state.reconciledStatus = mode === 'lose-save-ack-failed' ? 'FAILED' : 'SUPERSEDED';
          return { generationRequestRef: args.generationRequestRef, blocks: [] };
        }
        const second = args.generationRequestRef === secondBatch.generationRequestRef;
        if (second ? state.savedSecond : state.saved) throw new Error('FIXTURE_DUPLICATE_SAVE');
        if (args.generationRequestRef !== (second ? secondBatch.generationRequestRef : batch.generationRequestRef) ||
            args.candidates?.[0]?.blockId !== (second ? 'fixture-block-2' : block.blockId))
          throw new Error('FIXTURE_SAVE_IDENTITY_CHANGED');
        state.saves++; if (second) state.savedSecond = true; else state.saved = true;
        return { generationRequestRef: args.generationRequestRef,
          blocks: [{ blockId: second ? 'fixture-block-2' : block.blockId }] };
      }
      if (args.phase === 'RECORD_FAILURE') { state.failure = args.error; return { recorded: true }; }
      if (args.phase === 'ASSEMBLE') {
        if (!state.saved || (state.secondRegistered && !state.savedSecond))
          throw new Error('FIXTURE_ASSEMBLE_NOT_READY');
        return { schemaVersion: 'wiselink.3_1.translation_final_result.v2', workspaceId: batch.workspaceId,
          manifest: { blockRevisions: [{ blockRevisionId: 'fixture-revision-1' },
            ...(state.secondRegistered ? [{ blockRevisionId: 'fixture-revision-2' }] : [])] },
          artifact: { ref: 'fixture-artifact', sha256: 'a'.repeat(64) }, completeness: 'COMPLETE' };
      }
      throw new Error(`FIXTURE_WORKSPACE_PHASE_INVALID_${args.phase}`);
    }
    throw new Error(`FIXTURE_UNEXPECTED_TOOL_${name}`);
  });
  if (name === 'translation_workspace' && args.phase === 'SAVE' && mode === 'after-host-save')
    process.kill(process.pid, 'SIGKILL');
  if (name === 'translation_workspace' && args.phase === 'SAVE' &&
      ['lose-save-ack', 'lose-save-ack-failed', 'lose-save-ack-superseded'].includes(mode))
    throw new Error('FIXTURE_ACK_LOST');
  if (name === 'commit_translation_candidate' && mode === 'lose-commit-ack')
    throw new Error('FIXTURE_COMMIT_ACK_LOST');
  return result;
};
try {
  const result = await consumeHostedWorkItem({ workItemId, checkpointRoot: resolve(root, 'checkpoint'),
    modelExecutor: 'CODEX', initialStageOnly: true, maxInitialStages: 1 }, { callTool,
    invokeInitialModel: (request, hooks) => invokeHostedInitialModel(request, {
      ...hooks, modelExecutor: 'CODEX', agentId: 'wiselink-engineering', executionModel,
      codexOptions: { codexBinary: '/fixture/no-real-codex', configPath: '/fixture/no-credentials',
        runRoot: resolve(root, 'codex-runs'), pythonBinary: resolve(root, 'python-wrapper'), timeoutSeconds: 20,
        onRunPrepared: async () => { if (mode === 'before-codex-launch') process.kill(process.pid, 'SIGKILL'); },
        onRunCompleted: async () => {
          if (mode === 'after-gateway-receipt') process.kill(process.pid, 'SIGKILL');
          if (mode === 'second-receipt' && (await readFile(resolve(root, 'codex-runs', 'dispatch-count'), 'utf8')).trim().split('\n').length === 2)
            process.kill(process.pid, 'SIGKILL');
        } },
    }), runtimeProvenance: { modelVersion: 'fixture', promptVersion: 'fixture', skillVersion: 'fixture',
      toolVersions: { 'model-executor': 'CODEX' },
      runMetrics: { durationMs: 0, inputUnits: 0, outputUnits: 0 } } });
  await host.write('fixture-outcome', result);
} catch (error) {
  await host.write('fixture-outcome', { errorCode: error.message, cause: error.cause?.message, stack: error.stack });
  process.exitCode = 1;
}
