import type { CanonicalWorkItemProjection } from '@shared/api.interface';

import { CanonicalLibraryCatalogService } from '../../server/modules/canonical-host/canonical-library-catalog.service';
import type { CanonicalHostActor } from '../../server/modules/canonical-host/canonical-host.types';

const actor: CanonicalHostActor = {
  userId: 'engineer-1001',
  tenantId: 'tenant-2001',
  appId: 'app_17bzc551rsg',
  roles: ['authenticated'],
  env: 'online',
  objectAccessActor: {
    principalKind: 'FINAL_USER',
    transport: 'MIAODA_AUTHENTICATED_HTTP',
    canonicalSubject: { namespace: 'MIAODA_USER_ID', id: 'engineer-1001' },
    subjectDecision: {
      source: 'MIAODA_GATEWAY_USER_CONTEXT',
      applicationScopeId: 'app_17bzc551rsg',
      tenantId: 'tenant-2001',
      version: 'test',
      decidedAt: '2026-09-01T08:00:00.000Z',
    },
    tenantId: 'tenant-2001',
    applicationScopeId: 'app_17bzc551rsg',
    applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT',
    workspaceId: null,
    workspaceProvenance: 'UNAVAILABLE',
    env: 'online',
    platformRoles: ['authenticated'],
    identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT',
    feishuUserId: null,
    feishuOpenId: null,
    feishuIdentityProvenance: 'UNAVAILABLE',
    sessionId: null,
    sessionRevision: null,
    sessionProvenance: 'UNAVAILABLE',
  },
};

const statement = (text: string, sourceRefIds: string[]) => ({
  text,
  basis: 'SOURCE_FACT' as const,
  sourceRefIds,
});

const projection = {
  schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
  workItemId: 'WI-CATALOG-1',
  requestId: 'REQ-CATALOG-1',
  revision: 7,
  phase: 'CANDIDATE_READBACK_VERIFIED',
  permissionSnapshotVersion: 'permission-snapshot:test',
  parseAuthorization: {} as never,
  source: {
    documentId: 'document-1',
    documentVersionId: 'document-version-1',
    sourceArtifactId: 'source-artifact-internal',
    sourceFileSha256: 'a'.repeat(64),
    sourceByteLength: 1024,
    driveSourceVersion: 'v1',
  },
  classification: { status: 'CONFIRMED', normalizedFamily: 'B737' },
  package: {
    title: '737 Navigation Software Change',
    packageId: 'package-internal',
    contentUnitCount: 75,
    sourceRefCount: 76,
    resultStatus: 'complete',
    artifact: { ref: 'artifact-internal', sha256: 'b'.repeat(64) },
  },
  integratedAssessment: {
    status: 'OVERALL_CANDIDATE_READY',
    baseRules: {
      status: 'CANDIDATE_ONLY',
      revision: 2,
      sourceResultId: 'result-internal',
      criterionSetId: 'criteria-internal',
      criterionCount: 150,
      evaluationItemCount: 150,
      unresolvedCount: 3,
      sourceBoundCandidateCount: 147,
      artifact: { ref: 'base-artifact', sha256: 'c'.repeat(64) },
      actionAttemptId: 'attempt-internal',
    },
    overallSynthesis: {
      status: 'CANDIDATE_ONLY',
      revision: 2,
      sourceResultId: 'overall-result-internal',
      basedOnBaseRuleRevision: 2,
      basedOnBaseRuleArtifactSha256: 'd'.repeat(64),
      basedOnEngineerReviewRevision: null,
      basedOnEngineerReviewArtifactSha256: null,
      discoveryStatus: 'NOT_REQUESTED',
      gap: null,
      candidateRefCount: 2,
      findingCount: 1,
      unresolvedCount: 1,
      authorityLevel: 'candidate_only',
      externalDiscoveryIsEvidence: false,
      artifact: { ref: 'overall-artifact', sha256: 'e'.repeat(64) },
      actionAttemptId: 'overall-attempt-internal',
      staleReason: null,
      missingInputs: ['需要当前机队构型事实'],
      engineeringSummary: {
        schemaVersion: 'wiselink.3_1.overall_engineering_summary.v1',
        conclusion: statement('当前适用性取决于受控机队构型。', ['SRC-9']),
        whyItMatters: [statement('涉及导航软件并行要求。', ['SRC-10'])],
        applicability: {
          sourceScope: statement('文件适用于指定生产线号。', ['SRC-9']),
          fleetMatch: statement('尚待绑定当前机队事实。', ['SRC-11']),
          requiredFacts: [statement('补充受控机队构型。', ['SRC-11'])],
        },
        implementationImpact: [
          statement('实施前需核对并行软件要求。', ['SRC-10']),
        ],
        dispositionPriority: [],
        nextActions: [statement('进入工作台核对 P10。', ['SRC-10'])],
      },
    },
  },
  failure: null,
  recordingFailure: null,
} as unknown as CanonicalWorkItemProjection;

