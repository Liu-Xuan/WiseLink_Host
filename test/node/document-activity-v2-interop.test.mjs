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
import { activityV2ProductionContract, DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2, DOCUMENT_ACTIVITY_QUOTE_OFFSETS_SCHEMA } from '../../openclaw/skills/wiselink-research-and-synthesize/scripts/document-activity-model-contract.mjs';
import { callJsonTool, validateHostToolMetadata } from '../../openclaw/skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs';
import { ACTIVITY_MODEL_EVIDENCE_VIEW_VERSION, restoreActivityModelEvidenceView } from '../../openclaw/skills/wiselink-research-and-synthesize/scripts/activity-model-evidence-view.mjs';
import { canonicalSha256 } from '../../openclaw/skills/wiselink-research-and-synthesize/scripts/validate-payload.mjs';

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

const EXECUTION_MODEL = { modelRef: 'miaoda/glm-5.3', displayName: 'GLM5.3', providerKind: 'BUILT_IN',
  settingsRevision: 1, selectedAt: '2026-10-12T00:00:00.000Z' };

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const FENCE = Object.freeze({ leaseOwner: 'synthetic-producer',
  leaseToken: '0f23e82b-2b1e-46ba-b62b-9e9a2ec62ca0', leaseGeneration: 1 });

