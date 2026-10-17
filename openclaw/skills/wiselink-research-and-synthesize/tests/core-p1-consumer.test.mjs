import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { consumeAutomaticWorkItemQueueTick, consumeHostedWorkItem, runHostedInitialStage } from '../scripts/consume-hosted-work-item.mjs';
import { optionalInitialStageRequest, initialStageCheckpointPath } from '../scripts/initial-assessment-recovery.mjs';
import { runDynamicEvaluation, runOverallSynthesis } from '../scripts/orchestrate-host-mcp.mjs';
import { createCheckpointStore, readHostMcpJsonResult } from '../scripts/run-hosted-review-turn.mjs';
import { canonicalSha256, sealResultEnvelope, WISELINK_SKILL_VERSION,
  WISELINK_HOST_MCP_NAME, WISELINK_HOST_MCP_VERSION } from '../scripts/validate-payload.mjs';

async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), 'wiselink-core-p1-unit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function provenance() {
  return { modelVersion: 'synthetic-configured-model', promptVersion: 'wiselink-jobaid-problem@v2',
    skillVersion: WISELINK_SKILL_VERSION,
    toolVersions: { [WISELINK_HOST_MCP_NAME]: WISELINK_HOST_MCP_VERSION, 'jobaid-problem-protocol': '2' },
    runMetrics: { durationMs: 1, inputUnits: 2, outputUnits: 3 } };
}

function beginFixture(taskType = 'OPENCLAW_DYNAMIC_EVALUATION') {
  const modelInput = { schemaVersion: 'wiselink.jobaid-problem-task.v2', expectedWorkRevision: 0,
    purpose: taskType === 'OPENCLAW_OVERALL_SYNTHESIS' ? 'OVERALL_CONSISTENCY' : 'INITIAL_PROBLEM_ASSESSMENT' };
  const body = { schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1', taskType,
    actionAttemptId: 'ATT-synthetic', operationRef: 'AQ-synthetic', tenantId: 'synthetic-tenant',
    workItemId: 'WI-synthetic', documentVersionId: 'DV-synthetic', priority: 100,
    inputRevision: 2, baseRevision: 2, sourceRefs: [], allowedConnectors: [], hostResolvedMissingInputs: [],
    modelInput: { modelInput, automaticWorkItemLease: { requestId: 'REQ-synthetic', leaseGeneration: 2 } },
    deadline: '2099-01-01T00:00:00.000Z', idempotencyKey: 'synthetic-initial' };
  return { status: 'RUNNING', attemptRef: 'AQ-synthetic', leaseToken: 'synthetic-fence', leaseGeneration: 2,
    leaseExpiresAt: '2099-01-01T00:00:00.000Z', task: { ...body, inputHash: canonicalSha256(body) },
    modelInput, selectedDiscoveryRefs: [] };
}

function initial(stages = {}) {
  return { workItemId: 'WI-synthetic', documentVersionId: 'DV-synthetic', workItemRevision: 2,
    candidateOnly: true, status: 'REQUIRED', nextOperation: 'EVALUATE_JOBAID', stages: {
      translation: { status: 'SUCCEEDED' }, applicability: { status: 'WAITING_INPUT' },
      jobAid: { status: 'PENDING' }, overall: { status: 'PENDING' }, ...stages } };
}

test('Q01 absence is initial; supplied undefined/null/numeric continuation is rejected before dispatch', async () => {
  assert.equal(optionalInitialStageRequest({}), undefined);
  assert.equal(optionalInitialStageRequest({ requestId: 'host-continuation' }), 'host-continuation');
  for (const requestId of [undefined, null, 42, '', {}, []]) {
    assert.throws(() => optionalInitialStageRequest({ requestId }), /CONTINUATION_REQUEST_INVALID/);
    for (const run of [runDynamicEvaluation, runOverallSynthesis]) {
      await assert.rejects(run({ workItemId: 'WI-synthetic', continuationRequestId: requestId,
        callTool: () => assert.fail('invalid continuation must not query or dispatch'),
        evaluateDynamicRules: () => assert.fail(), synthesizeOverall: () => assert.fail() }),
      /CONTINUATION_REQUEST_INVALID/);
    }
  }
});

test('Q01 initial checkpoint binding persists an explicit nullable identity through JSON', async t => {
  const root = await temporary(t);
  let after = false;
  const input = { checkpointRoot: root, workItemId: 'WI-synthetic', operation: 'EVALUATE_JOBAID', initial: initial() };
  const report = await runHostedInitialStage(input, {
    callTool: async name => {
      assert.equal(name, 'get_parse_status');
      return { entry: { workItemId: input.workItemId }, initialAnalysis: { ...input.initial,
        nextOperation: 'SYNTHESIZE_OVERALL', stages: { ...input.initial.stages, jobAid: { status: 'SUCCEEDED' } } } };
    },
    runInitial: async run => {
      assert.equal(Object.hasOwn(run, 'continuationRequestId'), false);
      assert.equal(Object.hasOwn(run, 'requestId'), false);
      after = true;
      return { outcome: 'CANDIDATE_ONLY' };
    },
  });
  assert.equal(after, true);
  assert.equal(report.status, 'INITIAL_STAGE_SAVED');
  const checkpoint = await createCheckpointStore(initialStageCheckpointPath(input, input.operation));
  const binding = await checkpoint.readOptional('binding');
  assert.equal(binding.requestId, null);
  assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(binding)), 'requestId'), true);
});

test('Q02/Q03 corrupt active claim is quarantined and normal Host selection can dispatch another item', async t => {
  for (const broken of ['{', JSON.stringify({ schemaVersion: 'wiselink.auto_work_item_claim.v1',
    stoppedStageRequest: { requestId: undefined } })]) {
    const root = join(await temporary(t), 'queue');
    const checkpoint = await createCheckpointStore(root);
    await writeFile(join(root, 'active-claim.json'), broken, { mode: 0o600 });
    // This unit seam serializes the single test owner; it does not test Linux flock or Host leases.
    checkpoint.withActiveClaimOwner = perform => perform();
    const inputs = [];
    const report = await consumeAutomaticWorkItemQueueTick({}, {
      checkpoint, now: () => new Date('2026-01-01T00:00:00.000Z'),
      nextWorkItem: async input => {
        inputs.push(input);
        return { status: 'CLAIMED', workItemId: 'WI-successor', requestId: 'REQ-successor',
          documentVersionId: 'DV-successor', workItemRevision: 2,
          leaseToken: '00000000-0000-4000-8000-000000000001', leaseGeneration: 2,
          leaseExpiresAt: '2099-01-01T00:00:00.000Z' };
      },
      readInitialStatus: async () => ({ ...initial(), documentVersionId: 'DV-successor', status: 'SUCCEEDED',
        nextOperation: null, stages: Object.fromEntries(['translation', 'applicability', 'jobAid', 'overall']
          .map(key => [key, { status: 'SUCCEEDED' }])) }),
      consumeWorkItem: () => assert.fail('already complete Host work must not run a model'),
      acknowledgeWorkItem: async input => ({ status: 'ACKNOWLEDGED', workItemId: input.workItemId,
        replayed: false, acknowledgedAt: '2026-01-01T00:00:00.000Z' }),
    });
    assert.deepEqual(inputs, [undefined], 'no untrusted local locator becomes a resume target');
    assert.equal(report.status, 'ACKNOWLEDGED');
    assert.equal(report.workItemId, 'WI-successor');
    assert.equal(report.localCheckpointWarnings[0].code, 'REVIEW_CHECKPOINT_QUARANTINED');
    const names = await readdir(root);
    const quarantined = names.find(name => name.startsWith('quarantine-active-claim-'));
    assert.equal(await readFile(join(root, quarantined), 'utf8'), broken);
  }
});

