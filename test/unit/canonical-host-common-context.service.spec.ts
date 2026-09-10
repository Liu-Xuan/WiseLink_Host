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

  it.each([false, true])('keeps evidence and discussion aligned for explicit selection=%s', async (explicit) => {
    const turns = Array.from({ length: 14 }, (_, index) => ({
      turnNo: index + 1,
      reviewTurnId: `RT-${index + 1}`,
      engineerSuppliedInputId: `ESI-${index + 1}`,
      reviewConversationId: 'RC-HISTORY',
      inputRevision: 2,
      userMessage: `Correction ${index + 1}`,
      attachmentBindings: [],
      assistantCandidate: null,
      createdAt: new Date('2026-09-05T05:00:00Z'),
    })) as PersistedReviewTurn[];
    const service = new CanonicalHostCommonContextService(
      {
        hasActiveOfficialActorMapping: jest.fn(async () => true),
        loadCurrent: jest.fn(async () => ({
          conversation: { reviewConversationId: 'RC-HISTORY' },
          turns: [...turns].reverse(),
        })),
      } as never,
      {} as never,
      {} as never,
    );
    const result = await service.build(workItem, {
      tenantId: 'tenant-one', actorId: 'engineer-owner',
    }, {
      asOf: '2026-09-05T06:00:00Z',
      ...(explicit ? { includedDiscussionTurnIds: turns.map((turn) => turn.reviewTurnId) } : {}),
    });
    const expected = explicit ? turns : turns.slice(-12);
    expect(result.common.discussion.turns.map((turn) => turn.question)).toEqual(
      expected.map((turn) => turn.userMessage),
    );
    expect(result.availableReadingEvidence.map((item) => item.excerpt)).toEqual(
      expected.map((turn) => turn.userMessage),
    );
    expect(result.common.discussion.omittedEarlierTurns).toBe(explicit ? 0 : 2);
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
    const identityFailure = new Error('IDENTITY_LOOKUP_UNAVAILABLE');
    conversations.hasActiveOfficialActorMapping.mockRejectedValue(
      identityFailure,
    );
    await expect(
      service.buildForWorkItem(workItem, 'tenant-one', '2026-09-05T06:00:00Z'),
    ).rejects.toBe(identityFailure);
    expect(conversations.loadCurrent).toHaveBeenCalledTimes(1);
  });

  it('isolates a failed related document while preserving authorized readable evidence and its failure reason', async () => {
    const targets = ['777-FTD-31-21002', '777-FTD-31-21003'];
    const bindings = targets.map((_, index) => ({
      workItemId: `WI-RELATED-${index}`,
      documentVersionId: `DV-RELATED-${index}`,
      requestId: `REQUEST-RELATED-${index}`,
      tenantId: 'tenant-one',
      requestedByUserId: 'engineer-owner',
      revision: 1,
    }));
    const workItems = {
      listTenantDocumentAuthorizationBindings: jest.fn(
        async (input: { documentVersionId: string }) =>
          bindings.filter(
            (binding) => binding.documentVersionId === input.documentVersionId,
          ),
      ),
      loadAuthorizationBinding: jest.fn(async (input: { workItemId: string }) =>
        bindings.find((binding) => binding.workItemId === input.workItemId),
      ),
      loadTenantScopedProjection: jest.fn(async (id: string) => {
        const binding = bindings.find((item) => item.workItemId === id)!;
        return {
          row: binding,
          projection: {
            ...workItem,
            ...binding,
            source: { documentVersionId: binding.documentVersionId },
            package: {
              ...workItem.package,
              artifact: { ref: `artifact://${id}`, sha256: 'a'.repeat(64) },
            },
          },
        };
      }),
    };
    const artifactStore = {
      persistAndReadback: jest.fn(async (_bytes: Uint8Array) => ({
        artifact: { ref: 'private://snapshot' },
      })),
      readActualBytes: jest.fn(async (artifact: { ref: string }) => {
        if (artifact.ref === 'artifact://WI-RELATED-0') {
          throw Object.assign(new Error('Private file service details'), {
            code: 'RELATED_FILE_UNAVAILABLE',
          });
        }
        return new TextEncoder().encode(
          JSON.stringify({
            sourceRefs: [
              {
                sourceRefId: 'SRC-GOOD',
                quote: 'Actual related evidence.',
                pageStart: 2,
                pageEnd: 2,
              },
            ],
          }),
        );
      }),
    };
    const service = new CanonicalHostCommonContextService(
      {
        hasActiveOfficialActorMapping: jest.fn(async () => true),
        loadCurrent: jest.fn(async () => null),
      } as never,
      workItems as never,
      artifactStore as never,
      {
        readAllSourceUnits: jest.fn(async () => [
          {
            unitId: 'U1',
            kind: 'paragraph',
            text: `For more information, refer to ${targets.join(' and ')}.`,
            sourceRefIds: ['SRC-PRIMARY'],
          },
        ]),
      } as never,
      {
        listCurrentReferenceTargets: jest.fn(async () =>
          targets.map((code, index) => ({
            canonicalDocumentNumber: code,
            documentVersionId: bindings[index].documentVersionId,
            issuerAuthority: 'BOEING',
          })),
        ),
      } as never,
    );
    const result = await service.build(
      workItem,
      { tenantId: 'tenant-one', actorId: 'engineer-owner' },
      { asOf: '2026-09-05T06:00:00Z' },
    );
    expect(result.common.relatedMaterials).toMatchObject({
      status: 'AVAILABLE',
      items: [
        {
          documentCode: targets[0],
          availability: 'UNAVAILABLE',
          reasonCodes: expect.arrayContaining(['RELATED_FILE_UNAVAILABLE']),
          availableSourceRefIds: [],
        },
        {
          documentCode: targets[1],
          availability: 'AVAILABLE',
          availableSourceRefIds: ['SRC-GOOD'],
          readFragments: [
            { sourceRefId: 'SRC-GOOD', excerpt: 'Actual related evidence.' },
          ],
        },
      ],
    });
    expect(result.related.resourceRefs.map((ref) => ref.sourceRefId)).toEqual([
      'SRC-GOOD',
    ]);
    expect(result.readingEvidence).toEqual([
      expect.objectContaining({
        evidenceRef: 'overall-evidence:related:2:1',
        kind: 'DOCUMENT_PASSAGE',
        workItemId: 'WI-RELATED-1',
        documentVersionId: 'DV-RELATED-1',
        sourceRefId: 'SRC-GOOD',
        excerpt: 'Actual related evidence.',
        locator: 'page 2-2',
      }),
    ]);
    expect(JSON.stringify(result.common)).not.toContain('WI-RELATED-1');
    const persisted = JSON.parse(
      new TextDecoder().decode(
        artifactStore.persistAndReadback.mock.calls[0][0],
      ),
    );
    expect(persisted.items[0].reasonCodes).toContain(
      'RELATED_FILE_UNAVAILABLE',
    );
    expect(JSON.stringify(result.common)).not.toContain(
      'Private file service details',
    );
    expect(workItems.loadAuthorizationBinding).toHaveBeenCalledTimes(2);
    expect(artifactStore.readActualBytes).toHaveBeenCalledTimes(2);
  });
});
