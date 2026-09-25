import type { CanonicalObjectAccessPort } from '../../server/modules/work-item/canonical-object-access.port';
import type { MiaodaDocumentVersionSourceResolver } from '../../server/modules/work-item/miaoda-document-version-source.resolver';
import type { MiaodaWorkItemRepository } from '../../server/modules/work-item/miaoda-work-item.repository';
import type { CanonicalHostActor } from '../../server/modules/canonical-host/canonical-host.types';
import type {
  EngineeringMatterRepository,
  EngineeringMatterSnapshot,
} from '../../server/modules/canonical-host/engineering-matter.repository';
import { EngineeringMatterService } from '../../server/modules/canonical-host/engineering-matter.service';

const snapshot: EngineeringMatterSnapshot = {
  matterId: 'MAT-1',
  tenantId: 'tenant-A',
  title: 'Cross-document engineering matter',
  status: 'ACTIVE',
  currentRevisionNo: 2,
  currentMatterRevisionId: 'MREV-2',
  changeKind: 'WORK_ITEM_LINKED',
  changeSummary: 'Linked the second real document WorkItem.',
  revisionCreatedAt: new Date('2026-08-30T00:00:00.000Z'),
  links: [
    {
      workItemId: 'WI-FTD',
      ordinal: 1,
      relationRole: 'PRIMARY',
      linkedAtWorkItemRevision: 4,
    },
    {
      workItemId: 'WI-SB',
      ordinal: 2,
      relationRole: 'RELATED',
      linkedAtWorkItemRevision: 6,
    },
  ],
};