test('Q06 remote business result survives a failed result-cache write and exposes the local warning', async t => {
  const root = await temporary(t);
  const checkpoint = await createCheckpointStore(root);
  let writes = 0;
  const receipt = { status: 'SAVED', workRevisionRef: 'JAWR-synthetic' };
  assert.deepEqual(await checkpoint.remoteStep({ step: 'commit', args: { originalKey: 'SAVE-synthetic' },
    ambiguousCommit: true, perform: async () => {
      writes += 1;
      await mkdir(join(root, 'commit.result.json'));
      return receipt;
    } }), receipt);
  assert.equal(writes, 1);
  assert.equal(checkpoint.diagnostics[0].code, 'REVIEW_CHECKPOINT_AUXILIARY_WRITE_FAILED');
  assert.ok(await checkpoint.readOptional('commit.started'), 'unknown restart cannot drop the write intent');
  await checkpoint.observeAuxiliary('shape', { responseBytes: 10 });
  await checkpoint.observeAuxiliary('shape', { responseBytes: 11 });
  assert.deepEqual(await checkpoint.readOptional('shape'), { responseBytes: 10 }, 'old observation is retained');
  assert.equal(checkpoint.diagnostics.at(-1).code, 'REVIEW_CHECKPOINT_AUXILIARY_OBSERVATION_FAILED');
});

test('Q06 an unavailable completion log cannot reverse confirmed Host stage completion', async t => {
  const root = await temporary(t);
  const input = { checkpointRoot: root, workItemId: 'WI-synthetic', operation: 'EVALUATE_JOBAID', initial: initial() };
  const checkpoint = await createCheckpointStore(initialStageCheckpointPath(input, input.operation));
  const report = await runHostedInitialStage(input, {
    runInitial: async () => { await mkdir(join(initialStageCheckpointPath(input, input.operation), 'run-result.json'));
      return { outcome: 'CANDIDATE_ONLY' }; },
    callTool: async () => ({ entry: { workItemId: input.workItemId }, initialAnalysis: { ...input.initial,
      nextOperation: 'SYNTHESIZE_OVERALL', stages: { ...input.initial.stages, jobAid: { status: 'SUCCEEDED' } } } }),
  });
  assert.equal(report.status, 'INITIAL_STAGE_SAVED');
  assert.equal(report.localCheckpointWarnings.at(-1).code, 'REVIEW_CHECKPOINT_AUXILIARY_WRITE_FAILED');
  assert.ok(await checkpoint.readOptional('binding'));
});

test('known completed/rejected assessment failure uses existing FAILED result and commit, without cancellation', async () => {
  const begin = beginFixture();
  const calls = [];
  const failure = Object.assign(new Error('JOBAID_WORK_JSON_INVALID'), {
    terminalAssessmentFailure: { errorCode: 'JOBAID_WORK_JSON_INVALID', provenance: provenance() },
  });
  const result = await runDynamicEvaluation({ workItemId: 'WI-synthetic',
    evaluateDynamicRules: async input => {
      assert.equal(Object.hasOwn(input, 'automaticWorkItemLease'), false, 'Host-only queue binding is not model input');
      throw failure;
    },
    callTool: async (name, args) => {
      calls.push({ name, args });
      if (name === 'get_parse_status' || name === 'get_deep_link') return {};
      if (name === 'begin_dynamic_evaluation') { assert.deepEqual(args, { workItemId: 'WI-synthetic' }); return begin; }
      if (name === 'heartbeat_action_attempt') return { leaseExpiresAt: begin.leaseExpiresAt };
      if (name === 'commit_dynamic_evaluation_candidate') {
        const result = args.result;
        assert.equal(result.status, 'FAILED');
        assert.equal(result.errorCode, 'JOBAID_WORK_JSON_INVALID');
        assert.equal(result.modelOutput, null);
        return { attemptRef: begin.attemptRef, status: 'FAILED', errorCode: result.errorCode };
      }
      assert.fail(name);
    },
  });
  assert.equal(result.outcome, 'FAILED');
  assert.equal(result.errorCode, 'JOBAID_WORK_JSON_INVALID');
  assert.equal(calls.filter(call => call.name === 'commit_dynamic_evaluation_candidate').length, 1);
  assert.equal(calls.filter(call => call.name === 'cancel_action_attempt').length, 0);
  const a = sealResultEnvelope({ task: begin.task, provenance: provenance(), failureCode: failure.terminalAssessmentFailure.errorCode });
  const b = sealResultEnvelope({ task: begin.task, provenance: provenance(), failureCode: failure.terminalAssessmentFailure.errorCode });
  assert.equal(a.contentHash, b.contentHash, 'Q07 same failure preserves the exact sealed result identity');
});

