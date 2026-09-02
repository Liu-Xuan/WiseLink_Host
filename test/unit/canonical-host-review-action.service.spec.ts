import { createHash } from 'node:crypto';

import type {
  CanonicalWorkItemProjection,
  ReviewActionDraftCandidate,
} from '@shared/api.interface';
import { CanonicalHostEngineerReviewService } from '../../server/modules/canonical-host/canonical-host-engineer-review.service';
import { CanonicalHostReviewActionService } from '../../server/modules/canonical-host/canonical-host-review-action.service';
import { buildSelectiveOverallResynthesisPlan } from '../../server/modules/canonical-host/selective-overall-resynthesis';
import { encodeReviewAttachmentParsedArtifact } from '../../server/modules/review-persistence/review-attachment-artifact';

const actor = {
  canonicalSubject: { namespace: 'MIAODA_USER_ID', id: 'actor-1' },
  tenantId: 'tenant-1',
  applicationScopeId: 'app_17bzc551rsg',
  platformRoles: [],
  env: 'preview',
  identityProvenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
  sessionProvenance: 'SERVER_OPAQUE_SESSION',
};

const CONFIRM_INPUT = {
  reviewActionDraftRef: 'RAD-DRAFT-1',
  expectedRevision: 7,
};

describe('CanonicalHostReviewActionService', () => {
  it('derives the ReviewAction entirely from the stored current draft and reads back revision + STALE', async () => {
    const harness = target();
    const result = await harness.service.confirmDraft(
      'WI-1',
      'RC-1',
      'RT-1',
      CONFIRM_INPUT,
      {} as never,
    );

    expect(harness.objectAccess.freshRead).toHaveBeenCalledWith({
      actor,
      action: 'RECORD_ENGINEER_REVIEW',
      accessRoot: { kind: 'WORK_ITEM', id: 'WI-1' },
    });
    expect(harness.engineerReviews.recordReviewAction).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: 'WI-1',
        expectedRevision: 7,
        criterionId: 'RULE-1',
        affectedCriterionIds: ['RULE-1', 'RULE-2'],
        actionType: 'SUPPLEMENT_EVIDENCE',
        evidence: [
          expect.objectContaining({
            kind: 'ENGINEER_TEXT',
            locator: 'engineer-input:ESI-1',
          }),
          expect.objectContaining({
            kind: 'ATTACHMENT',
            locator: 'ATTACHMENT-1',
          }),
        ],
      }),
      expect.objectContaining({
        userId: 'actor-1',
        tenantId: 'tenant-1',
        objectAccessActor: actor,
      }),
    );
    expect(harness.conversations.syncAfterReviewAction).toHaveBeenCalledWith({
      conversation: harness.conversation,
      expectedRevision: 7,
      currentRevision: 8,
    });
    expect(result.reviewAction).toEqual({
      reviewActionDraftRef: 'RAD-DRAFT-1',
      evaluationItemId: 'RULE-1',
      affectedItemIds: ['RULE-1', 'RULE-2'],
      resolvedGapRefs: [],
      resolvedMissingInputs: [],
      workItemRevision: 8,
      engineerReviewRevision: 1,
      overallStatus: 'STALE',
      overallRevision: 2,
      selectiveResynthesis: 'AFFECTED_ONLY_PENDING',
      uncertaintyDispositions: [],
      decisionSnapshot: null,
    });
    const publicJson = JSON.stringify(result);
    expect(publicJson).not.toContain('actor-1');
    expect(publicJson).not.toContain('tenant-1');
    expect(publicJson).not.toContain('official-selection');
    expect(publicJson).not.toContain('artifact://attachment');
  });

  it('resolves Host-issued gap refs to missing inputs before recording engineer-confirmed evidence', async () => {
    const harness = target({ resolvedGapRefs: ['GAP-007'] });

    const result = await harness.service.confirmDraft(
      'WI-1',
      'RC-1',
      'RT-1',
      CONFIRM_INPUT,
      {} as never,
    );

    expect(
      harness.engineerReviews.resolveReviewActionGaps,
    ).toHaveBeenCalledWith(
      {
        workItemId: 'WI-1',
        expectedRevision: 7,
        gapRefs: ['GAP-007'],
        affectedCriterionIds: ['RULE-1', 'RULE-2'],
      },
      expect.objectContaining({ userId: 'actor-1', tenantId: 'tenant-1' }),
    );
    expect(harness.engineerReviews.recordReviewAction).toHaveBeenCalledWith(
      expect.objectContaining({
        affectedCriterionIds: ['RULE-1', 'RULE-2'],
        resolvedMissingInputs: ['aircraft.currentPartNumber'],
      }),
      expect.any(Object),
    );
    expect(result.reviewAction).toMatchObject({
      resolvedGapRefs: ['GAP-007'],
      resolvedMissingInputs: ['aircraft.currentPartNumber'],
    });
  });

  it('does not close a Host gap when the confirmed draft carries no engineer evidence', async () => {
    const harness = target({
      resolvedGapRefs: ['GAP-007'],
      withoutEvidence: true,
    });

    await expect(
      harness.service.confirmDraft(
        'WI-1',
        'RC-1',
        'RT-1',
        CONFIRM_INPUT,
        {} as never,
      ),
    ).rejects.toMatchObject({
      code: 'REVIEW_ACTION_GAP_EVIDENCE_REQUIRED',
      statusCode: 409,
    });
    expect(harness.engineerReviews.recordReviewAction).not.toHaveBeenCalled();
  });

  it('treats a persisted pre-gap-ledger draft as a no-gap action', async () => {
    const harness = target({ legacyDraftWithoutGapField: true });

    const result = await harness.service.confirmDraft(
      'WI-1',
      'RC-1',
      'RT-1',
      CONFIRM_INPUT,
      {} as never,
    );

    expect(result.reviewAction).toMatchObject({
      resolvedGapRefs: [],
      resolvedMissingInputs: [],
    });
    expect(
      harness.engineerReviews.resolveReviewActionGaps,
    ).not.toHaveBeenCalled();
  });

  it('rejects a stale draft before ReviewAction/CAS mutation', async () => {
    const harness = target({ workItemRevision: 8 });
    await expect(
      harness.service.confirmDraft(
        'WI-1',
        'RC-1',
        'RT-1',
        CONFIRM_INPUT,
        {} as never,
      ),
    ).rejects.toMatchObject({
      code: 'REVIEW_ACTION_DRAFT_STALE',
      statusCode: 409,
    });
    expect(harness.engineerReviews.recordReviewAction).not.toHaveBeenCalled();
  });

  it('rejects a forged draft handle before ReviewAction/CAS mutation', async () => {
    const harness = target();
    await expect(
      harness.service.confirmDraft(
        'WI-1',
        'RC-1',
        'RT-1',
        {
          reviewActionDraftRef: 'RAD-FORGED',
          expectedRevision: 7,
        },
        {} as never,
      ),
    ).rejects.toMatchObject({
      code: 'REVIEW_ACTION_DRAFT_STALE',
      statusCode: 409,
    });
    expect(harness.engineerReviews.recordReviewAction).not.toHaveBeenCalled();
  });

  it('returns not-found for a conversation bound to another WorkItem', async () => {
    const harness = target({ conversationWorkItemId: 'WI-OTHER' });
    await expect(
      harness.service.confirmDraft(
        'WI-1',
        'RC-1',
        'RT-1',
        CONFIRM_INPUT,
        {} as never,
      ),
    ).rejects.toMatchObject({
      code: 'REVIEW_CONVERSATION_NOT_FOUND',
      statusCode: 404,
    });
    expect(harness.engineerReviews.recordReviewAction).not.toHaveBeenCalled();
  });

  it('runs confirm through the real ReviewAction CAS owner and produces affected-only r2 readback', async () => {
    const harness = integratedTarget();
    const confirmed = await harness.service.confirmDraft(
      'WI-C7',
      'RC-C7',
      'RT-C7',
      CONFIRM_INPUT,
      {} as never,
    );

    expect(confirmed.reviewAction).toMatchObject({
      affectedItemIds: ['RULE-A', 'RULE-B'],
      workItemRevision: 8,
      engineerReviewRevision: 1,
      overallStatus: 'STALE',
      selectiveResynthesis: 'AFFECTED_ONLY_PENDING',
    });
    expect(harness.state.workItem.revision).toBe(8);
    expect(harness.state.workItem.integratedAssessment).toMatchObject({
      status: 'OVERALL_CANDIDATE_STALE',
      overallSynthesis: {
        status: 'STALE',
        staleReason: 'ENGINEER_REVIEW_CHANGED',
      },
    });
    const reviewContext = await harness.engineerReviews.modelContext(
      harness.state.workItem,
    );
    const plan = buildSelectiveOverallResynthesisPlan({
      criterionSetId: 'RULESET-C7',
      criterionCount: 2,
      baseRuleRevision: 1,
      baseRuleArtifactSha256: 'c'.repeat(64),
      staleOverall:
        harness.state.workItem.integratedAssessment!.overallSynthesis,
      engineerReviewProjection:
        harness.state.workItem.integratedAssessment!.engineerReviews,
      engineerReviewContext: reviewContext,
      items: dynamicItems(),
    });
    expect(plan).toMatchObject({
      mode: 'AFFECTED_ONLY',
      affectedCriterionIds: ['RULE-A', 'RULE-B'],
      reusedCriterionIds: [],
      targetOverallRevision: 2,
      currentEngineerReviewRevision: 1,
    });
  });
});

