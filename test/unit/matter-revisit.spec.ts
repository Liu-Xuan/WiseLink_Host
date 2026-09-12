import { dueMatterRevisits, validateMatterRevisitWhen } from '../../server/modules/canonical-host/matter-revisit';
import type { EngineeringMatterWorkingInputBinding, EngineeringMatterWorkingTextItem } from '../../shared/matter-working.interface';

describe('explicit Matter revisit observations', () => {
  const inputs: EngineeringMatterWorkingInputBinding[] = [{ kind:'DOCUMENT_VERSION',inputId:'input',familyId:'family',
    documentVersionId:'DV',workItemId:null,workItemRevision:null,resultRef:null,resultRevision:null,original:{parseRunId:'PR-2',parseRevision:2} }];
  const condition = (itemId: string, when?: EngineeringMatterWorkingTextItem['when']): EngineeringMatterWorkingTextItem => ({itemId,text:'Bounded revisit',basisRefs:[],...(when ? {when} : {})});
  it('does not interpret prose, future dates or unknown sources as observed events', () => {
    expect(dueMatterRevisits([
      {itemId:'plain',text:'Tomorrow or whenever a new issue appears',basisRefs:[]},
      condition('future',{kind:'DUE_AT',at:'2099-01-01T00:00:00Z'}),
      condition('same',{kind:'ORIGINAL_CHANGED',inputId:'input',afterParseRunId:'PR-2'}),
      condition('foreign',{kind:'ORIGINAL_CHANGED',inputId:'foreign',afterParseRunId:null}),
    ],inputs,new Date('2026-09-13T00:00:00Z'))).toEqual([]);
  });
  it('returns stable occurrences for explicit due time and observed original changes', () => {
    const conditions = [condition('time',{kind:'DUE_AT',at:'2026-09-13T08:00:00+08:00'}),
      condition('original',{kind:'ORIGINAL_CHANGED',inputId:'input',afterParseRunId:'PR-1'})];
    const occurrences = dueMatterRevisits(conditions,inputs,new Date('2026-09-13T00:00:00Z'));
    expect(occurrences.map(item => item.conditionId)).toEqual(['original','time']);
    expect(occurrences[0].observedOriginal).toEqual(inputs[0].original);
    expect(dueMatterRevisits(conditions.map(item => ({...item,text:'Changed explanation'})),inputs,new Date('2027-01-01T00:00:00Z'))).toEqual(occurrences);
  });
  it('rejects ambiguous dates and injected authority', () => {
    expect(() => validateMatterRevisitWhen({kind:'DUE_AT',at:'tomorrow'})).toThrow('MATTER_REVISIT_WHEN_INVALID');
    expect(() => validateMatterRevisitWhen({kind:'DUE_AT',at:'2026-09-13T00:00:00Z',authorized:true})).toThrow('MATTER_REVISIT_WHEN_INVALID');
  });
});
