// One synthetic request through the actual Native gateway and pinned adapter.
// No real Codex, model, Host, SAVE callback or consumer registration.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { runProgramAgentGateway } from './program-agent-gateway.mjs';
import { programRecoveryData } from './program-recovery-fixture.mjs';
import { prepareProgramAgentMaterials } from '../skills/wiselink-research-and-synthesize/scripts/program-assessment-materials.mjs';

const [endpoint, root, scenario] = process.argv.slice(2);
const data = programRecoveryData();
const materials = await prepareProgramAgentMaterials(data.modelInput, {
  assessmentBinding: data.assessmentBinding, assessmentCheckpoint: { readOptional: async () => null } });
const binary = join(root, 'fake-codex.mjs');
await writeFile(binary, `#!${process.execPath}
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
for await (const _ of process.stdin) {}
const config = await readFile(join(process.env.CODEX_HOME, 'config.toml'), 'utf8');
const url = config.match(/base_url = "([^"]+)"/)[1] + '/responses';
const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json',
  authorization: 'Bearer ' + process.env.WISELINK_PROGRAM_AGENT_LOCAL_TOKEN },
  body: JSON.stringify({ model: 'glm-5.3', stream: true,
    input: [{ role: 'user', content: 'Synthetic actual gateway budget request.' }] }) });
await response.arrayBuffer();
if (response.status !== 200) throw new Error('SYNTHETIC_RESPONSE_NOT_ACCEPTED');
await writeFile(process.argv[process.argv.indexOf('--output-last-message') + 1], '{}');
console.log(JSON.stringify({ type: 'turn.completed' }));
`, { mode: 0o700 });
const executionModel = { modelRef: 'miaoda/glm-5.3', displayName: 'Synthetic', providerKind: 'BUILT_IN',
  settingsRevision: 1, selectedAt: '2026-10-26T00:00:00Z' };
let dispatches = 0, prepared;
const options = { requestId: 'synthetic-adapter-budget', binding: { synthetic: true }, materials,
  executionModel, codexOptions: { codexBinary: binary, runRoot: join(root, 'runs') },
  policy: { schemaVersion: 'wiselink.native.program_agent_policy.proposal.v1',
    maxModelRequests: 1, maxOutputTokens: 131072, maxToolCalls: 1, timeoutSeconds: 30 },
  generationDeadlineAt: new Date(Date.now() + 30_000).toISOString(),
  onRunPrepared: async value => { prepared = value; },
  readAssessmentSources: async () => { throw new Error('NO_SOURCE_READ_EXPECTED'); },
  readAssessmentWork: async () => { throw new Error('NO_WORK_READ_EXPECTED'); },
  providerDispatch: async request => {
    dispatches++;
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientRequestBytes: request.clientRequestBytes.toString('base64'),
        effectiveRequestBytes: request.effectiveRequestBytes.toString('base64'), executionModel: request.executionModel,
        maxOutputTokens: request.maxOutputTokens, nativeAdmission: request.nativeAdmission,
        directory: join(request.runDirectory, `dispatch-${request.ordinal}.adapter`) }) });
    assert.equal(response.status, 200);
    const result = await response.json();
    for (const field of ['responseBytes', 'upstreamRequestBytes', 'upstreamResponseBytes'])
      result[field] = Buffer.from(result[field], 'base64');
    return result;
  } };
await assert.rejects(runProgramAgentGateway(options), new RegExp(scenario === 'tool_first'
  ? 'PROGRAM_AGENT_OUTCOME_UNKNOWN' : 'PROGRAM_AGENT_CANDIDATE_INVALID', 'u'));
const closed = JSON.parse(await readFile(join(prepared.runDirectory, 'ledger/dispatch-1.result.json')));
const upstream = await readFile(join(prepared.runDirectory, 'dispatch-1.upstream-request'));
const actual = JSON.parse(upstream);
assert.equal(actual.max_tokens, 131072);
assert.equal(closed.maxOutputTokens, 131072);
assert.equal(closed.receipt.internalHttpAttemptCount, 1);
assert.equal(closed.receipt.upstreamProtocol, 'litellm-1.106.4-chat-completions-sse');
assert.equal(closed.receipt.terminal.basis, 'openai-sdk-raw-chat');
assert.equal(closed.receipt.terminal.rawFinishReason, scenario === 'tool_first' ? 'tool_calls' : 'stop');
assert.deepEqual(closed.receipt.nativeAdmission,
  JSON.parse(await readFile(join(prepared.runDirectory, 'ledger/dispatch-1.started.json'))));
assert.equal(closed.receipt.upstreamRequestSha256, createHash('sha256').update(upstream).digest('hex'));
assert.equal(Object.hasOwn(JSON.parse(await readFile(join(prepared.runDirectory, 'dispatch-1.client.json'))), 'max_output_tokens'), false);
assert.equal(JSON.parse(await readFile(join(prepared.runDirectory, 'dispatch-1.effective.json'))).max_output_tokens, 131072);
await assert.rejects(readFile(join(prepared.runDirectory, 'program-agent-final-receipt.json')), { code: 'ENOENT' });
await assert.rejects(runProgramAgentGateway(options), /PROGRAM_AGENT_OUTCOME_UNKNOWN/u);
assert.equal(dispatches, 1);
console.log(JSON.stringify({ scenario, dispatches, internalHttpAttemptCount: 1, actualChatMaxTokens: actual.max_tokens,
  oldFiveFieldModel: true, nativeOnlyAdmission: true, finalCandidate: false, saveCalls: 0,
  originalRequestSha256: closed.clientRequestSha256, upstreamRequestSha256: closed.receipt.upstreamRequestSha256,
  terminal: closed.receipt.terminal, recoveryDispatches: 0 }));
