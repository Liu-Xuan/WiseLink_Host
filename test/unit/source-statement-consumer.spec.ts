import { buildDocumentActivitySourceContext } from '../../server/modules/canonical-host/document-activity-source-context';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type { DocumentActivityValidationContext } from '../../server/modules/canonical-host/document-activity-candidate';
import { DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA, DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2, type DocumentActivityCandidateProposalV2 } from '@shared/document-activity.interface';
import { materializeDocumentActivityRevision, validateDocumentActivityCandidate } from '../../server/modules/canonical-host/document-activity-candidate';
import { projectSavedDocumentActivityForAssessment, readProjectedDocumentActivityStatement } from '../../server/modules/canonical-host/document-activity-assessment-projection';
import { buildTranslationSourcePlan } from '../../server/modules/canonical-host/canonical-translation-source-plan';
import { documentOriginalEngineeringReading } from '../../server/modules/canonical-host/document-original-engineering-reading';
import { buildDocumentSemanticMap, selectDocumentSemanticSection } from '../../server/modules/document-management/src/hosted/nest/document-semantic-map';
import { GENERIC_SEMANTIC_PROFILE } from '../../server/modules/document-management/src/hosted/nest/document-semantic-profile';
import { documentOriginalReadingCoverage } from '../../server/modules/document-management/src/hosted/nest/document-original-adapter';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';

/** Public constructed fixture only. No gold/holdout, DB, OCR or model. */
function activityFixture(text = 'Target Q4 2026; completion TBD. should retain TLS and LN 1400-1420. 😀', crossModule = false, samePage = false) {
  const original = originalFixture();
  if (samePage) for (const [index, locator] of original.source.sourceLocators.entries()) {
    Object.assign(locator, { pageStart: 0, pageEnd: 0, normalizedPath: `body/block-${index}`, xpath: `/body/block[${index + 1}]` });
    original.locations[index].pageIndex = 0;
  }
  const seed = original.source.units[0];
  original.source.units.unshift(
    { ...structuredClone(seed), unitId: 'h-parent', kind: 'heading', order: -3, payload: { text: 'Source conditions', level: 1 } },
    { ...structuredClone(seed), unitId: 'condition', order: -2, payload: { text: 'Only when X holds; otherwise do not use method M.' } },
    { ...structuredClone(seed), unitId: 'h-child', kind: 'heading', order: -1, payload: { text: 'Planned actions', level: 2 } },
  );
  original.source.units.find(unit => unit.unitId === 'u1')!.payload.text = text;
  if (crossModule) {
    original.source.modules.push({ moduleId: 'other', order: 1 });
    original.source.units.filter(unit => ['h-child', 'u1', 'u2'].includes(unit.unitId))
      .forEach(unit => { unit.moduleId = 'other'; });
  }
  const semanticMap = buildDocumentSemanticMap({ original, semanticRevision: 3, profile: GENERIC_SEMANTIC_PROFILE });
  const plan = buildTranslationSourcePlan({ documentVersionId: original.binding.documentVersionId,
    packageId: original.binding.parseRunId, title: '', source: original.source,
    parsedArtifact: { storeRole: 'UnifiedArtifactStoreCandidate', ref: 'constructed-not-read',
      sha256: 'b'.repeat(64), byteLength: 1, mediaType: 'application/json' } });
  const selected = selectDocumentSemanticSection(original, semanticMap, 'section:h-child');
  const ids = new Set([...selected.unitIds, ...selected.contextUnitIds]);
  const units = original.source.units.filter(unit => ids.has(unit.unitId));
  const anchors = plan.anchors.filter(anchor => ids.has(anchor.sourceUnitId));
  const context: DocumentActivityValidationContext = {
    sourceBinding: { original: original.binding, semanticRevision: semanticMap.semanticRevision },
    selection: { sectionIds: ['section:h-child'] }, deliveredAnchors: anchors,
    deliveredRanges: [{ sectionId: 'section:h-child', offset: 0, unitIds: units.map(unit => unit.unitId),
      anchorIds: anchors.map(anchor => anchor.anchorId), nextOffset: null }],
    sourceCoverage: documentOriginalReadingCoverage(original),
  };
  const anchor = anchors.find(value => value.sourceUnitId === 'u1')!;
  const table = anchors.find(value => value.sourceText === '12 kPa')!;
  const candidate = validateDocumentActivityCandidate({ schemaVersion: DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA, statements: [
    { statementKey: 'planned', label: '  Source target 😀\n',
      quotes: [{ anchorId: anchor.anchorId, start: 0, end: anchor.sourceText.length, text: anchor.sourceText }],
      time: text.includes('Q4 2026') ? { role: 'TARGET', precision: 'QUARTER', expression: 'CALENDAR', raw: 'Q4 2026', quoteIndex: 0 } : null,
      statusRaw: text.includes('TBD') ? 'TBD' : null, limitations: ['  subject to approval\n', 'Unresolved source scope'] },
    { statementKey: 'pressure', label: 'Source table limit',
      quotes: [{ anchorId: table.anchorId, start: 0, end: table.sourceText.length, text: table.sourceText }],
      time: null, statusRaw: null, limitations: ['Only when X'] },
  ] }, context);
  const savedRevision = materializeDocumentActivityRevision(candidate, { runRef: 'DAR-fixture', candidateRevision: 7,
    statementIds: ['DAS-fixture-1', 'DAS-fixture-2'], producer: { skillVersion: 'constructed', modelVersion: 'not-called' },
    savedAt: '2026-09-16T00:00:00Z' });
  const originalEvidence = documentOriginalEngineeringReading({ original, structuredSource: original.source,
    run: { documentVersionId: original.binding.documentVersionId, parseRunId: original.binding.parseRunId,
      parseRevision: original.binding.parseRevision,
      manifestArtifact: { relativePath: 'original/manifest.json', readback: 'VERIFIED', sha256: 'b'.repeat(64), byteLength: 1 } },
  } as never, 0, 20, crossModule ? null : semanticMap).evidence;
  return { savedRevision, original, semanticMap, originalEvidence };
}

import { buildJobAidProblemTask, assertJobAidProblemTaskBinding } from '../../server/modules/canonical-host/jobaid-problem-task';
import { projectCommonAssessmentContext } from '../../server/modules/canonical-host/canonical-host-common-context.service';
import type { CanonicalWorkItemProjection } from '@shared/api.interface';
const item = {workItemId:'WI-TEST', revision:1, source:{documentVersionId:'DV-TEST',sourceArtifactId:'ART-TEST',sourceFileSha256:'a'.repeat(64),sourceByteLength:10}} as unknown as CanonicalWorkItemProjection;
function buildTask() {
 const f=activityFixture(); const projection=projectSavedDocumentActivityForAssessment(f);
 const common=projectCommonAssessmentContext(item,{context:{status:'UNAVAILABLE',reason:'CONSTRUCTED'},documentReadingStatus:'AVAILABLE',items:[],sections:[],resourceRefs:[]},[]);
 const input={workItem:item,actorUserId:'owner',permissionSnapshotVersion:'p1',purpose:'INITIAL_PROBLEM_ASSESSMENT',sourceCatalog:f.originalEvidence.map(e=>({...e,workItemId:item.workItemId})),originalParseRunId:f.original.binding.parseRunId,sourceBindings:[],common,previousWork:null,expectedWorkRevision:0,priorAssessmentRefs:[],sourceActivityProjections:[projection],sourceStatementAvailability:{status:'AVAILABLE',semanticFieldsAvailability:'LEGACY_PARTIAL',limitations:projection.limitations}};
 return {f,projection,task:buildJobAidProblemTask(input as Parameters<typeof buildJobAidProblemTask>[0])};
}
test('new exact saved declarations enter only the unique directory, not delivered bodies',()=>{
 const {task,projection}=buildTask();
 expect(task.schemaVersion).toBe('wiselink.jobaid-problem-task.v3');
 const hint=task.modelInput.availableSources.find(row=>row.ref===projection.entries[0].ref);
 expect(hint).toMatchObject({kind:'PRIOR_RESULT',sourceStatement:{reference:projection.entries[0].reference,semanticFieldsAvailability:'LEGACY_PARTIAL',scopeBasis:'LEGACY_RUN_SCOPE'}});
 expect(task.initiallyDeliveredRefs).not.toContain(projection.entries[0].ref);
 expect(task.modelInput.deliveredEvidence.some(e=>e.evidenceRef===projection.entries[0].ref)).toBe(false);
 expect(task.modelInput).not.toHaveProperty('sourceStatements');
 expect(()=>assertJobAidProblemTaskBinding(task)).not.toThrow();
});