function fixture({ sourceText = '🛠️\r\nCafe\u0301 was measured once at 12 kPa.', runRef = 'DAR-selection',
  makeCurrentSource = null, selectionMode = true } = {}) {
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
    manifestSha256: artifact.sha256, executionModel: EXECUTION_MODEL, candidateSchemaVersion: DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2,
    productionContract: activityV2ProductionContract(selectionMode ? DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA : DOCUMENT_ACTIVITY_QUOTE_OFFSETS_SCHEMA), selection: { sectionIds: [map.sections[0].sectionId] }, expectedRevision: 0,
    candidateRevision: null, status: 'QUEUED', deadline: new Date(Date.now() + 60_000).toISOString(),
    deliveredRanges: [], result: null, saveCommand: null, errorCode: null };
  let saveAttempts = 0;
  let commits = 0;
  const runs = {
    readRequest: async () => null,
    begin: async (_scope, input) => { Object.assign(row,input); return structuredClone(row); },
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
    runs, { captureForNewTask: async () => EXECUTION_MODEL },
  );
  const documentWork = { run: async input => {
    assert.equal(input.action, 'STATUS');
    return { nextActivityRunRef: row.result ? null : row.runRef };
  } };
  const hostMcp = new CanonicalHostOpenClawMcpService(
    {}, {}, {}, {}, {}, {}, {}, {}, {},
    { authorizeDocumentWork: async () => scope },
    {}, {}, {}, documentWork, {}, {}, activity, { run: async () => { throw new Error('unexpected fixture document reading'); } }, { run: async () => { throw new Error('unexpected fixture derived summary'); } },
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


function modelFixture(f, { selectionMode = true, afterModel = () => {}, records = new Map(), loseSaveReply = false } = {}) {
  let calls = 0; let lost = false; let expectedInputHash; const actions = [];
  const requestGateway = async (_endpoint, init) => {
    calls++;
    assert.equal(init.headers['x-openclaw-model'], EXECUTION_MODEL.modelRef);
    const request = JSON.parse(init.body); const text = request.messages.at(-1).content;
    const delivered = JSON.parse(text.slice(text.indexOf('INPUT:\n')+'INPUT:\n'.length));
    const input = delivered.schemaVersion === ACTIVITY_MODEL_EVIDENCE_VIEW_VERSION ? restoreActivityModelEvidenceView(delivered, expectedInputHash) : delivered;
    assert.equal(canonicalSha256(input), expectedInputHash);
    assert.equal(input.candidateSchemaVersion,DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2);
    assert.deepEqual(input.productionContract,f.row.productionContract);
    assert.equal(input.sourceContext.schemaVersion,f.row.productionContract.sourceContextVersion);
    const anchor = input.anchors.find(value=>value.sourceUnitId==='u1');
    const condition = input.anchors.find(value=>value.sourceText==='Only when X');
    const quote = value => selectionMode ? {anchorId:value.anchorId,text:value.sourceText} :
      {anchorId:value.anchorId,start:0,end:value.sourceText.length,text:value.sourceText};
    const proposal = {schemaVersion:DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2,
      ...(selectionMode?{quoteSelectionSchemaVersion:DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA}:{}),statements:[{
      statementKey:'source-local',label:'Source plans and prerequisites',quotes:[quote(anchor),quote(condition)],
      subject:{raw:'Supplier',quoteIndex:0},action:{raw:'release',quoteIndex:0},
      modality:{raw:'plans',quoteIndex:0,meaning:'PLANNED',negationQuoteIndexes:[0]},status:{raw:'TBD',quoteIndex:0,meaning:'UNKNOWN'},
      times:[{raw:'Q4 2026',quoteIndex:0,role:'TARGET',precision:'QUARTER',expression:'CALENDAR'},
        {raw:'March 2027',quoteIndex:0,role:'UNKNOWN',precision:'MONTH',expression:'CALENDAR'},
        {raw:'TBD',quoteIndex:0,role:'UNKNOWN',precision:'UNKNOWN',expression:'TBD'}],
      technicalIds:[{raw:'LN 2024-2026',quoteIndex:0,kind:'AIRCRAFT_LINE_NUMBER'}],
      scope:{sectionIds:f.row.selection.sectionIds,conditions:[{raw:'Only when X',quoteIndex:1,kind:'PREREQUISITE',appliesTo:'SECTION',sectionIds:f.row.selection.sectionIds}],completeness:'DELIVERED_SCOPE_ONLY'},
      limitations:['Constructed protocol/storage fixture; forecast classification is not certified.']}]};
    afterModel();
    return {ok:true,status:200,text:async()=>JSON.stringify({model_version:'synthetic-v2-model',choices:[{message:{role:'assistant',
      tool_calls:[{type:'function',function:{name:ACTIVITY_PROPOSAL_FUNCTION_NAME,arguments:JSON.stringify(proposal)}}]}}]})};
  };
  const dependencies = {callTool:async(name,args,options)=>{
    actions.push(args.action); const reply=await callJsonTool(f.client,name,args,options,3);
    if(loseSaveReply&&!lost&&(args.action==='ACTIVITY_SAVE'||args.action==='ACTIVITY_SAVE_SELECTION')){lost=true;throw new Error('SYNTHETIC_SAVE_RESPONSE_LOST');}
    return reply;
  },checkpointFactory:inMemoryCheckpoint(records),invokeModel:(input,hooks)=>{ expectedInputHash=canonicalSha256(input); return invokeHostedDocumentActivityModel(input,{
    gatewayUrl:'https://synthetic-gateway.invalid',gatewayToken:'synthetic-test-only',agentId:'synthetic-agent',configuredModelVersion:'synthetic-v2-model',
    registeredModelRefs:[EXECUTION_MODEL.modelRef],timeoutMs:5000,...hooks},{requestGateway}); }};
  return {dependencies,records,actions,get modelCalls(){return calls;}};
}
const SOURCE = '😀 Supplier plans release in Q4 2026; expected approval March 2027. Actual installation TBD. LN 2024-2026. Do not install before prerequisite.';
function options(f,selectionMode=true){return {documentVersionId:f.scope.documentVersionId,runRef:f.row.runRef,
  leaseOwner:FENCE.leaseOwner,readLimit:1,candidateSchemaVersion:DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2,
  ...(selectionMode?{quoteSelectionSchemaVersion:DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA}:{})};}

for(const selectionMode of [true,false]) test(`v2 ${selectionMode?'selection':'offsets'}: actual registered MCP READ/context, adapter request, Host SAVE and exact receipt recovery`,async()=>{
  const f=fixture({sourceText:SOURCE,runRef:selectionMode?'DAR-v2-selection':'DAR-v2-offsets',selectionMode});
  const listed=await connect(f);validateHostToolMetadata(listed);const model=modelFixture(f,{selectionMode});
  try{
    const begin=await callJsonTool(f.client,'document_work',{action:'ACTIVITY_BEGIN',documentVersionId:f.scope.documentVersionId,
      parseRunId:f.row.parseRunId,semanticRevision:1,requestId:f.row.requestId,expectedRevision:0,sectionIds:f.row.selection.sectionIds,
      candidateSchemaVersion:DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2,productionContract:f.row.productionContract});
    assert.equal(begin.candidateSchemaVersion,DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2);assert.deepEqual(begin.productionContract,f.row.productionContract);
    const result=await consumeHostedDocumentActivity(options(f,selectionMode),model.dependencies);
    assert.equal(result.status,'ACTIVITY_WORK_SAVED');assert.equal(f.commits,1);assert.equal(model.modelCalls,1);
    assert.deepEqual(result.saved.sourceBinding,{original:f.original.binding,semanticRevision:1});
    assert.deepEqual(result.saved.statements[0].times.map(value=>value.raw),['Q4 2026','March 2027','TBD']);
    assert.equal(result.saved.statements[0].technicalIds[0].raw,'LN 2024-2026');
    assert.equal(result.saved.statements[0].quotes[0].text,SOURCE);assert.equal(result.saved.statements[0].quotes[0].end,SOURCE.length);
    assert.equal(result.saved.statements[0].time,undefined);assert.equal(result.saved.statements[0].scope.conditions[0].raw,'Only when X');
    assert.equal(result.saved.sourceContext.profile.selectionBasis,'NOT_RECORDED');
    assert.ok(result.saved.statements[0].statementId.startsWith('DAS-'));
    const recovered=await consumeHostedDocumentActivity(options(f,selectionMode),model.dependencies);
    assert.equal(recovered.modelInvocations,0);assert.deepEqual(recovered.saved,result.saved);assert.equal(model.modelCalls,1);assert.equal(f.commits,1);
    for(const step of ['source.result','model.started','model.result','save.started'])assert.equal(model.records.get(step).schemaVersion,'wiselink.document.activity-checkpoint.v2');
  }finally{await f.close();}
});

test('v2 registered Host refuses source drift after READ before SAVE without committing',async()=>{
  const f=fixture({sourceText:SOURCE,runRef:'DAR-v2-source-drift'});await connect(f);
  const model=modelFixture(f,{afterModel:()=>{f.setLoaded({...f.loaded,run:{...f.loaded.run,manifestArtifact:{...f.artifact,sha256:'c'.repeat(64)}}});}});
  try{
    await assert.rejects(consumeHostedDocumentActivity(options(f),model.dependencies),error => {
      assert.match(error.message,/ACTIVITY_SAVE_UNCONFIRMED/u); assert.match(JSON.stringify(error.cause?.hostResult??error.cause?.message??''),/ORIGINAL_CHANGED|REVIEW_HOST_MCP_TOOL_FAILED/u); return true; });
    assert.equal(f.commits,0);assert.equal(f.row.result,null);assert.equal(model.modelCalls,1);
    await assert.rejects(consumeHostedDocumentActivity(options(f),model.dependencies),/ACTIVITY_SAVE_UNCONFIRMED/u);
    assert.equal(model.modelCalls,1);assert.equal(f.commits,0);
  }finally{await f.close();}
});

test('v2 saved response loss is recovered by the original run without another dispatch or SAVE',async()=>{
  const f=fixture({sourceText:SOURCE,runRef:'DAR-v2-response-loss'});await connect(f);const model=modelFixture(f,{loseSaveReply:true});
  try{
    const result=await consumeHostedDocumentActivity(options(f),model.dependencies);
    assert.equal(result.status,'ACTIVITY_WORK_SAVED');assert.equal(f.commits,1);assert.equal(model.modelCalls,1);
    const recovered=await consumeHostedDocumentActivity(options(f),model.dependencies);
    const {replayed:_replayed,...saved}=result.saved;const {replayed:_recovered,...read}=recovered.saved;
    assert.deepEqual(read,saved);assert.equal(recovered.modelInvocations,0);assert.equal(f.commits,1);assert.equal(model.modelCalls,1);
  }finally{await f.close();}
});

test('Host-produced saved semantic receipt round-trips v2 with exact statements and no inferred authority', async () => {
  const f = fixture({ sourceText: SOURCE, runRef: 'DAR-recorded-profile' });
  f.map.profileSelection = {
    policyVersion: 'registered-metadata-existing-dispatch.v1', reason: 'UNKNOWN_FAMILY',
    registeredIdentity: { family: null, issuer: 'OTHER' }, evidenceSourceRefIds: [],
  };
  const before = JSON.stringify(f.map);
  await connect(f); const model = modelFixture(f);
  try {
    const result = await consumeHostedDocumentActivity(options(f), model.dependencies);
    assert.equal(result.status, 'ACTIVITY_WORK_SAVED');
    assert.deepEqual(result.saved.sourceContext.profile, {
      profileRef: f.map.profileRef, selectionBasis: 'RECORDED',
      selectionSchemaVersion: 'wiselink.document.semantic-profile-selection.v1', selection: f.map.profileSelection,
    });
    assert.deepEqual(result.saved.sourceBinding, { original: f.original.binding, semanticRevision: 1 });
    assert.deepEqual(result.saved.statements[0].times.map(value => value.raw), ['Q4 2026', 'March 2027', 'TBD']);
    assert.equal(result.saved.statements[0].scope.conditions[0].raw, 'Only when X');
    assert.equal(result.saved.statements[0].technicalIds[0].raw, 'LN 2024-2026');
    assert.equal(result.saved.statements[0].quotes[0].text, SOURCE);
    assert.equal(JSON.stringify(f.map), before);
    const recovered = await consumeHostedDocumentActivity(options(f), model.dependencies);
    assert.deepEqual(recovered.saved, result.saved);
    assert.equal(model.modelCalls, 1); assert.equal(f.commits, 1);
  } finally { await f.close(); }
});
