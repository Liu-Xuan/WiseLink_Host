import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runHostedInitialStage } from '../scripts/consume-hosted-work-item.mjs';
import { initialStageCheckpointPath } from '../scripts/initial-assessment-recovery.mjs';
import { createCheckpointStore } from '../scripts/run-hosted-review-turn.mjs';
import { invokeHostedJobAidProblemModel } from '../scripts/run-jobaid-problem-assessment.mjs';

async function fixture(t) {
  const checkpointRoot = await mkdtemp(join(tmpdir(), 'wiselink-initial-observer-'));
  t.after(() => rm(checkpointRoot, { recursive: true, force: true }));
  const requestId = 'synthetic-initial-request';
  const operation = 'EVALUATE_JOBAID';
  const options = { checkpointRoot, workItemId: 'WI-observer', operation,
    initial: { workItemRevision: 3, documentVersionId: 'DV-observer', candidateOnly: true,
      status: 'BUSY', nextOperation: null, stages: {
        translation: { status: 'SUCCEEDED' }, applicability: { status: 'SUCCEEDED' },
        jobAid: { status: 'BUSY', attemptRef: 'AQ-observer', attemptStatus: 'RUNNING', requestId },
        overall: { status: 'PENDING' },
      } } };
  const directory = initialStageCheckpointPath(options, operation, requestId);
  const checkpoint = await createCheckpointStore(directory);
  const modelInput = { schemaVersion: 'wiselink.jobaid-problem-task.v2',
    purpose: 'INITIAL_PROBLEM_ASSESSMENT', methodBinding: { packRef: 'synthetic-method' },
    documentOverview: { title: 'Synthetic document', sections: [] },
    availableSources: [{ ref: 'source:synthetic:1', kind: 'DOCUMENT_PASSAGE' }],
    deliveredEvidence: [], expectedWorkRevision: 0, previousWork: null, capabilities: [] };
  const executionModel = { providerKind: 'BUILT_IN', modelRef: 'miaoda/glm-5.3',
    displayName: 'Synthetic configured model', settingsRevision: 1,
    selectedAt: '2026-01-01T00:00:00.000Z' };
  const claim = { status: 'RUNNING', attemptRef: 'AQ-observer', leaseGeneration: 1,
    leaseToken: 'synthetic-g1', leaseExpiresAt: '2099-01-01T00:00:00.000Z', modelInput,
    task: { workItemId: options.workItemId, documentVersionId: options.initial.documentVersionId,
      inputHash: 'synthetic-frozen-task', deadline: '2099-01-01T00:00:00.000Z', executionModel } };
  let activeClaim = claim;
  let finished = false;
  let pendingSaveFailed = false;
  const gatewayCalls = [];
  const toolCalls = [];
  const revisions = new Map();
  const work = roundCompletion => ({ schemaVersion: 'wiselink.jobaid-problem-work.v3',
    roundCompletion, overview: 'The synthetic source condition remains unverified externally.' });
  const steps = [
    { action: 'READ_SOURCES', sourceRefs: ['source:synthetic:1'], purpose: 'read', context: 'PAGE' },
    { action: 'SAVE_WORK', workJson: JSON.stringify(work('IN_PROGRESS')) },
    { action: 'READ_SOURCES', sourceRefs: ['source:synthetic:1'], purpose: 'read', context: 'PAGE' },
    { action: 'SAVE_WORK', workJson: JSON.stringify(work('IN_PROGRESS')) },
    { action: 'SAVE_WORK', workJson: JSON.stringify(work('IN_PROGRESS')) },
    // FINISH with work uses the same pending SAVE helper, then ends this bounded
    // regression without asking for another model round after the readback.
    { action: 'FINISH', workJson: JSON.stringify(work('COMPLETE_WITH_OPEN_QUESTIONS')) },
  ];
  const dependencies = {
    callTool: async (name, args) => {
      toolCalls.push({ name, args });
      assert.equal(args.workItemId, options.workItemId);
      if (name === 'begin_dynamic_evaluation') {
        assert.equal(args.requestId, requestId);
        return activeClaim;
      }
      if (name === 'heartbeat_action_attempt') {
        assert.equal(args.attemptRef, activeClaim.attemptRef);
        assert.equal(args.leaseGeneration, activeClaim.leaseGeneration);
        assert.equal(args.leaseToken, activeClaim.leaseToken);
        return { status: 'RUNNING', attemptRef: activeClaim.attemptRef,
          leaseExpiresAt: activeClaim.leaseExpiresAt };
      }
      if (name === 'read_assessment_sources') return { status: 'AVAILABLE', evidence: [{
        evidenceRef: 'source:synthetic:1', kind: 'DOCUMENT_PASSAGE',
        excerpt: 'An exact synthetic original condition, including its exception.',
      }] };
      if (name === 'read_assessment_work') return { revision: revisions.get(args.requestId) ?? null };
      if (name === 'save_assessment_work') {
        if (args.expectedWorkRevision === 3 && !pendingSaveFailed) {
          pendingSaveFailed = true;
          throw new Error('SYNTHETIC_SAVE_RESPONSE_LOST');
        }
        const candidate = JSON.parse(args.workJson);
        const revision = { requestId: args.requestId, workRevision: args.expectedWorkRevision + 1,
          workRevisionRef: `JAWR-synthetic-${args.expectedWorkRevision + 1}`, content: {
            ...candidate, headline: 'Synthetic engineering topic', listBrief: 'Synthetic reading copy.',
            understanding: candidate.overview, overviewStatus: 'STALE',
            readSourceRefs: ['source:synthetic:1'], issues: [],
          } };
        revisions.set(args.requestId, revision);
        return { ...revision, roundCompletion: candidate.roundCompletion };
      }
      if (name === 'cancel_action_attempt') throw new Error('SYNTHETIC_CANCEL_RESPONSE_LOST');
      if (name === 'get_parse_status') return { entry: { workItemId: options.workItemId },
        initialAnalysis: finished ? { ...options.initial, status: 'REQUIRED',
          nextOperation: 'SYNTHESIZE_OVERALL', stages: { ...options.initial.stages,
            jobAid: { status: 'SUCCEEDED' } } } : options.initial };
      assert.fail(`Unexpected isolated Host callback: ${name}`);
    },
    runInitial: async run => {
      const current = await run.callTool('begin_dynamic_evaluation', {
        workItemId: run.workItemId, requestId: run.requestId,
      });
      const result = await run.evaluateDynamicRules(current.modelInput, {
        sessionDiscriminator: 'synthetic-frozen-attempt',
        heartbeat: () => run.callTool('heartbeat_action_attempt', {
          attemptRef: current.attemptRef, leaseToken: current.leaseToken,
          leaseGeneration: current.leaseGeneration,
        }),
        readAssessmentSources: args => run.callTool('read_assessment_sources', {
          ...args, attemptRef: current.attemptRef,
        }),
        saveAssessmentWork: args => run.callTool('save_assessment_work', {
          ...args, attemptRef: current.attemptRef,
        }),
        readAssessmentWork: args => run.callTool('read_assessment_work', {
          ...args, attemptRef: current.attemptRef,
        }),
      });
      assert.equal(result.output.workRevisionRef, 'JAWR-synthetic-4');
      finished = true;
      return { outcome: 'CANDIDATE_ONLY', provenance: result.provenance };
    },
    invokeInitialModel: (input, hooks) => invokeHostedJobAidProblemModel(input, {
      ...hooks, gatewayChatCompletionsEnabled: true,
      gatewayUrl: 'http://127.0.0.1:1', gatewayToken: 'synthetic-only',
      registeredModelRefs: ['miaoda/glm-5.3'],
    }, {
      requestGateway: async (_url, request) => {
        gatewayCalls.push(JSON.parse(request.body));
        const step = steps.shift();
        assert.ok(step, 'No repeated or additional model generation is allowed');
        return new Response(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: {
          role: 'assistant', content: null, tool_calls: [{ id: `call-${gatewayCalls.length}`,
            type: 'function', function: { name: 'return_wiselink_assessment_step',
              arguments: JSON.stringify({ step }) } }],
        } }], usage: { prompt_tokens: 30, completion_tokens: 50 } }), { status: 200 });
      },
    }),
  };
  const first = () => runHostedInitialStage(options, dependencies);
  const resume = () => {
    activeClaim = { ...claim, leaseGeneration: 2, leaseToken: 'synthetic-g2' };
    return runHostedInitialStage({ ...options,
      assessmentRecovery: { status: 'RECOVERY_CANDIDATE', previousClaim: claim } }, dependencies);
  };
  return { checkpoint, directory, gatewayCalls, toolCalls, revisions, first, resume };
}

