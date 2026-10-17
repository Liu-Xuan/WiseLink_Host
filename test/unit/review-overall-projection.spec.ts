import 'reflect-metadata';
import type {
  CanonicalWorkItemProjection,
  RequestCanonicalReviewOverallProjectionRequest,
} from '@shared/api.interface';
import type { JobAidWorkRevision } from '@shared/jobaid-problem-assessment.interface';
import { jobAidReadingResult } from '../../server/modules/canonical-host/jobaid-problem-work';
import { buildJobAidOverallProjection } from '../../server/modules/canonical-host/jobaid-overall-projection';
import { CanonicalHostReviewOverallProjectionService } from '../../server/modules/canonical-host/canonical-host-review-overall-projection.service';

const source = {
  documentVersionId: 'DV-1',
  sourceArtifactId: 'SRC-1',
  sourceFileSha256: 'a'.repeat(64),
  packageId: 'PKG-1',
  packageArtifactSha256: 'b'.repeat(64),
};
const artifact = {
  ref: 'artifact://overall',
  sha256: 'c'.repeat(64),
  byteLength: 100,
};

function item(): CanonicalWorkItemProjection {
  return {
    workItemId: 'WI-1',
    requestId: 'WI-REQUEST-1',
    revision: 8,
    source: { ...source, sourceByteLength: 300 },
    package: { packageId: source.packageId, artifact: {
      ...artifact, sha256: source.packageArtifactSha256,
    } },
    integratedAssessment: {
      status: 'BASE_RULE_CANDIDATE_READY',
      baseRules: {
        schemaVersion: 'wiselink.jobaid-problem-result.v2',
        status: 'CANDIDATE_ONLY',
        revision: 2,
        workRevisionRef: 'JAWR-old',
        workRevision: 15,
        artifact: { ...artifact, sha256: 'd'.repeat(64) },
      },
      engineerReviews: null,
      overallSynthesis: null,
      overallForAeoConfirmation: null,
    },
  } as unknown as CanonicalWorkItemProjection;
}

function saved(): JobAidWorkRevision {
  return {
    workRevisionRef: 'JAWR-new',
    workRevision: 16,
    workItemId: 'WI-1',
    previousWorkRevisionRef: 'JAWR-old',
    requestId: 'review-turn:RT-1',
    actionAttemptId: 'ATT-REVIEW-1',
    basedOnWorkItemRevision: 8,
    documentVersionId: 'DV-1',
    createdAt: '2026-10-03T00:00:00.000Z',
    content: {
      schemaVersion: 'wiselink.jobaid-problem-work.v3',
      headline: '保存的标题',
      listBrief: '保存的简述',
      understanding: '保存的完整理解',
      decisiveIssueKeys: ['ISSUE-1'],
      overviewStatus: 'CURRENT',
      roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS',
      issues: [{
        issueKey: 'ISSUE-1',
        issueRef: 'ISSUE-REF-1',
        question: '仍待核对什么？',
        body: '仅保留原有判断',
        openQuestions: [{ question: '需要序列号', affects: '适用范围',
          nextEvidence: '机队清单', reason: '资料缺失' }],
      }],
      evidence: [],
    },
  } as unknown as JobAidWorkRevision;
}

const request: RequestCanonicalReviewOverallProjectionRequest = {
  requestId: 'REQ-1',
  expectedRevision: 8,
  reviewConversationId: 'RC-1',
  reviewTurnId: 'RT-1',
  workRevisionRef: 'JAWR-new',
  expectedWorkRevision: 16,
  sourceIdentity: source,
};

