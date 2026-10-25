import assert from 'node:assert/strict';
import test from 'node:test';
import { createHostAutoWorkItemQueueClient } from '../scripts/run-hosted-review-turn.mjs';

for (const modelExecutor of ['HOSTED', 'CODEX']) {
  test(`${modelExecutor} queue controls use only its fixed endpoint family`, async () => {
    const requests = [];
    const name = modelExecutor === 'CODEX' ? 'codex' : 'openclaw';
    const client = createHostAutoWorkItemQueueClient({
      modelExecutor,
      hostMcpUrl: `https://host.example/app/test/openapi/wiselink/${name}-mcp`,
      headers: { 'X-Api-Key': 'synthetic-test-key' },
    }, async (url, init) => {
      requests.push({ path: new URL(url).pathname, ...init });
      return { ok: true, headers: { get: () => 'application/json' },
        json: async () => ({ accepted: true }) };
    });
    const binding = { workItemId: 'WI-test', leaseToken: 'synthetic-lease', leaseGeneration: 4 };
    await client.nextWorkItem({ resumeWorkItemId: binding.workItemId });
    await client.acknowledgeWorkItem(binding);
    await client.blockWorkItem(binding);
    assert.deepEqual(requests.map(({ path }) => path),
      ['next-work-item', 'ack-work-item', 'block-work-item'].map(route =>
        `/app/test/openapi/wiselink/${modelExecutor === 'CODEX' ? 'codex-' : ''}${route}`));
    assert.deepEqual(JSON.parse(requests[1].body), binding);
    assert.equal(requests[1].headers['X-Api-Key'], 'synthetic-test-key');
    assert.ok(requests.every(({ redirect }) => redirect === 'error'));
  });
}

test('executor/endpoint mismatch and unsupported executor fail before any queue request', () => {
  let calls = 0;
  const transport = () => { calls += 1; throw new Error('must not call'); };
  for (const [modelExecutor, endpoint] of [
    ['CODEX', 'openclaw'], ['HOSTED', 'codex'], ['UNRECOGNIZED', 'openclaw'],
  ]) {
    assert.throws(() => createHostAutoWorkItemQueueClient({
      modelExecutor, hostMcpUrl: `https://host.example/openapi/wiselink/${endpoint}-mcp`,
    }, transport), /AUTO_WORK_ITEM_QUEUE_ENDPOINT_INVALID|MODEL_EXECUTOR_UNSUPPORTED/u);
  }
  assert.equal(calls, 0);
});
