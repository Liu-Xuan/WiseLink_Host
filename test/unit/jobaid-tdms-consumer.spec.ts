import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { tdmsTransactionProofFixture } from './fixtures/tdms-transaction-native-verifier.fixture';
import type { TdmsNativeTransactionInput } from '@server/modules/canonical-host/tdms-native-evidence-verifier.port';
import { tdmsRuntimeFixture } from './fixtures/tdms-runtime.fixture';
import type { TdmsRuntimeReaderPort } from '../../server/modules/tdms-source/tdms-runtime-reader.port';
import type { TdmsNativeEvidenceVerifier } from '../../server/modules/canonical-host/tdms-native-evidence-verifier.port';
import type { CanonicalVerifiedServiceScope } from '../../server/modules/canonical-host/canonical-service-scope.authorization';
import { tdmsNativeEvidenceFixture } from './fixtures/tdms-native-evidence.fixture';
import type { TdmsRuntimeTaskContext } from '../../server/modules/tdms-source/tdms-runtime-reader.port';
import { tdmsApprovedOpinionRef } from '../../server/modules/canonical-host/tdms-approved-opinion-context';
import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import { buildJobAidProblemTask, assertJobAidProblemTaskBinding } from '../../server/modules/canonical-host/jobaid-problem-task';
import { projectCommonAssessmentContext } from '../../server/modules/canonical-host/canonical-host-common-context.service';
import { CanonicalJobAidProblemService } from '../../server/modules/canonical-host/canonical-jobaid-problem.service';

const item = {workItemId:'WI-TEST', revision:1, source:{documentVersionId:'DV-TEST',sourceArtifactId:'ART-TEST',sourceFileSha256:'a'.repeat(64),sourceByteLength:10}} as unknown as CanonicalWorkItemProjection;
const scope = {tenantId:'fixture-tenant',sourceKey:'TDMS',sourceInstanceId:'fixture-instance',scopeId:'fixture-scope'};
const NATIVE_REF = tdmsApprovedOpinionRef({scope,sourceRevisionRef:'assessment-observation-1',opinionIndex:0});
function nativeEvidence() {
  const evidence = tdmsNativeEvidenceFixture();
  evidence.evidenceRef = NATIVE_REF;
  evidence.nativeReadReceipt.taskContextRef = 'OP-TEST';
  return evidence;
}
function nativeContext(): TdmsRuntimeTaskContext {
  const evidence=nativeEvidence();const source=evidence.nativeSource;const bind=evidence.nativeScope.processingSetBinding;
  const opinion = {evidenceRef:NATIVE_REF,scope,assessment:{recordRef:source.recordRef,sourceRevisionRef:source.sourceRevisionRef,sourceRecordId:source.sourceRecordId,sourceVersion:source.sourceVersion,businessVersion:source.businessVersion??null},fieldPath:'content.opinions[0]',sourceSelector:evidence.nativeScope.fieldSelectors[0].selector,author:null,lane:null,approval:{captureRef:evidence.nativeScope.approval.captureRef,evidencePath:'rawFields.opinionCollection' as const,mode:'EXACT_VERSION' as const},sourceVerification:'DECLARED_ONLY' as const,readPerformed:false as const,engineeringAdoption:'NOT_CREATED' as const,executionVerified:false as const};
  return {schemaVersion:'wiselink.tdms-runtime-context.v1',binding:{tenantId:'fixture-tenant',workItemId:'WI-TEST',documentVersionId:'DV-TEST',actorUserId:'owner',taskContextRef:'OP-TEST'},selections:[{scope,processingFamilyRef:bind.processingFamilyRef,setRevisionRef:bind.setRevisionRef,generation:bind.generation,sourceRevisionRefs:['source-revision']}],projection:{opinions:[opinion],contradictions:[],selectedSetApprovedRefs:[NATIVE_REF],historicalCohortApprovedRefs:[],cohorts:[{scope,setRevisionRef:bind.setRevisionRef,processingFamilyRef:bind.processingFamilyRef,cohortRef:bind.cohortRef,processingObservationRef:bind.processingObservationRef,rootBindings:[{endpoint:{kind:'NATIVE_RECORD_REVISION',sourceRevisionRef:'source-revision'},fileProcessingAssertionRefs:['file-processing'],applicabilityEvidenceRefs:['applicability']}],selection:'HOST_SELECTED',membershipCoverage:'COMPLETE',versionMappingCoverage:'COMPLETE',approvedBodyCaptureCoverage:'COMPLETE',approvalReadiness:'ALL_APPROVED',currentness:'CURRENT',members:[{memberRef:bind.memberRef,assessmentObservationRef:source.sourceRevisionRef,membershipResolution:'CONFIRMED',opinionRefs:[NATIVE_REF],contributorRefs:['engineer-a','engineer-b'],responsibilityRefs:['responsibility-a'],ataScopes:['ATA 27','ATA 31'],evidenceRefs:['proof'],opinionContributions:[],status:'APPROVED'}],approvedOpinionRefs:[NATIVE_REF],qualifiedOpinionRefs:[],revokedOpinionRefs:[],gaps:[]}],readPerformed:false,interpretation:'APPROVED_PROFESSIONAL_JUDGMENT_NOT_INFALLIBLE'}};
}

