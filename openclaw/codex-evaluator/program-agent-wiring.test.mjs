import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createProgramAgentSession, validateProgramAgentCandidate } from './program-agent-session.mjs';
import { programRecoveryData } from './program-recovery-fixture.mjs';
import { prepareProgramAgentMaterials } from '../skills/wiselink-research-and-synthesize/scripts/program-assessment-materials.mjs';
import { runProgramAgentGateway } from './program-agent-gateway.mjs';
import { createCheckpointStore } from '../skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs';
import { invokeHostedProgramAssessmentAgent } from '../skills/wiselink-research-and-synthesize/scripts/run-program-assessment.mjs';
import { canonicalJson } from '../skills/wiselink-research-and-synthesize/scripts/validate-payload.mjs';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

// User-supplied Host 7d07 synthetic examples; never replay to a real Host.
const originalPage = JSON.parse(await readFile(new URL('./fixtures/program-agent-v3-original-page.json', import.meta.url)));
const statementExact = JSON.parse(await readFile(new URL('./fixtures/program-agent-v3-statement-exact.json', import.meta.url)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function sourceData(includeStatement = false) {
  const data = programRecoveryData();
  const input = data.modelInput;
  const binding = structuredClone(statementExact.sourceStatements[0].sourceBinding.original);
  input.documentOverview.original.binding = binding;
  input.programOriginal = {
    binding: structuredClone(binding),
    units: originalPage.evidence.map((item, i) => ({ unitId: `u${i + 1}`, kind: 'paragraph',
      payload: { text: item.excerpt, retainedUnknown: { value: `synthetic-${i}` } },
      sourceRefIds: [JSON.parse(item.locator).sourceRefId] })),
    sourceLocators: originalPage.evidence.map(item => JSON.parse(item.locator)),
    coverage: { status: 'PARTIAL', knownPageCount: 2, readPageIndexes: [0] }, findings: [],
  };
  input.availableSources = originalPage.evidence.map(item => {
    const locator = JSON.parse(item.locator);
    return { ref: item.evidenceRef, kind: item.kind, title: item.title, versionLabel: item.versionLabel,
      locator: item.locator, documentVersionId: binding.documentVersionId,
      parseRunId: binding.parseRunId, sourceRefId: locator.sourceRefId, carrierRangeRef: item.evidenceRef };
  });
  input.deliveredEvidence = [];
  if (includeStatement) {
    const record = statementExact.sourceStatements[0];
    input.schemaVersion = 'wiselink.jobaid-problem-task.v3';
    input.evidenceProjectionVersion = 'SOURCE_CONTEXT_V2';
    input.sourceStatementAvailability = { status: 'AVAILABLE',
      semanticFieldsAvailability: 'CAPTURED_FIELDS_ONLY', limitations: ['Synthetic source candidate only.'] };
    input.availableSources.unshift({ ref: record.ref, kind: 'PRIOR_RESULT',
      title: statementExact.evidence[0].title, versionLabel: binding.parseRunId, locator: null,
      sourceStatement: { reference: structuredClone(record.reference), label: record.statement.label,
        sourceSchemaVersion: record.sourceSchemaVersion,
        semanticFieldsAvailability: record.semanticFieldsAvailability, scopeBasis: record.scopeBasis } });
  }
  data.assessmentBinding.documentVersionId = binding.documentVersionId;
  data.work.issues[0].body = `仅说明已交付合成来源，不证明当前实施。[[${input.availableSources[0].ref}]]`;
  return data;
}

// EXACT is constructed from the actual requested refs, not a renamed PAGE packet.
function originalExact(sourceRefs) {
  return { schemaVersion: originalPage.schemaVersion, status: 'AVAILABLE', scope: 'EXACT',
    completeRequestedScope: true, sourceRefs: [...sourceRefs], sourceStatements: [], activityContexts: [],
    evidence: sourceRefs.map(ref => structuredClone(originalPage.evidence.find(item => item.evidenceRef === ref))) };
}

async function sessionFixture(includeStatement, overrides = {}) {
  const data = sourceData(includeStatement);
  const materials = await prepareProgramAgentMaterials(data.modelInput, {
    assessmentBinding: data.assessmentBinding, assessmentCheckpoint: { readOptional: async () => null } });
  const calls = [];
  const session = createProgramAgentSession({ materials, maxToolCalls: 16,
    readAssessmentSources: async intent => {
      calls.push(structuredClone(intent));
      return includeStatement ? structuredClone(statementExact) : originalExact(intent.sourceRefs);
    }, readAssessmentWork: async () => null, ...overrides });
  return { ...data, materials, session, calls };
}

test('candidate feedback requires each issue key, question and body without inventing fields', () => {
  const { work, modelInput } = programRecoveryData();
  const delivered = modelInput.deliveredEvidence.map(item => item.evidenceRef);
  const changes = [
    ['empty issue', value => { value.issues = [{}]; }],
    ...['issueKey', 'question', 'body'].map(key => [`missing ${key}`, value => { delete value.issues[0][key]; }]),
    ['blank question', value => { value.issues[0].question = '  '; }],
    ['invalid issue key', value => { value.issues[0].issueKey = 'bad:key'; }],
    ['long issue key', value => { value.issues[0].issueKey = 'x'.repeat(81); }],
  ];
  for (const [label, change] of changes) {
    const value = structuredClone(work); change(value);
    const before = JSON.stringify(value);
    assert.equal(validateProgramAgentCandidate(before, delivered).status, 'REPAIR_REQUIRED', label);
    assert.equal(JSON.stringify(value), before);
  }
  const minimal = structuredClone(work);
  for (const key of ['riskScenarios', 'measures', 'otherClassifications', 'openQuestions', 'requirementHandling'])
    delete minimal.issues[0][key];
  assert.equal(validateProgramAgentCandidate(JSON.stringify(minimal), delivered).status, 'VALID');
});

test('candidate inline citation feedback rejects missing malformed and undelivered refs on final recheck', async () => {
  const f = await sessionFixture(false);
  const ref = f.modelInput.availableSources[0].ref;
  await f.session.callTool('read_sources', { sourceRefs: [ref], purpose: 'Synthetic exact original' });
  assert.equal((await f.session.callTool('validate_candidate', { workJson: JSON.stringify(f.work) })).status, 'VALID');
  for (const body of ['没有引用', `有效 [[${ref}]] 后有 [[残片`, `[[${ref}\n]]`, '[[]]', '尾部 ]]', '[[NOT_DELIVERED]]']) {
    const work = structuredClone(f.work); work.issues[0].body = body;
    assert.equal(f.session.validateFinal(JSON.stringify(work)).status, 'REPAIR_REQUIRED', body);
  }
  assert.equal(f.session.validateFinal(JSON.stringify(f.work)).status, 'VALID');
});

test('bound read exceptions propagate while local source-selection feedback remains repairable', async () => {
  for (const code of ['JOBAID_SOURCE_AUTHORIZATION_CHANGED', 'JOBAID_SOURCE_VERSION_CHANGED', 'SYNTHETIC_LEASE_FENCE_INVALID']) {
    let reads = 0;
    const fatal = new Error(`${code}:SYNTHETIC_PRIVATE_DETAIL`);
    const f = await sessionFixture(false, { readAssessmentSources: async () => { reads++; throw fatal; } });
    assert.equal((await f.session.callTool('read_sources', { sourceRefs: ['not-in-catalogue'], purpose: 'x' })).code,
      'SOURCE_SELECTION_INVALID');
    assert.equal(reads, 0);
    await assert.rejects(f.session.callTool('read_sources', {
      sourceRefs: [f.modelInput.availableSources[0].ref], purpose: 'x' }), error => error === fatal);
    assert.equal(reads, 1);
    assert.deepEqual(f.session.deliveredRefs(), []);
    assert.deepEqual(f.session.audit(), []);
  }
});

test('v3 ordinary EXACT keeps empty arrays and does not grant the rest of a PAGE or directory', async () => {
  let persisted;
  const f = await sessionFixture(false, { persistToolResult: async row => { persisted = structuredClone(row); } });
  const before = JSON.stringify(f.modelInput);
  const selected = [f.modelInput.availableSources[0].ref];
  const result = await f.session.callTool('read_sources', { sourceRefs: selected, purpose: 'One exact original' });
  assert.deepEqual(f.calls, [{ sourceRefs: selected, purpose: 'One exact original', context: 'EXACT' }]);
  assert.deepEqual(result, originalExact(selected));
  assert.equal(f.modelInput.schemaVersion, 'wiselink.jobaid-problem-task.v2');
  assert.equal(result.schemaVersion, 'wiselink.jobaid-source-read.v3');
  assert.equal(Object.hasOwn(result, 'readReceipt'), false);
  assert.equal(Object.hasOwn(result, 'context'), false);
  assert.equal(Object.hasOwn(result.evidence[0], 'documentVersionId'), false);
  assert.equal(Object.hasOwn(result.evidence[0], 'sourceRefId'), false);
  assert.deepEqual(persisted.observation, result);
  assert.deepEqual(f.session.deliveredRefs(), selected);
  assert.deepEqual(f.session.audit(), [{ name: 'read_sources', status: 'AVAILABLE', refs: selected }]);
  assert.equal(JSON.stringify(f.modelInput), before);
});

test('v3 statement EXACT preserves full declared root and activity context closure after persistence', async () => {
  let persisted;
  const f = await sessionFixture(true, { persistToolResult: async row => {
    assert.deepEqual(f.session.deliveredRefs(), []);
    assert.deepEqual(f.session.audit(), []);
    persisted = structuredClone(row);
  } });
  const ref = statementExact.sourceStatements[0].ref;
  const result = await f.session.callTool('read_sources', { sourceRefs: [ref], purpose: 'Read the declared assertion and required roots' });
  assert.deepEqual(result, statementExact);
  assert.deepEqual(persisted.observation, statementExact);
  assert.deepEqual(f.session.deliveredRefs(), statementExact.evidence.map(item => item.evidenceRef));
  assert.deepEqual(f.session.audit()[0].refs, statementExact.sourceRefs);
  assert.equal(result.sourceStatements[0].sourceSchemaVersion, 'wiselink.document.activity-candidate.v2');
  assert.deepEqual(result.evidence[0].sourceContext, { resultRef: 'DRA-synthetic-001', resultRevision: 2 });
  assert.equal(result.activityContexts[0].sourceContext.schemaVersion, 'wiselink.document.activity-source-context.v1');
  const invalid = structuredClone(f.work);
  invalid.issues[0].body = '不能以目录/profile/coverage代替证据。[[synthetic-profile-v1]]';
  assert.equal(f.session.validateFinal(JSON.stringify(invalid)).status, 'REPAIR_REQUIRED');
  assert.equal(f.session.validateFinal(JSON.stringify(f.work)).status, 'VALID');
});

test('tool-result persistence failure grants no delivered source refs or AVAILABLE audit', async () => {
  const f = await sessionFixture(true, { persistToolResult: async () => { throw new Error('SYNTHETIC_DURABLE_WRITE_FAILED'); } });
  await assert.rejects(f.session.callTool('read_sources', {
    sourceRefs: [statementExact.sourceRefs[0]], purpose: 'Read before an interrupted durable write' }),
  /SYNTHETIC_DURABLE_WRITE_FAILED/u);
  assert.deepEqual(f.session.deliveredRefs(), []);
  assert.deepEqual(f.session.audit(), []);
});

test('v3 rejects damaged arrays bindings root closure and unrelated extra catalogue evidence', async () => {
  const changes = [
    ['missing sourceStatements', value => { delete value.sourceStatements; }],
    ['null activityContexts', value => { value.activityContexts = null; }],
    ['missing required root', value => { value.evidence.pop(); }],
    ['wrong context revision', value => { value.activityContexts[0].candidateRevision++; }],
    ['wrong context binding', value => { value.activityContexts[0].sourceContext.sourceBinding.semanticRevision++; }],
    ['wrong source binding', value => { value.sourceStatements[0].sourceBinding.original.sourceSha256 = 'b'.repeat(64); }],
    ['wrong quote/root relation', value => { value.sourceStatements[0].quoteLocators[0].rootRefs = ['foreign-root']; }],
    ['unsupported statement version', value => { value.sourceStatements[0].sourceSchemaVersion = 'wiselink.document.activity-candidate.v3'; }],
    ['PAGE returned for EXACT', value => { value.scope = 'PAGE'; }],
  ];
  for (const [label, change] of changes) {
    const packet = structuredClone(statementExact); change(packet);
    const f = await sessionFixture(true, { readAssessmentSources: async () => packet });
    await assert.rejects(f.session.callTool('read_sources', { sourceRefs: [statementExact.sourceRefs[0]], purpose: label }),
      /JOBAID_SOURCE_READ_FAILED|SOURCE_READ_INCOMPLETE/u, label);
    assert.deepEqual(f.session.deliveredRefs(), [], label);
  }
  const absentRoot = await sessionFixture(true);
  absentRoot.materials.originalInput.availableSources.pop();
  const noRootSession = createProgramAgentSession({ materials: absentRoot.materials, maxToolCalls: 2,
    readAssessmentSources: async () => structuredClone(statementExact), readAssessmentWork: async () => null });
  await assert.rejects(noRootSession.callTool('read_sources', { sourceRefs: [statementExact.sourceRefs[0]], purpose: 'Root outside bound directory' }),
    /SOURCE_READ_INCOMPLETE/u);
  const extra = structuredClone(originalPage.evidence[0]);
  extra.evidenceRef = 'UNRELATED_CATALOGUE_REF';
  const packet = structuredClone(statementExact); packet.evidence.push(extra); packet.sourceRefs.push(extra.evidenceRef);
  const other = await sessionFixture(true);
  other.materials.originalInput.availableSources.push({ ref: extra.evidenceRef, kind: extra.kind,
    versionLabel: extra.versionLabel, locator: extra.locator });
  const otherSession = createProgramAgentSession({ materials: other.materials, maxToolCalls: 2,
    readAssessmentSources: async () => packet, readAssessmentWork: async () => null });
  await assert.rejects(otherSession.callTool('read_sources', { sourceRefs: [statementExact.sourceRefs[0]], purpose: 'Unrelated extra is not closure' }),
    /SOURCE_READ_INCOMPLETE/u);
  assert.deepEqual(otherSession.deliveredRefs(), []);
});

test('EXACT limit of 96 explicit refs permits more returned evidence only for required roots', async () => {
  const f = await sessionFixture(true);
  const packet = structuredClone(statementExact);
  const explicit = [packet.sourceRefs[0]];
  for (let i = 0; i < 95; i++) {
    const item = { ...originalPage.evidence[0], evidenceRef: `synthetic-explicit-${i}` };
    explicit.push(item.evidenceRef); packet.evidence.push(item); packet.sourceRefs.push(item.evidenceRef);
    f.materials.originalInput.availableSources.push({ ref: item.evidenceRef, kind: item.kind,
      versionLabel: item.versionLabel, locator: item.locator });
  }
  const session = createProgramAgentSession({ materials: f.materials, maxToolCalls: 2,
    readAssessmentSources: async intent => { assert.equal(intent.sourceRefs.length, 96); return packet; },
    readAssessmentWork: async () => null });
  const result = await session.callTool('read_sources', { sourceRefs: explicit, purpose: 'Explicit selection plus two required roots' });
  assert.equal(result.evidence.length, 98);
  assert.equal(session.deliveredRefs().length, 98);
});

async function scratch(t) {
  const retained = process.env.WISELINK_PROGRAM_AGENT_WIRING_ARTIFACT_ROOT;
  const parent = retained || tmpdir();
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(parent, 'wiring-'));
  if (!retained) t.after(() => rm(root, { recursive: true, force: true }));
  else t.diagnostic(`synthetic artifacts: ${root}`);
  return root;
}

// Small HTTP-driving child, not real Codex or a model. This exercises the
// existing broker, dispatch ledger and final candidate path without rerunning
// the previously accepted real CLI/MCP demonstration.
function captureLogRound(ordinal) {
  return { stdout: Buffer.from(JSON.stringify({ type: 'item.completed', ordinal,
    text: 'synthetic only 汉字🧪 {"type":"turn.completed"} ' + 'x'.repeat(100_000) }) + '\n'),
  stderr: Buffer.concat([Buffer.from(`synthetic stderr ${ordinal}:` + 'z'.repeat(100_000)),
    Buffer.from([0xff, 0x00, 0xc3, 0x28, 0x0a])]) };
}
function captureLogTail(stdoutBytes, terminal) {
  if (terminal === 'missing') return Buffer.alloc(0);
  if (terminal === 'truncated') return Buffer.from('{"type":"turn.completed"');
  if (terminal === 'nested') return Buffer.from('{"type":"item.completed","item":{"type":"turn.completed"}}\n');
  if (terminal === 'invalid-suffix') return Buffer.from('{"type":"turn.completed"} invalid\n');
  if (terminal === 'large') return Buffer.from(JSON.stringify({ type: 'turn.completed',
    syntheticExtension: 'x'.repeat(131_072) }));
  const event = '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}';
  if (terminal === 'oversized-item') return Buffer.from(JSON.stringify({ type: 'item.completed',
    text: 'x'.repeat(6_000_001), nested: { type: 'turn.completed' } }) + '\n' + event);
  if (terminal !== 'split-eof') return Buffer.from(event + '\r\n');
  // Place the control record across a 64KiB file-read boundary, without final LF.
  const padding = (65530 - stdoutBytes % 65536 + 65536) % 65536;
  return Buffer.from((padding ? ' '.repeat(padding - 1) + '\n' : '') + event);
}

async function fakeCli(root, work, selected, validate = false, cli = null) {
  const path = join(root, 'fake-codex.mjs');
  const code = `#!${process.execPath}
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
for await (const _ of process.stdin) {}
const config = await readFile(join(process.env.CODEX_HOME, 'config.toml'), 'utf8');
const base = config.match(/base_url = "([^"]+)"/)[1];
const post = async (url, token, body) => {
  if (new URL(url).hostname !== '127.0.0.1') throw new Error('SYNTHETIC_LOOPBACK_ONLY');
  const response = await fetch(url, { method: 'POST', headers: { authorization: 'Bearer ' + token,
    'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.text() };
};
const model = () => post(base + '/responses', process.env.WISELINK_PROGRAM_AGENT_LOCAL_TOKEN,
  { model: 'glm-5.3', stream: true, input: [] });
const one = await model();
const source = await post(process.env.WISELINK_ASSESSMENT_URL, process.env.WISELINK_ASSESSMENT_TOKEN,
  { method: 'tools/call', params: { name: 'read_sources', arguments: { sourceRefs: ${JSON.stringify(selected)}, purpose: 'Synthetic bound read' } } });
let validation = null;
if (${validate} && source.status === 200) validation = await post(process.env.WISELINK_ASSESSMENT_URL,
  process.env.WISELINK_ASSESSMENT_TOKEN, { method: 'tools/call', params: { name: 'validate_candidate',
    arguments: { workJson: ${JSON.stringify(JSON.stringify(work))} } } });
const sourceAvailable = source.status === 200 && JSON.parse(JSON.parse(source.body).content[0].text).status === 'AVAILABLE';
const after = sourceAvailable ? null : await model();
const cli = ${JSON.stringify(cli)};
let stdoutBytes = 0;
if (cli) {
  const logRound = ${captureLogRound.toString()};
  const write = (stream, bytes) => new Promise((resolve, reject) => stream.write(bytes, error => error ? reject(error) : resolve()));
  for (let ordinal = 0; ordinal < (cli.rounds ?? 1); ordinal++) {
    if (ordinal > 0 && (await model()).status !== 200) throw new Error('SYNTHETIC_DISPATCH_FAILED');
    const part = logRound(ordinal);
    await write(process.stdout, part.stdout); await write(process.stderr, part.stderr);
    stdoutBytes += part.stdout.length;
  }
  if (cli.pauseBeforeCompletion) {
    await writeFile(join(dirname(process.env.CODEX_HOME), 'synthetic-log-ready'), 'ready');
    for (let i = 0; ; i++) {
      try { await readFile(join(dirname(process.env.CODEX_HOME), 'synthetic-log-continue')); break; }
      catch (error) { if (error.code !== 'ENOENT' || i > 500) throw error; }
      await delay(10);
    }
  }
}
await writeFile(join(dirname(process.env.CODEX_HOME), 'synthetic-child-observations.json'), JSON.stringify({ one, source, after, validation }));
const finalPath = process.argv[process.argv.indexOf('--output-last-message') + 1];
await writeFile(finalPath, ${JSON.stringify(JSON.stringify({ tool_name: 'return_wiselink_program_assessment', arguments: { workJson: JSON.stringify(work) } }))});
if (!cli) console.log(JSON.stringify({ type: 'turn.completed' }));
else {
  const tail = (${captureLogTail.toString()})(stdoutBytes, cli.terminal ?? 'normal');
  const write = bytes => new Promise((resolve, reject) => process.stdout.write(bytes, error => error ? reject(error) : resolve()));
  const split = Math.max(0, tail.length - 7);
  await write(tail.subarray(0, split)); await delay(5); await write(tail.subarray(split));
  if (cli.holdAfterCompletion) {
    await writeFile(join(dirname(process.env.CODEX_HOME), 'synthetic-log-ready'), 'ready');
    await delay(20_000);
  }
  process.exitCode = cli.exitCode ?? 0;
}
`;
  await writeFile(path, code, { mode: 0o700 });
  return path;
}

function providerResponse(request) {
  const upstreamRequestBytes = Buffer.from(JSON.stringify({ model: 'synthetic', max_tokens: request.maxOutputTokens }));
  const upstreamResponseBytes = Buffer.from('data: {"choices":[{"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  return { responseBytes: Buffer.from('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n'),
    upstreamRequestBytes, upstreamResponseBytes, receipt: { complete: true, upstreamHttpStatus: 200,
      upstreamProtocol: 'fixture-chat-completions-sse-v1', upstreamDoneSeen: true, upstreamFinishReason: 'stop',
      terminal: { schemaVersion: 'wiselink.chat-terminal-receipt.v1', basis: 'synthetic-fixture',
        seenValidTerminal: true, sdkStreamExhausted: true, rawFinishReason: 'stop', errorCode: null },
      reportedModel: 'fixture/synthetic-only', maxOutputTokens: request.maxOutputTokens,
      executionModel: request.executionModel, clientRequestSha256: request.clientRequestSha256,
      effectiveRequestSha256: request.effectiveRequestSha256,
      upstreamRequestSha256: sha(upstreamRequestBytes), upstreamResponseSha256: sha(upstreamResponseBytes) } };
}

async function gatewayFixture(t, includeStatement, dispatch = providerResponse, cli = null) {
  const root = await scratch(t), data = sourceData(includeStatement);
  const checkpoint = await createCheckpointStore(join(root, 'checkpoint'));
  const selected = [data.modelInput.availableSources[0].ref];
  const counters = { provider: 0, save: 0, reads: 0 };
  let saved;
  const options = { modelExecutor: 'CODEX',
    agentPolicy: { schemaVersion: 'wiselink.native.program_agent_policy.proposal.v1',
      maxModelRequests: 2, maxOutputTokens: 131072, maxToolCalls: 8, timeoutSeconds: 30 },
    executionModel: { modelRef: 'miaoda/glm-5.3', displayName: 'Synthetic fixture', providerKind: 'BUILT_IN',
      settingsRevision: 1, selectedAt: '2026-10-26T00:00:00Z' },
    sessionDiscriminator: 'synthetic-wiring', assessmentBinding: data.assessmentBinding,
    assessmentCheckpoint: checkpoint, taskDeadline: new Date(Date.now() + 60_000).toISOString(),
    codexOptions: { codexBinary: await fakeCli(root, data.work, selected, includeStatement, cli), runRoot: join(root, 'runs') },
    readAssessmentSources: async intent => {
      assert.equal(intent.context, 'EXACT');
      return includeStatement ? structuredClone(statementExact) : originalExact(intent.sourceRefs);
    },
    readAssessmentWork: async ({ requestId }) => {
      counters.reads++;
      return { schemaVersion: 'wiselink.jobaid-work-read.v2', attemptId: data.assessmentBinding.actionAttemptId,
        inputWorkRevision: 0, executionStatus: 'RUNNING', revision: saved?.requestId === requestId ? structuredClone(saved) : null };
    },
    saveAssessmentWork: async request => {
      counters.save++;
      const work = JSON.parse(request.workJson);
      saved = { requestId: request.requestId, workRevisionRef: 'JAWR-synthetic-wiring', workRevision: 1,
        actionAttemptId: data.assessmentBinding.actionAttemptId, workItemId: data.assessmentBinding.workItemId,
        documentVersionId: data.assessmentBinding.documentVersionId, basedOnWorkItemRevision: data.assessmentBinding.baseRevision,
        content: { ...work, understanding: work.overview.trim(), overviewStatus: 'CURRENT',
          issues: work.issues.map(issue => ({ ...issue, question: issue.question.trim(), body: issue.body.trim() })) } };
      return { workRevisionRef: saved.workRevisionRef, workRevision: saved.workRevision };
    },
    recordAssessmentProgramProgress: async ({ phase }) => ({ phase, status: 'SYNTHETIC_ACK' }),
  };
  if (cli) {
    data.modelInput.executionMode = 'PROGRAM_AGENT_V1';
    options.agentPolicy = { schemaVersion: 'wiselink.program-agent-policy.v1',
      maxModelRequests: null, maxOutputTokens: 131072, maxToolCalls: null, timeoutSeconds: 3600 };
    Object.assign(options.executionModel, {
      schemaVersion: 'wiselink.3_1.execution_model_selection.v2', maxOutputTokens: 131072 });
  }
  let originalGatewayInput;
  const invoke = () => invokeHostedProgramAssessmentAgent({ operation: 'EVALUATE_JOBAID', modelInput: data.modelInput }, options,
    { providerDispatch: async request => { counters.provider++; return dispatch(request); },
      runCodexAgent: async input => { originalGatewayInput ??= input; return runProgramAgentGateway(input); } });
  return { ...data, root, checkpoint, counters, options, invoke,
    recoverExact: () => runProgramAgentGateway(originalGatewayInput) };
}

for (const code of ['JOBAID_SOURCE_AUTHORIZATION_CHANGED', 'JOBAID_SOURCE_VERSION_CHANGED', 'SYNTHETIC_LEASE_FENCE_INVALID'])
  test(`fatal ${code} blocks later dispatch and SAVE while preserving original UNKNOWN ledger`, async t => {
    const f = await gatewayFixture(t, false);
    f.options.readAssessmentSources = async () => { throw new Error(`${code}:SYNTHETIC_PRIVATE_DETAIL`); };
    let failure;
    try { await f.invoke(); } catch (error) { failure = error.message; }
    const link = await f.checkpoint.readOptional('program-agent-run');
    const child = await readFile(join(link.runDirectory, 'synthetic-child-observations.json'), 'utf8')
      .then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    t.diagnostic(JSON.stringify({ failure, providerCalls: f.counters.provider, saveCalls: f.counters.save,
      readStatus: child?.source.status ?? 'CLI_STOPPED', afterReadPostStatus: child?.after?.status ?? 'NOT_DISPATCHED' }));
    assert.equal(f.counters.provider, 1);
    assert.equal(failure, 'PROGRAM_AGENT_OUTCOME_UNKNOWN');
    assert.equal(f.counters.save, 0);
    if (child) { assert.equal(child.source.status, 502); assert.equal(child.after.status, 502); }
    assert.equal(JSON.stringify(child).includes('SYNTHETIC_PRIVATE_DETAIL'), false);
    const ledgerFile = join(link.runDirectory, 'ledger/dispatch-1.started.json');
    const ledgerBefore = await readFile(ledgerFile);
    assert.equal(JSON.parse(ledgerBefore).maxOutputTokens, 131072);
    assert.ok(await f.checkpoint.readOptional('program-agent-candidate.started'));
    assert.equal(await f.checkpoint.readOptional('program-agent-candidate.result'), null);
    assert.equal(await f.checkpoint.readOptional('program-save-request'), null);
    await assert.rejects(f.recoverExact(), /PROGRAM_AGENT_OUTCOME_UNKNOWN/u);
    await assert.rejects(f.invoke(), /PROGRAM_AGENT_OUTCOME_UNKNOWN/u);
    t.diagnostic('new seal v2: exact and parent re-entry remain UNKNOWN; neither dispatches');
    assert.deepEqual(await readFile(ledgerFile), ledgerBefore);
    assert.equal(f.counters.provider, 1);
    assert.equal(f.counters.save, 0);
    await assert.rejects(readFile(join(link.runDirectory, 'ledger/dispatch-2.started.json')), { code: 'ENOENT' });
  });

test('v3 complete closure is persisted and delivered through gateway then accepted by original SAVE and READ tail', async t => {
  const f = await gatewayFixture(t, true);
  const result = await f.invoke();
  assert.deepEqual(result.output, { workRevisionRef: 'JAWR-synthetic-wiring' });
  const receipt = (await f.checkpoint.readOptional('program-agent-candidate.result')).value;
  const persisted = JSON.parse(await readFile(join(receipt.runDirectory, 'ledger/tool-1.result.json')));
  const child = JSON.parse(await readFile(join(receipt.runDirectory, 'synthetic-child-observations.json')));
  const delivered = JSON.parse(JSON.parse(child.source.body).content[0].text);
  assert.deepEqual(persisted.observation, statementExact);
  assert.deepEqual(delivered, statementExact);
  assert.deepEqual(receipt.deliveredRefs, statementExact.sourceRefs);
  assert.deepEqual(receipt.toolAudit[0].refs, statementExact.sourceRefs);
  assert.equal(JSON.parse(JSON.parse(child.validation.body).content[0].text).status, 'VALID');
  const saveKey = (await f.checkpoint.readOptional('program-save-request')).requestId;
  assert.ok(saveKey);
  assert.equal((await f.checkpoint.readOptional('program-work-readback')).revision.requestId, saveKey);
  assert.deepEqual(await f.invoke(), result);
  assert.equal((await f.checkpoint.readOptional('program-save-request')).requestId, saveKey);
  assert.equal(f.counters.provider, 1);
  assert.equal(f.counters.save, 1);
  t.diagnostic(JSON.stringify({ providerCalls: f.counters.provider, syntheticSaveCalls: f.counters.save,
    returnedEvidenceRefs: receipt.deliveredRefs.length, modelBudget: receipt.dispatches[0].maxOutputTokens,
    sameSaveKey: true, independentRead: true }));
});

async function interruptBeforeParentResult(f) {
  let interrupted = false;
  f.options.assessmentCheckpoint = { ...f.checkpoint, writeOnce: async (key, value) => {
    if (key === 'program-agent-candidate.result' && !interrupted) {
      interrupted = true;
      throw new Error('SYNTHETIC_PARENT_RESULT_NOT_WRITTEN');
    }
    return f.checkpoint.writeOnce(key, value);
  } };
  await assert.rejects(f.invoke(), /SYNTHETIC_PARENT_RESULT_NOT_WRITTEN/u);
  const link = await f.checkpoint.readOptional('program-agent-run');
  assert.equal(await f.checkpoint.readOptional('program-agent-candidate.result'), null);
  assert.equal(f.counters.provider, 1); assert.equal(f.counters.save, 0);
  return link;
}

test('seal v2 checkpoint roundtrip recovers complete child receipt before parent result without generation', async t => {
  const f = await gatewayFixture(t, true);
  const link = await interruptBeforeParentResult(f);
  const sealedPath = join(link.runDirectory, 'program-agent-binding.json');
  const sealedBytes = await readFile(sealedPath), sealed = JSON.parse(sealedBytes);
  const materials = await f.checkpoint.readOptional('program-agent-materials');
  assert.equal(sealed.version, 2);
  assert.equal(sealed.schemaVersion, 'wiselink.native.program-agent-seal.v2');
  assert.equal(sealed.materialsSha256, sha(canonicalJson(materials)));
  assert.equal(sealed.originalInputSha256, sha(canonicalJson(materials.originalInput)));
  assert.equal(sealed.directorySha256, sha(canonicalJson(materials.directory)));
  assert.equal(sealed.promptSha256, sha(await readFile(join(link.runDirectory, 'codex-prompt.txt'))));
  const childPath = join(link.runDirectory, 'program-agent-final-receipt.json');
  const childBytes = await readFile(childPath);
  const reservation = await readFile(join(link.runDirectory, 'ledger/dispatch-1.started.json'));
  // A trustworthy final child receipt is sufficient; no lower prompt/runner
  // reconstruction is required to restore the missing parent result.
  await rm(join(link.runDirectory, 'codex-prompt.txt'));
  const result = await f.invoke();
  const savedKey = (await f.checkpoint.readOptional('program-save-request')).requestId;
  assert.equal((await f.checkpoint.readOptional('program-work-readback')).revision.requestId, savedKey);
  assert.deepEqual(await f.invoke(), result);
  assert.equal((await f.checkpoint.readOptional('program-save-request')).requestId, savedKey);
  assert.deepEqual(await readFile(childPath), childBytes);
  assert.deepEqual(await readFile(sealedPath), sealedBytes);
  assert.deepEqual(await readFile(join(link.runDirectory, 'ledger/dispatch-1.started.json')), reservation);
  assert.equal(f.counters.provider, 1); assert.equal(f.counters.save, 1);
  t.diagnostic(JSON.stringify({ sealVersion: 2, checkpointRoundtrip: true,
    recoveredChildReceipt: true, providerCalls: 1, recoveryDispatches: 0,
    syntheticSaveCalls: 1, sameSaveKey: true, independentRead: true, stageEndProved: false }));
});

test('seal v2 rejects altered material and corrupt receipt without changing original reservation or generating', async t => {
  const f = await gatewayFixture(t, true);
  const link = await interruptBeforeParentResult(f);
  const reservationPath = join(link.runDirectory, 'ledger/dispatch-1.started.json');
  const before = await readFile(reservationPath);
  const originalMaterials = await f.checkpoint.readOptional('program-agent-materials');
  const changed = structuredClone(originalMaterials); changed.directory.syntheticTamper = true;
  await f.checkpoint.write('program-agent-materials', changed);
  await assert.rejects(f.invoke(), /PROGRAM_AGENT_BINDING_MISMATCH|REVIEW_CHECKPOINT/u);
  await f.checkpoint.write('program-agent-materials', originalMaterials);
  const receiptPath = join(link.runDirectory, 'program-agent-final-receipt.json');
  const receipt = JSON.parse(await readFile(receiptPath)); receipt.raw += ' ';
  await writeFile(receiptPath, JSON.stringify(receipt));
  await assert.rejects(f.invoke(), /PROGRAM_AGENT_OUTCOME_UNKNOWN/u);
  assert.equal(f.counters.provider, 1); assert.equal(f.counters.save, 0);
  assert.deepEqual(await readFile(reservationPath), before);
});

test('seal v2 refuses a changed task deadline without refreshing generation budget', async t => {
  const f = await gatewayFixture(t, true);
  const link = await interruptBeforeParentResult(f);
  const before = await readFile(join(link.runDirectory, 'program-agent-binding.json'));
  f.options.taskDeadline = new Date(Date.parse(f.options.taskDeadline) + 60_000).toISOString();
  await assert.rejects(f.invoke(), /PROGRAM_AGENT_CHECKPOINT_BINDING_MISMATCH/u);
  assert.deepEqual(await readFile(join(link.runDirectory, 'program-agent-binding.json')), before);
  assert.equal(f.counters.provider, 1); assert.equal(f.counters.save, 0);
});

test('seal v2 cancellation during final candidate read cannot publish a complete child receipt', async t => {
  const f = await gatewayFixture(t, true), controller = new AbortController();
  f.options.signal = controller.signal;
  const originalRead = fsPromises.readFile;
  const mocked = t.mock.method(fsPromises, 'readFile', async (path, ...args) => {
    const bytes = await originalRead(path, ...args);
    if (String(path).endsWith('/final.txt')) controller.abort();
    return bytes;
  });
  syncBuiltinESMExports();
  t.after(() => { mocked.mock.restore(); syncBuiltinESMExports(); });
  await assert.rejects(f.invoke(), /PROGRAM_AGENT_OUTCOME_UNKNOWN/u);
  const link = await f.checkpoint.readOptional('program-agent-run');
  await assert.rejects(readFile(join(link.runDirectory, 'program-agent-final-receipt.json')), { code: 'ENOENT' });
  assert.equal(await f.checkpoint.readOptional('program-agent-candidate.result'), null);
  assert.equal(await f.checkpoint.readOptional('program-save-request'), null);
  assert.equal(f.counters.provider, 1); assert.equal(f.counters.save, 0);
});

test('seal v2 parent reservation cannot recreate a missing original run directory', async t => {
  const f = await gatewayFixture(t, true);
  const link = await interruptBeforeParentResult(f);
  const original = join(f.root, 'retained-original-child');
  await rename(link.runDirectory, original);
  const before = await readFile(join(original, 'ledger/dispatch-1.started.json'));
  await assert.rejects(f.invoke(), /PROGRAM_AGENT_OUTCOME_UNKNOWN/u);
  await assert.rejects(readFile(join(link.runDirectory, 'program-agent-binding.json')), { code: 'ENOENT' });
  assert.deepEqual(await readFile(join(original, 'ledger/dispatch-1.started.json')), before);
  assert.equal(f.counters.provider, 1); assert.equal(f.counters.save, 0);
});

test('seal v2 rejects a production-protocol receipt without its exact frozen deadline', async t => {
  const f = await gatewayFixture(t, true, request => {
    const result = providerResponse(request);
    Object.assign(result.receipt, { upstreamProtocol: 'litellm-1.106.4-chat-completions-sse',
      nativeAdmission: request.nativeAdmission, litellmVersion: '1.106.4', openaiSdkVersion: '2.54.0',
      transportCleanEnd: true, internalHttpAttemptCount: 1, blockedAdditionalHttpAttempts: 0,
      cancelled: false, errorCode: null, deadlineBasis: 'SEALED_ABSOLUTE',
      generationDeadlineAt: new Date(Date.parse(request.generationDeadlineAt) + 60_000).toISOString() });
    result.receipt.terminal.basis = 'openai-sdk-raw-chat';
    return result;
  });
  await assert.rejects(f.invoke(), /PROGRAM_AGENT_OUTCOME_UNKNOWN/u);
  const link = await f.checkpoint.readOptional('program-agent-run');
  await assert.rejects(readFile(join(link.runDirectory, 'ledger/dispatch-1.result.json')), { code: 'ENOENT' });
  assert.equal(await f.checkpoint.readOptional('program-agent-candidate.result'), null);
  assert.equal(f.counters.provider, 1); assert.equal(f.counters.save, 0);
});

async function captureFixture(t, cli = {}) {
  const f = await gatewayFixture(t, true, providerResponse, cli);
  const controller = new AbortController();
  f.options.signal = controller.signal;
  t.after(() => controller.abort());
  return { ...f, controller };
}
async function waitForCapture(f, expectedLengths) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const link = await f.checkpoint.readOptional('program-agent-run');
    if (link) {
      try {
        await readFile(join(link.runDirectory, 'synthetic-log-ready'));
        if (!expectedLengths || ((await stat(join(link.runDirectory, 'codex.stdout.jsonl'))).size === expectedLengths.stdout &&
            (await stat(join(link.runDirectory, 'codex.stderr.log'))).size === expectedLengths.stderr)) return link.runDirectory;
      }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await delay(10);
  }
  throw new Error('SYNTHETIC_CAPTURE_HANDSHAKE_TIMED_OUT');
}
function expectedCapture(rounds, terminal = 'normal') {
  const output = Array.from({ length: rounds }, (_, i) => captureLogRound(i));
  const stdout = Buffer.concat(output.map(item => item.stdout));
  return { stdout: Buffer.concat([stdout, captureLogTail(stdout.length, terminal)]),
    stderr: Buffer.concat(output.map(item => item.stderr)) };
}
async function assertCaptureUnknown(f, pending, pattern = /PROGRAM_AGENT_OUTCOME_UNKNOWN/u) {
  await assert.rejects(pending, pattern);
  const link = await f.checkpoint.readOptional('program-agent-run');
  await assert.rejects(readFile(join(link.runDirectory, 'program-agent-final-receipt.json')), { code: 'ENOENT' });
  assert.equal(await f.checkpoint.readOptional('program-agent-candidate.result'), null);
  assert.equal(await f.checkpoint.readOptional('program-save-request'), null);
  assert.equal(f.counters.save, 0);
  const calls = f.counters.provider;
  const bindingPath = join(link.runDirectory, 'program-agent-binding.json'), before = await readFile(bindingPath);
  await assert.rejects(f.recoverExact(), /PROGRAM_AGENT_OUTCOME_UNKNOWN/u);
  assert.equal(f.counters.provider, calls);
  assert.deepEqual(await readFile(bindingPath), before);
  return link.runDirectory;
}
function mockCaptureOpen(t, intercept) {
  const original = fsPromises.open;
  const mocked = t.mock.method(fsPromises, 'open', (...args) => intercept(original, ...args));
  syncBuiltinESMExports();
  t.after(() => { mocked.mock.restore(); syncBuiltinESMExports(); });
}
const isCapture = path => /\/codex\.(?:stdout\.jsonl|stderr\.log)$/u.test(String(path));

