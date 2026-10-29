import { sql } from 'drizzle-orm';
import { AilyTaskDomainService } from '../../server/modules/canonical-host/aily-task-domain.service';
import { AilyTrustedTaskContext, type AilyTaskDomainSnapshot } from '../../server/modules/canonical-host/aily-task-domain.types';
import { assertJobAidWorkFence } from '../../server/modules/canonical-host/jobaid-work.repository';
import { canonicalJson } from '../../server/modules/action-attempt/action-attempt-envelope';
import type { AilyExecutorRun } from '../../server/modules/canonical-host/aily-executor-run';
import type { JobAidWorkRevision } from '@shared/jobaid-problem-assessment.interface';
import { AutomaticWorkItemDispatchService } from '../../server/modules/canonical-host/automatic-work-item-dispatch.service';
import { sealTaskEnvelope, sealResultEnvelope } from '../../server/modules/action-attempt/action-attempt-envelope';
import { actionAttempt,workItem } from '../../server/database/schema';
import { McpServer } from '@modelcontextprotocol/server';
import { createHmac } from 'node:crypto';
import { AilyMcpIdentityService } from '../../server/modules/canonical-host/aily-mcp-identity.service';
import { AilyTaskAdmissionService } from '../../server/modules/canonical-host/aily-task-admission';
import { CanonicalHostAilyMcpService } from '../../server/modules/canonical-host/canonical-host-aily-mcp.service';
import { buildJobAidProblemTask,parseJobAidProblemTask } from '../../server/modules/canonical-host/jobaid-problem-task';
import { projectCommonAssessmentContext } from '../../server/modules/canonical-host/canonical-host-common-context.service';
import { buildJobAidChecklistBinding } from '../../server/modules/canonical-host/jobaid-checklist-binding';
import { AILY_TASK_ROLE_MAPPING } from '../../server/modules/canonical-host/aily-executor-run';
import { syntheticAilyEnterpriseConfiguration } from '../support/aily-enterprise-configuration.fixture';
import { successorWorkItem } from '../support/aily-initial-successor.fixture';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';

