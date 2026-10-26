import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson, validateTaskEnvelope, validateExecutionModelSelection } from '../skills/wiselink-research-and-synthesize/scripts/validate-payload.mjs';
import { prepareProgramAgentMaterials, validateProgramAgentPolicy, assertProgramAgentMaterials } from '../skills/wiselink-research-and-synthesize/scripts/program-assessment-materials.mjs';
import { runDynamicEvaluation } from '../skills/wiselink-research-and-synthesize/scripts/orchestrate-host-mcp.mjs';
import { inspectInitialAssessmentRecovery } from '../skills/wiselink-research-and-synthesize/scripts/initial-assessment-recovery.mjs';
import { resolveProgramAgentAdapterConfig } from './program-agent-litellm-process.mjs';
import { hostTask, hostMaterials, syntheticHostFixture, sha } from './fixtures/program-agent-host-f1a.fixture.mjs';
import { loadExactHostMaterialParser } from './fixtures/program-agent-host-f1a-parser.mjs';

const hasHost = Boolean(process.env.WISELINK_HOST_F1A_SOURCE_ROOT);
const hostParser = hasHost ? await loadExactHostMaterialParser() : null;

test('exact five/seven-field selection and f1a null policy bind without rewriting old bytes', () => {
  const { schemaVersion: _schema, maxOutputTokens: _tokens, ...old } = hostTask.executionModel;
  const oldBytes = JSON.stringify(old), taskBytes = JSON.stringify(hostTask);
  assert.equal(validateExecutionModelSelection(old), old);
  assert.equal(validateTaskEnvelope(hostTask), hostTask);
  assert.deepEqual(validateProgramAgentPolicy(hostTask.modelInput.agentPolicy, hostTask.executionModel), hostTask.modelInput.agentPolicy);
  const cases = [
    value => { value.maxModelRequests = 24; }, value => { value.maxToolCalls = 64; },
    value => { value.maxModelRequests = 0; }, value => { value.maxToolCalls = 'null'; },
    value => { delete value.maxModelRequests; }, value => { value.extra = true; },
    value => { value.timeoutSeconds = 3599; }, value => { value.timeoutSeconds = 3601; },
    value => { value.maxOutputTokens = 64000; }, value => { value.maxOutputTokens = Number.MAX_SAFE_INTEGER + 1; },
  ];
  for (const change of cases) {
    const policy = structuredClone(hostTask.modelInput.agentPolicy); change(policy);
    assert.throws(() => validateProgramAgentPolicy(policy, hostTask.executionModel));
  }
  for (const selection of [old, { ...old, maxOutputTokens: 131072 },
    { ...hostTask.executionModel, settingsRevision: 0 }, { ...hostTask.executionModel, modelRef: 'other/model' },
    { ...hostTask.executionModel, maxOutputTokens: 64000 }, { ...hostTask.executionModel, extra: true }])
    assert.throws(() => validateProgramAgentPolicy(hostTask.modelInput.agentPolicy, selection));
  assert.equal(JSON.stringify(old), oldBytes); assert.equal(JSON.stringify(hostTask), taskBytes);
});

test('Native v2 materials equal the exact supplied f1a sample and preserve every private unit', async t => {
  const f = await syntheticHostFixture(t);
  const materials = await prepareProgramAgentMaterials(f.input, f.hooks());
  assert.deepEqual(materials, hostMaterials.materials);
  assertProgramAgentMaterials(materials, f.input);
  for (const change of [m => { m.directory.sources[0].title = 'extra'; },
    m => { m.sourceReads = []; }, m => { m.originalInput.programOriginal.units.pop(); },
    m => { m.deliveredEvidenceRefs.reverse(); }, m => { m.previousWorkRead = { revision: { workRevision: 1 } }; },
    m => { m.previousWorkRead = {}; }, m => { m.previousWorkRead = { revision: null }; }]) {
    const altered = structuredClone(materials); change(altered);
    assert.throws(() => assertProgramAgentMaterials(altered, f.input));
  }
  const input = structuredClone(f.input);
  input.programOriginal.units.push({ unitId: 'uncitable-private', sourceRefIds: [], payload: { text: 'Synthetic unreferenced text', unknown: [1, null] } });
  const extra = await prepareProgramAgentMaterials(input, f.hooks());
  assert.deepEqual(extra.originalInput.programOriginal.units, input.programOriginal.units);
  assert.deepEqual(extra.directory.originalUnits.at(-1), { unitId: 'uncitable-private', sourceRefIds: [] });
  assert.deepEqual(extra.deliveredEvidenceRefs, materials.deliveredEvidenceRefs);
  const previous = { workRevisionRef: 'JAWR-SYNTHETIC-PRIOR', workRevision: 1,
    content: { issues: [], overviewStatus: 'CURRENT' } };
  input.previousWork = previous;
  const exactPrevious = await prepareProgramAgentMaterials(input, { ...f.hooks(), readAssessmentWork: async args => {
    assert.deepEqual(args, { workRevisionRef: previous.workRevisionRef });
    return { revision: structuredClone(previous) };
  } });
  assertProgramAgentMaterials(exactPrevious, input);
  assert.deepEqual(exactPrevious.modelInput.previousUnderstandingAndChanges.previousWork, previous);
  assert.equal(exactPrevious.directory.previousWorkRevisionRef, previous.workRevisionRef);
  const changed = structuredClone(exactPrevious); changed.previousWorkRead.revision.content.issues.push({ issueKey: 'changed' });
  assert.throws(() => assertProgramAgentMaterials(changed, input));
});

