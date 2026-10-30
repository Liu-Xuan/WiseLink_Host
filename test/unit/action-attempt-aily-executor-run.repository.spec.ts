import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { ActionAttemptRepository } from '../../server/modules/action-attempt/action-attempt.repository';
import type { ActionAttemptRow } from '../../server/modules/action-attempt/action-attempt.types';
import { ailyFinalCommitGuard, type AilyExecutorRun, type AilyFinalCommitGuard } from '../../server/modules/canonical-host/aily-executor-run';
import { canonicalJson, sealTaskEnvelope, sealResultEnvelope, parseTaskEnvelope } from '../../server/modules/action-attempt/action-attempt-envelope';
import { buildInitialAnalysisRequestInput } from '../../server/modules/action-attempt/initial-analysis-request';
import { actionAttempt, assessmentWorkRevision, workItem } from '../../server/database/schema';
import { autoWorkItemAuthorization } from '../../server/database/auto-work-item-authorization.schema';
import { assertJobAidWorkFence } from '../../server/modules/canonical-host/jobaid-work.repository';

const dialect = new PgDialect();
function fixture() {
  const row = {attemptId: 'ATT-test', operationRef: 'AQ-test', tenantId: 'tenant-test', workItemId: 'WI-test',
    leaseOwner: 'service:aily-test', leaseToken: '00000000-0000-4000-8000-000000000105', leaseGeneration: 2,
    taskInputHash: 'a'.repeat(64)} as ActionAttemptRow;
  const run: AilyExecutorRun = {schemaVersion: 'wiselink.aily-executor-run.v1', executor: 'AILY_AGENT_V1',
    requestId: '00000000-0000-4000-8000-000000000101', agentId: 'agent_synthetic',
    publicationRef: 'synthetic-publication', configurationSource: 'synthetic-approved-fixture',
    scope: {tenantId: row.tenantId, workItemId: row.workItemId, intakeRequestId: 'original-intake', principalId: row.leaseOwner!},
    modelEvidence: {selectedModelRef: 'aily/deepseek-v4-pro', actualModelRef: null},
    hostSessionId: '00000000-0000-4000-8000-000000000102', leaseGeneration: 2,
    post: {state: 'STARTED', startedAt: '2026-10-29T00:00:00.000Z', requestBody: '{"stream":false}'}};
  const execute = jest.fn().mockResolvedValue([{attempt_id: row.attemptId}]);
  const repository = new ActionAttemptRepository({execute} as never);
  return {row, run, execute, repository};
}

