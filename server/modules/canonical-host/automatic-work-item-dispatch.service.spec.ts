import { MiaodaDocumentVersionSourceResolver } from '../work-item/miaoda-document-version-source.resolver';
import {
  MiaodaWorkItemRepository,
  type AutoWorkItemAuthorizationBinding,
  type AutoWorkItemQueueCandidate,
  type AutoWorkItemQueueWorkItem,
} from '../work-item/miaoda-work-item.repository';
import type {
  AilyInitialAnalysisStatus,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import type { AutomaticWorkItemLeaseAuthorizationPort } from './automatic-work-item-lease-authorization.port';
import type { CanonicalServiceScopeAuthorizationPort } from './canonical-service-scope.authorization';
import type { AutomaticWorkItemSourceAuthorizationPort } from './automatic-work-item-source-authorization.port';
import type { CanonicalHostInitialAnalysisStatusService } from './canonical-host-initial-analysis-status.service';
import {
  AutomaticWorkItemDispatchService,
  automaticAuthorizationBindingMismatch,
} from './automatic-work-item-dispatch.service';

const TENANT_ID = 'tenant-01';
const ACTOR_ID = 'user-01';
const WORK_ITEM_ID = 'WI-01';
const REQUEST_ID = 'REQ-01';
const DOCUMENT_ID = 'DOC-01';
const DOCUMENT_VERSION_ID = 'DV-01';
const SOURCE_ARTIFACT_ID = 'ART-01';
const SOURCE_SHA256 = 'a'.repeat(64);
const NOW = new Date('2026-09-25T08:00:00.000Z');

describe('AutomaticWorkItemDispatchService', () => {
  it('does not discover a legacy WorkItem without a Host enrollment row', async () => {
    const workItems = repositoryDouble([]);
    const sources = sourceDouble();
    const service = dispatchService(workItems, sources);

    await expect(service.nextWorkItem()).resolves.toEqual({ status: 'IDLE' });
    expect(sources.resolve).not.toHaveBeenCalled();
    expect(workItems.claimAutoProcessingCandidate).not.toHaveBeenCalled();
  });

  it('acknowledges only after fresh active lease verification and token-generation CAS', async () => {
    const workItems = repositoryDouble([]);
    workItems.loadAutoProcessingProjection.mockResolvedValue(currentSnapshot(9));
    workItems.acknowledgeAutoProcessingLease.mockResolvedValue({
      acknowledgedAt: NOW,
      replayed: false,
    });
    const leaseAuthorization = leaseAuthorizationDouble();
    const initial = initialStatusDouble();
    const service = dispatchService(
      workItems,
      sourceDouble(),
      sourceAuthorizationDouble(),
      leaseAuthorization,
      initial,
    );
    const leaseToken = 'b1686364-7ee9-4ca1-a3aa-0b62794cb436';

    await expect(
      service.acknowledgeWorkItem({
        workItemId: WORK_ITEM_ID,
        leaseToken,
        leaseGeneration: 3,
      }),
    ).resolves.toEqual({
      status: 'ACKNOWLEDGED',
      workItemId: WORK_ITEM_ID,
      replayed: false,
      acknowledgedAt: NOW.toISOString(),
    });
    expect(leaseAuthorization.authorizeActiveLease).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      principalId: 'service:openclaw-main',
      workItemId: WORK_ITEM_ID,
      leaseToken,
      leaseGeneration: 3,
    });
    expect(workItems.acknowledgeAutoProcessingLease).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        workItemId: WORK_ITEM_ID,
        leaseOwner: 'service:openclaw-main',
        leaseToken,
        leaseGeneration: 3,
        expectedWorkItemRevision: 9,
      }),
    );
  });

  it('refuses acknowledgement until Host confirms JobAid and Overall success', async () => {
    const workItems = repositoryDouble([]);
    workItems.loadAutoProcessingProjection.mockResolvedValue(currentSnapshot(9));
    const initial = initialStatusDouble({
      status: 'WAITING_INPUT',
      nextOperation: 'SYNTHESIZE_OVERALL',
      stages: {
        ...completeInitialStatus().stages,
        overall: stageStatus('PENDING'),
      },
    });
    const service = dispatchService(
      workItems,
      sourceDouble(),
      sourceAuthorizationDouble(),
      leaseAuthorizationDouble(),
      initial,
    );

    await expect(service.acknowledgeWorkItem({
      workItemId: WORK_ITEM_ID,
      leaseToken: 'b1686364-7ee9-4ca1-a3aa-0b62794cb436',
      leaseGeneration: 3,
    })).rejects.toMatchObject({
      code: 'AUTO_WORK_ITEM_INITIAL_ANALYSIS_NOT_COMPLETE',
      statusCode: 409,
    });
    expect(workItems.acknowledgeAutoProcessingLease).not.toHaveBeenCalled();
  });

  it('blocks only a fresh Host-confirmed terminal failure using the latest revision', async () => {
    const workItems = repositoryDouble([]);
    workItems.loadAutoProcessingProjection.mockResolvedValue(currentSnapshot(12));
    workItems.blockAutoProcessingLease.mockResolvedValue({
      blockedAt: NOW,
      blockedCode: 'AUTO_WORK_ITEM_STAGE_JOBAID_FAILED',
      replayed: false,
    });
    const initial = initialStatusDouble({
      workItemRevision: 12,
      status: 'FAILED',
      nextOperation: null,
      stages: {
        ...completeInitialStatus().stages,
        jobAid: stageStatus('FAILED'),
      },
    });
    const service = dispatchService(
      workItems,
      sourceDouble(),
      sourceAuthorizationDouble(),
      leaseAuthorizationDouble(),
      initial,
    );

    await expect(service.blockWorkItem({
      workItemId: WORK_ITEM_ID,
      leaseToken: 'b1686364-7ee9-4ca1-a3aa-0b62794cb436',
      leaseGeneration: 3,
    })).resolves.toEqual({
      status: 'BLOCKED',
      workItemId: WORK_ITEM_ID,
      blockedCode: 'AUTO_WORK_ITEM_STAGE_JOBAID_FAILED',
      replayed: false,
      blockedAt: NOW.toISOString(),
    });
    expect(workItems.blockAutoProcessingLease).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedWorkItemRevision: 12,
        leaseToken: 'b1686364-7ee9-4ca1-a3aa-0b62794cb436',
        leaseGeneration: 3,
        blockedCode: 'AUTO_WORK_ITEM_STAGE_JOBAID_FAILED',
      }),
    );
  });

  it('does not block from a stale or self-reported failure when Host status is active', async () => {
    const workItems = repositoryDouble([]);
    workItems.loadAutoProcessingProjection.mockResolvedValue(currentSnapshot(12));
    const initial = initialStatusDouble({
      workItemRevision: 12,
      status: 'BUSY',
      nextOperation: null,
      stages: {
        ...completeInitialStatus().stages,
        jobAid: stageStatus('BUSY'),
      },
    });
    const service = dispatchService(
      workItems,
      sourceDouble(),
      sourceAuthorizationDouble(),
      leaseAuthorizationDouble(),
      initial,
    );

    await expect(service.blockWorkItem({
      workItemId: WORK_ITEM_ID,
      leaseToken: 'b1686364-7ee9-4ca1-a3aa-0b62794cb436',
      leaseGeneration: 3,
    })).rejects.toMatchObject({
      code: 'AUTO_WORK_ITEM_FAILURE_NOT_CONFIRMED',
      statusCode: 409,
    });
    expect(workItems.blockAutoProcessingLease).not.toHaveBeenCalled();
  });

  it('returns an idempotent replay only for an already completed matching lease', async () => {
    const notFound = Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
    const workItems = repositoryDouble([]);
    workItems.readCompletedAutoProcessingLeaseReceipt.mockResolvedValue({
      acknowledgedAt: NOW,
      replayed: true,
    });
    const leaseAuthorization = leaseAuthorizationDouble();
    leaseAuthorization.authorizeActiveLease.mockRejectedValue(notFound);
    const service = dispatchService(
      workItems,
      sourceDouble(),
      sourceAuthorizationDouble(),
      leaseAuthorization,
    );

    await expect(
      service.acknowledgeWorkItem({
        workItemId: WORK_ITEM_ID,
        leaseToken: 'b1686364-7ee9-4ca1-a3aa-0b62794cb436',
        leaseGeneration: 3,
      }),
    ).resolves.toMatchObject({
      status: 'ACKNOWLEDGED',
      replayed: true,
      acknowledgedAt: NOW.toISOString(),
    });
    expect(workItems.acknowledgeAutoProcessingLease).not.toHaveBeenCalled();
  });

  it('blocks one mismatched grant and continues to the next authorized item', async () => {
    const invalid = candidate({ actorUserId: 'other-user' });
    const valid = candidate();
    const workItems = repositoryDouble([invalid, valid]);
    workItems.loadAuthorizationBinding.mockResolvedValue({
      workItemId: WORK_ITEM_ID,
      revision: 7,
      tenantId: TENANT_ID,
      requestId: REQUEST_ID,
      documentId: DOCUMENT_ID,
      documentVersionId: DOCUMENT_VERSION_ID,
      requestedByUserId: ACTOR_ID,
      runKey: 'canonical',
    });
    workItems.loadAutoProcessingProjection.mockResolvedValue({
      row: {
        workItemId: WORK_ITEM_ID,
        requestedByUserId: ACTOR_ID,
        revision: 7,
        packageId: 'PKG-01',
      },
      projection: {
        workItemId: WORK_ITEM_ID,
        requestId: REQUEST_ID,
        revision: 7,
        phase: 'CANDIDATE_READBACK_VERIFIED',
        source: { documentVersionId: DOCUMENT_VERSION_ID },
        package: { packageId: 'PKG-01' },
      } as unknown as CanonicalWorkItemProjection,
    });
    workItems.claimAutoProcessingCandidate.mockResolvedValue({
      leaseGeneration: 1,
      leaseToken: 'b1686364-7ee9-4ca1-a3aa-0b62794cb436',
    });
    const sources = sourceDouble();
    const service = dispatchService(workItems, sources);

    await expect(service.nextWorkItem()).resolves.toMatchObject({
      status: 'CLAIMED',
      workItemId: WORK_ITEM_ID,
      requestId: REQUEST_ID,
      documentVersionId: DOCUMENT_VERSION_ID,
      workItemRevision: 7,
      leaseGeneration: 1,
    });
    expect(workItems.blockAutoProcessingCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: 'WI-01',
        actorUserId: 'other-user',
        blockedCode: 'AUTO_WORK_ITEM_AUTHORIZATION_BINDING_INVALID',
      }),
    );
    expect(sources.resolve).toHaveBeenCalledTimes(1);
    expect(workItems.claimAutoProcessingCandidate).toHaveBeenCalledTimes(1);
  });

  it('blocks a source that is no longer current and returns IDLE', async () => {
    const workItems = repositoryDouble([candidate()]);
    workItems.loadAuthorizationBinding.mockResolvedValue({
      workItemId: WORK_ITEM_ID,
      revision: 7,
      tenantId: TENANT_ID,
      requestId: REQUEST_ID,
      documentId: DOCUMENT_ID,
      documentVersionId: DOCUMENT_VERSION_ID,
      requestedByUserId: ACTOR_ID,
      runKey: 'canonical',
    });
    const sources = sourceDouble();
    sources.resolve.mockRejectedValue(
      Object.assign(new Error('DOCUMENT_VERSION_NOT_CURRENT'), {
        code: 'DOCUMENT_VERSION_NOT_CURRENT',
      }),
    );
    const service = dispatchService(workItems, sources);

    await expect(service.nextWorkItem()).resolves.toEqual({ status: 'IDLE' });
    expect(workItems.blockAutoProcessingCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: WORK_ITEM_ID,
        blockedCode: 'DOCUMENT_VERSION_NOT_CURRENT',
      }),
    );
    expect(workItems.claimAutoProcessingCandidate).not.toHaveBeenCalled();
  });

  it('fails closed with an explicit error when no fresh source ACL adapter is configured', async () => {
    const workItems = repositoryDouble([candidate()]);
    workItems.loadAuthorizationBinding.mockResolvedValue({
      workItemId: WORK_ITEM_ID,
      revision: 7,
      tenantId: TENANT_ID,
      requestId: REQUEST_ID,
      documentId: DOCUMENT_ID,
      documentVersionId: DOCUMENT_VERSION_ID,
      requestedByUserId: ACTOR_ID,
      runKey: 'canonical',
    });
    const sources = sourceDouble();
    const service = dispatchService(workItems, sources, null);

    await expect(service.nextWorkItem()).rejects.toMatchObject({
      code: 'AUTO_WORK_ITEM_SOURCE_ACL_UNAVAILABLE',
      statusCode: 503,
    });
    expect(sources.resolve).not.toHaveBeenCalled();
    expect(workItems.claimAutoProcessingCandidate).not.toHaveBeenCalled();
    expect(workItems.blockAutoProcessingCandidate).not.toHaveBeenCalled();
  });

  it('isolates a denied source ACL and continues to another registered item', async () => {
    const denied = candidate();
    denied.authorization = authorization({ workItemId: 'WI-DENIED' });
    denied.workItem = workItemRow({ workItemId: 'WI-DENIED' });
    const valid = candidate();
    const workItems = repositoryDouble([denied, valid]);
    workItems.loadAuthorizationBinding.mockImplementation(
      async ({ workItemId }) => ({
        workItemId,
        revision: 7,
        tenantId: TENANT_ID,
        requestId: REQUEST_ID,
        documentId: DOCUMENT_ID,
        documentVersionId: DOCUMENT_VERSION_ID,
        requestedByUserId: ACTOR_ID,
        runKey: 'canonical',
      }),
    );
    workItems.loadAutoProcessingProjection.mockResolvedValue({
      row: {
        workItemId: WORK_ITEM_ID,
        requestedByUserId: ACTOR_ID,
        revision: 7,
        packageId: 'PKG-01',
      },
      projection: {
        workItemId: WORK_ITEM_ID,
        requestId: REQUEST_ID,
        revision: 7,
        phase: 'CANDIDATE_READBACK_VERIFIED',
        source: { documentVersionId: DOCUMENT_VERSION_ID },
        package: { packageId: 'PKG-01' },
      } as unknown as CanonicalWorkItemProjection,
    });
    workItems.claimAutoProcessingCandidate.mockResolvedValue({
      leaseGeneration: 1,
      leaseToken: 'b1686364-7ee9-4ca1-a3aa-0b62794cb436',
    });
    const sources = sourceDouble();
    const sourceAuthorization = sourceAuthorizationDouble();
    sourceAuthorization.authorizeSourceRead.mockResolvedValueOnce({
      allowed: false,
      code: 'AUTO_WORK_ITEM_SOURCE_ACL_REVOKED',
    });
    const service = dispatchService(workItems, sources, sourceAuthorization);

    await expect(service.nextWorkItem()).resolves.toMatchObject({
      status: 'CLAIMED',
      workItemId: WORK_ITEM_ID,
    });
    expect(workItems.blockAutoProcessingCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: 'WI-DENIED',
        blockedCode: 'AUTO_WORK_ITEM_SOURCE_ACL_REVOKED',
      }),
    );
    expect(sourceAuthorization.authorizeSourceRead).toHaveBeenCalledTimes(2);
    expect(workItems.claimAutoProcessingCandidate).toHaveBeenCalledTimes(1);
  });

  it('compares tenant, actor, WorkItem, source, current parse and grant kind', () => {
    const grant = authorization();
    const row = workItemRow();
    expect(
      automaticAuthorizationBindingMismatch(grant, row, TENANT_ID),
    ).toBeNull();
    expect(
      automaticAuthorizationBindingMismatch(grant, row, 'other-tenant'),
    ).toBe('AUTO_WORK_ITEM_AUTHORIZATION_BINDING_INVALID');
    expect(
      automaticAuthorizationBindingMismatch(
        grant,
        { ...row, sourceFileSha256: 'b'.repeat(64) },
        TENANT_ID,
      ),
    ).toBe('AUTO_WORK_ITEM_AUTHORIZATION_BINDING_INVALID');
    expect(
      automaticAuthorizationBindingMismatch(
        {
          ...grant,
          grantKind: 'LEGACY' as AutoWorkItemAuthorizationBinding['grantKind'],
        },
        row,
        TENANT_ID,
      ),
    ).toBe('AUTO_WORK_ITEM_AUTHORIZATION_BINDING_INVALID');
  });
});