test('exact f1a source parser accepts Native snapshot and rejects substitutions', { skip: !hasHost && 'PENDING_EXACT_HOST_SOURCE_PACKET' }, async t => {
  const f = await syntheticHostFixture(t, { parseHostSnapshot: hostParser });
  assert.deepEqual(hostParser(hostMaterials, hostTask, hostTask.modelInput), hostMaterials);
  const result = await f.run();
  assert.equal(result.status, 'INITIAL_STAGE_SAVED');
  const args = f.state.calls.find(row => row.name === 'record_assessment_program_progress').args;
  const snapshot = JSON.parse(args.materialSnapshotJson);
  assert.deepEqual(snapshot.materials, hostMaterials.materials);
  for (const change of [s => { s.materials.version = 1; }, s => { s.materials.sourceReads = []; },
    s => { s.materials.directory.sources[0].title = 'extra'; }, s => { s.modelRequest.agentPolicy.maxModelRequests = 24; },
    s => { s.modelRequest.executionModel.maxOutputTokens = 64000; },
    s => { s.modelRequest.body = JSON.stringify({ messages: [{ role: 'system' }, { role: 'user', content: 'changed' }] }); }]) {
    const altered = structuredClone(snapshot); change(altered); assert.throws(() => hostParser(altered, f.task, f.task.modelInput));
  }
  assert.equal(f.state.providerCalls, 2); assert.equal(f.state.saveCalls, 1); assert.equal(f.state.commitCalls, 1);
  assert.deepEqual(f.state.calls.filter(row => row.name === 'record_assessment_program_progress').map(row => row.args.phase), ['MATERIALS_READY', 'MODEL_RESPONSE_SAVED']);
  assert.equal(f.state.sealedResult.promptVersion, 'wiselink-jobaid-problem@v3');
  assert.equal(f.state.sealedResult.toolVersions['jobaid-problem-protocol'], '3');
  assert.equal(f.state.calls.some(row => row.name === 'begin_overall_synthesis'), false);
  assert.equal(f.status().integratedAssessmentSummary.overallSynthesis.modelRequests, 0);
  const exactReads = f.state.calls.filter(row => row.name === 'read_assessment_work' && row.args.requestId);
  assert.ok(exactReads.length >= 3); assert.ok(exactReads.every(row => row.args.requestId === f.state.saved.requestId && row.args.leaseGeneration === 1));
  t.diagnostic(JSON.stringify({ syntheticHost: true, actualHostMaterialParser: 'f1a00daeae2fd25345c2ef268a42cc97fc49cd04',
    fakeCLI: true, fakeProvider: true, providerDispatches: 2, save: 1, independentExactRead: true,
    deterministicOverall: true, stageEnd: true, realModel: false }));
});

test('null caps permit 25 recorded dispatches and 65 private tool reads without default 24/64', async t => {
  const f = await syntheticHostFixture(t, { modelCalls: 25, privateReads: 65 });
  assert.equal((await f.run()).status, 'INITIAL_STAGE_SAVED');
  const receipt = (await f.checkpoint.readOptional('program-agent-candidate.result')).value;
  assert.equal(receipt.dispatchCount, 25); assert.equal(receipt.policy.maxModelRequests, null);
  assert.equal(receipt.toolAudit.filter(row => row.name === 'read_private_units').length, 65);
  assert.equal(receipt.policy.maxToolCalls, null);
  assert.deepEqual(receipt.deliveredRefs, [f.input.availableSources[0].ref]);
  assert.ok(receipt.dispatches.every((row, index) => row.ordinal === index + 1 && row.maxOutputTokens === 131072));
  assert.equal((await readdir(join(receipt.runDirectory, 'ledger'))).filter(name => /^dispatch-\d+\.started.json$/u.test(name)).length, 25);
  assert.equal(f.state.providerCalls, 25); assert.equal(f.state.saveCalls, 1);
});

