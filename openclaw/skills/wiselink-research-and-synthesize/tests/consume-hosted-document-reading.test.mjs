import assert from 'node:assert/strict';
import test from 'node:test';
import { consumeHostedDocumentReading } from '../scripts/consume-hosted-document-reading.mjs';
import { invokeHostedDocumentReadingModel } from '../scripts/invoke-hosted-document-reading-model.mjs';
import { readHostMcpJsonResult } from '../scripts/run-hosted-review-turn.mjs';

function fixture() {
  const records = new Map(); const calls = []; let models = 0; let saved = null;
  const options = { documentVersionId: 'DV-test', runRef: 'DRR-test', leaseOwner: 'fixture' };
  const binding = { original: { documentVersionId: 'DV-test', parseRunId: 'PR-test', parseRevision: 1,
    sourceArtifactId: 'source-test', sourceSha256: 'a'.repeat(64), sourceByteLength: 10 }, semanticRevision: 1 };
  const anchor = { anchorId: 'a1', sourceUnitId: 'u1', sourceText: 'Not confirmed.', sourceRefIds: ['SR-test'], sourceLocators: [{ sourceRefId: 'SR-test' }] };
  const statement = { text: '尚未确认。', quotes: [{ anchorId: 'a1', start: 0, end: 14, text: 'Not confirmed.' }] };
  const proposal = { schemaVersion: 'wiselink.document.reading.v1', headline: '来源条件', brief: statement,
    explanation: [statement], criticalConditions: [statement], limitations: [] };
  const state = () => ({ ...options, parseRunId: 'PR-test', semanticRevision: 1, expectedRevision: 0,
    status: saved ? 'SAVED' : 'RUNNING', result: saved, deadline: new Date(Date.now()+3600000).toISOString() });
  const deps = {
    checkpointFactory: async () => ({ readOptional: async key => structuredClone(records.get(key) ?? null),
      write: async (key, value) => { records.set(key, structuredClone(value)); } }),
    invokeModel: async () => { models++;return { proposal, modelVersion: 'fixture-no-live-model' }; },
    callTool: async (tool, request) => {
      assert.equal(tool, 'document_reading');calls.push(request.action);
      if (request.action === 'READING_STATUS') return state();
      if (request.action === 'READING_CLAIM') return { ...state(), fence: { leaseOwner: 'fixture',
        leaseToken: '0f23e82b-2b1e-46ba-b62b-9e9a2ec62ca0', leaseGeneration: 1 } };
      if (request.action === 'READING_HEARTBEAT') return { runRef: options.runRef, renewed: true };
      if (request.action === 'READING_READ') return { runRef: options.runRef, sourceBinding: binding,
        units: [{ unitId: 'u1' }], anchors: [anchor], range: { offset: 0, unitIds: ['u1'], anchorIds: ['a1'], nextOffset: null },
        sourceCoverage: { knownPageCount: 1, readPageIndexes: [0], unresolvedRanges: [] } };
      if (request.action === 'READING_SAVE') {
        saved = { ...request.candidate, readingRunRef: options.runRef, readingRevision: 1, candidateOnly: true,
          sourceBinding: binding, producer: request.producer, savedAt: new Date().toISOString(), sourceAnchors: [anchor],
          readCoverage: { status: 'COMPLETE_DELIVERY', deliveredUnitIds: ['u1'], totalUnitCount: 1,
            sourceCoverage: { knownPageCount: 1, readPageIndexes: [0], unresolvedRanges: [] } } };
        return saved;
      }
      throw new Error(`unexpected ${request.action}`);
    },
  };
  return { options, deps, records, calls, count: () => models };
}

test('one admitted run creates one source-bound save, and a second consumption reads it without another model', async () => {
  const f = fixture();
  const result = await consumeHostedDocumentReading(f.options, f.deps);
  assert.equal(result.status, 'READING_SAVED'); assert.equal(result.saved.brief.text, '尚未确认。');
  assert.equal(f.count(), 1); assert.equal(f.calls.filter(x => x==='READING_SAVE').length, 1);
  assert.equal((await consumeHostedDocumentReading(f.options, f.deps)).modelInvocations, 0);
  assert.equal(f.count(), 1); assert.ok(!f.calls.some(x => /BEGIN|ACTIVITY|TRANSLATION/.test(x)));
});

