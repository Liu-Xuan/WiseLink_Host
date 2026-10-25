import 'reflect-metadata';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { OpenClawResultEnvelope, OpenClawTaskEnvelope } from '../../server/modules/action-attempt/action-attempt-envelope.types';
import type { ActionAttemptRow } from '../../server/modules/action-attempt/action-attempt.types';
import { preflightCanonicalHostOpenClawResult } from '../../server/modules/canonical-host/canonical-host-openclaw-runtime-policy';

interface Scenario {
  mode?: 'fresh' | 'recovered';
  markers: (string | null)[];
  selectedExecutor?: string;
  priorSealed?: OpenClawResultEnvelope;
}
interface Observed {
  task: OpenClawTaskEnvelope;
  result?: OpenClawResultEnvelope;
  error?: string;
  modelRequestCount?: number;
  generated: number;
  recovered: number;
  saves: number;
  persisted: number;
  phases: string[];
  priorReturnedByReference: boolean;
}

// Execute the real ESM coordinator and sealer, then pass its envelope through the
// real Host preflight below. Only workspace storage and model output are offline
// fixtures; no gateway, model process, or remote Host is invoked.
const childSource = String.raw`
import { pathToFileURL } from 'node:url';
const root = process.argv[1], options = JSON.parse(process.argv[2]);
const scripts = root + '/openclaw/skills/wiselink-research-and-synthesize/scripts/';
const { runSemanticTranslation } = await import(pathToFileURL(scripts + 'run-semantic-translation.mjs'));
const { canonicalSha256 } = await import(pathToFileURL(scripts + 'validate-payload.mjs'));
const fields = {
  schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
  actionAttemptId: 'ATT-translation-synthetic', operationRef: 'AQ-translation-synthetic',
  taskType: 'OPENCLAW_TRANSLATE', priority: 1, tenantId: 'tenant-synthetic',
  workItemId: 'WI-translation-synthetic', inputRevision: 1, baseRevision: 1,
  documentVersionId: 'dv-synthetic',
  sourceRefs: [{ ref: 'artifact://synthetic/source', sha256: '1'.repeat(64) }],
  allowedConnectors: [], hostResolvedMissingInputs: [],
  modelInput: { schemaVersion: 'wiselink.3_1.translation_task.v2', workspaceId: 'TW-synthetic' },
  executionModel: { modelRef: 'miaoda/glm-5.3', displayName: 'Synthetic model', providerKind: 'BUILT_IN',
    settingsRevision: 1, selectedAt: '2026-10-25T00:00:00.000Z' },
  deadline: '2099-01-01T00:00:00.000Z', idempotencyKey: 'synthetic-translation-key',
};
const task = { ...fields, inputHash: canonicalSha256(fields) };
const begin = { status: 'RUNNING', task, attemptRef: fields.operationRef,
  leaseToken: '00000000-0000-4000-8000-000000000001', leaseGeneration: 1 };
const observed = { task, generated: 0, recovered: 0, saves: 0, persisted: 0, phases: [],
  priorReturnedByReference: false };
let nextIndex = 0;
const ref = i => 'GEN-synthetic-' + i;
const indexFor = generationRequestRef => options.markers.findIndex((_, i) => ref(i) === generationRequestRef);
const execution = i => ({
  output: { blocks: [{ blockId: 'b1', elements: [
    { kind: 'paragraph', translatedText: '合成示例。', anchorIds: ['a1'] },
  ] }] },
  actualExecution: { modelRef: 'miaoda/glm-5.3', modelVersion: 'synthetic-actual-model' },
  provenance: { modelVersion: 'synthetic-actual-model',
    toolVersions: options.markers[i] === null ? {} : { 'model-executor': options.markers[i] },
    runMetrics: { inputUnits: 100, outputUnits: 32 } },
});
const translate = async batch => {
  if (options.mode === 'recovered') throw new Error('FIXTURE_UNEXPECTED_MODEL_CALL');
  observed.generated++;
  return execution(indexFor(batch.generationRequestRef));
};
if (options.selectedExecutor !== undefined) translate.modelExecutor = options.selectedExecutor;
translate.recoverTranslationExecution = async (generationRequestRef, clientRequestId) => {
  const i = indexFor(generationRequestRef);
  if (i < 0 || clientRequestId !== 'request-synthetic:batch-' + (i + 1))
    throw new Error('FIXTURE_RECOVERY_BINDING_CHANGED');
  observed.recovered++;
  return execution(i);
};
translate.readSealedTranslationResult = async () => options.priorSealed ?? null;
translate.persistSealedTranslationResult = async () => { observed.persisted++; };
const assembled = { schemaVersion: 'wiselink.3_1.translation_final_result.v2', workspaceId: 'TW-synthetic',
  completeness: 'COMPLETE', manifest: { workspaceId: 'TW-synthetic', planRevision: 1,
    contextRevision: 1, workspaceRowVersion: 7, blockRevisions: [
      { blockId: 'b1', blockRevisionId: 'TB-synthetic', contentRevision: 1 },
    ] },
  artifact: { storeRole: 'UnifiedArtifactStoreCandidate', ref: 'artifact://synthetic/final',
    sha256: '2'.repeat(64), byteLength: 1, mediaType: 'application/json' } };
const callTool = async (name, args) => {
  if (args.attemptRef !== begin.attemptRef || args.leaseToken !== begin.leaseToken || args.leaseGeneration !== 1)
    throw new Error('FIXTURE_FENCE_CHANGED');
  if (name === 'heartbeat_action_attempt') return { leaseExpiresAt: '2099-01-01T00:00:00.000Z' };
  if (name !== 'translation_workspace') throw new Error('FIXTURE_UNEXPECTED_TOOL');
  observed.phases.push(args.phase);
  if (args.phase === 'NEXT') {
    const i = nextIndex++;
    if (args.requestId !== 'request-synthetic:batch-' + (i + 1)) throw new Error('FIXTURE_REQUEST_CHANGED');
    if (i >= options.markers.length) return { action: 'DONE' };
    if (options.mode === 'recovered')
      return { action: 'REQUEST_RECONCILED', generationRequestRef: ref(i), requestStatus: 'SAVED' };
    const batch = { schemaVersion: 'wiselink.3_1.translation_semantic_batch.v2', purpose: 'GENERATE',
      workspaceId: 'TW-synthetic', generationRequestRef: ref(i), sourceLocale: 'en', targetLocale: 'zh-CN',
      blocks: [{ blockId: 'b1', order: 0, kind: 'paragraph', anchorIds: ['a1'],
        sourceStructure: [{ sourceUnitId: 'u1', kind: 'paragraph', payload: { text: 'Synthetic example.' } }] }],
      anchors: [{ anchorId: 'a1', sourceUnitId: 'u1', payloadPath: '/payload/text',
        sourceText: 'Synthetic example.' }], sourcePlanBlockCount: 1, sourcePlanAnchorCount: 1,
      documentContext: { title: 'Synthetic', blocks: [], anchors: [] }, terminology: [], dependencies: {} };
    const bytes = Buffer.from(JSON.stringify(batch));
    return { schemaVersion: 'wiselink.3_1.translation_batch_delivery.v2', action: 'GENERATE',
      workspaceId: batch.workspaceId, generationRequestRef: batch.generationRequestRef, blockIds: ['b1'],
      delivery: { partIndex: 0, partCount: 1, byteLength: bytes.length, payloadBase64: bytes.toString('base64') } };
  }
  if (args.phase === 'SAVE') {
    observed.saves++;
    return { generationRequestRef: args.generationRequestRef, blocks: args.candidates };
  }
  if (args.phase === 'ASSEMBLE') return assembled;
  throw new Error('FIXTURE_UNEXPECTED_PHASE_' + args.phase);
};
try {
  const output = await runSemanticTranslation({ begin, callTool, translate, requestId: 'request-synthetic' });
  Object.assign(observed, output);
  observed.priorReturnedByReference = Boolean(options.priorSealed && output.result === options.priorSealed);
} catch (error) { observed.error = error.message; }
process.stdout.write(JSON.stringify(observed));
`;

