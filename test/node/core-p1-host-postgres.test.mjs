import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { startCoreP1HostFixture } from './helpers/core-p1-host-postgres.fixture.mjs';
const require = createRequire(import.meta.url);
const {
  assertJobAidProblemTaskBinding,
} = require('../../server/modules/canonical-host/jobaid-problem-task.ts');

const {
  sealResultEnvelope,
} = require('../../server/modules/action-attempt/action-attempt-envelope.ts');

function saveArgs(f, claim, key = 'save-one', completion = 'COMPLETE') {
  return {
    workItemId: claim.task.workItemId,
    attemptRef: claim.attemptRef,
    leaseToken: claim.leaseToken,
    leaseGeneration: claim.leaseGeneration,
    requestId: key,
    expectedWorkRevision: 0,
    workJson: JSON.stringify(f.proposal(claim, completion)),
  };
}
function commitArgs(f, claim, workRevisionRef, consistencyCheck) {
  return {
    workItemId: claim.task.workItemId,
    attemptRef: claim.attemptRef,
    leaseToken: claim.leaseToken,
    leaseGeneration: claim.leaseGeneration,
    result: f.result(claim, workRevisionRef, consistencyCheck),
  };
}
async function opened(f, id = 'WI-core-p1') {
  await f.seed(id);
  const queue = await f.nextWorkItem({ resumeWorkItemId: id });
  assert.equal(queue.status, 'CLAIMED');
  const claim = await f.callTool('begin_dynamic_evaluation', {
    workItemId: id,
  });
  return { queue, claim };
}
async function usingFixture(body) {
  const f = await startCoreP1HostFixture();
  try {
    await body(f);
  } finally {
    await f.close();
  }
}
function errorText(error) {
  return [error?.message, error?.cause && errorText(error.cause)]
    .filter(Boolean)
    .join(':');
}

test('W01/W02/W03/W09: exact-key concurrent SAVE, conflict, receipt and independent revisions', () =>
  usingFixture(async (f) => {
    const { claim } = await opened(f);
    const args = saveArgs(f, claim);
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        f.callTool('save_assessment_work', args),
      ),
    );
    assert.equal(new Set(results.map((r) => r.workRevisionRef)).size, 1);
    assert.equal(results.filter((r) => !r.replayed).length, 1);
    for (let i = 0; i < 10; i++)
      assert.equal(
        (await f.callTool('save_assessment_work', args)).workRevision,
        1,
      );
    const changed = {
      ...args,
      workJson: JSON.stringify({
        ...f.proposal(claim),
        headline: '不同业务内容',
      }),
    };
    await assert.rejects(
      f.callTool('save_assessment_work', changed),
      /JOBAID_SAVE_REQUEST_REUSE/u,
    );
    const receipt = await f.callTool('read_assessment_work', {
      attemptRef: claim.attemptRef,
      workItemId: claim.task.workItemId,
      requestId: args.requestId,
    });
    assert.equal(receipt.revision.workRevisionRef, results[0].workRevisionRef);
    await f.callTool('heartbeat_action_attempt', {
      attemptRef: claim.attemptRef,
      workItemId: claim.task.workItemId,
      leaseToken: claim.leaseToken,
      leaseGeneration: claim.leaseGeneration,
    });
    const snapshot = await f.snapshot();
    assert.equal(snapshot.work.length, 1);
    assert.equal(snapshot.workItems[0].revision, 1);
    assert.equal(
      snapshot.attempts.find((a) => a.operation_ref === claim.attemptRef)
        .input_revision,
      1,
    );
    assert.equal((await f.roleEvidence())[0].bypassrls, false);
    assert.equal((await f.roleEvidence())[0].superuser, false);
  }));

test('W04: required projection registration fails before commit, no partial work or outbox', () =>
  usingFixture(async (f) => {
    const { claim } = await opened(f);
    await f.sql
      .unsafe(`CREATE FUNCTION core_p1_fail_pending() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'CORE_P1_PRECOMMIT_FAULT'; END; $$;
    CREATE TRIGGER core_p1_fail_pending BEFORE INSERT ON engineering_search_projection_pending
      FOR EACH ROW EXECUTE FUNCTION core_p1_fail_pending()`);
    await assert.rejects(
      f.callTool('save_assessment_work', saveArgs(f, claim)),
      (error) => /CORE_P1_PRECOMMIT_FAULT/u.test(errorText(error)),
    );
    assert.equal((await f.snapshot()).work.length, 0);
    assert.equal(
      (await f.sql`SELECT * FROM engineering_search_projection_pending`).length,
      0,
    );
  }));

test('W05: a real input CAS invalidates the old input writer', () =>
  usingFixture(async (f) => {
    const { claim } = await opened(f);
    await f.correctInput(claim.task.workItemId);
    await assert.rejects(
      f.callTool('save_assessment_work', saveArgs(f, claim)),
      /JOBAID_SAVE_WORK_ITEM_CHANGED/u,
    );
    assert.equal((await f.snapshot()).work.length, 0);
  }));

test('W06: revoked actor cannot read sources, SAVE, or recover a saved receipt', () =>
  usingFixture(async (f) => {
    const { claim } = await opened(f);
    await f.callTool('save_assessment_work', saveArgs(f, claim));
    await f.revokeActor();
    await assert.rejects(
      f.callTool('read_assessment_work', {
        workItemId: claim.task.workItemId,
        attemptRef: claim.attemptRef,
        requestId: 'save-one',
      }),
    );
    await assert.rejects(
      f.callTool('save_assessment_work', saveArgs(f, claim)),
    );
    await assert.rejects(
      f.callTool('read_assessment_sources', {
        workItemId: claim.task.workItemId,
        attemptRef: claim.attemptRef,
        leaseToken: claim.leaseToken,
        leaseGeneration: claim.leaseGeneration,
        sourceRefs: [],
        purpose: '核对原文',
      }),
    );
    assert.equal((await f.snapshot()).work.length, 1);
  }));

