// Short synthetic lifecycle fixture: fake CLI -> actual gateway -> one-shot
// Python adapter -> loopback fake Chat. It never registers a provider or SAVE.
import assert from 'node:assert/strict';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { programRecoveryData } from './program-recovery-fixture.mjs';
import { createProgramAgentLiteLLMDispatch } from './program-agent-litellm-process.mjs';
import { runProgramAgentGateway } from './program-agent-gateway.mjs';
import { createCheckpointStore } from '../skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs';
import { invokeHostedProgramAssessmentAgent } from '../skills/wiselink-research-and-synthesize/scripts/run-program-assessment.mjs';

const [apiBase, root, scenario, pythonBinary] = process.argv.slice(2);
const sha = value => createHash('sha256').update(value).digest('hex');
const controller = new AbortController();
const checkpoint = await createCheckpointStore(join(root, 'parent'));
const data = programRecoveryData();
const fakeCli = join(root, 'fake-codex.mjs');
await writeFile(fakeCli, `#!${process.execPath}
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
for await (const _ of process.stdin) {}
const config = await readFile(join(process.env.CODEX_HOME, 'config.toml'), 'utf8');
await writeFile(join(dirname(process.env.CODEX_HOME), 'synthetic-control.json'), JSON.stringify({
  url: process.env.WISELINK_ASSESSMENT_URL, token: process.env.WISELINK_ASSESSMENT_TOKEN }), { mode: 0o600 });
const response = await fetch(config.match(/base_url = "([^"]+)"/)[1] + '/responses', {
  method: 'POST', headers: { authorization: 'Bearer ' + process.env.WISELINK_PROGRAM_AGENT_LOCAL_TOKEN,
    'content-type': 'application/json' }, body: JSON.stringify({ model: 'glm-5.3', stream: true,
      input: [{ role: 'user', content: 'Synthetic lifecycle test, no real model.' }] }) });
await response.arrayBuffer();
if (!response.ok) process.exit(3);
await writeFile(process.argv[process.argv.indexOf('--output-last-message') + 1], '{}');
console.log(JSON.stringify({ type: 'turn.completed' }));
`, { mode: 0o700 });
let leaseInvalid = false, prepared, providerCalls = 0, saveCalls = 0;
const taskDeadline = new Date(Date.now() + (scenario === 'deadline' ? 8_000 : 30_000)).toISOString();
const options = { modelExecutor: 'CODEX', assessmentCheckpoint: checkpoint,
  assessmentBinding: data.assessmentBinding, sessionDiscriminator: 'synthetic-runtime-lifecycle',
  executionModel: { modelRef: 'miaoda/glm-5.3', displayName: 'Synthetic', providerKind: 'BUILT_IN',
    settingsRevision: 1, selectedAt: '2026-10-26T00:00:00Z' },
  agentPolicy: { schemaVersion: 'wiselink.native.program_agent_policy.proposal.v1',
    maxModelRequests: 1, maxToolCalls: 2, maxOutputTokens: 131072, timeoutSeconds: 30 },
  taskDeadline, signal: controller.signal,
  codexOptions: { codexBinary: fakeCli, runRoot: join(root, 'runs') },
  heartbeat: async () => { if (leaseInvalid) throw new Error('SYNTHETIC_FENCE_INVALID_PRIVATE_DETAIL'); },
  recordAssessmentProgramProgress: async ({ phase }) => ({ phase, status: 'SYNTHETIC_ACK' }),
  readAssessmentSources: async () => { throw new Error('NO_READ_EXPECTED'); },
  readAssessmentWork: async () => { throw new Error('NO_READ_EXPECTED'); },
  saveAssessmentWork: async () => { saveCalls++; throw new Error('NO_SAVE_ALLOWED'); },
};
const adapter = createProgramAgentLiteLLMDispatch({ pythonBinary, apiBase, apiKey: 'synthetic-not-a-credential' });
const dependencies = { providerDispatch: async request => { providerCalls++; return adapter(request); },
  runCodexAgent: async input => runProgramAgentGateway({ ...input, onRunPrepared: async value => {
    await input.onRunPrepared(value); prepared = value;
  } }) };
const invoke = () => invokeHostedProgramAssessmentAgent({ operation: 'EVALUATE_JOBAID', modelInput: data.modelInput },
  options, dependencies);
