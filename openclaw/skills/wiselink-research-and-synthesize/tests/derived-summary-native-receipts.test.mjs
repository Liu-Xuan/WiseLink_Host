import assert from 'node:assert/strict';
import test from 'node:test';
import { derivedSummaryModelView } from '../scripts/invoke-hosted-derived-summary-model.mjs';
import { derivedSummaryRegistry } from '../scripts/derived-summary-shape.mjs';
import { createDerivedSummaryDeliveredView, projectDerivedSummaryReadReceipt,
} from '../scripts/derived-summary-read-projection.mjs';
import { canonicalJson } from '../scripts/validate-payload.mjs';

/** Transport-only constructed evidence; no production authority or real READ. */
function native(receiptRef = 'receipt-1', task = 'task-1') {
  const sourceVersion = { rawRevision: 'R00', rawIteration: '2', confirmation: 'SOURCE_DECLARED' };
  const state = {rawName: 'Estimated', rawCode: 'Estimated'};
  const observation = {sourceRecordId: 'assessment-1', sourceVersion, state, recordKind: 'ENGINEER_ASSESSMENT',
    objectBinding: 'EXACT_CURRENT_DETAIL', sourceModifiedAt: null, observedAt: '2026-10-01T10:00:00Z',
    identitySelector: '#infoPageIdentityObjectIdentifier', stateSelector: '.attributePanel[oid] .attributePanel-label[State] => .attributePanel-value',
    versionSelector: '.attributePanel[oid] .attributePanel-label[Version] => .attributePanel-value'};
  return {kind: 'TDMS_NATIVE_RECORD', evidenceRef: 'native-exact', title: 'Native exact opinion', versionLabel: 'R00',
    excerpt: 'UNIQUE_NATIVE_BODY: conditional professional judgment, execution remains unknown',
    nativeSource: {recordRef: 'record-1', sourceRevisionRef: 'observation-1', recordKind: 'ENGINEER_ASSESSMENT', sourceRecordId: 'assessment-1',
      sourceKey: 'TDMS', sourceInstanceId: 'fixture-instance', title: 'Native exact opinion', fileType: null, sourceVersion, state, authors: [],
      observedAt: observation.observedAt, capturedAt: '2026-10-02T10:00:00Z', coverage: {status: 'PARTIAL', gaps: ['Currentness not connected'], readback: 'CONSISTENT'},
      relatedDocumentVersionIds: [], fieldSelectors: [{fieldPath: 'content.opinions[0]', selector: 'selector-1'}],
      sourceVerification: 'DECLARED_ONLY', currentness: 'SELECTED_HOST_OBSERVATION'},
    nativeScope: {sourceRevisionRef: 'observation-1', fieldSelectors: [{fieldPath: 'content.opinions[0]', selector: 'selector-1'}],
      grouping: 'TRANSPARENT_FIELDS', limitations: [], processingSetBinding: {scope: {tenantId: 'fixture', sourceKey: 'TDMS', sourceInstanceId: 'fixture-instance', scopeId: 'scope-1'},
        setRevisionRef: 'set-1', generation: 2, processingFamilyRef: 'family-1', cohortRef: 'cohort-1', processingObservationRef: 'processing-1', memberRef: 'member-1', assessmentObservationRef: 'observation-1'},
      approval: {captureRef: 'capture-1', mode: 'EXACT_VERSION', evidencePath: 'rawFields.opinionCollection',
        approvalSubject: {sourceRecordId: 'assessment-1', sourceVersion}, before: observation, after: observation}},
    nativeReadReceipt: {receiptRef, sourceRevisionRef: 'observation-1', readAt: '2026-10-03T10:00:00Z', purpose: 'JOB_AID_NATIVE_RECORD',
      fieldPaths: ['content.opinions[0]'], taskContextRef: task, readPerformed: true, permissionRevision: 'fixture-permission', engineeringAdoption: 'NOT_CREATED', executionVerified: false}};
}
function input() {
  const first = native(), second = native('receipt-2', 'task-2');
  const members = [first,second].map((evidence,index) => {
    const member = {kind: 'WORK_ITEM_WORK', workItemId: `work-${index}`, documentVersionId: `document-${index}`, workRef: `saved-${index}`, workRevision: 1, issueKeys: []};
    return {member, evidenceRef: `member-${index}`, headline: 'Saved candidate work', understanding: 'Complete saved understanding',
      body: 'Complete saved understanding\n\n', issues: [], evidence: [evidence], rootRefs: [evidence.evidenceRef], limitations: ['Not adoption'], current: true, overviewStatus: 'CURRENT', leaves: [member]};
  });
  return {scope: {kind: 'ATA4', title: 'Explicit fixture scope', fleetFamilyId: 'F', fleetModelIds: ['MODEL'], ata2: '46', ata4: '46-00', selectionReason: 'Fixture'},
    classificationStatus: 'CANDIDATE', instruction: 'Retain source limitations', members, evidence: [first], limitations: ['Native currentness unconnected']};
}
const step = (action,refs) => ({action,evidenceRefs:refs,purpose:'Read exact registered source'});
const project = (projector,receipt,intent,registry,delivered,round=0) => projector(receipt,intent,registry,delivered,{round,messageIndex:3+round*2});

