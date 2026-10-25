#!/usr/bin/env node
/** Offline, process-scoped reading consumer. The Host is a durable local fixture. */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCheckpointStore } from '../skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs';
import { consumeHostedDocumentReading } from '../skills/wiselink-research-and-synthesize/scripts/consume-hosted-document-reading.mjs';
import { invokeHostedDocumentReadingModel } from '../skills/wiselink-research-and-synthesize/scripts/invoke-hosted-document-reading-model.mjs';

const root = resolve(process.argv[2]);
const mode = process.argv[3] ?? 'normal';
const host = await createCheckpointStore(resolve(root, 'host'));
const checkpoint = await createCheckpointStore(resolve(root, 'checkpoint'));
const text = 'No approval is required except for installation.';
const documentVersionId = 'fixture-reading-dv', runRef = 'fixture-reading-run';
const executionModel = { modelRef: 'miaoda/glm-5.3', displayName: 'GLM 5.3', providerKind: 'BUILT_IN',
  settingsRevision: 1, selectedAt: '2026-10-25T00:00:00.000Z' };
const sourceBinding = { original: { documentVersionId, parseRunId: 'fixture-parse', parseRevision: 1,
  sourceArtifactId: 'fixture-artifact', sourceSha256: 'a'.repeat(64), sourceByteLength: 44 }, semanticRevision: 1 };
const unit = { unitId: 'fixture-unit', text, sourceRefIds: ['fixture-source'] };
const anchor = { anchorId: 'fixture-anchor', sourceUnitId: unit.unitId, payloadPath: '/text',
  sourceText: text, sourceRefIds: ['fixture-source'],
  sourceLocators: [{ sourceRefId: 'fixture-source', page: 1 }] };
const range = { offset: 0, unitIds: [unit.unitId], anchorIds: [anchor.anchorId], nextOffset: null };
const status = state => ({ documentVersionId, runRef, parseRunId: 'fixture-parse', semanticRevision: 1,
  expectedRevision: 0, status: state.saved ? 'SAVED' : 'QUEUED', executionModel,
  ...(state.saved ? { result: state.saved } : {}) });
async function update(callback) {
  const state = await host.readOptional('state') ?? { reads: 0, saves: 0, modelCalls: 0, saved: null };
  const result = await callback(state);
  await host.write('state', state);
  return result;
}
const callTool = async (name, args) => {
  const result = await update(state => {
  if (name !== 'document_reading' || args.documentVersionId !== documentVersionId || args.runRef !== runRef)
    throw new Error('FIXTURE_SCOPE_MISMATCH');
  if (args.action === 'READING_STATUS') { state.reads++; return status(state); }
  if (args.action === 'READING_CLAIM') return { ...status(state), status: state.saved ? 'SAVED' : 'RUNNING',
    deadline: '2099-01-01T00:00:00.000Z', fence: { leaseOwner: args.leaseOwner,
      leaseToken: '00000000-0000-4000-8000-000000000001', leaseGeneration: 1 } };
  if (args.action === 'READING_READ') return { runRef, sourceBinding,
    sourceCoverage: { unresolvedRanges: [] }, units: [unit], anchors: [anchor], range };
  if (args.action === 'READING_HEARTBEAT') return { renewed: true, runRef };
  if (args.action === 'READING_SAVE') {
    if (state.saved) throw new Error('FIXTURE_DUPLICATE_SAVE');
    state.saves++;
    state.saved = { ...args.candidate, schemaVersion: 'wiselink.document.reading.v1', candidateOnly: true,
      readingRunRef: runRef, readingRevision: 1, sourceBinding, producer: args.producer,
      readCoverage: { status: 'COMPLETE_DELIVERY' }, sourceAnchors: [anchor],
      savedAt: '2026-10-25T00:00:00.000Z' };
    return state.saved;
  }
  throw new Error('FIXTURE_UNEXPECTED_ACTION');
  });
  if (mode === 'after-host-save' && args.action === 'READING_SAVE') process.kill(process.pid, 'SIGKILL');
  return result;
};
try {
  const report = await consumeHostedDocumentReading({ documentVersionId, runRef, leaseOwner: 'fixture-owner',
    modelExecutor: 'CODEX' }, { callTool, checkpointFactory: async () => ({ ...checkpoint,
      write: async (step, value) => {
        await checkpoint.write(step, value);
        if (mode === 'after-model-started' && step === 'model.started') process.kill(process.pid, 'SIGKILL');
        if (mode === 'after-model-result' && step === 'model.result') process.kill(process.pid, 'SIGKILL');
        if (mode === 'before-save' && step === 'save.started') process.kill(process.pid, 'SIGKILL');
      } }),
    invokeModel: (input, hooks) => invokeHostedDocumentReadingModel(input, {
      ...hooks, modelExecutor: 'CODEX', executionModel,
      codexOptions: { codexBinary: '/fixture/no-real-codex', configPath: '/fixture/no-credentials',
        runRoot: resolve(root, 'codex-runs'), pythonBinary: resolve(root, 'python-wrapper'), timeoutSeconds: 20,
        onRunCompleted: async () => { if (mode === 'after-gateway-receipt') process.kill(process.pid, 'SIGKILL'); } },
    }) });
  await host.write('fixture-outcome', report);
} catch (error) {
  await host.write('fixture-outcome', { errorCode: error.message });
  process.exitCode = 1;
}