test('gateway/provider uncertainty does not become a known failure or trigger cancellation', async () => {
  for (const message of ['JOBAID_GATEWAY_HTTP_502:TOOL_CHOICE_NOT_SATISFIED', 'TRANSPORT_RESPONSE_LOST']) {
    const begin = beginFixture();
    const calls = [];
    const failure = Object.assign(new Error(message), { terminalAssessmentFailure: {
      errorCode: 'JOBAID_INCOMPLETE_TERMINAL_RESPONSE', provenance: provenance() } });
    await assert.rejects(runDynamicEvaluation({ workItemId: 'WI-synthetic',
      evaluateDynamicRules: async () => { throw failure; }, callTool: async name => {
        calls.push(name);
        if (name === 'get_parse_status') return {};
        if (name === 'begin_dynamic_evaluation') return begin;
        if (name === 'heartbeat_action_attempt') return { leaseExpiresAt: begin.leaseExpiresAt };
        assert.fail(name);
      } }), new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(calls.some(name => name.startsWith('commit_') || name === 'cancel_action_attempt'), false);
  }
});

test('only the recovery proof callback permits close-only policy failure; generic model errors do not', async () => {
  for (const [run, taskType, beginTool, commitTool] of [
    [runDynamicEvaluation, 'OPENCLAW_DYNAMIC_EVALUATION', 'begin_dynamic_evaluation', 'commit_dynamic_evaluation_candidate'],
    [runOverallSynthesis, 'OPENCLAW_OVERALL_SYNTHESIS', 'begin_overall_synthesis', 'commit_overall_candidate'],
  ]) {
    const begin = beginFixture(taskType);
    let callbacks = 0, commits = 0;
    const callTool = async (name, args) => {
      if (name === 'get_parse_status') return { integratedAssessmentSummary: { baseRules: {
        schemaVersion: 'wiselink.jobaid-problem-result.v2', status: 'CANDIDATE_ONLY',
        workRevisionRef: 'JAWR-prior', workRevision: 1, roundCompletion: 'COMPLETE' } } };
      if (name === 'get_deep_link') return {};
      if (name === beginTool) return begin;
      if (name === 'heartbeat_action_attempt') return { leaseExpiresAt: begin.leaseExpiresAt };
      if (name === commitTool) {
        commits++;
        assert.equal(args.result.status, 'FAILED');
        assert.equal(args.result.errorCode, 'JOBAID_CHECKPOINT_POLICY_CHANGED');
        return { status: 'FAILED', attemptRef: begin.attemptRef, errorCode: args.result.errorCode };
      }
      assert.fail(name);
    };
    const model = () => assert.fail('the internal closure callback must not fall through to a model');
    const result = await run({ workItemId: begin.task.workItemId, evaluateDynamicRules: model, synthesizeOverall: model,
      callTool, recoverAssessmentExecution: async received => {
        callbacks++; assert.deepEqual(received, begin);
        return { failureCode: 'JOBAID_CHECKPOINT_POLICY_CHANGED', provenance: provenance() };
      } });
    assert.equal(result.outcome, 'FAILED'); assert.equal(callbacks, 1); assert.equal(commits, 1);
    for (const recovery of [async () => null, async () => { throw new Error('CLOSURE_PROOF_CHANGED'); }]) {
      commits = 0;
      await assert.rejects(run({ workItemId: begin.task.workItemId, evaluateDynamicRules: model, synthesizeOverall: model,
        callTool, recoverAssessmentExecution: recovery }), /CLOSURE_UNCONFIRMED|CLOSURE_PROOF_CHANGED/u);
      assert.equal(commits, 0);
    }
    commits = 0;
    const unproved = async () => { throw Object.assign(new Error('JOBAID_CHECKPOINT_POLICY_CHANGED'), {
      terminalAssessmentFailure: { errorCode: 'JOBAID_CHECKPOINT_POLICY_CHANGED', provenance: provenance() } }); };
    await assert.rejects(run({ workItemId: begin.task.workItemId, evaluateDynamicRules: unproved, synthesizeOverall: unproved,
      callTool }), /JOBAID_CHECKPOINT_POLICY_CHANGED/u);
    assert.equal(commits, 0, 'the public error code alone cannot authorize a FAILED result');
  }
});

function savedReconciliationBegin() {
  const begin = beginFixture();
  const revision = { workRevisionRef: 'JAWR-saved', workRevision: 4, requestId: 'JA-save-original',
    actionAttemptId: 'ATT-original-analysis', workItemId: begin.task.workItemId,
    documentVersionId: begin.task.documentVersionId, basedOnWorkItemRevision: begin.task.baseRevision,
    content: { roundCompletion: 'COMPLETE', understanding: 'Synthetic saved complete analysis.', issues: [] } };
  const marker = { executionKind: 'HOST_SAVED_WORK_RECONCILIATION', modelRequests: 0,
    workRevisionRef: revision.workRevisionRef, workRevision: revision.workRevision,
    sourceActionAttemptId: revision.actionAttemptId };
  const { inputHash: _oldHash, ...body } = begin.task;
  body.modelInput = { ...body.modelInput, previousWork: revision, savedWorkReconciliation: marker,
    schemaVersion: begin.modelInput.schemaVersion };
  begin.task = { ...body, inputHash: canonicalSha256(body) };
  return { begin, revision, marker };
}

test('Q08 only Host sealed saved-work marker permits zero-model FINISH after latest and original SAVE-key queries', async () => {
  const { begin, revision, marker } = savedReconciliationBegin();
  const reads = [];
  let sealed;
  const result = await runDynamicEvaluation({ workItemId: begin.task.workItemId,
    evaluateDynamicRules: () => assert.fail('Host saved-work bridge must make zero model requests'),
    recoverAssessmentExecution: () => assert.fail('the sealed complete-work bridge takes priority over close-only failure'),
    callTool: async (name, args) => {
      if (name === 'get_parse_status' || name === 'get_deep_link') return {};
      if (name === 'begin_dynamic_evaluation') return begin;
      if (name === 'heartbeat_action_attempt') return { leaseExpiresAt: begin.leaseExpiresAt };
      if (name === 'read_assessment_work') {
        reads.push(args);
        return { schemaVersion: 'wiselink.jobaid-work-read.v2', attemptId: begin.task.actionAttemptId,
          inputWorkRevision: 4, revision, executionStatus: 'RUNNING' };
      }
      if (name === 'commit_dynamic_evaluation_candidate') {
        sealed = args.result;
        return { workItemId: begin.task.workItemId, workItemRevision: 3, status: 'BASE_RULE_CANDIDATE_READY',
          executionKind: 'HOST_SAVED_WORK_RECONCILIATION', modelRequests: 0 };
      }
      assert.fail(name);
    },
  });
  assert.deepEqual(reads, [{ attemptRef: begin.attemptRef },
    { attemptRef: begin.attemptRef, requestId: revision.requestId }]);
  assert.equal(sealed.modelVersion, null);
  assert.equal(sealed.modelRequests, 0);
  assert.equal(sealed.executionKind, marker.executionKind);
  assert.deepEqual(sealed.sourceWork, { workRevisionRef: revision.workRevisionRef,
    sourceActionAttemptId: revision.actionAttemptId });
  assert.deepEqual(JSON.parse(sealed.modelOutput), { workRevisionRef: revision.workRevisionRef });
  assert.equal(sealed.runMetrics.inputUnits, 0);
  assert.equal(sealed.runMetrics.outputUnits, 0);
  assert.equal(result.provenance.modelVersion, null);
  assert.equal(result.provenance.modelRequests, 0);
  assert.equal(result.modelRequests, 0);
  assert.equal(result.executionKind, marker.executionKind);
});

test('Q08 saved-work bridge rejects missing/original-key mismatch, partial work and current authorization failures without a model or SAVE', async () => {
  for (const mutation of ['missingOriginal', 'wrongOriginal', 'partial', 'revoked']) {
    const { begin, revision } = savedReconciliationBegin();
    const calls = [];
    await assert.rejects(runDynamicEvaluation({ workItemId: begin.task.workItemId,
      evaluateDynamicRules: () => assert.fail('invalid Host recovery never falls through to a model'),
      callTool: async (name, args) => {
        calls.push(name);
        if (name === 'get_parse_status') return {};
        if (name === 'begin_dynamic_evaluation') return begin;
        if (name === 'heartbeat_action_attempt') return { leaseExpiresAt: begin.leaseExpiresAt };
        if (name === 'read_assessment_work') {
          if (mutation === 'revoked') throw new Error('SOURCE_PERMISSION_REVOKED');
          const readRevision = mutation === 'partial' ? { ...revision, content: { roundCompletion: 'IN_PROGRESS' } }
            : args.requestId && mutation === 'missingOriginal' ? null
              : args.requestId && mutation === 'wrongOriginal' ? { ...revision, requestId: 'different-original-key' } : revision;
          return { schemaVersion: 'wiselink.jobaid-work-read.v2', attemptId: begin.task.actionAttemptId,
            revision: readRevision, executionStatus: 'RUNNING' };
        }
        assert.fail(name);
      },
    }), /SAVED_WORK_RECONCILIATION_READBACK_INVALID|SOURCE_PERMISSION_REVOKED/);
    assert.equal(calls.some(name => name.startsWith('commit_') || name === 'save_assessment_work'), false);
  }
});

test('Q01/Q08 incomplete JSON reconciliation cannot widen the ordinary model result branch', () => {
  const { begin, revision, marker } = savedReconciliationBegin();
  const hostProvenance = { ...provenance(), executionKind: marker.executionKind, modelRequests: 0, modelVersion: null,
    sourceWork: { workRevisionRef: revision.workRevisionRef, sourceActionAttemptId: revision.actionAttemptId },
    toolVersions: { ...provenance().toolVersions, 'host-saved-work-reconciliation': '1' },
    runMetrics: { durationMs: 0, inputUnits: 0, outputUnits: 0 } };
  for (const change of [
    value => { delete value.sourceWork; },
    value => { value.modelRequests = 1; },
    value => { value.modelVersion = 'pretend-model-run'; },
    value => { value.sourceWork.sourceActionAttemptId = 'ATT-other'; },
    value => { value.runMetrics.inputUnits = 1; },
    value => { value.executionKind = undefined; },
  ]) {
    const invalid = structuredClone(hostProvenance); change(invalid);
    assert.throws(() => sealResultEnvelope({ task: begin.task, modelOutput: { workRevisionRef: revision.workRevisionRef },
      provenance: invalid }), /RECONCILIATION|MISSING|Unknown field|INVALID/);
  }
  assert.throws(() => sealResultEnvelope({ task: beginFixture().task,
    modelOutput: { workRevisionRef: revision.workRevisionRef }, provenance: hostProvenance }), /RECONCILIATION/);
  assert.throws(() => sealResultEnvelope({ task: beginFixture().task, modelOutput: { workRevisionRef: revision.workRevisionRef },
    provenance: { ...provenance(), modelVersion: null } }), /MODEL_PROVENANCE_REQUIRED/);
});

test('Q04 a fresh Host queue generation may wake its new queued continuation; a live old grant keeps UNKNOWN stopped', async t => {
  for (const expired of [false, true]) {
    const root = await temporary(t);
    const checkpoint = await createCheckpointStore(join(root, 'queue'));
    checkpoint.withActiveClaimOwner = perform => perform();
    const old = { schemaVersion: 'wiselink.auto_work_item_claim.v1', workItemId: 'WI-synthetic',
      requestId: 'REQ-synthetic', documentVersionId: 'DV-synthetic', workItemRevision: 2,
      leaseToken: '00000000-0000-4000-8000-000000000001', leaseGeneration: 1,
      leaseExpiresAt: expired ? '2025-01-01T00:00:00.000Z' : '2099-01-01T00:00:00.000Z',
      completionReady: false, consumerStopped: true, attentionCode: 'JOBAID_PROVIDER_OUTCOME_UNKNOWN', blockReady: null,
      stoppedStageRequest: { workItemId: 'WI-synthetic', documentVersionId: 'DV-synthetic', workItemRevision: 2,
        operation: 'EVALUATE_JOBAID', requestId: null, attemptRef: 'AQ-old' } };
    await checkpoint.write('active-claim', old);
    const requestId = 'a'.repeat(64);
    let current = initial({ jobAid: { status: 'PENDING', attemptStatus: 'QUEUED', terminalCode: null,
      attemptRef: 'AQ-new', requestId } });
    let consumed = 0;
    const report = await consumeAutomaticWorkItemQueueTick({ checkpointRoot: root }, {
      checkpoint, now: () => new Date('2026-01-01T00:00:00.000Z'),
      nextWorkItem: async input => {
        assert.equal(expired, true);
        assert.deepEqual(input, { resumeWorkItemId: old.workItemId });
        return { status: 'CLAIMED', workItemId: old.workItemId, requestId: old.requestId,
          documentVersionId: old.documentVersionId, workItemRevision: 2,
          leaseToken: '00000000-0000-4000-8000-000000000002', leaseGeneration: 2,
          leaseExpiresAt: '2099-01-01T00:00:00.000Z' };
      },
      readInitialStatus: async () => current,
      acknowledgeWorkItem: () => assert.fail('an unfinished stage never ACKs'),
      consumeWorkItem: async options => {
        consumed += 1;
        assert.equal(options.explicitStageRequest.requestId, requestId);
        current = { ...current, status: 'BUSY', nextOperation: null,
          stages: { ...current.stages, jobAid: { ...current.stages.jobAid, status: 'BUSY', attemptStatus: 'RUNNING' } } };
        return { status: 'BUSY', operation: 'EVALUATE_JOBAID', nextOperation: null,
          candidateOnly: true, modelCallCount: 0, attemptRef: 'AQ-new' };
      },
    });
    assert.equal(consumed, expired ? 1 : 0);
    assert.equal(report.status, expired ? 'IN_PROGRESS' : 'REQUIRES_ATTENTION');
    assert.equal((await checkpoint.readOptional('active-claim')).consumerStopped, !expired);
  }
});

test('Q02 missing or corrupt stage cache still queries authorized Host latest and original SAVE key without taking a live attempt', async t => {
  for (const damaged of [false, true]) {
    const root = await temporary(t);
    const input = { checkpointRoot: root, workItemId: 'WI-synthetic', initialStageOnly: true, maxInitialStages: 1 };
    const stage = { status: 'BUSY', attemptStatus: 'RUNNING', attemptRef: 'AQ-synthetic' };
    const status = { ...initial({ jobAid: stage }), status: 'BUSY', nextOperation: null };
    const checkpoint = await createCheckpointStore(initialStageCheckpointPath(input, 'EVALUATE_JOBAID'));
    if (damaged) {
      await checkpoint.write('binding', { workItemId: input.workItemId, documentVersionId: status.documentVersionId,
        operation: 'EVALUATE_JOBAID', requestId: null });
      await writeFile(join(initialStageCheckpointPath(input, 'EVALUATE_JOBAID'), 'assessment-current-claim.json'), '{', { mode: 0o600 });
    }
    const reads = [];
    const revision = { requestId: 'JA-save-returned-by-host', workRevisionRef: 'JAWR-host-saved',
      actionAttemptId: 'ATT-synthetic', workItemId: input.workItemId, documentVersionId: status.documentVersionId,
      content: { roundCompletion: 'IN_PROGRESS' } };
    const report = await consumeHostedWorkItem(input, {
      callTool: async (name, args) => {
        if (name === 'get_parse_status') return { entry: { workItemId: input.workItemId }, initialAnalysis: status };
        assert.equal(name, 'read_assessment_work');
        reads.push(args);
        return { schemaVersion: 'wiselink.jobaid-work-read.v2', attemptId: 'ATT-synthetic',
          executionStatus: 'RUNNING', revision };
      },
      invokeInitialModel: () => assert.fail('a missing cache is not provider termination or a new lease'),
    });
    assert.deepEqual(reads, [{ attemptRef: stage.attemptRef, workItemId: input.workItemId },
      { attemptRef: stage.attemptRef, workItemId: input.workItemId, requestId: revision.requestId }]);
    assert.equal(report.errorCode, 'INITIAL_ASSESSMENT_MODEL_OUTCOME_UNKNOWN');
    assert.equal(report.savedWorkRevisionRef, revision.workRevisionRef);
    if (damaged) assert.ok((await readdir(initialStageCheckpointPath(input, 'EVALUATE_JOBAID')))
      .some(name => name.startsWith('quarantine-assessment-current-claim-')));
  }
});

test('Q02 COMMITTING with no checkpoint reads the original sealed commit before exact replay and never invokes a model', async t => {
  const root = await temporary(t);
  const running = beginFixture();
  const sealed = sealResultEnvelope({ task: running.task, modelOutput: { workRevisionRef: 'JAWR-original' }, provenance: provenance() });
  const begin = { ...running, status: 'COMMITTING', recoveryResult: sealed };
  const busy = { ...initial({ jobAid: { status: 'BUSY', attemptStatus: 'COMMITTING', attemptRef: begin.attemptRef } }),
    status: 'BUSY', nextOperation: null };
  let committed = false;
  const calls = [];
  const report = await consumeHostedWorkItem({ checkpointRoot: root, workItemId: running.task.workItemId,
    initialStageOnly: true, maxInitialStages: 1 }, {
    invokeInitialModel: () => assert.fail('sealed commit recovery makes no model request'),
    callTool: async (name, args) => {
      calls.push(name);
      if (name === 'get_parse_status') return { entry: { workItemId: running.task.workItemId },
        initialAnalysis: committed ? { ...busy, status: 'REQUIRED', nextOperation: 'SYNTHESIZE_OVERALL',
          stages: { ...busy.stages, jobAid: { status: 'SUCCEEDED' } } } : busy };
      if (name === 'get_action_attempt_status') return { attemptRef: begin.attemptRef, taskType: begin.task.taskType,
        status: 'COMMITTING', recoveryAvailable: true, recoveryResult: sealed, resultContentHash: sealed.contentHash,
        commitStartedAt: '2026-01-01T00:00:00.000Z', projectionApplied: false, terminalReason: null };
      if (name === 'begin_dynamic_evaluation') return begin;
      if (name === 'commit_dynamic_evaluation_candidate') {
        assert.deepEqual(args.result, sealed);
        committed = true;
        return { workItemId: running.task.workItemId, workItemRevision: 3, status: 'BASE_RULE_CANDIDATE_READY' };
      }
      assert.fail(name);
    },
  });
  assert.equal(report.status, 'INITIAL_STAGE_SAVED');
  assert.equal(report.attemptRef, begin.attemptRef);
  assert.equal(report.modelCallCount, 0);
  assert.ok(calls.indexOf('get_action_attempt_status') < calls.indexOf('begin_dynamic_evaluation'));
  assert.equal(calls.filter(name => name === 'commit_dynamic_evaluation_candidate').length, 1);
});

test('real Host cancellation and timeout with unknown provider never create a Native retry request or model run', async t => {
  for (const attemptStatus of ['CANCELLED', 'TIMED_OUT']) {
    const root = await temporary(t);
    const checkpoint = await createCheckpointStore(join(root, 'queue'));
    checkpoint.withActiveClaimOwner = perform => perform();
    const failed = { ...initial({ jobAid: { status: 'FAILED', attemptStatus, attemptRef: 'AQ-ended',
      terminalCode: attemptStatus === 'CANCELLED' ? 'CANCELLED_BY_REQUEST' : 'ACTION_ATTEMPT_DEADLINE_EXCEEDED' } }),
      status: 'FAILED', nextOperation: null };
    const calls = [];
    const callTool = async name => {
      calls.push(name);
      assert.equal(name, 'get_parse_status', 'termination observation cannot begin a new request');
      return { entry: { workItemId: failed.workItemId }, initialAnalysis: failed };
    };
    const report = await consumeAutomaticWorkItemQueueTick({ checkpointRoot: root }, {
      checkpoint, callTool, now: () => new Date('2026-01-01T00:00:00.000Z'),
      nextWorkItem: async () => ({ status: 'CLAIMED', workItemId: failed.workItemId,
        requestId: 'REQ-synthetic', documentVersionId: failed.documentVersionId, workItemRevision: 2,
        leaseToken: '00000000-0000-4000-8000-000000000001', leaseGeneration: 1,
        leaseExpiresAt: '2099-01-01T00:00:00.000Z' }),
      readInitialStatus: async () => failed,
      acknowledgeWorkItem: () => assert.fail('cancelled/incomplete work is not complete'),
      consumeWorkItem: options => {
        assert.equal(Object.hasOwn(options, 'autoRetry'), false);
        return consumeHostedWorkItem(options, { callTool,
          invokeInitialModel: () => assert.fail('provider outcome remains unknown') });
      },
    });
    assert.equal(report.status, 'REQUIRES_ATTENTION');
    assert.deepEqual(calls, attemptStatus === 'CANCELLED' ? ['get_parse_status'] : []);
    if (attemptStatus === 'TIMED_OUT') assert.equal(report.errorCode, 'AUTO_WORK_ITEM_BLOCK_FINALIZATION_UNAVAILABLE');
  }
});

test('serialized MCP queue-fence denial retains its bounded cause through the actual initial consumer without cancelling or exposing the body', async t => {
  for (const code of ['AUTO_WORK_ITEM_ATTEMPT_LEASE_REJECTED', 'AUTO_WORK_ITEM_TASK_LEASE_BINDING_REQUIRED']) {
    const root = await temporary(t);
    const begin = beginFixture();
    const calls = [];
    const secret = 'synthetic-private-error-body';
    const report = await runHostedInitialStage({ checkpointRoot: root, workItemId: begin.task.workItemId,
      operation: 'EVALUATE_JOBAID', initial: initial() }, {
      callTool: async (name, args) => {
        calls.push(name);
        if (name === 'save_assessment_work') return readHostMcpJsonResult(JSON.parse(JSON.stringify({
          isError: true, content: [{ type: 'text', text: `Error: ${code}:${secret}` }],
        })), name, args);
        const value = name === 'get_parse_status' ? { entry: { workItemId: begin.task.workItemId }, initialAnalysis: initial() }
          : name === 'begin_dynamic_evaluation' ? begin
            : name === 'heartbeat_action_attempt' ? { leaseExpiresAt: begin.leaseExpiresAt } : assert.fail(name);
        return readHostMcpJsonResult({ content: [{ type: 'text', text: JSON.stringify(value) }] }, name, args);
      },
      invokeInitialModel: async (_input, hooks) => {
        await hooks.saveAssessmentWork({ requestId: 'JA-save-synthetic', expectedWorkRevision: 0,
          workJson: JSON.stringify({ roundCompletion: 'IN_PROGRESS' }) });
        assert.fail('a rejected save must not proceed');
      },
    });
    assert.equal(report.errorCode, `REVIEW_HOST_MCP_TOOL_FAILED:save_assessment_work:${code}`);
    assert.equal(JSON.stringify(report).includes(secret), false);
    assert.equal(calls.filter(name => name === 'save_assessment_work').length, 1);
    assert.equal(calls.includes('cancel_action_attempt'), false);
  }
});

test('Q01 a complete continuation binding whose requestId disappears during JSON is quarantined rather than reclassified as initial', async t => {
  const root = await temporary(t);
  const checkpoint = await createCheckpointStore(root);
  checkpoint.withActiveClaimOwner = perform => perform();
  const stoppedStageRequest = { workItemId: 'WI-synthetic', documentVersionId: 'DV-synthetic',
    workItemRevision: 2, operation: 'EVALUATE_JOBAID', requestId: undefined, attemptRef: 'AQ-original' };
  const claim = { schemaVersion: 'wiselink.auto_work_item_claim.v1', workItemId: 'WI-synthetic',
    requestId: 'REQ-synthetic', documentVersionId: 'DV-synthetic', workItemRevision: 2,
    leaseToken: '00000000-0000-4000-8000-000000000001', leaseGeneration: 1,
    leaseExpiresAt: '2099-01-01T00:00:00.000Z', consumerStopped: true, attentionCode: 'UNKNOWN',
    completionReady: false, blockReady: null, stoppedStageRequest };
  await checkpoint.write('active-claim', claim);
  const serialized = JSON.parse(await readFile(join(root, 'active-claim.json'), 'utf8'));
  assert.equal(Object.hasOwn(serialized.stoppedStageRequest, 'requestId'), false);
  const report = await consumeAutomaticWorkItemQueueTick({}, {
    checkpoint, nextWorkItem: async input => { assert.equal(input, undefined); return { status: 'IDLE' }; },
    acknowledgeWorkItem: () => assert.fail('invalid local identity cannot ACK'),
    consumeWorkItem: () => assert.fail('a dropped continuation identity must not start a stage'),
    readInitialStatus: () => assert.fail('no trustworthy local target exists'),
  });
  assert.equal(report.status, 'IDLE');
  assert.equal(report.localCheckpointWarnings[0].code, 'REVIEW_CHECKPOINT_QUARANTINED');
});

async function committingQueueFixture(t, operation = 'EVALUATE_JOBAID', consumerStopped = false) {
  const root = await temporary(t);
  const checkpoint = await createCheckpointStore(join(root, 'queue'));
  checkpoint.withActiveClaimOwner = perform => perform();
  const taskType = operation === 'EVALUATE_JOBAID' ? 'OPENCLAW_DYNAMIC_EVALUATION' : 'OPENCLAW_OVERALL_SYNTHESIS';
  const running = beginFixture(taskType);
  const sealed = sealResultEnvelope({ task: running.task, modelOutput: { workRevisionRef: 'JAWR-original' }, provenance: provenance() });
  const begin = { ...running, status: 'COMMITTING', recoveryResult: sealed };
  const stage = operation === 'EVALUATE_JOBAID' ? 'jobAid' : 'overall';
  const busy = { ...initial({ ...(stage === 'overall' ? { jobAid: { status: 'SUCCEEDED' } } : {}),
    [stage]: { status: 'BUSY', attemptStatus: 'COMMITTING', attemptRef: begin.attemptRef } }),
    status: 'BUSY', nextOperation: null };
  const claim = { schemaVersion: 'wiselink.auto_work_item_claim.v1', workItemId: busy.workItemId,
    requestId: 'REQ-synthetic', documentVersionId: busy.documentVersionId, workItemRevision: 2,
    leaseToken: '00000000-0000-4000-8000-000000000001', leaseGeneration: 2,
    leaseExpiresAt: '2026-01-01T00:00:00.000Z', completionReady: false,
    consumerStopped, attentionCode: consumerStopped ? 'UNKNOWN' : null, blockReady: null };
  await checkpoint.write('active-claim', claim);
  const { schemaVersion, completionReady, consumerStopped: _stopped, attentionCode, blockReady, ...fields } = claim;
  const renewed = { status: 'CLAIMED', ...fields, leaseExpiresAt: '2099-01-01T00:00:00.000Z' };
  const observed = { attemptRef: begin.attemptRef, taskType, status: 'COMMITTING', recoveryAvailable: true,
    recoveryResult: sealed, resultContentHash: sealed.contentHash, commitStartedAt: '2026-01-01T00:00:00.000Z',
    projectionApplied: false, terminalReason: null };
  const calls = [];
  let committed = false;
  const after = { ...busy, workItemRevision: 3, status: stage === 'overall' ? 'SUCCEEDED' : 'REQUIRED',
    nextOperation: stage === 'overall' ? null : 'SYNTHESIZE_OVERALL',
    stages: { ...busy.stages, [stage]: { status: 'SUCCEEDED', attemptStatus: 'SUCCEEDED', attemptRef: begin.attemptRef } } };
  const callTool = async (name, args) => {
    calls.push({ name, args });
    if (name === 'get_parse_status') return { entry: { workItemId: busy.workItemId },
      initialAnalysis: committed ? after : busy,
      integratedAssessmentSummary: { baseRules: { schemaVersion: 'wiselink.jobaid-problem-result.v2',
        status: 'CANDIDATE_ONLY', workRevisionRef: 'JAWR-original', workRevision: 1, roundCompletion: 'COMPLETE' } } };
    if (name === 'get_action_attempt_status') return observed;
    if (name === (stage === 'jobAid' ? 'begin_dynamic_evaluation' : 'begin_overall_synthesis')) return begin;
    if (name === (stage === 'jobAid' ? 'commit_dynamic_evaluation_candidate' : 'commit_overall_candidate')) {
      assert.equal(args.attemptRef, begin.attemptRef);
      assert.deepEqual(args.result, sealed);
      committed = true;
      return { workItemId: busy.workItemId, workItemRevision: 3,
        status: stage === 'jobAid' ? 'BASE_RULE_CANDIDATE_READY' : 'OVERALL_CANDIDATE_READY',
        ...(stage === 'overall' ? { overallSynthesis: { status: 'CANDIDATE_ONLY',
          authorityLevel: 'candidate_only', externalDiscoveryIsEvidence: false } } : {}) };
    }
    assert.fail(`unexpected recovery tool ${name}`);
  };
  const dependencies = { checkpoint, callTool, now: () => new Date('2026-01-02T00:00:00.000Z'),
    nextWorkItem: async input => { assert.deepEqual(input, { resumeWorkItemId: busy.workItemId }); return renewed; },
    readInitialStatus: async () => committed ? after : busy,
    acknowledgeWorkItem: async input => ({ status: 'ACKNOWLEDGED', workItemId: input.workItemId,
      replayed: false, acknowledgedAt: '2026-01-02T00:00:00.000Z' }),
    consumeWorkItem: options => consumeHostedWorkItem(options, { callTool,
      invokeInitialModel: () => assert.fail('same queue grant recovery cannot invoke a model') }),
  };
  return { root, checkpoint, claim, renewed, begin, sealed, busy, observed, calls, dependencies };
}

test('expired active claim accepts the Host renewed identical grant only for the original JobAid/Overall commit, then ends the tick', async t => {
  for (const operation of ['EVALUATE_JOBAID', 'SYNTHESIZE_OVERALL']) {
    for (const stopped of [false, true]) {
      const f = await committingQueueFixture(t, operation, stopped);
      const report = await consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.root }, f.dependencies);
      assert.equal(report.status, operation === 'EVALUATE_JOBAID' ? 'IN_PROGRESS' : 'ACKNOWLEDGED');
      assert.equal(f.calls.filter(call => call.name.startsWith('commit_')).length, 1);
      assert.equal(f.calls.filter(call => call.name.startsWith('begin_')).length, 1);
      assert.equal(f.calls.some(call => ['save_assessment_work', 'heartbeat_action_attempt', 'read_assessment_work'].includes(call.name)), false);
      assert.ok(f.calls.findIndex(call => call.name === 'get_action_attempt_status') <
        f.calls.findIndex(call => call.name.startsWith('begin_')));
      const claim = await f.checkpoint.readOptional('active-claim');
      if (claim) {
        assert.equal(claim.leaseToken, f.claim.leaseToken);
        assert.equal(claim.leaseGeneration, f.claim.leaseGeneration);
        assert.equal(claim.workItemRevision, 3);
      }
    }
  }
});

