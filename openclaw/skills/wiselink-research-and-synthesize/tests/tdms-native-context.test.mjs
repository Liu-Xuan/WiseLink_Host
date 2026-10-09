import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTdmsNativeInput, assertTdmsNativeReadPacket } from '../scripts/tdms-native-context.mjs';
import { readJobAidSourceBatches, validateJobAidProblemInput, projectJobAidModelInput } from '../scripts/run-jobaid-problem-assessment.mjs';

// Constructed wire fixtures only; no model/provider or production authority.
const version={rawRevision:'A',rawIteration:'1',confirmation:'SOURCE_DECLARED'};
const state={rawCode:'Estimated',rawName:'Estimated'};
const scope={tenantId:'fixture',sourceKey:'TDMS',sourceInstanceId:'fixture',scopeId:'fixture'};
function input(){
 const ref='native:fixture';
 return {schemaVersion:'wiselink.jobaid-problem-task.v2',purpose:'INITIAL_PROBLEM_ASSESSMENT',methodBinding:{packRef:'fixture'},expectedWorkRevision:0,
  availableSources:[{ref,kind:'TDMS_NATIVE_RECORD',title:'Approved source opinion',versionLabel:'A',locator:'content.opinions[0]'}],deliveredEvidence:[],
  contextPackage:{sourceOrigins:[{evidenceRef:ref,origin:'TDMS_NATIVE_RECORD',contentNature:'SOURCE_DECLARED_PROFESSIONAL_OPINION'}]},
  tdmsContext:{schemaVersion:'wiselink.tdms-runtime-context.v1',projection:{opinions:[{evidenceRef:ref,scope,assessment:{recordRef:'record',sourceRevisionRef:'assessment',sourceRecordId:'source',sourceVersion:version,businessVersion:null},fieldPath:'content.opinions[0]',sourceSelector:'#opinion',author:null,lane:null,approval:{captureRef:'capture',evidencePath:'rawFields.opinionCollection',mode:'EXACT_VERSION'},sourceVerification:'DECLARED_ONLY',readPerformed:false,engineeringAdoption:'NOT_CREATED',executionVerified:false}],contradictions:[],selectedSetApprovedRefs:[ref],historicalCohortApprovedRefs:[],cohorts:[{scope,setRevisionRef:'set',processingFamilyRef:'family',cohortRef:'cohort',processingObservationRef:'processing',rootBindings:[],selection:'HOST_SELECTED',membershipCoverage:'PARTIAL',versionMappingCoverage:'PARTIAL',approvedBodyCaptureCoverage:'PARTIAL',approvalReadiness:'UNKNOWN',currentness:'CURRENT',members:[{memberRef:'member-a',assessmentObservationRef:'assessment',membershipResolution:'CONFIRMED',opinionRefs:[ref],contributorRefs:['engineer-a','engineer-b'],responsibilityRefs:['responsibility'],ataScopes:['ATA 27','ATA 31'],evidenceRefs:['proof'],opinionContributions:[],status:'APPROVED'},{memberRef:'member-b',assessmentObservationRef:null,membershipResolution:'UNRESOLVED',opinionRefs:[],contributorRefs:[],responsibilityRefs:[],ataScopes:[],evidenceRefs:[],opinionContributions:[],status:'UNKNOWN'}],approvedOpinionRefs:[ref],qualifiedOpinionRefs:[],revokedOpinionRefs:[],gaps:['MEMBER_NOT_ACQUIRED']}],readPerformed:false,interpretation:'APPROVED_PROFESSIONAL_JUDGMENT_NOT_INFALLIBLE'}}};
}
function packet(refs=['native:fixture']) {
 const evidence=refs.map(ref=>{
  const receipt={receiptRef:`read:${ref}`,readAt:'2026-10-07T00:00:00Z',sourceRevisionRef:'assessment',purpose:'JOB_AID_NATIVE_RECORD',fieldPaths:['content.opinions[0]'],taskContextRef:'task',permissionRevision:'current-authority',readPerformed:true,executionVerified:false,engineeringAdoption:'NOT_CREATED'};
  const observed={sourceRecordId:'source',sourceVersion:version,recordKind:'ENGINEER_ASSESSMENT',objectBinding:'EXACT_CURRENT_DETAIL',state};
  return {evidenceRef:ref,kind:'TDMS_NATIVE_RECORD',excerpt:'Complete opinion; only if installed; verify configuration.',nativeSource:{recordKind:'ENGINEER_ASSESSMENT',sourceRecordId:'source',sourceRevisionRef:'assessment',sourceVersion:version,state},nativeScope:{sourceRevisionRef:'assessment',fieldSelectors:[{fieldPath:'content.opinions[0]',selector:'#opinion'}],processingSetBinding:{assessmentObservationRef:'assessment'},approval:{captureRef:'capture',evidencePath:'rawFields.opinionCollection',mode:'EXACT_VERSION',approvalSubject:{sourceRecordId:'source',sourceVersion:version},before:observed,after:observed}},nativeReadReceipt:receipt};
 });
 return {schemaVersion:'wiselink.jobaid-source-read.v2',status:'AVAILABLE',scope:'EXACT',completeRequestedScope:true,sourceRefs:refs,evidence,nativeReadReceipts:evidence.map(e=>e.nativeReadReceipt)};
}

