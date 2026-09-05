import type {
  CanonicalRelatedContextSnapshotItem,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import {
  CanonicalHostCommonContextService,
  projectCommonAssessmentContext,
} from '../../server/modules/canonical-host/canonical-host-common-context.service';
import type { PersistedReviewTurn } from '../../server/modules/review-persistence/review-conversation.repository';

const workItem = {
  workItemId: 'WI-COMMON',
  revision: 2,
  source: { documentVersionId: 'DV-PRIMARY' },
  package: {
    packageId: 'PKG-PRIMARY',
    title: 'Engineering issue',
    documentIdentity: { documentCode: '777-SL-31-064', businessRevision: '1' },
    artifact: { ref: 'artifact://primary' },
  },
} as CanonicalWorkItemProjection;

function material(
  code: string,
  procedure: boolean,
): CanonicalRelatedContextSnapshotItem {
  return {
    normalizedTarget: code,
    documentType: procedure ? 'AMM' : 'FTD',
    contributionRoleCandidates: [
      procedure ? 'IMPLEMENTATION_INSTRUCTION' : 'TECHNICAL_BACKGROUND',
    ],
    relationTypeCandidates: [
      procedure ? 'PROCEDURE_SUPPORT' : 'RELATED_INFORMATION',
    ],
    sourceAuthority: 'OEM_FORMAL',
    targetApplicability: 'NOT_EVALUATED',
    currentness: 'CURRENT',
    availability: 'AVAILABLE',
    reasonCodes: [],
  } as CanonicalRelatedContextSnapshotItem;
}

describe('shared pre-evaluation context', () => {
  it('keeps procedural references in the catalog while giving issue background its real fragments', () => {
    const items = [material('FTD-ISSUE', false), material('AMM-TASK', true)];
    const common = projectCommonAssessmentContext(
      workItem,
      {
        context: { status: 'AVAILABLE' },
        documentReadingStatus: 'AVAILABLE',
        items,
        sections: [
          { title: 'Problem description', sourceRefIds: ['SRC-PRIMARY'] },
        ],
        resourceRefs: items.map((item) => ({
          sourceRefId: `SRC-${item.normalizedTarget}`,
          resourceArtifactRef: 'private://artifact',
          resourceArtifactSha256: 'a'.repeat(64),
          value: {
            quote: `Actual text for ${item.normalizedTarget}`,
            relatedDocument: { normalizedTarget: item.normalizedTarget },
          },
        })),
      },
      [],
    );
    expect(common.relatedMaterials.items).toEqual([
      expect.objectContaining({
        selection: 'BACKGROUND_CANDIDATE',
        readFragments: [
          {
            sourceRefId: 'SRC-FTD-ISSUE',
            excerpt: 'Actual text for FTD-ISSUE',
          },
        ],
      }),
      expect.objectContaining({
        selection: 'PROCEDURAL_REFERENCE',
        availableSourceRefIds: ['SRC-AMM-TASK'],
        readFragments: [],
      }),
    ]);
    expect(common.documentReading.sections[0].title).toBe(
      'Problem description',
    );
    expect(JSON.stringify(common)).not.toMatch(
      /private:\/\/|WI-COMMON|resourceArtifact/,
    );
  });

  it('reports bounded history honestly, retaining later corrections in chronological order', () => {
    const turns = Array.from({ length: 14 }, (_, index) => ({
      turnNo: index + 1,
      inputRevision: 2,
      userMessage: `Discussion ${index + 1}`,
      attachmentBindings: [],
      assistantCandidate: null,
    })) as PersistedReviewTurn[];
    const common = projectCommonAssessmentContext(
      workItem,
      {
        context: {
          status: 'UNAVAILABLE',
          reason: 'RELATED_CONTEXT_RUNTIME_NOT_CONFIGURED',
        },
        items: [],
        documentReadingStatus: 'UNAVAILABLE',
        sections: [],
        resourceRefs: [],
      },
      turns.reverse(),
    );
    expect(common.discussion).toMatchObject({
      totalPriorTurns: 14,
      omittedEarlierTurns: 2,
      usage: 'DISCUSSION_NOT_ADOPTION',
    });
    expect(common.discussion.turns.map((turn) => turn.turnNo)).toEqual([
      3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    ]);
    expect(common.knowledgeRetrieval).toEqual({
      status: 'NOT_CONNECTED',
      fragments: [],
    });
  });

  it('builds before any evaluation using the WorkItem owner, not a service identity', async () => {
    const conversations = {
      loadCurrent: jest.fn(async () => null),
      hasActiveOfficialActorMapping: jest.fn(async () => true),
    };
    const workItems = {
      loadTenantScopedProjection: jest.fn(async () => ({
        row: {
          requestedByUserId: 'engineer-owner',
          documentVersionId: 'DV-PRIMARY',
        },
        projection: workItem,
      })),
    };
    const artifactStore = {
      persistAndReadback: jest.fn(async () => ({
        artifact: { ref: 'private://snapshot' },
      })),
    };
    const reader = {
      readAllSourceUnits: jest.fn(async () => [
        {
          unitId: 'U1',
          kind: 'heading',
          text: 'Problem description',
          sourceRefIds: ['SRC-PRIMARY'],
        },
      ]),
    };
    const service = new CanonicalHostCommonContextService(
      conversations as never,
      workItems as never,
      artifactStore as never,
      reader as never,
    );
    const result = await service.buildForWorkItem(
      workItem,
      'tenant-one',
      '2026-09-05T06:00:00Z',
    );
    expect(conversations.loadCurrent).toHaveBeenCalledWith({
      tenantId: 'tenant-one',
      actorId: 'engineer-owner',
      workItemId: 'WI-COMMON',
    });
    expect(result).toMatchObject({
      documentReading: { status: 'AVAILABLE' },
      discussion: { status: 'NO_PRIOR_DISCUSSION' },
    });
    expect(workItem.integratedAssessment).toBeUndefined();
    conversations.hasActiveOfficialActorMapping.mockResolvedValue(false);
    const denied = await service.buildForWorkItem(
      workItem,
      'tenant-one',
      '2026-09-05T06:00:00Z',
    );
    expect(denied.discussion.status).toBe('ACCESS_DENIED');
    expect(conversations.loadCurrent).toHaveBeenCalledTimes(1);
    artifactStore.persistAndReadback.mockRejectedValue(
      new Error('RELATED_SNAPSHOT_UNAVAILABLE'),
    );
    const partial = await service.buildForWorkItem(
      workItem,
      'tenant-one',
      '2026-09-05T06:00:00Z',
    );
    expect(partial.documentReading.status).toBe('AVAILABLE');
    expect(partial.relatedMaterials).toMatchObject({
      status: 'UNAVAILABLE',
      reason: 'RELATED_SNAPSHOT_UNAVAILABLE',
    });
  });
});
