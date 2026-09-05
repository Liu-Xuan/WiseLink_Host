import type {
  CanonicalApplicabilityCandidateProjection,
  CanonicalApplicabilityInputProjection,
  CanonicalWorkItemProjection,
  ReviewTurnAssistantCandidate,
} from '../../shared/api.interface';
import {
  sealResultEnvelope,
  sealTaskEnvelope,
} from '../../server/modules/action-attempt/action-attempt-envelope';
import type {
  OpenClawResultEnvelope,
  OpenClawTaskEnvelope,
} from '../../server/modules/action-attempt/action-attempt-envelope.types';
import type {
  ActionAttemptRow,
  ReserveAndClaimInput,
} from '../../server/modules/action-attempt/action-attempt.types';
import {
  REVIEW_MODEL_POLICY_REF,
  REVIEW_MINIMUM_COMPATIBLE_SKILL_VERSION,
  REVIEW_PROFILE_REF,
} from '../../server/modules/canonical-host/canonical-host-openclaw-review.contract';
import { CanonicalHostOpenClawReviewService } from '../../server/modules/canonical-host/canonical-host-openclaw-review.service';
import { encodeReviewAttachmentParsedArtifact } from '../../server/modules/review-persistence/review-attachment-artifact';

describe('CanonicalHostOpenClawReviewService', () => {
  it('only returns the next authorized persisted automatic request without invoking the model', async () => {
    const harness = reviewHarness();
    harness.conversations.loadPendingOpenClawTurn.mockResolvedValue({
      reviewConversationId: 'RC-1', reviewTurnId: 'RT-2', requestId: 'request-2', turnNo: 2, inputRevision: 7,
    });
    await expect(harness.service.pending('WI-1')).resolves.toEqual({
      next: { reviewConversationRef: 'RC-1', reviewTurnRef: 'RT-2', requestId: 'request-2', turnNo: 2 }, busy: false,
    });
    expect(harness.conversations.loadPendingOpenClawTurn).toHaveBeenCalledWith({ tenantId: 'tenant-1', actorId: 'actor-1', workItemId: 'WI-1' });
    expect(harness.attempts.reserveAndClaim).not.toHaveBeenCalled();
    harness.dispatch.isBusy.mockResolvedValue(true);
    await expect(harness.service.pending('WI-1')).resolves.toEqual({ next: null, busy: true });
  });

  it('derives the user/work item/revision from C1 persistence and freezes exact SourceRefs', async () => {
    const harness = reviewHarness();
    const begin = await harness.service.begin('RC-1', 'request-1');

    expect(harness.attempts.reserveAndClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: 'WI-1',
        tenantId: 'tenant-1',
        actorUserId: 'actor-1',
        inputRevision: 7,
        baseRevision: 7,
        taskType: 'OPENCLAW_INTERACTIVE_REVIEW',
      }),
    );
    expect(begin.task.modelInput).toMatchObject({
      mode: 'INTERACTIVE_REVIEW',
      reviewConversationRef: 'RC-1',
      reviewTurnRef: 'RT-1',
      requestId: 'request-1',
      inputRevision: 7,
      selectedEvaluationItemId: null,
      resourceRefs: [expect.objectContaining({ sourceRefId: 'SRC-1' })],
      context: {
        evaluation: {
          gapLedger: expect.objectContaining({
            inputRevision: 7,
            currentness: 'CURRENT',
            candidateOnly: true,
            summary: expect.objectContaining({ total: 1, open: 1 }),
            gaps: [
              expect.objectContaining({
                gapRef: 'GAP-001',
                missingInputId: 'aircraft.currentPartNumber',
                resolutionStatus: 'OPEN',
                authority: expect.objectContaining({
                  owner: 'CANONICAL_HOST',
                  modelMayClose: false,
                  queryResultIsFact: false,
                }),
              }),
            ],
          }),
        },
      },
    });
    expect(JSON.stringify(begin.task.modelInput)).not.toContain('actor-1');
    expect(JSON.stringify(begin.task.modelInput)).not.toContain('tenant-1');
    expect(JSON.stringify(begin.task.modelInput)).not.toContain(
      'openClawSessionKey',
    );
    expect(harness.serviceScope.authorizeOpenClawReview).toHaveBeenCalledWith({
      operation: 'BEGIN_REVIEW',
      reviewConversationRef: 'RC-1',
      requestId: 'request-1',
    });
    expect(harness.conversations.loadOpenClawTurnBinding).toHaveBeenCalledWith({
      reviewConversationId: 'RC-1',
      requestId: 'request-1',
      tenantId: 'tenant-1',
      actorId: 'actor-1',
      workItemId: 'WI-1',
    });
    expect(
      harness.serviceScope.authorizeOpenClawReview.mock.invocationCallOrder[0],
    ).toBeLessThan(
      harness.conversations.loadOpenClawTurnBinding.mock.invocationCallOrder[0],
    );
    expect(harness.workItems.loadTenantScopedProjection).toHaveBeenCalledTimes(
      2,
    );
  });

  it('passes the persisted focus to the Agent task and context tool', async () => {
    const harness = reviewHarness(false, false, false, 'RULE-1');
    const begin = await harness.service.begin('RC-1', 'request-1');

    expect(begin.task.modelInput.selectedEvaluationItemId).toBe('RULE-1');
    await expect(harness.service.context('AQ-REVIEW-1')).resolves.toMatchObject(
      {
        selectedEvaluationItemId: 'RULE-1',
      },
    );
  });

  it('does not run against a focus absent from the current assessment', async () => {
    const harness = reviewHarness(false, false, false, 'RULE-OTHER');
    await expect(
      harness.service.begin('RC-1', 'request-1'),
    ).rejects.toMatchObject({
      code: 'REVIEW_SELECTED_EVALUATION_ITEM_NOT_FOUND',
    });
  });

  it('expands stored source-evidence candidate IDs to exact package SourceRefs', async () => {
    const harness = reviewHarness();
    const page = await harness.engineerReviews.pageContext();
    harness.engineerReviews.pageContext.mockResolvedValueOnce({
      ...page,
      gapLedger: {
        ...page.gapLedger,
        gaps: page.gapLedger.gaps.map((gap) => ({
          ...gap,
          sourceRefs: ['SEC-RULE-1'],
        })),
      },
      items: page.items.map((item) => ({
        ...item,
        sourceRefs: ['SEC-RULE-1'],
      })),
    });
    harness.assessment.resolveStoredBaseSourceEvidenceRefs.mockResolvedValueOnce(
      new Map([['SEC-RULE-1', ['SRC-1']]]),
    );

    const begin = await harness.service.begin('RC-1', 'request-1');

    expect(begin.task.modelInput).toMatchObject({
      resourceRefs: [expect.objectContaining({ sourceRefId: 'SRC-1' })],
      context: {
        evaluation: {
          gapLedger: {
            gaps: [expect.objectContaining({ sourceRefs: ['SRC-1'] })],
          },
          items: [expect.objectContaining({ sourceRefs: ['SRC-1'] })],
        },
      },
    });
  });

  it('exposes explicit related documents through the existing review context and SourceRef tools', async () => {
    const harness = reviewHarness(false, true);

    const begin = await harness.service.begin('RC-1', 'request-1');

    expect(begin.task.modelInput).toMatchObject({
      context: {
        relatedContext: {
          status: 'AVAILABLE',
          usagePolicy: {
            candidateOnly: true,
            readOnly: true,
            includedInAssessmentInput: false,
          },
          items: [
            expect.objectContaining({
              normalizedTarget: '777-SL-31-064',
              currentness: 'CURRENT',
              contextUse: 'BACKGROUND_ONLY',
              targetApplicability: 'NOT_EVALUATED',
              availableRelatedSourceRefIds: ['TARGET-SRC-1'],
            }),
          ],
        },
      },
      resourceRefs: expect.arrayContaining([
        expect.objectContaining({ sourceRefId: 'SRC-REL' }),
        expect.objectContaining({ sourceRefId: 'TARGET-SRC-1' }),
      ]),
    });
    expect(begin.task.sourceRefs).toContainEqual({
      ref: 'artifact://related-package',
      sha256: 'f'.repeat(64),
    });
    const [snapshotBytes] = harness.artifactStore.persistAndReadback.mock
      .calls[0] as [Uint8Array];
    const modelContext = begin.task.modelInput.context as {
      relatedContext: {
        snapshotRef: string;
        items: Array<Record<string, unknown>>;
      };
    };
    const persistedSnapshot = JSON.parse(new TextDecoder().decode(snapshotBytes));
    expect(persistedSnapshot).toMatchObject({
      snapshotRef: modelContext.relatedContext.snapshotRef,
      workItemRef: 'WI-1',
      inputRevision: 7,
    });
    expect(modelContext.relatedContext.snapshotRef).not.toContain('WI-1');
    // Real Turn 15 stopped before model execution on this legacy alias.
    // Keep the public snapshot intact and preserve its source semantics.
    expect(persistedSnapshot.items[0].authority).toBeDefined();
    expect(modelContext.relatedContext.items[0]).not.toHaveProperty('authority');
    expect(modelContext.relatedContext.items[0].sourceAuthority).toBe(
      persistedSnapshot.items[0].sourceAuthority,
    );
    await expect(
      harness.service.readSourceRefs('AQ-REVIEW-1', ['TARGET-SRC-1']),
    ).resolves.toMatchObject({
      sourceRefs: [
        {
          sourceRefId: 'TARGET-SRC-1',
          relatedDocument: {
            normalizedTarget: '777-SL-31-064',
            documentVersionRef: 'DV-SL-1',
            contextUse: 'BACKGROUND_ONLY',
            targetApplicability: 'NOT_EVALUATED',
          },
        },
      ],
    });
  });

  it('does not expose a related document after current read authorization is revoked', async () => {
    const harness = reviewHarness(false, true);
    harness.conversations.hasActiveOfficialActorMapping.mockResolvedValueOnce(
      false,
    );

    const begin = await harness.service.begin('RC-1', 'request-1');

    expect(begin.task.modelInput).toMatchObject({
      context: {
        relatedContext: {
          items: [
            expect.objectContaining({
              normalizedTarget: '777-SL-31-064',
              availability: 'ACCESS_DENIED',
              availableRelatedSourceRefIds: [],
            }),
          ],
        },
      },
    });
    expect(begin.task.modelInput.resourceRefs).not.toContainEqual(
      expect.objectContaining({ sourceRefId: 'TARGET-SRC-1' }),
    );
    expect(harness.artifactStore.readActualBytes).not.toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'artifact://related-package' }),
    );
  });

  it('reuses a matching CURRENT related-document applicability result without entering the assessment input', async () => {
    const harness = reviewHarness(false, true, true);

    const begin = await harness.service.begin('RC-1', 'request-1');

    expect(begin.task.modelInput).toMatchObject({
      context: {
        relatedContext: {
          status: 'AVAILABLE',
          usagePolicy: {
            candidateOnly: true,
            readOnly: true,
            includedInAssessmentInput: false,
          },
          items: [
            expect.objectContaining({
              normalizedTarget: '777-SL-31-064',
              targetApplicability: 'APPLICABLE',
              applicabilityResultRef: 'openclaw-applicability://RESULT-RELATED',
            }),
          ],
        },
      },
    });
    await expect(
      harness.service.readSourceRefs('AQ-REVIEW-1', ['TARGET-SRC-1']),
    ).resolves.toMatchObject({
      sourceRefs: [
        {
          relatedDocument: {
            targetApplicability: 'APPLICABLE',
            applicabilityResultRef: 'openclaw-applicability://RESULT-RELATED',
            contextUse: 'BACKGROUND_ONLY',
          },
        },
      ],
    });
    expect(harness.workItems.loadTenantScopedProjection).toHaveBeenCalledWith(
      'WI-RELATED-1',
      'tenant-1',
    );
  });

  it('fails closed when a stored source-evidence candidate cannot be resolved', async () => {
    const harness = reviewHarness();
    const page = await harness.engineerReviews.pageContext();
    harness.engineerReviews.pageContext.mockResolvedValueOnce({
      ...page,
      items: page.items.map((item) => ({
        ...item,
        sourceRefs: ['SEC-UNKNOWN'],
      })),
    });

    await expect(harness.service.begin('RC-1', 'request-1')).rejects.toThrow(
      'REVIEW_REFERENCED_SOURCE_REF_NOT_IN_PACKAGE',
    );
    expect(harness.attempts.reserveAndClaim).not.toHaveBeenCalled();
  });

  it('rejects a Review binding that does not match the Host-owned WorkItem actor', async () => {
    const harness = reviewHarness();
    harness.conversations.loadOpenClawTurnBinding.mockResolvedValueOnce({
      conversation: {
        ...(await harness.conversations.loadById()).conversation,
        actorId: 'actor-forged',
      },
      turn: await harness.conversations.loadTurnById(),
    });

    await expect(
      harness.service.begin('RC-1', 'request-1'),
    ).rejects.toMatchObject({
      code: 'REVIEW_TURN_BINDING_STALE_OR_INELIGIBLE',
    });
    expect(harness.attempts.reserveAndClaim).not.toHaveBeenCalled();
  });

  it('propagates Review schema readiness errors before reserving an ActionAttempt', async () => {
    const harness = reviewHarness();
    harness.conversations.loadOpenClawTurnBinding.mockRejectedValueOnce(
      Object.assign(
        new Error('Required Review database schema is not ready.'),
        {
          code: 'REVIEW_SCHEMA_NOT_READY',
          statusCode: 503,
          retryable: false,
          operatorAction: 'APPLY_REQUIRED_SCHEMA_MIGRATIONS',
        },
      ),
    );

    await expect(
      harness.service.begin('RC-1', 'request-1'),
    ).rejects.toMatchObject({
      code: 'REVIEW_SCHEMA_NOT_READY',
      statusCode: 503,
      retryable: false,
      operatorAction: 'APPLY_REQUIRED_SCHEMA_MIGRATIONS',
    });
    expect(harness.attempts.reserveAndClaim).not.toHaveBeenCalled();
  });

  it('returns only exact frozen allowlisted SourceRefs and rejects any other ref', async () => {
    const harness = reviewHarness();
    await harness.service.begin('RC-1', 'request-1');

    await expect(
      harness.service.readSourceRefs('AQ-REVIEW-1', ['SRC-OTHER']),
    ).rejects.toMatchObject({
      code: 'REVIEW_SOURCE_REF_NOT_ALLOWED',
      statusCode: 400,
    });
    await expect(
      harness.service.readSourceRefs('AQ-REVIEW-1', ['SRC-1']),
    ).resolves.toMatchObject({
      sourceRefs: [{ sourceRefId: 'SRC-1', pageStart: 1, pageEnd: 1 }],
    });
  });

  it('binds parsed attachment actual bytes and current EngineerSuppliedInput into the C2 task', async () => {
    const harness = reviewHarness(true);
    const begin = await harness.service.begin('RC-1', 'request-1');
    expect(begin.task.modelInput).toMatchObject({
      attachmentRefs: ['ATTACHMENT-1'],
      allowedAdoptedInputRefs: expect.arrayContaining([
        'engineer-input:ESI-1',
        'ATTACHMENT-1',
      ]),
      context: {
        engineerInput: {
          inputRef: 'engineer-input:ESI-1',
          text: 'Please review rule 1.',
          attachmentRefs: ['ATTACHMENT-1'],
        },
      },
    });
    const attachmentSource = (
      begin.task.modelInput.resourceRefs as Array<Record<string, unknown>>
    ).find((ref) => ref.sourceRefId === 'ATTACHMENT-1');
    expect(attachmentSource).toMatchObject({
      value: {
        kind: 'ENGINEER_ATTACHMENT',
        fileName: 'engineering-note.pdf',
        pages: [{ page: 1, text: 'Parsed engineering attachment.' }],
      },
    });
    expect(JSON.stringify(begin.task.modelInput)).not.toContain(
      'official-selection/',
    );
    expect(begin.task.sourceRefs).toContainEqual({
      ref: 'artifact://review-attachment',
      sha256: 'e'.repeat(64),
    });
  });

  it('rejects a non-official hosted profile before ActionAttempt or review mutation', async () => {
    const harness = reviewHarness();
    const begin = await harness.service.begin('RC-1', 'request-1');
    const result = harness.result(
      begin.task,
      { 'wiselink-openclaw-engineering-assessment': '1.2.0' },
      REVIEW_MINIMUM_COMPATIBLE_SKILL_VERSION,
      'GLM-5.3',
      'unofficial-profile',
    );

    await expect(
      harness.service.commit(
        begin.attemptRef,
        begin.leaseToken,
        begin.leaseGeneration,
        result,
      ),
    ).rejects.toThrow('REVIEW_RESULT_PROVENANCE_INVALID');
    expect(harness.attempts.prepareCommit).not.toHaveBeenCalled();
    expect(
      harness.conversations.persistOpenClawAssistantCandidate,
    ).not.toHaveBeenCalled();
  });

  it('rejects an old skill version before ActionAttempt or review mutation', async () => {
    const harness = reviewHarness();
    const begin = await harness.service.begin('RC-1', 'request-1');
    const result = harness.result(
      begin.task,
      { 'wiselink-openclaw-engineering-assessment': '1.2.0' },
      'wiselink-research-and-synthesize.v1',
    );

    await expect(
      harness.service.commit(
        begin.attemptRef,
        begin.leaseToken,
        begin.leaseGeneration,
        result,
      ),
    ).rejects.toThrow('OPENCLAW_RESULT_RUNTIME_POLICY_MISMATCH');
    expect(harness.attempts.prepareCommit).not.toHaveBeenCalled();
    expect(
      harness.conversations.persistOpenClawAssistantCandidate,
    ).not.toHaveBeenCalled();
  });

  it('persists only the ReviewTurn candidate and terminalizes without projection/CAS', async () => {
    const harness = reviewHarness();
    const begin = await harness.service.begin('RC-1', 'request-1');
    const result = harness.result(begin.task, {
      'wiselink-openclaw-engineering-assessment': '1.2.0',
    });

    const committed = await harness.service.commit(
      begin.attemptRef,
      begin.leaseToken,
      begin.leaseGeneration,
      result,
    );

    expect(committed).toMatchObject({
      attemptRef: 'AQ-REVIEW-1',
      status: 'SUCCEEDED',
      authority: {
        candidatePersisted: true,
        reviewActionExecuted: false,
        workItemRevisionChanged: false,
        currentChanged: false,
        staleMarked: false,
      },
    });
    expect(
      harness.conversations.persistOpenClawAssistantCandidate,
    ).toHaveBeenCalledTimes(1);
    expect(
      harness.attempts.finishCandidatePersistenceSuccess,
    ).toHaveBeenCalledTimes(1);
    expect(harness.workItems.loadTenantScopedProjection).toHaveBeenCalled();
  });

  it('issues an immutable Host draft ref before persisting a confirmable draft', async () => {
    const harness = reviewHarness();
    const begin = await harness.service.begin('RC-1', 'request-1');
    const result = harness.result(
      begin.task,
      { 'wiselink-openclaw-engineering-assessment': '1.2.0' },
      REVIEW_MINIMUM_COMPATIBLE_SKILL_VERSION,
      'GLM-5.3',
      REVIEW_PROFILE_REF,
      true,
    );

    const committed = await harness.service.commit(
      begin.attemptRef,
      begin.leaseToken,
      begin.leaseGeneration,
      result,
    );
    if (!('assistantCandidate' in committed)) {
      throw new Error('Expected a persisted Review candidate.');
    }

    expect(
      committed.assistantCandidate.reviewActionDraft?.reviewActionDraftRef,
    ).toMatch(/^RAD-[0-9a-f]{64}$/u);
    expect(
      harness.conversations.persistOpenClawAssistantCandidate,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate: expect.objectContaining({
          reviewActionDraft: expect.objectContaining({
            reviewActionDraftRef:
              committed.assistantCandidate.reviewActionDraft
                ?.reviewActionDraftRef,
          }),
        }),
      }),
    );
  });

  it('rejects an expired lease before ActionAttempt recovery or review mutation', async () => {
    const harness = reviewHarness();
    const begin = await harness.service.begin('RC-1', 'request-1');
    harness.expireLease();
    const result = harness.result(begin.task, {
      'wiselink-openclaw-engineering-assessment': '1.2.0',
    });

    await expect(
      harness.service.commit(
        begin.attemptRef,
        begin.leaseToken,
        begin.leaseGeneration,
        result,
      ),
    ).rejects.toMatchObject({ code: 'ACTION_ATTEMPT_LEASE_EXPIRED' });
    expect(harness.attempts.prepareCommit).not.toHaveBeenCalled();
    expect(
      harness.conversations.persistOpenClawAssistantCandidate,
    ).not.toHaveBeenCalled();
  });

  it('reconciles an already sealed COMMITTING candidate after lease expiry', async () => {
    const harness = reviewHarness();
    const begin = await harness.service.begin('RC-1', 'request-1');
    harness.markCommittingAndExpireLease();
    const result = harness.result(begin.task, {
      'wiselink-openclaw-engineering-assessment': '1.2.0',
    });

    await expect(
      harness.service.commit(
        begin.attemptRef,
        begin.leaseToken,
        begin.leaseGeneration,
        result,
      ),
    ).resolves.toMatchObject({ status: 'SUCCEEDED' });
    expect(harness.attempts.prepareCommit).toHaveBeenCalledTimes(1);
    expect(
      harness.conversations.persistOpenClawAssistantCandidate,
    ).toHaveBeenCalledTimes(1);
  });
});