test('CLI capture: 32 synthetic turns persist both streams above 2M before completion and preserve a split EOF terminal', async t => {
  const rounds = 32, f = await captureFixture(t, { rounds, terminal: 'split-eof', pauseBeforeCompletion: true });
  const pending = f.invoke(); pending.catch(() => {});
  const expected = expectedCapture(rounds, 'split-eof');
  const prefixBytes = Array.from({ length: rounds }, (_, i) => captureLogRound(i).stdout.length).reduce((a, b) => a + b, 0);
  const directory = await waitForCapture(f, { stdout: prefixBytes, stderr: expected.stderr.length });
  // The child is still alive waiting for our marker: these are live captured files.
  const liveStdout = await readFile(join(directory, 'codex.stdout.jsonl'));
  const liveStderr = await readFile(join(directory, 'codex.stderr.log'));
  assert.equal(liveStdout.length, prefixBytes);
  assert.deepEqual(liveStdout, expected.stdout.subarray(0, prefixBytes));
  assert.deepEqual(liveStderr, expected.stderr);
  assert.ok(liveStdout.length > 2_000_000 && liveStderr.length > 2_000_000);
  for (const name of ['codex.stdout.jsonl', 'codex.stderr.log'])
    assert.equal((await stat(join(directory, name))).mode & 0o777, 0o600);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  await assert.rejects(readFile(join(directory, 'program-agent-final-receipt.json')), { code: 'ENOENT' });
  await writeFile(join(directory, 'synthetic-log-continue'), 'continue', { mode: 0o600 });
  const result = await pending;
  assert.ok(result.output.workRevisionRef);
  assert.deepEqual(await readFile(join(directory, 'codex.stdout.jsonl')), expected.stdout);
  assert.deepEqual(await readFile(join(directory, 'codex.stderr.log')), expected.stderr);
  const receipt = JSON.parse(await readFile(join(directory, 'program-agent-final-receipt.json')));
  assert.equal(receipt.dispatchCount, rounds); assert.equal(f.counters.provider, rounds); assert.equal(f.counters.save, 1);
  assert.equal(receipt.policy.maxModelRequests, null); assert.equal(receipt.policy.maxToolCalls, null);
  assert.equal(receipt.policy.maxOutputTokens, 131072);
  assert.ok(receipt.dispatches.every(item => item.maxOutputTokens === 131072));
  assert.equal(receipt.generationDeadlineAt, f.options.taskDeadline);
  assert.deepEqual(await f.invoke(), result);
  assert.equal(f.counters.provider, rounds); assert.equal(f.counters.save, 1);
  t.diagnostic(JSON.stringify({ syntheticDispatches: rounds, syntheticSaves: 1,
    stdoutBytes: expected.stdout.length, stderrBytes: expected.stderr.length,
    stdoutSha256: sha(expected.stdout), stderrSha256: sha(expected.stderr), liveCaptureBeforeCompletion: true }));
});

