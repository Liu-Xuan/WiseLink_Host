import assert from 'node:assert/strict';
import test from 'node:test';
import { projectBoundedInitialJobAidInput, projectJobAidModelInput } from '../../openclaw/skills/wiselink-research-and-synthesize/scripts/run-jobaid-problem-assessment.mjs';

test('existing Native projections retain a newly delivered method ref, all definitions and saved matches', () => {
  const evidenceRef = 'method:severity-definitions';
  const classificationDefinitions = ['轻微', '重要', '严重', '灾难'].map(label => ({
    dimension: 'SEVERITY', label, definitionQuote: `Synthetic ${label} definition with its complete conditions.`,
  }));
  const method = { evidenceRef, kind: 'METHOD_CLAUSE', classificationDefinitions,
    excerpt: classificationDefinitions.map(item => item.definitionQuote).join(' '),
    title: 'Synthetic generic severity definitions', versionLabel: 'unconfirmed' };
  const definitionMatch = { methodRef: evidenceRef, definitionQuote: classificationDefinitions[2].definitionQuote };
  const requirementHandling = [{ methodRef: evidenceRef, treatment: 'ADDRESSED', bodyQuote: 'synthetic consequence',
    basisRefs: ['synthetic:business'], explanation: 'Synthetic business consequence corresponds to the definition.' }];
  const input = { contentValidationVersion: 'jobaid-semantic.v1',
    availableSources: [{ ref: evidenceRef, kind: 'METHOD_CLAUSE' }], deliveredEvidence: [method],
    contextPackage: { sourceOrigins: [{ evidenceRef, origin: 'Host method clause', contentNature: 'METHOD_MATERIAL' }] },
    previousWork: { workRevisionRef: 'synthetic-generic-r1', content: { issues: [{ issueKey: 'synthetic',
      body: 'synthetic consequence', riskScenarios: [{ severity: { label: '严重', definitionMatch,
        basisRefs: ['synthetic:business'], reason: 'Synthetic consequence matches the generic definition.' },
        importantEvent: null }], requirementHandling }] } } };
  const before = structuredClone(input);
  for (const project of [projectJobAidModelInput, projectBoundedInitialJobAidInput]) {
    const output = project(input);
    assert.deepEqual(output.deliveredEvidence, [method]);
    assert.deepEqual(output.previousWork.content.issues[0].riskScenarios[0].severity.definitionMatch, definitionMatch);
    assert.deepEqual(output.previousWork.content.issues[0].requirementHandling, requirementHandling);
    assert.equal(output.previousWork.content.issues[0].riskScenarios[0].importantEvent, null);
  }
  assert.deepEqual(input, before);
});

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
