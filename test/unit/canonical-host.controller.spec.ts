import 'reflect-metadata';

jest.mock('@nestjs/common', () => {
  const actual = jest.requireActual('@nestjs/common');
  const noOpDecorator = () => () => undefined;
  return {
    ...actual,
    Body: noOpDecorator,
    Controller: noOpDecorator,
    Get: noOpDecorator,
    Param: noOpDecorator,
    Post: noOpDecorator,
    Query: noOpDecorator,
    Req: noOpDecorator,
  };
});

jest.mock('@lark-apaas/fullstack-nestjs-core', () => ({
  NeedLogin: () => () => undefined,
}));

import { BadRequestException, UnauthorizedException } from '@nestjs/common';

import { CanonicalHostController } from '../../server/modules/canonical-host/canonical-host.controller';

const HOST_REQUEST = {
  userContext: {
    userId: 'engineer-1001',
    tenantId: 'tenant-2001',
    appId: 'app_17bzc551rsg',
    roles: ['authenticated'],
    env: 'development',
  },
};

function target() {
  const assessments = {
    evaluateCandidate: jest.fn().mockResolvedValue({ revision: 5 }),
    resynthesizeAfterEngineerChange: jest
      .fn()
      .mockResolvedValue({ revision: 6 }),
  };
  const aeo = {
    runPhase10CandidateLoop: jest.fn().mockResolvedValue({
      status: 'CANDIDATE_WORD_EXPORTED',
    }),
  };
  return {
    assessments,
    aeo,
    controller: new CanonicalHostController(
      {} as never,
      {} as never,
      assessments as never,
      aeo as never,
    ),
  };
}

describe('CanonicalHostController assessment actions', () => {
  it('derives the actor and NEEDS_REVIEW status on a valid deferred change', async () => {
    const { assessments, controller } = target();

    await expect(
      controller.resynthesizeAssessment(
        'WI-SB-1001',
        {
          expectedRevision: 5,
          criterionId: 'JAC-001',
          decision: 'deferred',
          comment: '需要补充受控证据。',
        },
        HOST_REQUEST as never,
      ),
    ).resolves.toEqual({ revision: 6 });

    expect(assessments.resynthesizeAfterEngineerChange).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: 'WI-SB-1001',
        expectedRevision: 5,
        criterionId: 'JAC-001',
        review: expect.objectContaining({
          decision: 'deferred',
          status: 'NEEDS_REVIEW',
          reviewingEngineerUserIds: ['engineer-1001'],
        }),
      }),
      expect.objectContaining({ userId: 'engineer-1001' }),
    );
  });

  it('derives ENGINEER_CONFIRMED only for a confirmed decision', async () => {
    const { assessments, controller } = target();

    await controller.resynthesizeAssessment(
      'WI-SB-1001',
      {
        expectedRevision: 5,
        criterionId: 'JAC-001',
        decision: 'confirmed_pass',
        comment: '已复核当前候选。',
      },
      HOST_REQUEST as never,
    );

    expect(assessments.resynthesizeAfterEngineerChange).toHaveBeenCalledWith(
      expect.objectContaining({
        review: expect.objectContaining({
          decision: 'confirmed_pass',
          status: 'ENGINEER_CONFIRMED',
        }),
      }),
      expect.any(Object),
    );
  });

  it.each([
    [{ expectedRevision: 0, criterionId: 'JAC-001', decision: 'deferred', comment: 'x' }],
    [{ expectedRevision: 5, criterionId: '', decision: 'deferred', comment: 'x' }],
    [{ expectedRevision: 5, criterionId: 'JAC-001', decision: 'overridden', comment: 'x' }],
    [{ expectedRevision: 5, criterionId: 'JAC-001', decision: 'deferred', comment: '' }],
    [{ expectedRevision: 5, criterionId: 'JAC-001', decision: 'deferred', comment: 'x', status: 'ENGINEER_CONFIRMED' }],
  ])('maps malformed engineer input to HTTP 400', async (body) => {
    const { assessments, controller } = target();

    let caught: unknown;
    try {
      await controller.resynthesizeAssessment(
        'WI-SB-1001',
        body,
        HOST_REQUEST as never,
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as BadRequestException).getStatus()).toBe(400);
    expect(assessments.resynthesizeAfterEngineerChange).not.toHaveBeenCalled();
  });

  it('rejects client-supplied authority fields as HTTP 400', async () => {
    const { assessments, controller } = target();

    expect(() =>
      controller.evaluateAssessment(
        'WI-SB-1001',
        { permissionSnapshotVersion: 'client-value' },
        HOST_REQUEST as never,
      ),
    ).toThrow(BadRequestException);
    expect(assessments.evaluateCandidate).not.toHaveBeenCalled();
  });

  it('requires the authenticated host actor for assessment actions', async () => {
    const { assessments, controller } = target();

    expect(() =>
      controller.evaluateAssessment(
        'WI-SB-1001',
        {},
        { userContext: null } as never,
      ),
    ).toThrow(UnauthorizedException);
    expect(assessments.evaluateCandidate).not.toHaveBeenCalled();
  });

  it('runs the fixed Phase10 action with an empty body and server actor only', async () => {
    const { aeo, controller } = target();

    await expect(
      controller.runPhase10AeoCandidateLoop({}, HOST_REQUEST as never),
    ).resolves.toEqual({ status: 'CANDIDATE_WORD_EXPORTED' });
    expect(aeo.runPhase10CandidateLoop).toHaveBeenCalledTimes(1);
    expect(aeo.runPhase10CandidateLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'engineer-1001',
        tenantId: 'tenant-2001',
        appId: 'app_17bzc551rsg',
      }),
    );
  });

  it.each([
    { workItemId: 'client-value' },
    { actor: 'client-value' },
    { package: 'client-value' },
    { authority: true },
    { path: '/tmp/client-value' },
  ])('rejects every client-supplied Phase10 field', (body) => {
    const { aeo, controller } = target();

    expect(() =>
      controller.runPhase10AeoCandidateLoop(body, HOST_REQUEST as never),
    ).toThrow(BadRequestException);
    expect(aeo.runPhase10CandidateLoop).not.toHaveBeenCalled();
  });
});
