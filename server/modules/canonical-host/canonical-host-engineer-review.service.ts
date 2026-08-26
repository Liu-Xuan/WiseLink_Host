import { Inject, Injectable } from '@nestjs/common';

import type {
  CanonicalEngineerReviewDecision,
  CanonicalEngineerReviewLedgerProjection,
  CanonicalEngineerReviewPageContext,
  CanonicalIntegratedAssessmentProjection,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
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
import { authorizeAndLoadCanonicalWorkItem } from './canonical-authorized-work-item-reader';
import type {
  CanonicalReviewActionType,
  CanonicalReviewEvidence,
  CanonicalReviewEvidenceInput,
} from './selective-overall-resynthesis';

const LEDGER_KIND = 'CANONICAL_ENGINEER_REVIEW_LEDGER';
const LEDGER_VERSION = 1;

type EngineerReviewStatus = 'ENGINEER_CONFIRMED' | 'NEEDS_REVIEW';

interface EngineerReviewEntry {
  sequence: number;
  criterionId: string;
  criterionSetId: string;
  decision: CanonicalEngineerReviewDecision;
  status: EngineerReviewStatus;
  comment: string;
  actionType?: CanonicalReviewActionType;
  evidence?: CanonicalReviewEvidence[];
  resolvedMissingInputs?: string[];
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
  actionType: CanonicalReviewActionType;
  comment: string;
  decision?: CanonicalEngineerReviewDecision;
  evidence?: CanonicalReviewEvidenceInput[];
  resolvedMissingInputs?: string[];
  correctedAnalysisDirection?: string;
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
    const integrated = workItem.integratedAssessment!;
    const dynamicItems = await this.readDynamicItems(workItem);
    if (!dynamicItems.some((item) => item.criterionId === input.criterionId)) {
      throw new Error(`ENGINEER_REVIEW_CRITERION_UNKNOWN:${input.criterionId}`);
    }
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

  async pageContext(
    workItem: CanonicalWorkItemProjection,
  ): Promise<CanonicalEngineerReviewPageContext | null> {
    if (!workItem.integratedAssessment?.baseRules) return null;
    const items = await this.readDynamicItems(workItem);
    const ledger = await this.readLedger(workItem);
    const effective = effectiveReviews(ledger?.reviews ?? []);
    return {
      criterionSetId: workItem.integratedAssessment.baseRules.criterionSetId,
      baseRuleRevision: workItem.integratedAssessment.baseRules.revision,
      ledger: workItem.integratedAssessment.engineerReviews ?? null,
      items: items.map((item) => {
        const latest = effective.get(item.criterionId) ?? null;
        return {
          ...item,
          latestReview: latest
            ? {
                decision: latest.decision,
                status: latest.status,
                comment: latest.comment,
                recordedAt: latest.recordedAt,
              }
            : null,
        };
      }),
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
    if (ledger.criterionSetId !== baseRules.criterionSetId) {
      throw new Error('ENGINEER_REVIEW_RULESET_CHANGED');
    }
    const known = new Set(
      readDynamicRuleReviewItems(baseRules, bytes).map(
        (item) => item.criterionId,
      ),
    );
    if (ledger.reviews.some((review) => !known.has(review.criterionId))) {
      throw new Error('ENGINEER_REVIEW_CRITERION_SET_DRIFT');
    }
  }

  private async readDynamicItems(workItem: CanonicalWorkItemProjection) {
    const baseRules = workItem.integratedAssessment!.baseRules;
    const bytes = await this.artifactStore.readActualBytes(baseRules.artifact);
    const items = readDynamicRuleReviewItems(baseRules, bytes);
    await this.assertLedgerCompatibleWithDynamicBytes(
      workItem,
      baseRules,
      bytes,
    );
    return items;
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
          .map((evidence) =>
            this.artifactStore.readActualBytes(evidence.artifact!),
          ),
      ),
    );
    return ledger;
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
    if (input.evidence?.some((value) => value.kind === 'ATTACHMENT')) {
      throw new Error('ENGINEER_REVIEW_ATTACHMENT_RESOLVER_REQUIRED');
    }
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
          value.artifact !== undefined,
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
      !input.correctedAnalysisDirection?.trim()
    ) {
      throw new Error('ENGINEER_REVIEW_DIRECTION_ACTION_INVALID');
    }
    return;
  }
  throw new Error('ENGINEER_REVIEW_ACTION_TYPE_INVALID');
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
    baseRuleRevision: review.baseRuleRevision,
    baseRuleArtifactSha256: review.baseRuleArtifactSha256,
    actionType: review.actionType ?? 'REVISE_JUDGMENT',
    decision: review.decision,
    status: review.status,
    comment: review.comment,
    recordedAt: review.recordedAt,
    evidence: structuredClone(review.evidence ?? []),
    resolvedMissingInputs: [...(review.resolvedMissingInputs ?? [])],
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
      !validLedgerAction(review)
    ) {
      throw new Error('ENGINEER_REVIEW_LEDGER_ENTRY_INVALID');
    }
  });
}

function validLedgerAction(review: EngineerReviewEntry): boolean {
  try {
    const actionType = review.actionType ?? 'REVISE_JUDGMENT';
    validateReviewActionInput({
      workItemId: 'ledger-readback',
      expectedRevision: Math.max(1, review.workItemRevisionBefore),
      criterionId: review.criterionId,
      actionType,
      comment: review.comment,
      ...(actionType === 'REVISE_JUDGMENT'
        ? { decision: review.decision }
        : {}),
      ...(review.evidence ? { evidence: review.evidence } : {}),
      ...(review.resolvedMissingInputs
        ? { resolvedMissingInputs: review.resolvedMissingInputs }
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
