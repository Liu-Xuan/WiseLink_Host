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