test('Q01 task binding: manual absence, automatic serialization, explicit invalid shapes', () =>
  usingFixture(async (f) => {
    const { claim } = await opened(f);
    const task = claim.task.modelInput;
    assert.ok(
      assertJobAidProblemTaskBinding(JSON.parse(JSON.stringify(task)))
        .automaticWorkItemLease,
    );
    const manual = structuredClone(task);
    delete manual.automaticWorkItemLease;
    assert.equal(
      assertJobAidProblemTaskBinding(manual).automaticWorkItemLease,
      undefined,
    );
    for (const value of [
      undefined,
      null,
      1,
      { requestId: 'r' },
      { requestId: 'r', leaseGeneration: null },
      { requestId: 'r', leaseGeneration: 0 },
    ])
      assert.throws(
        () =>
          assertJobAidProblemTaskBinding({
            ...task,
            automaticWorkItemLease: value,
          }),
        /AUTO_WORK_ITEM_TASK_LEASE_BINDING_INVALID/u,
      );
  }));

test('Q04/W07/Q08: pure status, expired old writer, exact saved zero-model finish, real Overall', () =>
  usingFixture(async (f) => {
    const { queue, claim } = await opened(f);
    const saved = await f.callTool('save_assessment_work', saveArgs(f, claim));
    await f.advance();
    const successor = await f.nextWorkItem({
      resumeWorkItemId: claim.task.workItemId,
    });
    assert.equal(successor.status, 'CLAIMED');
    assert.equal(successor.leaseGeneration, queue.leaseGeneration + 1);
    const status = (await f.readInitialStatus(claim.task.workItemId))
      .initialAnalysis;
    assert.match(status.stages.jobAid.requestId, /^[a-f0-9]{64}$/u);
    const resumed = await f.callTool('begin_dynamic_evaluation', {
      workItemId: claim.task.workItemId,
      requestId: status.stages.jobAid.requestId,
    });
    assert.notEqual(resumed.attemptRef, claim.attemptRef);
    assert.equal(
      resumed.task.modelInput.automaticWorkItemLease.leaseGeneration,
      successor.leaseGeneration,
    );
    const marker = resumed.task.modelInput.savedWorkReconciliation;
    assert.equal(marker.sourceActionAttemptId, claim.task.actionAttemptId);
    assert.equal(marker.modelRequests, 0);
    const receipt = await f.callTool('read_assessment_work', {
      workItemId: claim.task.workItemId,
      attemptRef: resumed.attemptRef,
      requestId: 'save-one',
    });
    assert.equal(receipt.revision.workRevisionRef, saved.workRevisionRef);
    await assert.rejects(
      f.callTool('save_assessment_work', saveArgs(f, claim, 'late-old')),
    );
    await assert.rejects(
      f.callTool('heartbeat_action_attempt', {
        workItemId: claim.task.workItemId,
        attemptRef: claim.attemptRef,
        leaseToken: claim.leaseToken,
        leaseGeneration: claim.leaseGeneration,
      }),
    );
    const bridge = await f.callTool(
      'commit_dynamic_evaluation_candidate',
      commitArgs(f, resumed, saved.workRevisionRef),
    );
    assert.equal(bridge.executionKind, 'HOST_SAVED_WORK_RECONCILIATION');
    assert.equal(bridge.modelRequests, 0);
    assert.equal(bridge.baseRules.workRevisionRef, saved.workRevisionRef);
    assert.equal(
      (await f.readInitialStatus(claim.task.workItemId)).initialAnalysis
        .nextOperation,
      'SYNTHESIZE_OVERALL',
    );
    const overall = await f.callTool('begin_overall_synthesis', {
      workItemId: claim.task.workItemId,
    });
    const finished = await f.callTool(
      'commit_overall_candidate',
      commitArgs(
        f,
        overall,
        saved.workRevisionRef,
        '与准确已保存问题逐项核对一致。',
      ),
    );
    assert.equal(
      finished.overallSynthesis.basedOnJobAidWorkRevisionRef,
      saved.workRevisionRef,
    );
    assert.equal(finished.overallSynthesis.revision, 1);
    assert.equal((await f.snapshot()).work.length, 1);
    assert.equal(
      (await f.snapshot()).grants[0].lease_generation,
      successor.leaseGeneration,
    );
  }));

test('W09 deadline: an authorized ordinary status read never terminalizes an expired RUNNING attempt', () =>
  usingFixture(async (f) => {
    await f.seed();
    await f.nextWorkItem();
    const requested = await f.reserveInitial({
      workItemId: 'WI-core-p1',
      deadlineMs: 5000,
    });
    const claim = await f.callTool('begin_dynamic_evaluation', {
      workItemId: 'WI-core-p1',
      requestId: requested.requestId,
    });
    const before = (await f.snapshot()).attempts.find(
      (a) => a.operation_ref === claim.attemptRef,
    );
    await f.advance(10000);
    const status = await f.readInitialStatus('WI-core-p1');
    assert.equal(status.initialAnalysis.stages.jobAid.attemptStatus, 'RUNNING');
    const after = (await f.snapshot()).attempts.find(
      (a) => a.operation_ref === claim.attemptRef,
    );
    assert.equal(after.status, 'RUNNING');
    assert.equal(after.updated_at, before.updated_at);
    assert.equal(after.result_envelope_json, null);
  }));

