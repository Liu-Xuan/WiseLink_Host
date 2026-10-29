import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { CanonicalJobAidProblemService } from '../../server/modules/canonical-host/canonical-jobaid-problem.service';
import { AilyTrustedTaskContext, type AilyTaskDomainSnapshot } from '../../server/modules/canonical-host/aily-task-domain.types';
import { canonicalJson } from '../../server/modules/action-attempt/action-attempt-envelope';
import { JOBAID_METHOD_BINDING } from '../../server/modules/canonical-host/jobaid-method-pack';
import { JOBAID_PROBLEM_WORK_SCHEMA, type AilyStageOverallReceipt, type JobAidWorkRevision } from '@shared/jobaid-problem-assessment.interface';
import { ailyStageOveralls } from '../../server/modules/canonical-host/program-controlled-assessment';
import { projectJobAidActivity } from '../../server/modules/canonical-host/jobaid-activity';

function fixture() {
  const revision:JobAidWorkRevision={workRevisionRef:'JAWR-A',workRevision:1,requestId:'SAVE-A',actionAttemptId:'ATT',
    workItemId:'WI',documentVersionId:'DV',basedOnWorkItemRevision:4,previousWorkRevisionRef:null,createdAt:new Date().toISOString(),
    content:{schemaVersion:JOBAID_PROBLEM_WORK_SCHEMA,headline:'合成阶段成果',listBrief:'保留当前认识',understanding:'完整保存正文',
      overviewStatus:'CURRENT',issues:[],decisiveIssueKeys:[],roundCompletion:'COMPLETE',completionReason:'候选本轮已完成',
      changeSummary:'合成',unchangedExplanation:'',methodBinding:structuredClone(JOBAID_METHOD_BINDING),evidence:[],readSourceRefs:[],capabilities:[],
      historyReview:{required:false,priorAssessmentRefs:[],engineeringDocumentRefs:[],coverage:'NOT_REQUIRED',limitation:null}}};
  const row={attemptId:'ATT',operationRef:'AQ',workItemId:'WI',tenantId:'tenant',documentVersionId:'DV',baseRevision:4,
    status:'RUNNING',leaseToken:'original-inner',leaseGeneration:1,startedAt:new Date(Date.now()-1000),
    reviewActivityJson:canonicalJson([{kind:'ASSESSMENT_WORK_READ',workRevisionRef:'JAWR-A',workRevision:1,saveRequestId:'SAVE-A',observedAt:'2026-10-29T00:00:00.000Z'}])};
  const snapshot=()=>({row:{...row},task:{actionAttemptId:'ATT',operationRef:'AQ',taskType:'OPENCLAW_DYNAMIC_EVALUATION',
    workItemId:'WI',baseRevision:4,sourceRefs:[]},sealedInput:{actorUserId:'owner',sourceBindings:[]},
    scope:{principalId:'service:synthetic',tenantId:'tenant',workItemId:'WI',attemptRef:'AQ',automaticWorkItemLease:{requestId:'intake',leaseGeneration:1}},
    baseline:revision,run:{agentId:'agent_synthetic',publicationRef:'publication-original',modelEvidence:{selectedModelRef:'aily/deepseek-v4-pro',actualModelRef:null},
      pending:{phase:'READ',candidateRef:'00000000-0000-4000-8000-000000000001',saveRequestId:'SAVE-A',
        validatedAt:'2026-10-29T00:00:00.000Z',workJson:'{}',expectedWorkRevision:0,previousWorkRevisionRef:null,
        workRevisionRef:'JAWR-A',workRevision:1,readObservedAt:'2026-10-29T00:00:00.000Z'}},writePredicate:sql`true`}) as unknown as AilyTaskDomainSnapshot;
  const context=()=>AilyTrustedTaskContext.authorized(snapshot(),async()=>snapshot());
  const bytes=new Map<string,Uint8Array>();
  const artifactStore={persistAndReadback:jest.fn(async(value:Uint8Array)=>{
    const sha256=createHash('sha256').update(value).digest('hex');const ref=`artifact://synthetic/${sha256}`;bytes.set(ref,value);
    return {bytes:value,artifact:{ref,sha256,byteLength:value.byteLength,mediaType:'application/json',storeRole:'UnifiedArtifactStoreCandidate'}};
  }),readActualBytes:jest.fn(async(artifact:{ref:string})=>bytes.get(artifact.ref)!)};
  const recordAilyStage=jest.fn(async(input:{receipt:AilyStageOverallReceipt})=>{
    row.reviewActivityJson=canonicalJson([...JSON.parse(row.reviewActivityJson),{kind:'AILY_STAGE_OVERALL',receipt:input.receipt,observedAt:input.receipt.observedAt}]);
  });
  const service=Object.create(CanonicalJobAidProblemService.prototype) as CanonicalJobAidProblemService;
  const commit=jest.fn(async()=>({status:'SUCCEEDED'}));
  Object.assign(service,{artifactStore,assertSourcesAuthorized:jest.fn(async()=>undefined),commit,
    work:{listForRuntime:async()=>[revision],recordAilyStage}});
  return {service,row,revision,context,recordAilyStage,artifactStore,commit};
}

