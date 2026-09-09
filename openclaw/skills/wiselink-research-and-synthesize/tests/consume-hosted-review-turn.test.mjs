import assert from 'node:assert/strict';
import test from 'node:test';
import { consumePendingReviewTurn } from '../scripts/consume-hosted-review-turn.mjs';

const options = {
  workItemId: 'WI-1',
  checkpointRoot: '/tmp/review-consumer-test',
};
const next = {
  reviewConversationRef: 'RC-1',
  reviewTurnRef: 'RT-2',
  requestId: 'request-2',
  turnNo: 2,
};

test('idle and busy ticks make no driver/model calls', async () => {
  for (const busy of [false, true]) {
    const result = await consumePendingReviewTurn(options, {
      callTool: async (name, args) => {
        assert.equal(name, 'get_pending_review_turn');
        assert.deepEqual(args, { workItemId: 'WI-1' });
        return { busy, next: null };
      },
      runTurn: () => assert.fail('Driver must not run'),
      invokeModel: () => assert.fail('Model must not run'),
    });
    assert.equal(result.status, busy ? 'BUSY' : 'IDLE');
  }
});

test('one tick dispatches exactly the persisted next turn with its own checkpoint', async () => {
  let runs = 0;
  const result = await consumePendingReviewTurn(options, {
    callTool: async () => ({ busy: false, next }),
    runTurn: async (input) => {
      runs += 1;
      assert.deepEqual(input, {
        reviewConversationRef: 'RC-1',
        requestId: 'request-2',
        checkpointDir: '/tmp/review-consumer-test/RT-2',
      });
      return { ok: true };
    },
  });
  assert.equal(runs, 1);
  assert.equal(result.status, 'CANDIDATE_SAVED');
});

test('pre-commit failure stops the exact attempt; an uncertain commit is never cancelled', async () => {
  for (const commitStarted of [false, true]) {
    const calls = [];
    const run = consumePendingReviewTurn(options, {
        callTool: async (name, args) => {
          calls.push({ name, args });
          if (name === 'get_pending_review_turn') return { busy: false, next };
          if (name === 'begin_review_turn')
            return { status: 'RUNNING', attemptRef: 'AQ-2' };
          if (name === 'commit_review_turn_candidate')
            throw new Error('REVIEW_COMMIT_OUTCOME_UNKNOWN');
          return { status: 'CANCELLED', attemptRef: 'AQ-2' };
        },
        runTurn: async (_input, dependencies) => {
          await dependencies.callTool('begin_review_turn', {});
          if (commitStarted)
            await dependencies.callTool('commit_review_turn_candidate', {});
          throw new Error('REVIEW_MODEL_OUTPUT_INVALID');
        },
      });
    if (commitStarted) await assert.rejects(run, /REVIEW_COMMIT_OUTCOME_UNKNOWN/u);
    else assert.deepEqual(await run, {
      status: 'REQUIRES_ATTENTION', reviewTurnRef: 'RT-2', attemptRef: 'AQ-2',
      errorCode: 'REVIEW_MODEL_OUTPUT_INVALID', attemptStatus: 'CANCELLED', candidateOnly: true,
    });
    const cancel = calls.find(({ name }) => name === 'cancel_action_attempt');
    if (commitStarted) assert.equal(cancel, undefined);
    else assert.equal(cancel.args.attemptRef, 'AQ-2');
  }
});

test('unconfirmed or wrong-attempt cancellation remains a consumer error', async () => {
  for (const stopped of [{ status: 'CANCELLED', attemptRef: 'AQ-other' }, { status: 'RUNNING', attemptRef: 'AQ-2' }]) {
    await assert.rejects(consumePendingReviewTurn(options, {
      callTool: async (name) => name === 'get_pending_review_turn' ? { busy: false, next }
        : name === 'begin_review_turn' ? { status: 'RUNNING', attemptRef: 'AQ-2' } : stopped,
      runTurn: async (_options, { callTool }) => {
        await callTool('begin_review_turn', {});
        throw new Error('REVIEW_MODEL_INVALID');
      },
    }), /ATTEMPT_STOP_FAILED:HOSTED_REVIEW_STOP_NOT_CONFIRMED/u);
  }
});

