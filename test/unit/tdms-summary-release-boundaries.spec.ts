import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AssessmentTdmsNativeEvidence } from '@shared/assessment-tdms-evidence';
import type { DerivedSummaryMember, DerivedSummaryMemberReading } from '@shared/derived-summary.interface';
import { canonicalJson, canonicalSha256 } from '../../server/modules/action-attempt/action-attempt-envelope';
import { taskModelSelection } from '../../server/modules/model-settings/canonical-model-catalog';
import { DerivedSummaryMembersService } from '../../server/modules/canonical-host/derived-summary-members.service';
import { DerivedSummaryRepository } from '../../server/modules/canonical-host/derived-summary.repository';
import { DerivedSummaryService } from '../../server/modules/canonical-host/derived-summary.service';
import { DerivedSummaryRuntimeService } from '../../server/modules/canonical-host/derived-summary-runtime.service';
import { tdmsNativeEvidenceFixture } from './fixtures/tdms-native-evidence.fixture';

const actor = {tenantId:'fixture-tenant',actorUserId:'fixture-owner'};
const clone = <T>(value:T):T => structuredClone(value);
const scope = {appId:'app_17bzc551rsg',tenantId:actor.tenantId,principalId:'fixture-runtime-principal',authorizationFingerprint:'fixture-scope'};
const member: DerivedSummaryMember = {kind:'WORK_ITEM_WORK',workItemId:'work-1',documentVersionId:'document-1',workRef:'saved-1',workRevision:1,issueKeys:[]};
const selection = {kind:'ATA4' as const,title:'Fixture scope',fleetFamilyId:'F',fleetModelIds:['MODEL'],ata2:'46',ata4:'46-00',selectionReason:'Explicit fixture'};

type Fault = 'NONE' | 'JOURNAL' | 'INSERT' | 'CAS' | 'METADATA';
/** Exercises actual RuntimeService and actual repository transaction wrapper;
 * deterministic database/authority doubles are development evidence only. */