describe('MCP-only real domain admission',()=>{
  it('rejects all six actual tool handlers at null task admission after valid identity, sealed task and WI reads',async()=>{
    const config=syntheticAilyEnterpriseConfiguration().configuration.mcp;
    const identity=new AilyMcpIdentityService({resolveSubjectMapping:async()=>({id:'synthetic-mapping',revision:1,
      miaodaUserId:'owner',miaodaTenantId:'tenant'})} as never,config);
    const header=Buffer.from(JSON.stringify({alg:'HS256'})).toString('base64url');
    const payload=Buffer.from(JSON.stringify({agent_id:config.agentId,user_id:'synthetic-open-id',tenant_id:'synthetic-tenant-key',exp:4102444800})).toString('base64url');
    const actor=await identity.verify(`${header}.${payload}.${createHmac('sha256',config.signingSecret).update(`${header}.${payload}`).digest('base64url')}`);
    const item=successorWorkItem();const original=originalFixture();
    item.source={documentId:'DOC-test',documentVersionId:original.binding.documentVersionId,sourceArtifactId:original.binding.sourceArtifactId,
      sourceFileSha256:original.binding.sourceSha256,sourceByteLength:original.binding.sourceByteLength,
      parserRequestId:null,driveFileToken:null,driveSourceVersion:null};
    const taskInput=buildJobAidProblemTask({workItem:item,actorUserId:actor.actorUserId,permissionSnapshotVersion:'synthetic-permission',
      purpose:'INITIAL_PROBLEM_ASSESSMENT',sourceCatalog:[],sourceBindings:[{kind:'SOURCE_FILE',workItemId:item.workItemId,
        documentVersionId:item.source.documentVersionId,artifactRef:item.source.sourceArtifactId,artifactSha256:item.source.sourceFileSha256}],
      common:projectCommonAssessmentContext(item,{context:{status:'UNAVAILABLE',reason:'SYNTHETIC'},documentReadingStatus:'AVAILABLE',
        items:[],sections:[],resourceRefs:[]},[]),previousWork:null,expectedWorkRevision:0,priorAssessmentRefs:[]});
    taskInput.executionMode='AILY_AGENT_V1';taskInput.requestedModelRef='aily/deepseek-v4-pro';
    taskInput.checklistBinding=buildJobAidChecklistBinding({workItemId:item.workItemId,documentVersionId:item.source.documentVersionId,
      basedOnWorkItemRevision:item.revision});
    Object.assign(taskInput.modelInput,{executionMode:'AILY_AGENT_V1',checklistBinding:structuredClone(taskInput.checklistBinding),
      executionRoleMapping:structuredClone(AILY_TASK_ROLE_MAPPING),programOriginal:{binding:original.binding,coverage:original.coverage,
        units:original.source.units,sourceLocators:original.source.sourceLocators,findings:original.source.findings}});
    taskInput.modelInput.documentOverview.original={binding:original.binding,coverage:original.coverage,findings:original.source.findings};
    const task=sealTaskEnvelope({schemaVersion:'wiselink.3_1.openclaw_task_envelope.v1',actionAttemptId:'ATT-mcp-only',operationRef:'AQ-mcp-only',
      taskType:'OPENCLAW_DYNAMIC_EVALUATION',priority:100,tenantId:actor.tenantId,workItemId:item.workItemId,inputRevision:item.revision,
      baseRevision:item.revision,documentVersionId:item.source.documentVersionId,sourceRefs:[{ref:item.source.sourceArtifactId,sha256:item.source.sourceFileSha256}],
      allowedConnectors:[],hostResolvedMissingInputs:[],executionModel:{modelRef:'aily/deepseek-v4-pro',displayName:'DeepSeek V4 Pro',
        providerKind:'BUILT_IN',settingsRevision:0,selectedAt:new Date().toISOString()},modelInput:taskInput,
      deadline:'2099-01-01T00:00:00.000Z',idempotencyKey:'synthetic-mcp-only'});
    expect(parseJobAidProblemTask(task)).toEqual(taskInput);
    const row={attemptId:task.actionAttemptId,operationRef:task.operationRef,actorUserId:actor.actorUserId,tenantId:actor.tenantId,
      workItemId:item.workItemId,taskEnvelopeJson:canonicalJson(task),taskInputHash:task.inputHash};
    const repository={readByOperationRef:jest.fn(async()=>row),readAilyExecutorRun:jest.fn(),compareAndSetAilyDomainRun:jest.fn()};
    const registrar={getTenantScopedByWorkItemId:jest.fn(async()=>item)};
    const actors={withActorScope:jest.fn(async(_actor:string,operation:()=>Promise<unknown>)=>operation()),withActorTransaction:jest.fn()};
    const work={listForRuntime:jest.fn(),readAilySave:jest.fn(),recordWorkRead:jest.fn(),recordAilyStage:jest.fn()};
    const jobAid={readSources:jest.fn(),validateWork:jest.fn(),saveWork:jest.fn(),readAttemptWork:jest.fn(),
      projectAilyStage:jest.fn(),finishAily:jest.fn()};
    const dispatch={acknowledgeAilyWorkItem:jest.fn()};const admission=new AilyTaskAdmissionService(null);
    const requireScope=jest.spyOn(admission,'requireScope');
    const domain=new AilyTaskDomainService(identity,actors as never,repository as never,work as never,jobAid as never,
      admission,registrar as never,dispatch as never);
    const service=new CanonicalHostAilyMcpService(identity,domain);
    const handlers=new Map<string,(value:never)=>Promise<unknown>>();
    const register=jest.spyOn(McpServer.prototype,'registerTool').mockImplementation(function(name,_definition,call){
      handlers.set(name,call as never);return {remove:jest.fn(),enable:jest.fn(),disable:jest.fn(),update:jest.fn()} as never;
    });
    try {
      (service as unknown as {server(value:typeof actor):McpServer}).server(actor);
      const selections:Record<string,object>={
        read_assessment_sources:{sourceRefs:['synthetic-source'],purpose:'核来源'},validate_assessment_work:{workJson:'{}'},
        save_assessment_work:{candidateRef:'00000000-0000-4000-8000-000000000001'},read_assessment_work:{workRevisionRef:'JAWR-synthetic'},
        project_assessment_stage_overall:{workRevisionRef:'JAWR-synthetic'},finish_assessment_task:{workRevisionRef:'JAWR-synthetic'}};
      for(const [name,input] of Object.entries(selections))
        expect(await handlers.get(name)!({taskContextRef:task.operationRef,...input} as never)).toMatchObject({isError:true,
          content:[{text:JSON.stringify({code:'INITIAL_CONTINUATION_AILY_NOT_CONFIGURED'})}]});
      expect(repository.readByOperationRef).toHaveBeenCalledTimes(6);expect(registrar.getTenantScopedByWorkItemId).toHaveBeenCalledTimes(6);
      expect(requireScope).toHaveBeenCalledTimes(6);expect(actors.withActorScope).toHaveBeenCalledTimes(6);
      for(const fn of [actors.withActorTransaction,repository.readAilyExecutorRun,repository.compareAndSetAilyDomainRun,
        ...Object.values(work),...Object.values(jobAid),dispatch.acknowledgeAilyWorkItem])expect(fn).not.toHaveBeenCalled();
    } finally {register.mockRestore();}
  });
});

