import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile,mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectJobAidUpdateInput, runHostedReviewTurn, invokeHostedReviewModel } from '../scripts/run-hosted-review-turn.mjs';
import { canonicalSha256,validateReviewTask } from '../scripts/validate-payload.mjs';
const prefix='DOCUMENT_ORIGINAL:DV-fixture-001:PR-fixture:';
const roots=[`${prefix}parent`,`${prefix}quote`];const other=`${prefix}other`;
const ref='DOCUMENT_ACTIVITY:DAR-fixture:7:DAS-action';
const binding={original:{documentVersionId:'DV-fixture-001',parseRunId:'PR-fixture',parseRevision:2,sourceArtifactId:'ART-fixture',sourceSha256:'a'.repeat(64),sourceByteLength:1234},semanticRevision:3};
const quote='Planned action remains TBD';
const record={ref,reference:{runRef:'DAR-fixture',candidateRevision:7,statementId:'DAS-action'},sourceBinding:binding,candidateOnly:true,sourceSchemaVersion:'wiselink.document.activity-candidate.v1',semanticFieldsAvailability:'LEGACY_PARTIAL',scopeBasis:'LEGACY_RUN_SCOPE',rootRefs:[roots[1]],requiredContextRootRefs:roots,statement:{statementId:'DAS-action',statementKey:'action',label:'Source action candidate',quotes:[{anchorId:'anchor-action',start:0,end:quote.length,text:quote}],time:null,statusRaw:'TBD',limitations:['Only if X; table values stay together']},quoteLocators:[{quoteIndex:0,anchorId:'anchor-action',sourceUnitId:'u-action',payloadPath:'/payload/text',sourceRefIds:['quote'],rootRefs:[roots[1]]}]};
const activity={runRef:'DAR-fixture',candidateRevision:7,readCoverage:{status:'DELIVERED_RANGES_ONLY',selection:{sectionIds:['section-actions']},deliveredRanges:[{sectionId:'section-actions',offset:0,unitIds:['u-parent','u-action'],anchorIds:['anchor-parent','anchor-action'],nextOffset:null}],sourceCoverage:{knownPageCount:3,readPageIndexes:[0,1],unresolvedRanges:[{pageIndexes:[2],unitIds:[],reason:'UNREAD',message:'Unseen page remains unknown'}]}}};
const evidence=[{evidenceRef:roots[0],kind:'DOCUMENT_PASSAGE',title:'Parent conditions',versionLabel:'PR-fixture',excerpt:'Only if X is confirmed. Otherwise do not proceed.',locator:'page:0'}, {evidenceRef:roots[1],kind:'DOCUMENT_PASSAGE',title:'Action table',versionLabel:'PR-fixture',excerpt:'Table header: Scope | Planned action remains TBD | Only under X.',locator:'page:1'}, {evidenceRef:other,kind:'DOCUMENT_PASSAGE',title:'Other source',versionLabel:'PR-fixture',excerpt:'Other unrelated text',locator:'page:2'}, {evidenceRef:ref,kind:'PRIOR_RESULT',title:'Saved interpretation candidate',versionLabel:'PR-fixture',excerpt:record.statement.label,locator:null,originalEvidenceRefs:roots,sourceStatement:{reference:record.reference,sourceBinding:binding},sourceContext:{resultRef:'DAR-fixture',resultRevision:7}}];
function assessment(){return {schemaVersion:'wiselink.jobaid-problem-task.v2',purpose:'PROBLEM_REVIEW',evidenceProjectionVersion:'SOURCE_CONTEXT_V2',sourceStatementAvailability:{status:'AVAILABLE',semanticFieldsAvailability:'LEGACY_PARTIAL',limitations:['Delivered run coverage only']},availableSources:evidence.map(e=>({ref:e.evidenceRef,kind:e.kind,title:e.title,versionLabel:e.versionLabel,locator:e.locator,...(e.kind==='PRIOR_RESULT'?{sourceStatement:{reference:record.reference,label:record.statement.label,semanticFieldsAvailability:'LEGACY_PARTIAL',scopeBasis:'LEGACY_RUN_SCOPE'}}:{})})),deliveredEvidence:evidence.filter(e=>e.evidenceRef!==other),sourceStatements:[record],activityContexts:[activity],previousWork:{content:{issues:[]}}};}