function reviewHarness(
  withAttachment = false,
  withRelatedContext = false,
  withRelatedApplicability = false,
  selectedEvaluationItemId: string | null = null,
) {
  const workItem = parsedWorkItem();
  const relatedWorkItem: CanonicalWorkItemProjection = {
    ...structuredClone(workItem),
    workItemId: 'WI-RELATED-1',
    requestId: 'WORK-REQ-RELATED-1',
    revision: 3,
    source: {
      ...structuredClone(workItem.source),
      documentId: 'DOC-SL-1',
      documentVersionId: 'DV-SL-1',
    },
    package: {
      ...structuredClone(workItem.package!),
      packageId: 'PKG-SL-1',
      contentHash: 'related-content-hash',
      artifact: {
        ...structuredClone(workItem.package!.artifact),
        ref: 'artifact://related-package',
        sha256: 'f'.repeat(64),
      },
      title: '777-SL-31-064',
      documentIdentity: {
        documentCode: '777-SL-31-064',
        businessRevision: 'ORIGINAL ISSUE',
      },
      contentUnitCount: 1,
      sourceRefCount: 1,
    },
  };
  if (withRelatedApplicability) {
    workItem.applicabilityInput = matchingApplicabilityInput(workItem);
    relatedWorkItem.applicability =
      matchingApplicabilityResult(relatedWorkItem);
  }
  const conversation = {
    reviewConversationId: 'RC-1',
    tenantId: 'tenant-1',
    actorId: 'actor-1',
    workItemId: 'WI-1',
    openClawAgentId: 'wiselink-engineering',
    openClawSessionKey: 'review:server-owned-secret',
    startedAtRevision: 7,
    lastSyncedRevision: 7,
    status: 'ACTIVE',
    createdAt: new Date('2026-08-26T10:00:00.000Z'),
    lastActiveAt: new Date('2026-08-26T10:01:00.000Z'),
    closedAt: null,
  };
  const turn = {
    reviewTurnId: 'RT-1',
    reviewConversationId: 'RC-1',
    engineerSuppliedInputId: 'ESI-1',
    turnNo: 1,
    requestId: 'request-1',
    inputRevision: 7,
    userMessage: 'Please review rule 1.',
    selectedEvaluationItemId,
    inputType: 'ENGINEER_TEXT',
    adoptionStatus: 'CANDIDATE_UNADOPTED',
    candidateText: 'Please review rule 1.',
    attachmentBindings: withAttachment
      ? [
          {
            attachmentRef: 'ATTACHMENT-1',
            documentVersionId: 'DV-ATTACHMENT-1',
            fileName: 'engineering-note.pdf',
            mediaType: 'application/pdf',
            byteLength: 321,
            selectionKey:
              'default-bucket\nofficial-selection/engineering-note.pdf',
            parsedArtifact: {
              storeRole: 'UnifiedArtifactStoreCandidate',
              ref: 'artifact://review-attachment',
              sha256: 'e'.repeat(64),
              byteLength: 200,
              mediaType: 'application/json',
            },
          },
        ]
      : [],
    assistantCandidate: null,
    createdAt: new Date('2026-08-26T10:01:00.000Z'),
  };
  let task: OpenClawTaskEnvelope | null = null;
  let row: ActionAttemptRow | null = null;
  const conversations = {
    loadPendingOpenClawTurn: jest.fn().mockResolvedValue(null),
    loadById: jest.fn(async () => ({ conversation, turns: [turn] })),
    loadTurnById: jest.fn(async () => turn),
    hasActiveOfficialActorMapping: jest.fn(async () => true),
    loadOpenClawTurnBinding: jest.fn(async () => ({ conversation, turn })),
    loadOpenClawTurnByIdBinding: jest.fn(async () => ({
      conversation,
      turn,
    })),
    persistOpenClawAssistantCandidate: jest.fn(async (input) => {
      const assistantCandidate: ReviewTurnAssistantCandidate = {
        ...input.candidate,
        completedAt: '2026-08-26T10:02:00.000Z',
      };
      return {
        turn: { ...turn, assistantCandidate },
        replayed: false,
      };
    }),
  };
  const workItems = {
    loadTenantScopedProjection: jest.fn(async (workItemId: string) => ({
      row: {
        workItemId,
        tenantId: 'tenant-1',
        requestId:
          workItemId === 'WI-RELATED-1' ? 'WORK-REQ-RELATED-1' : 'WORK-REQ-1',
        documentVersionId: workItemId === 'WI-RELATED-1' ? 'DV-SL-1' : 'DV-1',
        requestedByUserId: 'actor-1',
        revision: workItemId === 'WI-RELATED-1' ? 3 : 7,
      },
      projection: workItemId === 'WI-RELATED-1' ? relatedWorkItem : workItem,
    })),
    loadAuthorizationBinding: jest.fn(async () => ({
      workItemId: 'WI-RELATED-1',
      revision: 3,
      tenantId: 'tenant-1',
      requestId: 'WORK-REQ-RELATED-1',
      documentId: 'DOC-SL-1',
      documentVersionId: 'DV-SL-1',
      requestedByUserId: 'actor-1',
      runKey: 'run-related-1',
    })),
    listTenantDocumentAuthorizationBindings: jest.fn(async () => [
      {
        workItemId: 'WI-RELATED-1',
        revision: 3,
        tenantId: 'tenant-1',
        requestId: 'WORK-REQ-RELATED-1',
        documentId: 'DOC-SL-1',
        documentVersionId: 'DV-SL-1',
        requestedByUserId: 'actor-1',
        runKey: 'run-related-1',
      },
    ]),
  };
  const engineerReviews = {
    pageContext: jest.fn(async () => ({
      criterionSetId: 'RULESET-1',
      baseRuleRevision: 1,
      ledger: null,
      gapLedger: {
        schemaVersion: 'wiselink.3_1.assessment_gap_ledger_projection.v1',
        inputRevision: 7,
        baseRuleRevision: 1,
        currentness: 'CURRENT',
        candidateOnly: true,
        gaps: [
          {
            gapRef: 'GAP-001',
            missingInputId: 'aircraft.currentPartNumber',
            displayLabel: '当前装机件号',
            reasonClass: 'CONTROLLED_FACT_MISSING',
            dataDomain: 'aircraft',
            requiredFactType: 'aircraft.currentPartNumber',
            whyNeeded: '当前装机件号会影响此项规则判断。',
            materiality: 'P0_DECISION_CRITICAL',
            requiredness: 'REQUIRED_FOR_CONFIRMATION',
            queryability: 'REVIEW_QUERYABLE',
            resolutionStatus: 'OPEN',
            originCriterionIds: ['RULE-1'],
            affectedCriterionIds: ['RULE-1'],
            sourceRefs: ['SRC-1'],
            resolutionOptions: ['在交互式复核中补充受控事实或来源证据'],
            authority: {
              owner: 'CANONICAL_HOST',
              candidateOnly: true,
              modelMayClose: false,
              queryResultIsFact: false,
            },
          },
        ],
        summary: {
          total: 1,
          open: 1,
          partiallyResolved: 0,
          resolved: 0,
          decisionCritical: 1,
          reviewQueryable: 1,
        },
      },
      items: [
        {
          criterionId: 'RULE-1',
          dynamicResult: 'PASS',
          candidateConclusion: 'Candidate conclusion',
          humanReviewRequired: true,
          factsConsidered: ['fact'],
          ruleApplication: 'rule',
          analysisSummary: 'analysis',
          sourceRefs: ['SRC-1'],
          missingInputs: [],
          latestReview: null,
        },
      ],
    })),
    modelContext: jest.fn(async () => ({
      revision: null,
      artifactSha256: null,
      reviewCount: 0,
      history: [],
      effective: [],
    })),
  };
  const assessment = {
    resolveStoredBaseSourceEvidenceRefs: jest.fn(
      async () => new Map<string, string[]>(),
    ),
  };
  const attempts = {
    reserveAndClaim: jest.fn(async (input: ReserveAndClaimInput) => {
      const modelInput = await input.buildModelInput({
        attemptId: 'ATT-REVIEW-1',
        operationRef: 'AQ-REVIEW-1',
        triggerRequestId: 'REQ-REVIEW-1',
        attemptNo: 1,
        createdAt: new Date('2026-08-26T10:00:00.000Z'),
      });
      task = sealTaskEnvelope({
        schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
        actionAttemptId: 'ATT-REVIEW-1',
        operationRef: 'AQ-REVIEW-1',
        taskType: input.taskType,
        priority: 100,
        tenantId: input.tenantId,
        workItemId: input.workItemId,
        inputRevision: input.inputRevision,
        baseRevision: input.baseRevision,
        documentVersionId: input.documentVersionId,
        sourceRefs: input.sourceRefs ?? [],
        allowedConnectors: input.allowedConnectors ?? [],
        hostResolvedMissingInputs: input.hostResolvedMissingInputs ?? [],
        modelInput,
        deadline: '2099-08-26T10:10:00.000Z',
        idempotencyKey: input.idempotencyKey,
      });
      row = actionAttemptRow(task);
      return {
        attemptRef: task.operationRef,
        status: 'RUNNING' as const,
        leaseToken: '00000000-0000-4000-8000-000000000001',
        leaseGeneration: 1,
        leaseExpiresAt: '2099-08-26T10:01:00.000Z',
        task,
        created: true,
        triggerRequestId: 'REQ-REVIEW-1',
      };
    }),
    readScoped: jest.fn(async () => row!),
    prepareCommit: jest.fn(async (input) => ({
      row: { ...row!, status: 'COMMITTING' },
      task: task!,
      result: input.result,
      recovery: false,
    })),
    finishCandidatePersistenceSuccess: jest.fn(async () => ({
      attemptRef: 'AQ-REVIEW-1',
      status: 'SUCCEEDED',
      projectionApplied: false,
      terminalReason: 'REVIEW_TURN_CANDIDATE_PERSISTED',
    })),
    projectTerminal: jest.fn(),
  };
  const artifactStore = {
    persistAndReadback: jest.fn(async (bytes: Uint8Array) => ({
      artifact: {
        storeRole: 'UnifiedArtifactStoreCandidate' as const,
        ref: 'artifact://related-context-snapshot',
        sha256: '9'.repeat(64),
        byteLength: bytes.byteLength,
        mediaType: 'application/json' as const,
      },
      bytes: Uint8Array.from(bytes),
      reused: false,
    })),
    readActualBytes: jest.fn(async (artifact: { ref: string }) =>
      artifact.ref === 'artifact://review-attachment'
        ? encodeReviewAttachmentParsedArtifact({
            schemaVersion: 'wiselink.3_1.review_attachment_parse.v1.c7',
            attachmentRef: 'ATTACHMENT-1',
            workItemId: 'WI-1',
            reviewConversationId: 'RC-1',
            documentVersionId: 'DV-ATTACHMENT-1',
            fileName: 'engineering-note.pdf',
            mediaType: 'application/pdf',
            byteLength: 321,
            pageCount: 1,
            pages: [{ page: 1, text: 'Parsed engineering attachment.' }],
          })
        : artifact.ref === 'artifact://related-package'
          ? new TextEncoder().encode(
              JSON.stringify({
                sourceRefs: [
                  {
                    sourceRefId: 'TARGET-SRC-1',
                    pageStart: 1,
                    pageEnd: 1,
                    quote: 'Related document evidence.',
                  },
                ],
              }),
            )
          : new TextEncoder().encode(
              JSON.stringify({
                sourceRefs: [
                  { sourceRefId: 'SRC-1', pageStart: 1, pageEnd: 1 },
                  { sourceRefId: 'SRC-REL', pageStart: 2, pageEnd: 2 },
                  { sourceRefId: 'SRC-UNUSED', pageStart: 2, pageEnd: 2 },
                ],
              }),
            ),
    ),
  };
  const reader = withRelatedContext
    ? {
        readAllSourceUnits: jest.fn(async () => [
          {
            unitId: 'UNIT-REL-1',
            kind: 'paragraph',
            text: 'Please refer to 777-SL-31-064 for more information.',
            sourceRefIds: ['SRC-REL'],
          },
        ]),
      }
    : undefined;
  const documentManagement = withRelatedContext
    ? {
        listCurrentReferenceTargets: jest.fn(async () => [
          {
            familyId: 'FAMILY-SL-1',
            documentVersionId: 'DV-SL-1',
            canonicalDocumentNumber: '777-SL-31-064',
            documentFamily: 'SL',
            issuerAuthority: 'BOEING',
          },
        ]),
      }
    : undefined;
  const serviceScope = {
    authorizeOpenClawWorkItem: jest.fn(async () => verifiedScope()),
    authorizeOpenClawReview: jest.fn(async () => verifiedScope()),
    authorizeOpenClawAttempt: jest.fn(async () => ({
      ...verifiedScope(),
      attemptRef: 'AQ-REVIEW-1',
    })),
  };
  const dispatch = {
    isBusy: jest.fn().mockResolvedValue(false),
    readExecution: jest.fn().mockResolvedValue(null),
    prepareAndClaim: jest.fn(),
  };
  const service = new CanonicalHostOpenClawReviewService(
    conversations as never,
    workItems as never,
    engineerReviews as never,
    assessment as never,
    attempts as never,
    artifactStore as never,
    serviceScope as never,
    dispatch as never,
    reader as never,
    documentManagement as never,
  );
  return {
    service,
    dispatch,
    attempts,
    conversations,
    workItems,
    engineerReviews,
    assessment,
    serviceScope,
    artifactStore,
    expireLease() {
      row = {
        ...row!,
        leaseExpiresAt: new Date('2020-01-01T00:00:00.000Z'),
      };
    },
    markCommittingAndExpireLease() {
      row = {
        ...row!,
        status: 'COMMITTING',
        commitStartedAt: new Date('2026-08-26T10:00:30.000Z'),
        leaseExpiresAt: new Date('2020-01-01T00:00:00.000Z'),
      };
    },
    result(
      selectedTask: OpenClawTaskEnvelope,
      toolVersions: Record<string, string>,
      skillVersion: string = REVIEW_MINIMUM_COMPATIBLE_SKILL_VERSION,
      modelVersion: string = 'GLM-5.3',
      profileRef: string = REVIEW_PROFILE_REF,
      withDraft: boolean = false,
    ): OpenClawResultEnvelope {
      return sealResultEnvelope({
        schemaVersion: 'wiselink.3_1.openclaw_result_envelope.v1',
        actionAttemptId: selectedTask.actionAttemptId,
        operationRef: selectedTask.operationRef,
        taskType: 'OPENCLAW_INTERACTIVE_REVIEW',
        workItemId: selectedTask.workItemId,
        baseRevision: selectedTask.baseRevision,
        status: 'SUCCEEDED',
        businessOutcome: 'CANDIDATE_READY',
        candidateStatus: null,
        modelOutput: JSON.stringify({
          schemaVersion: 'wiselink.3_1.review_turn_candidate.v1.c3',
          mode: 'INTERACTIVE_REVIEW',
          reviewConversationRef: 'RC-1',
          reviewTurnRef: 'RT-1',
          responseType: withDraft ? 'REVIEW_ACTION_DRAFT' : 'ANSWER',
          answer: 'Candidate answer.',
          sourceRefs: ['SRC-1'],
          missingInputs: [],
          candidateEvidenceRefs: [],
          reviewActionDraft: withDraft
            ? {
                baseRevision: 7,
                evaluationItemId: 'RULE-1',
                proposedStatus: 'review_required',
                resolvedGapRefs: [],
                adoptedInputRefs: ['engineer-input:ESI-1'],
                sourceRefs: ['SRC-1'],
                assumptions: [],
                affectedItemIds: ['RULE-1'],
                overallImpact: true,
                uncertaintyDispositions: [],
                decisionSnapshot: {
                  assessmentAsOf: '2026-08-26T10:00:00.000Z',
                  evidenceHorizon: ['SOURCE_DOCUMENT_COMPLETE'],
                  currentBestJudgment: 'Candidate answer.',
                  alternativeJudgments: [],
                  decisionMaturity: 'PRELIMINARY',
                  decisiveFacts: [],
                  assumptions: [],
                  residualUncertainties: [],
                  uncertaintyDispositions: [],
                  controlsAndMitigations: [],
                  monitoringPlan: null,
                  validUntil: null,
                  reviewBy: null,
                  reopenTriggers: [],
                  whatWouldChangeDecision: [],
                  candidateOnly: true,
                },
              }
            : null,
          affectedItemIds: withDraft ? ['RULE-1'] : [],
          warnings: [],
          runtime: {
            runtimeAppId: 'app_17c3zn24kv2',
            profileRef,
          },
        }),
        outputArtifactRefs: [],
        sourceRefs: [...selectedTask.sourceRefs],
        factsConsidered: [],
        missingInputs: [],
        conflicts: [],
        warnings: [],
        modelVersion,
        promptVersion: 'review-prompt.v1',
        skillVersion,
        toolVersions,
        runMetrics: { durationMs: 1, inputUnits: 1, outputUnits: 1 },
        errorCode: null,
        errorDetail: null,
      });
    },
  };
}

