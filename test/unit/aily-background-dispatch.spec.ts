import type { AilyInitialAnalysisStatus, CanonicalWorkItemProjection } from '@shared/api.interface';
import type { ActionAttemptRow } from '../../server/modules/action-attempt/action-attempt.types';
import { canonicalJson, parseTaskEnvelope, sealTaskEnvelope } from '../../server/modules/action-attempt/action-attempt-envelope';
import { buildInitialAnalysisRequestInput } from '../../server/modules/action-attempt/initial-analysis-request';
import { AilyBackgroundDispatchService } from '../../server/modules/canonical-host/aily-background-dispatch.service';
import { AilyTaskAdmissionService } from '../../server/modules/canonical-host/aily-task-admission';
import type { AilyExecutorRun } from '../../server/modules/canonical-host/aily-executor-run';
import { HierarchicalWikiAutomation } from '../../server/modules/canonical-host/hierarchical-wiki.automation';
import { syntheticAilyEnterpriseConfiguration, syntheticAilyHostServiceConfiguration } from '../support/aily-enterprise-configuration.fixture';

function fixture(hostService=false) {
  const state = hostService?syntheticAilyHostServiceConfiguration():syntheticAilyEnterpriseConfiguration();
  const workItem = {workItemId: 'WI-test', requestId: 'original-intake', revision: 4,
    source: {documentVersionId: 'DV-test', documentId: 'DOC-test', sourceArtifactId: 'ART-test',
      sourceFileSha256: 'a'.repeat(64), sourceByteLength: 120}} as CanonicalWorkItemProjection;
  const owner = {requestedByUserId: 'owner-test', revision: 4};
  const model = {modelRef: 'aily/deepseek-v4-pro', displayName: 'DeepSeek V4 Pro', providerKind: 'BUILT_IN' as const,
    settingsRevision: 0, selectedAt: new Date().toISOString()};
  const requestId = '00000000-0000-4000-8000-000000000001';
  const task = sealTaskEnvelope({schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1', actionAttemptId: 'ATT-test',
    operationRef: 'AQ-test', taskType: 'OPENCLAW_DYNAMIC_EVALUATION', priority: 1, tenantId: 'tenant-test',
    workItemId: 'WI-test', inputRevision: 4, baseRevision: 4, documentVersionId: 'DV-test',
    sourceRefs: [{ref: 'ART-test', sha256: 'a'.repeat(64)}], allowedConnectors: [], hostResolvedMissingInputs: [], executionModel: model,
    modelInput: buildInitialAnalysisRequestInput({taskType: 'OPENCLAW_DYNAMIC_EVALUATION', requestId,
      originalParseRunId: 'PR-2', executionMode: 'AILY_AGENT_V1', modelRef: model.modelRef}),
    deadline: new Date(Date.now() + 3600000).toISOString(), idempotencyKey: `openclaw-v2:dynamic:WI-test:DV-test:${requestId}`});
  const row = {attemptId: 'ATT-test', operationRef: 'AQ-test', actorUserId: 'owner-test', tenantId: 'tenant-test', workItemId: 'WI-test',
    documentVersionId: 'DV-test', status: 'QUEUED', claimCount: 0, leaseGeneration: 1,
    taskEnvelopeJson: canonicalJson(task), taskInputHash: task.inputHash} as ActionAttemptRow;
  let run: AilyExecutorRun | null = null;
  const repository = {readByOperationRef: jest.fn(async (): Promise<ActionAttemptRow | null> => row), readAilyExecutorRun: jest.fn(async () => run)};
  const actors = {withActorScope: jest.fn(async (_actor: string, operation: () => Promise<unknown>) => operation())};
  const workItems = {loadAutoProcessingProjection: jest.fn(async () => ({row: owner, projection: workItem}))};
  const stage: AilyInitialAnalysisStatus['stages']['jobAid'] = {status: 'BUSY', attemptRef: 'AQ-test', attemptStatus: 'QUEUED', terminalCode: null, requestId};
  const progress = {status: 'BUSY', nextOperation: null, stages: {jobAid: stage}} as unknown as AilyInitialAnalysisStatus;
  const status = {project: jest.fn(async () => progress), readAilyBackgroundRequest: jest.fn(async () => undefined)};
  const jobAid = {enqueueOriginalContinuation: jest.fn(async () => ({attemptRef: 'AQ-test', requestId: 'original-2'}))};
  const work = {publishedOriginalBindingForRequest: jest.fn(async () => ({parseRunId: 'PR-2', parseRevision: 2}))};
  const execution = {preflight: jest.fn(async () => undefined), execute: jest.fn(async (_input: unknown) => ({attemptRef: 'AQ-test', dispatchStatus: 'ACCEPTED', chatId: '123', remoteSessionId: 'remote'}))};
  const lifecycle = {tick: jest.fn(async () => ({status: 'OBSERVED'}))};
  const dispatch = {claimAilyWorkItem: jest.fn(async () => ({}))};
  const service = new AilyBackgroundDispatchService(state, new AilyTaskAdmissionService(state.configuration.task), actors as never,
    workItems as never, status as never, repository as never, jobAid as never, work as never, execution as never, lifecycle as never, dispatch as never);
  const makeRun = (): AilyExecutorRun => ({schemaVersion: 'wiselink.aily-executor-run.v1', executor: 'AILY_AGENT_V1', requestId,
    agentId: 'agent_synthetic', publicationRef: 'original-publication', configurationSource: 'synthetic-approved-fixture',
    scope: {tenantId: 'tenant-test', workItemId: 'WI-test', intakeRequestId: 'original-intake', principalId: 'service:aily-synthetic'},
    modelEvidence: {selectedModelRef: 'aily/deepseek-v4-pro', actualModelRef: null}, hostSessionId: null,
    invocation: {purpose: 'BACKGROUND', identityRef: 'synthetic-approved-caller', callerAppId: 'cli_synthetic', configurationSource: 'synthetic-approved-fixture'},
    leaseGeneration: 1, post: {state: 'STARTED', startedAt: new Date().toISOString(), requestBody: '{}'}});
  return {state, workItem, owner, row, repository, actors, workItems, status, stage, progress, jobAid, work, execution, lifecycle, dispatch, service,
    makeRun, setRun: (value: AilyExecutorRun) => {run = value;}};
}