test('Q04 UNKNOWN: expired executed partial work remains queryable and does not enqueue another model attempt', () =>
  usingFixture(async (f) => {
    const { claim } = await opened(f);
    await f.callTool(
      'save_assessment_work',
      saveArgs(f, claim, 'partial', 'IN_PROGRESS'),
    );
    await f.advance();
    assert.equal(
      (await f.nextWorkItem({ resumeWorkItemId: claim.task.workItemId }))
        .status,
      'CLAIMED',
    );
    const status = (await f.readInitialStatus(claim.task.workItemId))
      .initialAnalysis;
    assert.equal(status.nextOperation, null);
    assert.equal(
      (await f.snapshot()).attempts.filter(
        (a) => a.action_type === 'OPENCLAW_DYNAMIC_EVALUATION',
      ).length,
      1,
    );
    assert.equal(
      (
        await f.callTool('read_assessment_work', {
          workItemId: claim.task.workItemId,
          attemptRef: claim.attemptRef,
        })
      ).revision.content.roundCompletion,
      'IN_PROGRESS',
    );
  }));

test('Q07: true cancellation is idempotent and never relabelled as provider failure', () =>
  usingFixture(async (f) => {
    const { claim } = await opened(f);
    const args = {
      workItemId: claim.task.workItemId,
      attemptRef: claim.attemptRef,
      reason: 'EXPLICIT_USER_CANCELLED',
    };
    const first = await f.callTool('cancel_action_attempt', args);
    const second = await f.callTool('cancel_action_attempt', args);
    assert.deepEqual(second, first);
    const row = (await f.snapshot()).attempts.find(
      (a) => a.operation_ref === claim.attemptRef,
    );
    assert.equal(row.status, 'CANCELLED');
    assert.equal(row.cancel_reason, args.reason);
    await f.advance();
    await f.nextWorkItem({ resumeWorkItemId: claim.task.workItemId });
    assert.equal(
      (await f.snapshot()).attempts.filter(
        (a) => a.action_type === 'OPENCLAW_DYNAMIC_EVALUATION',
      ).length,
      1,
    );
  }));

test('Q08 negative: current input/source change prevents sealed saved-work promotion', () =>
  usingFixture(async (f) => {
    const { claim } = await opened(f);
    const saved = await f.callTool('save_assessment_work', saveArgs(f, claim));
    await f.advance();
    await f.nextWorkItem({ resumeWorkItemId: claim.task.workItemId });
    const requestId = (await f.readInitialStatus(claim.task.workItemId))
      .initialAnalysis.stages.jobAid.requestId;
    const resumed = await f.callTool('begin_dynamic_evaluation', {
      workItemId: claim.task.workItemId,
      requestId,
    });
    assert.ok(resumed.task.modelInput.savedWorkReconciliation);
    await f.correctInput(claim.task.workItemId);
    await assert.rejects(
      f.callTool(
        'commit_dynamic_evaluation_candidate',
        commitArgs(f, resumed, saved.workRevisionRef),
      ),
      /WORK_ITEM_REVISION_CONFLICT/u,
    );
    assert.equal(
      JSON.parse((await f.snapshot()).workItems[0].projection_json)
        .integratedAssessment,
      null,
    );
  }));

async function prepareExactCommit(f, claim, saved) {
  const args = commitArgs(f, claim, saved.workRevisionRef);
  await f.hosted(async () => {
    const scope = await f.serviceScope.authorizeOpenClawAttempt({
      operation: 'COMMIT_DYNAMIC',
      workItemId: claim.task.workItemId,
      attemptRef: claim.attemptRef,
    });
    await f.attempts.prepareCommit({
      ...args,
      tenantId: scope.tenantId,
      principalId: scope.principalId,
      automaticLeaseRequired: !!scope.automaticWorkItemLease,
    });
  });
  return args;
}

test('COMMITTING before CAS: bounded exact-result recovery keeps original owner and both fences', () =>
  usingFixture(async (f) => {
    const { queue, claim } = await opened(f);
    const saved = await f.callTool('save_assessment_work', saveArgs(f, claim));
    const args = await prepareExactCommit(f, claim, saved);
    const original = (await f.snapshot()).attempts.find(
      (a) => a.operation_ref === claim.attemptRef,
    );
    await f.advance();
    const recovery = await f.nextWorkItem({
      resumeWorkItemId: claim.task.workItemId,
    });
    assert.equal(recovery.status, 'CLAIMED');
    assert.equal(recovery.leaseGeneration, queue.leaseGeneration);
    assert.equal(recovery.leaseToken, queue.leaseToken);
    const renewed = (await f.snapshot()).attempts.find(
      (a) => a.operation_ref === claim.attemptRef,
    );
    assert.equal(renewed.lease_owner, original.lease_owner);
    assert.equal(renewed.lease_token, original.lease_token);
    assert.equal(renewed.lease_generation, original.lease_generation);
    assert.equal(renewed.deadline_at, original.deadline_at);
    assert.equal(renewed.result_content_hash, original.result_content_hash);
    assert.equal(renewed.task_envelope_json, original.task_envelope_json);
    assert.ok(Date.parse(renewed.lease_expires_at) - Date.now() <= 30000);
    assert.equal(
      (await f.nextWorkItem({ resumeWorkItemId: claim.task.workItemId }))
        .status,
      'IDLE',
    );
    const status = await f.callTool('get_action_attempt_status', {
      workItemId: claim.task.workItemId,
      attemptRef: claim.attemptRef,
    });
    assert.deepEqual(status.recoveryResult, args.result);
    const { contentHash, ...unsealed } = args.result;
    const different = sealResultEnvelope({
      ...unsealed,
      modelOutput: JSON.stringify({ workRevisionRef: 'JAWR-foreign' }),
    });
    await assert.rejects(
      f.callTool('commit_dynamic_evaluation_candidate', {
        ...args,
        result: different,
      }),
      /RESULT_ENVELOPE_REPLAY_MISMATCH/u,
    );
    await assert.rejects(
      f.callTool('save_assessment_work', saveArgs(f, claim, 'late-committing')),
    );
    const finished = await f.callTool(
      'commit_dynamic_evaluation_candidate',
      args,
    );
    assert.equal(finished.baseRules.workRevisionRef, saved.workRevisionRef);
    assert.equal(
      (await f.snapshot()).attempts.find(
        (a) => a.operation_ref === claim.attemptRef,
      ).status,
      'SUCCEEDED',
    );
    assert.equal((await f.snapshot()).work.length, 1);
  }));

