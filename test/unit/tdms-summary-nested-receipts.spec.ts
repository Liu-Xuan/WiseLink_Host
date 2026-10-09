import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type { AssessmentTdmsNativeEvidence } from '@shared/assessment-tdms-evidence';
import type { DerivedSummaryMember, DerivedSummaryMemberReading } from '@shared/derived-summary.interface';
import { canonicalJson, canonicalSha256 } from '../../server/modules/action-attempt/action-attempt-envelope';
import { taskModelSelection } from '../../server/modules/model-settings/canonical-model-catalog';
import { DerivedSummaryMembersService, mergeSummaryEvidence } from '../../server/modules/canonical-host/derived-summary-members.service';
import { DerivedSummaryRepository } from '../../server/modules/canonical-host/derived-summary.repository';
import { DerivedSummaryService } from '../../server/modules/canonical-host/derived-summary.service';
import { DerivedSummaryRuntimeService } from '../../server/modules/canonical-host/derived-summary-runtime.service';
import { tdmsNativeEvidenceFixture } from './fixtures/tdms-native-evidence.fixture';

const actor={tenantId:'fixture-tenant',actorUserId:'fixture-owner'};
const scope={appId:'app_17bzc551rsg',tenantId:actor.tenantId,principalId:'nested-runtime',authorizationFingerprint:'nested-authority'};
const caller={kind:'RUNTIME' as const,summaryId:'target-summary',attemptRef:'target-attempt',scope};
const leaf=(id:string):DerivedSummaryMember=>({kind:'WORK_ITEM_WORK',workItemId:id,documentVersionId:`document-${id}`,workRef:`work-${id}`,workRevision:1,issueKeys:[]});
const nested=(id:string):DerivedSummaryMember=>({kind:'DERIVED_SUMMARY',summaryId:id,summaryRef:`revision-${id}`,summaryRevision:1});
const refs=(evidence:AssessmentEvidence[])=>evidence.filter((item):item is AssessmentTdmsNativeEvidence=>item.kind==='TDMS_NATIVE_RECORD').map(item=>item.nativeReadReceipt.receiptRef);