function authorization(
  overrides: Partial<AutoWorkItemAuthorizationBinding> = {},
): AutoWorkItemAuthorizationBinding {
  return {
    tenantId: TENANT_ID,
    workItemId: WORK_ITEM_ID,
    requestId: REQUEST_ID,
    actorUserId: ACTOR_ID,
    documentId: DOCUMENT_ID,
    documentVersionId: DOCUMENT_VERSION_ID,
    sourceArtifactId: SOURCE_ARTIFACT_ID,
    sourceFileSha256: SOURCE_SHA256,
    sourceByteLength: 1024,
    grantKind: 'MIAODA_CANONICAL_PARSE_REQUEST',
    status: 'WAITING',
    ...overrides,
  };
}

function workItemRow(
  overrides: Partial<AutoWorkItemQueueWorkItem> = {},
): AutoWorkItemQueueWorkItem {
  return {
    tenantId: TENANT_ID,
    workItemId: WORK_ITEM_ID,
    requestId: REQUEST_ID,
    requestedByUserId: ACTOR_ID,
    documentId: DOCUMENT_ID,
    documentVersionId: DOCUMENT_VERSION_ID,
    sourceArtifactId: SOURCE_ARTIFACT_ID,
    sourceFileSha256: SOURCE_SHA256,
    sourceByteLength: 1024,
    actionType: 'PARSE_PDF',
    runKey: 'canonical',
    status: 'CANDIDATE_READBACK_VERIFIED',
    revision: 7,
    packageId: 'PKG-01',
    ...overrides,
  };
}