async function persistedSnapshot(directory) {
  const snapshot = new Map();
  for (const name of await readdir(directory)) {
    if (['assessment-current-claim.json', 'assessment-state.json'].includes(name)) continue;
    const path = join(directory, name);
    snapshot.set(name, { bytes: await readFile(path), mtimeNs: (await stat(path, { bigint: true })).mtimeNs });
  }
  return snapshot;
}

async function assertUnchanged(directory, snapshot) {
  for (const [name, previous] of snapshot) {
    const path = join(directory, name);
    assert.deepEqual(await readFile(path), previous.bytes, name);
    assert.equal((await stat(path, { bigint: true })).mtimeNs, previous.mtimeNs, name);
  }
}

test('initial durable round 6 resumes the same SAVE request with equal observer and no new model request', async t => {
  const f = await fixture(t);
  await assert.rejects(f.first(), /HOSTED_INITIAL_CANCEL_FAILED:SYNTHETIC_SAVE_RESPONSE_LOST:SYNTHETIC_CANCEL_RESPONSE_LOST/u);
  assert.equal(f.gatewayCalls.length, 6);
  assert.equal((await f.checkpoint.readOptional('assessment-state')).round, 6);
  const save = await f.checkpoint.readOptional('assessment-6-save');
  const before = await persistedSnapshot(f.directory);
  const callCount = f.toolCalls.length;
  const result = await f.resume();
  assert.equal(result.status, 'INITIAL_STAGE_SAVED');
  assert.equal(f.gatewayCalls.length, 6, 'all completed model responses are reused');
  await assertUnchanged(f.directory, before);
  assert.equal(await f.checkpoint.readOptional('stop-attempt.result'), null, 'unknown cancellation is not declared successful');
  assert.equal(await f.checkpoint.readOptional('model.result'), null, 'the old outer model checkpoint is not rewritten');
  const afterCalls = f.toolCalls.slice(callCount);
  assert.equal(afterCalls.filter(call => call.name === 'cancel_action_attempt').length, 0);
  const saves = f.toolCalls.filter(call => call.name === 'save_assessment_work' && call.args.expectedWorkRevision === 3);
  assert.equal(saves.length, 2, 'one original failed write and one exact request continuation');
  assert.deepEqual(saves[1].args, saves[0].args);
  assert.equal(saves[1].args.requestId, save.requestId);
  assert.equal(f.revisions.get(save.requestId).workRevision, 4);
  assert.equal(afterCalls.filter(call => call.name === 'read_assessment_work' &&
    call.args.requestId === save.requestId).length, 2, 'read the same request before SAVE and verify its exact revision afterwards');
  assert.equal((await f.checkpoint.readOptional('assessment-current-claim')).leaseGeneration, 2);
});