describe('EngineeringMatterService', () => {
  it('links a verified uploaded WorkItem to its family Matter only once', async () => {
    const linked: string[] = [];
    const matters = {
      ensureFamilyMatter: jest
        .fn()
        .mockResolvedValue({ matterId: 'MAT-1', created: false }),
      loadCurrent: jest.fn().mockImplementation(() =>
        Promise.resolve({
          ...snapshot,
          links: linked.map((workItemId) => ({
            workItemId,
            ordinal: 1,
            relationRole: 'RELATED',
            linkedAtWorkItemRevision: 5,
          })),
        }),
      ),
      linkWorkItem: jest.fn().mockImplementation(({ workItemId }) => {
        linked.push(workItemId);
        return Promise.resolve({ linked: true, replayed: false });
      }),
    };
    const workItems = {
      loadTenantScopedProjection: jest
        .fn()
        .mockResolvedValue(workItem('WI-FTD')),
    };
    const documentVersions = {
      resolve: jest.fn().mockResolvedValue(documentVersion('DV-FTD')),
    };
    const objectAccess = {
      freshRead: jest.fn().mockResolvedValue({
        allowed: true,
        workItemId: 'WI-FTD',
        documentVersionId: 'DV-FTD',
      }),
    };
    const actorTransactions = {
      withBrowserActorTransaction: jest
        .fn()
        .mockImplementation((_, work) => work({ database: {} })),
    };
    const service = new EngineeringMatterService(
      matters as unknown as EngineeringMatterRepository,
      workItems as unknown as MiaodaWorkItemRepository,
      documentVersions as unknown as MiaodaDocumentVersionSourceResolver,
      objectAccess as unknown as CanonicalObjectAccessPort,
      actorTransactions as never,
    );
    const input = {
      actor: nativeActor(),
      documentVersionId: 'DV-FTD',
      workItemId: 'WI-FTD',
    };
    await service.organizeWorkItemIntake(input);
    await service.organizeWorkItemIntake(input);
    expect(matters.linkWorkItem).toHaveBeenCalledTimes(1);
    expect(matters.linkWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'intake:WI-FTD',
        workItemRevision: 5,
      }),
    );
    expect(matters.ensureFamilyMatter).toHaveBeenCalledTimes(2);
    expect(actorTransactions.withBrowserActorTransaction).toHaveBeenCalledWith(
      'actor-A',
      expect.any(Function),
    );
  });

  it('rejects an intake source that differs from the authorized WorkItem', async () => {
    const matters = { ensureFamilyMatter: jest.fn() };
    const workItems = {
      loadTenantScopedProjection: jest
        .fn()
        .mockResolvedValue(workItem('WI-FTD')),
    };
    const documentVersions = {
      resolve: jest.fn().mockResolvedValue(documentVersion('DV-FTD')),
    };
    const objectAccess = {
      freshRead: jest.fn().mockResolvedValue({
        allowed: true,
        workItemId: 'WI-FTD',
        documentVersionId: 'DV-FTD',
      }),
    };
    const service = new EngineeringMatterService(
      matters as unknown as EngineeringMatterRepository,
      workItems as unknown as MiaodaWorkItemRepository,
      documentVersions as unknown as MiaodaDocumentVersionSourceResolver,
      objectAccess as unknown as CanonicalObjectAccessPort,
    );
    await expect(
      service.organizeWorkItemIntake({
        actor: nativeActor(),
        documentVersionId: 'DV-SB',
        workItemId: 'WI-FTD',
      }),
    ).rejects.toMatchObject({
      code: 'ENGINEERING_MATTER_WORK_ITEM_DOCUMENT_CONFLICT',
    });
    expect(matters.ensureFamilyMatter).not.toHaveBeenCalled();
  });

  it('returns a browser-safe catalog while fresh-reading each WorkItem and DocumentVersion owner', async () => {
    const matters = {
      loadCurrent: jest.fn().mockResolvedValue(snapshot),
    };
    const workItems = {
      loadTenantScopedProjection: jest
        .fn()
        .mockImplementation((workItemId: string) =>
          Promise.resolve(workItem(workItemId)),
        ),
    };
    const documentVersions = {
      resolve: jest
        .fn()
        .mockImplementation((documentVersionId: string) =>
          Promise.resolve(documentVersion(documentVersionId)),
        ),
    };
    const objectAccess = {
      freshRead: jest.fn().mockImplementation(({ accessRoot }) =>
        Promise.resolve({
          allowed: true,
          workItemId: accessRoot.id,
          documentVersionId: accessRoot.id === 'WI-FTD' ? 'DV-FTD' : 'DV-SB',
        }),
      ),
    };
    const service = new EngineeringMatterService(
      matters as unknown as EngineeringMatterRepository,
      workItems as unknown as MiaodaWorkItemRepository,
      documentVersions as unknown as MiaodaDocumentVersionSourceResolver,
      objectAccess as unknown as CanonicalObjectAccessPort,
    );

    const readModel = await service.read('MAT-1', actor());

    expect(readModel).toEqual({
      schemaVersion: 'wiselink.3_1.engineering_matter_catalog.v1',
      matterId: 'MAT-1',
      title: 'Cross-document engineering matter',
      status: 'ACTIVE',
      currentRevision: {
        matterRevisionId: 'MREV-2',
        revisionNo: 2,
        changeKind: 'WORK_ITEM_LINKED',
        changeSummary: 'Linked the second real document WorkItem.',
        createdAt: '2026-08-30T00:00:00.000Z',
      },
      catalog: {
        scope: 'CROSS_WORK_ITEM',
        entries: [
          expect.objectContaining({
            workItemId: 'WI-FTD',
            relationRole: 'PRIMARY',
            linkedAtWorkItemRevision: 4,
            currentWorkItemRevision: 5,
            workItemChangedSinceLink: true,
            document: expect.objectContaining({ documentCode: '777-FTD' }),
            sourceNavigation: {
              status: 'AVAILABLE',
              sourceRefCount: 239,
              structuredContentPath:
                '/api/canonical-host/work-items/WI-FTD/structured-content',
            },
          }),
          expect.objectContaining({
            workItemId: 'WI-SB',
            relationRole: 'RELATED',
            linkedAtWorkItemRevision: 6,
            currentWorkItemRevision: 6,
            workItemChangedSinceLink: false,
            document: expect.objectContaining({ documentCode: '737-SB' }),
            sourceNavigation: {
              status: 'AVAILABLE',
              sourceRefCount: 76,
              structuredContentPath:
                '/api/canonical-host/work-items/WI-SB/structured-content',
            },
          }),
        ],
      },
      authorization: {
        policy: 'ALL_LINKED_WORK_ITEMS_REQUIRED',
        authorizedWorkItemCount: 2,
      },
      authority: {
        workItemCurrentRemainsAuthoritative: true,
        documentManagementRemainsAuthoritative: true,
        sourceRefsRemainWorkItemScoped: true,
        matterCreatesAssessmentCurrent: false,
      },
    });
    expect(objectAccess.freshRead).toHaveBeenCalledTimes(2);
    expect(workItems.loadTenantScopedProjection).toHaveBeenCalledTimes(2);
    expect(documentVersions.resolve).toHaveBeenCalledTimes(2);
    expect(matters.loadCurrent).toHaveBeenCalledTimes(2);

    const serialized = JSON.stringify(readModel);
    for (const forbidden of [
      'tenant-A',
      'actor-A',
      'tenantId',
      'actorUserId',
      'packageId',
      'artifactRef',
      'sourceArtifactId',
      'sourceFileSha256',
      'packageArtifactSha256',
      'bucketId',
      'filePath',
      'permissionSnapshotVersion',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).not.toMatch(/sha256:[0-9a-f]{64}/u);
  });

  it('fails the whole catalog read when any linked WorkItem fresh ACL denies', async () => {
    const matters = { loadCurrent: jest.fn().mockResolvedValue(snapshot) };
    const objectAccess = {
      freshRead: jest.fn().mockImplementation(({ accessRoot }) =>
        Promise.resolve(
          accessRoot.id === 'WI-SB'
            ? {
                allowed: false,
                code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
                statusCode: 404,
              }
            : {
                allowed: true,
                workItemId: 'WI-FTD',
                documentVersionId: 'DV-FTD',
              },
        ),
      ),
    };
    const service = new EngineeringMatterService(
      matters as unknown as EngineeringMatterRepository,
      {
        loadTenantScopedProjection: jest
          .fn()
          .mockResolvedValue(workItem('WI-FTD')),
      } as unknown as MiaodaWorkItemRepository,
      {
        resolve: jest.fn().mockResolvedValue(documentVersion('DV-FTD')),
      } as unknown as MiaodaDocumentVersionSourceResolver,
      objectAccess as unknown as CanonicalObjectAccessPort,
    );

    await expect(service.read('MAT-1', actor())).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
    expect(matters.loadCurrent).toHaveBeenCalledTimes(1);
  });
});

