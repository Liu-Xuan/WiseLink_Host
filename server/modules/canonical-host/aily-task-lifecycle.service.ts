import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { actionAttempt } from '../../database/schema';
import { ActionAttemptRepository } from '../action-attempt/action-attempt.repository';
import { ActionAttemptLifecycleService } from '../action-attempt/action-attempt-lifecycle.service';
import { parseTaskEnvelope } from '../action-attempt/action-attempt-envelope';
import { taskAutomaticWorkItemLease } from '../action-attempt/automatic-work-item-attempt-lease';
import { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';
import { AilyTaskAdmissionService } from './aily-task-admission';
import { EngineeringMatterWorkingRepository } from './engineering-matter-working.repository';
import { AILY_TASK_CHAT_CLIENT, type AilyTaskChatClient } from './aily-task-execution.service';
import { AILY_HOST_INVOCATION_IDENTITY, assertAilyInvocationBinding, type AilyHostInvocationIdentityPort } from './aily-host-invocation-identity.port';
import { canonicalHostBareSha256 } from './canonical-host-sha256';
import { assertAilyRequestTaskBinding, type AilyExecutorRun } from './aily-executor-run';

/** One trusted invocation. Scheduling/provider approval remains a separate step. */
@Injectable()
export class AilyTaskLifecycleService {
  constructor(private readonly repository: ActionAttemptRepository,
    private readonly attempts: ActionAttemptLifecycleService, private readonly admission: AilyTaskAdmissionService,
    private readonly actors: EngineeringMatterWorkingRepository, private readonly workItems: MiaodaWorkItemRepository,
    @Inject(AILY_TASK_CHAT_CLIENT) private readonly client: AilyTaskChatClient,
    @Inject(AILY_HOST_INVOCATION_IDENTITY) private readonly invocation: AilyHostInvocationIdentityPort) {}

  async tick(taskContextRef: string) {
    const row = await this.repository.readByOperationRef(taskContextRef);
    if (!row?.actorUserId) throw new Error('AILY_LIFECYCLE_TASK_NOT_FOUND');
    return this.actors.withActorScope(row.actorUserId,async () => {
      const task = parseTaskEnvelope(row.taskEnvelopeJson);
      const current = await this.workItems.loadAutoProcessingProjection(row.workItemId,row.tenantId);
      if (!current?.projection || current.row.requestedByUserId !== row.actorUserId ||
          task.modelInput.executionMode !== 'AILY_AGENT_V1' || task.operationRef !== taskContextRef ||
          task.inputHash !== row.taskInputHash || task.documentVersionId !== current.projection.source.documentVersionId ||
          !task.sourceRefs.some(ref => ref.ref === current.projection!.source.sourceArtifactId &&
            ref.sha256 === canonicalHostBareSha256(current.projection!.source.sourceFileSha256)))
        throw new Error('AILY_LIFECYCLE_TASK_BINDING_CHANGED');
      const config = this.admission.requireScope(row.tenantId,current.projection);
      const run = await this.repository.readAilyExecutorRun(row);
      if (!run || run.agentId !== config.agentId || run.scope.principalId !== config.principalId ||
          run.scope.tenantId !== row.tenantId || run.scope.workItemId !== row.workItemId ||
          run.scope.intakeRequestId !== current.projection.requestId || run.leaseGeneration !== row.leaseGeneration ||
          task.idempotencyKey !== `openclaw-v2:dynamic:${row.workItemId}:${task.documentVersionId}:${run.requestId}` ||
          run.modelEvidence.selectedModelRef !== task.executionModel?.modelRef)
        throw new Error('AILY_LIFECYCLE_RUN_BINDING_CHANGED');
      assertAilyRequestTaskBinding(run.requestId, task);
      if (!run.invocation) return {status:'UNAVAILABLE' as const,reason:'AILY_ORIGINAL_BROWSER_INVOCATION_REQUIRED',
        taskContextRef,requestId:run.requestId,hostStatus:row.status,postState:run.post.state};
      const request = {purpose:'BACKGROUND' as const,tenantId:row.tenantId,actorUserId:row.actorUserId!,
        workItemId:row.workItemId,principalId:config.principalId,agentId:run.agentId};
      const identity = await this.invocation.resolve(request);
      if (identity.status !== 'READY') return {status:'UNAVAILABLE' as const,reason:identity.reason};
      const accessToken = assertAilyInvocationBinding(identity,request);
      if (run.invocation && run.invocation.callerAppId !== identity.callerAppId)
        throw new Error('AILY_INVOCATION_CALLER_CHANGED');
      if (row.cancelRequestedAt || row.status === 'CANCELLED') return {status:'CANCELLED' as const,
        remoteCancellation:'UNCONFIRMED' as const};
      const now = new Date();
      const bound = taskAutomaticWorkItemLease(row);
      const outer = await this.workItems.loadActiveAutoProcessingLease({tenantId:row.tenantId,
        workItemId:row.workItemId,leaseOwner:config.principalId,now});
      if (!bound || !outer || outer.authorization.requestId !== bound.requestId ||
          outer.authorization.leaseGeneration !== bound.leaseGeneration || outer.authorization.actorUserId !== row.actorUserId ||
          !outer.authorization.leaseExpiresAt || !row.deadlineAt || row.deadlineAt <= now ||
          (row.status === 'RUNNING' && (!row.leaseExpiresAt || row.leaseExpiresAt <= now)))
        return {status:'EXPIRED_OR_UNAUTHORIZED' as const};
      if (!this.client.configured) return {status:'UNAVAILABLE' as const,reason:'AILY_TRANSPORT_UNAVAILABLE'};
      let observation: Awaited<ReturnType<AilyTaskChatClient['read']>> | null = null;
      let observationUnconfirmed = false;
      if (run.post.state === 'ACCEPTED') {
        try { observation = await this.client.read({agentId:run.agentId,accessToken,
          chatId:run.post.chatId,remoteSessionId:run.post.remoteSessionId ?? undefined}); }
        catch { observationUnconfirmed = true; }
      }
      if (observation && run.post.state === 'ACCEPTED' && observation.chatId !== run.post.chatId)
        throw new Error('AILY_RESULT_CHAT_MISMATCH');
      if (row.status !== 'RUNNING') return {status: observationUnconfirmed ? 'OBSERVATION_UNCONFIRMED' as const : 'OBSERVED' as const,
        observation, hostStatus:row.status,recoveryRequired:row.status === 'COMMITTING',taskContextRef,postState:run.post.state};
      // Revoke/cancel/expiry during GET is checked by the original atomic fence.
      const authorized = await this.invocation.resolve(request);
      if (authorized.status !== 'READY') return {status:'UNAVAILABLE' as const,reason:authorized.reason};
      assertAilyInvocationBinding(authorized,request);
      if (run.invocation && run.invocation.callerAppId !== authorized.callerAppId)
        throw new Error('AILY_INVOCATION_CALLER_CHANGED');
      if (!row.leaseToken) throw new Error('AILY_LIFECYCLE_LEASE_REQUIRED');
      const heartbeat = await this.attempts.heartbeat({attemptRef:taskContextRef,tenantId:row.tenantId,
        workItemId:row.workItemId,principalId:config.principalId,leaseToken:row.leaseToken,
        leaseGeneration:row.leaseGeneration,automaticLeaseRequired:true,
        writePredicate:sql`${actionAttempt.leaseExpiresAt}>clock_timestamp() AND ${actionAttempt.deadlineAt}>clock_timestamp()
          AND ${actionAttempt.taskInputHash}=${task.inputHash}`});
      let observationPersisted = false;
      let currentObservation: AilyExecutorRun['observation'];
      if (observation) {
        observationPersisted = await this.repository.compareAndSetAilyObservation({row, principalId:config.principalId,
          expected:run, observation:{checkedAt:new Date().toISOString(),remoteStatus:observation.remoteStatus,
            ...(observation.remoteFinishReason === undefined ? {} : {remoteFinishReason:observation.remoteFinishReason})}});
        if (!observationPersisted) currentObservation = (await this.repository.readAilyExecutorRun(row))?.observation;
      }
      return {status: observationUnconfirmed ? 'OBSERVATION_UNCONFIRMED' as const : 'OBSERVED' as const,
        hostStatus:row.status,postState:run.post.state,requestId:run.requestId,taskContextRef,
        observation,observationPersisted,...(currentObservation ? {currentObservation} : {}),
        ...(run.post.state === 'UNKNOWN' ? {postErrorCode:run.post.errorCode} : {}),
        ...(observationUnconfirmed ? {errorCode:'AILY_OBSERVATION_UNCONFIRMED'} : {}),
        effectiveWriteExpiresAt:new Date(Math.min(new Date(heartbeat.leaseExpiresAt).getTime(),
          row.deadlineAt.getTime(),outer.authorization.leaseExpiresAt.getTime())).toISOString()};
    });
  }
}