import { CanonicalJobAidProblemService } from '../../server/modules/canonical-host/canonical-jobaid-problem.service';
import { DocumentActivityRunRepository } from '../../server/modules/canonical-host/document-activity-run.repository';
import { assertJobAidWorkFence } from '../../server/modules/canonical-host/jobaid-work.repository';
import { sealTaskEnvelope, canonicalJson } from '../../server/modules/action-attempt/action-attempt-envelope';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { ActionAttemptRow } from '../../server/modules/action-attempt/action-attempt.types';
import type { JobAidWorkRevision } from '@shared/jobaid-problem-assessment.interface';
import { DerivedSummaryMembersService } from '../../server/modules/canonical-host/derived-summary-members.service';
import { readStoredOverallEvidence } from '../../server/modules/canonical-host/overall-assessment-reading';
import { assessmentEvidenceRoots } from '@shared/assessment-evidence-roots';

/** Actual Host service/task/SQL reader/work materializer. External persistence is a unit double.
 * This is not a physical PostgreSQL, model, OEM semantic-quality or release test. */
function serviceHarness(fixtureOverride?: ReturnType<typeof activityFixture>) {
 const f=fixtureOverride??activityFixture(); const current=structuredClone(item);
 current.source.sourceByteLength=f.original.binding.sourceByteLength;
 let actor='ambient'; let active=true; let allowed=true;
 let saved:typeof f.savedRevision|null=f.savedRevision;
 const queries:Array<ReturnType<PgDialect['sqlToQuery']>>=[];
 const dialect=new PgDialect();
 const db={execute:jest.fn(async(statement:SQL)=>{
   const q=dialect.sqlToQuery(statement);queries.push(q);
   expect(q.sql).toMatch(/^SELECT/u); expect(q.sql).toContain("current_setting('app.user_id',true)");
   const param=(field:string)=>{const escaped=field.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&'); const m=q.sql.match(new RegExp(`${escaped}=\\$(\\d+)`,'u')); return m?q.params[Number(m[1])-1]:undefined;};
   if(!active||!allowed||!saved||actor!=='owner'||param("current_setting('app.user_id',true)")!==actor||param('a.tenant_id')!=='tenant'||param('a.document_version_id')!==f.original.binding.documentVersionId||param('a.parse_run_id')!==f.original.binding.parseRunId||param('a.semantic_revision')!==saved.sourceBinding.semanticRevision||param('a.run_ref')!==undefined&&param('a.run_ref')!==saved.runRef||param('a.candidate_revision')!==undefined&&param('a.candidate_revision')!==saved.candidateRevision) return [];
   return [{runRef:saved.runRef,candidateRevision:saved.candidateRevision,candidateSchemaVersion:saved.schemaVersion,status:'SAVED',documentVersionId:f.original.binding.documentVersionId,parseRunId:f.original.binding.parseRunId,parseRevision:f.original.binding.parseRevision,semanticRevision:saved.sourceBinding.semanticRevision,result:JSON.parse(JSON.stringify(saved))}];
 })};
 const activityRuns=new DocumentActivityRunRepository(db as never);
 const loaded={original:f.original,structuredSource:f.original.source,run:{tenantId:'tenant',documentVersionId:f.original.binding.documentVersionId,parseRunId:f.original.binding.parseRunId,parseRevision:f.original.binding.parseRevision,manifestArtifact:{relativePath:'original/manifest.json',readback:'VERIFIED',sha256:'b'.repeat(64),byteLength:1}}};
 const originalReader={readDocumentOriginal:jest.fn(async(dv:string,pr:string,context:{actorUserId:string})=>{
   if(!allowed||!active||context.actorUserId!=='owner') throw new Error('JOBAID_SOURCE_AUTHORIZATION_CHANGED');
   if(dv!==f.original.binding.documentVersionId||pr!==f.original.binding.parseRunId) throw new Error('WRONG_PARSE'); return loaded;
 })};
 const semantics={read:jest.fn(async(_scope:unknown,_loaded:unknown,revision?:number)=>{if(revision!==undefined&&revision!==f.semanticMap.semanticRevision) throw new Error('DOCUMENT_SEMANTIC_REVISION_NOT_FOUND');return f.semanticMap;})};
 const history:JobAidWorkRevision[]=[];
 let row:ActionAttemptRow;
 const scope={tenantId:'tenant',workItemId:current.workItemId,principalId:'executor',appId:'app_17bzc551rsg'};
 const work={
   withActorScope:jest.fn(async(id:string,fn:()=>Promise<unknown>)=>{actor=id;return fn();}),
   withActorTransaction:jest.fn(async(id:string,fn:(database:unknown)=>Promise<unknown>)=>{actor=id;return fn(db);}),
   loadOwnedSourceBinding:jest.fn(async()=>allowed?{kind:'SOURCE_FILE',workItemId:current.workItemId,documentVersionId:current.source.documentVersionId,artifactRef:current.source.sourceArtifactId,artifactSha256:current.source.sourceFileSha256}:null),
   publishedOriginalBinding:jest.fn(async()=>({parseRunId:f.original.binding.parseRunId})),
   listHeadersForRuntime:jest.fn(async()=>history.map(x=>({workRevisionRef:x.workRevisionRef,workRevision:x.workRevision}))),
   listForRuntime:jest.fn(async()=>history),
   readByRefForRuntime:jest.fn(async(input:{workRevisionRef:string})=>history.find(x=>x.workRevisionRef===input.workRevisionRef)??null),
   readByRef:jest.fn(async(input:{workRevisionRef:string})=>history.find(x=>x.workRevisionRef===input.workRevisionRef)??null),
   latest:jest.fn(async()=>history[0]??null),
   recordSourceRead:jest.fn(async(input:{row:ActionAttemptRow;fence:Parameters<typeof assertJobAidWorkFence>[1];sourceRefs:string[]})=>{
     assertJobAidWorkFence(input.row,input.fence); const entries=JSON.parse(row.reviewActivityJson??'[]');entries.push({kind:'ASSESSMENT_SOURCES_READ',sourceRefs:input.sourceRefs}); row.reviewActivityJson=JSON.stringify(entries);
   }),
   save:jest.fn(async(input:{row:ActionAttemptRow;fence:Parameters<typeof assertJobAidWorkFence>[1];requestId:string;content:JobAidWorkRevision['content']})=>{
     assertJobAidWorkFence(input.row,input.fence);
     const revision:JobAidWorkRevision={workRevisionRef:`JAWR-${history.length+1}`,workItemId:current.workItemId,workRevision:history.length+1,previousWorkRevisionRef:history[0]?.workRevisionRef??null,requestId:input.requestId,actionAttemptId:row.attemptId,basedOnWorkItemRevision:1,documentVersionId:current.source.documentVersionId,createdAt:'2026-10-05T00:00:00Z',content:structuredClone(input.content)};
     history.unshift(revision);return {revision,replayed:false};
   }),
 };
 const conversations={hasActiveOfficialActorMapping:jest.fn(async()=>active)};
 const service=new CanonicalJobAidProblemService({getTenantScopedByWorkItemId:jest.fn(async()=>current)} as never,{} as never,{authorizeOpenClawAttempt:jest.fn(async()=>scope)} as never,{} as never,{} as never,{readScoped:jest.fn(async()=>row)} as never,{loadTenantScopedProjection:jest.fn(async()=>({row:{},projection:current}))} as never,conversations as never,{buildForWorkItemWithEvidence:jest.fn(async()=>({common:projectCommonAssessmentContext(current,{context:{status:'UNAVAILABLE',reason:'CONSTRUCTED'},documentReadingStatus:'AVAILABLE',items:[],sections:[],resourceRefs:[]},[]),availableReadingEvidence:[]}))} as never,work as never,undefined,originalReader as never,semantics as never,undefined,activityRuns);
 const prepare=async(purpose:'INITIAL_PROBLEM_ASSESSMENT'|'OVERALL_CONSISTENCY'|'PROBLEM_REVIEW'='INITIAL_PROBLEM_ASSESSMENT')=>{
   if(purpose==='OVERALL_CONSISTENCY') current.integratedAssessment={baseRules:{schemaVersion:'wiselink.jobaid-problem-result.v2',workRevisionRef:history[0].workRevisionRef,workRevision:history[0].workRevision}} as never;
   const task=await (service as unknown as {buildInput(...args:unknown[]):Promise<ReturnType<typeof buildJobAidProblemTask>>}).buildInput(current,'tenant','owner','p1',purpose,'2026-10-05T00:00:00Z');
   const envelope=sealTaskEnvelope({schemaVersion:'wiselink.3_1.openclaw_task_envelope.v1',actionAttemptId:'ATT-TEST',operationRef:'OP-TEST',taskType:purpose==='OVERALL_CONSISTENCY'?'OPENCLAW_OVERALL_SYNTHESIS':'OPENCLAW_DYNAMIC_EVALUATION',priority:1,tenantId:'tenant',workItemId:current.workItemId,inputRevision:1,baseRevision:1,documentVersionId:current.source.documentVersionId,sourceRefs:[],allowedConnectors:[],hostResolvedMissingInputs:[],modelInput:task,deadline:'2099-01-01T00:00:00Z',idempotencyKey:'test-request'});
   row={attemptId:'ATT-TEST',operationRef:'OP-TEST',tenantId:'tenant',workItemId:current.workItemId,actionType:envelope.taskType,status:'RUNNING',taskEnvelopeJson:canonicalJson(envelope),reviewActivityJson:'[]',leaseOwner:'executor',leaseToken:'lease',leaseGeneration:1,leaseExpiresAt:new Date('2099-01-01'),deadlineAt:new Date('2099-01-01'),cancelRequestedAt:null} as ActionAttemptRow;
   return task;
 };
 const fence={attemptRef:'OP-TEST',leaseToken:'lease',leaseGeneration:1};
 const command=(ref:string)=>({schemaVersion:'wiselink.jobaid-problem-work.v3',headline:'Conditional proposed action',listBrief:'Retain condition X; completion remains TBD',overview:'Action is a source candidate, with unconfirmed applicability.',issues:[{issueKey:'action',question:'Does condition X hold?',body:`The source candidate retains its source wording and limitations [[${ref}]].`,riskScenarios:[],measures:[{text:'Check condition X before proceeding',addresses:'Scope prerequisite',limitations:['No effect verification'],status:'PROPOSED',basisRefs:[ref]}],otherClassifications:[],openQuestions:[{question:'Does X hold?',affects:'Applicability',nextEvidence:'Controlled object data',reason:'Source scope alone is insufficient'}],requirementHandling:[]}],roundCompletion:'COMPLETE_WITH_OPEN_QUESTIONS',completionReason:'Saved the candidate; object applicability remains open',changeSummary:'Added one sourced issue',unchangedExplanation:'No prior issue replaced'});
 const summaryDb={execute:jest.fn(async(statement:SQL)=>{const q=dialect.sqlToQuery(statement);if(q.sql.includes('AS allowed'))return [{allowed:active&&allowed}];return db.execute(statement);}),select:jest.fn((fields:Record<string,unknown>)=>{
   const result='projectionJson' in fields?[{projectionJson:JSON.stringify(current)}]:'currentDocumentVersionId' in fields?[{documentVersionId:current.source.documentVersionId,currentDocumentVersionId:current.source.documentVersionId}]:active?[{id:'ACTIVE'}]:[];
   const chain={from:()=>chain,where:()=>chain,innerJoin:()=>chain,orderBy:()=>chain,limit:async()=>result,then:(resolve:(r:unknown)=>unknown)=>Promise.resolve(result).then(resolve)};return chain;})};
 return {service,prepare,fence,command,f,work,history,queries,db,summaryDb,originalReader,semantics,conversations,getRow:()=>row,setSaved:(v:typeof saved)=>{saved=v;},revoke:()=>{allowed=false;},deactivate:()=>{active=false;}};
}

function pageReadHarness() {
 return serviceHarness(activityFixture(undefined,false,true));
}

test('actual PAGE read delivers and journals the complete same-page original selection',async()=>{
 const h=pageReadHarness();const task=await h.prepare();
 const originals=task.sourceCatalog.filter(e=>e.kind==='DOCUMENT_PASSAGE');
 expect(originals).toHaveLength(2);
 const receipt=await h.service.readSources({...h.fence,sourceRefs:[originals[0].evidenceRef],purpose:'Read original page and all conditions',context:'PAGE'});
 const refs=originals.map(e=>e.evidenceRef);
 expect(receipt.sourceRefs).toEqual(refs);
 expect(receipt.evidence.map(e=>e.evidenceRef)).toEqual(refs);
 expect(receipt.evidence.map(e=>e.excerpt)).toEqual(originals.map(e=>e.excerpt));
 expect(receipt).toMatchObject({scope:'PAGE',completeRequestedScope:true});
 expect(h.work.recordSourceRead).toHaveBeenCalledTimes(1);
 expect(h.work.recordSourceRead).toHaveBeenLastCalledWith(expect.objectContaining({sourceRefs:refs}));
 expect(JSON.parse(h.getRow().reviewActivityJson!)).toEqual([{kind:'ASSESSMENT_SOURCES_READ',sourceRefs:refs}]);
});

test.each(['actor','source','lease'] as const)('PAGE read keeps %s rejection ahead of a source-read journal',async(kind)=>{
 const h=pageReadHarness();const task=await h.prepare();
 const ref=task.sourceCatalog.find(e=>e.kind==='DOCUMENT_PASSAGE')!.evidenceRef;
 if(kind==='actor')h.deactivate();else if(kind==='source')h.revoke();else h.getRow().leaseExpiresAt=new Date('2000-01-01T00:00:00Z');
 await expect(h.service.readSources({...h.fence,sourceRefs:[ref],purpose:'Read complete authorized page',context:'PAGE'}))
   .rejects.toThrow(kind==='lease'?'JOBAID_WORK_LEASE_FENCE_REJECTED':'AUTHORIZATION_CHANGED');
 expect(JSON.parse(h.getRow().reviewActivityJson!)).toEqual([]);
 if(kind!=='lease')expect(h.work.recordSourceRead).not.toHaveBeenCalled();
});

test('actual build→READ→SAVE→readback→Overall exact re-read closes the dependency chain',async()=>{
 const h=serviceHarness();const task=await h.prepare();expect(task.schemaVersion).toBe('wiselink.jobaid-problem-task.v3');
 const ref=task.sourceActivityProjections![0].entries[0].ref;
 await expect(h.service.saveWork({...h.fence,requestId:'save-before-read',expectedWorkRevision:0,workJson:JSON.stringify(h.command(ref))})).rejects.toThrow('SOURCE_NOT_DELIVERED');
 const receipt=await h.service.readSources({...h.fence,sourceRefs:[ref],purpose:'Read exact saved statement and conditions',context:'EXACT'});
 expect(receipt.schemaVersion).toBe('wiselink.jobaid-source-read.v3');expect(receipt.sourceStatements).toHaveLength(1);expect(receipt.activityContexts).toHaveLength(1);
 expect(receipt.sourceStatements![0].statement).toEqual(h.f.savedRevision.statements[0]);
 expect(receipt.sourceRefs).toEqual(expect.arrayContaining([ref,...receipt.sourceStatements![0].requiredContextRootRefs]));
 expect(new Set(receipt.evidence.map(e=>e.evidenceRef)).size).toBe(receipt.evidence.length);
 const saved=await h.service.saveWork({...h.fence,requestId:'save-1',expectedWorkRevision:0,workJson:JSON.stringify(h.command(ref))});expect(saved.workRevision).toBe(1);
 const readback=await h.service.readAttemptWork(h.fence.attemptRef,'save-1');expect(readback.revision!.content.evidence.find(e=>e.evidenceRef===ref)).toMatchObject({kind:'PRIOR_RESULT',sourceStatement:{reference:h.f.savedRevision&&{runRef:h.f.savedRevision.runRef,candidateRevision:7,statementId:'DAS-fixture-1'},sourceBinding:h.f.savedRevision.sourceBinding}});
 const stored=readStoredOverallEvidence(readback.revision!.content.evidence);expect(stored).toEqual(readback.revision!.content.evidence);
 const roots=assessmentEvidenceRoots([ref],stored);expect(roots.unresolvedRefs).toEqual([]);expect(roots.rootRefs).toEqual(receipt.sourceStatements![0].requiredContextRootRefs);
 const overall=await h.prepare('OVERALL_CONSISTENCY');expect(overall.schemaVersion).toBe('wiselink.jobaid-problem-task.v3');expect(overall.sourceActivityProjections![0].records[0].reference).toEqual(receipt.sourceStatements![0].reference);
 const again=await h.service.readSources({...h.fence,sourceRefs:[ref],purpose:'Review exact saved provenance',context:'EXACT'});expect(again.sourceStatements).toEqual(receipt.sourceStatements);
 expect(h.queries.filter(q=>q.sql.includes('AND a.run_ref=')).every(q=>q.params.includes('DAR-fixture')&&q.params.includes(7))).toBe(true);
});

test('SAVED absence falls back to original with no Activity BEGIN or synthetic semantic fields',async()=>{
 const h=serviceHarness();h.setSaved(null);const task=await h.prepare();expect(task.modelInput.sourceStatementAvailability?.status).toBe('NOT_SAVED');expect(task.sourceActivityProjections![0].records).toEqual([]);expect(task.sourceCatalog.every(e=>e.kind!=='PRIOR_RESULT'||!e.sourceStatement)).toBe(true);
 const ref=task.sourceCatalog.find(e=>e.kind==='DOCUMENT_PASSAGE')!.evidenceRef;const receipt=await h.service.readSources({...h.fence,sourceRefs:[ref],purpose:'Original fallback',context:'EXACT'});expect(receipt.sourceStatements).toEqual([]);expect(receipt.evidence.some(e=>e.kind==='DOCUMENT_PASSAGE')).toBe(true);
 expect(h.queries.every(q=>!/(?:INSERT|UPDATE|ACTIVITY_BEGIN)/u.test(q.sql))).toBe(true);
});

test.each(['actor','source'] as const)('fresh %s revocation stops delivery and dependent save before leaking saved records',async(kind)=>{
 const h=serviceHarness();const task=await h.prepare();const ref=task.sourceActivityProjections![0].entries[0].ref;
 if(kind==='actor')h.deactivate();else h.revoke();const before=h.queries.length;
 await expect(h.service.readSources({...h.fence,sourceRefs:[ref],purpose:'Revoked read',context:'EXACT'})).rejects.toThrow('AUTHORIZATION_CHANGED');
 await expect(h.service.saveWork({...h.fence,requestId:'denied',expectedWorkRevision:0,workJson:JSON.stringify(h.command(ref))})).rejects.toThrow('AUTHORIZATION_CHANGED');
 expect(h.work.recordSourceRead).not.toHaveBeenCalled();expect(h.work.save).not.toHaveBeenCalled();expect(h.queries.length).toBe(before);
});

test('exact sealed reference never substitutes a newer saved candidate or a new semantic map',async()=>{
 const h=serviceHarness();const task=await h.prepare();const ref=task.sourceActivityProjections![0].entries[0].ref;
 h.setSaved({...h.f.savedRevision,runRef:'DAR-new',candidateRevision:8});
 await expect(h.service.readSources({...h.fence,sourceRefs:[ref],purpose:'Historical exact only',context:'EXACT'})).rejects.toThrow('SOURCE_STATEMENT_UNAVAILABLE');
 expect(h.work.recordSourceRead).not.toHaveBeenCalled();
 const h2=serviceHarness();const t2=await h2.prepare();h2.f.semanticMap.semanticRevision=4;
 await expect(h2.service.readSources({...h2.fence,sourceRefs:[t2.sourceActivityProjections![0].entries[0].ref],purpose:'No map rebinding',context:'EXACT'})).rejects.toThrow('SEMANTIC_REVISION_NOT_FOUND');
});

test('new work→new v2 mixed Review→materialized save→Overall keeps full records and exact provenance',async()=>{
 const h=serviceHarness();const initial=await h.prepare();const ref=initial.sourceActivityProjections![0].entries[0].ref;
 await h.service.readSources({...h.fence,sourceRefs:[ref],purpose:'Read initial',context:'EXACT'});
 await h.service.saveWork({...h.fence,requestId:'save-initial',expectedWorkRevision:0,workJson:JSON.stringify(h.command(ref))});
 const review=await h.prepare('PROBLEM_REVIEW');expect(review.schemaVersion).toBe('wiselink.jobaid-problem-task.v2');
 expect(review.modelInput.sourceStatements).toHaveLength(1);expect(review.modelInput.activityContexts).toHaveLength(1);
 expect(review.initiallyDeliveredRefs).toContain(ref);expect(()=>assertJobAidProblemTaskBinding(review)).not.toThrow();
 const changed=h.command(ref);changed.issues[0].body+= ' The original condition remains unresolved.';
 const content=h.service.prepareReviewWork(review,item.workItemId,changed,new Set(),['action']);
 expect(content.evidence.find(e=>e.evidenceRef===ref)).toEqual(h.history[0].content.evidence.find(e=>e.evidenceRef===ref));
 await h.service.saveReviewWork({row:h.getRow(),task:review,fence:{principalId:'executor',leaseToken:'lease',leaseGeneration:1},requestId:'save-review',proposal:changed,actualReadRefs:new Set(),targetIssueKeys:['action']},h.db as never);
 const overall=await h.prepare('OVERALL_CONSISTENCY');expect(overall.previousWork!.workRevisionRef).toBe('JAWR-2');
 const read=await h.service.readSources({...h.fence,sourceRefs:[ref],purpose:'Read corrected member provenance',context:'EXACT'});expect(read.sourceStatements).toEqual(review.modelInput.sourceStatements);
});


test.each(['v1','v2'] as const)('actual Summary member preserves complete %s issue work and reauthorizes exact Activity and original roots',async(version)=>{
 const h=serviceHarness(version==='v2'?activityFixtureV2() as never:undefined);const task=await h.prepare();const ref=task.sourceActivityProjections![0].entries[0].ref;
 await h.service.readSources({...h.fence,sourceRefs:[ref],purpose:'Read member source',context:'EXACT'});
 await h.service.saveWork({...h.fence,requestId:'member-save',expectedWorkRevision:0,workJson:JSON.stringify(h.command(ref))});
 const summary=new DerivedSummaryMembersService(h.service,{withActorScope:h.work.withActorScope} as never,h.originalReader as never);
 const member={kind:'WORK_ITEM_WORK' as const,workItemId:item.workItemId,workRef:h.history[0].workRevisionRef,workRevision:1,documentVersionId:item.source.documentVersionId,issueKeys:['action']};
 const reads=await summary.readAll([member],{tenantId:'tenant',actorUserId:'owner'},h.summaryDb as never);
 expect(reads[0].issues).toEqual(h.history[0].content.issues);expect(reads[0].body).toContain(h.history[0].content.issues[0].body);
 expect(reads[0].rootRefs).not.toContain(ref);expect(new Set(reads[0].rootRefs).size).toBe(reads[0].rootRefs.length);
 const actualProjection=jest.spyOn(h.service,'readSourceStatementProjections');
 await expect(summary.verifyOriginalEvidence(reads[0].evidence,{tenantId:'tenant',actorUserId:'owner'})).resolves.toBeUndefined();
 const projected=await actualProjection.mock.results[0].value;expect(projected[0].records[0].statement).toEqual(h.f.savedRevision.statements[0]);
 if(version==='v2') expect(projected[0].activityContexts[0].sourceContext).toEqual((h.f.savedRevision as unknown as {sourceContext:unknown}).sourceContext);
 h.setSaved({...h.f.savedRevision,runRef:'DAR-new',candidateRevision:8});
 await expect(summary.readAll([member],{tenantId:'tenant',actorUserId:'owner'},h.summaryDb as never)).rejects.toThrow('SOURCE_STATEMENT_UNAVAILABLE');
});


test('ordinary saved work→new Review retains the old v2 model contract without statement fields',async()=>{
 const h=serviceHarness();const initial=await h.prepare();const root=initial.sourceCatalog.find(e=>e.kind==='DOCUMENT_PASSAGE')!.evidenceRef;
 await h.service.saveWork({...h.fence,requestId:'plain-save',expectedWorkRevision:0,workJson:JSON.stringify(h.command(root))});
 const review=await h.prepare('PROBLEM_REVIEW');expect(review.schemaVersion).toBe('wiselink.jobaid-problem-task.v2');
 expect(review).not.toHaveProperty('sourceActivityProjections');expect(review.modelInput).not.toHaveProperty('sourceStatements');expect(review.modelInput).not.toHaveProperty('sourceStatementAvailability');expect(review.modelInput).not.toHaveProperty('evidenceProjectionVersion');
 expect(()=>assertJobAidProblemTaskBinding(review)).not.toThrow();
});


test('new task historical refs allow unchanged retention but require full current delivery for changed issues',async()=>{
 const h=serviceHarness();const initial=await h.prepare();const ref=initial.sourceActivityProjections![0].entries[0].ref;
 await h.service.readSources({...h.fence,sourceRefs:[ref],purpose:'First task actual read',context:'EXACT'});
 await h.service.saveWork({...h.fence,requestId:'first-task',expectedWorkRevision:0,workJson:JSON.stringify(h.command(ref))});
 const second=await h.prepare();expect(second.initiallyDeliveredRefs).not.toContain(ref);
 const changed=h.command(ref);changed.issues[0].body+=' Condition X is not established for this object.';
 await expect(h.service.saveWork({...h.fence,requestId:'changed-unread',expectedWorkRevision:1,workJson:JSON.stringify(changed)})).rejects.toThrow('SOURCE_STATEMENT_RECORD_NOT_DELIVERED');
 const same=await h.service.saveWork({...h.fence,requestId:'same-exact',expectedWorkRevision:1,workJson:JSON.stringify(h.command(ref))});expect(same.workRevision).toBe(2);
 const retained={...h.command(ref),issues:[],changeSummary:'Retained byte-equivalent prior issues'};
 await h.service.saveWork({...h.fence,requestId:'retained',expectedWorkRevision:2,workJson:JSON.stringify(retained)});
 expect(h.history[0].content.evidence.some(e=>e.evidenceRef===ref&&e.kind==='PRIOR_RESULT'&&e.sourceStatement)).toBe(true);
 await h.service.readSources({...h.fence,sourceRefs:[ref],purpose:'Read full record for changed issue',context:'EXACT'});
 const result=await h.service.saveWork({...h.fence,requestId:'changed-read',expectedWorkRevision:3,workJson:JSON.stringify(changed)});expect(result.workRevision).toBe(4);
});

import * as runtimePolicy from '../../server/modules/canonical-host/canonical-host-openclaw-runtime-policy';
import { parseTaskEnvelope } from '../../server/modules/action-attempt/action-attempt-envelope';
test.each(['v3','v2'] as const)('Host commit checks application provenance against the exact sealed %s task',async(version)=>{
 const h=serviceHarness();await h.prepare(version==='v3'?'INITIAL_PROBLEM_ASSESSMENT':'PROBLEM_REVIEW');
 const task=parseTaskEnvelope(h.getRow().taskEnvelopeJson!);
 const prepareCommit=jest.fn(async()=>({row:{status:'FAILED'}}));const projectTerminal=jest.fn(()=>({status:'FAILED'}));
 Object.assign(h.service,{attempts:{prepareCommit,projectTerminal}});
 const expectedVersion=version==='v3'?'3':'2';
 const result={toolVersions:{'jobaid-problem-protocol':expectedVersion},promptVersion:`wiselink-jobaid-problem@v${expectedVersion}`};
 const preflight=jest.spyOn(runtimePolicy,'preflightCanonicalHostOpenClawResult').mockReturnValue({task,result} as never);
 const input={row:h.getRow(),scope:{tenantId:'tenant',workItemId:item.workItemId,attemptRef:'OP-TEST',principalId:'executor'},leaseToken:'lease',leaseGeneration:1,result};
 try {
   await expect(h.service.commit(input as never)).resolves.toEqual({status:'FAILED'});expect(prepareCommit).toHaveBeenCalledTimes(1);
   result.promptVersion=version==='v3'?'wiselink-jobaid-problem@v2':'wiselink-jobaid-problem@v3';
   await expect(h.service.commit(input as never)).rejects.toThrow('JOBAID_RUNTIME_CAPABILITY_REQUIRED');expect(prepareCommit).toHaveBeenCalledTimes(1);
 } finally {preflight.mockRestore();}
});


test('overview statement citations require actual record delivery and persist lineage; exact historical copy can be retained',async()=>{
 const h=serviceHarness();const initial=await h.prepare();const statement=initial.sourceActivityProjections![0].records[0];
 const root=initial.sourceCatalog.find(e=>e.kind==='DOCUMENT_PASSAGE')!.evidenceRef;
 const command=h.command(root);command.overview=`Retain the source condition [[${statement.ref}]]`;
 await expect(h.service.saveWork({...h.fence,requestId:'overview-unread',expectedWorkRevision:0,workJson:JSON.stringify(command)})).rejects.toThrow('SOURCE_NOT_DELIVERED');
 expect(h.work.save).not.toHaveBeenCalled();
 await h.service.readSources({...h.fence,sourceRefs:[statement.ref],purpose:'Read complete statement for overview',context:'EXACT'});
 await h.service.saveWork({...h.fence,requestId:'overview-read',expectedWorkRevision:0,workJson:JSON.stringify(command)});
 expect(h.history[0].content.understanding).toBe(command.overview);expect(h.history[0].content.readSourceRefs).toContain(statement.ref);
 expect(h.history[0].content.evidence.find(e=>e.evidenceRef===statement.ref)).toMatchObject({kind:'PRIOR_RESULT',sourceStatement:{reference:statement.reference}});
 expect(assessmentEvidenceRoots([statement.ref],h.history[0].content.evidence).unresolvedRefs).toEqual([]);
 const second=await h.prepare();expect(second.initiallyDeliveredRefs).not.toContain(statement.ref);
 const retain={...command,issues:[]};await h.service.saveWork({...h.fence,requestId:'overview-retain',expectedWorkRevision:1,workJson:JSON.stringify(retain)});
 const changed={...retain,overview:`Changed source-based overview [[${statement.ref}]]`};
 await expect(h.service.saveWork({...h.fence,requestId:'overview-changed-unread',expectedWorkRevision:2,workJson:JSON.stringify(changed)})).rejects.toThrow('SOURCE_STATEMENT_RECORD_NOT_DELIVERED');
 for(const field of ['headline','listBrief','completionReason','changeSummary','unchangedExplanation'] as const) {
   const update={...retain,[field]:`Changed source citation [[${statement.ref}]]`};
   if(field==='headline'||field==='listBrief'){update.headline=`Source citation [[${statement.ref}]]`;update.listBrief=`Source citation [[${statement.ref}]]`;}
   await expect(h.service.saveWork({...h.fence,requestId:`copy-unread-${field}`,expectedWorkRevision:2,workJson:JSON.stringify(update)})).rejects.toThrow('SOURCE_STATEMENT_RECORD_NOT_DELIVERED');
 }
});


import { buildJobAidOverallProjection } from '../../server/modules/canonical-host/jobaid-overall-projection';
import { jobAidReadingResult } from '../../server/modules/canonical-host/jobaid-problem-work';

test.each(['v1','v2'] as const)('full same-version %s correction saves summary, body, risk, requirement conditions and measure state consistently through exact Overall', async(version)=>{
 const h=serviceHarness(version==='v2'?activityFixtureV2() as never:undefined);const initial=await h.prepare();const ref=initial.sourceActivityProjections![0].entries[0].ref;
 await h.service.readSources({...h.fence,sourceRefs:[ref],purpose:'Actual bounded source read',context:'EXACT'});
 const original=h.command(ref);original.issues.push({...h.command(ref).issues[0],issueKey:'unaffected',question:'Independent unresolved issue',body:`Retain separate scope [[${ref}]]`});
 await h.service.saveWork({...h.fence,requestId:'complete-before-correction',expectedWorkRevision:0,workJson:JSON.stringify(original)});
 const unchanged=structuredClone(h.history[0].content.issues[1]);
 const review=await h.prepare('PROBLEM_REVIEW');
 const method=review.initiallyDeliveredRefs.find(value=>review.sourceCatalog.some(e=>e.evidenceRef===value&&e.kind==='METHOD_CLAUSE'))!;
 const correctedOverview=`Only if X is confirmed may the source candidate apply. Risk magnitude is unknown and the check remains proposed [[${ref}]].`;
 const proposal={...h.command(ref),headline:'Conditional action; applicability unknown',listBrief:'Condition X remains unconfirmed; the proposed check is not verified effective',overview:undefined,issues:[{
  issueKey:'action',question:'Is X confirmed before the proposed action?',body:`Corrected bounded reading: do not proceed unless X is confirmed. No implementation or effect verification has been supplied [[${ref}]].`,
  riskScenarios:[{scenario:'Bounded source condition could affect the object',conditions:['Only under X','Object scope remains unconfirmed'],method:'JA_AC_R01',severity:null,likelihood:null,limitations:['No severity or frequency basis has been delivered'],controlComparison:'Proposed check has no verified effect'}],
  measures:[{text:'Check condition X before proceeding',addresses:'Unconfirmed scope',limitations:['No implementation evidence','No effect verification'],status:'PROPOSED',basisRefs:[ref]}],
  otherClassifications:[{method:'SOURCE_DOCUMENT_CLASSIFICATION',value:'Source classification candidate',reason:'Independent of JA-AC grading',basisRefs:[ref]}],
  openQuestions:[{question:'Does X hold for this object?',affects:'Applicability',nextEvidence:'Controlled object data',reason:'The source alone does not establish target facts'}],
  requirementHandling:[{methodRef:method,requirement:'Verify the decisive applicability condition',conditions:['Only under X'],treatment:'CONDITIONS_UNCONFIRMED',basisRefs:[ref],explanation:'Keep the requirement bounded until object data is provided',bodyQuote:'do not proceed unless X is confirmed.'}],
 }],roundCompletion:'COMPLETE_WITH_OPEN_QUESTIONS',completionReason:original.completionReason,changeSummary:'Corrected action issue and its summary consistently',unchangedExplanation:'Independent issue retained exactly'};
 await h.service.saveReviewWork({row:h.getRow(),task:review,fence:{principalId:'executor',leaseToken:'lease',leaseGeneration:1},requestId:'full-correction',proposal,actualReadRefs:new Set(),targetIssueKeys:['action']},h.db as never);
 const local=h.history[0];expect(local.workRevisionRef).toBe('JAWR-2');expect(local.content.overviewStatus).toBe('STALE');
 const localRead=await h.service.readAttemptWork(h.fence.attemptRef,'full-correction');expect(localRead.revision).toEqual(local);
 const overallTask=await h.prepare('OVERALL_CONSISTENCY');expect(overallTask.previousWork!.workRevisionRef).toBe(local.workRevisionRef);expect(overallTask.previousWork!.content).toEqual(local.content);
 await h.service.readSources({...h.fence,sourceRefs:[ref],purpose:'Actual exact source re-read for corrected Overall',context:'EXACT'});
 const finalCopy={...proposal,issues:[],overview:correctedOverview,completionReason:'Saved bounded correction; object condition remains unknown',changeSummary:'Updated Overall from the exact corrected issue work'};
 await h.service.saveWork({...h.fence,requestId:'corrected-overall-save',expectedWorkRevision:2,workJson:JSON.stringify(finalCopy)});
 const corrected=h.history[0];expect(corrected.workRevisionRef).toBe('JAWR-3');expect(corrected.content.overviewStatus).toBe('CURRENT');expect(corrected.content.issues[1]).toEqual(unchanged);
 expect(corrected.content).toMatchObject({headline:proposal.headline,listBrief:proposal.listBrief,understanding:finalCopy.overview,completionReason:finalCopy.completionReason,changeSummary:finalCopy.changeSummary,roundCompletion:proposal.roundCompletion});
 expect(corrected.content.issues[0]).toMatchObject(proposal.issues[0]);expect(corrected.content.issues[0].riskScenarios[0]).toMatchObject({score:null,riskGrade:null,gradeMeaning:null});
 expect(corrected.content.issues[0].measures[0].status).toBe('PROPOSED');
 const exact=await h.service.readAttemptWork(h.fence.attemptRef,'corrected-overall-save');expect(exact.revision).toEqual(corrected);
 const finalOverallTask=await h.prepare('OVERALL_CONSISTENCY');expect(finalOverallTask.previousWork!.workRevisionRef).toBe(corrected.workRevisionRef);expect(finalOverallTask.previousWork!.content).toEqual(corrected.content);
 const projectedItem={...item,integratedAssessment:{baseRules:{revision:2,artifact:{ref:'artifact://base',sha256:'c'.repeat(64),byteLength:1}}}} as never;
 const overall=buildJobAidOverallProjection({workItem:projectedItem,revision:corrected,artifact:{storeRole:'UnifiedArtifactStoreCandidate',ref:'artifact://overall',sha256:'d'.repeat(64),byteLength:1,mediaType:'application/json'},actionAttemptId:'ATT-projection',sourceResultId:'RESULT-corrected',applicabilityStatus:'UNCONFIRMED'});
 expect(overall.basedOnJobAidWorkRevisionRef).toBe(corrected.workRevisionRef);expect(overall.overallCandidate).toBe(finalCopy.overview);expect(overall.readingResult).toEqual(jobAidReadingResult(corrected));
 expect(overall.missingInputs).toContain(proposal.issues[0].openQuestions[0].question);expect(JSON.stringify(overall.readingResult)).not.toContain('VERIFIED_EFFECTIVE');
});

test.each(['actor','source'] as const)('fresh %s revocation after actual READ rejects dependent SAVE',async(kind)=>{
 const h=serviceHarness();const task=await h.prepare();const ref=task.sourceActivityProjections![0].entries[0].ref;
 await h.service.readSources({...h.fence,sourceRefs:[ref],purpose:'Read before permission change',context:'EXACT'});
 if(kind==='actor')h.deactivate();else h.revoke();
 await expect(h.service.saveWork({...h.fence,requestId:'save-after-revocation',expectedWorkRevision:0,workJson:JSON.stringify(h.command(ref))})).rejects.toThrow('AUTHORIZATION_CHANGED');
 expect(h.work.save).not.toHaveBeenCalled();
});

test('a v2 schema tag alone cannot reinterpret legacy saved bytes without the exact v2 context and fields',async()=>{
 const h=serviceHarness();h.setSaved({...h.f.savedRevision,schemaVersion:'wiselink.document.activity-candidate.v2'} as never);
 await expect(h.prepare()).rejects.toThrow('SOURCE_CONTEXT_MISMATCH');expect(h.work.save).not.toHaveBeenCalled();
});

test('source-statement work cannot save after its exact lease fence expires',async()=>{
 const h=serviceHarness();const task=await h.prepare();const ref=task.sourceActivityProjections![0].entries[0].ref;
 await h.service.readSources({...h.fence,sourceRefs:[ref],purpose:'Read with active lease',context:'EXACT'});
 h.getRow().leaseExpiresAt=new Date('2000-01-01T00:00:00Z');
 await expect(h.service.saveWork({...h.fence,requestId:'expired-source-save',expectedWorkRevision:0,workJson:JSON.stringify(h.command(ref))})).rejects.toThrow('LEASE');
 expect(h.history).toEqual([]);
});


function activityFixtureV2() {
 const f=activityFixture('Supplier plans release in Q4 2026; expected approval March 2027. Actual installation TBD. LN 2024-2026. Supplier reports completed. Only after CIDB, do not install.');
 const old=f.savedRevision;const sourceContext=buildDocumentActivitySourceContext({original:f.original,semanticMap:f.semanticMap,sourceBinding:old.sourceBinding,selection:old.readCoverage.selection,deliveredRanges:old.readCoverage.deliveredRanges});
 const main=old.sourceAnchors.find(a=>a.sourceUnitId==='u1')!;const parent=old.sourceAnchors.find(a=>a.sourceUnitId==='condition')!;
 const proposal:DocumentActivityCandidateProposalV2={schemaVersion:DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2,statements:[{statementKey:'planned',label:'Saved v2 source candidate',
  quotes:[main,parent].map(a=>({anchorId:a.anchorId,start:0,end:a.sourceText.length,text:a.sourceText})),
  subject:{raw:'Supplier',quoteIndex:0},action:{raw:'release',quoteIndex:0},modality:{raw:'plans',quoteIndex:0,meaning:'PLANNED',negationQuoteIndexes:[0,1]},
  status:{raw:'reports completed',quoteIndex:0,meaning:'SOURCE_REPORTED_COMPLETED'},times:[
   {role:'TARGET',precision:'QUARTER',expression:'CALENDAR',raw:'Q4 2026',quoteIndex:0},
   {role:'UNKNOWN',precision:'MONTH',expression:'CALENDAR',raw:'March 2027',quoteIndex:0},
   {role:'UNKNOWN',precision:'UNKNOWN',expression:'TBD',raw:'TBD',quoteIndex:0}],
  technicalIds:[{kind:'AIRCRAFT_LINE_NUMBER',raw:'LN 2024-2026',quoteIndex:0}],
  scope:{sectionIds:['section:h-child'],conditions:[{raw:'Only after CIDB',quoteIndex:0,kind:'PREREQUISITE',appliesTo:'STATEMENT',sectionIds:[]},{raw:'Only when X holds',quoteIndex:1,kind:'CONDITION',appliesTo:'SECTION',sectionIds:['section:h-child']}],completeness:'DELIVERED_SCOPE_ONLY'},
  limitations:['Expected approval remains forecast source wording; no target execution or effective-control proof.']} ]};
 const candidate=validateDocumentActivityCandidate(proposal,{sourceBinding:old.sourceBinding,selection:old.readCoverage.selection,deliveredRanges:old.readCoverage.deliveredRanges,deliveredAnchors:old.sourceAnchors,sourceCoverage:old.readCoverage.sourceCoverage,sourceContext});
 const savedRevision=materializeDocumentActivityRevision(candidate,{runRef:old.runRef,candidateRevision:old.candidateRevision,statementIds:['DAS-fixture-1'],producer:old.producer,savedAt:old.savedAt});
 return {...f,savedRevision};
}

test('v2 D0 preserves every captured cue, all times, negation, technical IDs and the actual run context',()=>{
 const f=activityFixtureV2();const before=JSON.stringify(f);const p=projectSavedDocumentActivityForAssessment(f);
 expect(p.records[0].sourceSchemaVersion).toBe(DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2);expect(p.records[0].statement).toEqual(f.savedRevision.statements[0]);
 expect(p.records[0].statement).not.toHaveProperty('time');expect(p.entries[0]).toMatchObject({sourceSchemaVersion:DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2,semanticFieldsAvailability:'V2_CAPTURED_FIELDS_ONLY',scopeBasis:'ACTUAL_DELIVERED_RUN_SCOPE'});
 expect(p.activityContexts[0].sourceContext).toEqual(f.savedRevision.sourceContext);expect(p.records[0].requiredContextRootRefs).toEqual(f.originalEvidence.map(e=>e.evidenceRef));expect(JSON.stringify(f)).toBe(before);
 const drift=structuredClone(f);drift.savedRevision.sourceContext.sections[0].contextForSectionIds=[];
 expect(()=>projectSavedDocumentActivityForAssessment(drift)).toThrow('SOURCE_CONTEXT_MISMATCH');
});

test('saved v2 actual build→READ→SAVE→exact Overall exposes raw fields without upgrading measure state',async()=>{
 const f=activityFixtureV2();const h=serviceHarness(f as never);const task=await h.prepare();expect(task.schemaVersion).toBe('wiselink.jobaid-problem-task.v3');expect(task.modelInput.evidenceProjectionVersion).toBe('SOURCE_CONTEXT_V2');
 expect(task.modelInput.sourceStatementAvailability?.semanticFieldsAvailability).toBe('CAPTURED_FIELDS_ONLY');const ref=task.sourceActivityProjections![0].records[0].ref;expect(task.initiallyDeliveredRefs).not.toContain(ref);
 const receipt=await h.service.readSources({...h.fence,sourceRefs:[ref],purpose:'Actually read saved v2 source and all conditions',context:'EXACT'});expect(receipt.sourceStatements![0].statement).toEqual(f.savedRevision.statements[0]);expect(receipt.activityContexts![0].sourceContext).toEqual(f.savedRevision.sourceContext);
 await h.service.saveWork({...h.fence,requestId:'v2-candidate-save',expectedWorkRevision:0,workJson:JSON.stringify(h.command(ref))});expect(h.history[0].content.issues[0].measures[0].status).toBe('PROPOSED');
 const overall=await h.prepare('OVERALL_CONSISTENCY');expect(overall.previousWork!.workRevisionRef).toBe('JAWR-1');const reread=await h.service.readSources({...h.fence,sourceRefs:[ref],purpose:'Read the exact saved v2 provenance for Overall',context:'EXACT'});expect(reread.sourceStatements).toEqual(receipt.sourceStatements);
 h.setSaved({...f.savedRevision,runRef:'DAR-new',candidateRevision:8} as never);await expect(h.service.readSources({...h.fence,sourceRefs:[ref],purpose:'Never substitute another v2 run',context:'EXACT'})).rejects.toThrow('SOURCE_STATEMENT_UNAVAILABLE');
});

test.each(['actor','source'] as const)('fresh %s revocation after v2 READ rejects dependent SAVE',async(kind)=>{
 const h=serviceHarness(activityFixtureV2() as never);const task=await h.prepare();const ref=task.sourceActivityProjections![0].records[0].ref;await h.service.readSources({...h.fence,sourceRefs:[ref],purpose:'V2 actual delivery before revocation',context:'EXACT'});if(kind==='actor')h.deactivate();else h.revoke();
 await expect(h.service.saveWork({...h.fence,requestId:'v2-revoked-save',expectedWorkRevision:0,workJson:JSON.stringify(h.command(ref))})).rejects.toThrow('AUTHORIZATION_CHANGED');expect(h.history).toEqual([]);
});

test('new mixed Review preserves exact v2 records and full sourceContext under its existing sealed v2 branch',async()=>{
 const f=activityFixtureV2();const h=serviceHarness(f as never);const initial=await h.prepare();const ref=initial.sourceActivityProjections![0].records[0].ref;
 await h.service.readSources({...h.fence,sourceRefs:[ref],purpose:'Actually read full v2 source before initial work',context:'EXACT'});
 await h.service.saveWork({...h.fence,requestId:'v2-before-review',expectedWorkRevision:0,workJson:JSON.stringify(h.command(ref))});
 const review=await h.prepare('PROBLEM_REVIEW');expect(review.schemaVersion).toBe('wiselink.jobaid-problem-task.v2');expect(review.modelInput.evidenceProjectionVersion).toBe('SOURCE_CONTEXT_V2');expect(()=>assertJobAidProblemTaskBinding(review)).not.toThrow();
 expect(review.modelInput.sourceStatements![0].statement).toEqual(f.savedRevision.statements[0]);expect(review.modelInput.activityContexts![0].sourceContext).toEqual(f.savedRevision.sourceContext);
 const changed=h.command(ref);changed.issues[0].body+=' The source-reported completion does not verify target execution or effectiveness.';
 await h.service.saveReviewWork({row:h.getRow(),task:review,fence:{principalId:'executor',leaseToken:'lease',leaseGeneration:1},requestId:'v2-review-save',proposal:changed,actualReadRefs:new Set(),targetIssueKeys:['action']},h.db as never);
 expect(h.history[0].content.issues[0].measures[0].status).toBe('PROPOSED');expect(h.history[0].content.issues[0].sourceDependencies).toContain(ref);
});


test.each(['actor','source'] as const)('actual v2 Summary fresh %s revocation blocks exact saved-source reread',async(kind)=>{
 const h=serviceHarness(activityFixtureV2() as never);const task=await h.prepare();const ref=task.sourceActivityProjections![0].records[0].ref;
 await h.service.readSources({...h.fence,sourceRefs:[ref],purpose:'Actually read v2 source for Summary member',context:'EXACT'});
 await h.service.saveWork({...h.fence,requestId:'v2-summary-member-save',expectedWorkRevision:0,workJson:JSON.stringify(h.command(ref))});
 const summary=new DerivedSummaryMembersService(h.service,{withActorScope:h.work.withActorScope} as never,h.originalReader as never);
 const member={kind:'WORK_ITEM_WORK' as const,workItemId:item.workItemId,workRef:h.history[0].workRevisionRef,workRevision:1,documentVersionId:item.source.documentVersionId,issueKeys:['action']};
 const reads=await summary.readAll([member],{tenantId:'tenant',actorUserId:'owner'},h.summaryDb as never);
 await expect(summary.verifyOriginalEvidence(reads[0].evidence,{tenantId:'tenant',actorUserId:'owner'})).resolves.toBeUndefined();
 if(kind==='actor')h.deactivate();else h.revoke();
 await expect(summary.verifyOriginalEvidence(reads[0].evidence,{tenantId:'tenant',actorUserId:'owner'})).rejects.toThrow('SOURCE_AUTHORIZATION_CHANGED');
});

test('historical NOT_RECORDED candidate stays byte-exact when its semantic map already has a saved receipt', () => {
 const f=activityFixtureV2();
 f.semanticMap.profileSelection={policyVersion:'host-family-original-headings.v1',reason:'REGISTERED_FAMILY_ISSUER',registeredIdentity:{family:'SB',issuer:'BOEING'},evidenceSourceRefIds:['SR-TEST-P1']};
 const before=JSON.stringify(f);
 const projected=projectSavedDocumentActivityForAssessment(f);
 expect(projected.activityContexts[0].sourceContext).toEqual(f.savedRevision.sourceContext);
 expect(projected.activityContexts[0].sourceContext!.profile).toEqual({profileRef:f.semanticMap.profileRef,selectionBasis:'NOT_RECORDED',family:null,issuer:null});
 expect(projected.records[0].statement).toEqual(f.savedRevision.statements[0]);
 expect(JSON.stringify(f)).toBe(before);
 const bad=structuredClone(f);
 (bad.savedRevision.sourceContext.profile as unknown as Record<string,unknown>).issuer='BOEING';
 expect(()=>projectSavedDocumentActivityForAssessment(bad)).toThrow('SOURCE_CONTEXT_MISMATCH');
});

test('recorded saved-candidate provenance must equal its exact semantic revision, including historical policy and evidence refs', () => {
 const f=activityFixtureV2();
 f.semanticMap.profileSelection={policyVersion:'host-family-original-headings.v1',reason:'REGISTERED_FAMILY_ISSUER',registeredIdentity:{family:' SB ',issuer:' Boeing '},evidenceSourceRefIds:['SR-TEST-P1']};
 f.savedRevision.sourceContext=buildDocumentActivitySourceContext({original:f.original,semanticMap:f.semanticMap,sourceBinding:f.savedRevision.sourceBinding,selection:f.savedRevision.readCoverage.selection,deliveredRanges:f.savedRevision.readCoverage.deliveredRanges});
 const before=JSON.stringify(f), projected=projectSavedDocumentActivityForAssessment(f);
 expect(projected.activityContexts[0].sourceContext).toEqual(f.savedRevision.sourceContext);
 expect(JSON.stringify(f)).toBe(before);
 for(const field of ['policyVersion','reason','evidenceSourceRefIds'] as const){
  const drift=structuredClone(f);
  if(drift.savedRevision.sourceContext.profile.selectionBasis==='RECORDED'){
   const receipt=drift.savedRevision.sourceContext.profile.selection as unknown as Record<string,unknown>;
   receipt[field]=field==='evidenceSourceRefIds'?[]:'changed';
  }
  expect(()=>projectSavedDocumentActivityForAssessment(drift)).toThrow('SOURCE_CONTEXT_MISMATCH');
 }
 const missing=structuredClone(f);delete missing.semanticMap.profileSelection;
 expect(()=>projectSavedDocumentActivityForAssessment(missing)).toThrow('SOURCE_CONTEXT_MISMATCH');
});
