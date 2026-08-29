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
  it('normalizes canonical and bare source hashes to the same Host digest', async () => {
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
        sourceFileSha256: `sha256:${'1'.repeat(64)}`,
        packageId: 'PKG-1',
        packageArtifactSha256: `sha256:${'2'.repeat(64)}`,
      },
    };
    const normalizedBody = {
      ...body,
      sourceIdentity: {
        ...body.sourceIdentity,
        sourceFileSha256: '1'.repeat(64),
        packageArtifactSha256: '2'.repeat(64),
      },
    };

    await controller.requestRegeneration('WI-1', body, request);
    await controller.requestRegeneration('WI-1', normalizedBody, request);
    expect(service.request).toHaveBeenNthCalledWith(
      1,
      'WI-1',
      normalizedBody,
      request,
    );
    expect(service.request).toHaveBeenNthCalledWith(
      2,
      'WI-1',
      normalizedBody,
      request,
    );

    expect(() =>
      controller.requestRegeneration(
        'WI-1',
        { ...body, staleReason: 'ENGINEER_REVIEW_CHANGED' },
        request,
      ),
    ).toThrow('OVERALL_REGENERATION_UNKNOWN_FIELD:staleReason');
    expect(service.request).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['uppercase digest', 'A'.repeat(64)],
    ['uppercase prefix', `SHA256:${'a'.repeat(64)}`],
    ['wrong prefix', `sha512:${'a'.repeat(64)}`],
    ['invalid length', `sha256:${'a'.repeat(63)}`],
  ])('rejects an invalid %s', (_label: string, sourceFileSha256: string) => {
    const controller = new CanonicalHostOverallRegenerationController({
      request: jest.fn(),
      status: jest.fn(),
    } as never);
    expect(() =>
      controller.requestRegeneration(
        'WI-1',
        {
          requestId: 'REQ-REGEN-INVALID',
          expectedRevision: 12,
          sourceIdentity: {
            documentVersionId: 'DV-1',
            sourceArtifactId: 'SRC-ART-1',
            sourceFileSha256,
            packageId: 'PKG-1',
            packageArtifactSha256: '2'.repeat(64),
          },
        },
        {} as never,
      ),
    ).toThrow('OVERALL_REGENERATION_SOURCE_HASH_INVALID');
  });
});
