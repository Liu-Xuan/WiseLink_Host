import assert from 'node:assert/strict';
import test from 'node:test';
import Ajv from 'ajv';
import { invokeHostedJobAidProblemModel } from '../../openclaw/skills/wiselink-research-and-synthesize/scripts/run-jobaid-problem-assessment.mjs';

test('native schema transports complete work as a primitive JSON string', async () => {
  await assert.rejects(invokeHostedJobAidProblemModel({ operation: 'EVALUATE_JOBAID', modelInput: {
    schemaVersion: 'wiselink.jobaid-problem-task.v2', purpose: 'INITIAL_PROBLEM_ASSESSMENT',
    methodBinding: { packRef: 'synthetic' }, availableSources: [], deliveredEvidence: [], expectedWorkRevision: 0,
  } }, {
    gatewayChatCompletionsEnabled: true, gatewayUrl: 'http://127.0.0.1:1', gatewayToken: 'synthetic',
    sessionDiscriminator: 'synthetic', readAssessmentSources: async () => {},
    saveAssessmentWork: async () => {}, readAssessmentWork: async () => {},
  }, { requestGateway: async (_url, request) => {
    const schema = JSON.parse(request.body).tools[0].function.parameters;
    const validate = new Ajv().compile(schema);
    assert.equal(validate({ step: { action: 'SAVE_WORK', workJson: JSON.stringify({ nested: [[], null, { text: '"\n' }] }) } }), true);
    assert.equal(validate({ step: { action: 'SAVE_WORK', work: {} } }), false);
    assert.equal(validate({ step: { action: 'SAVE_WORK', workJson: {} } }), false);
    throw new Error('SCHEMA_VERIFIED');
  } }), /SCHEMA_VERIFIED/);
});
