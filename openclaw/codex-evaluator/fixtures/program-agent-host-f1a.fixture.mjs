// Exact user-supplied f1a samples plus a synthetic Host for Native seam tests.
// No Host service, credentials, real CLI/model, queue or provider registration.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCheckpointStore } from '../../skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs';
import { canonicalSha256, validateResultEnvelope } from '../../skills/wiselink-research-and-synthesize/scripts/validate-payload.mjs';
import { invokeHostedInitialModel } from '../../skills/wiselink-research-and-synthesize/scripts/invoke-hosted-initial-model.mjs';
import { runHostedInitialStage } from '../../skills/wiselink-research-and-synthesize/scripts/consume-hosted-work-item.mjs';
import { initialStageCheckpointPath } from '../../skills/wiselink-research-and-synthesize/scripts/initial-assessment-recovery.mjs';
import { programRecoveryData } from '../program-recovery-fixture.mjs';

export const sha = value => createHash('sha256').update(value).digest('hex');
const taskBytes = await readFile(new URL('./program-agent-host-f1a-task.json', import.meta.url));
const materialBytes = await readFile(new URL('./program-agent-host-f1a-materials.json', import.meta.url));
assert.equal(sha(taskBytes), '103492f4c68cdf404c1fa9e0e9ea4a81bcdee615a44af553795d2d5c110ecfac');
assert.equal(sha(materialBytes), '53f1876801902b9001d34cec6008cb7529eb02210cd9d3e3487ca04c5f555930');
export const hostTask = JSON.parse(taskBytes);
export const hostMaterials = JSON.parse(materialBytes);

export function syntheticProviderResponse(request) {
  const upstreamRequestBytes = Buffer.from(JSON.stringify({ model: 'glm-5.3', max_tokens: request.maxOutputTokens }));
  const upstreamResponseBytes = Buffer.from('data: {"choices":[{"finish_reason":"stop"}]}\n\n');
  return { responseBytes: Buffer.from('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n'),
    upstreamRequestBytes, upstreamResponseBytes, receipt: { complete: true, upstreamHttpStatus: 200,
      upstreamProtocol: 'fixture-chat-completions-sse-v1', upstreamFinishReason: 'stop',
      terminal: { schemaVersion: 'wiselink.chat-terminal-receipt.v1', basis: 'synthetic-fixture',
        seenValidTerminal: true, sdkStreamExhausted: true, rawFinishReason: 'stop', errorCode: null },
      reportedModel: 'fixture/synthetic-only', maxOutputTokens: request.maxOutputTokens,
      executionModel: request.executionModel, clientRequestSha256: request.clientRequestSha256,
      effectiveRequestSha256: request.effectiveRequestSha256,
      upstreamRequestSha256: sha(upstreamRequestBytes), upstreamResponseSha256: sha(upstreamResponseBytes) } };
}