function task(withNative = true, context = nativeContext()) {
  return buildJobAidProblemTask({workItem:item,actorUserId:'owner',permissionSnapshotVersion:'p1',purpose:'INITIAL_PROBLEM_ASSESSMENT',sourceCatalog:[],sourceBindings:[],common:projectCommonAssessmentContext(item,{context:{status:'UNAVAILABLE',reason:'CONSTRUCTED'},documentReadingStatus:'AVAILABLE',items:[],sections:[],resourceRefs:[]},[]),previousWork:null,expectedWorkRevision:0,priorAssessmentRefs:[],...(withNative?{tdmsContext:context}: {})} as Parameters<typeof buildJobAidProblemTask>[0]);
}

test('new task carries metadata-only TDMS directory and all sibling contribution scope',()=>{
  const built=task();
  expect(built.modelInput.availableSources).toContainEqual(expect.objectContaining({ref:NATIVE_REF,kind:'TDMS_NATIVE_RECORD'}));
  expect(built.modelInput.tdmsContext).toEqual({schemaVersion:'wiselink.tdms-runtime-context.v1',projection:nativeContext().projection});
  expect(built.sourceCatalog.some(e=>e.kind==='TDMS_NATIVE_RECORD')).toBe(false);
  expect(built.modelInput.deliveredEvidence.some(e=>e.kind==='TDMS_NATIVE_RECORD')).toBe(false);
  expect(assertJobAidProblemTaskBinding(built)).toBe(built);
});
test('old task keeps identical bytes and schema with no native addon',()=>{
  const old=task(false); expect(old).not.toHaveProperty('tdmsContext');expect(old.modelInput).not.toHaveProperty('tdmsContext');
  expect(JSON.stringify(assertJobAidProblemTaskBinding(old))).toBe(JSON.stringify(old));
  expect(old.schemaVersion).toBe('wiselink.jobaid-problem-task.v2');
});
test('real source reader refuses native task when runtime verifier is absent',async()=>{
  const service=new CanonicalJobAidProblemService(...Array.from({length:10},()=>({})) as ConstructorParameters<typeof CanonicalJobAidProblemService>);
  const built=task(); Object.assign(built,{tdmsContext:nativeContext()});
  Object.assign(service,{authorizedAttempt:async()=>({row:{operationRef:'OP-TEST'},taskInput:built,scope:{tenantId:'fixture-tenant',workItemId:'WI-TEST',principalId:'executor'}}),assertSourcesAuthorized:async()=>undefined});
  await expect(service.readSources({attemptRef:'OP-TEST',leaseToken:'lease',leaseGeneration:1,sourceRefs:[NATIVE_REF],purpose:'explicit native read',context:'EXACT'})).rejects.toThrow('TDMS_RUNTIME_CALLER_AUTHORIZATION_NOT_CONNECTED');
});

import type { AssessmentTdmsNativeEvidence } from '@shared/assessment-tdms-evidence';
import type { JobAidWorkRevision } from '@shared/jobaid-problem-assessment.interface';
import type { ActionAttemptRow } from '../../server/modules/action-attempt/action-attempt.types';
import { sealTaskEnvelope, canonicalJson } from '../../server/modules/action-attempt/action-attempt-envelope';
import { assertJobAidWorkFence } from '../../server/modules/canonical-host/jobaid-work.repository';
import { tdmsReadObservation, resolvedTdmsReadEvidence, sameTdmsEvidenceBody } from '../../server/modules/canonical-host/jobaid-tdms-context';