test('COMMITTING after real projection CAS: lost terminal response reconciles exact persisted result on authorized claim', () =>
  usingFixture(async (f) => {
    const { queue, claim } = await opened(f);
    const saved = await f.callTool('save_assessment_work', saveArgs(f, claim));
    await f.sql
      .unsafe(`CREATE FUNCTION core_p1_fail_terminal() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF OLD.status='COMMITTING' AND NEW.status='SUCCEEDED' THEN RAISE EXCEPTION 'CORE_P1_TERMINAL_FAULT'; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER core_p1_fail_terminal BEFORE UPDATE ON action_attempt FOR EACH ROW EXECUTE FUNCTION core_p1_fail_terminal()`);
    await assert.rejects(
      f.callTool(
        'commit_dynamic_evaluation_candidate',
        commitArgs(f, claim, saved.workRevisionRef),
      ),
      (error) => /CORE_P1_TERMINAL_FAULT/u.test(errorText(error)),
    );
    const committed = await f.snapshot();
    assert.equal(
      JSON.parse(committed.workItems[0].projection_json).integratedAssessment
        .baseRules.workRevisionRef,
      saved.workRevisionRef,
    );
    const old = committed.attempts.find(
      (a) => a.operation_ref === claim.attemptRef,
    );
    assert.equal(old.status, 'COMMITTING');
    await f.sql.unsafe('DROP TRIGGER core_p1_fail_terminal ON action_attempt');
    await f.advance();
    const next = await f.nextWorkItem({
      resumeWorkItemId: claim.task.workItemId,
    });
    assert.equal(next.status, 'CLAIMED');
    assert.equal(next.leaseGeneration, queue.leaseGeneration + 1);
    const after = await f.snapshot();
    const row = after.attempts.find(
      (a) => a.operation_ref === claim.attemptRef,
    );
    assert.equal(row.status, 'SUCCEEDED');
    assert.equal(row.terminal_reason, 'COMMIT_RECONCILED_FROM_PROJECTION');
    assert.equal(row.result_content_hash, old.result_content_hash);
    assert.equal(row.lease_slot, null);
    assert.equal(after.workItems[0].revision, committed.workItems[0].revision);
    assert.equal(
      (await f.readInitialStatus(claim.task.workItemId)).initialAnalysis
        .nextOperation,
      'SYNTHESIZE_OVERALL',
    );
  }));

test('COMMITTING recovery refuses a different owner and revoked actor', () =>
  usingFixture(async (f) => {
    const { claim } = await opened(f);
    const saved = await f.callTool('save_assessment_work', saveArgs(f, claim));
    await prepareExactCommit(f, claim, saved);
    await f.advance();
    const before = (await f.snapshot()).attempts.find(
      (a) => a.operation_ref === claim.attemptRef,
    );
    process.env.WL_OPENCLAW_SERVICE_PRINCIPAL_ID =
      'service:other-test-principal';
    assert.equal(
      (await f.nextWorkItem({ resumeWorkItemId: claim.task.workItemId }))
        .status,
      'IDLE',
    );
    process.env.WL_OPENCLAW_SERVICE_PRINCIPAL_ID = 'service:core-p1-test';
    await f.revokeActor();
    await assert.rejects(
      f.nextWorkItem({ resumeWorkItemId: claim.task.workItemId }),
      /JOBAID_ACTOR_AUTHORIZATION_CHANGED/u,
    );
    const after = (await f.snapshot()).attempts.find(
      (a) => a.operation_ref === claim.attemptRef,
    );
    assert.equal(after.lease_expires_at, before.lease_expires_at);
    assert.equal(after.result_content_hash, before.result_content_hash);
  }));

test('Q07: a proven failed Result preserves its actual failure reason and repeat result is idempotent', () =>
  usingFixture(async (f) => {
    const { claim } = await opened(f);
    const { contentHash, ...normal } = f.result(claim, 'JAWR-unused');
    const result = sealResultEnvelope({
      ...normal,
      status: 'FAILED',
      businessOutcome: 'NOT_PRODUCED',
      modelOutput: null,
      errorCode: 'CONSTRUCTED_PROVIDER_TERMINAL_FAILURE',
      errorDetail: 'Synthetic provider reported a terminal failure.',
    });
    const args = {
      workItemId: claim.task.workItemId,
      attemptRef: claim.attemptRef,
      leaseToken: claim.leaseToken,
      leaseGeneration: claim.leaseGeneration,
      result,
    };
    const first = await f.callTool('commit_dynamic_evaluation_candidate', args);
    const before = (await f.snapshot()).attempts.find(
      (a) => a.operation_ref === claim.attemptRef,
    );
    const second = await f.callTool(
      'commit_dynamic_evaluation_candidate',
      args,
    );
    assert.deepEqual(second, first);
    assert.equal(first.status, 'FAILED');
    assert.equal(
      before.terminal_reason,
      'CONSTRUCTED_PROVIDER_TERMINAL_FAILURE',
    );
    assert.equal(before.cancel_reason, null);
    assert.equal(
      (await f.snapshot()).attempts.find(
        (a) => a.operation_ref === claim.attemptRef,
      ).updated_at,
      before.updated_at,
    );
  }));

