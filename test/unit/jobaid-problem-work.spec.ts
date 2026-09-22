import { JOBAID_PROBLEM_WORK_SCHEMA, jobAidReadingResult } from '@shared/jobaid-problem-assessment.interface';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import { collectEvidenceUses } from '@shared/jobaid-evidence-uses';
import { materializeJobAidWork, calculateJaAcRisk } from '../../server/modules/canonical-host/jobaid-problem-work';
import { JOBAID_METHOD_BINDING } from '../../server/modules/canonical-host/jobaid-method-pack';
import { materializeMatterJobAidCommand } from '../../server/modules/canonical-host/matter-jobaid-save';
import { engineeringMatterPendingInputs, engineeringMatterWorkingChangeFromCommand, materializeEngineeringMatterWorkingState, parseEngineeringMatterWorkingState } from '../../server/modules/canonical-host/engineering-matter-working-state';
import type { EngineeringMatterWorkingRevisionReadModel } from '@shared/matter-working.interface';
import { buildWorkSearchProjection } from '../../server/modules/canonical-host/engineering-search-projection';
import { readHistoricalJobAidWork } from '../../server/modules/canonical-host/jobaid-historical-reading';
const source: AssessmentEvidence = { evidenceRef:'DOCUMENT_ORIGINAL:dv:pr1:u1', kind:'DOCUMENT_PASSAGE', workItemId:null,
  documentVersionId:'dv', sourceRefId:'u1', locator:'page 1', title:'Synthetic FTD', versionLabel:'R1',
  excerpt:'Do not replace unless the indication persists after five seconds.' };
const context = { matterId:'MAT-test', methodBinding: JOBAID_METHOD_BINDING, previous:null,
  evidence:[source], readSourceRefs:[source.evidenceRef], capabilities:[], history:{required:false,
    priorAssessmentRefs:[],engineeringDocumentRefs:[],coverage:'NOT_REQUIRED' as const,limitation:null} };
const issue = (key:string, body='指示持续超过五秒才符合原文更换前提；单次正常检查不能证明间歇问题消失。') => ({
  issueKey:key, question:`问题${key}`, body:`${body} [[${source.evidenceRef}]]` });
const update = (issues: ReturnType<typeof issue>[], extra: Record<string,unknown>={}) => ({
  schemaVersion:JOBAID_PROBLEM_WORK_SCHEMA, headline:'指示持续条件',listBrief:'更换前提尚待核查。', issues, roundCompletion:'IN_PROGRESS',
  completionReason:'当前认识已保存，继续核对适用前提。', changeSummary:'保存本批有依据的认识。', ...extra });

test('historical projection preserves actual prose and source identity without accepting old writes',()=>{
  const current=materializeJobAidWork(update([issue('A')]),context);
  const old={...current,headline:undefined,listBrief:undefined,schemaVersion:'wiselink.jobaid-problem-work.v2',issues:[{
    ...current.issues[0],body:undefined,understanding:'旧工作原有解释。',statements:[{
      claimId:'old-claim',text:'五秒条件尚未确认。',premises:[{role:'LIMITS',explanation:'这是更换前提。',
        evidenceRef:source.evidenceRef,limitation:'不能据此确认本机适用。'}]}]}]};
  const before=JSON.stringify(old);
  const projected=readHistoricalJobAidWork(old,{matterId:'MAT-test'});
  expect(JSON.stringify(old)).toBe(before);
  expect(projected.historicalSourceSchema).toBe('wiselink.jobaid-problem-work.v2');
  expect(projected.issues[0].body).toContain('不能据此确认本机适用。');
  expect(projected.evidence).toEqual(current.evidence);
  expect(projected.issues[0].issueRef).toBe(current.issues[0].issueRef);
  expect(projected.headline).toBe(current.issues[0].question);
  expect(projected.listBrief).toBe(projected.headline);
  expect(()=>materializeJobAidWork(old,context)).toThrow();
  expect(()=>readHistoricalJobAidWork({...old,readSourceRefs:[]},{matterId:'MAT-test'})).toThrow('SOURCE_NOT_DELIVERED');
});