test('unchanged queue grant rejects RUNNING, missing or mismatched sealed result, and mixed fences before consuming or checkpoint replacement', async t => {
  const cases = [
    f => { f.busy.stages.jobAid.attemptStatus = 'RUNNING'; },
    f => { f.observed.status = 'RUNNING'; },
    f => { f.observed.attemptRef = 'AQ-other'; },
    f => { f.observed.recoveryAvailable = false; },
    f => { delete f.observed.recoveryResult; },
    f => { f.observed.resultContentHash = '0'.repeat(64); },
    f => { f.observed.recoveryResult = { ...f.sealed, modelOutput: 'changed' }; },
    f => { const { contentHash, ...body } = f.sealed; body.workItemId = 'WI-other';
      f.observed.recoveryResult = { ...body, contentHash: canonicalSha256(body) };
      f.observed.resultContentHash = f.observed.recoveryResult.contentHash; },
    f => { f.renewed.leaseToken = '00000000-0000-4000-8000-000000000002'; },
    f => { f.renewed.leaseGeneration = 3; },
    f => { f.renewed.workItemRevision = 3; },
    f => { f.busy.workItemRevision = 3; },
    f => { f.busy.documentVersionId = 'DV-other'; },
    f => { f.busy.stages.overall = { ...f.busy.stages.jobAid }; },
    f => { f.dependencies.callTool = async () => { throw new Error('SOURCE_ACCESS_REVOKED'); }; },
  ];
  for (const change of cases) {
    const f = await committingQueueFixture(t);
    change(f);
    f.dependencies.consumeWorkItem = () => assert.fail('an unconfirmed same grant cannot dispatch');
    await assert.rejects(consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.root }, f.dependencies),
      /COMMITTING_RECOVERY_NOT_CONFIRMED|RECLAIM_FENCE_INVALID|STATUS_SOURCE_CHANGED|SOURCE_ACCESS_REVOKED/);
    assert.deepEqual(await f.checkpoint.readOptional('active-claim'), f.claim);
  }
});