test('Q01 manual and legacy automatic binding: actual manual SAVE works; current automatic scope never treats missing binding as manual', () =>
  usingFixture(async (f) => {
    await f.seed();
    await f.nextWorkItem();
    process.env.WL_OPENCLAW_SERVICE_WORK_ITEM_ID = 'WI-core-p1';
    const claim = await f.callTool('begin_dynamic_evaluation', {
      workItemId: 'WI-core-p1',
    });
    assert.equal(claim.task.modelInput.automaticWorkItemLease, undefined);
    const saved = await f.callTool('save_assessment_work', saveArgs(f, claim));
    delete process.env.WL_OPENCLAW_SERVICE_WORK_ITEM_ID;
    assert.equal(
      (
        await f.callTool('read_assessment_work', {
          attemptRef: claim.attemptRef,
          workItemId: 'WI-core-p1',
          requestId: 'save-one',
        })
      ).revision.workRevisionRef,
      saved.workRevisionRef,
    );
    await assert.rejects(
      f.callTool('save_assessment_work', saveArgs(f, claim)),
      /AUTO_WORK_ITEM_TASK_LEASE_BINDING_REQUIRED/u,
    );
    await assert.rejects(
      f.callTool('heartbeat_action_attempt', {
        attemptRef: claim.attemptRef,
        workItemId: 'WI-core-p1',
        leaseToken: claim.leaseToken,
        leaseGeneration: claim.leaseGeneration,
      }),
      /AUTO_WORK_ITEM_TASK_LEASE_BINDING_REQUIRED/u,
    );
    assert.equal((await f.snapshot()).work.length, 1);
  }));

test('Q04 never-started expired request receives a Host-persisted continuation under a new grant', () =>
  usingFixture(async (f) => {
    await f.seed();
    const first = await f.nextWorkItem();
    const old = await f.reserveInitial({
      workItemId: 'WI-core-p1',
      deadlineMs: 5000,
    });
    await f.advance();
    const next = await f.nextWorkItem({ resumeWorkItemId: 'WI-core-p1' });
    assert.equal(next.status, 'CLAIMED');
    assert.equal(next.leaseGeneration, first.leaseGeneration + 1);
    const status = (await f.readInitialStatus('WI-core-p1')).initialAnalysis;
    assert.match(status.stages.jobAid.requestId, /^[a-f0-9]{64}$/u);
    const claim = await f.callTool('begin_dynamic_evaluation', {
      workItemId: 'WI-core-p1',
      requestId: status.stages.jobAid.requestId,
    });
    assert.equal(claim.status, 'RUNNING');
    assert.equal(claim.task.modelInput.savedWorkReconciliation, undefined);
    assert.notEqual(claim.attemptRef, old.attemptRef);
    const previous = (await f.snapshot()).attempts.find(
      (a) => a.operation_ref === old.attemptRef,
    );
    assert.equal(previous.status, 'TIMED_OUT');
    assert.equal(previous.claim_count, 0);
  }));

test('COMMITTING still-live attempt is not reclaimed when its queue lease expires first', () =>
  usingFixture(async (f) => {
    const { claim } = await opened(f);
    const saved = await f.callTool('save_assessment_work', saveArgs(f, claim));
    await f.advance(1740000);
    await f.callTool('heartbeat_action_attempt', {
      attemptRef: claim.attemptRef,
      workItemId: claim.task.workItemId,
      leaseToken: claim.leaseToken,
      leaseGeneration: claim.leaseGeneration,
    });
    await f.advance(1740000);
    await f.callTool('heartbeat_action_attempt', {
      attemptRef: claim.attemptRef,
      workItemId: claim.task.workItemId,
      leaseToken: claim.leaseToken,
      leaseGeneration: claim.leaseGeneration,
    });
    await f.advance(110000);
    await prepareExactCommit(f, claim, saved);
    const before = (await f.snapshot()).attempts.find(
      (a) => a.operation_ref === claim.attemptRef,
    );
    await f.advance(15000);
    assert.equal(
      (await f.nextWorkItem({ resumeWorkItemId: claim.task.workItemId }))
        .status,
      'IDLE',
    );
    const after = (await f.snapshot()).attempts.find(
      (a) => a.operation_ref === claim.attemptRef,
    );
    assert.equal(after.updated_at, before.updated_at);
    assert.equal(after.lease_expires_at, before.lease_expires_at);
    await f.advance(20000);
    assert.equal(
      (await f.nextWorkItem({ resumeWorkItemId: claim.task.workItemId }))
        .status,
      'CLAIMED',
    );
  }));

test('Q08 source correction after sealing refuses zero-model saved-work projection', () =>
  usingFixture(async (f) => {
    const { claim } = await opened(f);
    const saved = await f.callTool('save_assessment_work', saveArgs(f, claim));
    await f.advance();
    await f.nextWorkItem({ resumeWorkItemId: claim.task.workItemId });
    const requestId = (await f.readInitialStatus(claim.task.workItemId))
      .initialAnalysis.stages.jobAid.requestId;
    const resumed = await f.callTool('begin_dynamic_evaluation', {
      workItemId: claim.task.workItemId,
      requestId,
    });
    assert.ok(resumed.task.modelInput.savedWorkReconciliation);
    await f.correctSource(claim.task.workItemId);
    await assert.rejects(
      f.callTool(
        'commit_dynamic_evaluation_candidate',
        commitArgs(f, resumed, saved.workRevisionRef),
      ),
      /JOBAID_SOURCE_VERSION_CHANGED/u,
    );
    assert.equal(
      JSON.parse((await f.snapshot()).workItems[0].projection_json)
        .integratedAssessment,
      null,
    );
  }));

