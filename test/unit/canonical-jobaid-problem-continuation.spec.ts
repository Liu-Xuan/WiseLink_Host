import * as authorizedWork from '../../server/modules/canonical-host/canonical-authorized-work-item-reader';
import { CanonicalHostInitialAnalysisStatusService } from '../../server/modules/canonical-host/canonical-host-initial-analysis-status.service';
import { taskModelSelection } from '../../server/modules/model-settings/canonical-model-catalog';
import * as runtimePolicy from '../../server/modules/canonical-host/canonical-host-openclaw-runtime-policy';
import * as sourcePlanning from '../../server/modules/canonical-host/canonical-translation-source-plan';
import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import {
  JOBAID_PROBLEM_RESULT_SCHEMA,
  JOBAID_PROBLEM_WORK_SCHEMA,
  type JobAidWorkRevision,
} from '@shared/jobaid-problem-assessment.interface';
import {
  canonicalJson,
  parseTaskEnvelope,
  sealTaskEnvelope,
} from '../../server/modules/action-attempt/action-attempt-envelope';
import type {
  ActionAttemptRow,
  ReserveActionAttemptInput,
} from '../../server/modules/action-attempt/action-attempt.types';
import {
  INITIAL_ANALYSIS_REQUEST_SCHEMA,
  assertPreparedInitialAnalysisInput,
  readInitialAnalysisRequestInput,
} from '../../server/modules/action-attempt/initial-analysis-request';
import { CanonicalJobAidProblemService } from '../../server/modules/canonical-host/canonical-jobaid-problem.service';
import { projectCommonAssessmentContext } from '../../server/modules/canonical-host/canonical-host-common-context.service';
import {
  configurationEvidenceShadow,
  createConfigurationEvidenceReevaluation,
} from '../../server/modules/canonical-host/configuration-evidence/configuration-evidence-reevaluation.state';
import { JOBAID_METHOD_BINDING, JOBAID_METHOD_EVIDENCE } from '../../server/modules/canonical-host/jobaid-method-pack';
import { assertJobAidProblemTaskBinding, buildJobAidProblemTask, parseJobAidProblemTask } from '../../server/modules/canonical-host/jobaid-problem-task';

const REQUEST_1 = '00000000-0000-4000-8000-000000000101';
const REQUEST_2 = '00000000-0000-4000-8000-000000000102';
const TENANT = 'tenant-jobaid-continuation';
const OWNER = 'owner-jobaid';
const ENGLISH = `Do not replace unless the indication persists after 5 seconds. ${'A normal inspection does not exclude intermittent failure. '.repeat(50)}Retain this final condition.`;
const scope = {
  tenantId: TENANT,
  workItemId: 'WI-JOBAID-CONTINUE',
  principalId: 'service:openclaw-real',
  appId: 'app_17bzc551rsg',
  authorizationFingerprint: 'permission-service',
};

