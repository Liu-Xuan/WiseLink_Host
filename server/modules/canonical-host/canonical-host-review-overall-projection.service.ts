import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, inArray } from 'drizzle-orm';
import type {
  CanonicalReviewOverallProjectionEligibility,
  CanonicalReviewOverallProjectionReceipt,
  CanonicalWorkItemProjection,
  RequestCanonicalReviewOverallProjectionRequest,
} from '@shared/api.interface';
import { isJobAidProblemProjection } from '@shared/jobaid-problem-assessment.interface';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';
import { actionAttempt } from '../../database/schema';
import { SessionResolver } from '../identity/session-resolver.service';
import { CANONICAL_OBJECT_ACCESS, type CanonicalObjectAccessPort } from '../work-item/canonical-object-access.port';
import { CANONICAL_WORK_ITEM_REGISTRAR } from './canonical-host.constants';
import type { CanonicalWorkItemRegistrarPort } from './canonical-host.types';
import { CanonicalJobAidProblemService } from './canonical-jobaid-problem.service';
import { JobAidWorkRepository } from './jobaid-work.repository';
import { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';
import { UNIFIED_ARTIFACT_STORE } from '../unified-reader/unified-reader.constants';
import type { UnifiedArtifactStorePort } from '../unified-reader/unified-reader.types';
import { canonicalHostBareSha256 } from './canonical-host-sha256';
import { jobAidReadingResult } from './jobaid-problem-work';
import { buildJobAidOverallProjection } from './jobaid-overall-projection';
import { activeConfigurationEvidenceReevaluation } from './configuration-evidence/configuration-evidence-reevaluation.state';
import { CanonicalHostReviewOverallProjectionRepository,
  type ReviewOverallStructuralChecks } from './canonical-host-review-overall-projection.repository';

const ACTIVE_STATUSES = ['QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'];
const BLOCKING_TYPES = [
  'OPENCLAW_OVERALL_SYNTHESIS',
  'OPENCLAW_INTERACTIVE_REVIEW',
  'OPENCLAW_DYNAMIC_EVALUATION',
];

function conflict(code: string): Error {
  return Object.assign(new Error(code), { code, statusCode: 409 });
}

@Injectable()
export class CanonicalHostReviewOverallProjectionService {
  constructor(
    private readonly sessions: SessionResolver,
    @Inject(CANONICAL_OBJECT_ACCESS) private readonly access: CanonicalObjectAccessPort,
    @Inject(CANONICAL_WORK_ITEM_REGISTRAR) private readonly registrar: CanonicalWorkItemRegistrarPort,
    private readonly workItems: MiaodaWorkItemRepository,
    private readonly work: JobAidWorkRepository,
    private readonly jobAid: CanonicalJobAidProblemService,
    private readonly executions: CanonicalHostReviewOverallProjectionRepository,
    @Inject(UNIFIED_ARTIFACT_STORE) private readonly artifacts: UnifiedArtifactStorePort,
  ) {}

  private async authorized(
    workItemId: string,
    request: Request,
    database?: PostgresJsDatabase,
  ) {
    const session = await this.sessions.resolve(request, database);
    if (!session)
      throw Object.assign(new Error('REVIEW_OVERALL_LOGIN_REQUIRED'),
        { code: 'REVIEW_OVERALL_LOGIN_REQUIRED', statusCode: 401 });
    const grant = await this.access.freshRead({
      actor: session.actor,
      action: 'REQUEST_OVERALL_REGENERATION',
      accessRoot: { kind: 'WORK_ITEM', id: workItemId },
    }, database);
    if (grant.allowed === false)
      throw Object.assign(new Error(grant.code),
        { code: grant.code, statusCode: grant.statusCode });
    const item = await this.registrar.getTenantScopedByWorkItemId({
      workItemId, tenantId: grant.tenantId,
    }, database);
    if (grant.action !== 'REQUEST_OVERALL_REGENERATION' ||
      grant.workItemId !== workItemId ||
      grant.tenantId !== session.actor.tenantId ||
      grant.actorUserId !== session.actor.canonicalSubject.id ||
      grant.workItemRevision !== item.revision ||
      grant.requestId !== item.requestId ||
      grant.documentVersionId !== item.source.documentVersionId)
      throw conflict('REVIEW_OVERALL_ACCESS_CHANGED');
    return { item, tenantId: grant.tenantId, actorUserId: grant.actorUserId };
  }

  async eligibility(workItemId: string, request: Request): Promise<CanonicalReviewOverallProjectionEligibility> {
    const authorized = await this.authorized(workItemId, request);
    const item = authorized.item;
    if (!isJobAidProblemProjection(item.integratedAssessment?.baseRules) ||
      activeConfigurationEvidenceReevaluation(item))
      return { eligible: false, binding: null };
    const latest = await this.work.latest({
      tenantId: authorized.tenantId, workItemId,
    });
    if (!latest?.requestId.startsWith('review-turn:') ||
      latest.basedOnWorkItemRevision !== item.revision)
      return { eligible: false, binding: null };
    const turnId = latest.requestId.slice('review-turn:'.length);
    // The exact conversation ID comes from the RLS-protected saved Review row.
    const binding = await this.work.reviewTurnBindingForProjection({
      tenantId: authorized.tenantId,
      actorUserId: authorized.actorUserId,
      workItemId,
      reviewTurnId: turnId,
      actionAttemptId: latest.actionAttemptId,
    });
    if (!binding) return { eligible: false, binding: null };
    try {
      await this.jobAid.exactSavedReviewWorkForProjection({
        ...authorized,
        workItem: item,
        expectedRevision: item.revision,
        reviewConversationId: binding.reviewConversationId,
        reviewTurnId: turnId,
        workRevisionRef: latest.workRevisionRef,
        expectedWorkRevision: latest.workRevision,
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('JOBAID_'))
        return { eligible: false, binding: null };
      throw error;
    }
    if (await this.blocked(authorized.tenantId, workItemId))
      return { eligible: false, binding: null };
    const overall = item.integratedAssessment?.overallSynthesis;
    if (overall?.status === 'CANDIDATE_ONLY' &&
      overall.basedOnJobAidWorkRevisionRef === latest.workRevisionRef)
      return { eligible: false, binding: null };
    return {
      eligible: true,
      binding: {
        expectedRevision: item.revision,
        reviewConversationId: binding.reviewConversationId,
        reviewTurnId: turnId,
        workRevisionRef: latest.workRevisionRef,
        expectedWorkRevision: latest.workRevision,
        sourceIdentity: sourceIdentity(item),
      },
    };
  }

  async status(workItemId: string, requestId: string, request: Request):
    Promise<CanonicalReviewOverallProjectionReceipt> {
    const authorized = await this.authorized(workItemId, request);
    const stored = await this.executions.read({
      tenantId: authorized.tenantId,
      actorUserId: authorized.actorUserId,
      workItemId, requestId,
    });
    if (!stored) throw conflict('REVIEW_OVERALL_REQUEST_NOT_FOUND');
    return { ...stored.receipt, replayed: true };
  }

  async project(workItemId: string, input: RequestCanonicalReviewOverallProjectionRequest,
    request: Request): Promise<CanonicalReviewOverallProjectionReceipt> {
    const authorized = await this.authorized(workItemId, request);
    const identity = {
      tenantId: authorized.tenantId,
      actorUserId: authorized.actorUserId,
      workItemId,
      requestId: input.requestId,
    };
    const prior = await this.executions.read(identity);
    if (prior) {
      if (canonicalJson(prior.input) !== canonicalJson(input))
        throw conflict('REVIEW_OVERALL_IDEMPOTENCY_CONFLICT');
      return { ...prior.receipt, replayed: true };
    }
    const item = authorized.item;
    if (item.revision !== input.expectedRevision)
      throw conflict('REVIEW_OVERALL_WORK_ITEM_CAS_CONFLICT');
    assertSourceIdentity(item, input);
    assertCandidate(item);
    if (await this.blocked(authorized.tenantId, workItemId))
      throw conflict('REVIEW_OVERALL_ACTIVE_EXECUTION');
    let saved;
    try {
      saved = await this.jobAid.exactSavedReviewWorkForProjection({
        workItem: item,
        tenantId: authorized.tenantId,
        actorUserId: authorized.actorUserId,
        ...input,
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('JOBAID_'))
        throw conflict(error.message);
      throw error;
    }
    assertNotAlreadyProjected(item, saved.workRevisionRef);
    const sourceReview = {
      reviewConversationId: input.reviewConversationId,
      reviewTurnId: input.reviewTurnId,
      actionAttemptId: saved.actionAttemptId,
      workRevisionRef: saved.workRevisionRef,
      workRevision: saved.workRevision,
    };
    const reading = jobAidReadingResult(saved);
    const artifact = await this.artifacts.persistAndReadback(new TextEncoder().encode(
      canonicalJson({
        schemaVersion: 'wiselink.jobaid-review-overall-projection.v1',
        analysisRef: { workRevisionRef: saved.workRevisionRef,
          workRevision: saved.workRevision },
        readingResult: reading,
        sourceReview,
        executionKind: 'DETERMINISTIC_PROJECTION',
        modelRequests: 0,
        semanticReanalysisPerformed: false,
        authorityLevel: 'candidate_only',
        adopted: false,
      }),
    ));
    const admittedBase = item.integratedAssessment!.baseRules;
    if (!isJobAidProblemProjection(admittedBase))
      throw conflict('REVIEW_OVERALL_BASE_UNAVAILABLE');
    const baseArtifact = saved.workRevisionRef !== admittedBase.workRevisionRef
      ? await this.artifacts.persistAndReadback(new TextEncoder().encode(canonicalJson(saved)))
      : null;
    try {
      const result = await this.workItems.withLockedReviewOverallProjection({
        tenantId: authorized.tenantId,
        actorUserId: authorized.actorUserId,
        workItemId,
        expectedRevision: input.expectedRevision,
        workRevisionRef: saved.workRevisionRef,
        documentVersionId: item.source.documentVersionId,
      }, async (database, current) => {
        const fresh = await this.authorized(workItemId, request, database);
        if (fresh.item.revision !== current.revision ||
          fresh.tenantId !== authorized.tenantId ||
          fresh.actorUserId !== authorized.actorUserId)
          throw conflict('REVIEW_OVERALL_ACCESS_CHANGED');
        assertSourceIdentity(current, input);
        assertCandidate(current);
        const exact = await this.jobAid.exactSavedReviewWorkForProjection({
          workItem: current, tenantId: authorized.tenantId,
          actorUserId: authorized.actorUserId, ...input, database,
        });
        if (canonicalJson(exact) !== canonicalJson(saved))
          throw conflict('REVIEW_OVERALL_WORK_CHANGED');
        assertNotAlreadyProjected(current, exact.workRevisionRef);
        await this.jobAid.assertProjectionOriginalCurrent({
          tenantId: authorized.tenantId, actorUserId: authorized.actorUserId,
          workItem: current, saved: exact, database,
        });
        const checkedReading = jobAidReadingResult(exact);
        const checks: ReviewOverallStructuralChecks = {
          sourceReceiptMatched: exact.actionAttemptId === saved.actionAttemptId &&
            exact.requestId === `review-turn:${input.reviewTurnId}`,
          latestWorkMatched: exact.workRevisionRef === saved.workRevisionRef &&
            exact.workRevision === saved.workRevision,
          workItemRevisionMatched: current.revision === input.expectedRevision,
          sourceBindingsReauthorized: exact.content.evidence !== undefined,
          documentVersionAndParseMatched:
            exact.documentVersionId === current.source.documentVersionId,
          fullV3ReadingConstructed: checkedReading.resultRef === exact.workRevisionRef &&
            checkedReading.content.schemaVersion === 'wiselink.3_1.assessment_reading.v1',
          overviewCurrent: exact.content.overviewStatus === 'CURRENT',
          completionNotInProgress: exact.content.roundCompletion !== 'IN_PROGRESS',
        };
        if (Object.values(checks).some((value) => value !== true))
          throw conflict('REVIEW_OVERALL_STRUCTURAL_CHECK_FAILED');
        const active = await database.select({ id: actionAttempt.attemptId })
          .from(actionAttempt).where(and(
            eq(actionAttempt.tenantId, authorized.tenantId),
            eq(actionAttempt.workItemId, workItemId),
            inArray(actionAttempt.actionType, BLOCKING_TYPES),
            inArray(actionAttempt.status, ACTIVE_STATUSES),
          )).limit(1);
        if (active.length) throw conflict('REVIEW_OVERALL_ACTIVE_EXECUTION');
        const base = current.integratedAssessment!.baseRules;
        if (!isJobAidProblemProjection(base))
          throw conflict('REVIEW_OVERALL_BASE_CHANGED');
        const nextBase = base.workRevisionRef === exact.workRevisionRef ? base : {
          ...base, revision: base.revision + 1,
          workRevisionRef: exact.workRevisionRef,
          workRevision: exact.workRevision,
          issueCount: exact.content.issues.length,
          openQuestionCount: exact.content.issues.reduce(
            (sum, issue) => sum + issue.openQuestions.length, 0),
          headline: exact.content.headline,
          listBrief: exact.content.listBrief,
          readingResult: reading,
          artifact: baseArtifact!.artifact,
        };
        const basis = {
          ...current,
          integratedAssessment: {
            ...current.integratedAssessment!,
            baseRules: nextBase,
          },
        };
        const attemptId = this.executions.attemptId(identity);
        const synthesis = buildJobAidOverallProjection({
          workItem: basis,
          revision: exact,
          artifact: artifact.artifact,
          actionAttemptId: attemptId,
          sourceResultId: 'review-overall://' + input.requestId,
          applicabilityStatus: current.applicability?.decision ?? 'UNKNOWN',
          deterministicSource: {
            reviewConversationId: input.reviewConversationId,
            reviewTurnId: input.reviewTurnId,
          },
        });
        const receipt: CanonicalReviewOverallProjectionReceipt = {
          executionKind: 'DETERMINISTIC_PROJECTION',
          modelRequests: 0,
          requestId: input.requestId,
          executionAttemptId: attemptId,
          status: 'SUCCEEDED',
          replayed: false,
          workItemRevision: current.revision + 1,
          overallRevision: synthesis.revision,
          basedOnJobAidWorkRevisionRef: exact.workRevisionRef,
          artifact: artifact.artifact,
        };
        await this.executions.insert({
          database, tenantId: authorized.tenantId,
          actorUserId: authorized.actorUserId, workItemId,
          documentVersionId: current.source.documentVersionId,
          request: input, receipt, checks,
        });
        return {
          next: {
            ...withoutRevision(current),
            integratedAssessment: {
              status: 'OVERALL_CANDIDATE_READY' as const,
              baseRules: nextBase,
              engineerReviews: current.integratedAssessment?.engineerReviews ?? null,
              overallSynthesis: synthesis,
              overallForAeoConfirmation: null,
            },
            aeo: null,
          },
          value: receipt,
        };
      });
      return { ...result.value, workItemRevision: result.saved.revision };
    } catch (error) {
      // A committed concurrent request wins by the stable execution identity.
      const winner = await this.executions.read(identity);
      if (winner) {
        if (canonicalJson(winner.input) !== canonicalJson(input))
          throw conflict('REVIEW_OVERALL_IDEMPOTENCY_CONFLICT');
        return { ...winner.receipt, replayed: true };
      }
      if (error instanceof Error && (error.message.startsWith('JOBAID_') ||
        error.message === 'WORK_ITEM_CAS_CONFLICT'))
        throw conflict(error.message);
      throw error;
    }
  }

  private async blocked(tenantId: string, workItemId: string): Promise<boolean> {
    return this.work.hasActiveReviewOverallConflict(tenantId, workItemId,
      BLOCKING_TYPES, ACTIVE_STATUSES);
  }
}

function sourceIdentity(item: CanonicalWorkItemProjection) {
  const packageArtifact = item.package?.artifact;
  if (!item.package || !packageArtifact ||
    !canonicalHostBareSha256(item.source.sourceFileSha256) ||
    !canonicalHostBareSha256(packageArtifact.sha256))
    throw conflict('REVIEW_OVERALL_SOURCE_UNAVAILABLE');
  return {
    documentVersionId: item.source.documentVersionId,
    sourceArtifactId: item.source.sourceArtifactId,
    sourceFileSha256: canonicalHostBareSha256(item.source.sourceFileSha256)!,
    packageId: item.package.packageId,
    packageArtifactSha256: canonicalHostBareSha256(packageArtifact.sha256)!,
  };
}

function assertSourceIdentity(item: CanonicalWorkItemProjection,
  input: RequestCanonicalReviewOverallProjectionRequest): void {
  if (canonicalJson(sourceIdentity(item)) !== canonicalJson(input.sourceIdentity))
    throw conflict('REVIEW_OVERALL_SOURCE_CHANGED');
}

function assertCandidate(item: CanonicalWorkItemProjection): void {
  if (!isJobAidProblemProjection(item.integratedAssessment?.baseRules) ||
    activeConfigurationEvidenceReevaluation(item))
    throw conflict('REVIEW_OVERALL_BASE_UNAVAILABLE');
}

function assertNotAlreadyProjected(item: CanonicalWorkItemProjection,
  workRevisionRef: string): void {
  const overall = item.integratedAssessment?.overallSynthesis;
  if (overall?.status === 'CANDIDATE_ONLY' &&
    overall.basedOnJobAidWorkRevisionRef === workRevisionRef)
    throw conflict('REVIEW_OVERALL_ALREADY_CURRENT');
}

function withoutRevision(item: CanonicalWorkItemProjection):
  Omit<CanonicalWorkItemProjection, 'revision'> {
  const { revision: _revision, ...rest } = item;
  return rest;
}
