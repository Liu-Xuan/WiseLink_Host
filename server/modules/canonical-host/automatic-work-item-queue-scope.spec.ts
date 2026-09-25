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
  process.env.WL_OPENCLAW_SERVICE_PRINCIPAL_ID = 'service:openclaw-g2-dev-20260826';
  process.env.WL_OPENCLAW_SERVICE_TENANT_ID = 'tenant-01';
}