test('same grant recovery rechecks the Host stage and original result before begin, and refuses a RUNNING or changed-result begin', async t => {
  for (const change of ['stage-before-consume', 'source-before-consume', 'result-before-consume', 'begin-running', 'begin-result']) {
    const f = await committingQueueFixture(t);
    const actual = f.dependencies.consumeWorkItem;
    f.dependencies.consumeWorkItem = options => {
      assert.equal(options.queueCommitRecovery.resultContentHash, f.sealed.contentHash);
      if (change === 'stage-before-consume') f.busy.stages.jobAid = { status: 'PENDING' };
      if (change === 'source-before-consume') f.busy.documentVersionId = 'DV-other';
      if (change === 'result-before-consume' || change === 'begin-result') {
        const replacement = sealResultEnvelope({ task: f.begin.task,
          modelOutput: { workRevisionRef: 'JAWR-other' }, provenance: provenance() });
        if (change === 'result-before-consume') Object.assign(f.observed,
          { recoveryResult: replacement, resultContentHash: replacement.contentHash });
        else f.begin.recoveryResult = replacement;
      }
      if (change === 'begin-running') f.begin.status = 'RUNNING';
      return actual(options);
    };
    await assert.rejects(consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.root }, f.dependencies),
      /COMMITTING_RECOVERY_NOT_CONFIRMED|COMMITTING_RECOVERY_CHANGED|RECOVERY_BINDING_MISMATCH/);
    assert.equal(f.calls.some(call => call.name.startsWith('commit_')), false);
    assert.equal(f.calls.some(call => call.name === 'save_assessment_work'), false);
    if (change.endsWith('before-consume')) assert.equal(f.calls.some(call => call.name.startsWith('begin_')), false);
  }
});

