import { CanonicalHostOpenClawDiscoveryService } from '../../server/modules/canonical-host/canonical-host-openclaw-discovery.service';

describe('CanonicalHostOpenClawDiscoveryService', () => {
  it('rejects before WorkItem or candidate-store I/O without service scope', async () => {
    const registrar = { getTenantScopedByWorkItemId: jest.fn() };
    const discovery = { recordSearchRun: jest.fn() };
    const service = new CanonicalHostOpenClawDiscoveryService(
      registrar as never,
      { nowIso: jest.fn() } as never,
      {} as never,
      {} as never,
      discovery as never,
      {
        authorizeOpenClawWorkItem: jest.fn().mockRejectedValue(
          Object.assign(new Error('scope unavailable'), {
            code: 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE',
            statusCode: 503,
          }),
        ),
      } as never,
    );

    await expect(
      service.record('WI-DISCOVERY', deniedResult()),
    ).rejects.toMatchObject({
      code: 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE',
      statusCode: 503,
    });
    expect(registrar.getTenantScopedByWorkItemId).not.toHaveBeenCalled();
    expect(discovery.recordSearchRun).not.toHaveBeenCalled();
  });

  it('derives service identity/time/ref and records ACCESS_DENIED without DM I/O', async () => {
    const recorded: Array<Record<string, unknown>> = [];
    const service = createService(recorded);
    const result = await service.record('WI-DISCOVERY', deniedResult());

    expect(result).toMatchObject({
      provider: 'BOEING',
      resultStatus: 'ACCESS_DENIED',
      observedAt: '2026-08-16T03:00:00.000Z',
      candidateCount: 0,
      documentManagementIoPerformed: false,
      candidateAdopted: false,
    });
    expect(String(result.searchRunRef)).toMatch(/^search:boeing:/u);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      context: {
        actorUserId: 'service:openclaw-main',
        tenantId: 'tenant-hosted',
        roles: [],
      },
      searchRun: {
        sourceSystem: 'FEISHU_HOSTED_OPENCLAW',
        resultStatus: 'ACCESS_DENIED',
        failureCode: 'UPSTREAM_CONNECT_TIMEOUT',
      },
    });
  });

  it('rejects permission drift before candidate-store write', async () => {
    const recorded: Array<Record<string, unknown>> = [];
    const service = createService(recorded, 'permission-drift');
    await expect(
      service.record('WI-DISCOVERY', deniedResult()),
    ).rejects.toThrow('OPENCLAW_DISCOVERY_PERMISSION_SNAPSHOT_CHANGED');
    expect(recorded).toEqual([]);
  });
});

function createService(
  recorded: Array<Record<string, unknown>>,
  freshPermission = 'permission-current',
) {
  return new CanonicalHostOpenClawDiscoveryService(
    {
      getTenantScopedByWorkItemId: async () => ({
        workItemId: 'WI-DISCOVERY',
        requestId: 'REQ-DISCOVERY',
        source: { documentVersionId: 'DV-DISCOVERY' },
      }),
    } as never,
    { nowIso: () => '2026-08-16T03:00:00.000Z' },
    {
      authorize: async (input: Record<string, unknown>) => ({
        action: input.action,
        allowed: true,
        permissionSnapshotVersion: 'permission-current',
      }),
    } as never,
    {
      freshRead: async () => ({ permissionSnapshotVersion: freshPermission }),
    } as never,
    {
      recordSearchRun: async (searchRun: unknown, context: unknown) => {
        recorded.push({ searchRun, context });
        return { disposition: 'RECORDED' };
      },
    } as never,
    {
      authorizeOpenClawWorkItem: async () => ({
        principalId: 'service:openclaw-test',
        appId: 'app_17bzc551rsg',
        tenantId: 'tenant-hosted',
        workItemId: 'WI-DISCOVERY',
        authorizationFingerprint: 'scope:discovery-test',
      }),
    } as never,
  );
}

function deniedResult() {
  return {
    provider: 'BOEING' as const,
    query: '737-34-3830 applicability',
    resultStatus: 'ACCESS_DENIED' as const,
    candidates: [],
    accessRestricted: true,
    truncated: false,
    partialOnly: false,
    excludedNonOemCandidateCount: 0,
    error: {
      code: 'UPSTREAM_CONNECT_TIMEOUT',
      message: 'Boeing public search data layer timed out.',
    },
  };
}