async function harness(fault:Fault='NONE', mutation: 'PERMISSION'|'BODY'|'RECEIPT' = 'PERMISSION') {
  const evidence = tdmsNativeEvidenceFixture(); const retained=clone(evidence); let allowed=true,inTransaction=false;
  const state = {journal:0,revisions:[] as unknown[],commits:0,rollbacks:0};
  const head = {summaryId:'summary-1',currentRevision:0,currentSummaryRef:null as string|null,scopeJson:selection,membersJson:[member]};
  const faultAt = (point:Fault) => { if(fault!==point)return; if(mutation==='PERMISSION')allowed=false;else if(mutation==='BODY')retained.excerpt='MUTATED_AFTER_AWAIT';else retained.nativeReadReceipt.taskContextRef='FORGED_AFTER_AWAIT'; };
  const assertAllowed = (items:AssessmentTdmsNativeEvidence[] = []) => {
    if(!allowed)throw new Error('FIXTURE_NATIVE_REVOKED_AFTER_AWAIT');
    if(items.some(item=>item.excerpt!==retained.excerpt))throw new Error('FIXTURE_NATIVE_BODY_CHANGED_AFTER_AWAIT');
    if(items.some(item=>canonicalJson(item.nativeReadReceipt)!==canonicalJson(retained.nativeReadReceipt)))throw new Error('FIXTURE_NATIVE_RECEIPT_CHANGED_AFTER_AWAIT');
  };
  const noRootInTransaction = () => {if(inTransaction)throw new Error('ROOT_POOL_NATIVE_IO_FORBIDDEN');};
  const verifier = {
    authorize: jest.fn(async(items:AssessmentTdmsNativeEvidence[])=>{noRootInTransaction();assertAllowed(items);return items.map(item=>({evidenceRef:item.evidenceRef,sourceRevisionRef:item.nativeSource.sourceRevisionRef,
      processingSetBinding:item.nativeScope.processingSetBinding,permissionRevision:'fixture-current',sourceAudienceAuthorized:true as const,selectedObjectAuthorized:true as const}));}),
    readExactEvidence:jest.fn(async(items:AssessmentTdmsNativeEvidence[])=>{noRootInTransaction();assertAllowed(items);return clone(items);}),
    assertCurrentEvidence:jest.fn(async({evidence:items}:{evidence:AssessmentTdmsNativeEvidence[]})=>{noRootInTransaction();assertAllowed(items);}),
    assertInTransaction:jest.fn(async(input:{database:unknown;evidence:AssessmentTdmsNativeEvidence[];summaryCaller?:unknown})=>{expect(input.database).toBe(database);assertAllowed(input.evidence);}),
  };
  let attempt: Record<string,unknown>;
  const database = {
    execute:jest.fn(async(query:unknown)=>new PgDialect().sqlToQuery(query as never).sql.includes('max(semantic_revision)') ? [] : [{allowed:true}]),
    select:jest.fn(()=>({from:(table:unknown)=>{
      const rows = () => getTableName(table as never)==='identity_subject_mapping' ? [{id:'verified-fixture-mapping'}]
        : getTableName(table as never)==='derived_summary_revision' ? (faultAt('METADATA'),state.revisions)
        : getTableName(table as never)==='work_item' ? [{workItemId:'work-1',documentVersionId:'document-1',revision:1,projectionJson:'{}'}]
        : getTableName(table as never)==='assessment_work_revision' ? [{ref:'saved-1',revision:1}]
        : getTableName(table as never)==='dm_document_version' ? [{familyId:'family-1',selectedHead:'document-1',currentGeneration:1,status:'ACTIVE'}] : [];
      const query = {where:()=>query,orderBy:()=>query,innerJoin:()=>query,limit:async()=>rows(),for:async()=>rows(),then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(rows()).then(resolve)};
      return query;
    }})),
    insert:jest.fn(()=>({values:async(value:unknown)=>{state.revisions.push(value);faultAt('INSERT');}})),
    update:jest.fn((table:unknown)=>({set:(value:Record<string,unknown>)=>{
      const run = () => {if(getTableName(table as never)==='derived_summary'){Object.assign(head,value);faultAt('CAS');}
        else {state.journal++;faultAt('JOURNAL');}return [{id:'summary-1'}];};
      const query={where:()=>query,returning:async()=>run(),then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(run()).then(resolve)};return query;
    }})),
  };
  const transactions={withActorTransaction:jest.fn(async(_actor:string,operation:(input:{database:unknown})=>Promise<unknown>)=>{
    const old={journal:state.journal,revisions:clone(state.revisions),head:clone(head)};
    inTransaction=true;try {const result=await operation({database});state.commits++;return result;} catch(error){state.journal=old.journal;state.revisions=old.revisions;Object.assign(head,old.head);state.rollbacks++;throw error;}finally{inTransaction=false;}
  })};
  const jobAid={readSummaryMemberInTransaction:jest.fn(async()=>({current:true,revision:{workRevision:1,documentVersionId:'document-1',content:{headline:'Saved exact work',understanding:'Saved exact body',issues:[],evidence:[evidence],overviewStatus:'CURRENT'}}}))};
  const members=new DerivedSummaryMembersService(jobAid as never,transactions as never,undefined,verifier);
  const [reading]=await members.readAll([member],actor,database as never);
  const root={execute:jest.fn(async()=>[{actorUserId:actor.actorUserId}])};
  const repository=new DerivedSummaryRepository(root as never,transactions as never,members);
  const contextBasis=await repository.contextBasis([reading!],actor,database as never);
  const basis={schemaVersion:'wiselink.derived-summary-task.v1',taskType:'OPENCLAW_DERIVED_SUMMARY',subject:{kind:'DERIVED_SUMMARY',summaryId:'summary-1'},expectedSummaryRevision:0,
    requestId:'request-1',actionAttemptId:'attempt-1',operationRef:'operation-1',deadlineAt:'2099-01-01T00:00:00.000Z',executionModel:taskModelSelection('miaoda/glm-5.3',new Date('2026-10-07T00:00:00Z')),
    contextBasis, modelInput:{scope:selection,classificationStatus:'CANDIDATE',instruction:'Retain conditions',members:[reading],evidence:[evidence],limitations:[]}};
  const task={...basis,taskInputHash:canonicalSha256(basis)};
  attempt={summaryId:'summary-1',attemptId:'attempt-1',operationRef:'operation-1',actorUserId:actor.actorUserId,tenantId:actor.tenantId,delegatedPrincipalId:scope.principalId,
    status:'RUNNING',leaseOwner:scope.principalId,leaseToken:'lease-1',leaseGeneration:1,leaseExpiresAt:new Date('2099-01-01T00:00:00Z'),deadlineAt:new Date(task.deadlineAt),
    triggerRequestId:'request-1',baseRevision:0,inputRevision:0,taskEnvelopeJson:canonicalJson(task),taskInputHash:task.taskInputHash,executionModelJson:canonicalJson(task.executionModel),
    requestCommandJson:canonicalJson({requestId:basis.requestId,expectedSummaryRevision:0,scope:selection,members:[member],instruction:basis.modelInput.instruction,modelRef:task.executionModel.modelRef}),reviewActivityJson:canonicalJson([{kind:'DERIVED_SUMMARY_MEMBERS_READ',evidenceRefs:[reading!.evidenceRef]}])};
  jest.spyOn(repository,'head').mockImplementation(async()=>head as never);
  jest.spyOn(repository,'attempt').mockImplementation(async()=>attempt as never);
  const summaries=new DerivedSummaryService(repository,members,{} as never);
  // Keep the real S3 context collection, locks and task-access check in this harness.
  const runtime=new DerivedSummaryRuntimeService(repository,members,summaries);
  const target={summaryId:'summary-1',attemptRef:'operation-1',scope,leaseToken:'lease-1',leaseGeneration:1};
  return {runtime,repository,summaries,members,database,verifier,state,head,task,reading:reading!,evidence,target,
    jobAid,transactions,restorePermission:()=>{allowed=true;}};
}