async function terminalQueueFixture(t, attemptStatus = 'FAILED') {
  const root = await temporary(t);
  const checkpoint = await createCheckpointStore(join(root, 'queue'));
  checkpoint.withActiveClaimOwner = perform => perform();
  const claim = { schemaVersion: 'wiselink.auto_work_item_claim.v1', workItemId: 'WI-synthetic',
    requestId: 'REQ-synthetic', documentVersionId: 'DV-synthetic', workItemRevision: 2,
    leaseToken: '00000000-0000-4000-8000-000000000001', leaseGeneration: 2,
    leaseExpiresAt: '2099-01-01T00:00:00.000Z', completionReady: false,
    consumerStopped: true, attentionCode: 'INITIAL_ASSESSMENT_MODEL_OUTCOME_UNKNOWN', blockReady: null };
  await checkpoint.write('active-claim', claim);
  const failed = { ...initial({ jobAid: { status: attemptStatus === 'CONFLICT' ? 'CONFLICT' : 'FAILED',
    attemptStatus, attemptRef: 'AQ-synthetic' } }),
    status: attemptStatus === 'CONFLICT' ? 'CONFLICT' : 'FAILED', nextOperation: null };
  const receipt = { status: 'BLOCKED', workItemId: claim.workItemId,
    blockedCode: `AUTO_WORK_ITEM_STAGE_JOBAID_${failed.status}`, blockedAt: '2026-01-01T00:00:00.000Z', replayed: false };
  let blocked = false;
  const posts = [];
  const dependencies = { checkpoint, now: () => new Date('2026-01-01T00:00:00.000Z'),
    readInitialStatus: async () => failed,
    nextWorkItem: () => assert.fail('the current terminal grant must settle before independent discovery'),
    consumeWorkItem: () => assert.fail('Host terminal state is not permission to run another model'),
    acknowledgeWorkItem: () => assert.fail('failure is never ACK success'),
    blockWorkItem: async input => {
      assert.deepEqual(input, { workItemId: claim.workItemId, leaseToken: claim.leaseToken, leaseGeneration: claim.leaseGeneration });
      const intent = await checkpoint.readOptional('active-claim');
      assert.deepEqual(intent.blockReady, { stage: 'jobAid', status: failed.status });
      assert.equal(intent.stoppedStageRequest.requestId, null, 'actual absent initial request remains nullable');
      posts.push(structuredClone(input));
      const value = { ...receipt, replayed: blocked };
      blocked = true;
      return value;
    },
  };
  return { root, checkpoint, claim, failed, receipt, posts, dependencies };
}

