import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { actionAttempt, assessmentWorkRevision, identitySubjectMapping, workItem } from '@server/database/schema';
import { autoWorkItemAuthorization } from '@server/database/auto-work-item-authorization.schema';
import type { ActionAttemptRow } from '@server/modules/action-attempt/action-attempt.types';
import { canonicalJson } from '@server/modules/action-attempt/action-attempt-envelope';
import { CanonicalJobAidProblemService } from '@server/modules/canonical-host/canonical-jobaid-problem.service';
import { JobAidWorkRepository } from '@server/modules/canonical-host/jobaid-work.repository';
import type { JobAidProblemTaskInput } from '@server/modules/canonical-host/jobaid-problem-task';
import { JOBAID_METHOD_BINDING } from '@server/modules/canonical-host/jobaid-method-pack';
import { JOBAID_PROBLEM_WORK_SCHEMA, type JobAidProblemWorkContent } from '@shared/jobaid-problem-assessment.interface';

const OWNER = 'owner-unchanged', TENANT = 'tenant-unchanged', WI = 'WI-UNCHANGED', DV = 'DV-UNCHANGED';
const SHA = 'a'.repeat(64), TOKEN = 'bdde8ea4-b802-4b1c-a19e-ae79d63af404';
const content: JobAidProblemWorkContent = {
  schemaVersion: JOBAID_PROBLEM_WORK_SCHEMA, headline: '原有条件', listBrief: '保留未知',
  understanding: '配置仍未知，不能据本轮比较自动确认执行。', decisiveIssueKeys: [], overviewStatus: 'CURRENT',
  issues: [], roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS', completionReason: '保留未决条件',
  changeSummary: '原始已存工作', unchangedExplanation: '本轮比较不替代工程确认',
  methodBinding: JOBAID_METHOD_BINDING, evidence: [], readSourceRefs: [], capabilities: [],
  historyReview: { required: false, priorAssessmentRefs: [], engineeringDocumentRefs: [],
    coverage: 'NOT_REQUIRED', limitation: null },
};
function reviewRow(): ActionAttemptRow {
  const now = new Date();
  return {
    attemptId: 'ATT-REVIEW', operationRef: 'AQ-REVIEW', triggerRequestId: 'REQ-REVIEW',
    workItemId: WI, actionType: 'OPENCLAW_INTERACTIVE_REVIEW', attemptNo: 1,
    status: 'COMMITTING', requestOrigin: 'OPENCLAW_MCP_V1', tenantId: TENANT,
    actorUserId: OWNER, priority: 0, inputRevision: 7, baseRevision: 7,
    documentVersionId: DV, taskEnvelopeJson: '{}', taskInputHash: SHA,
    resultEnvelopeJson: '{}', resultContentHash: SHA, idempotencyKey: 'review-key',
    claimCount: 1, retryCount: 0, maxAttempts: 3, leaseOwner: 'service:review',
    leaseToken: TOKEN, leaseGeneration: 2, leaseExpiresAt: new Date('2099-01-01'),
    lastHeartbeatAt: now, nextAttemptAt: null, deadlineAt: new Date('2099-01-01'),
    cancelRequestedAt: null, cancelReason: null, terminalReason: null,
    projectionApplied: false, executorSessionKey: null, commitStartedAt: now,
    leaseSlot: 0, startedAt: now, completedAt: null, createdAt: now, updatedAt: now,
  };
}

