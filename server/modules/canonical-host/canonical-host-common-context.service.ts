import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';

import type {
  CanonicalCommonAssessmentContext,
  CanonicalReferenceTargetResolution,
  CanonicalRelatedContextSnapshotItem,
  CanonicalWorkItemProjection,
  ReviewScopeSelection,
  UnifiedReaderQueryResult,
} from '@shared/api.interface';
import {
  ReviewConversationRepository,
  type PersistedReviewTurn,
} from '../review-persistence/review-conversation.repository';
import { DocumentManagementHostedService } from '../document-management/src/hosted/nest';
import { UNIFIED_ARTIFACT_STORE } from '../unified-reader/unified-reader.constants';
import { UnifiedArtifactReadScope } from '../unified-reader/unified-artifact-read-scope';
import { UnifiedReaderService } from '../unified-reader/unified-reader.service';
import type { UnifiedArtifactStorePort } from '../unified-reader/unified-reader.types';
import { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';
import type { FrozenReviewSourceRef } from './canonical-host-openclaw-review.contract';
import {
  canonicalReferenceResolutionOr,
  canonicalReferenceSelectionKey,
  deriveCanonicalReferenceMentionPreview,
  finalizeCanonicalReferenceMentionPreview,
  type CanonicalReferenceMentionCandidate,
} from './canonical-reference-mention-preview';
import { buildCanonicalRelatedContextSnapshot } from './canonical-related-context-snapshot';
import {
  relatedContextAssessmentTarget,
  resolveCanonicalRelatedTargetApplicability,
  type CanonicalRelatedContextAssessmentTarget,
  type CanonicalRelatedTargetApplicabilityResolution,
} from './canonical-related-context-applicability';
import { projectCanonicalStructuredContentUnit } from './canonical-structured-content-projection';
import { sameReviewBusinessScope } from '../review-persistence/review-business-scope';
import { DialogueRepository } from './dialogue.repository';
import { CanonicalHostEngineerReviewService } from './canonical-host-engineer-review.service';
import { isJobAidProblemProjection } from '@shared/jobaid-problem-assessment.interface';
import type {
  JobAidEngineerPreparationFacts,
  JobAidPreparationScope,
  JobAidTaskPurpose,
} from './jobaid-preparation-view';

const CANONICAL_APP_ID = 'app_17bzc551rsg';

interface CommonContextScope {
  tenantId: string;
  actorId: string;
}

interface CommonContextHistorySelection {
  asOf: string;
  reviewConversationId?: string;
  beforeTurnNo?: number;
  reviewScope?: ReviewScopeSelection;
  includedDiscussionTurnIds?: string[];
}

interface ReviewRelatedContextBuild {
  mentionSourceRefIds: Set<string>;
  resourceRefs: FrozenReviewSourceRef[];
  items: CanonicalRelatedContextSnapshotItem[];
  sections: CanonicalCommonAssessmentContext['documentReading']['sections'];
  documentReadingStatus: 'AVAILABLE' | 'UNAVAILABLE';
  context: Record<string, unknown>;
  /** Complete bindings are Host-only; common is the model-safe projection. */
  readingEvidence?: AssessmentEvidence[];
}

interface ResolvedReviewReferenceTarget extends CanonicalRelatedTargetApplicabilityResolution {
  resolution: CanonicalReferenceTargetResolution;
  publisherCandidate: string | null;
  resourceRefs: FrozenReviewSourceRef[];
  readingEvidence?: AssessmentEvidence[];
}

/** Builds background without requiring a JobAid or Overall result to exist. */
@Injectable()
export class CanonicalHostCommonContextService {
  private readonly logger = new Logger(CanonicalHostCommonContextService.name);

  constructor(
    private readonly conversations: ReviewConversationRepository,
    private readonly workItems: MiaodaWorkItemRepository,
    @Inject(UNIFIED_ARTIFACT_STORE)
    private readonly artifactStore: UnifiedArtifactStorePort,
    @Optional() private readonly reader?: UnifiedReaderService,
    @Optional()
    private readonly documentManagement?: DocumentManagementHostedService,
    @Optional() private readonly dialogues?: DialogueRepository,
    @Optional() private readonly engineerReviews?: CanonicalHostEngineerReviewService,
  ) {}

  /** Full pending input index, independent of the bounded discussion summary.
   * Caller retains the existing source authorization and actor SQL context. */
  async readPreparationFacts(input: {
    workItem: CanonicalWorkItemProjection;
    tenantId: string;
    actorUserId: string;
    purpose: JobAidTaskPurpose;
    selection?: JobAidPreparationScope;
    browserRead?: true;
  }): Promise<JobAidEngineerPreparationFacts> {
    const scope = {tenantId:input.tenantId,actorId:input.actorUserId};
    if (!await this.conversations.hasActiveOfficialActorMapping(scope))
      throw new Error('JOBAID_ACTOR_AUTHORIZATION_CHANGED');
    const loaded = await this.workItems.loadTenantScopedProjection(input.workItem.workItemId,input.tenantId);
    if (!loaded || loaded.row.requestedByUserId !== input.actorUserId ||
        loaded.row.documentVersionId !== input.workItem.source.documentVersionId)
      throw new Error('COMMON_CONTEXT_WORK_ITEM_NOT_VISIBLE');
    const selection = input.selection;
    const aggregate = selection?.reviewConversationId
      ? await this.conversations.loadById(selection.reviewConversationId)
      : await this.conversations.loadCurrent({...scope,workItemId:input.workItem.workItemId});
    if (aggregate && (aggregate.conversation.tenantId !== input.tenantId ||
        aggregate.conversation.actorId !== input.actorUserId ||
        aggregate.conversation.workItemId !== input.workItem.workItemId))
      throw new Error('REVIEW_CONVERSATION_CHANGED');
    if (selection?.reviewConversationId && !aggregate) throw new Error('REVIEW_CONVERSATION_CHANGED');
    const turns = (aggregate?.turns ?? []).filter(turn =>
      sameReviewBusinessScope(turn.reviewScope, undefined) &&
      (selection?.beforeTurnNo === undefined || turn.turnNo < selection.beforeTurnNo) &&
      (selection?.includedDiscussionTurnIds === undefined ||
        selection.includedDiscussionTurnIds.includes(turn.reviewTurnId)),
    );
    const facts: JobAidEngineerPreparationFacts = {
      pendingEngineerInputs:turns.filter(turn => !turn.assistantCandidate?.jobAidWorkingUpdate).map(turn => ({
        ref:turn.engineerSuppliedInputId,revision:turn.inputRevision,kind:'REVIEW_INSTRUCTION',
        text:turn.userMessage,sourcePart:'USER',origin:'REVIEW_CONVERSATION',recordedAt:turn.createdAt.toISOString(),
      })),
      savedUpdates:turns.flatMap(turn => {
        const update = turn.assistantCandidate?.jobAidWorkingUpdate;
        return update ? [{...structuredClone(update),instruction:turn.userMessage}] : [];
      }),
      humanConfirmedDecisions:[],humanConfirmationStatus:'NOT_RECORDED',limitations:[],
    };
    const currentTurn = aggregate?.turns.find(turn => turn.turnNo === selection?.beforeTurnNo);
    if (currentTurn) facts.taskGoal = {instruction:currentTurn.userMessage,targetIssueKeys:[...(currentTurn.targetIssueKeys ?? [])]};
    if (this.dialogues) {
      const contributions = await this.dialogues.relevantContributions(
        {...scope,...(input.browserRead ? {browserRead:true as const} : {})},[input.workItem.workItemId],
      );
      facts.pendingEngineerInputs.push(...contributions.filter(row => !row.consumed_working_ref &&
        (input.purpose !== 'PROBLEM_REVIEW' || selection?.selectedContributionRefs?.includes(row.contribution_ref)),
      ).map(row => ({ref:row.contribution_ref,revision:row.revision,kind:row.kind,text:row.selected_text,
        sourcePart:row.source_part,origin:'PERSONAL_DIALOGUE' as const,
        recordedAt:new Date(row._created_at).toISOString()})));
    } else facts.limitations.push('PERSONAL_DIALOGUE_READER_UNAVAILABLE');
    const projection = input.workItem.integratedAssessment?.engineerReviews;
    if (projection && this.engineerReviews && !isJobAidProblemProjection(input.workItem.integratedAssessment?.baseRules)) {
      const context = await this.engineerReviews.modelContext(input.workItem);
      facts.humanConfirmedDecisions = context.effective.filter(review => review.status === 'ENGINEER_CONFIRMED').map(review => ({
        sequence:review.sequence,criterionId:review.criterionId,baseRuleRevision:review.baseRuleRevision,
        baseRuleArtifactSha256:review.baseRuleArtifactSha256,actionType:review.actionType,
        decision:review.decision,status:review.status,comment:review.comment,recordedAt:review.recordedAt,
        correctedAnalysisDirection:review.correctedAnalysisDirection,
      }));
      facts.humanConfirmationStatus = 'AVAILABLE';
    } else if (projection) {
      facts.humanConfirmationStatus = 'UNAVAILABLE';
      facts.limitations.push('FORMAL_ENGINEER_CONFIRMATION_NOT_READABLE');
    }
    return facts;
  }

  async buildForWorkItem(
    workItem: CanonicalWorkItemProjection,
    tenantId: string,
    asOf: string,
    readScope?: UnifiedArtifactReadScope,
  ): Promise<CanonicalCommonAssessmentContext> {
    return (
      await this.buildForWorkItemWithEvidence(
        workItem,
        tenantId,
        asOf,
        readScope,
      )
    ).common;
  }

  async buildForWorkItemWithEvidence(
    workItem: CanonicalWorkItemProjection,
    tenantId: string,
    asOf: string,
    readScope?: UnifiedArtifactReadScope,
    historySelection?: Omit<CommonContextHistorySelection, 'asOf'>,
    originalUnits?: UnifiedReaderQueryResult[],
  ): Promise<{
    common: CanonicalCommonAssessmentContext;
    readingEvidence: AssessmentEvidence[];
    availableReadingEvidence: AssessmentEvidence[];
  }> {
    // Service execution uses the existing WorkItem owner, not a service actor,
    // for ordinary discussion and cross-document access.
    const loaded = await this.workItems.loadTenantScopedProjection(
      workItem.workItemId,
      tenantId,
    );
    if (
      !loaded ||
      loaded.row.documentVersionId !== workItem.source.documentVersionId
    ) {
      throw new Error('COMMON_CONTEXT_WORK_ITEM_NOT_VISIBLE');
    }
    return this.build(
      workItem,
      {
        tenantId,
        actorId: loaded.row.requestedByUserId,
      },
      { ...historySelection, asOf },
      readScope,
      originalUnits,
    );
  }

  async build(
    workItem: CanonicalWorkItemProjection,
    scope: CommonContextScope,
    history: CommonContextHistorySelection,
    readScope: UnifiedArtifactReadScope = new UnifiedArtifactReadScope(
      this.artifactStore,
    ),
    originalUnits?: UnifiedReaderQueryResult[],
  ): Promise<{
    common: CanonicalCommonAssessmentContext;
    related: ReviewRelatedContextBuild;
    readingEvidence: AssessmentEvidence[];
    availableReadingEvidence: AssessmentEvidence[];
  }> {
    const actorMappingActive =
      await this.conversations.hasActiveOfficialActorMapping(scope);
    const [related, aggregate] = await Promise.all([
      this.readRelatedContext(scope, workItem, actorMappingActive, readScope, originalUnits),
      actorMappingActive
        ? this.conversations.loadCurrent({
            ...scope,
            workItemId: workItem.workItemId,
          })
        : null,
    ]);
    if (
      actorMappingActive &&
      history.reviewConversationId &&
      aggregate?.conversation.reviewConversationId !==
        history.reviewConversationId
    ) {
      throw new Error('REVIEW_CONVERSATION_CHANGED');
    }
    const priorTurns = (aggregate?.turns ?? []).filter(
      (turn) =>
        (history.includedDiscussionTurnIds === undefined ||
          history.includedDiscussionTurnIds.includes(turn.reviewTurnId)) &&
        sameReviewBusinessScope(turn.reviewScope, history.reviewScope) &&
        turn.createdAt.getTime() <= Date.parse(history.asOf) &&
        (history.beforeTurnNo === undefined ||
          turn.turnNo < history.beforeTurnNo),
    );
    const common = projectCommonAssessmentContext(
      workItem,
      related,
      priorTurns,
      history.includedDiscussionTurnIds !== undefined,
    );
    const includedTurns = selectDiscussionTurns(
      priorTurns,
      history.includedDiscussionTurnIds !== undefined,
    );
    if (!actorMappingActive) common.discussion.status = 'ACCESS_DENIED';
    const delivered = new Set(
      common.relatedMaterials.items.flatMap((item) =>
        item.readFragments.map((fragment) =>
          JSON.stringify([item.documentVersionRef, fragment.sourceRefId]),
        ),
      ),
    );
    return {
      related,
      common,
      availableReadingEvidence: [
        ...(related.readingEvidence ?? []),
        ...includedTurns.map(
          (turn): AssessmentEvidence => ({
            evidenceRef: `engineer-statement:${turn.engineerSuppliedInputId}`,
            kind: 'ENGINEER_STATEMENT',
            origin: 'REVIEW_CONVERSATION',
            title: `工程师陈述 · 第 ${turn.turnNo} 轮`,
            versionLabel: null,
            excerpt: turn.userMessage,
            reviewConversationId: turn.reviewConversationId,
            reviewTurnId: turn.reviewTurnId,
            engineerSuppliedInputId: turn.engineerSuppliedInputId,
            recordedAt: turn.createdAt.toISOString(),
          }),
        ),
      ],
      readingEvidence: (related.readingEvidence ?? []).filter(
        (item) =>
          item.kind === 'DOCUMENT_PASSAGE' &&
          delivered.has(
            JSON.stringify([item.documentVersionId, item.sourceRefId]),
          ),
      ),
    };
  }

  private async readRelatedContext(
    scope: CommonContextScope,
    workItem: CanonicalWorkItemProjection,
    actorMappingActive: boolean,
    readScope: UnifiedArtifactReadScope,
    originalUnits?: UnifiedReaderQueryResult[],
  ): Promise<ReviewRelatedContextBuild> {
    if (!this.reader || (!workItem.package && !originalUnits)) {
      return unavailableReviewRelatedContext(
        'RELATED_CONTEXT_RUNTIME_NOT_CONFIGURED',
      );
    }
    let sections: ReviewRelatedContextBuild['sections'] = [];
    let documentReadingStatus: ReviewRelatedContextBuild['documentReadingStatus'] =
      'UNAVAILABLE';
    try {
      const allUnits = originalUnits ?? await this.reader.readAllSourceUnits({
        artifact: workItem.package.artifact,
        packageId: workItem.package.packageId,
        documentVersionId: workItem.source.documentVersionId,
        readScope,
      });
      const browserUnits = allUnits
        .map((unit, index) =>
          projectCanonicalStructuredContentUnit(unit, index + 1),
        )
        .filter((unit) => unit !== null);
      documentReadingStatus = 'AVAILABLE';
      sections = browserUnits
        .filter((unit) => unit.sectionTitle !== null)
        .map((unit) => ({
          title: unit.sectionTitle!,
          sourceRefIds: unit.sourceRefIds,
        }));
      const candidates = deriveCanonicalReferenceMentionPreview(
        browserUnits,
        workItem.package?.documentIdentity?.documentCode,
        allUnits,
      );
      const assessmentTarget = relatedContextAssessmentTarget(workItem);
      const resolved = await this.resolveReviewReferenceTargets(
        candidates,
        scope,
        assessmentTarget,
        actorMappingActive,
        readScope,
      );
      const mentions = candidates.map((mention) => {
        const target = resolved.get(canonicalReferenceSelectionKey(mention));
        return finalizeCanonicalReferenceMentionPreview({
          candidate: mention,
          primaryDocumentVersionRef: workItem.source.documentVersionId,
          targetResolution: canonicalReferenceResolutionOr(
            mention,
            target?.resolution ?? { status: 'UNAVAILABLE' },
          ),
          targetApplicability: target?.targetApplicability ?? 'NOT_EVALUATED',
          ...(target?.applicabilityResultRef
            ? { applicabilityResultRef: target.applicabilityResultRef }
            : {}),
          publisherCandidate: target?.publisherCandidate ?? null,
        });
      });
      const built = buildCanonicalRelatedContextSnapshot({
        workItemId: workItem.workItemId,
        inputRevision: workItem.revision,
        primaryDocumentVersionId: workItem.source.documentVersionId,
        assessmentTargetContextRef:
          assessmentTarget?.applicabilityContextRef ?? null,
        assessmentAsOf: assessmentTarget?.assessmentAsOf ?? null,
        mentions,
      });
      const persistedSnapshot = await this.artifactStore.persistAndReadback(
        built.bytes,
      );
      const snapshot = built.snapshot;
      const sourceReadings = uniqueReferenceReadings([...resolved.values()]);
      const relatedResources = sourceReadings.flatMap(
        (entry) => entry.resourceRefs,
      );
      const availableByTarget = new Map(
        [...resolved].map(([target, entry]) => [
          target,
          entry.resourceRefs.map((resource) => resource.sourceRefId),
        ]),
      );
      return {
        readingEvidence: sourceReadings.flatMap(
          (entry) => entry.readingEvidence ?? [],
        ),
        mentionSourceRefIds: new Set(
          mentions.flatMap((mention) => mention.sourceRefIds),
        ),
        resourceRefs: relatedResources,
        items: snapshot.items,
        sections,
        documentReadingStatus,
        context: {
          status: 'AVAILABLE',
          schemaVersion: snapshot.schemaVersion,
          snapshotRef: snapshot.snapshotRef,
          snapshotArtifact: persistedSnapshot.artifact,
          inputRevision: snapshot.inputRevision,
          primaryDocumentVersionRef: snapshot.primaryDocumentVersionRef,
          mode: snapshot.mode,
          policyVersion: snapshot.policyVersion,
          availability: snapshot.availability,
          downgradeReasons: snapshot.downgradeReasons,
          unresolvedMentions: snapshot.unresolvedMentions,
          retrievalReceipts: snapshot.retrievalReceipts,
          usagePolicy: {
            candidateOnly: true,
            readOnly: true,
            includedInAssessmentInput: false,
          },
          items: snapshot.items.map((item) => {
            // The snapshot keeps a legacy alias; the model receives the
            // existing sourceAuthority field, not a control-plane authority.
            const { authority: _legacyAuthority, ...safeItem } = item;
            return {
              ...safeItem,
              availableRelatedSourceRefIds:
                availableByTarget.get(canonicalReferenceSelectionKey(item)) ?? [],
            };
          }),
        },
      };
    } catch (error) {
      this.logger.warn(
        `Related Context unavailable for document ${workItem.source.documentVersionId}: ${relatedContextErrorCode(error)}`,
      );
      return {
        ...unavailableReviewRelatedContext(relatedContextErrorCode(error)),
        sections,
        documentReadingStatus,
      };
    }
  }

  private async resolveReviewReferenceTargets(
    mentions: CanonicalReferenceMentionCandidate[],
    scope: CommonContextScope,
    assessmentTarget: CanonicalRelatedContextAssessmentTarget | null,
    actorMappingActive: boolean,
    readScope: UnifiedArtifactReadScope,
  ): Promise<Map<string, ResolvedReviewReferenceTarget>> {
    const selections = new Map(mentions.filter(item => !item.initialResolutionState)
      .map(item => [canonicalReferenceSelectionKey(item), item]));
    const targets = [...selections.keys()];
    // This server-side review delegation has no browser session to replay.
    // Re-read its Host-owned identity mapping and owner binding before bytes.
    if (!actorMappingActive) {
      return new Map(
        targets.map((target) => [
          target,
          unresolvedReviewReferenceTarget('ACCESS_DENIED'),
        ]),
      );
    }
    if (!this.documentManagement) {
      return new Map(
        targets.map((target) => [
          target,
          unresolvedReviewReferenceTarget('UNAVAILABLE'),
        ]),
      );
    }
    let catalogTargets: Awaited<
      ReturnType<DocumentManagementHostedService['listReferenceTargets']>
    >;
    try {
      catalogTargets =
        await this.documentManagement.listReferenceTargets([...selections.values()].map(item => ({
          canonicalDocumentNumber: item.normalizedTarget,
          ...(item.requestedBusinessRevision === undefined ? {} : { requestedBusinessRevision: item.requestedBusinessRevision }),
        })), {
          actorUserId: scope.actorId,
          tenantId: scope.tenantId,
          roles: [],
          appId: CANONICAL_APP_ID,
          env: 'runtime',
        });
    } catch (error) {
      const reasonCode = relatedContextErrorCode(error);
      this.logger.warn(`Related Context catalog unavailable: ${reasonCode}`);
      return new Map(
        targets.map((target) => [
          target,
          unresolvedReviewReferenceTarget('UNAVAILABLE', reasonCode),
        ]),
      );
    }
    const result = new Map<string, ResolvedReviewReferenceTarget>();
    const resolveTarget = async (key: string) => {
      const selection = selections.get(key)!;
      try {
        const matches = catalogTargets.filter(
          (candidate) =>
            canonicalReferenceSelectionKey({ normalizedTarget: candidate.canonicalDocumentNumber,
              requestedBusinessRevision: candidate.requestedBusinessRevision }) === key,
        );
        if (matches.length === 0) {
          result.set(
            key,
            unresolvedReviewReferenceTarget('DOCUMENT_NOT_INGESTED'),
          );
          return;
        }
        if (matches.length > 1) {
          result.set(key, {
            resolution: {
              status: 'RESOLVED_MULTIPLE',
              candidateCount: matches.length,
            },
            publisherCandidate: null,
            resourceRefs: [],
            targetApplicability: 'NOT_EVALUATED',
          });
          return;
        }
        const [match] = matches;
        const tenantBindings =
          await this.workItems.listTenantDocumentAuthorizationBindings({
            tenantId: scope.tenantId,
            documentVersionId: match.documentVersionId,
          });
        if (tenantBindings.length === 0) {
          result.set(
            key,
            unresolvedReviewReferenceTarget('DOCUMENT_NOT_INGESTED'),
          );
          return;
        }
        const bindings: typeof tenantBindings = [];
        for (const candidate of tenantBindings) {
          if (candidate.requestedByUserId !== scope.actorId) {
            continue;
          }
          const freshBinding = await this.workItems.loadAuthorizationBinding({
            workItemId: candidate.workItemId,
            tenantId: scope.tenantId,
            actorUserId: scope.actorId,
          });
          if (
            freshBinding?.workItemId === candidate.workItemId &&
            freshBinding.tenantId === candidate.tenantId &&
            freshBinding.requestId === candidate.requestId &&
            freshBinding.documentVersionId === candidate.documentVersionId &&
            freshBinding.requestedByUserId === candidate.requestedByUserId &&
            freshBinding.revision === candidate.revision
          ) {
            bindings.push(freshBinding);
          }
        }
        if (bindings.length === 0) {
          result.set(key, unresolvedReviewReferenceTarget('ACCESS_DENIED'));
          return;
        }
        if (bindings.length > 1) {
          result.set(key, {
            resolution: {
              status: 'RESOLVED_MULTIPLE',
              candidateCount: bindings.length,
            },
            publisherCandidate: null,
            resourceRefs: [],
            targetApplicability: 'NOT_EVALUATED',
          });
          return;
        }
        const [owned] = bindings;
        const loaded = await this.workItems.loadTenantScopedProjection(
          owned.workItemId,
          scope.tenantId,
        );
        if (!loaded?.projection.package) {
          result.set(key, unresolvedReviewReferenceTarget('UNAVAILABLE'));
          return;
        }
        if (
          loaded.row.workItemId !== owned.workItemId ||
          loaded.row.tenantId !== owned.tenantId ||
          loaded.row.requestedByUserId !== scope.actorId ||
          loaded.row.requestId !== owned.requestId ||
          loaded.row.documentVersionId !== match.documentVersionId ||
          loaded.row.revision !== owned.revision ||
          loaded.projection.workItemId !== owned.workItemId ||
          loaded.projection.requestId !== owned.requestId ||
          loaded.projection.revision !== owned.revision ||
          loaded.projection.source.documentVersionId !== match.documentVersionId
        ) {
          result.set(key, unresolvedReviewReferenceTarget('ACCESS_DENIED'));
          return;
        }
        const targetWorkItem = loaded.projection;
        const applicability = resolveCanonicalRelatedTargetApplicability(
          assessmentTarget,
          targetWorkItem,
        );
        const packageBytes = await readScope.readActualBytes(
          targetWorkItem.package.artifact,
        );
        const resourceRefs = relatedDocumentResourceRefs(
          packageBytes,
          targetWorkItem.package.artifact.ref,
          targetWorkItem.package.artifact.sha256,
          match.canonicalDocumentNumber,
          match.documentVersionId,
          applicability,
          readScope,
        );
        const readingEvidence = resourceRefs.flatMap(
          (resource, index): AssessmentEvidence[] => {
            const quote = resource.value.quote;
            if (typeof quote !== 'string' || !quote.trim()) return [];
            const { pageStart, pageEnd } = resource.value;
            if (
              !Number.isInteger(pageStart) ||
              Number(pageStart) < 1 ||
              !Number.isInteger(pageEnd) ||
              Number(pageEnd) < Number(pageStart)
            ) {
              throw new Error('COMMON_RELATED_EVIDENCE_LOCATOR_INVALID');
            }
            return [
              {
                evidenceRef: `overall-evidence:related:${targets.indexOf(key) + 1}:${index + 1}`,
                kind: 'DOCUMENT_PASSAGE',
                title: match.canonicalDocumentNumber,
                versionLabel:
                  targetWorkItem.package.documentIdentity?.businessRevision ??
                  null,
                excerpt: quote.trim(),
                workItemId: targetWorkItem.workItemId,
                documentVersionId: match.documentVersionId,
                sourceRefId: resource.sourceRefId,
                locator: `page ${pageStart}-${pageEnd}`,
              },
            ];
          },
        );
        result.set(key, {
          resolution: {
            status: 'RESOLVED_EXACT',
            workItemId: targetWorkItem.workItemId,
            documentVersionId: match.documentVersionId,
            canonicalDocumentNumber: match.canonicalDocumentNumber,
            businessRevision:
              targetWorkItem.package.documentIdentity?.businessRevision ?? null,
          },
          ...applicability,
          publisherCandidate: match.issuerAuthority,
          resourceRefs,
          readingEvidence,
        });
      } catch (error) {
        const reasonCode = relatedContextErrorCode(error);
        this.logger.warn(`Related Context target unavailable: ${reasonCode}`);
        result.set(
          key,
          unresolvedReviewReferenceTarget('UNAVAILABLE', reasonCode),
        );
      }
    };
    // Independent documents can overlap; bound file/DB pressure without
    // changing per-document authorization or swallowing a target's failure.
    let nextTarget = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, targets.length) }, async () => {
        while (nextTarget < targets.length) {
          const target = targets[nextTarget++];
          await resolveTarget(target);
        }
      }),
    );
    return result;
  }
}

