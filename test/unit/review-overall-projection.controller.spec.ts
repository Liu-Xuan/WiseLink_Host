import 'reflect-metadata';

jest.mock('@nestjs/common', () => {
  const actual = jest.requireActual('@nestjs/common');
  const noOp = () => () => undefined;
  return { ...actual, Body: noOp, Controller: noOp, Get: noOp,
    Param: noOp, Post: noOp, Req: noOp };
});
jest.mock('@lark-apaas/fullstack-nestjs-core', () => {
  const actual = jest.requireActual('@lark-apaas/fullstack-nestjs-core');
  return { ...actual, NeedLogin: () => () => undefined };
});

import { CanonicalHostReviewOverallProjectionController } from
  '../../server/modules/canonical-host/canonical-host-review-overall-projection.controller';

const body = {
  requestId: 'REQ-1',
  expectedRevision: 8,
  reviewConversationId: 'RC-1',
  reviewTurnId: 'RT-1',
  workRevisionRef: 'JAWR-1',
  expectedWorkRevision: 16,
  sourceIdentity: {
    documentVersionId: 'DV-1',
    sourceArtifactId: 'SRC-1',
    sourceFileSha256: 'sha256:' + 'a'.repeat(64),
    packageId: 'PKG-1',
    packageArtifactSha256: 'sha256:' + 'b'.repeat(64),
  },
};

describe('Review Overall browser command boundary', () => {
  it('accepts only the exact source and Review pointer fields', async () => {
    const service = { project: jest.fn(), eligibility: jest.fn(), status: jest.fn() };
    const browser = { runNativeWrite: jest.fn(async (_request: unknown, operation: () => Promise<unknown>) => operation()) };
    const controller = new CanonicalHostReviewOverallProjectionController(service as never, browser as never);
    const request = {} as never;
    await controller.project('WI-1', body, request);
    expect(service.project).toHaveBeenCalledWith('WI-1', {
      ...body,
      sourceIdentity: {
        ...body.sourceIdentity,
        sourceFileSha256: 'a'.repeat(64),
        packageArtifactSha256: 'b'.repeat(64),
      },
    }, request);
    expect(browser.runNativeWrite).toHaveBeenCalledWith(request, expect.any(Function));
    expect(() => controller.project('WI-1', { ...body, actorUserId: 'attacker' },
      request)).toThrow('REVIEW_OVERALL_UNKNOWN_FIELD');
    expect(() => controller.project('WI-1', {
      ...body, sourceIdentity: { ...body.sourceIdentity, sourceFileSha256: 'bad' },
    }, request)).toThrow('REVIEW_OVERALL_SOURCE_HASH_INVALID');
    expect(() => controller.project('WI-1', { ...body, expectedRevision: 0 },
      request)).toThrow('REVIEW_OVERALL_REVISION_INVALID');
  });
});