test('model evidence appears once while distinct immutable member receipts remain separately reconstructable', () => {
  const value=input(), saved=canonicalJson(value), view=derivedSummaryModelView(value);
  assert.equal(view.evidence.length,1); assert.equal(canonicalJson(view).split('UNIQUE_NATIVE_BODY').length-1,1);
  assert.deepEqual(view.members.map(member=>member.nativeReadReceipts[0].receipt.receiptRef),['receipt-1','receipt-2']);
  const delivered=createDerivedSummaryDeliveredView(view);
  assert.deepEqual([...delivered.members.values()].map(item=>item.value.evidence[0].nativeReadReceipt.receiptRef),['receipt-1','receipt-2']);
  assert.equal(delivered.nativeReadReceipts.size,2);
  const result=project(projectDerivedSummaryReadReceipt,{members:value.members},step('READ_MEMBER_WORK',['member-0','member-1']),derivedSummaryRegistry(value),delivered);
  assert.deepEqual(result.items.map(item=>item.status),['CONFIRMED_SAME_CONTENT','CONFIRMED_SAME_CONTENT']);
  assert.equal(result.items[1].nativeReadReceipts[0].receipt.receiptRef,'receipt-2');
  assert.equal(result.items[1].contentLocation.nativeReadReceiptLocations[0].inputPointer,'/members/1/nativeReadReceipts/0/receipt');
  assert.equal(canonicalJson(value),saved);
});

for (const [label,create,projector] of [['full',createDerivedSummaryDeliveredView,projectDerivedSummaryReadReceipt]]) {
  test(`${label} repeated exact body retains newly returned receipt separately, never re-delivers body`,()=>{
    const value=input(), registry=derivedSummaryRegistry(value), delivered=create({members:[],evidence:[native()]});
    const fresh=native('receipt-3','task-3'); fresh.nativeReadReceipt.readAt='2026-10-07T08:30:00Z';
    const result=project(projector,{evidence:[fresh]},step('READ_SOURCES',['native-exact']),registry,delivered);
    assert.equal(result.items[0].status,'CONFIRMED_SAME_CONTENT'); assert.equal(Object.hasOwn(result.items[0],'content'),false);
    assert.deepEqual(result.items[0].nativeReadReceipts,[{evidenceRef:fresh.evidenceRef,receipt:fresh.nativeReadReceipt}]);
    assert.equal(delivered.nativeReadReceipts.size,2); assert.equal(delivered.evidence.get('native-exact').value.nativeReadReceipt.receiptRef,'receipt-1');
    assert.equal(result.items[0].notices.inheritedSourceReadIsNotFreshVerification,true);
  });
  for (const mutation of ['body','cohort','approval','receipt-reuse','wiki','foreign-source']) test(`${label} refuses ${mutation} before receipt/delivery state changes`,()=>{
    const value=input(), delivered=create({members:[],evidence:[native()]}), registry=derivedSummaryRegistry(value), changed=native('receipt-3','task-3');
    if(mutation==='body') changed.excerpt+=' changed';
    if(mutation==='cohort') changed.nativeScope.processingSetBinding.cohortRef='foreign';
    if(mutation==='approval') changed.nativeScope.approval.captureRef='foreign';
    if(mutation==='receipt-reuse') changed.nativeReadReceipt.receiptRef='receipt-1';
    if(mutation==='wiki') changed.nativeReadReceipt.purpose='WIKI_NATIVE_RECORD';
    if(mutation==='foreign-source') changed.nativeReadReceipt.sourceRevisionRef='foreign';
    const before=canonicalJson([...delivered.nativeReadReceipts]);
    assert.throws(()=>project(projector,{evidence:[changed]},step('READ_SOURCES',['native-exact']),registry,delivered));
    assert.equal(canonicalJson([...delivered.nativeReadReceipts]),before);
  });
}
test('registry never coalesces same receiptRef with altered task provenance',()=>{
  const value=input(); value.members[1].evidence[0].nativeReadReceipt.receiptRef='receipt-1';
  assert.throws(()=>derivedSummaryRegistry(value),/NATIVE_RECEIPT_INVALID/);
});