export function projectCommonAssessmentContext(
  workItem: CanonicalWorkItemProjection,
  related: Pick<
    ReviewRelatedContextBuild,
    'context' | 'items' | 'sections' | 'resourceRefs' | 'documentReadingStatus'
  >,
  priorTurns: PersistedReviewTurn[],
  explicitlySelected = false,
): CanonicalCommonAssessmentContext {
  // Recent turns carry the actual engineer wording and saved working answer.
  // Earlier turns are counted explicitly, never represented as a made-up summary.
  const includedTurns = selectDiscussionTurns(priorTurns, explicitlySelected);
  return {
    primaryDocument: {
      documentVersionRef: workItem.source.documentVersionId,
      documentCode: workItem.package?.documentIdentity?.documentCode ?? null,
      businessRevision:
        workItem.package?.documentIdentity?.businessRevision ?? null,
      title: workItem.package?.title ?? '',
    },
    documentReading: {
      status: related.documentReadingStatus,
      sections: structuredClone(related.sections),
    },
    relatedMaterials: {
      status:
        related.context.status === 'AVAILABLE' ? 'AVAILABLE' : 'UNAVAILABLE',
      reason:
        typeof related.context.reason === 'string'
          ? related.context.reason
          : null,
      items: related.items.map((item) => {
        const proceduralOnly =
          item.relationTypeCandidates.length > 0 &&
          item.relationTypeCandidates.every(
            (role) => role === 'PROCEDURE_SUPPORT',
          );
        const refs = related.resourceRefs.filter((resource) => {
          const document = resource.value.relatedDocument as
            | Record<string, unknown>
            | undefined;
          return document?.documentVersionRef === item.resolvedDocumentVersionRef;
        });
        return {
          documentCode: item.normalizedTarget,
          documentVersionRef: item.resolvedDocumentVersionRef ?? null,
          documentType: item.documentType,
          contributionRoles: [...item.contributionRoleCandidates],
          sourceAuthority: item.sourceAuthority,
          targetApplicability: item.targetApplicability,
          currentness: item.currentness,
          availability: item.availability,
          contextUse: 'BACKGROUND_ONLY' as const,
          selection: proceduralOnly
            ? ('PROCEDURAL_REFERENCE' as const)
            : ('BACKGROUND_CANDIDATE' as const),
          reasonCodes: [...item.reasonCodes],
          availableSourceRefIds: refs.map((ref) => ref.sourceRefId),
          // A procedural citation stays in the catalog. Its whole manual is
          // not automatically inserted as issue-analysis background.
          readFragments: proceduralOnly
            ? []
            : refs.flatMap((ref) =>
                typeof ref.value.quote === 'string' && ref.value.quote.trim()
                  ? [{ sourceRefId: ref.sourceRefId, excerpt: ref.value.quote }]
                  : [],
              ),
        };
      }),
    },
    discussion: {
      status: priorTurns.length ? 'AVAILABLE' : 'NO_PRIOR_DISCUSSION',
      totalPriorTurns: priorTurns.length,
      omittedEarlierTurns: priorTurns.length - includedTurns.length,
      turns: includedTurns.map((turn) => ({
        turnNo: turn.turnNo,
        fromCurrentRevision: turn.inputRevision === workItem.revision,
        question: turn.userMessage,
        selectedEvaluationItemId: turn.selectedEvaluationItemId ?? null,
        attachmentNames: turn.attachmentBindings.map(
          (binding) => binding.fileName,
        ),
        workingAnswer: turn.assistantCandidate?.answer ?? null,
        missingInputs: [...(turn.assistantCandidate?.missingInputs ?? [])],
        warnings: [...(turn.assistantCandidate?.warnings ?? [])],
      })),
      usage: 'DISCUSSION_NOT_ADOPTION',
    },
    knowledgeRetrieval: { status: 'NOT_CONNECTED', fragments: [] },
  };
}