describe('Aily private run repository seam', () => {
  it('uses the original WI/grant fence and changes only observation while a concurrent SAVE slot survives', async () => {
    const h = observationHarness(); const expected = structuredClone(h.run);
    h.run.pending = {candidateRef: '00000000-0000-4000-8000-000000000002', saveRequestId: 'SAVE-B', phase: 'SAVE_STARTED',
      validatedAt: new Date().toISOString(), workJson: '{"candidate":"B"}', expectedWorkRevision: 1, previousWorkRevisionRef: 'JAWR-A'};
    const pending = structuredClone(h.run.pending);
    expect(await h.observe(expected)).toBe(true);
    expect(h.run.pending).toEqual(pending); expect(h.run.post).toEqual(expected.post);
    expect(h.run.observation?.remoteStatus).toBe('UnverifiedRemoteStatus');
    expect(h.locks).toEqual(['WI', 'GRANT', 'ATTEMPT']);
    const query = h.statements[0]; expect(query.sql).toContain("jsonb_set(executor_run_json,'{observation}'");
    expect(query.sql).toContain("executor_run_json-'pending'");expect(query.sql).not.toContain("-'observation'");
    expect(query.sql).toContain('clock_timestamp()');
    expect(query.params).toEqual(expect.arrayContaining([h.row.leaseToken, h.row.leaseGeneration, h.row.taskInputHash]));
    expect(query.sql).not.toContain('SET executor_run_json=$');
  });

  it('keeps the newer observation in the actual SQL CAS while ignoring only a changed SAVE slot',async()=>{
    const h=observationHarness();const beforeGets=structuredClone(h.run);
    expect(await h.observe(beforeGets,'Completed')).toBe(true);const completed=structuredClone(h.run.observation);
    h.run.pending={candidateRef:'00000000-0000-4000-8000-000000000004',saveRequestId:'SAVE-late',phase:'VALIDATED',
      validatedAt:new Date().toISOString(),workJson:'{}',expectedWorkRevision:1,previousWorkRevisionRef:'JAWR-A'};
    const pending=structuredClone(h.run.pending);
    expect(await h.observe(beforeGets,'Running')).toBe(false);
    expect(h.run.observation).toEqual(completed);expect(h.run.pending).toEqual(pending);
    expect(h.statements).toHaveLength(2);expect(h.statements[1].sql).not.toContain("-'observation'");
  });

  it.each(['cancel', 'generation', 'deadline', 'inner', 'grant', 'owner-source'])('prevents an observation write after %s changes', async reason => {
    const h = observationHarness(); const expected = structuredClone(h.run); const before = canonicalJson(h.run);
    if (reason === 'cancel') h.row.cancelRequestedAt = new Date();
    if (reason === 'generation') h.row.leaseGeneration += 1;
    if (reason === 'deadline') h.row.deadlineAt = new Date(0);
    if (reason === 'inner') h.row.leaseExpiresAt = new Date(0);
    if (reason === 'grant') h.grant.status = 'CANCELLED';
    if (reason === 'owner-source') h.owner.sourceArtifactId = 'changed';
    if (reason === 'grant' || reason === 'owner-source') await expect(h.observe(expected)).rejects.toThrow('AUTO_WORK_ITEM_ATTEMPT_LEASE_REJECTED');
    else expect(await h.observe(expected)).toBe(false);
    expect(canonicalJson(h.run)).toBe(before);
  });
  it.each(['VALIDATED','SAVE_STARTED','READ'] as const)('does not seal A after B reached %s at the real markCommitting SQL cut',async phase=>{
    const h=finalCutoffHarness();const original=h.guard();h.advanceB(phase);
    expect(await h.finalize('JAWR-A',original)).toBeNull();
    expect(h.row.status).toBe('RUNNING');expect(h.row.resultEnvelopeJson).toBeNull();expect(h.row.resultContentHash).toBeNull();
    const query=h.statements[0];expect(query.sql).toContain("executor_run_json->'pending'");
    expect(query.sql).toContain('final_work.command_json');expect(query.sql).toContain('later_work.work_revision>final_work.work_revision');
    expect(query.sql).toContain('final_owner.revision');expect(query.sql).toContain("@>");
    expect(query.params).toContain(canonicalJson(original.pending));
    expect(h.locks.slice(0,3)).toEqual(['WI','GRANT','ATTEMPT']);
    h.advanceB('READ');
    expect((await h.finalize('JAWR-B',h.guard()))?.status).toBe('COMMITTING');
    expect(JSON.parse(h.row.resultEnvelopeJson!).modelOutput).toBe('{"workRevisionRef":"JAWR-B"}');
  });
  it.each(['read-proof','latest-work','work-item-base'])('leaves result absent when the atomic final %s condition no longer holds',async reason=>{
    const h=finalCutoffHarness();const guard=h.guard();
    if(reason==='read-proof')h.row.reviewActivityJson='[]';if(reason==='latest-work')h.setLatest('JAWR-later');
    if(reason==='work-item-base')h.owner.revision=6;
    expect(await h.finalize('JAWR-A',guard)).toBeNull();expect(h.row.status).toBe('RUNNING');expect(h.row.resultContentHash).toBeNull();
  });
  it('permits a pending candidate replacement only for READ to a new VALIDATED slot',async()=>{
    const h=fixture();const pending={candidateRef:'00000000-0000-4000-8000-000000000001',saveRequestId:'SAVE-A',phase:'READ' as const,
      validatedAt:new Date().toISOString(),workJson:'{}',expectedWorkRevision:0,previousWorkRevisionRef:null,
      workRevisionRef:'JAWR-A',workRevision:1,readObservedAt:new Date().toISOString()};
    const expected={...h.run,pending};
    const replacement={candidateRef:'00000000-0000-4000-8000-000000000002',saveRequestId:'SAVE-B',phase:'VALIDATED' as const,
      validatedAt:new Date().toISOString(),workJson:'{"next":true}',expectedWorkRevision:1,previousWorkRevisionRef:'JAWR-A'};
    expect(await h.repository.compareAndSetAilyDomainRun({row:h.row,principalId:h.row.leaseOwner!,expected,
      next:{...h.run,pending:replacement},writePredicate:sql`true`})).toBe(true);
    await expect(h.repository.compareAndSetAilyDomainRun({row:h.row,principalId:h.row.leaseOwner!,expected,
      next:{...h.run,pending:{...replacement,phase:'READ',workRevisionRef:'JAWR-B',workRevision:2,readObservedAt:new Date().toISOString()}},writePredicate:sql`true`}))
      .rejects.toThrow('AILY_PENDING_SAVE_CONFLICT');
  });
  it('admits a new successor after an exact Host final and saved/READ/stage result settled the old remote UNKNOWN',async()=>{
    const h=reservationHarness('SUCCEEDED');
    const {inputHash:_hash,...base}=parseTaskEnvelope(h.old.taskEnvelopeJson);
    const task=sealTaskEnvelope({...base,inputRevision:4,baseRevision:4});
    h.old.taskEnvelopeJson=canonicalJson(task);h.old.taskInputHash=task.inputHash;h.old.inputRevision=4;h.old.baseRevision=4;
    const stage={schemaVersion:'wiselink.aily-stage-overall.v1',workRevisionRef:'JAWR-final',workRevision:1,
      sourceAssessment:{actionAttemptId:h.old.attemptId,workRevisionRef:'JAWR-final',workRevision:1,saveRequestId:'SAVE-final',readObservedAt:'2026-10-29T00:00:00.000Z'},
      artifact:{ref:'artifact://synthetic-final',sha256:'b'.repeat(64),byteLength:123,mediaType:'application/json',storeRole:'UnifiedArtifactStoreCandidate'},
      observedAt:'2026-10-29T00:00:01.000Z'};
    h.old.reviewActivityJson=canonicalJson([{kind:'ASSESSMENT_WORK_READ',workRevisionRef:'JAWR-final',workRevision:1,
      saveRequestId:'SAVE-final',observedAt:stage.sourceAssessment.readObservedAt},{kind:'AILY_STAGE_OVERALL',receipt:stage,observedAt:stage.observedAt}]);
    h.run.pending={candidateRef:'00000000-0000-4000-8000-000000000001',saveRequestId:'SAVE-final',phase:'READ',
      validatedAt:'2026-10-29T00:00:00.000Z',workJson:'{}',expectedWorkRevision:0,previousWorkRevisionRef:null,
      workRevisionRef:'JAWR-final',workRevision:1,readObservedAt:stage.sourceAssessment.readObservedAt};
    h.proof.saved.push({workRevisionRef:'JAWR-final',workRevision:1,saveRequestId:'SAVE-final'});
    h.storedWorks.push({assessmentWorkRevisionId:'JAWR-final',actionAttemptId:h.old.attemptId,requestId:'SAVE-final',
      basedOnWorkItemRevision:4,workRevision:1,previousWorkRevisionId:null,commandJson:canonicalJson({expectedWorkRevision:0,work:{}})});
    const result=sealResultEnvelope({schemaVersion:'wiselink.3_1.openclaw_result_envelope.v1',executionKind:'AILY_AGENT',
      actionAttemptId:h.old.attemptId,operationRef:h.old.operationRef!,taskType:'OPENCLAW_DYNAMIC_EVALUATION',workItemId:h.old.workItemId,
      baseRevision:4,status:'SUCCEEDED',businessOutcome:'CANDIDATE_READY',candidateStatus:null,modelOutput:'{"workRevisionRef":"JAWR-final"}',
      outputArtifactRefs:[{ref:stage.artifact.ref,sha256:stage.artifact.sha256}],sourceRefs:task.sourceRefs,factsConsidered:[],missingInputs:[],conflicts:[],warnings:[],
      modelVersion:null,promptVersion:'synthetic',skillVersion:'wiselink-aily-domain@v1',toolVersions:{'model-executor':'AILY_AGENT_V1','wiselink-aily-engineering':'1.0.0'},
      producer:{kind:'AILY_AGENT_V1',agentId:h.run.agentId,publicationRef:h.run.publicationRef,selectedModelRef:h.run.modelEvidence.selectedModelRef,actualModelRef:null,usage:null},
      runMetrics:{durationMs:1,inputUnits:null,outputUnits:null},errorCode:null,errorDetail:null});
    h.old.resultEnvelopeJson=canonicalJson(result);h.old.resultContentHash=result.contentHash;
    h.old.commitStartedAt=new Date();h.old.projectionApplied=true;
    expect((await h.reserve()).created).toBe(true);expect(h.run.post.state).toBe('UNKNOWN');
    expect(h.old.resultEnvelopeJson).toBe(canonicalJson(result));
  });
  it('merges a late accepted receipt without overwriting domain pending written while create was in flight',async()=>{
    const h=fixture();const accepted:AilyExecutorRun={...h.run,post:{...h.run.post,state:'ACCEPTED',acceptedAt:new Date().toISOString(),chatId:'123',remoteSessionId:'remote'}};
    await expect(h.repository.compareAndSetAilyExecutorRun({row:h.row,principalId:h.row.leaseOwner!,expected:h.run,next:accepted})).resolves.toBe(true);
    const query=dialect.sqlToQuery(h.execute.mock.calls[0][0]);
    expect(query.sql).toContain("jsonb_set(executor_run_json,'{post}'");
    expect(query.sql).toContain("executor_run_json-'pending'");
  });
  it('binds pending command, payload, original POST and current fence in the same private-row CAS',async()=>{
    const h=fixture();const pending={candidateRef:'00000000-0000-4000-8000-000000000001',saveRequestId:'SAVE-original',phase:'SAVE_STARTED' as const,
      validatedAt:new Date().toISOString(),workJson:'{"complete":"candidate"}',expectedWorkRevision:0,previousWorkRevisionRef:null};
    const expected={...h.run,pending};const next={...expected,pending:{...pending,phase:'SAVED' as const,workRevisionRef:'JAWR-original',workRevision:1}};
    expect(await h.repository.compareAndSetAilyDomainRun({row:h.row,principalId:h.row.leaseOwner!,expected,next,writePredicate:sql`synthetic_current_mapping`})).toBe(true);
    const query=dialect.sqlToQuery(h.execute.mock.calls[0][0]);expect(query.sql).toContain('synthetic_current_mapping');
    expect(query.sql).toContain('clock_timestamp()');expect(query.sql).toContain('executor_run_json IS NOT DISTINCT FROM');
    await expect(h.repository.compareAndSetAilyDomainRun({row:h.row,principalId:h.row.leaseOwner!,expected,
      next:{...next,pending:{...next.pending,workJson:'{"replacement":true}'}},writePredicate:sql`true`})).rejects.toThrow('AILY_PENDING_SAVE_CONFLICT');
  });
  it('allows a newly authorized successor after the old UNKNOWN is terminal, fenced and proven to have no saved work', async () => {
    const h = reservationHarness(); const original = structuredClone(h.run);
    const reserved = await h.reserve();
    expect(reserved.created).toBe(true);
    expect(h.locks.slice(0, 3)).toEqual(['WI', 'GRANT', 'ATTEMPT']);
    expect(h.coverageReads()).toBeGreaterThan(0);
    expect(h.run).toEqual(original);
    expect(h.insert).toHaveBeenCalledTimes(1);
  });

  it.each(['RUNNING', 'COMMITTING'])('does not allow a new UUID to replace original %s dispatch', async state => {
    const h = reservationHarness(state);
    await expect(h.reserve()).rejects.toThrow();
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.old.status).toBe(state);
    expect(h.run.post.state).toBe('UNKNOWN');
  });

  it.each(['SUCCEEDED', 'WAITING_INPUT'])('does not invent final-result settlement for an unverified enterprise %s shape', async state => {
    const h = reservationHarness(state);
    await expect(h.reserve()).rejects.toThrow('INITIAL_EXPIRED_UNRECONCILED_AILY_DISPATCH');
    expect(h.insert).not.toHaveBeenCalled();
  });

  it.each(['invisible', 'committing-result', 'unknown-activity'] as const)('keeps %s coverage protected instead of treating it as an empty save set', async protectedBy => {
    const h = reservationHarness();
    if (protectedBy === 'invisible') h.proof.covered = false;
    if (protectedBy === 'committing-result') h.old.resultContentHash = 'b'.repeat(64);
    if (protectedBy === 'unknown-activity') h.old.reviewActivityJson = '[{"kind":"UNRECOGNIZED_SAVE_RECEIPT"}]';
    await expect(h.reserve()).rejects.toThrow();
    expect(h.insert).not.toHaveBeenCalled();
  });

  it('preserves known saved work after the old Host fence is closed instead of making remote UNKNOWN a permanent block', async () => {
    const h = reservationHarness();
    const saved = {workRevisionRef: 'JAWR-old', workRevision: 1, saveRequestId: 'SAVE-old'};
    h.proof.saved.push(saved);
    expect((await h.reserve()).created).toBe(true);
    expect(h.proof.saved).toEqual([saved]);
    expect(h.run.post.state).toBe('UNKNOWN');
  });

  it.each(['unknown-activity', 'malformed-known-activity', 'unreconciled-projection', 'earlier-unknown-activity'] as const)
    ('does not let known saved work mask %s under the original locks', async hidden => {
      const h = reservationHarness(); h.proof.saved.push({workRevisionRef: 'JAWR-old', workRevision: 1, saveRequestId: 'SAVE-old'});
      if (hidden === 'unknown-activity') h.old.reviewActivityJson = '[{"kind":"UNRECOGNIZED_SAVE_RECEIPT"}]';
      if (hidden === 'malformed-known-activity') h.old.reviewActivityJson = '[{"kind":"ASSESSMENT_WORK_READ"}]';
      if (hidden === 'unreconciled-projection') h.owner.projectionJson = canonicalJson({source: {
        sourceArtifactId: h.owner.sourceArtifactId, sourceFileSha256: h.owner.sourceFileSha256},
        integratedAssessment: {baseRules: {actionAttemptId: h.old.attemptId}}});
      if (hidden === 'earlier-unknown-activity') h.old.reviewActivityJson = canonicalJson([{kind: 'UNRECOGNIZED_SAVE_RECEIPT'},
        ...Array.from({length: 50}, () => ({kind: 'ASSESSMENT_KNOWLEDGE_OBSERVED', status: 'COMPLETED', observedAt: '2026-10-29T00:00:00.000Z'}))]);
      await expect(h.reserve()).rejects.toThrow(hidden === 'unreconciled-projection'
        ? 'INITIAL_EXPIRED_UNRECONCILED_AILY_PROJECTION' : 'INITIAL_EXPIRED_ACTIVITY_UNKNOWN');
      expect(h.insert).not.toHaveBeenCalled();
      expect(h.proof.saved).toHaveLength(1);
      expect(h.locks.slice(0, 3)).toEqual(['WI', 'GRANT', 'ATTEMPT']);
    });

  it('does not turn a historical UNKNOWN from another intake into a permanent whole-WI block', async () => {
    const h = reservationHarness(); h.run.scope.intakeRequestId = 'different-original-intake';
    expect((await h.reserve()).created).toBe(true);
    expect(h.coverageReads()).toBe(0);
  });

  it('rechecks the exact current source grant under its existing lock before inserting any successor', async () => {
    const h = reservationHarness(); h.grant.sourceFileSha256 = 'b'.repeat(64);
    await expect(h.reserve()).rejects.toThrow('INITIAL_CONTINUATION_AILY_SCOPE_CHANGED');
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.locks.slice(0, 2)).toEqual(['WI', 'GRANT']);
  });

  it('sees a SAVE that wins the attempt lock and refuses to reconcile or supersede it', async () => {
    const h = reservationHarness('RUNNING');
    h.onAttemptLock(() => h.proof.saved.push({workRevisionRef: 'JAWR-before-lock', workRevision: 1, saveRequestId: 'SAVE-before-lock'}));
    await expect(h.reserve()).rejects.toThrow();
    expect(h.old.status).toBe('RUNNING');
    expect(h.insert).not.toHaveBeenCalled();
  });

  it('reconciles an expired original under the same locks and rejects a later SAVE with the old fence', async () => {
    const h = reservationHarness('expired');
    const fence = {principalId: h.old.leaseOwner!, leaseToken: h.old.leaseToken!, leaseGeneration: h.old.leaseGeneration};
    expect((await h.reserve()).created).toBe(true);
    expect(h.old.status).toBe('TIMED_OUT');
    expect(h.old.leaseToken).toBeNull();
    expect(() => assertJobAidWorkFence(h.old, fence)).toThrow('JOBAID_WORK_LEASE_FENCE_REJECTED');
    expect(h.run.post.state).toBe('UNKNOWN');
  });

  it.each([false, true])('constructs the real claim SQL with enterprise isolation (enterprise=%s)', async enterprise => {
    const where = jest.fn((_condition: SQL | undefined) => ({returning: async () => []}));
    const database = {update: () => ({set: () => ({where})})};
    const repository = new ActionAttemptRepository(database as never);
    await repository.claimExact({attemptId: 'ATT-test', operationRef: 'AQ-test', expectedStatus: 'QUEUED',
      expectedClaimCount: 0, expectedLeaseGeneration: 0, leaseOwner: 'service:test', leaseSlot: 1,
      startedAt: null, now: new Date('2026-10-29T00:00:00.000Z'), leaseMs: 1000,
      ...(enterprise ? {ailyExecution: true as const} : {})});
    const query = dialect.sqlToQuery(where.mock.calls[0][0] as SQL);
    expect(query.sql).toContain(enterprise ? "'{modelInput,executionMode}'='AILY_AGENT_V1'" :
      "'{modelInput,executionMode}','')<>'AILY_AGENT_V1'");
    expect(query.sql.includes('COALESCE')).toBe(!enterprise);
  });

  it('probes only the new consumer storage and explicitly rejects an unapplied column', async () => {
    const h = fixture(); h.execute.mockRejectedValue(Object.assign(new Error('not installed'), {code: '42703'}));
    await expect(h.repository.assertAilyExecutorStorage()).rejects.toThrow('INITIAL_CONTINUATION_AILY_STORAGE_UNAVAILABLE');
    expect(dialect.sqlToQuery(h.execute.mock.calls[0][0] as SQL).sql).toContain('WHERE FALSE');
  });

  it('reads only the exact tenant/WI/attempt sealed in enterprise mode', async () => {
    const h = fixture(); h.execute.mockResolvedValue([{value: h.run}]);
    expect(await h.repository.readAilyExecutorRun(h.row)).toEqual(h.run);
    const statement = dialect.sqlToQuery(h.execute.mock.calls[0][0] as SQL);
    expect(statement.sql).toContain("'{modelInput,executionMode}'='AILY_AGENT_V1'");
    expect(statement.params).toEqual([h.row.attemptId, h.row.tenantId, h.row.workItemId]);
    h.execute.mockResolvedValue([{value: {...h.run, leaseToken: 'forbidden'}}]);
    await expect(h.repository.readAilyExecutorRun(h.row)).rejects.toThrow('AILY_EXECUTOR_RUN_INVALID');
  });

  it('atomically fences exact bytes, lease, generation, task hash, live status and both original deadlines', async () => {
    const h = fixture();
    expect(await h.repository.compareAndSetAilyExecutorRun({row: h.row, principalId: h.row.leaseOwner!, expected: null, next: h.run})).toBe(true);
    const query = dialect.sqlToQuery(h.execute.mock.calls[0][0] as SQL);
    expect(query.sql).toContain("status='RUNNING' AND cancel_requested_at IS NULL");
    expect(query.sql).toContain('lease_expires_at>clock_timestamp() AND deadline_at>clock_timestamp()');
    expect(query.sql).toContain('executor_run_json IS NOT DISTINCT FROM');
    expect(query.params).toEqual(expect.arrayContaining([h.row.leaseToken, h.row.leaseGeneration, h.row.taskInputHash]));
    const persisted = JSON.parse(String(query.params[0]));
    expect(persisted.post.requestBody).toBe(h.run.post.requestBody);
    expect(persisted).not.toHaveProperty('leaseToken');
    expect(query.sql.split('WHERE')[0]).not.toMatch(/\b(?:lease_|deadline_|task_envelope_json|status=)/u);
    h.execute.mockResolvedValue([]);
    expect(await h.repository.compareAndSetAilyExecutorRun({row: h.row, principalId: h.row.leaseOwner!, expected: null, next: h.run})).toBe(false);
  });

  it('allows only STARTED to become its original ACCEPTED/UNKNOWN receipt', async () => {
    const h = fixture();
    const accepted: AilyExecutorRun = {...h.run, post: {...h.run.post, state: 'ACCEPTED',
      acceptedAt: '2026-10-29T00:01:00.000Z', chatId: '123', remoteSessionId: 'original-session'}};
    await h.repository.compareAndSetAilyExecutorRun({row: h.row, principalId: h.row.leaseOwner!, expected: h.run, next: accepted});
    expect(h.execute).toHaveBeenCalledTimes(1);
    await expect(h.repository.compareAndSetAilyExecutorRun({row: h.row, principalId: h.row.leaseOwner!, expected: accepted, next: h.run}))
      .rejects.toThrow('AILY_EXECUTOR_RUN_TRANSITION_INVALID');
    await expect(h.repository.compareAndSetAilyExecutorRun({row: h.row, principalId: h.row.leaseOwner!, expected: h.run,
      next: {...accepted, post: {...accepted.post, requestBody: 'replacement'}}})).rejects.toThrow('AILY_EXECUTOR_RUN_TRANSITION_INVALID');
    await expect(h.repository.compareAndSetAilyExecutorRun({row: h.row, principalId: h.row.leaseOwner!, expected: h.run,
      next: {...accepted, agentId: 'agent_other'}})).rejects.toThrow('AILY_EXECUTOR_RUN_TRANSITION_INVALID');
    expect(h.execute).toHaveBeenCalledTimes(1);
  });

  it('rejects a different trusted principal, tenant or generation before querying', async () => {
    const h = fixture();
    for (const next of [{...h.run, leaseGeneration: 3}, {...h.run, scope: {...h.run.scope, tenantId: 'other'}}])
      await expect(h.repository.compareAndSetAilyExecutorRun({row: h.row, principalId: h.row.leaseOwner!, expected: null, next}))
        .rejects.toThrow('ACTION_ATTEMPT_LEASE_FENCE_REJECTED');
    await expect(h.repository.compareAndSetAilyExecutorRun({row: h.row, principalId: 'service:other', expected: null, next: h.run}))
      .rejects.toThrow('ACTION_ATTEMPT_LEASE_FENCE_REJECTED');
    expect(h.execute).not.toHaveBeenCalled();
  });
});

