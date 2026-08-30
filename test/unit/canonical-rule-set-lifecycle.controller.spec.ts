import type { Request } from 'express';

import { CanonicalRuleSetLifecycleController } from '../../server/modules/canonical-host/canonical-rule-set-lifecycle.controller';

describe('CanonicalRuleSetLifecycleController', () => {
  const request = {} as Request;
  const lifecycle = {
    createSnapshot: jest.fn(),
    promote: jest.fn(),
    rollback: jest.fn(),
  };
  const controller = new CanonicalRuleSetLifecycleController(
    lifecycle as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects a client- or AI-reported snapshot owner', () => {
    expect(() =>
      controller.createSnapshot(
        {
          selection: { bucketId: 'bucket', filePath: 'rule-pack.json' },
          engineeringOwnerUserId: 'self-reported-owner',
        },
        request,
      ),
    ).toThrow('RULE_SET_UNKNOWN_FIELD:engineeringOwnerUserId');
    expect(lifecycle.createSnapshot).not.toHaveBeenCalled();
  });

  it('rejects a provider-reported promotion authority', () => {
    expect(() =>
      controller.promote(
        {
          targetSnapshotId: 'JACS-TEST',
          expectedRevision: 0,
          reason: 'Provider asks to publish.',
          approvedByProvider: true,
        },
        request,
      ),
    ).toThrow('RULE_SET_UNKNOWN_FIELD:approvedByProvider');
    expect(lifecycle.promote).not.toHaveBeenCalled();
  });
});