let settled = false;
const running = invoke().then(value => ({ value }), error => ({ error: error.message })).finally(() => { settled = true; });
if (scenario !== 'normal') {
  const until = Date.now() + 12_000;
  let observed;
  while (Date.now() < until && !settled) {
    if (prepared) {
      const path = join(prepared.runDirectory, 'dispatch-1.adapter/upstream-response.body');
      if (await stat(path).then(s => s.size > 0).catch(() => false)) {
        observed = await readFile(path); break;
      }
    }
    await new Promise(accept => setTimeout(accept, 10));
  }
  assert.ok(observed?.length > 0, 'cancel only after actual durable HTTP entity bytes');
  await writeFile(join(root, 'capture-before-stop.json'), JSON.stringify({ byteLength: observed.length,
    sha256: sha(observed), generationDeadlineAt: taskDeadline, scenario }) + '\n');
  if (scenario === 'cancel') controller.abort();
  else if (scenario === 'lease') {
    leaseInvalid = true;
    const control = JSON.parse(await readFile(join(prepared.runDirectory, 'synthetic-control.json')));
    await fetch(control.url, { method: 'POST', headers: { authorization: 'Bearer ' + control.token,
      'content-type': 'application/json' }, body: JSON.stringify({ method: 'tools/call',
        params: { name: 'read_sources', arguments: { sourceRefs: [data.modelInput.availableSources[0].ref],
          purpose: 'Synthetic heartbeat invalidation while adapter is in flight' } } }) }).catch(() => {});
  }
}
const outcome = await running;
assert.match(outcome.error, scenario === 'normal' ? /PROGRAM_AGENT_CANDIDATE_INVALID/u : /PROGRAM_AGENT_OUTCOME_UNKNOWN/u);
const processReceipt = JSON.parse(await readFile(join(prepared.runDirectory, 'ledger/dispatch-1.adapter-process-result.json')));
const receipt = JSON.parse(await readFile(join(prepared.runDirectory, 'dispatch-1.adapter/receipt.json')));
const startedPath = join(prepared.runDirectory, 'ledger/dispatch-1.started.json');
const before = await readFile(startedPath), started = JSON.parse(before);
assert.equal(started.generationDeadlineAt, taskDeadline);
assert.equal(receipt.generationDeadlineAt, taskDeadline);
assert.equal(receipt.deadlineBasis, 'SEALED_ABSOLUTE');
assert.equal(processReceipt.closed, true);
assert.equal(processReceipt.killedAfterGrace, false);
assert.equal(receipt.internalHttpAttemptCount, 1);
assert.equal(receipt.blockedAdditionalHttpAttempts, 0);
assert.equal(receipt.maxOutputTokens, 131072);
if (scenario !== 'normal') {
  assert.equal(receipt.complete, false);
  assert.equal(receipt.cancelled, true);
  assert.equal((await readFile(join(prepared.runDirectory, 'dispatch-1.adapter/response.sse'))).length, 0);
  assert.ok(receipt.upstreamResponseByteLength > 0);
  const stop = JSON.parse(await readFile(join(prepared.runDirectory, 'ledger/session-stop.json')));
  assert.equal(stop.inFlightAtReturn, 0);
  if (scenario === 'lease') assert.equal(stop.code, 'PROGRAM_AGENT_HEARTBEAT_FAILED');
  if (scenario === 'cancel') assert.equal(stop.code, 'PROGRAM_AGENT_USER_CANCELLED');
  if (scenario === 'deadline') assert.ok(Date.now() >= Date.parse(taskDeadline));
}
await assert.rejects(invoke(), /PROGRAM_AGENT_OUTCOME_UNKNOWN/u);
assert.equal(providerCalls, 1); assert.equal(saveCalls, 0);
assert.deepEqual(await readFile(startedPath), before);
assert.equal(await checkpoint.readOptional('program-agent-candidate.result'), null);
assert.equal(await checkpoint.readOptional('program-save-request'), null);
await writeFile(join(root, 'runtime-result.json'), JSON.stringify({ scenario, outcome, providerCalls, saveCalls,
  parentSignalForwarded: true, recoveryDispatches: 0, generationDeadlineAt: taskDeadline,
  processReceipt, receipt, realCodex: false, realModel: false, realHost: false }, null, 2) + '\n');
console.log(JSON.stringify({ scenario, providerCalls, saveCalls, recoveryDispatches: 0,
  capturedBytes: receipt.upstreamResponseByteLength, processClosed: processReceipt.closed,
  errorCode: receipt.errorCode, deadline: taskDeadline }));