function candidate(
  input: {
    actorUserId?: string;
  } = {},
): AutoWorkItemQueueCandidate {
  const actorUserId = input.actorUserId ?? ACTOR_ID;
  return {
    authorization: authorization({ actorUserId }),
    workItem: workItemRow({ requestedByUserId: ACTOR_ID }),
  };
}

function repositoryDouble(candidates: AutoWorkItemQueueCandidate[]) {
  const double = {
    listAutoProcessingCandidates: jest.fn().mockResolvedValue(candidates),
    loadAuthorizationBinding: jest.fn(),
    loadAutoProcessingProjection: jest.fn(),
    claimAutoProcessingCandidate: jest.fn(),
    blockAutoProcessingCandidate: jest.fn().mockResolvedValue(undefined),
    blockAutoProcessingLease: jest.fn(),
    acknowledgeAutoProcessingLease: jest.fn(),
    readCompletedAutoProcessingLeaseReceipt: jest.fn(),
    readBlockedAutoProcessingLeaseReceipt: jest.fn(),
  };
  return double as unknown as jest.Mocked<
    Pick<
      MiaodaWorkItemRepository,
      | 'listAutoProcessingCandidates'
      | 'loadAuthorizationBinding'
      | 'loadAutoProcessingProjection'
      | 'claimAutoProcessingCandidate'
      | 'blockAutoProcessingCandidate'
      | 'blockAutoProcessingLease'
      | 'acknowledgeAutoProcessingLease'
      | 'readCompletedAutoProcessingLeaseReceipt'
      | 'readBlockedAutoProcessingLeaseReceipt'
    >
  >;
}

