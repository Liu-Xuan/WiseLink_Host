import { ConfiguredDevelopmentCanonicalServiceScopeAuthorization } from './configured-development-service-scope.authorization';
import type { AutomaticWorkItemLeaseAuthorizationPort } from './automatic-work-item-lease-authorization.port';

const CONFIG_KEYS = [
  'WL_OPENCLAW_SERVICE_SCOPE_ENABLED',
  'WL_OPENCLAW_GATEWAY_AUTH_MODE',
  'WL_OPENCLAW_SERVICE_SCOPE_ENV',
  'WL_OPENCLAW_SERVICE_PRINCIPAL_ID',
  'WL_OPENCLAW_SERVICE_TENANT_ID',
  'WL_OPENCLAW_SERVICE_WORK_ITEM_ID',
  'WL_OPENCLAW_SERVICE_AUTO_QUEUE_ENABLED',
  'WL_OPENCLAW_SERVICE_SUCCESSOR_REVIEW_ENABLED',
  'WL_OPENCLAW_DOCUMENT_SCOPE_ENABLED',
  'WL_OPENCLAW_SERVICE_DOCUMENT_VERSION_ID',
  'WL_OPENCLAW_SERVICE_DOCUMENT_VERSION_IDS',
  'WL_OPENCLAW_SERVICE_DOCUMENT_ACTOR_ID',
] as const;