test('new policy lost SAVE ACK recovers original result and key under current fence without generation', async t => {
  const f = await syntheticHostFixture(t);
  f.state.loseSaveAck = true; f.state.hideSavedReads = 1;
  await assert.rejects(f.direct(), /SYNTHETIC_SAVE_ACK_LOST/u);
  const request = await f.checkpoint.readOptional('program-save-request');
  const response = await f.checkpoint.readOptional('program-agent-candidate.result');
  const before = canonicalJson(response);
  f.state.leaseGeneration = 2;
  const result = await f.direct();
  assert.equal(result.output.workRevisionRef, f.state.saved.workRevisionRef);
  assert.deepEqual(await f.direct(), result);
  assert.deepEqual(await f.checkpoint.readOptional('program-save-request'), request);
  assert.equal(canonicalJson(await f.checkpoint.readOptional('program-agent-candidate.result')), before);
  assert.equal(f.state.providerCalls, 2); assert.equal(f.state.saveCalls, 1);
  assert.equal(f.state.calls.filter(row => row.name === 'read_assessment_work').at(-1).args.leaseGeneration, 2);
});

test('new null policy child receipt recovers through the existing consumer after parent result interruption', async t => {
  const f = await syntheticHostFixture(t);
  const interrupted = { ...f.checkpoint, writeOnce: async (key, value) => {
    if (key === 'program-agent-candidate.result') throw new Error('SYNTHETIC_PARENT_WRITE_INTERRUPTED');
    return f.checkpoint.writeOnce(key, value);
  } };
  await assert.rejects(f.direct({ assessmentCheckpoint: interrupted }), /SYNTHETIC_PARENT_WRITE_INTERRUPTED/u);
  const run = await f.checkpoint.readOptional('program-agent-run');
  const sealed = await readFile(join(run.runDirectory, 'program-agent-binding.json'));
  const childReceipt = await readFile(join(run.runDirectory, 'program-agent-final-receipt.json'));
  await rm(join(run.runDirectory, 'codex-prompt.txt'));
  const binding = { workItemId: f.task.workItemId, documentVersionId: f.task.documentVersionId,
    operation: 'EVALUATE_JOBAID', requestId: '00000000-0000-4000-8000-000000000001', modelExecutor: 'CODEX' };
  await f.checkpoint.writeOnce('binding', binding);
  f.state.leaseExpiresAt = new Date(Date.now() - 1000).toISOString();
  await f.checkpoint.writeOnce('assessment-current-claim', f.claim());
  const initial = { ...f.status().initialAnalysis, status: 'BUSY', nextOperation: null,
    stages: { jobAid: { status: 'BUSY', attemptStatus: 'RUNNING', attemptRef: f.task.operationRef, requestId: binding.requestId } } };
  const recovery = await inspectInitialAssessmentRecovery({ checkpoint: f.checkpoint, initial,
    workItemId: f.task.workItemId, operation: 'EVALUATE_JOBAID' });
  assert.equal(recovery.modelRecovery, 'CODEX_AGENT_DURABLE_RECEIPT_ONLY');
  f.state.leaseGeneration = 2; f.state.leaseExpiresAt = f.task.deadline;
  assert.equal((await f.run({ assessmentRecovery: recovery, initial })).status, 'INITIAL_STAGE_SAVED');
  assert.deepEqual(await readFile(join(run.runDirectory, 'program-agent-binding.json')), sealed);
  assert.deepEqual(await readFile(join(run.runDirectory, 'program-agent-final-receipt.json')), childReceipt);
  assert.equal(f.state.providerCalls, 2); assert.equal(f.state.saveCalls, 1); assert.equal(f.state.commitCalls, 1);
});

test('new agent COMMITTING uses the original ResultEnvelope and original SAVE key without regeneration', async t => {
  const f = await syntheticHostFixture(t);
  f.state.failProjection = true;
  const invoke = () => runDynamicEvaluation({ workItemId: f.task.workItemId,
    callTool: f.callTool, evaluateDynamicRules: (modelInput, hooks) => f.invoke({ operation: 'EVALUATE_JOBAID', modelInput },
      { ...f.hooks(), ...hooks }) });
  const first = await invoke();
  assert.notEqual(first.status, 'INITIAL_STAGE_SAVED'); assert.equal(f.state.done, false);
  const sealed = canonicalJson(f.state.sealedResult), savedKey = f.state.saved.requestId;
  const before = f.state.calls.length;
  f.state.failProjection = false;
  const recovered = await invoke();
  assert.equal(recovered.outcome, 'COMMITTING_REPLAYED'); assert.equal(canonicalJson(f.state.sealedResult), sealed);
  const reads = f.state.calls.slice(before).filter(row => row.name === 'read_assessment_work');
  assert.equal(reads.length, 2); assert.equal(reads[1].args.requestId, savedKey);
  assert.ok(reads.every(row => row.args.leaseToken === undefined && row.args.leaseGeneration === undefined));
  assert.equal(f.state.providerCalls, 2); assert.equal(f.state.saveCalls, 1);
  assert.equal(recovered.committed.overallSynthesis.sourceAssessment.saveRequestId, savedKey);
});