/** Pure repository ports: no PG, runtime flags, ALS or real role/RLS claims. */
function harness() {
  const row = reviewRow();
  const source = { tenantId: TENANT, workItemId: WI, requestedByUserId: OWNER,
    documentVersionId: DV, documentId: 'DOC-UNCHANGED', requestId: 'AUTO-UNCHANGED',
    sourceArtifactId: 'ART-UNCHANGED', sourceFileSha256: SHA, sourceByteLength: 1234, revision: 7,
    projectionJson: JSON.stringify({ source: { sourceArtifactId: 'ART-UNCHANGED', sourceFileSha256: SHA },
      integratedAssessment: { overallSynthesis: { status: 'CANDIDATE_ONLY', basedOnJobAidWorkRevisionRef: 'JAWR-OLD' } } }),
  };
  const stored = { assessmentWorkRevisionId: 'JAWR-OLD', tenantId: TENANT, workItemId: WI,
    createdByUserId: OWNER, workRevision: 4, previousWorkRevisionId: 'JAWR-OLDER',
    requestId: 'old-save', actionAttemptId: 'ATT-ORIGINAL', basedOnWorkItemRevision: 2,
    documentVersionId: DV, createdAt: new Date('2026-10-01T00:00:00Z'),
    commandJson: canonicalJson({ original: true }), contentJson: JSON.stringify(content),
  };
  const state = { source, current: structuredClone(stored), attempt: structuredClone(row),
    mappingActive: true, serviceMappingActive: true, scopeDenied: false,
    grant: { tenantId: TENANT, workItemId: WI, documentId: source.documentId, documentVersionId: DV,
      actorUserId: OWNER, requestId: source.requestId, sourceArtifactId: source.sourceArtifactId,
      sourceFileSha256: SHA, sourceByteLength: 1234, status: 'LEASED',
      grantKind: 'MIAODA_CANONICAL_PARSE_REQUEST', leaseGeneration: 3,
      leaseOwner: row.leaseOwner, leaseExpiresAt: new Date('2099-01-01') },
    onSourceLock: () => {},
  };
  const events: string[] = [], queries: Array<{ sql: string; params: unknown[] }> = [];
  const dialect = new PgDialect();
  const insert = jest.fn(() => { throw new Error('UNCHANGED_INSERT_FORBIDDEN'); });
  const update = jest.fn(() => { throw new Error('UNCHANGED_UPDATE_FORBIDDEN'); });
  const ambientSelect = jest.fn(() => { throw new Error('AMBIENT_POOL_USED'); });
  const nestedTransaction = jest.fn(() => { throw new Error('REPLACEMENT_TRANSACTION_USED'); });
  function selected(table: unknown, query: { sql: string; params: unknown[] }): unknown[] {
    const has = (value: unknown) => query.params.includes(value);
    if (table === identitySubjectMapping) return state.mappingActive ? [{ id: 'MAP-UNIT-PORT' }] : [];
    if (table === workItem) return has(state.source.tenantId) && has(state.source.workItemId) &&
      (!query.sql.includes('"requested_by_user_id"') || has(state.source.requestedByUserId)) ? [state.source] : [];
    if (table === autoWorkItemAuthorization) return has(state.grant.tenantId) && has(state.grant.workItemId) ? [state.grant] : [];
    if (table === actionAttempt) return has(state.attempt.attemptId) && has(state.attempt.tenantId) &&
      has(state.attempt.workItemId) ? [state.attempt] : [];
    if (table !== assessmentWorkRevision) throw new Error('UNEXPECTED_UNIT_TABLE');
    if (query.sql.includes('"request_id"')) return has(stored.requestId) ? [stored] : [];
    const current = state.current;
    if (!has(current.tenantId) || !has(current.workItemId)) return [];
    if (query.sql.includes('"assessment_work_revision_id"') && !has(current.assessmentWorkRevisionId)) return [];
    if (query.sql.includes('"created_by_user_id"') && !has(current.createdByUserId)) return [];
    return [current];
  }
  const database = {
    select: () => ({ from: (table: unknown) => ({ where: (predicate: SQL) => {
      const query = dialect.sqlToQuery(predicate); queries.push(query);
      const read = async () => selected(table, query);
      const lock = async () => {
        if (table === workItem) { events.push('source-lock'); state.onSourceLock(); }
        if (table === actionAttempt) events.push('attempt-lock');
        if (table === autoWorkItemAuthorization) events.push('grant-lock');
        return read();
      };
      return { limit: () => ({ then: (resolve: (value: unknown[]) => void) => read().then(resolve), for: lock }),
        orderBy: () => ({ limit: async () => {
        events.push('latest'); return read();
      } }), for: lock };
    } }) }), insert, update,
  } as unknown as PostgresJsDatabase;
  const withActorScope = jest.fn(async (actor: string, operation: () => Promise<unknown>, executor: PostgresJsDatabase) => {
    expect(actor).toBe(OWNER); expect(executor).toBe(database);
    if (state.scopeDenied) throw new Error('UNIT_ROLE_PORT_REJECTED');
    events.push('actor-scope'); return operation();
  });
  const search = { enqueuePending: jest.fn() }, wiki = { record: jest.fn() };
  const repository = new JobAidWorkRepository({ select: ambientSelect } as unknown as PostgresJsDatabase,
    { withActorScope, withActorTransaction: nestedTransaction } as never, search as never, wiki as never);
  const conversations = { hasActiveOfficialActorMapping: jest.fn(async () => state.serviceMappingActive) };
  const service = new CanonicalJobAidProblemService(undefined as never, undefined as never, undefined as never,
    undefined as never, undefined as never, undefined as never, undefined as never,
    conversations as never, undefined as never, repository);
  const previousWork = { workRevisionRef: stored.assessmentWorkRevisionId, workItemId: WI, workRevision: 4,
    previousWorkRevisionRef: stored.previousWorkRevisionId, requestId: stored.requestId,
    actionAttemptId: stored.actionAttemptId, basedOnWorkItemRevision: 2, documentVersionId: DV,
    createdAt: stored.createdAt.toISOString(), content: structuredClone(content) };
  const input = { row, task: { actorUserId: OWNER, sourceCatalog: [], previousWork,
    modelInput: { purpose: 'PROBLEM_REVIEW', expectedWorkRevision: 4 },
    sourceBindings: [{ kind: 'SOURCE_FILE', workItemId: WI, documentVersionId: DV,
      artifactRef: 'ART-UNCHANGED', artifactSha256: SHA }],
  } as unknown as JobAidProblemTaskInput,
  fence: { principalId: row.leaseOwner!, leaseToken: TOKEN, leaseGeneration: 2 } };
  const assertNoWrites = () => {
    expect(insert).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
    expect(search.enqueuePending).not.toHaveBeenCalled(); expect(wiki.record).not.toHaveBeenCalled();
    expect(ambientSelect).not.toHaveBeenCalled(); expect(nestedTransaction).not.toHaveBeenCalled();
  };
  return { service, repository, database, input, state, stored, events, queries, withActorScope, conversations, assertNoWrites };
}