/** Isolates pending recovery only; the real authorization/message binding is
 * exercised by the normal-consumer integration in aily-task-execution.spec. */
function fixture() {
  const candidateRef='00000000-0000-4000-8000-000000000001';
  let run={schemaVersion:'wiselink.aily-executor-run.v1',executor:'AILY_AGENT_V1',requestId:candidateRef,
    agentId:'agent_synthetic',publicationRef:'synthetic',configurationSource:'synthetic',hostSessionId:candidateRef,leaseGeneration:1,
    scope:{tenantId:'tenant',workItemId:'WI',intakeRequestId:'intake',principalId:'service:synthetic'},
    modelEvidence:{selectedModelRef:'aily/deepseek-v4-pro',actualModelRef:null},post:{state:'STARTED',startedAt:new Date().toISOString(),requestBody:'{}'},
    pending:{candidateRef,saveRequestId:'SAVE-original',phase:'VALIDATED',validatedAt:new Date().toISOString(),
      workJson:JSON.stringify({headline:'完整候选',body:'完整正文'.repeat(20000)}),expectedWorkRevision:0,previousWorkRevisionRef:null}} as AilyExecutorRun;
  const row={attemptId:'ATT',operationRef:'AQ',tenantId:'tenant',workItemId:'WI',documentVersionId:'DV',baseRevision:4,
    status:'RUNNING',leaseOwner:'service:synthetic',leaseToken:'original-inner',leaseGeneration:1,
    leaseExpiresAt:new Date('2099-01-01'),deadlineAt:new Date('2099-01-02'),cancelRequestedAt:null,reviewActivityJson:'[]'};
  let saved:JobAidWorkRevision|null=null;
  let onContext:((operation:string)=>Promise<void>)|undefined;
  const snapshot=()=>({row:{...row},run:structuredClone(run),task:{},sealedInput:{},baseline:saved,
    scope:{principalId:row.leaseOwner,tenantId:row.tenantId,workItemId:row.workItemId,automaticWorkItemLease:{requestId:'intake',leaseGeneration:1}},
    writePredicate:sql`true`}) as unknown as AilyTaskDomainSnapshot;
  const repository={compareAndSetAilyDomainRun:jest.fn(async(input:{expected:AilyExecutorRun;next:AilyExecutorRun})=>{
    if(canonicalJson(input.expected)!==canonicalJson(run))return false;run=structuredClone(input.next);return true;
  })};
  const work={readAilySave:jest.fn(async(input:{requestId:string})=>saved?.requestId===input.requestId?saved:null)};
  const jobAid={validateWork:jest.fn(async()=>({status:'VALID'})),saveWork:jest.fn(async(input:{requestId:string;workJson:string;expectedWorkRevision:number})=>{
    const previous=saved;
    saved={workRevisionRef:input.expectedWorkRevision===0?'JAWR-original':`JAWR-${input.expectedWorkRevision+1}`,
      workRevision:input.expectedWorkRevision+1,requestId:input.requestId,actionAttemptId:row.attemptId,
      workItemId:row.workItemId,documentVersionId:row.documentVersionId,basedOnWorkItemRevision:row.baseRevision,
      content:JSON.parse(input.workJson),createdAt:new Date().toISOString(),previousWorkRevisionRef:previous?.workRevisionRef??null} as JobAidWorkRevision;
    return {workRevisionRef:saved.workRevisionRef,workRevision:saved.workRevision};
  }),readAttemptWork:jest.fn(async()=>{
    if(saved)row.reviewActivityJson=canonicalJson([...JSON.parse(row.reviewActivityJson),{kind:'ASSESSMENT_WORK_READ',workRevisionRef:saved.workRevisionRef,
      workRevision:saved.workRevision,saveRequestId:saved.requestId,observedAt:new Date().toISOString()}]);
    return {revision:saved};
  })};
  const actor={actorUserId:'owner',expiresAt:4102444800000};
  const service=new AilyTaskDomainService({assertVerified:jest.fn()} as never,
    {withActorScope:async(_actor:string,operation:()=>Promise<unknown>)=>operation(),
      withActorTransaction:async(_actor:string,operation:(input:unknown)=>Promise<unknown>)=>operation({database:{execute:async()=>[{allowed:true}]}})} as never,
    repository as never,work as never,jobAid as never,{} as never,{} as never,{} as never);
  Object.assign(service,{context:async(_actor:unknown,_ref:string,operation:string)=>{
    await onContext?.(operation);
    if(operation==='WRITE')assertJobAidWorkFence(row as never,{principalId:row.leaseOwner,leaseToken:row.leaseToken,leaseGeneration:1});
    return AilyTrustedTaskContext.authorized(snapshot(),async()=>snapshot());
  }});
  return {service,actor:actor as never,row,repository,work,jobAid,run:()=>run,saved:()=>saved,
    onContext:(hook:(operation:string)=>Promise<void>)=>{onContext=hook;},
    input:{taskContextRef:'AQ',candidateRef}};
}