test('native member receipt metadata cannot be omitted and replaced by another member receipt',()=>{
  const view=derivedSummaryModelView(input()); delete view.members[1].nativeReadReceipts;
  assert.throws(()=>createDerivedSummaryDeliveredView(view),/NATIVE_RECEIPT_INVALID/);
});

import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCheckpointStore} from '../scripts/run-hosted-review-turn.mjs';
import {invokeHostedDerivedSummaryModel,derivedSummaryModelMessages,derivedSummaryCachePrefixModelMessages,
  DERIVED_SUMMARY_PROMPT_VERSION,DERIVED_SUMMARY_CACHE_PREFIX_PROMPT_VERSION} from '../scripts/invoke-hosted-derived-summary-model.mjs';

function nestedInput() {
  const value=input(); const original=value.members;
  value.members=[{member:{kind:'DERIVED_SUMMARY',summaryId:'nested-depth-two',summaryRef:'nested-depth-two-revision',summaryRevision:1},
    evidenceRef:'member-0',headline:'Depth-two saved summary',body:'Exact nested saved body',issues:[],evidence:original.flatMap(member=>member.evidence),
    rootRefs:['native-exact'],limitations:['Nested source declarations'],current:true,overviewStatus:'CURRENT',leaves:original.flatMap(member=>member.leaves)}];
  return value;
}
for(const variant of ['siblings','nested','single-leaf'])for(const mode of ['fresh','fresh-read','fresh-source','regular','cache','receipt-only','receipt-only-cache']) test(`actual native driver ${mode} ${variant} first invocation and exact checkpoint resume retain both receipts`,async()=>{
  const root=await mkdtemp(join(tmpdir(),'native-summary-driver-'));
  try {
    const value=variant==='nested'?nestedInput():input(), checkpoint=await createCheckpointStore(root);
    if(variant==='single-leaf')value.members=[{...value.members[0],evidence:value.members.flatMap(member=>member.evidence)}];
    if(!['fresh','fresh-read','fresh-source'].includes(mode)) {
      const cache=mode.endsWith('cache');
      await checkpoint.write('summary-model-state',{round:0,promptVersion:cache?DERIVED_SUMMARY_CACHE_PREFIX_PROMPT_VERSION:DERIVED_SUMMARY_PROMPT_VERSION,
        messages:cache?derivedSummaryCachePrefixModelMessages(value):derivedSummaryModelMessages(value)});
    }
    let calls=0,reads=0,binding,receipt;
    const receiptOnlyMode=mode.startsWith('receipt-only');
    const needsRead=['fresh-read','fresh-source'].includes(mode)||receiptOnlyMode;
    const content={headline:'Candidate',listBrief:'Limited source coverage',body:'Saved candidate [[member-0]]',limitations:[]};
    const options={gatewayChatCompletionsEnabled:true,gatewayUrl:'http://127.0.0.1:1',gatewayToken:'fixture-only',configuredModelVersion:'fixture-configured',registeredModelRefs:['miaoda/glm-5.3'],
      summaryId:'summary-1',attemptRef:'attempt-1',deadlineAt:'2099-01-01T00:00:00Z',sessionDiscriminator:'attempt-1:1',checkpoint,
      executionModel:{modelRef:'miaoda/glm-5.3',displayName:'Fixture',providerKind:'BUILT_IN',settingsRevision:1,selectedAt:'2026-10-07T00:00:00Z'},
      runBudget:{timeoutMs:600000,maxCompletionTokens:1000,maxModelRequests:2,reasoningEffort:'low'},heartbeat:async()=>{},
      readMembers:async()=>{reads++;return {members:value.members};},readSources:async()=>{reads++;return {evidence:[native('receipt-source-new','task-source-new')]};},
      prepareGateway:async actual=>{binding=actual;receipt={attemptRef:actual.attemptRef,modelId:'glm-5.3',maxCompletionTokens:actual.maxCompletionTokens,maxModelRequests:actual.maxModelRequests,
        absoluteDeadline:actual.deadlineAt,dispatches:[],activeOrdinal:null,unknownTerminal:false,upstreamDispatchCount:0,upstreamHttpStatus:null,transportCompleted:false,providerStopConfirmed:false,
        outcome:'CREATED',finishedAt:null,expectedReasoningEffort:'low',observedReasoningEffort:null,observedThinkingMode:null,tempSecretScan:null};
        return {gatewayUrl:'http://127.0.0.1:1',gatewayToken:'fixture-only',getSanitizedReceipt:()=>structuredClone(receipt),close:async()=>{receipt.tempSecretScan={complete:true,found:false};}};}};
    const dependencies={requestGateway:async()=>{calls++;const ordinal=receipt.dispatches.length+1;Object.assign(receipt,{upstreamDispatchCount:ordinal,upstreamHttpStatus:200,transportCompleted:true,providerStopConfirmed:true,outcome:'COMPLETE',observedReasoningEffort:'LOW',observedThinkingMode:'ABSENT',
      dispatches:[...receipt.dispatches,{ordinal,upstreamHttpStatus:200,actualCompletionTokens:binding.maxCompletionTokens,transportCompleted:true,providerKnownTerminal:true,finishReason:'tool_calls',outcome:'COMPLETE'}]});
      return new Response(JSON.stringify({model:'fixture/actual-model',choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'fixture-call',type:'function',function:{name:'return_wiselink_summary_step',arguments:JSON.stringify({step:needsRead&&calls===1?{action:mode==='fresh-source'||receiptOnlyMode?'READ_SOURCES':'READ_MEMBER_WORK',evidenceRefs:mode==='fresh-source'||receiptOnlyMode?['native-exact']:value.members.map(member=>member.evidenceRef),purpose:'Recheck exact selected native carrier'}:{action:'SAVE_SUMMARY',content}})}}]}}]}));}};
    const first=await invokeHostedDerivedSummaryModel(value,options,dependencies);assert.deepEqual(first.content,content);assert.equal(calls,needsRead?2:1);assert.equal(reads,needsRead?1:0);
    const initial=await checkpoint.readOptional('summary-model-state'),before=canonicalJson(initial);
    const view=JSON.parse(initial.messages[1].content.split('INPUT:\n')[1]);
    const projectedMembers=view.members;
    assert.deepEqual(projectedMembers.flatMap(member=>member.nativeReadReceipts.map(value=>value.receipt.receiptRef)),['receipt-1','receipt-2']);
    if(mode==='fresh-source'||receiptOnlyMode) {
      const packet=JSON.parse(initial.messages[3].content);
      assert.equal(packet.items[0].status,'CONFIRMED_SAME_CONTENT');
      assert.equal(Object.hasOwn(packet.items[0],'content'),false);
      assert.equal(packet.items[0].nativeReadReceipts[0].receipt.receiptRef,'receipt-source-new');
      const raw=await checkpoint.readOptional('summary-round-0-read');
      assert.equal(raw.evidence[0].nativeReadReceipt.receiptRef,'receipt-source-new');
    }
    if(receiptOnlyMode) {
      // Seed the same completed round/immutable read receipts as the accepted
      // S2 receipt-only recovery fixture, with the durable transcript at round 0.
      // Never remove the native gateway marker or try to rearm this request.
      await checkpoint.write('summary-model-state',{round:0,promptVersion:initial.promptVersion,messages:initial.messages.slice(0,2)});
    }
    const frozenReceipts=canonicalJson(await Promise.all(['summary-round-0.result','summary-round-0-read','summary-round-1.result'].map(key=>checkpoint.readOptional(key))));
    const again=await invokeHostedDerivedSummaryModel(value,options,dependencies);assert.deepEqual(again.content,content);assert.equal(calls,needsRead?2:1);assert.equal(reads,needsRead?1:0);
    assert.equal(canonicalJson(await checkpoint.readOptional('summary-model-state')),before);
    assert.equal(canonicalJson(await Promise.all(['summary-round-0.result','summary-round-0-read','summary-round-1.result'].map(key=>checkpoint.readOptional(key)))),frozenReceipts);
  } finally {await rm(root,{recursive:true,force:true});}
});