function selectDiscussionTurns(
  turns: PersistedReviewTurn[],
  explicitlySelected: boolean,
): PersistedReviewTurn[] {
  const ordered: PersistedReviewTurn[] = [...turns].sort(
    (a, b) => a.turnNo - b.turnNo,
  );
  // Automatic history stays bounded; an explicit selection is already the
  // user's input scope and must not silently lose an earlier correction.
  return explicitlySelected ? ordered : ordered.slice(-12);
}

function relatedDocumentResourceRefs(
  bytes: Uint8Array,
  resourceArtifactRef: string,
  resourceArtifactSha256: string,
  normalizedTarget: string,
  documentVersionRef: string,
  applicability: CanonicalRelatedTargetApplicabilityResolution,
  readScope: UnifiedArtifactReadScope,
): FrozenReviewSourceRef[] {
  const raw: unknown = readScope.parseJson(bytes);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('REVIEW_RELATED_PACKAGE_JSON_INVALID');
  }
  const sourceRefs = (raw as Record<string, unknown>).sourceRefs;
  if (!Array.isArray(sourceRefs)) {
    throw new Error('REVIEW_RELATED_PACKAGE_SOURCE_REFS_INVALID');
  }
  return sourceRefs.map((value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('REVIEW_RELATED_PACKAGE_SOURCE_REF_INVALID');
    }
    const ref = value as Record<string, unknown>;
    return {
      sourceRefId: requiredText(
        ref.sourceRefId,
        'REVIEW_RELATED_PACKAGE_SOURCE_REF_ID_INVALID',
      ),
      resourceArtifactRef,
      resourceArtifactSha256,
      value: {
        ...structuredClone(ref),
        relatedDocument: {
          normalizedTarget,
          documentVersionRef,
          contextUse: 'BACKGROUND_ONLY',
          targetApplicability: applicability.targetApplicability,
          ...(applicability.applicabilityResultRef
            ? {
                applicabilityResultRef: applicability.applicabilityResultRef,
              }
            : {}),
        },
      },
    };
  });
}