/** Constructed authority and storage fixtures exercise actual service/task/materializer.
 * Runtime adapter and transaction SQL/fence mechanics have separate focused tests. */
function serviceHarness(override: {context?:TdmsRuntimeTaskContext;principal?:CanonicalVerifiedServiceScope;reader?:TdmsRuntimeReaderPort;verifier?:TdmsNativeEvidenceVerifier} = {}) {
  const taskInput=task(true,override.context??nativeContext()); let allowed=true; let readCount=0; let revokeOnRecord=false;
  const principal=override.principal??{tenantId:'fixture-tenant',workItemId:'WI-TEST',principalId:'executor',appId:'app_17bzc551rsg',authorizationFingerprint:'fixture-auth'};
  if (principal.automaticWorkItemLease) taskInput.automaticWorkItemLease={
    requestId:principal.automaticWorkItemLease.requestId,leaseGeneration:principal.automaticWorkItemLease.leaseGeneration};
  const envelope=sealTaskEnvelope({schemaVersion:'wiselink.3_1.openclaw_task_envelope.v1',actionAttemptId:'ATT-TEST',operationRef:'OP-TEST',taskType:'OPENCLAW_DYNAMIC_EVALUATION',priority:1,tenantId:principal.tenantId,workItemId:'WI-TEST',inputRevision:1,baseRevision:1,documentVersionId:'DV-TEST',sourceRefs:[],allowedConnectors:[],hostResolvedMissingInputs:[],modelInput:taskInput,deadline:'2099-01-01T00:00:00Z',idempotencyKey:'fixture'});
  const row={attemptId:'ATT-TEST',operationRef:'OP-TEST',tenantId:principal.tenantId,workItemId:'WI-TEST',documentVersionId:'DV-TEST',inputRevision:1,baseRevision:1,actionType:envelope.taskType,status:'RUNNING',taskEnvelopeJson:canonicalJson(envelope),reviewActivityJson:'[]',leaseOwner:principal.principalId,leaseToken:'lease',leaseGeneration:1,leaseExpiresAt:new Date('2099-01-01'),deadlineAt:new Date('2099-01-01'),cancelRequestedAt:null} as ActionAttemptRow;
  const history:JobAidWorkRevision[]=[];
  const database={fixtureTransaction:'source-read-and-save'} as unknown as PostgresJsDatabase;
  let transactionHeld=false;
  const assertOrdinaryReader=()=>{if(transactionHeld)throw new Error('ORDINARY_NATIVE_READER_UNDER_HELD_TRANSACTION');};
  const held=async<T>(run:()=>Promise<T>):Promise<T>=>{transactionHeld=true;try{return await run();}finally{transactionHeld=false;}};
  const assertAllowed=()=>{if(!allowed)throw new Error('FIXTURE_NATIVE_ACCESS_REVOKED');};
  const reader={
    discover:jest.fn(async()=>nativeContext()),
    assertAuthorized:jest.fn(async(caller:{actorUserId:string;scope:{principalId:string}},context:TdmsRuntimeTaskContext)=>{
      assertOrdinaryReader();assertAllowed();expect(caller.actorUserId).toBe('owner');expect(caller.scope.principalId).toBe('executor');expect(context).toEqual(nativeContext());
    }),
    read:jest.fn(async()=>{assertOrdinaryReader();assertAllowed();const e=nativeEvidence();e.nativeReadReceipt.receiptRef=`read-${++readCount}`;return {evidence:[e],receipts:[e.nativeReadReceipt]};}),
    verifyEvidence:jest.fn(async()=>{assertOrdinaryReader();assertAllowed();}),
  };
  const verifier={assertInTransaction:jest.fn(async(input:TdmsNativeTransactionInput)=>{expect(input.database).toBe(database);assertAllowed();for(const e of input.evidence)if(e.kind==='TDMS_NATIVE_RECORD'&&!sameTdmsEvidenceBody(e,nativeEvidence()))throw new Error('FIXTURE_BODY_CHANGED');}),authorize:jest.fn(async(evidence:AssessmentTdmsNativeEvidence[])=>{assertOrdinaryReader();assertAllowed();return evidence.map(e=>({evidenceRef:e.evidenceRef,sourceRevisionRef:e.nativeSource.sourceRevisionRef,processingSetBinding:e.nativeScope.processingSetBinding,permissionRevision:'fixture-permission',sourceAudienceAuthorized:true as const,selectedObjectAuthorized:true as const}));}),
    readExactEvidence:jest.fn(async(evidence:AssessmentTdmsNativeEvidence[])=>{assertOrdinaryReader();assertAllowed();for(const e of evidence)expect(sameTdmsEvidenceBody(e,nativeEvidence())).toBe(true);return structuredClone(evidence);}),
    assertCurrentEvidence:jest.fn(async({evidence}:{evidence:AssessmentTdmsNativeEvidence[]})=>{assertOrdinaryReader();assertAllowed();for(const e of evidence)if(!sameTdmsEvidenceBody(e,nativeEvidence()))throw new Error('FIXTURE_BODY_CHANGED');})};
  const work={
    withActorTransaction:jest.fn(async(_actor:string,fn:(db:unknown)=>Promise<unknown>)=>held(()=>fn(database))),
    withActorScope:jest.fn(async(_actor:string,fn:()=>Promise<unknown>)=>fn()),
    loadOwnedSourceBinding:jest.fn(async()=>({documentVersionId:'DV-TEST'})),
    listForRuntime:jest.fn(async()=>history),
    recordSourceRead:jest.fn(async(input:{sourceRefs:string[];nativeEvidence?:AssessmentTdmsNativeEvidence[];assertNativeAuthorized?:(database:PostgresJsDatabase)=>Promise<void>;fence:Parameters<typeof assertJobAidWorkFence>[1]})=>held(async()=>{
      assertJobAidWorkFence(row,input.fence);await input.assertNativeAuthorized?.(database);
      const observations=JSON.parse(row.reviewActivityJson??'[]');observations.push({kind:'ASSESSMENT_SOURCES_READ',sourceRefs:input.sourceRefs,...tdmsReadObservation(input,row.reviewActivityJson,row.operationRef)});row.reviewActivityJson=JSON.stringify(observations);
      if(revokeOnRecord)allowed=false;await input.assertNativeAuthorized?.(database);
    })),
    save:jest.fn(async(input:{content:JobAidWorkRevision['content'];requestId:string;assertNativeAuthorized?:(database:PostgresJsDatabase)=>Promise<void>;fence:Parameters<typeof assertJobAidWorkFence>[1]})=>held(async()=>{
      assertJobAidWorkFence(row,input.fence);await input.assertNativeAuthorized?.(database);
      const revision:JobAidWorkRevision={workRevisionRef:`JAWR-${history.length+1}`,workItemId:'WI-TEST',workRevision:history.length+1,previousWorkRevisionRef:history[0]?.workRevisionRef??null,requestId:input.requestId,actionAttemptId:row.attemptId,basedOnWorkItemRevision:1,documentVersionId:'DV-TEST',createdAt:'2026-10-07T00:00:00Z',content:structuredClone(input.content)};
      history.unshift(revision);await input.assertNativeAuthorized?.(database);return {revision,replayed:false};
    })),
  };
  const service=new CanonicalJobAidProblemService({} as never,{} as never,{authorizeOpenClawAttempt:async()=>principal} as never,{} as never,{} as never,{readScoped:async()=>row} as never,{loadAuthorizationBinding:async()=>({documentVersionId:'DV-TEST'})} as never,{hasActiveOfficialActorMapping:async()=>true} as never,{} as never,work as never,undefined,undefined,undefined,undefined,undefined,undefined,override.reader??reader,override.verifier??verifier);
  Object.assign(service,{registrar:{getTenantScopedByWorkItemId:async()=>structuredClone(item)}});
  const fence={attemptRef:'OP-TEST',leaseToken:'lease',leaseGeneration:1};
  const targetRef=taskInput.modelInput.availableSources.find(item=>item.kind==='TDMS_NATIVE_RECORD')!.ref;
  const command={schemaVersion:'wiselink.jobaid-problem-work.v3',headline:'Conditional native judgment',listBrief:'Configuration remains to be verified',overview:'Source professional judgment, not execution proof',issues:[{issueKey:'native-condition',question:'Is configuration eligible?',body:`The approved source opinion is conditional [[${targetRef}]].`,riskScenarios:[],measures:[],otherClassifications:[],openQuestions:[],requirementHandling:[]}],roundCompletion:'COMPLETE_WITH_OPEN_QUESTIONS',completionReason:'Source read; configuration remains unresolved',changeSummary:'Added source judgment',unchangedExplanation:'No prior conclusion replaced'};
  return {service,taskInput,row,reader,verifier,work,history,fence,command,database,revoke:()=>{allowed=false;},revokeDuringRecord:()=>{revokeOnRecord=true;}};
}