test('withdrawn saved run is a terminal status and never claims, models or saves', async () => {
  const f = fixture();
  f.deps.checkpointFactory = async () => assert.fail('terminal run must not touch checkpoints');
  f.deps.invokeModel = async () => assert.fail('terminal run must not invoke a model');
  f.deps.callTool = async (_tool, request) => {
    assert.equal(request.action, 'READING_STATUS');
    return { ...f.options, parseRunId: 'PR-test', semanticRevision: 1, expectedRevision: 0,
      status: 'RETRACTED', result: null, readingRevision: 1 };
  };
  assert.deepEqual(await consumeHostedDocumentReading(f.options, f.deps),
    { status: 'RETRACTED', modelInvocations: 0 });
});

test('lost model response remains uncertain across restart and never generates or saves again', async () => {
  const f = fixture(); let attempts = 0;
  f.deps.invokeModel = async () => { attempts++; throw new Error('uncertain network'); };
  assert.equal((await consumeHostedDocumentReading(f.options, f.deps)).status, 'PENDING_MODEL_CONFIRMATION');
  assert.equal((await consumeHostedDocumentReading(f.options, f.deps)).status, 'PENDING_MODEL_CONFIRMATION');
  assert.equal(attempts, 1); assert.ok(!f.calls.includes('READING_SAVE'));
});

test('actual MCP reading rejection remains a bounded application error across consumer restart', async () => {
  const f = fixture(); const call = f.deps.callTool; let saves = 0;
  f.deps.callTool = async (tool, request) => {
    if (request.action === 'READING_SAVE') {
      saves++;
      return readHostMcpJsonResult({ isError: true, content: [{ type: 'text',
        text: 'Error: DOCUMENT_READING_QUOTE_MISMATCH' }] }, tool, request);
    }
    return call(tool, request);
  };
  const result = await consumeHostedDocumentReading(f.options, f.deps);
  assert.equal(result.status, 'REQUIRES_ATTENTION');
  assert.equal(result.errorCode, 'DOCUMENT_READING_QUOTE_MISMATCH');
  assert.deepEqual(f.records.get('failure').value, { errorCode: 'DOCUMENT_READING_QUOTE_MISMATCH',
    modelResponse: { finishReason: null, usage: {
      inputTokens: null, outputTokens: null, totalTokens: null, reasoningTokens: null,
    } } });
  const resumed = await consumeHostedDocumentReading(f.options, f.deps);
  assert.equal(resumed.status, 'REQUIRES_ATTENTION');
  assert.equal(resumed.modelInvocations, 0);
  assert.equal(saves, 1); assert.equal(f.count(), 1);
});

test('exact SAVED receipt takes precedence over an MCP reading error', async () => {
  const f = fixture(); const call = f.deps.callTool;
  f.deps.callTool = async (tool, request) => {
    const value = await call(tool, request);
    if (request.action === 'READING_SAVE') return readHostMcpJsonResult({ isError: true,
      content: [{ type: 'text', text: 'DOCUMENT_READING_LEASE_REJECTED' }] }, tool, request);
    return value;
  };
  const result = await consumeHostedDocumentReading(f.options, f.deps);
  assert.equal(result.status, 'READING_SAVED');
  assert.equal(f.records.has('failure'), false);
  assert.equal(f.count(), 1);
});