test('body directly persists and exact reading/search use the complete same answer',()=>{
  const work=materializeJobAidWork(update([issue('A')]),context);
  expect(work.issues[0].body).toContain('五秒');
  expect(work.issues[0]).not.toHaveProperty('statements');
  expect(work.overviewStatus).toBe('NOT_AVAILABLE');
  expect(collectEvidenceUses(work)).toContainEqual(expect.objectContaining({role:'BODY',evidenceRef:source.evidenceRef}));
  const reading=jobAidReadingResult({workRevisionRef:'W1',workItemId:'WI',workRevision:1,previousWorkRevisionRef:null,
    requestId:'r1',actionAttemptId:'a1',basedOnWorkItemRevision:1,documentVersionId:'dv',createdAt:'2026-09-14',content:work});
  expect(reading.content.claims).toEqual([]);
  expect(reading.content.issueArticles?.[0].body).toBe(work.issues[0].body);
  const projection=buildWorkSearchProjection({ownerKind:'MATTER',ownerId:'MAT-test',subjectId:'MAT-test',exactRevisionRef:'W1',content:work});
  expect(projection[0].search.originalText).toContain(work.issues[0].body);
});
test('saved reading summary preserves decisive negation and survives local updates and validation',()=>{
  const summary={headline:'指示持续条件与更换范围',
    listBrief:'指示持续超过五秒才符合更换前提；当前尚未确认该条件，不能据此确认本机适用。'};
  const work=materializeJobAidWork(update([issue('A')],summary),context);
  expect(work).toMatchObject(summary);
  const next=materializeJobAidWork(update([issue('B')],{headline:undefined,listBrief:undefined}),{...context,previous:work});
  expect(next).toMatchObject(summary);
  const input={matterId:'MAT-test',matterRevisionId:'MR1',attemptRef:'AQ-summary',requestId:'save-summary',expectedWorkRevision:0,previous:null,
    inputs:[{kind:'DOCUMENT_VERSION' as const,inputId:'I1',familyId:'F1',workItemId:null,workItemRevision:null,resultRef:null,resultRevision:null,documentVersionId:'dv',original:{parseRunId:'pr1',parseRevision:1,semantic:{revision:1,profileRef:'ftd'}}}],
    proposal:update([issue('A')],summary),evidence:context.evidence,readSourceRefs:context.readSourceRefs,
    capabilities:[],history:context.history,methodBinding:context.methodBinding};
  const command=materializeMatterJobAidCommand(input);
  const state=materializeEngineeringMatterWorkingState({matterId:'MAT-test',current:null,command}).state;
  const read=parseEngineeringMatterWorkingState(JSON.stringify(state),'MAT-test');
  expect(read.problemWork).toMatchObject(summary);
  expect(read.substantiveResult?.content).toMatchObject(summary);
  expect(read.problemWork?.overviewStatus).toBe('NOT_AVAILABLE');
  expect(read.problemWork?.issues[0].body).toBe(issue('A').body);
  for(const supplied of [{headline:'只有标题',listBrief:undefined},{headline:undefined,listBrief:'只有摘要'},
    {headline:'',listBrief:'摘要'},{headline:'标题',listBrief:null}]) {
    expect(()=>materializeJobAidWork(update([issue('A')],supplied),context)).toThrow();
  }
});
test('A survives B failure; batch B, correction A and pure retirement keep accurate work',()=>{
  const a=materializeJobAidWork(update([issue('A')],{overview:'当前措施仅覆盖列明前提。'}),context);
  expect(()=>materializeJobAidWork(update([{...issue('B'),body:'未经交付 [[unknown]]'}]),{...context,previous:a})).toThrow('SOURCE_NOT_DELIVERED');
  expect(a.issues).toHaveLength(1);
  const b=materializeJobAidWork(update([issue('B')]),{...context,previous:a});
  expect(b.issues[0]).toEqual(a.issues[0]); expect(b.overviewStatus).toBe('STALE');
  const corrected=materializeJobAidWork(update([issue('A','更正：五秒前不得据此更换。')]),{...context,previous:b});
  expect(corrected.issues[1]).toEqual(b.issues[1]);
  const retired=materializeJobAidWork(update([],{retiredIssues:[{issueKey:'B',reason:'重复范围已撤回。'}]}),{...context,previous:corrected});
  expect(retired.issues.map(x=>x.issueKey)).toEqual(['A']);
  expect(()=>materializeJobAidWork(update([]),context)).toThrow('SUBSTANTIVE_WORK_REQUIRED');
});
test('rejects unknown, undelivered, malformed citations and obsolete rich fields',()=>{
  expect(()=>materializeJobAidWork(update([issue('A')]),{...context,readSourceRefs:[]})).toThrow('SOURCE_NOT_DELIVERED');
  expect(()=>materializeJobAidWork(update([{...issue('A'),body:'无依据'}]),context)).toThrow('BODY_CITATIONS_REQUIRED');
  expect(()=>materializeJobAidWork(update([{...issue('A'),body:issue('A').body+' [[broken'}]),context)).toThrow('BODY_CITATION_MALFORMED');
  expect(()=>materializeJobAidWork(update([{...issue('A'),statements:[]} as ReturnType<typeof issue>]),context)).toThrow('UNDECLARED_FIELD:statements');
});
test('optional risk still uses JA-AC and is not inherited after an issue replacement',()=>{
  const risk={scenario:'合成情景',conditions:['条件尚待核查'],method:'JA_AC_R01',
    severity:{label:'严重',reason:'合成依据',basisRefs:[source.evidenceRef]},likelihood:null,
    limitations:['没有发生频率记录'],controlComparison:'措施覆盖尚待验证'};
  const a=materializeJobAidWork(update([{...issue('A'),riskScenarios:[risk]} as ReturnType<typeof issue>]),context);
  expect(a.issues[0].riskScenarios[0].score).toBeNull();
  expect(calculateJaAcRisk('严重','可能')).toMatchObject({score:70,riskGrade:5});
  const b=materializeJobAidWork(update([issue('A','前提已更正，原评级不沿用。')]),{...context,previous:a});
  expect(b.issues[0].riskScenarios).toEqual([]);
});
test('normal Matter command materializes, validates and reads the same body with exact coverage',()=>{
  const input={matterId:'MAT-test',matterRevisionId:'MR1',attemptRef:'AQ1',requestId:'save1',expectedWorkRevision:0,previous:null,
    inputs:[{kind:'DOCUMENT_VERSION' as const,inputId:'I1',familyId:'F1',workItemId:null,workItemRevision:null,resultRef:null,resultRevision:null,documentVersionId:'dv',original:{parseRunId:'pr1',parseRevision:1,semantic:{revision:1,profileRef:'ftd'}}}],proposal:update([issue('A')]),
    evidence:context.evidence,readSourceRefs:context.readSourceRefs,capabilities:[],history:context.history,methodBinding:context.methodBinding};
  // No synthetic DB writes: use the actual command and state validators.
  expect(()=>materializeMatterJobAidCommand({...input,proposal:{...input.proposal,headline:undefined,listBrief:undefined}})).toThrow('JOBAID_READING_SUMMARY_REQUIRED');
  const command=materializeMatterJobAidCommand(input);
  const {state}=materializeEngineeringMatterWorkingState({matterId:'MAT-test',current:null,command});
  expect(state.focus.question).toBe('问题A');
  expect(parseEngineeringMatterWorkingState(JSON.stringify(state),'MAT-test').problemWork?.issues[0].body).toBe(issue('A').body);
  expect(state.substantiveResult?.content.issueArticles?.[0].body).toBe(issue('A').body);
  expect(state.substantiveResult?.evidence[0]).toEqual(source);
  const tampered=structuredClone(state);tampered.substantiveResult!.content.issueArticles![0].body='偷偷改写';
  expect(()=>parseEngineeringMatterWorkingState(JSON.stringify(tampered),'MAT-test')).toThrow('PROBLEM_READING_MISMATCH');
  const previous: EngineeringMatterWorkingRevisionReadModel={matterWorkRevisionId:'MW1',matterId:input.matterId,
    workingRevision:1,basedOnMatterRevisionId:'MR1',updateKind:command.updateKind,changeSummary:command.changeSummary,
    substantiveResultRef:state.substantiveResult!.resultRef,substantiveResultRevision:1,state,
    change:engineeringMatterWorkingChangeFromCommand(command),source:null,createdAt:'2026-09-15T00:00:00Z'};
  const extraSource={...source,evidenceRef:'DOCUMENT_ORIGINAL:dv:pr1:u2',sourceRefId:'u2',locator:'page 2'};
  const overviewInput={...input,previous,expectedWorkRevision:1,requestId:'save2',attemptRef:'AQ2',
    proposal:update([],{overview:'综合：五秒前提尚待核查。'}),evidence:[source,extraSource],
    readSourceRefs:[source.evidenceRef,extraSource.evidenceRef],currentReadSourceRefs:[extraSource.evidenceRef]};
  const overviewCommand=materializeMatterJobAidCommand(overviewInput);
  const overviewState=materializeEngineeringMatterWorkingState({matterId:input.matterId,current:state,command:overviewCommand}).state;
  expect(overviewState.problemWork?.issues).toEqual(state.problemWork?.issues);
  expect(overviewState.problemWork?.overviewStatus).toBe('CURRENT');
  expect(overviewCommand.changeSummary).toContain('综合正文');
  expect(overviewCommand.changeSummary).not.toContain('更新 1 个问题');
  expect(overviewState.coverage[0]).toMatchObject({contribution:'SUBSTANTIVE',checkedSourceRefIds:['u1','u2'],reason:state.coverage[0].reason});
  expect(overviewState.coverage[0].checkedScope).toContain('另读取但未新增分析：page 2');
  expect(engineeringMatterPendingInputs(overviewState,input.inputs)).toEqual([]);
  const explicit=materializeMatterJobAidCommand({...overviewInput,proposal:update([],{overview:'综合：仍需核查。',inputDispositions:[{
    inputId:'I1',contribution:'READ_ONLY',checkedEvidenceRefs:[extraSource.evidenceRef],checkedScope:'page 2',reason:'仅阅读'}]})});
  expect(explicit.coverageUpdates[0].contribution).toBe('READ_ONLY');
  // Constructed formal R2: compare and cover the new version without rebinding the R1 finding.
  const revisedBinding={...input.inputs[0],documentVersionId:'dv-r2',
    original:{parseRunId:'pr-r2',parseRevision:1,semantic:{revision:1,profileRef:'ftd'}}};
  const revisedSource={...source,documentVersionId:'dv-r2',evidenceRef:'DOCUMENT_ORIGINAL:dv-r2:pr-r2:u1',
    versionLabel:'CONSTRUCTED R2',title:'Synthetic FTD R2'};
  const revisedInput={...input,previous,expectedWorkRevision:1,matterRevisionId:'MR2',requestId:'save-r2',attemptRef:'AQ-r2',
    inputs:[revisedBinding],evidence:[source,revisedSource],readSourceRefs:[source.evidenceRef,revisedSource.evidenceRef],
    currentReadSourceRefs:[revisedSource.evidenceRef],proposal:update([],{inputDispositions:[{
      inputId:'I1',contribution:'NO_MATERIAL_CHANGE',checkedEvidenceRefs:[revisedSource.evidenceRef],
      checkedScope:'Constructed R2 page 1; only the five-second condition compared',reason:'The compared condition is unchanged; remaining R2 pages have not been assessed.'}]})};
  expect(()=>materializeMatterJobAidCommand({...revisedInput,currentReadSourceRefs:[source.evidenceRef]}))
    .toThrow('MATTER_INPUT_DISPOSITION_SOURCE_NOT_READ');
  const revisedCommand=materializeMatterJobAidCommand(revisedInput);
  const revised=materializeEngineeringMatterWorkingState({matterId:input.matterId,current:state,command:revisedCommand});
  expect(revised.coverageChanged).toBe(true);
  expect(revised.resultChanged).toBe(false);
  expect(revised.state.problemWork).toEqual(state.problemWork);
  expect(revised.state.substantiveResult).toBe(state.substantiveResult);
  expect(revised.state.coverage[0]).toMatchObject({binding:revisedBinding,contribution:'NO_MATERIAL_CHANGE',checkedSourceRefIds:['u1']});
  expect(revised.state.coverage[0].reason).toContain('remaining R2 pages have not been assessed');
  expect(engineeringMatterPendingInputs(revised.state,[revisedBinding])).toEqual([]);
  expect(parseEngineeringMatterWorkingState(JSON.stringify(revised.state),input.matterId).problemWork?.evidence)
    .toEqual(state.problemWork?.evidence);
  expect(state.coverage[0].binding.documentVersionId).toBe('dv');
  const thirdBinding={...revisedBinding,documentVersionId:'dv-r3',original:{...revisedBinding.original,parseRunId:'pr-r3'}};
  expect(engineeringMatterPendingInputs(revised.state,[thirdBinding])[0]).toMatchObject({
    covered:revisedBinding,current:thirdBinding,reasons:expect.arrayContaining(['DOCUMENT_VERSION_CHANGED'])});
  for(const changedOriginal of [ {...input.inputs[0].original,semantic:{revision:2,profileRef:'ftd'}},
    {...input.inputs[0].original,parseRunId:'pr2',parseRevision:2} ]) {
    const nextSource={...extraSource,evidenceRef:`DOCUMENT_ORIGINAL:dv:${changedOriginal.parseRunId}:u2`};
    const changed=materializeMatterJobAidCommand({...overviewInput,inputs:[{...input.inputs[0],original:changedOriginal}],
      evidence:[source,nextSource],readSourceRefs:[source.evidenceRef,nextSource.evidenceRef],currentReadSourceRefs:[nextSource.evidenceRef]});
    expect(changed.coverageUpdates[0].contribution).toBe('READ_ONLY');
    const changedState=materializeEngineeringMatterWorkingState({matterId:input.matterId,current:state,command:changed}).state;
    expect(engineeringMatterPendingInputs(changedState,[{...input.inputs[0],original:changedOriginal}])[0].reasons).toContain('READ_NOT_PROCESSED');
  }
});

