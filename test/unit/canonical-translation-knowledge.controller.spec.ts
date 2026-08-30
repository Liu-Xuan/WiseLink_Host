import 'reflect-metadata';

jest.mock('@nestjs/common', () => {
  const actual = jest.requireActual('@nestjs/common');
  const noOp = () => () => undefined;
  return {
    ...actual,
    Body: noOp,
    Controller: noOp,
    Get: noOp,
    Param: noOp,
    Post: noOp,
    Query: noOp,
    Req: noOp,
    UseGuards: noOp,
  };
});

jest.mock('@lark-apaas/fullstack-nestjs-core', () => {
  const actual = jest.requireActual('@lark-apaas/fullstack-nestjs-core');
  return { ...actual, NeedLogin: () => () => undefined };
});

const actor = {
  userId: 'user:engineer-1',
  tenantId: 'tenant-1',
  appId: 'app-1',
  roles: ['engineer'],
  env: 'test',
};

jest.mock(
  '../../server/modules/canonical-host/canonical-host-request-actor',
  () => ({ hostActor: () => actor }),
);

import { CanonicalTranslationKnowledgeController } from '../../server/modules/canonical-host/canonical-translation-knowledge.controller';

describe('CanonicalTranslationKnowledgeController', () => {
  it('accepts only the browser-safe candidate import contract', async () => {
    const service = {
      createCandidates: jest.fn().mockResolvedValue({ ok: true }),
      readCandidate: jest.fn(),
      recordFeedback: jest.fn(),
    };
    const controller = new CanonicalTranslationKnowledgeController(
      service as never,
    );
    const body = {
      requestId: 'REQ-TM-IMPORT-1',
      expectedWorkItemRevision: 8,
      validFrom: '2026-08-30T00:00:00.000Z',
      expiresAt: '2026-09-30T00:00:00.000Z',
    };

    await controller.createCandidates('WI-TM-1', body, {} as never);
    expect(service.createCandidates).toHaveBeenCalledWith(
      'WI-TM-1',
      body,
      actor,
    );
    expect(() =>
      controller.createCandidates(
        'WI-TM-1',
        { ...body, ownerActorId: 'user:forged-owner' },
        {} as never,
      ),
    ).toThrow('KNOWLEDGE_REQUEST_UNKNOWN_FIELD:ownerActorId');
    expect(service.createCandidates).toHaveBeenCalledTimes(1);
  });

  it('uses exact asOf and rejects forged feedback actor or timestamp fields', async () => {
    const service = {
      createCandidates: jest.fn(),
      readCandidate: jest.fn().mockResolvedValue({ ok: true }),
      recordFeedback: jest.fn().mockResolvedValue({ ok: true }),
    };
    const controller = new CanonicalTranslationKnowledgeController(
      service as never,
    );
    const asOf = '2026-08-30T12:00:00.000Z';
    await controller.readCandidate(
      'WI-TM-1',
      'TM-CANDIDATE-1',
      asOf,
      {} as never,
    );
    expect(service.readCandidate).toHaveBeenCalledWith(
      'WI-TM-1',
      'TM-CANDIDATE-1',
      asOf,
      actor,
    );

    const feedback = {
      requestId: 'REQ-TM-FEEDBACK-1',
      expectedWorkItemRevision: 8,
      expectedGovernanceRevision: 0,
      decision: 'ADOPTED_AS_CANDIDATE_SUGGESTION',
      comment: 'Reviewed against the bound source.',
    };
    await controller.recordFeedback(
      'WI-TM-1',
      'TM-CANDIDATE-1',
      feedback,
      {} as never,
    );
    expect(service.recordFeedback).toHaveBeenCalledWith(
      'WI-TM-1',
      'TM-CANDIDATE-1',
      feedback,
      actor,
    );
    for (const forged of [
      { actorId: 'user:forged' },
      { occurredAt: asOf },
      { activeTerminology: true },
    ]) {
      expect(() =>
        controller.recordFeedback(
          'WI-TM-1',
          'TM-CANDIDATE-1',
          { ...feedback, ...forged },
          {} as never,
        ),
      ).toThrow('KNOWLEDGE_REQUEST_UNKNOWN_FIELD');
    }
    expect(service.recordFeedback).toHaveBeenCalledTimes(1);
  });
});