test.each(['RUNNING', 'COMMITTING'] as const)('unchanged %s checks the held transaction and returns stored work without mutation', async status => {
  const h = harness(); h.state.attempt.status = status;
  const before = structuredClone({ source: h.state.source, work: h.state.current, task: h.input.task });
  const current = await h.service.assertReviewWorkUnchanged(h.input, h.database);
  expect(current.workRevisionRef).toBe('JAWR-OLD'); expect(current.workRevision).toBe(4);
  expect(current.actionAttemptId).toBe('ATT-ORIGINAL');
  expect(current.basedOnWorkItemRevision).toBe(2); // Overall may have advanced WI, not this immutable work.
  expect(current).not.toBe(h.input.task.previousWork);
  expect(JSON.stringify(current.content)).toBe(h.stored.contentJson);
  expect({ source: h.state.source, work: h.state.current, task: h.input.task }).toEqual(before);
  expect(h.events.indexOf('source-lock')).toBeLessThan(h.events.indexOf('attempt-lock'));
  expect(h.events.indexOf('attempt-lock')).toBeLessThan(h.events.indexOf('latest'));
  expect(h.conversations.hasActiveOfficialActorMapping).toHaveBeenCalledWith({ tenantId: TENANT, actorId: OWNER }, h.database);
  expect(h.queries.some(query => query.sql.includes('"created_by_user_id"') &&
    query.params.includes(OWNER) && query.params.includes('JAWR-OLD'))).toBe(true);
  h.assertNoWrites();
});

