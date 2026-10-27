import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type { JobAidChecklistResult, JobAidMethodUsage } from '@shared/jobaid-checklist.interface';
import { JOBAID_PROBLEM_WORK_SCHEMA } from '@shared/jobaid-problem-assessment.interface';
import { collectIssueEvidenceUses } from '@shared/jobaid-evidence-uses';
import { buildJobAidChecklistBinding, assertJobAidChecklistBinding } from '@server/modules/canonical-host/jobaid-checklist-binding';
import { materializeJobAidWork, assertJobAidIssueEditScope, type JobAidWorkValidationContext } from '@server/modules/canonical-host/jobaid-problem-work';
import { JOBAID_METHOD_BINDING, JOBAID_METHOD_EVIDENCE } from '@server/modules/canonical-host/jobaid-method-pack';
import { assertJobAidSemanticContent, JobAidSemanticValidationError } from '@server/modules/canonical-host/jobaid-semantic-content';
import { readHistoricalJobAidWork } from '@server/modules/canonical-host/jobaid-historical-reading';
import { jobAidProblemModelWorkContent } from '@server/modules/canonical-host/jobaid-problem-task';

const source: AssessmentEvidence = { kind: 'DOCUMENT_PASSAGE', evidenceRef: 'source:rc1:synthetic',
  workItemId: 'WI-rc1-synthetic', documentVersionId: 'DV-rc1-synthetic', sourceRefId: 'p1',
  locator: 'synthetic page 1', title: 'Synthetic source', versionLabel: 'R1', excerpt: 'Synthetic observation only.' };
const binding = buildJobAidChecklistBinding({ workItemId: 'WI-rc1-synthetic', documentVersionId: 'DV-rc1-synthetic', basedOnWorkItemRevision: 3 });
const context: JobAidWorkValidationContext = { workItemId: binding.goal.workItemId,
  contentValidationVersion: 'jobaid-semantic.v1', checklistBinding: binding, methodBinding: JOBAID_METHOD_BINDING,
  previous: null, evidence: [source, ...JOBAID_METHOD_EVIDENCE],
  readSourceRefs: [source.evidenceRef, ...JOBAID_METHOD_EVIDENCE.map(item => item.evidenceRef)],
  capabilities: [], history: { required: false, priorAssessmentRefs: [], engineeringDocumentRefs: [], coverage: 'NOT_REQUIRED', limitation: null } };

function candidate() {
  return { schemaVersion: JOBAID_PROBLEM_WORK_SCHEMA, headline: '合成方法讨论', listBrief: '仅解释方法，不作实施认定。',
    overview: '合成讨论保留用途与版本边界。', roundCompletion: 'COMPLETE', completionReason: '只完成讨论目标。',
    changeSummary: '解释合成材料。', issues: [{ issueKey: 'discussion', question: '方法如何表述？',
      body: `这里只讨论方法定义，未进行业务分级。 [[method:risk]] [[${source.evidenceRef}]]`,
      methodUsage: [{ methodRef: 'method:risk', usage: 'REFERENCE_ONLY', basisRefs: [] }] as JobAidMethodUsage[],
      openQuestions: [] as Array<{question: string; affects: string; nextEvidence: string; reason: string}> }],
    checklistResults: binding.selection.map((selected): JobAidChecklistResult => ({ itemId: selected.itemId,
      itemApplicability: selected.mode === 'INCLUDE' || selected.itemId === 'ENG-METHOD-01' ? 'APPLICABLE' : 'NOT_APPLICABLE',
      outcome: 'ANSWERED', resultRefs: [{ issueKey: 'discussion', fieldPath: '/body' }], basisRefs: [source.evidenceRef] })) };
}
function rejection(raw: unknown, ctx = context): JobAidSemanticValidationError {
  try { materializeJobAidWork(raw, ctx); } catch (error) {
    if (error instanceof JobAidSemanticValidationError) return error;
    throw error;
  }
  throw new Error('EXPECTED_RC1_REJECTION');
}