describe('Aily original pending SAVE recovery',()=>{
  it('does not let a delayed historical READ A replace an already READ B slot',async()=>{
    const h=fixture();await h.service.save(h.actor,h.input);const savedA=h.saved()!;
    let release!:()=>void;let started!:()=>void;
    const paused=new Promise<void>(resolve=>{release=resolve;});const entered=new Promise<void>(resolve=>{started=resolve;});
    const read=h.jobAid.readAttemptWork.getMockImplementation()!;
    h.jobAid.readAttemptWork.mockImplementationOnce(async()=>{const result=await read();started();await paused;return result;});
    const delayed=h.service.read(h.actor,{taskContextRef:'AQ',saveRequestId:'SAVE-original'});await entered;
    await h.service.read(h.actor,{taskContextRef:'AQ',saveRequestId:'SAVE-original'});
    const candidate=await h.service.validate(h.actor,{taskContextRef:'AQ',workJson:'{"headline":"B","body":"B actual content"}'});
    if(!('candidateRef'in candidate))throw new Error('SYNTHETIC_VALIDATION_REQUIRED');
    const saveB=await h.service.save(h.actor,{taskContextRef:'AQ',candidateRef:candidate.candidateRef});
    await h.service.read(h.actor,{taskContextRef:'AQ',saveRequestId:saveB.saveRequestId});
    const pendingB=structuredClone(h.run().pending);const count=h.repository.compareAndSetAilyDomainRun.mock.calls.length;
    release();expect((await delayed).revision).toEqual(savedA);
    expect(h.run().pending).toEqual(pendingB);expect(h.run().pending?.workRevisionRef).toBe('JAWR-2');
    expect(h.repository.compareAndSetAilyDomainRun).toHaveBeenCalledTimes(count);
  });
  it('does not let the old SAVE A refresh switch to B key/payload before B has SAVE_STARTED',async()=>{
    const h=fixture();let calls=0;let release!:()=>void;let started!:()=>void;
    const paused=new Promise<void>(resolve=>{release=resolve;});const entered=new Promise<void>(resolve=>{started=resolve;});
    h.onContext(async operation=>{if(operation==='WRITE'&&++calls===2){started();await paused;}});
    const delayed=h.service.save(h.actor,h.input);await entered;
    await h.service.save(h.actor,h.input);await h.service.read(h.actor,{taskContextRef:'AQ',saveRequestId:'SAVE-original'});
    await h.service.validate(h.actor,{taskContextRef:'AQ',workJson:'{"headline":"B","body":"B actual content"}'});
    const pendingB=structuredClone(h.run().pending);expect(pendingB?.phase).toBe('VALIDATED');
    release();await expect(delayed).rejects.toThrow('AILY_PENDING_SAVE_CHANGED');
    expect(h.jobAid.saveWork).toHaveBeenCalledTimes(1);
    expect(h.jobAid.saveWork.mock.calls[0][0].requestId).toBe('SAVE-original');
    expect(h.run().pending).toEqual(pendingB);
  });
  it('persists original command before SAVE and queries the same key after a lost successful response',async()=>{
    const h=fixture();const save=h.jobAid.saveWork.getMockImplementation()!;
    h.jobAid.saveWork.mockImplementationOnce(async input=>{await save(input);throw new Error('SYNTHETIC_RESPONSE_LOST');});
    await expect(h.service.save(h.actor,h.input)).rejects.toThrow('SYNTHETIC_RESPONSE_LOST');
    expect(h.run().pending?.phase).toBe('SAVE_STARTED');expect(h.saved()).not.toBeNull();
    expect(h.repository.compareAndSetAilyDomainRun.mock.invocationCallOrder[0]).toBeLessThan(h.jobAid.saveWork.mock.invocationCallOrder[0]);
    expect(await h.service.save(h.actor,h.input)).toMatchObject({status:'SAVED',replayed:true,saveRequestId:'SAVE-original'});
    expect(h.jobAid.saveWork).toHaveBeenCalledTimes(1);expect(h.run().pending?.phase).toBe('SAVED');
    const result=await h.service.read(h.actor,{taskContextRef:'AQ',saveRequestId:'SAVE-original'});
    expect((result.revision!.content as unknown as {body:string}).body.length).toBeGreaterThan(60000);
    expect(h.run().pending?.phase).toBe('READ');
    expect(h.run().pending?.readObservedAt).toBeDefined();
  });
  it('does not treat an unsuccessful original-key query as no SAVE and does not change payload or key',async()=>{
    const h=fixture();h.work.readAilySave.mockRejectedValueOnce(new Error('SYNTHETIC_RLS_UNCONFIRMED'));
    await expect(h.service.save(h.actor,h.input)).rejects.toThrow('SYNTHETIC_RLS_UNCONFIRMED');
    expect(h.jobAid.saveWork).not.toHaveBeenCalled();
    await expect(h.service.validate(h.actor,{taskContextRef:'AQ',workJson:'{"different":true}'})).rejects.toThrow('AILY_PENDING_SAVE_UNRESOLVED');
    await expect(h.service.save(h.actor,{...h.input,candidateRef:'00000000-0000-4000-8000-000000000002'})).rejects.toThrow('AILY_CANDIDATE_REFERENCE_INVALID');
    expect(h.run().pending?.saveRequestId).toBe('SAVE-original');
  });
  it.each(['CANCELLED','COMMITTING','TIMED_OUT'])('does not SAVE after Host %s',async status=>{
    const h=fixture();h.row.status=status;
    await expect(h.service.save(h.actor,h.input)).rejects.toThrow();expect(h.jobAid.saveWork).not.toHaveBeenCalled();
  });
  it('does not mark a missing materialized READ as complete or prepare a successor candidate',async()=>{
    const h=fixture();await expect(h.service.read(h.actor,{taskContextRef:'AQ',saveRequestId:'SAVE-original'})).rejects.toThrow('AILY_SAVE_READBACK_UNCONFIRMED');
    expect(h.run().pending?.phase).toBe('VALIDATED');expect(h.repository.compareAndSetAilyDomainRun).not.toHaveBeenCalled();
  });
});