/** Actual observation SQL and original grant lock helper; isolated DB evaluates its CAS. */
function observationHarness() {
  const h = fixture();
  const owner = {tenantId: h.row.tenantId, workItemId: h.row.workItemId, requestId: h.run.scope.intakeRequestId,
    requestedByUserId: 'owner-test', documentId: 'DOC', documentVersionId: 'DV', sourceArtifactId: 'ART',
    sourceFileSha256: 'a'.repeat(64), sourceByteLength: 123};
  const grant = {...owner, actorUserId: owner.requestedByUserId, status: 'LEASED', grantKind: 'MIAODA_CANONICAL_PARSE_REQUEST',
    leaseOwner: h.row.leaseOwner, leaseGeneration: 3, leaseExpiresAt: new Date('2099-01-01')};
  const row = {...h.row, documentVersionId: 'DV', status: 'RUNNING', cancelRequestedAt: null,
    deadlineAt: new Date('2099-01-01'), leaseExpiresAt: new Date('2099-01-01')} as ActionAttemptRow;
  const run: AilyExecutorRun = {...h.run, post: {...h.run.post, state: 'ACCEPTED', acceptedAt: new Date().toISOString(), chatId: '123', remoteSessionId: 'remote'}};
  const locks: string[] = []; const statements: Array<{sql: string; params: unknown[]}> = [];
  const database = {transaction: jest.fn(), select: () => ({from: (table: unknown) => {
    const values = () => table === workItem ? [owner] : table === autoWorkItemAuthorization ? [grant] :
      [{...row, automaticLease: canonicalJson({requestId: owner.requestId, leaseGeneration: 3})}];
    const chain = {where: () => chain, limit: () => chain, for: async () => {locks.push(table === workItem ? 'WI' : 'GRANT'); return values();},
      then: <T>(resolve: (rows: unknown[]) => T) => Promise.resolve(values()).then(resolve)};
    return chain;
  }}), execute: async (statement: SQL) => {
    locks.push('ATTEMPT'); const query = dialect.sqlToQuery(statement); statements.push(query);
    const json = query.params.filter((value): value is string => typeof value === 'string' && value.includes('"schemaVersion":"wiselink.aily-executor-run.v1"'));
    const checked = JSON.parse(json[0]) as AilyExecutorRun; const expected = JSON.parse(json[1]) as AilyExecutorRun;
    if (row.cancelRequestedAt || row.status !== 'RUNNING' || !row.deadlineAt || row.deadlineAt <= new Date() ||
        !row.leaseExpiresAt || row.leaseExpiresAt <= new Date() || !query.params.includes(row.leaseGeneration) ||
        canonicalJson({...run, pending: undefined}) !== canonicalJson({...expected, pending: undefined})) return [];
    run.observation = checked.observation; return [{attempt_id: row.attemptId}];
  }};
  database.transaction.mockImplementation(async (operation: (db: typeof database) => Promise<unknown>) => operation(database));
  const repository = new ActionAttemptRepository(database as never);
  const captured = {...row};
  const observe = (expected: AilyExecutorRun, remoteStatus='UnverifiedRemoteStatus') => repository.compareAndSetAilyObservation({row: captured, principalId: captured.leaseOwner!, expected,
    observation: {checkedAt: new Date().toISOString(), remoteStatus}});
  return {row, run, owner, grant, locks, statements, observe};
}