test('seals authored selection and preserves the complete RC1 fields through existing historical/model readers', () => {
  const raw = candidate();
  const before = JSON.stringify(raw);
  const work = materializeJobAidWork(raw, context);
  expect(JSON.stringify(raw)).toBe(before);
  expect(work.checklistResults).toEqual(raw.checklistResults);
  expect(work.checklistBinding).toEqual(binding);
  expect(work.issues[0].requirementHandling).toEqual([]);
  expect(work.issues[0].methodUsage).toEqual(raw.issues[0].methodUsage);
  expect(readHistoricalJobAidWork(JSON.parse(JSON.stringify(work)), {workItemId: binding.goal.workItemId})).toEqual(work);
  expect(jobAidProblemModelWorkContent(work).checklistResults).toEqual(raw.checklistResults);
  expect(collectIssueEvidenceUses(work.issues[0])).toContainEqual(expect.objectContaining({
    evidenceRef: 'method:risk', position: 'methodUsage/0/methodRef/0', role: 'METHOD' }));
  expect(work.methodBinding.sources.some(item => item.status === 'VERSION_UNCONFIRMED')).toBe(true);
  expect(() => materializeJobAidWork({...raw, checklistBinding: binding}, context)).toThrow();
  const changed = structuredClone(binding); changed.selection[0].mode = 'EXCLUDE_OPTIONAL';
  expect(() => assertJobAidChecklistBinding(changed)).toThrow('CHECKLIST_BINDING_INVALID');
});

test.each(['missing', 'duplicate', 'unknown', 'core-skip', 'unknown-answered', 'deferred'])(
  'rejects %s checklist state at its actual field without pretending semantic sufficiency', mode => {
    const raw = candidate();
    if (mode === 'missing') raw.checklistResults.pop();
    if (mode === 'duplicate') raw.checklistResults.push(raw.checklistResults[0]);
    if (mode === 'unknown') Object.assign(raw.checklistResults[0], {itemId: 'ENG-INVENTED'});
    if (mode === 'core-skip') raw.checklistResults[0].itemApplicability = 'NOT_APPLICABLE';
    if (mode === 'unknown-answered') raw.checklistResults[1].itemApplicability = 'UNDETERMINED';
    if (mode === 'deferred') raw.checklistResults[1].outcome = 'DEFERRED';
    const error = rejection(raw);
    expect(error.violations[0].fieldPath).toMatch(/^\/checklistResults/u);
    expect(error.violations[0].ruleId).toMatch(/^WLCHK\./u);
  });

test('resolves results after local merge; retaining an untouched issue is valid but retiring it invalidates its refs', () => {
  const previous = materializeJobAidWork(candidate(), context);
  const patch = {...candidate(), issues: [], checklistResults: undefined, roundCompletion: 'IN_PROGRESS'};
  const retained = materializeJobAidWork(patch, {...context, previous});
  expect(retained.issues).toEqual(previous.issues);
  expect(retained.checklistResults).toEqual(previous.checklistResults);
  const replacement = {...candidate().issues[0], issueKey: 'replacement'};
  const error = rejection({...patch, issues: [replacement], retiredIssues: [{issueKey:'discussion', reason:'Synthetic replacement'}]}, {...context, previous});
  expect(error.message).toBe('JOBAID_CHECKLIST_RESULT_REF_INVALID');
  expect(error.violations[0].fieldPath).toBe('/checklistResults/0/resultRefs/0');
  const altered = structuredClone(previous); altered.checklistResults![0].outcome = 'OPEN';
  expect(() => assertJobAidIssueEditScope(previous, altered, ['discussion'])).toThrow('REVIEW_WORK_OUT_OF_SCOPE:checklistResults');
});

test('scoped Review independently rejects a change to global round completion', () => {
  const previous = materializeJobAidWork(candidate(), context);
  const next = structuredClone(previous); next.roundCompletion = 'IN_PROGRESS';
  expect(() => assertJobAidIssueEditScope(previous, next, ['discussion']))
    .toThrow('REVIEW_WORK_OUT_OF_SCOPE:roundCompletion');
});