async function fixture() {
  const a=tdmsNativeEvidenceFixture(),b=tdmsNativeEvidenceFixture();Object.assign(b.nativeReadReceipt,{receiptRef:'native-receipt-B',taskContextRef:'task-B'});
  const saved=new Map<string,Record<string,unknown>>();let revokeOnC=false,revoked=false,journal=0,journalRevoke=false;
  const calls:Array<{database:unknown;summaryCaller?:unknown;evidence:AssessmentTdmsNativeEvidence[]}> = [];
  const verifier={authorize:jest.fn(async()=>{throw new Error('ROOT_POOL_AUTHORIZATION_FORBIDDEN');}),readExactEvidence:jest.fn(async()=>{throw new Error('ROOT_POOL_READ_FORBIDDEN');}),
    assertCurrentEvidence:jest.fn(async()=>{throw new Error('ROOT_POOL_FINAL_FORBIDDEN');}),
    assertInTransaction:jest.fn(async(input:{database:unknown;summaryCaller?:unknown;evidence:AssessmentTdmsNativeEvidence[]})=>{
      expect(input.database).toBe(database);calls.push(input);if(revoked&&refs(input.evidence).includes('native-receipt-B'))throw new Error('NONFIRST_NATIVE_RECEIPT_REVOKED');
    })};
  const database={execute:jest.fn(async(query:unknown)=>new PgDialect().sqlToQuery(query as never).sql.includes('max(semantic_revision)') ? [] : [{allowed:true}]),select:jest.fn(()=>({from:(table:unknown)=>{
    let params:unknown[]=[];const name=getTableName(table as never);
    const rows=()=>name==='identity_subject_mapping'?[{id:'fixture-mapping'}]:name==='derived_summary'
      ?[...saved.keys()].filter(id=>params.includes(id)).map(id=>({summaryId:id,currentRevision:1,currentSummaryRef:`revision-${id}`}))
      :name==='derived_summary_revision'?[...saved].filter(([id])=>params.includes(id)).map(([,contentJson])=>({revision:1,contentJson}))
      :name==='work_item' ? ['A','B','C'].filter(id=>params.includes(id)).map(id=>({workItemId:id,documentVersionId:`document-${id}`,revision:1,projectionJson:'{}'}))
      :name==='assessment_work_revision' ? ['A','B','C'].filter(id=>params.includes(id)).map(id=>({ref:`work-${id}`,revision:1}))
      :name==='dm_document_version' ? ['A','B','C'].filter(id=>params.includes(`document-${id}`)).map(id=>({familyId:`family-${id}`,selectedHead:`document-${id}`,currentGeneration:1,status:'ACTIVE'})):[];
    const query={orderBy:()=>query,innerJoin:()=>query,where:(predicate:unknown)=>{params=new PgDialect().sqlToQuery(predicate as never).params;return query;},limit:async()=>rows(),for:async()=>rows(),then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(rows()).then(resolve)};return query;
  }})),update:jest.fn(()=>({set:()=>({where:async()=>{journal++;if(journalRevoke)revoked=true;}})}))};
  const transactions={withActorTransaction:jest.fn(async(_owner:string,operation:(input:{database:unknown})=>Promise<unknown>)=>{
    const previous=journal;try{return await operation({database});}catch(error){journal=previous;throw error;}
  })};
  const jobAid={readSummaryMemberInTransaction:jest.fn(async({workItemId}:{workItemId:string})=>{
    if(workItemId==='C'&&revokeOnC)revoked=true;
    return {current:true,revision:{workRevision:1,documentVersionId:`document-${workItemId}`,content:{headline:`Saved ${workItemId}`,understanding:`Body ${workItemId}`,issues:[],overviewStatus:'CURRENT',evidence:workItemId==='A'?[a]:workItemId==='B'?[b]:[]}}};
  })};
  const members=new DerivedSummaryMembersService(jobAid as never,transactions as never,undefined,verifier);
  const children=await members.readAll([leaf('A'),leaf('B')],actor,database as never);
  const put=(id:string,readings:DerivedSummaryMemberReading[])=>saved.set(id,{summaryId:id,summaryRef:`revision-${id}`,revision:1,members:readings,
    evidence:mergeSummaryEvidence(readings.flatMap(item=>item.evidence)),usedEvidenceRefs:readings.map(item=>item.evidenceRef),content:{headline:`Nested ${id}`,body:`Nested body ${id}`,limitations:[]}});
  put('S1',children);const [s1]=await members.readAll([nested('S1')],actor,database as never);put('S2',[s1!]);
  const [s2]=await members.readAll([nested('S2')],actor,database as never);calls.length=0;
  return {members,jobAid,verifier,database,transactions,saved,calls,s2:s2!,a,b,armC:()=>{revokeOnC=true;},armJournal:()=>{journalRevoke=true;},journal:()=>journal};
}