test('nested receipt-bearing carriers deliver one native body and reconstruct every original carrier',()=>{
  const value=nestedInput(),view=derivedSummaryModelView(value);
  assert.deepEqual(view.members[0].evidenceRefs,['native-exact']);assert.equal(view.members[0].nativeReadReceipts.length,2);
  assert.equal(canonicalJson(view).split('UNIQUE_NATIVE_BODY').length-1,1);
  const restored=createDerivedSummaryDeliveredView(view);
  assert.deepEqual(restored.members.get('member-0').value.evidence,value.members[0].evidence);
  const empty=createDerivedSummaryDeliveredView({members:[],evidence:[]});
  const read=project(projectDerivedSummaryReadReceipt,{members:value.members},step('READ_MEMBER_WORK',['member-0']),derivedSummaryRegistry(value),empty);
  assert.equal(read.items[0].content.evidence.length,1);assert.equal(read.items[0].content.nativeReadReceipts.length,2);
  assert.equal(canonicalJson(read).split('UNIQUE_NATIVE_BODY').length-1,1);
});

const ordinarySource = {kind:'DOCUMENT_PASSAGE',evidenceRef:'ordinary-after-native',excerpt:'Complete ordinary body after duplicate native carriers',versionLabel:'R1',locator:'p4'};
function atPointer(value,pointer) {
  assert.ok(pointer.startsWith('/'));
  return pointer.slice(1).split('/').reduce((current,key)=>current?.[key.replaceAll('~1','/').replaceAll('~0','~')],value);
}
test('P2 native mixed body dedup locations resolve the actual ordinary full body',()=>{
  const value=nestedInput();value.members[0].evidence.push(structuredClone(ordinarySource));value.members[0].rootRefs.push(ordinarySource.evidenceRef);value.evidence.push(structuredClone(ordinarySource));
  const delivered=createDerivedSummaryDeliveredView({members:[],evidence:[]});
  const packet=project(projectDerivedSummaryReadReceipt,{members:value.members},step('READ_MEMBER_WORK',['member-0']),derivedSummaryRegistry(value),delivered);
  assert.equal(packet.items[0].content.evidence.length,2);
  const location=delivered.evidence.get(ordinarySource.evidenceRef).location;
  assert.deepEqual(atPointer(packet,location.toolPointer),ordinarySource);
  assert.equal(location.toolPointer,'/items/0/content/evidence/1');
});
test('P2 native distinct member receipts point at their own actual bytes after body dedup',()=>{
  const value=nestedInput(),delivered=createDerivedSummaryDeliveredView({members:[],evidence:[]});
  const packet=project(projectDerivedSummaryReadReceipt,{members:value.members},step('READ_MEMBER_WORK',['member-0']),derivedSummaryRegistry(value),delivered);
  const locations=packet.items[0].nativeReadReceiptLocations;
  assert.deepEqual(locations.map(location=>atPointer(packet,location.toolPointer).receiptRef),['receipt-1','receipt-2']);
  assert.notEqual(locations[0].toolPointer,locations[1].toolPointer);
  for(const [index,location] of locations.entries())assert.deepEqual(atPointer(packet,location.toolPointer),value.members[0].evidence[index].nativeReadReceipt);
  const contentLocations=packet.items[0].contentLocation.nativeReadReceiptLocations;
  assert.deepEqual(contentLocations.map(location=>atPointer(packet,location.toolPointer)),value.members[0].evidence.map(item=>item.nativeReadReceipt));
  const confirmed=project(projectDerivedSummaryReadReceipt,{members:value.members},step('READ_MEMBER_WORK',['member-0']),derivedSummaryRegistry(value),delivered,1);
  assert.equal(confirmed.items[0].contentLocation.messageIndex,3);
  assert.equal(confirmed.items[0].nativeReadReceiptLocations[1].messageIndex,5);
  assert.deepEqual(confirmed.items[0].nativeReadReceiptLocations.map(location=>atPointer(confirmed,location.toolPointer).receiptRef),['receipt-1','receipt-2']);
});
test('P2 native fresh READ receipt points at this tool message while body points at original input',()=>{
  const value=input(),delivered=createDerivedSummaryDeliveredView(derivedSummaryModelView(value)),fresh=native('receipt-new-pointer','task-new-pointer');
  const packet=project(projectDerivedSummaryReadReceipt,{evidence:[fresh]},step('READ_SOURCES',['native-exact']),derivedSummaryRegistry(value),delivered,1);
  const item=packet.items[0];assert.equal(item.status,'CONFIRMED_SAME_CONTENT');assert.equal(item.contentLocation.messageIndex,1);
  assert.deepEqual(item.nativeReadReceiptLocations,[{evidenceRef:'native-exact',messageIndex:5,toolPointer:'/items/0/nativeReadReceipts/0/receipt'}]);
  assert.deepEqual(atPointer(packet,item.nativeReadReceiptLocations[0].toolPointer),fresh.nativeReadReceipt);
  assert.equal(atPointer(derivedSummaryModelView(value),item.contentLocation.inputPointer).nativeReadReceipt.receiptRef,'receipt-1');
  assert.notEqual(fresh.nativeReadReceipt.receiptRef,delivered.evidence.get('native-exact').value.nativeReadReceipt.receiptRef);
});
test('P2 native absence keeps ordinary full and confirmed packet bytes unchanged',()=>{
  const value=input();value.members=[];value.evidence=[structuredClone(ordinarySource)];
  const delivered=createDerivedSummaryDeliveredView({members:[],evidence:[]}),registry=derivedSummaryRegistry(value),intent=step('READ_SOURCES',[ordinarySource.evidenceRef]);
  const first=project(projectDerivedSummaryReadReceipt,{evidence:[ordinarySource]},intent,registry,delivered);
  const expected={operation:'READ_SOURCES',requestedEvidenceRefs:[ordinarySource.evidenceRef],receiptCheckpointKey:'summary-round-0-read',status:'READ_COMPLETE',
    notice:'Host authorized this exact read and checked the bound versions. Same-content confirmations refer to full content already in these messages. This does not establish approval, applicability, or fresh verification of inherited sources.',
    items:[{evidenceRef:ordinarySource.evidenceRef,status:'DELIVERED_FULL_CONTENT',contentLocation:{messageIndex:3,toolPointer:'/items/0/content'},content:ordinarySource,notices:{inheritedSourceReadIsNotFreshVerification:true}}]};
  assert.equal(canonicalJson(first),canonicalJson(expected));
  const confirmed=project(projectDerivedSummaryReadReceipt,{evidence:[ordinarySource]},intent,registry,delivered,1);
  const confirmedExpected={...expected,receiptCheckpointKey:'summary-round-1-read',items:[{evidenceRef:ordinarySource.evidenceRef,status:'CONFIRMED_SAME_CONTENT',contentLocation:expected.items[0].contentLocation,notices:expected.items[0].notices}]};
  assert.equal(canonicalJson(confirmed),canonicalJson(confirmedExpected));
});
