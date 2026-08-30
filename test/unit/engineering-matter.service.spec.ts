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
              packageId: 'PKG-WI-FTD',
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
              packageId: 'PKG-WI-SB',
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
      'artifactRef',
      'bucketId',
      'filePath',
      'permissionSnapshotVersion',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
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
        packageId: `PKG-${workItemId}`,
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