describe('JobAid continuation requests', () => {
  it('registers exact program material bytes without putting plaintext in the progress journal', async () => {
    const h = harness();
    await h.service.enqueueContinuation(h.current(), TENANT, 'permission', REQUEST_1,
      'INITIAL_PROBLEM_ASSESSMENT', undefined, undefined, undefined, {modelRef:'miaoda/glm-5.3'});
    const started = await h.service.begin(h.current(), scope, 'INITIAL_PROBLEM_ASSESSMENT', REQUEST_1);
    Object.assign(h.rows.get(started.attemptRef)!, {attemptId:started.task.actionAttemptId,
      taskInputHash:started.task.inputHash,leaseOwner:scope.principalId,leaseToken:started.leaseToken,
      leaseGeneration:started.leaseGeneration,leaseExpiresAt:new Date('2099-01-01'),deadlineAt:new Date('2099-01-01')});
    const materials = {version:1,originalInput:started.modelInput,previousWorkRead:null,sourceReads:[],
      deliveredEvidenceRefs:[],modelInput:{continuousOriginal:{content:'exact materials'}}};
    const modelRequest = {version:1,executionModel:started.task.executionModel,materialCheckpoint:'program-materials',
      body:canonicalJson({messages:[{role:'system',content:'analyze'},{role:'user',content:canonicalJson(materials.modelInput)}]})};
    const artifact = {ref:'artifact://materials',sha256:'a'.repeat(64),byteLength:123,mediaType:'application/json',storeRole:'UnifiedArtifactStoreCandidate'};
    (h.artifactStore.persistAndReadback as jest.Mock).mockImplementationOnce(async (bytes:Uint8Array) => ({artifact,bytes}));
    const result = await h.service.recordProgramProgress({attemptRef:started.attemptRef,workItemId:scope.workItemId,
      leaseToken:started.leaseToken,leaseGeneration:started.leaseGeneration,phase:'MATERIALS_READY',checkpointRef:'program-materials',
      materialSnapshotJson:JSON.stringify({materials,modelRequest})});
    expect(result.status).toBe('RECORDED');
    expect(h.work.recordProgramProgress).toHaveBeenCalledWith(expect.objectContaining({materialsArtifact:artifact}));
    expect(h.work.recordProgramProgress.mock.calls[0][0]).not.toHaveProperty('materialSnapshotJson');
    expect(h.work.recordProgramProgress.mock.calls[0][0]).not.toHaveProperty('snapshot');
  });

  it('reads the exact historical program input only after all current source grants pass', async () => {
    const h = harness();
    await h.service.enqueueContinuation(h.current(), TENANT, 'permission', REQUEST_1,
      'INITIAL_PROBLEM_ASSESSMENT', undefined, undefined, undefined, {modelRef:'miaoda/glm-5.3'});
    const started = await h.service.begin(h.current(), scope, 'INITIAL_PROBLEM_ASSESSMENT', REQUEST_1);
    const row = h.rows.get(started.attemptRef)!;
    Object.assign(row,{attemptId:started.task.actionAttemptId,taskInputHash:started.task.inputHash});
    const materials = {version:1,originalInput:started.modelInput,previousWorkRead:null,sourceReads:[],
      deliveredEvidenceRefs:[],modelInput:{continuousOriginal:{content:'exact historical materials'}}};
    const snapshot = {materials,modelRequest:{version:1,executionModel:started.task.executionModel,
      materialCheckpoint:'program-materials',body:canonicalJson({messages:[{role:'system'},
        {role:'user',content:canonicalJson(materials.modelInput)}]})}};
    const artifact = {ref:'artifact://historical',sha256:'a'.repeat(64),byteLength:123,mediaType:'application/json',storeRole:'UnifiedArtifactStoreCandidate'};
    row.reviewActivityJson=JSON.stringify([{kind:'ASSESSMENT_PROGRAM_PROGRESS',phase:'MATERIALS_READY',
      checkpointRef:'program-materials',materialsArtifact:artifact,observedAt:'2026-10-25T00:00:00Z'}]);
    h.artifactStore.readActualBytes.mockResolvedValue(new TextEncoder().encode(canonicalJson({workItemId:scope.workItemId,
      attemptId:row.attemptId,attemptRef:row.operationRef,taskInputHash:row.taskInputHash,snapshot})));
    const authorization = jest.spyOn(authorizedWork,'authorizeAndLoadCanonicalWorkItem')
      .mockResolvedValue({workItem:h.current(),permissionSnapshotVersion:'fresh'});
    const sourceCheck = jest.spyOn(h.service as unknown as {assertBrowserEvidenceOwned: (...args:unknown[])=>Promise<void>},
      'assertBrowserEvidenceOwned').mockResolvedValue();
    const actor={tenantId:TENANT,userId:OWNER,appId:'app_17bzc551rsg',roles:[],env:'runtime' as const};
    try {
      const result=await h.service.readBrowserProgramMaterials(scope.workItemId,row.attemptId,actor);
      expect(result).toMatchObject({snapshot,submissionEvidence:'PREPARED_NOT_CONFIRMED_SENT',attemptId:row.attemptId});
      expect(sourceCheck.mock.calls[0][0]).toEqual(parseJobAidProblemTask(started.task).sourceCatalog);
      expect(h.artifactStore.readActualBytes).toHaveBeenLastCalledWith(artifact);
      h.artifactStore.readActualBytes.mockClear();
      sourceCheck.mockRejectedValueOnce(new Error('JOBAID_SOURCE_AUTHORIZATION_CHANGED'));
      await expect(h.service.readBrowserProgramMaterials(scope.workItemId,row.attemptId,actor))
        .rejects.toThrow('JOBAID_SOURCE_AUTHORIZATION_CHANGED');
      expect(h.artifactStore.readActualBytes).not.toHaveBeenCalled();
      const records=JSON.parse(row.reviewActivityJson!);records.push({kind:'ASSESSMENT_PROGRAM_PROGRESS',phase:'MODEL_RESPONSE_SAVED',
        checkpointRef:'program-response',observedAt:'2026-10-25T00:01:00Z'});row.reviewActivityJson=JSON.stringify(records);
      expect(await h.service.readBrowserProgramMaterials(scope.workItemId,row.attemptId,actor)).toMatchObject({submissionEvidence:'RESPONSE_RECEIVED'});
    } finally { authorization.mockRestore(); sourceCheck.mockRestore(); }
  });

  it('reads only the sealed previous work baseline without treating it as this attempt saved-work proof', async () => {
    const h = harness();
    const previous = savedWork();
    h.work.listForRuntime.mockResolvedValue([previous]);
    await h.service.enqueueContinuation(h.current(), TENANT, 'permission', REQUEST_1,
      'INITIAL_PROBLEM_ASSESSMENT', undefined, undefined, undefined, {modelRef: 'miaoda/glm-5.3'});
    const started = await h.service.begin(h.current(), scope, 'INITIAL_PROBLEM_ASSESSMENT', REQUEST_1);
    const newer = {...previous, workRevisionRef: 'JAWR-NEWER', workRevision: 4};
    h.work.listForRuntime.mockResolvedValue([newer, previous]);
    const fence = {leaseToken: started.leaseToken, leaseGeneration: started.leaseGeneration};
    expect((await h.service.readAttemptWork(started.attemptRef, undefined, scope.workItemId, fence, previous.workRevisionRef)).revision)
      .toEqual(previous);
    expect(h.work.recordWorkRead).not.toHaveBeenCalled();
    await expect(h.service.readAttemptWork(started.attemptRef, undefined, scope.workItemId, fence, newer.workRevisionRef))
      .rejects.toThrow('JOBAID_PROGRAM_BASELINE_READ_INVALID');
    await expect(h.service.readAttemptWork(started.attemptRef, previous.requestId, scope.workItemId, fence, previous.workRevisionRef))
      .rejects.toThrow('JOBAID_PROGRAM_BASELINE_READ_INVALID');
    await expect(h.service.enqueueContinuation(h.current(), TENANT, 'permission', REQUEST_1, 'INITIAL_PROBLEM_ASSESSMENT'))
      .rejects.toThrow('JOBAID_REQUEST_SCOPE_CHANGED');
  });

  it.each(['success', 'read-missing', 'read-other-revision', 'overview-stale', 'artifact-failure', 'ack-lost'] as const)(
    'program initial projects only independently read saved work and recovers without another analysis: %s', async scenario => {
      const h = harness();
      await h.service.enqueueContinuation(h.current(), TENANT, 'permission', REQUEST_1,
        'INITIAL_PROBLEM_ASSESSMENT', undefined, undefined, undefined, {modelRef: 'miaoda/glm-5.3'});
      const started = await h.service.begin(h.current(), scope, 'INITIAL_PROBLEM_ASSESSMENT', REQUEST_1);
      expect(started.modelInput.executionMode).toBe('PROGRAM_CONTROLLED_V1');
      const preparedTask = parseJobAidProblemTask(started.task);
      expect(started.task.executionModel?.modelRef).toBe('miaoda/glm-5.3');
      expect(preparedTask.modelInput.programOriginal?.binding).toEqual(preparedTask.modelInput.documentOverview.original?.binding);
      expect(preparedTask.modelInput.programOriginal?.units.length).toBeGreaterThan(0);
      expect(preparedTask.savedWorkReconciliation).toBeUndefined();
      const revision = {...savedWork(), actionAttemptId: started.task.actionAttemptId};
      if (scenario === 'overview-stale') revision.content.overviewStatus = 'STALE';
      h.work.listForRuntime.mockResolvedValue([revision]);
      if (scenario !== 'read-missing') {
        await h.service.readAttemptWork(started.attemptRef, revision.requestId, scope.workItemId,
          {leaseToken: started.leaseToken, leaseGeneration: started.leaseGeneration});
        expect(h.work.recordWorkRead).toHaveBeenCalledTimes(1);
      }
      if (scenario === 'read-other-revision') h.rows.get(started.attemptRef)!.reviewActivityJson =
        h.rows.get(started.attemptRef)!.reviewActivityJson!.replace(revision.workRevisionRef, 'JAWR-OTHER');
      const prepared = {task: started.task, row: {...h.rows.get(started.attemptRef),
        attemptId: started.task.actionAttemptId, tenantId: TENANT, workItemId: scope.workItemId,
        documentVersionId: started.task.documentVersionId, baseRevision: started.task.baseRevision,
        status: 'COMMITTING', triggerRequestId: 'TRIGGER-PROGRAM'}, result: {
        toolVersions: {'jobaid-problem-protocol': '2'}, promptVersion: 'wiselink-jobaid-problem@v2',
        modelOutput: JSON.stringify({workRevisionRef: revision.workRevisionRef})}};
      h.attempts.prepareCommit.mockResolvedValue(prepared);
      const preflight = jest.spyOn(runtimePolicy, 'preflightCanonicalHostOpenClawResult')
        .mockReturnValue({task: prepared.task, result: prepared.result} as never);
      const input = {row: prepared.row, scope: {...scope, attemptRef: started.attemptRef},
        leaseToken: started.leaseToken, leaseGeneration: started.leaseGeneration, result: prepared.result};
      if (scenario === 'artifact-failure') h.artifactStore.persistAndReadback.mockRejectedValueOnce(new Error('ARTIFACT_UNAVAILABLE'));
      if (scenario === 'ack-lost') h.attempts.finishProjectionSuccess.mockRejectedValueOnce(new Error('ACK_LOST'));
      try {
        if (['read-missing', 'read-other-revision', 'overview-stale', 'artifact-failure'].includes(scenario)) {
          await expect(h.service.commit(input as never)).rejects.toThrow();
          expect(h.registrar.compareAndSet).not.toHaveBeenCalled();
          expect(h.attempts.finishResultGateFailure).not.toHaveBeenCalled();
          expect(h.work.listForRuntime.mock.results.length).toBeGreaterThan(0);
          if (scenario !== 'artifact-failure') return;
        }
        await h.service.commit(input as never);
        const overall = h.current().integratedAssessment?.overallSynthesis;
        expect(overall).toMatchObject({executionKind: 'DETERMINISTIC_PROJECTION', modelRequests: 0,
          overallCandidate: revision.content.understanding,
          basedOnJobAidWorkRevisionRef: revision.workRevisionRef,
          sourceAssessment: {actionAttemptId: revision.actionAttemptId, workRevisionRef: revision.workRevisionRef,
            workRevision: revision.workRevision, saveRequestId: revision.requestId}});
        expect(overall).not.toHaveProperty('sourceReview');
        expect(h.current().integratedAssessment?.baseRules).toMatchObject({readingResult: overall?.readingResult});
        await h.service.commit(input as never);
        expect(h.registrar.compareAndSet).toHaveBeenCalledTimes(1);
        expect(h.attempts.reserve).toHaveBeenCalledTimes(1);
        expect(h.attempts.finishResultGateFailure).not.toHaveBeenCalled();
        if (scenario === 'success') {
          Object.assign(h.current().package!, {contractId: 'techpub.parsed-package.v1', contractRevision: 'frozen.2'});
          const stored = {...prepared.row, actionType: started.task.taskType, requestOrigin: 'OPENCLAW_MCP_V1',
            status: 'SUCCEEDED', projectionApplied: true, taskEnvelopeJson: canonicalJson(started.task),
            taskInputHash: started.task.inputHash, executionModelJson: canonicalJson(started.task.executionModel)};
          const database = {
            selectDistinctOn: () => ({from: () => ({where: () => ({orderBy: async () => [stored]})})}),
            select: () => ({from: () => ({where: () => ({limit: async () => [stored]})})}),
          };
          const savedStore = {
            readByRef: jest.fn(async (identity: {workRevisionRef: string}) =>
              identity.workRevisionRef === revision.workRevisionRef ? revision : null),
            latest: jest.fn(async () => ({...revision, workRevision: revision.workRevision + 1, workRevisionRef: 'JAWR-SAVED-LATER'})),
          };
          const statusService = new CanonicalHostInitialAnalysisStatusService(database as never, h.attempts as never,
            savedStore as never);
          const mode = process.env.WL_JOBAID_PROBLEM_V2_ENABLED;
          process.env.WL_JOBAID_PROBLEM_V2_ENABLED = '0';
          try {
            const status = await statusService.project({workItem: h.current(), tenantId: TENANT, browserActorUserId: OWNER});
            expect(status.stages.overall.status).toBe('SUCCEEDED');
            // Work 2 already exists; Overall 1 remains a valid historical result.
            // The working reader separately reports its relation to work 2 as STALE.
            expect(savedStore.latest).not.toHaveBeenCalled();
            expect(savedStore.readByRef).toHaveBeenCalledWith({tenantId: TENANT, workItemId: scope.workItemId,
              workRevisionRef: revision.workRevisionRef});
            h.current().integratedAssessment!.overallSynthesis!.sourceAssessment!.workRevisionRef = 'JAWR-WRONG';
            const invalid = await statusService.project({workItem: h.current(), tenantId: TENANT, browserActorUserId: OWNER});
            expect(invalid.stages.overall).toMatchObject({status: 'CONFLICT', terminalCode: 'INITIAL_OVERALL_PROJECTION_RECORD_INVALID'});
          } finally {
            if (mode === undefined) delete process.env.WL_JOBAID_PROBLEM_V2_ENABLED;
            else process.env.WL_JOBAID_PROBLEM_V2_ENABLED = mode;
          }
        }
      } finally { preflight.mockRestore(); }
    });

  it('derives successor Overall from the persisted receipt, keeps the prior projection, and replays one attempt', async () => {
    const h = successorHarness();
    const before = structuredClone(h.current());
    const first = await h.service.beginSuccessorOverall(scope.workItemId,h.delegated,'TURN-SUCCESSOR');
    const replay = await h.service.beginSuccessorOverall(scope.workItemId,h.delegated,'TURN-SUCCESSOR');
    expect(replay.attemptRef).toBe(first.attemptRef);
    expect(h.attempts.reserve).toHaveBeenCalledTimes(1);
    expect(h.current()).toEqual(before);
    const input = parseJobAidProblemTask(first.task);
    expect(input.previousWork?.workRevisionRef).toBe('JAWR-PERSISTED-3');
    expect(input.successorOverallBinding).toEqual({reviewConversationRef:'CONV-SUCCESSOR',
      requestId:'REQUEST-SUCCESSOR',inputRevision:5,workRevisionRef:'JAWR-PERSISTED-3',
      workRevision:3,workItemRevision:5});
    expect(first.task.sourceRefs).toEqual([{ref:'ART-TEST',sha256:'a'.repeat(64)}]);
    expect(first.task.baseRevision).toBe(5);
    expect(h.conversations.loadOpenClawTurnByIdBinding).toHaveBeenCalledWith({
      tenantId:TENANT,actorId:OWNER,workItemId:scope.workItemId,
      reviewConversationId:'CONV-SUCCESSOR',reviewTurnId:'TURN-SUCCESSOR'});
  });

  it.each(['no-grant','no-overall','different-turn','no-work','unchanged','newer-work','unfinished','source-change'])(
    'fails closed before reserving successor Overall for %s', async reason => {
      const h = successorHarness();
      if (reason === 'no-grant') delete h.delegated.successorReviewDelegation;
      if (reason === 'no-overall') h.turn.overallRequested=false;
      if (reason === 'different-turn') h.turn.requestId='OTHER';
      if (reason === 'no-work') h.turn.assistantCandidate.jobAidWorkingUpdate.workRevisionRef=null;
      if (reason === 'unchanged') h.turn.assistantCandidate.jobAidWorkingUpdate.status='UNCHANGED';
      if (reason === 'newer-work') h.work.listForRuntime.mockResolvedValue([{...savedWork(),workRevisionRef:'OTHER',workRevision:4}]);
      if (reason === 'unfinished') {const work=savedWork();work.content.roundCompletion='IN_PROGRESS';h.work.listForRuntime.mockResolvedValue([work]);}
      if (reason === 'source-change') h.current().source.sourceArtifactId='OTHER';
      await expect(h.service.beginSuccessorOverall(scope.workItemId,h.delegated,'TURN-SUCCESSOR')).rejects.toThrow('JOBAID_SUCCESSOR_OVERALL_');
      expect(h.attempts.reserveAndClaim).not.toHaveBeenCalled();
    });

  it('does not duplicate a terminal successor Overall after a lost response', async () => {
    const h=successorHarness();
    const first=await h.service.beginSuccessorOverall(scope.workItemId,h.delegated,'TURN-SUCCESSOR');
    h.rows.get(first.attemptRef)!.status='SUCCEEDED';
    await expect(h.service.beginSuccessorOverall(scope.workItemId,h.delegated,'TURN-SUCCESSOR'))
      .rejects.toThrow('ACTION_ATTEMPT_ALREADY_SUCCEEDED');
    expect(h.attempts.reserve).toHaveBeenCalledTimes(1);
  });

  it('recovers the same COMMITTING fence after projection CAS advanced the WorkItem revision', async () => {
    const h=successorHarness();
    const started=await h.service.beginSuccessorOverall(scope.workItemId,h.delegated,'TURN-SUCCESSOR');
    const task=started.task;
    Object.assign(h.rows.get(started.attemptRef)!, {status:'COMMITTING',attemptId:task.actionAttemptId,
      actionType:task.taskType,tenantId:task.tenantId,workItemId:task.workItemId,
      inputRevision:task.inputRevision,baseRevision:task.baseRevision,documentVersionId:task.documentVersionId,
      idempotencyKey:task.idempotencyKey,taskInputHash:task.inputHash,
      leaseOwner:scope.principalId,leaseToken:started.leaseToken,leaseGeneration:started.leaseGeneration,
      leaseExpiresAt:new Date(started.leaseExpiresAt)});
    h.advanceRevision();
    const stored=jest.spyOn(runtimePolicy,'parseCanonicalHostOpenClawStoredResult').mockReturnValue({status:'SUCCEEDED'} as never);
    try {
      const recovered=await h.service.beginSuccessorOverall(scope.workItemId,h.delegated,'TURN-SUCCESSOR');
      expect(recovered).toMatchObject({attemptRef:started.attemptRef,status:'COMMITTING',
        leaseToken:started.leaseToken,leaseGeneration:started.leaseGeneration,recoveryResult:{status:'SUCCEEDED'}});
      expect(recovered.task.baseRevision).toBe(5);
      expect(h.attempts.reserveAndClaim).toHaveBeenCalledTimes(1);
    } finally {stored.mockRestore();}
  });

  it.each([false,true])('commits only the exact successor work with a transactional latest guard; CAS race=%s', async race => {
    const h=successorHarness();
    const started=await h.service.beginSuccessorOverall(scope.workItemId,h.delegated,'TURN-SUCCESSOR');
    const prepared={task:started.task,row:{...h.rows.get(started.attemptRef),attemptId:started.task.actionAttemptId,
      tenantId:TENANT,workItemId:scope.workItemId,status:'COMMITTING',triggerRequestId:'TRIGGER'},
      result:{toolVersions:{'jobaid-problem-protocol':'2'},promptVersion:'wiselink-jobaid-problem@v2',
        modelOutput:JSON.stringify({workRevisionRef:savedWork().workRevisionRef,consistencyCheck:'Reviewed exact saved work.'})}};
    const preflight=jest.spyOn(runtimePolicy,'preflightCanonicalHostOpenClawResult').mockReturnValue({
      task:prepared.task,result:prepared.result} as never);
    h.attempts.prepareCommit.mockResolvedValue(prepared);
    h.current().integratedAssessment!.baseRules={...h.current().integratedAssessment!.baseRules,
      revision:1,artifact:{ref:'OLD',sha256:'a'.repeat(64)}} as never;
    if(race) h.registrar.compareAndSet.mockRejectedValueOnce(new Error('JOBAID_OVERALL_EXACT_WORK_CHANGED'));
    const commitInput={row:prepared.row,scope:{...h.delegated,attemptRef:started.attemptRef},
      leaseToken:started.leaseToken,leaseGeneration:started.leaseGeneration,result:prepared.result};
    try {
      const result=await h.service.commit(commitInput as never);
      expect(h.registrar.compareAndSet).toHaveBeenCalledWith(expect.objectContaining({
        expectedRevision:5,syncPrimaryAttempt:false,
        jobAidWorkRevisionGuard:{tenantId:TENANT,workRevisionRef:'JAWR-PERSISTED-3',
          sourceGuard:{actorUserId:started.task.modelInput.actorUserId,
            sourceBindings:started.task.modelInput.sourceBindings}}}));
      if(race) {
        expect(h.attempts.finishResultGateFailure).toHaveBeenCalled();
        expect(h.current().integratedAssessment!.overallSynthesis!.status).toBe('STALE');
      } else {
        expect(result).toMatchObject({overallSynthesis:{basedOnJobAidWorkRevisionRef:'JAWR-PERSISTED-3',status:'CANDIDATE_ONLY'}});
        await h.service.commit(commitInput as never);
        expect(h.registrar.compareAndSet).toHaveBeenCalledTimes(1);
      }
    } finally {preflight.mockRestore();}
  });

  it('rejects a model-selected successor work ref and never publishes it', async () => {
    const h=successorHarness();
    const started=await h.service.beginSuccessorOverall(scope.workItemId,h.delegated,'TURN-SUCCESSOR');
    const prepared={task:started.task,row:{...h.rows.get(started.attemptRef),attemptId:started.task.actionAttemptId,
      tenantId:TENANT,workItemId:scope.workItemId,status:'COMMITTING'},result:{
        toolVersions:{'jobaid-problem-protocol':'2'},promptVersion:'wiselink-jobaid-problem@v2',
        modelOutput:JSON.stringify({workRevisionRef:'MODEL-CHOSEN',consistencyCheck:'done'})}};
    h.work.listForRuntime.mockResolvedValue([{...savedWork(),workRevisionRef:'MODEL-CHOSEN',workRevision:4}]);
    h.attempts.prepareCommit.mockResolvedValue(prepared);
    const preflight=jest.spyOn(runtimePolicy,'preflightCanonicalHostOpenClawResult').mockReturnValue({task:prepared.task,result:prepared.result} as never);
    try {
      await h.service.commit({row:prepared.row,scope:{...h.delegated,attemptRef:started.attemptRef},
        leaseToken:started.leaseToken,leaseGeneration:started.leaseGeneration,result:prepared.result} as never);
      expect(h.attempts.finishResultGateFailure).toHaveBeenCalledWith(prepared,expect.objectContaining({message:'JOBAID_SUCCESSOR_OVERALL_WORK_CHANGED'}));
      expect(h.registrar.compareAndSet).not.toHaveBeenCalled();
    } finally {preflight.mockRestore();}
  });

  it('reads the exact attempt identity and starting revision for bounded recovery', async () => {
    const h = harness();
    h.work.listForRuntime.mockResolvedValue([{
      ...savedWork(), actionAttemptId: 'ATT-PRIOR',
    }]);
    const started = await h.service.begin(h.current(), scope, 'INITIAL_PROBLEM_ASSESSMENT');
    h.work.listForRuntime.mockResolvedValue([{
      ...savedWork(), actionAttemptId: 'ATT-CONTINUATION-1',
      workRevisionRef: 'JAWR-PERSISTED-4', workRevision: 4,
      previousWorkRevisionRef: savedWork().workRevisionRef,
    }, savedWork()]);
    const read = await h.service.readAttemptWork(started.attemptRef, undefined,
      scope.workItemId);
    expect(read).toMatchObject({
      schemaVersion: 'wiselink.jobaid-work-read.v2',
      attemptId: 'ATT-CONTINUATION-1', inputWorkRevision: 3,
      revision: { actionAttemptId: 'ATT-CONTINUATION-1', workRevision: 4 },
      executionStatus: 'RUNNING',
    });
  });

  it('prepares all pages with one plan and independently revalidates before returning the task', async () => {
    const h = harness();
    const loaded = await h.originalReader.readDocumentOriginal();
    const first = loaded.structuredSource.units[0];
    loaded.structuredSource.units = Array.from({ length: 61 }, (_, index) => ({ ...first,
      unitId: `u${index}`, order: index, payload: { text: `Complete source condition ${index}.` } }));
    h.originalReader.readDocumentOriginal.mockResolvedValue(loaded);
    h.originalReader.readDocumentOriginal.mockClear();
    const plan = jest.spyOn(sourcePlanning, 'buildTranslationSourcePlan');
    try {
      const started = await h.service.begin(h.current(), scope, 'INITIAL_PROBLEM_ASSESSMENT');
      expect(plan).toHaveBeenCalledTimes(2); // One for preparation, one for fresh source authorization.
      expect(h.originalReader.readDocumentOriginal).toHaveBeenCalledTimes(2);
      const catalog = parseJobAidProblemTask(started.task).sourceCatalog.filter(item => item.kind === 'DOCUMENT_PASSAGE');
      expect(catalog).toHaveLength(1);
      expect(catalog[0].excerpt).toBe(loaded.structuredSource.units.map(unit => unit.payload.text).join('\n'));
    } finally { plan.mockRestore(); }
  });

  it('prepares one exact finder per authorization of many distinct original refs and reloads on every work read', async () => {
    const h = harness();
    const loaded = await h.originalReader.readDocumentOriginal();
    const first = loaded.structuredSource.units[0];
    const locator = loaded.structuredSource.sourceLocators[0];
    const location = loaded.original.locations[0];
    const refs = Array.from({ length: 61 }, (_, index) => `SR-DISTINCT-${index}`);
    loaded.structuredSource.units = refs.map((ref, index) => ({ ...first,
      unitId: `u${index}`, order: index, sourceRefIds: [ref], sourceSegmentIds: [ref],
      payload: { text: `Complete source condition ${index}; retain its exact exception.` } }));
    loaded.structuredSource.sourceLocators = refs.map(sourceRefId => ({ ...locator,
      sourceRefId, pageStart: 0, pageEnd: 0 }));
    loaded.original.locations = refs.map(sourceRefId => ({ ...location, sourceRefId, pageIndex: 0 }));
    loaded.original.coverage = { knownPageCount: 1, readPageIndexes: [0], unresolvedRanges: [] };
    h.originalReader.readDocumentOriginal.mockResolvedValue(loaded);
    h.originalReader.readDocumentOriginal.mockClear();
    const plan = jest.spyOn(sourcePlanning, 'buildTranslationSourcePlan');
    try {
      const started = await h.service.begin(h.current(), scope, 'INITIAL_PROBLEM_ASSESSMENT');
      const catalog = parseJobAidProblemTask(started.task).sourceCatalog.filter(item => item.kind === 'DOCUMENT_PASSAGE');
      expect(catalog.map(item => item.sourceRefId)).toEqual(refs);
      expect(catalog.map(item => item.excerpt)).toEqual(loaded.structuredSource.units.map(unit => unit.payload.text));
      // Preparation and its independent fresh authorization each build once,
      // regardless of the number of refs in the exact original.
      expect(plan).toHaveBeenCalledTimes(2);
      expect(h.originalReader.readDocumentOriginal).toHaveBeenCalledTimes(2);
      const frozen = structuredClone(started.task);
      plan.mockClear();
      h.originalReader.readDocumentOriginal.mockClear();
      for (let read = 0; read < 2; read++) {
        await expect(h.service.readAttemptWork(started.attemptRef, undefined, scope.workItemId))
          .resolves.toMatchObject({ schemaVersion: 'wiselink.jobaid-work-read.v2', revision: null });
      }
      expect(plan).toHaveBeenCalledTimes(2);
      expect(h.originalReader.readDocumentOriginal).toHaveBeenCalledTimes(2);
      expect(h.task(started.attemptRef)).toEqual(frozen);
      const changed = structuredClone(loaded);
      changed.structuredSource.units[0].payload.text = 'Changed exact original text.';
      h.originalReader.readDocumentOriginal.mockResolvedValue(changed);
      await expect(h.service.readAttemptWork(started.attemptRef, undefined, scope.workItemId))
        .rejects.toThrow('JOBAID_ORIGINAL_SOURCE_CHANGED');
      h.originalReader.readDocumentOriginal.mockRejectedValue(new Error('SOURCE_ACCESS_REVOKED'));
      await expect(h.service.readAttemptWork(started.attemptRef, undefined, scope.workItemId))
        .rejects.toThrow('SOURCE_ACCESS_REVOKED');
      expect(h.originalReader.readDocumentOriginal).toHaveBeenCalledTimes(4);
      expect(h.task(started.attemptRef)).toEqual(frozen);
    } finally { plan.mockRestore(); }
  });

  it('requires published original input and rechecks exact original bytes on a resumed task', async () => {
    const missing = harness();
    missing.work.publishedOriginalBinding.mockRejectedValue(new Error('DOCUMENT_ORIGINAL_NOT_PUBLISHED'));
    await expect(missing.service.begin(missing.current(),scope,'INITIAL_PROBLEM_ASSESSMENT'))
      .rejects.toThrow('DOCUMENT_ORIGINAL_NOT_PUBLISHED');
    expect(missing.artifactStore.readActualBytes).not.toHaveBeenCalled();
    const h = harness();
    const started = await h.service.begin(h.current(),scope,'INITIAL_PROBLEM_ASSESSMENT');
    const frozen = structuredClone(started.task);
    const changed = await h.originalReader.readDocumentOriginal();
    changed.original.source.units[0].payload = {text:'Unexpected rewrite of a published original.'};
    h.originalReader.readDocumentOriginal.mockResolvedValue(changed);
    await expect(h.service.begin(h.current(),scope,'INITIAL_PROBLEM_ASSESSMENT'))
      .rejects.toThrow('JOBAID_ORIGINAL_SOURCE_CHANGED');
    expect(h.task(started.attemptRef)).toEqual(frozen);
    h.originalReader.readDocumentOriginal.mockRejectedValue(new Error('SOURCE_ACCESS_REVOKED'));
    await expect(h.service.begin(h.current(),scope,'INITIAL_PROBLEM_ASSESSMENT')).rejects.toThrow('SOURCE_ACCESS_REVOKED');
  });
  it('prepares the reserved original even when a newer parse is published before claim', async () => {
    const h = harness();
    const queued = await h.enqueue(REQUEST_1);
    const request = readInitialAnalysisRequestInput(h.task(queued.attemptRef))!;
    expect(request.originalParseRunId).toBe('PR-TEST-2');
    h.work.publishedOriginalBinding.mockResolvedValue({parseRunId:'PR-TEST-3'});
    const begun = await h.service.begin(h.current(), scope, 'INITIAL_PROBLEM_ASSESSMENT', REQUEST_1);
    expect(h.work.publishedOriginalBinding).not.toHaveBeenCalled();
    expect(h.work.publishedOriginalBindingForRequest).toHaveBeenCalledTimes(1);
    expect(h.originalReader.readDocumentOriginal).toHaveBeenCalledWith(
      'DV-JOBAID', 'PR-TEST-2', expect.objectContaining({actorUserId:OWNER,tenantId:TENANT}));
    expect(parseJobAidProblemTask(begun.task).modelInput.documentOverview.original).toMatchObject({binding:{parseRunId:'PR-TEST-2'}});
    const substituted = structuredClone(begun.task.modelInput);
    (substituted.modelInput as {documentOverview:{original:{binding:{parseRunId:string}}}})
      .documentOverview.original.binding.parseRunId='PR-TEST-3';
    expect(() => assertPreparedInitialAnalysisInput(request, substituted))
      .toThrow('ACTION_ATTEMPT_INITIAL_REQUEST_ORIGINAL_CHANGED');
  });

  it.each(['same','different-original','different-fleet'] as const)('passes only matching original applicability into the actual JobAid task: %s',async mode=>{
    const h=harness(); const current=h.current();
    const original=(await h.originalReader.readDocumentOriginal()).original;
    const originalSource={binding:original.binding,artifact:{ref:'document-original://fixture/parse',sha256:'b'.repeat(64),byteLength:100,mediaType:'application/json'}};
    current.applicabilityInput={schemaVersion:'wiselink.3_1.applicability_input_projection.v2',currentness:'CURRENT',
      workItemId:current.workItemId,documentVersionId:current.source.documentVersionId,sourcePackageId:null,
      sourcePackageContentHash:null,sourcePackageArtifactSha256:null,originalSource,
      applicabilityContextRef:'context',bindingRevision:'binding',aircraftNumber:'B-TEST',assessmentAsOf:'2026-09-09',
      fleetMasterData:{sourceSnapshotId:'fleet',sourceRevisionKey:'rev',authorityRevision:'authority'}} as CanonicalWorkItemProjection['applicabilityInput'];
    current.applicability={schemaVersion:'wiselink.3_1.applicability_candidate_projection.v3',currentness:'CURRENT',staleReason:null,
      documentId:current.source.documentId,documentVersionId:current.source.documentVersionId,sourcePackageId:null,
      sourcePackageContentHash:null,translationActionAttemptId:null,sourceReadingMode:'VERIFIED_ENGLISH',originalSource:structuredClone(originalSource),
      applicabilityContextRef:'context',applicabilityBindingRevision:'binding',aircraftNumber:'B-TEST',assessmentAsOf:'2026-09-09',
      fleetSourceSnapshotId:'fleet',fleetSourceRevisionKey:'rev',fleetAuthorityRevision:'authority',
      status:'CANDIDATE_ONLY',decision:'APPLICABLE',kleeneResult:true,pass:true,blockingUnknownCount:0,sourceExpressionCount:1} as CanonicalWorkItemProjection['applicability'];
    if(mode==='different-original') {
      current.applicabilityInput!.originalSource!.binding.parseRunId='previous';
      (current.applicability as Extract<NonNullable<typeof current.applicability>,{schemaVersion:'wiselink.3_1.applicability_candidate_projection.v3'}>).originalSource.binding.parseRunId='previous';
    }
    if(mode==='different-fleet') current.applicabilityInput!.fleetMasterData.sourceRevisionKey='new';
    const started=await h.service.begin(current,scope,'INITIAL_PROBLEM_ASSESSMENT');
    const result=parseJobAidProblemTask(started.task).modelInput.hostApplicability;
    if(mode==='same') expect(result).toMatchObject({decision:'APPLICABLE',pass:true});
    else expect(result).toBeNull();
    expect(current.applicability!.decision).toBe('APPLICABLE');
  });
  it('claims a source-file-bound original task without a legacy package', async () => {
    const h=harness(); h.current().package=null; h.current().classification.normalizedFamily='FTD';
    const started=await h.service.begin(h.current(),scope,'INITIAL_PROBLEM_ASSESSMENT');
    expect(started.task.sourceRefs).toEqual([{ref:'ART-TEST',sha256:'a'.repeat(64)}]);
    expect(parseJobAidProblemTask(started.task).sourceBindings[0]).toMatchObject({kind:'SOURCE_FILE',artifactRef:'ART-TEST'});
    expect(h.artifactStore.readActualBytes).not.toHaveBeenCalled();
  });
  it('keeps current original sections separate from retained historical parsing evidence', () => {
    const workItem = projection();
    const common = projectCommonAssessmentContext(workItem, {
      context: { status: 'AVAILABLE' }, documentReadingStatus: 'AVAILABLE',
      items: [], sections: [{ title: 'Original condition', sourceRefIds: ['SR-1'] }], resourceRefs: [],
    }, []);
    const current: AssessmentEvidence = { kind: 'DOCUMENT_PASSAGE', workItemId: workItem.workItemId,
      documentVersionId: 'DV-JOBAID', evidenceRef: 'DOCUMENT_ORIGINAL:DV-JOBAID:PR-2:SR-1',
      sourceRefId: 'SR-1', title: 'Original', versionLabel: 'PR-2', locator: 'page 1', excerpt: 'Corrected condition.' };
    const prior = { ...current, evidenceRef: 'DOCUMENT_ORIGINAL:DV-JOBAID:PR-1:SR-1',
      versionLabel: 'PR-1', excerpt: 'Earlier condition.' };
    const previousWork = savedWork(); previousWork.content.evidence = [prior];
    previousWork.content.readSourceRefs = [prior.evidenceRef];
    const task = buildJobAidProblemTask({ workItem, actorUserId: OWNER, permissionSnapshotVersion: 'permission',
      purpose: 'INITIAL_PROBLEM_ASSESSMENT', sourceCatalog: [current], sourceBindings: [], common,
      originalParseRunId: 'PR-2',
      previousWork, expectedWorkRevision: previousWork.workRevision, priorAssessmentRefs: [previousWork.workRevisionRef] });
    expect(task.sourceCatalog).toEqual(expect.arrayContaining([current, prior]));
    expect(task.modelInput.documentOverview.sections[0].sourceRefs).toEqual([current.evidenceRef]);
    expect(task.initiallyDeliveredRefs).toContain(prior.evidenceRef);
    expect(task.initiallyDeliveredRefs).toContain(current.evidenceRef);
    expect(task.modelInput.deliveredEvidence.find(item => item.evidenceRef === current.evidenceRef)?.excerpt)
      .toBe('Corrected condition.');
    expect(assertJobAidProblemTaskBinding(task)).toBe(task);
  });
  it.each(['INITIAL_PROBLEM_ASSESSMENT', 'OVERALL_CONSISTENCY', 'PROBLEM_REVIEW'] as const)(
    'delivers the independent generic severity clause to a new %s task', purpose => {
      const workItem = projection();
      const common = projectCommonAssessmentContext(workItem, {
        context: { status: 'AVAILABLE' }, documentReadingStatus: 'AVAILABLE',
        items: [], sections: [], resourceRefs: [],
      }, []);
      const definitions = JOBAID_METHOD_EVIDENCE.find(item => item.evidenceRef === 'method:severity-definitions')!;
      if (definitions.kind !== 'METHOD_CLAUSE') throw new Error('METHOD_FIXTURE_INVALID');
      const task = buildJobAidProblemTask({ workItem, actorUserId: OWNER,
        permissionSnapshotVersion: 'permission', purpose, sourceBindings: [], common,
        sourceCatalog: [], previousWork: null, expectedWorkRevision: 0, priorAssessmentRefs: [] });
      expect(task.initiallyDeliveredRefs).toContain(definitions.evidenceRef);
      expect(task.sourceCatalog.find(item => item.evidenceRef === definitions.evidenceRef)).toEqual(definitions);
      expect(task.modelInput.deliveredEvidence.find(item => item.evidenceRef === definitions.evidenceRef))
        .toMatchObject({ classificationDefinitions: definitions.classificationDefinitions, excerpt: definitions.excerpt });
      expect(assertJobAidProblemTaskBinding(task)).toBe(task);
    });

  it('recovers a sealed task without injecting a newly added core method clause', async () => {
    const h = harness();
    await h.enqueue(REQUEST_1);
    const begun = await h.service.begin(h.current(), scope, 'INITIAL_PROBLEM_ASSESSMENT', REQUEST_1);
    const legacy = structuredClone(parseJobAidProblemTask(begun.task));
    const newRef = 'method:severity-definitions';
    legacy.sourceCatalog = legacy.sourceCatalog.filter(item => item.evidenceRef !== newRef);
    legacy.initiallyDeliveredRefs = legacy.initiallyDeliveredRefs.filter(ref => ref !== newRef);
    legacy.modelInput.availableSources = legacy.modelInput.availableSources.filter(item => item.ref !== newRef);
    legacy.modelInput.deliveredEvidence = legacy.modelInput.deliveredEvidence.filter(item => item.evidenceRef !== newRef);
    if (legacy.modelInput.contextPackage) legacy.modelInput.contextPackage.sourceOrigins =
      legacy.modelInput.contextPackage.sourceOrigins.filter(item => item.evidenceRef !== newRef);
    const sealed = sealTaskEnvelope({ ...begun.task, modelInput: legacy });
    const before = JSON.stringify(sealed);
    expect(parseJobAidProblemTask(sealed)).toEqual(legacy);
    expect(parseJobAidProblemTask(sealed).initiallyDeliveredRefs).not.toContain(newRef);
    expect(JSON.stringify(sealed)).toBe(before);
  });

  it.each(['INITIAL_PROBLEM_ASSESSMENT', 'OVERALL_CONSISTENCY', 'PROBLEM_REVIEW'] as const)(
    'prepares %s from a real legacy method snapshot without rewriting the saved work', purpose => {
      const workItem = projection();
      const common = projectCommonAssessmentContext(workItem, {
        context: { status: 'AVAILABLE' }, documentReadingStatus: 'AVAILABLE',
        items: [], sections: [], resourceRefs: [],
      }, []);
      const current = JOBAID_METHOD_EVIDENCE.find(item => item.evidenceRef === 'method:risk')!;
      if (current.kind !== 'METHOD_CLAUSE') throw new Error('METHOD_FIXTURE_INVALID');
      const { classificationDefinitions: _definitions, ...legacy } = structuredClone(current);
      const previousWork = savedWork();
      previousWork.content.evidence = [legacy];
      previousWork.content.readSourceRefs = [legacy.evidenceRef];
      const before = structuredClone(previousWork);
      const input = { workItem, actorUserId: OWNER, permissionSnapshotVersion: 'permission',
        purpose, sourceBindings: [], common, previousWork,
        expectedWorkRevision: previousWork.workRevision, priorAssessmentRefs: [previousWork.workRevisionRef] };
      for (const sourceCatalog of [[], [legacy]]) {
        const task = buildJobAidProblemTask({ ...input, sourceCatalog });
        expect(task.sourceCatalog.find(item => item.evidenceRef === legacy.evidenceRef)).toEqual(current);
        expect(task.modelInput.deliveredEvidence.find(item => item.evidenceRef === legacy.evidenceRef))
          .toHaveProperty('classificationDefinitions', current.classificationDefinitions);
        expect(task.previousWork).toEqual(before);
        expect(previousWork).toEqual(before);
        expect(assertJobAidProblemTaskBinding(task)).toBe(task);
      }
      for (const field of ['sourceIdentity', 'versionLabel', 'locator', 'excerpt', 'packRef', 'methodRef', 'sourceVersionStatus', 'title'] as const) {
        const changed = { ...legacy, [field]: `${legacy[field]} changed` };
        previousWork.content.evidence = [changed];
        expect(() => buildJobAidProblemTask({ ...input, sourceCatalog: [] })).toThrow('JOBAID_PRIOR_SOURCE_CHANGED');
        previousWork.content.evidence = [legacy];
        expect(() => buildJobAidProblemTask({ ...input, sourceCatalog: [changed] })).toThrow('JOBAID_SOURCE_CATALOG_CONFLICT');
      }
      previousWork.content.evidence = [{ ...current, classificationDefinitions: [] }];
      expect(() => buildJobAidProblemTask({ ...input, sourceCatalog: [] })).toThrow('JOBAID_PRIOR_SOURCE_CHANGED');
    });

  it('delivers a complete short current original without treating a large original as partly read', () => {
    const workItem = projection();
    const common = projectCommonAssessmentContext(workItem, {
      context: { status: 'AVAILABLE' }, documentReadingStatus: 'AVAILABLE',
      items: [], sections: [], resourceRefs: [],
    }, []);
    const passage = (index: number, excerpt: string): AssessmentEvidence => ({
      kind: 'DOCUMENT_PASSAGE', workItemId: workItem.workItemId,
      documentVersionId: workItem.source.documentVersionId,
      evidenceRef: `DOCUMENT_ORIGINAL:${workItem.source.documentVersionId}:PRUN-2:SR-${index}`,
      sourceRefId: `SR-${index}`, title: 'Current original', versionLabel: 'PRUN-2',
      locator: `page ${index}`, excerpt,
    });
    const short = [passage(1, 'Production target: 3Q 2027.'),
      passage(2, 'Service bulletin availability: TBD.')];
    const older = { ...passage(3, 'Superseded milestone.'),
      evidenceRef: `DOCUMENT_ORIGINAL:${workItem.source.documentVersionId}:PRUN-1:SR-3`,
      versionLabel: 'PRUN-1' };
    const base = { workItem, actorUserId: OWNER, permissionSnapshotVersion: 'permission',
      purpose: 'INITIAL_PROBLEM_ASSESSMENT' as const, sourceBindings: [], common,
      originalParseRunId: 'PRUN-2',
      previousWork: null, expectedWorkRevision: 0, priorAssessmentRefs: [] };
    const task = buildJobAidProblemTask({ ...base, sourceCatalog: [...short, older] });
    expect(task.initiallyDeliveredRefs).toEqual(expect.arrayContaining(short.map(item => item.evidenceRef)));
    expect(task.initiallyDeliveredRefs).not.toContain(older.evidenceRef);
    expect(task.modelInput.deliveredEvidence.filter(item => item.kind === 'DOCUMENT_PASSAGE')
      .map(item => item.evidenceRef)).toEqual(short.map(item => item.evidenceRef));
    expect(assertJobAidProblemTaskBinding(task)).toBe(task);

    const large = [passage(1, 'x'.repeat(65 * 1024)), passage(2, 'TBD')];
    const largeTask = buildJobAidProblemTask({ ...base, sourceCatalog: large });
    expect(largeTask.initiallyDeliveredRefs).not.toContain(large[0].evidenceRef);
    expect(largeTask.initiallyDeliveredRefs).not.toContain(large[1].evidenceRef);
    expect(largeTask.modelInput.deliveredEvidence.some(item => item.kind === 'DOCUMENT_PASSAGE')).toBe(false);

    const many = Array.from({ length: 65 }, (_, index) => passage(index + 1, 'Short passage.'));
    const manyTask = buildJobAidProblemTask({ ...base, sourceCatalog: many });
    expect(manyTask.modelInput.deliveredEvidence.some(item => item.kind === 'DOCUMENT_PASSAGE')).toBe(false);
  });
  it('recovers the sealed method version after a release and rejects an unbacked method binding', async () => {
    const h = harness();
    await h.enqueue(REQUEST_1);
    const begun = await h.service.begin(h.current(), scope, 'INITIAL_PROBLEM_ASSESSMENT', REQUEST_1);
    const originalBinding = structuredClone(JOBAID_METHOD_BINDING);
    try {
      // Simulate a newer release while the old, valid task remains in flight.
      JOBAID_METHOD_BINDING.packRef = 'JA-NEW-RELEASE';
      JOBAID_METHOD_BINDING.version = '2.0';
      const recovered = parseJobAidProblemTask(begun.task);
      expect(recovered.modelInput.methodBinding).toEqual(originalBinding);
      const unbacked = structuredClone(recovered);
      unbacked.modelInput.methodBinding.packRef = 'UNREGISTERED-PACK';
      expect(() => assertJobAidProblemTaskBinding(unbacked)).toThrow('JOBAID_TASK_METHOD_BINDING_INVALID');
      const falselyConfirmed = structuredClone(recovered);
      falselyConfirmed.modelInput.methodBinding.sources[0].status = 'CONFIRMED';
      falselyConfirmed.modelInput.methodBinding.sources[0].documentVersionId = null;
      expect(() => assertJobAidProblemTaskBinding(falselyConfirmed)).toThrow('JOBAID_TASK_BINDING_INVALID');
    } finally {
      Object.assign(JOBAID_METHOD_BINDING, originalBinding);
    }
  });

  it.each([false, true])(
    'binds Overall to its saved JobAid ref and rejects a newer unbound revision: %s',
    async (hasNewer) => {
      const h = harness();
      const exact = savedWork();
      const newer = {
        ...exact,
        workRevisionRef: 'JAWR-NEWER',
        workRevision: 4,
      };
      h.current().integratedAssessment = {
        status: 'BASE_RULE_CANDIDATE_READY',
        baseRules: {
          schemaVersion: JOBAID_PROBLEM_RESULT_SCHEMA,
          workRevisionRef: exact.workRevisionRef,
          workRevision: exact.workRevision,
        },
      } as never;
      h.work.listForRuntime.mockResolvedValue(
        hasNewer ? [newer, exact] : [exact],
      );
      h.work.readByRefForRuntime.mockResolvedValue(exact);
      if (hasNewer) {
        await expect(
          h.service.enqueueOverall(h.current(), TENANT, 'permission'),
        ).rejects.toThrow('JOBAID_OVERALL_EXACT_WORK_REQUIRED');
        expect(h.rows.size).toBe(0);
        return;
      }
      const queued = await h.service.enqueueOverall(
        h.current(),
        TENANT,
        'permission',
      );
      const input = parseJobAidProblemTask(h.task(queued.attemptRef));
      expect(input.previousWork).toEqual(exact);
      expect(input.modelInput.expectedWorkRevision).toBe(3);
      expect(h.work.readByRefForRuntime).toHaveBeenCalledWith({
        tenantId: TENANT,
        actorUserId: OWNER,
        workItemId: scope.workItemId,
        workRevisionRef: exact.workRevisionRef,
      });
    },
  );

  it.each(['missing', 'version', 'unfinished'])(
    'rejects %s exact Overall work instead of substituting the latest work',
    async (failure) => {
      const h = harness();
      const exact = savedWork();
      h.current().integratedAssessment = {
        status: 'BASE_RULE_CANDIDATE_READY',
        baseRules: {
          schemaVersion: JOBAID_PROBLEM_RESULT_SCHEMA,
          workRevisionRef: exact.workRevisionRef,
          workRevision: exact.workRevision,
        },
      } as never;
      h.work.listForRuntime.mockResolvedValue([exact]);
      h.work.readByRefForRuntime.mockResolvedValue(
        failure === 'missing'
          ? null
          : {
              ...exact,
              documentVersionId:
                failure === 'version' ? 'DV-OTHER' : exact.documentVersionId,
              content: {
                ...exact.content,
                roundCompletion:
                  failure === 'unfinished'
                    ? 'IN_PROGRESS'
                    : exact.content.roundCompletion,
              },
            },
      );
      await expect(
        h.service.enqueueOverall(h.current(), TENANT, 'permission'),
      ).rejects.toThrow('JOBAID_OVERALL_EXACT_WORK_REQUIRED');
      expect(h.rows.size).toBe(0);
    },
  );

  const recoverableOverallTerminals = [
    ['CANCELLED', null],
    ['TIMED_OUT', 'ACTION_ATTEMPT_DEADLINE_EXCEEDED'],
    ['TIMED_OUT', 'DEADLINE_EXCEEDED_DURING_LEASE'],
  ] as const;

  it.each(recoverableOverallTerminals)('continues from work saved by exact Overall %s / %s', async (status, terminalReason) => {
    const h = harness();
    const base = { ...savedWork(), workRevisionRef: 'JAWR-W0', workRevision: 1 };
    h.current().integratedAssessment = {
      status: 'BASE_RULE_CANDIDATE_READY',
      baseRules: { schemaVersion: JOBAID_PROBLEM_RESULT_SCHEMA,
        workRevisionRef: base.workRevisionRef, workRevision: base.workRevision },
    } as never;
    h.work.listForRuntime.mockResolvedValue([base]);
    h.work.readByRefForRuntime.mockResolvedValue(base);
    const failed = await h.service.enqueueOverall(h.current(), TENANT, 'permission');
    Object.assign(h.rows.get(failed.attemptRef)!, { status, terminalReason });
    const newer: JobAidWorkRevision = { ...base, workRevisionRef: 'JAWR-OVERALL-2',
      workRevision: 2, previousWorkRevisionRef: base.workRevisionRef,
      actionAttemptId: h.task(failed.attemptRef).actionAttemptId,
      requestId: 'SAVE-OVERALL-2' };
    h.work.listForRuntime.mockResolvedValue([newer, base]);
    h.work.readByRefForRuntime.mockImplementation(async ({ workRevisionRef }: {workRevisionRef:string}) =>
      workRevisionRef === newer.workRevisionRef ? newer : base);
    await h.enqueue(REQUEST_2, 'OVERALL_CONSISTENCY');
    const continued = await h.service.begin(h.current(), scope, 'OVERALL_CONSISTENCY', REQUEST_2);
    const input = parseJobAidProblemTask(continued.task);
    expect(input.previousWork).toEqual(newer);
    expect(input.modelInput.expectedWorkRevision).toBe(2);
    expect(h.current().integratedAssessment).toMatchObject({ baseRules: { workRevisionRef: base.workRevisionRef } });
    expect(h.work.readByRefForRuntime).toHaveBeenCalledWith({
      tenantId: TENANT, actorUserId: OWNER, workItemId: scope.workItemId,
      workRevisionRef: newer.workRevisionRef,
    });
    expect(h.attempts.readScopedById).toHaveBeenCalledWith({
      attemptId: newer.actionAttemptId, tenantId: TENANT, workItemId: scope.workItemId,
    });
    h.rows.get(failed.attemptRef)!.status = 'RUNNING';
    await h.enqueue(REQUEST_1, 'OVERALL_CONSISTENCY');
    await expect(h.service.begin(h.current(), scope, 'OVERALL_CONSISTENCY', REQUEST_1))
      .rejects.toThrow('JOBAID_OVERALL_EXACT_WORK_REQUIRED');
  });

  for (const [status, terminalReason] of recoverableOverallTerminals)
  it.each(['broken-chain', 'cycle', 'revision-gap', 'document-version', 'work-item', 'formal-version', 'unfinished', 'non-cancelled'] as const)(
    `rejects %s in saved Overall recovery from ${status}/${terminalReason} before claiming a queued continuation`, async reason => {
      const h = harness(); const base = savedWork();
      h.current().integratedAssessment = { status: 'BASE_RULE_CANDIDATE_READY',
        baseRules: { schemaVersion: JOBAID_PROBLEM_RESULT_SCHEMA,
          workRevisionRef: base.workRevisionRef, workRevision: base.workRevision } } as never;
      h.work.listForRuntime.mockResolvedValue([base]); h.work.readByRefForRuntime.mockResolvedValue(base);
      const cancelled = await h.service.enqueueOverall(h.current(), TENANT, 'permission');
      Object.assign(h.rows.get(cancelled.attemptRef)!, {
        status: reason === 'non-cancelled' ? 'RUNNING' : status, terminalReason,
      });
      const newer: JobAidWorkRevision = { ...base, content: structuredClone(base.content),
        workRevisionRef: 'JAWR-OVERALL-INVALID', workRevision:4, previousWorkRevisionRef:base.workRevisionRef,
        actionAttemptId:h.task(cancelled.attemptRef).actionAttemptId, requestId:'SAVE-OVERALL-INVALID' };
      if (reason === 'broken-chain') newer.previousWorkRevisionRef = null;
      if (reason === 'cycle') newer.previousWorkRevisionRef = newer.workRevisionRef;
      if (reason === 'revision-gap') newer.workRevision = 5;
      if (reason === 'document-version') newer.documentVersionId = 'DV-OTHER';
      if (reason === 'work-item') newer.workItemId = 'WI-OTHER';
      if (reason === 'formal-version') newer.basedOnWorkItemRevision++;
      if (reason === 'unfinished') newer.content.roundCompletion = 'IN_PROGRESS';
      h.work.listForRuntime.mockResolvedValue([newer, base]);
      h.work.readByRefForRuntime.mockImplementation(async ({workRevisionRef}:{workRevisionRef:string}) =>
        workRevisionRef === newer.workRevisionRef ? newer : base);
      const queued = await h.enqueue(REQUEST_2, 'OVERALL_CONSISTENCY');
      await expect(h.service.begin(h.current(), scope, 'OVERALL_CONSISTENCY', REQUEST_2))
        .rejects.toThrow('JOBAID_OVERALL_EXACT_WORK_REQUIRED');
      expect(h.rows.get(queued.attemptRef)!.status).toBe('QUEUED');
    });

  it.each([
    ['RUNNING', 'ACTION_ATTEMPT_DEADLINE_EXCEEDED'],
    ['COMMITTING', 'ACTION_ATTEMPT_DEADLINE_EXCEEDED'],
    ['FAILED', 'ACTION_ATTEMPT_DEADLINE_EXCEEDED'],
    ['FAILED', 'LEASE_EXPIRED_MAX_ATTEMPTS'],
    ['OBSOLETE', 'ACTION_ATTEMPT_SUPERSEDED_AFTER_LEASE_EXPIRY'],
    ['TIMED_OUT', null],
    ['TIMED_OUT', 'UNRECOGNIZED_TIMEOUT'],
    ['TIMED_OUT', 'LEASE_EXPIRED_MAX_ATTEMPTS'],
  ] as const)('rejects %s / %s in saved Overall recovery', async (status, terminalReason) => {
    const h = harness(); const base = savedWork();
    h.current().integratedAssessment = { status: 'BASE_RULE_CANDIDATE_READY',
      baseRules: { schemaVersion: JOBAID_PROBLEM_RESULT_SCHEMA,
        workRevisionRef: base.workRevisionRef, workRevision: base.workRevision } } as never;
    h.work.listForRuntime.mockResolvedValue([base]); h.work.readByRefForRuntime.mockResolvedValue(base);
    const prior = await h.service.enqueueOverall(h.current(), TENANT, 'permission');
    Object.assign(h.rows.get(prior.attemptRef)!, { status, terminalReason });
    const newer: JobAidWorkRevision = { ...base, workRevisionRef: 'JAWR-OVERALL-4', workRevision: 4,
      previousWorkRevisionRef: base.workRevisionRef, actionAttemptId: h.task(prior.attemptRef).actionAttemptId,
      requestId: 'SAVE-OVERALL-4' };
    h.work.listForRuntime.mockResolvedValue([newer, base]);
    h.work.readByRefForRuntime.mockImplementation(async ({workRevisionRef}: {workRevisionRef:string}) =>
      workRevisionRef === newer.workRevisionRef ? newer : base);
    const queued = await h.enqueue(REQUEST_2, 'OVERALL_CONSISTENCY');
    await expect(h.service.begin(h.current(), scope, 'OVERALL_CONSISTENCY', REQUEST_2))
      .rejects.toThrow('JOBAID_OVERALL_EXACT_WORK_REQUIRED');
    expect(h.rows.get(queued.attemptRef)!.status).toBe('QUEUED');
  });

  it.each(['current', 'actor-revoked', 'source-revoked', 'earlier-fake-timeout'] as const)(
    'preserves the saved Overall recovery chain and authorization: %s', async mode => {
      const h = harness(); const base = savedWork();
      h.current().integratedAssessment = { status: 'BASE_RULE_CANDIDATE_READY',
        baseRules: { schemaVersion: JOBAID_PROBLEM_RESULT_SCHEMA,
          workRevisionRef: base.workRevisionRef, workRevision: base.workRevision } } as never;
      h.work.listForRuntime.mockResolvedValue([base]); h.work.readByRefForRuntime.mockResolvedValue(base);
      const first = await h.service.enqueueOverall(h.current(), TENANT, 'permission');
      Object.assign(h.rows.get(first.attemptRef)!, {
        status: 'TIMED_OUT', terminalReason: 'ACTION_ATTEMPT_DEADLINE_EXCEEDED',
      });
      const middle: JobAidWorkRevision = { ...base, workRevisionRef: 'JAWR-OVERALL-4', workRevision: 4,
        previousWorkRevisionRef: base.workRevisionRef, actionAttemptId: h.task(first.attemptRef).actionAttemptId,
        requestId: 'SAVE-OVERALL-4' };
      const saved = new Map([base, middle].map(work => [work.workRevisionRef, work]));
      h.work.listForRuntime.mockImplementation(async () => [...saved.values()].reverse());
      h.work.readByRefForRuntime.mockImplementation(async ({workRevisionRef}: {workRevisionRef:string}) =>
        saved.get(workRevisionRef) ?? null);
      await h.enqueue(REQUEST_2, 'OVERALL_CONSISTENCY');
      const second = await h.service.begin(h.current(), scope, 'OVERALL_CONSISTENCY', REQUEST_2);
      h.rows.get(second.attemptRef)!.status = 'CANCELLED';
      const latest = { ...middle, workRevisionRef: 'JAWR-OVERALL-5', workRevision: 5,
        previousWorkRevisionRef: middle.workRevisionRef, actionAttemptId: second.task.actionAttemptId,
        requestId: 'SAVE-OVERALL-5', content: { ...middle.content, overviewStatus: 'STALE' as const } };
      saved.set(latest.workRevisionRef, latest);
      const queued = await h.enqueue(REQUEST_1, 'OVERALL_CONSISTENCY');
      if (mode === 'actor-revoked') h.conversations.hasActiveOfficialActorMapping.mockResolvedValue(false);
      if (mode === 'source-revoked') h.work.loadOwnedSourceBinding.mockResolvedValue(null as never);
      if (mode === 'earlier-fake-timeout') h.rows.get(first.attemptRef)!.terminalReason = 'UNRECOGNIZED_TIMEOUT';
      const begun = h.service.begin(h.current(), scope, 'OVERALL_CONSISTENCY', REQUEST_1);
      if (mode !== 'current') {
        await expect(begun).rejects.toThrow(mode === 'actor-revoked' ? 'JOBAID_ACTOR_AUTHORIZATION_CHANGED'
          : mode === 'source-revoked' ? 'JOBAID_SOURCE_AUTHORIZATION_CHANGED' : 'JOBAID_OVERALL_EXACT_WORK_REQUIRED');
        expect(h.rows.get(queued.attemptRef)!.status).toBe('QUEUED');
        return;
      }
      const input = parseJobAidProblemTask((await begun).task);
      expect(input.previousWork).toEqual(latest);
      expect(input.modelInput.expectedWorkRevision).toBe(5);
      expect(input.previousWork!.content.overviewStatus).toBe('STALE');
      expect(h.current().integratedAssessment).toMatchObject({ baseRules: { workRevisionRef: base.workRevisionRef } });
    });

  it('prepares the same queued request with its reserved knowledge connector', async () => {
    const binding = { sessionId: '11111111-1111-4111-8111-111111111111', agentId: 'bound-agent-only' };
    const knowledge = { binding: jest.fn().mockResolvedValue({ binding, access: { available: true } }) };
    const h = harness(knowledge, binding.sessionId);
    const queued = await h.enqueue(REQUEST_1);
    const reserved = h.task(queued.attemptRef);
    expect(reserved.allowedConnectors).toEqual(['feishu-aily-user']);
    expect(readInitialAnalysisRequestInput(reserved)?.requestId).toBe(REQUEST_1);
    const begun = await h.service.begin(h.current(), scope, 'INITIAL_PROBLEM_ASSESSMENT', REQUEST_1);
    expect(begun.attemptRef).toBe(queued.attemptRef);
    expect(begun.task.allowedConnectors).toEqual(reserved.allowedConnectors);
    expect(parseJobAidProblemTask(begun.task).knowledgeBinding).toEqual(binding);
    expect(h.attempts.reserve).toHaveBeenCalledTimes(1);
    for (const allowedConnectors of [['other-connector'], ['feishu-aily-user', 'feishu-aily-user']]) {
      expect(() => readInitialAnalysisRequestInput({ ...reserved, allowedConnectors })).toThrow(
        'ACTION_ATTEMPT_INITIAL_REQUEST_BINDING_INVALID',
      );
    }
    expect(() => readInitialAnalysisRequestInput({
      ...reserved,
      taskType: 'OPENCLAW_TRANSLATE',
      idempotencyKey: reserved.idempotencyKey.replace(':dynamic:', ':translate:'),
      modelInput: { ...reserved.modelInput, taskType: 'OPENCLAW_TRANSLATE' },
    })).toThrow('ACTION_ATTEMPT_INITIAL_REQUEST_ORIGINAL_SCOPE_INVALID');
  });

  it('keeps initial user-session binding in the Host envelope and out of model input', async () => {
    const binding = { sessionId: '11111111-1111-4111-8111-111111111111', agentId: 'bound-agent-only' };
    const knowledge = { binding: jest.fn().mockResolvedValue({ binding, access: { available: true } }) };
    const h = harness(knowledge, binding.sessionId);
    const begun = await h.service.begin(h.current(), scope, 'INITIAL_PROBLEM_ASSESSMENT');
    expect(begun.task.allowedConnectors).toEqual(['feishu-aily-user']);
    expect(parseJobAidProblemTask(begun.task).knowledgeBinding).toEqual(binding);
    expect(begun.modelInput.knowledgeAccess).toEqual({ available: true });
    expect(begun.modelInput.capabilities.find(item => item.capability === 'knowledge_retrieval'))
      .toMatchObject({ status: 'AVAILABLE', impact: expect.stringContaining('不代表已取得检索结果') });
    expect(begun.modelInput.contextPackage?.knowledgeRetrieval.status).toBe('NOT_REQUESTED');
    expect(begun.modelInput.contextPackage?.knowledgeRetrieval.fragments).toEqual([]);
    expect(JSON.stringify(begun.modelInput)).not.toMatch(/knowledgeBinding|sessionId|bound-agent-only|actorUserId|tenantId|leaseToken/);
    expect(JSON.stringify(begun.modelInput)).not.toContain(binding.sessionId);
  });

  it.each([
    ['NOT_CONFIGURED', 'NOT_CONNECTED'],
    ['USER_REAUTHORIZATION_REQUIRED', 'ACCESS_DENIED'],
  ] as const)('keeps unavailable knowledge capability accurate: %s', async (reason, status) => {
    const knowledge = { binding: jest.fn().mockResolvedValue({ access: { available: false, reason } }) };
    const h = harness(knowledge);
    const begun = await h.service.begin(h.current(), scope, 'INITIAL_PROBLEM_ASSESSMENT');
    expect(begun.modelInput.knowledgeAccess).toEqual({ available: false, reason });
    expect(begun.modelInput.capabilities.find(item => item.capability === 'knowledge_retrieval'))
      .toMatchObject({ status });
    expect(begun.modelInput.contextPackage?.knowledgeRetrieval).toMatchObject({ status: 'UNAVAILABLE', reason, fragments: [] });
    expect(begun.task.allowedConnectors).toEqual([]);
    expect(parseJobAidProblemTask(begun.task).knowledgeBinding).toBeUndefined();
  });

  it('delivers supplemental source context without treating inaccessible references or user assumptions as primary-source failures', () => {
    const workItem = projection();
    const common = projectCommonAssessmentContext(workItem, {
      context: { status: 'AVAILABLE' }, documentReadingStatus: 'AVAILABLE',
      items: [], sections: [], resourceRefs: [],
    }, []);
    const reference = {
      documentCode: 'OEM-RELATED', documentVersionRef: 'DV-RELATED',
      documentType: 'SB' as const, contributionRoles: [],
      sourceAuthority: 'OEM_FORMAL' as const, targetApplicability: 'NOT_EVALUATED' as const,
      currentness: 'HISTORICAL' as const, availability: 'AVAILABLE' as const,
      contextUse: 'BACKGROUND_ONLY' as const, selection: 'BACKGROUND_CANDIDATE' as const,
      reasonCodes: [], availableSourceRefIds: ['SR-RELATED'],
      readFragments: [{ sourceRefId: 'SR-RELATED', excerpt: 'Reported earlier measure; effect not verified.' }],
    };
    common.relatedMaterials.items = [reference, {
      ...reference, documentCode: 'RESTRICTED-MANUAL', documentVersionRef: null,
      availability: 'ACCESS_DENIED', availableSourceRefIds: [], readFragments: [],
      reasonCodes: ['REFERENCE_ACCESS_DENIED'],
    }];
    const evidence: AssessmentEvidence[] = [{
      evidenceRef: 'primary', kind: 'DOCUMENT_PASSAGE', title: 'Primary SB',
      versionLabel: 'R1', excerpt: 'No compliance time is given.',
      workItemId: workItem.workItemId, documentVersionId: 'DV-JOBAID', sourceRefId: 'SR-1', locator: 'page 1-1',
    }, {
      evidenceRef: 'related', kind: 'DOCUMENT_PASSAGE', title: 'OEM related',
      versionLabel: 'R0', excerpt: reference.readFragments[0].excerpt,
      workItemId: 'WI-RELATED', documentVersionId: 'DV-RELATED', sourceRefId: 'SR-RELATED', locator: 'page 2-2',
    }, {
      evidenceRef: 'assumption', kind: 'ENGINEER_STATEMENT', origin: 'REVIEW_CONVERSATION',
      title: 'User hypothesis', versionLabel: null, excerpt: '假设测试设备使用 Win7，尚未核实。',
      reviewConversationId: 'RC', reviewTurnId: 'RT', engineerSuppliedInputId: 'ESI', recordedAt: '2026-09-10T00:00:00.000Z',
    }];
    const task = buildJobAidProblemTask({
      workItem, actorUserId: OWNER, permissionSnapshotVersion: 'permission',
      purpose: 'INITIAL_PROBLEM_ASSESSMENT', sourceCatalog: evidence, sourceBindings: [],
      common, previousWork: null, expectedWorkRevision: 0, priorAssessmentRefs: [],
    });
    const delivered = task.modelInput.deliveredEvidence;
    const related = delivered.find((item) => item.title === 'OEM related')!;
    expect(related.excerpt).toBe(reference.readFragments[0].excerpt);
    expect(delivered.find((item) => item.title === 'Primary SB')).toBeUndefined();
    expect(task.modelInput.contextPackage).toMatchObject({
      basedOnWorkItemRevision: workItem.revision,
      primaryDocument: { readingStatus: 'AVAILABLE' },
      supplementaryMaterials: { items: [
        { sourceAuthority: 'OEM_FORMAL', currentness: 'HISTORICAL', contextUse: 'BACKGROUND_ONLY', deliveredEvidenceRefs: [related.evidenceRef] },
        { documentCode: 'RESTRICTED-MANUAL', availability: 'ACCESS_DENIED', reasonCodes: ['REFERENCE_ACCESS_DENIED'], deliveredEvidenceRefs: [] },
      ] },
      knowledgeRetrieval: { status: 'NOT_CONNECTED' },
    });
    expect(task.modelInput.contextPackage?.sourceOrigins).toContainEqual({
      evidenceRef: 'assumption', origin: 'REVIEW_CONVERSATION', contentNature: 'UNVERIFIED_ENGINEER_STATEMENT',
    });
    expect(delivered.find((item) => item.evidenceRef === 'assumption')?.excerpt).toBe(evidence[2].excerpt);
  });
  const originalFlag = process.env.WL_JOBAID_PROBLEM_V2_ENABLED;
  beforeEach(() => {
    process.env.WL_JOBAID_PROBLEM_V2_ENABLED = '1';
  });
  afterEach(() => {
    if (originalFlag === undefined)
      delete process.env.WL_JOBAID_PROBLEM_V2_ENABLED;
    else process.env.WL_JOBAID_PROBLEM_V2_ENABLED = originalFlag;
  });

  it('queues a browser request bound to the authorized published original without reading file bytes or history', async () => {
    const h = harness();
    const queued = await h.enqueue(REQUEST_1);

    expect(readInitialAnalysisRequestInput(h.task(queued.attemptRef))).toEqual({
      schemaVersion: INITIAL_ANALYSIS_REQUEST_SCHEMA,
      taskType: 'OPENCLAW_DYNAMIC_EVALUATION',
      requestId: REQUEST_1,
      originalParseRunId: 'PR-TEST-2',
    });
    expect(h.artifactStore.readActualBytes).not.toHaveBeenCalled();
    expect(h.work.listForRuntime).not.toHaveBeenCalled();
    expect(h.work.withActorTransaction).not.toHaveBeenCalled();
    expect(
      h.conversations.hasActiveOfficialActorMapping,
    ).not.toHaveBeenCalled();
    expect(await h.enqueue(REQUEST_1)).toEqual({ ...queued, created: false });
    expect(h.attempts.reserve).toHaveBeenCalledTimes(1);
  });

  it('rejects a new initial task before reservation when the Host owner mapping is no longer authorized', async () => {
    const h = harness();
    h.conversations.hasActiveOfficialActorMapping.mockResolvedValue(false);

    await expect(
      h.service.begin(h.current(), scope, 'INITIAL_PROBLEM_ASSESSMENT'),
    ).rejects.toThrow('JOBAID_ACTOR_AUTHORIZATION_CHANGED');

    expect(h.rows.size).toBe(0);
    expect(h.work.withActorTransaction).toHaveBeenCalledWith(
      OWNER,
      expect.any(Function),
    );
    expect(h.conversations.hasActiveOfficialActorMapping).toHaveBeenCalledWith(
      { tenantId: TENANT, actorId: OWNER },
      h.actorExecutor,
    );
  });

  it('rechecks the stored actor after an existing claim without rebuilding or replacing the task', async () => {
    const h = harness();
    const first = await h.service.begin(
      h.current(),
      scope,
      'INITIAL_PROBLEM_ASSESSMENT',
    );
    expect(h.conversations.hasActiveOfficialActorMapping).toHaveBeenCalledTimes(
      3,
    );
    h.conversations.hasActiveOfficialActorMapping.mockResolvedValue(false);

    await expect(
      h.service.begin(h.current(), scope, 'INITIAL_PROBLEM_ASSESSMENT'),
    ).rejects.toThrow('JOBAID_ACTOR_AUTHORIZATION_CHANGED');

    expect(h.rows.size).toBe(1);
    expect(h.rows.get(first.attemptRef)?.status).toBe('RUNNING');
    expect(h.attempts.reserve).toHaveBeenCalledTimes(1);
    expect(h.artifactStore.readActualBytes).not.toHaveBeenCalled();
    expect(h.work.publishedOriginalBinding).toHaveBeenCalledTimes(1);
    expect(h.conversations.hasActiveOfficialActorMapping).toHaveBeenCalledTimes(
      4,
    );
  });

  it.each(['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT'] as const)(
    'returns the same %s request after WorkItem revision advances without reserving, reading sources or preparing configuration again',
    async (status) => {
      const h = harness();
      const first = await h.enqueue(REQUEST_1);
      h.rows.get(first.attemptRef)!.status = status;
      h.advanceRevision();
      process.env.WL_JOBAID_PROBLEM_V2_ENABLED = '0';
      const reads = h.artifactStore.readActualBytes.mock.calls.length;

      await expect(h.enqueue(REQUEST_1)).resolves.toEqual({
        ...first,
        status,
        created: false,
      });
      expect(h.attempts.reserve).toHaveBeenCalledTimes(1);
      expect(h.artifactStore.readActualBytes).toHaveBeenCalledTimes(reads);
      expect(h.registrar.compareAndSet).not.toHaveBeenCalled();
    },
  );

  it('prepares complete persisted work and exact English only when the runtime claims the new request', async () => {
    const h = harness();
    const first = await h.enqueue(REQUEST_1);
    h.rows.get(first.attemptRef)!.status = 'FAILED';
    const failed = structuredClone(h.rows.get(first.attemptRef));
    const previous = savedWork();
    h.work.listForRuntime.mockResolvedValue([previous]);

    const second = await h.enqueue(REQUEST_2);
    expect(
      readInitialAnalysisRequestInput(h.task(second.attemptRef)),
    ).not.toBeNull();
    expect(h.artifactStore.readActualBytes).not.toHaveBeenCalled();
    const claimed = await h.service.begin(
      h.current(),
      scope,
      'INITIAL_PROBLEM_ASSESSMENT',
      REQUEST_2,
    );
    expect(claimed.attemptRef).toBe(second.attemptRef);
    expect(readInitialAnalysisRequestInput(claimed.task)).toBeNull();
    const input = parseJobAidProblemTask(h.task(second.attemptRef));

    expect(second).toMatchObject({
      created: true,
      status: 'QUEUED',
      workItemRevision: 5,
    });
    expect(second.attemptRef).not.toBe(first.attemptRef);
    expect(h.rows.get(first.attemptRef)).toEqual(failed);
    expect(input.previousWork).toEqual(previous);
    expect(input.modelInput.previousWork).toMatchObject({
      workRevisionRef: previous.workRevisionRef,
      content: { overview: previous.content.understanding },
    });
    expect(input.modelInput.expectedWorkRevision).toBe(previous.workRevision);
    expect(
      input.sourceCatalog.find((item) => item.kind === 'DOCUMENT_PASSAGE')
        ?.excerpt,
    ).toBe(ENGLISH);
    expect(h.work.listForRuntime).toHaveBeenLastCalledWith({
      tenantId: TENANT,
      workItemId: scope.workItemId,
      actorUserId: OWNER,
    });
    expect(h.task(second.attemptRef).idempotencyKey).toBe(
      `openclaw-v2:dynamic:${scope.workItemId}:DV-JOBAID:${REQUEST_2}`,
    );
  });

  it.each(['INITIAL_PROBLEM_ASSESSMENT', 'OVERALL_CONSISTENCY'] as const)(
    'prepares a failed configuration %s stage once and claims the same queued request without rebuilding input',
    async (purpose) => {
      const h = harness();
      const workItem = h.current();
      const marker = createConfigurationEvidenceReevaluation({
        triggerSnapshotId: 'CONFIG-2',
        triggerConfigurationRevision: 2,
        adoptionWorkItemRevision: 5,
      });
      marker.status = 'FAILED';
      marker.stages.applicability.status = 'SUCCEEDED';
      marker.stages.applicability.attempt = {
        attemptId: 'ATT-APP',
        attemptRef: 'AQ-APP',
        inputRevision: 4,
        baseRevision: 4,
      };
      marker.stages.applicability.committedWorkItemRevision = 5;
      marker.stagedBundle.applicabilityInput = {
        applicabilityContextRef: 'APPCTX-STAGED',
      } as never;
      marker.stagedBundle.applicability = {
        status: 'CANDIDATE_ONLY',
        currentness: 'CURRENT',
        decision: 'APPLICABLE',
        aircraftNumber: 'B-TEST',
        assessmentAsOf: '2026-09-09',
        blockingUnknownCount: 0,
        sourceExpressionCount: 1,
        pass: 1,
      } as never;
      workItem.configurationEvidenceReevaluation = marker;
      workItem.configurationEvidenceCurrent = {
        snapshotId: 'CONFIG-2',
        configurationRevision: 2,
      } as never;
      workItem.integratedAssessment = {
        status: 'BASE_RULE_CANDIDATE_READY',
        baseRules: {
          schemaVersion: JOBAID_PROBLEM_RESULT_SCHEMA,
          sourceResultId: 'openclaw-dynamic://prior',
          workRevisionRef: savedWork().workRevisionRef,
          workRevision: savedWork().workRevision,
        },
      } as never;
      const serving = structuredClone(workItem.integratedAssessment);
      if (purpose === 'OVERALL_CONSISTENCY') {
        marker.stages.dynamic.status = 'SUCCEEDED';
        marker.stages.dynamic.attempt = {
          attemptId: 'ATT-DYNAMIC',
          attemptRef: 'AQ-DYNAMIC',
          inputRevision: 4,
          baseRevision: 4,
        };
        marker.stages.dynamic.committedWorkItemRevision = 5;
        marker.stages.overall.status = 'FAILED';
        marker.stages.overall.terminal = {
          status: 'FAILED',
          code: 'TEST_FAILURE',
          message: null,
        };
        marker.stages.overall.committedWorkItemRevision = 5;
        marker.stagedBundle.baseRules = structuredClone(
          workItem.integratedAssessment!.baseRules,
        );
        h.work.listForRuntime.mockResolvedValue([savedWork()]);
      } else {
        marker.stages.dynamic.status = 'FAILED';
        marker.stages.dynamic.terminal = {
          status: 'FAILED',
          code: 'TEST_FAILURE',
          message: null,
        };
        marker.stages.dynamic.committedWorkItemRevision = 5;
      }

      const queued = await h.enqueue(REQUEST_1, purpose);
      expect(h.artifactStore.readActualBytes).not.toHaveBeenCalled();
      expect(h.work.withActorTransaction).not.toHaveBeenCalled();
      // Both real execution entry points supply the staged configuration view.
      await h.service.begin(
        configurationEvidenceShadow(h.current()),
        scope,
        purpose,
        REQUEST_1,
      );
      const replay = await h.enqueue(REQUEST_1, purpose);

      expect(queued.workItemRevision).toBe(6);
      expect(h.current().revision).toBe(6);
      expect(h.registrar.compareAndSet).toHaveBeenCalledTimes(1);
      expect(h.registrar.compareAndSet).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedRevision: 5,
          syncPrimaryAttempt: false,
        }),
      );
      expect(h.current().integratedAssessment).toEqual(serving);
      expect(h.attempts.reserve).toHaveBeenCalledTimes(1);
      expect(h.artifactStore.readActualBytes).not.toHaveBeenCalled();
      expect(h.work.publishedOriginalBindingForRequest).toHaveBeenCalledTimes(1);
      expect(h.work.publishedOriginalBinding).not.toHaveBeenCalled();
      expect(h.task(queued.attemptRef).baseRevision).toBe(6);
      expect(
        parseJobAidProblemTask(h.task(queued.attemptRef)).modelInput
          .hostApplicability,
      ).toEqual({
        decision: 'APPLICABLE',
        currentness: 'CURRENT',
        aircraftNumber: 'B-TEST',
        assessmentAsOf: '2026-09-09',
        blockingUnknownCount: 0,
        sourceExpressionCount: 1,
        pass: 1,
      });
      expect(replay).toEqual({ ...queued, status: 'RUNNING', created: false });
    },
  );

  it('refuses to reclaim a terminal explicit request and never replays its model input', async () => {
    const h = harness();
    const queued = await h.enqueue(REQUEST_1);
    h.rows.get(queued.attemptRef)!.status = 'CANCELLED';
    h.advanceRevision();

    await expect(
      h.service.begin(
        h.current(),
        scope,
        'INITIAL_PROBLEM_ASSESSMENT',
        REQUEST_1,
      ),
    ).rejects.toThrow('ACTION_ATTEMPT_ALREADY_CANCELLED');
    expect(h.attempts.reserveAndClaim).not.toHaveBeenCalled();
    expect(h.attempts.reserve).toHaveBeenCalledTimes(1);
  });

  it('retains the old no-request key and rejects disabled new v2 requests before source I/O', async () => {
    const h = harness();
    process.env.WL_JOBAID_PROBLEM_V2_ENABLED = '0';
    await expect(h.enqueue(REQUEST_1)).rejects.toThrow(
      'JOBAID_PROBLEM_V2_NEW_REQUEST_DISABLED',
    );
    expect(h.artifactStore.readActualBytes).not.toHaveBeenCalled();
    const legacy = await h.service.begin(
      h.current(),
      scope,
      'INITIAL_PROBLEM_ASSESSMENT',
    );
    expect(legacy.task.idempotencyKey).toBe(
      `openclaw-v1:dynamic:${scope.workItemId}:5:problem-v2`,
    );
    expect(h.attempts.reserveAndClaim).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale new request before resetting a configuration stage or reserving work', async () => {
    const h = harness();
    const requested = structuredClone(h.current());
    h.advanceRevision();
    await expect(
      h.service.enqueueContinuation(
        requested,
        TENANT,
        'permission-browser',
        REQUEST_1,
        'INITIAL_PROBLEM_ASSESSMENT',
      ),
    ).rejects.toThrow('JOBAID_WORK_ITEM_BINDING_CHANGED');
    expect(h.registrar.compareAndSet).not.toHaveBeenCalled();
    expect(h.attempts.reserve).not.toHaveBeenCalled();
  });
});

