import test from 'node:test';
import assert from 'node:assert/strict';
import { runDynamicEvaluation, assertProgramAssessmentStatusReadback } from '../skills/wiselink-research-and-synthesize/scripts/orchestrate-host-mcp.mjs';
import { canonicalSha256, sealResultEnvelope, validateTaskEnvelope, WISELINK_HOST_MCP_NAME, WISELINK_HOST_MCP_VERSION,
  WISELINK_SKILL_VERSION } from '../skills/wiselink-research-and-synthesize/scripts/validate-payload.mjs';

const workItemId = 'WI-PROGRAM-TEST', attemptRef = 'AQ-PROGRAM-TEST';
const actionAttemptId = 'ATT-PROGRAM-TEST', workRevisionRef = 'JAWR-PROGRAM-TEST';
const leaseToken = '00000000-0000-4000-8000-000000000001';
const saveRequestId = 'SAVE-PROGRAM-TEST';
const iso = '2026-10-25T08:00:00.000Z';
const modelInput = {schemaVersion:'wiselink.jobaid-problem-task.v3',
  executionMode:'PROGRAM_CONTROLLED_V1',purpose:'INITIAL_PROBLEM_ASSESSMENT',expectedWorkRevision:0};
const taskDraft = {
  schemaVersion:'wiselink.3_1.openclaw_task_envelope.v1', actionAttemptId,
  operationRef:attemptRef,taskType:'OPENCLAW_DYNAMIC_EVALUATION',priority:100,
  tenantId:'synthetic-tenant',workItemId,inputRevision:1,baseRevision:1,
  documentVersionId:'DVI-PROGRAM-TEST',sourceRefs:[],allowedConnectors:[],hostResolvedMissingInputs:[],
  modelInput:{executionMode:'PROGRAM_CONTROLLED_V1',modelInput},deadline:'2099-01-01T00:00:00.000Z',
  idempotencyKey:'synthetic-program-test',
};
const task = validateTaskEnvelope({...taskDraft,inputHash:canonicalSha256(taskDraft)});
const begin = {status:'RUNNING',attemptRef,leaseToken,leaseGeneration:1,task,modelInput};
const provenance = {modelVersion:'miaoda/glm-5.3',promptVersion:'wiselink-jobaid-problem@v3',
  skillVersion:WISELINK_SKILL_VERSION,
  toolVersions:{[WISELINK_HOST_MCP_NAME]:WISELINK_HOST_MCP_VERSION,'jobaid-problem-protocol':'3'},
  runMetrics:{durationMs:1,inputUnits:1,outputUnits:1}};
const projection = () => ({status:'OVERALL_CANDIDATE_READY',
  baseRules:{workRevisionRef},overallSynthesis:{status:'CANDIDATE_ONLY',
    executionKind:'DETERMINISTIC_PROJECTION',modelRequests:0,
    basedOnJobAidWorkRevisionRef:workRevisionRef,
    sourceAssessment:{actionAttemptId,workRevisionRef,workRevision:1,saveRequestId,readObservedAt:iso}}});
const statusRead = () => ({entry:{workItemId},integratedAssessmentSummary:projection()});
const commitAck = () => ({workItemId,workItemRevision:2,...projection()});
const savedRead = () => ({schemaVersion:'wiselink.jobaid-work-read.v2',attemptId:actionAttemptId,
  inputWorkRevision:0,executionStatus:'RUNNING',revision:{workRevisionRef,workRevision:1,
    requestId:saveRequestId,actionAttemptId,workItemId,documentVersionId:task.documentVersionId,
    basedOnWorkItemRevision:task.baseRevision,
    content:{roundCompletion:'COMPLETE_WITH_OPEN_QUESTIONS',overviewStatus:'CURRENT',understanding:'synthetic understanding'}}});
const attemptStatus = hash => ({attemptRef,taskType:task.taskType,status:'SUCCEEDED',
  recoveryAvailable:false,projectionApplied:true,commitStartedAt:iso,terminalReason:null,
  resultContentHash:hash});