function sourceDouble() {
  const double = {
    resolve: jest.fn().mockResolvedValue({
      version: {
        documentId: DOCUMENT_ID,
        documentVersionId: DOCUMENT_VERSION_ID,
        sourceArtifactId: SOURCE_ARTIFACT_ID,
        pdfSha256: SOURCE_SHA256,
        byteLength: 1024,
      },
      artifact: {
        sourceArtifactId: SOURCE_ARTIFACT_ID,
        sha256: SOURCE_SHA256,
        byteLength: 1024,
      },
    }),
  };
  return double as unknown as jest.Mocked<
    Pick<MiaodaDocumentVersionSourceResolver, 'resolve'>
  >;
}

function dispatchService(
  workItems: jest.Mocked<
    Pick<
      MiaodaWorkItemRepository,
      | 'listAutoProcessingCandidates'
      | 'loadAuthorizationBinding'
      | 'loadAutoProcessingProjection'
      | 'claimAutoProcessingCandidate'
      | 'blockAutoProcessingCandidate'
      | 'blockAutoProcessingLease'
      | 'acknowledgeAutoProcessingLease'
      | 'readCompletedAutoProcessingLeaseReceipt'
      | 'readBlockedAutoProcessingLeaseReceipt'
    >
  >,
  sources: jest.Mocked<Pick<MiaodaDocumentVersionSourceResolver, 'resolve'>>,
  sourceAuthorization: jest.Mocked<
    Pick<AutomaticWorkItemSourceAuthorizationPort, 'authorizeSourceRead'>
  > | null = sourceAuthorizationDouble(),
  leaseAuthorization: jest.Mocked<
    Pick<AutomaticWorkItemLeaseAuthorizationPort, 'authorizeActiveLease'>
  > = leaseAuthorizationDouble(),
  initial = initialStatusDouble(),
): AutomaticWorkItemDispatchService {
  const serviceScope = {
    authorizeOpenClawAutoWorkItemQueue: jest.fn().mockResolvedValue({
      principalId: 'service:openclaw-main',
      appId: 'app_17bzc551rsg',
      tenantId: TENANT_ID,
      authorizationFingerprint: `sha256:${'c'.repeat(64)}`,
    }),
  } as unknown as CanonicalServiceScopeAuthorizationPort;
  return new AutomaticWorkItemDispatchService(
    workItems as unknown as MiaodaWorkItemRepository,
    sources as unknown as MiaodaDocumentVersionSourceResolver,
    serviceScope,
    sourceAuthorization ?? undefined,
    leaseAuthorization,
    initial as unknown as CanonicalHostInitialAnalysisStatusService,
  );
}