/** Real repository markCommitting and its actual SQL, with an isolated database
 * double evaluating the bound JSON/READ/latest-work values from that statement. */
function finalCutoffHarness() {
  const h=fixture();const actorUserId='owner-test';
  const owner={tenantId:h.row.tenantId,workItemId:h.row.workItemId,requestId:h.run.scope.intakeRequestId,requestedByUserId:actorUserId,
    revision:5,documentId:'DOC',documentVersionId:'DV',sourceArtifactId:'ART',sourceFileSha256:'a'.repeat(64),sourceByteLength:123};
  const task=sealTaskEnvelope({schemaVersion:'wiselink.3_1.openclaw_task_envelope.v1',actionAttemptId:h.row.attemptId,operationRef:h.row.operationRef!,
    taskType:'OPENCLAW_DYNAMIC_EVALUATION',priority:1,tenantId:owner.tenantId,workItemId:owner.workItemId,inputRevision:5,baseRevision:5,
    documentVersionId:'DV',sourceRefs:[],allowedConnectors:[],hostResolvedMissingInputs:[],modelInput:{executionMode:'AILY_AGENT_V1',
      automaticWorkItemLease:{requestId:owner.requestId,leaseGeneration:3}},deadline:'2099-01-01T00:00:00.000Z',idempotencyKey:'synthetic-final'});
  const row={...h.row,actorUserId,documentVersionId:'DV',baseRevision:5,inputRevision:5,status:'RUNNING',taskEnvelopeJson:canonicalJson(task),
    taskInputHash:task.inputHash,resultEnvelopeJson:null,resultContentHash:null,leaseExpiresAt:new Date('2099-01-01'),deadlineAt:new Date('2099-01-01'),
    cancelRequestedAt:null,reviewActivityJson:'[]'} as ActionAttemptRow;
  const grant={...owner,actorUserId,status:'LEASED',grantKind:'MIAODA_CANONICAL_PARSE_REQUEST',leaseOwner:row.leaseOwner,
    leaseToken:'synthetic-outer',leaseGeneration:3,leaseExpiresAt:new Date('2099-01-01')};
  const run={...h.run,pending:{candidateRef:'00000000-0000-4000-8000-000000000001',saveRequestId:'SAVE-A',phase:'READ' as const,
    validatedAt:'2026-10-29T00:00:00.000Z',workJson:'{"headline":"A"}',expectedWorkRevision:0,previousWorkRevisionRef:null,
    workRevisionRef:'JAWR-A',workRevision:1,readObservedAt:'2026-10-29T00:00:01.000Z'}} as AilyExecutorRun;
  let latest='JAWR-A';const locks:string[]=[];const statements:Array<{sql:string;params:unknown[]}>=[];
  const recordRead=()=>{const p=run.pending!;row.reviewActivityJson=canonicalJson([...JSON.parse(row.reviewActivityJson!),
    {kind:'ASSESSMENT_WORK_READ',workRevisionRef:p.workRevisionRef,workRevision:p.workRevision,saveRequestId:p.saveRequestId,observedAt:p.readObservedAt}]);};
  recordRead();
  const database={transaction:jest.fn(),select:()=>({from:(table:unknown)=>{
    const values=()=>table===workItem?[owner]:table===autoWorkItemAuthorization?[grant]:[{...row,
      automaticLease:canonicalJson({requestId:owner.requestId,leaseGeneration:3})}];
    const chain={where:()=>chain,limit:()=>chain,for:async()=>{locks.push(table===workItem?'WI':'GRANT');return values();},
      then:<T>(resolve:(rows:unknown[])=>T)=>Promise.resolve(values()).then(resolve)};return chain;
  }}),update:()=>({set:(changes:Record<string,unknown>)=>({where:(condition:SQL)=>({returning:async()=>{
    locks.push('ATTEMPT');const query=dialect.sqlToQuery(condition);statements.push(query);
    const json=query.params.find(value=>typeof value==='string'&&value.includes('"candidateRef"')&&value.includes('"phase":"READ"'));
    const proof=query.params.find(value=>typeof value==='string'&&value.startsWith('[')&&value.includes('ASSESSMENT_WORK_READ'));
    const expectedRead=typeof proof==='string'?(JSON.parse(proof) as Record<string,unknown>[])[0]:null;
    const records=JSON.parse(row.reviewActivityJson??'[]') as Record<string,unknown>[];
    if(typeof json!=='string'||canonicalJson(run.pending)!==json||run.pending?.workRevisionRef!==latest||row.status!=='RUNNING'||
        owner.revision!==row.baseRevision||!expectedRead||!records.some(record=>Object.keys(expectedRead).every(key=>record[key]===expectedRead[key])))return [];
    Object.assign(row,{status:changes.status,resultEnvelopeJson:changes.resultEnvelopeJson,resultContentHash:changes.resultContentHash,commitStartedAt:changes.commitStartedAt});
    return [row];
  }})})})};
  database.transaction.mockImplementation(async(operation:(db:typeof database)=>Promise<unknown>)=>operation(database));
  const repository=new ActionAttemptRepository(database as never);
  const guard=()=>ailyFinalCommitGuard(run,run.pending!.workRevisionRef!,actorUserId);
  const finalize=(ref:string,final:AilyFinalCommitGuard)=>repository.markCommitting({attemptId:row.attemptId,automaticLeaseRequired:true,
    leaseToken:row.leaseToken!,leaseGeneration:row.leaseGeneration,now:new Date(),recoveryLeaseMs:60000,ailyFinal:final,
    result:sealResultEnvelope({schemaVersion:'wiselink.3_1.openclaw_result_envelope.v1',executionKind:'AILY_AGENT',
      actionAttemptId:row.attemptId,operationRef:row.operationRef!,taskType:'OPENCLAW_DYNAMIC_EVALUATION',workItemId:row.workItemId,baseRevision:5,
      status:'SUCCEEDED',businessOutcome:'CANDIDATE_READY',candidateStatus:null,modelOutput:JSON.stringify({workRevisionRef:ref}),outputArtifactRefs:[],sourceRefs:[],
      factsConsidered:[],missingInputs:[],conflicts:[],warnings:[],modelVersion:null,promptVersion:'synthetic',skillVersion:'wiselink-aily-domain@v1',toolVersions:{},
      producer:{kind:'AILY_AGENT_V1',agentId:run.agentId,publicationRef:run.publicationRef,selectedModelRef:run.modelEvidence.selectedModelRef,actualModelRef:null,usage:null},
      runMetrics:{durationMs:1,inputUnits:null,outputUnits:null},errorCode:null,errorDetail:null})});
  return {row,run,owner,statements,locks,guard,finalize,setLatest:(ref:string)=>{latest=ref;},advanceB:(phase:'VALIDATED'|'SAVE_STARTED'|'READ')=>{
    run.pending={candidateRef:'00000000-0000-4000-8000-000000000002',saveRequestId:'SAVE-B',phase,validatedAt:'2026-10-29T00:00:02.000Z',
      workJson:'{"headline":"B"}',expectedWorkRevision:1,previousWorkRevisionRef:'JAWR-A',
      ...(phase==='READ'?{workRevisionRef:'JAWR-B',workRevision:2,readObservedAt:'2026-10-29T00:00:03.000Z'}:{})};
    if(phase==='READ'){latest='JAWR-B';recordRead();}
  }};
}

