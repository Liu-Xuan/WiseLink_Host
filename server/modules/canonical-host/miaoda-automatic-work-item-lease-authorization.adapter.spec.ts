import type { MiaodaDocumentVersionSourceResolver } from '../work-item/miaoda-document-version-source.resolver';
import type {
  AutoWorkItemLeaseBinding,
  MiaodaWorkItemRepository,
  WorkItemAuthorizationBinding,
} from '../work-item/miaoda-work-item.repository';
import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import type { AutomaticWorkItemSourceAuthorizationPort } from './automatic-work-item-source-authorization.port';
import { MiaodaAutomaticWorkItemLeaseAuthorizationAdapter } from './miaoda-automatic-work-item-lease-authorization.adapter';

const TENANT_ID = 'tenant-01';
const PRINCIPAL_ID = 'service:openclaw-main';
const WORK_ITEM_ID = 'WI-01';
const REQUEST_ID = 'REQ-01';
const ACTOR_ID = 'user-01';
const DOCUMENT_ID = 'DOC-01';
const DOCUMENT_VERSION_ID = 'DV-01';
const ARTIFACT_ID = 'ART-01';
const SHA256 = 'a'.repeat(64);
const TOKEN = 'b1686364-7ee9-4ca1-a3aa-0b62794cb436';
const LEASE_EXPIRES_AT = new Date('2099-01-01T00:00:00.000Z');