function target(
  options: {
    workItemRevision?: number;
    conversationWorkItemId?: string;
    resolvedGapRefs?: string[];
    withoutEvidence?: boolean;
    legacyDraftWithoutGapField?: boolean;
  } = {},
) {
  const attachmentArtifact = {
    storeRole: 'UnifiedArtifactStoreCandidate' as const,
    ref: 'artifact://attachment',
    sha256: 'e'.repeat(64),
    byteLength: 200,
    mediaType: 'application/json' as const,
  };
  const attachmentBinding = {
    attachmentRef: 'ATTACHMENT-1',
    documentVersionId: 'DV-ATTACHMENT-1',
    fileName: 'engineering-note.pdf',
    mediaType: 'application/pdf' as const,
    byteLength: 321,
    selectionKey: 'default-bucket\nofficial-selection/engineering-note.pdf',
    parsedArtifact: attachmentArtifact,
  };
  const reviewActionDraft: ReviewActionDraftCandidate = {
    reviewActionDraftRef: CONFIRM_INPUT.reviewActionDraftRef,
    baseRevision: 7,
    evaluationItemId: 'RULE-1',
    proposedStatus: 'review_required',
    resolvedGapRefs: [...(options.resolvedGapRefs ?? [])],
    adoptedInputRefs: options.withoutEvidence
      ? []
      : ['engineer-input:ESI-1', 'ATTACHMENT-1'],
    sourceRefs: options.withoutEvidence ? [] : ['ATTACHMENT-1'],
    assumptions: ['Attachment is applicable to the current configuration.'],
    affectedItemIds: ['RULE-1', 'RULE-2'],
    overallImpact: true,
    uncertaintyDispositions: [],
    decisionSnapshot: null,
  };
  if (options.legacyDraftWithoutGapField) {
    delete reviewActionDraft.resolvedGapRefs;
  }
  const assistantCandidate = {
    responseType: 'REVIEW_ACTION_DRAFT' as const,
    answer: 'Adopt the supplied evidence and selectively reassess.',
    sourceRefs: ['ATTACHMENT-1'],
    missingInputs: [],
    candidateEvidenceRefs: ['ATTACHMENT-1'],
    reviewActionDraft,
    affectedItemIds: ['RULE-1', 'RULE-2'],
    warnings: [],
    actionAttemptRef: 'AQ-1',
    provenance: {
      runtimeAppId: 'app_17c3zn24kv2' as const,
      profileRef: 'wiselink-engineering' as const,
      modelVersion: 'GLM-5.3',
      promptVersion: 'review-prompt.v1',
      skillVersion: 'skill-v1',
      toolVersions: {},
      resultContentHash: `sha256:${'f'.repeat(64)}`,
    },
    completedAt: '2026-08-27T00:02:00.000Z',
  };
  const turn = {
    reviewTurnId: 'RT-1',
    reviewConversationId: 'RC-1',
    engineerSuppliedInputId: 'ESI-1',
    turnNo: 1,
    requestId: 'request-1',
    inputRevision: 7,
    userMessage: 'Use the attached engineering note.',
    inputType: 'ENGINEER_TEXT',
    adoptionStatus: 'CANDIDATE_UNADOPTED',
    candidateText: 'Use the attached engineering note.',
    attachmentBindings: [attachmentBinding],
    assistantCandidate,
    createdAt: new Date('2026-08-27T00:01:00.000Z'),
  };
  const conversation = {
    reviewConversationId: 'RC-1',
    tenantId: 'tenant-1',
    actorId: 'actor-1',
    workItemId: options.conversationWorkItemId ?? 'WI-1',
    openClawAgentId: 'wiselink-engineering',
    openClawSessionKey: 'server-private-session-key',
    startedAtRevision: 7,
    lastSyncedRevision: 7,
    status: 'ACTIVE',
    createdAt: new Date('2026-08-27T00:00:00.000Z'),
    lastActiveAt: new Date('2026-08-27T00:01:00.000Z'),
    closedAt: null,
  };
  const sessions = {
    resolve: jest.fn(async () => ({
      actor,
      session: { id: 'session-1', revision: 1 },
    })),
  };
  const objectAccess = {
    freshRead: jest.fn(async () => ({
      allowed: true,
      action: 'RECORD_ENGINEER_REVIEW',
      workItemId: 'WI-1',
      workItemRevision: options.workItemRevision ?? 7,
      tenantId: 'tenant-1',
      actorUserId: 'actor-1',
    })),
  };
  const syncedConversation = {
    ...conversation,
    lastSyncedRevision: 8,
    lastActiveAt: new Date('2026-08-27T00:03:00.000Z'),
  };
  const conversations = {
    loadById: jest.fn(async () => ({ conversation, turns: [turn] })),
    syncAfterReviewAction: jest.fn(async () => ({
      conversation: syncedConversation,
      turns: [turn],
    })),
  };
  const engineerReviews = {
    resolveReviewActionGaps: jest.fn(async () => ({
      gapRefs: [...(options.resolvedGapRefs ?? [])],
      resolvedMissingInputs:
        options.resolvedGapRefs?.length > 0
          ? ['aircraft.currentPartNumber']
          : [],
      affectedCriterionIds: ['RULE-1', 'RULE-2'],
    })),
    recordReviewAction: jest.fn(async () => ({
      revision: 8,
      integratedAssessment: {
        engineerReviews: { revision: 1 },
        overallSynthesis: { status: 'STALE', revision: 2 },
      },
    })),
  };
  const artifactStore = {
    readActualBytes: jest.fn(async () =>
      encodeReviewAttachmentParsedArtifact({
        schemaVersion: 'wiselink.3_1.review_attachment_parse.v1.c7',
        attachmentRef: 'ATTACHMENT-1',
        workItemId: 'WI-1',
        reviewConversationId: 'RC-1',
        documentVersionId: 'DV-ATTACHMENT-1',
        fileName: 'engineering-note.pdf',
        mediaType: 'application/pdf',
        byteLength: 321,
        pageCount: 1,
        pages: [{ page: 1, text: 'Verified attachment content.' }],
      }),
    ),
  };
  return {
    service: new CanonicalHostReviewActionService(
      sessions as never,
      objectAccess as never,
      conversations as never,
      engineerReviews as never,
      artifactStore as never,
    ),
    conversation,
    conversations,
    objectAccess,
    engineerReviews,
  };
}

