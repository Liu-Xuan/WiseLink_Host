import assert from 'node:assert/strict';
import test from 'node:test';
import { consumeHierarchicalWikiIdle } from '../scripts/consume-hierarchical-wiki-queue.mjs';
import {
  consumeAutomaticWorkItemQueueTick,
  automaticWorkItemQueueMode,
} from '../scripts/consume-hosted-work-item.mjs';

const options = {
  enabled: true,
  checkpointRoot: '/synthetic/checkpoint',
  endpointKey: 'synthetic-endpoint',
  runBudget: {
    timeoutMs: 60000,
    maxCompletionTokens: 32000,
    maxModelRequests: 4,
    reasoningEffort: 'low',
  },
};
const memory = () => {
  const entries = new Map();
  return {
    entries,
    readOptional: async (key) => entries.get(key) ?? null,
    write: async (key, value) => entries.set(key, value),
    writeOnce: async (key, value) => {
      assert.equal(entries.has(key), false);
      entries.set(key, value);
    },
    withActiveClaimOwner: async (operation) => operation(),
  };
};

test('unchanged idle tick never prepares a model or a checkpoint', async () => {
  let calls = 0;
  const value = await consumeHierarchicalWikiIdle(options, {
    checkpoint: memory(),
    callTool: async (name, input) => {
      assert.equal(name, 'next_hierarchical_wiki');
      assert.deepEqual(input, {});
      calls++;
      return { status: 'IDLE' };
    },
    createGatewayPreparer: () => assert.fail('no provider for idle'),
    createCheckpoint: () => assert.fail('no task for idle'),
  });
  assert.equal(value.status, 'IDLE');
  assert.equal(calls, 1);
});

for (const kind of ['SUMMARY', 'MATTER'])
  test(`${kind} preparing without terminal proof stays pinned even when Host reports saved`, async () => {
    const checkpoint = memory(),
      store = memory();
    const active = {
      schemaVersion: 1,
      kind,
      attemptRef: 'AQ-exact',
      phase: 'PREPARING',
      ...(kind === 'MATTER'
        ? { matterId: 'MAT-exact' }
        : { summaryId: 'DS-exact' }),
    };
    await checkpoint.write('active-wiki', active);
    const value = await consumeHierarchicalWikiIdle(options, {
      checkpoint,
      createCheckpoint: async () => store,
      callTool: () => assert.fail('no new admission'),
      createGatewayPreparer: () => () => assert.fail('no new provider'),
      consumeSummary: async () => ({ status: 'DERIVED_SUMMARY_SAVED' }),
      consumeMatter: async () => ({ status: 'MATTER_WORK_SAVED' }),
    });
    assert.equal(value.status, 'WIKI_ATTENTION');
    assert.equal(value.errorCode, 'WIKI_PROVIDER_TERMINAL_UNKNOWN');
    assert.deepEqual(await checkpoint.readOptional('active-wiki'), active);
  });

for (const lost of [false, true])
  test(`source revoked before gateway uses exact metadata cleanup, uncertain cancellation=${lost}`, async () => {
    const checkpoint = memory(),
      store = memory();
    const calls = [];
    const value = await consumeHierarchicalWikiIdle(options, {
      checkpoint,
      createCheckpoint: async () => store,
      createGatewayPreparer: () => () =>
        assert.fail('source failed before model'),
      consumeSummary: async () => {
        throw new Error('SOURCE_UNAVAILABLE');
      },
      callTool: async (name, input) => {
        calls.push({ name, input });
        if (name === 'next_hierarchical_wiki')
          return {
            status: 'SUMMARY_PENDING',
            summaryId: 'DS-exact',
            attemptRef: 'AQ-exact',
          };
        assert.equal(name, 'hierarchical_wiki_cleanup');
        assert.deepEqual(input, {
          kind: 'SUMMARY',
          subjectId: 'DS-exact',
          attemptRef: 'AQ-exact',
          operation: 'CANCEL',
        });
        if (lost) throw new Error('CONTROL_RESPONSE_UNKNOWN');
        return {
          summaryId: 'DS-exact',
          attemptRef: 'AQ-exact',
          status: 'CANCELLED',
        };
      },
    });
    assert.equal(value.status, 'WIKI_ATTENTION');
    assert.equal(calls.length, 2);
    assert.equal(!!(await checkpoint.readOptional('active-wiki')), lost);
  });

test('an unresolved Wiki owns the auto-queue lock before newly arrived user work', async () => {
  const checkpoint = memory();
  await checkpoint.write('active-wiki', {
    schemaVersion: 1,
    kind: 'MATTER',
    matterId: 'MAT-exact',
    attemptRef: 'AQ-exact',
    phase: 'PREPARING',
  });
  const result = await consumeAutomaticWorkItemQueueTick(
    {},
    {
      checkpoint,
      nextWorkItem: () => assert.fail('UNKNOWN must block new work'),
      acknowledgeWorkItem: () => assert.fail('no work claim'),
      consumeWorkItem: () => assert.fail('no user model'),
      readInitialStatus: () => assert.fail('no user read'),
      consumeWikiIdle: async () => ({
        status: 'WIKI_ATTENTION',
        errorCode: 'WIKI_PROVIDER_TERMINAL_UNKNOWN',
      }),
    },
  );
  assert.equal(result.status, 'WIKI_ATTENTION');
});

test('durable Host COMMITTING retains the exact pointer and exposes commit recovery attention', async () => {
  const checkpoint = memory(),
    store = memory();
  const result = await consumeHierarchicalWikiIdle(options, {
    checkpoint,
    createCheckpoint: async () => store,
    createGatewayPreparer: () => () => assert.fail('no redispatch'),
    consumeMatter: async () => {
      throw new Error('SOURCE_UNAVAILABLE');
    },
    callTool: async (name) =>
      name === 'next_hierarchical_wiki'
        ? {
            status: 'MATTER_PENDING',
            matterId: 'MAT-exact',
            attemptRef: 'AQ-exact',
          }
        : {
            status: 'COMMITTING',
            cancelResult: 'TOO_LATE',
            matterId: 'MAT-exact',
            attemptRef: 'AQ-exact',
          },
  });
  assert.equal(result.errorCode, 'WIKI_HOST_COMMIT_PENDING');
  assert.equal(
    (await checkpoint.readOptional('active-wiki')).attemptRef,
    'AQ-exact',
  );
});

test('Wiki option requires the normal auto queue and cannot mix operator recovery', () => {
  const args = [
    '--auto-queue',
    '--wiki-idle',
    '--wiki-timeout-ms',
    '60000',
    '--wiki-max-completion-tokens',
    '32000',
    '--wiki-max-model-requests',
    '4',
  ];
  assert.equal(automaticWorkItemQueueMode(args), true);
  assert.throws(
    () => automaticWorkItemQueueMode(['--wiki-idle']),
    /OPTIONS_INVALID/,
  );
  assert.throws(
    () => automaticWorkItemQueueMode([...args, '--repair-stopped-claim']),
    /OPTIONS_INVALID/,
  );
  assert.throws(
    () =>
      automaticWorkItemQueueMode([
        '--auto-queue',
        '--wiki-max-model-requests',
        '4',
      ]),
    /OPTIONS_INVALID/,
  );
});