test('new mixed Review projection preserves each complete required root once; legacy remains byte-equivalent',()=>{
 const input={context:{purpose:'UPDATE_ASSESSMENT',problemAssessment:assessment()}};
 const projected=projectJobAidUpdateInput(input).context.problemAssessment;
 assert.deepEqual(projected.deliveredEvidence.filter(e=>e.kind==='DOCUMENT_PASSAGE').map(e=>e.evidenceRef),roots);
 assert.equal(projected.deliveredEvidence.find(e=>e.evidenceRef===roots[0]).excerpt,evidence[0].excerpt);
 assert.equal(projected.deliveredEvidence.find(e=>e.evidenceRef===roots[1]).excerpt,evidence[1].excerpt);
 assert.deepEqual(projected.sourceStatements,[record]);assert.deepEqual(projected.activityContexts,[activity]);
 const legacy={context:{purpose:'UPDATE_ASSESSMENT',problemAssessment:{availableSources:evidence.slice(0,3).map(e=>({ref:e.evidenceRef})),deliveredEvidence:evidence.slice(0,3),documentOverview:{title:'legacy'}}}};
 const oldExpected={context:{purpose:'UPDATE_ASSESSMENT',problemAssessment:{availableSources:legacy.context.problemAssessment.availableSources,deliveredEvidence:[],documentPreviewProjection:'DOCUMENT_PASSAGE excerpts omitted from model prompt; exact refs and locators remain in availableSources. Read relevant authorized passages this turn before citing or changing their premises. Host retains the full task and validates the proposed update.'}}};
 assert.equal(JSON.stringify(projectJobAidUpdateInput(legacy)),JSON.stringify(oldExpected));
 const missing=structuredClone(input);missing.context.problemAssessment.deliveredEvidence=missing.context.problemAssessment.deliveredEvidence.filter(e=>e.evidenceRef!==roots[0]);
 assert.throws(()=>projectJobAidUpdateInput(missing),/CONTEXT_NOT_DELIVERED/);
});