describe('saved stage Overall is independent of final',()=>{
  it('persists the exact READ-backed artifact without changing task, business revision, status or lease',async()=>{
    const h=fixture();const before={...h.row};
    const stage=await h.service.projectAilyStage(h.context(),'JAWR-A');
    expect(stage.sourceAssessment).toMatchObject({actionAttemptId:'ATT',workRevisionRef:'JAWR-A',saveRequestId:'SAVE-A'});
    expect(h.row).toEqual({...before,reviewActivityJson:h.row.reviewActivityJson});expect(h.commit).not.toHaveBeenCalled();
    expect(h.artifactStore.persistAndReadback).toHaveBeenCalledTimes(1);
    h.row.reviewActivityJson=canonicalJson([...JSON.parse(h.row.reviewActivityJson),{kind:'ASSESSMENT_WORK_READ',
      workRevisionRef:'JAWR-A',workRevision:1,saveRequestId:'SAVE-A',observedAt:'2026-10-29T00:01:00.000Z'}]);
    expect(await h.service.projectAilyStage(h.context(),'JAWR-A')).toEqual(stage);
    expect(h.recordAilyStage).toHaveBeenCalledTimes(1);
    expect(ailyStageOveralls(h.row.reviewActivityJson)).toEqual([stage]);
    expect(projectJobAidActivity({attemptId:'ATT',attemptRef:'AQ',status:'RUNNING',activityJson:h.row.reviewActivityJson},[]))
      .toMatchObject({unknownRecordCount:0,malformedRecordCount:0});
    expect(projectJobAidActivity({attemptId:'ATT',attemptRef:'AQ',status:'RUNNING',activityJson:canonicalJson([
      {kind:'AILY_STAGE_OVERALL',receipt:{...stage,sourceAssessment:{...stage.sourceAssessment,actionAttemptId:'OTHER'}},observedAt:stage.observedAt}])},[]).malformedRecordCount).toBe(1);
  });
  it.each(['missing-read','cancelled','in-progress','wrong-ref'])('rejects %s as a stage receipt',async reason=>{
    const h=fixture();if(reason==='missing-read')h.row.reviewActivityJson='[]';
    if(reason==='cancelled')h.row.status='CANCELLED';if(reason==='in-progress')h.revision.content.roundCompletion='IN_PROGRESS';
    await expect(h.service.projectAilyStage(h.context(),reason==='wrong-ref'?'JAWR-other':'JAWR-A')).rejects.toThrow();
    expect(h.recordAilyStage).not.toHaveBeenCalled();expect(h.commit).not.toHaveBeenCalled();
  });
  it('constructs explicit Aily final provenance with actual model and usage unknown, then calls the original commit consumer',async()=>{
    const h=fixture();await h.service.finishAily(h.context(),'JAWR-A');
    expect(h.commit).toHaveBeenCalledTimes(1);
    const result=(h.commit.mock.calls[0] as unknown as [{result:Record<string,unknown>}])[0].result;
    expect(result).toMatchObject({executionKind:'AILY_AGENT',modelVersion:null,
      producer:{kind:'AILY_AGENT_V1',agentId:'agent_synthetic',publicationRef:'publication-original',selectedModelRef:'aily/deepseek-v4-pro',actualModelRef:null,usage:null},
      runMetrics:{inputUnits:null,outputUnits:null},skillVersion:'wiselink-aily-domain@v1'});
    expect(result).not.toHaveProperty('modelRequests');expect(result).not.toHaveProperty('sourceWork');
  });
});
