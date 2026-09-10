import {
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import {
  SessionResolver,
  type ResolvedSession,
} from '../identity/session-resolver.service';
import { ReviewAilyService } from './review-aily.service';
import { z } from 'zod/v4';
import type {
  CanonicalInitialAnalysisContinuationReceipt,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import { isJobAidProblemProjection } from '@shared/jobaid-problem-assessment.interface';
import { ActionAttemptLifecycleService } from '../action-attempt/action-attempt-lifecycle.service';
import { parseTaskEnvelope } from '../action-attempt/action-attempt-envelope';
import {
  CANONICAL_AUTHORIZATION,
  CANONICAL_PERMISSION_SNAPSHOT,
  CANONICAL_WORK_ITEM_REGISTRAR,
} from './canonical-host.constants';
import type {
  CanonicalAuthorizationPort,
  CanonicalHostActor,
  CanonicalPermissionSnapshotPort,
  CanonicalWorkItemRegistrarPort,
} from './canonical-host.types';
import { authorizeAndLoadCanonicalWorkItem } from './canonical-authorized-work-item-reader';
import {
  CanonicalHostInitialAnalysisStatusService,
  canContinueInitialStage,
} from './canonical-host-initial-analysis-status.service';
import { CanonicalHostOpenClawTranslationService } from './canonical-host-openclaw-translation.service';
import { CanonicalJobAidProblemService } from './canonical-jobaid-problem.service';
import { isOpenClawAutomaticReviewConfigured } from './configured-development-service-scope.authorization';
import { activeConfigurationEvidenceReevaluation } from './configuration-evidence/configuration-evidence-reevaluation.state';

const command = z.strictObject({
  requestId: z.string().uuid(),
  expectedRevision: z.number().int().positive(),
  operation: z.enum(['TRANSLATE', 'EVALUATE_JOBAID', 'SYNTHESIZE_OVERALL']),
  retranslateBlockIds: z
    .array(z.string().min(1).max(200))
    .min(1)
    .max(64)
    .optional(),
});
const bindings = {
  TRANSLATE: {
    key: 'translate',
    task: 'OPENCLAW_TRANSLATE',
    stage: 'translation',
  },
  EVALUATE_JOBAID: {
    key: 'dynamic',
    task: 'OPENCLAW_DYNAMIC_EVALUATION',
    stage: 'jobAid',
  },
  SYNTHESIZE_OVERALL: {
    key: 'overall',
    task: 'OPENCLAW_OVERALL_SYNTHESIS',
    stage: 'overall',
  },
} as const;

@Injectable()
export class CanonicalInitialAnalysisContinuationService {
  constructor(
    @Inject(CANONICAL_AUTHORIZATION)
    private readonly authorization: CanonicalAuthorizationPort,
    @Inject(CANONICAL_PERMISSION_SNAPSHOT)
    private readonly permissions: CanonicalPermissionSnapshotPort,
    @Inject(CANONICAL_WORK_ITEM_REGISTRAR)
    private readonly registrar: CanonicalWorkItemRegistrarPort,
    private readonly attempts: ActionAttemptLifecycleService,
    private readonly initial: CanonicalHostInitialAnalysisStatusService,
    private readonly translation: CanonicalHostOpenClawTranslationService,
    private readonly jobAid: CanonicalJobAidProblemService,
    @Optional() private readonly sessions?: SessionResolver,
    @Optional() private readonly aily?: ReviewAilyService,
  ) {}

  async request(
    workItemId: string,
    raw: unknown,
    actor: CanonicalHostActor,
    session?: ResolvedSession | null,
  ): Promise<CanonicalInitialAnalysisContinuationReceipt> {
    const input = command.parse(raw);
    if (input.operation !== 'TRANSLATE' && input.retranslateBlockIds)
      throw continuationConflict('BLOCK_SCOPE_REQUIRES_TRANSLATION');
    const { workItem, permissionSnapshotVersion } =
      await authorizeAndLoadCanonicalWorkItem({
        authorization: this.authorization,
        permissionSnapshots: this.permissions,
        registrar: this.registrar,
        actor,
        action:
          input.operation === 'SYNTHESIZE_OVERALL'
            ? 'RESYNTHESIZE_ASSESSMENT'
            : 'EVALUATE_JOB_AID',
        workItemId,
      });
    if (
      !isOpenClawAutomaticReviewConfigured({
        tenantId: actor.tenantId,
        workItemId,
      })
    )
      throw continuationConflict('AUTOMATIC_SCOPE_UNAVAILABLE');
    const binding = bindings[input.operation];
    const existing = await this.attempts.readRequest({
      tenantId: actor.tenantId,
      workItemId,
      taskType: binding.task,
      documentVersionId: workItem.source.documentVersionId,
      idempotencyKey: [
        'openclaw-v2',
        binding.key,
        workItemId,
        workItem.source.documentVersionId,
        input.requestId,
      ].join(':'),
    });
    if (existing) {
      const task = parseTaskEnvelope(existing.taskEnvelopeJson);
      if (
        input.retranslateBlockIds &&
        JSON.stringify(task.modelInput.retranslateBlockIds ?? []) !==
          JSON.stringify(input.retranslateBlockIds)
      )
        throw continuationConflict('REQUEST_SCOPE_CHANGED');
      return {
        requestId: input.requestId,
        operation: input.operation,
        status: existing.status,
        replayed: true,
        candidateOnly: true,
      };
    }
    if (workItem.revision !== input.expectedRevision)
      throw continuationConflict('WORK_ITEM_CHANGED');
    const status = await this.initial.project({
      workItem,
      tenantId: actor.tenantId,
    });
    if (
      status.status === 'NOT_READY' ||
      Object.values(status.stages).some(
        (stage) =>
          stage.attemptStatus &&
          ['QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'].includes(
            stage.attemptStatus,
          ),
      )
    )
      throw continuationConflict('EXISTING_WORK_NOT_TERMINAL');
    assertContinuationPrerequisites(
      input,
      workItem,
      status.stages[binding.stage].status,
    );
    if (
      !canContinueInitialStage(
        status.stages,
        input.operation,
        process.env.WL_JOBAID_PROBLEM_V2_ENABLED === '1',
        workItem,
      )
    )
      throw continuationConflict('PREREQUISITE_NOT_READY');
    let requestedBlocks = input.retranslateBlockIds;
    if (
      input.operation === 'TRANSLATE' &&
      !requestedBlocks &&
      status.stages.translation.attemptRef &&
      ['FAILED', 'CONFLICT'].includes(status.stages.translation.status)
    ) {
      const previous = await this.attempts.readScoped({
        tenantId: actor.tenantId,
        workItemId,
        attemptRef: status.stages.translation.attemptRef,
      });
      const task = parseTaskEnvelope(previous.taskEnvelopeJson);
      requestedBlocks = z
        .array(z.string().min(1).max(200))
        .min(1)
        .max(64)
        .optional()
        .parse(task.modelInput.retranslateBlockIds);
    }
    const authorizedKnowledgeSession =
      input.operation === 'TRANSLATE'
        ? undefined
        : await this.currentKnowledgeSession(actor, session);
    const reserved =
      input.operation === 'TRANSLATE'
        ? await this.translation.enqueueContinuation(
            workItem,
            actor.tenantId,
            input.requestId,
            requestedBlocks,
          )
        : await this.jobAid.enqueueContinuation(
            workItem,
            actor.tenantId,
            permissionSnapshotVersion,
            input.requestId,
            input.operation === 'EVALUATE_JOBAID'
              ? 'INITIAL_PROBLEM_ASSESSMENT'
              : 'OVERALL_CONSISTENCY',
            authorizedKnowledgeSession,
          );
    return {
      requestId: input.requestId,
      operation: input.operation,
      status: 'status' in reserved ? String(reserved.status) : 'QUEUED',
      replayed: !reserved.created,
      candidateOnly: true,
    };
  }

  private async currentKnowledgeSession(
    actor: CanonicalHostActor,
    session?: ResolvedSession | null,
  ) {
    if (!session) return undefined;
    if (
      session.actor.canonicalSubject.id !== actor.userId ||
      session.actor.tenantId !== actor.tenantId ||
      session.actor.applicationScopeId !== actor.appId
    )
      throw new ForbiddenException('INITIAL_CONTINUATION_IDENTITY_MISMATCH');
    if (!this.sessions || !this.aily)
      throw new Error('INITIAL_CONTINUATION_AUTHORIZATION_RUNTIME_UNAVAILABLE');
    const binding = {
      sessionId: session.session.id,
      actorId: actor.userId,
      tenantId: actor.tenantId,
    };
    const access = await this.sessions.withVerifiedServiceSql(
      () => this.aily!.availability(binding),
      actor.userId,
    );
    // Optional retrieval must not block source analysis when native consent
    // is unavailable. The prepared task reports its actual knowledge access.
    return access.available ? binding : undefined;
  }
}

function assertContinuationPrerequisites(
  input: z.infer<typeof command>,
  workItem: CanonicalWorkItemProjection,
  stageStatus: string,
) {
  if (input.operation === 'TRANSLATE') {
    if (process.env.WL_TRANSLATION_V2_ENABLED !== '1')
      throw continuationConflict('NEW_TRANSLATION_DISABLED');
    if (
      input.retranslateBlockIds &&
      new Set(input.retranslateBlockIds).size !==
        input.retranslateBlockIds.length
    )
      throw continuationConflict('BLOCK_SCOPE_INVALID');
    if (
      !input.retranslateBlockIds &&
      stageStatus === 'SUCCEEDED' &&
      workItem.translation?.schemaVersion ===
        'wiselink.3_1.translation_candidate_projection.v2' &&
      workItem.translation.completeness === 'COMPLETE'
    )
      throw continuationConflict('TRANSLATION_ALREADY_COMPLETE');
    return;
  }
  if (process.env.WL_JOBAID_PROBLEM_V2_ENABLED !== '1')
    throw continuationConflict('NEW_ASSESSMENT_DISABLED');
  if (
    workItem.classification.status !== 'CONFIRMED' ||
    workItem.classification.normalizedFamily !== 'SB'
  )
    throw continuationConflict('CONFIRMED_SB_REQUIRED');
  if (stageStatus === 'SUCCEEDED')
    throw continuationConflict('STAGE_ALREADY_COMPLETE');
  const staged =
    activeConfigurationEvidenceReevaluation(workItem)?.stagedBundle.baseRules;
  if (
    input.operation === 'SYNTHESIZE_OVERALL' &&
    !isJobAidProblemProjection(
      staged ?? workItem.integratedAssessment?.baseRules,
    )
  )
    throw continuationConflict('JOBAID_WORK_REQUIRED');
}

function continuationConflict(code: string) {
  return Object.assign(new Error(`INITIAL_CONTINUATION_${code}`), {
    statusCode: 409,
  });
}