describe('MiaodaAutomaticWorkItemLeaseAuthorizationAdapter', () => {
  it('revalidates the active grant, original owner, source read policy and current source', async () => {
    const { adapter, workItems, sourceResolver, sourceAuthorization } =
      fixture();

    await expect(
      adapter.authorizeActiveLease({
        tenantId: TENANT_ID,
        principalId: PRINCIPAL_ID,
        workItemId: WORK_ITEM_ID,
      }),
    ).resolves.toMatchObject({
      tenantId: TENANT_ID,
      principalId: PRINCIPAL_ID,
      workItemId: WORK_ITEM_ID,
      requestId: REQUEST_ID,
      actorUserId: ACTOR_ID,
      documentId: DOCUMENT_ID,
      documentVersionId: DOCUMENT_VERSION_ID,
      sourceArtifactId: ARTIFACT_ID,
      sourceFileSha256: SHA256,
      sourceByteLength: 1024,
      leaseGeneration: 3,
      leaseExpiresAt: LEASE_EXPIRES_AT.toISOString(),
    });
    expect(workItems.loadActiveAutoProcessingLease).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        workItemId: WORK_ITEM_ID,
        leaseOwner: PRINCIPAL_ID,
        now: expect.any(Date),
      }),
    );
    expect(workItems.loadAuthorizationBinding).toHaveBeenCalledWith({
      workItemId: WORK_ITEM_ID,
      tenantId: TENANT_ID,
      actorUserId: ACTOR_ID,
    });
    expect(sourceAuthorization.authorizeSourceRead).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      actorUserId: ACTOR_ID,
      workItemId: WORK_ITEM_ID,
      requestId: REQUEST_ID,
      documentId: DOCUMENT_ID,
      documentVersionId: DOCUMENT_VERSION_ID,
      sourceArtifactId: ARTIFACT_ID,
      sourceFileSha256: SHA256,
      sourceByteLength: 1024,
    });
    expect(sourceResolver.resolve).toHaveBeenCalledWith(DOCUMENT_VERSION_ID, {
      requireCurrent: true,
      expectedCreatorUserId: ACTOR_ID,
    });
  });

  it.each([
    ['token', { leaseToken: '11111111-1111-4111-8111-111111111111' }],
    ['generation', { leaseGeneration: 4 }],
  ] as const)(
    'rejects a stale acknowledgement %s without accepting the active lease',
    async (_label, input) => {
      const { adapter } = fixture();

      await expect(
        adapter.authorizeActiveLease({
          tenantId: TENANT_ID,
          principalId: PRINCIPAL_ID,
          workItemId: WORK_ITEM_ID,
          leaseToken: TOKEN,
          leaseGeneration: 3,
          ...input,
        }),
      ).rejects.toMatchObject({ statusCode: 404 });
    },
  );

  it('rejects an absent enrollment or mismatched owner before source I/O', async () => {
    const state = fixture();
    state.workItems.loadActiveAutoProcessingLease.mockResolvedValueOnce(null);

    await expect(
      state.adapter.authorizeActiveLease({
        tenantId: 'other-tenant',
        principalId: PRINCIPAL_ID,
        workItemId: WORK_ITEM_ID,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(
      state.sourceAuthorization.authorizeSourceRead,
    ).not.toHaveBeenCalled();

    const wrongOwner = fixture({ requestedByUserId: 'other-user' });
    await expect(
      wrongOwner.adapter.authorizeActiveLease({
        tenantId: TENANT_ID,
        principalId: PRINCIPAL_ID,
        workItemId: WORK_ITEM_ID,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(
      wrongOwner.sourceAuthorization.authorizeSourceRead,
    ).not.toHaveBeenCalled();
  });

  it('rejects a tenant/DV/source binding change, missing owner binding or expired lease', async () => {
    const mismatch = fixture({ documentVersionId: 'DV-other' });
    await expect(
      mismatch.adapter.authorizeActiveLease({
        tenantId: TENANT_ID,
        principalId: PRINCIPAL_ID,
        workItemId: WORK_ITEM_ID,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });

    const missingOwner = fixture();
    missingOwner.workItems.loadAuthorizationBinding.mockResolvedValueOnce(null);
    await expect(
      missingOwner.adapter.authorizeActiveLease({
        tenantId: TENANT_ID,
        principalId: PRINCIPAL_ID,
        workItemId: WORK_ITEM_ID,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });

    const expired = fixture({
      leaseExpiresAt: new Date('2026-09-24T00:00:00.000Z'),
    });
    await expect(
      expired.adapter.authorizeActiveLease({
        tenantId: TENANT_ID,
        principalId: PRINCIPAL_ID,
        workItemId: WORK_ITEM_ID,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('fails closed for revoked source read/currentness but propagates infrastructure errors', async () => {
    const denied = fixture();
    denied.sourceAuthorization.authorizeSourceRead.mockResolvedValue({
      allowed: false,
      code: 'AUTO_WORK_ITEM_SOURCE_ACL_DENIED',
    });
    await expect(
      denied.adapter.authorizeActiveLease({
        tenantId: TENANT_ID,
        principalId: PRINCIPAL_ID,
        workItemId: WORK_ITEM_ID,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });

    const stale = fixture();
    stale.sourceResolver.resolve.mockRejectedValue(
      Object.assign(new Error('DOCUMENT_VERSION_NOT_CURRENT'), {
        code: 'DOCUMENT_VERSION_NOT_CURRENT',
      }),
    );
    await expect(
      stale.adapter.authorizeActiveLease({
        tenantId: TENANT_ID,
        principalId: PRINCIPAL_ID,
        workItemId: WORK_ITEM_ID,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });

    const outage = fixture();
    const failure = Object.assign(new Error('database unavailable'), {
      statusCode: 503,
    });
    outage.workItems.loadActiveAutoProcessingLease.mockRejectedValue(failure);
    await expect(
      outage.adapter.authorizeActiveLease({
        tenantId: TENANT_ID,
        principalId: PRINCIPAL_ID,
        workItemId: WORK_ITEM_ID,
      }),
    ).rejects.toBe(failure);
  });
});

function fixture(
  overrides: {
    requestedByUserId?: string;
    documentVersionId?: string;
    leaseExpiresAt?: Date;
  } = {},
) {
  const authorization = {
    tenantId: TENANT_ID,
    workItemId: WORK_ITEM_ID,
    requestId: REQUEST_ID,
    actorUserId: ACTOR_ID,
    documentId: DOCUMENT_ID,
    documentVersionId: DOCUMENT_VERSION_ID,
    sourceArtifactId: ARTIFACT_ID,
    sourceFileSha256: SHA256,
    sourceByteLength: 1024,
    grantKind: 'MIAODA_CANONICAL_PARSE_REQUEST',
    status: 'LEASED',
    leaseOwner: PRINCIPAL_ID,
    leaseToken: TOKEN,
    leaseGeneration: 3,
    leaseExpiresAt: LEASE_EXPIRES_AT,
  } satisfies AutoWorkItemLeaseBinding['authorization'];
  const row = {
    tenantId: TENANT_ID,
    workItemId: WORK_ITEM_ID,
    requestId: REQUEST_ID,
    requestedByUserId: overrides.requestedByUserId ?? ACTOR_ID,
    documentId: DOCUMENT_ID,
    documentVersionId: overrides.documentVersionId ?? DOCUMENT_VERSION_ID,
    sourceArtifactId: ARTIFACT_ID,
    sourceFileSha256: SHA256,
    sourceByteLength: 1024,
    actionType: 'PARSE_PDF',
    status: 'CANDIDATE_READBACK_VERIFIED',
    revision: 7,
    packageId: 'PKG-01',
  } satisfies AutoWorkItemLeaseBinding['workItem'];
  const workItems = {
    loadActiveAutoProcessingLease: jest.fn().mockResolvedValue({
      authorization: {
        ...authorization,
        leaseExpiresAt: overrides.leaseExpiresAt ?? LEASE_EXPIRES_AT,
      },
      workItem: row,
    } satisfies AutoWorkItemLeaseBinding),
    loadAuthorizationBinding: jest.fn().mockResolvedValue({
      workItemId: WORK_ITEM_ID,
      tenantId: TENANT_ID,
      requestId: REQUEST_ID,
      documentId: DOCUMENT_ID,
      documentVersionId: DOCUMENT_VERSION_ID,
      requestedByUserId: ACTOR_ID,
      revision: 7,
      runKey: 'canonical',
    } satisfies WorkItemAuthorizationBinding),
    loadAutoProcessingProjection: jest.fn().mockResolvedValue({
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
    }),
  } as unknown as jest.Mocked<
    Pick<
      MiaodaWorkItemRepository,
      | 'loadActiveAutoProcessingLease'
      | 'loadAuthorizationBinding'
      | 'loadAutoProcessingProjection'
    >
  >;
  const sourceResolver = {
    resolve: jest.fn().mockResolvedValue({
      version: {
        documentId: DOCUMENT_ID,
        documentVersionId: DOCUMENT_VERSION_ID,
        sourceArtifactId: ARTIFACT_ID,
        pdfSha256: SHA256,
        byteLength: 1024,
      },
      artifact: {
        sourceArtifactId: ARTIFACT_ID,
        sha256: SHA256,
        byteLength: 1024,
      },
    }),
  } as unknown as jest.Mocked<
    Pick<MiaodaDocumentVersionSourceResolver, 'resolve'>
  >;
  const sourceAuthorization = {
    authorizeSourceRead: jest.fn().mockResolvedValue({
      allowed: true as const,
      action: 'DOCUMENT_READ' as const,
      authorizationPolicy: 'MIAODA_HOST_DOCUMENT_READ' as const,
      tenantId: TENANT_ID,
      actorUserId: ACTOR_ID,
      documentId: DOCUMENT_ID,
      documentVersionId: DOCUMENT_VERSION_ID,
      sourceArtifactId: ARTIFACT_ID,
      sourceFileSha256: SHA256,
      sourceByteLength: 1024,
    }),
  } as unknown as jest.Mocked<
    Pick<AutomaticWorkItemSourceAuthorizationPort, 'authorizeSourceRead'>
  >;

  return {
    adapter: new MiaodaAutomaticWorkItemLeaseAuthorizationAdapter(
      workItems as unknown as MiaodaWorkItemRepository,
      sourceResolver as unknown as MiaodaDocumentVersionSourceResolver,
      sourceAuthorization,
    ),
    workItems,
    sourceResolver,
    sourceAuthorization,
  };
}