test('actual JobAid READ→SAVE→exact readback keeps one body and independent fresh receipts',async()=>{
  const h=serviceHarness();
  await expect(h.service.saveWork({...h.fence,requestId:'before-read',expectedWorkRevision:0,workJson:JSON.stringify(h.command)})).rejects.toThrow('SOURCE_NOT_DELIVERED');
  const read=()=>h.service.readSources({...h.fence,sourceRefs:[NATIVE_REF],purpose:'Read own approved fields',context:'EXACT'});
  const first=await read();const second=await read();
  expect(first.evidence.filter(e=>e.kind==='TDMS_NATIVE_RECORD')).toHaveLength(1);
  expect(first.nativeReadReceipts![0].receiptRef).not.toBe(second.nativeReadReceipts![0].receiptRef);
  expect(resolvedTdmsReadEvidence(h.row.reviewActivityJson)).toHaveLength(1);
  const observations=JSON.parse(h.row.reviewActivityJson!);expect(observations.flatMap((o:{nativeReadReceipts:unknown[]})=>o.nativeReadReceipts)).toHaveLength(2);
  expect(observations.flatMap((o:{nativeEvidence:unknown[]})=>o.nativeEvidence)).toHaveLength(1);
  const saved=await h.service.saveWork({...h.fence,requestId:'save-native',expectedWorkRevision:0,workJson:JSON.stringify(h.command)});
  expect(saved.workRevision).toBe(1);
  const body=await h.service.readAttemptWork('OP-TEST','save-native');
  expect(body.revision!.content.evidence.filter(e=>e.kind==='TDMS_NATIVE_RECORD')).toHaveLength(1);
  expect(body.revision!.content.evidence.find(e=>e.kind==='TDMS_NATIVE_RECORD')!.excerpt).toBe(nativeEvidence().excerpt);
  expect(h.verifier.readExactEvidence).toHaveBeenCalled();
});
test('revocation after awaited receipt persistence prevents native body return and later SAVE',async()=>{
  const h=serviceHarness();h.revokeDuringRecord();
  await expect(h.service.readSources({...h.fence,sourceRefs:[NATIVE_REF],purpose:'Explicit read',context:'EXACT'})).rejects.toThrow('FIXTURE_NATIVE_ACCESS_REVOKED');
  await expect(h.service.saveWork({...h.fence,requestId:'denied',expectedWorkRevision:0,workJson:JSON.stringify(h.command)})).rejects.toThrow('FIXTURE_NATIVE_ACCESS_REVOKED');
  expect(h.work.save).not.toHaveBeenCalled();
});
test('stale lease is rejected before reading the native body',async()=>{
  const h=serviceHarness();
  await expect(h.service.readSources({...h.fence,leaseGeneration:2,sourceRefs:[NATIVE_REF],purpose:'Stale',context:'EXACT'})).rejects.toThrow();
  expect(h.reader.read).not.toHaveBeenCalled();
});
test('native current task scope cannot be rebound to another attempt or historical document',()=>{
  const built=task();const changed=structuredClone(built);changed.tdmsContext!.binding.documentVersionId='other';
  expect(()=>assertJobAidProblemTaskBinding(changed)).toThrow('JOBAID_TDMS_TASK_BINDING_INVALID');
});

