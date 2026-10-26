import { canonicalJson, sealTaskEnvelope } from '../../server/modules/action-attempt/action-attempt-envelope';
import { buildInitialAnalysisRequestInput, readInitialAnalysisRequestInput, assertPreparedInitialAnalysisInput } from '../../server/modules/action-attempt/initial-analysis-request';
import { buildProgramAgentPolicy, assertProgramAgentPolicyModel, readProgramAgentPolicy } from '../../server/modules/canonical-host/program-agent-policy';
import { parseProgramMaterialSnapshot, assertProgramCompleteIssueCoverage } from '../../server/modules/canonical-host/program-assessment-materials';
import { taskModelSelection } from '../../server/modules/model-settings/canonical-model-catalog';
import type { JobAidProblemTaskInput } from '../../server/modules/canonical-host/jobaid-problem-task';
import type { OpenClawTaskEnvelope } from '../../server/modules/action-attempt/action-attempt-envelope.types';
import { programAgentMaterialsFixture } from './fixtures/program-assessment-materials';

function fixture() {
  const read = programAgentMaterialsFixture();
  const input = {executionMode: 'PROGRAM_AGENT_V1', agentPolicy: readProgramAgentPolicy(read.snapshot.modelRequest.agentPolicy),
    modelInput: read.snapshot.materials.originalInput, previousWork: null, sourceCatalog: []} as unknown as JobAidProblemTaskInput;
  const task = {executionModel: read.executionModel} as OpenClawTaskEnvelope;
  return {read, input, task, snapshot: read.snapshot};
}

it('seals null request/tool caps and one configured per-dispatch output budget', () => {
  const {read} = fixture();
  expect(buildProgramAgentPolicy(read.executionModel)).toEqual({schemaVersion: 'wiselink.program-agent-policy.v1',
    maxModelRequests: null, maxOutputTokens: 131072, maxToolCalls: null, timeoutSeconds: 3600});
  expect(() => buildProgramAgentPolicy(taskModelSelection('miaoda/glm-5.3'))).toThrow();
  expect(() => assertProgramAgentPolicyModel({...buildProgramAgentPolicy(read.executionModel), maxOutputTokens: 64000},
    read.executionModel)).toThrow('JOBAID_PROGRAM_AGENT_MODEL_BINDING_INVALID');
  expect(() => readProgramAgentPolicy({...buildProgramAgentPolicy(read.executionModel), maxModelRequests: 24})).toThrow();
});

it('binds new pending intent and prepare to the same captured policy without changing the original request', () => {
  const {read} = fixture(), policy = buildProgramAgentPolicy(read.executionModel);
  const request = buildInitialAnalysisRequestInput({taskType: 'OPENCLAW_DYNAMIC_EVALUATION',
    requestId: '00000000-0000-4000-8000-000000000001', originalParseRunId: 'PR-historic',
    executionMode: 'PROGRAM_AGENT_V1', modelRef: 'miaoda/glm-5.3', agentPolicy: policy});
  const task = sealTaskEnvelope({schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
    actionAttemptId: 'ATT-synthetic', operationRef: 'AQ-synthetic', taskType: request.taskType,
    priority: 100, tenantId: 'tenant', workItemId: 'WI-synthetic', inputRevision: 1, baseRevision: 1,
    documentVersionId: 'DV-historic', sourceRefs: [{ref: 'ART-historic', sha256: 'a'.repeat(64)}],
    allowedConnectors: [], hostResolvedMissingInputs: [], modelInput: request, executionModel: read.executionModel,
    deadline: '2099-01-01T00:00:00.000Z', idempotencyKey: `openclaw-v2:dynamic:WI-synthetic:DV-historic:${request.requestId}`});
  const bytes = canonicalJson(task);
  expect(readInitialAnalysisRequestInput(task)).toEqual(request);
  const prepared = {schemaVersion: 'wiselink.jobaid-problem-task.v3', executionMode: request.executionMode,
    requestedModelRef: request.modelRef, agentPolicy: policy, modelInput: {documentOverview: {original: {binding: {parseRunId: 'PR-historic'}}}}};
  expect(() => assertPreparedInitialAnalysisInput(request, prepared)).not.toThrow();
  expect(() => assertPreparedInitialAnalysisInput(request, {...prepared, agentPolicy: {...policy, maxOutputTokens: 64000}}))
    .toThrow('JOBAID_PROGRAM_AGENT_POLICY_BINDING_CHANGED');
  expect(canonicalJson(task)).toBe(bytes);
  expect(() => buildInitialAnalysisRequestInput({...request, modelRef: 'miaoda/minimax-m3'})).toThrow('PROGRAM_AGENT_MODEL_UNSUPPORTED');
});

it('retains the exact private v2 snapshot without converting its directory into source reads', () => {
  const {snapshot, task, input} = fixture();
  const before = canonicalJson(snapshot);
  expect(parseProgramMaterialSnapshot(snapshot, task, input)).toEqual(snapshot);
  expect(snapshot.materials).not.toHaveProperty('sourceReads');
  expect(snapshot.materials.deliveredEvidenceRefs).toEqual([]);
  expect(canonicalJson(snapshot)).toBe(before);
});

it.each(['directory', 'private-original', 'model', 'policy', 'previous', 'body', 'cross-version', 'extra'])(
  'rejects a v2 material %s substitution', field => {
    const {snapshot, task, input} = fixture();
    if (field === 'directory') (snapshot.materials.directory as Record<string, unknown>).previousWorkRevisionRef = 'JAWR-newest';
    if (field === 'private-original') snapshot.materials.originalInput = {changed: true};
    if (field === 'model') snapshot.modelRequest.executionModel = {...task.executionModel, settingsRevision: 99};
    if (field === 'policy') snapshot.modelRequest.agentPolicy = {...input.agentPolicy, maxOutputTokens: 64000};
    if (field === 'previous') snapshot.materials.previousWorkRead = {revision: {workRevisionRef: 'JAWR-latest'}};
    if (field === 'body') snapshot.modelRequest.body = JSON.stringify({messages: [{role: 'system'}, {role: 'user', content: 'new body'}]});
    if (field === 'cross-version') snapshot.materials.version = 1;
    if (field === 'extra') snapshot.materials.sourceReads = [];
    expect(() => parseProgramMaterialSnapshot(snapshot, task, input)).toThrow();
  },
);

it('does not accept v2 material under the old mode or skip prior issues under the new mode', () => {
  const {snapshot, task, input} = fixture();
  expect(() => parseProgramMaterialSnapshot(snapshot, task, {...input, executionMode: 'PROGRAM_CONTROLLED_V1'})).toThrow();
  const prior = {...input, previousWork: {content: {issues: [{issueKey: 'KEPT'}]}}} as unknown as JobAidProblemTaskInput;
  expect(() => assertProgramCompleteIssueCoverage({roundCompletion: 'COMPLETE', issues: []}, prior))
    .toThrow('JOBAID_PROGRAM_PREVIOUS_ISSUE_COVERAGE_REQUIRED');
});
