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

function deniedService(projection: CanonicalWorkItemProjection) {
  const authorization = {
    authorize: jest.fn().mockResolvedValue({
      action: 'WRONG_ACTION',
      allowed: false,
    }),
  };
  const permissionSnapshots = { freshRead: jest.fn() };
  const registrar = {
    getByWorkItemId: jest.fn().mockResolvedValue(projection),
  };
  const service = new CanonicalHostAssessmentService(
    registrar as never,
    authorization as never,
    permissionSnapshots as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { authorization, permissionSnapshots, service };
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
    ).rejects.toThrow('CANONICAL_ACTION_NOT_AUTHORIZED');
    expect(target.authorization.authorize).toHaveBeenCalledTimes(1);
    expect(target.permissionSnapshots.freshRead).not.toHaveBeenCalled();
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
    ).rejects.toThrow('CANONICAL_ACTION_NOT_AUTHORIZED');
    expect(target.authorization.authorize).toHaveBeenCalledTimes(1);
    expect(target.permissionSnapshots.freshRead).not.toHaveBeenCalled();
  });
});
