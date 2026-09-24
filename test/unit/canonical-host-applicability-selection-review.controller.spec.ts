import 'reflect-metadata';

jest.mock('@nestjs/common', () => {
  const actual = jest.requireActual('@nestjs/common');
  const noOp = () => () => undefined;
  return { ...actual, Body: noOp, Controller: noOp,
    Get: noOp, Param: noOp, Post: noOp, Req: noOp };
});

jest.mock('@lark-apaas/fullstack-nestjs-core', () => {
  const actual = jest.requireActual('@lark-apaas/fullstack-nestjs-core');
  return { ...actual, NeedLogin: () => () => undefined };
});

import { CanonicalHostApplicabilitySelectionController } from
  '../../server/modules/canonical-host/canonical-host-applicability-selection.controller';

describe('applicability selection ReviewAction request boundary', () => {
  it('passes only exact preview and signed confirmation fields to the service', () => {
    const service = { read: jest.fn(), reviewAvailability: jest.fn(),
      previewReviewAction: jest.fn(), confirmReviewAction: jest.fn() };
    const controller = new CanonicalHostApplicabilitySelectionController(service as never);
    const preview = { aircraftIdentifier: 'B-1234', asOf: '2026-08-27',
      expectedWorkItemRevision: 7 };
    controller.preview(' WI-1 ', preview, {} as never);
    expect(service.previewReviewAction).toHaveBeenCalledWith('WI-1', preview,
      expect.anything());
    const draft = { schemaVersion: 'wiselink.3_1.applicability_selection_review_draft.v1',
      workItemId: 'WI-1', documentVersionId: 'DV-1',
      expectedWorkItemRevision: 7, aircraftIdentifier: 'B-1234',
      asOf: '2026-08-27', fleetSource: { snapshotId: 'snap-1',
        sourceRevisionKey: 'fleet-r1', authorityRevision: 'authority-r1',
        sourceAsOf: '2026-08-26' }, expiresAt: '2026-08-27T01:00:00.000Z',
      confirmationToken: 'a'.repeat(64) };
    controller.confirm('WI-1', { draft, confirmed: true }, {} as never);
    expect(service.confirmReviewAction).toHaveBeenCalledWith('WI-1',
      { draft, confirmed: true }, expect.anything());
    expect(() => controller.confirm('WI-1', {
      draft, confirmed: false,
    }, {} as never)).toThrow('APPLICABILITY_SELECTION_CONFIRMATION_REQUIRED');
    expect(() => controller.confirm('WI-1', {
      draft: { ...draft, selectedByUserId: 'forged' }, confirmed: true,
    }, {} as never)).toThrow('APPLICABILITY_SELECTION_REVIEW_BODY_INVALID');
    expect(service.confirmReviewAction).toHaveBeenCalledTimes(1);
  });
});