test.each([
  ['service actor revocation', 'JOBAID_ACTOR_AUTHORIZATION_CHANGED'],
  ['repository actor revocation', 'JOBAID_ACTOR_AUTHORIZATION_CHANGED'],
  ['source owner', 'JOBAID_SOURCE_AUTHORIZATION_CHANGED'],
  ['source tenant', 'JOBAID_SOURCE_AUTHORIZATION_CHANGED'],
  ['source document', 'JOBAID_SOURCE_AUTHORIZATION_CHANGED'],
  ['source hash', 'JOBAID_SOURCE_VERSION_CHANGED'],
  ['source artifact', 'JOBAID_SOURCE_VERSION_CHANGED'],
  ['current input', 'JOBAID_SAVE_WORK_ITEM_CHANGED'],
  ['lost role', 'UNIT_ROLE_PORT_REJECTED'],
])('unchanged rejects %s without writes', async (reason, code) => {
  const h = harness();
  if (reason === 'service actor revocation') h.state.serviceMappingActive = false;
  if (reason === 'repository actor revocation') h.state.mappingActive = false;
  if (reason === 'source owner') h.state.source.requestedByUserId = 'foreign-owner';
  if (reason === 'source tenant') h.state.source.tenantId = 'foreign-tenant';
  if (reason === 'source document') h.state.source.documentVersionId = 'DV-OTHER';
  if (reason === 'source hash' || reason === 'source artifact') h.state.source.projectionJson = JSON.stringify({
    source: { sourceArtifactId: reason === 'source artifact' ? 'OTHER' : 'ART-UNCHANGED',
      sourceFileSha256: reason === 'source hash' ? 'b'.repeat(64) : SHA },
  });
  if (reason === 'current input') h.state.source.revision++;
  if (reason === 'lost role') h.state.scopeDenied = true;
  await expect(h.service.assertReviewWorkUnchanged(h.input, h.database)).rejects.toThrow(code);
  h.assertNoWrites();
});

test.each(['token', 'generation', 'lease owner', 'lease expiry', 'deadline', 'cancel', 'terminal',
  'attempt hash', 'attempt actor', 'attempt type', 'attempt input', 'attempt document', 'attempt tenant'])
('unchanged rejects a changed %s without writes', async reason => {
  const h = harness(), attempt = h.state.attempt;
  if (reason === 'token') attempt.leaseToken = 'other';
  if (reason === 'generation') attempt.leaseGeneration++;
  if (reason === 'lease owner') attempt.leaseOwner = 'other';
  if (reason === 'lease expiry') attempt.leaseExpiresAt = new Date(0);
  if (reason === 'deadline') attempt.deadlineAt = new Date(0);
  if (reason === 'cancel') attempt.cancelRequestedAt = new Date();
  if (reason === 'terminal') attempt.status = 'SUCCEEDED';
  if (reason === 'attempt hash') attempt.taskInputHash = 'b'.repeat(64);
  if (reason === 'attempt actor') attempt.actorUserId = 'foreign';
  if (reason === 'attempt type') attempt.actionType = 'OPENCLAW_DYNAMIC_EVALUATION';
  if (reason === 'attempt input') attempt.inputRevision++;
  if (reason === 'attempt document') attempt.documentVersionId = 'DV-OTHER';
  if (reason === 'attempt tenant') attempt.tenantId = 'foreign';
  const code = ['attempt hash', 'attempt document', 'attempt tenant'].includes(reason) ? 'JOBAID_SAVE_ATTEMPT_CHANGED'
    : reason.startsWith('attempt') ? 'JOBAID_REVIEW_SAVE_BINDING_INVALID' : 'JOBAID_WORK_LEASE_FENCE_REJECTED';
  await expect(h.service.assertReviewWorkUnchanged(h.input, h.database)).rejects.toThrow(code);
  h.assertNoWrites();
});