function accessGrant(workItemId = projection.workItemId) {
  return {
    allowed: true as const,
    action: 'READ_WORK_ITEM' as const,
    accessRoot: { kind: 'WORK_ITEM' as const, id: workItemId },
    workItemId,
    workItemRevision: projection.revision,
    requestId: projection.requestId,
    documentVersionId: projection.source.documentVersionId,
    tenantId: actor.tenantId,
    applicationScopeId: actor.appId,
  } as never;
}

function target() {
  const row = {
    workItemId: projection.workItemId,
    revision: projection.revision,
    status: projection.phase,
    documentId: projection.source.documentId,
    documentVersionId: projection.source.documentVersionId,
    requestedByUserId: actor.userId,
    createdAt: new Date('2026-09-01T08:00:00.000Z'),
    updatedAt: new Date('2026-09-01T09:00:00.000Z'),
    projection,
    documentCode: '737-34-3830',
    documentFamily: 'B737',
    businessRevision: 'Original Issue',
    currentDocumentVersionId: projection.source.documentVersionId,
    currentGeneration: 1,
  };
  const workItems = {
    listOwnedLibraryCatalog: jest.fn().mockResolvedValue([row]),
    listOwnedLibraryFamilies: jest.fn().mockResolvedValue(['B737']),
    loadTenantScopedProjection: jest.fn().mockResolvedValue({
      row,
      projection,
    }),
  };
  const documentVersions = {
    resolve: jest.fn().mockResolvedValue({
      version: {
        documentId: projection.source.documentId,
        documentVersionId: projection.source.documentVersionId,
        businessRevision: 'Original Issue',
      },
      family: {
        canonicalDocumentNumber: '737-34-3830',
        documentFamily: 'B737',
        currentDocumentVersionId: projection.source.documentVersionId,
        currentGeneration: 1,
      },
    }),
  };
  const objectAccess = {
    freshRead: jest.fn().mockResolvedValue(accessGrant()),
  };
  return {
    workItems,
    documentVersions,
    objectAccess,
    service: new CanonicalLibraryCatalogService(
      workItems as never,
      documentVersions as never,
      objectAccess as never,
    ),
  };
}

describe('CanonicalLibraryCatalogService', () => {
  it('returns a creator-owned paginated catalog without browser history or internal source identities', async () => {
    const context = target();
    const result = await context.service.read(
      { view: 'document', query: '737', limit: 24 },
      actor,
    );

    expect(context.workItems.listOwnedLibraryCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        query: '737',
        limit: 25,
      }),
    );
    expect(result.scope).toMatchObject({
      mode: 'CREATOR_OWNED',
      allAuthorizedAvailable: false,
    });
    expect(result.items[0]).toMatchObject({
      displayCode: '737-34-3830',
      document: { currentness: 'CURRENT' },
      assessment: {
        jobAid: { completed: 147, total: 150, waiting: 3 },
      },
    });
    const browserPayload = JSON.stringify(result);
    for (const internal of [
      actor.userId,
      actor.tenantId,
      'document-version-1',
      'source-artifact-internal',
      'package-internal',
      'artifact-internal',
      'criteria-internal',
    ]) {
      expect(browserPayload).not.toContain(internal);
    }
  });

  it('returns a source-bound quicklook while preserving unknown family counts', async () => {
    const context = target();
    const result = await context.service.quicklook(
      projection.workItemId,
      actor,
    );

    expect(result).toMatchObject({
      objectKind: 'WORKITEM',
      displayCode: '737-34-3830',
      authorityState: 'CANDIDATE',
      freshness: 'CURRENT',
      basedOnRevision: 7,
      currentJudgment: {
        text: '当前适用性取决于受控机队构型。',
        sourceRefIds: ['SRC-9'],
      },
      familySummary: {
        historicalVersionCount: null,
        attachmentCount: null,
      },
    });
    expect(result.keyEvidence.map((item) => item.sourceRefId)).toEqual(
      expect.arrayContaining(['SRC-9', 'SRC-10']),
    );
    expect(result.unresolvedQuestions).toContain('需要当前机队构型事实');
    const browserPayload = JSON.stringify(result);
    expect(browserPayload).not.toContain('document-version-1');
    expect(browserPayload).not.toContain('source-artifact-internal');
    expect(browserPayload).not.toContain('overall-attempt-internal');
  });

  it('stops before WorkItem and DocumentVersion reads when fresh access is denied', async () => {
    const context = target();
    context.objectAccess.freshRead.mockResolvedValue({
      allowed: false,
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });

    await expect(
      context.service.quicklook('WI-OTHER', actor),
    ).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
    expect(context.workItems.loadTenantScopedProjection).not.toHaveBeenCalled();
    expect(context.documentVersions.resolve).not.toHaveBeenCalled();
  });
});