for (const operation of ['readMemberWork','readSources'] as const) it(`actual ${operation} rejects revocation during its journal await and rolls back`,async()=>{
  const h=await harness('JOURNAL');
  await expect(h.runtime[operation]({...h.target,evidenceRefs:[operation==='readMemberWork'?h.reading.evidenceRef:h.evidence.evidenceRef],purpose:'Read exact fixture'} as never))
    .rejects.toThrow('FIXTURE_NATIVE_REVOKED_AFTER_AWAIT');
  expect(h.state.journal).toBe(0);expect(h.state.rollbacks).toBe(1);
});
for (const fault of ['INSERT','CAS','JOURNAL'] as const) it(`actual SAVE rejects native revocation during ${fault} and rolls back revision/head/journal`,async()=>{
  const h=await harness(fault);
  await expect(h.runtime.save({...h.target,requestId:'request-1',expectedSummaryRevision:0,
    contentJson:JSON.stringify({headline:'Candidate',listBrief:'Limited',body:`Saved candidate [[${h.reading.evidenceRef}]]`,limitations:[]})} as never))
    .rejects.toThrow('FIXTURE_NATIVE_REVOKED_AFTER_AWAIT');
  expect(h.state.revisions).toHaveLength(0);expect(h.head.currentRevision).toBe(0);expect(h.head.currentSummaryRef).toBeNull();expect(h.state.journal).toBe(0);
});

for(const mutation of ['BODY','RECEIPT'] as const)for (const operation of ['readMemberWork','readSources'] as const) it(`actual ${operation} rejects ${mutation} substitution during journal`,async()=>{
  const h=await harness('JOURNAL',mutation);
  await expect(h.runtime[operation]({...h.target,evidenceRefs:[operation==='readMemberWork'?h.reading.evidenceRef:h.evidence.evidenceRef],purpose:'Read exact fixture'} as never))
    .rejects.toThrow(`FIXTURE_NATIVE_${mutation}_CHANGED_AFTER_AWAIT`);
  expect(h.state.journal).toBe(0);expect(h.state.rollbacks).toBe(1);
});
for(const mutation of ['BODY','RECEIPT'] as const)for(const fault of ['INSERT','CAS','JOURNAL'] as const)it(`actual SAVE rejects ${mutation} substitution during ${fault}`,async()=>{
  const h=await harness(fault,mutation);
  await expect(h.runtime.save({...h.target,requestId:'request-1',expectedSummaryRevision:0,
    contentJson:JSON.stringify({headline:'Candidate',listBrief:'Limited',body:`Saved candidate [[${h.reading.evidenceRef}]]`,limitations:[]})} as never))
    .rejects.toThrow(`FIXTURE_NATIVE_${mutation}_CHANGED_AFTER_AWAIT`);
  expect(h.state.revisions).toHaveLength(0);expect(h.head.currentRevision).toBe(0);expect(h.head.currentSummaryRef).toBeNull();expect(h.state.journal).toBe(0);
});
it('actual Summary native caller denies an absent TX capability without root-pool fallback',async()=>{
  const h=await harness();h.verifier.assertInTransaction=undefined as never;
  await expect(h.runtime.readMemberWork({...h.target,evidenceRefs:[h.reading.evidenceRef],purpose:'Read'} as never)).rejects.toThrow('TDMS_NATIVE_TRANSACTION_AUTHORIZATION_NOT_CONNECTED');
  expect(h.state.journal).toBe(0);expect(h.verifier.authorize).not.toHaveBeenCalled();expect(h.verifier.readExactEvidence).not.toHaveBeenCalled();
});
it('actual Summary native release passes exact runtime caller and TX identity after journal',async()=>{
  const h=await harness();
  await expect(h.runtime.readMemberWork({...h.target,evidenceRefs:[h.reading.evidenceRef],purpose:'Read'} as never)).resolves.toHaveProperty('members');
  expect(h.state.journal).toBe(1);expect(h.state.commits).toBe(1);
  expect(h.verifier.assertInTransaction.mock.calls.at(-1)?.[0]).toMatchObject({database:h.database,summaryCaller:{kind:'RUNTIME',summaryId:'summary-1',attemptRef:'operation-1',scope},evidence:[h.evidence]});
  expect(h.verifier.authorize).not.toHaveBeenCalled();expect(h.verifier.readExactEvidence).not.toHaveBeenCalled();
});