function fixture({lostAck=false,receivedAck=commitAck(),readStatus=statusRead(),statusHash='same',
  saved=savedRead(),beginReturn=begin,attemptReturn=null}={}) {
  const calls=[];
  let modelCalls=0;
  let resultHash;
  const callTool=async (name,args) => {
    calls.push({name,args});
    switch(name) {
      case 'get_parse_status': return calls.filter(call=>call.name==='get_parse_status').length===1
        ? {entry:{workItemId},initialAnalysis:{status:'RUNNING'}} : structuredClone(readStatus);
      case 'begin_dynamic_evaluation': return structuredClone(beginReturn);
      case 'heartbeat_action_attempt': return {leaseExpiresAt:'2099-01-01T00:00:00.000Z'};
      case 'read_assessment_work':
        assert.deepEqual(args,{attemptRef,workItemId});
        return structuredClone(saved);
      case 'commit_dynamic_evaluation_candidate':
        resultHash=args.result.contentHash;
        if(lostAck) throw new Error('SYNTHETIC_ACK_LOST');
        return structuredClone(receivedAck);
      case 'get_action_attempt_status': return structuredClone(attemptReturn ?? attemptStatus(statusHash==='same' ? resultHash : 'f'.repeat(64)));
      case 'get_deep_link': return {workItemId,deepLink:'/synthetic'};
      default: throw new Error(`UNEXPECTED_TOOL:${name}`);
    }
  };
  const evaluateDynamicRules=async (_input,hooks) => {
    modelCalls++;
    assert.equal(typeof hooks.readAssessmentWork,'function');
    return {output:{workRevisionRef},provenance};
  };
  return {calls,modelCalls:()=>modelCalls,run:()=>runDynamicEvaluation({workItemId,callTool,evaluateDynamicRules})};
}
function names(calls) { return calls.map(call=>call.name); }

test('normal program commit requires matching nested Overall status readback',async()=>{
  const f=fixture();
  const result=await f.run();
  assert.equal(result.ok,true);
  assert.equal(result.committed.overallSynthesis.sourceAssessment.saveRequestId,saveRequestId);
  assert.deepEqual(names(f.calls),['get_parse_status','begin_dynamic_evaluation','heartbeat_action_attempt',
    'heartbeat_action_attempt','read_assessment_work','commit_dynamic_evaluation_candidate','get_parse_status','get_deep_link']);
});

test('lost commit ACK reads same-hash SUCCEEDED and nested Overall without model or commit replay',async()=>{
  const f=fixture({lostAck:true});
  const result=await f.run();
  assert.equal(result.ok,true);
  assert.equal(result.outcome,'COMMIT_RESPONSE_LOSS_RECOVERED_READ_ONLY');
  assert.equal(f.modelCalls(),1);
  assert.equal(result.after.integratedAssessmentSummary.overallSynthesis.sourceAssessment.workRevisionRef,workRevisionRef);
  assert.deepEqual(names(f.calls),['get_parse_status','begin_dynamic_evaluation','heartbeat_action_attempt',
    'heartbeat_action_attempt','read_assessment_work','commit_dynamic_evaluation_candidate','get_action_attempt_status','get_parse_status']);
});

test('lost ACK with absent Overall fails rather than treating SUCCEEDED as projection',async()=>{
  const f=fixture({lostAck:true,readStatus:{entry:{workItemId},integratedAssessmentSummary:{...projection(),overallSynthesis:null}}});
  await assert.rejects(f.run(),/HOST_MCP_PROGRAM_ASSESSMENT_COMMIT_RESULT_INVALID/);
  assert.equal(names(f.calls).filter(name=>name==='commit_dynamic_evaluation_candidate').length,1);
});

test('lost ACK with wrong Overall work revision fails',async()=>{
  const readStatus=statusRead();
  readStatus.integratedAssessmentSummary.overallSynthesis.basedOnJobAidWorkRevisionRef='JAWR-OTHER';
  const f=fixture({lostAck:true,readStatus});
  await assert.rejects(f.run(),/HOST_MCP_PROGRAM_ASSESSMENT_COMMIT_RESULT_INVALID/);
});

test('malformed received ACK is not masked by later attempt status',async()=>{
  const f=fixture({receivedAck:{...commitAck(),workItemRevision:'invalid'}});
  await assert.rejects(f.run(),/HOST_MCP_PROGRAM_ASSESSMENT_COMMIT_RESULT_INVALID/);
  assert.equal(names(f.calls).includes('get_action_attempt_status'),false);
});

test('received commit ACK with unrelated SAVE request ID fails despite same work revision',async()=>{
  const receivedAck=commitAck();
  receivedAck.overallSynthesis.sourceAssessment.saveRequestId='SAVE-OTHER';
  const f=fixture({receivedAck});
  await assert.rejects(f.run(),/HOST_MCP_PROGRAM_ASSESSMENT_COMMIT_RESULT_INVALID/);
  assert.equal(names(f.calls).includes('get_action_attempt_status'),false);
});