async function failTerminalAfterCas(f, claim, saved) {
  await f.sql
    .unsafe(`CREATE FUNCTION core_p1_late_terminal() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF OLD.status='COMMITTING' AND NEW.status='SUCCEEDED' THEN RAISE EXCEPTION 'CORE_P1_LATE_TERMINAL'; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER core_p1_late_terminal BEFORE UPDATE ON action_attempt FOR EACH ROW EXECUTE FUNCTION core_p1_late_terminal()`);
  await assert.rejects(
    f.callTool(
      'commit_dynamic_evaluation_candidate',
      commitArgs(f, claim, saved.workRevisionRef),
    ),
    (error) => /CORE_P1_LATE_TERMINAL/u.test(errorText(error)),
  );
}

test('Overall actual entry refuses an unacknowledged COMMITTING dynamic even after its projection CAS', () =>
  usingFixture(async (f) => {
    const { claim } = await opened(f);
    const saved = await f.callTool('save_assessment_work', saveArgs(f, claim));
    await failTerminalAfterCas(f, claim, saved);
    await assert.rejects(
      f.callTool('begin_overall_synthesis', {
        workItemId: claim.task.workItemId,
      }),
      /OPENCLAW_OVERALL_DYNAMIC_N_ATTEMPT_MISMATCH/u,
    );
    const snapshot = await f.snapshot();
    assert.equal(
      snapshot.attempts.filter(
        (a) => a.action_type === 'OPENCLAW_OVERALL_SYNTHESIS',
      ).length,
      0,
    );
    assert.equal(
      snapshot.attempts.find((a) => a.operation_ref === claim.attemptRef)
        .status,
      'COMMITTING',
    );
  }));

test('Overall UNKNOWN never enqueues another model run just because its input JAWR is COMPLETE', () =>
  usingFixture(async (f) => {
    const { claim } = await opened(f);
    const saved = await f.callTool('save_assessment_work', saveArgs(f, claim));
    await f.callTool(
      'commit_dynamic_evaluation_candidate',
      commitArgs(f, claim, saved.workRevisionRef),
    );
    const overall = await f.callTool('begin_overall_synthesis', {
      workItemId: claim.task.workItemId,
    });
    const overallSave = saveArgs(f, overall, 'saved-overall-work');
    overallSave.expectedWorkRevision = 1;
    await f.callTool('save_assessment_work', overallSave);
    await f.advance();
    assert.equal(
      (await f.nextWorkItem({ resumeWorkItemId: claim.task.workItemId }))
        .status,
      'CLAIMED',
    );
    const snapshot = await f.snapshot();
    const rows = snapshot.attempts.filter(
      (a) => a.action_type === 'OPENCLAW_OVERALL_SYNTHESIS',
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].operation_ref, overall.attemptRef);
    assert.equal(rows[0].status, 'TIMED_OUT');
    assert.equal(
      (await f.readInitialStatus(claim.task.workItemId)).initialAnalysis
        .nextOperation,
      null,
    );
    assert.equal(snapshot.work.length, 2);
  }));

for (const correctSecondary of [false, true]) test(correctSecondary
  ? 'secondary source correction during artifact I/O is rejected by the actual projection transaction'
  : 'unchanged secondary sources commit through the same source-locking projection transaction', () =>
  usingFixture(async (f) => {
    const context = await opened(f, 'WI-context');
    const evidence = structuredClone(
      context.claim.task.modelInput.sourceCatalog.find(
        (item) => item.kind === 'DOCUMENT_PASSAGE',
      ),
    );
    evidence.evidenceRef = 'CONSTRUCTED_CONTEXT:passage';
    const common = f.problem.common;
    const build = common.buildForWorkItemWithEvidence;
    common.buildForWorkItemWithEvidence = async (...args) => ({
      ...(await build(...args)),
      availableReadingEvidence: [evidence],
    });
    const { claim } = await opened(f, 'WI-primary');
    const ref = claim.task.modelInput.sourceCatalog.find(
      (item) =>
        item.kind === 'DOCUMENT_PASSAGE' && item.workItemId === 'WI-context',
    ).evidenceRef;
    assert.ok(
      claim.task.modelInput.sourceBindings.some(
        (binding) => binding.workItemId === 'WI-context',
      ),
    );
    await f.callTool('read_assessment_sources', {
      workItemId: 'WI-primary',
      attemptRef: claim.attemptRef,
      leaseToken: claim.leaseToken,
      leaseGeneration: claim.leaseGeneration,
      sourceRefs: [ref],
      purpose: '构造附属来源时序核查',
      context: 'EXACT',
    });
    const command = f.proposal(claim);
    command.overview += ` 附属来源条件 [[${ref}]]`;
    const args = { ...saveArgs(f, claim), workJson: JSON.stringify(command) };
    const saved = await f.callTool('save_assessment_work', args);
    let corrected = false;
    if (correctSecondary) f.armArtifactPersistHook(async () => {
        await f.correctSource('WI-context');
        corrected = true;
      });
    const result = await f.callTool(
      'commit_dynamic_evaluation_candidate',
      commitArgs(f, claim, saved.workRevisionRef),
    );
    assert.equal(corrected, correctSecondary);
    assert.equal(result.status, correctSecondary ? 'FAILED' : 'BASE_RULE_CANDIDATE_READY');
    const snapshot = await f.snapshot();
    const primary = snapshot.workItems.find(
      (row) => row.work_item_id === 'WI-primary',
    );
    assert.equal(primary.revision, correctSecondary ? 1 : 2);
    const integrated = JSON.parse(primary.projection_json).integratedAssessment;
    if (correctSecondary) assert.equal(integrated, null);
    else assert.equal(integrated.baseRules.workRevisionRef, saved.workRevisionRef);
    assert.equal(
      snapshot.workItems.find((row) => row.work_item_id === 'WI-context')
        .revision,
      correctSecondary ? 2 : 1,
    );
    assert.equal(snapshot.work.length, 1);
  }));

