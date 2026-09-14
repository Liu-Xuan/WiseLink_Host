import { JOBAID_PROBLEM_WORK_SCHEMA, jobAidReadingResult } from '@shared/jobaid-problem-assessment.interface';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import { collectEvidenceUses } from '@shared/jobaid-evidence-uses';
import { materializeJobAidWork, calculateJaAcRisk } from '../../server/modules/canonical-host/jobaid-problem-work';
import { JOBAID_METHOD_BINDING } from '../../server/modules/canonical-host/jobaid-method-pack';
import { materializeMatterJobAidCommand } from '../../server/modules/canonical-host/matter-jobaid-save';
import { materializeEngineeringMatterWorkingState, parseEngineeringMatterWorkingState } from '../../server/modules/canonical-host/engineering-matter-working-state';
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
  schemaVersion:JOBAID_PROBLEM_WORK_SCHEMA, issues, roundCompletion:'IN_PROGRESS',
  completionReason:'当前认识已保存，继续核对适用前提。', changeSummary:'保存本批有依据的认识。', ...extra });

test('historical projection preserves actual prose and source identity without accepting old writes',()=>{
  const current=materializeJobAidWork(update([issue('A')]),context);
  const old={...current,schemaVersion:'wiselink.jobaid-problem-work.v2',issues:[{
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
  const command=materializeMatterJobAidCommand(input);
  const {state}=materializeEngineeringMatterWorkingState({matterId:'MAT-test',current:null,command});
  expect(parseEngineeringMatterWorkingState(JSON.stringify(state),'MAT-test').problemWork?.issues[0].body).toBe(issue('A').body);
  expect(state.substantiveResult?.content.issueArticles?.[0].body).toBe(issue('A').body);
  expect(state.substantiveResult?.evidence[0]).toEqual(source);
  const tampered=structuredClone(state);tampered.substantiveResult!.content.issueArticles![0].body='偷偷改写';
  expect(()=>parseEngineeringMatterWorkingState(JSON.stringify(tampered),'MAT-test')).toThrow('PROBLEM_READING_MISMATCH');
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
