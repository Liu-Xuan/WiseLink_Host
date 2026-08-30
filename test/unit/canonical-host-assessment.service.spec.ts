import type { CanonicalWorkItemProjection } from '@shared/api.interface';

jest.mock(
  '../../server/modules/assessment-workbench/assessment-host-consumer.public-api',
  () => ({ AssessmentHostConsumerService: class {} }),
);
jest.mock(
  '../../server/modules/assessment-workbench/job-aid-runtime/criterionSet.js',
  () => ({ buildJobAidCriterionSetVersion: jest.fn() }),
);
jest.mock(
  '../../server/modules/document-management/src/hosted/phase5BoeingSbHandoff.js',
  () => ({
    PHASE5_737_34_3830_HANDOFF: {
      classificationEnvelope: {
        status: 'CONFIRMED',
        normalizedFamily: 'SB',
      },
    },
  }),
);

import { CanonicalHostAssessmentService } from '../../server/modules/canonical-host/canonical-host-assessment.service';
import type { CanonicalHostActor } from '../../server/modules/canonical-host/canonical-host.types';
import type { EngineerReviewState } from '@shared/assessment-host.interface';

const ACTOR: CanonicalHostActor = {
  userId: 'engineer-1001',
  tenantId: 'tenant-2001',
  appId: 'app_17bzc551rsg',
  roles: ['authenticated'],
  env: 'development',
};

function workItem(
  assessment: CanonicalWorkItemProjection['assessment'],
): CanonicalWorkItemProjection {
  return {
    workItemId: 'WI-SB-1001',
    requestId: 'REQ-SB-1001',
    revision: 5,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    classification: {
      status: 'CONFIRMED',
      normalizedFamily: 'SB',
    },
    source: {
      documentVersionId: 'document-version-1001',
    },
    package: {
      packageId: 'urn:techpub:package:v1:sha256:test',
    },
    assessment,
  } as unknown as CanonicalWorkItemProjection;
}