test('actual non-isolated Review driver sends full parent condition and table header in final model messages',async t=>{
 const review=JSON.parse(await readFile(new URL('./fixtures/review-turn-task.c2.json',import.meta.url),'utf8'));
 review.schemaVersion='wiselink.3_1.review_turn_task.v1.c5';review.selectedEvaluationItemId=null;review.allowedEvaluationItemIds=[];review.allowedAdoptedInputRefs=[];
 review.context.purpose='UPDATE_ASSESSMENT';review.context.problemAssessment=assessment();
 const artifact='artifact://fixture',sha='a'.repeat(64);
 const sourceCatalog=evidence.map(e=>e.kind==='DOCUMENT_PASSAGE'?{...e,workItemId:review.context.workItem.workItemId,documentVersionId:'DV-fixture-001',sourceRefId:e.evidenceRef.slice(prefix.length)}:{...e,resultRef:'DAR-fixture',resultRevision:7});
 review.resourceRefs=evidence.filter(e=>e.kind==='DOCUMENT_PASSAGE').map(e=>({sourceRefId:e.evidenceRef,resourceArtifactRef:artifact,resourceArtifactSha256:sha,value:{...e,sourceRefId:e.evidenceRef}}));
 review.jobAidContext={schemaVersion:'wiselink.jobaid-problem-task.v2',sourceCatalog,sourceBindings:[{workItemId:review.context.workItem.workItemId,artifactRef:artifact,artifactSha256:sha}],initiallyDeliveredRefs:[...roots,ref],sourceActivityProjections:[{records:[record],activityContexts:[activity]}],modelInput:review.context.problemAssessment,previousWork:{content:{issues:[]}}};
 review.executionPolicy.toolPolicyRef='wiselink-openclaw-engineering-assessment@1.2.0#interactive-jobaid-review-c5';
 validateReviewTask(review);
 const unsealed={schemaVersion:'wiselink.3_1.openclaw_task_envelope.v1',actionAttemptId:'ATT-review',operationRef:'AQ-review',taskType:'OPENCLAW_INTERACTIVE_REVIEW',priority:100,tenantId:'tenant',workItemId:review.context.workItem.workItemId,inputRevision:review.inputRevision,baseRevision:review.inputRevision,documentVersionId:review.context.workItem.documentVersionId,sourceRefs:[{ref:artifact,sha256:sha}],allowedConnectors:[],hostResolvedMissingInputs:[],modelInput:review,deadline:'2099-01-01T00:00:00Z',idempotencyKey:'synthetic-review'};
 const task={...unsealed,inputHash:canonicalSha256(unsealed)};
 const scratch=await mkdtemp(join(tmpdir(),'statement-review-'));t.after(()=>rm(scratch,{recursive:true,force:true}));
 const requests=[];let mutations=0;
 const callTool=async(name,args)=>{
   if(name==='begin_review_turn')return {attemptRef:task.operationRef,status:'RUNNING',task,leaseToken:'lease',leaseGeneration:1,leaseExpiresAt:'2099-01-01T00:00:00Z'};
   if(name==='get_review_turn_context')return {schemaVersion:'wiselink.3_1.review_turn_context.v1.c2',attemptRef:task.operationRef,reviewConversationRef:review.reviewConversationRef,reviewTurnRef:review.reviewTurnRef,mode:'INTERACTIVE_REVIEW',selectedEvaluationItemId:null,inputRevision:review.inputRevision,allowedOperations:review.allowedOperations,resourceRefs:review.resourceRefs.map(({sourceRefId,resourceArtifactRef,resourceArtifactSha256})=>({sourceRefId,resourceArtifactRef,resourceArtifactSha256})),context:review.context,executionPolicy:review.executionPolicy};
   if(name==='read_source_refs')return {schemaVersion:'wiselink.3_1.review_source_refs.v1.c2',attemptRef:task.operationRef,sourceRefs:args.sourceRefIds.map(id=>review.resourceRefs.find(r=>r.sourceRefId===id).value)};
   if(name==='heartbeat_action_attempt')return {leaseExpiresAt:'2099-01-01T00:00:00Z'};
   mutations++;throw new Error(`Unexpected mutation ${name}`);
 };
 const requestGateway=async(_url,init)=>{
   requests.push(JSON.parse(init.body));
   if(requests.length===1)return Response.json({model:'fixture-model',choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:'read-other',type:'function',function:{name:'read_wiselink_review_sources',arguments:JSON.stringify({sourceRefIds:[other]})}}]}}]});
   throw new Error('TEST_STOP_AFTER_FULL_MODEL_MESSAGE');
 };
 await assert.rejects(runHostedReviewTurn({workItemId:task.workItemId,reviewConversationRef:review.reviewConversationRef,requestId:review.requestId,checkpointDir:scratch},{callTool,invokeModel:(input,hooks)=>invokeHostedReviewModel(input,{...hooks,gatewayChatCompletionsEnabled:true,gatewayUrl:'https://fixture.invalid',gatewayToken:'fixture-token',configuredModelVersion:'fixture-model',maxCompletionTokens:8192},{requestGateway})}),/TEST_STOP_AFTER_FULL_MODEL_MESSAGE/);
 assert.equal(mutations,0);assert.ok(requests.length>=2);
 assert.equal(requests[0].tool_choice,'auto'); // Full saved roots do not force another read
 const firstText=JSON.stringify(requests[0].messages);
 for(const root of roots){const quoteText=evidence.find(e=>e.evidenceRef===root).excerpt;assert.equal(firstText.split(quoteText).length-1,1);}
 const modelText=JSON.stringify(requests[1].messages);
 for(const root of roots){assert.ok(modelText.includes(root));const quoteText=evidence.find(e=>e.evidenceRef===root).excerpt;assert.equal(modelText.split(quoteText).length-1,1);}
 assert.ok(modelText.includes('LEGACY_PARTIAL'));assert.ok(modelText.includes('LEGACY_RUN_SCOPE'));
 assert.ok(modelText.includes('Only if X is confirmed. Otherwise do not proceed.'));assert.ok(modelText.includes('Table header: Scope'));
});
