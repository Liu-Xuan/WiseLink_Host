import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import { actionAttempt, workItem } from '../../server/database/schema';
import { autoWorkItemAuthorization } from '../../server/database/auto-work-item-authorization.schema';
import { dmDocumentParseRun } from '../../server/database/document-parsing.schema';
import { canonicalJson, sealTaskEnvelope, sealResultEnvelope } from '../../server/modules/action-attempt/action-attempt-envelope';
import type { ActionAttemptRow } from '../../server/modules/action-attempt/action-attempt.types';
import { buildInitialAnalysisRequestInput } from '../../server/modules/action-attempt/initial-analysis-request';
import { MiaodaWorkItemRepository } from '../../server/modules/work-item/miaoda-work-item.repository';
import { AutomaticWorkItemDispatchService } from '../../server/modules/canonical-host/automatic-work-item-dispatch.service';
import { AilyTaskAdmissionService, type AilyTaskConfiguration } from '../../server/modules/canonical-host/aily-task-admission';

const dialect=new PgDialect();
const OLD_MODEL={modelRef:'miaoda/glm-5.3',displayName:'GLM-5.3',providerKind:'BUILT_IN' as const,
  settingsRevision:1,selectedAt:'2026-10-01T00:00:00.000Z'};
const stageRequestId='00000000-0000-4000-8000-000000000901';
type Owner=typeof workItem.$inferSelect;
type Grant=typeof autoWorkItemAuthorization.$inferSelect;
type WorkItemAttempt=ActionAttemptRow & {subjectKind:'WORK_ITEM'};

export function successorWorkItem():CanonicalWorkItemProjection {
  return {schemaVersion:'wiselink.3_1.canonical_work_item_projection.v0.candidate',workItemId:'WI-successor',requestId:'intake-successor',
    revision:3,phase:'CANDIDATE_READBACK_VERIFIED',permissionSnapshotVersion:'permission-test',
    parseAuthorization:{action:'PARSE_PDF',actorFingerprint:`sha256:${'1'.repeat(64)}`,decisionId:'synthetic-parse-decision',
      decisionHash:`sha256:${'2'.repeat(64)}`,permissionSnapshotVersion:'permission-test'},
    classification:{normalizedFamily:'SB',status:'CONFIRMED',classifierReleaseId:'synthetic-classifier',
      classifierReleaseHash:`sha256:${'3'.repeat(64)}`,parserProfileId:'synthetic-parser',parserProfileHash:`sha256:${'4'.repeat(64)}`,
      fingerprint:`sha256:${'5'.repeat(64)}`},source:{documentId:'DOC-successor',documentVersionId:'DV-successor',
      parserRequestId:'synthetic-parser-request',driveFileToken:null,driveSourceVersion:null,
      sourceArtifactId:'ART-successor',sourceFileSha256:'a'.repeat(64),sourceByteLength:1000},
    package:{packageId:'PKG-successor',title:'Synthetic original',artifact:{ref:'artifact://synthetic-package',sha256:'b'.repeat(64),
      byteLength:12,mediaType:'application/json',storeRole:'UnifiedArtifactStoreCandidate'},contractId:'techpub.parsed-package.v1',contractRevision:'frozen.2',
      contentHash:`sha256:${'6'.repeat(64)}`,semanticHash:`sha256:${'7'.repeat(64)}`,provenanceHash:`sha256:${'8'.repeat(64)}`,
      coverageHash:`sha256:${'9'.repeat(64)}`,resultStatus:'complete',contentUnitCount:1,sourceRefCount:1,readerReceiptId:'synthetic-reader-receipt',
      fullValidatorProof:{validatorId:'U0Frozen2SchemaSemanticValidator',validatorRevision:'synthetic-not-executed',
        contractCommit:'fa69ada08265934951df53c7a61a3ccdb8cb2900',artifactSha256:'b'.repeat(64)}},
    integratedAssessment:null,failure:null,recordingFailure:null};
}

/** Valid synthetic legacy control/result shapes. Metrics are fabricated test
 * data, not a repair or a claim about the original persisted run's usage. */
