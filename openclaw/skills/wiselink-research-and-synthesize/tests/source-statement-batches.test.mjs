import assert from 'node:assert/strict';
import test from 'node:test';
import { readJobAidSourceBatches } from '../scripts/run-jobaid-problem-assessment.mjs';
const roots=['DOCUMENT_ORIGINAL:DV:PR:parent-condition','DOCUMENT_ORIGINAL:DV:PR:table'];
const binding={original:{documentVersionId:'DV',parseRunId:'PR',parseRevision:1,sourceArtifactId:'ART',sourceSha256:'a'.repeat(64),sourceByteLength:100},semanticRevision:3};
const refs=Array.from({length:97},(_,i)=>`DOCUMENT_ACTIVITY:DAR:7:DAS-${i}`);
function packet(requested){
 const records=requested.map(ref=>({ref,reference:{runRef:'DAR',candidateRevision:7,statementId:ref.split(':')[3]},sourceBinding:binding,candidateOnly:true,sourceSchemaVersion:'wiselink.document.activity-candidate.v1',semanticFieldsAvailability:'LEGACY_PARTIAL',scopeBasis:'LEGACY_RUN_SCOPE',rootRefs:[roots[1]],requiredContextRootRefs:roots,quoteLocators:[{quoteIndex:0,anchorId:'anchor',sourceUnitId:'unit',payloadPath:'/payload/text',sourceRefIds:['table'],rootRefs:[roots[1]]}],statement:{statementId:ref.split(':')[3],statementKey:ref.split(':')[3],label:'Planned condition-preserving action',quotes:[{anchorId:'anchor',start:0,end:18,text:'Planned action TBD'}],time:null,statusRaw:'TBD',limitations:['Only if X']}}));
 return {schemaVersion:'wiselink.jobaid-source-read.v3',status:'AVAILABLE',scope:'EXACT',completeRequestedScope:true,sourceRefs:[...requested,...roots],evidence:[...records.map(r=>({evidenceRef:r.ref,kind:'PRIOR_RESULT',title:'Saved source candidate',versionLabel:binding.original.parseRunId,excerpt:r.statement.label,locator:null,sourceContext:{resultRef:r.reference.runRef,resultRevision:r.reference.candidateRevision},originalEvidenceRefs:[...new Set([...r.rootRefs,...r.requiredContextRootRefs])],sourceStatement:{reference:r.reference,sourceBinding:r.sourceBinding}})),...roots.map(evidenceRef=>({evidenceRef,kind:'DOCUMENT_PASSAGE',excerpt:'Keep all parent conditions and table scope',locator:'page:0'}))],sourceStatements:records,activityContexts:[{runRef:'DAR',candidateRevision:7,readCoverage:{status:'DELIVERED_RANGES_ONLY',selection:{sectionIds:['section']},deliveredRanges:[{sectionId:'section',offset:0,unitIds:['unit'],anchorIds:['anchor'],nextOffset:null}],sourceCoverage:{knownPageCount:2,readPageIndexes:[0],unresolvedRanges:[]}}}]};
}
test('all exact v3 records and shared coverage survive multiple Host batches once',async()=>{
 const receipt=await readJobAidSourceBatches({sourceRefs:refs,purpose:'Read all exact statements',context:'EXACT'},async intent=>packet(intent.sourceRefs));
 assert.equal(receipt.sourceStatements.length,97);assert.equal(receipt.activityContexts.length,1);assert.equal(receipt.sourceRefs.length,99);assert.equal(receipt.evidence.length,99);
 assert.deepEqual(receipt.sourceStatements.map(r=>r.ref),refs);assert.equal(receipt.completeRequestedScope,true);
});
test('conflicting exact run coverage and missing full later records fail closed',async()=>{
 let call=0;
 await assert.rejects(readJobAidSourceBatches({sourceRefs:refs,purpose:'Read',context:'EXACT'},async intent=>{const p=packet(intent.sourceRefs);if(call++)p.activityContexts[0].readCoverage.selection.sectionIds=['changed'];return p;}),/INCONSISTENT_ACTIVITY_CONTEXT/);
 call=0;
 await assert.rejects(readJobAidSourceBatches({sourceRefs:refs,purpose:'Read',context:'EXACT'},async intent=>{const p=packet(intent.sourceRefs);if(call++)p.sourceStatements=[];return p;}),/INCOMPLETE_STATEMENT/);
});
test('legacy v2 batching retains original fields and never inserts new optional carriers',async()=>{
 const receipt=await readJobAidSourceBatches({sourceRefs:refs,purpose:'Legacy',context:'EXACT'},async intent=>({schemaVersion:'wiselink.jobaid-source-read.v2',status:'AVAILABLE',scope:'EXACT',completeRequestedScope:true,sourceRefs:intent.sourceRefs,evidence:intent.sourceRefs.map(evidenceRef=>({evidenceRef,kind:'DOCUMENT_PASSAGE',excerpt:'source'}))}));
 assert.equal(receipt.sourceRefs.length,97);assert.ok(!Object.hasOwn(receipt,'sourceStatements'));assert.ok(!Object.hasOwn(receipt,'activityContexts'));
});

test('single v3 requested scope cannot be declared complete with empty or partial saved carriers',async()=>{
 const intent={sourceRefs:[refs[0]],purpose:'Read one full record',context:'EXACT'};
 await assert.rejects(readJobAidSourceBatches(intent,async()=>({...packet([]),sourceRefs:[],evidence:[]})),/INCOMPLETE_BATCH/);
 const changes=[p=>{delete p.sourceStatements[0].statement.label;},p=>{delete p.sourceStatements[0].sourceBinding.original.sourceSha256;},p=>{delete p.activityContexts[0].readCoverage;},p=>{p.evidence.find(e=>e.kind==='DOCUMENT_PASSAGE').excerpt='';},p=>{p.scope='PAGE';}];
 for(const change of changes) await assert.rejects(readJobAidSourceBatches(intent,async()=>{const p=structuredClone(packet(intent.sourceRefs));change(p);return p;}),/INCOMPLETE_/);
});