test('actual producer/set service/shared READ decisions feed JobAid native task→READ→SAVE with both siblings',async()=>{
  const f=tdmsRuntimeFixture({tenantId:'fixture-tenant',actorUserId:'owner',workItemId:'WI-TEST',documentVersionId:'DV-TEST',taskContextRef:'OP-TEST'});
  f.principal.scope.appId='app_17bzc551rsg';f.actor.applicationScopeId=f.principal.scope.appId;f.actor.subjectDecision.applicationScopeId=f.principal.scope.appId;
  const context=await f.adapter.discover(f.principal,f.binding);
  expect(f.control.bodyReads).toBe(0);
  const verifier:TdmsNativeEvidenceVerifier={
    assertInTransaction:tdmsTransactionProofFixture(f),
    authorize:async(evidence)=>{
      await f.adapter.verifyEvidence(f.principal,evidence);
      const grant=await f.authorization.authorize(f.actor,f.scope,'READ_RECORD',{workItemId:f.binding.workItemId});
      return evidence.map(item=>({evidenceRef:item.evidenceRef,sourceRevisionRef:item.nativeSource.sourceRevisionRef,processingSetBinding:item.nativeScope.processingSetBinding,permissionRevision:grant.permissionRevision,sourceAudienceAuthorized:true,selectedObjectAuthorized:true}));
    },
    readExactEvidence:async(evidence)=>{await f.adapter.verifyEvidence(f.principal,evidence);return structuredClone(evidence);},
    assertCurrentEvidence:async({evidence})=>{await f.adapter.verifyEvidence(f.principal,evidence);},
  };
  const h=serviceHarness({context,principal:f.principal.scope,reader:f.adapter,verifier});
  const refs=context.projection.selectedSetApprovedRefs;
  expect(refs).toHaveLength(2);
  expect(h.taskInput.modelInput.tdmsContext!.projection.cohorts[0].members[0].contributorRefs).toEqual(['engineer-1','engineer-2']);
  const receipt=await h.service.readSources({...h.fence,sourceRefs:refs,purpose:'Read exact parallel siblings',context:'EXACT'});
  expect(receipt.evidence).toHaveLength(2);expect(f.receipts).toHaveLength(2);
  expect(receipt.evidence.map(e=>e.excerpt)).toEqual(expect.arrayContaining([expect.stringContaining('Only if installed a'),expect.stringContaining('Only if installed b')]));
  const saved=await h.service.saveWork({...h.fence,requestId:'real-adapter-save',expectedWorkRevision:0,workJson:JSON.stringify(h.command)});
  expect(saved.workRevision).toBe(1);
  await h.service.readAttemptWork('OP-TEST','real-adapter-save');
  f.control.sourceAllowed=false;
  await expect(h.service.readAttemptWork('OP-TEST','real-adapter-save')).rejects.toThrow();
});