test('Host lease/source errors need attention while unstructured transport errors remain uncertain', async () => {
  for (const code of ['DOCUMENT_READING_LEASE_REJECTED', 'DOCUMENT_READING_ORIGINAL_CHANGED', 'fetch failed']) {
    const f = fixture(); const call = f.deps.callTool; let saves = 0;
    f.deps.callTool = async (tool, request) => {
      if (request.action === 'READING_SAVE') {
        saves++;
        return readHostMcpJsonResult({ isError: true, content: [{ type: 'text', text: code }] }, tool, request);
      }
      return call(tool, request);
    };
    const result = await consumeHostedDocumentReading(f.options, f.deps);
    assert.equal(result.status, code === 'fetch failed' ? 'PENDING_SAVE_CONFIRMATION' : 'REQUIRES_ATTENTION');
    assert.equal(f.calls.includes('READING_FAIL'), false);
    assert.equal(saves, 1); assert.equal(f.count(), 1);
  }
});

test('lost SAVE response is recovered only by exact saved Host readback', async () => {
  const f = fixture();const call = f.deps.callTool;
  f.deps.callTool = async (...args) => { const result = await call(...args); if (args[1].action==='READING_SAVE') throw new Error('lost response'); return result; };
  assert.equal((await consumeHostedDocumentReading(f.options, f.deps)).status, 'READING_SAVED');
  assert.equal(f.count(), 1); assert.equal(f.calls.filter(x => x==='READING_SAVE').length, 1);
});

test('unconfirmed SAVE stays pending across restart without a duplicate SAVE or model call', async () => {
  const f = fixture();const call = f.deps.callTool;let saves=0;
  f.deps.callTool = async (...args) => { if(args[1].action==='READING_SAVE'){saves++;throw new Error('unknown');} return call(...args); };
  assert.equal((await consumeHostedDocumentReading(f.options, f.deps)).status, 'PENDING_SAVE_CONFIRMATION');
  assert.equal((await consumeHostedDocumentReading(f.options, f.deps)).status, 'PENDING_SAVE_CONFIRMATION');
  assert.equal(saves, 1);assert.equal(f.count(), 1);
});

test('cross-source delivery and checkpoint drift fail before model dispatch', async () => {
  const f = fixture();const call = f.deps.callTool;
  f.deps.callTool = async (...args) => { const value=await call(...args); if(args[1].action==='READING_READ')value.sourceBinding.original.parseRunId='other';return value; };
  await assert.rejects(consumeHostedDocumentReading(f.options, f.deps), /READING_DELIVERY_MISMATCH/);
  assert.equal(f.count(), 0);
  f.records.set('model.started', { schemaVersion: 'wiselink.document.reading-checkpoint.v1', identity: { documentVersionId: 'other' }, value: {} });
  await assert.rejects(consumeHostedDocumentReading(f.options, f.deps), /CHECKPOINT_BINDING_MISMATCH/);
});

test('lease loss aborts an in-flight model and forbids SAVE', async () => {
  const f=fixture();const call=f.deps.callTool;let aborted=false;
  f.deps.callTool=async (...args)=>args[1].action==='READING_HEARTBEAT'?{runRef:f.options.runRef,renewed:false}:call(...args);
  f.deps.invokeModel=async (_input,{signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true});});
  const result=await consumeHostedDocumentReading({...f.options,heartbeatIntervalMs:5},f.deps);
  assert.equal(result.status,'PENDING_MODEL_CONFIRMATION');assert.equal(aborted,true);assert.ok(!f.calls.includes('READING_SAVE'));
});

test('ordinary document consumer discovers only admitted reading and does not reparse or retranslate', async () => {
  const { consumeHostedDocument } = await import('../scripts/consume-hosted-work-item.mjs');
  const f = fixture();const call = f.deps.callTool;const outer = [];
  const result = await consumeHostedDocument({ documentVersionId: f.options.documentVersionId, leaseOwner: 'fixture' }, {
    callTool: async (tool, input, hooks) => {
      outer.push([tool,input.action]);
      if (tool === 'document_work') return { documentVersionId: f.options.documentVersionId, nextReadingRunRef: f.options.runRef };
      return call(tool,input,hooks);
    }, readingCheckpoint: f.deps.checkpointFactory, invokeReadingModel: f.deps.invokeModel,
  });
  assert.equal(result.status,'READING_SAVED');assert.equal(f.count(),1);
  assert.deepEqual(outer.filter(x=>x[0]==='document_work'),[['document_work','STATUS']]);
});