/** Real reserve + existing coverage/reconcile helper, with SQL-only local ports. */
interface LocalQuery {
  where(condition: SQL | undefined): LocalQuery;
  orderBy(...columns: unknown[]): LocalQuery;
  limit(count: number): LocalQuery;
  for(kind: string): Promise<unknown[]>;
  then<T>(resolve: (rows: unknown[]) => T): Promise<T>;
}

function reservationHarness(state = 'CANCELLED') {
  const original = fixture();
  const model = {modelRef: 'aily/deepseek-v4-pro', displayName: 'DeepSeek V4 Pro', providerKind: 'BUILT_IN' as const,
    settingsRevision: 0, selectedAt: '2026-10-29T00:00:00.000Z'};
  const owner = {workItemId: original.row.workItemId, tenantId: original.row.tenantId, requestedByUserId: 'owner-test',
    requestId: 'original-intake', revision: 5, documentId: 'DOC-test', documentVersionId: 'DV-test',
    sourceArtifactId: 'ART-test', sourceFileSha256: 'a'.repeat(64), sourceByteLength: 1234,
    actionType: 'PARSE_PDF', status: 'CANDIDATE_READBACK_VERIFIED', packageId: 'PKG-test', initialAilySessionId: null,
    analysisModelJson: null, projectionJson: canonicalJson({source: {sourceArtifactId: 'ART-test', sourceFileSha256: 'a'.repeat(64)}})};
  const grant = {tenantId: owner.tenantId, workItemId: owner.workItemId, actorUserId: owner.requestedByUserId,
    requestId: owner.requestId, documentId: owner.documentId, documentVersionId: owner.documentVersionId,
    sourceArtifactId: owner.sourceArtifactId, sourceFileSha256: owner.sourceFileSha256, sourceByteLength: owner.sourceByteLength,
    status: 'WAITING', grantKind: 'MIAODA_CANONICAL_PARSE_REQUEST'};
  const oldDeadline = new Date(Date.now() + (state === 'expired' ? -60_000 : 60_000));
  const task = sealTaskEnvelope({schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1', actionAttemptId: original.row.attemptId,
    operationRef: original.row.operationRef!, taskType: 'OPENCLAW_DYNAMIC_EVALUATION', priority: 100,
    tenantId: owner.tenantId, workItemId: owner.workItemId, documentVersionId: owner.documentVersionId,
    inputRevision: owner.revision, baseRevision: owner.revision, sourceRefs: [{ref: owner.sourceArtifactId, sha256: owner.sourceFileSha256}],
    allowedConnectors: [], hostResolvedMissingInputs: [], executionModel: model, deadline: oldDeadline.toISOString(),
    idempotencyKey: `openclaw-v2:dynamic:${owner.workItemId}:${owner.documentVersionId}:${original.run.requestId}`,
    modelInput: {schemaVersion: 'wiselink.jobaid-problem-task.v3', actorUserId: owner.requestedByUserId,
      executionMode: 'AILY_AGENT_V1', modelInput: {purpose: 'INITIAL_PROBLEM_ASSESSMENT'},
      sourceBindings: [{kind: 'SOURCE_FILE', workItemId: owner.workItemId, documentVersionId: owner.documentVersionId,
        artifactRef: owner.sourceArtifactId, artifactSha256: owner.sourceFileSha256}]}});
  const live = state === 'RUNNING' || state === 'COMMITTING' || state === 'expired';
  const old = {...original.row, actionType: task.taskType, attemptNo: 1, actorUserId: owner.requestedByUserId,
    subjectKind: 'WORK_ITEM', requestOrigin: 'OPENCLAW_MCP_V1', status: state === 'expired' ? 'RUNNING' : state,
    taskEnvelopeJson: canonicalJson(task), taskInputHash: task.inputHash, executionModelJson: canonicalJson(model),
    documentVersionId: owner.documentVersionId, inputRevision: owner.revision, baseRevision: owner.revision,
    idempotencyKey: task.idempotencyKey, deadlineAt: oldDeadline, leaseExpiresAt: live ? oldDeadline : null,
    leaseOwner: live ? original.row.leaseOwner : null, leaseToken: live ? original.row.leaseToken : null,
    leaseSlot: live ? 1 : null, completedAt: live ? null : new Date(), cancelRequestedAt: null, cancelReason: null,
    commitStartedAt: null, resultEnvelopeJson: null, resultContentHash: null, projectionApplied: false,
    terminalReason: state === 'CANCELLED' ? 'CANCELLED_BY_REQUEST' : null, reviewActivityJson: '[]'} as ActionAttemptRow;
  const run: AilyExecutorRun = {...original.run, post: {...original.run.post, state: 'UNKNOWN',
    observedAt: '2026-10-29T00:01:00.000Z', errorCode: 'AILY_POST_RESULT_UNCONFIRMED'}};
  const proof = {covered: true, saved: [] as Array<{workRevisionRef: string; workRevision: number; saveRequestId: string}>, otherActive: false};
  const locks: string[] = [];
  const storedWorks:Record<string,unknown>[]=[];
  let beforeAttemptLock = () => {};
  let coverageReadCount = 0;
  let insertedRow: Record<string, unknown> | null = null;
  const insert = jest.fn(() => ({values: (value: Record<string, unknown>) => {
    insertedRow = value; return {onConflictDoNothing: () => ({returning: async () => [{attemptId: value.attemptId}]})};
  }}));
  const database = {
    transaction: jest.fn(), insert,
    select: (columns?: Record<string, unknown>) => ({from: (table: unknown) => {
      let condition: SQL | undefined;
      const values = () => {
        if (table === workItem) return [owner];
        if (table === autoWorkItemAuthorization) return [grant];
        if (table === assessmentWorkRevision) return storedWorks;
        const query = condition ? dialect.sqlToQuery(condition) : {sql: '', params: []};
        let rows: Record<string, unknown>[] = [old as unknown as Record<string, unknown>, ...(insertedRow ? [insertedRow] : [])];
        if (query.sql.includes('"idempotency_key" =')) rows = rows.filter(row => query.params.includes(row.idempotencyKey));
        if (query.sql.includes('"attempt_id" =')) rows = rows.filter(row => query.params.includes(row.attemptId));
        if (query.sql.includes('"status" in')) rows = rows.filter(row => ['QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'].includes(String(row.status)));
        return columns?.hasPersistedResult ? rows.map(row => ({...row, hasPersistedResult: row.resultEnvelopeJson !== null || row.resultContentHash !== null})) : rows;
      };
      const chain: LocalQuery = {where: (value: SQL | undefined) => {condition = value; return chain;}, orderBy: () => chain,
        limit: () => chain, for: async () => {
          locks.push(table === workItem ? 'WI' : table === autoWorkItemAuthorization ? 'GRANT' : 'ATTEMPT');
          if (table === actionAttempt) beforeAttemptLock(); return values();
        }, then: <T>(resolve: (value: unknown[]) => T) => Promise.resolve(values()).then(resolve)};
      return chain;
    }}),
    execute: jest.fn(async (statement: SQL) => {
      const query = dialect.sqlToQuery(statement);
      if (query.sql.includes('executor_run_json AS value')) return [{value: run}];
      if (query.sql.includes(' AS covered')) {coverageReadCount += 1; return [proof];}
      throw new Error('UNEXPECTED_LOCAL_SQL');
    }),
    update: () => ({set: (changes: Record<string, unknown>) => ({where: () => ({returning: async () => {
      Object.assign(old, changes); return [{attemptId: old.attemptId}];
    }})})}),
  };
  database.transaction.mockImplementation(async (operation: (value: typeof database) => Promise<unknown>) => operation(database));
  const nextRequestId = '00000000-0000-4000-8000-000000000199';
  const {inputHash: _originalHash, ...originalTask} = task;
  const newTask = sealTaskEnvelope({...originalTask, actionAttemptId: 'ATT-new', operationRef: 'AQ-new',
    idempotencyKey: `openclaw-v2:dynamic:${owner.workItemId}:${owner.documentVersionId}:${nextRequestId}`,
    modelInput: buildInitialAnalysisRequestInput({taskType: 'OPENCLAW_DYNAMIC_EVALUATION', requestId: nextRequestId,
      executionMode: 'AILY_AGENT_V1', modelRef: model.modelRef})});
  const repository = new ActionAttemptRepository(database as never);
  return {old, run, proof, locks, insert, grant, owner, storedWorks, coverageReads: () => coverageReadCount,
    onAttemptLock: (operation: () => void) => {beforeAttemptLock = operation;},
    reserve: () => repository.reserve({attemptId: newTask.actionAttemptId, operationRef: newTask.operationRef,
      workItemId: owner.workItemId, tenantId: owner.tenantId, actorUserId: owner.requestedByUserId,
      actionType: newTask.taskType, attemptNo: 2, triggerRequestId: 'TRIGGER-new', requestOrigin: 'OPENCLAW_MCP_V1',
      status: 'QUEUED', baseRevision: owner.revision, inputRevision: owner.revision, documentVersionId: owner.documentVersionId,
      taskEnvelopeJson: canonicalJson(newTask), taskInputHash: newTask.inputHash, executionModelJson: canonicalJson(model),
      idempotencyKey: newTask.idempotencyKey}, undefined, undefined,
    {model, intakeRequestId: owner.requestId, principalId: original.row.leaseOwner!})};
}


