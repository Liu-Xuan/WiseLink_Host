import { CanonicalHostLibraryIndexService } from '../../server/modules/canonical-host/canonical-host-library-index.service';
import type { CanonicalHostActor } from '../../server/modules/canonical-host/canonical-host.types';
import type { CanonicalWorkItemProjection } from '../../shared/api.interface';

const actor: CanonicalHostActor = {
  userId: 'engineer-1001',
  tenantId: 'tenant-2001',
  appId: 'app_17bzc551rsg',
  roles: ['authenticated'],
  env: 'test',
};

const projection = {
  schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
  workItemId: 'WI-LIBRARY-1',
  requestId: 'REQ-LIBRARY-1',
  revision: 4,
  phase: 'CANDIDATE_READBACK_VERIFIED',
  permissionSnapshotVersion: 'permission-snapshot:test',
  parseAuthorization: {} as never,
  source: {
    documentId: 'document-1',
    documentVersionId: 'document-version-1',
    sourceArtifactId: 'source-1',
    sourceFileSha256: 'a'.repeat(64),
    sourceByteLength: 10,
    driveSourceVersion: 'v1',
  },
  classification: {
    status: 'CONFIRMED',
    normalizedFamily: 'SB',
  },
  package: null,
  failure: null,
  recordingFailure: null,
} as unknown as CanonicalWorkItemProjection;

function target(
  overrides: {
    row?: Record<string, unknown>;
    scoped?: unknown;
    decision?: Record<string, unknown>;
  } = {},
) {
  const repository = {
    loadTenantScopedProjection: jest.fn().mockResolvedValue(
      overrides.scoped === undefined
        ? {
            row: {
              workItemId: projection.workItemId,
              tenantId: actor.tenantId,
              requestId: projection.requestId,
              documentVersionId: projection.source.documentVersionId,
              documentId: projection.source.documentId,
              ...(overrides.row ?? {}),
            },
            projection,
          }
        : overrides.scoped,
    ),
  };
  const resolver = {
    resolve: jest.fn().mockResolvedValue({
      version: {
        documentId: projection.source.documentId,
        documentVersionId: projection.source.documentVersionId,
        businessRevision: 'Original Issue',
      },
      family: {
        familyId: 'family-1',
        canonicalDocumentNumber: '737-34-3830',
        documentFamily: 'SB',
        currentDocumentVersionId: projection.source.documentVersionId,
        currentGeneration: 1,
      },
    }),
  };
  const authorization = {
    authorize: jest.fn().mockResolvedValue(
      overrides.decision ?? {
        action: 'READ_LIBRARY_INDEX',
        allowed: true,
        decisionId: 'decision-1',
        decisionHash: 'hash-1',
        actorFingerprint: 'actor-1',
        permissionSnapshotVersion: 'permission-snapshot:test',
      },
    ),
  };
  const permissions = {
    freshRead: jest.fn().mockResolvedValue({
      permissionSnapshotVersion: 'permission-snapshot:test',
    }),
  };
  return {
    repository,
    resolver,
    authorization,
    permissions,
    service: new CanonicalHostLibraryIndexService(
      repository as never,
      resolver as never,
      authorization as never,
      permissions as never,
    ),
  };
}

describe('CanonicalHostLibraryIndexService', () => {
  it('scopes WorkItem lookup by tenant and returns currentness-backed thin projection', async () => {
    const { service, repository, authorization, resolver } = target();

    const result = await service.read({
      workItemId: projection.workItemId,
      actor,
    });

    expect(repository.loadTenantScopedProjection).toHaveBeenCalledWith(
      projection.workItemId,
      actor.tenantId,
    );
    expect(authorization.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'READ_LIBRARY_INDEX',
        workItemId: projection.workItemId,
      }),
    );
    expect(result.scope).toBe('CURRENT_WORKITEM_ONLY');
    expect(result.document).toEqual(
      expect.objectContaining({
        documentId: 'document-1',
        documentVersionId: 'document-version-1',
        documentCode: '737-34-3830',
      }),
    );
    expect(result.currentness.selectedVersionIsCurrent).toBe(true);
    expect(result.workItem.currentJobAidWorkRevisionRef).toBeNull();
    expect(result.readAuthorization.action).toBe('READ_LIBRARY_INDEX');
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
  });

  it('binds the graph read to the JobAid identity saved in the same WorkItem projection', async () => {
    const withJobAid = {
      ...projection,
      integratedAssessment: {
        baseRules: {
          schemaVersion: 'wiselink.jobaid-problem-result.v2',
          workRevisionRef: 'JAWR-EXACT-7',
          status: 'CANDIDATE_ONLY',
          revision: 7,
          issueCount: 1,
          openQuestionCount: 0,
          artifact: { ref: 'artifact-7', sha256: 'a'.repeat(64) },
          actionAttemptId: 'attempt-7',
        },
      },
    } as unknown as CanonicalWorkItemProjection;
    const { service } = target({
      scoped: {
        row: {
          workItemId: projection.workItemId,
          tenantId: actor.tenantId,
          documentId: projection.source.documentId,
          documentVersionId: projection.source.documentVersionId,
        },
        projection: withJobAid,
      },
    });
    const result = await service.read({ workItemId: projection.workItemId, actor });
    expect(result.workItem.currentJobAidWorkRevisionRef).toBe('JAWR-EXACT-7');
  });

  it('returns the same 404 boundary for a missing or cross-tenant WorkItem', async () => {
    const { service, repository, authorization, permissions, resolver } =
      target({
        scoped: null,
      });
    authorization.authorize.mockRejectedValue(
      Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {
        code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
        statusCode: 404,
      }),
    );

    await expect(
      service.read({ workItemId: 'WI-OTHER-TENANT', actor }),
    ).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
    expect(authorization.authorize).toHaveBeenCalledTimes(1);
    expect(repository.loadTenantScopedProjection).not.toHaveBeenCalled();
    expect(permissions.freshRead).not.toHaveBeenCalled();
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('returns the same 404 on a denied decision before projection, DM, or permission reads', async () => {
    const { service, repository, authorization, permissions, resolver } =
      target({
        decision: {
          action: 'READ_LIBRARY_INDEX',
          allowed: false,
          decisionId: 'decision-denied',
          permissionSnapshotVersion: 'permission-snapshot:test',
        },
      });

    await expect(
      service.read({ workItemId: projection.workItemId, actor }),
    ).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
    expect(repository.loadTenantScopedProjection).not.toHaveBeenCalled();
    expect(permissions.freshRead).not.toHaveBeenCalled();
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('projects historical selected versions without claiming they are current', async () => {
    const context = target();
    context.resolver.resolve.mockResolvedValue({
      version: {
        documentId: projection.source.documentId,
        documentVersionId: projection.source.documentVersionId,
        businessRevision: 'Issue 1',
      },
      family: {
        familyId: 'family-1',
        canonicalDocumentNumber: '737-34-3830',
        documentFamily: 'SB',
        currentDocumentVersionId: 'document-version-2',
        currentGeneration: 2,
      },
    });
    const historical = await context.service.read({
      workItemId: projection.workItemId,
      actor,
    });
    expect(historical.currentness.selectedVersionIsCurrent).toBe(false);
    expect(historical.currentness.currentGeneration).toBe(2);
  });
});