describe('one exact background engineering invocation', () => {
  it('consumes an existing queued UUID without a browser session or a new request', async () => {
    const h = fixture();
    expect(await h.service.runOnce()).toMatchObject({status: 'DISPATCHED', requestId: h.stage.requestId});
    expect(h.execution.execute).toHaveBeenCalledWith(expect.objectContaining({purpose: 'BACKGROUND', identityRef: 'synthetic-approved-caller',
      requestId: h.stage.requestId, actor: {userId: 'owner-test', tenantId: 'tenant-test'}}));
    expect(h.execution.execute.mock.calls[0][0]).not.toHaveProperty('sessionId');
    expect(h.jobAid.enqueueOriginalContinuation).not.toHaveBeenCalled();
    expect(h.status.readAilyBackgroundRequest).toHaveBeenCalledWith(expect.objectContaining({expectedAttemptRef: 'AQ-test'}));
  });

  it.each(['STARTED', 'UNKNOWN', 'ACCEPTED'] as const)('routes original %s to one tick without dispatching', async state => {
    const h = fixture(); const run = h.makeRun();
    run.post = state === 'ACCEPTED' ? {...run.post, state, acceptedAt: new Date().toISOString(), chatId: '123', remoteSessionId: 'remote'} :
      state === 'UNKNOWN' ? {...run.post, state, observedAt: new Date().toISOString(), errorCode: 'AILY_POST_RESULT_UNCONFIRMED'} : run.post;
    h.setRun(run); h.row.status = 'RUNNING';
    expect(await h.service.runOnce()).toMatchObject({status: 'TICK', requestId: run.requestId});
    expect(h.lifecycle.tick).toHaveBeenCalledTimes(1); expect(h.execution.execute).not.toHaveBeenCalled();
    expect(h.jobAid.enqueueOriginalContinuation).not.toHaveBeenCalled();
  });

  it.each(['COMMITTING', 'SUCCEEDED', 'TIMED_OUT'])('reports original %s without replacing the request', async status => {
    const h = fixture(); h.setRun(h.makeRun()); h.row.status = status;
    const result = await h.service.runOnce();
    expect(result.status).toBe(status === 'COMMITTING' ? 'TICK' : 'HOST_TERMINAL');
    expect(h.execution.execute).not.toHaveBeenCalled(); expect(h.dispatch.claimAilyWorkItem).not.toHaveBeenCalled();
  });

  it('does not let current application configuration select a TAT tick for an old browser/UAT run', async () => {
    const h=fixture();const run=h.makeRun();delete run.invocation;run.hostSessionId='00000000-0000-4000-8000-000000000002';
    h.setRun(run);h.row.status='RUNNING';const before=canonicalJson(run);
    expect(await h.service.runOnce()).toMatchObject({status:'UNAVAILABLE',reason:'AILY_ORIGINAL_BROWSER_INVOCATION_REQUIRED',requestId:run.requestId});
    expect(h.lifecycle.tick).not.toHaveBeenCalled();expect(h.execution.execute).not.toHaveBeenCalled();
    expect(h.dispatch.claimAilyWorkItem).not.toHaveBeenCalled();expect(canonicalJson(run)).toBe(before);
  });

  it('uses only the original parse producer for a newly authorized initial request', async () => {
    const h = fixture(); h.stage.attemptRef = null; h.progress.nextOperation = 'EVALUATE_JOBAID';
    await h.service.runOnce();
    expect(h.work.publishedOriginalBindingForRequest).toHaveBeenCalledWith({tenantId: 'tenant-test', actorUserId: 'owner-test', workItemId: 'WI-test', documentVersionId: 'DV-test'});
    expect(h.jobAid.enqueueOriginalContinuation).toHaveBeenCalledWith(h.workItem, expect.objectContaining({principalId: 'service:aily-synthetic'}),
      'INITIAL_PROBLEM_ASSESSMENT', {parseRunId: 'PR-2', parseRevision: 2}, expect.objectContaining({executionMode: 'AILY_AGENT_V1', actorUserId: 'owner-test'}));
    expect(h.execution.execute).toHaveBeenCalledWith(expect.objectContaining({requestId: 'original-2'}));
  });

  it('does not skip a real applicability prerequisite or an existing failed intake', async () => {
    const h = fixture(); h.stage.attemptRef = null; h.progress.nextOperation = 'EXTRACT_APPLICABILITY';
    expect(await h.service.runOnce()).toMatchObject({status: 'PREREQUISITE_REQUIRED', nextOperation: 'EXTRACT_APPLICABILITY'});
    expect(h.execution.execute).not.toHaveBeenCalled(); expect(h.jobAid.enqueueOriginalContinuation).not.toHaveBeenCalled();
  });

  it.each(['tenant', 'actor', 'source', 'mode', 'run-intake', 'caller', 'role', 'invisible'])('refuses %s rather than treating it as an empty queue', async reason => {
    const h = fixture();
    if (reason === 'tenant') h.row.tenantId = 'other';
    if (reason === 'actor') h.row.actorUserId = 'other';
    if (reason === 'source') h.workItem.source.sourceFileSha256 = 'b'.repeat(64);
    if (reason === 'mode') {const {inputHash: _hash, ...task} = parseTaskEnvelope(h.row.taskEnvelopeJson);
      const sealed = sealTaskEnvelope({...task, modelInput: {executionMode: 'PROGRAM_CONTROLLED_V1'}});
      h.row.taskEnvelopeJson = canonicalJson(sealed); h.row.taskInputHash = sealed.inputHash;}
    if (reason === 'run-intake') {const run = h.makeRun(); run.scope.intakeRequestId = 'other'; h.setRun(run);}
    if (reason === 'caller') {h.setRun(h.makeRun()); h.state.configuration.caller.appId = 'cli_new-caller';}
    if (reason === 'role') h.actors.withActorScope.mockRejectedValue(new Error('ACTUAL_SERVICE_ROLE_REQUIRED'));
    if (reason === 'invisible') h.repository.readByOperationRef.mockResolvedValue(null);
    await expect(h.service.runOnce()).rejects.toThrow();
    expect(h.execution.execute).not.toHaveBeenCalled(); expect(h.jobAid.enqueueOriginalContinuation).not.toHaveBeenCalled();
  });

  it('keeps independent Wiki and disabled enterprise automation consumers separate', async () => {
    const h = fixture(); h.state.configuration.background.enabled = false;
    const wiki = {next: jest.fn(async () => ({status: 'IDLE'}))};
    const automation = new HierarchicalWikiAutomation(wiki as never, h.service);
    expect(await automation.tickAilyEngineering()).toEqual({status: 'UNAVAILABLE', reason: 'AILY_BACKGROUND_DISABLED'});
    expect(h.workItems.loadAutoProcessingProjection).not.toHaveBeenCalled();
    expect(wiki.next).not.toHaveBeenCalled();
    await automation.reserveDue(); expect(wiki.next).toHaveBeenCalledTimes(1);
  });
});


it('uses the original background dispatcher in fixed-service mode without a browser/JWT identity',async()=>{
  const h=fixture(true);expect(h.state.configuration.mcp).not.toHaveProperty('signingSecret');
  expect(await h.service.runOnce()).toMatchObject({status:'DISPATCHED',requestId:h.stage.requestId});
  expect(h.execution.execute).toHaveBeenCalledWith(expect.objectContaining({purpose:'BACKGROUND',actor:{userId:'owner-test',tenantId:'tenant-test'}}));
  expect(h.execution.execute.mock.calls[0][0]).not.toHaveProperty('sessionId');
  expect(h.jobAid.enqueueOriginalContinuation).not.toHaveBeenCalled();
});