test('explicit reading recovery does not discover another activity; ambiguous explicit refs fail before I/O', async () => {
  const { consumeHostedDocument } = await import('../scripts/consume-hosted-work-item.mjs');
  const f = fixture();const options = { documentVersionId: f.options.documentVersionId, readingRunRef: f.options.runRef, leaseOwner:'fixture' };
  const deps = { callTool: f.deps.callTool, readingCheckpoint:f.deps.checkpointFactory, invokeReadingModel:f.deps.invokeModel };
  assert.equal((await consumeHostedDocument(options,deps)).status,'READING_SAVED');
  const before=f.calls.length;
  await assert.rejects(consumeHostedDocument({...options,activityRunRef:'DAR-test'},deps),/RUN_AMBIGUOUS/);
  assert.equal(f.calls.length,before);
});

test('no admitted reading or parse stays idle with no model or checkpoint', async () => {
  const { consumeHostedDocument } = await import('../scripts/consume-hosted-work-item.mjs');
  let calls=0;
  const result=await consumeHostedDocument({documentVersionId:'DV-test'}, {callTool: async (tool,input)=>{
    calls++;assert.equal(tool,'document_work');assert.equal(input.action,'STATUS');
    return {documentVersionId:'DV-test',nextReadingRunRef:null,latestRun:null};
  }});
  assert.equal(result.status,'IDLE');assert.equal(calls,1);
});

test('changed saved content cannot become accepted after restart', async () => {
  const f=fixture();const call=f.deps.callTool;
  f.deps.callTool=async (...args)=>{
    const result=await call(...args);
    if(args[1].action==='READING_SAVE') result.brief={...result.brief,text:'different'};
    return result;
  };
  const result=await consumeHostedDocumentReading(f.options,f.deps);
  assert.equal(result.status,'REQUIRES_ATTENTION');assert.equal(result.errorCode,'READING_SAVE_RECEIPT_MISMATCH');
  await assert.rejects(consumeHostedDocumentReading(f.options,f.deps),/READING_SAVE_RECEIPT_MISMATCH/);
  assert.equal(f.count(),1);assert.equal(f.calls.filter(x=>x==='READING_SAVE').length,1);
});

test('known invalid model result and Host validation error persist actionable codes without retry', async () => {
  for(const phase of ['model','save']) {
    const f=fixture();const call=f.deps.callTool;
    if(phase==='model') f.deps.invokeModel=async()=>({modelVersion:'fixture',proposal:{schemaVersion:'wrong'}});
    else f.deps.callTool=async (...args)=>{
      if(args[1].action==='READING_SAVE')throw Object.assign(new Error('tool failed'),{hostErrorCode:'DOCUMENT_READING_QUOTE_MISMATCH'});
      return call(...args);
    };
    const first=await consumeHostedDocumentReading(f.options,f.deps);
    assert.equal(first.status,'REQUIRES_ATTENTION');
    assert.equal(first.errorCode,phase==='model'?'READING_MODEL_RESULT_INVALID':'DOCUMENT_READING_QUOTE_MISMATCH');
    const again=await consumeHostedDocumentReading(f.options,f.deps);
    assert.equal(again.errorCode,first.errorCode);assert.equal(again.modelInvocations,0);
  }
});

test('CLAIM saved race rereads a concurrently written SAVE checkpoint before accepting content', async () => {
  const f=fixture();await consumeHostedDocumentReading(f.options,f.deps);
  const expected=structuredClone(f.records.get('save.started'));
  f.records.delete('save.started');const call=f.deps.callTool;
  f.deps.callTool=async (...args)=>{
    const result=await call(...args);
    if(args[1].action==='READING_STATUS') return {...result,status:'RUNNING',result:null};
    if(args[1].action==='READING_CLAIM') {
      f.records.set('save.started',expected);
      return {...result,status:'SAVED',result:{...result.result,brief:{...result.result.brief,text:'different'}}};
    }
    return result;
  };
  await assert.rejects(consumeHostedDocumentReading(f.options,f.deps),/READING_SAVE_RECEIPT_MISMATCH/);
  assert.equal(f.count(),1);
});

