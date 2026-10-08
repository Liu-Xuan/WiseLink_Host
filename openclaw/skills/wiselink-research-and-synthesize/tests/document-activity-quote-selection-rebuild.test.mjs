import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import {DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA as Q,validateActivityQuoteSelection,consumeHostedDocumentActivity,buildActivityRequest} from '../scripts/consume-hosted-document-activity.mjs';
import {activityModelMessages,activityProposalFunctionTool,activityQuoteSelectionFunctionTool} from '../scripts/invoke-hosted-document-activity-model.mjs';
import {callJsonTool} from '../scripts/run-hosted-review-turn.mjs';
const B={original:{documentVersionId:'DV-rebuild',parseRunId:'PR-rebuild',parseRevision:1,sourceArtifactId:'A-rebuild',sourceSha256:'a'.repeat(64),sourceByteLength:10},semanticRevision:1};
const A=[{anchorId:'a',sourceText:'前😀\r\nTarget café e\u0301; tail'}];
const C=()=>({sourceBinding:structuredClone(B),expectedSourceBinding:structuredClone(B),deliveredRanges:[{anchorIds:['a']}]});
const P=()=>({schemaVersion:'wiselink.document.activity-candidate.v1',quoteSelectionSchemaVersion:Q,statements:[{statementKey:'constructed',label:'Source cue',quotes:[{anchorId:'a',text:'Target café e\u0301'}],time:null,statusRaw:null,limitations:[]}]});
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
test('new selection producer omits numeric offsets; recovered numeric producer bytes stay unchanged',()=>{
 const quote=activityQuoteSelectionFunctionTool().function.parameters.properties.statements.items.properties.quotes.items;
 assert.deepEqual(quote.required,['anchorId','text']);assert.deepEqual(Object.keys(quote.properties).sort(),['anchorId','text']);assert.equal(quote.additionalProperties,false);
 assert.equal(hash(activityProposalFunctionTool()),'0bd85a63aa95f96154a3964d9a91785532b00ce7a533c626b84922c2536a9d78');
 assert.equal(hash(activityModelMessages({anchors:[{anchorId:'constructed',sourceText:A[0].sourceText}]})),'240c754ecdb6c07f14585769c66a4ce034d0c6b902c779ba7769785754f8fb83');
 assert.match(activityModelMessages({quoteSelectionSchemaVersion:Q,anchors:A})[0].content,/Never generate start\/end offsets/);
 assert.throws(()=>activityModelMessages({quoteSelectionSchemaVersion:Q,candidateSchemaVersion:'wiselink.document.activity-candidate.v2'}),/ACTIVITY_MODEL_SCHEMA_INVALID/);
});
test('runtime selection validation keeps original semantics/object and rejects marker, range and scope inventions',()=>{
 const p=P(),bytes=JSON.stringify(p);assert.equal(validateActivityQuoteSelection(p,A,C()),p);assert.equal(JSON.stringify(p),bytes);
 const bad=P();bad.statements[0].quotes[0].start=5;assert.throws(()=>validateActivityQuoteSelection(bad,A,C()),/SELECTION_INVALID/);
 assert.throws(()=>validateActivityQuoteSelection({...P(),quoteSelectionSchemaVersion:'other'},A,C()),/SHAPE_INVALID/);
 assert.throws(()=>validateActivityQuoteSelection(P(),A,{...C(),deliveredRanges:[]}),/ANCHOR_NOT_ALLOWED/);
 const stale=C();stale.expectedSourceBinding.original.documentVersionId='other';assert.throws(()=>validateActivityQuoteSelection(P(),A,stale),/SOURCE_BINDING_MISMATCH/);
 assert.throws(()=>validateActivityQuoteSelection(P(),[{...A[0],sourceText:`${A[0].sourceText} ${A[0].sourceText}`}],C()),/TEXT_AMBIGUOUS:STATEMENT_0:QUOTE_0/);
});
test('actual cancellation adapter recognizes only the bounded new action options',async()=>{
 const request=buildActivityRequest('ACTIVITY_SAVE_SELECTION',{documentVersionId:'DV-rebuild',runRef:'DAR-rebuild',leaseOwner:'rebuild:producer',leaseToken:'0f23e82b-2b1e-46ba-b62b-9e9a2ec62ca0',leaseGeneration:1,candidate:P(),producer:{skillVersion:'rebuild',modelVersion:'not-called'}});
 let seen;const client={callTool:async(...args)=>{seen=args;return{content:[{type:'text',text:'{"synthetic":true}'}]};}};
 const options={signal:new AbortController().signal,timeout:120000};assert.deepEqual(await callJsonTool(client,'document_work',request,options),{synthetic:true});assert.equal(seen[2],options);
 await assert.rejects(callJsonTool(client,'document_work',request,{...options,timeout:120001}),/REQUEST_OPTIONS_INVALID/);
});
test('new mode cannot recover an old numeric checkpoint by silently reinterpreting it',async()=>{
 const summary={documentVersionId:'DV-rebuild',runRef:'DAR-rebuild',parseRunId:'PR-rebuild',semanticRevision:1,selection:{sectionIds:['s']},expectedRevision:0,deadline:new Date(Date.now()+60000).toISOString(),result:null};
 const fence={leaseOwner:'rebuild:producer',leaseToken:'0f23e82b-2b1e-46ba-b62b-9e9a2ec62ca0',leaseGeneration:1};let calls=[];
 const deps={callTool:async(_name,request)=>{calls.push(request.action);if(request.action==='STATUS')return{nextActivityRunRef:summary.runRef};if(request.action==='ACTIVITY_STATUS')return summary;if(request.action==='ACTIVITY_CLAIM')return{...summary,fence};if(request.action==='ACTIVITY_FAIL')return{};throw new Error('unexpected dispatch');},
 checkpointFactory:async()=>({readOptional:async name=>name==='source.result'?{schemaVersion:'wiselink.document.activity-checkpoint.v1',documentVersionId:summary.documentVersionId,runRef:summary.runRef}:null,write:async()=>{throw new Error('unexpected write');}}),invokeModel:async()=>{throw new Error('unexpected model');}};
 await assert.rejects(consumeHostedDocumentActivity({documentVersionId:summary.documentVersionId,runRef:summary.runRef,leaseOwner:fence.leaseOwner,quoteSelectionSchemaVersion:Q},deps),/CHECKPOINT_BINDING_MISMATCH/);
 assert.ok(!calls.includes('ACTIVITY_READ'));assert.ok(!calls.includes('ACTIVITY_SAVE_SELECTION'));
});
test('generated rebuild resolver remains byte-for-byte synchronized with its shared TypeScript',()=>{
 const require=createRequire(import.meta.url),ts=require('typescript');
 const source=readFileSync(new URL('../../../../shared/document-activity-quote-selection.ts',import.meta.url),'utf8');
 const expected='// Rebuild implementation generated from shared/document-activity-quote-selection.ts.\n'+ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022},fileName:'document-activity-quote-selection.ts'}).outputText;
 assert.equal(readFileSync(new URL('../scripts/resolve-document-activity-quote-selection.mjs',import.meta.url),'utf8'),expected);
});
