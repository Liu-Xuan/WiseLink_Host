import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  ACTIVITY_CHECKPOINT_SCHEMA,
  ACTIVITY_CHECKPOINT_QUOTE_SELECTION_SCHEMA,
  DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA,
  DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA,
  consumeHostedDocumentActivity,
} from '../../openclaw/skills/wiselink-research-and-synthesize/scripts/consume-hosted-document-activity.mjs';
import {
  ACTIVITY_PROPOSAL_FUNCTION_NAME,
  activityQuoteSelectionFunctionTool,
  invokeHostedDocumentActivityModel,
} from '../../openclaw/skills/wiselink-research-and-synthesize/scripts/invoke-hosted-document-activity-model.mjs';
import { callJsonTool } from '../../openclaw/skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs';

process.env.TS_NODE_PROJECT = 'tsconfig.node.json';
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { InMemoryTransport } = require('@modelcontextprotocol/server');
const { Client } = require('@modelcontextprotocol/client');
const { CanonicalHostOpenClawMcpService } = require('../../server/modules/canonical-host/canonical-host-openclaw-mcp.service.ts');
const { DocumentActivityRuntimeService } = require('../../server/modules/canonical-host/document-activity-runtime.service.ts');
const { buildDocumentSemanticMap } = require('../../server/modules/document-management/src/hosted/nest/document-semantic-map.ts');
const { GENERIC_SEMANTIC_PROFILE } = require('../../server/modules/document-management/src/hosted/nest/document-semantic-profile.ts');
const { originalFixture } = require('../unit/document-parsing/fixtures/document-original.fixture.ts');

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const FENCE = Object.freeze({ leaseOwner: 'synthetic-producer',
  leaseToken: '0f23e82b-2b1e-46ba-b62b-9e9a2ec62ca0', leaseGeneration: 1 });

function fixture({ sourceText = '🛠️\r\nCafe\u0301 was measured once at 12 kPa.', runRef = 'DAR-selection',
  makeCurrentSource = null } = {}) {
  const original = originalFixture();
  original.source.units[0].kind = 'heading';
  original.source.units[0].payload = { text: sourceText, level: 1 };
  const map = buildDocumentSemanticMap({ original, semanticRevision: 1, profile: GENERIC_SEMANTIC_PROFILE });
  const artifact = { relativePath: 'original/manifest.json', readback: 'VERIFIED', sha256: 'b'.repeat(64), byteLength: 4321 };
  const makeLoaded = source => ({ original: source, structuredSource: source.source,
    run: { status: 'PUBLISHED', manifestArtifact: artifact, sourceBinding: { familyId: 'synthetic-family' } } });
  let loaded = makeCurrentSource ? makeCurrentSource({ original, map, artifact, makeLoaded }) : makeLoaded(original);
  const scope = { tenantId: 'tenant-synthetic', actorUserId: 'actor-synthetic', documentVersionId: original.binding.documentVersionId };
  const row = { runRef, requestId: `request-${runRef}`, documentVersionId: scope.documentVersionId,
    parseRunId: original.binding.parseRunId, parseRevision: original.binding.parseRevision, semanticRevision: 1,
    manifestSha256: artifact.sha256, selection: { sectionIds: [map.sections[0].sectionId] }, expectedRevision: 0,
    candidateRevision: null, status: 'QUEUED', deadline: new Date(Date.now() + 60_000).toISOString(),
    deliveredRanges: [], result: null, saveCommand: null, errorCode: null };
  let saveAttempts = 0;
  let commits = 0;
  const runs = {
    expire: async () => {},
    readRun: async () => structuredClone(row),
    claim: async () => { row.status = 'RUNNING'; return { ...FENCE }; },
    renew: async () => true,
    recordDelivery: async (_scope, _fence, range) => { row.deliveredRanges.push(structuredClone(range)); },
    save: async (_scope, _fence, command, materialize) => {
      saveAttempts++;
      const result = materialize(row, (row.candidateRevision ?? 0) + 1);
      row.saveCommand = structuredClone(command);
      row.result = result;
      row.candidateRevision = (row.candidateRevision ?? 0) + 1;
      row.status = 'SAVED';
      commits++;
      return result;
    },
    fail: async (_scope, _fence, errorCode) => { row.status = 'FAILED'; row.errorCode = errorCode; },
  };
  const activity = new DocumentActivityRuntimeService(
    { authorizeDocumentWork: async () => scope },
    { withActorScope: async (_actor, operation) => operation() },
    { readDocumentOriginal: async () => loaded },
    { read: async () => map },
    { status: async () => ({}) },
    runs,
  );
  const documentWork = { run: async input => {
    assert.equal(input.action, 'STATUS');
    return { nextActivityRunRef: row.result ? null : row.runRef };
  } };
  const hostMcp = new CanonicalHostOpenClawMcpService(
    {}, {}, {}, {}, {}, {}, {}, {}, {},
    { authorizeDocumentWork: async () => scope },
    {}, undefined, undefined, documentWork, undefined, undefined, activity, undefined,
  );
  // Exercise the Host service's actual registerTool schema and callback over a
  // linked in-memory MCP client/server pair; no production listener is used.
  const server = hostMcp.createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'synthetic-quote-selection-test', version: '1.0.0' });
  const close = async () => { await client.close(); await server.close(); };
  const setLoaded = value => { loaded = value; };
  return { original, map, artifact, get loaded() { return loaded; }, setLoaded, scope, row, runs, activity,
    get saveAttempts() { return saveAttempts; }, get commits() { return commits; }, server, serverTransport,
    client, clientTransport, close };
}

