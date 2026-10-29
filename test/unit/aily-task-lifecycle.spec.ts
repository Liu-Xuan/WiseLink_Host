import { AilyTaskLifecycleService } from '../../server/modules/canonical-host/aily-task-lifecycle.service';
import { AilyTaskAdmissionService, type AilyTaskConfiguration } from '../../server/modules/canonical-host/aily-task-admission';
import { sealTaskEnvelope, canonicalJson } from '../../server/modules/action-attempt/action-attempt-envelope';
import type { AilyExecutorRun } from '../../server/modules/canonical-host/aily-executor-run';
import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import type { AilyHostInvocationIdentity } from '../../server/modules/canonical-host/aily-host-invocation-identity.port';

function fixture() {
  const now=Date.now();const config:AilyTaskConfiguration={enabled:true,tenantId:'tenant',workItemId:'WI',intakeRequestId:'intake',
    agentId:'agent_synthetic',principalId:'service:synthetic',authorizationFingerprint:'synthetic',publicationRef:'new-publication',
    configurationSource:'synthetic',apiAccessVerified:true,trustedToolsVerified:true,modelOptions:[{modelRef:'aily/glm-5.3',platformBuiltIn:true}]};
  const task=sealTaskEnvelope({schemaVersion:'wiselink.3_1.openclaw_task_envelope.v1',actionAttemptId:'ATT',operationRef:'AQ',
    taskType:'OPENCLAW_DYNAMIC_EVALUATION',priority:1,tenantId:'tenant',workItemId:'WI',inputRevision:4,baseRevision:4,
    documentVersionId:'DV',sourceRefs:[{ref:'source',sha256:'a'.repeat(64)}],allowedConnectors:[],hostResolvedMissingInputs:[],
    executionModel:{modelRef:'aily/deepseek-v4-pro',displayName:'DeepSeek V4 Pro',providerKind:'BUILT_IN',settingsRevision:0,selectedAt:new Date(now).toISOString()},
    modelInput:{executionMode:'AILY_AGENT_V1',automaticWorkItemLease:{requestId:'intake',leaseGeneration:2}},
    deadline:new Date(now+3600000).toISOString(),idempotencyKey:'openclaw-v2:dynamic:WI:DV:00000000-0000-4000-8000-000000000001'});
  const row={attemptId:'ATT',operationRef:'AQ',tenantId:'tenant',workItemId:'WI',actorUserId:'owner',
    taskEnvelopeJson:canonicalJson(task),taskInputHash:task.inputHash,status:'RUNNING',leaseToken:'original-inner',leaseOwner:config.principalId,
    leaseGeneration:1,leaseExpiresAt:new Date(now+300000),deadlineAt:new Date(now+3600000),cancelRequestedAt:null as Date|null};
  const run={schemaVersion:'wiselink.aily-executor-run.v1',executor:'AILY_AGENT_V1',requestId:'00000000-0000-4000-8000-000000000001',
    agentId:config.agentId,publicationRef:'original-ds-publication',configurationSource:'synthetic',scope:{tenantId:'tenant',workItemId:'WI',
      intakeRequestId:'intake',principalId:config.principalId},modelEvidence:{selectedModelRef:'aily/deepseek-v4-pro',actualModelRef:null},
    hostSessionId:null,invocation:{purpose:'BACKGROUND',callerAppId:'cli_synthetic',identityRef:'synthetic-app-identity',configurationSource:'synthetic'},
    leaseGeneration:1,post:{state:'ACCEPTED',startedAt:new Date(now).toISOString(),
      acceptedAt:new Date(now).toISOString(),requestBody:'{}',chatId:'1234567890123456789012345678901234567890',remoteSessionId:'remote-original'}} as AilyExecutorRun;
  const projection={workItemId:'WI',requestId:'intake',source:{documentVersionId:'DV',sourceArtifactId:'source',sourceFileSha256:'a'.repeat(64)}} as CanonicalWorkItemProjection;
  const outer={authorization:{requestId:'intake',actorUserId:'owner',leaseGeneration:2,leaseExpiresAt:new Date(now+600000)}};
  const invocation={resolve:jest.fn(async()=>({status:'READY',accessToken:'synthetic-background-token',identityRef:'synthetic-app-identity',
    transport:'APPLICATION',callerAppId:'cli_synthetic',
    tenantId:'tenant',actorUserId:'owner',workItemId:'WI',principalId:config.principalId,agentId:config.agentId}) as AilyHostInvocationIdentity)};
  let allowed=true;
  const heartbeat=jest.fn(async()=>{
    if(!allowed||row.cancelRequestedAt||row.leaseExpiresAt<=new Date()||row.deadlineAt<=new Date()||outer.authorization.leaseExpiresAt<=new Date())
      throw new Error('ACTION_ATTEMPT_HEARTBEAT_FENCE_REJECTED');
    return {leaseExpiresAt:new Date(Date.now()+1800000).toISOString()};
  });
  const client={configured:true,read:jest.fn(async()=>({chatId:'1234567890123456789012345678901234567890',remoteStatus:'Completed'})),create:jest.fn()};
  const observationCas=jest.fn(async(input:{expected:AilyExecutorRun;observation:NonNullable<AilyExecutorRun['observation']>})=>{
    if(canonicalJson({...run,pending:undefined})!==canonicalJson({...input.expected,pending:undefined}))return false;
    run.observation=structuredClone(input.observation);return true;
  });
  const service=new AilyTaskLifecycleService({readByOperationRef:async()=>row,readAilyExecutorRun:async()=>structuredClone(run),
    compareAndSetAilyObservation:observationCas} as never,
    {heartbeat} as never,new AilyTaskAdmissionService(config),{withActorScope:async(_actor:string,operation:()=>Promise<unknown>)=>operation()} as never,
    {loadAutoProcessingProjection:async()=>({row:{requestId:'intake',requestedByUserId:'owner'},projection}),
      loadActiveAutoProcessingLease:async(input:{now:Date})=>outer.authorization.leaseExpiresAt>input.now?outer:null} as never,
    client as never,invocation);
  return {service,row,run,outer,invocation,heartbeat,client,observationCas,revoke:()=>{allowed=false;}};
}