it('actual depth-2 nested readAll retains both descendant receipts and passes authentic caller/TX to final guard',async()=>{
  const f=await fixture();
  const result=await f.members.withNativeTransaction(actor,f.database as never,caller,()=>f.members.readAll([nested('S2'),leaf('C')],actor,f.database as never));
  expect(refs(result[0]!.evidence)).toEqual(['native-receipt-1','native-receipt-B']);
  expect(refs(f.calls.at(-1)!.evidence)).toEqual(['native-receipt-1','native-receipt-B']);
  expect(f.calls.at(-1)!.summaryCaller).toEqual(caller);expect(f.calls.at(-1)!.database).toBe(f.database);
  expect(f.verifier.authorize).not.toHaveBeenCalled();expect(f.verifier.readExactEvidence).not.toHaveBeenCalled();
});
it('actual standalone readAll([depth-2 summary, ordinary C]) rejects nonfirst receipt revoked by C await',async()=>{
  const f=await fixture();f.armC();
  await expect(f.members.readAll([nested('S2'),leaf('C')],actor,f.database as never)).rejects.toThrow('NONFIRST_NATIVE_RECEIPT_REVOKED');
  expect(refs(f.calls.at(-1)!.evidence)).toContain('native-receipt-B');
});
it('actual runtime nested member READ rejects nonfirst receipt revoked during journal and rolls back',async()=>{
  const f=await fixture();
  const repository=new DerivedSummaryRepository({execute:async()=>[{actorUserId:actor.actorUserId}]} as never,f.transactions as never,f.members);
  const contextBasis=await repository.contextBasis([f.s2],actor,f.database as never);
  const selection={kind:'ATA4',title:'Nested fixture',fleetFamilyId:'F',fleetModelIds:['MODEL'],ata2:'46',ata4:'46-00',selectionReason:'Explicit'};
  const basis={schemaVersion:'wiselink.derived-summary-task.v1',taskType:'OPENCLAW_DERIVED_SUMMARY',subject:{kind:'DERIVED_SUMMARY',summaryId:caller.summaryId},expectedSummaryRevision:0,
    requestId:'nested-request',actionAttemptId:'nested-attempt-id',operationRef:caller.attemptRef,deadlineAt:'2099-01-01T00:00:00.000Z',executionModel:taskModelSelection('miaoda/glm-5.3',new Date('2026-10-07T00:00:00Z')),
    contextBasis, modelInput:{scope:selection,classificationStatus:'CANDIDATE',instruction:'Retain receipts',members:[f.s2],evidence:[f.a],limitations:[]}};
  const task={...basis,taskInputHash:canonicalSha256(basis)};
  const attempt={summaryId:caller.summaryId,attemptId:basis.actionAttemptId,operationRef:caller.attemptRef,actorUserId:actor.actorUserId,tenantId:actor.tenantId,delegatedPrincipalId:scope.principalId,
    status:'RUNNING',leaseOwner:scope.principalId,leaseToken:'lease-1',leaseGeneration:1,leaseExpiresAt:new Date('2099-01-01T00:00:00Z'),deadlineAt:new Date(task.deadlineAt),triggerRequestId:basis.requestId,
    baseRevision:0,inputRevision:0,taskEnvelopeJson:canonicalJson(task),taskInputHash:task.taskInputHash,executionModelJson:canonicalJson(task.executionModel),requestCommandJson:canonicalJson({requestId:basis.requestId,expectedSummaryRevision:0,scope:selection,members:[f.s2.member],instruction:basis.modelInput.instruction,modelRef:task.executionModel.modelRef}),reviewActivityJson:'[]'};
  const readHead=repository.head.bind(repository);
  jest.spyOn(repository,'head').mockImplementation((id,owner,database,lock)=>id===caller.summaryId
    ? Promise.resolve({summaryId:caller.summaryId,currentRevision:0} as never) : readHead(id,owner,database,lock));jest.spyOn(repository,'attempt').mockResolvedValue(attempt as never);
  const summaries=new DerivedSummaryService(repository,f.members,{} as never);
  const runtime=new DerivedSummaryRuntimeService(repository,f.members,summaries);f.armJournal();
  await expect(runtime.readMemberWork({summaryId:caller.summaryId,attemptRef:caller.attemptRef,scope,leaseToken:'lease-1',leaseGeneration:1,evidenceRefs:[f.s2.evidenceRef],purpose:'Read nested saved work'} as never))
    .rejects.toThrow('NONFIRST_NATIVE_RECEIPT_REVOKED');
  expect(f.journal()).toBe(0);expect(refs(f.calls.at(-1)!.evidence)).toEqual(['native-receipt-1','native-receipt-B']);expect(f.calls.at(-1)!.summaryCaller).toEqual(caller);
});

it('a single saved leaf retains both distinct native READ receipts while its registry keeps one exact body',async()=>{
  const f=await fixture();
  f.jobAid.readSummaryMemberInTransaction.mockResolvedValue({current:true,revision:{workRevision:1,documentVersionId:'document-A',content:{headline:'Saved A',understanding:'Body A',issues:[],overviewStatus:'CURRENT',evidence:[f.a,f.b]}}});
  const [reading]=await f.members.readAll([leaf('A')],actor,f.database as never);
  expect(refs(reading!.evidence)).toEqual(['native-receipt-1','native-receipt-B']);
  expect(mergeSummaryEvidence(reading!.evidence)).toEqual([f.a]);
});

it('same-leaf nonfirst native receipt cannot borrow first receipt authorization after a later ordinary leaf await',async()=>{
  const f=await fixture(),original=f.jobAid.readSummaryMemberInTransaction.getMockImplementation()!;
  f.jobAid.readSummaryMemberInTransaction.mockImplementation(async input=>input.workItemId==='A'
    ? {current:true,revision:{workRevision:1,documentVersionId:'document-A',content:{headline:'Saved A',understanding:'Body A',issues:[],overviewStatus:'CURRENT',evidence:[f.a,f.b]}}}
    : original(input));
  f.armC();
  await expect(f.members.withNativeTransaction(actor,f.database as never,caller,()=>f.members.readAll([leaf('A'),leaf('C')],actor,f.database as never)))
    .rejects.toThrow('NONFIRST_NATIVE_RECEIPT_REVOKED');
  expect(refs(f.calls.at(-1)!.evidence)).toContain('native-receipt-B');
});