function integratedTarget() {
  const attachmentBytes = encodeReviewAttachmentParsedArtifact({
    schemaVersion: 'wiselink.3_1.review_attachment_parse.v1.c7',
    attachmentRef: 'ATTACHMENT-C7',
    workItemId: 'WI-C7',
    reviewConversationId: 'RC-C7',
    documentVersionId: 'DV-ATTACHMENT-C7',
    fileName: 'engineering-note.pdf',
    mediaType: 'application/pdf',
    byteLength: 321,
    pageCount: 1,
    pages: [{ page: 1, text: 'Verified current configuration evidence.' }],
  });
  const artifacts = new Map<string, Uint8Array>([
    ['artifact://dynamic-C7', dynamicArtifactBytes()],
    ['artifact://attachment-C7', attachmentBytes],
  ]);
  const state = {
    workItem: integratedWorkItem(),
    attemptCount: 0,
  };
  const artifactStore = {
    readActualBytes: async (artifact: { ref: string }) => {
      const bytes = artifacts.get(artifact.ref);
      if (!bytes) throw new Error(`ARTIFACT_NOT_FOUND:${artifact.ref}`);
      return Uint8Array.from(bytes);
    },
    persistAndReadback: async (bytes: Uint8Array) => {
      const copy = Uint8Array.from(bytes);
      const sha256 = digest(copy);
      const ref = `artifact://review-ledger-${sha256}`;
      artifacts.set(ref, copy);
      return {
        artifact: {
          storeRole: 'UnifiedArtifactStoreCandidate' as const,
          ref,
          sha256,
          byteLength: copy.byteLength,
          mediaType: 'application/json' as const,
        },
        bytes: copy,
        reused: false,
      };
    },
  };
  const engineerReviews = new CanonicalHostEngineerReviewService(
    {
      getTenantScopedByWorkItemId: async () => state.workItem,
      compareAndSet: async (input: {
        expectedRevision: number;
        next: Omit<CanonicalWorkItemProjection, 'revision'>;
      }) => {
        if (state.workItem.revision !== input.expectedRevision) {
          throw new Error('WORK_ITEM_CAS_CONFLICT');
        }
        state.workItem = {
          ...input.next,
          revision: input.expectedRevision + 1,
        };
        return state.workItem;
      },
    } as never,
    {
      authorize: async (input: { action: string }) => ({
        action: input.action,
        allowed: true,
        permissionSnapshotVersion: 'permission-C7',
      }),
    } as never,
    {
      freshRead: async () => ({
        permissionSnapshotVersion: 'permission-C7',
      }),
    } as never,
    { nowIso: () => '2026-08-27T05:00:00.000Z' },
    artifactStore as never,
    {
      reserveAssessmentAction: async () => {
        state.attemptCount += 1;
        return { attemptId: 'ATT-REVIEW-C7', created: true };
      },
      completeAssessmentAction: async () => undefined,
      failAssessmentAction: async () => undefined,
    } as never,
  );
  const conversation = {
    reviewConversationId: 'RC-C7',
    tenantId: 'tenant-C7',
    actorId: 'actor-C7',
    workItemId: 'WI-C7',
    openClawAgentId: 'wiselink-engineering',
    openClawSessionKey: 'server-private-session-key-C7',
    startedAtRevision: 7,
    lastSyncedRevision: 7,
    status: 'ACTIVE',
    createdAt: new Date('2026-08-27T04:00:00.000Z'),
    lastActiveAt: new Date('2026-08-27T04:01:00.000Z'),
    closedAt: null,
  };
  const turn = {
    reviewTurnId: 'RT-C7',
    reviewConversationId: 'RC-C7',
    engineerSuppliedInputId: 'ESI-C7',
    turnNo: 1,
    requestId: 'request-C7',
    inputRevision: 7,
    userMessage: 'Use the current configuration and attachment.',
    inputType: 'ENGINEER_TEXT',
    adoptionStatus: 'CANDIDATE_UNADOPTED',
    candidateText: 'Use the current configuration and attachment.',
    attachmentBindings: [
      {
        attachmentRef: 'ATTACHMENT-C7',
        documentVersionId: 'DV-ATTACHMENT-C7',
        fileName: 'engineering-note.pdf',
        mediaType: 'application/pdf' as const,
        byteLength: 321,
        selectionKey: 'bucket-C7\nofficial-selection/engineering-note.pdf',
        parsedArtifact: {
          storeRole: 'UnifiedArtifactStoreCandidate' as const,
          ref: 'artifact://attachment-C7',
          sha256: digest(attachmentBytes),
          byteLength: attachmentBytes.byteLength,
          mediaType: 'application/json' as const,
        },
      },
    ],
    assistantCandidate: {
      responseType: 'REVIEW_ACTION_DRAFT' as const,
      answer: 'Adopt the current engineering evidence.',
      sourceRefs: ['ATTACHMENT-C7'],
      missingInputs: [],
      candidateEvidenceRefs: ['ATTACHMENT-C7'],
      reviewActionDraft: {
        reviewActionDraftRef: CONFIRM_INPUT.reviewActionDraftRef,
        baseRevision: 7,
        evaluationItemId: 'RULE-A',
        proposedStatus: 'review_required',
        resolvedGapRefs: [],
        adoptedInputRefs: ['engineer-input:ESI-C7', 'ATTACHMENT-C7'],
        sourceRefs: ['ATTACHMENT-C7'],
        assumptions: [],
        affectedItemIds: ['RULE-A', 'RULE-B'],
        overallImpact: true,
        uncertaintyDispositions: [],
        decisionSnapshot: null,
      },
      affectedItemIds: ['RULE-A', 'RULE-B'],
      warnings: [],
      actionAttemptRef: 'AQ-C7',
      provenance: {
        runtimeAppId: 'app_17c3zn24kv2' as const,
        profileRef: 'wiselink-engineering' as const,
        modelVersion: 'GLM-5.3',
        promptVersion: 'review-prompt.v1',
        skillVersion: 'review-skill-C7',
        toolVersions: {},
        resultContentHash: 'f'.repeat(64),
      },
      completedAt: '2026-08-27T04:02:00.000Z',
    },
    createdAt: new Date('2026-08-27T04:01:00.000Z'),
  };
  const sessionActor = {
    ...actor,
    canonicalSubject: { namespace: 'MIAODA_USER_ID', id: 'actor-C7' },
    tenantId: 'tenant-C7',
  };
  const conversations = {
    loadById: async () => ({ conversation, turns: [turn] }),
    syncAfterReviewAction: async (input: {
      expectedRevision: number;
      currentRevision: number;
    }) => {
      expect(input).toMatchObject({
        expectedRevision: 7,
        currentRevision: 8,
      });
      return {
        conversation: {
          ...conversation,
          lastSyncedRevision: input.currentRevision,
          lastActiveAt: new Date('2026-08-27T05:00:00.000Z'),
        },
        turns: [turn],
      };
    },
  };
  return {
    service: new CanonicalHostReviewActionService(
      {
        resolve: async () => ({
          actor: sessionActor,
          session: { id: 'session-C7', revision: 1 },
        }),
      } as never,
      {
        freshRead: async () => ({
          allowed: true,
          action: 'RECORD_ENGINEER_REVIEW',
          workItemId: 'WI-C7',
          workItemRevision: 7,
          tenantId: 'tenant-C7',
          actorUserId: 'actor-C7',
        }),
      } as never,
      conversations as never,
      engineerReviews,
      artifactStore as never,
    ),
    engineerReviews,
    state,
  };
}

