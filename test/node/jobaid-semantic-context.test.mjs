import assert from 'node:assert/strict';
import test from 'node:test';
import { projectBoundedInitialJobAidInput } from '../../openclaw/skills/wiselink-research-and-synthesize/scripts/run-jobaid-problem-assessment.mjs';

test('versioned bounded continuation preserves risk, measure status and precise unknowns', () => {
  const issue = {issueKey:'synthetic',question:'持续条件与后果',body:'短正文',
    riskScenarios:[{severity:null,likelihood:null,conditions:['尚未确认暴露'],limitations:['未提供频率'],score:null}],
    measures:[{status:'PROPOSED',text:'建议检查',limitations:['未批准、未实施、效果未知']}],
    requirementHandling:[{methodRef:'method:risk',treatment:'CONFLICT',bodyQuote:'短正文'}],
    openQuestions:[{question:'后果为何',affects:'风险',nextEvidence:'功能定义',reason:'资料未知'}],
    otherClassifications:[],sourceDependencies:['source:1'],premiseRefs:[]};
  const input={contentValidationVersion:'jobaid-semantic.v1',previousWork:{workRevisionRef:'synthetic-r1',content:{issues:[issue]}}};
  const output=projectBoundedInitialJobAidInput(input);
  for(const field of ['riskScenarios','measures','requirementHandling','openQuestions','sourceDependencies'])
    assert.deepEqual(output.previousWork.content.issues[0][field],issue[field]);
  assert.equal(output.previousWork.workRevisionRef,'synthetic-r1');
  const old=projectBoundedInitialJobAidInput({...input,contentValidationVersion:undefined});
  assert.equal(old.previousWork.content.issues[0].riskScenarios,undefined);
  assert.deepEqual(old.previousWork.content.issues[0].openQuestions,[{question:'后果为何',nextEvidence:'功能定义'}]);
});