import { originalFixture } from './document-parsing/fixtures/document-original.fixture';
test('actual new JobAid input builder discovers approved metadata through injected runtime reader before sealing',async()=>{
  const f=tdmsRuntimeFixture({tenantId:'fixture-tenant',actorUserId:'owner',workItemId:'WI-TEST',documentVersionId:'DV-TEST',taskContextRef:'OP-TEST'});
  f.principal.scope.appId='app_17bzc551rsg';f.actor.applicationScopeId=f.principal.scope.appId;f.actor.subjectDecision.applicationScopeId=f.principal.scope.appId;
  const context=await f.adapter.discover(f.principal,f.binding);
  const h=serviceHarness({context,principal:f.principal.scope,reader:f.adapter});
  const original=originalFixture();const workItem=structuredClone(item);workItem.source.sourceByteLength=original.binding.sourceByteLength;
  Object.assign(h.work,{publishedOriginalBinding:async()=>({parseRunId:original.binding.parseRunId}),listHeadersForRuntime:async()=>[],
    loadOwnedSourceBinding:async()=>({kind:'SOURCE_FILE',workItemId:item.workItemId,documentVersionId:'DV-TEST',artifactRef:'ART-TEST',artifactSha256:'a'.repeat(64)})});
  Object.assign(h.service,{originalReader:{readDocumentOriginal:async()=>({original,structuredSource:original.source,run:{tenantId:'fixture-tenant',documentVersionId:'DV-TEST',parseRunId:original.binding.parseRunId,parseRevision:original.binding.parseRevision,manifestArtifact:{relativePath:'original/manifest.json',readback:'VERIFIED',sha256:'b'.repeat(64),byteLength:1}}})},
    semantics:{read:async()=>null},common:{buildForWorkItemWithEvidence:async()=>({common:projectCommonAssessmentContext(item,{context:{status:'UNAVAILABLE',reason:'CONSTRUCTED'},documentReadingStatus:'AVAILABLE',items:[],sections:[],resourceRefs:[]},[]),availableReadingEvidence:[]})},
    workItems:{loadAuthorizationBinding:async()=>({documentVersionId:'DV-TEST'}),loadTenantScopedProjection:async()=>({row:{initialAilySessionId:null}})}});
  const build=()=> (h.service as unknown as {buildInput(...args:unknown[]):Promise<ReturnType<typeof buildJobAidProblemTask>>}).buildInput(workItem,'fixture-tenant','owner','p1','INITIAL_PROBLEM_ASSESSMENT','2026-10-07T00:00:00Z',[],undefined,undefined,undefined,false,{scope:f.principal.scope,taskContextRef:'OP-TEST'});
  const built=await build();expect(built.tdmsContext).toEqual(context);expect(built.modelInput.availableSources.filter(s=>s.kind==='TDMS_NATIVE_RECORD')).toHaveLength(2);
  expect(f.control.bodyReads).toBe(0);expect(f.receipts).toEqual([]);
  Object.assign(h.service,{knowledge:{binding:async()=>{f.control.sourceAllowed=false;return undefined;}}});
  await expect(build()).rejects.toThrow();
  expect(f.control.bodyReads).toBe(0);
});

