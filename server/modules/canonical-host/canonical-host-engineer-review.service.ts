import { Inject, Injectable } from '@nestjs/common';

import type {
  CanonicalEngineerReviewDecision,
  CanonicalEngineerReviewLedgerProjection,
  CanonicalEngineerReviewPageContext,
  CanonicalIntegratedAssessmentProjection,
  CanonicalWorkItemProjection,
  ReviewDecisionSnapshotCandidate,
  ReviewUncertaintyDispositionCandidate,
} from '@shared/api.interface';
import {
  parseReviewAttachmentParsedArtifact,
  reviewAttachmentEvidenceStatement,
} from '../review-persistence/review-attachment-artifact';
import { UNIFIED_ARTIFACT_STORE } from '../unified-reader/unified-reader.constants';
import type { UnifiedArtifactStorePort } from '../unified-reader/unified-reader.types';
import { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';
import {
  CANONICAL_AUTHORIZATION,
  CANONICAL_HOST_CLOCK,
  CANONICAL_PERMISSION_SNAPSHOT,
  CANONICAL_WORK_ITEM_REGISTRAR,
} from './canonical-host.constants';
import type {
  CanonicalAuthorizationPort,
  CanonicalHostActor,
  CanonicalHostClockPort,
  CanonicalPermissionSnapshotPort,
  CanonicalWorkItemRegistrarPort,
} from './canonical-host.types';
import {
  readDynamicRuleReviewItems,
  type OpenClawEngineerReviewContext,
} from './openclaw-overall-synthesis.processor';
import { readActiveJobAidBrowserRules } from './canonical-job-aid-browser-rules';
import { authorizeAndLoadCanonicalWorkItem } from './canonical-authorized-work-item-reader';
import type {
  CanonicalReviewActionType,
  CanonicalReviewEvidence,
  CanonicalReviewEvidenceInput,
} from './selective-overall-resynthesis';
import { buildCanonicalAssessmentGapLedger } from './canonical-assessment-gap-ledger';

const LEDGER_KIND = 'CANONICAL_ENGINEER_REVIEW_LEDGER';
const LEDGER_VERSION = 1;

type EngineerReviewStatus = 'ENGINEER_CONFIRMED' | 'NEEDS_REVIEW';

interface EngineerReviewEntry {
  sequence: number;
  criterionId: string;
  affectedCriterionIds?: string[];
  criterionSetId: string;
  decision: CanonicalEngineerReviewDecision;
  status: EngineerReviewStatus;
  comment: string;
  actionType?: CanonicalReviewActionType;
  evidence?: CanonicalReviewEvidence[];
  resolvedMissingInputs?: string[];
  uncertaintyDispositions?: ReviewUncertaintyDispositionCandidate[];
  decisionSnapshot?: ReviewDecisionSnapshotCandidate;
  correctedAnalysisDirection?: string;
  actorUserId: string;
  recordedAt: string;
  actionAttemptId: string;
  workItemRevisionBefore: number;
  baseRuleRevision: number;
  baseRuleArtifactSha256: string;
  overallRevisionAtReview: number | null;
  overallArtifactSha256AtReview: string | null;
}

interface EngineerReviewLedger {
  kind: typeof LEDGER_KIND;
  version: typeof LEDGER_VERSION;
  workItemId: string;
  documentVersionId: string;
  packageId: string;
  criterionSetId: string;
  revision: number;
  reviews: EngineerReviewEntry[];
}

export interface RecordEngineerReviewInput {
  workItemId: string;
  expectedRevision: number;
  criterionId: string;
  decision: CanonicalEngineerReviewDecision;
  comment: string;
}

export interface RecordEngineerReviewActionInput {
  workItemId: string;
  expectedRevision: number;
  criterionId: string;
  affectedCriterionIds?: string[];
  actionType: CanonicalReviewActionType;
  comment: string;
  decision?: CanonicalEngineerReviewDecision;
  evidence?: CanonicalReviewEvidenceInput[];
  resolvedMissingInputs?: string[];
  uncertaintyDispositions?: ReviewUncertaintyDispositionCandidate[];
  decisionSnapshot?: ReviewDecisionSnapshotCandidate;
  correctedAnalysisDirection?: string;
}

export interface ResolveReviewActionGapsInput {
  workItemId: string;
  expectedRevision: number;
  gapRefs: string[];
  affectedCriterionIds: string[];
}

export interface ResolvedReviewActionGaps {
  gapRefs: string[];
  resolvedMissingInputs: string[];
  affectedCriterionIds: string[];
}

@Injectable()
export class CanonicalHostEngineerReviewService {
  constructor(
    @Inject(CANONICAL_WORK_ITEM_REGISTRAR)
    private readonly registrar: CanonicalWorkItemRegistrarPort,
    @Inject(CANONICAL_AUTHORIZATION)
    private readonly authorization: CanonicalAuthorizationPort,
    @Inject(CANONICAL_PERMISSION_SNAPSHOT)
    private readonly permissions: CanonicalPermissionSnapshotPort,
    @Inject(CANONICAL_HOST_CLOCK)
    private readonly clock: CanonicalHostClockPort,
    @Inject(UNIFIED_ARTIFACT_STORE)
    private readonly artifactStore: UnifiedArtifactStorePort,
    private readonly repository: MiaodaWorkItemRepository,
  ) {}

  async recordReview(
    input: RecordEngineerReviewInput,
    actor: CanonicalHostActor,
  ): Promise<CanonicalWorkItemProjection> {
    return this.recordReviewAction(
      { ...input, actionType: 'REVISE_JUDGMENT' },
      actor,
    );
  }

  async recordReviewAction(
    input: RecordEngineerReviewActionInput,
    actor: CanonicalHostActor,
  ): Promise<CanonicalWorkItemProjection> {
    validateReviewActionInput(input);
    let authorized = await this.authorizeAndLoad(input.workItemId, actor);
    let workItem = requiredDynamicWorkItem(authorized.workItem);
    if (workItem.revision !== input.expectedRevision) {
      throw new Error('WORK_ITEM_CAS_CONFLICT');
    }
    assertDecisionSnapshotProposalBinding(input, workItem);
    const integrated = workItem.integratedAssessment!;
    const dynamicItems = await this.readDynamicItems(workItem);
    const knownCriterionIds = new Set(
      dynamicItems.map((item) => item.criterionId),
    );
    if (!knownCriterionIds.has(input.criterionId)) {
      throw new Error(`ENGINEER_REVIEW_CRITERION_UNKNOWN:${input.criterionId}`);
    }
    const affectedCriterionIds = input.affectedCriterionIds ?? [
      input.criterionId,
    ];
    if (
      !affectedCriterionIds.includes(input.criterionId) ||
      affectedCriterionIds.some(
        (criterionId) => !knownCriterionIds.has(criterionId),
      )
    ) {
      throw new Error('ENGINEER_REVIEW_AFFECTED_CRITERION_UNKNOWN');
    }
    await this.assertResolvedEvidence(input, workItem);
    const existingLedger = await this.readLedger(workItem);
    const attempt = await this.repository.reserveAssessmentAction({
      workItemId: workItem.workItemId,
      actionType: 'RECORD_ENGINEER_REVIEW',
      triggerRequestId: workItem.requestId,
      requestOrigin: 'MIAODA',
      actorUserId: actor.userId,
      tenantId: actor.tenantId,
      attemptNo: workItem.revision,
    });
    if (!attempt.created) {
      authorized = await this.authorizeAndLoad(input.workItemId, actor);
      workItem = requiredDynamicWorkItem(authorized.workItem);
      if (
        workItem.integratedAssessment?.engineerReviews?.actionAttemptId ===
        attempt.attemptId
      ) {
        return workItem;
      }
      throw new Error('ENGINEER_REVIEW_INCOMPLETE_PRIOR_ATTEMPT');
    }
    try {
      const decision = input.decision ?? 'deferred';
      const status =
        input.actionType === 'REVISE_JUDGMENT'
          ? statusFor(decision)
          : 'NEEDS_REVIEW';
      const nextLedgerRevision = (existingLedger?.revision ?? 0) + 1;
      const entry: EngineerReviewEntry = {
        sequence: (existingLedger?.reviews.length ?? 0) + 1,
        criterionId: input.criterionId,
        affectedCriterionIds: [...affectedCriterionIds],
        criterionSetId: integrated.baseRules.criterionSetId,
        decision,
        status,
        comment: input.comment,
        actionType: input.actionType,
        ...(input.evidence
          ? {
              evidence: input.evidence.map((value, index) => ({
                ...structuredClone(value),
                sourceRefId: reviewEvidenceSourceRefId(
                  workItem.workItemId,
                  nextLedgerRevision,
                  input.criterionId,
                  index,
                ),
              })),
            }
          : {}),
        ...(input.resolvedMissingInputs
          ? { resolvedMissingInputs: [...input.resolvedMissingInputs] }
          : {}),
        ...(input.uncertaintyDispositions
          ? {
              uncertaintyDispositions: structuredClone(
                input.uncertaintyDispositions,
              ),
            }
          : {}),
        ...(input.decisionSnapshot
          ? {
              decisionSnapshot: {
                ...structuredClone(input.decisionSnapshot),
                revision: workItem.revision + 1,
                engineerConfirmationRef: attempt.attemptId,
              },
            }
          : {}),
        ...(input.correctedAnalysisDirection
          ? { correctedAnalysisDirection: input.correctedAnalysisDirection }
          : {}),
        actorUserId: actor.userId,
        recordedAt: this.clock.nowIso(),
        actionAttemptId: attempt.attemptId,
        workItemRevisionBefore: workItem.revision,
        baseRuleRevision: integrated.baseRules.revision,
        baseRuleArtifactSha256: integrated.baseRules.artifact.sha256,
        overallRevisionAtReview: integrated.overallSynthesis?.revision ?? null,
        overallArtifactSha256AtReview:
          integrated.overallSynthesis?.artifact.sha256 ?? null,
      };
      const ledger: EngineerReviewLedger = existingLedger
        ? {
            ...existingLedger,
            revision: existingLedger.revision + 1,
            reviews: [...existingLedger.reviews, entry],
          }
        : {
            kind: LEDGER_KIND,
            version: LEDGER_VERSION,
            workItemId: workItem.workItemId,
            documentVersionId: workItem.source.documentVersionId,
            packageId: workItem.package!.packageId,
            criterionSetId: integrated.baseRules.criterionSetId,
            revision: 1,
            reviews: [entry],
          };
      const bytes = encodeLedger(ledger);
      const persisted = await this.artifactStore.persistAndReadback(bytes);
      assertSameBytes(bytes, persisted.bytes);
      const projection: CanonicalEngineerReviewLedgerProjection = {
        status: 'HUMAN_REVIEW_RECORDED',
        revision: ledger.revision,
        reviewCount: ledger.reviews.length,
        criterionSetId: ledger.criterionSetId,
        artifact: persisted.artifact,
        actionAttemptId: attempt.attemptId,
      };
      const overallSynthesis = integrated.overallSynthesis
        ? {
            ...integrated.overallSynthesis,
            status: 'STALE' as const,
            staleReason: 'ENGINEER_REVIEW_CHANGED' as const,
          }
        : null;
      const nextIntegrated: CanonicalIntegratedAssessmentProjection = {
        status: overallSynthesis
          ? 'OVERALL_CANDIDATE_STALE'
          : 'BASE_RULE_CANDIDATE_READY',
        baseRules: integrated.baseRules,
        engineerReviews: projection,
        overallSynthesis,
        overallForAeoConfirmation: null,
      };
      const updated = await this.registrar.compareAndSet({
        workItemId: workItem.workItemId,
        expectedRevision: workItem.revision,
        syncPrimaryAttempt: false,
        next: {
          ...withoutRevision(workItem),
          integratedAssessment: nextIntegrated,
          aeo: null,
        },
      });
      await this.repository.completeAssessmentAction(attempt.attemptId);
      return updated;
    } catch (error) {
      await this.repository.failAssessmentAction({
        attemptId: attempt.attemptId,
        errorCode: errorCode(error),
        errorMessage: errorMessage(error),
      });
      throw error;
    }
  }

  async resolveReviewActionGaps(
    input: ResolveReviewActionGapsInput,
    actor: CanonicalHostActor,
  ): Promise<ResolvedReviewActionGaps> {
    if (
      !input.workItemId.trim() ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 1 ||
      !validDistinctTexts(input.gapRefs) ||
      input.gapRefs.length === 0 ||
      !validDistinctTexts(input.affectedCriterionIds)
    ) {
      throw new Error('ENGINEER_REVIEW_GAP_RESOLUTION_INPUT_INVALID');
    }
    const authorized = await this.authorizeAndLoad(input.workItemId, actor);
    const workItem = requiredDynamicWorkItem(authorized.workItem);
    if (workItem.revision !== input.expectedRevision) {
      throw new Error('WORK_ITEM_CAS_CONFLICT');
    }
    const context = await this.pageContext(workItem);
    if (!context || context.gapLedger.inputRevision !== workItem.revision) {
      throw new Error('ENGINEER_REVIEW_GAP_LEDGER_CURRENTNESS_INVALID');
    }
    const gapsByRef = new Map(
      context.gapLedger.gaps.map((gap) => [gap.gapRef, gap]),
    );
    const selected = input.gapRefs.map((gapRef) => {
      const gap = gapsByRef.get(gapRef);
      if (!gap) throw new Error(`ENGINEER_REVIEW_GAP_UNKNOWN:${gapRef}`);
      if (
        gap.queryability !== 'REVIEW_QUERYABLE' ||
        gap.authority.owner !== 'CANONICAL_HOST' ||
        gap.authority.modelMayClose !== false
      ) {
        throw new Error(`ENGINEER_REVIEW_GAP_NOT_QUERYABLE:${gapRef}`);
      }
      if (gap.resolutionStatus === 'RESOLVED_BY_ENGINEER_REVIEW') {
        throw new Error(`ENGINEER_REVIEW_GAP_ALREADY_RESOLVED:${gapRef}`);
      }
      return gap;
    });
    const affectedCriterionIds = uniqueSortedTexts(
      selected.flatMap((gap) => gap.affectedCriterionIds),
    );
    if (!sameTextSet(affectedCriterionIds, input.affectedCriterionIds)) {
      throw new Error('ENGINEER_REVIEW_GAP_AFFECTED_CRITERIA_MISMATCH');
    }
    return {
      gapRefs: uniqueSortedTexts(selected.map((gap) => gap.gapRef)),
      resolvedMissingInputs: uniqueSortedTexts(
        selected.map((gap) => gap.missingInputId),
      ),
      affectedCriterionIds,
    };
  }

  async pageContext(
    workItem: CanonicalWorkItemProjection,
  ): Promise<CanonicalEngineerReviewPageContext | null> {
    if (!workItem.integratedAssessment?.baseRules) return null;
    const [{ items, ledger }, rules] = await Promise.all([
      this.readDynamicItemsAndLedger(workItem),
      readActiveJobAidBrowserRules(
        workItem.integratedAssessment.baseRules.criterionSetId,
      ),
    ]);
    const effective = effectiveReviews(ledger?.reviews ?? []);
    const pageItems = items.map((item) => {
      const latest = effective.get(item.criterionId) ?? null;
      const rule = rules.get(item.criterionId);
      if (!rule) {
        throw new Error(
          `ENGINEER_REVIEW_CRITERION_UNKNOWN:${item.criterionId}`,
        );
      }
      return {
        ...item,
        criterionName: rule.criterionName,
        evaluationQuestion: rule.evaluationQuestion,
        decisionRule: rule.decisionRule,
        appliesWhen: rule.appliesWhen,
        latestReview: latest
          ? {
              decision: latest.decision,
              status: latest.status,
              comment: latest.comment,
              recordedAt: latest.recordedAt,
            }
          : null,
      };
    });
    return {
      criterionSetId: workItem.integratedAssessment.baseRules.criterionSetId,
      baseRuleRevision: workItem.integratedAssessment.baseRules.revision,
      ledger: workItem.integratedAssessment.engineerReviews ?? null,
      gapLedger: buildCanonicalAssessmentGapLedger({
        workItemRevision: workItem.revision,
        baseRuleRevision: workItem.integratedAssessment.baseRules.revision,
        expectedUnresolvedCriterionCount:
          workItem.integratedAssessment.baseRules.unresolvedCount,
        items: pageItems,
        rules,
        effectiveReviews: [...effective.values()].map((review) => ({
          sequence: review.sequence,
          criterionId: review.criterionId,
          affectedCriterionIds: [
            ...(review.affectedCriterionIds ?? [review.criterionId]),
          ],
          resolvedMissingInputs: [...(review.resolvedMissingInputs ?? [])],
          uncertaintyDispositions: structuredClone(
            review.uncertaintyDispositions ?? [],
          ),
        })),
      }),
      items: pageItems,
    };
  }

  async modelContext(
    workItem: CanonicalWorkItemProjection,
  ): Promise<OpenClawEngineerReviewContext> {
    const ledger = await this.readLedger(workItem);
    const history = (ledger?.reviews ?? []).map(sanitizedReview);
    return {
      revision: ledger?.revision ?? null,
      artifactSha256:
        workItem.integratedAssessment?.engineerReviews?.artifact.sha256 ?? null,
      reviewCount: history.length,
      history,
      effective: [...effectiveReviews(ledger?.reviews ?? []).values()].map(
        sanitizedReview,
      ),
    };
  }

  async assertLedgerCompatibleWithDynamicBytes(
    workItem: CanonicalWorkItemProjection,
    baseRules: CanonicalIntegratedAssessmentProjection['baseRules'],
    bytes: Uint8Array,
  ): Promise<void> {
    const ledger = await this.readLedger(workItem);
    if (!ledger) return;
    assertLedgerItems(
      ledger,
      baseRules,
      readDynamicRuleReviewItems(baseRules, bytes),
    );
  }

  private async readDynamicItems(workItem: CanonicalWorkItemProjection) {
    return (await this.readDynamicItemsAndLedger(workItem)).items;
  }

  private async readDynamicItemsAndLedger(workItem: CanonicalWorkItemProjection) {
    const baseRules = workItem.integratedAssessment!.baseRules;
    const [bytes, ledger] = await Promise.all([
      this.artifactStore.readActualBytes(baseRules.artifact),
      this.readLedger(workItem),
    ]);
    const items = readDynamicRuleReviewItems(baseRules, bytes);
    if (ledger) assertLedgerItems(ledger, baseRules, items);
    return { items, ledger };
  }

  private async readLedger(
    workItem: CanonicalWorkItemProjection,
  ): Promise<EngineerReviewLedger | null> {
    const projection = workItem.integratedAssessment?.engineerReviews ?? null;
    if (!projection) return null;
    const bytes = await this.artifactStore.readActualBytes(projection.artifact);
    const ledger = parseLedger(bytes);
    assertLedger(ledger, projection, workItem);
    await Promise.all(
      ledger.reviews.flatMap((review) =>
        (review.evidence ?? [])
          .filter((evidence) => evidence.artifact !== undefined)
          .map(async (evidence) => {
            const evidenceBytes = await this.artifactStore.readActualBytes(
              evidence.artifact!,
            );
            if (evidence.kind !== 'ATTACHMENT') return;
            const parsed = parseReviewAttachmentParsedArtifact(evidenceBytes);
            if (
              parsed.workItemId !== workItem.workItemId ||
              parsed.attachmentRef !== evidence.locator ||
              reviewAttachmentEvidenceStatement(parsed) !== evidence.statement
            ) {
              throw new Error('ENGINEER_REVIEW_ATTACHMENT_BINDING_INVALID');
            }
          }),
      ),
    );
    return ledger;
  }

  private async assertResolvedEvidence(
    input: RecordEngineerReviewActionInput,
    workItem: CanonicalWorkItemProjection,
  ): Promise<void> {
    await Promise.all(
      (input.evidence ?? [])
        .filter((evidence) => evidence.kind === 'ATTACHMENT')
        .map(async (evidence) => {
          const parsed = parseReviewAttachmentParsedArtifact(
            await this.artifactStore.readActualBytes(evidence.artifact!),
          );
          if (
            parsed.workItemId !== workItem.workItemId ||
            parsed.attachmentRef !== evidence.locator ||
            reviewAttachmentEvidenceStatement(parsed) !== evidence.statement
          ) {
            throw new Error('ENGINEER_REVIEW_ATTACHMENT_BINDING_INVALID');
          }
        }),
    );
  }

  private authorizeAndLoad(workItemId: string, actor: CanonicalHostActor) {
    return authorizeAndLoadCanonicalWorkItem({
      authorization: this.authorization,
      permissionSnapshots: this.permissions,
      registrar: this.registrar,
      actor,
      action: 'RECORD_ENGINEER_REVIEW',
      workItemId,
    });
  }
}

function assertLedgerItems(
  ledger: EngineerReviewLedger,
  baseRules: CanonicalIntegratedAssessmentProjection['baseRules'],
  items: ReturnType<typeof readDynamicRuleReviewItems>,
): void {
  if (ledger.criterionSetId !== baseRules.criterionSetId) {
    throw new Error('ENGINEER_REVIEW_RULESET_CHANGED');
  }
  const known = new Set(items.map((item) => item.criterionId));
  if (
    ledger.reviews.some((review) =>
      !known.has(review.criterionId) ||
      (review.affectedCriterionIds ?? [review.criterionId]).some(
        (id) => !known.has(id),
      ),
    )
  ) {
    throw new Error('ENGINEER_REVIEW_CRITERION_SET_DRIFT');
  }
}

function requiredDynamicWorkItem(
  workItem: CanonicalWorkItemProjection,
): CanonicalWorkItemProjection {
  if (
    workItem.phase !== 'CANDIDATE_READBACK_VERIFIED' ||
    !workItem.package ||
    !workItem.integratedAssessment?.baseRules ||
    !workItem.integratedAssessment.baseRules.sourceResultId.startsWith(
      'openclaw-dynamic://',
    )
  ) {
    throw new Error('ENGINEER_REVIEW_DYNAMIC_N_CANDIDATE_REQUIRED');
  }
  return workItem;
}

function validateReviewActionInput(
  input: RecordEngineerReviewActionInput,
): void {
  if (
    !input.workItemId.trim() ||
    !input.criterionId.trim() ||
    !input.comment.trim()
  ) {
    throw new Error('ENGINEER_REVIEW_INPUT_INVALID');
  }
  if (
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 1
  ) {
    throw new Error('ENGINEER_REVIEW_EXPECTED_REVISION_INVALID');
  }
  const affectedCriterionIds = input.affectedCriterionIds ?? [
    input.criterionId,
  ];
  if (
    !validDistinctTexts(affectedCriterionIds) ||
    !affectedCriterionIds.includes(input.criterionId)
  ) {
    throw new Error('ENGINEER_REVIEW_AFFECTED_CRITERIA_INVALID');
  }
  validateUncertaintyDispositions(input.uncertaintyDispositions ?? []);
  if (
    input.decisionSnapshot &&
    (!input.decisionSnapshot.decisionSnapshotRef?.trim() ||
      !input.decisionSnapshot.workItemId?.trim() ||
      !Number.isSafeInteger(input.decisionSnapshot.revision) ||
      input.decisionSnapshot.revision < 1 ||
      input.decisionSnapshot.candidateOnly !== true ||
      JSON.stringify(input.decisionSnapshot.uncertaintyDispositions) !==
        JSON.stringify(input.uncertaintyDispositions ?? []))
  ) {
    throw new Error('ENGINEER_REVIEW_DECISION_SNAPSHOT_INVALID');
  }
  if (input.actionType === 'REVISE_JUDGMENT') {
    if (
      !input.decision ||
      input.evidence !== undefined ||
      input.resolvedMissingInputs !== undefined ||
      input.correctedAnalysisDirection !== undefined
    ) {
      throw new Error('ENGINEER_REVIEW_JUDGMENT_ACTION_INVALID');
    }
    statusFor(input.decision);
    return;
  }
  if (input.actionType === 'SUPPLEMENT_EVIDENCE') {
    if (
      input.decision !== undefined ||
      input.correctedAnalysisDirection !== undefined ||
      !Array.isArray(input.evidence) ||
      input.evidence.length === 0 ||
      input.evidence.some(
        (value) =>
          !value.statement?.trim() ||
          !value.locator?.trim() ||
          ![
            'ENGINEER_TEXT',
            'AIRCRAFT_FACT',
            'DOCUMENT_FACT',
            'ATTACHMENT',
          ].includes(value.kind) ||
          (value.kind === 'ATTACHMENT') !== (value.artifact !== undefined),
      ) ||
      !validDistinctTexts(input.resolvedMissingInputs ?? [])
    ) {
      throw new Error('ENGINEER_REVIEW_EVIDENCE_ACTION_INVALID');
    }
    return;
  }
  if (input.actionType === 'CORRECT_ANALYSIS_DIRECTION') {
    if (
      input.decision !== undefined ||
      input.evidence !== undefined ||
      input.resolvedMissingInputs !== undefined ||
      input.uncertaintyDispositions !== undefined ||
      input.decisionSnapshot !== undefined ||
      !input.correctedAnalysisDirection?.trim()
    ) {
      throw new Error('ENGINEER_REVIEW_DIRECTION_ACTION_INVALID');
    }
    return;
  }
  throw new Error('ENGINEER_REVIEW_ACTION_TYPE_INVALID');
}

function assertDecisionSnapshotProposalBinding(
  input: RecordEngineerReviewActionInput,
  workItem: CanonicalWorkItemProjection,
): void {
  const snapshot = input.decisionSnapshot;
  if (!snapshot) return;
  if (
    snapshot.workItemId !== workItem.workItemId ||
    snapshot.revision !== workItem.revision ||
    snapshot.engineerConfirmationRef !== null
  ) {
    throw new Error('ENGINEER_REVIEW_DECISION_SNAPSHOT_BINDING_INVALID');
  }
}

function validateUncertaintyDispositions(
  dispositions: ReviewUncertaintyDispositionCandidate[],
): void {
  const allowed = new Set([
    'RESOLVE_NOW',
    'ACCEPT_WITH_ASSUMPTION',
    'APPLY_CONSERVATIVE_BOUND',
    'MITIGATE_AND_MONITOR',
    'DEFER_TO_REVIEW_DATE',
    'PROFESSIONAL_JUDGMENT',
    'OUT_OF_CURRENT_SCOPE',
    'LIFECYCLE_NOT_REACHED',
    'RESOLVED_BY_EVIDENCE',
    'NOT_APPLICABLE',
  ]);
  if (
    !Array.isArray(dispositions) ||
    !validDistinctTexts(dispositions.map((value) => value.gapRef)) ||
    dispositions.some(
      (value) =>
        !allowed.has(value.disposition) ||
        !value.rationale?.trim() ||
        !validDistinctTexts(value.assumptions) ||
        !validDistinctTexts(value.controlsAndMitigations) ||
        !validDistinctTexts(value.evidenceRefs) ||
        !validDistinctTexts(value.reopenTriggers) ||
        (value.reviewBy !== null && !validIsoText(value.reviewBy)) ||
        (value.disposition === 'ACCEPT_WITH_ASSUMPTION' &&
          value.assumptions.length === 0) ||
        (['APPLY_CONSERVATIVE_BOUND', 'MITIGATE_AND_MONITOR'].includes(
          value.disposition,
        ) &&
          value.controlsAndMitigations.length === 0) ||
        (['MITIGATE_AND_MONITOR', 'DEFER_TO_REVIEW_DATE'].includes(
          value.disposition,
        ) &&
          value.reviewBy === null) ||
        (value.disposition === 'RESOLVED_BY_EVIDENCE' &&
          value.evidenceRefs.length === 0),
    )
  ) {
    throw new Error('ENGINEER_REVIEW_UNCERTAINTY_DISPOSITION_INVALID');
  }
}

function validIsoText(value: string): boolean {
  return value.trim() === value && Number.isFinite(Date.parse(value));
}

function statusFor(
  decision: CanonicalEngineerReviewDecision,
): EngineerReviewStatus {
  if (decision === 'confirmed_pass' || decision === 'confirmed_fail') {
    return 'ENGINEER_CONFIRMED';
  }
  if (decision === 'returned_for_rework' || decision === 'deferred') {
    return 'NEEDS_REVIEW';
  }
  throw new Error('ENGINEER_REVIEW_DECISION_INVALID');
}

function sanitizedReview(review: EngineerReviewEntry) {
  return {
    sequence: review.sequence,
    criterionId: review.criterionId,
    affectedCriterionIds: [
      ...(review.affectedCriterionIds ?? [review.criterionId]),
    ],
    baseRuleRevision: review.baseRuleRevision,
    baseRuleArtifactSha256: review.baseRuleArtifactSha256,
    actionType: review.actionType ?? 'REVISE_JUDGMENT',
    decision: review.decision,
    status: review.status,
    comment: review.comment,
    recordedAt: review.recordedAt,
    evidence: structuredClone(review.evidence ?? []),
    resolvedMissingInputs: [...(review.resolvedMissingInputs ?? [])],
    uncertaintyDispositions: structuredClone(
      review.uncertaintyDispositions ?? [],
    ),
    decisionSnapshot: review.decisionSnapshot
      ? structuredClone(review.decisionSnapshot)
      : null,
    correctedAnalysisDirection: review.correctedAnalysisDirection ?? null,
  };
}

function effectiveReviews(reviews: EngineerReviewEntry[]) {
  const result = new Map<string, EngineerReviewEntry>();
  for (const review of reviews) result.set(review.criterionId, review);
  return result;
}

function encodeLedger(ledger: EngineerReviewLedger): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(ledger)}\n`);
}

function parseLedger(bytes: Uint8Array): EngineerReviewLedger {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as EngineerReviewLedger;
  } catch {
    throw new Error('ENGINEER_REVIEW_LEDGER_JSON_INVALID');
  }
}

function assertLedger(
  ledger: EngineerReviewLedger,
  projection: CanonicalEngineerReviewLedgerProjection,
  workItem: CanonicalWorkItemProjection,
): void {
  if (
    ledger.kind !== LEDGER_KIND ||
    ledger.version !== LEDGER_VERSION ||
    ledger.workItemId !== workItem.workItemId ||
    ledger.documentVersionId !== workItem.source.documentVersionId ||
    ledger.packageId !== workItem.package?.packageId ||
    ledger.criterionSetId !==
      workItem.integratedAssessment?.baseRules.criterionSetId ||
    ledger.criterionSetId !== projection.criterionSetId ||
    ledger.revision !== projection.revision ||
    ledger.reviews.length !== projection.reviewCount
  ) {
    throw new Error('ENGINEER_REVIEW_LEDGER_IDENTITY_DRIFT');
  }
  ledger.reviews.forEach((review, index) => {
    if (
      review.sequence !== index + 1 ||
      review.criterionSetId !== ledger.criterionSetId ||
      !review.criterionId?.trim() ||
      !review.comment?.trim() ||
      !review.actorUserId?.trim() ||
      !review.recordedAt?.trim() ||
      !review.actionAttemptId?.trim() ||
      !validLedgerAction(review, ledger.workItemId)
    ) {
      throw new Error('ENGINEER_REVIEW_LEDGER_ENTRY_INVALID');
    }
  });
}

function validLedgerAction(
  review: EngineerReviewEntry,
  workItemId = 'ledger-readback',
): boolean {
  try {
    const actionType = review.actionType ?? 'REVISE_JUDGMENT';
    validateReviewActionInput({
      workItemId: 'ledger-readback',
      expectedRevision: Math.max(1, review.workItemRevisionBefore),
      criterionId: review.criterionId,
      affectedCriterionIds: review.affectedCriterionIds ?? [review.criterionId],
      actionType,
      comment: review.comment,
      ...(actionType === 'REVISE_JUDGMENT'
        ? { decision: review.decision }
        : {}),
      ...(review.evidence ? { evidence: review.evidence } : {}),
      ...(review.resolvedMissingInputs
        ? { resolvedMissingInputs: review.resolvedMissingInputs }
        : {}),
      ...(review.uncertaintyDispositions
        ? { uncertaintyDispositions: review.uncertaintyDispositions }
        : {}),
      ...(review.decisionSnapshot
        ? { decisionSnapshot: review.decisionSnapshot }
        : {}),
      ...(review.correctedAnalysisDirection
        ? { correctedAnalysisDirection: review.correctedAnalysisDirection }
        : {}),
    });
    if (
      (actionType === 'REVISE_JUDGMENT'
        ? statusFor(review.decision)
        : 'NEEDS_REVIEW') !== review.status
    ) {
      return false;
    }
    if (
      review.decisionSnapshot &&
      (review.decisionSnapshot.workItemId !== workItemId ||
        review.decisionSnapshot.revision !==
          review.workItemRevisionBefore + 1 ||
        review.decisionSnapshot.engineerConfirmationRef !==
          review.actionAttemptId)
    ) {
      return false;
    }
    return (
      (review.evidence ?? []).every((value) =>
        Boolean(value.sourceRefId?.trim()),
      ) &&
      new Set((review.evidence ?? []).map((value) => value.sourceRefId))
        .size === (review.evidence ?? []).length
    );
  } catch {
    return false;
  }
}

function validDistinctTexts(values: string[]): boolean {
  return (
    values.every((value) => typeof value === 'string' && value.trim() !== '') &&
    new Set(values).size === values.length
  );
}

function uniqueSortedTexts(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sameTextSet(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value) => right.includes(value)) &&
    right.every((value) => left.includes(value))
  );
}

function reviewEvidenceSourceRefId(
  workItemId: string,
  ledgerRevision: number,
  criterionId: string,
  index: number,
): string {
  return [
    'review-evidence:/',
    encodeURIComponent(workItemId),
    ledgerRevision,
    encodeURIComponent(criterionId),
    index + 1,
  ].join('/');
}

function assertSameBytes(expected: Uint8Array, actual: Uint8Array): void {
  if (
    expected.byteLength !== actual.byteLength ||
    expected.some((byte, index) => byte !== actual[index])
  ) {
    throw new Error('ENGINEER_REVIEW_LEDGER_READBACK_DRIFT');
  }
}

function withoutRevision(
  workItem: CanonicalWorkItemProjection,
): Omit<CanonicalWorkItemProjection, 'revision'> {
  const { revision: _revision, ...rest } = workItem;
  return rest;
}

function errorCode(error: unknown): string {
  return error instanceof Error
    ? error.message.split(':', 1)[0]
    : 'ENGINEER_REVIEW_FAILED';
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