function harness(knowledge?: { binding: jest.Mock }, initialAilySessionId?: string) {
  let current = projection();
  const rows = new Map<string, ActionAttemptRow>();
  const task = (attemptRef: string) =>
    parseTaskEnvelope(rows.get(attemptRef)!.taskEnvelopeJson!);
  const registrar = {
    getTenantScopedByWorkItemId: jest.fn(async () => current),
    compareAndSet: jest.fn(
      async (input: {
        expectedRevision: number;
        next: Omit<CanonicalWorkItemProjection, 'revision'>;
      }) => {
        if (input.expectedRevision !== current.revision)
          throw new Error('TEST_CAS_CONFLICT');
        current = { ...input.next, revision: input.expectedRevision + 1 };
        return structuredClone(current);
      },
    ),
  };
  const artifactStore = {
    persistAndReadback: jest.fn(async () => ({artifact:{ref:'NEW',sha256:'b'.repeat(64),byteLength:100,mediaType:'application/json',storeRole:'U0_PARSED_PACKAGE'}})),
    readActualBytes: jest.fn(async () =>
      new TextEncoder().encode(
        JSON.stringify({
          sourceRefs: [
            { sourceRefId: 'SR-1', pageStart: 1, pageEnd: 1, quote: ENGLISH },
          ],
        }),
      ),
    ),
  };
  const workItems = {
    loadTenantScopedProjection: jest.fn(async () => ({
      row: {
        requestedByUserId: OWNER,
        initialAilySessionId,
        documentVersionId: current.source.documentVersionId,
      },
      projection: current,
    })),
    loadAuthorizationBinding: jest.fn(async () => ({
      documentVersionId: current.source.documentVersionId,
    })),
  };
  const actorExecutor = { kind: 'host-owner-transaction' };
  const work = {
    recordProgramProgress: jest.fn(async (_input: unknown) => undefined),
    recordWorkRead: jest.fn(async (input: {row: ActionAttemptRow; revision: JobAidWorkRevision}) => {
      const persisted = rows.get(input.row.operationRef!)!;
      persisted.reviewActivityJson = canonicalJson([{kind: 'ASSESSMENT_WORK_READ',
        workRevisionRef: input.revision.workRevisionRef, workRevision: input.revision.workRevision,
        saveRequestId: input.revision.requestId, observedAt: '2026-10-25T01:00:00.000Z'}]);
    }),
    publishedOriginalBinding: jest.fn(async () => ({parseRunId:'PR-TEST-2'})),
    publishedOriginalBindingForRequest: jest.fn(async () => ({parseRunId:'PR-TEST-2'})),
    withActorScope: jest.fn(async (_actor: string, operation: () => Promise<unknown>) => operation()),
    listForRuntime: jest.fn(async (): Promise<JobAidWorkRevision[]> => []),
    listHeadersForRuntime: jest.fn(async (input: unknown) =>
      (await work.listForRuntime(input as never)).map(
        ({ workRevisionRef, workRevision }) => ({
          workRevisionRef,
          workRevision,
        }),
      ),
    ),
    readByRefForRuntime: jest.fn(
      async (): Promise<JobAidWorkRevision | null> => savedWork(),
    ),
    withActorTransaction: jest.fn(
      async (
        _actorUserId: string,
        operation: (database: typeof actorExecutor) => Promise<unknown>,
      ) => operation(actorExecutor),
    ),
    loadOwnedSourceBinding: jest.fn(async () => ({
      kind:'SOURCE_FILE',
      workItemId: current.workItemId,
      documentVersionId: current.source.documentVersionId,
      artifactRef: current.source.sourceArtifactId,
      artifactSha256: current.source.sourceFileSha256,
    })),
  };
  const conversations = {
    loadOpenClawTurnByIdBinding: jest.fn(),
    hasActiveOfficialActorMapping: jest.fn(async () => true),
  };
  const attempts = {
    prepareCommit: jest.fn(),
    finishProjectionSuccess: jest.fn(),
    finishProjectionConflict: jest.fn(),
    finishResultGateFailure: jest.fn(),
    readScoped: jest.fn(async (input: {attemptRef:string}) => {
      const row = rows.get(input.attemptRef)!;
      const envelope = task(input.attemptRef);
      return { ...row, attemptId: envelope.actionAttemptId,
        tenantId: envelope.tenantId, workItemId: envelope.workItemId,
        actionType: envelope.taskType };
    }),
    readScopedById: jest.fn(async (input: {attemptId:string}) => {
      const row = [...rows.values()].find((item) =>
        parseTaskEnvelope(item.taskEnvelopeJson!).actionAttemptId === input.attemptId);
      if (!row) return null;
      const envelope = parseTaskEnvelope(row.taskEnvelopeJson!);
      return { ...row, tenantId: envelope.tenantId, workItemId: envelope.workItemId,
        actionType: envelope.taskType, documentVersionId: envelope.documentVersionId,
        baseRevision: envelope.baseRevision };
    }),
    readRequest: jest.fn(
      async (input: { idempotencyKey: string }) =>
        [...rows.values()].find(
          (row) =>
            task(row.operationRef!).idempotencyKey === input.idempotencyKey,
        ) ?? null,
    ),
    readRequestIdentity:jest.fn(async(input:{idempotencyKey:string})=>{
      const row=[...rows.values()].find(value=>task(value.operationRef!).idempotencyKey===input.idempotencyKey);
      return row?{operationRef:row.operationRef,status:row.status}:null;
    }),
    reserve: jest.fn(async (input: ReserveActionAttemptInput) => {
      const operationRef = `AQ-CONTINUATION-${rows.size + 1}`;
      const actionAttemptId = `ATT-CONTINUATION-${rows.size + 1}`;
      const envelope = sealTaskEnvelope({
        schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
        actionAttemptId,
        operationRef,
        taskType: input.taskType,
        priority: 100,
        tenantId: input.tenantId,
        workItemId: input.workItemId,
        inputRevision: input.inputRevision,
        baseRevision: input.baseRevision,
        documentVersionId: input.documentVersionId,
        sourceRefs: input.sourceRefs!,
        allowedConnectors: input.allowedConnectors ?? [],
        hostResolvedMissingInputs: [],
        ...(input.programControlled ? {executionModel: taskModelSelection(input.programControlled.modelRef)} : {}),
        modelInput: await input.buildModelInput({
          attemptId: actionAttemptId,
          operationRef,
          triggerRequestId: 'TRIGGER-CONTINUATION',
          attemptNo: rows.size + 1,
          createdAt: new Date('2026-09-09T00:00:00.000Z'),
        }),
        deadline: '2026-09-09T01:00:00.000Z',
        idempotencyKey: input.idempotencyKey,
      });
      const row = {
        operationRef,
        status: 'QUEUED',
        taskEnvelopeJson: canonicalJson(envelope),
      } as ActionAttemptRow;
      rows.set(operationRef, row);
      return { row, task: envelope, created: true };
    }),
    reserveAndClaim: jest.fn(async (input: ReserveActionAttemptInput) => {
      const existing = await attempts.readRequest(input);
      const reserved = existing
        ? { row: existing, task: task(existing.operationRef!) }
        : await attempts.reserve(input);
      const pendingRequest = readInitialAnalysisRequestInput(reserved.task);
      if (pendingRequest) {
        const { inputHash: _oldHash, ...pending } = reserved.task;
        reserved.task = sealTaskEnvelope({
          ...pending,
          modelInput: await input.buildModelInput({
            attemptId: pending.actionAttemptId,
            operationRef: pending.operationRef,
            triggerRequestId: 'TRIGGER-CONTINUATION',
            attemptNo: 1,
            createdAt: new Date('2026-09-09T00:00:00.000Z'),
          }),
        });
        assertPreparedInitialAnalysisInput(pendingRequest, reserved.task.modelInput);
        reserved.row.taskEnvelopeJson = canonicalJson(reserved.task);
      }
      reserved.row.status = 'RUNNING';
      return {
        attemptRef: reserved.task.operationRef,
        status: 'RUNNING',
        leaseToken: REQUEST_2,
        leaseGeneration: 1,
        leaseExpiresAt: '2026-09-09T00:30:00.000Z',
        task: reserved.task,
      };
    }),
  };
  const originalReader = { readDocumentOriginal: jest.fn(async () => {
      const original = originalFixture(); original.binding.documentVersionId=current.source.documentVersionId;
      original.source.units = [original.source.units[0]];
      original.source.units[0].payload = {text:ENGLISH};
      return {original,structuredSource:original.source,run:{...original.binding,
        manifestArtifact:{relativePath:'original/manifest.json',readback:'VERIFIED',sha256:'b'.repeat(64),byteLength:100}}};
    }) };
  const service = new CanonicalJobAidProblemService(
    registrar as never,
    artifactStore as never,
    { authorizeOpenClawAttempt: jest.fn(async () => scope) } as never,
    {} as never,
    {} as never,
    attempts as never,
    workItems as never,
    conversations as never,
    {
      buildForWorkItemWithEvidence: jest.fn(async () => ({
        common: projectCommonAssessmentContext(
          current,
          {
            context: { status: 'UNAVAILABLE', reason: 'SYNTHETIC_TEST' },
            documentReadingStatus: 'AVAILABLE',
            items: [],
            sections: [],
            resourceRefs: [],
          },
          [],
        ),
        availableReadingEvidence: [],
      })),
    } as never,
    work as never,
    knowledge as never,
    originalReader as never,
    { read: jest.fn().mockResolvedValue(null) } as never,
  );
  return {
    service,
    originalReader,
    rows,
    task,
    registrar,
    artifactStore,
    attempts,
    work,
    conversations,
    actorExecutor,
    current: () => current,
    advanceRevision: () => {
      current = { ...current, revision: current.revision + 1 };
    },
    enqueue: (
      requestId: string,
      purpose:
        | 'INITIAL_PROBLEM_ASSESSMENT'
        | 'OVERALL_CONSISTENCY' = 'INITIAL_PROBLEM_ASSESSMENT',
    ) =>
      service.enqueueContinuation(
        current,
        TENANT,
        'permission-browser',
        requestId,
        purpose,
      ),
  };
}