function stageStatus(
  status: AilyInitialAnalysisStatus['stages']['overall']['status'],
) {
  return {
    status,
    attemptRef: null,
    attemptStatus: null,
    terminalCode: null,
  };
}

function completeInitialStatus(): AilyInitialAnalysisStatus {
  return {
    workItemRevision: 9,
    documentVersionId: DOCUMENT_VERSION_ID,
    applicabilityContextRef: null,
    status: 'SUCCEEDED',
    nextOperation: null,
    candidateOnly: true,
    stages: {
      translation: stageStatus('SUCCEEDED'),
      applicability: stageStatus('WAITING_INPUT'),
      jobAid: stageStatus('SUCCEEDED'),
      overall: stageStatus('SUCCEEDED'),
    },
  };
}

function initialStatusDouble(
  overrides: {
    workItemRevision?: number;
    status?: AilyInitialAnalysisStatus['status'];
    nextOperation?: AilyInitialAnalysisStatus['nextOperation'];
    stages?: Partial<AilyInitialAnalysisStatus['stages']>;
  } = {},
): jest.Mocked<Pick<CanonicalHostInitialAnalysisStatusService, 'project'>> {
  const base = completeInitialStatus();
  return {
    project: jest.fn().mockResolvedValue({
      ...base,
      ...overrides,
      workItemRevision: overrides.workItemRevision ?? base.workItemRevision,
      stages: { ...base.stages, ...overrides.stages },
    }),
  } as unknown as jest.Mocked<
    Pick<CanonicalHostInitialAnalysisStatusService, 'project'>
  >;
}

