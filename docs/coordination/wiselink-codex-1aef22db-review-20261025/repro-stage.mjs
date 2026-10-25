#!/usr/bin/env node
// Offline diagnostic only. Usage: node repro.mjs SOURCE_ROOT OUTPUT_ROOT normal|interrupt|recover
// Imports the delivered implementation. All Host and model effects below are synthetic files.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [sourceArg, outputArg, mode] = process.argv.slice(2);
if (!sourceArg || !outputArg || !['normal', 'interrupt', 'recover'].includes(mode))
  throw Error('USAGE: node repro.mjs SOURCE_ROOT OUTPUT_ROOT normal|interrupt|recover');
const source = resolve(sourceArg), root = resolve(outputArg);
await mkdir(root, { recursive: true });
const fromSource = async relative => import(pathToFileURL(join(source, relative)).href);
const { consumeHostedWorkItem } = await fromSource('openclaw/skills/wiselink-research-and-synthesize/scripts/consume-hosted-work-item.mjs');
const { invokeHostedInitialModel } = await fromSource('openclaw/skills/wiselink-research-and-synthesize/scripts/invoke-hosted-initial-model.mjs');
const { programRecoveryData } = await fromSource('openclaw/codex-evaluator/program-recovery-fixture.mjs');
const { canonicalSha256 } = await fromSource('openclaw/skills/wiselink-research-and-synthesize/scripts/validate-payload.mjs');
const { modelInput, work, assessmentBinding: binding } = programRecoveryData();
const statePath = join(root, 'synthetic-state.json');
let state;
try { state = JSON.parse(await readFile(statePath, 'utf8')); }
catch (e) { if (e.code !== 'ENOENT') throw e; state = { begins: 0, generations: 0, recoveries: 0, saves: 0, commits: 0, calls: [], response: null, saved: null }; }
const persist = async () => writeFile(statePath, JSON.stringify(state, null, 2) + '\n');
const remember = async (name, args) => { state.calls.push({ name, args }); await persist(); };
const responseRaw = JSON.stringify({ id: 'fixture-model-response-1', object: 'chat.completion', model: 'glm-5.3',
  choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null,
    tool_calls: [{ id: 'fixture-result-call-1', type: 'function', function: {
      name: 'return_wiselink_program_assessment', arguments: JSON.stringify({ workJson: JSON.stringify(work) }) } }] } }],
  usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } });
const executionModel = { modelRef: 'miaoda/glm-5.3', displayName: 'synthetic', providerKind: 'BUILT_IN',
  settingsRevision: 1, selectedAt: '2026-10-25T00:00:00.000Z' };
const body = { schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1', taskType: 'OPENCLAW_DYNAMIC_EVALUATION',
  actionAttemptId: binding.actionAttemptId, operationRef: binding.attemptRef, tenantId: 'synthetic-tenant',
  workItemId: binding.workItemId, documentVersionId: binding.documentVersionId, priority: 100,
  inputRevision: binding.inputRevision, baseRevision: binding.baseRevision, sourceRefs: [],
  allowedConnectors: [], hostResolvedMissingInputs: [], modelInput: { executionMode: modelInput.executionMode, modelInput },
  executionModel, deadline: '2099-01-01T00:00:00.000Z', idempotencyKey: 'synthetic-budget-stage' };
const task = { ...body, inputHash: canonicalSha256(body) };
// First Host grant is live for this process, then expires before the restart.
// The resumed begin grants a newer generation on the unchanged task.
const oldLease = state.oldLease ?? new Date(Date.now() + 1500).toISOString();
const newLease = '2099-01-01T00:00:00.000Z';
const initial = () => ({ workItemId: binding.workItemId, documentVersionId: binding.documentVersionId,
  workItemRevision: binding.baseRevision, candidateOnly: true,
  status: state.commits ? 'REQUIRED' : state.begins ? 'BUSY' : 'REQUIRED',
  nextOperation: state.commits ? 'SYNTHESIZE_OVERALL' : state.begins ? null : 'EVALUATE_JOBAID',
  stages: { translation: { status: 'SUCCEEDED' }, applicability: { status: 'WAITING_INPUT' },
    jobAid: state.commits ? { status: 'SUCCEEDED' } : state.begins
      ? { status: 'BUSY', attemptStatus: 'RUNNING', attemptRef: binding.attemptRef } : { status: 'PENDING' },
    overall: { status: 'PENDING' } } });
const projection = () => { const source = { actionAttemptId: binding.actionAttemptId,
  workRevisionRef: state.saved.workRevisionRef, workRevision: state.saved.workRevision,
  saveRequestId: state.saved.requestId, readObservedAt: '2026-10-25T00:00:00.000Z' };
  return { workItemId: binding.workItemId, workItemRevision: binding.baseRevision + 1,
    status: 'OVERALL_CANDIDATE_READY', baseRules: { workRevisionRef: state.saved.workRevisionRef },
    overallSynthesis: { status: 'CANDIDATE_ONLY', executionKind: 'DETERMINISTIC_PROJECTION',
      modelRequests: 0, basedOnJobAidWorkRevisionRef: state.saved.workRevisionRef, sourceAssessment: source } }; };
const readWork = args => ({ schemaVersion: 'wiselink.jobaid-work-read.v2', attemptId: binding.actionAttemptId,
  inputWorkRevision: 0, executionStatus: 'RUNNING', revision: !args.requestId || state.saved?.requestId === args.requestId ? state.saved : null,
  observationSequence: state.calls.filter(call => call.name === 'read_assessment_work').length });