function successorHarness() {
  const h=harness();
  // These ordinary-source unit fixtures contain no TDMS marker or carriers.
  // The real Source/role/lease admission is exercised in the owned PG chain.
  Object.assign(h.service,{nativeVerifier:{admitReview:async()=>null}});
  const exact=savedWork();
  h.work.listForRuntime.mockResolvedValue([exact]);
  h.current().integratedAssessment={status:'OVERALL_CANDIDATE_STALE',baseRules:{
    schemaVersion:JOBAID_PROBLEM_RESULT_SCHEMA,workRevisionRef:'JAWR-PERSISTED-2',workRevision:2,
  },overallSynthesis:{status:'STALE',basedOnJobAidWorkRevisionRef:'JAWR-PERSISTED-2'}} as never;
  const turn={requestId:'REQUEST-SUCCESSOR',inputRevision:5,overallRequested:true,
    purpose:'UPDATE_ASSESSMENT',reviewScope:null,
    assistantCandidate:{jobAidWorkingUpdate:{status:'APPLIED',workRevisionRef:'JAWR-PERSISTED-3' as string|null,workRevision:3}}};
  h.conversations.loadOpenClawTurnByIdBinding.mockResolvedValue({turn});
  const delegated: import('../../server/modules/canonical-host/canonical-service-scope.authorization').CanonicalVerifiedServiceScope={
    ...scope,successorReviewDelegation:{...scope,actorUserId:OWNER,
      documentId:'DOC-JOBAID',documentVersionId:'DV-JOBAID',sourceArtifactId:'ART-TEST',
      sourceFileSha256:'a'.repeat(64),sourceByteLength:1234,
      reviewConversationRef:'CONV-SUCCESSOR',reviewTurnRef:'TURN-SUCCESSOR',
      requestId:'REQUEST-SUCCESSOR',inputRevision:5,overallRequested:true}};
  return {...h,turn,delegated};
}