function integratedWorkItem(): CanonicalWorkItemProjection {
  const artifact = (ref: string, sha256: string) => ({
    storeRole: 'UnifiedArtifactStoreCandidate' as const,
    ref,
    sha256,
    byteLength: 100,
    mediaType: 'application/json' as const,
  });
  return {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: 'WI-C7',
    requestId: 'REQ-C7',
    revision: 7,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    permissionSnapshotVersion: 'permission-C7',
    parseAuthorization: {} as never,
    source: {
      documentId: 'DOC-C7',
      documentVersionId: 'DV-C7',
      sourceArtifactId: 'SOURCE-C7',
      artifactSha256: 'a'.repeat(64),
      byteLength: 100,
    } as never,
    classification: {
      status: 'CONFIRMED',
      normalizedFamily: 'SB',
      parserProfileId: 'issuer.boeing.sb',
    } as never,
    package: {
      packageId: 'PKG-C7',
      artifact: artifact('artifact://package-C7', 'b'.repeat(64)),
    } as never,
    assessment: null,
    integratedAssessment: {
      status: 'OVERALL_CANDIDATE_READY',
      baseRules: {
        status: 'CANDIDATE_ONLY',
        revision: 1,
        sourceResultId: 'openclaw-dynamic://C7',
        criterionSetId: 'RULESET-C7',
        criterionCount: 2,
        evaluationItemCount: 2,
        unresolvedCount: 1,
        sourceBoundCandidateCount: 2,
        artifact: artifact('artifact://dynamic-C7', 'c'.repeat(64)),
        actionAttemptId: 'ATT-DYNAMIC-C7',
      },
      engineerReviews: null,
      overallSynthesis: {
        status: 'CANDIDATE_ONLY',
        revision: 1,
        sourceResultId: 'openclaw-overall://C7',
        basedOnBaseRuleRevision: 1,
        basedOnBaseRuleArtifactSha256: 'c'.repeat(64),
        basedOnEngineerReviewRevision: null,
        basedOnEngineerReviewArtifactSha256: null,
        discoveryStatus: 'NO_DISCOVERY',
        gap: null,
        candidateRefCount: 0,
        findingCount: 2,
        unresolvedCount: 1,
        authorityLevel: 'candidate_only',
        externalDiscoveryIsEvidence: false,
        artifact: artifact('artifact://overall-C7', 'd'.repeat(64)),
        actionAttemptId: 'ATT-OVERALL-C7',
        staleReason: null,
      },
      overallForAeoConfirmation: null,
    },
    translation: null,
    aeo: null,
    failure: null,
    recordingFailure: null,
  };
}