function acknowledgementFixture() {
  const task=sealTaskEnvelope({schemaVersion:'wiselink.3_1.openclaw_task_envelope.v1',actionAttemptId:'ATT-final',operationRef:'AQ-final',
    taskType:'OPENCLAW_DYNAMIC_EVALUATION',priority:1,tenantId:'tenant',workItemId:'WI',inputRevision:4,baseRevision:4,documentVersionId:'DV',
    sourceRefs:[],allowedConnectors:[],hostResolvedMissingInputs:[],modelInput:{executionMode:'AILY_AGENT_V1',automaticWorkItemLease:{requestId:'intake',leaseGeneration:2}},
    executionModel:{modelRef:'aily/deepseek-v4-pro',displayName:'DeepSeek V4 Pro',providerKind:'BUILT_IN',settingsRevision:0,selectedAt:new Date().toISOString()},
    deadline:'2099-01-01T00:00:00.000Z',idempotencyKey:'synthetic-final'});
  const result=sealResultEnvelope({schemaVersion:'wiselink.3_1.openclaw_result_envelope.v1',executionKind:'AILY_AGENT',
    actionAttemptId:task.actionAttemptId,operationRef:task.operationRef,taskType:task.taskType,workItemId:'WI',baseRevision:4,status:'SUCCEEDED',
    businessOutcome:'CANDIDATE_READY',candidateStatus:null,modelOutput:'{"workRevisionRef":"JAWR-final"}',outputArtifactRefs:[],sourceRefs:[],
    factsConsidered:[],missingInputs:[],conflicts:[],warnings:[],modelVersion:null,promptVersion:'synthetic',skillVersion:'wiselink-aily-domain@v1',
    toolVersions:{'model-executor':'AILY_AGENT_V1','wiselink-aily-engineering':'1.0.0'},runMetrics:{durationMs:1,inputUnits:null,outputUnits:null},
    producer:{kind:'AILY_AGENT_V1',agentId:'agent_synthetic',publicationRef:'original-publication',selectedModelRef:'aily/deepseek-v4-pro',actualModelRef:null,usage:null},
    errorCode:null,errorDetail:null});
  const row={...task,attemptId:task.actionAttemptId,tenantId:'tenant',workItemId:'WI',taskEnvelopeJson:canonicalJson(task),
    taskInputHash:task.inputHash,status:'SUCCEEDED',projectionApplied:true,completedAt:new Date(),leaseToken:null,leaseOwner:null,
    resultEnvelopeJson:canonicalJson(result),resultContentHash:result.contentHash};
  const source={documentId:'DOC',documentVersionId:'DV',sourceArtifactId:'source',sourceFileSha256:'a'.repeat(64),sourceByteLength:123};
  const projection={workItemId:'WI',requestId:'intake',revision:5,phase:'CANDIDATE_READBACK_VERIFIED',source,package:{packageId:'PKG'},
    integratedAssessment:{baseRules:{actionAttemptId:row.attemptId},overallSynthesis:{sourceAssessment:{actionAttemptId:row.attemptId},basedOnJobAidWorkRevisionRef:'JAWR-final'}}};
  const owner={workItemId:'WI',tenantId:'tenant',requestedByUserId:'owner',requestId:'intake',revision:5,packageId:'PKG',...source,
    projectionJson:canonicalJson(projection)};
  const grant={...source,requestId:'intake',actorUserId:'owner',leaseGeneration:2,leaseToken:'original-OUTER-token',leaseOwner:'service:synthetic',leaseExpiresAt:new Date('2099-01-01')};
  const snapshot=()=>({row,task,scope:{tenantId:'tenant',workItemId:'WI',principalId:'service:synthetic',appId:'app_17bzc551rsg'},
    sealedInput:{actorUserId:'owner'},run:{agentId:'agent_synthetic',publicationRef:'original-publication',
      modelEvidence:{selectedModelRef:'aily/deepseek-v4-pro'}},writePredicate:sql`true`}) as unknown as AilyTaskDomainSnapshot;
  const context=()=>AilyTrustedTaskContext.authorized(snapshot(),async()=>snapshot());
  const database={execute:jest.fn(async()=>[{allowed:true}]),select:()=>({from:(table:unknown)=>({where:()=>({limit:()=>{
    const rows=table===actionAttempt?[row]:table===workItem?[owner]:[];
    return Object.assign(Promise.resolve(rows),{for:async()=>rows});
  }})})})};
  let completed=false;
  const workItems={loadAutoProcessingProjection:jest.fn(async()=>({row:owner,projection})),loadActiveAutoProcessingLease:jest.fn(async()=>completed?null:{authorization:grant}),
    acknowledgeAutoProcessingLease:jest.fn(async(input:{leaseToken:string;leaseGeneration:number;assertHostFinal:(db:unknown)=>Promise<void>})=>{
      await input.assertHostFinal(database);if(input.leaseToken!==grant.leaseToken||input.leaseGeneration!==grant.leaseGeneration)throw new Error('SYNTHETIC_FENCE_REJECTED');
      completed=true;return {acknowledgedAt:new Date('2026-10-29T00:00:00.000Z'),replayed:false};
    }),readCompletedAilyAutoProcessingReceipt:jest.fn(async(input:{leaseGeneration:number;assertHostFinal:(db:unknown)=>Promise<void>})=>{
      if(!completed||input.leaseGeneration!==grant.leaseGeneration)return null;await input.assertHostFinal(database);
      return {acknowledgedAt:new Date('2026-10-29T00:00:00.000Z'),replayed:true};
    })};
  const status={status:'SUCCEEDED',nextOperation:null,documentVersionId:'DV',workItemRevision:5,
    stages:{applicability:{status:'WAITING_INPUT'},jobAid:{status:'SUCCEEDED'},overall:{status:'SUCCEEDED'}}};
  const authorizeActiveLease=jest.fn(async(input:{leaseToken:string;leaseGeneration:number})=>{
    if(input.leaseToken!==grant.leaseToken||input.leaseGeneration!==grant.leaseGeneration)throw new Error('SYNTHETIC_FENCE_REJECTED');
    return grant;
  });
  const legacyScope={authorizeOpenClawAutoWorkItemQueue:jest.fn(()=>{throw new Error('LEGACY_SCOPE_MUST_NOT_BE_USED');})};
  const service=new AutomaticWorkItemDispatchService(workItems as never,{} as never,legacyScope as never,undefined,
    {authorizeActiveLease} as never,{project:async()=>status} as never);
  return {service,context,row,grant,owner,status,workItems,authorizeActiveLease,legacyScope,database};
}