test('basisRefs are authorized delivered sources and cannot replace body citations', () => {
  const raw = candidate(); raw.checklistResults[2].basisRefs = ['source:catalog-only'];
  const error = rejection(raw, {...context, evidence: [...context.evidence, {...source, evidenceRef:'source:catalog-only'}]});
  expect(error.violations[0]).toMatchObject({ code:'JOBAID_CHECKLIST_SOURCE_NOT_DELIVERED',
    itemId:'ENG-EVIDENCE-01', ruleId:'WLCHK.SOURCE.REGISTERED_REFERENCE', fieldPath:'/checklistResults/2/basisRefs/0' });
  const withoutBody = candidate(); withoutBody.issues[0].body = '没有正文引用。';
  expect(() => materializeJobAidWork(withoutBody, context)).toThrow('BODY_CITATIONS_REQUIRED');
});

test('OPEN and CONFLICT need an explicit qualified completion and concrete issue openQuestions', () => {
  const raw = candidate(); raw.checklistResults[1].outcome = 'CONFLICT';
  raw.checklistResults[1].itemApplicability = 'UNDETERMINED';
  expect(rejection(raw).message).toBe('JOBAID_CHECKLIST_OPEN_QUESTION_REQUIRED');
  raw.roundCompletion = 'COMPLETE_WITH_OPEN_QUESTIONS';
  expect(rejection(raw).message).toBe('JOBAID_CHECKLIST_OPEN_QUESTION_REQUIRED');
  raw.issues[0].openQuestions.push({ question:'哪条记录准确？', affects:'对象判断', nextEvidence:'原记录', reason:'两份记录冲突' });
  expect(materializeJobAidWork(raw, context).roundCompletion).toBe('COMPLETE_WITH_OPEN_QUESTIONS');
});

test('actual definitionMatch requires APPLIED, but APPLIED does not force a new requirementHandling row', () => {
  const severity = JOBAID_METHOD_EVIDENCE.find(item => item.kind === 'METHOD_CLAUSE' && item.evidenceRef === 'method:severity-definitions')!;
  if (severity.kind !== 'METHOD_CLAUSE') throw new Error('MISSING_METHOD');
  const definition = severity.classificationDefinitions!.find(item => item.label === '轻微')!;
  const base = candidate();
  const risk = { scenario:'合成轻微后果', method:'JA_AC_R01', conditions:[],
    severity:{label:'轻微',reason:'合成对应',basisRefs:[source.evidenceRef],definitionMatch:{methodRef:severity.evidenceRef,definitionQuote:definition.definitionQuote}},
    likelihood:{label:'不大可能',reason:'合成暴露',basisRefs:[source.evidenceRef],definitionMatch:{methodRef:'method:risk',definitionQuote:'单机不太可能但机队可多次'}},
    limitations:['仅合成输入'],controlComparison:'不认定任何控制已实施。' };
  base.issues[0].methodUsage.push({methodRef:severity.evidenceRef,usage:'REFERENCE_ONLY',basisRefs:[]});
  const raw = {...base, issues:[{...base.issues[0],riskScenarios:[risk]}]};
  expect(rejection(raw).violations.some(item => item.code === 'JOBAID_METHOD_USAGE_APPLIED_REQUIRED')).toBe(true);
  raw.issues[0].methodUsage.forEach(usage => { usage.usage='APPLIED';usage.basisRefs=[source.evidenceRef]; });
  const work = materializeJobAidWork(raw, context);
  expect(work.issues[0].riskScenarios[0].score).toBe(21);
  expect(work.issues[0].requirementHandling).toEqual([]);
});