async function connect(f) {
  await f.server.connect(f.serverTransport);
  await f.client.connect(f.clientTransport);
  return f.client.listTools();
}

function inMemoryCheckpoint(records) {
  return async () => ({
    readOptional: async name => structuredClone(records.get(name) ?? null),
    write: async (name, value) => { records.set(name, structuredClone(value)); },
  });
}

function modelDependencies(f, { text, mode = 'selection', records = new Map(), callTool = null } = {}) {
  let gatewayCalls = 0;
  const toolActions = [];
  const requestGateway = async (endpoint, init) => {
    gatewayCalls++;
    assert.equal(new URL(endpoint).pathname, '/v1/chat/completions');
    assert.equal(init.method, 'POST');
    const body = JSON.parse(init.body);
    assert.equal(body.stream, false);
    assert.equal(body.tool_choice, 'required');
    assert.equal(body.parallel_tool_calls, false);
    const inputText = body.messages.at(-1).content;
    assert.match(inputText, /INPUT:\n/u);
    let proposal;
    if (mode === 'selection') {
      const tool = activityQuoteSelectionFunctionTool().function.parameters;
      const quoteShape = tool.properties.statements.items.properties.quotes.items;
      assert.deepEqual(quoteShape.required, ['anchorId', 'text']);
      assert.equal(hasOwn(quoteShape.properties, 'start'), false);
      assert.equal(hasOwn(quoteShape.properties, 'end'), false);
      assert.deepEqual(tool.properties.quoteSelectionSchemaVersion.enum, [DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA]);
      const modelInput = JSON.parse(inputText.slice(inputText.indexOf('INPUT:\n') + 'INPUT:\n'.length));
      assert.equal(modelInput.quoteSelectionSchemaVersion, DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA);
      const deliveredText = text ?? modelInput.anchors[0]?.sourceText;
      const anchorRecord = modelInput.anchors.find(value => value.sourceText.includes(deliveredText));
      assert.ok(anchorRecord, 'the selected text comes from a delivered Host anchor');
      proposal = { schemaVersion: DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA,
        quoteSelectionSchemaVersion: DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA,
        statements: [{ statementKey: 'synthetic-claim', label: 'Synthetic condition',
          quotes: [{ anchorId: anchorRecord.anchorId, text: deliveredText }],
          time: null, statusRaw: null, limitations: ['Synthetic fixture only.'] }] };
    } else {
      const input = JSON.parse(inputText.slice(inputText.indexOf('INPUT:\n') + 'INPUT:\n'.length));
      const anchor = input.anchors.find(value => value.sourceText.includes(text));
      assert.ok(anchor);
      const start = anchor.sourceText.indexOf(text);
      proposal = { schemaVersion: DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA,
        statements: [{ statementKey: 'legacy-claim', label: 'Legacy synthetic condition',
          quotes: [{ anchorId: anchor.anchorId, start, end: start + text.length, text }],
          time: null, statusRaw: null, limitations: ['Synthetic fixture only.'] }] };
      assert.equal(body.tools[0].function.parameters.properties.statements.items.properties.quotes.items.required.includes('start'), true);
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ model_version: 'synthetic-model',
      choices: [{ message: { role: 'assistant', tool_calls: [{ type: 'function', function: {
        name: ACTIVITY_PROPOSAL_FUNCTION_NAME, arguments: JSON.stringify(proposal),
      } }] } }] }) };
  };
  const dependencies = {
    callTool: callTool ?? ((name, args, options) => {
      toolActions.push(args.action);
      return callJsonTool(f.client, name, args, options, 3);
    }),
    checkpointFactory: inMemoryCheckpoint(records),
    invokeModel: (input, hooks) => invokeHostedDocumentActivityModel(input, {
      gatewayUrl: 'https://synthetic-gateway.invalid', gatewayToken: 'synthetic-token',
      agentId: 'synthetic-test-agent', configuredModelVersion: 'synthetic-model', timeoutMs: 5000,
      ...hooks,
    }, { requestGateway }),
  };
  return { dependencies, records, toolActions, get gatewayCalls() { return gatewayCalls; } };
}