test('independent issue updates retain exact-source coverage without hiding affected or revised inputs', () => {
  const sourceB = { ...source, documentVersionId: 'dv-b', evidenceRef: 'DOCUMENT_ORIGINAL:dv-b:pr-b:u1' };
  const issueB = (body: string) => ({ issueKey: 'B', question: '问题B', body: `${body} [[${sourceB.evidenceRef}]]` });
  const priorSource: AssessmentEvidence = { kind: 'PRIOR_RESULT', evidenceRef: 'prior-A', resultRef: 'W-prior',
    resultRevision: 1, originalEvidenceRefs: [source.evidenceRef], title: '既有候选分析', versionLabel: null, excerpt: '保留原文条件。' };
  const relatedIssue = { issueKey: 'C', question: '问题C', body: '候选认识需结合原文条件核查。 [[prior-A]]' };
  const bindingA = { kind: 'DOCUMENT_VERSION' as const, inputId: 'I1', familyId: 'F1', workItemId: null,
    workItemRevision: null, resultRef: null, resultRevision: null, documentVersionId: 'dv',
    original: { parseRunId: 'pr1', parseRevision: 1, semantic: { revision: 1, profileRef: 'ftd' } } };
  const bindingB = { ...bindingA, inputId: 'I2', familyId: 'F2', documentVersionId: 'dv-b',
    original: { ...bindingA.original, parseRunId: 'pr-b' } };
  const input = { matterId: 'MAT-test', matterRevisionId: 'MR1', attemptRef: 'AQ1', requestId: 'save1',
    expectedWorkRevision: 0, previous: null, inputs: [bindingA, bindingB],
    proposal: update([issue('A'), issue('A2', '同一来源的另一条件也需要保留。'), issueB('来源 B 的条件尚待核查。'), relatedIssue]), evidence: [source, sourceB, priorSource],
    readSourceRefs: [source.evidenceRef, sourceB.evidenceRef, priorSource.evidenceRef], capabilities: [], history: context.history,
    methodBinding: context.methodBinding };
  const initial = materializeMatterJobAidCommand(input);
  const state = materializeEngineeringMatterWorkingState({ matterId: input.matterId, current: null, command: initial }).state;
  const previous: EngineeringMatterWorkingRevisionReadModel = { matterWorkRevisionId: 'MW1', matterId: input.matterId,
    workingRevision: 1, basedOnMatterRevisionId: 'MR1', updateKind: initial.updateKind, changeSummary: initial.changeSummary,
    substantiveResultRef: state.substantiveResult!.resultRef, substantiveResultRevision: 1, state,
    change: engineeringMatterWorkingChangeFromCommand(initial), source: null, createdAt: '2026-09-23T00:00:00Z' };
  // Both sources were read in this attempt; only B's issue is replaced in this save.
  const nextInput = { ...input, previous, expectedWorkRevision: 1, requestId: 'save2', attemptRef: 'AQ2',
    currentReadSourceRefs: input.readSourceRefs, proposal: update([issueB('来源 B 的处置须满足新增前提。')]) };
  const command = materializeMatterJobAidCommand(nextInput);
  const next = materializeEngineeringMatterWorkingState({ matterId: input.matterId, current: state, command }).state;
  expect(next.problemWork?.issues[0]).toEqual(state.problemWork?.issues[0]);
  expect(next.coverage[0]).toEqual(state.coverage[0]);
  expect(next.coverage[1].contribution).toBe('SUBSTANTIVE');
  expect(engineeringMatterPendingInputs(next, input.inputs)).toEqual([]);
  expect(parseEngineeringMatterWorkingState(JSON.stringify(next), input.matterId)).toEqual(next);

  // Explicit disposition and withdrawn A analysis must still reopen A's input.
  const explicit = materializeMatterJobAidCommand({ ...nextInput, proposal: update([issueB('B 的新认识。')], {
    inputDispositions: [{ inputId: 'I1', contribution: 'READ_ONLY', checkedEvidenceRefs: [source.evidenceRef],
      checkedScope: 'page 1', reason: '仅重新阅读，尚未完成处置。' }],
  }) });
  expect(explicit.coverageUpdates[0].contribution).toBe('READ_ONLY');
  // A2 survives in all cases: neither a surviving citation nor indirect lineage
  // can mask the withdrawal/replacement of other A-dependent analysis.
  for (const proposal of [
    update([issueB('B 的新认识。')], { retiredIssues: [{ issueKey: 'A', reason: '旧论证撤回。' }] }),
    update([issueB('B 的新认识。')], { retiredIssues: [{ issueKey: 'C', reason: '间接依赖原文的旧论证撤回。' }] }),
    update([{ ...issue('A'), body: `改为仅基于来源 B，旧推断撤回。 [[${sourceB.evidenceRef}]]` }]),
  ]) {
    const affected = materializeMatterJobAidCommand({ ...nextInput, proposal });
    const affectedState = materializeEngineeringMatterWorkingState({ matterId: input.matterId, current: state, command: affected }).state;
    expect(engineeringMatterPendingInputs(affectedState, input.inputs)).toEqual([
      expect.objectContaining({ inputId: 'I1', reasons: ['READ_NOT_PROCESSED'] }),
    ]);
  }
  const revisedBinding = { ...bindingA, original: { ...bindingA.original, semantic: { revision: 2, profileRef: 'ftd' } } };
  const revised = materializeMatterJobAidCommand({ ...nextInput, inputs: [revisedBinding, bindingB] });
  expect(revised.coverageUpdates[0].contribution).toBe('READ_ONLY');
});