describe('one trusted Aily lifecycle tick',()=>{
  it('keeps an older GET Running response from replacing a newer persisted Completed observation',async()=>{
    const h=fixture();const chatId='1234567890123456789012345678901234567890';
    let entered!:()=>void;let release!:(value:{chatId:string;remoteStatus:string})=>void;
    const waiting=new Promise<void>(resolve=>{entered=resolve;});
    const firstResponse=new Promise<{chatId:string;remoteStatus:string}>(resolve=>{release=resolve;});
    h.client.read.mockImplementationOnce(async()=>{entered();return firstResponse;});
    const earlier=h.service.tick('AQ');
    await Promise.race([waiting,earlier.then(()=>{throw new Error('SYNTHETIC_GET_NOT_STARTED');})]);
    expect(await h.service.tick('AQ')).toMatchObject({observation:{remoteStatus:'Completed'},observationPersisted:true});
    const completed=structuredClone(h.run.observation);
    h.run.pending={candidateRef:'00000000-0000-4000-8000-000000000003',saveRequestId:'SAVE-concurrent',phase:'SAVE_STARTED',
      validatedAt:new Date().toISOString(),workJson:'{}',expectedWorkRevision:1,previousWorkRevisionRef:'JAWR-A'};
    const pending=structuredClone(h.run.pending);release({chatId,remoteStatus:'Running'});
    expect(await earlier).toMatchObject({observation:{remoteStatus:'Running'},observationPersisted:false,
      currentObservation:{remoteStatus:'Completed'}});
    expect(h.run.observation).toEqual(completed);expect(h.run.pending).toEqual(pending);
    expect(h.client.read).toHaveBeenCalledTimes(2);expect(h.observationCas).toHaveBeenCalledTimes(2);
    expect(h.heartbeat).toHaveBeenCalledTimes(2);expect(h.client.create).not.toHaveBeenCalled();
  });
  it('does not obtain an application token, GET or heartbeat for an old browser/UAT run',async()=>{
    const h=fixture();delete h.run.invocation;h.run.hostSessionId='00000000-0000-4000-8000-000000000002';
    const before=canonicalJson(h.run);
    expect(await h.service.tick('AQ')).toMatchObject({status:'UNAVAILABLE',reason:'AILY_ORIGINAL_BROWSER_INVOCATION_REQUIRED'});
    expect(h.invocation.resolve).not.toHaveBeenCalled();expect(h.client.read).not.toHaveBeenCalled();
    expect(h.heartbeat).not.toHaveBeenCalled();expect(h.client.create).not.toHaveBeenCalled();expect(canonicalJson(h.run)).toBe(before);
  });
  it('rejects a changed application caller for a bound background run before GET or renewal',async()=>{
    const h=fixture();h.run.hostSessionId=null;h.run.invocation={purpose:'BACKGROUND',callerAppId:'cli_original',
      identityRef:'original-proof',configurationSource:'synthetic'};
    h.invocation.resolve.mockResolvedValue({status:'READY',accessToken:'synthetic-token',identityRef:'new-proof',callerAppId:'cli_changed',
      tenantId:'tenant',actorUserId:'owner',workItemId:'WI',principalId:'service:synthetic',agentId:'agent_synthetic'});
    await expect(h.service.tick('AQ')).rejects.toThrow('AILY_INVOCATION_CALLER_CHANGED');
    expect(h.client.read).not.toHaveBeenCalled();expect(h.heartbeat).not.toHaveBeenCalled();
  });
  it('heartbeats a still-authorized silent task when its single GET fails, without inventing an observation',async()=>{
    const h=fixture();h.client.read.mockRejectedValue(new Error('synthetic private HTTP failure'));
    expect(await h.service.tick('AQ')).toMatchObject({status:'OBSERVATION_UNCONFIRMED',observation:null,
      observationPersisted:false,errorCode:'AILY_OBSERVATION_UNCONFIRMED'});
    expect(h.client.read).toHaveBeenCalledTimes(1);expect(h.heartbeat).toHaveBeenCalledTimes(1);
    expect(h.observationCas).not.toHaveBeenCalled();expect(h.client.create).not.toHaveBeenCalled();
  });
  it('does not renew after GET failure and a concurrent revocation',async()=>{
    const h=fixture();h.client.read.mockImplementationOnce(async()=>{h.revoke();throw new Error('HTTP failed');});
    await expect(h.service.tick('AQ')).rejects.toThrow('ACTION_ATTEMPT_HEARTBEAT_FENCE_REJECTED');
    expect(h.observationCas).not.toHaveBeenCalled();expect(h.client.create).not.toHaveBeenCalled();
  });
  it('reports one observation CAS miss without retrying or pretending the snapshot was persisted',async()=>{
    const h=fixture();h.observationCas.mockResolvedValue(false);
    expect(await h.service.tick('AQ')).toMatchObject({status:'OBSERVED',observationPersisted:false});
    expect(h.observationCas).toHaveBeenCalledTimes(1);expect(h.client.read).toHaveBeenCalledTimes(1);
  });
  it('uses background identity independently of browser sessions and only observes the exact original chat',async()=>{
    const h=fixture();const before=canonicalJson({...h.run,observation:undefined});
    expect(await h.service.tick('AQ')).toMatchObject({status:'OBSERVED',hostStatus:'RUNNING',observation:{remoteStatus:'Completed'},
      effectiveWriteExpiresAt:h.outer.authorization.leaseExpiresAt.toISOString()});
    expect(h.invocation.resolve).toHaveBeenCalledWith(expect.objectContaining({purpose:'BACKGROUND',actorUserId:'owner'}));
    expect(h.client.read).toHaveBeenCalledWith({agentId:'agent_synthetic',accessToken:'synthetic-background-token',
      chatId:'1234567890123456789012345678901234567890',remoteSessionId:'remote-original'});
    await h.service.tick('AQ');expect(h.client.create).not.toHaveBeenCalled();
    expect(h.heartbeat).toHaveBeenCalledTimes(2);expect(canonicalJson({...h.run,observation:undefined})).toBe(before);
  });
  it('reports unavailable formal identity without a browser grant fallback',async()=>{
    const h=fixture();h.invocation.resolve.mockResolvedValue({status:'UNAVAILABLE',reason:'AILY_BACKGROUND_IDENTITY_NOT_CONFIGURED'});
    expect(await h.service.tick('AQ')).toEqual({status:'UNAVAILABLE',reason:'AILY_BACKGROUND_IDENTITY_NOT_CONFIGURED'});
    expect(h.client.read).not.toHaveBeenCalled();expect(h.heartbeat).not.toHaveBeenCalled();
  });
  it.each(['cancel','deadline','inner','outer'])('does not renew after original %s expiry/cancellation',async reason=>{
    const h=fixture();if(reason==='cancel')h.row.cancelRequestedAt=new Date();
    if(reason==='deadline')h.row.deadlineAt=new Date(0);if(reason==='inner')h.row.leaseExpiresAt=new Date(0);
    if(reason==='outer')h.outer.authorization.leaseExpiresAt=new Date(0);
    const result=await h.service.tick('AQ');
    expect(result.status).toBe(reason==='cancel'?'CANCELLED':'EXPIRED_OR_UNAUTHORIZED');
    expect(h.client.read).not.toHaveBeenCalled();expect(h.heartbeat).not.toHaveBeenCalled();expect(h.client.create).not.toHaveBeenCalled();
  });
  it('keeps a late cancellation/revocation during GET fenced before heartbeat',async()=>{
    const h=fixture();h.client.read.mockImplementationOnce(async()=>{h.revoke();return {chatId:'1234567890123456789012345678901234567890',remoteStatus:'Running'};});
    await expect(h.service.tick('AQ')).rejects.toThrow('ACTION_ATTEMPT_HEARTBEAT_FENCE_REJECTED');expect(h.client.create).not.toHaveBeenCalled();
  });
  it('retains original UNKNOWN without guessing a GET or repeating POST',async()=>{
    const h=fixture();h.run.post={state:'UNKNOWN',startedAt:h.run.post.startedAt,requestBody:h.run.post.requestBody,
      observedAt:new Date().toISOString(),errorCode:'AILY_POST_RESULT_UNCONFIRMED'};
    expect(await h.service.tick('AQ')).toMatchObject({status:'OBSERVED',observation:null});
    expect(h.client.read).not.toHaveBeenCalled();expect(h.client.create).not.toHaveBeenCalled();
  });
});