test('CLI capture: a complete terminal above 64KiB remains accepted within the original successful record range', async t => {
  const f = await captureFixture(t, { terminal: 'large' });
  await f.invoke();
  const { runDirectory } = await f.checkpoint.readOptional('program-agent-run');
  const expected = expectedCapture(1, 'large');
  assert.ok(captureLogTail(0, 'large').length > 64 * 1024);
  assert.deepEqual(await readFile(join(runDirectory, 'codex.stdout.jsonl')), expected.stdout);
  assert.equal(f.counters.provider, 1); assert.equal(f.counters.save, 1);
});

test('CLI capture: an oversized nonterminal record stays intact and scanning resumes at the next complete record', async t => {
  const f = await captureFixture(t, { terminal: 'oversized-item' });
  await f.invoke();
  const { runDirectory } = await f.checkpoint.readOptional('program-agent-run');
  const expected = expectedCapture(1, 'oversized-item');
  assert.ok(expected.stdout.length > 6_000_000);
  assert.deepEqual(await readFile(join(runDirectory, 'codex.stdout.jsonl')), expected.stdout);
  assert.deepEqual(await readFile(join(runDirectory, 'codex.stderr.log')), expected.stderr);
  assert.equal(f.counters.provider, 1); assert.equal(f.counters.save, 1);
});