test('Host FAILED/TIMED_OUT/OBSOLETE/CONFLICT naturally BLOCK the exact grant and a later tick discovers independent work', async t => {
  for (const state of ['FAILED', 'TIMED_OUT', 'OBSOLETE', 'CONFLICT']) {
    const f = await terminalQueueFixture(t, state);
    const report = await consumeAutomaticWorkItemQueueTick({}, f.dependencies);
    assert.equal(report.status, 'BLOCKED_CLAIM_FINALIZED');
    assert.equal(f.posts.length, 2, 'one mutation plus the existing exact idempotent receipt read');
    assert.equal(await f.checkpoint.readOptional('active-claim'), null);
    const archived = await f.checkpoint.readOptional(`blocked-claim-${f.claim.workItemId}-g${f.claim.leaseGeneration}`);
    assert.equal(archived.receipt.replayed, true);
    assert.equal(archived.claim.attentionCode, f.claim.attentionCode, 'provider UNKNOWN observation is retained');
    const successor = { ...f.claim, workItemId: 'WI-successor', requestId: 'REQ-successor',
      documentVersionId: 'DV-successor', consumerStopped: false, attentionCode: null };
    const { schemaVersion, completionReady, consumerStopped, attentionCode, blockReady, ...grant } = successor;
    const next = await consumeAutomaticWorkItemQueueTick({}, { ...f.dependencies,
      nextWorkItem: async input => { assert.equal(input, undefined); return { status: 'CLAIMED', ...grant }; },
      readInitialStatus: async () => ({ ...initial(), workItemId: grant.workItemId, documentVersionId: grant.documentVersionId,
        status: 'SUCCEEDED', nextOperation: null,
        stages: { translation: { status: 'SUCCEEDED' }, applicability: { status: 'WAITING_INPUT' },
          jobAid: { status: 'SUCCEEDED' }, overall: { status: 'SUCCEEDED' } } }),
      acknowledgeWorkItem: async () => ({ status: 'ACKNOWLEDGED', workItemId: successor.workItemId,
        acknowledgedAt: '2026-01-01T00:00:00.000Z', replayed: false }),
    });
    assert.equal(next.status, 'ACKNOWLEDGED');
    assert.equal(next.workItemId, successor.workItemId);
  }
});

test('terminal cleanup never derives BLOCK from RUNNING/COMMITTING/CANCELLED, a local error, or a changed Host binding', async t => {
  for (const change of [
    f => { f.failed.stages.jobAid.attemptStatus = 'RUNNING'; },
    f => { f.failed.stages.jobAid.attemptStatus = 'COMMITTING'; },
    f => { f.failed.stages.jobAid.attemptStatus = 'CANCELLED'; },
    f => { delete f.failed.stages.jobAid.attemptStatus; },
    f => { delete f.failed.stages.jobAid.attemptRef; },
    f => { f.failed.nextOperation = 'EVALUATE_JOBAID'; },
    f => { f.failed.workItemId = 'WI-other'; },
    f => { f.failed.workItemRevision = 3; },
    f => { f.failed.documentVersionId = 'DV-other'; },
  ]) {
    const f = await terminalQueueFixture(t);
    change(f);
    f.dependencies.consumeWorkItem = async () => ({ status: 'REQUIRES_ATTENTION' });
    try { await consumeAutomaticWorkItemQueueTick({}, f.dependencies); }
    catch (error) { assert.match(error.message, /STATUS_SOURCE_CHANGED/); }
    assert.equal(f.posts.length, 0);
    assert.notEqual(await f.checkpoint.readOptional('active-claim'), null);
  }
});

test('expired stopped terminal work uses only its newly authorized queue grant for natural BLOCK', async t => {
  const f = await terminalQueueFixture(t, 'TIMED_OUT');
  const expired = { ...f.claim, leaseExpiresAt: '2025-01-01T00:00:00.000Z' };
  await f.checkpoint.write('active-claim', expired);
  Object.assign(f.claim, { leaseGeneration: 3, leaseToken: '00000000-0000-4000-8000-000000000002' });
  const { schemaVersion, completionReady, consumerStopped, attentionCode, blockReady, ...grant } = f.claim;
  f.dependencies.nextWorkItem = async input => {
    assert.deepEqual(input, { resumeWorkItemId: f.claim.workItemId });
    return { status: 'CLAIMED', ...grant };
  };
  const report = await consumeAutomaticWorkItemQueueTick({}, f.dependencies);
  assert.equal(report.status, 'BLOCKED_CLAIM_FINALIZED');
  assert.equal(report.leaseGeneration, 3);
  assert.equal(f.posts.every(post => post.leaseGeneration === 3 && post.leaseToken !== expired.leaseToken), true);
});