describe('deterministic saved Review Overall', () => {
  it.each(['NOT_AVAILABLE', 'STALE'] as const)(
    'rejects %s saved overview instead of projecting it as current',
    (overviewStatus) => {
      const revision: JobAidWorkRevision = saved();
      revision.content.overviewStatus = overviewStatus;
      const before: string = JSON.stringify(revision);
      expect(() => buildJobAidOverallProjection({
        workItem: item(),
        revision,
        artifact: {
          ...artifact,
          storeRole: 'UnifiedArtifactStoreCandidate',
          mediaType: 'application/json',
        },
        actionAttemptId: 'ATT-OVERALL',
        sourceResultId: 'openclaw-overall://REQ-1',
        applicabilityStatus: 'UNKNOWN',
      })).toThrow(
        `JOBAID_OVERALL_EXACT_WORK_REQUIRED:${revision.workRevisionRef}:OVERVIEW_${overviewStatus}`,
      );
      expect(JSON.stringify(revision)).toBe(before);
    },
  );

  it('projects an exact current saved overview with ordinary model provenance', () => {
    const revision: JobAidWorkRevision = saved();
    const projection = buildJobAidOverallProjection({
      workItem: item(),
      revision,
      artifact: {
        ...artifact,
        storeRole: 'UnifiedArtifactStoreCandidate',
        mediaType: 'application/json',
      },
      actionAttemptId: 'ATT-OVERALL',
      sourceResultId: 'openclaw-overall://REQ-1',
      applicabilityStatus: 'UNKNOWN',
      modelProvenance: {
        modelVersion: 'constructed-model',
        promptVersion: 'constructed-prompt',
        skillVersion: 'constructed-skill',
        toolVersions: { protocol: '2' },
      },
    });
    expect(projection).toMatchObject({
      status: 'CANDIDATE_ONLY',
      revision: 1,
      actionAttemptId: 'ATT-OVERALL',
      basedOnJobAidWorkRevisionRef: revision.workRevisionRef,
      overallCandidate: revision.content.understanding,
      staleReason: null,
      modelVersion: 'constructed-model',
    });
    expect(projection.readingResult).toEqual(jobAidReadingResult(revision));
    expect(projection).not.toHaveProperty('executionKind');
    expect(projection).not.toHaveProperty('sourceReview');
  });

  it('builds the candidate from saved work without model provenance or new prose', () => {
    const workItem = item();
    const revision = saved();
    const projection = buildJobAidOverallProjection({
      workItem,
      revision,
      artifact: artifact as never,
      actionAttemptId: 'ATT-NEW',
      sourceResultId: 'review-overall://REQ-1',
      applicabilityStatus: 'UNKNOWN',
      deterministicSource: {
        reviewConversationId: 'RC-1',
        reviewTurnId: 'RT-1',
      },
    });
    expect(projection).toMatchObject({
      executionKind: 'DETERMINISTIC_PROJECTION',
      modelRequests: 0,
      actionAttemptId: 'ATT-NEW',
      sourceReview: {
        actionAttemptId: 'ATT-REVIEW-1',
        workRevisionRef: 'JAWR-new',
      },
      overallCandidate: revision.content.understanding,
      affectedIssueKeys: revision.content.decisiveIssueKeys,
      missingInputs: ['需要序列号'],
      findingCount: 1,
      unresolvedCount: 1,
      authorityLevel: 'candidate_only',
      staleReason: null,
    });
    expect(projection.readingResult).toEqual(jobAidReadingResult(revision));
    expect(projection).not.toHaveProperty('modelVersion');
    expect(projection).not.toHaveProperty('promptVersion');
    expect(projection).not.toHaveProperty('skillVersion');
  });

  it('commits once through the locked WorkItem path and replays the same request', async () => {
    const workItem = item();
    const revision = saved();
    const session = { actor: {
      tenantId: 'TENANT-1', canonicalSubject: { id: 'USER-1' },
    } };
    const grant = {
      allowed: true,
      action: 'REQUEST_OVERALL_REGENERATION',
      workItemId: 'WI-1',
      tenantId: 'TENANT-1',
      actorUserId: 'USER-1',
      workItemRevision: 8,
      requestId: workItem.requestId,
      documentVersionId: 'DV-1',
    };
    let stored: { input: RequestCanonicalReviewOverallProjectionRequest;
      receipt: Awaited<ReturnType<CanonicalHostReviewOverallProjectionService['project']>> } | null = null;
    const database = {
      select: () => ({ from: () => ({ where: () => ({
        limit: async () => [],
      }) }) }),
    };
    const workItems = {
      withLockedReviewOverallProjection: jest.fn(async (_input, operation) => {
        const result = await operation(database, workItem);
        return { saved: { ...workItem, ...result.next, revision: 9 },
          value: result.value };
      }),
    };
    const exact = jest.fn().mockResolvedValue(revision);
    const insert = jest.fn(async ({ request: committedInput, receipt }) => {
      stored = { input: committedInput, receipt };
    });
    const executions = {
      read: jest.fn(async () => stored),
      attemptId: () => 'ATT-DETERMINISTIC-1',
      insert,
    };
    const artifacts = {
      persistAndReadback: jest.fn()
        .mockResolvedValueOnce({ artifact })
        .mockResolvedValueOnce({ artifact: { ...artifact, ref: 'artifact://base' } }),
    };
    const service = new CanonicalHostReviewOverallProjectionService(
      { resolve: jest.fn().mockResolvedValue(session) } as never,
      { freshRead: jest.fn().mockResolvedValue(grant) } as never,
      { getTenantScopedByWorkItemId: jest.fn().mockResolvedValue(workItem) } as never,
      workItems as never,
      { hasActiveReviewOverallConflict: jest.fn().mockResolvedValue(false) } as never,
      {
        exactSavedReviewWorkForProjection: exact,
        assertProjectionOriginalCurrent: jest.fn().mockResolvedValue(undefined),
      } as never,
      executions as never,
      artifacts as never,
    );

    const first = await service.project('WI-1', request, {} as never);
    expect(first).toMatchObject({
      executionKind: 'DETERMINISTIC_PROJECTION',
      modelRequests: 0,
      executionAttemptId: 'ATT-DETERMINISTIC-1',
      workItemRevision: 9,
      overallRevision: 1,
      replayed: false,
    });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0].checks).toEqual({
      sourceReceiptMatched: true,
      latestWorkMatched: true,
      workItemRevisionMatched: true,
      sourceBindingsReauthorized: true,
      documentVersionAndParseMatched: true,
      fullV3ReadingConstructed: true,
      overviewCurrent: true,
      completionNotInProgress: true,
    });
    expect(workItems.withLockedReviewOverallProjection).toHaveBeenCalledTimes(1);
    const second = await service.project('WI-1', request, {} as never);
    expect(second.replayed).toBe(true);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(artifacts.persistAndReadback).toHaveBeenCalledTimes(2);
    await expect(service.project('WI-1', {
      ...request, reviewTurnId: 'RT-other',
    }, {} as never)).rejects.toThrow('REVIEW_OVERALL_IDEMPOTENCY_CONFLICT');
  });
});