describe('OpenClaw automatic WorkItem queue scope', () => {
  const previous = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of CONFIG_KEYS) {
      previous.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of CONFIG_KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('uses the configured trusted service identity with dedicated queue opt-in', async () => {
    const authorization =
      new ConfiguredDevelopmentCanonicalServiceScopeAuthorization();
    setBaseScope();

    await expect(
      authorization.authorizeOpenClawAutoWorkItemQueue(),
    ).rejects.toMatchObject({
      code: 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE',
      statusCode: 503,
    });

    process.env.WL_OPENCLAW_SERVICE_AUTO_QUEUE_ENABLED = '1';
    await expect(
      authorization.authorizeOpenClawAutoWorkItemQueue(),
    ).resolves.toMatchObject({
      principalId: 'service:openclaw-g2-dev-20260826',
      appId: 'app_17bzc551rsg',
      tenantId: 'tenant-01',
      authorizationFingerprint: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    });
  });

  it('grants only selected document work to one exact intake actor', async () => {
    setBaseScope();
    process.env.WL_OPENCLAW_SERVICE_AUTO_QUEUE_ENABLED = '1';
    const workItems = { readDocumentDeliveryIntents: jest.fn().mockResolvedValue([{
      workItemId: 'WI-one', actorUserId: 'engineer-1', delivery: { reading: true, translation: 'NONE' },
    }]) };
    const uploads = { readDocumentUploadDeliveryIntents: jest.fn().mockResolvedValue([]) };
    const authorization = new ConfiguredDevelopmentCanonicalServiceScopeAuthorization(
      undefined, workItems as never, uploads as never);

    await expect(authorization.authorizeDocumentWork({ documentVersionId: 'DV-1',
      deliveryRef: 'work-item:WI-one', purpose: 'READING' })).resolves.toMatchObject({
      tenantId: 'tenant-01', actorUserId: 'engineer-1', documentVersionId: 'DV-1',
    });
    await expect(authorization.authorizeDocumentWork({ documentVersionId: 'DV-1',
      deliveryRef: 'work-item:WI-one', purpose: 'TRANSLATION' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(authorization.authorizeDocumentWork({ documentVersionId: 'DV-1',
      deliveryRef: 'work-item:WI-one', purpose: 'ACTIVITY' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(authorization.authorizeDocumentWork({ documentVersionId: 'DV-1',
      deliveryRef: 'work-item:WI-one', purpose: 'REVISION' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(authorization.authorizeDocumentWork({ documentVersionId: 'DV-1',
      deliveryRef: 'work-item:WI-one', purpose: 'CANCEL' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(authorization.authorizeDocumentWork({ documentVersionId: 'DV-1',
      deliveryRef: 'work-item:WI-forged', purpose: 'READING' }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(workItems.readDocumentDeliveryIntents).toHaveBeenCalledWith({
      tenantId: 'tenant-01', documentVersionId: 'DV-1',
    });
    uploads.readDocumentUploadDeliveryIntents.mockResolvedValue([{
      acquisitionId: 'ACQ-two', actorUserId: 'engineer-2',
      delivery: { reading: true, translation: 'NONE' },
    }]);
    await expect(authorization.authorizeDocumentWork({ documentVersionId: 'DV-1',
      deliveryRef: 'work-item:WI-one', purpose: 'READING' }))
      .rejects.toMatchObject({ code: 'DOCUMENT_DELIVERY_MULTI_ACTOR_UNSUPPORTED' });
    await expect(authorization.authorizeDocumentWork({ documentVersionId: 'DV-1',
      deliveryRef: 'acquisition:ACQ-two', purpose: 'READING' }))
      .rejects.toMatchObject({ code: 'DOCUMENT_DELIVERY_MULTI_ACTOR_UNSUPPORTED' });
    await expect(authorization.authorizeDocumentWork({ documentVersionId: 'DV-1',
      purpose: 'READING' })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects a malformed configured service principal', async () => {
    setBaseScope();
    process.env.WL_OPENCLAW_SERVICE_AUTO_QUEUE_ENABLED = '1';
    process.env.WL_OPENCLAW_SERVICE_PRINCIPAL_ID = 'other';
    const authorization =
      new ConfiguredDevelopmentCanonicalServiceScopeAuthorization();

    await expect(
      authorization.authorizeOpenClawAutoWorkItemQueue(),
    ).rejects.toMatchObject({
      code: 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE',
      statusCode: 503,
    });
  });

  it('allows queue-only MCP transport while leaving individual WorkItem calls lease gated', async () => {
    setBaseScope();
    process.env.WL_OPENCLAW_SERVICE_AUTO_QUEUE_ENABLED = '1';
    const authorization =
      new ConfiguredDevelopmentCanonicalServiceScopeAuthorization();

    await expect(
      authorization.assertTransport({ transport: 'OPENCLAW_MCP' }),
    ).resolves.toBeUndefined();
    await expect(
      authorization.assertAutoWorkItemQueueTransport(),
    ).resolves.toBeUndefined();
  });

  it('rechecks an exact active lease for each allowed downstream WorkItem operation', async () => {
    setBaseScope();
    process.env.WL_OPENCLAW_SERVICE_AUTO_QUEUE_ENABLED = '1';
    const leaseAuthorization: jest.Mocked<
      Pick<AutomaticWorkItemLeaseAuthorizationPort, 'authorizeActiveLease'>
    > = {
      authorizeActiveLease: jest.fn().mockResolvedValue({
        tenantId: 'tenant-01',
        principalId: 'service:openclaw-g2-dev-20260826',
        workItemId: 'WI-dynamic',
        requestId: 'REQ-dynamic',
        actorUserId: 'user-dynamic',
        documentId: 'DOC-dynamic',
        documentVersionId: 'DV-dynamic',
        sourceArtifactId: 'ART-dynamic',
        sourceFileSha256: 'a'.repeat(64),
        sourceByteLength: 1024,
        leaseGeneration: 3,
        leaseExpiresAt: '2099-01-01T00:00:00.000Z',
      }),
    };
    const authorization =
      new ConfiguredDevelopmentCanonicalServiceScopeAuthorization(
        leaseAuthorization as AutomaticWorkItemLeaseAuthorizationPort,
      );

    await expect(
      authorization.authorizeWorkItemRead({
        transport: 'READONLY_MCP',
        operation: 'READ_STATUS',
        workItemId: 'WI-dynamic',
      }),
    ).resolves.toMatchObject({
      tenantId: 'tenant-01',
      principalId: 'service:openclaw-g2-dev-20260826',
      workItemId: 'WI-dynamic',
      automaticWorkItemLease: {
        actorUserId: 'user-dynamic',
        documentVersionId: 'DV-dynamic',
        leaseGeneration: 3,
      },
    });
    await authorization.authorizeOpenClawWorkItem({
      operation: 'BEGIN_DYNAMIC',
      workItemId: 'WI-dynamic',
    });
    await authorization.authorizeOpenClawAttempt({
      operation: 'COMMIT_DYNAMIC',
      attemptRef: 'ATT-dynamic',
      workItemId: 'WI-dynamic',
    });
    expect(leaseAuthorization.authorizeActiveLease).toHaveBeenCalledTimes(3);
    expect(leaseAuthorization.authorizeActiveLease).toHaveBeenNthCalledWith(1, {
      tenantId: 'tenant-01',
      principalId: 'service:openclaw-g2-dev-20260826',
      workItemId: 'WI-dynamic',
    });
  });

  it('keeps formal review operations outside dynamic automatic queue scope', async () => {
    setBaseScope();
    process.env.WL_OPENCLAW_SERVICE_AUTO_QUEUE_ENABLED = '1';
    const leaseAuthorization = { authorizeActiveLease: jest.fn() };
    const authorization =
      new ConfiguredDevelopmentCanonicalServiceScopeAuthorization(
        leaseAuthorization as unknown as AutomaticWorkItemLeaseAuthorizationPort,
      );

    await expect(
      authorization.authorizeOpenClawAttempt({
        operation: 'COMMIT_REVIEW',
        attemptRef: 'ATT-dynamic',
        workItemId: 'WI-dynamic',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(leaseAuthorization.authorizeActiveLease).not.toHaveBeenCalled();
  });

  it('requires explicit successor opt-in and never falls back from a rejected Review to the initial lease', async () => {
    setBaseScope();
    process.env.WL_OPENCLAW_SERVICE_AUTO_QUEUE_ENABLED = '1';
    const delegate = {
      authorizeActiveLease: jest.fn(),
      authorizeSuccessorOverall: jest.fn(),
      authorizeReviewDelegation: jest.fn().mockResolvedValue({
        principalId: 'service:openclaw-g2-dev-20260826',
        tenantId: 'tenant-01',
        workItemId: 'WI-dynamic',
        reviewConversationRef: 'RC-new',
        requestId: 'REQ-new',
        actorUserId: 'actor-1',
        reviewTurnRef: 'RT-new',
        inputRevision: 7,
        overallRequested: true,
        documentId: 'DOC-1',
        documentVersionId: 'DV-1',
        sourceArtifactId: 'SA-1',
        sourceFileSha256: 'a'.repeat(64),
        sourceByteLength: 100,
      }),
      authorizeReviewAttempt: jest.fn().mockRejectedValue(
        Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {
          code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
          statusCode: 404,
        }),
      ),
    };
    const authorization =
      new ConfiguredDevelopmentCanonicalServiceScopeAuthorization(delegate);
    const begin = {
      operation: 'BEGIN_REVIEW' as const,
      workItemId: 'WI-dynamic',
      reviewConversationRef: 'RC-new',
      requestId: 'REQ-new',
    };
    await expect(
      authorization.authorizeOpenClawReview(begin),
    ).rejects.toMatchObject({ statusCode: 503 });
    process.env.WL_OPENCLAW_SERVICE_SUCCESSOR_REVIEW_ENABLED = '1';
    await expect(
      authorization.authorizeOpenClawReview(begin),
    ).resolves.toMatchObject({
      workItemId: 'WI-dynamic',
      successorReviewDelegation: { reviewConversationRef: 'RC-new' },
    });
    await expect(
      authorization.authorizeOpenClawAttempt({
        operation: 'HEARTBEAT_ATTEMPT',
        workItemId: 'WI-dynamic',
        attemptRef: 'OP-review',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    delegate.authorizeSuccessorOverall.mockResolvedValue(
      await delegate.authorizeReviewDelegation(),
    );
    for (const operation of ['READ_STATUS', 'READ_DEEP_LINK'] as const) {
      await expect(
        authorization.authorizeWorkItemRead({
          transport: 'READONLY_MCP',
          operation,
          workItemId: 'WI-dynamic',
          successorReviewTurnRef: 'RT-new',
        }),
      ).resolves.toMatchObject({
        successorReviewDelegation: { reviewTurnRef: 'RT-new' },
      });
    }
    await expect(
      authorization.authorizeWorkItemRead({
        transport: 'READONLY_MCP',
        operation: 'QUERY_PARSED_PACKAGE',
        workItemId: 'WI-dynamic',
        successorReviewTurnRef: 'RT-new',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(delegate.authorizeSuccessorOverall).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-01',
        workItemId: 'WI-dynamic',
        reviewTurnRef: 'RT-new',
      }),
    );
    expect(delegate.authorizeActiveLease).not.toHaveBeenCalled();
    await expect(
      authorization.authorizeOpenClawReview({
        operation: 'BEGIN_REVIEW',
        reviewConversationRef: 'RC-new',
        requestId: 'REQ-new',
      }),
    ).rejects.toMatchObject({ statusCode: 503 });
  });

  it('preserves the configured exact WorkItem scope without queue configuration', async () => {
    setBaseScope();
    process.env.WL_OPENCLAW_SERVICE_WORK_ITEM_ID = 'WI-static';
    const authorization =
      new ConfiguredDevelopmentCanonicalServiceScopeAuthorization();

    await expect(
      authorization.authorizeWorkItemRead({
        transport: 'READONLY_MCP',
        operation: 'QUERY_PARSED_PACKAGE',
        workItemId: 'WI-static',
      }),
    ).resolves.toMatchObject({
      workItemId: 'WI-static',
      tenantId: 'tenant-01',
    });
  });
});

function setBaseScope(): void {
  process.env.WL_OPENCLAW_SERVICE_SCOPE_ENABLED = '1';
  process.env.WL_OPENCLAW_GATEWAY_AUTH_MODE = 'API_KEY';
  process.env.WL_OPENCLAW_SERVICE_SCOPE_ENV = 'DEV';
  process.env.WL_OPENCLAW_SERVICE_PRINCIPAL_ID =
    'service:openclaw-g2-dev-20260826';
  process.env.WL_OPENCLAW_SERVICE_TENANT_ID = 'tenant-01';
}