test('actual requirement rows retain body location checks independently of REFERENCE_ONLY', () => {
  const raw = candidate();
  const result = rejection({...raw, issues:[{...raw.issues[0],requirementHandling:[{
    methodRef:'method:risk',requirement:'合成条件',conditions:[],treatment:'LATER_BUSINESS_STAGE',
    explanation:'保留实际处置行',basisRefs:[],bodyQuote:'不在正文中的句子'}]}]});
  expect(result.message).toBe('JOBAID_SEMANTIC_REQUIREMENT_BODY_LOCATION_REQUIRED');
  expect(result.violations[0].fieldPath).toBe('/issues/0/requirementHandling/0/bodyQuote');
});


test.each(['confirmedBy','confirmedAt','approval'])('RC1 measure %s is a located authority rejection without changing the candidate status vocabulary', field => {
  const base = candidate();
  const measure = {text:'合成候选认为有效',addresses:'合成条件',limitations:['仍是候选解释'],status:'VERIFIED_EFFECTIVE',basisRefs:[source.evidenceRef]};
  const raw = {...base,issues:[{...base.issues[0],measures:[measure]}]};
  const previous = materializeJobAidWork(raw,context);
  expect(previous.issues[0].measures[0].status).toBe('VERIFIED_EFFECTIVE');
  const error = rejection({...base,issues:[{...base.issues[0],measures:[{...measure,[field]:'synthetic-injected-value'}]}]});
  expect(error.violations[0]).toMatchObject({code:'JOBAID_CHECKLIST_AUTHORITY_FIELD_FORBIDDEN',
    ruleId:'WLCHK.AUTHORITY.NO_PROMOTION',itemId:'ENG-STATUS-01',fieldPath:`/issues/0/measures/0/${field}`});
  const retained = materializeJobAidWork({...base,issues:[],checklistResults:undefined}, {...context,previous});
  expect(retained.issues[0].measures).toEqual(previous.issues[0].measures);
  expect(readHistoricalJobAidWork(previous,{workItemId:binding.goal.workItemId})).toEqual(previous);
  expect(() => materializeJobAidWork({...base,issues:[{...base.issues[0],measures:[{...measure,basisRefs:['undelivered']}]}]},context)).toThrow('SOURCE_NOT_DELIVERED');
});


test('explicit null is invalid rather than an omission retaining old checklist or method usage', () => {
  const raw=candidate();const previous=materializeJobAidWork(raw,context);
  expect(rejection({...raw,checklistResults:null},{...context,previous}).message).toBe('JOBAID_CHECKLIST_STRUCTURE_INVALID');
  expect(rejection({...raw,issues:[{...raw.issues[0],methodUsage:null}]}).message).toBe('JOBAID_CHECKLIST_STRUCTURE_INVALID');
});

test('RC1 rejects a retained legacy issue before SAVE; explicit resubmission satisfies the same Overall rule', () => {
  const raw = candidate();
  const legacyIssue = {issueKey:'legacy',question:'合成历史问题',body:`合成旧判断 [[method:risk]] [[${source.evidenceRef}]]`,
    requirementHandling:[{methodRef:'method:risk',requirement:'合成要求',conditions:[],treatment:'LATER_BUSINESS_STAGE',
      explanation:'仅保留后续阶段',basisRefs:[],bodyQuote:'合成旧判断'}]};
  const previous = materializeJobAidWork({...raw,issues:[legacyIssue],checklistResults:undefined},
    {...context,checklistBinding:undefined});
  const before = JSON.stringify(previous);
  const error = rejection(raw,{...context,previous});
  expect(error.message).toBe('JOBAID_METHOD_USAGE_INVALID');
  expect(error.violations[0]).toMatchObject({fieldPath:'/issues',ruleId:'WLCHK.METHOD.KNOWN_RULE'});
  expect(error.violations[0].message).toContain('legacy');
  expect(JSON.stringify(previous)).toBe(before);
  const upgraded = materializeJobAidWork({...raw,issues:[...raw.issues,
    {...legacyIssue,methodUsage:[{methodRef:'method:risk',usage:'REFERENCE_ONLY',basisRefs:[]}]}]}, {...context,previous});
  expect(() => assertJobAidSemanticContent(upgraded,upgraded.evidence,true)).not.toThrow();
  expect(upgraded.issues.find(issue=>issue.issueKey==='legacy')!.methodUsage![0].usage).toBe('REFERENCE_ONLY');
  // The merged order differs from the submitted patch; diagnostics still locate the actual submitted issue.
  const invalid = {...raw,issues:[{...raw.issues[0],methodUsage:[]},
    {...legacyIssue,methodUsage:[{methodRef:'method:risk',usage:'REFERENCE_ONLY',basisRefs:[]}]}]};
  expect(rejection(invalid,{...context,previous}).violations[0].fieldPath).toBe('/issues/0/methodUsage');
});