test('real MCP transport forwards bounded reading signals and rejects unrelated option use', async () => {
  const {callJsonTool}=await import('../scripts/run-hosted-review-turn.mjs');
  const f=fixture();const direct=f.deps.callTool;const signals=[];
  const client={callTool:async ({name,arguments:request},_schema,opts)=>{
    signals.push(opts);
    return {content:[{type:'text',text:JSON.stringify(await direct(name,request))}]};
  }};
  f.deps.callTool=(name,args,opts)=>callJsonTool(client,name,args,opts);
  assert.equal((await consumeHostedDocumentReading(f.options,f.deps)).status,'READING_SAVED');
  assert.ok(signals.some(x=>x?.signal instanceof AbortSignal));
  const options={signal:new AbortController().signal,timeout:60000};
  const v2={callTool:async (_request,received)=>{assert.equal(received,options);return {content:[{type:'text',text:'{}'}]};}};
  await callJsonTool(v2,'document_reading',{action:'READING_STATUS'},options,2);
  await callJsonTool(v2,'document_reading',{action:'READING_RETRACT'},options,2);
  await assert.rejects(callJsonTool(client,'document_reading',{action:'READING_BEGIN'},{signal:new AbortController().signal,timeout:120000}),/REQUEST_OPTIONS_INVALID/);
});

test('received malformed real adapter response stays actionable across restart without another model dispatch', async () => {
  const {invokeHostedDocumentReadingModel}=await import('../scripts/invoke-hosted-document-reading-model.mjs');
  const f=fixture();let requests=0;
  f.deps.invokeModel=(input,hooks)=>invokeHostedDocumentReadingModel(input,{
    gatewayUrl:'https://official.invalid',gatewayToken:'fixture',configuredModelVersion:'fixture',...hooks,
  },{requestGateway:async()=>{requests++;return Response.json({choices:[{message:{tool_calls:[]}}]});}});
  const result=await consumeHostedDocumentReading(f.options,f.deps);
  assert.equal(result.status,'REQUIRES_ATTENTION');assert.equal(result.errorCode,'READING_MODEL_RESULT_INVALID');
  assert.equal((await consumeHostedDocumentReading(f.options,f.deps)).errorCode,result.errorCode);
  assert.equal(requests,1);
});

test('reading response metadata survives model checkpoint and SAVED readback', async () => {
  const f = fixture();
  const modelResponse = { finishReason: 'tool_calls', usage: {
    inputTokens: 310, outputTokens: 120, totalTokens: 430, reasoningTokens: 20,
  } };
  const original = f.deps.invokeModel;
  f.deps.invokeModel = async (...args) => ({ ...await original(...args), modelResponse });
  const first = await consumeHostedDocumentReading(f.options, f.deps);
  assert.equal(first.status, 'READING_SAVED');
  assert.deepEqual(first.modelResponse, modelResponse);
  assert.deepEqual(f.records.get('model.result').value.modelResponse, modelResponse);
  const resumed = await consumeHostedDocumentReading(f.options, f.deps);
  assert.deepEqual(resumed.modelResponse, modelResponse);
  assert.equal(resumed.modelInvocations, 0);
  assert.equal(f.count(), 1);
});

test('old model checkpoint remains readable with explicitly unknown response metadata', async () => {
  const f = fixture();
  await consumeHostedDocumentReading(f.options, f.deps);
  assert.equal('modelResponse' in f.records.get('model.result').value, false);
  const resumed = await consumeHostedDocumentReading(f.options, f.deps);
  assert.deepEqual(resumed.modelResponse, { finishReason: null, usage: {
    inputTokens: null, outputTokens: null, totalTokens: null, reasoningTokens: null,
  } });
  assert.equal(f.count(), 1);
});

