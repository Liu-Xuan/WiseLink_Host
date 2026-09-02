import 'reflect-metadata';

jest.mock('@nestjs/common', () => {
  const actual = jest.requireActual('@nestjs/common');
  const noOp = () => () => undefined;
  return {
    ...actual,
    Body: noOp,
    Controller: noOp,
    Param: noOp,
    Post: noOp,
    Req: noOp,
  };
});

jest.mock('@lark-apaas/fullstack-nestjs-core', () => {
  const actual = jest.requireActual('@lark-apaas/fullstack-nestjs-core');
  return { ...actual, NeedLogin: () => () => undefined };
});

import { CanonicalHostReviewActionController } from '../../server/modules/canonical-host/canonical-host-review-action.controller';

describe('CanonicalHostReviewActionController request boundary', () => {
  it('accepts only the Host-issued draft ref and expected revision', async () => {
    const service = { confirmDraft: jest.fn().mockResolvedValue({ ok: true }) };
    const controller = new CanonicalHostReviewActionController(
      service as never,
    );

    await controller.confirmDraft(
      ' WI-1 ',
      ' RC-1 ',
      ' RT-1 ',
      {
        reviewActionDraftRef: 'RAD-DRAFT-1',
        expectedRevision: 7,
      },
      {} as never,
    );
    expect(service.confirmDraft).toHaveBeenCalledWith(
      'WI-1',
      'RC-1',
      'RT-1',
      {
        reviewActionDraftRef: 'RAD-DRAFT-1',
        expectedRevision: 7,
      },
      expect.anything(),
    );
    await expect(
      controller.confirmDraft(
        'WI-1',
        'RC-1',
        'RT-1',
        {
          reviewActionDraftRef: 'RAD-DRAFT-1',
          expectedRevision: 7,
          proposedStatus: 'pass',
        },
        {} as never,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(service.confirmDraft).toHaveBeenCalledTimes(1);
  });
});