test('CLI capture: awaited short writes preserve every raw byte without a queued write backlog', async t => {
  const f = await captureFixture(t), active = new Map(), maximum = new Map();
  let shortWrites = 0, largestChunk = 0;
  mockCaptureOpen(t, async (open, path, ...args) => {
    const file = await open(path, ...args);
    if (isCapture(path)) {
      const write = file.write.bind(file);
      file.write = async (buffer, offset, length, position) => {
        const key = String(path); active.set(key, (active.get(key) ?? 0) + 1);
        maximum.set(key, Math.max(maximum.get(key) ?? 0, active.get(key)));
        largestChunk = Math.max(largestChunk, buffer.length);
        try {
          await new Promise(resolve => setImmediate(resolve));
          if (length > 4093) shortWrites++;
          return await write(buffer, offset, Math.min(length, 4093), position);
        } finally { active.set(key, active.get(key) - 1); }
      };
    }
    return file;
  });
  await f.invoke();
  const { runDirectory } = await f.checkpoint.readOptional('program-agent-run');
  const expected = expectedCapture(1);
  assert.deepEqual(await readFile(join(runDirectory, 'codex.stdout.jsonl')), expected.stdout);
  assert.deepEqual(await readFile(join(runDirectory, 'codex.stderr.log')), expected.stderr);
  assert.ok(shortWrites > 2); assert.equal(maximum.size, 2);
  assert.ok([...maximum.values()].every(value => value === 1));
  assert.ok(largestChunk <= 128 * 1024); assert.equal(f.counters.save, 1);
  t.diagnostic(JSON.stringify({ shortWrites, maximumConcurrentWritesPerStream: 1, largestChunk }));
});