function runOptions(f, quoteSelection = true) {
  return { documentVersionId: f.scope.documentVersionId, runRef: f.row.runRef,
    leaseOwner: FENCE.leaseOwner, readLimit: 50,
    ...(quoteSelection ? { quoteSelectionSchemaVersion: DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA } : {}) };
}

test('quote-selection producer uses its versioned tool over registered Host MCP, saves exact offsets, then recovers by receipt', async () => {
  const text = 'Cafe\u0301 was measured once at 12 kPa.';
  const f = fixture({ sourceText: `🛠️\r\n${text}` });
  const toolList = await connect(f);
  try {
    const registered = toolList.tools.find(tool => tool.name === 'document_work');
    assert.ok(registered?.inputSchema);
    assert.match(JSON.stringify(registered.inputSchema), /ACTIVITY_SAVE_SELECTION/u);
    const model = modelDependencies(f, { text, mode: 'selection' });
    const first = await consumeHostedDocumentActivity(runOptions(f), model.dependencies);
    assert.equal(first.status, 'ACTIVITY_WORK_SAVED');
    assert.equal(first.modelInvocations, 1);
    assert.deepEqual(first.saved.statements[0].quotes[0], {
      anchorId: first.saved.statements[0].quotes[0].anchorId,
      start: 5,
      end: 5 + text.length,
      text,
    });
    assert.equal(first.saved.schemaVersion, DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA);
      assert.equal(hasOwn(first.saved, 'quoteSelectionSchemaVersion'), false);
    assert.equal(f.saveAttempts, 1);
    assert.equal(f.commits, 1);
    assert.equal(model.gatewayCalls, 1);
    for (const record of model.records.values())
      assert.equal(record.schemaVersion, ACTIVITY_CHECKPOINT_QUOTE_SELECTION_SCHEMA);
    const saveRequest = f.row.saveCommand;
    assert.ok(model.toolActions.includes('ACTIVITY_SAVE_SELECTION'));
    assert.equal(saveRequest.candidate.quoteSelectionSchemaVersion, DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA);
    assert.deepEqual(Object.keys(saveRequest.candidate.statements[0].quotes[0]).sort(), ['anchorId', 'text']);

    const recovered = await consumeHostedDocumentActivity(runOptions(f), model.dependencies);
    assert.equal(recovered.status, 'ACTIVITY_WORK_SAVED');
    assert.equal(recovered.modelInvocations, 0);
    assert.deepEqual(recovered.saved, first.saved);
    assert.equal(model.gatewayCalls, 1);
    assert.equal(f.saveAttempts, 1);
    assert.equal(f.commits, 1);
  } finally { await f.close(); }
});