test('a definite Host validation rejection and exact unprepared readback end only the failed attempt', async () => {
  const calls = [];
  const result = await rejectedCommit(calls);
  assert.equal(result.status, 'REQUIRES_ATTENTION');
  assert.equal(result.errorCode, 'JOBAID_IMPORTANT_EVENT_CATEGORY');
  assert.equal(result.attemptStatus, 'CANCELLED');
  assert.deepEqual(calls.map(({ name }) => name), [
    'get_pending_review_turn', 'begin_review_turn', 'commit_review_turn_candidate', 'cancel_action_attempt',
  ]);
  assert.deepEqual(calls.at(-1).args, {
    attemptRef: 'AQ-2', reason: 'HOSTED_REVIEW_EXECUTION_FAILED:JOBAID_IMPORTANT_EVENT_CATEGORY',
  });
});

test('uncertain, mismatched, prepared and terminal commit outcomes never authorize cancellation', async () => {
  for (const overrides of [
    { receivedHostToolError: false }, { hostErrorCode: null },
    { code: 'HOST_MCP_COMMIT_READBACK_FAILED' }, { readback: null },
    { readback: { attemptRef: 'AQ-other' } }, { readback: { taskType: 'OTHER' } },
    { readback: { status: 'COMMITTING' } }, { readback: { status: 'SUCCEEDED' } },
    { readback: { commitStartedAt: '2026-09-09T08:33:09Z' } },
    { readback: { resultContentHash: 'sealed' } },
    { readback: { projectionApplied: true } }, { readback: { recoveryAvailable: true } },
  ]) {
    const calls = [];
    await assert.rejects(rejectedCommit(calls, overrides), /HOST_MCP_COMMIT/u);
    assert.equal(calls.some(({ name }) => name === 'cancel_action_attempt'), false);
    assert.equal(calls.filter(({ name }) => name === 'commit_review_turn_candidate').length, 1);
  }
});

test('a race across the Host commit cutoff remains an error without replay', async () => {
  const calls = [];
  await assert.rejects(rejectedCommit(calls, { cancelError: 'ACTION_ATTEMPT_COMMIT_CUTOFF' }),
    /JOBAID_IMPORTANT_EVENT_CATEGORY;ATTEMPT_STOP_FAILED:ACTION_ATTEMPT_COMMIT_CUTOFF/u);
  assert.equal(calls.filter(({ name }) => name === 'cancel_action_attempt').length, 1);
  assert.equal(calls.filter(({ name }) => name === 'commit_review_turn_candidate').length, 1);
});

function rejectedCommit(calls, overrides = {}) {
  return consumePendingReviewTurn(options, {
    callTool: async (name, args) => {
      calls.push({ name, args });
      if (name === 'get_pending_review_turn') return { busy: false, next };
      if (name === 'begin_review_turn') return { status: 'RUNNING', attemptRef: 'AQ-2' };
      if (name === 'commit_review_turn_candidate') throw Object.assign(new Error('HOST_REJECTED'), {
        receivedHostToolError: overrides.receivedHostToolError ?? true,
        hostErrorCode: 'hostErrorCode' in overrides ? overrides.hostErrorCode : 'JOBAID_IMPORTANT_EVENT_CATEGORY',
      });
      if (overrides.cancelError) throw new Error(overrides.cancelError);
      return { status: 'CANCELLED', attemptRef: 'AQ-2' };
    },
    runTurn: async (_input, { callTool }) => {
      await callTool('begin_review_turn', {});
      try {
        await callTool('commit_review_turn_candidate', {});
      } catch {
        // Same exact-identity readback and error contract as the orchestrator.
        throw Object.assign(new Error('HOST_MCP_COMMIT_OUTCOME_UNKNOWN'), {
          code: overrides.code ?? 'HOST_MCP_COMMIT_OUTCOME_UNKNOWN',
          readback: overrides.readback === null ? null : {
            attemptRef: 'AQ-2', taskType: 'OPENCLAW_INTERACTIVE_REVIEW', status: 'RUNNING',
            commitStartedAt: null, resultContentHash: null,
            recoveryAvailable: false, projectionApplied: false, ...overrides.readback,
          },
        });
      }
    },
  });
}
