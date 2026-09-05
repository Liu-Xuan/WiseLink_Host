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
    await assert.rejects(
      consumePendingReviewTurn(options, {
        callTool: async (name, args) => {
          calls.push({ name, args });
          if (name === 'get_pending_review_turn') return { busy: false, next };
          if (name === 'begin_review_turn')
            return { status: 'RUNNING', attemptRef: 'AQ-2' };
          if (name === 'commit_review_turn_candidate')
            throw new Error('REVIEW_COMMIT_OUTCOME_UNKNOWN');
          return { status: 'CANCELLED' };
        },
        runTurn: async (_input, dependencies) => {
          await dependencies.callTool('begin_review_turn', {});
          if (commitStarted)
            await dependencies.callTool('commit_review_turn_candidate', {});
          throw new Error('REVIEW_MODEL_OUTPUT_INVALID');
        },
      }),
    );
    const cancel = calls.find(({ name }) => name === 'cancel_action_attempt');
    if (commitStarted) assert.equal(cancel, undefined);
    else assert.equal(cancel.args.attemptRef, 'AQ-2');
  }
});