test('legacy default keeps the original numeric v1 producer, SAVE action, receipt, and checkpoint envelope', async () => {
  const text = 'LEGACY-SYNTHETIC-QUOTE';
  const f = fixture({ sourceText: `Legacy source says ${text} exactly once.` , runRef: 'DAR-legacy' });
  await connect(f);
  try {
    const model = modelDependencies(f, { text, mode: 'legacy' });
    const first = await consumeHostedDocumentActivity(runOptions(f, false), model.dependencies);
    assert.equal(first.status, 'ACTIVITY_WORK_SAVED');
    assert.deepEqual(first.saved.statements[0].quotes[0], {
      anchorId: first.saved.statements[0].quotes[0].anchorId,
      start: `Legacy source says `.length,
      end: `Legacy source says `.length + text.length,
      text,
    });
    assert.ok(model.toolActions.includes('ACTIVITY_SAVE'));
    assert.equal(hasOwn(f.row.saveCommand.candidate, 'quoteSelectionSchemaVersion'), false);
    assert.ok([...model.records.values()].every(record => record.schemaVersion === ACTIVITY_CHECKPOINT_SCHEMA));
    const recovered = await consumeHostedDocumentActivity(runOptions(f, false), model.dependencies);
    assert.equal(recovered.modelInvocations, 0);
    assert.deepEqual(recovered.saved, first.saved);
    assert.equal(model.gatewayCalls, 1);
    assert.equal(f.commits, 1);
  } finally { await f.close(); }
});

test('checkpoint envelopes bind quote-selection mode and prevent numeric-mode recovery from reusing it', async () => {
  const text = 'MODE-SYNTHETIC-QUOTE';
  const f = fixture({ sourceText: `Checkpoint includes ${text}.`, runRef: 'DAR-mode' });
  await connect(f);
  try {
    const records = new Map();
    const baseModel = modelDependencies(f, { text, mode: 'selection', records });
    let loseFirstSelectionSave = true;
    const dependencies = { ...baseModel.dependencies,
      callTool: (name, args, options) => {
        if (args.action === 'ACTIVITY_SAVE_SELECTION' && loseFirstSelectionSave) {
          loseFirstSelectionSave = false;
          throw new Error('SYNTHETIC_RESPONSE_LOST');
        }
        return callJsonTool(f.client, name, args, options, 3);
      } };
    await assert.rejects(consumeHostedDocumentActivity(runOptions(f), dependencies), /ACTIVITY_SAVE_UNCONFIRMED/u);
    assert.equal(f.commits, 0);
    assert.equal(records.get('model.result').schemaVersion, ACTIVITY_CHECKPOINT_QUOTE_SELECTION_SCHEMA);
    assert.equal(records.get('save.started').schemaVersion, ACTIVITY_CHECKPOINT_QUOTE_SELECTION_SCHEMA);
    assert.equal(baseModel.gatewayCalls, 1);

    await assert.rejects(consumeHostedDocumentActivity(runOptions(f, false), baseModel.dependencies), /ACTIVITY_CHECKPOINT_BINDING_MISMATCH/u);
    assert.equal(baseModel.gatewayCalls, 1);
    assert.equal(f.commits, 0);
  } finally { await f.close(); }
});