for (const terminal of ['missing', 'truncated', 'nested', 'invalid-suffix'])
  test(`CLI capture: ${terminal} completion cannot publish a final receipt or replay a dispatch`, async t => {
    const f = await captureFixture(t, { terminal });
    const directory = await assertCaptureUnknown(f, f.invoke()), expected = expectedCapture(1, terminal);
    assert.deepEqual(await readFile(join(directory, 'codex.stdout.jsonl')), expected.stdout);
    assert.deepEqual(await readFile(join(directory, 'codex.stderr.log')), expected.stderr);
    assert.equal(f.counters.provider, 1);
  });

test('CLI capture: nonzero exit retains both streams above 2M despite a complete terminal and valid candidate', async t => {
  const rounds = 25, f = await captureFixture(t, { rounds, exitCode: 17 });
  const directory = await assertCaptureUnknown(f, f.invoke()), expected = expectedCapture(rounds);
  assert.ok(expected.stdout.length > 2_000_000 && expected.stderr.length > 2_000_000);
  assert.deepEqual(await readFile(join(directory, 'codex.stdout.jsonl')), expected.stdout);
  assert.deepEqual(await readFile(join(directory, 'codex.stderr.log')), expected.stderr);
  const stop = JSON.parse(await readFile(join(directory, 'ledger/session-stop.json')));
  assert.equal(stop.code, 'PROGRAM_AGENT_CLI_EXITED'); assert.equal(stop.reservedDispatches, rounds);
  assert.equal(stop.inFlightAtReturn, 0); assert.equal(f.counters.provider, rounds);
});