function projection(): CanonicalWorkItemProjection {
  return {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: scope.workItemId,
    requestId: 'REQUEST-WORK-ITEM',
    revision: 5,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    permissionSnapshotVersion: 'permission-browser',
    parseAuthorization: {
      action: 'PARSE_PDF',
      actorFingerprint: 'actor',
      decisionId: 'decision',
      decisionHash: 'hash',
      permissionSnapshotVersion: 'permission-browser',
    },
    source: { documentId: 'DOC-JOBAID', documentVersionId: 'DV-JOBAID',sourceArtifactId:'ART-TEST',sourceFileSha256:'a'.repeat(64),sourceByteLength:1234 },
    classification: { status: 'CONFIRMED', normalizedFamily: 'SB' },
    package: {
      packageId: 'PKG-JOBAID',
      title: 'Synthetic English source',
      artifact: {
        ref: 'artifact://english-package',
        sha256: 'a'.repeat(64),
        byteLength: 100,
        storeRole: 'U0_PARSED_PACKAGE',
        mediaType: 'application/json',
      },
    },
    integratedAssessment: null,
    failure: null,
    recordingFailure: null,
  } as unknown as CanonicalWorkItemProjection;
}

function savedWork(): JobAidWorkRevision {
  return {
    workRevisionRef: 'JAWR-PERSISTED-3',
    workItemId: scope.workItemId,
    workRevision: 3,
    previousWorkRevisionRef: 'JAWR-PERSISTED-2',
    requestId: 'SAVE-3',
    actionAttemptId: 'ATT-PRIOR',
    basedOnWorkItemRevision: 5,
    documentVersionId: 'DV-JOBAID',
    createdAt: '2026-09-08T00:00:00.000Z',
    content: {
      schemaVersion: JOBAID_PROBLEM_WORK_SCHEMA,
      overviewStatus: 'CURRENT',
      headline: '单次正常检查不能排除间歇故障',
      listBrief: '继续核查持续状态。',
      understanding: `已保存的完整认识及条件：${ENGLISH}`,
      decisiveIssueKeys: [],
      issues: [],
      roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS',
      completionReason: '本轮已完成，保持现有未知。',
      changeSummary: '保留此前工作。',
      unchangedExplanation: '未修改内容完整继承。',
      methodBinding: structuredClone(JOBAID_METHOD_BINDING),
      evidence: [],
      readSourceRefs: [],
      capabilities: [],
      historyReview: {
        required: false,
        priorAssessmentRefs: [],
        engineeringDocumentRefs: [],
        coverage: 'NOT_REQUIRED',
        limitation: null,
      },
    },
  };
}