function currentSnapshot(
  revision: number,
): NonNullable<
  Awaited<ReturnType<MiaodaWorkItemRepository['loadAutoProcessingProjection']>>
> {
  return {
    row: {
      workItemId: WORK_ITEM_ID,
      requestedByUserId: ACTOR_ID,
      revision,
      packageId: 'PKG-01',
    },
    projection: {
      workItemId: WORK_ITEM_ID,
      requestId: REQUEST_ID,
      revision,
      phase: 'CANDIDATE_READBACK_VERIFIED',
      source: {
        documentId: DOCUMENT_ID,
        documentVersionId: DOCUMENT_VERSION_ID,
        sourceArtifactId: SOURCE_ARTIFACT_ID,
        sourceFileSha256: SOURCE_SHA256,
        sourceByteLength: 1024,
      },
      package: { packageId: 'PKG-01' },
    } as unknown as CanonicalWorkItemProjection,
  };
}

function leaseAuthorizationDouble() {
  return {
    authorizeActiveLease: jest.fn().mockResolvedValue({
      tenantId: TENANT_ID,
      principalId: 'service:openclaw-main',
      workItemId: WORK_ITEM_ID,
      requestId: REQUEST_ID,
      actorUserId: ACTOR_ID,
      documentId: DOCUMENT_ID,
      documentVersionId: DOCUMENT_VERSION_ID,
      sourceArtifactId: SOURCE_ARTIFACT_ID,
      sourceFileSha256: SOURCE_SHA256,
      sourceByteLength: 1024,
      leaseGeneration: 3,
      leaseExpiresAt: '2026-09-25T09:00:00.000Z',
    }),
  } as jest.Mocked<
    Pick<AutomaticWorkItemLeaseAuthorizationPort, 'authorizeActiveLease'>
  >;
}

function sourceAuthorizationDouble() {
  return {
    authorizeSourceRead: jest
      .fn()
      .mockImplementation(
        async (
          input: Parameters<
            AutomaticWorkItemSourceAuthorizationPort['authorizeSourceRead']
          >[0],
        ) => ({
          allowed: true as const,
          action: 'DOCUMENT_READ' as const,
          authorizationPolicy: 'MIAODA_HOST_DOCUMENT_READ' as const,
          tenantId: input.tenantId,
          actorUserId: input.actorUserId,
          documentId: input.documentId,
          documentVersionId: input.documentVersionId,
          sourceArtifactId: input.sourceArtifactId,
          sourceFileSha256: input.sourceFileSha256,
          sourceByteLength: input.sourceByteLength,
        }),
      ),
  } as jest.Mocked<
    Pick<AutomaticWorkItemSourceAuthorizationPort, 'authorizeSourceRead'>
  >;
}