for (const reason of ['user cancellation', 'sealed absolute deadline'])
  test(`CLI capture: ${reason} after completion still preserves logs and forbids success`, async t => {
    const f = await captureFixture(t, { holdAfterCompletion: true });
    if (reason === 'sealed absolute deadline') f.options.taskDeadline = new Date(Date.now() + 1200).toISOString();
    const pending = f.invoke(); pending.catch(() => {});
    const directory = await waitForCapture(f), expected = expectedCapture(1);
    if (reason === 'user cancellation') f.controller.abort(new Error('SYNTHETIC_USER_CANCELLED'));
    await assertCaptureUnknown(f, pending);
    assert.deepEqual(await readFile(join(directory, 'codex.stdout.jsonl')), expected.stdout);
    assert.deepEqual(await readFile(join(directory, 'codex.stderr.log')), expected.stderr);
    const stop = JSON.parse(await readFile(join(directory, 'ledger/session-stop.json')));
    assert.equal(stop.code, reason === 'user cancellation' ? 'PROGRAM_AGENT_USER_CANCELLED' : 'PROGRAM_AGENT_DEADLINE_EXPIRED');
    assert.equal(stop.generationDeadlineAt, f.options.taskDeadline);
    assert.equal(stop.inFlightAtReturn, 0); assert.equal(f.counters.provider, 1);
  });