function workItem(workItemId: string) {
  const ftd = workItemId === 'WI-FTD';
  const documentVersionId = ftd ? 'DV-FTD' : 'DV-SB';
  return {
    row: {
      workItemId,
      tenantId: 'tenant-A',
      documentId: ftd ? 'DOC-FTD' : 'DOC-SB',
      documentVersionId,
      revision: ftd ? 5 : 6,
      status: 'candidate_readback_verified',
    },
    projection: {
      workItemId,
      revision: ftd ? 5 : 6,
      source: { documentVersionId },
      package: {
        packageId: `urn:techpub:package:v1:sha256:${ftd ? 'a'.repeat(64) : 'b'.repeat(64)}`,
        sourceRefCount: ftd ? 239 : 76,
      },
    },
  };
}

function documentVersion(documentVersionId: string) {
  const ftd = documentVersionId === 'DV-FTD';
  return {
    version: {
      documentId: ftd ? 'DOC-FTD' : 'DOC-SB',
      documentVersionId,
      businessRevision: ftd ? '2025-09-26' : 'Original Issue',
    },
    family: {
      familyId: ftd ? 'FAMILY-FTD' : 'FAMILY-SB',
      canonicalDocumentNumber: ftd ? '777-FTD' : '737-SB',
      documentFamily: ftd ? 'FTD' : 'SB',
      currentDocumentVersionId: documentVersionId,
      currentGeneration: 1,
    },
  };
}

function actor(): CanonicalHostActor {
  return {
    userId: 'actor-A',
    tenantId: 'tenant-A',
    appId: 'app_17bzc551rsg',
    roles: [],
    env: 'runtime',
    objectAccessActor: {} as NonNullable<
      CanonicalHostActor['objectAccessActor']
    >,
  };
}

function nativeActor(): CanonicalHostActor {
  const value = actor();
  return {
    ...value,
    objectAccessActor: {
      principalKind: 'FINAL_USER',
      transport: 'MIAODA_AUTHENTICATED_HTTP',
      canonicalSubject: { namespace: 'MIAODA_USER_ID', id: value.userId },
      subjectDecision: {
        source: 'MIAODA_GATEWAY_USER_CONTEXT',
        applicationScopeId: value.appId,
        tenantId: value.tenantId,
        version: 'miaoda-hosted-native-sso.v1',
      },
      tenantId: value.tenantId,
      applicationScopeId: value.appId,
      applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT',
      workspaceId: null,
      workspaceProvenance: 'UNAVAILABLE',
      env: 'runtime',
      identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT',
      feishuUserId: null,
      feishuOpenId: null,
      feishuIdentityProvenance: 'UNAVAILABLE',
      sessionId: null,
      sessionRevision: null,
      sessionProvenance: 'UNAVAILABLE',
    } as NonNullable<CanonicalHostActor['objectAccessActor']>,
  };
}
