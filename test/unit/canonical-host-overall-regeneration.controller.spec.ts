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
    Req: noOp,
  };
});

jest.mock('@lark-apaas/fullstack-nestjs-core', () => {
  const actual = jest.requireActual('@lark-apaas/fullstack-nestjs-core');
  return { ...actual, NeedLogin: () => () => undefined };
});

import { CanonicalHostOverallRegenerationController } from '../../server/modules/canonical-host/canonical-host-overall-regeneration.controller';

describe('CanonicalHostOverallRegenerationController', () => {
  it('accepts the exact source-bound command and never accepts a stale reason', async () => {
    const service = {
      request: jest.fn().mockResolvedValue({ ok: true }),
      status: jest.fn(),
    };
    const controller = new CanonicalHostOverallRegenerationController(
      service as never,
    );
    const request = {} as never;
    const body = {
      requestId: 'REQ-REGEN-1',
      expectedRevision: 12,
      sourceIdentity: {
        documentVersionId: 'DV-1',
        sourceArtifactId: 'SRC-ART-1',
        sourceFileSha256: '1'.repeat(64),
        packageId: 'PKG-1',
        packageArtifactSha256: '2'.repeat(64),
      },
    };

    await controller.requestRegeneration('WI-1', body, request);
    expect(service.request).toHaveBeenCalledWith('WI-1', body, request);

    expect(() =>
      controller.requestRegeneration(
        'WI-1',
        { ...body, staleReason: 'ENGINEER_REVIEW_CHANGED' },
        request,
      ),
    ).toThrow('OVERALL_REGENERATION_UNKNOWN_FIELD:staleReason');
    expect(service.request).toHaveBeenCalledTimes(1);
  });
});