export function closedLegacySuccessorAttempt(item:CanonicalWorkItemProjection,actor:string,status:'TIMED_OUT'|'FAILED',ordinal=1):WorkItemAttempt {
  const deadline=new Date(Date.now()-3_600_000);const completed=new Date(deadline.getTime()+1000);
  const requestId=`00000000-0000-4000-8000-${String(ordinal).padStart(12,'0')}`;
  const task=sealTaskEnvelope({schemaVersion:'wiselink.3_1.openclaw_task_envelope.v1',actionAttemptId:`ATT-legacy-${ordinal}`,
    operationRef:`AQ-legacy-${ordinal}`,taskType:'OPENCLAW_DYNAMIC_EVALUATION',priority:100,tenantId:'tenant-test',
    workItemId:item.workItemId,inputRevision:item.revision,baseRevision:item.revision,documentVersionId:item.source.documentVersionId,
    sourceRefs:[{ref:item.source.sourceArtifactId,sha256:item.source.sourceFileSha256.replace(/^sha256:/u,'')}],
    allowedConnectors:[],hostResolvedMissingInputs:[],executionModel:OLD_MODEL,
    modelInput:{schemaVersion:'wiselink.jobaid-problem-task.v2',executionMode:'PROGRAM_AGENT_V1',requestedModelRef:OLD_MODEL.modelRef,
      actorUserId:actor,sourceBindings:[{kind:'SOURCE_FILE',workItemId:item.workItemId,documentVersionId:item.source.documentVersionId,
        artifactRef:item.source.sourceArtifactId,artifactSha256:item.source.sourceFileSha256}],
      automaticWorkItemLease:{requestId:item.requestId,leaseGeneration:ordinal},modelInput:{purpose:'INITIAL_PROBLEM_ASSESSMENT'}},
    deadline:deadline.toISOString(),idempotencyKey:`openclaw-v2:dynamic:${item.workItemId}:${item.source.documentVersionId}:${requestId}`});
  const reason=status==='TIMED_OUT'?'ACTION_ATTEMPT_DEADLINE_EXCEEDED':'SYNTHETIC_LEGACY_FAILED';
  const result=status==='FAILED'?sealResultEnvelope({schemaVersion:'wiselink.3_1.openclaw_result_envelope.v1',
    actionAttemptId:task.actionAttemptId,operationRef:task.operationRef,taskType:task.taskType,workItemId:item.workItemId,
    baseRevision:item.revision,status:'FAILED',businessOutcome:'NOT_PRODUCED',candidateStatus:null,modelOutput:null,
    outputArtifactRefs:[],sourceRefs:task.sourceRefs,factsConsidered:[],missingInputs:[],conflicts:[],warnings:[],
    modelVersion:OLD_MODEL.modelRef,promptVersion:'synthetic',skillVersion:'synthetic',toolVersions:{},
    runMetrics:{durationMs:1,inputUnits:17,outputUnits:23},errorCode:reason,errorDetail:null}):null;
  return {attemptId:task.actionAttemptId,operationRef:task.operationRef,subjectKind:'WORK_ITEM',workItemId:item.workItemId,
    tenantId:task.tenantId,actionType:task.taskType,attemptNo:ordinal,triggerRequestId:`REQ-legacy-${ordinal}`,requestOrigin:'OPENCLAW_MCP_V1',
    priority:task.priority,maxAttempts:3,nextAttemptAt:null,executorSessionKey:`g2-action-attempt:${task.operationRef}`,
    actorUserId:'service:openclaw-main',inputRevision:item.revision,baseRevision:item.revision,documentVersionId:item.source.documentVersionId,
    status,taskEnvelopeJson:canonicalJson(task),taskInputHash:task.inputHash,executionModelJson:canonicalJson(OLD_MODEL),
    idempotencyKey:task.idempotencyKey,claimCount:1,retryCount:0,leaseGeneration:ordinal,leaseOwner:null,leaseToken:null,leaseExpiresAt:null,
    leaseSlot:null,startedAt:new Date(deadline.getTime()-5000),lastHeartbeatAt:new Date(deadline.getTime()-3000),
    completedAt:completed,commitStartedAt:null,cancelRequestedAt:null,cancelReason:null,projectionApplied:false,
    resultEnvelopeJson:result?canonicalJson(result):null,resultContentHash:result?.contentHash??null,terminalReason:reason,
    reviewActivityJson:'[]',createdAt:new Date(deadline.getTime()-10000),updatedAt:completed,deadlineAt:deadline};
}