for (const reason of ['lease', 'deadline']) test(`dispatch edge ${reason} after reservation prevents provider call and preserves UNKNOWN`, async t => {
  const f = await syntheticHostFixture(t, { deadlineMs: reason === 'deadline' ? 1500 : 60_000 });
  let lastFence = false;
  const heartbeat = async () => {
    const link = await f.checkpoint.readOptional('program-agent-run');
    if (!link || !existsSync(join(link.runDirectory, 'ledger/dispatch-1.started.json'))) return;
    lastFence = true;
    if (reason === 'lease') throw new Error('SYNTHETIC_LAST_FENCE_REJECTED');
    await new Promise(resolve => setTimeout(resolve, Math.max(1, Date.parse(f.task.deadline) - Date.now() + 30)));
  };
  await assert.rejects(f.direct({ heartbeat }), /PROGRAM_AGENT_OUTCOME_UNKNOWN/u);
  assert.equal(lastFence, true); assert.equal(f.state.providerCalls, 0); assert.equal(f.state.saveCalls, 0);
  const run = await f.checkpoint.readOptional('program-agent-run');
  const path = join(run.runDirectory, 'ledger/dispatch-1.started.json'), before = await readFile(path);
  await assert.rejects(f.direct(), /PROGRAM_AGENT_OUTCOME_UNKNOWN/u);
  assert.deepEqual(await readFile(path), before); assert.equal(f.state.providerCalls, 0);
});

test('configured adapter reuses exact official route and separate file secrets without catalogue budget mutation', async t => {
  const f = await syntheticHostFixture(t), path = join(f.root, 'synthetic-config.json');
  const ref = id => ({ source: 'file', provider: 'fixture', id });
  const config = { secrets: { providers: { fixture: { source: 'file', path: '/synthetic/not-read-by-fixture', mode: 'json' } } },
    models: { providers: { miaoda: { baseUrl: 'https://innerapi.aiforce.cloud/innerapi/api/v1/sgw/model/proxy',
      api: 'openai-completions', apiKey: ref('/api'), headers: { 'x-api-key': ref('/header') },
      models: [{ id: 'glm-5.3', maxTokens: 64000 }] } } } };
  await writeFile(path, JSON.stringify(config), { mode: 0o600 });
  const refs = [];
  const dependencies = { resolveSecretRefValues: async ([selected]) => {
    refs.push(selected.id); return new Map([[selected.id, selected.id === '/api' ? 'synthetic-api' : 'synthetic-header']]);
  } };
  const before = await readFile(path);
  const resolved = await resolveProgramAgentAdapterConfig({ configPath: path, pythonBinary: '/synthetic/python' }, dependencies);
  assert.deepEqual(refs, ['/api', '/header']); assert.equal(resolved.apiKey, 'synthetic-api');
  assert.equal(resolved.headers['x-api-key'], 'synthetic-header');
  assert.equal(Object.hasOwn(resolved, 'maxOutputTokens'), false);
  assert.deepEqual(await readFile(path), before);
  config.models.providers.miaoda.baseUrl = 'https://other.invalid/v1';
  await writeFile(path, JSON.stringify(config));
  await assert.rejects(resolveProgramAgentAdapterConfig({ configPath: path, pythonBinary: '/synthetic/python' }, dependencies), /PROVIDER_INVALID/u);
  assert.equal(refs.length, 2, 'route rejection occurs before resolving any secret');
});

test('new agent UNKNOWN reports the sealed candidate round without resetting its dispatch or replaying', async t => {
  const f = await syntheticHostFixture(t, { providerDispatch: async () => { throw new Error('SYNTHETIC_PROVIDER_UNKNOWN'); } });
  const result = await f.run();
  assert.equal(result.attemptStatus, 'UNKNOWN');
  assert.equal(result.consumerStoppedObservation.status, 'RECORDED');
  assert.equal(f.state.providerCalls, 1); assert.equal(f.state.saveCalls, 0); assert.equal(f.state.commitCalls, 0);
  const run = await f.checkpoint.readOptional('program-agent-run');
  const path = join(run.runDirectory, 'ledger/dispatch-1.started.json'), before = await readFile(path);
  assert.equal(await f.checkpoint.readOptional('assessment-state'), null);
  assert.equal(f.state.calls.find(row => row.name === 'record_assessment_consumer_stopped').args.modelRound, 1);
  await assert.rejects(f.run(), /INITIAL_COMPLETED_STAGE_HOST_DRIFT/u);
  assert.equal(f.state.providerCalls, 1); assert.deepEqual(await readFile(path), before);
});