async function failSavedRound(f, claim) {
  const saved = await f.callTool('save_assessment_work', saveArgs(f, claim));
  const { contentHash, ...normal } = f.result(claim, saved.workRevisionRef);
  const failed = sealResultEnvelope({ ...normal, status: 'FAILED',
    businessOutcome: 'NOT_PRODUCED', modelOutput: null,
    errorCode: 'CONSTRUCTED_PROVIDER_TERMINAL_FAILURE',
    errorDetail: 'Synthetic provider explicitly reported a terminal failure.' });
  assert.equal((await f.callTool('commit_dynamic_evaluation_candidate', {
    ...commitArgs(f, claim, saved.workRevisionRef), result: failed,
  })).status, 'FAILED');
  return saved;
}

for (const change of ['none', 'actor-revoked', 'source-corrected', 'wrong-token'])
  test(`BLOCK original receipt reauthorizes exact saved grant: ${change}`, () =>
    usingFixture(async (f) => {
      const { queue, claim } = await opened(f);
      const saved = await failSavedRound(f, claim);
      const request = {workItemId:claim.task.workItemId,
        leaseToken:queue.leaseToken,leaseGeneration:queue.leaseGeneration};
      const block = (body=request) => f.hosted(() => f.dispatch.blockWorkItem(body));
      const first = await block();
      assert.equal(first.status, 'BLOCKED');
      assert.equal(first.replayed, false);
      if (change === 'actor-revoked') await f.revokeActor();
      if (change === 'source-corrected') await f.correctSource(claim.task.workItemId);
      const before = await f.snapshot();
      if (change === 'none') {
        const replay = await block();
        assert.deepEqual(replay, {...first,replayed:true});
        const exact = await f.hosted(() => f.workItems.readBlockedAutoProcessingLeaseReceipt({
          ...request, tenantId:f.tenantId,
        }));
        const readExact = (sourceBinding) => f.hosted(() => f.work.withActorScope(f.actorUserId,
          () => f.workItems.readBlockedAutoProcessingLeaseReceipt({
            ...request,tenantId:f.tenantId,sourceBinding,
          })));
        assert.ok(await readExact(exact.sourceBinding));
        for (const field of ['workItemId','requestId','actorUserId','documentId','documentVersionId',
          'sourceArtifactId','sourceFileSha256','sourceByteLength']) {
          const mismatched = {...exact.sourceBinding,
            [field]:field === 'sourceByteLength' ? exact.sourceBinding.sourceByteLength + 1 : `${exact.sourceBinding[field]}-other`};
          assert.equal(await readExact(mismatched), null);
        }
      } else {
        const denied = change === 'wrong-token'
          ? {...request,leaseToken:'11111111-1111-4111-8111-111111111111'} : request;
        await assert.rejects(block(denied));
      }
      const after = await f.snapshot();
      assert.deepEqual(after, before);
      assert.equal(after.work.length, 1);
      assert.equal(after.work[0].assessment_work_revision_id, saved.workRevisionRef);
      const attempt = after.attempts.find((a) => a.operation_ref === claim.attemptRef);
      assert.equal(attempt.status, 'FAILED');
      assert.equal(attempt.terminal_reason, 'CONSTRUCTED_PROVIDER_TERMINAL_FAILURE');
      assert.equal(attempt.cancel_reason, null);
    }));

test('BLOCK old queue qualification cannot release a new authorized grant', () =>
  usingFixture(async (f) => {
    const {queue,claim} = await opened(f);
    await f.callTool('save_assessment_work',saveArgs(f,claim));
    await f.advance();
    const next = await f.nextWorkItem({resumeWorkItemId:claim.task.workItemId});
    assert.equal(next.status, 'CLAIMED');
    assert.equal(next.leaseGeneration,queue.leaseGeneration+1);
    const before = await f.snapshot();
    await assert.rejects(f.hosted(() => f.dispatch.blockWorkItem({
      workItemId:claim.task.workItemId,leaseToken:queue.leaseToken,
      leaseGeneration:queue.leaseGeneration,
    })));
    assert.deepEqual(await f.snapshot(),before);
  }));