export async function syntheticHostFixture(t, { root, modelCalls = 2, privateReads = 1, providerDispatch,
  parseHostSnapshot, deadlineMs } = {}) {
  if (!root) {
    const parent = process.env.WISELINK_PROGRAM_AGENT_TEST_ARTIFACT_ROOT ?? tmpdir();
    await mkdir(parent, { recursive: true, mode: 0o700 });
    root = await mkdtemp(join(parent, 'host-f1a-'));
    if (!process.env.WISELINK_PROGRAM_AGENT_TEST_ARTIFACT_ROOT) t?.after(() => rm(root, { recursive: true, force: true }));
    else t?.diagnostic(`synthetic artifacts: ${root}`);
  }
  const task = structuredClone(hostTask);
  if (deadlineMs !== undefined) {
    task.deadline = new Date(Date.now() + deadlineMs).toISOString();
    const { inputHash: _hash, ...unsealed } = task; task.inputHash = canonicalSha256(unsealed);
  }
  const input = task.modelInput.modelInput;
  const { work } = programRecoveryData();
  work.issues[0].body = `仅依据本轮合成来源，实际工程状态待核。[[${input.availableSources[0].ref}]]`;
  const fakeCli = join(root, 'fake-codex.mjs');
  await writeFile(fakeCli, `#!${process.execPath}
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
for await (const _ of process.stdin) {}
const config = await readFile(join(process.env.CODEX_HOME, 'config.toml'), 'utf8');
const base = config.match(/base_url = "([^"]+)"/)[1];
const post = async (url, token, data) => {
  const r = await fetch(url, {method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(data)});
  const body = await r.text(); if(!r.ok) process.exit(3); return JSON.parse(body);
};
const model = async () => {
  const r = await fetch(base+'/responses',{method:'POST',headers:{authorization:'Bearer '+process.env.WISELINK_PROGRAM_AGENT_LOCAL_TOKEN,'content-type':'application/json'},body:JSON.stringify({model:'glm-5.3',stream:true,input:[{role:'user',content:'Synthetic offline fixture.'}]})});
  await r.arrayBuffer(); if(!r.ok) process.exit(3);
};
const tool = (name,args) => post(process.env.WISELINK_ASSESSMENT_URL,process.env.WISELINK_ASSESSMENT_TOKEN,{method:'tools/call',params:{name,arguments:args}});
await model();
for (let i=0;i<${privateReads};i++) await tool('read_private_units',{unitIds:${JSON.stringify(input.programOriginal.units.map(unit => unit.unitId))}});
await tool('read_sources',{sourceRefs:${JSON.stringify([input.availableSources[0].ref])},purpose:'Verify exact synthetic source.'});
for (let i=1;i<${modelCalls};i++) await model();
const feedback=await tool('validate_candidate',{workJson:${JSON.stringify(JSON.stringify(work))}});
if(JSON.parse(feedback.content[0].text).status!=='VALID') process.exit(4);
await writeFile(process.argv[process.argv.indexOf('--output-last-message')+1],${JSON.stringify(JSON.stringify({ tool_name: 'return_wiselink_program_assessment', arguments: { workJson: JSON.stringify(work) } }))});
console.log(JSON.stringify({type:'turn.completed'}));
`, { mode: 0o700 });
  const checkpoint = await createCheckpointStore(initialStageCheckpointPath({ checkpointRoot: root,
    workItemId: task.workItemId }, 'EVALUATE_JOBAID', '00000000-0000-4000-8000-000000000001'));
  const runtime = { modelExecutor: 'CODEX', runtimeAppId: 'app_17gr74pbere',
    configuredModelVersion: 'configured-route:miaoda/glm-5.3',
    codexOptions: { codexBinary: fakeCli, runRoot: join(root, 'runs') } };
  const state = { calls: [], providerCalls: 0, saveCalls: 0, commitCalls: 0, saved: null,
    committing: false, done: false, failProjection: false, loseSaveAck: false, hideSavedReads: 0,
    leaseGeneration: 1, leaseExpiresAt: task.deadline, sealedResult: null, denyHeartbeat: false };
  const claim = () => ({ task: structuredClone(task), modelInput: structuredClone(input),
    status: state.committing ? 'COMMITTING' : 'RUNNING', attemptRef: task.operationRef,
    leaseToken: `00000000-0000-4000-8000-${String(state.leaseGeneration).padStart(12, '0')}`,
    leaseGeneration: state.leaseGeneration, leaseExpiresAt: state.leaseExpiresAt,
    ...(state.committing ? { recoveryResult: structuredClone(state.sealedResult) } : {}) });
  const projection = () => ({ workItemId: task.workItemId, workItemRevision: 6, status: 'OVERALL_CANDIDATE_READY',
    baseRules: { workRevisionRef: state.saved.workRevisionRef }, overallSynthesis: {
      status: 'CANDIDATE_ONLY', executionKind: 'DETERMINISTIC_PROJECTION', modelRequests: 0,
      candidateOnly: true, authorityLevel: 'candidate_only', adopted: false,
      basedOnJobAidWorkRevisionRef: state.saved.workRevisionRef,
      sourceAssessment: { actionAttemptId: task.actionAttemptId, workRevisionRef: state.saved.workRevisionRef,
        workRevision: state.saved.workRevision, saveRequestId: state.saved.requestId,
        readObservedAt: '2026-10-26T00:00:00.000Z' } } });
  const status = () => ({ entry: { workItemId: task.workItemId },
    ...(state.done ? { integratedAssessmentSummary: projection() } : {}), initialAnalysis: {
      workItemRevision: state.done ? 6 : 5, documentVersionId: task.documentVersionId, candidateOnly: true,
      status: state.done ? 'SUCCEEDED' : state.committing ? 'BUSY' : 'REQUIRED',
      nextOperation: state.done || state.committing ? null : 'EVALUATE_JOBAID',
      stages: { translation: { status: 'SUCCEEDED' }, applicability: { status: 'WAITING_INPUT' },
        jobAid: { status: state.done ? 'SUCCEEDED' : state.committing ? 'BUSY' : 'PENDING',
          requestId: '00000000-0000-4000-8000-000000000001', attemptRef: task.operationRef,
          ...(state.committing ? { attemptStatus: 'COMMITTING' } : {}) },
        overall: { status: state.done ? 'SUCCEEDED' : 'PENDING' } } } });
  const callTool = async (name, args) => {
    state.calls.push({ name, args: structuredClone(args) });
    if (name === 'get_parse_status') return status();
    if (name === 'get_deep_link') return { workItemId: task.workItemId };
    if (name === 'begin_dynamic_evaluation') return claim();
    const checkFence = () => {
      assert.equal(args.attemptRef, task.operationRef);
      if (args.workItemId !== undefined) assert.equal(args.workItemId, task.workItemId);
      assert.equal(args.leaseToken, claim().leaseToken); assert.equal(args.leaseGeneration, state.leaseGeneration);
    };
    if (name === 'heartbeat_action_attempt') {
      if (state.denyHeartbeat) throw new Error('SYNTHETIC_FENCE_REJECTED');
      assert.equal(args.leaseGeneration, state.leaseGeneration); return { leaseExpiresAt: state.leaseExpiresAt };
    }
    if (name === 'record_assessment_program_progress') {
      checkFence();
      if (args.phase === 'MATERIALS_READY') {
        const snapshot = JSON.parse(args.materialSnapshotJson);
        if (parseHostSnapshot) parseHostSnapshot(snapshot, task, task.modelInput);
      } else assert.equal(Object.hasOwn(args, 'materialSnapshotJson'), false);
      return { status: 'RECORDED', phase: args.phase, checkpointRef: args.checkpointRef };
    }
    if (name === 'record_assessment_consumer_stopped') {
      checkFence(); assert.equal(args.modelRound, 1); assert.equal(args.upstreamOutcome, 'UNKNOWN');
      return { status: 'RECORDED', attemptRef: task.operationRef, upstreamOutcome: 'UNKNOWN',
        replayed: false, observedAt: new Date().toISOString() };
    }
    if (name === 'read_assessment_sources') {
      checkFence(); assert.equal(args.context, 'EXACT');
      return { schemaVersion: 'wiselink.jobaid-source-read.v3', scope: 'EXACT', status: 'AVAILABLE',
        completeRequestedScope: true, sourceRefs: [...args.sourceRefs], sourceStatements: [], activityContexts: [],
        evidence: args.sourceRefs.map(ref => structuredClone(input.deliveredEvidence.find(item => item.evidenceRef === ref))) };
    }
    if (name === 'save_assessment_work') {
      checkFence(); assert.equal(state.committing, false); state.saveCalls++;
      assert.equal(args.expectedWorkRevision, 0);
      const authored = JSON.parse(args.workJson);
      state.saved = { requestId: args.requestId, workRevisionRef: 'JAWR-SYNTHETIC-F1A', workRevision: 1,
        actionAttemptId: task.actionAttemptId, workItemId: task.workItemId,
        documentVersionId: task.documentVersionId, basedOnWorkItemRevision: task.baseRevision,
        content: { ...authored, understanding: authored.overview.trim(), overviewStatus: 'CURRENT',
          issues: authored.issues.map(issue => ({ ...issue, question: issue.question.trim(), body: issue.body.trim() })) } };
      if (state.loseSaveAck) { state.loseSaveAck = false; throw new Error('SYNTHETIC_SAVE_ACK_LOST'); }
      return { workRevisionRef: state.saved.workRevisionRef, workRevision: 1 };
    }
    if (name === 'read_assessment_work') {
      if (args.requestId && !state.committing) checkFence();
      else { assert.equal(args.leaseToken, undefined); assert.equal(args.leaseGeneration, undefined); }
      let revision = state.saved && (!args.requestId || args.requestId === state.saved.requestId) ? structuredClone(state.saved) : null;
      if (revision && state.hideSavedReads > 0) { state.hideSavedReads--; revision = null; }
      return { schemaVersion: 'wiselink.jobaid-work-read.v2', attemptId: task.actionAttemptId,
        inputWorkRevision: 0, executionStatus: state.committing ? 'COMMITTING' : 'RUNNING', revision };
    }
    if (name === 'commit_dynamic_evaluation_candidate') {
      checkFence(); state.commitCalls++; validateResultEnvelope(task, args.result);
      assert.equal(args.result.promptVersion, 'wiselink-jobaid-problem@v3');
      assert.equal(args.result.toolVersions['jobaid-problem-protocol'], '3');
      if (state.sealedResult) assert.deepEqual(args.result, state.sealedResult);
      state.sealedResult = structuredClone(args.result);
      assert.equal(JSON.parse(args.result.modelOutput).workRevisionRef, state.saved.workRevisionRef);
      if (state.failProjection) { state.committing = true; throw new Error('SYNTHETIC_PROJECTION_INTERRUPTED'); }
      state.done = true; return projection();
    }
    if (name === 'get_action_attempt_status') return { attemptRef: task.operationRef, taskType: task.taskType,
      status: state.committing ? 'COMMITTING' : 'SUCCEEDED', recoveryAvailable: state.committing,
      projectionApplied: state.done, commitStartedAt: '2026-10-26T00:00:00.000Z', terminalReason: null,
      resultContentHash: state.sealedResult.contentHash, recoveryResult: structuredClone(state.sealedResult) };
    throw new Error(`UNEXPECTED_SYNTHETIC_TOOL:${name}`);
  };
  const dependencies = { providerDispatch: async request => {
    state.providerCalls++; return (providerDispatch ?? syntheticProviderResponse)(request);
  } };
  const invoke = (request, hooks) => invokeHostedInitialModel(request, { ...runtime, ...hooks }, dependencies);
  const hooks = () => {
    const current = claim(), control = { attemptRef: current.attemptRef, workItemId: task.workItemId,
      leaseToken: current.leaseToken, leaseGeneration: current.leaseGeneration };
    return { executionModel: task.executionModel, taskDeadline: task.deadline,
      agentPolicy: task.modelInput.agentPolicy, assessmentCheckpoint: checkpoint,
      sessionDiscriminator: '00000000-0000-4000-8000-000000000001',
      assessmentBinding: { attemptRef: task.operationRef, actionAttemptId: task.actionAttemptId,
        workItemId: task.workItemId, documentVersionId: task.documentVersionId,
        inputRevision: task.inputRevision, baseRevision: task.baseRevision },
      heartbeat: () => callTool('heartbeat_action_attempt', control),
      readAssessmentSources: args => callTool('read_assessment_sources', { ...args, ...control }),
      readAssessmentWork: args => callTool('read_assessment_work', { ...args, ...control }),
      saveAssessmentWork: args => callTool('save_assessment_work', { ...args, ...control }),
      recordAssessmentProgramProgress: args => callTool('record_assessment_program_progress', { ...args, ...control }) };
  };
  const direct = (overrides = {}) => invoke({ operation: 'EVALUATE_JOBAID', modelInput: input }, { ...hooks(), ...overrides });
  const run = (extra = {}) => runHostedInitialStage({ workItemId: task.workItemId, checkpointRoot: root,
    operation: 'EVALUATE_JOBAID', modelExecutor: 'CODEX', initial: status().initialAnalysis, ...extra }, {
    callTool, hasTool: async name => name === 'record_assessment_consumer_stopped', invokeInitialModel: invoke });
  return { root, task, input, work, state, runtime, checkpoint, callTool, claim, status, run, direct, hooks, invoke, dependencies };
}