it('looks up only exact Aily Host actor metadata, never an unscoped task body',async()=>{
  const metadata={attemptId:'ATT-synthetic',operationRef:'AQ-synthetic',actorUserId:'owner-test',tenantId:'tenant-test',
    workItemId:'WI-test',taskInputHash:'a'.repeat(64),documentVersionId:'DV-test',inputRevision:4,baseRevision:4};
  let selected:unknown;let where:SQL|undefined;
  const repository=new ActionAttemptRepository({select:(columns:unknown)=>{selected=columns;return {from:()=>({where:(condition:SQL)=>{
    where=condition;return {limit:async()=>[metadata]};}})};}} as never);
  expect(await repository.readAilyTaskActorBinding({operationRef:'AQ-synthetic',tenantId:'tenant-test',workItemId:'WI-test'})).toEqual(metadata);
  expect(Object.keys(selected as object).sort()).toEqual(Object.keys(metadata).sort());
  const query=dialect.sqlToQuery(where!);expect(query.sql).toContain('operation_ref');expect(query.sql).toContain('tenant_id');
  expect(query.sql).toContain('work_item_id');expect(query.sql).toContain("'{modelInput,executionMode}'='AILY_AGENT_V1'");
  expect(query.params).toEqual(expect.arrayContaining(['AQ-synthetic','tenant-test','WI-test','OPENCLAW_MCP_V1','OPENCLAW_DYNAMIC_EVALUATION']));
  expect(selected).not.toHaveProperty('taskEnvelopeJson');expect(selected).not.toHaveProperty('resultEnvelopeJson');
});