test('scoped Review can explicitly resolve only checklist rows wholly owned by changed target issues', () => {
  const raw = candidate();
  raw.roundCompletion='COMPLETE_WITH_OPEN_QUESTIONS';
  raw.issues[0].openQuestions=[{question:'合成未知',affects:'合成目标',nextEvidence:'合成材料',reason:'待核'}];
  raw.issues.push({...candidate().issues[0],issueKey:'other'});
  raw.checklistResults[0].outcome='OPEN';
  raw.checklistResults[1].resultRefs=[{issueKey:'other',fieldPath:'/body'}];
  const previous=materializeJobAidWork(raw,context);
  const resolution={...raw,issues:[{...raw.issues[0],body:raw.issues[0].body+' 合成未知已据材料解决。',openQuestions:[]}],
    checklistResults:structuredClone(raw.checklistResults)};
  resolution.checklistResults[0].outcome='ANSWERED';
  const next=materializeJobAidWork(resolution,{...context,previous});
  expect(()=>assertJobAidIssueEditScope(previous,next,['discussion'])).not.toThrow();
  expect(next.roundCompletion).toBe(previous.roundCompletion);
  expect(next.issues.find(issue=>issue.issueKey==='other')).toEqual(previous.issues.find(issue=>issue.issueKey==='other'));
  const unrelated=structuredClone(next);unrelated.checklistResults![1].itemApplicability='APPLICABLE';
  expect(()=>assertJobAidIssueEditScope(previous,unrelated,['discussion'])).toThrow('REVIEW_WORK_OUT_OF_SCOPE:checklistResults');
  const mixed=structuredClone(previous);mixed.checklistResults![0].resultRefs.push({issueKey:'other',fieldPath:'/body'});
  expect(()=>assertJobAidIssueEditScope(mixed,next,['discussion'])).toThrow('REVIEW_WORK_OUT_OF_SCOPE:checklistResults');
  const added=structuredClone(next);added.checklistResults!.pop();
  expect(()=>assertJobAidIssueEditScope(previous,added,['discussion'])).toThrow('REVIEW_WORK_OUT_OF_SCOPE:checklistResults');
  const noIssueEdit=structuredClone(previous);noIssueEdit.checklistResults![0].outcome='ANSWERED';
  expect(()=>assertJobAidIssueEditScope(previous,noIssueEdit,['discussion'])).toThrow('REVIEW_WORK_OUT_OF_SCOPE:checklistResults');
});

test.each(['/riskScenarios/length','/measures/length','/measures/01','/measures/-','/measures/1','/measures/99999999999999999'])(
  'checklist result pointer rejects non-JSON array element %s', fieldPath => {
    const raw=candidate();
    const value={...raw,issues:[{...raw.issues[0],measures:[{text:'合成措施',addresses:'合成对象',limitations:[],
      status:'PROPOSED',basisRefs:[source.evidenceRef]}]}]};
    value.checklistResults[0].resultRefs[0].fieldPath=fieldPath;
    expect(rejection(value).message).toBe('JOBAID_CHECKLIST_RESULT_REF_INVALID');
    value.checklistResults[0].resultRefs[0].fieldPath='/measures/0';
    expect(()=>materializeJobAidWork(value,context)).not.toThrow();
  });