test('lost ACK with wrong result content hash is outcome unknown and does not read Overall',async()=>{
  const f=fixture({lostAck:true,statusHash:'wrong'});
  await assert.rejects(f.run(),/HOST_MCP_COMMIT_OUTCOME_UNKNOWN/);
  assert.equal(names(f.calls).filter(name=>name==='get_parse_status').length,1);
});

test('status readback rejects wrong entry identity even with matching nested Overall',()=>{
  assert.throws(()=>assertProgramAssessmentStatusReadback(
    {entry:{workItemId:'WI-OTHER'},integratedAssessmentSummary:projection()},workItemId,
    {actionAttemptId,workRevisionRef}),/HOST_MCP_PROGRAM_PROJECTION_IDENTITY_MISMATCH/);
});

test('status validator rejects an unrelated SAVE request ID from the same revision',()=>{
  const readStatus=statusRead();
  readStatus.integratedAssessmentSummary.overallSynthesis.sourceAssessment.saveRequestId='SAVE-OTHER';
  const f=fixture({lostAck:true,readStatus});
  return assert.rejects(f.run(),/HOST_MCP_PROGRAM_ASSESSMENT_COMMIT_RESULT_INVALID/);
});

test('precommit latest-work read rejects a revision from another attempt before committing',async()=>{
  const saved=savedRead();
  saved.revision.actionAttemptId='ATT-OTHER';
  const f=fixture({saved});
  await assert.rejects(f.run(),/HOST_MCP_PROGRAM_ASSESSMENT_SAVED_READBACK_INVALID/);
  assert.equal(names(f.calls).includes('commit_dynamic_evaluation_candidate'),false);
});

test('precommit latest-work read rejects a different work revision before committing',async()=>{
  const saved=savedRead();
  saved.revision.workRevisionRef='JAWR-OTHER';
  const f=fixture({saved});
  await assert.rejects(f.run(),/HOST_MCP_PROGRAM_ASSESSMENT_SAVED_READBACK_INVALID/);
  assert.equal(names(f.calls).includes('commit_dynamic_evaluation_candidate'),false);
});

test('COMMITTING replay binds saved request and revision, then verifies nested projection without model or SAVE',async()=>{
  const recoveryResult=sealResultEnvelope({task,modelOutput:{workRevisionRef},provenance,
    factsConsidered:[workRevisionRef]});
  const beginReturn={...begin,status:'COMMITTING',recoveryResult};
  const attemptReturn={...attemptStatus(recoveryResult.contentHash),status:'COMMITTING',
    projectionApplied:false,recoveryAvailable:true,recoveryResult};
  const saved=savedRead();
  saved.executionStatus='COMMITTING';
  const f=fixture({beginReturn,attemptReturn,saved});
  const result=await f.run();
  assert.equal(result.outcome,'COMMITTING_REPLAYED');
  assert.equal(result.after.integratedAssessmentSummary.overallSynthesis.sourceAssessment.saveRequestId,saveRequestId);
  assert.equal(f.modelCalls(),0);
  assert.deepEqual(names(f.calls),['get_parse_status','begin_dynamic_evaluation','get_action_attempt_status',
    'read_assessment_work','commit_dynamic_evaluation_candidate','get_parse_status']);
});

test('COMMITTING replay refuses projection from an unrelated SAVE request',async()=>{
  const recoveryResult=sealResultEnvelope({task,modelOutput:{workRevisionRef},provenance,
    factsConsidered:[workRevisionRef]});
  const saved=savedRead(); saved.executionStatus='COMMITTING';
  const ack=commitAck(); ack.overallSynthesis.sourceAssessment.saveRequestId='SAVE-OTHER';
  const f=fixture({beginReturn:{...begin,status:'COMMITTING',recoveryResult},
    attemptReturn:{...attemptStatus(recoveryResult.contentHash),status:'COMMITTING',
      projectionApplied:false,recoveryAvailable:true,recoveryResult},saved,receivedAck:ack});
  await assert.rejects(f.run(),/HOST_MCP_PROGRAM_ASSESSMENT_COMMIT_RESULT_INVALID/);
  assert.equal(f.modelCalls(),0);
});
