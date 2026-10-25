import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePayload } from '../scripts/validate-payload.mjs';

const discovery = runtime => ({ runtime, provider: 'AIRBUS', query: 'synthetic query',
  resultStatus: 'ZERO_RESULT', observedAt: null, candidates: [], accessRestricted: false,
  truncated: false, partialOnly: false, excludedNonOemCandidateCount: 0, error: null });

for (const runtime of ['FEISHU_HOSTED_OPENCLAW', 'CODEX']) {
  test(`${runtime} discovery accepts server-stamped metadata without inventing historical app identity`, () => {
    const historical = discovery(runtime);
    assert.doesNotThrow(() => validatePayload('discovery-output', historical));
    assert.equal(Object.hasOwn(historical, 'runtimeAppId'), false);
    assert.doesNotThrow(() => validatePayload('discovery-output', {
      ...historical, runtimeAppId: runtime === 'CODEX' ? 'app_17gr74pbere' : 'app_17c3zn24kv2',
    }));
  });
}

test('discovery rejects unknown runtime and authority input rather than treating identity metadata as a grant', () => {
  assert.throws(() => validatePayload('discovery-output', discovery('CALLER_SELECTED')), /DISCOVERY_RUNTIME_INVALID/u);
  assert.throws(() => validatePayload('discovery-output', { ...discovery('CODEX'), leaseToken: 'forged' }));
});