export function ailyInitialSuccessorFixture(options:{workItem?:CanonicalWorkItemProjection;actorUserId?:string;
  getQueued?:()=>ActionAttemptRow|null;storeQueued?:(row:ActionAttemptRow)=>void;
  parseRunId?:string;principalId?:string;grant?:Grant;stageRequestId?:string;initialAilySessionId?:string}={}) {
  const item=options.workItem??successorWorkItem();const actor=options.actorUserId??'owner-test';
  const principal=options.principalId??'service:aily-synthetic';const parseRunId=options.parseRunId??'PR-synthetic';
  const requestId=options.stageRequestId??stageRequestId;
  const model={modelRef:'aily/deepseek-v4-pro',displayName:'DeepSeek V4 Pro',providerKind:'BUILT_IN' as const,settingsRevision:0,selectedAt:new Date().toISOString()};
  const task=sealTaskEnvelope({schemaVersion:'wiselink.3_1.openclaw_task_envelope.v1',actionAttemptId:'ATT-new-successor',operationRef:'AQ-new-successor',
    taskType:'OPENCLAW_DYNAMIC_EVALUATION',priority:100,tenantId:'tenant-test',workItemId:item.workItemId,inputRevision:item.revision,
    baseRevision:item.revision,documentVersionId:item.source.documentVersionId,sourceRefs:[{ref:item.source.sourceArtifactId,
      sha256:item.source.sourceFileSha256.replace(/^sha256:/u,'')}],allowedConnectors:[],hostResolvedMissingInputs:[],executionModel:model,
    modelInput:buildInitialAnalysisRequestInput({taskType:'OPENCLAW_DYNAMIC_EVALUATION',requestId,originalParseRunId:parseRunId,
      executionMode:'AILY_AGENT_V1',modelRef:model.modelRef}),deadline:new Date(Date.now()+3_600_000).toISOString(),
    idempotencyKey:`openclaw-v2:dynamic:${item.workItemId}:${item.source.documentVersionId}:${requestId}`});
  const queued:WorkItemAttempt={attemptId:task.actionAttemptId,operationRef:task.operationRef,tenantId:task.tenantId,workItemId:item.workItemId,
    subjectKind:'WORK_ITEM',actorUserId:actor,actionType:task.taskType,attemptNo:3,triggerRequestId:'REQ-new-successor',requestOrigin:'OPENCLAW_MCP_V1',
    priority:task.priority,maxAttempts:3,nextAttemptAt:null,
    status:'QUEUED',baseRevision:item.revision,inputRevision:item.revision,documentVersionId:item.source.documentVersionId,
    taskEnvelopeJson:canonicalJson(task),taskInputHash:task.inputHash,executionModelJson:canonicalJson(model),idempotencyKey:task.idempotencyKey,
    claimCount:0,retryCount:0,leaseGeneration:0,leaseOwner:null,leaseToken:null,leaseExpiresAt:null,leaseSlot:null,startedAt:null,lastHeartbeatAt:null,
    completedAt:null,commitStartedAt:null,projectionApplied:false,resultEnvelopeJson:null,resultContentHash:null,cancelRequestedAt:null,cancelReason:null,
    executorSessionKey:null,terminalReason:null,deadlineAt:new Date(task.deadline),createdAt:new Date(),updatedAt:new Date(),reviewActivityJson:'[]'};
  const getQueued=options.getQueued??(()=>queued);
  const owner:Owner={id:'00000000-0000-4000-8000-000000000905',tenantId:'tenant-test',workItemId:item.workItemId,requestId:item.requestId,requestedByUserId:actor,revision:item.revision,
    ...item.source,sourceFileSha256:item.source.sourceFileSha256.replace(/^sha256:/u,''),sourceByteLength:item.source.sourceByteLength,
    actionType:'PARSE_PDF',status:'CANDIDATE_READBACK_VERIFIED',packageId:item.package!.packageId,
    packageArtifactRef:item.package!.artifact.ref,packageArtifactSha256:item.package!.artifact.sha256,projectionJson:canonicalJson(item),
    initialAilySessionId:options.initialAilySessionId??null,analysisModelJson:canonicalJson(OLD_MODEL),normalizedFamily:item.classification.normalizedFamily,
    failureCode:null,failureArtifactRef:null,failureArtifactSha256:null,runKey:'canonical',
    createdAt:new Date(),updatedAt:new Date(),createdBy:null,updatedBy:null};
  const grant:Grant=options.grant??{tenantId:owner.tenantId,workItemId:owner.workItemId,requestId:owner.requestId,actorUserId:actor,documentId:owner.documentId,
    documentVersionId:owner.documentVersionId,sourceArtifactId:owner.sourceArtifactId,sourceFileSha256:owner.sourceFileSha256,sourceByteLength:owner.sourceByteLength,
    grantKind:'MIAODA_CANONICAL_PARSE_REQUEST',status:'LEASED',leaseOwner:'service:legacy-synthetic',
    leaseToken:'00000000-0000-4000-8000-000000000802',leaseGeneration:2,leaseExpiresAt:new Date(Date.now()-60_000),
    completedAt:null,completedLeaseGeneration:null,completedLeaseTokenHash:null,blockedAt:null,blockedCode:null,
    blockedLeaseGeneration:null,blockedLeaseTokenHash:null,createdAt:new Date(Date.now()-7_200_000),updatedAt:new Date(Date.now()-3_600_000)};
  const history=[closedLegacySuccessorAttempt(item,actor,'FAILED',1),closedLegacySuccessorAttempt(item,actor,'TIMED_OUT',2)];
  const state:{covered:boolean;hasSavedWork:boolean;clock:Date;databaseClock:Date|string|number|null|undefined;
    sourceCurrent:boolean;run:unknown;publishedParseRunId:string}={covered:true,hasSavedWork:false,clock:new Date(),
      databaseClock:undefined,sourceCurrent:true,run:null,publishedParseRunId:parseRunId};
  const locks:string[]=[];const statements:Array<{kind:string;sql:string;params:unknown[]}>=[];
  const changesApplied:Array<Record<string,unknown>>=[];
  let onLock:(table:unknown)=>void=()=>undefined;let snapshot:typeof grant|null=null;let tail=Promise.resolve();
  const database={transaction:jest.fn(),select:(selection?:unknown)=>({from:(table:unknown)=>{
    let joined=false;let condition:SQL|undefined;let limit:number|undefined;
    const values=():unknown[]=>{
      if(table===workItem)return [selection&&typeof selection==='object'&&'row'in selection
        ?{row:structuredClone(owner),projectionJson:owner.projectionJson}:selection&&typeof selection==='object'&&'id'in selection
          ?{...structuredClone(owner),id:owner.workItemId}:structuredClone(owner)];
      if(table===dmDocumentParseRun)return [{id:state.publishedParseRunId}];
      if(table===autoWorkItemAuthorization) {
        if(!joined)return [structuredClone(grant)];
        const query=condition?dialect.sqlToQuery(condition):{sql:'',params:[]};
        if(query.params.includes(principal)) {
          if(grant.status!=='LEASED'||grant.leaseOwner!==principal||!grant.leaseExpiresAt||grant.leaseExpiresAt<=new Date())return [];
        } else if(grant.status!=='WAITING'&&!(grant.status==='LEASED'&&grant.leaseExpiresAt&&grant.leaseExpiresAt<new Date()))return [];
        return [{authorization:structuredClone(grant),workItem:structuredClone(owner)}];
      }
      if(table===actionAttempt) {
        const rows=[...history,...(getQueued()?[getQueued()!]:[])];const query=condition?dialect.sqlToQuery(condition):{sql:'',params:[]};
        const exact=rows.filter(row=>query.params.includes(row.attemptId));
        let result=exact.length?exact:rows;
        if(query.sql.includes('"idempotency_key" ='))result=result.filter(row=>query.params.includes(row.idempotencyKey));
        if(query.sql.includes("'{modelInput,executionMode}'='AILY_AGENT_V1'"))
          result=result.filter(row=>JSON.parse(row.taskEnvelopeJson).modelInput.executionMode==='AILY_AGENT_V1');
        const statuses=['QUEUED','RUNNING','RETRY_SCHEDULED','COMMITTING'].filter(status=>query.params.includes(status));
        if(statuses.length)result=result.filter(row=>statuses.includes(row.status));
        if(limit!==undefined)result=result.slice(0,limit);
        return result.map(row=>({...structuredClone(row),hasPersistedResult:row.resultEnvelopeJson!==null||row.resultContentHash!==null}));
      }
      throw new Error('UNEXPECTED_SYNTHETIC_TABLE');
    };
    const chain={where:(value:SQL|undefined)=>{condition=value;if(value){const query=dialect.sqlToQuery(value);statements.push({kind:'SELECT',...query});}return chain;},
      limit:(count:number)=>{limit=count;return chain;},orderBy:()=>chain,innerJoin:()=>{joined=true;return chain;},
      for:async()=>{locks.push(table===workItem?'WI':table===autoWorkItemAuthorization?'GRANT':'ATTEMPT');onLock(table);return values();},
      then:<T>(resolve:(rows:unknown[])=>T)=>Promise.resolve(values()).then(resolve)};
    void selection;return chain;
  }}),execute:jest.fn(async(statement:SQL)=>{
    const query=dialect.sqlToQuery(statement);statements.push({kind:'EXECUTE',...query});
    if(query.sql.includes('clock_timestamp() AS now'))return [{now:state.databaseClock===undefined?new Date(state.clock.getTime()):state.databaseClock}];
    if(query.sql.includes('executor_run_json AS value'))return [{value:state.run}];
    if(query.sql.includes('AS "hasSavedWork"'))return [{covered:state.covered,hasSavedWork:state.hasSavedWork}];
    if(query.sql.includes('AS covered'))return [{covered:state.covered,saved:state.hasSavedWork?[{workRevisionRef:'JAWR-unknown',workRevision:1,saveRequestId:'SAVE-unknown'}]:[],otherActive:true}];
    throw new Error('UNEXPECTED_SYNTHETIC_SQL');
  }),insert:(table:unknown)=>({values:(value:typeof actionAttempt.$inferInsert)=>({onConflictDoNothing:()=>({returning:async()=>{
    if(table!==actionAttempt||!options.storeQueued)throw new Error('UNEXPECTED_SYNTHETIC_INSERT');
    if(getQueued())return [];
    if(typeof value.workItemId!=='string'||!value.workItemId)throw new Error('SYNTHETIC_WORK_ITEM_BINDING_REQUIRED');
    const stored:WorkItemAttempt={...value,workItemId:value.workItemId,subjectKind:'WORK_ITEM',
      attemptNo:value.attemptNo??1,status:value.status??'pending',operationRef:value.operationRef??null,
      priority:value.priority??100,maxAttempts:value.maxAttempts??3,nextAttemptAt:value.nextAttemptAt??null,
      inputRevision:value.inputRevision??null,baseRevision:value.baseRevision??null,documentVersionId:value.documentVersionId??null,
      taskEnvelopeJson:value.taskEnvelopeJson??null,taskInputHash:value.taskInputHash??null,idempotencyKey:value.idempotencyKey??null,
      deadlineAt:value.deadlineAt??null,createdAt:value.createdAt??new Date(),updatedAt:value.updatedAt??new Date(),
      claimCount:0,retryCount:0,leaseGeneration:0,leaseOwner:null,leaseToken:null,
      leaseExpiresAt:null,leaseSlot:null,startedAt:null,lastHeartbeatAt:null,cancelRequestedAt:null,cancelReason:null,
      commitStartedAt:null,resultEnvelopeJson:null,resultContentHash:null,projectionApplied:false,executorSessionKey:null,
      completedAt:null,terminalReason:null,reviewActivityJson:'[]'};
    statements.push({kind:'INSERT',sql:'action_attempt',params:[stored.attemptId,stored.idempotencyKey]});
    options.storeQueued(stored);return [{attemptId:stored.attemptId}];
  }})})}),update:(table:unknown)=>({set:(changes:Record<string,unknown>)=>({where:(condition:SQL)=>({returning:async()=>{
    if(table!==autoWorkItemAuthorization)throw new Error('OLD_ATTEMPT_MUST_NOT_BE_WRITTEN');
    const query=dialect.sqlToQuery(condition);statements.push({kind:'UPDATE',...query});changesApplied.push(changes);const current=getQueued();
    if(query.sql.includes('executor_run_json IS NULL')) {
      if(!current||current.status!=='QUEUED'||!current.deadlineAt||current.deadlineAt<=state.clock||state.run!==null||
          grant.status!=='LEASED'||!grant.leaseExpiresAt||grant.leaseExpiresAt>state.clock||
          !query.params.includes(grant.leaseGeneration)||!query.params.includes(grant.leaseToken)||
          !query.params.includes(owner.projectionJson)||owner.revision!==item.revision||owner.requestedByUserId!==actor||
          owner.sourceArtifactId!==item.source.sourceArtifactId||state.publishedParseRunId!==parseRunId||
          history.some(row=>['QUEUED','RUNNING','RETRY_SCHEDULED','COMMITTING'].includes(row.status)))return [];
    } else if(grant.status!=='WAITING'||grant.leaseGeneration!==0)return [];
    snapshot=structuredClone(grant);
    grant.status='LEASED';grant.leaseOwner=changes.leaseOwner as string;grant.leaseToken=changes.leaseToken as string;
    grant.leaseGeneration+=1;grant.leaseExpiresAt=new Date(state.clock.getTime()+3_600_000);grant.updatedAt=new Date(state.clock.getTime());
    return [{leaseGeneration:grant.leaseGeneration,leaseToken:grant.leaseToken}];
  },then:<T>(resolve:(value:void)=>T)=>{
    if(table!==workItem||Object.keys(changes).some(key=>!['initialAilySessionId','updatedAt'].includes(key)))
      throw new Error('UNEXPECTED_SYNTHETIC_WORK_ITEM_UPDATE');
    statements.push({kind:'WI_KNOWLEDGE_UPDATE',...dialect.sqlToQuery(condition)});
    Object.assign(owner,changes);return Promise.resolve().then(resolve);
  }})})})};
  database.transaction.mockImplementation(async(operation:(db:typeof database)=>Promise<unknown>)=>{
    const previous=tail;let release!:()=>void;tail=new Promise<void>(resolve=>{release=resolve;});await previous;snapshot=null;
    try{return await operation(database);}catch(error){if(snapshot)Object.assign(grant,snapshot);throw error;}finally{release();}
  });
  const repository=new MiaodaWorkItemRepository(database as never);
  const config:AilyTaskConfiguration={enabled:true,tenantId:owner.tenantId,workItemId:owner.workItemId,intakeRequestId:owner.requestId,
    agentId:'agent_synthetic',principalId:principal,authorizationFingerprint:'synthetic-scope',publicationRef:'synthetic-publication',
    configurationSource:'synthetic',apiAccessVerified:true,trustedToolsVerified:true,modelOptions:[{modelRef:'aily/deepseek-v4-pro',platformBuiltIn:true}]};
  const sourceValue={version:{documentId:owner.documentId,documentVersionId:owner.documentVersionId,sourceArtifactId:owner.sourceArtifactId,
    pdfSha256:owner.sourceFileSha256,byteLength:owner.sourceByteLength},artifact:{sourceArtifactId:owner.sourceArtifactId,
    sha256:owner.sourceFileSha256,byteLength:owner.sourceByteLength}};
  const source={resolve:jest.fn(async()=>{if(!state.sourceCurrent)throw new Error('DOCUMENT_VERSION_NOT_CURRENT');return sourceValue;})};
  const sourceAuthorization={authorizeSourceRead:jest.fn(async()=>({allowed:true,action:'DOCUMENT_READ',authorizationPolicy:'MIAODA_HOST_DOCUMENT_READ',
    tenantId:owner.tenantId,actorUserId:actor,documentId:owner.documentId,documentVersionId:owner.documentVersionId,
    sourceArtifactId:owner.sourceArtifactId,sourceFileSha256:owner.sourceFileSha256,sourceByteLength:Number(owner.sourceByteLength)}))};
  const leaseAuthorization={authorizeActiveLease:jest.fn(async(input:{principalId:string;leaseToken:string;leaseGeneration:number})=>{
    if(grant.status!=='LEASED'||grant.leaseOwner!==input.principalId||grant.leaseToken!==input.leaseToken||
        grant.leaseGeneration!==input.leaseGeneration||!grant.leaseExpiresAt||grant.leaseExpiresAt<=new Date())throw new Error('SYNTHETIC_ACTIVE_LEASE_REJECTED');
    return {...grant,principalId:grant.leaseOwner,leaseExpiresAt:grant.leaseExpiresAt.toISOString(),sourceByteLength:Number(grant.sourceByteLength)};
  })};
  const automatic=new AutomaticWorkItemDispatchService(repository,source as never,{} as never,sourceAuthorization as never,leaseAuthorization as never,
    undefined,undefined,undefined,undefined,undefined,undefined,undefined,new AilyTaskAdmissionService(config));
  const authorize=jest.fn(async(_database:unknown,_owners:readonly Owner[])=>undefined);
  const authorization=()=>repository.authorizeAilyInitialSuccessor({tenantId:owner.tenantId,actorUserId:actor,workItem:item,
    request:getQueued()!,stageRequestId:requestId,
    principalId:principal,leaseToken:'00000000-0000-4000-8000-000000000803',leaseMs:3_600_000,authorize});
  return {item,owner,grant,queued,history,state,database,repository,automatic,config,source,sourceValue,sourceAuthorization,leaseAuthorization,
    authorize,authorization,getQueued,stageRequestId:requestId,locks,statements,changesApplied,setOnLock:(callback:(table:unknown)=>void)=>{onLock=callback;}};
}