test('Matter save summary reports actual differences even when the producer claims no change',()=>{
  const input={matterId:'MAT-test',matterRevisionId:'MR1',attemptRef:'AQ1',requestId:'save1',expectedWorkRevision:0,previous:null,
    inputs:[{kind:'DOCUMENT_VERSION' as const,inputId:'I1',familyId:'F1',workItemId:null,workItemRevision:null,resultRef:null,resultRevision:null,documentVersionId:'dv',original:{parseRunId:'pr1',parseRevision:1,semantic:{revision:1,profileRef:'ftd'}}}],
    proposal:update([issue('A'),issue('B')],{overview:'原综合。'}),
    evidence:context.evidence,readSourceRefs:context.readSourceRefs,capabilities:[],history:context.history,methodBinding:context.methodBinding};
  const initial=materializeMatterJobAidCommand(input);
  const {state}=materializeEngineeringMatterWorkingState({matterId:input.matterId,current:null,command:initial});
  const previous: EngineeringMatterWorkingRevisionReadModel={matterWorkRevisionId:'MW1',matterId:input.matterId,
    workingRevision:1,basedOnMatterRevisionId:'MR1',updateKind:initial.updateKind,changeSummary:initial.changeSummary,
    substantiveResultRef:state.substantiveResult!.resultRef,substantiveResultRevision:1,state,
    change:engineeringMatterWorkingChangeFromCommand(initial),source:null,createdAt:'2026-09-15T00:00:00Z'};
  const noChangeClaim='逐项核对一致，没有实质变化。';
  const appended=materializeMatterJobAidCommand({...input,previous,expectedWorkRevision:1,
    proposal:update([],{overview:'原综合。\n本轮核对没有变化。',changeSummary:noChangeClaim})});
  const appendedState=materializeEngineeringMatterWorkingState({matterId:input.matterId,current:state,command:appended}).state;
  expect(appended.changeSummary).toBe('字段变化：综合正文。');
  expect(appended.claimDelta?.changedBecause).toBe(noChangeClaim);
  expect(appendedState.problemWork?.changeSummary).toBe(noChangeClaim);
  expect(appendedState.problemWork?.issues).toEqual(state.problemWork?.issues);
  const retired=materializeMatterJobAidCommand({...input,previous,expectedWorkRevision:1,
    proposal:update([],{retiredIssues:[{issueKey:'B',reason:'重复范围已撤回。'}],changeSummary:noChangeClaim})});
  expect(retired.changeSummary).toContain('撤回 1 个问题');
  expect(retired.changeSummary).not.toContain('更新 1 个问题');
  expect(materializeEngineeringMatterWorkingState({matterId:input.matterId,current:state,command:retired})
    .state.problemWork?.issues.map(item=>item.issueKey)).toEqual(['A']);
  const unchanged=materializeMatterJobAidCommand({...input,previous,expectedWorkRevision:1,
    proposal:update([],{changeSummary:'已经更正全部问题。'})});
  expect(unchanged.changeSummary).toBe('本轮没有字段变化。');
  expect(unchanged.nextProblemWork).toBeUndefined();
  expect(unchanged.nextSubstantiveResult).toBeNull();
});

  test('calculates the sixteen original matrix cells, with five grades and no other matrix substitution', () => {
    const severities = ['轻微', '重要', '严重', '灾难'];
    const likelihoods = [
      '可能',
      '不大可能',
      '不可能（极少）',
      '极不可能（极端少）',
    ];
    const scores = [
      [30, 21, 15, 9],
      [50, 35, 25, 15],
      [70, 49, 35, 21],
      [100, 70, 50, 30],
    ];
    const grades = [
      [3, 2, 1, 1],
      [4, 3, 2, 1],
      [5, 4, 3, 2],
      [5, 5, 4, 3],
    ];
    severities.forEach((severity, i) =>
      likelihoods.forEach((likelihood, j) =>
        expect(calculateJaAcRisk(severity, likelihood)).toMatchObject({
          score: scores[i][j],
          riskGrade: grades[i][j],
        }),
      ),
    );
    expect(calculateJaAcRisk('严重', null)).toEqual({
      score: null,
      riskGrade: null,
      gradeMeaning: null,
    });
    expect(() => calculateJaAcRisk('SAE Category 3', '可能')).toThrow(
      'JOBAID_RISK_CLASSIFICATION_INVALID',
    );
  });


test('long change summaries preserve content and still reject blank input', () => {
  const summary='完整变更说明𠮷'.repeat(1000);
  const accepted=materializeJobAidWork(update([issue('A')],{changeSummary:summary}),context);
  expect(accepted.changeSummary).toBe(summary);
  expect(()=>materializeJobAidWork(update([issue('A')],{changeSummary:'  '}),context)).toThrow('JOBAID_CHANGE_SUMMARY_INVALID');
});


test('initial work requires an explicit summary, but saved copy survives overview-only omission',()=>{
 const missing=update([issue('A')],{headline:undefined,listBrief:undefined});
 expect(()=>materializeJobAidWork(missing,context)).toThrow('JOBAID_READING_SUMMARY_REQUIRED');
 const first=materializeJobAidWork(update([issue('A')]),context);
 const next=materializeJobAidWork(update([],{headline:undefined,listBrief:undefined,overview:'已有综合正文'}),{...context,previous:first});
 expect(next.headline).toBe(first.headline); expect(next.listBrief).toBe(first.listBrief);
 expect(next.issues).toEqual(first.issues);
});
