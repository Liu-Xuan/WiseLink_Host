import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createProgramAgentSession, validateProgramAgentCandidate } from './program-agent-session.mjs';
import { programRecoveryData } from './program-recovery-fixture.mjs';
import { prepareProgramAgentMaterials } from '../skills/wiselink-research-and-synthesize/scripts/program-assessment-materials.mjs';
import { runProgramAgentGateway } from './program-agent-gateway.mjs';
import { createCheckpointStore } from '../skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs';
import { invokeHostedProgramAssessmentAgent } from '../skills/wiselink-research-and-synthesize/scripts/run-program-assessment.mjs';

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
async function fakeCli(root, work, selected, validate = false) {
  const path = join(root, 'fake-codex.mjs');
  const code = `#!${process.execPath}
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
for await (const _ of process.stdin) {}
const config = await readFile(join(process.env.CODEX_HOME, 'config.toml'), 'utf8');
const base = config.match(/base_url = "([^"]+)"/)[1];
const post = async (url, token, body) => {
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
await writeFile(join(dirname(process.env.CODEX_HOME), 'synthetic-child-observations.json'), JSON.stringify({ one, source, after, validation }));
const finalPath = process.argv[process.argv.indexOf('--output-last-message') + 1];
await writeFile(finalPath, ${JSON.stringify(JSON.stringify({ tool_name: 'return_wiselink_program_assessment', arguments: { workJson: JSON.stringify(work) } }))});
console.log(JSON.stringify({ type: 'turn.completed' }));
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
      reportedModel: 'fixture/synthetic-only', maxOutputTokens: request.maxOutputTokens,
      executionModel: request.executionModel, clientRequestSha256: request.clientRequestSha256,
      effectiveRequestSha256: request.effectiveRequestSha256,
      upstreamRequestSha256: sha(upstreamRequestBytes), upstreamResponseSha256: sha(upstreamResponseBytes) } };
}

async function gatewayFixture(t, includeStatement) {
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
    codexOptions: { codexBinary: await fakeCli(root, data.work, selected, includeStatement), runRoot: join(root, 'runs') },
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
  let originalGatewayInput;
  const invoke = () => invokeHostedProgramAssessmentAgent({ operation: 'EVALUATE_JOBAID', modelInput: data.modelInput }, options,
    { providerDispatch: async request => { counters.provider++; return providerResponse(request); },
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
    const child = JSON.parse(await readFile(join(link.runDirectory, 'synthetic-child-observations.json')));
    t.diagnostic(JSON.stringify({ failure, providerCalls: f.counters.provider, saveCalls: f.counters.save,
      readStatus: child.source.status, afterReadPostStatus: child.after?.status }));
    assert.equal(f.counters.provider, 1);
    assert.equal(failure, 'PROGRAM_AGENT_OUTCOME_UNKNOWN');
    assert.equal(f.counters.save, 0);
    assert.equal(child.source.status, 502);
    assert.equal(child.after.status, 502);
    assert.equal(JSON.stringify(child).includes('SYNTHETIC_PRIVATE_DETAIL'), false);
    const ledgerFile = join(link.runDirectory, 'ledger/dispatch-1.started.json');
    const ledgerBefore = await readFile(ledgerFile);
    assert.equal(JSON.parse(ledgerBefore).maxOutputTokens, 131072);
    assert.ok(await f.checkpoint.readOptional('program-agent-candidate.started'));
    assert.equal(await f.checkpoint.readOptional('program-agent-candidate.result'), null);
    assert.equal(await f.checkpoint.readOptional('program-save-request'), null);
    await assert.rejects(f.recoverExact(), /PROGRAM_AGENT_OUTCOME_UNKNOWN/u);
    // Existing parent checkpoint canonicalization changes JSON property order
    // used by the gateway's frozen material hashes. Preserve this safe refusal,
    // rather than changing old hashes or claiming parent re-entry succeeds.
    await assert.rejects(f.invoke(), /PROGRAM_AGENT_BINDING_MISMATCH/u);
    t.diagnostic('exact frozen recovery: OUTCOME_UNKNOWN; parent re-entry: BINDING_MISMATCH; neither dispatches');
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
