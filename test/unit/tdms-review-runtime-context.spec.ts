import { tdmsRuntimeFixture } from './fixtures/tdms-runtime.fixture';
import { tdmsNativeEvidenceFixture } from './fixtures/tdms-native-evidence.fixture';
import { assertTdmsReviewRuntimeContext, assertTdmsReviewSavedContext, assertTdmsReviewContext } from '@server/modules/canonical-host/tdms-review-saved-context';
import { mergeTdmsReadEvidence, resolvedTdmsReadCarriers, resolvedTdmsReadEvidence } from '@server/modules/canonical-host/jobaid-tdms-context';
import { projectTdmsProcessingCohortContext, tdmsOpinionOwnApprovalMode } from '@server/modules/canonical-host/tdms-approved-opinion-context';

test.each(['QUALIFIED','NO_FIELDS','MIXED_DRAFT','MISSING_APPROVAL'] as const)(
  'own approval remains independent of an empty or partial readable directory: %s',kind=>{
    const f=tdmsRuntimeFixture(),facts=structuredClone(f.facts);facts.contributions=[];
    if(kind==='QUALIFIED')for(const a of facts.assessments)a.validity={status:'UNKNOWN',assertionRef:null};
    if(kind==='NO_FIELDS')for(const a of facts.assessments)a.opinionFields=[];
    if(kind==='MIXED_DRAFT')facts.assessments[1]!.approval=null;
    if(kind==='MISSING_APPROVAL')for(const a of facts.assessments){a.approval=null;
      Object.defineProperty(a,'opinionFields',{get:()=>{throw new Error('UNAPPROVED_LOCATOR_READ');}});}
    const own=facts.assessments.map(tdmsOpinionOwnApprovalMode);
    const projection=projectTdmsProcessingCohortContext({...facts,sets:[f.set],selectedSetRevisionRefs:[f.set.setRevisionRef]});
    expect(own.some(mode=>mode!==null)).toBe(kind!=='MISSING_APPROVAL');
    if(kind==='MIXED_DRAFT')expect(projection.selectedSetApprovedRefs).toHaveLength(1);
    else expect(projection.selectedSetApprovedRefs).toEqual([]);
    if(kind==='QUALIFIED')expect(projection.cohorts[0]!.members.every(member=>member.status==='QUALIFIED')).toBe(true);
  });

async function addon() {
  const f=tdmsRuntimeFixture();
  return {schemaVersion:'wiselink.tdms-review-runtime-context.v1',mode:'BOUNDED_NATIVE_READ',
    reviewConversationRef:'conversation',reviewTurnRef:'turn',requestId:'request',inputRevision:1,
    workRevisionRef:'saved-work',workRevision:1,savedEvidenceRefs:[],
    runtimeContext:await f.adapter.discover(f.principal,f.binding)};
}
test('the strict ten-key addon accepts an empty saved catalog without treating metadata as a READ',async()=>{
  const value=await addon();
  expect(assertTdmsReviewRuntimeContext(value)).toBe(value);
  expect(assertTdmsReviewContext(value)).toBe(value);
  expect(value.runtimeContext.projection.readPerformed).toBe(false);
  expect(()=>assertTdmsReviewSavedContext(value)).toThrow();
});
test.each(['extra','evidenceRefs','tdmsContext'])('bounded addon rejects unknown or mixed %s',async key=>{
  const value=await addon();
  expect(()=>assertTdmsReviewRuntimeContext({...value,[key]:[]})).toThrow();
});
test.each(['runtimeContext','workRevisionRef','savedEvidenceRefs'])('bounded addon rejects missing %s',async key=>{
  const value:Record<string,unknown>=await addon();delete value[key];
  expect(()=>assertTdmsReviewRuntimeContext(value)).toThrow();
});
test('a saved-only v1 carrier remains the original distinct nine-key contract',()=>{
  const value={schemaVersion:'wiselink.tdms-review-saved-context.v1',mode:'SAVED_EVIDENCE_ONLY',
    reviewConversationRef:'conversation',reviewTurnRef:'turn',requestId:'request',inputRevision:1,
    workRevisionRef:'saved-work',workRevision:1,evidenceRefs:['native:saved']};
  expect(assertTdmsReviewSavedContext(value)).toBe(value);
  expect(()=>assertTdmsReviewSavedContext({...value,evidenceRefs:[]})).toThrow();
  expect(()=>assertTdmsReviewRuntimeContext(value)).toThrow();
});
test('decision catalog retains the first saved carrier while every new real journal receipt remains independently verifiable',()=>{
  const original=tdmsNativeEvidenceFixture();
  const fresh=structuredClone(original);fresh.nativeReadReceipt.receiptRef='TDMS_READ:fresh';
  fresh.nativeReadReceipt.taskContextRef='AQ-current';
  const later=structuredClone(fresh);later.nativeReadReceipt.receiptRef='TDMS_READ:later';
  const activity=JSON.stringify([{kind:'ASSESSMENT_SOURCES_READ',sourceRefs:[fresh.evidenceRef],nativeEvidence:[fresh],
    nativeReadReceipts:[fresh.nativeReadReceipt]},{kind:'ASSESSMENT_SOURCES_READ',sourceRefs:[fresh.evidenceRef],
    nativeEvidence:[],nativeReadReceipts:[later.nativeReadReceipt]}]);
  const first=resolvedTdmsReadEvidence(activity);
  expect(first).toEqual([fresh]);
  expect(mergeTdmsReadEvidence([original],first)).toEqual([original]);
  expect(resolvedTdmsReadCarriers(activity)).toEqual([fresh,later]);
  expect(original.nativeReadReceipt.receiptRef).not.toBe(fresh.nativeReadReceipt.receiptRef);
});
test.each(['excerpt','nativeSource','nativeScope'])('an equal ref cannot mask a changed native %s',field=>{
  const original=tdmsNativeEvidenceFixture(),changed=structuredClone(original);
  if(field==='excerpt') changed.excerpt='another opinion';
  else if(field==='nativeSource') changed.nativeSource.sourceVersion.rawRevision='changed';
  else changed.nativeScope.processingSetBinding.generation++;
  expect(()=>mergeTdmsReadEvidence([original],[changed])).toThrow('JOBAID_TDMS_BODY_CHANGED');
});
test('a detached, wrong-field or unpaired journal receipt cannot create an allowed carrier',()=>{
  const body=tdmsNativeEvidenceFixture();
  const wrong=structuredClone(body.nativeReadReceipt);wrong.fieldPaths=['content.opinions[1]'];
  const entry={kind:'ASSESSMENT_SOURCES_READ',sourceRefs:[body.evidenceRef],nativeEvidence:[body],nativeReadReceipts:[wrong]};
  expect(()=>resolvedTdmsReadCarriers(JSON.stringify([entry]))).toThrow('JOBAID_TDMS_READ_OBSERVATION_INVALID');
  expect(()=>resolvedTdmsReadCarriers(JSON.stringify([{...entry,sourceRefs:[],nativeReadReceipts:[]}]))).toThrow();
});