test.each(['newer ref', 'newer revision', 'different work owner', 'different work document', 'frozen input', 'missing baseline'])
('unchanged rejects %s instead of returning a frozen reference', async reason => {
  const h = harness();
  if (reason === 'newer ref') h.state.current.assessmentWorkRevisionId = 'JAWR-NEWER';
  if (reason === 'newer revision') h.state.current.workRevision++;
  if (reason === 'different work owner') h.state.current.createdByUserId = 'foreign';
  if (reason === 'different work document') h.state.current.documentVersionId = 'DV-OTHER';
  if (reason === 'frozen input') h.input.task.previousWork!.basedOnWorkItemRevision++;
  if (reason === 'missing baseline') h.input.task.previousWork = null;
  const code = reason.startsWith('newer') ? 'JOBAID_WORK_REVISION_CONFLICT' : 'JOBAID_REVIEW_UNCHANGED_BASIS_INVALID';
  await expect(h.service.assertReviewWorkUnchanged(h.input, h.database)).rejects.toThrow(code);
  h.assertNoWrites();
});

test('a newer work appearing after service source checks is still rejected under the source lock', async () => {
  const h = harness();
  h.state.onSourceLock = () => { h.state.current = { ...h.state.current, assessmentWorkRevisionId: 'JAWR-LATE', workRevision: 5 }; };
  await expect(h.service.assertReviewWorkUnchanged(h.input, h.database)).rejects.toThrow('JOBAID_WORK_REVISION_CONFLICT');
  h.assertNoWrites();
});

test.each(['valid grant', 'expired grant', 'missing binding'])(
  'unchanged preserves the existing automatic grant fence: %s', async reason => {
    const h = harness();
    Object.assign(h.input.fence, { automaticLeaseRequired: true });
    if (reason !== 'missing binding') {
      const taskEnvelopeJson = JSON.stringify({ modelInput: { automaticWorkItemLease: {
        requestId: h.state.grant.requestId, leaseGeneration: h.state.grant.leaseGeneration,
      } } });
      h.input.row.taskEnvelopeJson = taskEnvelopeJson; h.state.attempt.taskEnvelopeJson = taskEnvelopeJson;
    }
    if (reason === 'expired grant') h.state.grant.leaseExpiresAt = new Date(0);
    if (reason === 'valid grant') {
      const current = await h.service.assertReviewWorkUnchanged(h.input, h.database);
      expect(current.workRevisionRef).toBe('JAWR-OLD');
      expect(h.events.indexOf('source-lock')).toBeLessThan(h.events.indexOf('grant-lock'));
      expect(h.events.indexOf('grant-lock')).toBeLessThan(h.events.indexOf('attempt-lock'));
    } else {
      await expect(h.service.assertReviewWorkUnchanged(h.input, h.database)).rejects.toThrow(
        reason === 'missing binding' ? 'AUTO_WORK_ITEM_TASK_LEASE_BINDING_REQUIRED' : 'AUTO_WORK_ITEM_ATTEMPT_LEASE_REJECTED');
      expect(h.events).not.toContain('attempt-lock');
    }
    h.assertNoWrites();
  });

test('existing SAVE key replay precedes later input, latest-work and lease changes', async () => {
  const h = harness();
  h.state.source.revision++;
  h.state.current = { ...h.state.current, assessmentWorkRevisionId: 'JAWR-LATER', workRevision: 5 };
  h.state.attempt.leaseExpiresAt = new Date(0);
  const row = { ...h.input.row, attemptId: h.stored.actionAttemptId,
    baseRevision: h.stored.basedOnWorkItemRevision, inputRevision: h.stored.basedOnWorkItemRevision };
  Object.assign(h.state.attempt, { attemptId: row.attemptId, baseRevision: row.baseRevision, inputRevision: row.inputRevision });
  const result = await h.repository.save({ row, actorUserId: OWNER, fence: h.input.fence,
    sourceBindings: h.input.task.sourceBindings, requestId: h.stored.requestId,
    expectedWorkRevision: 3, command: { original: true }, content,
  }, h.database);
  expect(result.replayed).toBe(true);
  expect(result.revision.workRevisionRef).toBe(h.stored.assessmentWorkRevisionId);
  expect(result.revision.content).toEqual(content);
  expect(h.events).not.toContain('latest');
  h.assertNoWrites();
});