test('ambiguous Host-side selection and a source change between READ and SAVE both leave the run uncommitted', async () => {
  const f = fixture({ sourceText: 'repeat / repeat; another exact clause.' , runRef: 'DAR-ambiguous' });
  await connect(f);
  try {
    const claim = await callJsonTool(f.client, 'document_work', { action: 'ACTIVITY_CLAIM',
      documentVersionId: f.scope.documentVersionId, runRef: f.row.runRef, leaseOwner: FENCE.leaseOwner });
    const read = await callJsonTool(f.client, 'document_work', { action: 'ACTIVITY_READ',
      documentVersionId: f.scope.documentVersionId, runRef: f.row.runRef, ...claim.fence,
      sectionId: f.row.selection.sectionIds[0], offset: 0, limit: 50 });
    const anchor = read.anchors.find(value => value.sourceText.includes('repeat / repeat'));
    assert.ok(anchor);
    const candidate = { schemaVersion: DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA,
      quoteSelectionSchemaVersion: DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA,
      statements: [{ statementKey: 'ambiguous-claim', label: 'Synthetic repeat',
        quotes: [{ anchorId: anchor.anchorId, text: 'repeat' }], time: null, statusRaw: null,
        limitations: ['Synthetic fixture only.'] }] };
    const result = await f.client.callTool({ name: 'document_work', arguments: {
      action: 'ACTIVITY_SAVE_SELECTION', documentVersionId: f.scope.documentVersionId, runRef: f.row.runRef,
      ...claim.fence, candidate, producer: { skillVersion: 'synthetic', modelVersion: 'synthetic' },
    } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /DOCUMENT_ACTIVITY_QUOTE_SELECTION_TEXT_AMBIGUOUS:STATEMENT_0:QUOTE_0/u);
    assert.equal(f.saveAttempts, 1);
    assert.equal(f.commits, 0);
    assert.equal(f.row.result, null);
  } finally { await f.close(); }

  const changed = fixture({ sourceText: 'exact source before any update.', runRef: 'DAR-changed' });
  await connect(changed);
  try {
    const claim = await callJsonTool(changed.client, 'document_work', { action: 'ACTIVITY_CLAIM',
      documentVersionId: changed.scope.documentVersionId, runRef: changed.row.runRef, leaseOwner: FENCE.leaseOwner });
    const read = await callJsonTool(changed.client, 'document_work', { action: 'ACTIVITY_READ',
      documentVersionId: changed.scope.documentVersionId, runRef: changed.row.runRef, ...claim.fence,
      sectionId: changed.row.selection.sectionIds[0], offset: 0, limit: 50 });
    const anchor = read.anchors.find(value => value.sourceText.includes('exact source before'));
    assert.ok(anchor);
    const candidate = { schemaVersion: DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA,
      quoteSelectionSchemaVersion: DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA,
      statements: [{ statementKey: 'changed-claim', label: 'Synthetic source',
        quotes: [{ anchorId: anchor.anchorId, text: 'exact source before' }], time: null, statusRaw: null,
        limitations: ['Synthetic fixture only.'] }] };
    const changedOriginal = structuredClone(changed.original);
    changedOriginal.binding.sourceSha256 = 'c'.repeat(64);
    const changedArtifact = { ...changed.artifact, sha256: 'c'.repeat(64) };
    changed.setLoaded({ original: changedOriginal, structuredSource: changedOriginal.source,
      run: { status: 'PUBLISHED', manifestArtifact: changedArtifact, sourceBinding: { familyId: 'synthetic-family' } } });
    const result = await changed.client.callTool({ name: 'document_work', arguments: {
      action: 'ACTIVITY_SAVE_SELECTION', documentVersionId: changed.scope.documentVersionId, runRef: changed.row.runRef,
      ...claim.fence, candidate, producer: { skillVersion: 'synthetic', modelVersion: 'synthetic' },
    } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /DOCUMENT_ACTIVITY_ORIGINAL_CHANGED/u);
    assert.equal(changed.saveAttempts, 0);
    assert.equal(changed.commits, 0);
    assert.equal(changed.row.result, null);
  } finally { await changed.close(); }
});