describe('enterprise final conditional outer ACK',()=>{
  it('reads the original active outer token on FaaS re-entry and never substitutes the inner task token or legacy scope',async()=>{
    const h=acknowledgementFixture();await h.service.acknowledgeAilyWorkItem(h.context());
    expect(h.authorizeActiveLease).toHaveBeenCalledWith(expect.objectContaining({leaseToken:'original-OUTER-token',leaseGeneration:2}));
    expect(h.workItems.acknowledgeAutoProcessingLease).toHaveBeenCalledWith(expect.objectContaining({expectedRequestId:'intake',expectedWorkItemRevision:5}));
    expect(h.legacyScope.authorizeOpenClawAutoWorkItemQueue).not.toHaveBeenCalled();
  });
  it('returns the real next operation after final without ACK or rerunning evaluation',async()=>{
    const h=acknowledgementFixture();h.status.nextOperation='EVALUATE_APPLICABILITY' as never;
    expect(await h.service.acknowledgeAilyWorkItem(h.context())).toMatchObject({status:'NOT_ACKNOWLEDGED',nextOperation:'EVALUATE_APPLICABILITY'});
    expect(h.workItems.acknowledgeAutoProcessingLease).not.toHaveBeenCalled();
  });
  it('recovers a lost successful ACK response by the exact completed generation read only',async()=>{
    const h=acknowledgementFixture();const ack=h.workItems.acknowledgeAutoProcessingLease.getMockImplementation()!;
    h.workItems.acknowledgeAutoProcessingLease.mockImplementationOnce(async input=>{await ack(input);throw new Error('SYNTHETIC_RESPONSE_LOST');});
    await expect(h.service.acknowledgeAilyWorkItem(h.context())).rejects.toThrow('SYNTHETIC_RESPONSE_LOST');
    expect(await h.service.acknowledgeAilyWorkItem(h.context())).toMatchObject({replayed:true});
    expect(h.workItems.acknowledgeAutoProcessingLease).toHaveBeenCalledTimes(1);
    expect(h.workItems.readCompletedAilyAutoProcessingReceipt).toHaveBeenCalledTimes(1);
  });
  it.each(['stage','new-revision','mapping-revoked'])('does not ACK after %s changes its completion proof',async reason=>{
    const h=acknowledgementFixture();if(reason==='stage')h.row.status='RUNNING';
    if(reason==='new-revision')h.owner.revision=6;
    if(reason==='mapping-revoked')h.database.execute.mockResolvedValue([{allowed:false}]);
    await expect(h.service.acknowledgeAilyWorkItem(h.context())).rejects.toThrow();
  });
});