function unavailableReviewRelatedContext(
  reason: string,
): ReviewRelatedContextBuild {
  return {
    mentionSourceRefIds: new Set(),
    resourceRefs: [],
    items: [],
    sections: [],
    documentReadingStatus: 'UNAVAILABLE',
    context: {
      status: 'UNAVAILABLE',
      reason,
      usagePolicy: {
        candidateOnly: true,
        readOnly: true,
        includedInAssessmentInput: false,
      },
      items: [],
    },
  };
}

/** Several citation selections can name the same exact publication. They keep
 * separate snapshot items, while the unchanged source resource enters Review
 * once. Never discard a different artifact, source value or authorization carrier. */
function uniqueReferenceReadings(entries: ResolvedReviewReferenceTarget[]): ResolvedReviewReferenceTarget[] {
  const selected = new Map<string, ResolvedReviewReferenceTarget>();
  const comparable = (entry: ResolvedReviewReferenceTarget) => ({ ...entry,
    readingEvidence: entry.readingEvidence?.map(({ evidenceRef: _occurrenceRef, ...evidence }) => evidence),
  });
  for (const entry of entries) {
    if (entry.resolution.status !== 'RESOLVED_EXACT') continue;
    const key = entry.resolution.documentVersionId;
    const prior = selected.get(key);
    if (prior && canonicalJson(comparable(prior)) !== canonicalJson(comparable(entry)))
      throw new Error('COMMON_RELATED_SOURCE_IDENTITY_CHANGED');
    if (!prior) selected.set(key, entry);
  }
  return [...selected.values()];
}

function unresolvedReviewReferenceTarget(
  status:
    | 'UNRESOLVED'
    | 'DOCUMENT_NOT_INGESTED'
    | 'UNAVAILABLE'
    | 'ACCESS_DENIED'
    | 'UNSUPPORTED_DOCUMENT',
  reasonCode?: string,
): ResolvedReviewReferenceTarget {
  return {
    resolution:
      status === 'UNAVAILABLE' && reasonCode
        ? { status, reasonCode }
        : { status },
    publisherCandidate: null,
    resourceRefs: [],
    targetApplicability: 'NOT_EVALUATED',
  };
}

function relatedContextErrorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z][A-Z0-9_:.-]{0,159}$/u.test(error.code)
  ) {
    return error.code;
  }
  if (
    error instanceof Error &&
    /^[A-Z][A-Z0-9_:.-]{0,159}$/u.test(error.message)
  ) {
    return error.message;
  }
  return 'RELATED_CONTEXT_BUILD_FAILED';
}

function requiredText(value: unknown, code: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw Object.assign(new Error(code), { code, statusCode: 400 });
  }
  return value;
}