test('initial durable round 6 rejects one changed observer field without SAVE or checkpoint replacement', async t => {
  const f = await fixture(t);
  await assert.rejects(f.first(), /SYNTHETIC_SAVE_RESPONSE_LOST/u);
  const shape = await f.checkpoint.readOptional('model.output-shape-6');
  // Deliberately corrupt only this synthetic fixture before testing refusal.
  await f.checkpoint.write('model.output-shape-6', { ...shape, inputTokens: shape.inputTokens + 1 });
  const before = await persistedSnapshot(f.directory);
  const stateBefore = await readFile(join(f.directory, 'assessment-state.json'));
  const callCount = f.toolCalls.length;
  await assert.rejects(f.resume(), /HOSTED_INITIAL_CANCEL_FAILED:REVIEW_CHECKPOINT_VALUE_CHANGED:REVIEW_STOP-ATTEMPT_OUTCOME_UNKNOWN/u);
  assert.equal(f.gatewayCalls.length, 6);
  await assertUnchanged(f.directory, before);
  assert.deepEqual(await readFile(join(f.directory, 'assessment-state.json')), stateBefore);
  const afterCalls = f.toolCalls.slice(callCount);
  assert.equal(afterCalls.filter(call => ['save_assessment_work', 'read_assessment_work', 'cancel_action_attempt'].includes(call.name)).length, 0);
  assert.equal(await f.checkpoint.readOptional('run-result'), null);
  assert.equal(await f.checkpoint.readOptional('stop-attempt.result'), null);
});
