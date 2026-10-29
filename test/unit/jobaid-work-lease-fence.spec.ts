import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import type { ActionAttemptRow } from '../../server/modules/action-attempt/action-attempt.types';
import {
  actionAttempt,
  assessmentWorkRevision,
  identitySubjectMapping,
  workItem,
} from '../../server/database/schema';
import { JobAidWorkRepository } from '../../server/modules/canonical-host/jobaid-work.repository';
import { JOBAID_METHOD_BINDING } from '../../server/modules/canonical-host/jobaid-method-pack';
import { JOBAID_PROBLEM_WORK_SCHEMA, type JobAidProblemWorkContent } from '@shared/jobaid-problem-assessment.interface';
import { sql,type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const TOKEN_OLD = 'b1686364-7ee9-4ca1-a3aa-0b62794cb436';
const TOKEN_CURRENT = 'a8e9a6e1-d1ab-4a58-9290-3634685d684c';
const SOURCE_SHA = 'a'.repeat(64);

function currentAttempt(): ActionAttemptRow {
  const now = new Date();
  return {
    attemptId: 'ATT-LEASE', operationRef: 'AQ-LEASE', triggerRequestId: 'REQ-LEASE',
    workItemId: 'WI-LEASE', actionType: 'OPENCLAW_DYNAMIC_EVALUATION', attemptNo: 1,
    status: 'RUNNING', requestOrigin: 'OPENCLAW_MCP_V1', tenantId: 'TENANT-LEASE',
    actorUserId: 'USER-LEASE', priority: 0, inputRevision: 3, baseRevision: 3,
    documentVersionId: 'DV-LEASE', taskEnvelopeJson: '{}', taskInputHash: SOURCE_SHA,
    resultEnvelopeJson: null, resultContentHash: null, idempotencyKey: 'REQ-LEASE',
    claimCount: 2, retryCount: 0, maxAttempts: 3,
    leaseOwner: 'service:openclaw-main', leaseToken: TOKEN_CURRENT,
    leaseGeneration: 2, leaseExpiresAt: new Date('2099-01-01'),
    lastHeartbeatAt: now, nextAttemptAt: null, deadlineAt: new Date('2099-01-01'),
    cancelRequestedAt: null, cancelReason: null, terminalReason: null,
    projectionApplied: false, executorSessionKey: null, commitStartedAt: null,
    leaseSlot: 0, startedAt: now, completedAt: null, createdAt: now, updatedAt: now,
  };
}

const content: JobAidProblemWorkContent = {
  schemaVersion: JOBAID_PROBLEM_WORK_SCHEMA, headline: '隔离测试', listBrief: '隔离测试',
  understanding: '隔离测试', decisiveIssueKeys: [], overviewStatus: 'NOT_AVAILABLE',
  issues: [], roundCompletion: 'IN_PROGRESS', completionReason: '隔离测试',
  changeSummary: '隔离测试', unchangedExplanation: '', methodBinding: JOBAID_METHOD_BINDING,
  evidence: [], readSourceRefs: [], capabilities: [],
  historyReview: { required: false, priorAssessmentRefs: [], engineeringDocumentRefs: [],
    coverage: 'NOT_REQUIRED', limitation: null },
};

test('enterprise SAVE evaluates its current identity predicate in the actual INSERT after the earlier authorization read',async()=>{
  const current=currentAttempt();const search={enqueuePending:jest.fn()};const statements:string[]=[];
  const rows=(table:unknown):unknown[]=>table===identitySubjectMapping?[{id:'synthetic-mapping'}]:table===actionAttempt?[current]:
    table===assessmentWorkRevision?[]:[{workItemId:current.workItemId,documentVersionId:current.documentVersionId,revision:3,
      projectionJson:JSON.stringify({source:{sourceArtifactId:'ART-LEASE',sourceFileSha256:SOURCE_SHA}})}];
  let authorizationRead=false;
  const execute=jest.fn(async(statement:SQL)=>{
    const query=new PgDialect().sqlToQuery(statement);statements.push(query.sql);
    if(query.sql.includes('INSERT INTO')){
      expect(authorizationRead).toBe(true);
      expect(query.sql).toContain('WHERE (EXISTS');expect(query.sql).toContain('identity_subject_mapping');
      expect(query.sql).toContain('clock_timestamp()');expect(query.params).toContain('synthetic-mapping');
      // The isolated database evaluates this condition after the earlier read
      // was revoked. Zero RETURNING rows means no save or search projection.
      return [];
    }
    authorizationRead=true;return [{allowed:true}];
  });
  const database={execute,select:()=>({from:(table:unknown)=>({where:()=>({limit:async()=>rows(table),for:async()=>rows(table),
    orderBy:()=>({limit:async()=>rows(table)})})})}),insert:jest.fn()} as unknown as PostgresJsDatabase;
  const repository=new JobAidWorkRepository(database,{} as never,search as never);
  await expect(repository.save({row:current,actorUserId:current.actorUserId,
    fence:{principalId:current.leaseOwner!,leaseToken:current.leaseToken!,leaseGeneration:current.leaseGeneration},
    sourceBindings:[{kind:'SOURCE_FILE',workItemId:current.workItemId,documentVersionId:current.documentVersionId!,artifactRef:'ART-LEASE',artifactSha256:SOURCE_SHA}],
    requestId:'SAVE-enterprise',expectedWorkRevision:0,command:{expectedWorkRevision:0,work:{}},content,
    writePredicate:sql`EXISTS (SELECT 1 FROM ${identitySubjectMapping} WHERE ${identitySubjectMapping.id}=${'synthetic-mapping'}
      AND ${identitySubjectMapping.status}='ACTIVE') AND ${new Date('2099-01-01')}>clock_timestamp()`},database))
    .rejects.toThrow('AILY_DOMAIN_AUTHORIZATION_CHANGED');
  expect(statements.some(statement=>statement.includes('INSERT INTO'))).toBe(true);
  expect(search.enqueuePending).not.toHaveBeenCalled();expect(database.insert).not.toHaveBeenCalled();
});

test('enterprise original-key lookup proves owner/RLS coverage and absence in one statement',async()=>{
  const row=currentAttempt();let covered=false;
  const limit=jest.fn(async()=>[{covered,saved:null}]);
  const where=jest.fn((_condition:unknown)=>({limit}));
  const leftJoin=jest.fn((_table:unknown,_condition:SQL)=>({where}));
  const select=jest.fn((_columns:unknown)=>({from:()=>({leftJoin})}));
  const database={select,execute:jest.fn()};
  const repository=new JobAidWorkRepository(database as never,{withActorScope:async(_actor:string,operation:()=>Promise<unknown>)=>operation()} as never,{} as never);
  const input={row,actorUserId:row.actorUserId,requestId:'SAVE-original',command:{},readPredicate:sql`synthetic_current_identity`};
  await expect(repository.readAilySave(input)).rejects.toThrow('AILY_SAVE_COVERAGE_UNKNOWN');
  expect(select).toHaveBeenCalledTimes(1);expect(database.execute).not.toHaveBeenCalled();
  const projection=select.mock.calls[0][0] as unknown as {covered:SQL};
  const proof=new PgDialect().sqlToQuery(projection.covered);
  expect(proof.sql).toContain('engineering_matter_work_item_owned_by_actor');expect(proof.sql).toContain('synthetic_current_identity');
  covered=true;expect(await repository.readAilySave(input)).toBeNull();
  expect(new PgDialect().sqlToQuery(leftJoin.mock.calls[0][1]).params).toContain('SAVE-original');
});

test.each([
  ['old token', TOKEN_OLD, 2],
  ['old generation', TOKEN_CURRENT, 1],
])('a superseded JobAid %s cannot write a new work revision', async (_case, token, generation) => {
  const current = currentAttempt();
  const insert = jest.fn(() => { throw new Error('STALE_EXECUTOR_INSERTED_WORK'); });
  const rows = (table: unknown): unknown[] => {
    if (table === identitySubjectMapping) return [{ id: 'MAP-LEASE' }];
    if (table === workItem) return [{ workItemId: current.workItemId,
      documentVersionId: current.documentVersionId, revision: 3,
      projectionJson: JSON.stringify({ source: {
        sourceArtifactId: 'ART-LEASE', sourceFileSha256: SOURCE_SHA,
      } }),
    }];
    if (table === actionAttempt) return [current];
    if (table === assessmentWorkRevision) return [];
    throw new Error('UNEXPECTED_TABLE');
  };
  const database = {
    select: () => ({ from: (table: unknown) => ({ where: () => ({
      limit: async () => rows(table),
      for: async () => rows(table),
    }) }) }),
    insert,
  } as unknown as PostgresJsDatabase;
  const repository = new JobAidWorkRepository(
    database,
    { withActorTransaction: jest.fn() } as never,
    { enqueuePending: jest.fn() } as never,
  );

  await expect(repository.save({
    row: { ...current, leaseToken: token, leaseGeneration: generation },
    actorUserId: current.actorUserId,
    fence: { principalId: current.leaseOwner!, leaseToken: token,
      leaseGeneration: generation },
    sourceBindings: [{ kind: 'SOURCE_FILE', workItemId: current.workItemId,
      documentVersionId: current.documentVersionId!, artifactRef: 'ART-LEASE',
      artifactSha256: SOURCE_SHA }],
    requestId: `save-${generation}-${token === TOKEN_OLD ? 'old' : 'current'}`,
    expectedWorkRevision: 0, command: { test: true }, content,
  }, database)).rejects.toThrow('JOBAID_WORK_LEASE_FENCE_REJECTED');
  expect(insert).not.toHaveBeenCalled();
});

test('program progress ACK retries preserve the first observation and reject a changed artifact', async () => {
  const current = currentAttempt();
  const artifact: import('@shared/api.interface').UnifiedPackageArtifactDescriptor = {ref:'artifact://input-a',sha256:'b'.repeat(64),byteLength:123,mediaType:'application/json',storeRole:'UnifiedArtifactStoreCandidate' as const};
  const observedAt='2026-10-25T00:00:00Z';
  current.reviewActivityJson=JSON.stringify([{kind:'ASSESSMENT_PROGRAM_PROGRESS',phase:'MATERIALS_READY',
    checkpointRef:'program-materials',materialsArtifact:artifact,observedAt}]);
  const original=current.reviewActivityJson;
  const update=jest.fn();
  const rows=(table:unknown) => table === identitySubjectMapping ? [{id:'MAP'}] : table === actionAttempt ? [current]
    : [{workItemId:current.workItemId,documentVersionId:current.documentVersionId,revision:3,
      projectionJson:JSON.stringify({source:{sourceArtifactId:'ART-LEASE',sourceFileSha256:SOURCE_SHA}})}];
  const database={select:()=>({from:(table:unknown)=>({where:()=>({limit:async()=>rows(table),for:async()=>rows(table)})})}),update} as unknown as PostgresJsDatabase;
  const repository=new JobAidWorkRepository(database,{withActorTransaction:async (_actor:string,operation:(input:{database:PostgresJsDatabase})=>Promise<void>)=>operation({database})} as never,{} as never);
  const input={row:current,actorUserId:current.actorUserId,fence:{principalId:current.leaseOwner!,leaseToken:TOKEN_CURRENT,leaseGeneration:2},
    sourceBindings:[{kind:'SOURCE_FILE' as const,workItemId:current.workItemId,documentVersionId:current.documentVersionId!,artifactRef:'ART-LEASE',artifactSha256:SOURCE_SHA}],
    phase:'MATERIALS_READY' as const,checkpointRef:'program-materials',materialsArtifact:artifact};
  await repository.recordProgramProgress(input);
  expect(update).not.toHaveBeenCalled();expect(current.reviewActivityJson).toBe(original);
  await expect(repository.recordProgramProgress({...input,materialsArtifact:{...artifact,sha256:'c'.repeat(64)}}))
    .rejects.toThrow('JOBAID_PROGRAM_PROGRESS_CONFLICT');
  expect(update).not.toHaveBeenCalled();
});