function dynamicArtifactBytes(): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      ruleResults: {
        columns: [
          'ruleId',
          'result',
          'factsConsidered',
          'ruleApplication',
          'analysisSummary',
          'conclusion',
          'sourceRefs',
          'missingInputs',
          'humanReviewRequired',
        ],
        rows: dynamicItems().map((item) => [
          item.criterionId,
          item.dynamicResult,
          item.factsConsidered,
          item.ruleApplication,
          item.analysisSummary,
          item.candidateConclusion,
          item.sourceRefs,
          item.missingInputs,
          item.humanReviewRequired,
        ]),
      },
    }),
  );
}

function dynamicItems() {
  return [
    {
      criterionId: 'RULE-A',
      dynamicResult: 'UNKNOWN/WAITING_INPUT',
      candidateConclusion: 'Waiting for current configuration.',
      humanReviewRequired: true,
      factsConsidered: ['Document fact A'],
      ruleApplication: 'Rule A application',
      analysisSummary: 'Initial analysis A',
      sourceRefs: ['SRC-A'],
      missingInputs: [],
    },
    {
      criterionId: 'RULE-B',
      dynamicResult: 'PASS',
      candidateConclusion: 'Candidate pass.',
      humanReviewRequired: true,
      factsConsidered: ['Document fact B'],
      ruleApplication: 'Rule B application',
      analysisSummary: 'Initial analysis B',
      sourceRefs: ['SRC-B'],
      missingInputs: [],
    },
  ];
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