function deniedService(
  projection: CanonicalWorkItemProjection,
  decision: Record<string, unknown> = {
    action: 'WRONG_ACTION',
    allowed: false,
  },
) {
  const authorization = {
    authorize: jest.fn().mockResolvedValue(decision),
  };
  const permissionSnapshots = { freshRead: jest.fn() };
  const getByWorkItemId = jest.fn().mockResolvedValue(projection);
  const registrar = {
    getByWorkItemId,
    getTenantScopedByWorkItemId: getByWorkItemId,
  };
  const service = new CanonicalHostAssessmentService(
    registrar as never,
    authorization as never,
    permissionSnapshots as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { authorization, permissionSnapshots, registrar, service };
}

function authorizedService(
  projection: CanonicalWorkItemProjection,
  options: {
    action?: 'EVALUATE_JOB_AID' | 'RESYNTHESIZE_ASSESSMENT';
    permissionSnapshotVersion?: string;
    assessmentArtifact?: unknown;
  } = {},
) {
  const permissionSnapshotVersion =
    options.permissionSnapshotVersion ?? 'permission-snapshot:test';
  const authorization = {
    authorize: jest.fn().mockImplementation(async (input) => ({
      action: options.action ?? input.action,
      allowed: true,
      actorFingerprint: 'sha256:actor',
      decisionId: 'decision-test',
      decisionHash: 'sha256:decision',
      permissionSnapshotVersion,
    })),
  };
  const permissionSnapshots = {
    freshRead: jest.fn().mockResolvedValue({ permissionSnapshotVersion }),
  };
  const getByWorkItemId = jest.fn().mockResolvedValue(projection);
  const registrar = {
    getByWorkItemId,
    getTenantScopedByWorkItemId: getByWorkItemId,
  };
  const artifactStore = {
    readActualBytes: jest
      .fn()
      .mockResolvedValue(
        new TextEncoder().encode(JSON.stringify(options.assessmentArtifact)),
      ),
  };
  const repository = {
    reserveAssessmentAction: jest.fn(),
  };
  const service = new CanonicalHostAssessmentService(
    registrar as never,
    authorization as never,
    permissionSnapshots as never,
    artifactStore as never,
    {} as never,
    repository as never,
    {} as never,
    {} as never,
  );
  return {
    artifactStore,
    authorization,
    permissionSnapshots,
    registrar,
    repository,
    service,
  };
}

function existingAssessment() {
  return {
    status: 'CANDIDATE_ONLY' as const,
    artifact: {
      storeRole: 'UnifiedArtifactStoreCandidate' as const,
      ref: 'artifact://assessment/test',
      sha256: 'a'.repeat(64),
      byteLength: 2,
      mediaType: 'application/json' as const,
    },
  } as CanonicalWorkItemProjection['assessment'];
}

function engineerReview(
  decision:
    | 'confirmed_pass'
    | 'confirmed_fail'
    | 'returned_for_rework'
    | 'deferred',
  status: 'ENGINEER_CONFIRMED' | 'NEEDS_REVIEW',
): EngineerReviewState {
  return {
    baseRecordId: 'ENGINEER-REVIEW:WI-SB-1001:JAC-001',
    decision,
    comment: '需要补充受控证据。',
    reviewingEngineerUserIds: [ACTOR.userId],
    status,
    updatedAt: '2026-08-15T00:00:00.000Z',
  };
}

describe('CanonicalHostAssessmentService authorization ordering', () => {
  it('does not return an existing assessment before authorizing the actor', async () => {
    const target = deniedService(
      workItem({
        status: 'CANDIDATE_ONLY',
      } as CanonicalWorkItemProjection['assessment']),
    );

    await expect(
      target.service.evaluateCandidate(
        {
          workItemId: 'WI-SB-1001',
          assessmentAsOf: '2026-08-15T00:00:00.000Z',
          generatedAt: '2026-08-15T00:00:00.000Z',
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
    expect(target.authorization.authorize).toHaveBeenCalledTimes(1);
    expect(target.permissionSnapshots.freshRead).not.toHaveBeenCalled();
    expect(target.registrar.getTenantScopedByWorkItemId).not.toHaveBeenCalled();
  });

  it('does not return an already resynthesized assessment before authorization', async () => {
    const target = deniedService(
      workItem({
        status: 'CANDIDATE_ONLY_RESYNTHESIZED',
        resynthesisAttemptId: 'ATT-OLD',
      } as CanonicalWorkItemProjection['assessment']),
    );

    await expect(
      target.service.resynthesizeAfterEngineerChange(
        {
          workItemId: 'WI-SB-1001',
          expectedRevision: 5,
          criterionId: 'JAC-001',
          review: {
            baseRecordId: 'ENGINEER-REVIEW:WI-SB-1001:JAC-001',
            decision: 'deferred',
            comment: '需要补证',
            reviewingEngineerUserIds: ['engineer-1001'],
            status: 'NEEDS_REVIEW',
            updatedAt: '2026-08-15T00:00:00.000Z',
          },
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
    expect(target.authorization.authorize).toHaveBeenCalledTimes(1);
    expect(target.permissionSnapshots.freshRead).not.toHaveBeenCalled();
    expect(target.registrar.getTenantScopedByWorkItemId).not.toHaveBeenCalled();
  });

  it('rejects a denied decision even when the action string matches', async () => {
    const target = deniedService(workItem(existingAssessment()), {
      action: 'EVALUATE_JOB_AID',
      allowed: false,
    });

    await expect(
      target.service.evaluateCandidate(
        {
          workItemId: 'WI-SB-1001',
          assessmentAsOf: '2026-08-15T00:00:00.000Z',
          generatedAt: '2026-08-15T00:00:00.000Z',
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
    expect(target.permissionSnapshots.freshRead).not.toHaveBeenCalled();
    expect(target.registrar.getTenantScopedByWorkItemId).not.toHaveBeenCalled();
  });

  it('rejects an allowed decision for a different action', async () => {
    const target = deniedService(workItem(existingAssessment()), {
      action: 'RESYNTHESIZE_ASSESSMENT',
      allowed: true,
    });

    await expect(
      target.service.evaluateCandidate(
        {
          workItemId: 'WI-SB-1001',
          assessmentAsOf: '2026-08-15T00:00:00.000Z',
          generatedAt: '2026-08-15T00:00:00.000Z',
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
    expect(target.permissionSnapshots.freshRead).not.toHaveBeenCalled();
    expect(target.registrar.getTenantScopedByWorkItemId).not.toHaveBeenCalled();
  });

  it('authorizes and fresh-reads permission before reusing an existing result', async () => {
    const projection = workItem(existingAssessment());
    const target = authorizedService(projection);

    await expect(
      target.service.evaluateCandidate(
        {
          workItemId: 'WI-SB-1001',
          assessmentAsOf: '2026-08-15T00:00:00.000Z',
          generatedAt: '2026-08-15T00:00:00.000Z',
        },
        ACTOR,
      ),
    ).resolves.toBe(projection);
    expect(target.authorization.authorize).toHaveBeenCalledTimes(1);
    expect(target.permissionSnapshots.freshRead).toHaveBeenCalledTimes(1);
    expect(target.repository.reserveAssessmentAction).not.toHaveBeenCalled();
  });

  it('reauthorizes the fresh result returned after an evaluate attempt collision', async () => {
    const initial = workItem(null);
    const completed = workItem(existingAssessment());
    const target = authorizedService(initial);
    target.registrar.getByWorkItemId
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(completed);
    target.repository.reserveAssessmentAction.mockResolvedValue({
      created: false,
    });

    await expect(
      target.service.evaluateCandidate(
        {
          workItemId: 'WI-SB-1001',
          assessmentAsOf: '2026-08-15T00:00:00.000Z',
          generatedAt: '2026-08-15T00:00:00.000Z',
        },
        ACTOR,
      ),
    ).resolves.toBe(completed);
    expect(target.authorization.authorize).toHaveBeenCalledTimes(2);
    expect(target.permissionSnapshots.freshRead).toHaveBeenCalledTimes(2);
  });

  it('reauthorizes the fresh result returned after a resynthesis attempt collision', async () => {
    const initial = workItem(existingAssessment());
    const completed = {
      ...initial,
      revision: 6,
    } as CanonicalWorkItemProjection;
    const target = authorizedService(initial, {
      assessmentArtifact: {
        evaluation: {
          snapshot: {
            items: [{ criterionId: 'JAC-001', engineerReview: null }],
          },
        },
      },
    });
    target.registrar.getByWorkItemId
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(completed);
    target.repository.reserveAssessmentAction.mockResolvedValue({
      created: false,
    });

    await expect(
      target.service.resynthesizeAfterEngineerChange(
        {
          workItemId: 'WI-SB-1001',
          expectedRevision: 5,
          criterionId: 'JAC-001',
          review: engineerReview('deferred', 'NEEDS_REVIEW'),
        },
        ACTOR,
      ),
    ).resolves.toBe(completed);
    expect(target.authorization.authorize).toHaveBeenCalledTimes(2);
    expect(target.permissionSnapshots.freshRead).toHaveBeenCalledTimes(2);
  });
});

describe('CanonicalHostAssessmentService engineer input', () => {
  it('rejects an illegal decision/status combination as HTTP 400 before artifact I/O', async () => {
    const target = authorizedService(workItem(existingAssessment()));

    const promise = target.service.resynthesizeAfterEngineerChange(
      {
        workItemId: 'WI-SB-1001',
        expectedRevision: 5,
        criterionId: 'JAC-001',
        review: engineerReview('deferred', 'ENGINEER_CONFIRMED'),
      },
      ACTOR,
    );

    await expect(promise).rejects.toMatchObject({ status: 400 });
    await expect(promise).rejects.toThrow(
      'ASSESSMENT_ENGINEER_DECISION_STATUS_INVALID',
    );
    expect(target.artifactStore.readActualBytes).not.toHaveBeenCalled();
    expect(target.repository.reserveAssessmentAction).not.toHaveBeenCalled();
  });

  it('rejects an unknown criterion as HTTP 400 without reserving an ActionAttempt', async () => {
    const target = authorizedService(workItem(existingAssessment()), {
      assessmentArtifact: {
        evaluation: { snapshot: { items: [] } },
      },
    });

    const promise = target.service.resynthesizeAfterEngineerChange(
      {
        workItemId: 'WI-SB-1001',
        expectedRevision: 5,
        criterionId: 'JAC-UNKNOWN',
        review: engineerReview('deferred', 'NEEDS_REVIEW'),
      },
      ACTOR,
    );

    await expect(promise).rejects.toMatchObject({ status: 400 });
    await expect(promise).rejects.toThrow('ASSESSMENT_CRITERION_NOT_FOUND');
    expect(target.artifactStore.readActualBytes).toHaveBeenCalledTimes(1);
    expect(target.repository.reserveAssessmentAction).not.toHaveBeenCalled();
  });

  it('rejects a self-reported engineer identity as HTTP 400', async () => {
    const target = authorizedService(workItem(existingAssessment()));
    const review = {
      ...engineerReview('deferred', 'NEEDS_REVIEW'),
      reviewingEngineerUserIds: ['different-user'],
    };

    await expect(
      target.service.resynthesizeAfterEngineerChange(
        {
          workItemId: 'WI-SB-1001',
          expectedRevision: 5,
          criterionId: 'JAC-001',
          review,
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(target.artifactStore.readActualBytes).not.toHaveBeenCalled();
  });
});