test('Overall consumes the new saved condition in its actual input and persisted artifact, then ACKs', () =>
  usingFixture(async (f) => {
    // Constructed source and model output; real Host services, SQL, artifact bytes.
    // This checks content transport, not model reasoning or production acceptance.
    const observations = {};
    const { queue, claim } = await opened(f);
    const initial = await f.readBrowserSnapshot(claim.task.workItemId);
    assert.equal(initial.latestAttempt.attemptId, claim.task.actionAttemptId);
    assert.ok(initial.latestAttempt.createdAt);
    assert.ok(initial.latestAttempt.startedAt);
    assert.equal(initial.latestAttempt.firstSavedAt, null);
    assert.equal(initial.latestAttempt.completedAt, null);
    const first = await f.callTool('save_assessment_work', saveArgs(f, claim));
    const updated = f.proposal(claim);
    const ref = claim.task.modelInput.sourceCatalog.find(item => item.kind === 'DOCUMENT_PASSAGE').evidenceRef;
    const condition = 'Do not use method M unless condition X is met.';
    const exception = 'Keep the original part number A-12, limit -0.25 and exception together.';
    assert.ok(f.original.source.units[0].payload.text.includes(condition));
    assert.ok(f.original.source.units[0].payload.text.includes(exception));
    updated.overview = `${condition} ${exception} Target condition X remains unverified. [[${ref}]]`;
    updated.issues[0].body = updated.overview;
    const second = await f.callTool('save_assessment_work', {
      ...saveArgs(f, claim, 'save-new-condition'), expectedWorkRevision: 1,
      workJson: JSON.stringify(updated),
    });
    const readback = await f.callTool('read_assessment_work', {
      attemptRef: claim.attemptRef, workItemId: claim.task.workItemId, requestId: 'save-new-condition',
    });
    observations.firstReadableObservedAt = new Date().toISOString();
    assert.equal(readback.revision.workRevisionRef, second.workRevisionRef);
    assert.notEqual(second.workRevisionRef, first.workRevisionRef);
    await f.callTool('commit_dynamic_evaluation_candidate', commitArgs(f, claim, second.workRevisionRef));
    const overall = await f.callTool('begin_overall_synthesis', { workItemId: claim.task.workItemId });
    const input = overall.modelInput.previousWork;
    assert.equal(input.workRevisionRef, second.workRevisionRef);
    assert.equal(input.workRevision, 2);
    assert.ok(JSON.stringify(input.content).includes(condition));
    assert.ok(JSON.stringify(input.content).includes(exception));
    const check = 'Condition X remains unverified; preserve A-12 and -0.25 together with its exception.';
    const finished = await f.callTool('commit_overall_candidate',
      commitArgs(f, overall, second.workRevisionRef, check));
    const artifact = await f.readArtifact(finished.overallSynthesis.artifact);
    assert.deepEqual(artifact.analysis, readback.revision);
    assert.equal(artifact.consistencyCheck, check);
    assert.ok(JSON.stringify(artifact.readingResult).includes(condition));
    assert.ok(JSON.stringify(artifact.readingResult).includes(exception));
    assert.equal(artifact.adopted, false);
    const ack = await f.acknowledgeWorkItem({ workItemId: claim.task.workItemId,
      leaseToken: queue.leaseToken, leaseGeneration: queue.leaseGeneration });
    observations.acknowledgementObservedAt = new Date().toISOString();
    assert.equal(ack.status, 'ACKNOWLEDGED');
    const snapshot = await f.snapshot();
    const read = await f.readBrowserSnapshot(claim.task.workItemId);
    const dynamic = snapshot.attempts.find(item => item.attempt_id === claim.task.actionAttemptId);
    const persistedOverall = snapshot.attempts.find(item => item.attempt_id === overall.task.actionAttemptId);
    const persistedInput = JSON.parse(persistedOverall.task_envelope_json).modelInput.modelInput.previousWork;
    assert.deepEqual(persistedInput, input);
    assert.equal(persistedOverall.status, 'SUCCEEDED');
    const firstSaved = snapshot.work.find(item => item.assessment_work_revision_id === first.workRevisionRef);
    assert.equal(read.latestAttempt.createdAt, new Date(dynamic.created_at).toISOString());
    assert.equal(read.latestAttempt.startedAt, new Date(dynamic.started_at).toISOString());
    assert.equal(read.latestAttempt.completedAt, new Date(dynamic.completed_at).toISOString());
    assert.equal(read.latestAttempt.firstSavedAt, new Date(firstSaved.created_at).toISOString());
    assert.equal(snapshot.work.length, 2);
    // No readiness transition or first-readable event is persisted by this protocol.
    console.log(JSON.stringify({ scenario: 'isolated-overall-content-consumption',
      modelCalls: 0, productionCalls: 0, requestRecordedAt: read.latestAttempt.createdAt,
      readyAt: null, startedAt: read.latestAttempt.startedAt,
      firstSavedAt: read.latestAttempt.firstSavedAt, firstReadablePersistedAt: null,
      executionCompletedAt: read.latestAttempt.completedAt, ...observations }));
  }));

test('semantic upgrade: legacy saved and sealed COMMITTING recover, new Overall rejects unsupported rating before seal', async () => {
  const f=await startCoreP1HostFixture({legacySemanticTasks:true});
  try {
    const {claim}=await opened(f);
    assert.equal(claim.task.modelInput.contentValidationVersion,undefined);
    assert.equal(claim.task.modelInput.sourceCatalog.find(item=>item.evidenceRef==='method:risk').classificationDefinitions,undefined);
    const proposal=f.proposal(claim);
    const ref=claim.task.modelInput.sourceCatalog.find(item=>item.kind==='DOCUMENT_PASSAGE').evidenceRef;
    proposal.issues[0].riskScenarios=[{scenario:'Synthetic loss of function',conditions:['exposure unknown'],method:'JA_AC_R01',
      severity:{label:'轻微',reason:'Historical unsupported inference',basisRefs:[ref]},likelihood:null,
      limitations:['frequency unknown'],controlComparison:'proposed inspection is not implemented'}];
    // Change the preparation policy while this old task is still RUNNING.
    f.setSemanticContract(true);
    const saved=await f.callTool('save_assessment_work',{...saveArgs(f,claim),workJson:JSON.stringify(proposal)});
    const args=await prepareExactCommit(f,claim,saved);
    // The pre-upgrade sealed task also recovers exactly after entering COMMITTING.
    const recovered=await f.callTool('commit_dynamic_evaluation_candidate',args);
    assert.equal(recovered.baseRules.workRevisionRef,saved.workRevisionRef);
    const overall=await f.callTool('begin_overall_synthesis',{workItemId:claim.task.workItemId});
    assert.equal(overall.modelInput.contentValidationVersion,'jobaid-semantic.v1');
    const mismatched=structuredClone(overall.task.modelInput);
    delete mismatched.modelInput.contentValidationVersion;
    assert.throws(()=>assertJobAidProblemTaskBinding(mismatched),/CONTENT_VALIDATION_VERSION_INVALID/);
    const before=await f.snapshot();
    await assert.rejects(f.callTool('commit_overall_candidate',commitArgs(f,overall,saved.workRevisionRef,'Synthetic comparison')),
      /SEVERITY_DEFINITION_REQUIRED/);
    const after=await f.snapshot();
    assert.deepEqual(after.attempts,before.attempts);
    assert.deepEqual(after.work,before.work);
  } finally {await f.close();}
});