test('native body verification is last after awaited final task authorization',async()=>{
  const h=serviceHarness();let afterJournal=false;let bodyChanged=false;
  const record=h.work.recordSourceRead.getMockImplementation()!;
  h.work.recordSourceRead.mockImplementation(async args=>{await record(args);afterJournal=true;});
  const authorize=h.reader.assertAuthorized.getMockImplementation()!;
  h.reader.assertAuthorized.mockImplementation(async(caller,context)=>{await authorize(caller,context);if(afterJournal)bodyChanged=true;});
  h.reader.verifyEvidence.mockImplementation(async()=>{if(bodyChanged)throw new Error('FIXTURE_BODY_CHANGED');});
  await expect(h.service.readSources({...h.fence,sourceRefs:[NATIVE_REF],purpose:'Exact return boundary',context:'EXACT'})).rejects.toThrow('FIXTURE_BODY_CHANGED');
});

import { readInitialAnalysisRequestInput, assertPreparedInitialAnalysisInput } from '../../server/modules/action-attempt/initial-analysis-request';
import type { ReserveActionAttemptInput } from '../../server/modules/action-attempt/action-attempt.types';
import type { OpenClawTaskEnvelope } from '../../server/modules/action-attempt/action-attempt-envelope.types';
import { ActionAttemptLifecycleService } from '../../server/modules/action-attempt/action-attempt-lifecycle.service';
test('normal queued Overall defers only native admission to genuine runtime and pins prior work/original/idempotency',async()=>{
  const h=serviceHarness();const current=structuredClone(item);
  current.integratedAssessment={baseRules:{schemaVersion:'wiselink.jobaid-problem-result.v2',workRevisionRef:'JAWR-1',workRevision:1,readingResult:{evidence:[nativeEvidence()]}}} as never;
  let queued:OpenClawTaskEnvelope | undefined;
  const reserve=jest.fn(async(input:ReserveActionAttemptInput)=>{
    const modelInput=await input.buildModelInput({attemptId:'ATT-QUEUE',operationRef:'OP-QUEUE',triggerRequestId:'REQ-QUEUE',attemptNo:1,createdAt:new Date('2026-10-07T00:00:00Z')});
    queued=sealTaskEnvelope({schemaVersion:'wiselink.3_1.openclaw_task_envelope.v1',actionAttemptId:'ATT-QUEUE',operationRef:'OP-QUEUE',taskType:input.taskType,priority:1,tenantId:input.tenantId,workItemId:input.workItemId,inputRevision:input.inputRevision,baseRevision:input.baseRevision,documentVersionId:input.documentVersionId,sourceRefs:input.sourceRefs??[],allowedConnectors:input.allowedConnectors??[],hostResolvedMissingInputs:[],modelInput,deadline:'2099-01-01T00:00:00Z',idempotencyKey:input.idempotencyKey});
    return {task:queued,created:true};
  });
  const eager=jest.fn(async()=>{throw new Error('BROWSER_MUST_NOT_CREATE_RUNTIME_PRINCIPAL');});
  Object.assign(h.service,{attempts:{reserve},buildInput:eager,workItems:{loadTenantScopedProjection:async()=>({row:{documentVersionId:'DV-TEST',requestedByUserId:'owner',initialAilySessionId:null}})}});
  Object.assign(h.work,{publishedOriginalBinding:async()=>({parseRunId:'PR-TEST-2'})});
  const result=await h.service.enqueueOverall(current,'fixture-tenant','browser-permission');
  expect(result.attemptRef).toBe('OP-QUEUE');expect(eager).not.toHaveBeenCalled();expect(h.reader.discover).not.toHaveBeenCalled();
  const request=readInitialAnalysisRequestInput(queued!)!;
  expect(request.nativeOverallAdmission).toEqual({workRevisionRef:'JAWR-1',workRevision:1});
  expect(queued!.idempotencyKey).toBe('openclaw-v1:overall:WI-TEST:1:problem-v2');
  expect(queued!.modelInput).not.toHaveProperty('tdmsContext');
  const prepared={...task(),previousWork:{workRevisionRef:'JAWR-1',workRevision:1},modelInput:{...task().modelInput,documentOverview:{...task().modelInput.documentOverview,original:{binding:{parseRunId:'PR-TEST-2'}}}}};
  expect(()=>assertPreparedInitialAnalysisInput(request,prepared)).not.toThrow();
  expect(()=>assertPreparedInitialAnalysisInput(request,{...prepared,tdmsContext:undefined})).toThrow('JOBAID_TDMS_OVERALL_PREPARED_BINDING_INVALID');
  expect(()=>assertPreparedInitialAnalysisInput(request,{...prepared,previousWork:{workRevisionRef:'JAWR-2',workRevision:2}})).toThrow('JOBAID_TDMS_OVERALL_PREPARED_BINDING_INVALID');
  expect(()=>readInitialAnalysisRequestInput({...queued!,idempotencyKey:'openclaw-v1:overall:foreign:1:problem-v2'})).toThrow('ACTION_ATTEMPT_INITIAL_REQUEST_BINDING_INVALID');
  const row={attemptId:'ATT-QUEUE',operationRef:'OP-QUEUE',triggerRequestId:'REQ-QUEUE',attemptNo:1,createdAt:new Date(),status:'QUEUED',claimCount:0,leaseGeneration:0,startedAt:null,leaseToken:null,deadlineAt:new Date('2099-01-01')} as ActionAttemptRow;
  const prepare=jest.fn(async(_row:ActionAttemptRow,value:OpenClawTaskEnvelope)=>({...row,taskEnvelopeJson:canonicalJson(value)}));
  const lifecycle=new ActionAttemptLifecycleService({prepareInitialRequestInput:prepare,failInitialRequestPreparation:async()=>undefined} as never,{} as never);
  await (lifecycle as unknown as {prepareInitialRequest(...args:unknown[]):Promise<unknown>}).prepareInitialRequest({row,task:queued},{buildModelInput:async()=>prepared});
  expect(prepare).toHaveBeenCalledTimes(1);
});


