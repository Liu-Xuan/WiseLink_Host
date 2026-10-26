// Exact f1a contract -> actual Native consumer/gateway/one-shot adapter -> fake
// Chat. The CLI and Host callbacks are synthetic; no real business is executed.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { syntheticHostFixture } from './fixtures/program-agent-host-f1a.fixture.mjs';
import { createProgramAgentLiteLLMDispatch } from './program-agent-litellm-process.mjs';

const [apiBase, root, pythonBinary] = process.argv.slice(2);
const dispatch = createProgramAgentLiteLLMDispatch({ apiBase, pythonBinary,
  apiKey: 'synthetic-bearer-only', headers: { 'x-api-key': 'synthetic-header-only' } });
const f = await syntheticHostFixture(null, { root, providerDispatch: dispatch });
const outcome = await f.run();
assert.equal(outcome.status, 'INITIAL_STAGE_SAVED');
const result = (await f.checkpoint.readOptional('program-agent-candidate.result')).value;
const receipts = [];
for (const ordinal of [1, 2]) {
  const receipt = JSON.parse(await readFile(join(result.runDirectory, `dispatch-${ordinal}.adapter/receipt.json`)));
  assert.equal(receipt.complete, true); assert.equal(receipt.maxOutputTokens, 131072);
  assert.deepEqual(receipt.executionModel, f.task.executionModel);
  assert.equal(receipt.nativeAdmission.ordinal, ordinal);
  assert.equal(receipt.nativeAdmission.maxOutputTokens, 131072);
  assert.equal(receipt.generationDeadlineAt, result.generationDeadlineAt);
  assert.equal(receipt.internalHttpAttemptCount, 1); assert.equal(receipt.blockedAdditionalHttpAttempts, 0);
  assert.equal(receipt.terminal.rawFinishReason, 'stop');
  receipts.push(receipt);
}
assert.equal(f.state.providerCalls, 2); assert.equal(f.state.saveCalls, 1); assert.equal(f.state.commitCalls, 1);
assert.equal(f.status().integratedAssessmentSummary.overallSynthesis.modelRequests, 0);
const before = JSON.stringify(await f.checkpoint.readOptional('program-save-request'));
await assert.rejects(f.run(), /INITIAL_COMPLETED_STAGE_HOST_DRIFT/u);
assert.equal(f.state.providerCalls, 2); assert.equal(f.state.saveCalls, 1);
assert.equal(JSON.stringify(await f.checkpoint.readOptional('program-save-request')), before);
await writeFile(join(root, 'contract-adapter-result.json'), JSON.stringify({ outcome,
  selection: f.task.executionModel, policy: f.task.modelInput.agentPolicy, receipts,
  providerCalls: 2, saveCalls: 1, commitCalls: 1, recoveryDispatches: 0,
  independentExactReads: f.state.calls.filter(row => row.name === 'read_assessment_work'),
  deterministicOverall: f.status().integratedAssessmentSummary.overallSynthesis,
  realCLI: false, realModel: false, realHost: false, actualAdapter: true,
  actualUsageTokens: null, usageBasis: 'SYNTHETIC_NO_REAL_USAGE' }, null, 2) + '\n');
console.log(JSON.stringify({ status: outcome.status, actualAdapter: true, realCLI: false,
  realModel: false, realHost: false, providerDispatches: 2, httpAttempts: 2, maxTokensPerPost: 131072 }));
