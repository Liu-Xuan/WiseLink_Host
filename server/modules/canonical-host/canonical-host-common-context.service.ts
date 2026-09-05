import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import type {
  CanonicalCommonAssessmentContext,
  CanonicalReferenceTargetResolution,
  CanonicalRelatedContextSnapshotItem,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import {
  ReviewConversationRepository,
  type PersistedReviewTurn,
} from '../review-persistence/review-conversation.repository';
import { DocumentManagementHostedService } from '../document-management/src/hosted/nest';
import { UNIFIED_ARTIFACT_STORE } from '../unified-reader/unified-reader.constants';
import { UnifiedReaderService } from '../unified-reader/unified-reader.service';
import type { UnifiedArtifactStorePort } from '../unified-reader/unified-reader.types';
import { assertNoDuplicateJsonKeys } from '../unified-reader/unified-reader.utils';
import { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';
import type { FrozenReviewSourceRef } from './canonical-host-openclaw-review.contract';
import {
  canonicalReferenceResolutionOr,
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

const CANONICAL_APP_ID = 'app_17bzc551rsg';

interface CommonContextScope {
  tenantId: string;
  actorId: string;
}

interface CommonContextHistorySelection {
  asOf: string;
  reviewConversationId?: string;
  beforeTurnNo?: number;
}

interface ReviewRelatedContextBuild {
  mentionSourceRefIds: Set<string>;
  resourceRefs: FrozenReviewSourceRef[];
  items: CanonicalRelatedContextSnapshotItem[];
  sections: CanonicalCommonAssessmentContext['documentReading']['sections'];
  documentReadingStatus: 'AVAILABLE' | 'UNAVAILABLE';
  context: Record<string, unknown>;
}

interface ResolvedReviewReferenceTarget extends CanonicalRelatedTargetApplicabilityResolution {
  resolution: CanonicalReferenceTargetResolution;
  publisherCandidate: string | null;
  resourceRefs: FrozenReviewSourceRef[];
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
  ) {}

  async buildForWorkItem(
    workItem: CanonicalWorkItemProjection,
    tenantId: string,
    asOf: string,
  ): Promise<CanonicalCommonAssessmentContext> {
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
    return (
      await this.build(
        workItem,
        {
          tenantId,
          actorId: loaded.row.requestedByUserId,
        },
        { asOf },
      )
    ).common;
  }

  async build(
    workItem: CanonicalWorkItemProjection,
    scope: CommonContextScope,
    history: CommonContextHistorySelection,
  ): Promise<{
    common: CanonicalCommonAssessmentContext;
    related: ReviewRelatedContextBuild;
  }> {
    const actorMappingActive = await this.conversations
      .hasActiveOfficialActorMapping(scope)
      .catch(() => false);
    const [related, aggregate] = await Promise.all([
      this.readRelatedContext(scope, workItem, actorMappingActive),
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
        turn.createdAt.getTime() <= Date.parse(history.asOf) &&
        (history.beforeTurnNo === undefined ||
          turn.turnNo < history.beforeTurnNo),
    );
    const common = projectCommonAssessmentContext(
      workItem,
      related,
      priorTurns,
    );
    if (!actorMappingActive) common.discussion.status = 'ACCESS_DENIED';
    return {
      related,
      common,
    };
  }

  private async readRelatedContext(
    scope: CommonContextScope,
    workItem: CanonicalWorkItemProjection,
    actorMappingActive: boolean,
  ): Promise<ReviewRelatedContextBuild> {
    if (!this.reader || !workItem.package) {
      return unavailableReviewRelatedContext(
        'RELATED_CONTEXT_RUNTIME_NOT_CONFIGURED',
      );
    }
    let sections: ReviewRelatedContextBuild['sections'] = [];
    let documentReadingStatus: ReviewRelatedContextBuild['documentReadingStatus'] =
      'UNAVAILABLE';
    try {
      const allUnits = await this.reader.readAllSourceUnits({
        artifact: workItem.package.artifact,
        packageId: workItem.package.packageId,
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
        workItem.package.documentIdentity?.documentCode,
        allUnits,
      );
      const assessmentTarget = relatedContextAssessmentTarget(workItem);
      const resolved = await this.resolveReviewReferenceTargets(
        candidates,
        scope,
        assessmentTarget,
        actorMappingActive,
      );
      const mentions = candidates.map((mention) => {
        const target = resolved.get(mention.normalizedTarget);
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
      const relatedResources = [...resolved.values()].flatMap(
        (entry) => entry.resourceRefs,
      );
      const availableByTarget = new Map(
        [...resolved].map(([target, entry]) => [
          target,
          entry.resourceRefs.map((resource) => resource.sourceRefId),
        ]),
      );
      return {
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
                availableByTarget.get(item.normalizedTarget) ?? [],
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
  ): Promise<Map<string, ResolvedReviewReferenceTarget>> {
    const targets = [
      ...new Set(
        mentions
          .filter((item) => !item.initialResolutionState)
          .map((item) => item.normalizedTarget),
      ),
    ];
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
      ReturnType<DocumentManagementHostedService['listCurrentReferenceTargets']>
    >;
    try {
      catalogTargets =
        await this.documentManagement.listCurrentReferenceTargets(targets, {
          actorUserId: scope.actorId,
          tenantId: scope.tenantId,
          roles: [],
          appId: CANONICAL_APP_ID,
          env: 'runtime',
        });
    } catch {
      return new Map(
        targets.map((target) => [
          target,
          unresolvedReviewReferenceTarget('UNAVAILABLE'),
        ]),
      );
    }
    const result = new Map<string, ResolvedReviewReferenceTarget>();
    await Promise.all(
      targets.map(async (target) => {
        const matches = catalogTargets.filter(
          (candidate) =>
            canonicalReferenceLookupKey(candidate.canonicalDocumentNumber) ===
            canonicalReferenceLookupKey(target),
        );
        if (matches.length === 0) {
          result.set(
            target,
            unresolvedReviewReferenceTarget('DOCUMENT_NOT_INGESTED'),
          );
          return;
        }
        if (matches.length > 1) {
          result.set(target, {
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
            target,
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
          result.set(target, unresolvedReviewReferenceTarget('ACCESS_DENIED'));
          return;
        }
        if (bindings.length > 1) {
          result.set(target, {
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
          result.set(target, unresolvedReviewReferenceTarget('UNAVAILABLE'));
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
          result.set(target, unresolvedReviewReferenceTarget('ACCESS_DENIED'));
          return;
        }
        const targetWorkItem = loaded.projection;
        const applicability = resolveCanonicalRelatedTargetApplicability(
          assessmentTarget,
          targetWorkItem,
        );
        const packageBytes = await this.artifactStore.readActualBytes(
          targetWorkItem.package.artifact,
        );
        result.set(target, {
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
          resourceRefs: relatedDocumentResourceRefs(
            packageBytes,
            targetWorkItem.package.artifact.ref,
            targetWorkItem.package.artifact.sha256,
            target,
            match.documentVersionId,
            applicability,
          ),
        });
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
): CanonicalCommonAssessmentContext {
  // Recent turns carry the actual engineer wording and saved working answer.
  // Earlier turns are counted explicitly, never represented as a made-up summary.
  const orderedTurns = [...priorTurns].sort((a, b) => a.turnNo - b.turnNo);
  const includedTurns = orderedTurns.slice(-12);
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
          return document?.normalizedTarget === item.normalizedTarget;
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
      status: orderedTurns.length ? 'AVAILABLE' : 'NO_PRIOR_DISCUSSION',
      totalPriorTurns: orderedTurns.length,
      omittedEarlierTurns: orderedTurns.length - includedTurns.length,
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

function relatedDocumentResourceRefs(
  bytes: Uint8Array,
  resourceArtifactRef: string,
  resourceArtifactSha256: string,
  normalizedTarget: string,
  documentVersionRef: string,
  applicability: CanonicalRelatedTargetApplicabilityResolution,
): FrozenReviewSourceRef[] {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  assertNoDuplicateJsonKeys(text);
  const raw: unknown = JSON.parse(text) as unknown;
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

function unresolvedReviewReferenceTarget(
  status:
    | 'UNRESOLVED'
    | 'DOCUMENT_NOT_INGESTED'
    | 'UNAVAILABLE'
    | 'ACCESS_DENIED'
    | 'UNSUPPORTED_DOCUMENT',
): ResolvedReviewReferenceTarget {
  return {
    resolution: { status },
    publisherCandidate: null,
    resourceRefs: [],
    targetApplicability: 'NOT_EVALUATED',
  };
}

function canonicalReferenceLookupKey(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, '');
}

function relatedContextErrorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.trim()
  ) {
    return error.code.trim();
  }
  if (error instanceof Error && /^[A-Z][A-Z0-9_:.-]+$/u.test(error.message)) {
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