test('public native READ and SAVE route held guards only through the exact supplied transaction proof',async()=>{
  const h=serviceHarness();
  await h.service.readSources({...h.fence,sourceRefs:[NATIVE_REF],purpose:'transaction source read',context:'EXACT'});
  await h.service.saveWork({...h.fence,requestId:'held-save',expectedWorkRevision:0,workJson:JSON.stringify(h.command)});
  const calls=h.verifier.assertInTransaction.mock.calls.map(([input])=>input);
  expect(calls.filter(input=>input.runtime!==undefined).length).toBeGreaterThanOrEqual(4);
  for(const input of calls)expect(input.database).toBe(h.database);
  for(const input of calls.filter(input=>input.runtime!==undefined)){
    expect(input.runtime!.principal.scope.principalId).toBe('executor');
    expect(input.runtime!.context).toEqual(h.taskInput.tdmsContext);
  }
});

test('public native READ denies a missing transaction proof capability before journal persistence',async()=>{
  const h=serviceHarness();Reflect.deleteProperty(h.verifier,'assertInTransaction');
  await expect(h.service.readSources({...h.fence,sourceRefs:[NATIVE_REF],purpose:'missing proof',context:'EXACT'}))
    .rejects.toThrow('TDMS_NATIVE_TRANSACTION_AUTHORIZATION_NOT_CONNECTED');
  expect(h.row.reviewActivityJson).toBe('[]');expect(h.history).toHaveLength(0);
});