test('CLI capture: second file open failure closes the first private file before any dispatch', async t => {
  const f = await captureFixture(t); let stdoutClosed = false;
  mockCaptureOpen(t, async (open, path, ...args) => {
    if (String(path).endsWith('/codex.stderr.log')) throw new Error('SYNTHETIC_CAPTURE_OPEN_FAILED');
    const file = await open(path, ...args);
    if (String(path).endsWith('/codex.stdout.jsonl')) {
      const close = file.close.bind(file);
      file.close = async () => { await close(); stdoutClosed = true; };
    }
    return file;
  });
  const directory = await assertCaptureUnknown(f, f.invoke(), /SYNTHETIC_CAPTURE_OPEN_FAILED/u);
  assert.equal(stdoutClosed, true); assert.equal(f.counters.provider, 0);
  assert.equal((await readFile(join(directory, 'codex.stdout.jsonl'))).length, 0);
  assert.equal((await stat(join(directory, 'codex.stdout.jsonl'))).mode & 0o777, 0o600);
});

for (const fault of ['partial write failure', 'zero write', 'file sync', 'file close', 'directory sync'])
  test(`CLI capture: ${fault} fails closed and retains captured files`, async t => {
    const f = await captureFixture(t); let failed = false, writes = 0, capturesClosed = 0;
    mockCaptureOpen(t, async (open, path, ...args) => {
      const file = await open(path, ...args), name = String(path);
      if (isCapture(path)) {
        const close = file.close.bind(file);
        file.close = async () => {
          await close(); capturesClosed++;
          if (fault === 'file close' && name.endsWith('/codex.stdout.jsonl')) {
            failed = true; throw new Error('SYNTHETIC_CAPTURE_CLOSE_FAILED');
          }
        };
      }
      if (name.endsWith('/codex.stdout.jsonl')) {
        if (fault === 'partial write failure' || fault === 'zero write') {
          const write = file.write.bind(file);
          file.write = async (buffer, offset, length, position) => {
            writes++;
            if (fault === 'zero write') { failed = true; return { bytesWritten: 0, buffer }; }
            if (writes > 1) { failed = true; throw new Error('SYNTHETIC_CAPTURE_WRITE_FAILED'); }
            return write(buffer, offset, Math.min(length, 4096), position);
          };
        }
        if (fault === 'file sync') file.sync = async () => { failed = true; throw new Error('SYNTHETIC_CAPTURE_SYNC_FAILED'); };
      }
      if (fault === 'directory sync' && capturesClosed === 2 && /\/program-agent-[a-f0-9]{64}$/u.test(name))
        file.sync = async () => { failed = true; throw new Error('SYNTHETIC_CAPTURE_DIRECTORY_SYNC_FAILED'); };
      return file;
    });
    const directory = await assertCaptureUnknown(f, f.invoke());
    assert.equal(failed, true); assert.equal(capturesClosed, 2);
    const stdout = await readFile(join(directory, 'codex.stdout.jsonl'));
    await readFile(join(directory, 'codex.stderr.log'));
    if (fault === 'partial write failure') assert.deepEqual(stdout, captureLogRound(0).stdout.subarray(0, 4096));
    else if (fault === 'zero write') { assert.equal(stdout.length, 0); assert.equal(writes, 1); }
    else assert.deepEqual(stdout, expectedCapture(1).stdout);
    const stop = JSON.parse(await readFile(join(directory, 'ledger/session-stop.json')));
    assert.equal(stop.code, 'PROGRAM_AGENT_CLI_OUTPUT_CAPTURE_FAILED'); assert.equal(stop.inFlightAtReturn, 0);
  });

test('CLI capture: spawn failure drains and closes both already-created private capture files', async t => {
  const f = await captureFixture(t); f.options.codexOptions.codexBinary = join(f.root, 'synthetic-absent-cli');
  const directory = await assertCaptureUnknown(f, f.invoke(), /ENOENT/u);
  for (const name of ['codex.stdout.jsonl', 'codex.stderr.log'])
    assert.equal((await readFile(join(directory, name))).length, 0);
  assert.equal(f.counters.provider, 0);
});