test('actual runtime accepts metadata addon with full siblings and source nature but no native body',()=>{
 const value=input();assert.equal(validateJobAidProblemInput(value),value);const projected=projectJobAidModelInput(value);
 assert.deepEqual(projected.tdmsContext,value.tdmsContext);assert.deepEqual(projected.availableSources[0].sourceOrigins,[{origin:'TDMS_NATIVE_RECORD',contentNature:'SOURCE_DECLARED_PROFESSIONAL_OPINION'}]);
 assert.equal(projected.tdmsContext.projection.cohorts[0].members.length,2);
 assert.equal(projected.deliveredEvidence.length,0);
});
test('old task bytes remain unchanged; native fields without an explicit addon fail closed',()=>{
 const value=input();delete value.tdmsContext;
 assert.throws(()=>validateJobAidProblemInput(value),/TDMS_CONTEXT_REQUIRED/);
 value.availableSources=[];delete value.contextPackage;const bytes=JSON.stringify(value);validateJobAidProblemInput(value);assert.equal(JSON.stringify(value),bytes);
});
test('projector metadata cannot smuggle body or claim a READ',()=>{
 for(const poison of [p=>p.opinions[0].body='hidden',p=>p.readPerformed=true,p=>p.cohorts[0].members[1].body='unapproved']){
  const value=input();poison(value.tdmsContext.projection);assert.throws(()=>assertTdmsNativeInput(value),/TDMS_/);
 }
 const value=input();value.deliveredEvidence=packet().evidence;assert.throws(()=>assertTdmsNativeInput(value),/DIRECTORY_ONLY_REQUIRED/);
});
test('READ validates exact selected fields, own approval and separate fresh receipt',async()=>{
 const value=packet();assert.doesNotThrow(()=>assertTdmsNativeReadPacket(value));
 for(const poison of [p=>delete p.nativeReadReceipts,p=>delete p.evidence[0].nativeReadReceipt.readAt,p=>p.evidence[0].nativeReadReceipt.readAt='2026-02-31T00:00:00Z',p=>p.nativeReadReceipts=[],p=>p.evidence[0].nativeSource.state={rawCode:'Estimating',rawName:'Estimating'},p=>p.evidence[0].nativeScope.approval.before={...p.evidence[0].nativeScope.approval.before,sourceRecordId:'parent-processing'},p=>p.evidence[0].nativeReadReceipt.fieldPaths=['other']]){
  const changed=structuredClone(value);poison(changed);assert.throws(()=>assertTdmsNativeReadPacket(changed),/TDMS_/);
 }
 const result=await readJobAidSourceBatches({sourceRefs:value.sourceRefs,context:'EXACT'},async()=>value);assert.deepEqual(result,value);
});
test('actual >96 source batching keeps each native body once and all distinct receipts',async()=>{
 const refs=Array.from({length:97},(_,index)=>`native:${index}`);let calls=0;
 const result=await readJobAidSourceBatches({sourceRefs:refs,context:'EXACT'},async request=>{calls++;return packet(request.sourceRefs);});
 assert.equal(calls,2);assert.equal(result.evidence.length,97);assert.equal(result.nativeReadReceipts.length,97);assert.deepEqual(result.sourceRefs,refs);
});