async function run(scenario: Scenario): Promise<Observed> {
  const { stdout } = await promisify(execFile)(process.execPath,
    ['--input-type=module', '-e', childSource, process.cwd(), JSON.stringify(scenario)],
    { timeout: 10_000, maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout) as Observed;
}

function preflight(observed: Observed, executor: 'HOSTED' | 'CODEX' = 'CODEX') {
  const savedExecutor = process.env.WL_MODEL_EXECUTOR;
  process.env.WL_MODEL_EXECUTOR = executor;
  const task = observed.task;
  // These are exactly the stored-row identity fields read by the real preflight.
  const row = { taskEnvelopeJson: JSON.stringify(task), attemptId: task.actionAttemptId,
    operationRef: task.operationRef, actionType: task.taskType, tenantId: task.tenantId,
    workItemId: task.workItemId, inputRevision: task.inputRevision, baseRevision: task.baseRevision,
    documentVersionId: task.documentVersionId, idempotencyKey: task.idempotencyKey,
    taskInputHash: task.inputHash } as ActionAttemptRow;
  try { return preflightCanonicalHostOpenClawResult({ row, result: observed.result }); }
  finally {
    if (savedExecutor === undefined) delete process.env.WL_MODEL_EXECUTOR;
    else process.env.WL_MODEL_EXECUTOR = savedExecutor;
  }
}

describe('semantic translation executor provenance at the Host boundary', () => {
  it.each(['fresh', 'recovered'] as const)('accepts a real CODEX envelope from %s generations', async mode => {
    const observed = await run({ mode, selectedExecutor: 'CODEX', markers: ['CODEX', 'CODEX'] });
    expect(observed.error).toBeUndefined();
    expect(observed.modelRequestCount).toBe(2);
    expect(observed.generated).toBe(mode === 'fresh' ? 2 : 0);
    expect(observed.recovered).toBe(mode === 'recovered' ? 2 : 0);
    expect(observed.saves).toBe(mode === 'fresh' ? 2 : 0);
    expect(observed.persisted).toBe(1);
    const accepted = preflight(observed).result;
    expect(accepted).toEqual(observed.result);
    expect(accepted.toolVersions).toMatchObject({ 'model-executor': 'CODEX',
      'wiselink-openclaw-engineering-assessment': '1.2.0' });
    expect(accepted.runMetrics).toMatchObject({ inputUnits: 200, outputUnits: 64 });
  });

  it('retains legacy HOSTED provenance when no executor marker is present', async () => {
    const observed = await run({ markers: [null] });
    expect(observed.error).toBeUndefined();
    expect(preflight(observed, 'HOSTED').result).toEqual(observed.result);
    expect(() => preflight(observed)).toThrow('CANONICAL_RESULT_EXECUTOR_MISMATCH');
  });

  it('keeps the trusted CODEX executor on an assembly with no new model call', async () => {
    const observed = await run({ selectedExecutor: 'CODEX', markers: [] });
    expect(observed.error).toBeUndefined();
    expect(observed.generated).toBe(0);
    expect(observed.modelRequestCount).toBe(0);
    expect(preflight(observed).result.toolVersions['model-executor']).toBe('CODEX');
  });

  describe.each(['fresh', 'recovered'] as const)('%s provenance', mode => {
    it.each([
      { markers: ['CODEX', null], selectedExecutor: 'CODEX', error: 'TRANSLATION_EXECUTOR_PROVENANCE_MISMATCH' },
      { markers: ['HOSTED', 'CODEX'], error: 'TRANSLATION_EXECUTOR_PROVENANCE_MISMATCH' },
      { markers: ['CODEX', 'UNRECOGNIZED'], selectedExecutor: 'CODEX', error: 'TRANSLATION_EXECUTOR_INVALID' },
    ])('rejects $markers before sealing or saving the invalid generation', async scenario => {
      const observed = await run({ mode, ...scenario });
      expect(observed.error).toBe(scenario.error);
      expect(observed.result).toBeUndefined();
      expect(observed.persisted).toBe(0);
      expect(observed.phases).not.toContain('ASSEMBLE');
      expect(observed.saves).toBe(mode === 'fresh' ? 1 : 0);
    });
  });

  it.each(['CODEX', 'HOSTED'] as const)('returns a sealed %s receipt without rewriting or rebranding it', async executor => {
    const original = await run({ selectedExecutor: executor, markers: [executor] });
    expect(original.error).toBeUndefined();
    expect(original.result).toBeDefined();
    const recovered = await run({ selectedExecutor: 'CODEX', markers: [], priorSealed: original.result });
    expect(recovered.error).toBeUndefined();
    expect(recovered.priorReturnedByReference).toBe(true);
    expect(JSON.stringify(recovered.result)).toBe(JSON.stringify(original.result));
    expect(recovered.result?.contentHash).toBe(original.result?.contentHash);
    expect(recovered.persisted).toBe(0);
    expect(recovered.generated).toBe(0);
    expect(recovered.saves).toBe(0);
    if (executor === 'CODEX') expect(preflight(recovered).result).toEqual(original.result);
    else expect(() => preflight(recovered)).toThrow('CANONICAL_RESULT_EXECUTOR_MISMATCH');
  });
});
