import { isProgramAssessmentMode, type ProgramAssessmentAdmission } from './program-agent-policy';
import { AilyTaskAdmissionService, type AilyAssessmentAdmission } from './aily-task-admission';
import { AilyTaskExecutionService } from './aily-task-execution.service';
import { AutomaticWorkItemDispatchService } from './automatic-work-item-dispatch.service';
import type { ActionAttemptRow } from '../action-attempt/action-attempt.types';
import type { Request } from 'express';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import {
  AUTOMATIC_WORK_ITEM_SOURCE_AUTHORIZATION,
  type AutomaticWorkItemSourceAuthorizationPort,
} from './automatic-work-item-source-authorization.port';
import {
  type CancelledInitialContinuationGuard,
  type CancelledInitialContinuationBinding,
  cancelledContinuationConflict,
  matchesInitialContinuationOwner,
} from '../action-attempt/cancelled-initial-continuation';
import {
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
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
  executionMode: z.enum(['PROGRAM_CONTROLLED_V1', 'PROGRAM_AGENT_V1', 'AILY_AGENT_V1']).optional(),
  modelRef: z.string().min(1).max(160).optional(),
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
    @Optional()
    @Inject(AUTOMATIC_WORK_ITEM_SOURCE_AUTHORIZATION)
    private readonly sourceAuthorization?: AutomaticWorkItemSourceAuthorizationPort,
    @Optional() private readonly ailyAdmission?: AilyTaskAdmissionService,
    @Optional() private readonly ailyExecution?: AilyTaskExecutionService,
    @Optional() private readonly automaticDispatch?: AutomaticWorkItemDispatchService,
  ) {}

  async request(
    workItemId: string,
    raw: unknown,
    actor: CanonicalHostActor,
    session?: ResolvedSession | null,
    httpRequest?: Request,
  ): Promise<CanonicalInitialAnalysisContinuationReceipt> {
    const input = command.parse(raw);
    if ((input.executionMode !== undefined || input.modelRef !== undefined) &&
        (input.operation !== 'EVALUATE_JOBAID' ||
          (!isProgramAssessmentMode(input.executionMode) && input.executionMode !== 'AILY_AGENT_V1') || !input.modelRef))
      throw continuationConflict('PROGRAM_SCOPE_INVALID');
    if (input.executionMode === 'PROGRAM_AGENT_V1' && input.modelRef !== 'miaoda/glm-5.3')
      throw continuationConflict('PROGRAM_AGENT_MODEL_UNSUPPORTED');
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
      if (task.modelInput.executionMode !== input.executionMode ||
          (input.modelRef !== undefined && task.executionModel?.modelRef !== input.modelRef))
        throw continuationConflict('REQUEST_SCOPE_CHANGED');
      if (input.executionMode === 'AILY_AGENT_V1')
        return this.runAily(workItem, input, actor, permissionSnapshotVersion, session, existing, httpRequest);
      if (
        input.retranslateBlockIds &&
        JSON.stringify(task.modelInput.retranslateBlockIds ?? []) !==
          JSON.stringify(input.retranslateBlockIds)
      )
        throw continuationConflict('REQUEST_SCOPE_CHANGED');
      if (existing.status === 'QUEUED' && input.operation === 'EVALUATE_JOBAID' &&
          isProgramAssessmentMode(input.executionMode) && this.initial.queuedContinuationBinding) {
        const pending = await this.initial.queuedContinuationBinding({tenantId:actor.tenantId,
          actorUserId:actor.userId,workItem},input.requestId);
        if (pending.blocked) {
          if (!pending.binding || input.expectedRevision !== workItem.revision) throw cancelledContinuationConflict();
          const guard = this.continuationGuard(pending.binding,actor,workItem,permissionSnapshotVersion,httpRequest);
          await this.sessions!.withVerifiedReviewServiceSql(
            () => this.attempts.releaseQueuedInitialContinuation(guard),actor.userId);
        } else if (pending.status !== 'WAITING' && pending.status !== 'LEASED') throw cancelledContinuationConflict();
      }
      return {
        requestId: input.requestId,
        operation: input.operation,
        status: existing.status,
        replayed: true,
        candidateOnly: true,
      };
    }
    if (this.ailyAdmission?.matches(actor.tenantId, workItem) && input.operation === 'EVALUATE_JOBAID' &&
        input.executionMode !== 'AILY_AGENT_V1') throw continuationConflict('AILY_MODE_REQUIRED');
    const cancelled =
      input.operation === 'EVALUATE_JOBAID' &&
      this.initial.cancelledContinuationBinding
        ? await this.initial.cancelledContinuationBinding({
            tenantId: actor.tenantId,
            actorUserId: actor.userId,
            workItem,
          })
        : null;
    if (
      !cancelled &&
      !isOpenClawAutomaticReviewConfigured({
        tenantId: actor.tenantId,
        workItemId,
      }) &&
      !(await this.initial.hasExactAutoProcessingGrant({
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        workItem,
      }))
    )
      throw continuationConflict('AUTOMATIC_SCOPE_UNAVAILABLE');
    if (workItem.revision !== input.expectedRevision)
      throw continuationConflict('WORK_ITEM_CHANGED');
    const status = await this.initial.project({
      workItem,
      tenantId: actor.tenantId,
      browserActorUserId: actor.userId,
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
    if (input.executionMode === 'AILY_AGENT_V1') {
      if (cancelled) throw continuationConflict('AILY_CANCELLED_GRANT_NOT_ADOPTABLE');
      return this.runAily(workItem, input, actor, permissionSnapshotVersion, session, undefined, httpRequest);
    }
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
    const cancelledGuard = cancelled
      ? this.continuationGuard(cancelled, actor, workItem, permissionSnapshotVersion, httpRequest)
      : undefined;
    const programControlled: ProgramAssessmentAdmission | undefined = isProgramAssessmentMode(input.executionMode) && input.modelRef
      ? {modelRef: input.modelRef, executionMode: input.executionMode} : undefined;
    const reserve = () =>
      input.operation === 'TRANSLATE'
        ? this.translation.enqueueContinuation(
            workItem,
            actor.tenantId,
            input.requestId,
            requestedBlocks,
          )
        : cancelledGuard
          ? this.jobAid.enqueueContinuation(
              workItem,
              actor.tenantId,
              permissionSnapshotVersion,
              input.requestId,
              'INITIAL_PROBLEM_ASSESSMENT',
              authorizedKnowledgeSession,
              undefined,
              cancelledGuard,
              programControlled,
            )
          : this.jobAid.enqueueContinuation(
              workItem,
              actor.tenantId,
              permissionSnapshotVersion,
              input.requestId,
              input.operation === 'EVALUATE_JOBAID'
                ? 'INITIAL_PROBLEM_ASSESSMENT'
                : 'OVERALL_CONSISTENCY',
              authorizedKnowledgeSession,
              undefined, undefined, programControlled,
            );
    const reserved = cancelled
      ? await this.sessions!.withVerifiedReviewServiceSql(reserve, actor.userId)
      : await reserve();
    return {
      requestId: input.requestId,
      operation: input.operation,
      status: 'status' in reserved ? String(reserved.status) : 'QUEUED',
      replayed: !reserved.created,
      candidateOnly: true,
    };
  }

  private async runAily(workItem: CanonicalWorkItemProjection, input: z.infer<typeof command>,
    actor: CanonicalHostActor, permissionSnapshotVersion: string, session?: ResolvedSession | null,
    existing?: ActionAttemptRow, httpRequest?: Request): Promise<CanonicalInitialAnalysisContinuationReceipt> {
    if (!this.ailyAdmission || !this.ailyExecution || !this.sessions || !session || input.operation !== 'EVALUATE_JOBAID')
      throw continuationConflict('AILY_NOT_CONFIGURED');
    if (session.actor.canonicalSubject.id !== actor.userId || session.actor.tenantId !== actor.tenantId ||
        session.actor.applicationScopeId !== actor.appId)
      throw new ForbiddenException('INITIAL_CONTINUATION_IDENTITY_MISMATCH');
    const selected = existing ? null : this.ailyAdmission.require(actor.tenantId, workItem, input.modelRef);
    if (existing) this.ailyAdmission.requireScope(actor.tenantId, workItem);
    const reauthorize = async (): Promise<void> => {
      const fresh = await authorizeAndLoadCanonicalWorkItem({authorization: this.authorization,
        permissionSnapshots: this.permissions, registrar: this.registrar, actor, action: 'EVALUATE_JOB_AID',
        workItemId: workItem.workItemId});
      if (fresh.permissionSnapshotVersion !== permissionSnapshotVersion || fresh.workItem.revision !== workItem.revision ||
          fresh.workItem.source.documentVersionId !== workItem.source.documentVersionId ||
          !this.ailyAdmission!.matches(actor.tenantId, fresh.workItem) ||
          !await this.initial.hasExactAutoProcessingGrant({tenantId: actor.tenantId, actorUserId: actor.userId, workItem: fresh.workItem}))
        throw continuationConflict('AILY_SCOPE_CHANGED');
    };
    return this.sessions.withVerifiedReviewServiceSql(async () => {
      await reauthorize();
      const context = {workItem, actor, sessionId: session.session.id};
      await this.ailyExecution!.preflight(context, input.modelRef!, !!existing);
      if (!existing) {
        const admission: AilyAssessmentAdmission = {...selected!, executionMode: 'AILY_AGENT_V1',
          modelRef: selected!.model.modelRef, actorUserId: actor.userId};
        await this.jobAid.enqueueContinuation(workItem, actor.tenantId, permissionSnapshotVersion, input.requestId,
          'INITIAL_PROBLEM_ASSESSMENT', {sessionId: session.session.id, actorId: actor.userId, tenantId: actor.tenantId},
          undefined, undefined, admission);
      }
      const key = `openclaw-v2:dynamic:${workItem.workItemId}:${workItem.source.documentVersionId}:${input.requestId}`;
      const row = existing ?? await this.attempts.readRequest({tenantId: actor.tenantId, workItemId: workItem.workItemId,
        taskType: 'OPENCLAW_DYNAMIC_EVALUATION', documentVersionId: workItem.source.documentVersionId, idempotencyKey: key});
      if (!row) throw continuationConflict('AILY_REQUEST_NOT_FOUND');
      if (row.status === 'QUEUED') {
        if (!this.automaticDispatch || process.env.WL_JOBAID_PROBLEM_V2_ENABLED !== '1')
          throw continuationConflict('AILY_NOT_CONFIGURED');
        const progress=await this.initial.project({workItem,tenantId:actor.tenantId,browserActorUserId:actor.userId});
        assertContinuationPrerequisites(input,workItem,progress.stages.jobAid.status);
        if(progress.status==='NOT_READY'||!canContinueInitialStage(progress.stages,input.operation,true,workItem)||
            Object.values(progress.stages).some(stage=>stage.attemptRef!==row.operationRef&&stage.attemptStatus&&
              ['QUEUED','RUNNING','RETRY_SCHEDULED','COMMITTING'].includes(stage.attemptStatus)))
          throw continuationConflict('PREREQUISITE_NOT_READY');
        await this.ailyExecution!.preflight(context, parseTaskEnvelope(row.taskEnvelopeJson).executionModel!.modelRef);
        const authorize = this.continuationAuthorization(actor, workItem, permissionSnapshotVersion, httpRequest,
          () => continuationConflict('AILY_SCOPE_CHANGED'));
        await this.automaticDispatch.authorizeAilyInitialSuccessor({tenantId:actor.tenantId,actorUserId:actor.userId,
          workItem,request:row,stageRequestId:input.requestId,authorize:async(database,owners)=>{
            if(owners.length!==1||!matchesInitialContinuationOwner(owners[0],{tenantId:actor.tenantId,actorUserId:actor.userId,workItem}))
              throw continuationConflict('AILY_SCOPE_CHANGED');
            await authorize(database);
          }});
      }
      const ailyDispatch = await this.ailyExecution!.execute({...context, permissionSnapshotVersion,
        requestId: input.requestId, row, reauthorize});
      const current = await this.attempts.readRequest({tenantId: actor.tenantId, workItemId: workItem.workItemId,
        taskType: 'OPENCLAW_DYNAMIC_EVALUATION', documentVersionId: workItem.source.documentVersionId, idempotencyKey: key});
      if (!current) throw continuationConflict('AILY_REQUEST_NOT_FOUND');
      return {requestId: input.requestId, operation: input.operation, status: current.status,
        replayed: !!existing, candidateOnly: true, ailyDispatch};
    }, actor.userId);
  }

  private continuationGuard(
    binding: CancelledInitialContinuationBinding,
    actor: CanonicalHostActor,
    workItem: CanonicalWorkItemProjection,
    permissionSnapshotVersion: string,
    httpRequest?: Request,
  ): CancelledInitialContinuationGuard {
    if (!this.sessions || !httpRequest || !this.sourceAuthorization) throw cancelledContinuationConflict();
    return {
      binding,
      authorize: this.continuationAuthorization(actor,workItem,permissionSnapshotVersion,httpRequest),
    };
  }

  private continuationAuthorization(actor:CanonicalHostActor,workItem:CanonicalWorkItemProjection,
    permissionSnapshotVersion:string,httpRequest?:Request,reject:()=>Error=cancelledContinuationConflict) {
    const workItemId = workItem.workItemId;
    return async (database: PostgresJsDatabase):Promise<void> => {
      if (!this.sessions || !httpRequest || !this.sourceAuthorization)
        throw reject();
      const current = this.sessions.nativeBrowserIdentity(httpRequest);
      if (
        !current ||
        current.actor.canonicalSubject.id !== actor.userId ||
        current.actor.tenantId !== actor.tenantId ||
        current.actor.applicationScopeId !== actor.appId
      )
        throw reject();
      const decision = await this.authorization.authorize(
        { actor, action: 'EVALUATE_JOB_AID', workItemId },
        database,
      );
      const fresh = await this.permissions.freshRead(
        { actor, decision, workItemId },
        database,
      );
      if (
        !decision.allowed ||
        decision.action !== 'EVALUATE_JOB_AID' ||
        fresh.permissionSnapshotVersion !== permissionSnapshotVersion ||
        decision.permissionSnapshotVersion !== permissionSnapshotVersion
      )
        throw reject();
      const source = workItem.source;
      const permission =
        await this.sourceAuthorization.authorizeSourceRead({
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          workItemId,
          requestId: workItem.requestId,
          documentId: source.documentId,
          documentVersionId: source.documentVersionId,
          sourceArtifactId: source.sourceArtifactId,
          sourceFileSha256: source.sourceFileSha256.replace(
            /^sha256:/u,
            '',
          ),
          sourceByteLength: source.sourceByteLength,
        }, database);
      if (
        !permission.allowed || permission.action !== 'DOCUMENT_READ' || permission.authorizationPolicy !== 'MIAODA_HOST_DOCUMENT_READ' ||
        permission.tenantId !== actor.tenantId ||
        permission.actorUserId !== actor.userId ||
        permission.documentId !== source.documentId ||
        permission.documentVersionId !== source.documentVersionId ||
        permission.sourceArtifactId !== source.sourceArtifactId ||
        permission.sourceFileSha256 !==
          source.sourceFileSha256.replace(/^sha256:/u, '') ||
        permission.sourceByteLength !== source.sourceByteLength
      )
        throw reject();
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
    try {
      const access = await this.sessions.withVerifiedServiceSql(
        () => this.aily!.availability(binding),
        actor.userId,
      );
      return access.available ? binding : undefined;
    } catch (error) {
      // Expired optional OAuth never revokes the native local operation.
      // External knowledge still requires its own current session and grant.
      if (error instanceof UnauthorizedException &&
          error.message === 'OFFICIAL_OAUTH_SESSION_REQUIRED') return undefined;
      throw error;
    }
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
    workItem.classification.normalizedFamily === 'SB' &&
    workItem.classification.status !== 'CONFIRMED'
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