it('metadata-only STATUS rechecks hidden native carriers after its last await and rolls back',async()=>{
  const h=await harness('METADATA');
  await expect(h.runtime.status(h.target)).rejects.toThrow('FIXTURE_NATIVE_REVOKED_AFTER_AWAIT');
  const last=h.verifier.assertInTransaction.mock.calls.at(-1)?.[0];
  expect(last).toMatchObject({database:h.database,evidence:[h.evidence],summaryCaller:{kind:'RUNTIME',
    summaryId:h.target.summaryId,attemptRef:h.target.attemptRef,scope}});
  expect(h.state.rollbacks).toBe(1);expect(h.state.journal).toBe(0);
});

it('transaction-local native frame rejects reentry and is removed after failure',async()=>{
  const h=await harness();const caller={kind:'RUNTIME' as const,...h.target};
  await expect(h.members.withNativeTransaction(actor,h.database as never,caller,()=>
    h.members.withNativeTransaction(actor,h.database as never,caller,async()=>({status:'nested'}))))
    .rejects.toThrow('DERIVED_SUMMARY_NATIVE_TRANSACTION_REENTRY');
  await expect(h.members.withNativeTransaction(actor,h.database as never,caller,async()=>{
    await h.members.readAll([member],actor,h.database as never);return {status:'metadata-only'};
  })).resolves.toEqual({status:'metadata-only'});
  expect(h.verifier.assertInTransaction.mock.calls.at(-1)?.[0]).toMatchObject({evidence:[h.evidence]});
});

it('a frame never hands native proof to a different tenant or actor',async()=>{
  const h=await harness();const caller={kind:'RUNTIME' as const,...h.target};
  for(const foreign of [{...actor,tenantId:'foreign'},{...actor,actorUserId:'foreign'}]) {
    await expect(h.members.withNativeTransaction(actor,h.database as never,caller,()=>
      h.members.readAll([member],foreign,h.database as never))).rejects.toThrow('TDMS_NATIVE_EVIDENCE_ACTOR_INVALID');
  }
});

it('missing optional native verifier fails closed; ordinary source context keeps its existing behavior',async()=>{
  const h=await harness();const absent=new DerivedSummaryMembersService(h.jobAid as never,h.transactions as never);
  await expect(absent.readAll([member],actor,h.database as never))
    .rejects.toThrow('TDMS_NATIVE_TRANSACTION_AUTHORIZATION_NOT_CONNECTED');
  const ordinaryJobAid={readSummaryMemberInTransaction:jest.fn(async()=>({current:true,revision:{workRevision:1,
    documentVersionId:member.documentVersionId,content:{headline:'Ordinary exact work',understanding:'Ordinary complete body',
      issues:[],evidence:[],overviewStatus:'CURRENT'}}}))};
  const ordinary=new DerivedSummaryMembersService(ordinaryJobAid as never,h.transactions as never);
  const [reading]=await ordinary.readAll([member],actor,h.database as never);
  expect(reading!.limitations).not.toContain('NATIVE_CURRENTNESS_NOT_CONNECTED');
  const repository=new DerivedSummaryRepository({} as never,h.transactions as never,ordinary);
  const basis=await repository.contextBasis([reading!],actor,h.database as never);
  expect(basis.uncoordinatedDependencies).toEqual(['DOCUMENT_LIFECYCLE_NOT_FENCED']);
  expect((await h.repository.contextBasis([h.reading],actor,h.database as never)).uncoordinatedDependencies)
    .toEqual(['DOCUMENT_LIFECYCLE_NOT_FENCED','NATIVE_CURRENTNESS_NOT_CONNECTED']);
});