test('a terminal intent that cannot be persisted never sends BLOCK', async t => {
  const f = await terminalQueueFixture(t);
  f.checkpoint.write = async () => { throw new Error('LOCAL_TERMINAL_INTENT_WRITE_FAILED'); };
  await assert.rejects(consumeAutomaticWorkItemQueueTick({}, f.dependencies), /LOCAL_TERMINAL_INTENT_WRITE_FAILED/);
  assert.equal(f.posts.length, 0);
  assert.deepEqual(await f.checkpoint.readOptional('active-claim'), f.claim);
});

test('a lost original BLOCK response resumes only the durable original grant and clears after its exact receipt', async t => {
  const f = await terminalQueueFixture(t);
  const actual = f.dependencies.blockWorkItem;
  f.dependencies.blockWorkItem = async input => { await actual(input); throw new Error('AUTO_WORK_ITEM_QUEUE_TRANSPORT_FAILED'); };
  const first = await consumeAutomaticWorkItemQueueTick({}, f.dependencies);
  assert.equal(first.errorCode, 'AUTO_WORK_ITEM_BLOCK_RECEIPT_UNCERTAIN');
  const intent = await f.checkpoint.readOptional('active-claim');
  assert.deepEqual(intent.blockReady, { stage: 'jobAid', status: 'FAILED' });
  f.dependencies.blockWorkItem = actual;
  f.dependencies.readInitialStatus = () => assert.fail('a blocked grant cannot be reauthorized as an active status read');
  const resumed = await consumeAutomaticWorkItemQueueTick({}, f.dependencies);
  assert.equal(resumed.status, 'BLOCKED_CLAIM_FINALIZED');
  assert.equal(resumed.alreadyFinalized, true);
  assert.equal(f.posts.length, 2);
  assert.equal(await f.checkpoint.readOptional('active-claim'), null);
});

test('a confirmed Host BLOCK survives receipt-read and archive failures, retaining exact original identity for later cleanup', async t => {
  for (const failure of ['readback', 'archive', 'clear']) {
    const f = await terminalQueueFixture(t);
    const block = f.dependencies.blockWorkItem;
    const write = f.checkpoint.write;
    const archive = f.checkpoint.writeOnceOrEqual;
    let fail = true;
    if (failure === 'readback') f.dependencies.blockWorkItem = async input => {
      if (f.posts.length === 1 && fail) { fail = false; throw new Error('AUTO_WORK_ITEM_QUEUE_TRANSPORT_FAILED'); }
      return block(input);
    };
    if (failure === 'archive') f.checkpoint.writeOnceOrEqual = async (...args) => {
      if (fail) { fail = false; throw new Error('LOCAL_ARCHIVE_WRITE_FAILED'); }
      return archive(...args);
    };
    if (failure === 'clear') f.checkpoint.write = async (step, value) => {
      if (step === 'active-claim' && value === null && fail) { fail = false; throw new Error('LOCAL_CLEAR_WRITE_FAILED'); }
      return write(step, value);
    };
    const first = await consumeAutomaticWorkItemQueueTick({}, f.dependencies);
    assert.equal(first.status, 'BLOCKED', 'local logging cannot relabel a confirmed business result as failed');
    assert.equal(first.localFinalizationPending, true);
    assert.notEqual(await f.checkpoint.readOptional('active-claim'), null);
    f.dependencies.readInitialStatus = () => assert.fail('resume uses only the original idempotent BLOCK');
    const later = await consumeAutomaticWorkItemQueueTick({}, f.dependencies);
    assert.equal(later.status, 'BLOCKED_CLAIM_FINALIZED');
    assert.equal(await f.checkpoint.readOptional('active-claim'), null);
  }
});

test('revoked access, missing or changed BLOCK receipts never clear a claim, and late original cleanup preserves a new local grant', async t => {
  for (const kind of ['revoked', 'missing', 'wrong-code', 'wrong-work-item', 'different-readback', 'new-claim']) {
    const f = await terminalQueueFixture(t);
    const actual = f.dependencies.blockWorkItem;
    const newer = { ...f.claim, leaseGeneration: 3, leaseToken: '00000000-0000-4000-8000-000000000002' };
    f.dependencies.blockWorkItem = async input => {
      if (kind === 'revoked') throw new Error('SOURCE_ACCESS_REVOKED');
      if (kind === 'missing') return null;
      const receipt = await actual(input);
      if (kind === 'wrong-code') receipt.blockedCode = 'AUTO_WORK_ITEM_STAGE_OVERALL_FAILED';
      if (kind === 'wrong-work-item') receipt.workItemId = 'WI-other';
      if (kind === 'different-readback' && receipt.replayed) receipt.blockedAt = '2026-01-02T00:00:00.000Z';
      if (kind === 'new-claim' && receipt.replayed) await f.checkpoint.write('active-claim', newer);
      return receipt;
    };
    const report = await consumeAutomaticWorkItemQueueTick({}, f.dependencies);
    assert.notEqual(report.status, 'BLOCKED_CLAIM_FINALIZED');
    const current = await f.checkpoint.readOptional('active-claim');
    assert.notEqual(current, null);
    assert.equal(current.leaseGeneration, kind === 'new-claim' ? 3 : f.claim.leaseGeneration);
  }
});

test('Q06 queue retains stage warnings through progress, ACK and attention, and merges root diagnostics without changing business status', async t => {
  const stageWarning = { step: 'run-result', code: 'REVIEW_CHECKPOINT_AUXILIARY_WRITE_FAILED' };
  const rootWarning = { step: 'active-claim', code: 'REVIEW_CHECKPOINT_AUXILIARY_WRITE_FAILED' };
  for (const [outcome, rootWarnings] of [['IN_PROGRESS', []], ['IN_PROGRESS', [rootWarning]],
    ['ACKNOWLEDGED', [rootWarning]], ['REQUIRES_ATTENTION', [rootWarning]]]) {
    const f = await terminalQueueFixture(t);
    await f.checkpoint.write('active-claim', { ...f.claim, consumerStopped: false, attentionCode: null });
    f.checkpoint.diagnostics.push(...rootWarnings);
    let consumed = false;
    const after = outcome === 'ACKNOWLEDGED' ? { ...initial(), status: 'SUCCEEDED', nextOperation: null,
      stages: { translation: { status: 'SUCCEEDED' }, applicability: { status: 'WAITING_INPUT' },
        jobAid: { status: 'SUCCEEDED' }, overall: { status: 'SUCCEEDED' } } }
      : outcome === 'REQUIRES_ATTENTION' ? { ...initial({ jobAid: { status: 'BUSY', attemptStatus: 'RUNNING' } }),
        status: 'BUSY', nextOperation: null }
        : { ...initial({ jobAid: { status: 'SUCCEEDED' } }), nextOperation: 'SYNTHESIZE_OVERALL' };
    const report = await consumeAutomaticWorkItemQueueTick({}, { ...f.dependencies,
      readInitialStatus: async () => consumed ? after : initial(),
      consumeWorkItem: async () => {
        consumed = true;
        return { status: outcome === 'REQUIRES_ATTENTION' ? 'REQUIRES_ATTENTION' : 'INITIAL_STAGE_SAVED',
          errorCode: 'INITIAL_ASSESSMENT_MODEL_OUTCOME_UNKNOWN', localCheckpointWarnings: [stageWarning] };
      },
      acknowledgeWorkItem: async () => ({ status: 'ACKNOWLEDGED', workItemId: f.claim.workItemId,
        acknowledgedAt: '2026-01-01T00:00:00.000Z', replayed: false }),
    });
    assert.equal(report.status, outcome);
    assert.deepEqual(report.localCheckpointWarnings, [stageWarning, ...rootWarnings]);
    assert.equal(f.posts.length, 0, 'an auxiliary warning never creates a business BLOCK');
    assert.equal((await f.checkpoint.readOptional('active-claim')) === null, outcome === 'ACKNOWLEDGED');
  }
});