function actionAttemptRow(task: OpenClawTaskEnvelope): ActionAttemptRow {
  const now = new Date('2026-08-26T10:00:00.000Z');
  return {
    attemptId: task.actionAttemptId,
    operationRef: task.operationRef,
    triggerRequestId: 'REQ-REVIEW-1',
    workItemId: task.workItemId,
    actionType: task.taskType,
    attemptNo: 1,
    status: 'RUNNING',
    requestOrigin: 'OPENCLAW_MCP_V1',
    tenantId: task.tenantId,
    actorUserId: 'actor-1',
    priority: 100,
    inputRevision: task.inputRevision,
    baseRevision: task.baseRevision,
    documentVersionId: task.documentVersionId,
    taskEnvelopeJson: JSON.stringify(task),
    taskInputHash: task.inputHash,
    resultEnvelopeJson: null,
    resultContentHash: null,
    idempotencyKey: task.idempotencyKey,
    claimCount: 1,
    retryCount: 0,
    maxAttempts: 3,
    leaseOwner: 'service:openclaw',
    leaseToken: '00000000-0000-4000-8000-000000000001',
    leaseGeneration: 1,
    leaseExpiresAt: new Date('2099-08-26T10:01:00.000Z'),
    lastHeartbeatAt: now,
    nextAttemptAt: now,
    deadlineAt: new Date('2099-08-26T10:10:00.000Z'),
    cancelRequestedAt: null,
    cancelReason: null,
    terminalReason: null,
    projectionApplied: false,
    executorSessionKey: null,
    commitStartedAt: null,
    leaseSlot: 0,
    startedAt: now,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function verifiedScope() {
  return {
    principalId: 'service:openclaw',
    appId: 'app_17bzc551rsg',
    tenantId: 'tenant-1',
    workItemId: 'WI-1',
    authorizationFingerprint: 'sha256:scope',
  };
}

function parsedWorkItem(): CanonicalWorkItemProjection {
  return {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: 'WI-1',
    requestId: 'WORK-REQ-1',
    revision: 7,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    permissionSnapshotVersion: 'permission-v1',
    parseAuthorization: {
      action: 'PARSE_PDF',
      actorFingerprint: 'actor-fingerprint',
      decisionId: 'decision-1',
      decisionHash: 'decision-hash',
      permissionSnapshotVersion: 'permission-v1',
    },
    source: {
      documentId: 'DOC-1',
      documentVersionId: 'DV-1',
      parserRequestId: 'PARSER-1',
      sourceArtifactId: 'SOURCE-1',
      sourceFileSha256: 'b'.repeat(64),
      sourceByteLength: 100,
      driveFileToken: 'drive-token',
      driveSourceVersion: 'drive-version',
    },
    classification: {
      status: 'CONFIRMED',
      normalizedFamily: 'SB',
      classifierReleaseId: 'classifier',
      classifierReleaseHash: 'classifier-hash',
      parserProfileId: 'parser',
      parserProfileHash: 'parser-hash',
      fingerprint: 'fingerprint',
    },
    package: {
      packageId: 'PKG-1',
      contractId: 'techpub.parsed-package.v1',
      contractRevision: 'frozen.2',
      artifact: {
        storeRole: 'UnifiedArtifactStoreCandidate',
        ref: 'artifact://package',
        sha256: 'a'.repeat(64),
        byteLength: 100,
        mediaType: 'application/json',
      },
      contentHash: 'content-hash',
      semanticHash: 'semantic-hash',
      provenanceHash: 'provenance-hash',
      coverageHash: 'coverage-hash',
      resultStatus: 'complete',
      title: 'Test package',
      contentUnitCount: 1,
      sourceRefCount: 2,
      readerReceiptId: 'receipt-1',
      fullValidatorProof: {
        validatorId: 'U0Frozen2SchemaSemanticValidator',
        validatorRevision: 'validator-v1',
        contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
        artifactSha256: 'a'.repeat(64),
      },
    },
    integratedAssessment: {
      status: 'BASE_RULE_CANDIDATE_READY',
      baseRules: {
        status: 'CANDIDATE_ONLY',
        revision: 1,
        sourceResultId: 'openclaw-dynamic://1',
        criterionSetId: 'RULESET-1',
        criterionCount: 1,
        evaluationItemCount: 1,
        unresolvedCount: 0,
        sourceBoundCandidateCount: 1,
        artifact: {
          storeRole: 'UnifiedArtifactStoreCandidate',
          ref: 'artifact://base',
          sha256: 'c'.repeat(64),
          byteLength: 100,
          mediaType: 'application/json',
        },
        actionAttemptId: 'ATT-BASE-1',
      },
      engineerReviews: null,
      overallSynthesis: null,
      overallForAeoConfirmation: null,
    },
    translation: null,
    assessment: null,
    aeo: null,
    failure: null,
    recordingFailure: null,
  };
}

function matchingApplicabilityInput(
  item: CanonicalWorkItemProjection,
): CanonicalApplicabilityInputProjection {
  return {
    schemaVersion: 'wiselink.3_1.applicability_input_projection.v1',
    applicabilityContextRef: 'applicability-context://B-1266/2026-06-05',
    workItemId: item.workItemId,
    documentVersionId: item.source.documentVersionId,
    sourcePackageId: item.package!.packageId,
    sourcePackageContentHash: item.package!.contentHash,
    sourcePackageArtifactSha256: item.package!.artifact.sha256,
    targetBindingHash: 'target-binding-hash',
    selectionRevision: 'selection-v1',
    bindingRevision: 'binding-v1',
    currentness: 'CURRENT',
    aircraftNumber: 'B-1266',
    assessmentAsOf: '2026-06-05',
    fleetMasterData: {
      schemaVersion: 'wiselink.v3_1.applicability_fleet.fleet_master_data.v1',
      sourceSnapshotId: 'fleet-snapshot-1',
      sourceRevisionKey: 'fleet-revision-1',
      authorityRevision: 'fleet-authority-1',
      sourceAsOf: '2026-06-05T00:00:00.000Z',
      assets: [],
      facts: [],
    },
  };
}

function matchingApplicabilityResult(
  item: CanonicalWorkItemProjection,
): CanonicalApplicabilityCandidateProjection {
  return {
    schemaVersion: 'wiselink.3_1.applicability_candidate_projection.v1',
    status: 'CANDIDATE_ONLY',
    currentness: 'CURRENT',
    staleReason: null,
    sourceResultId: 'openclaw-applicability://RESULT-RELATED',
    actionAttemptId: 'ATT-RELATED',
    inputRevision: 3,
    documentId: item.source.documentId,
    documentVersionId: item.source.documentVersionId,
    sourcePackageId: item.package!.packageId,
    sourcePackageContentHash: item.package!.contentHash,
    translationActionAttemptId: 'ATT-TRANSLATION',
    applicabilityContextRef: 'applicability-context://related',
    applicabilityBindingRevision: 'binding-v1',
    aircraftNumber: 'B-1266',
    assessmentAsOf: '2026-06-05',
    fleetSourceSnapshotId: 'fleet-snapshot-1',
    fleetSourceRevisionKey: 'fleet-revision-1',
    fleetAuthorityRevision: 'fleet-authority-1',
    fleetSourceAsOf: '2026-06-05T00:00:00.000Z',
    sourceExpressionCount: 1,
    sourceRefCount: 1,
    decision: 'APPLICABLE',
    kleeneResult: true,
    pass: true,
    blockingUnknownCount: 0,
    artifact: {
      storeRole: 'UnifiedArtifactStoreCandidate',
      ref: 'artifact://related-applicability',
      sha256: 'd'.repeat(64),
      byteLength: 100,
      mediaType: 'application/json',
    },
  };
}