const callTool = async (name, args) => {
  await remember(name, args);
  if (name === 'get_parse_status') return { entry: { workItemId: binding.workItemId }, initialAnalysis: initial(),
    ...(state.commits ? { integratedAssessmentSummary: projection() } : {}) };
  if (name === 'begin_dynamic_evaluation') {
    state.begins++;
    if (state.begins === 1) state.oldLease = oldLease;
    await persist();
    return { status: 'RUNNING', attemptRef: binding.attemptRef, leaseToken: `synthetic-fence-${state.begins}`,
      leaseGeneration: state.begins, leaseExpiresAt: state.begins === 1 ? oldLease : newLease,
      modelInput, task, selectedDiscoveryRefs: [] };
  }
  if (name === 'heartbeat_action_attempt') return { leaseExpiresAt: state.begins === 1 ? oldLease : newLease };
  if (name === 'record_assessment_program_progress') return { phase: args.phase, checkpointRef: args.checkpointRef };
  if (name === 'read_assessment_work') return readWork(args);
  if (name === 'save_assessment_work') {
    state.saves++;
    const command = JSON.parse(args.workJson);
    state.saved = { requestId: args.requestId, workRevisionRef: 'fixture-work-revision-1', workRevision: 1,
      actionAttemptId: binding.actionAttemptId, workItemId: binding.workItemId,
      documentVersionId: binding.documentVersionId, basedOnWorkItemRevision: binding.baseRevision,
      content: { ...command, understanding: command.overview.trim(), overviewStatus: 'CURRENT',
        issues: command.issues.map(issue => ({ ...issue, question: issue.question.trim(), body: issue.body.trim(),
          issueRef: `fixture-issue:${issue.issueKey}`, sourceDependencies: [] })) } };
    await persist();
    return { workRevisionRef: state.saved.workRevisionRef, workRevision: 1 };
  }
  if (name === 'commit_dynamic_evaluation_candidate') {
    state.commits++; await persist();
    return projection();
  }
  if (name === 'get_deep_link') return { url: 'https://example.invalid/synthetic' };
  throw Error(`FIXTURE_UNEXPECTED_HOST_TOOL:${name}`);
};
const gateway = async (_endpoint, init) => {
  if (!init.codexRecovery || init.codexRecovery.requestId !== `program:${binding.attemptRef}:round-1`)
    throw Error('FIXTURE_MODEL_REQUEST_ID_CHANGED');
  // Match the delivered program-recovery-fixture's synthetic parent-run link.
  const sha256 = value => createHash('sha256').update(value).digest('hex');
  await init.codexRecovery.onRunPrepared?.({ runRoot: root, runDirectory: join(root, 'synthetic-model'),
    requestId: init.codexRecovery.requestId,
    bindingSha256: sha256(JSON.stringify({ synthetic: true,
      requestId: init.codexRecovery.requestId, requestBody: init.body })),
    promptSha256: sha256(init.body) });
  if (!state.response) {
    if (init.codexRecovery.recoverOnly) throw Error('FIXTURE_RECOVERY_WITHOUT_RECEIPT');
    state.generations++;
    state.response = { raw: responseRaw, requestBody: init.body, requestId: init.codexRecovery.requestId };
    await persist();
    if (mode === 'interrupt') process.kill(process.pid, 'SIGKILL');
  } else {
    if (state.response.requestBody !== init.body || state.response.requestId !== init.codexRecovery.requestId)
      throw Error('FIXTURE_MODEL_BINDING_CHANGED');
    if (init.codexRecovery.recoverOnly) state.recoveries++;
    else throw Error('FIXTURE_SECOND_GENERATION_REJECTED');
    await persist();
  }
  return { status: 200, ok: true, text: async () => state.response.raw,
    codexReceipt: { requestId: state.response.requestId, runDirectory: join(root, 'synthetic-model'),
      responseSha256: createHash('sha256').update(state.response.raw).digest('hex'),
      transportSummaryRef: join(root, 'synthetic-model', 'transport-summary.json'),
      recovered: Boolean(init.codexRecovery.recoverOnly) } };
};
const options = { workItemId: binding.workItemId, checkpointRoot: join(root, 'checkpoint'), initialStageOnly: true,
  maxInitialStages: 1, expectedInitialOperation: 'EVALUATE_JOBAID', modelExecutor: 'CODEX',
  jobAidRunLimits: { modelRequests: 1, saves: 1, finishes: 1 } };
const deps = { callTool, invokeInitialModel: (input, hooks) => invokeHostedInitialModel(input,
  { modelExecutor: 'CODEX', codexOptions: { codexBinary: '/fixture/no-real-codex',
    configPath: '/fixture/no-credentials', runRoot: join(root, 'synthetic-model'),
    pythonBinary: '/fixture/runner-must-not-launch' }, ...hooks }, { requestGateway: gateway }) };
let result;
try { result = await consumeHostedWorkItem(options, deps); }
catch (error) { result = { thrown: error.message, stack: error.stack }; }
await writeFile(join(root, `${mode}-result.json`), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ mode, result, counts: { begins: state.begins, generations: state.generations,
  recoveries: state.recoveries, saves: state.saves, commits: state.commits } }));