test('old failure checkpoint remains readable without changing its retry decision', async () => {
  const f = fixture();
  f.deps.invokeModel = async () => ({ modelVersion: 'fixture', proposal: { schemaVersion: 'wrong' } });
  const first = await consumeHostedDocumentReading(f.options, f.deps);
  assert.equal(first.status, 'REQUIRES_ATTENTION');
  const legacy = f.records.get('failure');
  delete legacy.value.modelResponse;
  f.records.set('failure', legacy);
  const resumed = await consumeHostedDocumentReading(f.options, f.deps);
  assert.equal(resumed.errorCode, 'READING_MODEL_RESULT_INVALID');
  assert.deepEqual(resumed.modelResponse, { finishReason: null, usage: {
    inputTokens: null, outputTokens: null, totalTokens: null, reasoningTokens: null,
  } });
  assert.equal(resumed.modelInvocations, 0);
});

test('length-finished tool call persists usage and never attempts SAVE or a second model', async () => {
  const { READING_PROPOSAL_FUNCTION_NAME } = await import('../scripts/invoke-hosted-document-reading-model.mjs');
  const f = fixture(); let requests = 0;
  const candidate = { schemaVersion: 'wiselink.document.reading.v1', headline: '来源条件',
    brief: { text: '尚未确认。', quotes: [{ anchorId: 'a1' }] },
    explanation: [{ text: '尚未确认。', quotes: [{ anchorId: 'a1' }] }],
    criticalConditions: [], limitations: [] };
  f.deps.invokeModel = (input, hooks) => invokeHostedDocumentReadingModel(input, {
    gatewayUrl: 'https://official.invalid', gatewayToken: 'fixture', configuredModelVersion: 'fixture', ...hooks,
  }, { requestGateway: async () => {
    requests++;
    return Response.json({ choices: [{ finish_reason: 'length', message: { role: 'assistant', tool_calls: [{
      type: 'function', function: { name: READING_PROPOSAL_FUNCTION_NAME, arguments: JSON.stringify(candidate) },
    }] } }], usage: { prompt_tokens: 300, completion_tokens: 16000,
      completion_tokens_details: { reasoning_tokens: 4000 } } });
  } });
  const first = await consumeHostedDocumentReading(f.options, f.deps);
  assert.equal(first.status, 'REQUIRES_ATTENTION');
  assert.equal(first.errorCode, 'READING_MODEL_RESULT_TRUNCATED');
  assert.deepEqual(first.modelResponse, { finishReason: 'length', usage: {
    inputTokens: 300, outputTokens: 16000, totalTokens: null, reasoningTokens: 4000,
  } });
  assert.equal(f.records.has('model.result'), false);
  assert.equal(f.calls.includes('READING_SAVE'), false);
  const resumed = await consumeHostedDocumentReading(f.options, f.deps);
  assert.deepEqual(resumed.modelResponse, first.modelResponse);
  assert.equal(requests, 1);
});

test('pre-dispatch invalid source anchors are a durable explicit failure, not a pending model', async () => {
  for (const kind of ['duplicate', 'empty']) {
    const f = fixture(); const call = f.deps.callTool;
    let dispatched = 0;
    f.deps.callTool = async (tool, request) => {
      const result = await call(tool, request);
      if (request.action === 'READING_READ') {
        if (kind === 'duplicate') {
          result.anchors.push(structuredClone(result.anchors[0]));
          result.range.anchorIds.push(result.anchors[0].anchorId);
        } else result.anchors[0].sourceText = '';
      }
      return result;
    };
    f.deps.invokeModel = input => invokeHostedDocumentReadingModel(input, {}, {
      requestGateway: async () => { dispatched++; throw new Error('must not dispatch'); },
    });
    const result = await consumeHostedDocumentReading(f.options, f.deps);
    assert.equal(result.status, 'REQUIRES_ATTENTION');
    assert.equal(result.errorCode, 'READING_MODEL_INPUT_INVALID');
    assert.equal(f.records.get('failure').value.errorCode, 'READING_MODEL_INPUT_INVALID');
    assert.equal((await consumeHostedDocumentReading(f.options, f.deps)).status, 'REQUIRES_ATTENTION');
    assert.equal(dispatched, 0);
    assert.equal(f.calls.includes('READING_SAVE'), false);
  }
});
