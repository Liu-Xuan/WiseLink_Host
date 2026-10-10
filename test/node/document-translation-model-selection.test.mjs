import assert from 'node:assert/strict';
import test from 'node:test';
import { runDocumentSemanticTranslationStep } from '../../openclaw/skills/wiselink-research-and-synthesize/scripts/run-document-semantic-translation.mjs';

function fixture(modelRef, providerKind) {
  const summary = { documentVersionId: 'DV-test', parseRunId: 'PRUN-test', attemptRef: 'DTQ-test' };
  const executionModel = { modelRef, providerKind, displayName: 'Frozen model', settingsRevision: 0,
    selectedAt: '2026-10-01T00:00:00.000Z' };
  const calls = [];
  const callTool = async (_name, args) => {
    calls.push(args);
    if (args.action === 'CLAIM') return { fence: { attemptRef: summary.attemptRef, leaseToken: 'token', leaseGeneration: 1 },
      executionModel, task: { ...summary, workspaceId: 'workspace', modelInput: { workspaceId: 'workspace', documentProducer: 'HOSTED_M3' } } };
    if (args.action === 'HEARTBEAT') return { renewed: true, attemptRef: summary.attemptRef };
    if (args.action === 'WORKSPACE' && args.workspaceCommand.phase === 'READ') return { generationRequestCount: 0, retryableFailureCount: 0 };
    if (args.action === 'WORKSPACE' && args.workspaceCommand.phase === 'NEXT') return { action: 'DONE' };
    if (args.action === 'FINISH') return { ...summary, status: 'SUCCEEDED' };
    throw new Error(`UNEXPECTED_${args.action}`);
  };
  return { summary, calls, callTool };
}
for (const [modelRef, kind] of [['miaoda/glm-5.3', 'BUILT_IN'], ['m3probe/minimax-m3', 'CUSTOM'], ['miaoda/miaoda-model-auto', 'BUILT_IN']]) {
  test(`document consumer accepts frozen ${modelRef}`, async () => {
    const f = fixture(modelRef, kind);
    assert.equal((await runDocumentSemanticTranslationStep(f.summary, { callTool: f.callTool })).status, 'SUCCEEDED');
  });
}
for (const [modelRef, kind] of [['invalid-model-ref', 'BUILT_IN'], ['miaoda/glm-5.3', 'INVALID']]) {
  test(`document consumer rejects unsupported or mismatched ${modelRef}/${kind}`, async () => {
    const f = fixture(modelRef, kind);
    await assert.rejects(runDocumentSemanticTranslationStep(f.summary, { callTool: f.callTool }), /TASK_EXECUTION_MODEL_INVALID/);
    assert.equal(f.calls.length, 1);
  });
}
